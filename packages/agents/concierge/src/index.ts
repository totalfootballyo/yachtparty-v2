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
 * Main entry point for Concierge Agent.
 *
 * Processes user messages using 2-LLM sequential architecture.
 *
 * @param message - Inbound user message
 * @param user - User record
 * @param conversation - Active conversation
 * @returns Agent response with actions and/or immediate reply
 */
export async function invokeConciergeAgent(
  message: Message,
  user: User,
  conversation: Conversation
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
    });

    // Detect message type and route appropriately
    const isReengagement = message.role === 'system' &&
      message.content.includes('"type":"re_engagement_check"');

    if (message.role === 'user') {
      // Week 2: User messages with 2-LLM pattern
      return await handleUserMessage(message, user, conversation, startTime);
    } else if (isReengagement) {
      // Week 3: Re-engagement with social judgment
      return await handleReengagement(message, user, conversation, startTime);
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
    console.error('Concierge Agent Error:', error);

    // Log error
    await logAgentAction({
      agentType: 'concierge',
      actionType: 'agent_invocation',
      userId: user.id,
      contextId: conversation.id,
      contextType: 'conversation',
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - startTime,
    });

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
  startTime: number
): Promise<AgentResponse> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Step 1: Load context fresh from database
  const context = await loadAgentContext(user.id, conversation.id);
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

    const result = await executeTool(toolDef, user, conversation, context);

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

  // Build message history for Call 2 (same as Call 1 for continuity and self-reflection)
  const conversationMessages = context.recentMessages.map(m => ({
    role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
    content: m.content
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

  // Step 5: Parse message sequences (split by "---" delimiter)
  const textBlocks = response.content.filter((block) => block.type === 'text');
  const rawTexts = textBlocks.map(block => 'text' in block ? block.text.trim() : '').filter(t => t.length > 0);
  const messageTexts = rawTexts.flatMap(text =>
    text.split(/\n---\n/).map(msg => msg.trim()).filter(msg => msg.length > 0)
  );

  console.log(`[Concierge 2-LLM] Call 2 Output: ${messageTexts.length} message(s)`);

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
  });

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
  startTime: number
): Promise<AgentResponse> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  console.log(`[Concierge Re-engagement] Starting re-engagement check for user ${user.id}`);

  // Parse re-engagement context from system message
  const reengagementContext = JSON.parse(message.content);
  const daysSinceLastMessage = reengagementContext.daysSinceLastMessage || 0;
  const priorityCount = reengagementContext.priorityCount || 0;
  const hasActiveGoals = reengagementContext.hasActiveGoals || false;

  console.log(`[Concierge Re-engagement] Context: ${daysSinceLastMessage} days, ${priorityCount} priorities, goals: ${hasActiveGoals}`);

  // Step 1: Load FULL context for re-engagement (15-20 messages)
  const context = await loadAgentContext(user.id, conversation.id, 20); // More messages for social judgment

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
    });

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
    });

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
    const result = await executeTool(toolDef, user, conversation, context);

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

  // Build message history for Call 2 (same messages for self-reflection)
  const conversationMessages = context.recentMessages.map(m => ({
    role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
    content: m.content
  }));

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    temperature: 0.7, // Same as user messages
    system: personalityPrompt,
    messages: conversationMessages
  });

  // Step 6: Parse message sequences
  const textBlocks = response.content.filter(block => block.type === 'text');
  const rawTexts = textBlocks.map(block => 'text' in block ? block.text.trim() : '').filter(t => t.length > 0);

  const messageTexts = rawTexts.flatMap(text =>
    text.split(/\n---\n/).map(msg => msg.trim()).filter(msg => msg.length > 0)
  );

  console.log(`[Concierge Re-engagement] Call 2 Output: ${messageTexts.length} message(s)`);

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
  });

  return {
    immediateReply: messageTexts.length > 0,
    messages: messageTexts,
    actions,
  };
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
  }
): Promise<{
  actions?: AgentAction[];
  requestId?: string;
  introId?: string;
  researchId?: string;
  responseId?: string;
}> {
  const supabase = createServiceClient();
  const input = toolDef.params;

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
      });

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
      });

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

    case 'create_intro_opportunity': {
      // Publish event for Account Manager
      await publishEvent({
        event_type: 'user.intro_inquiry',
        aggregate_id: user.id,
        aggregate_type: 'user',
        payload: {
          userId: user.id,
          conversationId: conversation.id,
          prospectName: input.prospect_name,
          prospectCompany: input.prospect_company,
          reason: input.reason,
        },
        created_by: 'concierge_agent',
      });

      const action: AgentAction = {
        type: 'create_intro_opportunity',
        params: {
          prospectName: input.prospect_name,
          prospectCompany: input.prospect_company,
          reason: input.reason,
        },
        reason: 'User requested introduction',
      };

      return {
        actions: [action],
        introId: 'pending', // Will be created by event handler
      };
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
      });

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
      });

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
 * Load agent context from database.
 */
async function loadAgentContext(
  userId: string,
  conversationId: string,
  messageLimit: number = 5 // Default to 5 for user messages, override for re-engagement
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
  const supabase = createServiceClient();

  // Load recent messages (5 for user messages, 15-20 for re-engagement)
  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(messageLimit);

  const recentMessages = (messages as Message[] || []).reverse();

  // Load user priorities
  const { data: priorities } = await supabase
    .from('user_priorities')
    .select('*')
    .eq('user_id', userId)
    .order('priority_score', { ascending: false })
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
}): Promise<void> {
  const supabase = createServiceClient();

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
