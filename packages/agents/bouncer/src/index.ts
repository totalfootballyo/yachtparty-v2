/**
 * Bouncer Agent - Main Implementation
 *
 * The Bouncer Agent onboards new users through verification process.
 * Handles all interactions with unverified users (user.verified = false).
 *
 * Architecture:
 * - Stateless: Loads fresh context from database on each invocation
 * - Event-driven: Publishes events, never calls other agents directly
 * - Uses Claude API for conversational responses and decision making
 * - Implements prompt caching to reduce costs (~40% reduction)
 *
 * @module bouncer-agent
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/messages';
import { createServiceClient } from '@yachtparty/shared';
import type {
  User,
  Conversation,
  Message,
  AgentActionsLog,
  AgentResponse,
  AgentAction,
  AgentEvent
} from '@yachtparty/shared';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

import {
  checkOnboardingProgress,
  collectUserInfo,
  generateVerificationEmail,
  completeOnboarding,
  createReengagementTask,
  storeNomination,
  lookupUserByName,
  type OnboardingProgress
} from './onboarding-steps';

import {
  buildDecisionPrompt,
  buildReengagementDecisionPrompt,
  DECISION_TOOL
} from './decision';

import {
  buildPersonalityPrompt
} from './personality';

// Initialize Anthropic client (verify API key is present)
if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY environment variable is required but not set');
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const MODEL = 'claude-sonnet-4-20250514';

/**
 * Extracts JSON from Claude's response text.
 *
 * Handles various formats:
 * - Pure JSON
 * - JSON wrapped in markdown code fences (```json ... ```)
 * - JSON with explanatory text before/after
 *
 * @param text - Raw text from Claude's response
 * @returns Parsed JSON object
 * @throws Error if no valid JSON found
 */
/**
 * Agent context loaded fresh on each invocation.
 */
interface BouncerContext {
  user: User;
  conversation: Conversation;
  recentMessages: Message[];
  progress: OnboardingProgress;
}

/**
 * Main entry point for Bouncer Agent.
 *
 * This is the primary function invoked when a user message is received
 * or when a scheduled task fires (re-engagement).
 *
 * @param message - The incoming message from user
 * @param user - User record
 * @param conversation - Conversation record
 * @returns Agent response with actions to take
 */
export async function invokeBouncerAgent(
  message: Message,
  user: User,
  conversation: Conversation
): Promise<AgentResponse> {
  const startTime = Date.now();

  try {
    // Load context
    const context = await loadContext(user, conversation);

    // Check if this is a special task invocation
    const isSystemTask = message.role === 'system';
    const isEmailVerifiedAcknowledgment = isSystemTask && context.user.email_verified && message.content?.includes('email_verified');

    // Parse re-engagement context if present
    let reengagementContext: any = null;
    if (isSystemTask && !isEmailVerifiedAcknowledgment) {
      try {
        const parsed = JSON.parse(message.content);
        if (parsed.type === 're_engagement_check') {
          reengagementContext = parsed;
        }
      } catch (e) {
        // Not JSON or not re-engagement, continue
      }
    }

    let response: AgentResponse;

    if (isEmailVerifiedAcknowledgment) {
      response = await handleEmailVerifiedAcknowledgment(context);
    } else if (reengagementContext) {
      response = await handleReengagement(context, reengagementContext);
    } else if (isSystemTask) {
      // Unknown system task - ignore it and don't respond
      console.log(`⚠️  Unknown system task for user ${user.id}, message content: ${message.content}`);
      return {
        immediateReply: false,
        message: undefined,
        actions: [],
        reasoning: 'Unknown system task, no action taken'
      };
    } else {
      response = await handleUserMessage(context, message);
    }

    // Log action
    await logAgentAction({
      agent_type: 'bouncer',
      action_type: 'agent_invocation',
      user_id: user.id,
      context_id: conversation.id,
      context_type: 'conversation',
      latency_ms: Date.now() - startTime,
      input_data: {
        message_content: message.content
      },
      output_data: {
        immediate_reply: response.immediateReply,
        actions_count: response.actions.length,
        events_count: response.events?.length || 0
      }
    });

    return response;
  } catch (error) {
    // Log error
    await logAgentAction({
      agent_type: 'bouncer',
      action_type: 'agent_invocation',
      user_id: user.id,
      context_id: conversation.id,
      context_type: 'conversation',
      latency_ms: Date.now() - startTime,
      input_data: {
        message_content: message.content
      },
      error: error instanceof Error ? error.message : String(error)
    });

    throw error;
  }
}

/**
 * Loads fresh context from database.
 *
 * This function is called on every invocation to ensure we have
 * the latest state from the database.
 */
async function loadContext(
  user: User,
  conversation: Conversation
): Promise<BouncerContext> {
  const supabase = createServiceClient();

  // Load recent messages (last 20)
  const { data: messages, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    throw new Error(`Failed to load messages: ${error.message}`);
  }

  const recentMessages = (messages as Message[] || []).reverse();

  // Check onboarding progress
  const progress = checkOnboardingProgress(user, conversation);

  return {
    user,
    conversation,
    recentMessages,
    progress
  };
}

/**
 * Handles re-engagement check using 2-LLM architecture with enhanced social judgment.
 */
async function handleReengagement(
  context: BouncerContext,
  reengagementContext: any
): Promise<AgentResponse> {
  const actions: AgentAction[] = [];
  const events: AgentEvent[] = [];

  // Build conversation history (last 10-15 messages for re-engagement - need more context)
  const conversationMessages = context.recentMessages
    .filter(msg => msg.role !== 'system')
    .slice(-15)
    .map(msg => ({
      role: msg.role === 'user' ? 'user' : 'assistant' as 'user' | 'assistant',
      content: msg.content
    }));

  // Add re-engagement context as synthetic user message
  conversationMessages.push({
    role: 'user',
    content: `(re-engagement check: ${reengagementContext.attemptCount} attempts, last interaction: ${reengagementContext.lastInteractionAt})`
  });

  console.log(`[2-LLM] Starting Call 1: Re-engagement decision (attempt ${reengagementContext.attemptCount})`);

  // ====================
  // CALL 1: RE-ENGAGEMENT DECISION
  // ====================
  const decisionPrompt = buildReengagementDecisionPrompt(context.user, context.progress, reengagementContext);
  const decisionResponse = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 500,
    temperature: 0.6, // Higher temp for nuanced social judgment
    system: decisionPrompt,
    tools: [DECISION_TOOL],
    messages: conversationMessages
  });

  // Extract decision
  const decisionTool = decisionResponse.content.find(
    (block): block is ToolUseBlock => block.type === 'tool_use' && block.name === 'make_decision'
  );

  if (!decisionTool) {
    throw new Error('Decision tool not used by LLM in re-engagement Call 1');
  }

  const decision = decisionTool.input as {
    tools_to_use: Array<{ tool_name: string; tool_input: any }>;
    next_scenario: string;
    context_for_response: string;
  };

  console.log(`[2-LLM] Re-engagement decision: ${decision.next_scenario}, tools: ${decision.tools_to_use.length}`);

  // ====================
  // EXECUTE TOOLS
  // ====================
  const toolResults: any = {};

  for (const toolDef of decision.tools_to_use) {
    const toolUse: ToolUseBlock = {
      type: 'tool_use',
      id: `tool_${Date.now()}`,
      name: toolDef.tool_name,
      input: toolDef.tool_input
    };

    const { actions: toolActions, events: toolEvents } = await executeBouncerTools(
      [toolUse],
      context
    );

    actions.push(...toolActions);
    events.push(...toolEvents);
  }

  // Reload user state after tool execution
  const supabase = createServiceClient();
  const { data: updatedUser } = await supabase
    .from('users')
    .select('*')
    .eq('id', context.user.id)
    .single();

  if (updatedUser) {
    context.user = updatedUser as User;
    context.progress = checkOnboardingProgress(context.user, context.conversation);
  }

  // ====================
  // CALL 2: PERSONALITY (if decision says to send message)
  // ====================
  let messageTexts: string[] = [];

  if (decision.next_scenario !== 'no_message') {
    console.log(`[2-LLM] Starting Call 2: Re-engagement personality response`);

    const personalityPrompt = buildPersonalityPrompt(
      decision.next_scenario,
      decision.context_for_response,
      toolResults
    );

    const personalityResponse = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      temperature: 0.7,
      system: personalityPrompt,
      messages: conversationMessages
    });

    const textBlocks = personalityResponse.content.filter(
      (block): block is Anthropic.Messages.TextBlock => block.type === 'text'
    );

    // Parse message sequences (split by "---" delimiter)
    const rawTexts = textBlocks.map(block => block.text.trim()).filter(t => t.length > 0);
    messageTexts = rawTexts.flatMap(text =>
      text.split(/\n---\n/).map(msg => msg.trim()).filter(msg => msg.length > 0)
    );
  }

  // Create re-engagement task if onboarding still incomplete
  // BUT stop after 2 re-engagement attempts without response
  const attemptCount = reengagementContext.attemptCount || 0;

  if (!context.progress.isComplete && attemptCount < 2) {
    const taskId = await createReengagementTask(
      context.user.id,
      context.conversation.id,
      context.progress.currentStep,
      context.progress.missingFields
    );

    actions.push({
      type: 'create_task',
      params: { task_id: taskId, task_type: 're_engagement_check' },
      reason: `Schedule re-engagement check (attempt ${attemptCount + 1})`
    });
  } else if (attemptCount >= 2) {
    console.log(`[2-LLM] Stopping re-engagement for user ${context.user.id} after ${attemptCount} attempts - conversation will be paused`);
  }

  return {
    immediateReply: messageTexts.length > 0,
    messages: messageTexts,
    actions,
    events,
    reasoning: '2-LLM re-engagement: decision + personality with social judgment'
  };
}

/**
 * Handles incoming user message using 2-LLM architecture.
 * Call 1: Decision-making (actions)
 * Call 2: Personality response (text only)
 */
async function handleUserMessage(
  context: BouncerContext,
  message: Message
): Promise<AgentResponse> {
  const actions: AgentAction[] = [];
  const events: AgentEvent[] = [];

  // Build conversation history (last 5 messages for user message handling)
  const conversationMessages = context.recentMessages
    .slice(-5)
    .map(msg => ({
      role: msg.role === 'user' ? 'user' : 'assistant' as 'user' | 'assistant',
      content: msg.content
    }));

  // Add current message
  conversationMessages.push({
    role: 'user',
    content: message.content
  });

  console.log(`[2-LLM] Starting Call 1: Decision making (user message)`);

  // ====================
  // CALL 1: DECISION
  // ====================
  const decisionPrompt = buildDecisionPrompt(context.user, context.progress);
  const decisionResponse = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 500,
    temperature: 0.1, // Low temp for consistent data extraction
    system: decisionPrompt,
    tools: [DECISION_TOOL],
    messages: conversationMessages
  });

  // Extract decision
  const decisionTool = decisionResponse.content.find(
    (block): block is ToolUseBlock => block.type === 'tool_use' && block.name === 'make_decision'
  );

  if (!decisionTool) {
    throw new Error('Decision tool not used by LLM in Call 1');
  }

  const decision = decisionTool.input as {
    tools_to_use: Array<{ tool_name: string; tool_input: any }>;
    next_scenario: string;
    context_for_response: string;
  };

  console.log(`[2-LLM] Decision: ${decision.next_scenario}, tools: ${decision.tools_to_use.length}`);

  // ====================
  // EXECUTE TOOLS
  // ====================
  const toolResults: any = {};

  for (const toolDef of decision.tools_to_use) {
    const toolUse: ToolUseBlock = {
      type: 'tool_use',
      id: `tool_${Date.now()}`,
      name: toolDef.tool_name,
      input: toolDef.tool_input
    };

    const { actions: toolActions, events: toolEvents } = await executeBouncerTools(
      [toolUse],
      context
    );

    actions.push(...toolActions);
    events.push(...toolEvents);

    // Store verification email if generated
    if (toolDef.tool_name === 'send_verification_email') {
      toolResults.verificationEmail = generateVerificationEmail(context.user.id);
      console.log(`[2-LLM] Generated verification email: ${toolResults.verificationEmail}`);
    }
  }

  console.log(`[2-LLM] Tool results for Call 2:`, JSON.stringify(toolResults));

  // Reload user state after tool execution
  const supabase = createServiceClient();
  const { data: updatedUser } = await supabase
    .from('users')
    .select('*')
    .eq('id', context.user.id)
    .single();

  if (updatedUser) {
    context.user = updatedUser as User;
    context.progress = checkOnboardingProgress(context.user, context.conversation);
  }

  console.log(`[2-LLM] Starting Call 2: Personality response`);

  // ====================
  // CALL 2: PERSONALITY
  // ====================
  const personalityPrompt = buildPersonalityPrompt(
    decision.next_scenario,
    decision.context_for_response,
    toolResults
  );

  const personalityResponse = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300, // Short responses only
    temperature: 0.7, // Higher for natural personality
    system: personalityPrompt,
    messages: conversationMessages // Same conversation history for continuity
  });

  // Extract text response
  const textBlocks = personalityResponse.content.filter(
    (block): block is Anthropic.Messages.TextBlock => block.type === 'text'
  );

  // Parse message sequences (split by "---" delimiter)
  const rawTexts = textBlocks.map(block => block.text.trim()).filter(t => t.length > 0);
  const messageTexts = rawTexts.flatMap(text =>
    text.split(/\n---\n/).map(msg => msg.trim()).filter(msg => msg.length > 0)
  );

  console.log(`[2-LLM] Response generated: ${messageTexts.length} messages`);

  // Create re-engagement task if onboarding incomplete
  if (!context.progress.isComplete) {
    await createReengagementTask(
      context.user.id,
      context.conversation.id,
      context.progress.currentStep,
      context.progress.missingFields
    );
  }

  return {
    immediateReply: true,
    messages: messageTexts,
    actions,
    events,
    reasoning: '2-LLM architecture: decision + personality'
  };
}

/**
 * Execute Bouncer tools and return actions/events
 */
async function executeBouncerTools(
  toolUses: ToolUseBlock[],
  context: BouncerContext
): Promise<{ actions: AgentAction[]; events: AgentEvent[] }> {
  const actions: AgentAction[] = [];
  const events: AgentEvent[] = [];
  const supabase = createServiceClient();

  for (const toolUse of toolUses) {
    const input = toolUse.input as any;

    switch (toolUse.name) {
      case 'collect_user_info': {
        // Collect user info
        const fields: Record<string, any> = {};

        if (input.first_name) fields.first_name = input.first_name;
        if (input.last_name) fields.last_name = input.last_name;
        if (input.email) fields.email = input.email;
        if (input.company) fields.company = input.company;
        if (input.title) fields.title = input.title;
        if (input.linkedin_url) fields.linkedin_url = input.linkedin_url;
        if (input.expertise) fields.expertise = input.expertise;

        // Update user record
        if (Object.keys(fields).length > 0) {
          await collectUserInfo(context.user.id, fields);

          actions.push({
            type: 'update_user_field',
            params: { fields },
            reason: 'Collected user information from conversation'
          });
        }

        // Handle referrer if provided
        if (input.referrer_name && !context.user.referred_by) {
          const referrerName = input.referrer_name;
          const matches = await lookupUserByName(referrerName);

          if (matches.length > 0) {
            // Use first match (can be enhanced with LLM confirmation later)
            await supabase
              .from('users')
              .update({ referred_by: matches[0].user_id, updated_at: new Date() })
              .eq('id', context.user.id);

            actions.push({
              type: 'set_referrer',
              params: {
                referred_by: matches[0].user_id,
                referrer_name: referrerName
              },
              reason: `Matched referrer "${referrerName}"`
            });
          } else {
            // Store in name_dropped for manual review
            await supabase
              .from('users')
              .update({ name_dropped: referrerName, updated_at: new Date() })
              .eq('id', context.user.id);

            actions.push({
              type: 'store_name_dropped',
              params: { name_dropped: referrerName },
              reason: `No match found for "${referrerName}"`
            });
          }
        }

        // Handle nomination if provided
        if (input.nomination) {
          const introOpportunityId = await storeNomination(
            context.user.id,
            input.nomination
          );

          actions.push({
            type: 'create_intro_opportunity',
            params: {
              intro_opportunity_id: introOpportunityId,
              nomination: input.nomination
            },
            reason: 'User nominated someone during onboarding'
          });
        }
        break;
      }

      case 'send_verification_email': {
        const verificationEmail = generateVerificationEmail(context.user.id);

        // The verification email address has already been provided to the user in the system prompt
        // This just marks that we've requested verification
        actions.push({
          type: 'create_verification_task',
          params: {
            user_id: context.user.id,
            verification_email: verificationEmail
          },
          reason: 'Verification email requested'
        });
        break;
      }

      case 'complete_onboarding': {
        // Complete onboarding and mark user as verified
        const updatedUser = await completeOnboarding(context.user.id);

        actions.push({
          type: 'mark_user_verified',
          params: {
            user_id: context.user.id,
            verified_at: new Date().toISOString()
          },
          reason: 'All onboarding steps completed'
        });

        // Publish user.verified event
        events.push({
          event_type: 'user.verified',
          aggregate_id: context.user.id,
          aggregate_type: 'user',
          payload: {
            userId: context.user.id,
            verificationCompletedAt: new Date().toISOString(),
            pocAgentType: updatedUser.poc_agent_type
          },
          created_by: 'bouncer_agent'
        });
        break;
      }
    }
  }

  return { actions, events };
}

async function handleEmailVerifiedAcknowledgment(context: BouncerContext): Promise<AgentResponse> {
  // Use 2-LLM architecture for email verification acknowledgment
  const conversationMessages = context.recentMessages
    .slice(-10)
    .map(msg => ({
      role: msg.role === 'user' ? 'user' : 'assistant' as 'user' | 'assistant',
      content: msg.content
    }));

  // Add system context about email verification
  conversationMessages.push({
    role: 'user',
    content: '(email verification received)'
  });

  console.log(`[2-LLM] Email verification acknowledged - using personality prompt`);

  // Use Call 2 personality prompt directly (no decisions needed)
  const personalityPrompt = buildPersonalityPrompt(
    'email_verification_received',
    `User just sent verification email. Acknowledge receipt, reassure privacy, and ask what they hope to get from community.`
  );

  const personalityResponse = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    temperature: 0.7,
    system: personalityPrompt,
    messages: conversationMessages
  });

  const textBlocks = personalityResponse.content.filter(
    (block): block is Anthropic.Messages.TextBlock => block.type === 'text'
  );

  // Parse message sequences (split by "---" delimiter)
  const rawTexts = textBlocks.map(block => block.text.trim()).filter(t => t.length > 0);
  const messageTexts = rawTexts.flatMap(text =>
    text.split(/\n---\n/).map(msg => msg.trim()).filter(msg => msg.length > 0)
  );

  return {
    immediateReply: true,
    messages: messageTexts,
    actions: [],
    events: [],
    reasoning: 'Email verification acknowledged using 2-LLM personality layer'
  };
}


/**
 * Extracts user information from conversational message using Claude.
 */
async function logAgentAction(log: Partial<AgentActionsLog>): Promise<void> {
  const supabase = createServiceClient();

  await supabase.from('agent_actions_log').insert({
    agent_type: log.agent_type || 'bouncer',
    action_type: log.action_type || 'unknown',
    user_id: log.user_id || null,
    context_id: log.context_id || null,
    context_type: log.context_type || null,
    model_used: log.model_used || null,
    input_tokens: log.input_tokens || null,
    output_tokens: log.output_tokens || null,
    cost_usd: log.cost_usd || null,
    latency_ms: log.latency_ms || null,
    input_data: log.input_data || null,
    output_data: log.output_data || null,
    error: log.error || null
  });
}

/**
 * Also export types for convenience
 */
export type { OnboardingProgress } from './onboarding-steps';

/**
 * Export as default for Cloud Run service
 */
export default invokeBouncerAgent;
