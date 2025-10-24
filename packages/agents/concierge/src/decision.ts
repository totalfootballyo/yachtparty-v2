/**
 * Call 1: Decision Logic for Concierge Agent
 *
 * Handles business logic, tool selection, and context analysis.
 * NO personality, NO message composition - that's Call 2's job.
 *
 * Pattern: 2-LLM Sequential Architecture
 * - This file: Decision-making ONLY (temp 0.1 for user messages)
 * - personality.ts: Message composition ONLY (temp 0.7)
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Message, User, UserPriority } from '@yachtparty/shared';

/**
 * Output structure from Call 1
 */
export interface Call1Output {
  // Tools to execute
  tools_to_execute: Array<{
    tool_name: string;
    params: Record<string, any>;
  }>;

  // Message composition strategy for Call 2
  next_scenario:
    | 'single_topic_response'
    | 'community_request_acknowledgment'
    | 'solution_research_acknowledgment'
    | 'intro_opportunity_acknowledgment'
    | 'goal_stored_acknowledgment'
    | 'priority_opportunity'
    | 'solution_update'
    | 'multi_thread_response'
    | 'community_request_followup'
    | 'priority_update'
    | 'response_with_proactive_priority' // Answer question + mention priority
    | 'general_response'
    | 'request_clarification' // User intent is ambiguous, need clarification
    | 'no_message'; // Re-engagement can decide not to message

  // Context for Call 2
  context_for_call_2: {
    primary_topic: string;
    primary_response_guidance?: string; // Dry answer from Call 1 to user's question
    tone: 'helpful' | 'informative' | 'reassuring';
    message_structure?: 'single' | 'sequence_2' | 'sequence_3'; // Re-engagement specific
    secondary_topics?: string[]; // Re-engagement specific

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
      emotional_state?: 'eager' | 'patient' | 'frustrated' | 'overwhelmed'; // Re-engagement specific
    };
    clarification_needed?: {
      ambiguous_request: string; // What the user said that's ambiguous
      possible_interpretations: Array<{
        label: string; // "Partners who can help solve a business problem"
        description: string; // Context about what this would mean
        would_trigger_tool?: string; // Which tool would be used for this interpretation
      }>;
    };
    post_clarification_context?: {
      had_recent_clarification: boolean; // Did we request clarification in past 5-10 messages?
      frustration_detected: boolean; // User showing frustration after clarification?
      should_acknowledge_confusion: boolean; // Should we acknowledge the confusion?
    };
  };
}

/**
 * Context loaded for Call 1
 */
export interface ConciergeContext {
  recentMessages: Message[];
  userPriorities?: UserPriority[];
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
  user: User;
}

/**
 * Call 1: User Message Decision
 *
 * Analyzes user message, decides which tools to use, prepares context for Call 2.
 * Temperature: 0.1 (fast, consistent decisions)
 * Focus: Tool selection and data extraction
 */
export async function callUserMessageDecision(
  anthropic: Anthropic,
  userMessage: Message,
  context: ConciergeContext
): Promise<Call1Output> {

  const systemPrompt = buildUserMessageDecisionPrompt(context);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 800,
    temperature: 0.1, // Low temp for consistent, fast decisions
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: userMessage.content
      }
    ]
  });

  // Extract text response (JSON)
  const textBlock = response.content.find(block => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Call 1');
  }

  // Parse JSON response
  const cleanedText = textBlock.text.trim().replace(/^```json\s*\n?/, '').replace(/\n?```\s*$/, '');

  try {
    const decision: Call1Output = JSON.parse(cleanedText);
    return decision;
  } catch (error) {
    console.error('[Concierge Call 1] Failed to parse JSON:', error);
    console.error('[Concierge Call 1] Raw response:', cleanedText);

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
 * Build system prompt for user message decision
 */
function buildUserMessageDecisionPrompt(context: ConciergeContext): string {
  // Format recent messages - increased to 10 for better intent matching
  const messageHistory = context.recentMessages
    .slice(-10) // Last 10 messages for user message handling
    .map(m => `[${m.role === 'user' ? 'User' : 'Concierge'}] (${new Date(m.created_at).toLocaleString()}): ${m.content}`)
    .join('\n');

  // Format priorities with denormalized fields for intent matching
  let prioritiesSection = '';
  if (context.userPriorities && context.userPriorities.length > 0) {
    const priorityList = context.userPriorities
      .slice(0, 10) // Top 10 priorities
      .map((p, idx) => {
        let details = `${idx + 1}. **${p.item_type}** (ID: ${p.item_id}, Rank: ${p.priority_rank}, Presented: ${p.presentation_count || 0}x)`;
        if (p.item_summary) details += `\n   Summary: ${p.item_summary}`;
        if (p.item_primary_name) details += `\n   Primary: ${p.item_primary_name}`;
        if (p.item_secondary_name) details += `\n   Secondary: ${p.item_secondary_name}`;
        if (p.item_context) details += `\n   Context: ${p.item_context}`;
        if (p.item_metadata) details += `\n   Metadata: ${JSON.stringify(p.item_metadata)}`;
        return details;
      })
      .join('\n\n');
    prioritiesSection = `\n\n## User's Current Priorities (from Account Manager - denormalized for fast matching)\n${priorityList}\n\nNote: These are ranked opportunities. Use the names/context to match against user's message.`;
  }

  // Format outstanding requests if available
  let outstandingSection = '';
  if (context.outstandingCommunityRequests && context.outstandingCommunityRequests.length > 0) {
    const requestList = context.outstandingCommunityRequests
      .map((r, idx) => `${idx + 1}. "${r.question}" (${Math.floor((Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24))} days ago)`)
      .join('\n');
    outstandingSection = `\n\n## User's Outstanding Community Requests\n${requestList}\n\nNote: Only mention if user asks about status or it's directly relevant.`;
  }

  // Check for pending community request response
  let pendingResponseSection = '';
  if (context.lastPresentedCommunityRequest) {
    pendingResponseSection = `\n\n## Pending Community Request Response\nYou recently presented this community request to the user:
- Request ID: ${context.lastPresentedCommunityRequest.requestId}
- Question: "${context.lastPresentedCommunityRequest.question}"
- Presented at: ${context.lastPresentedCommunityRequest.presentedAt}

If the user's current message appears to be answering or responding to this question, use the record_community_response tool.
Only use this tool if they're actually providing substantive insight/information. If they're just acknowledging or saying they don't know, don't record it.`;
  }

  return `You are Call 1 of a 2-LLM sequential architecture for the Concierge Agent.

YOUR JOB: Analyze the user's message, decide which tools to use, and prepare structured guidance for Call 2.

CRITICAL: You do NOT compose messages. You do NOT express personality. You ONLY:
1. Analyze what the user wants
2. Decide which tools to execute
3. Prepare structured guidance for Call 2 (personality layer)

## User Profile
Name: ${context.user.first_name} ${context.user.last_name || ''}
Company: ${context.user.company || 'Not specified'}
Goal: ${(context.user.response_pattern as any)?.user_goal || 'Not yet provided'}

## Recent Conversation
${messageHistory}${prioritiesSection}${outstandingSection}${pendingResponseSection}

## Available Tools

1. **publish_community_request**
   - Use when: User asks a question that needs expert input from the community
   - Required params: question, expertise_needed
   - Optional params: requester_context, desired_outcome, urgency, request_summary

2. **request_solution_research**
   - Use when: User needs help finding a vendor, product, service, or technology
   - Required params: description
   - Optional params: category, urgency

3. **offer_introduction**
   - Use when: User spontaneously offers to introduce a prospect to someone on the platform
   - Example: "I can introduce you to Sarah at Google"
   - Required params: prospect_name, introducee_user_id
   - Optional params: prospect_company, prospect_title, prospect_context, context_type, context_id
   - CRITICAL: Only use if user is OFFERING to make an intro, not REQUESTING one

4. **accept_intro_opportunity**
   - Use when: User accepts an intro opportunity from their priorities
   - Required params: intro_opportunity_id
   - Note: This is for when they agree to make an intro as a connector

5. **decline_intro_opportunity**
   - Use when: User declines an intro opportunity
   - Required params: intro_opportunity_id
   - Optional params: reason

6. **accept_intro_offer**
   - Use when: User accepts an intro offer (someone offered to introduce them)
   - Required params: intro_offer_id

7. **decline_intro_offer**
   - Use when: User declines an intro offer
   - Required params: intro_offer_id
   - Optional params: reason

8. **confirm_intro_offer**
   - Use when: User confirms they completed an intro they offered to make
   - Required params: intro_offer_id

9. **accept_connection_request**
   - Use when: User accepts a connection request (someone wants to be introduced to them)
   - Required params: connection_request_id

10. **decline_connection_request**
    - Use when: User declines a connection request
    - Required params: connection_request_id
    - Optional params: reason

11. **store_user_goal**
   - Use when: User shares what they want from the community (their objectives or needs)
   - Required params: goal

12. **record_community_response**
    - Use when: User is providing an answer to a community request you recently presented
    - Required params: request_id, response_content
    - Only use if they're providing substantive information (not just "I don't know")

## CRITICAL: Introduction Flow Disambiguation

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

**3. connection_requests (Requestor asks introducee)**
- **Situation**: Someone wants to be introduced to this user
- **User sees**: "[Name] wants an intro to you. Context: [reason]"
- **User actions**: Accept (accept_connection_request) or Decline (decline_connection_request)
- **Flow**: Requestor asks → Introducee agrees/declines → System coordinates intro

**How to Disambiguate:**

If user says "I want to meet [Person]" or "Can you connect me with [Person]?":
→ This is NOT any of the above flows
→ Use publish_community_request to find someone who can make that intro
→ DO NOT use offer_introduction (user is not offering, they're requesting)

If user says "I can introduce you to [Person]":
→ Use offer_introduction (user is OFFERING to be the connector)

If user is responding to a priority about an intro opportunity:
→ Use accept_intro_opportunity or decline_intro_opportunity

If user is responding to an intro offer (someone offered to introduce them):
→ Use accept_intro_offer or decline_intro_offer

If user is responding to a connection request (someone wants intro to them):
→ Use accept_connection_request or decline_connection_request

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

### Intent Matching Examples

**CORRECT - Specific Intent Identified:**

\`\`\`
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
\`\`\`

**CORRECT - No Specific Intent (New Topic):**

\`\`\`
Recent context:
- User had 3 open priorities: hiring CTO, intro to Sarah Chen, meet Rob from MediaMath

User (today): "Can you help me find a marketing agency?"

✅ CORRECT INTERPRETATION:
- User is NOT responding to any existing priority
- User is introducing a NEW topic (marketing agency search)
- Output: user_responding_to = null
- Consider: proactive_priority (mention one of the 3 open items if appropriate)
- Use tool: request_solution_research OR publish_community_request
\`\`\`

**INCORRECT - Marking Everything as Actioned:**

\`\`\`
[Same scenario as above - user asks about marketing agency]

❌ INCORRECT INTERPRETATION:
- User sent a message, so mark ALL 3 priorities as actioned
- This is WRONG - user didn't address any of them
- Result: System "forgets" about legitimate open priorities

Never do this. Only mark priorities as actioned when user EXPLICITLY addresses them.
\`\`\`

**AMBIGUOUS - Ask for Clarification:**

\`\`\`
You (yesterday): "I have 2 intro opportunities for you: (1) Sarah Chen at Hulu for content strategy, (2) Mike Ross at HBO for distribution partnerships"

User (today): "Yes, let's do it!"

❌ UNCLEAR which intro user wants (or if they want both)

✅ CORRECT RESPONSE:
- Output: next_scenario = "request_clarification"
- Output: clarification_needed = {
    ambiguous_request: "User said 'yes, let's do it' but didn't specify which intro",
    possible_interpretations: [
      { label: "Both intros", description: "User wants both Sarah and Mike intros" },
      { label: "Sarah only", description: "User wants Sarah Chen intro (content strategy)" },
      { label: "Mike only", description: "User wants Mike Ross intro (distribution)" }
    ]
  }
- Call 2 will ask: "Just to clarify - are you interested in both intros (Sarah at Hulu and Mike at HBO), or one specifically?"
\`\`\`

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
- ❌ The topic is completely unrelated and would feel jarring

### When in Doubt

If the user's message could apply to multiple priorities:
1. **Ask for clarification** rather than guessing
2. **Be explicit** in the clarification: List the specific options
3. **Wait for clear confirmation** before updating status or calling tools

Remember: It's better to ask one clarifying question than to incorrectly mark items as actioned or miss opportunities to serve the user.

## Decision Process

Analyze the user's message:
1. What are they asking for or saying?
2. **RECENT CLARIFICATION CHECK**: Did we request clarification in the past 5-10 messages?
   - If yes: Exercise EXTRA caution
   - Check message timestamps - could messages be out of order?
   - Review message sequence carefully
   - Verify the ambiguity is now resolved
   - Check for frustration signals (terse responses, "never mind", delays in response)
3. **AMBIGUITY CHECK**: Is their intent clear, or could it mean multiple things?
4. If ambiguous: Request clarification (DO NOT guess)
5. If clear: Which tool(s) should be used?
6. Extract parameters for each tool
7. Determine next_scenario for Call 2

## CRITICAL: Ambiguity Detection

When the user's request could have multiple valid interpretations:
- **DO NOT GUESS** which interpretation is correct
- Set next_scenario to 'request_clarification'
- **DO NOT execute any tools yet** (tools_to_execute should be empty)
- Provide structured clarification guidance for Call 2

**Common Ambiguities:**
- "Looking for partners" → Could mean: business advisors, strategic partners, sales prospects, service providers
- "Need help with X" → Could mean: expert introductions, vendor research, general advice
- "CTV" / "AI" / technical terms → Could mean different things (check conversation context for clues!)
- "Scale our business" → Could mean: hiring, funding, operations, technology

**Context Clues to Resolve Ambiguity:**
- Check conversation history for prior mentions
- Look at user's stated goal
- Review recent priorities
- If context strongly suggests one interpretation, proceed with that tool
- If context is unclear or contradictory, request clarification

## Next Scenario Options

- **community_request_acknowledgment**: User asked a question for experts
- **solution_research_acknowledgment**: User needs help finding a vendor/solution
- **intro_opportunity_acknowledgment**: User wants to meet someone
- **goal_stored_acknowledgment**: User shared their goal for the community
- **request_clarification**: User's intent is ambiguous, need clarification
- **response_with_proactive_priority**: Answer user's question + mention a priority proactively
- **general_response**: General conversation or question not requiring tools

## Output Format

Return ONLY a JSON object (no markdown, no explanation):

**Example 1: Clear intent, execute tool**
{
  "tools_to_execute": [
    {
      "tool_name": "publish_community_request",
      "params": {
        "question": "...",
        "expertise_needed": ["domain1", "domain2"],
        "requester_context": "why they're asking",
        "desired_outcome": "backchannel",
        "urgency": "medium",
        "request_summary": "3-5 word summary"
      }
    }
  ],
  "next_scenario": "community_request_acknowledgment",
  "context_for_call_2": {
    "primary_topic": "what the user asked about",
    "primary_response_guidance": "Dry answer: We'll find experts to help with...",
    "tone": "helpful",
    "user_responding_to": null,
    "personalization_hooks": {
      "user_name": "${context.user.first_name}",
      "recent_context": "brief context from conversation"
    }
  }
}

**Example 2: User responding to specific priority + proactive mention**
{
  "tools_to_execute": [
    {
      "tool_name": "accept_intro_opportunity",
      "params": {
        "intro_opportunity_id": "uuid-123"
      }
    }
  ],
  "next_scenario": "response_with_proactive_priority",
  "context_for_call_2": {
    "primary_topic": "User accepted Jim James intro",
    "primary_response_guidance": "Great! I'll coordinate the intro with Ben and Jim.",
    "tone": "helpful",
    "user_responding_to": {
      "item_type": "intro_opportunity",
      "item_id": "uuid-123",
      "confidence": "high"
    },
    "proactive_priority": {
      "item_type": "connection_request",
      "item_id": "uuid-456",
      "summary": "Rob from MediaMath wants to connect about CTV attribution",
      "transition_phrase": "While I have you",
      "should_mention": true,
      "reason": "User seems engaged, different topic, high value"
    },
    "personalization_hooks": {
      "user_name": "${context.user.first_name}"
    }
  }
}

**Example 2: Ambiguous intent, request clarification**
{
  "tools_to_execute": [],
  "next_scenario": "request_clarification",
  "context_for_call_2": {
    "primary_topic": "clarify what type of partners they need",
    "tone": "helpful",
    "clarification_needed": {
      "ambiguous_request": "Want to find the right partners for that",
      "possible_interpretations": [
        {
          "label": "Partners who can help you solve a business problem",
          "description": "You mentioned CTV scaling - this would mean finding consultants, vendors, or advisors",
          "would_trigger_tool": "publish_community_request"
        },
        {
          "label": "Strategic partners or businesses interested in partnering",
          "description": "Companies to collaborate with on your CTV offering",
          "would_trigger_tool": "request_solution_research"
        },
        {
          "label": "Something else altogether",
          "description": "Open-ended option for user to clarify",
          "would_trigger_tool": null
        }
      ]
    },
    "personalization_hooks": {
      "user_name": "${context.user.first_name}",
      "recent_context": "User mentioned scaling CTV from $100k to $1M"
    }
  }
}

If NO tools are needed (general conversation), return empty array for tools_to_execute and use next_scenario: "general_response".

CRITICAL REMINDERS:
- Extract ALL required parameters for tools
- Be specific with expertise_needed (use domain keywords, not vague terms)
- For community requests: always include requester_context (why they're asking)
- Use request_summary to create short reference (e.g., "CTV advertising guidance")
- Primary topic should be brief (5-10 words max)`;
}

/**
 * Re-engagement specific output structure
 */
export interface ReengagementDecisionOutput extends Call1Output {
  // Re-engagement specific fields
  should_message: boolean;
  reasoning?: string; // Why we should/shouldn't message
  extend_days?: number; // How many days to extend if not messaging

  // Threads to address (multi-threading)
  threads_to_address?: Array<{
    type: 'priority_opportunity' | 'community_request_update' | 'user_inquiry_update' | 'solution_update';
    item_id: string;
    priority: 'high' | 'medium' | 'low';
    message_guidance: string;
  }>;
}

/**
 * Call 1: Re-engagement Decision
 *
 * Analyzes full context to decide whether to re-engage user.
 * Temperature: 0.6 (higher for nuanced social judgment)
 * Focus: Multi-thread analysis, social awareness, priority assessment
 */
export async function callReengagementDecision(
  anthropic: Anthropic,
  user: User,
  context: ConciergeContext,
  reengagementContext: {
    daysSinceLastMessage: number;
    priorityCount: number;
    hasActiveGoals: boolean;
  }
): Promise<ReengagementDecisionOutput> {

  const systemPrompt = buildReengagementDecisionPrompt(user, context, reengagementContext);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000, // More tokens for multi-thread analysis
    temperature: 0.6, // Higher temp for social judgment
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: 'Based on the context above, should I reach out to this user? If yes, what should I say?'
      }
    ]
  });

  // Extract text response (JSON)
  const textBlock = response.content.find(block => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Call 1 re-engagement');
  }

  // Parse JSON response
  const cleanedText = textBlock.text.trim().replace(/^```json\s*\n?/, '').replace(/\n?```\s*$/, '');

  try {
    const decision: ReengagementDecisionOutput = JSON.parse(cleanedText);
    return decision;
  } catch (error) {
    console.error('[Concierge Re-engagement Call 1] Failed to parse JSON:', error);
    console.error('[Concierge Re-engagement Call 1] Raw response:', cleanedText);

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

/**
 * Build system prompt for re-engagement decision
 */
function buildReengagementDecisionPrompt(
  user: User,
  context: ConciergeContext,
  reengagementContext: {
    daysSinceLastMessage: number;
    priorityCount: number;
    hasActiveGoals: boolean;
  }
): string {
  // Format recent messages (15-20 for re-engagement)
  const messageHistory = context.recentMessages
    .map(m => `[${m.role === 'user' ? 'User' : 'Concierge'}]: ${m.content}`)
    .join('\n');

  // Format priorities
  let prioritiesSection = '';
  if (context.userPriorities && context.userPriorities.length > 0) {
    const priorityList = context.userPriorities
      .map((p, idx) => `${idx + 1}. [${p.item_type}] ID: ${p.item_id} (value: ${p.value_score || 'N/A'}) - Status: ${p.status}`)
      .join('\n');
    prioritiesSection = `\n\n## User's Current Priorities (from Account Manager)\n${priorityList}`;
  }

  // Format outstanding requests
  let outstandingSection = '';
  if (context.outstandingCommunityRequests && context.outstandingCommunityRequests.length > 0) {
    const requestList = context.outstandingCommunityRequests
      .map((r, idx) => {
        const daysAgo = Math.floor((Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24));
        return `${idx + 1}. "${r.question}" (${daysAgo} days ago, ID: ${r.id})`;
      })
      .join('\n');
    outstandingSection = `\n\n## User's Outstanding Community Requests\n${requestList}`;
  }

  return `You are Call 1 of a 2-LLM architecture for the Concierge Agent. This is a RE-ENGAGEMENT check.

YOUR JOB: Decide whether to reach out to an inactive user, and if yes, what to say.

## User Profile
Name: ${user.first_name} ${user.last_name || ''}
Company: ${user.company || 'Not specified'}
Goal: ${(user.response_pattern as any)?.user_goal || 'Not yet provided'}

## Re-Engagement Context
Days since last message: ${reengagementContext.daysSinceLastMessage}
Priority items available: ${reengagementContext.priorityCount}
Has active goals: ${reengagementContext.hasActiveGoals}

## Recent Conversation (Last ${context.recentMessages.length} messages)
${messageHistory}${prioritiesSection}${outstandingSection}

## Your Decision Process

**Step 1: Social Judgment (Read the Room)**
Review the conversation history and ask:
- Is the user engaged or overwhelmed?
- Did they express frustration with messages? (e.g., "too many messages", "give me some time")
- Are their responses brief/terse (suggesting busy/frustrated) or thoughtful/detailed (suggesting engaged)?
- Have we already sent unanswered follow-ups?
- Would reaching out feel helpful or pushy?

**Step 2: Analyze Each Thread**
For each priority/request/opportunity:
- Is it still relevant to their stated goal?
- Has enough time passed to warrant follow-up?
- What value does it offer them RIGHT NOW?
- Is this the right timing, or should we wait?

**Step 3: Decide Message Strategy**

IF should NOT message:
- Reason: User busy/overwhelmed, no high-value items, already sent unanswered follow-up, etc.
- Extend by: 7-90 days depending on reason
- Return with should_message: false

IF should message:
- Identify threads to address (max 3, prioritize by value)
- Decide message structure:
  * Single message: One primary topic, brief
  * Sequence of 2: Reassurance + opportunity OR update + opportunity
  * Sequence of 3: Reassurance + update + opportunity
- Provide guidance for Call 2 on tone and content

## Output Format

Return ONLY a JSON object (no markdown, no explanation):

{
  "should_message": true | false,

  // If should_message = false:
  "reasoning": "brief explanation why not messaging",
  "extend_days": 7 | 14 | 30 | 60 | 90,

  // If should_message = true:
  "tools_to_execute": [],  // Usually empty for re-engagement, but available if needed
  "threads_to_address": [
    {
      "type": "priority_opportunity" | "community_request_update" | "user_inquiry_update" | "solution_update",
      "item_id": "the ID from context",
      "priority": "high" | "medium" | "low",
      "message_guidance": "What to say about this thread (brief)"
    }
  ],
  "next_scenario": "multi_thread_response" | "single_topic_response" | "no_message",
  "context_for_call_2": {
    "primary_topic": "what to lead with",
    "secondary_topics": ["optional", "list"],
    "tone": "reassuring" | "informative" | "opportunistic",
    "message_structure": "single" | "sequence_2" | "sequence_3",
    "personalization_hooks": {
      "user_name": "${user.first_name}",
      "recent_context": "brief context from conversation",
      "emotional_state": "eager" | "patient" | "frustrated" | "overwhelmed"
    }
  }
}

CRITICAL REMINDERS:
- Be conservative: When in doubt, DON'T message. It's better to wait than spam.
- Social awareness: Read conversation tone carefully. Short responses = user may be busy.
- High-value only: Only reach out if you have something truly valuable to offer.
- Respect frustration: If user expressed message fatigue, extend by 60-90 days minimum.
- Natural timing: Don't reach out too frequently. Minimum 7 days between re-engagements.`;
}
