/**
 * Innovator Agent - 2-LLM Sequential Architecture
 *
 * Extends Concierge capabilities with innovator-specific tools.
 * Handles solution provider users who use Yachtparty to find customers.
 *
 * Week 5: Refactored to use 2-LLM pattern
 * - Call 1 (Decision): Tool selection, re-engagement decisions (temp 0.1/0.6)
 * - Call 2 (Personality): Message composition (temp 0.7)
 *
 * Tools (9 total):
 * - Concierge tools (5): publish_community_request, request_solution_research,
 *   create_intro_opportunity, store_user_goal, record_community_response
 * - Innovator tools (4): update_innovator_profile, upload_prospects,
 *   check_intro_progress, request_credit_funding
 *
 * @module agent-innovator
 */

import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createServiceClient,
  publishEvent,
  createAgentTask,
  type User,
  type Conversation,
  type Message,
  type AgentResponse,
  type AgentAction,
  type UserPriority,
} from '@yachtparty/shared';

import { buildPersonalityPrompt } from './personality';
import {
  callUserMessageDecision,
  callReengagementDecision,
  type InnovatorContext,
  type Call1Output,
  type ReengagementDecisionOutput,
} from './decision';

/**
 * Parse message sequences with support for multiple delimiter patterns.
 * LLM might use various formats, so we try them all.
 *
 * @param rawTexts - Raw text blocks from LLM response
 * @returns Array of individual message strings
 */
function parseMessageSequences(rawTexts: string[]): string[] {
  const delimiters = [
    /\n---\n/,        // Standard (current)
    /\n--- \n/,       // With trailing space
    / ---\n/,         // With leading space
    /\n — — — \n/,    // Em dashes
    /\n___\n/,        // Underscores
    /\n===\n/,        // Equal signs
    /^---$/m,         // Just three dashes on own line (multiline mode)
  ];

  let messages = rawTexts;

  // Try each delimiter - some text might have multiple types
  for (const delimiter of delimiters) {
    messages = messages.flatMap((msg) =>
      msg.split(delimiter).map((m) => m.trim()).filter((m) => m.length > 0)
    );
  }

  // If we ended up with more than 10 messages, something went wrong
  // (probably split on common punctuation). Fall back to original.
  if (messages.length > 10) {
    console.warn('[Message Parsing] Too many splits, falling back to original:', messages.length);
    return rawTexts.map((t) => t.trim()).filter((t) => t.length > 0);
  }

  return messages;
}

/**
 * Main entry point for Innovator Agent
 *
 * Routes to appropriate handler based on message role:
 * - 'user': User message (user asks question, provides info)
 * - 'system': Re-engagement check (scheduled task)
 * @param dbClient - Optional Supabase client (defaults to production)
 */
export async function invokeInnovatorAgent(
  message: Message,
  user: User,
  conversation: Conversation,
  dbClient: SupabaseClient = createServiceClient()
): Promise<AgentResponse> {
  const startTime = Date.now();

  try {
    // Route based on message role
    if (message.role === 'system') {
      return await handleReengagement(message, user, conversation, startTime, dbClient);
    } else {
      return await handleUserMessage(message, user, conversation, startTime, dbClient);
    }
  } catch (error) {
    console.error('[Innovator Agent Error]:', error);

    // Enhanced error logging with full context
    await logAgentAction({
      agentType: 'innovator',
      actionType: 'agent_invocation_error',
      userId: user.id,
      contextId: conversation.id,
      contextType: 'conversation',
      inputData: {
        messageContent: message.content,
        messageRole: message.role,
        messageId: message.id,
        timestamp: new Date().toISOString(),
        isReengagement: message.role === 'system',
      },
      outputData: {
        // Error context
        errorContext: {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          errorType: error instanceof Error ? error.constructor.name : typeof error,
        },
      },
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - startTime,
    }, dbClient);

    return {
      immediateReply: true,
      messages: ["I'm having trouble processing that. Could you try rephrasing?"],
      actions: [],
    };
  }
}

/**
 * Handle User Messages (2-LLM Pattern)
 *
 * Flow:
 * 1. Load context (5 messages)
 * 2. Call 1: Decision (temp 0.1, tool selection)
 * 3. Execute tools
 * 4. Call 2: Personality (temp 0.7, compose message)
 * 5. Parse message sequences
 */
async function handleUserMessage(
  message: Message,
  user: User,
  conversation: Conversation,
  startTime: number,
  dbClient: SupabaseClient
): Promise<AgentResponse> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Step 1: Load context (5 messages for user messages)
  const context = await loadAgentContext(user.id, conversation.id, 5, dbClient);

  const innovatorContext: InnovatorContext = {
    recentMessages: context.recentMessages,
    userPriorities: context.userPriorities,
    outstandingCommunityRequests: context.outstandingCommunityRequests,
    lastPresentedCommunityRequest: context.lastPresentedCommunityRequest,
    innovatorProfile: context.innovatorProfile,
    pendingIntros: context.pendingIntros,
    creditBalance: user.credit_balance,
    user,
  };

  // Step 2: CALL 1 - Decision (temp 0.1, tool selection)
  const decision = await callUserMessageDecision(anthropic, message, innovatorContext);

  // Step 3: Execute tools and collect results
  const toolResults: Record<string, any> = {};
  const actions: AgentAction[] = [];

  for (const toolDef of decision.tools_to_execute) {
    const result = await executeTool(toolDef, user, conversation, context, dbClient);
    if (result.actions) actions.push(...result.actions);

    // Collect tool results for Call 2
    if (toolDef.tool_name === 'publish_community_request') {
      toolResults.requestId = result.requestId || 'pending';
      toolResults.requestSummary = toolDef.params.request_summary;
    } else if (toolDef.tool_name === 'request_solution_research') {
      toolResults.researchId = result.researchId || 'pending';
    } else if (toolDef.tool_name === 'create_intro_opportunity') {
      toolResults.introId = result.introId;
      toolResults.prospectName = toolDef.params.prospect_name;
    } else if (toolDef.tool_name === 'update_innovator_profile') {
      toolResults.profileUpdated = true;
      toolResults.updatedFields = Object.keys(toolDef.params);
    } else if (toolDef.tool_name === 'upload_prospects') {
      toolResults.uploadLink = result.uploadLink;
    } else if (toolDef.tool_name === 'check_intro_progress') {
      toolResults.introProgress = result.introProgress;
    } else if (toolDef.tool_name === 'request_credit_funding') {
      toolResults.paymentLink = result.paymentLink;
      toolResults.creditAmount = toolDef.params.amount;
    }
  }

  // Step 4: CALL 2 - Personality (temp 0.7, compose message)
  const personalityPrompt = buildPersonalityPrompt(
    decision.next_scenario,
    JSON.stringify(decision.context_for_call_2),
    toolResults
  );

  // Build conversation history for Call 2 (filter out internal system messages)
  const conversationMessages = context.recentMessages
    .filter((msg) => {
      // Always include user messages
      if (msg.role === 'user') return true;

      // Always include agent's own messages for self-reflection
      if (msg.role === 'innovator') return true;

      // Include system messages that were sent to user (outbound)
      // Exclude internal system messages (inbound triggers like re-engagement)
      if (msg.role === 'system') {
        return msg.direction === 'outbound';
      }

      // Exclude everything else
      return false;
    })
    .map((msg) => ({
      role: msg.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: msg.content,
    }));

  conversationMessages.push({
    role: 'user',
    content: message.content,
  });

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    temperature: 0.7, // Higher temp for natural, creative responses
    system: personalityPrompt,
    messages: conversationMessages,
  });

  // Step 5: Parse message sequences (split by "---" and other delimiters)
  const textBlocks = response.content.filter((block) => block.type === 'text');
  const rawTexts = textBlocks.map((block) => ('text' in block ? block.text.trim() : '')).filter((t) => t.length > 0);

  const messageTexts = parseMessageSequences(rawTexts);

  // Step 6: Track proactive priority presentation (if applicable)
  // Phase 5: Priority Status Tracking (Appendix E)
  if (decision.context_for_call_2?.proactive_priority && messageTexts.length > 0) {
    const proactivePriority = decision.context_for_call_2.proactive_priority;

    // Only mark as presented if message was actually sent (has content)
    if (proactivePriority.should_mention && proactivePriority.item_id) {
      try {
        await markPriorityPresented(
          dbClient,
          proactivePriority.item_type as 'intro_opportunity' | 'connection_request' | 'community_request',
          proactivePriority.item_id,
          'natural', // This is a proactive mention, not dedicated re-engagement
          user.id,
          conversation.id
        );
        console.log(`[Innovator 2-LLM] Marked proactive priority as presented: ${proactivePriority.item_type} ${proactivePriority.item_id}`);
      } catch (error) {
        console.error(`[Innovator 2-LLM] Failed to mark proactive priority as presented:`, error);
      }
    }
  }

  // Log completion
  await logAgentAction({
    agentType: 'innovator',
    actionType: 'user_message_handled',
    userId: user.id,
    contextId: conversation.id,
    contextType: 'conversation',
    latencyMs: Date.now() - startTime,
    inputData: { message_content: message.content },
    outputData: {
      tools_executed: decision.tools_to_execute.map((t) => t.tool_name),
      scenario: decision.next_scenario,
      message_count: messageTexts.length,
    },
  }, dbClient);

  return {
    immediateReply: true,
    messages: messageTexts,
    actions,
  };
}

/**
 * Handle Re-engagement (2-LLM Pattern with Social Judgment)
 *
 * Flow:
 * 1. Load full context (15-20 messages)
 * 2. Call 1: Re-engagement Decision (temp 0.6, social judgment)
 * 3. If decision says DON'T message: extend task and return silent
 * 4. If decision says MESSAGE: execute tools, Call 2, parse sequences
 */
async function handleReengagement(
  message: Message,
  user: User,
  conversation: Conversation,
  startTime: number,
  dbClient: SupabaseClient
): Promise<AgentResponse> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  console.log(`[Innovator Re-engagement] Starting re-engagement check for user ${user.id}`);

  // ========================================================================
  // THROTTLING CHECKS - Prevent spam
  // ========================================================================

  // Check 1: No re-engagement in last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const { data: recentAttempts } = await dbClient
    .from('agent_actions_log')
    .select('created_at')
    .eq('user_id', user.id)
    .eq('action_type', 're_engagement_message_sent')
    .gte('created_at', sevenDaysAgo.toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  if (recentAttempts && recentAttempts.length > 0) {
    const lastAttemptDate = new Date(recentAttempts[0].created_at);
    const daysSinceLastAttempt = (Date.now() - lastAttemptDate.getTime()) / (1000 * 60 * 60 * 24);

    console.log(`[Innovator Re-engagement] Throttled: Last re-engagement was ${daysSinceLastAttempt.toFixed(1)} days ago`);

    // Extend task by remaining days to reach 7 days
    const extendDays = Math.ceil(7 - daysSinceLastAttempt);
    const scheduledFor = new Date();
    scheduledFor.setDate(scheduledFor.getDate() + extendDays);

    await createAgentTask({
      task_type: 're_engagement_check',
      agent_type: 'innovator',
      user_id: user.id,
      context_id: conversation.id,
      context_type: 'conversation',
      scheduled_for: scheduledFor.toISOString(),
      priority: 'low',
      context_json: {
        throttled: true,
        throttledReason: '7_day_limit',
        lastAttemptDate: lastAttemptDate.toISOString(),
      },
      created_by: 'innovator_agent',
    }, dbClient);

    await logAgentAction({
      agentType: 'innovator',
      actionType: 're_engagement_throttled',
      userId: user.id,
      contextId: conversation.id,
      contextType: 'conversation',
      outputData: {
        throttledReason: '7_day_limit',
        lastAttemptDate: lastAttemptDate.toISOString(),
        extendDays,
      },
      latencyMs: Date.now() - startTime,
    }, dbClient);

    return {
      immediateReply: false,
      messages: [],
      actions: [],
    };
  }

  // Check 2: No more than 3 unanswered attempts in 90 days
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const { data: allAttempts } = await dbClient
    .from('agent_actions_log')
    .select('created_at')
    .eq('user_id', user.id)
    .eq('action_type', 're_engagement_message_sent')
    .gte('created_at', ninetyDaysAgo.toISOString())
    .order('created_at', { ascending: false });

  let unansweredCount = 0;
  for (const attempt of (allAttempts || [])) {
    const attemptDate = new Date(attempt.created_at);

    // Check if user responded after this attempt
    const { data: userResponses } = await dbClient
      .from('messages')
      .select('id')
      .eq('user_id', user.id)
      .eq('role', 'user')
      .gte('created_at', attemptDate.toISOString())
      .limit(1);

    if (!userResponses || userResponses.length === 0) {
      unansweredCount++;
    } else {
      // User responded - reset counter
      break;
    }
  }

  if (unansweredCount >= 3) {
    console.log(`[Innovator Re-engagement] Paused: User has not responded to ${unansweredCount} attempts in 90 days`);

    await logAgentAction({
      agentType: 'innovator',
      actionType: 're_engagement_paused',
      userId: user.id,
      contextId: conversation.id,
      contextType: 'conversation',
      outputData: {
        pausedReason: 'too_many_unanswered_attempts',
        unansweredCount,
        requiresManualOverride: true,
      },
      latencyMs: Date.now() - startTime,
    }, dbClient);

    // Don't create new task - paused until manual override
    return {
      immediateReply: false,
      messages: [],
      actions: [],
    };
  }

  console.log(`[Innovator Re-engagement] Throttling checks passed (${unansweredCount} unanswered in 90 days)`);

  // ========================================================================
  // END THROTTLING CHECKS - Continue with normal re-engagement flow
  // ========================================================================

  // Parse re-engagement context from system message
  const reengagementContext = JSON.parse(message.content);
  const { daysSinceLastMessage, priorityCount, hasActiveGoals } = reengagementContext;

  // Step 1: Load FULL context (15-20 messages for social judgment)
  const context = await loadAgentContext(user.id, conversation.id, 20, dbClient);

  const innovatorContext: InnovatorContext = {
    recentMessages: context.recentMessages,
    userPriorities: context.userPriorities,
    outstandingCommunityRequests: context.outstandingCommunityRequests,
    lastPresentedCommunityRequest: context.lastPresentedCommunityRequest,
    innovatorProfile: context.innovatorProfile,
    pendingIntros: context.pendingIntros,
    creditBalance: user.credit_balance,
    user,
  };

  // Step 2: CALL 1 - Re-engagement Decision (temp 0.6, social judgment)
  const decision = await callReengagementDecision(anthropic, user, innovatorContext, {
    daysSinceLastMessage,
    priorityCount,
    hasActiveGoals,
    pendingIntroCount: context.pendingIntros?.length || 0,
    creditBalance: user.credit_balance,
    profileLastUpdated: context.innovatorProfile?.last_updated,
  });

  // Step 3: If decision says DON'T message, extend task and return silent
  if (!decision.should_message || decision.next_scenario === 'no_message') {
    const extendDays = decision.extend_days || 30;
    const scheduledFor = new Date();
    scheduledFor.setDate(scheduledFor.getDate() + extendDays);

    await createAgentTask({
      task_type: 're_engagement_check',
      agent_type: 'innovator',
      user_id: user.id,
      scheduled_for: scheduledFor.toISOString(),
      priority: 'low',
      context_json: {
        attemptCount: (reengagementContext.attemptCount || 0) + 1,
        reason: decision.reasoning,
      },
      created_by: 'innovator_agent',
    }, dbClient);

    await logAgentAction({
      agentType: 'innovator',
      actionType: 're_engagement_declined',
      userId: user.id,
      contextId: conversation.id,
      contextType: 'conversation',
      latencyMs: Date.now() - startTime,
      outputData: {
        should_message: false,
        reasoning: decision.reasoning,
        extend_days: extendDays,
      },
    }, dbClient);

    return {
      immediateReply: false,
      messages: [],
      actions: [],
    };
  }

  // Step 4: Execute tools and collect results
  const toolResults: Record<string, any> = {};
  const actions: AgentAction[] = [];

  for (const toolDef of decision.tools_to_execute) {
    const result = await executeTool(toolDef, user, conversation, context, dbClient);
    if (result.actions) actions.push(...result.actions);

    // Collect tool results for Call 2
    if (toolDef.tool_name === 'check_intro_progress') {
      toolResults.introProgress = result.introProgress;
    } else if (toolDef.tool_name === 'update_innovator_profile') {
      toolResults.profileUpdated = true;
    }
  }

  // Step 5: CALL 2 - Personality (temp 0.7, compose message)
  const personalityPrompt = buildPersonalityPrompt(
    decision.next_scenario,
    JSON.stringify(decision.context_for_call_2),
    toolResults
  );

  // Build conversation history for Call 2 (filter out internal system messages)
  const conversationMessages = context.recentMessages
    .filter((msg) => {
      // Always include user messages
      if (msg.role === 'user') return true;

      // Always include agent's own messages for self-reflection
      if (msg.role === 'innovator') return true;

      // Include system messages that were sent to user (outbound)
      // Exclude internal system messages (inbound triggers like re-engagement)
      if (msg.role === 'system') {
        return msg.direction === 'outbound';
      }

      // Exclude everything else
      return false;
    })
    .map((msg) => ({
      role: msg.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: msg.content,
    }));

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 700, // More tokens for multi-thread responses
    temperature: 0.7,
    system: personalityPrompt,
    messages: conversationMessages,
  });

  // Step 6: Parse message sequences (split by "---" and other delimiters)
  const textBlocks = response.content.filter((block) => block.type === 'text');
  const rawTexts = textBlocks.map((block) => ('text' in block ? block.text.trim() : '')).filter((t) => t.length > 0);

  const messageTexts = parseMessageSequences(rawTexts);

  // Step 7: Track priority presentations in re-engagement (Phase 5: Priority Status Tracking)
  if (decision.threads_to_address && messageTexts.length > 0) {
    for (const thread of decision.threads_to_address) {
      // Only track priority threads (not general updates)
      if (thread.type === 'priority_opportunity' && thread.item_id) {
        // Determine which table this priority is from
        const priority = context.userPriorities?.find(p => p.item_id === thread.item_id);
        if (priority && (priority.item_type === 'intro_opportunity' || priority.item_type === 'connection_request' || priority.item_type === 'community_request')) {
          try {
            await markPriorityPresented(
              dbClient,
              priority.item_type as 'intro_opportunity' | 'connection_request' | 'community_request',
              thread.item_id,
              'dedicated', // Re-engagement is dedicated presentation, not proactive
              user.id,
              conversation.id
            );
            console.log(`[Innovator Re-engagement] Marked priority as presented (dedicated): ${priority.item_type} ${thread.item_id}`);
          } catch (error) {
            console.error(`[Innovator Re-engagement] Failed to mark priority as presented:`, error);
          }
        }
      }
    }
  }

  // Log completion
  await logAgentAction({
    agentType: 'innovator',
    actionType: 're_engagement_sent',
    userId: user.id,
    contextId: conversation.id,
    contextType: 'conversation',
    latencyMs: Date.now() - startTime,
    outputData: {
      threads_addressed: decision.threads_to_address?.length || 0,
      scenario: decision.next_scenario,
      message_count: messageTexts.length,
    },
  }, dbClient);

  return {
    immediateReply: true,
    messages: messageTexts,
    actions,
  };
}

/**
 * Mark priority as presented, increment count, check for dormancy.
 *
 * Part of Phase 5: Priority Status Tracking (Appendix E).
 *
 * @param dbClient - Supabase client
 * @param itemType - Type of priority item
 * @param itemId - ID of the item
 * @param presentationType - How it was presented ('dedicated' = re-engagement, 'natural' = proactive mention)
 * @param userId - User ID (for logging)
 * @param conversationId - Conversation ID (for logging)
 */
async function markPriorityPresented(
  dbClient: SupabaseClient,
  itemType: 'intro_opportunity' | 'connection_request' | 'community_request',
  itemId: string,
  presentationType: 'dedicated' | 'natural',
  userId: string,
  conversationId: string
): Promise<void> {
  const tableName = itemType === 'intro_opportunity' ? 'intro_opportunities' :
                    itemType === 'connection_request' ? 'connection_requests' :
                    'community_requests';

  // Get current count and status
  const { data: current } = await dbClient
    .from(tableName)
    .select('presentation_count, status')
    .eq('id', itemId)
    .single();

  if (!current) {
    console.warn(`[markPriorityPresented] Item not found: ${itemType} ${itemId}`);
    return;
  }

  const newCount = (current.presentation_count || 0) + 1;
  const currentStatus = current.status || 'open';

  // Determine new status
  let newStatus = currentStatus;
  if (currentStatus === 'open') {
    newStatus = 'presented'; // First presentation
  }

  // Check for dormancy (2 presentations, no response)
  const shouldMarkDormant = newCount >= 2 && currentStatus === 'presented';

  // Update source table
  await dbClient
    .from(tableName)
    .update({
      presentation_count: newCount,
      last_presented_at: new Date().toISOString(),
      status: shouldMarkDormant ? 'dormant' : newStatus,
      dormant_at: shouldMarkDormant ? new Date().toISOString() : undefined
    })
    .eq('id', itemId);

  // If dormant, cancel all future re-engagement tasks
  if (shouldMarkDormant) {
    await cancelReengagementTasksForPriority(dbClient, itemType, itemId);
  }

  // Log action
  await logAgentAction({
    agentType: 'innovator',
    actionType: shouldMarkDormant ? 'priority_marked_dormant' : 'priority_presented',
    userId,
    contextId: conversationId,
    contextType: 'conversation',
    inputData: {
      item_type: itemType,
      item_id: itemId,
      presentation_count: newCount,
      presentation_type: presentationType
    },
    outputData: {
      new_status: shouldMarkDormant ? 'dormant' : newStatus,
      message: shouldMarkDormant
        ? 'User did not respond after 2 presentations. Marked dormant, cancelled re-engagement tasks.'
        : `Priority presented to user (${presentationType}).`
    }
  }, dbClient);
}

/**
 * Cancel all pending re-engagement tasks for a priority (when it goes dormant).
 *
 * Part of Phase 5: Priority Status Tracking (Appendix E).
 *
 * @param dbClient - Supabase client
 * @param itemType - Type of priority item
 * @param itemId - ID of the item
 */
async function cancelReengagementTasksForPriority(
  dbClient: SupabaseClient,
  itemType: string,
  itemId: string
): Promise<void> {
  await dbClient
    .from('agent_tasks')
    .update({
      status: 'cancelled',
      result_json: {
        reason: 'item_marked_dormant',
        cancelled_at: new Date().toISOString(),
        explanation: 'Priority presented 2x with no user response. Moved to dormant status.'
      }
    })
    .eq('context_type', itemType)
    .eq('context_id', itemId)
    .eq('task_type', 're_engagement_check')
    .eq('status', 'pending');
}

/**
 * Load Innovator Agent Context
 *
 * Loads conversation history, priorities, requests, profile, and intros.
 *
 * @param userId - User ID
 * @param conversationId - Conversation ID
 * @param messageLimit - Number of recent messages to load (5 for user messages, 20 for re-engagement)
 */
async function loadAgentContext(
  userId: string,
  conversationId: string,
  messageLimit: number = 5,
  dbClient: SupabaseClient = createServiceClient()
): Promise<{
  recentMessages: Message[];
  userPriorities: UserPriority[];
  outstandingCommunityRequests: Array<{
    id: string;
    question: string;
    created_at: string;
  }>;
  lastPresentedCommunityRequest?: {
    id: string;
    question: string;
    created_at: string;
  };
  innovatorProfile?: {
    company: string;
    solution_description?: string;
    target_customers?: string;
    pricing_model?: string;
    last_updated?: string;
  };
  pendingIntros?: Array<{
    id: string;
    prospect_name: string;
    status: 'pending' | 'accepted' | 'declined' | 'met';
    created_at: string;
  }>;
}> {
  const supabase = dbClient;

  // Load recent messages
  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(messageLimit);

  // Load user priorities - denormalized fields, NO joins needed
  const { data: priorities } = await supabase
    .from('user_priorities')
    .select('id, user_id, priority_rank, item_type, item_id, value_score, status, presentation_count, created_at, expires_at, presented_at, item_summary, item_primary_name, item_secondary_name, item_context, item_metadata')
    .eq('user_id', userId)
    .in('status', ['active', 'presented', 'clarifying']) // Exclude actioned, dormant
    .lte('presentation_count', 1) // Exclude items presented 2x (approaching dormant)
    .order('priority_rank', { ascending: true })
    .limit(10);

  // Load outstanding community requests (for this user)
  const { data: requests } = await supabase
    .from('community_requests')
    .select('id, question, created_at')
    .eq('requesting_user_id', userId)
    .eq('status', 'open')
    .order('created_at', { ascending: false });

  // Load innovator profile
  const { data: innovatorProfile } = await supabase
    .from('innovators')
    .select('company, solution_description, target_customers, pricing_model, updated_at')
    .eq('user_id', userId)
    .single();

  // Load pending intros
  const { data: pendingIntros } = await supabase
    .from('intro_opportunities')
    .select('id, prospect_name, status, created_at')
    .eq('innovator_id', userId)
    .in('status', ['pending', 'accepted'])
    .order('created_at', { ascending: false })
    .limit(10);

  return {
    recentMessages: (messages || []).reverse() as Message[],
    userPriorities: (priorities as UserPriority[]) || [],
    outstandingCommunityRequests:
      requests?.map((r) => ({
        id: r.id,
        question: r.question,
        created_at: r.created_at,
      })) || [],
    lastPresentedCommunityRequest: requests?.[0]
      ? {
          id: requests[0].id,
          question: requests[0].question,
          created_at: requests[0].created_at,
        }
      : undefined,
    innovatorProfile: innovatorProfile
      ? {
          company: innovatorProfile.company,
          solution_description: innovatorProfile.solution_description,
          target_customers: innovatorProfile.target_customers,
          pricing_model: innovatorProfile.pricing_model,
          last_updated: innovatorProfile.updated_at,
        }
      : undefined,
    pendingIntros:
      pendingIntros?.map((i) => ({
        id: i.id,
        prospect_name: i.prospect_name,
        status: i.status as 'pending' | 'accepted' | 'declined' | 'met',
        created_at: i.created_at,
      })) || [],
  };
}

/**
 * Validate tool parameters before execution
 * Returns error if required IDs don't exist in context
 */
function validateToolParams(
  toolName: string,
  params: Record<string, any>,
  context: {
    userPriorities?: Array<{
      id: string;
      item_type: string;
      item_id: string;
      status: string;
    }>;
    outstandingCommunityRequests?: Array<{
      id: string;
      question: string;
      created_at: string;
    }>;
    lastPresentedCommunityRequest?: {
      id: string;
      question: string;
      created_at: string;
    };
  }
): { valid: boolean; error?: string } {
  switch (toolName) {
    case 'accept_intro_opportunity':
    case 'decline_intro_opportunity':
      const introOppExists = context.userPriorities?.some(
        (p) => p.item_id === params.intro_opportunity_id && p.item_type === 'intro_opportunity'
      );
      if (!introOppExists) {
        return {
          valid: false,
          error: `intro_opportunity ${params.intro_opportunity_id} not found in user priorities`,
        };
      }
      break;

    case 'record_community_response':
      if (!params.request_id) {
        return { valid: false, error: 'request_id required for record_community_response' };
      }
      // Check if this request was presented to user
      if (context.lastPresentedCommunityRequest?.id !== params.request_id) {
        // Also check outstanding requests
        const requestExists = context.outstandingCommunityRequests?.some((r) => r.id === params.request_id);
        if (!requestExists) {
          return {
            valid: false,
            error: `community_request ${params.request_id} not found in context`,
          };
        }
      }
      break;

    // Note: accept_intro_offer, decline_intro_offer, etc. would need DB checks
    // For now, let DB handle those (existing error logging is ok)
  }

  return { valid: true };
}

/**
 * Execute a single tool and return results
 *
 * Handles all 9 tools (5 Concierge + 4 Innovator-specific).
 */
async function executeTool(
  toolDef: { tool_name: string; params: Record<string, any> },
  user: User,
  conversation: Conversation,
  context: Awaited<ReturnType<typeof loadAgentContext>>,
  dbClient: SupabaseClient = createServiceClient()
): Promise<{
  actions?: AgentAction[];
  requestId?: string;
  researchId?: string;
  introId?: string;
  uploadLink?: string;
  paymentLink?: string;
  introProgress?: any;
  error?: string;
  errorType?: string;
}> {
  const supabase = dbClient;

  // VALIDATE PARAMETERS BEFORE EXECUTION
  const validation = validateToolParams(toolDef.tool_name, toolDef.params, context);
  if (!validation.valid) {
    console.error(`[Tool Validation Failed] ${toolDef.tool_name}:`, validation.error);

    return {
      actions: [],
      error: validation.error,
      errorType: 'validation_failed',
    };
  }

  switch (toolDef.tool_name) {
    // ===== CONCIERGE TOOLS =====

    case 'publish_community_request': {
      await publishEvent({
        event_type: 'community.request_needed',
        aggregate_id: user.id,
        aggregate_type: 'user',
        payload: {
          requestingAgentType: 'innovator',
          requestingUserId: user.id,
          contextId: conversation.id,
          contextType: 'conversation',
          question: toolDef.params.question,
          expertiseNeeded: toolDef.params.expertise_needed || [],
          requesterContext: toolDef.params.requester_context,
          desiredOutcome: toolDef.params.desired_outcome || 'backchannel',
          urgency: toolDef.params.urgency || 'medium',
          requestSummary: toolDef.params.request_summary,
        },
        created_by: 'innovator_agent',
      }, dbClient);

      const action: AgentAction = {
        type: 'ask_community_question',
        params: {
          question: toolDef.params.question,
          expertise_needed: toolDef.params.expertise_needed,
        },
        reason: 'User asked a question needing community expertise',
      };

      return { actions: [action], requestId: 'pending' };
    }

    case 'request_solution_research': {
      await publishEvent({
        event_type: 'user.inquiry.solution_needed',
        aggregate_id: user.id,
        aggregate_type: 'user',
        payload: {
          userId: user.id,
          conversationId: conversation.id,
          requestDescription: toolDef.params.request_description,
          category: toolDef.params.category,
          urgency: toolDef.params.urgency || 'medium',
        },
        created_by: 'innovator_agent',
      }, dbClient);

      const action: AgentAction = {
        type: 'request_solution_research',
        params: {
          request_description: toolDef.params.request_description,
          category: toolDef.params.category,
        },
        reason: 'User needs solution recommendations',
      };

      return { actions: [action], researchId: 'pending' };
    }

    case 'offer_introduction': {
      // User spontaneously offers to introduce prospect to introducee
      const { data: introOffer, error } = await supabase
        .from('intro_offers')
        .insert({
          offering_user_id: user.id,
          introducee_user_id: toolDef.params.introducee_user_id,
          prospect_name: toolDef.params.prospect_name,
          prospect_company: toolDef.params.prospect_company || null,
          prospect_title: toolDef.params.prospect_title || null,
          prospect_context: toolDef.params.prospect_context || null,
          context_type: toolDef.params.context_type || 'conversation',
          context_id: toolDef.params.context_id || conversation?.id,
          bounty_credits: 0, // Set when introducee accepts
          status: 'pending_introducee_response',
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating intro offer:', error);
        return {};
      }

      const action: AgentAction = {
        type: 'offer_introduction',
        params: {
          intro_offer_id: introOffer.id,
          prospect_name: toolDef.params.prospect_name,
          introducee_user_id: toolDef.params.introducee_user_id,
        },
        reason: 'User offered to make introduction',
      };

      return { actions: [action], introId: introOffer.id };
    }

    case 'accept_intro_opportunity': {
      // User accepts an intro opportunity from their priorities

      // Track presentation before updating status (Phase 5: Priority Status Tracking)
      await markPriorityPresented(
        dbClient,
        'intro_opportunity',
        toolDef.params.intro_opportunity_id,
        'dedicated', // User is directly responding to this priority
        user.id,
        conversation.id
      );

      const { data: introOpp, error } = await supabase
        .from('intro_opportunities')
        .update({ status: 'accepted', connector_response: 'Accepted' })
        .eq('id', toolDef.params.intro_opportunity_id)
        .select()
        .single();

      if (error) {
        console.error('Error accepting intro opportunity:', error);
        return {};
      }

      const action: AgentAction = {
        type: 'accept_intro_opportunity',
        params: { intro_opportunity_id: toolDef.params.intro_opportunity_id },
        reason: 'User accepted intro opportunity',
      };

      return { actions: [action] };
    }

    case 'decline_intro_opportunity': {
      // User declines an intro opportunity

      // Track presentation before updating status (Phase 5: Priority Status Tracking)
      await markPriorityPresented(
        dbClient,
        'intro_opportunity',
        toolDef.params.intro_opportunity_id,
        'dedicated', // User is directly responding to this priority
        user.id,
        conversation.id
      );

      const { data: introOpp, error } = await supabase
        .from('intro_opportunities')
        .update({
          status: 'rejected',
          connector_response: toolDef.params.reason || 'Declined',
        })
        .eq('id', toolDef.params.intro_opportunity_id)
        .select()
        .single();

      if (error) {
        console.error('Error declining intro opportunity:', error);
        return {};
      }

      const action: AgentAction = {
        type: 'decline_intro_opportunity',
        params: {
          intro_opportunity_id: toolDef.params.intro_opportunity_id,
          reason: toolDef.params.reason,
        },
        reason: 'User declined intro opportunity',
      };

      return { actions: [action] };
    }

    case 'accept_intro_offer': {
      // Introducee accepts intro offer - set bounty based on innovator status
      const { data: introOffer } = await supabase
        .from('intro_offers')
        .select('*, introducee:introducee_user_id(id)')
        .eq('id', toolDef.params.intro_offer_id)
        .single();

      if (!introOffer) {
        console.error(`Intro offer ${toolDef.params.intro_offer_id} not found`);
        return {};
      }

      // Query innovator's warm_intro_bounty if introducee is an innovator
      const { data: innovator } = await supabase
        .from('innovators')
        .select('warm_intro_bounty')
        .eq('user_id', introOffer.introducee_user_id)
        .single();

      const bountyCredits = innovator ? innovator.warm_intro_bounty : 0;

      const { error } = await supabase
        .from('intro_offers')
        .update({
          status: 'pending_connector_confirmation',
          introducee_response: 'Accepted',
          bounty_credits: bountyCredits,
        })
        .eq('id', toolDef.params.intro_offer_id);

      if (error) {
        console.error('Error accepting intro offer:', error);
        return {};
      }

      const action: AgentAction = {
        type: 'accept_intro_offer',
        params: {
          intro_offer_id: toolDef.params.intro_offer_id,
          bounty_credits: bountyCredits,
        },
        reason: 'User accepted intro offer',
      };

      return { actions: [action] };
    }

    case 'decline_intro_offer': {
      // Introducee declines intro offer
      const { error } = await supabase
        .from('intro_offers')
        .update({
          status: 'declined',
          introducee_response: toolDef.params.reason || 'Declined',
        })
        .eq('id', toolDef.params.intro_offer_id);

      if (error) {
        console.error('Error declining intro offer:', error);
        return {};
      }

      const action: AgentAction = {
        type: 'decline_intro_offer',
        params: {
          intro_offer_id: toolDef.params.intro_offer_id,
          reason: toolDef.params.reason,
        },
        reason: 'User declined intro offer',
      };

      return { actions: [action] };
    }

    case 'confirm_intro_offer': {
      // Connector confirms they completed the intro
      const { error } = await supabase
        .from('intro_offers')
        .update({
          status: 'completed',
          connector_confirmation: 'Confirmed',
          intro_completed_at: new Date().toISOString(),
        })
        .eq('id', toolDef.params.intro_offer_id);

      if (error) {
        console.error('Error confirming intro offer:', error);
        return {};
      }

      const action: AgentAction = {
        type: 'confirm_intro_offer',
        params: { intro_offer_id: toolDef.params.intro_offer_id },
        reason: 'User confirmed intro completion',
      };

      return { actions: [action] };
    }

    case 'accept_connection_request': {
      // User accepts a connection request

      // Track presentation before updating status (Phase 5: Priority Status Tracking)
      await markPriorityPresented(
        dbClient,
        'connection_request',
        toolDef.params.connection_request_id,
        'dedicated', // User is directly responding to this priority
        user.id,
        conversation.id
      );

      const { error } = await supabase
        .from('connection_requests')
        .update({
          status: 'accepted',
          introducee_response: 'Accepted',
        })
        .eq('id', toolDef.params.connection_request_id);

      if (error) {
        console.error('Error accepting connection request:', error);
        return {};
      }

      const action: AgentAction = {
        type: 'accept_connection_request',
        params: { connection_request_id: toolDef.params.connection_request_id },
        reason: 'User accepted connection request',
      };

      return { actions: [action] };
    }

    case 'decline_connection_request': {
      // User declines a connection request

      // Track presentation before updating status (Phase 5: Priority Status Tracking)
      await markPriorityPresented(
        dbClient,
        'connection_request',
        toolDef.params.connection_request_id,
        'dedicated', // User is directly responding to this priority
        user.id,
        conversation.id
      );

      const { error } = await supabase
        .from('connection_requests')
        .update({
          status: 'declined',
          introducee_response: toolDef.params.reason || 'Declined',
        })
        .eq('id', toolDef.params.connection_request_id);

      if (error) {
        console.error('Error declining connection request:', error);
        return {};
      }

      const action: AgentAction = {
        type: 'decline_connection_request',
        params: {
          connection_request_id: toolDef.params.connection_request_id,
          reason: toolDef.params.reason,
        },
        reason: 'User declined connection request',
      };

      return { actions: [action] };
    }

    case 'request_connection': {
      // Innovator-specific: Request intro to a platform user
      const { data: connectionRequest, error } = await supabase
        .from('connection_requests')
        .insert({
          introducee_user_id: toolDef.params.introducee_user_id,
          requestor_user_id: user.id,
          requestor_name: toolDef.params.requestor_name,
          requestor_company: toolDef.params.requestor_company || null,
          requestor_title: toolDef.params.requestor_title || null,
          intro_context: toolDef.params.intro_context,
          bounty_credits: toolDef.params.bounty_credits || 0,
          status: 'open',
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating connection request:', error);
        return {};
      }

      const action: AgentAction = {
        type: 'request_connection',
        params: {
          connection_request_id: connectionRequest.id,
          introducee_user_id: toolDef.params.introducee_user_id,
        },
        reason: 'Innovator requested connection',
      };

      return { actions: [action], requestId: connectionRequest.id };
    }

    case 'store_user_goal': {
      await supabase
        .from('users')
        .update({
          response_pattern: {
            ...(user.response_pattern as any),
            user_goal: toolDef.params.goal_description,
            goal_type: toolDef.params.goal_type,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      const action: AgentAction = {
        type: 'update_user_field',
        params: {
          field: 'user_goal',
          value: toolDef.params.goal_description,
          goal_type: toolDef.params.goal_type,
        },
        reason: 'User shared their goal',
      };

      return { actions: [action] };
    }

    case 'record_community_response': {
      await publishEvent({
        event_type: 'community.response_received',
        aggregate_id: toolDef.params.request_id,
        aggregate_type: 'community_request',
        payload: {
          requestId: toolDef.params.request_id,
          responderId: user.id,
          responseContent: toolDef.params.response_text,
          expertiseDemonstrated: toolDef.params.expertise_demonstrated,
        },
        created_by: 'innovator_agent',
      }, dbClient);

      const action: AgentAction = {
        type: 'record_community_response',
        params: {
          request_id: toolDef.params.request_id,
          response_text: toolDef.params.response_text,
        },
        reason: 'User provided community response',
      };

      return { actions: [action] };
    }

    // ===== INNOVATOR-SPECIFIC TOOLS =====

    case 'update_innovator_profile': {
      const updates: any = {};
      if (toolDef.params.solution_name) updates.solution_name = toolDef.params.solution_name;
      if (toolDef.params.solution_description) updates.solution_description = toolDef.params.solution_description;
      if (toolDef.params.target_customer_profile) updates.target_customer_profile = toolDef.params.target_customer_profile;
      if (toolDef.params.pricing_model) updates.pricing_model = toolDef.params.pricing_model;
      if (toolDef.params.differentiation) updates.differentiation = toolDef.params.differentiation;

      if (Object.keys(updates).length > 0) {
        updates.updated_at = new Date().toISOString();

        await supabase.from('innovators').update(updates).eq('user_id', user.id);

        const action: AgentAction = {
          type: 'update_innovator_profile',
          params: updates,
          reason: 'User updated innovator profile',
        };

        return { actions: [action] };
      }

      return {};
    }

    case 'upload_prospects': {
      // Generate secure upload link (would integrate with file upload service)
      const uploadToken = `upload_${user.id}_${Date.now()}`;
      const uploadLink = `https://yachtparty.com/upload/${uploadToken}`;

      const action: AgentAction = {
        type: 'generate_prospect_upload_link',
        params: {
          upload_token: uploadToken,
          upload_link: uploadLink,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
        reason: 'User requested prospect upload',
      };

      return { actions: [action], uploadLink };
    }

    case 'check_intro_progress': {
      const introProgress = {
        pending_count: context.pendingIntros?.length || 0,
        intros: context.pendingIntros || [],
      };

      const action: AgentAction = {
        type: 'report_intro_progress',
        params: introProgress,
        reason: 'User asked about intro progress',
      };

      return { actions: [action], introProgress };
    }

    case 'request_credit_funding': {
      // Generate payment link (would integrate with Stripe)
      const paymentToken = `payment_${user.id}_${Date.now()}`;
      const paymentLink = `https://yachtparty.com/payment/${paymentToken}`;

      const action: AgentAction = {
        type: 'generate_payment_link',
        params: {
          amount: toolDef.params.amount,
          payment_token: paymentToken,
          payment_link: paymentLink,
        },
        reason: 'User requested credit top-up',
      };

      return { actions: [action], paymentLink };
    }

    default:
      console.warn(`Unknown tool: ${toolDef.tool_name}`);
      return {};
  }
}

/**
 * Log agent action for debugging and cost tracking
 */
async function logAgentAction(log: {
  agentType: string;
  actionType: string;
  userId: string;
  contextId: string;
  contextType: string;
  error?: string;
  latencyMs?: number;
  inputData?: any;
  outputData?: any;
}, dbClient: SupabaseClient = createServiceClient()): Promise<void> {
  const supabase = dbClient;

  await supabase.from('agent_actions_log').insert({
    agent_type: log.agentType,
    action_type: log.actionType,
    user_id: log.userId,
    context_id: log.contextId,
    context_type: log.contextType,
    error: log.error || null,
    latency_ms: log.latencyMs || null,
    input_data: log.inputData || null,
    output_data: log.outputData || null,
    created_at: new Date().toISOString(),
  });
}
