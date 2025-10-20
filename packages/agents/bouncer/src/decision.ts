/**
 * Decision Logic for Bouncer Agent - Call 1
 *
 * Pure business logic for onboarding decisions.
 * NO personality, NO tone - just structured decision-making.
 */

import type { OnboardingProgress } from './onboarding-steps';
import type { User } from '@yachtparty/shared';

/**
 * System prompt for Call 1: Decision-making
 * Focused on business logic only
 */
export function buildDecisionPrompt(
  user: User,
  progress: OnboardingProgress
): string {
  return `You analyze onboarding conversations and make structured decisions about actions to take.

## Current User State
- First Name: ${user.first_name || 'NOT PROVIDED'}
- Last Name: ${user.last_name || 'NOT PROVIDED'}
- Email: ${user.email || 'NOT PROVIDED'}
- Email Verified: ${user.email_verified ? 'YES' : 'NO'}
- Company: ${user.company || 'NOT PROVIDED'}
- Title: ${user.title || 'NOT PROVIDED'}
- Referrer: ${user.referred_by ? 'LINKED' : 'NOT PROVIDED'}

## Onboarding Requirements (in order)
1. Referrer name (who told them about Yachtparty)
2. First name and last name
3. Company and job title
4. Email verification (user sends email to verify-{userId}@verify.yachtparty.xyz)
5. (Optional) LinkedIn connection
6. (Optional) Nomination

## Current Progress
- Current Step: ${progress.currentStep}
- Missing Fields: ${progress.missingFields.join(', ') || 'none'}
- Is Complete: ${progress.isComplete ? 'YES' : 'NO'}

## Available Actions
1. **collect_user_info** - Store user information fields
   - Can store multiple fields at once if user provides them
   - Fields: first_name, last_name, email, company, title, linkedin_url, expertise, referrer_name, nomination

2. **send_verification_email** - Mark that email verification was requested
   - Only use after user has provided email
   - This doesn't send email - just marks that we asked them to send one

3. **complete_onboarding** - Mark user as verified and complete
   - Only when all required fields are filled AND email is verified

## Decision Rules
- Extract ALL information the user provides (they may give multiple fields at once)
- Don't ask for fields that are already filled
- Follow the onboarding order
- If user just provided information, acknowledge and ask for next missing piece
- If onboarding is complete, acknowledge completion

## Your Task
Analyze the user's message and decide:
1. What tools to execute (extract info, mark email verification requested, etc.)
2. What scenario to handle next (what should the personality layer say?)
3. Brief context about what happened

Use the make_decision tool to output your structured decision.`;
}

/**
 * System prompt for re-engagement decision (Call 1) with social judgment guidance.
 */
export function buildReengagementDecisionPrompt(
  user: User,
  progress: OnboardingProgress,
  reengagementContext: any
): string {
  const daysSinceLastInteraction = reengagementContext.lastInteractionAt
    ? Math.floor((Date.now() - new Date(reengagementContext.lastInteractionAt).getTime()) / (1000 * 60 * 60 * 24))
    : 1;

  return `You are analyzing a re-engagement scenario to decide whether and how to reach out. This requires NUANCED SOCIAL JUDGMENT.

## Current User State
- First Name: ${user.first_name || 'NOT PROVIDED'}
- Last Name: ${user.last_name || 'NOT PROVIDED'}
- Email: ${user.email || 'NOT PROVIDED'}
- Email Verified: ${user.email_verified ? 'YES' : 'NO'}
- Company: ${user.company || 'NOT PROVIDED'}
- Title: ${user.title || 'NOT PROVIDED'}
- Referrer: ${user.referred_by ? 'LINKED' : 'NOT PROVIDED'}

## Onboarding Progress
- Current Step: ${progress.currentStep}
- Missing Fields: ${progress.missingFields.join(', ') || 'none'}
- Is Complete: ${progress.isComplete ? 'YES' : 'NO'}

## Re-engagement Context
- Attempt Count: ${reengagementContext.attemptCount}
- Days Since Last Interaction: ${daysSinceLastInteraction}
- Last Activity: ${reengagementContext.lastInteractionAt}

## CRITICAL: Read Conversation Tone & Cadence

Before deciding whether to message, analyze the conversation history for:

1. **User's Emotional Tone:**
   - Do they seem engaged and interested? Or distracted/rushed?
   - Are they responding thoughtfully or giving short answers?
   - Did their last message sound frustrated, excited, or neutral?

2. **Conversation Momentum:**
   - Are they responding quickly (minutes) or slowly (hours)?
   - Did they initiate the last exchange or were they responding?
   - Is there a pattern of delays in their responses?

3. **User Needs Time to Act:**
   - Did they say they need to do something? (e.g., "let me check my email")
   - Are they waiting on email verification or another async action?
   - Did they indicate they're busy or in the middle of something?

4. **Social Appropriateness:**
   - Would reaching out now feel pushy or helpful?
   - Have we already sent multiple reminders without response?
   - Is this a good time based on conversation context?

## Decision Guidelines

**SEND MESSAGE (next_scenario = ask_for_* or general_response) when:**
- User seemed engaged but conversation dropped off naturally
- Enough time has passed that a gentle nudge is appropriate
- They didn't indicate they need time to complete a task
- We haven't sent multiple unanswered follow-ups

**DON'T SEND MESSAGE (next_scenario = no_message) when:**
- User's last message indicated they're working on something
- We just messaged them recently
- They seem disengaged or frustrated
- They've ignored multiple follow-ups already
- Their responses suggest they need space

## Available Actions
1. collect_user_info - Store user information fields (if any in history)
2. send_verification_email - Mark that email verification was requested
3. complete_onboarding - Mark user as verified and complete

## Your Task

Analyze the conversation history with social awareness and decide:
1. What tools to execute (if any)
2. Whether to send a message (next_scenario)
3. Context explaining your social judgment

Use the make_decision tool. For next_scenario, use:
- 'no_message' if you decide NOT to reach out
- 'ask_for_*' or 'general_response' if you decide to send a message`;
}

/**
 * Decision tool for Call 1 output
 */
export const DECISION_TOOL = {
  name: 'make_decision',
  description: 'Output your decision about what actions to take and what scenario to handle next',
  input_schema: {
    type: 'object' as const,
    properties: {
      tools_to_use: {
        type: 'array' as const,
        description: 'List of tools to execute (collect_user_info, send_verification_email, complete_onboarding)',
        items: {
          type: 'object' as const,
          properties: {
            tool_name: { type: 'string' as const, description: 'Name of the tool' },
            tool_input: { type: 'object' as const, description: 'Input parameters for the tool' }
          },
          required: ['tool_name', 'tool_input'] as const
        }
      },
      next_scenario: {
        type: 'string' as const,
        description: 'What scenario should the personality layer handle?',
        enum: [
          'ask_for_referrer',
          'ask_for_name',
          'ask_for_last_name',
          'ask_for_company_and_title',
          'request_email_verification',
          'email_verification_received',
          'acknowledge_completion',
          'general_response',
          'no_message'
        ] as const
      },
      context_for_response: {
        type: 'string' as const,
        description: 'Brief context about what just happened (e.g., "User provided first name: Ben")'
      }
    },
    required: ['tools_to_use', 'next_scenario', 'context_for_response'] as const
  }
} as const;
