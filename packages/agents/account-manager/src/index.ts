/**
 * Account Manager Agent - Main Implementation
 *
 * Conversational agent that tracks user priorities through natural conversation.
 * Maintains three types of priorities: goals, challenges, opportunities.
 *
 * Key Characteristics:
 * - Learns through conversation, not interrogation
 * - Updates priorities silently in background
 * - Never sends messages directly to users
 * - Provides context to other agents (Concierge, Innovator)
 *
 * When Invoked:
 * - After 3rd conversation with Concierge (initial setup)
 * - When user mentions goals/challenges (explicit priority updates)
 * - Every 2 weeks (scheduled priority review)
 * - Before major agent actions (provide user context)
 *
 * @module account-manager
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  createServiceClient,
  type User,
  type Conversation,
  type Message,
} from '@yachtparty/shared';

import {
  ACCOUNT_MANAGER_SYSTEM_PROMPT,
  buildPriorityExtractionPrompt,
  buildCheckInPrompt,
  buildContextPrompt,
} from './prompts';

import {
  parseAccountManagerResponse,
  sanitizePriorityContent,
} from './parsers';

import type {
  AccountManagerContext,
  AccountManagerResponse,
  FormattedPriorities,
  UserPriority,
} from './types';

// Initialize Anthropic client
if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY environment variable is required');
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = 'claude-3-5-sonnet-20241022';

/**
 * Main entry point for Account Manager Agent.
 *
 * This function is invoked when:
 * - A user has had 3+ conversations (initial setup)
 * - User mentions goals/challenges in conversation
 * - Scheduled review every 2 weeks
 * - Another agent requests user context
 *
 * @param message - The message that triggered this invocation (may be null for scheduled tasks)
 * @param user - User record
 * @param conversation - Conversation record
 * @param context - Invocation context (trigger type, recent messages, etc.)
 * @returns Agent response with actions to execute
 */
export async function invokeAccountManagerAgent(
  _message: Message,
  user: User,
  conversation: Conversation,
  context?: AccountManagerContext
): Promise<AccountManagerResponse> {
  const startTime = Date.now();
  const supabase = createServiceClient();

  console.log(
    `[Account Manager] Invoked for user ${user.id}, trigger: ${context?.trigger || 'unknown'}`
  );

  try {
    // Load existing priorities from database
    const { data: priorityData, error: priorityError } = await supabase
      .from('user_priorities')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (priorityError) {
      console.error('[Account Manager] Error loading priorities:', priorityError);
    }

    const existingPriorities = (priorityData || []) as UserPriority[];

    // Format priorities for prompts
    const formattedPriorities = formatPrioritiesForPrompt(existingPriorities);

    // Load recent messages (last 20 from conversation)
    const { data: messagesData, error: messagesError } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (messagesError) {
      console.error('[Account Manager] Error loading messages:', messagesError);
    }

    const recentMessages = ((messagesData || []) as Message[]).reverse();

    // Build prompt based on trigger type
    let prompt: string;
    let trigger = context?.trigger || 'explicit_mention';

    switch (trigger) {
      case 'scheduled_review':
        const daysSinceLastUpdate = calculateDaysSinceLastUpdate(existingPriorities);
        prompt = buildCheckInPrompt({
          user,
          priorities: formattedPriorities,
          daysSinceLastUpdate,
        });
        break;

      case 'context_request':
        prompt = buildContextPrompt({
          user,
          priorities: formattedPriorities,
          requestingAgent: 'concierge',
        });
        break;

      case 'initial_setup':
      case 'explicit_mention':
      default:
        prompt = buildPriorityExtractionPrompt({
          user,
          priorities: formattedPriorities,
          recentMessages,
          trigger,
        });
        break;
    }

    // Call Claude API
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      temperature: 0.3,
      system: [
        {
          type: 'text',
          text: ACCOUNT_MANAGER_SYSTEM_PROMPT,
          // @ts-ignore - cache_control is valid but not in type definitions yet
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    // Extract response text
    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text content in Claude response');
    }

    // Parse response into actions
    const actions = parseAccountManagerResponse(textContent.text, existingPriorities);

    // Execute actions (update database)
    for (const action of actions) {
      await executeAction(action, user.id, supabase);
    }

    // Publish priority update event for Concierge (simplified architecture)
    // Concierge will decide when/how to notify user
    const { data: updatedPriorities } = await supabase
      .from('user_priorities')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('value_score', { ascending: false })
      .limit(5);

    if (updatedPriorities && updatedPriorities.length > 0) {
      const urgentItems = updatedPriorities.filter((p: any) => (p.value_score || 0) >= 80);

      if (urgentItems.length > 0) {
        await supabase.from('events').insert({
          event_type: 'priority.update',
          aggregate_id: user.id,
          aggregate_type: 'user',
          payload: {
            priorities: urgentItems.map((p: any) => ({
              item_type: p.item_type,
              item_id: p.item_id,
              value_score: p.value_score,
              content: p.content,
            })),
            maxScore: Math.max(...urgentItems.map((p: any) => p.value_score || 0)),
            itemCount: urgentItems.length,
          },
          created_by: 'account_manager',
          metadata: {
            trigger,
            totalPriorities: updatedPriorities.length,
          },
        });

        console.log(`[Account Manager] Published priority.update event with ${urgentItems.length} urgent items`);
      }
    }

    // Log agent action
    await logAgentAction({
      agentType: 'account_manager',
      actionType: 'agent_invocation',
      userId: user.id,
      conversationId: conversation.id,
      modelUsed: MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      costUsd: calculateCost(response.usage.input_tokens, response.usage.output_tokens),
      latencyMs: Date.now() - startTime,
      inputData: {
        trigger,
        existingPrioritiesCount: existingPriorities.length,
      },
      outputData: {
        actionsCount: actions.length,
        responseText: textContent.text,
      },
    });

    console.log(
      `[Account Manager] Completed in ${Date.now() - startTime}ms, ${actions.length} actions`
    );

    return {
      immediateReply: false, // Account Manager never replies directly
      actions,
      reasoning: textContent.text,
    };
  } catch (error) {
    console.error('[Account Manager] Error:', error);

    // Log error
    await logAgentAction({
      agentType: 'account_manager',
      actionType: 'agent_invocation',
      userId: user.id,
      conversationId: conversation.id,
      latencyMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    });

    // Return empty response on error
    return {
      immediateReply: false,
      actions: [],
    };
  }
}

/**
 * Formats priorities for prompt (grouped by type)
 */
function formatPrioritiesForPrompt(priorities: UserPriority[]): FormattedPriorities {
  const goals = priorities
    .filter((p) => p.priority_type === 'goal')
    .map((p) => ({
      id: p.id,
      content: p.content,
      created_at: p.created_at,
    }));

  const challenges = priorities
    .filter((p) => p.priority_type === 'challenge')
    .map((p) => ({
      id: p.id,
      content: p.content,
      created_at: p.created_at,
    }));

  const opportunities = priorities
    .filter((p) => p.priority_type === 'opportunity')
    .map((p) => ({
      id: p.id,
      content: p.content,
      created_at: p.created_at,
    }));

  return { goals, challenges, opportunities };
}

/**
 * Calculates days since last priority update
 */
function calculateDaysSinceLastUpdate(priorities: UserPriority[]): number {
  if (priorities.length === 0) return 999; // No priorities yet

  const latestUpdate = priorities.reduce((latest, p) => {
    const pDate = new Date(p.updated_at || p.created_at);
    return pDate > latest ? pDate : latest;
  }, new Date(0));

  const now = new Date();
  const diffMs = now.getTime() - latestUpdate.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Executes an action (updates database)
 */
async function executeAction(action: any, userId: string, supabase: any): Promise<void> {
  console.log(`[Account Manager] Executing action: ${action.type}`);

  switch (action.type) {
    case 'update_priority': {
      const { priority_type, content, status, metadata } = action.params;

      // Sanitize content
      const sanitizedContent = sanitizePriorityContent(content);

      // Check if priority already exists (based on content similarity)
      const { data: existing } = await supabase
        .from('user_priorities')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .ilike('content', `%${sanitizedContent.substring(0, 50)}%`);

      if (existing && existing.length > 0) {
        // Update existing priority
        await supabase
          .from('user_priorities')
          .update({
            content: sanitizedContent,
            updated_at: new Date().toISOString(),
            metadata: { ...existing[0].metadata, ...metadata },
          })
          .eq('id', existing[0].id);

        console.log(`[Account Manager] Updated existing priority: ${existing[0].id}`);
      } else {
        // Insert new priority (use item_type and item_id for compatibility)
        await supabase.from('user_priorities').insert({
          user_id: userId,
          priority_rank: 999, // Will be re-ranked later
          item_type: priority_type, // Using item_type to store priority_type
          item_id: generatePriorityId(), // Generate fake UUID for compatibility
          value_score: 50, // Default score
          status: status || 'active',
          content: sanitizedContent,
          metadata: {
            priority_type, // Store actual type in metadata
            ...metadata,
          },
        });

        console.log(`[Account Manager] Created new priority: ${priority_type}`);
      }
      break;
    }

    case 'archive_priority': {
      const { priority_id, reason } = action.params;

      await supabase
        .from('user_priorities')
        .update({
          status: 'archived',
          updated_at: new Date().toISOString(),
          metadata: { archive_reason: reason },
        })
        .eq('id', priority_id);

      console.log(`[Account Manager] Archived priority: ${priority_id}`);
      break;
    }

    case 'schedule_check_in': {
      const { days_from_now, reason } = action.params;
      const scheduledFor = new Date();
      scheduledFor.setDate(scheduledFor.getDate() + days_from_now);

      await supabase.from('agent_tasks').insert({
        task_type: 're_engagement_check',
        agent_type: 'account_manager',
        user_id: userId,
        scheduled_for: scheduledFor.toISOString(),
        priority: 'medium',
        context_json: {
          reason,
          trigger: 'scheduled_review',
        },
      });

      console.log(
        `[Account Manager] Scheduled check-in for ${days_from_now} days from now`
      );
      break;
    }

    case 'provide_context': {
      // This is for other agents requesting context
      // No database action needed, just return in response
      console.log('[Account Manager] Provided context to requesting agent');
      break;
    }

    default:
      console.warn(`[Account Manager] Unknown action type: ${action.type}`);
  }
}

/**
 * Generates a priority ID (UUID v4)
 */
function generatePriorityId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Logs agent action to agent_actions_log table
 */
async function logAgentAction(params: {
  agentType: string;
  actionType: string;
  userId?: string;
  conversationId?: string;
  modelUsed?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  inputData?: any;
  outputData?: any;
  error?: string;
}): Promise<void> {
  const supabase = createServiceClient();

  await supabase.from('agent_actions_log').insert({
    agent_type: params.agentType,
    action_type: params.actionType,
    user_id: params.userId || null,
    context_id: params.conversationId || null,
    context_type: params.conversationId ? 'conversation' : null,
    model_used: params.modelUsed || null,
    input_tokens: params.inputTokens || null,
    output_tokens: params.outputTokens || null,
    cost_usd: params.costUsd || null,
    latency_ms: params.latencyMs || null,
    input_data: params.inputData || null,
    output_data: params.outputData || null,
    error: params.error || null,
  });
}

/**
 * Calculates LLM API cost in USD
 *
 * Claude 3.5 Sonnet pricing:
 * - Input: $3.00 per million tokens
 * - Output: $15.00 per million tokens
 * - Cached input: $0.30 per million tokens (90% discount)
 */
function calculateCost(inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1_000_000) * 3.0;
  const outputCost = (outputTokens / 1_000_000) * 15.0;
  return inputCost + outputCost;
}

/**
 * Export as default for Cloud Run service
 */
export default invokeAccountManagerAgent;

/**
 * Export types for use by other modules
 */
export type {
  AccountManagerContext,
  AccountManagerResponse,
  UserPriority,
  PriorityType,
} from './types';
