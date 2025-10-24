/**
 * Concierge Agent - 2-LLM Sequential Architecture
 *
 * Primary interface for verified users on Yachtparty platform.
 *
 * Architecture Pattern (Week 2 Implementation - User Messages Only):
 * - Call 1 (decision.ts): Business logic, tool selection, context analysis
 * - Execute Tools: Perform actions based on Call 1 decisions
 * - Call 2 (personality.ts): Natural language generation, tone, personality
 *
 * Key characteristics:
 * - Stateless: Loads fresh context on each invocation
 * - Two-LLM: Separates decision-making from personality
 * - Event-driven: Publishes events instead of calling other agents
 * - Logged: Comprehensive action logging for debugging
 *
 * @module agent-concierge
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
  type UserPriority,
  type AgentResponse,
  type AgentAction,
} from '@yachtparty/shared';

// Import 2-LLM architecture components
import {
  callUserMessageDecision,
  callReengagementDecision,
  type ConciergeContext,
  type ReengagementDecisionOutput,
} from './decision';
import { buildPersonalityPrompt } from './personality';

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
 * Main entry point for Concierge Agent.
 *
 * Processes user messages using 2-LLM sequential architecture.
 *
 * @param message - Inbound user message
 * @param user - User record
 * @param conversation - Active conversation
 * @param dbClient - Optional Supabase client (defaults to production)
 * @returns Agent response with actions and/or immediate reply
 */
export async function invokeConciergeAgent(
  message: Message,
  user: User,
  conversation: Conversation,
  dbClient: SupabaseClient = createServiceClient()
): Promise<AgentResponse> {
  const startTime = Date.now();

  try {
    // Log agent invocation
    await logAgentAction({
      agentType: 'concierge',
      actionType: 'agent_invocation',
      userId: user.id,
      contextId: conversation.id,
      contextType: 'conversation',
      inputData: {
        messageId: message.id,
        messageContent: message.content,
        messageRole: message.role,
      },
    }, dbClient);

    // Detect message type and route appropriately
    const isReengagement = message.role === 'system' &&
      message.content.includes('"type":"re_engagement_check"');

    if (message.role === 'user') {
      // Week 2: User messages with 2-LLM pattern
      return await handleUserMessage(message, user, conversation, startTime, dbClient);
    } else if (isReengagement) {
      // Week 3: Re-engagement with social judgment
      return await handleReengagement(message, user, conversation, startTime, dbClient);
    } else {
      // Week 4: System triggers (solution updates, priority notifications, etc.)
      console.log(`[Concierge] System message received (not re-engagement). Returning fallback.`);
      return {
        immediateReply: false,
        messages: [],
        actions: [],
      };
    }
  } catch (error) {
    console.error('[Concierge Agent Error]:', error);

    // Enhanced error logging with full context
    await logAgentAction({
      agentType: 'concierge',
      actionType: 'agent_invocation_error',
      userId: user.id,
      contextId: conversation.id,
      contextType: 'conversation',
      inputData: {
        messageContent: message.content,
        messageRole: message.role,
        messageId: message.id,
        timestamp: new Date().toISOString(),
        isReengagement: message.role === 'system' &&
          message.content.includes('"type":"re_engagement_check"'),
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

    // Return graceful fallback
    return {
      immediateReply: true,
      messages: ["I'm having trouble processing that right now. Could you try rephrasing?"],
      actions: [],
    };
  }
}

/**
 * Handle user message with 2-LLM architecture
 *
 * Flow: Load Context → Call 1 (Decision) → Execute Tools → Call 2 (Personality) → Parse Messages
 */
async function handleUserMessage(
  message: Message,
  user: User,
  conversation: Conversation,
  startTime: number,
  dbClient: SupabaseClient
): Promise<AgentResponse> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Step 1: Load context fresh from database
  const context = await loadAgentContext(user.id, conversation.id, 5, dbClient);
  const conciergeContext: ConciergeContext = {
    recentMessages: context.recentMessages,
    userPriorities: context.userPriorities,
    outstandingCommunityRequests: context.outstandingCommunityRequests,
    lastPresentedCommunityRequest: context.lastPresentedCommunityRequest,
    user,
  };

  console.log(`[Concierge 2-LLM] Processing user message from ${user.first_name} ${user.last_name}`);

  // Step 2: CALL 1 - Decision (temp 0.1, tool selection and business logic)
  console.log(`[Concierge 2-LLM] Call 1: Decision (analyzing message and selecting tools)`);
  const decision = await callUserMessageDecision(anthropic, message, conciergeContext);

  console.log(`[Concierge 2-LLM] Call 1 Output:`, {
    tools: decision.tools_to_execute.length,
    scenario: decision.next_scenario,
  });

  // Step 3: Execute tools and collect results
  const toolResults: Record<string, any> = {};
  const actions: AgentAction[] = [];

  for (const toolDef of decision.tools_to_execute) {
    console.log(`[Concierge 2-LLM] Executing tool: ${toolDef.tool_name}`);

    const result = await executeTool(toolDef, user, conversation, context, dbClient);

    // Collect actions from tool execution
    if (result.actions) {
      actions.push(...result.actions);
    }

    // Collect specific results that Call 2 needs
    if (toolDef.tool_name === 'publish_community_request') {
      toolResults.requestId = result.requestId;
      toolResults.requestSummary = toolDef.params.request_summary;
    } else if (toolDef.tool_name === 'create_intro_opportunity') {
      toolResults.introId = result.introId;
      toolResults.prospectName = toolDef.params.prospect_name;
    } else if (toolDef.tool_name === 'request_solution_research') {
      toolResults.researchId = result.researchId;
      toolResults.category = toolDef.params.category;
    }
  }

  console.log(`[Concierge 2-LLM] Tool results collected:`, Object.keys(toolResults));

  // Step 4: CALL 2 - Personality (temp 0.7, compose natural response)
  console.log(`[Concierge 2-LLM] Call 2: Personality (composing message)`);

  const personalityPrompt = buildPersonalityPrompt(
    decision.next_scenario,
    JSON.stringify(decision.context_for_call_2),
    toolResults
  );

  // Build message history for Call 2 (filter out internal system messages)
  const conversationMessages = context.recentMessages
    .filter((msg) => {
      // Always include user messages
      if (msg.role === 'user') return true;

      // Always include agent's own messages for self-reflection
      if (msg.role === 'concierge') return true;

      // Include system messages that were sent to user (outbound)
      // Exclude internal system messages (inbound triggers like re-engagement)
      if (msg.role === 'system') {
        return msg.direction === 'outbound';
      }

      // Exclude everything else
      return false;
    })
    .map((m) => ({
      role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: m.content,
    }));

  conversationMessages.push({
    role: 'user',
    content: message.content
  });

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    temperature: 0.7, // Higher temp for creative personality
    system: personalityPrompt,
    messages: conversationMessages
  });

  // Step 5: Parse message sequences (supports multiple delimiter patterns)
  const textBlocks = response.content.filter((block) => block.type === 'text');
  const rawTexts = textBlocks.map(block => 'text' in block ? block.text.trim() : '').filter(t => t.length > 0);
  const messageTexts = parseMessageSequences(rawTexts);

  console.log(`[Concierge 2-LLM] Call 2 Output: ${messageTexts.length} message(s)`);

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
        console.log(`[Concierge 2-LLM] Marked proactive priority as presented: ${proactivePriority.item_type} ${proactivePriority.item_id}`);
      } catch (error) {
        console.error(`[Concierge 2-LLM] Failed to mark proactive priority as presented:`, error);
      }
    }
  }

  // Log completion
  await logAgentAction({
    agentType: 'concierge',
    actionType: 'agent_invocation_complete',
    userId: user.id,
    contextId: conversation.id,
    contextType: 'conversation',
    outputData: {
      toolsUsed: decision.tools_to_execute.map(t => t.tool_name),
      actionsCount: actions.length,
      messagesCount: messageTexts.length,
      scenario: decision.next_scenario,
    },
    latencyMs: Date.now() - startTime,
  }, dbClient);

  return {
    immediateReply: messageTexts.length > 0,
    messages: messageTexts,
    actions,
  };
}

/**
 * Handle re-engagement check with LLM-based social judgment
 *
 * Week 3: Re-engagement with multi-thread analysis
 * - Loads 15-20 messages for full context
 * - Temperature 0.6 for social awareness
 * - Can decide NOT to message if user overwhelmed or no high-value items
 * - Addresses multiple threads (priorities, requests, inquiries)
 */
async function handleReengagement(
  message: Message,
  user: User,
  conversation: Conversation,
  startTime: number,
  dbClient: SupabaseClient
): Promise<AgentResponse> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  console.log(`[Concierge Re-engagement] Starting re-engagement check for user ${user.id}`);

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

    console.log(`[Concierge Re-engagement] Throttled: Last re-engagement was ${daysSinceLastAttempt.toFixed(1)} days ago`);

    // Extend task by remaining days to reach 7 days
    const extendDays = Math.ceil(7 - daysSinceLastAttempt);
    const scheduledFor = new Date();
    scheduledFor.setDate(scheduledFor.getDate() + extendDays);

    await createAgentTask({
      task_type: 're_engagement_check',
      agent_type: 'concierge',
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
      created_by: 'concierge_agent',
    }, dbClient);

    await logAgentAction({
      agentType: 'concierge',
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
    console.log(`[Concierge Re-engagement] Paused: User has not responded to ${unansweredCount} attempts in 90 days`);

    await logAgentAction({
      agentType: 'concierge',
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

  console.log(`[Concierge Re-engagement] Throttling checks passed (${unansweredCount} unanswered in 90 days)`);

  // ========================================================================
  // END THROTTLING CHECKS - Continue with normal re-engagement flow
  // ========================================================================

  // Parse re-engagement context from system message
  const reengagementContext = JSON.parse(message.content);
  const daysSinceLastMessage = reengagementContext.daysSinceLastMessage || 0;
  const priorityCount = reengagementContext.priorityCount || 0;
  const hasActiveGoals = reengagementContext.hasActiveGoals || false;

  console.log(`[Concierge Re-engagement] Context: ${daysSinceLastMessage} days, ${priorityCount} priorities, goals: ${hasActiveGoals}`);

  // Step 1: Load FULL context for re-engagement (15-20 messages)
  const context = await loadAgentContext(user.id, conversation.id, 20, dbClient); // More messages for social judgment

  const conciergeContext: ConciergeContext = {
    recentMessages: context.recentMessages,
    userPriorities: context.userPriorities,
    outstandingCommunityRequests: context.outstandingCommunityRequests,
    lastPresentedCommunityRequest: context.lastPresentedCommunityRequest,
    user,
  };

  // Step 2: CALL 1 - Re-engagement Decision (temp 0.6, social judgment)
  console.log(`[Concierge Re-engagement] Call 1: Re-engagement Decision (analyzing ${conciergeContext.recentMessages.length} messages)`);

  const decision = await callReengagementDecision(
    anthropic,
    user,
    conciergeContext,
    {
      daysSinceLastMessage,
      priorityCount,
      hasActiveGoals,
    }
  );

  console.log(`[Concierge Re-engagement] Decision: should_message=${decision.should_message}, scenario=${decision.next_scenario}`);

  // Step 3: If decision says DON'T message, extend task and return silent
  if (!decision.should_message || decision.next_scenario === 'no_message') {
    const extendDays = decision.extend_days || 30;
    console.log(`[Concierge Re-engagement] Not messaging. Reason: ${decision.reasoning}. Extending by ${extendDays} days.`);

    // Create new re-engagement task for future
    const scheduledFor = new Date();
    scheduledFor.setDate(scheduledFor.getDate() + extendDays);

    await createAgentTask({
      task_type: 're_engagement_check',
      agent_type: 'concierge',
      user_id: user.id,
      context_id: conversation.id,
      context_type: 'conversation',
      scheduled_for: scheduledFor.toISOString(),
      priority: 'low',
      context_json: {
        attemptCount: (reengagementContext.attemptCount || 0) + 1,
        reason: decision.reasoning,
      },
      created_by: 'concierge_agent',
    }, dbClient);

    // Log the decision
    await logAgentAction({
      agentType: 'concierge',
      actionType: 're_engagement_decision_no_message',
      userId: user.id,
      contextId: conversation.id,
      contextType: 'conversation',
      outputData: {
        reasoning: decision.reasoning,
        extendDays,
        daysSinceLastMessage,
        priorityCount,
      },
      latencyMs: Date.now() - startTime,
    }, dbClient);

    return {
      immediateReply: false,
      messages: [],
      actions: [],
    };
  }

  // Step 4: Execute any tools if needed (rare for re-engagement)
  const toolResults: Record<string, any> = {};
  const actions: AgentAction[] = [];

  for (const toolDef of decision.tools_to_execute || []) {
    console.log(`[Concierge Re-engagement] Executing tool: ${toolDef.tool_name}`);
    const result = await executeTool(toolDef, user, conversation, context, dbClient);

    if (result.actions) {
      actions.push(...result.actions);
    }

    // Collect tool results for Call 2
    if (toolDef.tool_name === 'publish_community_request') {
      toolResults.requestId = result.requestId;
    }
  }

  // Add threads to tool results for Call 2
  if (decision.threads_to_address) {
    toolResults.threads = decision.threads_to_address;
  }

  // Step 5: CALL 2 - Personality (temp 0.7, compose multi-thread response)
  console.log(`[Concierge Re-engagement] Call 2: Personality (composing ${decision.context_for_call_2?.message_structure || 'single'} message)`);

  const personalityPrompt = buildPersonalityPrompt(
    decision.next_scenario,
    JSON.stringify(decision.context_for_call_2),
    toolResults
  );

  // Build message history for Call 2 (filter out internal system messages)
  const conversationMessages = context.recentMessages
    .filter((msg) => {
      // Always include user messages
      if (msg.role === 'user') return true;

      // Always include agent's own messages for self-reflection
      if (msg.role === 'concierge') return true;

      // Include system messages that were sent to user (outbound)
      // Exclude internal system messages (inbound triggers like re-engagement)
      if (msg.role === 'system') {
        return msg.direction === 'outbound';
      }

      // Exclude everything else
      return false;
    })
    .map((m) => ({
      role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: m.content,
    }));

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    temperature: 0.7, // Same as user messages
    system: personalityPrompt,
    messages: conversationMessages
  });

  // Step 6: Parse message sequences (supports multiple delimiter patterns)
  const textBlocks = response.content.filter(block => block.type === 'text');
  const rawTexts = textBlocks.map(block => 'text' in block ? block.text.trim() : '').filter(t => t.length > 0);
  const messageTexts = parseMessageSequences(rawTexts);

  console.log(`[Concierge Re-engagement] Call 2 Output: ${messageTexts.length} message(s)`);

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
            console.log(`[Concierge Re-engagement] Marked priority as presented (dedicated): ${priority.item_type} ${thread.item_id}`);
          } catch (error) {
            console.error(`[Concierge Re-engagement] Failed to mark priority as presented:`, error);
          }
        }
      }
    }
  }

  // Log completion
  await logAgentAction({
    agentType: 'concierge',
    actionType: 're_engagement_message_sent',
    userId: user.id,
    contextId: conversation.id,
    contextType: 'conversation',
    outputData: {
      threadsAddressed: decision.threads_to_address?.length || 0,
      messagesCount: messageTexts.length,
      scenario: decision.next_scenario,
      daysSinceLastMessage,
    },
    latencyMs: Date.now() - startTime,
  }, dbClient);

  return {
    immediateReply: messageTexts.length > 0,
    messages: messageTexts,
    actions,
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
      requestId: string;
      question: string;
      presentedAt: string;
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
      if (context.lastPresentedCommunityRequest?.requestId !== params.request_id) {
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
 * Execute a single tool based on Call 1 decision
 */
async function executeTool(
  toolDef: { tool_name: string; params: Record<string, any> },
  user: User,
  conversation: Conversation,
  context: {
    recentMessages: Message[];
    userPriorities: UserPriority[];
    outstandingCommunityRequests: Array<{ id: string; question: string; created_at: string }>;
    lastPresentedCommunityRequest?: {
      requestId: string;
      question: string;
      presentedAt: string;
    };
  },
  dbClient: SupabaseClient = createServiceClient()
): Promise<{
  actions?: AgentAction[];
  requestId?: string;
  introId?: string;
  researchId?: string;
  responseId?: string;
  error?: string;
  errorType?: string;
}> {
  const supabase = dbClient;
  const input = toolDef.params;

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
    case 'publish_community_request': {
      // Publish event for Agent of Humans
      const event = await publishEvent({
        event_type: 'community.request_needed',
        aggregate_id: user.id,
        aggregate_type: 'user',
        payload: {
          requestingAgentType: 'concierge',
          requestingUserId: user.id,
          contextId: conversation.id,
          contextType: 'conversation',
          question: input.question,
          expertiseNeeded: input.expertise_needed || [],
          requesterContext: input.requester_context,
          desiredOutcome: input.desired_outcome || 'backchannel',
          urgency: input.urgency || 'medium',
          requestSummary: input.request_summary,
        },
        created_by: 'concierge_agent',
      }, dbClient);

      const action: AgentAction = {
        type: 'ask_community_question',
        params: {
          question: input.question,
          expertiseNeeded: input.expertise_needed,
          requesterContext: input.requester_context,
          desiredOutcome: input.desired_outcome,
          urgency: input.urgency,
        },
        reason: 'User asked a question needing expert input',
      };

      return {
        actions: [action],
        requestId: 'pending', // Will be created by event handler
      };
    }

    case 'request_solution_research': {
      // Publish event for Solution Saga
      await publishEvent({
        event_type: 'user.inquiry.solution_needed',
        aggregate_id: user.id,
        aggregate_type: 'user',
        payload: {
          userId: user.id,
          conversationId: conversation.id,
          requestDescription: input.description,
          category: input.category,
          urgency: input.urgency || 'medium',
        },
        created_by: 'concierge_agent',
      }, dbClient);

      const action: AgentAction = {
        type: 'request_solution_research',
        params: {
          description: input.description,
          category: input.category,
        },
        reason: 'User inquired about business solution',
      };

      return {
        actions: [action],
        researchId: 'pending', // Will be created by event handler
      };
    }

    case 'offer_introduction': {
      // User spontaneously offers to introduce prospect to introducee
      const { data: introOffer, error } = await supabase
        .from('intro_offers')
        .insert({
          offering_user_id: user.id,
          introducee_user_id: input.introducee_user_id,
          prospect_name: input.prospect_name,
          prospect_company: input.prospect_company || null,
          prospect_title: input.prospect_title || null,
          prospect_context: input.prospect_context || null,
          context_type: input.context_type || 'conversation',
          context_id: input.context_id || conversation.id,
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
          prospect_name: input.prospect_name,
          introducee_user_id: input.introducee_user_id,
        },
        reason: 'User offered to make introduction',
      };

      return {
        actions: [action],
        introId: introOffer.id,
      };
    }

    case 'accept_intro_opportunity': {
      // User accepts an intro opportunity from their priorities

      // Track presentation before updating status (Phase 5: Priority Status Tracking)
      await markPriorityPresented(
        dbClient,
        'intro_opportunity',
        input.intro_opportunity_id,
        'dedicated', // User is directly responding to this priority
        user.id,
        conversation.id
      );

      const { data: introOpp, error } = await supabase
        .from('intro_opportunities')
        .update({ status: 'accepted', connector_response: 'Accepted' })
        .eq('id', input.intro_opportunity_id)
        .select()
        .single();

      if (error) {
        console.error('Error accepting intro opportunity:', error);
        return {};
      }

      const action: AgentAction = {
        type: 'accept_intro_opportunity',
        params: { intro_opportunity_id: input.intro_opportunity_id },
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
        input.intro_opportunity_id,
        'dedicated', // User is directly responding to this priority
        user.id,
        conversation.id
      );

      const { data: introOpp, error } = await supabase
        .from('intro_opportunities')
        .update({
          status: 'rejected',
          connector_response: input.reason || 'Declined',
        })
        .eq('id', input.intro_opportunity_id)
        .select()
        .single();

      if (error) {
        console.error('Error declining intro opportunity:', error);
        return {};
      }

      const action: AgentAction = {
        type: 'decline_intro_opportunity',
        params: {
          intro_opportunity_id: input.intro_opportunity_id,
          reason: input.reason,
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
        .eq('id', input.intro_offer_id)
        .single();

      if (!introOffer) {
        console.error(`Intro offer ${input.intro_offer_id} not found`);
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
        .eq('id', input.intro_offer_id);

      if (error) {
        console.error('Error accepting intro offer:', error);
        return {};
      }

      const action: AgentAction = {
        type: 'accept_intro_offer',
        params: {
          intro_offer_id: input.intro_offer_id,
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
          introducee_response: input.reason || 'Declined',
        })
        .eq('id', input.intro_offer_id);

      if (error) {
        console.error('Error declining intro offer:', error);
        return {};
      }

      const action: AgentAction = {
        type: 'decline_intro_offer',
        params: {
          intro_offer_id: input.intro_offer_id,
          reason: input.reason,
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
        .eq('id', input.intro_offer_id);

      if (error) {
        console.error('Error confirming intro offer:', error);
        return {};
      }

      const action: AgentAction = {
        type: 'confirm_intro_offer',
        params: { intro_offer_id: input.intro_offer_id },
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
        input.connection_request_id,
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
        .eq('id', input.connection_request_id);

      if (error) {
        console.error('Error accepting connection request:', error);
        return {};
      }

      const action: AgentAction = {
        type: 'accept_connection_request',
        params: { connection_request_id: input.connection_request_id },
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
        input.connection_request_id,
        'dedicated', // User is directly responding to this priority
        user.id,
        conversation.id
      );

      const { error } = await supabase
        .from('connection_requests')
        .update({
          status: 'declined',
          introducee_response: input.reason || 'Declined',
        })
        .eq('id', input.connection_request_id);

      if (error) {
        console.error('Error declining connection request:', error);
        return {};
      }

      const action: AgentAction = {
        type: 'decline_connection_request',
        params: {
          connection_request_id: input.connection_request_id,
          reason: input.reason,
        },
        reason: 'User declined connection request',
      };

      return { actions: [action] };
    }

    case 'store_user_goal': {
      // Determine if goal is within scope
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const scopeCheckPrompt = `Is this request within the scope of a professional networking platform focused on intros, business solutions, and expert insights?

User's goal: "${input.goal}"

Return JSON:
{
  "within_scope": boolean,
  "reasoning": "brief explanation"
}`;

      let isWithinScope = true;
      try {
        const scopeResponse = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 150,
          messages: [{ role: 'user', content: scopeCheckPrompt }],
        });

        const scopeText = scopeResponse.content[0].type === 'text' ? scopeResponse.content[0].text : '{}';
        const cleanedText = scopeText.trim().replace(/^```json\s*\n?/, '').replace(/\n?```\s*$/, '');
        const scopeResult = JSON.parse(cleanedText);
        isWithinScope = scopeResult.within_scope;
      } catch (error) {
        console.error('Failed to parse scope check:', error);
      }

      // Store user goal
      const existingPattern = (user.response_pattern as any) || {};
      const updatedPattern = {
        ...existingPattern,
        user_goal: input.goal,
        user_goal_stored_at: new Date().toISOString(),
        within_scope: isWithinScope,
      };

      await supabase
        .from('users')
        .update({ response_pattern: updatedPattern })
        .eq('id', user.id);

      // Create 30-day re-engagement task
      const reengagementDate = new Date();
      reengagementDate.setDate(reengagementDate.getDate() + 30);

      await createAgentTask({
        task_type: 're_engagement_check',
        agent_type: 'concierge',
        user_id: user.id,
        context_id: conversation.id,
        context_type: 'conversation',
        scheduled_for: reengagementDate,
        priority: 'low',
        context_json: {
          reason: 'user_goal_stored',
          user_goal: input.goal,
          within_scope: isWithinScope,
        },
        created_by: 'concierge_agent',
      }, dbClient);

      const action: AgentAction = {
        type: 'store_user_goal',
        params: {
          goal: input.goal,
          within_scope: isWithinScope,
          reengagement_date: reengagementDate.toISOString(),
        },
        reason: 'User shared their goal for the community',
      };

      return {
        actions: [action],
      };
    }

    case 'record_community_response': {
      // Verify this is a valid request
      const { data: request } = await supabase
        .from('community_requests')
        .select('id, question, status')
        .eq('id', input.request_id)
        .single();

      if (!request) {
        console.error(`Community request ${input.request_id} not found`);
        return {};
      }

      // Check if user already responded
      const { data: existingResponse } = await supabase
        .from('community_responses')
        .select('id')
        .eq('request_id', input.request_id)
        .eq('user_id', user.id)
        .single();

      if (existingResponse) {
        console.log(`User ${user.id} already responded to request ${input.request_id}`);
        return {};
      }

      // Generate summary using LLM
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const summaryPrompt = `Summarize this expert response in 1-2 sentences:

Question: "${request.question}"

Response: "${input.response_content}"

Be concise and capture the key insight.`;

      let responseSummary = input.response_content.substring(0, 200);
      try {
        const summaryResponse = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 150,
          messages: [{ role: 'user', content: summaryPrompt }],
        });

        if (summaryResponse.content[0].type === 'text') {
          responseSummary = summaryResponse.content[0].text.trim();
        }
      } catch (error) {
        console.error('Failed to generate response summary:', error);
      }

      // Record response
      const { data: responseRecord, error: responseError } = await supabase
        .from('community_responses')
        .insert({
          request_id: input.request_id,
          user_id: user.id,
          response_content: input.response_content,
          response_summary: responseSummary,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (responseError) {
        console.error('Failed to record community response:', responseError);
        return {};
      }

      // Update priority to mark as responded
      await supabase
        .from('user_priorities')
        .update({
          status: 'responded',
          responded_at: new Date().toISOString(),
        })
        .eq('user_id', user.id)
        .eq('item_id', input.request_id)
        .eq('item_type', 'community_request');

      // Publish event
      await publishEvent({
        event_type: 'community.response_received',
        aggregate_id: input.request_id,
        aggregate_type: 'community_request',
        payload: {
          requestId: input.request_id,
          responderId: user.id,
          responseId: responseRecord.id,
          responseSummary,
        },
        created_by: 'concierge_agent',
      }, dbClient);

      const action: AgentAction = {
        type: 'record_community_response',
        params: {
          request_id: input.request_id,
          response_id: responseRecord.id,
          response_summary: responseSummary,
        },
        reason: 'User provided expert response to community request',
      };

      return {
        actions: [action],
        responseId: responseRecord.id,
      };
    }

    default:
      console.warn(`Unknown tool: ${toolDef.tool_name}`);
      return {};
  }
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
    agentType: 'concierge',
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
 * Load agent context from database.
 */
async function loadAgentContext(
  userId: string,
  conversationId: string,
  messageLimit: number = 5, // Default to 5 for user messages, override for re-engagement
  dbClient: SupabaseClient = createServiceClient()
): Promise<{
  recentMessages: Message[];
  conversationSummary?: string;
  userPriorities: UserPriority[];
  outstandingCommunityRequests: Array<{ id: string; question: string; created_at: string }>;
  lastPresentedCommunityRequest?: {
    requestId: string;
    question: string;
    presentedAt: string;
  };
}> {
  const supabase = dbClient;

  // Load recent messages (5 for user messages, 15-20 for re-engagement)
  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(messageLimit);

  const recentMessages = (messages as Message[] || []).reverse();

  // Load user priorities - denormalized fields, NO joins needed
  const { data: priorities } = await supabase
    .from('user_priorities')
    .select('id, user_id, priority_rank, item_type, item_id, value_score, status, presentation_count, created_at, expires_at, presented_at, item_summary, item_primary_name, item_secondary_name, item_context, item_metadata')
    .eq('user_id', userId)
    .in('status', ['active', 'presented', 'clarifying']) // Exclude actioned, dormant
    .lte('presentation_count', 1) // Exclude items presented 2x (approaching dormant)
    .order('priority_rank', { ascending: true })
    .limit(10);

  const userPriorities = (priorities as UserPriority[]) || [];

  // Load outstanding community requests
  const { data: requests } = await supabase
    .from('community_requests')
    .select('id, question, created_at')
    .eq('status', 'open')
    .contains('target_user_ids', [userId])
    .order('created_at', { ascending: false })
    .limit(5);

  const outstandingCommunityRequests = requests || [];

  // Check for last presented community request awaiting response
  const { data: lastPresentedPriority } = await supabase
    .from('user_priorities')
    .select('item_id, presented_at')
    .eq('user_id', userId)
    .eq('item_type', 'community_request')
    .eq('status', 'presented')
    .order('presented_at', { ascending: false })
    .limit(1)
    .single();

  let lastPresentedCommunityRequest;
  if (lastPresentedPriority) {
    // Check if user already responded
    const { data: existingResponse } = await supabase
      .from('community_responses')
      .select('id')
      .eq('request_id', lastPresentedPriority.item_id)
      .eq('user_id', userId)
      .single();

    if (!existingResponse) {
      // Fetch request details
      const { data: request } = await supabase
        .from('community_requests')
        .select('question, status')
        .eq('id', lastPresentedPriority.item_id)
        .single();

      if (request && request.status === 'open') {
        lastPresentedCommunityRequest = {
          requestId: lastPresentedPriority.item_id as string,
          question: request.question,
          presentedAt: lastPresentedPriority.presented_at as string,
        };
      }
    }
  }

  return {
    recentMessages,
    userPriorities,
    outstandingCommunityRequests,
    lastPresentedCommunityRequest,
  };
}

/**
 * Log agent action
 */
async function logAgentAction(data: {
  agentType: string;
  actionType: string;
  userId: string;
  contextId: string;
  contextType: string;
  inputData?: any;
  outputData?: any;
  error?: string;
  latencyMs?: number;
}, dbClient: SupabaseClient = createServiceClient()): Promise<void> {
  const supabase = dbClient;

  await supabase.from('agent_actions_log').insert({
    agent_type: data.agentType,
    action_type: data.actionType,
    user_id: data.userId,
    context_id: data.contextId,
    context_type: data.contextType,
    input_data: data.inputData,
    output_data: data.outputData,
    error: data.error,
    latency_ms: data.latencyMs,
    created_at: new Date().toISOString(),
  });
}

// Re-export types for Innovator agent (existing exports)
export type { UserIntent } from './intent-classifier';
export { getReengagementDecisionPrompt } from './prompts';
