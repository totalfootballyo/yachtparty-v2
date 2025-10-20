/**
 * Account Manager Agent - Prompts
 *
 * System prompts and prompt builders for Account Manager.
 * Personality: Professional archivist, quiet observer, context provider
 *
 * @module account-manager/prompts
 */

import type { User, Message } from '@yachtparty/shared';
import type { FormattedPriorities } from './types';

/**
 * System prompt for Account Manager agent
 *
 * Defines the agent's personality and core behaviors:
 * - Professional archivist
 * - Quiet observer (doesn't interrupt)
 * - Context provider (surfaces relevant history)
 * - Gentle prompts (calm and steady tone)
 */
export const ACCOUNT_MANAGER_SYSTEM_PROMPT = `You are the Account Manager for Yachtparty, a professional networking platform.

YOUR ROLE:
You quietly maintain an accurate understanding of what matters to each user professionally.
You are the archivist of their professional priorities, learning through conversation rather than interrogation.

YOU TRACK THREE TYPES OF PRIORITIES:

1. GOALS - What they're trying to achieve
   Examples:
   - "Launch new product by Q2"
   - "Hire senior engineer"
   - "Close Series A funding"
   - "Break into enterprise market"

2. CHALLENGES - What's blocking them
   Examples:
   - "Can't find qualified candidates"
   - "Payment processor keeps declining"
   - "Need better sales process"
   - "Struggling with customer retention"

3. OPPORTUNITIES - What they're exploring
   Examples:
   - "Evaluating CRM systems"
   - "Looking for marketing agency"
   - "Considering partnership with X"
   - "Exploring new distribution channels"

YOUR PERSONALITY:
- Professional archivist: "I keep track of what matters to you"
- Quiet observer: You don't interrupt, you learn through conversation
- Context provider: You surface relevant history at the right time
- Gentle prompts: "Last month you mentioned X. Still working on that?"
- NO exclamation points, calm and steady tone

HOW YOU LEARN:
You extract priorities when users naturally mention their work, projects, or professional interests.
You update their profile silently, without making it feel like data collection.

BEHAVIORAL GUIDELINES:
- Extract information from natural conversation, not interrogation
- Be subtle - users shouldn't feel like they're being processed
- Track changes over time (goals achieved, challenges resolved)
- Archive stale priorities that are no longer relevant
- Surface relevant context when appropriate

OUTPUT FORMAT:
Always return valid JSON with your decisions.
No markdown code fences, no explanatory text outside JSON.`;

/**
 * Builds prompt for extracting priorities from conversation
 */
export function buildPriorityExtractionPrompt(params: {
  user: User;
  priorities: FormattedPriorities;
  recentMessages: Message[];
  trigger: string;
}): string {
  const { user, priorities, recentMessages, trigger } = params;

  // Format conversation history
  const conversationHistory = recentMessages
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  // Format existing priorities
  const formattedGoals = priorities.goals
    .map((g, i) => `${i + 1}. ${g.content} (added ${formatDate(g.created_at)})`)
    .join('\n   ') || '   None tracked yet';

  const formattedChallenges = priorities.challenges
    .map((c, i) => `${i + 1}. ${c.content} (added ${formatDate(c.created_at)})`)
    .join('\n   ') || '   None tracked yet';

  const formattedOpportunities = priorities.opportunities
    .map((o, i) => `${i + 1}. ${o.content} (added ${formatDate(o.created_at)})`)
    .join('\n   ') || '   None tracked yet';

  return `CURRENT USER: ${user.first_name} ${user.last_name}
Company: ${user.company || 'Unknown'}
Title: ${user.title || 'Unknown'}

CURRENT PRIORITIES:

Goals:
   ${formattedGoals}

Challenges:
   ${formattedChallenges}

Opportunities:
   ${formattedOpportunities}

RECENT CONVERSATION CONTEXT:
${conversationHistory}

TRIGGER: ${trigger}

YOUR TASK:
Based on this conversation, determine if you should update this user's priorities.

Look for:
- NEW priorities mentioned (goals, challenges, or opportunities)
- UPDATES to existing priorities (status changed, more context added)
- COMPLETED/RESOLVED priorities (should be archived)
- NO CHANGE (nothing priority-related discussed)

Return JSON with your decision:

{
  "action": "ADD" | "UPDATE" | "ARCHIVE" | "SCHEDULE_CHECK_IN" | "NO_ACTION",
  "priority_type": "goal" | "challenge" | "opportunity",
  "content": "extracted priority text",
  "priority_id": "uuid-if-updating-existing",
  "reason": "brief explanation of your decision",
  "confidence": 85
}

Examples:

User mentions "trying to hire a senior engineer":
{
  "action": "ADD",
  "priority_type": "goal",
  "content": "Hire senior engineer",
  "reason": "User explicitly stated hiring goal",
  "confidence": 90
}

User says "finally closed that funding round":
{
  "action": "ARCHIVE",
  "priority_id": "existing-goal-id",
  "reason": "Goal achieved - funding round closed",
  "confidence": 95
}

User casually mentions the weather:
{
  "action": "NO_ACTION",
  "reason": "No priority-related information in this message",
  "confidence": 100
}

Now analyze this conversation and return your decision:`;
}

/**
 * Builds prompt for scheduled priority check-in
 */
export function buildCheckInPrompt(params: {
  user: User;
  priorities: FormattedPriorities;
  daysSinceLastUpdate: number;
}): string {
  const { user, priorities, daysSinceLastUpdate } = params;

  const hasGoals = priorities.goals.length > 0;
  const hasChallenges = priorities.challenges.length > 0;
  const hasOpportunities = priorities.opportunities.length > 0;

  if (!hasGoals && !hasChallenges && !hasOpportunities) {
    return `USER: ${user.first_name} ${user.last_name}
NO PRIORITIES TRACKED

This is a scheduled check-in (${daysSinceLastUpdate} days since last update).
Since we have no priorities tracked, there's nothing to review.

Return:
{
  "action": "NO_ACTION",
  "reason": "No priorities to review",
  "confidence": 100
}`;
  }

  // Format existing priorities
  const goalsList = priorities.goals
    .map((g, i) => `${i + 1}. ${g.content} (${formatAge(g.created_at)})`)
    .join('\n   ');

  const challengesList = priorities.challenges
    .map((c, i) => `${i + 1}. ${c.content} (${formatAge(c.created_at)})`)
    .join('\n   ');

  const opportunitiesList = priorities.opportunities
    .map((o, i) => `${i + 1}. ${o.content} (${formatAge(o.created_at)})`)
    .join('\n   ');

  return `USER: ${user.first_name} ${user.last_name}
SCHEDULED CHECK-IN (${daysSinceLastUpdate} days since last update)

CURRENT PRIORITIES:

Goals:
   ${goalsList || 'None'}

Challenges:
   ${challengesList || 'None'}

Opportunities:
   ${opportunitiesList || 'None'}

YOUR TASK:
Review these priorities and determine if any should be:
- Archived (likely stale if >30 days old with no updates)
- Kept active (still relevant)
- Prompt user for update (via scheduled check-in)

If priorities are getting stale (>14 days), schedule a check-in.

Return your decision:
{
  "action": "ARCHIVE" | "SCHEDULE_CHECK_IN" | "NO_ACTION",
  "priority_id": "uuid-if-archiving",
  "reason": "brief explanation",
  "days_from_now": 14
}`;
}

/**
 * Builds prompt for providing context to other agents
 */
export function buildContextPrompt(params: {
  user: User;
  priorities: FormattedPriorities;
  requestingAgent: string;
  query?: string;
}): string {
  const { user, priorities, requestingAgent, query } = params;

  const allPriorities = [
    ...priorities.goals.map((g) => ({ type: 'goal', ...g })),
    ...priorities.challenges.map((c) => ({ type: 'challenge', ...c })),
    ...priorities.opportunities.map((o) => ({ type: 'opportunity', ...o })),
  ];

  const prioritiesList =
    allPriorities
      .map((p) => `- [${p.type.toUpperCase()}] ${p.content}`)
      .join('\n') || '- No priorities tracked yet';

  return `CONTEXT REQUEST from ${requestingAgent}

USER: ${user.first_name} ${user.last_name}
QUERY: ${query || 'Provide all relevant priorities'}

ALL TRACKED PRIORITIES:
${prioritiesList}

YOUR TASK:
Provide the most relevant priorities for this context request.

Return:
{
  "action": "PROVIDE_CONTEXT",
  "relevant_priorities": ["priority-id-1", "priority-id-2"],
  "reason": "why these priorities are relevant"
}`;
}

/**
 * Formats date relative to now (e.g., "2 days ago", "3 weeks ago")
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

/**
 * Formats age of priority (e.g., "2 days old", "3 weeks old")
 */
function formatAge(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'added today';
  if (diffDays === 1) return '1 day old';
  if (diffDays < 7) return `${diffDays} days old`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks old`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months old`;
  return `${Math.floor(diffDays / 365)} years old`;
}
