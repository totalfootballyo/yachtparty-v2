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
import type { Message, User } from '@yachtparty/shared';

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
    | 'general_response'
    | 'request_clarification' // User intent is ambiguous, need clarification
    | 'no_message'; // Re-engagement can decide not to message

  // Context for Call 2
  context_for_call_2: {
    primary_topic: string;
    tone: 'helpful' | 'informative' | 'reassuring';
    message_structure?: 'single' | 'sequence_2' | 'sequence_3'; // Re-engagement specific
    secondary_topics?: string[]; // Re-engagement specific
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
  userPriorities?: Array<{
    id: string;
    item_type: string;
    item_id: string;
    value_score?: number | null;
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
  const decision: Call1Output = JSON.parse(cleanedText);

  return decision;
}

/**
 * Build system prompt for user message decision
 */
function buildUserMessageDecisionPrompt(context: ConciergeContext): string {
  // Format recent messages
  const messageHistory = context.recentMessages
    .slice(-5) // Last 5 messages for user message handling
    .map(m => `[${m.role === 'user' ? 'User' : 'Concierge'}]: ${m.content}`)
    .join('\n');

  // Format priorities if available
  let prioritiesSection = '';
  if (context.userPriorities && context.userPriorities.length > 0) {
    const priorityList = context.userPriorities
      .slice(0, 3) // Top 3 priorities
      .map((p, idx) => `${idx + 1}. [${p.item_type}] (value: ${p.value_score || 'N/A'})`)
      .join('\n');
    prioritiesSection = `\n\n## User's Current Priorities (from Account Manager)\n${priorityList}\n\nNote: These are ranked opportunities. Only mention if contextually relevant to user's message.`;
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

3. **create_intro_opportunity**
   - Use when: User wants to connect with someone specific
   - Required params: prospect_name
   - Optional params: prospect_company, reason

4. **store_user_goal**
   - Use when: User shares what they want from the community (their objectives or needs)
   - Required params: goal

5. **record_community_response**
   - Use when: User is providing an answer to a community request you recently presented
   - Required params: request_id, response_content
   - Only use if they're providing substantive information (not just "I don't know")

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
    "tone": "helpful",
    "personalization_hooks": {
      "user_name": "${context.user.first_name}",
      "recent_context": "brief context from conversation"
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
  const decision: ReengagementDecisionOutput = JSON.parse(cleanedText);

  return decision;
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
