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
    | 'response_with_proactive_priority' // NEW - Appendix E
    | 'general_response'
    | 'request_clarification' // NEW - Appendix E
    | 'no_message';

  context_for_call_2: {
    primary_topic: string;
    primary_response_guidance?: string; // NEW - Appendix E: Dry answer from Call 1
    tone: 'helpful' | 'informative' | 'reassuring' | 'professional';
    message_structure?: 'single' | 'sequence_2' | 'sequence_3';
    secondary_topics?: string[];

    // Intent tracking (NEW - Appendix E)
    user_responding_to?: {
      item_type: string;
      item_id: string;
      confidence: 'high' | 'medium' | 'low';
    } | null;

    // Proactive priority presentation (NEW - Appendix E)
    proactive_priority?: {
      item_type: 'intro_opportunity' | 'connection_request' | 'community_request';
      item_id: string;
      summary: string;
      transition_phrase: string;
      should_mention: boolean;
      reason?: string;
    };

    personalization_hooks?: {
      user_name?: string;
      recent_context?: string;
      emotional_state?: 'eager' | 'patient' | 'frustrated' | 'overwhelmed';
    };

    // Clarification support (NEW - Appendix E)
    clarification_needed?: {
      ambiguous_request: string;
      possible_interpretations: Array<{
        label: string;
        description: string;
        would_trigger_tool?: string;
      }>;
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

AVAILABLE TOOLS (17 total):

1. publish_community_request
   Use when: User asks a question that requires community expertise
   Parameters: { question, expertise_needed, requester_context, desired_outcome, urgency, request_summary }

2. request_solution_research
   Use when: User needs recommendations for vendors/solutions
   Parameters: { problem_description, domain, requirements, budget_range }

3. offer_introduction
   Use when: User spontaneously offers to introduce a prospect to someone on the platform
   Example: "I can introduce you to Sarah at Google"
   Parameters: { prospect_name, introducee_user_id, prospect_company?, prospect_title?, prospect_context?, context_type?, context_id? }
   CRITICAL: Only use if user is OFFERING to make an intro, not REQUESTING one

4. accept_intro_opportunity
   Use when: User accepts an intro opportunity from their priorities
   Parameters: { intro_opportunity_id }
   Note: This is for when they agree to make an intro as a connector

5. decline_intro_opportunity
   Use when: User declines an intro opportunity
   Parameters: { intro_opportunity_id, reason? }

6. accept_intro_offer
   Use when: User accepts an intro offer (someone offered to introduce them)
   Parameters: { intro_offer_id }

7. decline_intro_offer
   Use when: User declines an intro offer
   Parameters: { intro_offer_id, reason? }

8. confirm_intro_offer
   Use when: User confirms they completed an intro they offered to make
   Parameters: { intro_offer_id }

9. accept_connection_request
   Use when: User accepts a connection request (someone wants to be introduced to them)
   Parameters: { connection_request_id }

10. decline_connection_request
    Use when: User declines a connection request
    Parameters: { connection_request_id, reason? }

11. request_connection
    Use when: Innovator wants to request an intro to a specific user on the platform
    Parameters: { introducee_user_id, intro_context, requestor_name, requestor_company?, requestor_title?, bounty_credits? }
    Note: This creates a connection_request record for the introducee to review

12. store_user_goal
    Use when: User mentions a goal or objective for the first time
    Parameters: { goal_type, goal_description, timeline, success_criteria }

13. record_community_response
    Use when: User is providing information/feedback in response to a community request
    Parameters: { community_request_id, response_content, expertise_demonstrated }

14. update_innovator_profile
    Use when: User wants to update company info, solution description, target customers, or pricing
    Parameters: { company?, solution_description?, target_customers?, pricing_model?, website? }

15. upload_prospects
    Use when: User wants to upload a list of prospects for targeted matching
    Parameters: { prospect_count_estimate, target_industries?, notes? }
    Returns: Secure CSV upload link

16. check_intro_progress
    Use when: User asks about introduction status or conversion metrics
    Parameters: { intro_id?, time_period?, include_metrics? }

17. request_credit_funding
    Use when: User needs more credits or asks about purchasing credits
    Parameters: { requested_amount?, urgency? }
    Returns: Payment link

CRITICAL: INTRODUCTION FLOW DISAMBIGUATION

There are THREE different introduction flows. Choose the correct tool based on the situation:

**1. intro_opportunities (System-initiated, connector makes intro)**
- **Situation**: Account Manager identified a match and presented it to connector
- **User sees**: "Want to intro [Prospect Name] to [Innovator Name]? Worth 25 credits."
- **User actions**: Accept (accept_intro_opportunity) or Decline (decline_intro_opportunity)
- **Flow**: System asks connector → Connector agrees → System coordinates intro

**2. intro_offers (User-initiated, connector offers intro)**
- **Situation**: User spontaneously offers to introduce someone
- **User says**: "I can introduce you to [Name]" or "Want me to connect you with [Name]?"
- **Tool to use**: offer_introduction
- **Flow**: User offers intro → Introducee accepts/declines → Connector confirms completion
- **User actions as connector**: offer_introduction, confirm_intro_offer
- **User actions as introducee**: accept_intro_offer, decline_intro_offer

**3. connection_requests (Requestor asks introducee / Innovator-specific)**
- **Situation**: Someone wants to be introduced to this user OR Innovator wants intro to user
- **User sees**: "[Name] wants an intro to you. Context: [reason]"
- **User actions**: Accept (accept_connection_request) or Decline (decline_connection_request)
- **Innovator creates request**: request_connection (creates connection_requests record)
- **Flow**: Requestor asks → Introducee agrees/declines → System coordinates intro

**How to Disambiguate:**

If user says "I want to meet [Person]" or "Can you connect me with [Person]?":
→ This is NOT any of the above flows
→ Use publish_community_request to find someone who can make that intro
→ DO NOT use offer_introduction (user is not offering, they're requesting)
→ EXCEPTION: If Innovator wants to request intro directly, use request_connection (Innovator-specific)

If user says "I can introduce you to [Person]":
→ Use offer_introduction (user is OFFERING to be the connector)

If user is responding to a priority about an intro opportunity:
→ Use accept_intro_opportunity or decline_intro_opportunity

If user is responding to an intro offer (someone offered to introduce them):
→ Use accept_intro_offer or decline_intro_offer

If user is responding to a connection request (someone wants intro to them):
→ Use accept_connection_request or decline_connection_request

If Innovator wants to directly request an intro to a platform user:
→ Use request_connection (creates connection_request for introducee to review)

CONTEXT:
Recent messages (last 10 with timestamps):
${context.recentMessages.slice(-10).map(m => `[${m.role}] (${new Date(m.created_at).toLocaleString()}): ${m.content}`).join('\n')}

User priorities (denormalized for fast intent matching):
${context.userPriorities.map((p, idx) => {
  let details = `${idx + 1}. **${p.item_type}** (ID: ${p.item_id}, Rank: ${p.priority_rank}, Presented: ${p.presentation_count || 0}x)`;
  if (p.item_summary) details += `\n   Summary: ${p.item_summary}`;
  if (p.item_primary_name) details += `\n   Primary: ${p.item_primary_name}`;
  if (p.item_secondary_name) details += `\n   Secondary: ${p.item_secondary_name}`;
  if (p.item_context) details += `\n   Context: ${p.item_context}`;
  if (p.item_metadata) details += `\n   Metadata: ${JSON.stringify(p.item_metadata)}`;
  return details;
}).join('\n\n')}

Outstanding community requests: ${JSON.stringify(context.outstandingCommunityRequests, null, 2)}

Innovator profile: ${JSON.stringify(context.innovatorProfile || {}, null, 2)}

Pending intros: ${JSON.stringify(context.pendingIntros || [], null, 2)}

Credit balance: ${context.creditBalance || 0}

## CRITICAL: Determining User Intent & Context

When a user sends a message, you MUST carefully analyze WHAT they are talking about.

### Reading Conversation Flow

1. **Review recent messages (last 10) with timestamps**
   - What topics were discussed?
   - What questions did you ask?
   - What priorities did you present to this user?

2. **Identify the user's intent**
   - Is the user clearly responding to a specific item you presented?
   - Is the user introducing a new topic entirely?
   - Is the user's message ambiguous (could apply to multiple items)?

3. **Match response to specific priorities (if applicable)**
   - You have access to the user's current priorities (from Account Manager)
   - Each priority has details: names, topics, context
   - Use these details to determine if user is addressing a specific priority
   - Look for keywords, names, topics that match

### CORRECT - Specific Intent Identified:

Recent context:
- You (yesterday 3pm): "I found 3 people who responded to your CTO hiring question. I'll send details."
- You (yesterday 3:05pm): "Also, Ben offered to intro you to Jim James at ABC Corp for CTV attribution. Interested?"

User (today 9am): "Yes please, send me those 3 people!"

✅ CORRECT INTERPRETATION:
- User is responding to: community_request (CTO hiring question)
- User is NOT responding to: intro_opportunity (Jim James intro)
- Output: user_responding_to = { item_type: "community_request", item_id: "...", confidence: "high" }
- Use tool: respond_to_community_request (or relevant tool)
- Do NOT mark intro_opportunity as actioned

### CORRECT - No Specific Intent (New Topic):

Recent context:
- User had 3 open priorities: hiring CTO, intro to Sarah Chen, meet Rob from MediaMath

User (today): "Can you help me find a marketing agency?"

✅ CORRECT INTERPRETATION:
- User is NOT responding to any existing priority
- User is introducing a NEW topic (marketing agency search)
- Output: user_responding_to = null
- Consider: proactive_priority (mention one of the 3 open items if appropriate)
- Use tool: request_solution_research OR publish_community_request

### INCORRECT - Marking Everything as Actioned:

❌ WRONG: User sent a message, so mark ALL 3 priorities as actioned
- This is INCORRECT - user didn't address any of them
- Result: System "forgets" about legitimate open priorities
- Never do this. Only mark priorities as actioned when user EXPLICITLY addresses them.

### When to Include Proactive Priority

**DO mention a proactive priority if:**
- ✅ User's message is about a DIFFERENT topic (not the priority you want to mention)
- ✅ User seems engaged and responsive (not stressed/short)
- ✅ Priority has high value_score (>70)
- ✅ It's been >3 days since last presentation
- ✅ You can introduce it naturally with "While I have you..."

**DON'T mention proactive priority if:**
- ❌ User's message indicates urgency or stress
- ❌ User explicitly said "just answer my question"
- ❌ You already presented this priority in last 2 messages
- ❌ User is clearly disengaged (one-word answers)

DECISION PROCESS:
1. What is the user asking for?
2. **INTENT CHECK**: Is user responding to a specific priority OR introducing new topic?
3. Which tool(s) should be executed?
4. What are the complete parameters for each tool?
5. Should we mention a proactive priority (different from main topic)?
6. What scenario does this create for Call 2?
7. What tone should Call 2 use?
8. What's the primary topic Call 2 should address?

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
    "primary_response_guidance": "Dry, factual answer to user's question (NEW - Appendix E)",
    "tone": "helpful|informative|reassuring|professional",

    "user_responding_to": {
      "item_type": "intro_opportunity",
      "item_id": "uuid-123",
      "confidence": "high"
    } OR null,

    "proactive_priority": {
      "item_type": "connection_request",
      "item_id": "uuid-456",
      "summary": "Rob from MediaMath wants to connect about CTV attribution",
      "transition_phrase": "While I have you",
      "should_mention": true,
      "reason": "User seems engaged, different topic, high value"
    } OR omit if no proactive priority,

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
- response_with_proactive_priority: Answer question + mention a priority (NEW - Appendix E)
- request_clarification: User's intent is ambiguous (NEW - Appendix E)
- general_response: Catch-all for other interactions

IMPORTANT:
- Extract ALL required parameters for each tool
- Be precise with parameter values (don't make up information)
- If user's message is ambiguous, select the most likely intent
- You can execute multiple tools if needed
- Keep context_for_call_2 concise but informative

CRITICAL - NEVER FABRICATE TOOL PARAMETERS:

1. FOR INTRO FLOW TOOLS (offer_introduction, accept_intro_opportunity, etc.):
   - accept_intro_opportunity: ONLY use if intro_opportunity_id exists in User priorities
   - decline_intro_opportunity: ONLY use if intro_opportunity_id exists in User priorities
   - accept_intro_offer: ONLY use if intro_offer_id exists in context
   - decline_intro_offer: ONLY use if intro_offer_id exists in context
   - accept_connection_request: ONLY use if connection_request_id exists in context
   - decline_connection_request: ONLY use if connection_request_id exists in context
   - offer_introduction: ONLY use if user explicitly offers to make intro + you have introducee_user_id
   - request_connection: ONLY use if Innovator explicitly wants to request intro + you have introducee_user_id
   - DO NOT invent person names, companies, or job titles
   - If user asks "do you know anyone at [Company]?" but NO matching ID exists → use publish_community_request
   - CORRECT: User says "yes to that intro" + intro_opportunity_id exists in priorities → use accept_intro_opportunity
   - WRONG: User says "I want to meet {name} at {company}" + NO ID exists in priorities → DO NOT use any intro tool, use publish_community_request

2. FOR ALL TOOLS:
   - ONLY use data from the CONTEXT section above
   - DO NOT make up budget numbers, timelines, or requirements not mentioned by user
   - DO NOT invent details to fill in parameters
   - If user's request is ambiguous or you don't have the data, include clarifying questions in context_for_call_2

3. PARAMETER VALIDATION:
   - All intro flow tool IDs: MUST exist in provided context (priorities, pending items, etc.)
   - introducee_user_id: MUST be a valid user ID from context (don't invent)
   - budget_range: ONLY include if user explicitly mentioned budget
   - timeline: ONLY include if user explicitly mentioned timeline
   - If parameter is unclear, leave it null or use publish_community_request to gather more info
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

  try {
    const decision: Call1Output = JSON.parse(jsonText);
    return decision;
  } catch (error) {
    console.error('[Innovator Call 1] Failed to parse JSON:', error);
    console.error('[Innovator Call 1] Raw response:', jsonText);

    // Fallback to safe default that won't crash
    return {
      tools_to_execute: [],
      next_scenario: 'general_response',
      context_for_call_2: {
        primary_topic: 'processing your request',
        tone: 'helpful',
        personalization_hooks: {
          user_name: context.user.first_name || undefined,
          recent_context: 'Having trouble understanding that right now'
        }
      }
    };
  }
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

  try {
    const decision: ReengagementDecisionOutput = JSON.parse(jsonText);
    return decision;
  } catch (error) {
    console.error('[Innovator Re-engagement Call 1] Failed to parse JSON:', error);
    console.error('[Innovator Re-engagement Call 1] Raw response:', jsonText);

    // Fallback: Don't message, extend task by 7 days
    return {
      should_message: false,
      reasoning: 'Error parsing re-engagement decision - extending task',
      extend_days: 7,
      tools_to_execute: [],
      next_scenario: 'no_message',
      context_for_call_2: {
        primary_topic: 're-engagement decision error',
        tone: 'helpful'
      }
    };
  }
}
