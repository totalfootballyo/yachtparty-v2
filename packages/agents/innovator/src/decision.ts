/**
 * Innovator Agent Decision Module (Call 1)
 *
 * Handles ALL decision-making logic for the Innovator agent:
 * - Tool selection (which tools to execute based on user message)
 * - Re-engagement decisions (should we message the user? what threads to address?)
 * - Context preparation for Call 2 (what to tell the personality layer)
 *
 * Week 5: Innovator Implementation
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Message, User, UserPriority } from '@yachtparty/shared';

/**
 * Innovator-specific context for decision-making
 */
export interface InnovatorContext {
  recentMessages: Message[];
  userPriorities: Array<{
    id: string;
    item_type: string;
    item_id: string;
    value_score?: number | null;
    status: string;
  }>;
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
  creditBalance?: number;
  user: User;
}

/**
 * Call 1 Output Structure
 *
 * This is what Call 1 returns after analyzing the user's message and context.
 * It tells the orchestrator:
 * - Which tools to execute
 * - What scenario we're in (for personality guidance)
 * - What context to pass to Call 2
 */
export interface Call1Output {
  tools_to_execute: Array<{
    tool_name: string;
    params: Record<string, any>;
  }>;

  next_scenario:
    | 'single_topic_response'
    | 'community_request_acknowledgment'
    | 'solution_research_acknowledgment'
    | 'intro_opportunity_acknowledgment'
    | 'goal_stored_acknowledgment'
    | 'community_response_shared'
    | 'profile_update_acknowledgment'
    | 'profile_update_prompt'
    | 'prospect_upload_guidance'
    | 'intro_progress_report'
    | 'intro_progress_followup'
    | 'credit_funding_offer'
    | 'credit_funding_acknowledgment'
    | 'priority_opportunity'
    | 'solution_update'
    | 'multi_thread_response'
    | 'community_request_followup'
    | 'priority_update'
    | 'general_response'
    | 'no_message';

  context_for_call_2: {
    primary_topic: string;
    tone: 'helpful' | 'informative' | 'reassuring' | 'professional';
    message_structure?: 'single' | 'sequence_2' | 'sequence_3';
    secondary_topics?: string[];
    personalization_hooks?: {
      user_name?: string;
      recent_context?: string;
      emotional_state?: 'eager' | 'patient' | 'frustrated' | 'overwhelmed';
    };
  };
}

/**
 * Re-engagement Decision Output
 *
 * Extends Call1Output with re-engagement-specific fields.
 */
export interface ReengagementDecisionOutput extends Call1Output {
  should_message: boolean;
  reasoning?: string;
  extend_days?: number;
  threads_to_address?: Array<{
    type:
      | 'priority_opportunity'
      | 'community_request_update'
      | 'user_inquiry_update'
      | 'solution_update'
      | 'intro_progress_update'
      | 'profile_update_needed'
      | 'prospect_upload_reminder'
      | 'credit_funding_needed';
    item_id: string;
    priority: 'high' | 'medium' | 'low';
    message_guidance: string;
  }>;
}

/**
 * Build Call 1 Decision Prompt for User Messages
 *
 * This prompt tells Call 1 (temp 0.1) to:
 * 1. Analyze the user's message
 * 2. Select which tools to execute (if any)
 * 3. Prepare context for Call 2
 */
function buildUserMessageDecisionPrompt(context: InnovatorContext): string {
  let prompt = `You are Call 1 of a 2-LLM system for an Innovator agent.

YOUR JOB:
Analyze the user's message and decide which tools to execute (if any).
You do NOT compose messages. Call 2 handles that.

AVAILABLE TOOLS (9 total):

1. publish_community_request
   Use when: User asks a question that requires community expertise
   Parameters: { question, expertise_needed, requester_context, desired_outcome, urgency, request_summary }

2. request_solution_research
   Use when: User needs recommendations for vendors/solutions
   Parameters: { problem_description, domain, requirements, budget_range }

3. create_intro_opportunity
   Use when: You can connect user with someone relevant
   Parameters: { opportunity_type, target_person_name, target_person_context, value_proposition }

4. store_user_goal
   Use when: User mentions a goal or objective for the first time
   Parameters: { goal_type, goal_description, timeline, success_criteria }

5. record_community_response
   Use when: User is providing information/feedback in response to a community request
   Parameters: { community_request_id, response_content, expertise_demonstrated }

6. update_innovator_profile
   Use when: User wants to update company info, solution description, target customers, or pricing
   Parameters: { company?, solution_description?, target_customers?, pricing_model?, website? }

7. upload_prospects
   Use when: User wants to upload a list of prospects for targeted matching
   Parameters: { prospect_count_estimate, target_industries?, notes? }
   Returns: Secure CSV upload link

8. check_intro_progress
   Use when: User asks about introduction status or conversion metrics
   Parameters: { intro_id?, time_period?, include_metrics? }

9. request_credit_funding
   Use when: User needs more credits or asks about purchasing credits
   Parameters: { requested_amount?, urgency? }
   Returns: Payment link

CONTEXT:
Recent messages (last 5): ${JSON.stringify(context.recentMessages.map(m => ({ role: m.role, content: m.content })), null, 2)}

User priorities: ${JSON.stringify(context.userPriorities, null, 2)}

Outstanding community requests: ${JSON.stringify(context.outstandingCommunityRequests, null, 2)}

Innovator profile: ${JSON.stringify(context.innovatorProfile || {}, null, 2)}

Pending intros: ${JSON.stringify(context.pendingIntros || [], null, 2)}

Credit balance: ${context.creditBalance || 0}

DECISION PROCESS:
1. What is the user asking for?
2. Which tool(s) should be executed?
3. What are the complete parameters for each tool?
4. What scenario does this create for Call 2?
5. What tone should Call 2 use?
6. What's the primary topic Call 2 should address?

OUTPUT FORMAT (JSON):
{
  "tools_to_execute": [
    {
      "tool_name": "tool_name_here",
      "params": {
        "param1": "value1",
        "param2": "value2"
      }
    }
  ],
  "next_scenario": "scenario_name",
  "context_for_call_2": {
    "primary_topic": "what the user asked about",
    "tone": "helpful|informative|reassuring|professional",
    "personalization_hooks": {
      "user_name": "${context.user.first_name}",
      "recent_context": "any relevant context from conversation"
    }
  }
}

SCENARIOS FOR CALL 2:
- community_request_acknowledgment: User asked a question, you're publishing it
- solution_research_acknowledgment: User needs vendor recs, you're researching
- intro_opportunity_acknowledgment: You're creating an intro opportunity
- goal_stored_acknowledgment: You stored a user goal
- community_response_shared: You're sharing a community response
- profile_update_acknowledgment: User updated their profile
- prospect_upload_guidance: User wants to upload prospects
- intro_progress_report: User asked about intro status
- credit_funding_offer: User needs credits
- general_response: Catch-all for other interactions

IMPORTANT:
- Extract ALL required parameters for each tool
- Be precise with parameter values (don't make up information)
- If user's message is ambiguous, select the most likely intent
- You can execute multiple tools if needed
- Keep context_for_call_2 concise but informative
`;

  return prompt;
}

/**
 * Build Call 1 Decision Prompt for Re-engagement
 *
 * This prompt tells Call 1 (temp 0.6) to:
 * 1. Review all open items (priorities, requests, intros)
 * 2. Read conversation history for social context
 * 3. Decide whether to message or extend task
 * 4. If messaging, select which threads to address
 */
function buildReengagementDecisionPrompt(
  user: User,
  context: InnovatorContext,
  reengagementContext: {
    daysSinceLastMessage: number;
    priorityCount: number;
    hasActiveGoals: boolean;
    pendingIntroCount?: number;
    creditBalance?: number;
    profileLastUpdated?: string;
  }
): string {
  let prompt = `You are Call 1 of a 2-LLM system for an Innovator agent.

YOUR JOB (RE-ENGAGEMENT DECISION):
Decide whether to reach out to this Innovator user based on:
1. Open priorities (intro opportunities, solution updates, etc.)
2. Conversation history and emotional tone
3. Outstanding community requests or pending intros
4. Profile update needs
5. Credit balance and funding needs

CRITICAL: You can decide NOT to message if:
- User seems frustrated or overwhelmed
- Not enough time has passed since last message
- No high-value items to present
- User's responses have been terse or disengaged

RE-ENGAGEMENT CONTEXT:
Days since last message: ${reengagementContext.daysSinceLastMessage}
Priority count: ${reengagementContext.priorityCount}
Pending intro count: ${reengagementContext.pendingIntroCount || 0}
Credit balance: ${reengagementContext.creditBalance || 0}
Profile last updated: ${reengagementContext.profileLastUpdated || 'unknown'}
Has active goals: ${reengagementContext.hasActiveGoals}

CONVERSATION HISTORY (last 20 messages):
${JSON.stringify(context.recentMessages.map(m => ({ role: m.role, content: m.content, created_at: m.created_at })), null, 2)}

USER PRIORITIES (sorted by value score):
${JSON.stringify(context.userPriorities, null, 2)}

OUTSTANDING COMMUNITY REQUESTS:
${JSON.stringify(context.outstandingCommunityRequests, null, 2)}

PENDING INTROS:
${JSON.stringify(context.pendingIntros || [], null, 2)}

INNOVATOR PROFILE:
${JSON.stringify(context.innovatorProfile || {}, null, 2)}

DECISION PROCESS:
1. READ THE CONVERSATION HISTORY
   - Is the user engaged, frustrated, or terse?
   - What's their communication style?
   - Are they responsive or slow to reply?

2. ASSESS VALUE OF OPEN ITEMS
   - High priority items (value 80-100): Usually worth messaging
   - Medium priority items (value 50-79): Consider if multiple items or high engagement
   - Low priority items (<50): Only if user is very engaged
   - Pending intros needing follow-up: High value
   - Profile updates needed: Medium value if profile is >90 days old

3. DECIDE: MESSAGE OR EXTEND?
   - If messaging: Select 1-3 threads to address
   - If not messaging: Extend task by 7-90 days (more days if user frustrated)

4. IF MESSAGING: MULTI-THREADING
   - Start with reassurance (pending work, intros in progress)
   - Then provide updates (intro progress, community request status)
   - Then offer opportunities (new intros, profile updates, credit offers)
   - Use message_structure: 'single' (1 thread), 'sequence_2' (2 threads), 'sequence_3' (3+ threads)

OUTPUT FORMAT (JSON):
{
  "should_message": true|false,
  "reasoning": "why you decided to message or not",
  "extend_days": 30, // Only if should_message = false
  "threads_to_address": [ // Only if should_message = true
    {
      "type": "intro_progress_update|priority_opportunity|profile_update_needed|etc",
      "item_id": "id_of_item",
      "priority": "high|medium|low",
      "message_guidance": "what Call 2 should say about this thread"
    }
  ],
  "tools_to_execute": [], // Tools to execute (if any)
  "next_scenario": "multi_thread_response|priority_opportunity|intro_progress_report|no_message",
  "context_for_call_2": {
    "primary_topic": "main thread to address",
    "secondary_topics": ["thread 2", "thread 3"],
    "tone": "reassuring|informative|professional",
    "message_structure": "single|sequence_2|sequence_3",
    "personalization_hooks": {
      "user_name": "${user.first_name}",
      "recent_context": "context from conversation",
      "emotional_state": "eager|patient|frustrated|overwhelmed"
    }
  }
}

SCENARIOS FOR RE-ENGAGEMENT:
- multi_thread_response: Addressing 2-3 threads (reassurance + updates + opportunities)
- priority_opportunity: Single high-value intro opportunity
- intro_progress_report: Update on pending introductions
- intro_progress_followup: Follow-up on specific intro
- profile_update_prompt: Suggest updating outdated profile
- credit_funding_offer: Offer to purchase more credits
- community_request_followup: Update on outstanding community request
- solution_update: Share solution research results
- no_message: Don't message (extend task instead)

SOCIAL JUDGMENT GUIDELINES:
- Frustrated signals: "too many messages", "I'll let you know", terse replies
- Overwhelmed signals: Long delays, decreasing message length, single-word responses
- Engaged signals: Questions, follow-ups, detailed responses, timely replies
- Patient signals: "take your time", "no rush", understanding tone

BE CONSERVATIVE:
- When in doubt, extend the task rather than risking annoyance
- High-value items (intro progress, hot leads) can override caution
- If user expressed frustration recently, extend by 60-90 days
- If user is engaged, 7-14 days is reasonable
`;

  return prompt;
}

/**
 * Call 1: User Message Decision
 *
 * Temperature: 0.1 (fast, consistent, deterministic)
 * Message history: Last 5 messages (focused context)
 *
 * @param anthropic - Anthropic SDK client
 * @param userMessage - The user's message
 * @param context - Innovator-specific context
 * @returns Decision output (tools, scenario, context for Call 2)
 */
export async function callUserMessageDecision(
  anthropic: Anthropic,
  userMessage: Message,
  context: InnovatorContext
): Promise<Call1Output> {
  const systemPrompt = buildUserMessageDecisionPrompt(context);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000, // More tokens for 9 tools vs 5
    temperature: 0.1, // Low temp for consistent, fast decisions
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: userMessage.content,
      },
    ],
  });

  // Parse the JSON response
  const textContent = response.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text content in Call 1 response');
  }

  // Extract JSON from the response (may be wrapped in markdown code blocks)
  let jsonText = textContent.text;
  const jsonMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (jsonMatch) {
    jsonText = jsonMatch[1];
  }

  const decision: Call1Output = JSON.parse(jsonText);

  return decision;
}

/**
 * Call 1: Re-engagement Decision
 *
 * Temperature: 0.6 (social judgment, nuanced decision-making)
 * Message history: Last 15-20 messages (full context for emotional tone)
 *
 * @param anthropic - Anthropic SDK client
 * @param user - The user
 * @param context - Innovator-specific context
 * @param reengagementContext - Re-engagement metadata
 * @returns Re-engagement decision output
 */
export async function callReengagementDecision(
  anthropic: Anthropic,
  user: User,
  context: InnovatorContext,
  reengagementContext: {
    daysSinceLastMessage: number;
    priorityCount: number;
    hasActiveGoals: boolean;
    pendingIntroCount?: number;
    creditBalance?: number;
    profileLastUpdated?: string;
  }
): Promise<ReengagementDecisionOutput> {
  const systemPrompt = buildReengagementDecisionPrompt(user, context, reengagementContext);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1200, // More tokens for multi-thread analysis
    temperature: 0.6, // Higher temp for social judgment and nuance
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: 'Based on the context above, should I reach out to this user? If yes, what should I say?',
      },
    ],
  });

  // Parse the JSON response
  const textContent = response.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text content in Call 1 response');
  }

  // Extract JSON from the response
  let jsonText = textContent.text;
  const jsonMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (jsonMatch) {
    jsonText = jsonMatch[1];
  }

  const decision: ReengagementDecisionOutput = JSON.parse(jsonText);

  return decision;
}
