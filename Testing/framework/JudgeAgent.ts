/**
 * Judge Agent
 *
 * Evaluates conversation quality using Claude API.
 * Provides scores for tone, flow, completeness, and identifies critical errors.
 */

import Anthropic from '@anthropic-ai/sdk';

export interface JudgeScore {
  overall: number;        // 0-1 score
  tone: number;           // 0-1 score
  flow: number;           // 0-1 score
  completeness: number;   // 0-1 score
  errors: string[];       // Critical errors found
  reasoning: string;      // Judge's detailed explanation
}

export interface DatabaseContext {
  agentActionsLogged?: Array<{
    action_type: string;
    created_at: string;
    input_data?: any;
  }>;
  stateTransitions?: Array<{
    table: string;
    record_id: string;
    old_status: string;
    new_status: string;
  }>;
}

export class JudgeAgent {
  private anthropic: Anthropic;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable required for JudgeAgent');
    }

    this.anthropic = new Anthropic({ apiKey });
  }

  /**
   * Evaluates a conversation transcript against expected behavior.
   *
   * @param transcript - Full conversation transcript (user and agent messages)
   * @param expectedBehavior - Description of what the agent should have done
   * @param expectedTools - Array of tool names that should have been used
   * @param actualToolsUsed - Array of tool names that were actually used by the agent
   * @param dbContext - Optional database context for validating state changes and actions
   * @returns Judge score with detailed evaluation
   */
  async evaluateConversation(
    transcript: string,
    expectedBehavior: string,
    expectedTools: string[],
    actualToolsUsed: string[],
    dbContext?: DatabaseContext
  ): Promise<JudgeScore> {
    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      temperature: 0.2,  // Low temperature for consistent evaluation
      system: this.buildJudgePrompt(expectedBehavior, expectedTools, actualToolsUsed, dbContext),
      messages: [{
        role: 'user',
        content: `Evaluate this conversation:\n\n${transcript}`
      }],
      tools: [{
        name: 'submit_evaluation',
        description: 'Submit conversation evaluation scores',
        input_schema: {
          type: 'object',
          properties: {
            overall_score: {
              type: 'number',
              description: '0-1 overall quality score (average of tone, flow, completeness)'
            },
            tone_score: {
              type: 'number',
              description: '0-1 tone consistency score'
            },
            flow_score: {
              type: 'number',
              description: '0-1 conversation flow score'
            },
            completeness_score: {
              type: 'number',
              description: '0-1 task completion score'
            },
            critical_errors: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of critical errors (hallucinations, wrong tools, broken flow)'
            },
            reasoning: {
              type: 'string',
              description: 'Detailed explanation of scores and any issues found'
            }
          },
          required: ['overall_score', 'tone_score', 'flow_score', 'completeness_score', 'critical_errors', 'reasoning']
        }
      }]
    });

    // Find the tool use in response
    const toolUse = response.content.find(block => block.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      throw new Error('Judge did not use evaluation tool');
    }

    const evaluation = toolUse.input as any;

    return {
      overall: evaluation.overall_score,
      tone: evaluation.tone_score,
      flow: evaluation.flow_score,
      completeness: evaluation.completeness_score,
      errors: evaluation.critical_errors,
      reasoning: evaluation.reasoning
    };
  }

  /**
   * Builds the system prompt for the judge agent.
   */
  private buildJudgePrompt(
    expectedBehavior: string,
    expectedTools: string[],
    actualToolsUsed: string[],
    dbContext?: DatabaseContext
  ): string {
    let contextSection = '';

    if (dbContext) {
      contextSection = '\n\n**Database Context:**\n';

      if (dbContext.agentActionsLogged && dbContext.agentActionsLogged.length > 0) {
        contextSection += '\nAgent Actions Logged:\n';
        dbContext.agentActionsLogged.forEach(action => {
          contextSection += `- ${action.action_type} at ${action.created_at}\n`;
          if (action.input_data) {
            contextSection += `  Data: ${JSON.stringify(action.input_data)}\n`;
          }
        });
      }

      if (dbContext.stateTransitions && dbContext.stateTransitions.length > 0) {
        contextSection += '\nState Transitions:\n';
        dbContext.stateTransitions.forEach(transition => {
          contextSection += `- ${transition.table} record ${transition.record_id}: ${transition.old_status} → ${transition.new_status}\n`;
        });
      }
    }

    return `You are a conversation quality evaluator for an AI agent system.

Your job is to evaluate whether the agent:
1. Maintained appropriate tone throughout
2. Used the correct tools at the right times
3. Completed the expected task
4. Had natural conversation flow
5. Made any critical errors (hallucinations, wrong actions, broken flow)

Expected Behavior:
${expectedBehavior}

Tools the agent SHOULD have used:
${expectedTools.join(', ')}

Tools the agent ACTUALLY used:
${actualToolsUsed.length > 0 ? actualToolsUsed.join(', ') : 'NONE'}
${contextSection}

Evaluation Criteria:

**Tone (0-1):**
- Professional but not salesy
- Consistent with agent personality (Bouncer = gatekeeper, Concierge = helpful assistant)
- No overly enthusiastic or robotic responses
- Deduct 0.3 for tone breaks

**Flow (0-1):**
- Logical progression through conversation steps
- Appropriate responses to user questions
- No confusing back-and-forth
- **IMPORTANT:** Asking about community goals/what they hope to get out of Yachtparty is GOOD - do NOT penalize this
- Deduct 0.2 per flow disruption

**Completeness (0-1):**
- Agent completed the expected task
- All required information collected
- Correct tools used at correct times
- Deduct 0.5 if task incomplete

**Critical Errors:**
- Hallucinating names/companies from examples (Mike, Roku, Brian, etc.)
- Using wrong tools or skipping required tools
- Providing incorrect information
- Breaking character
- Wrong email format (not verify-{userId}@verify.yachtparty.xyz)
- Asking for information already provided
- Repeating the same question multiple times

**Re-engagement Throttling Errors (Phase 3.5):**
- Sending re-engagement message when one was sent <7 days ago
- Sending re-engagement message after 3 unanswered attempts in 90 days
- Missing agent_actions_log entry for re_engagement_message_sent when message was sent
- Missing agent_actions_log entry for re_engagement_throttled when throttled
- Missing agent_actions_log entry for re_engagement_paused when paused
- Sending ANY message when throttling should have prevented it

**Intro Flow State Transition Errors (Phase 3.4):**
- Failing to pause competing intro_opportunities when one is accepted
- Failing to cancel competing intro_opportunities when one is completed
- Mentioning intros/connections that don't exist in the database
- Incorrectly describing intro status or state

**Message History Filtering Errors (Phase 2.2):**
- Referencing or mentioning inbound system messages (direction='inbound', role='system')
- Failing to acknowledge outbound system messages (direction='outbound', role='system')
- Treating system notifications as if user sent them

**IMPORTANT - Email Collection:**
- The Bouncer agent should NOT store the user's email address when they mention it in conversation
- Email addresses are captured ONLY through the verification webhook (when user sends email)
- It is CORRECT for the agent to request email verification without storing the user's mentioned email
- Do NOT flag this as an error

**IMPORTANT - Test Environment Email Verification:**
- In the test environment, email verification webhooks are SIMULATED automatically
- When you see "Got your email, thanks" from the agent, this is the agent responding to a simulated webhook notification
- The user may not have explicitly typed "I sent the email", but the test framework simulates the webhook
- This is CORRECT expected behavior in tests - do NOT flag as hallucination
- Do NOT penalize the agent for acknowledging email receipt in test transcripts
- Example: Agent says "Got your email, thanks" → User replies "Wait, I didn't send my email yet!" → This is a test artifact, NOT an agent error

**Overall Score:**
- Average of tone, flow, and completeness scores
- If critical errors exist, cap overall score at 0.6

Provide honest, critical evaluation focused on production readiness.`;
  }
}
