/**
 * Community Request Task Handlers
 *
 * Handles all community request-related tasks:
 * - community_request_available: Account Manager adds request to priorities
 * - process_community_response: Solution Saga evaluates expert responses
 * - community_response_available: Account Manager notifies requester
 * - notify_expert_of_impact: Account Manager sends close-the-loop to expert
 */

import { createServiceClient } from '@yachtparty/shared';
import Anthropic from '@anthropic-ai/sdk';
import type { Task, TaskResult } from '../types';

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Handle community_request_available task
 *
 * Account Manager adds community request to user's priorities.
 * Calculates priority score based on expertise match and user response history.
 */
export async function handleCommunityRequestAvailable(task: Task): Promise<TaskResult> {
  const supabase = createServiceClient();
  const { requestId, question, category, expertiseNeeded } = task.context_json as any;

  console.log(`[${task.id}] Processing community_request_available for user ${task.user_id}`);

  try {
    // 1. Fetch community request details
    const { data: request, error: requestError } = await supabase
      .from('community_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (requestError || !request) {
      return {
        success: false,
        error: `Failed to fetch community request: ${requestError?.message}`,
        shouldRetry: true,
      };
    }

    // 2. Fetch user details
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('expertise, response_pattern')
      .eq('id', task.user_id)
      .single();

    if (userError || !user) {
      return {
        success: false,
        error: `Failed to fetch user: ${userError?.message}`,
        shouldRetry: true,
      };
    }

    // 3. Calculate priority score using heuristic
    let priorityScore = 50; // Base score

    // Boost if user's expertise matches request
    const userExpertise = (user.expertise || []) as string[];
    const matchingExpertise = expertiseNeeded?.filter((e: string) =>
      userExpertise.some(ue => ue.toLowerCase() === e.toLowerCase())
    ) || [];

    priorityScore += matchingExpertise.length * 15; // +15 per matching expertise area

    // Check user's response history (how responsive are they to community requests?)
    const { data: responseHistory } = await supabase
      .from('community_responses')
      .select('id, usefulness_score, credits_awarded')
      .eq('user_id', task.user_id)
      .order('created_at', { ascending: false })
      .limit(5);

    if (responseHistory && responseHistory.length > 0) {
      // User has responded before - slight boost
      priorityScore += 10;

      // If they've provided valuable responses (usefulness_score >= 7), bigger boost
      const valuableResponses = responseHistory.filter((r: any) => r.usefulness_score >= 7);
      priorityScore += valuableResponses.length * 5;
    }

    // Cap score at 100
    priorityScore = Math.min(priorityScore, 100);

    // 4. Determine priority rank (higher scores = lower rank number = higher priority)
    let priorityRank = 5; // Default: medium priority
    if (priorityScore >= 80) priorityRank = 1;
    else if (priorityScore >= 65) priorityRank = 2;
    else if (priorityScore >= 50) priorityRank = 3;
    else priorityRank = 4;

    // 5. Insert into user_priorities
    const { error: priorityError } = await supabase
      .from('user_priorities')
      .insert({
        user_id: task.user_id,
        priority_rank: priorityRank,
        item_type: 'community_request',
        item_id: requestId,
        value_score: priorityScore,
        status: 'active',
      });

    if (priorityError) {
      // Check if it's a duplicate (unique constraint violation)
      if (priorityError.code === '23505') {
        console.log(`[${task.id}] Priority already exists for this request, skipping`);
        return {
          success: true,
          data: { skipped: true, reason: 'Priority already exists' },
        };
      }

      return {
        success: false,
        error: `Failed to create priority: ${priorityError.message}`,
        shouldRetry: true,
      };
    }

    console.log(`[${task.id}] ✓ Added community request to priorities (rank: ${priorityRank}, score: ${priorityScore})`);

    return {
      success: true,
      data: {
        requestId,
        priorityRank,
        valueScore: priorityScore,
        matchingExpertise: matchingExpertise.length,
      },
    };

  } catch (error) {
    console.error(`[${task.id}] Error handling community_request_available:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      shouldRetry: true,
    };
  }
}

/**
 * Handle process_community_response task
 *
 * Solution Saga evaluates an expert's response for usefulness,
 * awards credits if valuable, and incorporates into workflow.
 */
export async function handleProcessCommunityResponse(task: Task): Promise<TaskResult> {
  const supabase = createServiceClient();
  const { responseId, requestId } = task.context_json as any;

  console.log(`[${task.id}] Processing community response ${responseId}`);

  try {
    // 1. Fetch solution workflow
    const { data: workflow, error: workflowError } = await supabase
      .from('solution_workflows')
      .select('*')
      .eq('id', task.context_id)
      .single();

    if (workflowError || !workflow) {
      return {
        success: false,
        error: `Failed to fetch solution workflow: ${workflowError?.message}`,
        shouldRetry: true,
      };
    }

    // 2. Fetch community response
    const { data: response, error: responseError } = await supabase
      .from('community_responses')
      .select('*')
      .eq('id', responseId)
      .single();

    if (responseError || !response) {
      return {
        success: false,
        error: `Failed to fetch community response: ${responseError?.message}`,
        shouldRetry: true,
      };
    }

    // 3. Fetch community request for context
    const { data: request, error: requestError } = await supabase
      .from('community_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (requestError || !request) {
      return {
        success: false,
        error: `Failed to fetch community request: ${requestError?.message}`,
        shouldRetry: true,
      };
    }

    // 4. Use LLM to evaluate usefulness
    const evaluationPrompt = `Evaluate the usefulness of this expert response for a solution research workflow.

**Original Request:** ${workflow.request_description}

**Question Asked to Expert:** ${request.question}

**Expert's Response:** ${response.verbatim_answer}

Rate the usefulness of this response on a scale of 1-10, where:
- 1-3: Not useful (generic, off-topic, or unhelpful)
- 4-6: Somewhat useful (provides context but not actionable)
- 7-8: Useful (provides actionable insights that influence the research)
- 9-10: Highly useful (provides critical insights that directly solve the problem or point to a solution)

Return JSON:
{
  "usefulness_score": <number 1-10>,
  "reasoning": "<brief explanation>",
  "impact_description": "<how this response helped (if useful)>"
}`;

    const llmResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{ role: 'user', content: evaluationPrompt }],
    });

    const resultText = llmResponse.content[0].type === 'text' ? llmResponse.content[0].text : '{}';

    // Parse LLM evaluation
    let evaluation: any;
    try {
      let cleanText = resultText.trim();
      if (cleanText.startsWith('```json')) {
        cleanText = cleanText.replace(/^```json\s*\n?/, '').replace(/\n?```\s*$/, '');
      } else if (cleanText.startsWith('```')) {
        cleanText = cleanText.replace(/^```\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      evaluation = JSON.parse(cleanText);
    } catch (error) {
      console.error(`[${task.id}] Failed to parse LLM evaluation:`, error);
      // Fallback to medium score
      evaluation = {
        usefulness_score: 5,
        reasoning: 'Failed to parse LLM response',
        impact_description: 'Evaluation error',
      };
    }

    const usefulnessScore = Math.max(1, Math.min(10, evaluation.usefulness_score || 5));

    // 5. Update response with evaluation
    await supabase
      .from('community_responses')
      .update({
        usefulness_score: usefulnessScore,
        impact_description: evaluation.impact_description || evaluation.reasoning,
      })
      .eq('id', responseId);

    // 6. Award credits if response is useful (score >= 7)
    if (usefulnessScore >= 7) {
      const baseCredits = 15;
      const bonusCredits = Math.floor((usefulnessScore - 7) * 10); // 0-30 bonus
      const totalCredits = baseCredits + bonusCredits;

      // Create credit event (idempotent)
      const { error: creditError } = await supabase
        .from('credit_events')
        .insert({
          user_id: response.user_id,
          event_type: 'community_response',
          amount: totalCredits,
          reference_type: 'community_response',
          reference_id: responseId,
          idempotency_key: `community_response_${responseId}`,
          description: `Expert insight (usefulness: ${usefulnessScore}/10)`,
          created_by: 'task_processor',
          processed: true,
        });

      if (creditError && creditError.code !== '23505') { // Ignore duplicate key errors
        console.error(`[${task.id}] Failed to award credits:`, creditError);
      } else if (!creditError) {
        console.log(`[${task.id}] ✓ Awarded ${totalCredits} credits to expert ${response.user_id}`);

        // Update response with credit info
        await supabase
          .from('community_responses')
          .update({
            credits_awarded: totalCredits,
            credited_at: new Date().toISOString(),
            status: 'rewarded',
          })
          .eq('id', responseId);

        // Create task to notify expert of impact (24h delay for close-the-loop)
        const notifyDate = new Date();
        notifyDate.setHours(notifyDate.getHours() + 24);

        await supabase.from('agent_tasks').insert({
          task_type: 'notify_expert_of_impact',
          agent_type: 'account_manager',
          user_id: response.user_id,
          context_id: responseId,
          context_type: 'community_response',
          scheduled_for: notifyDate.toISOString(),
          priority: 'low',
          context_json: {
            responseId,
            requestId,
            impactDescription: evaluation.impact_description || 'Your insight helped with solution research',
            creditsAwarded: totalCredits,
            usefulnessScore,
          },
          created_by: 'task_processor',
        });
      }
    }

    // 7. Incorporate insight into workflow
    const currentInsights = (workflow.community_insights as any) || [];
    currentInsights.push({
      responseId,
      expertId: response.user_id,
      summary: response.response_text,
      usefulnessScore,
      evaluatedAt: new Date().toISOString(),
    });

    await supabase
      .from('solution_workflows')
      .update({
        community_insights: currentInsights,
        updated_at: new Date().toISOString(),
      })
      .eq('id', workflow.id);

    console.log(`[${task.id}] ✓ Processed community response (usefulness: ${usefulnessScore}/10)`);

    return {
      success: true,
      data: {
        responseId,
        usefulnessScore,
        creditsAwarded: usefulnessScore >= 7,
        impactDescription: evaluation.impact_description,
      },
    };

  } catch (error) {
    console.error(`[${task.id}] Error processing community response:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      shouldRetry: true,
    };
  }
}

/**
 * Handle community_response_available task
 *
 * Account Manager adds expert response to requester's priorities
 * so Concierge can deliver the insight.
 */
export async function handleCommunityResponseAvailable(task: Task): Promise<TaskResult> {
  const supabase = createServiceClient();
  const { responseId, requestId } = task.context_json as any;

  console.log(`[${task.id}] Processing community_response_available for user ${task.user_id}`);

  try {
    // 1. Fetch response details
    const { data: response, error: responseError } = await supabase
      .from('community_responses')
      .select('*')
      .eq('id', responseId)
      .single();

    if (responseError || !response) {
      return {
        success: false,
        error: `Failed to fetch response: ${responseError?.message}`,
        shouldRetry: true,
      };
    }

    // 2. Add to user priorities (high priority - user asked a question and got an answer)
    const { error: priorityError } = await supabase
      .from('user_priorities')
      .insert({
        user_id: task.user_id,
        priority_rank: 1, // High priority
        item_type: 'community_response',
        item_id: responseId,
        value_score: 90, // High value - user specifically asked this question
        status: 'active',
      });

    if (priorityError) {
      if (priorityError.code === '23505') {
        console.log(`[${task.id}] Priority already exists, skipping`);
        return {
          success: true,
          data: { skipped: true, reason: 'Priority already exists' },
        };
      }

      return {
        success: false,
        error: `Failed to create priority: ${priorityError.message}`,
        shouldRetry: true,
      };
    }

    console.log(`[${task.id}] ✓ Added community response to requester's priorities`);

    return {
      success: true,
      data: {
        responseId,
        priorityRank: 1,
        valueScore: 90,
      },
    };

  } catch (error) {
    console.error(`[${task.id}] Error handling community_response_available:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      shouldRetry: true,
    };
  }
}

/**
 * Handle notify_expert_of_impact task
 *
 * Account Manager creates priority for Concierge to send
 * close-the-loop message to expert about their response's impact.
 */
export async function handleNotifyExpertOfImpact(task: Task): Promise<TaskResult> {
  const supabase = createServiceClient();
  const { responseId, impactDescription, creditsAwarded, usefulnessScore } = task.context_json as any;

  console.log(`[${task.id}] Creating impact notification priority for user ${task.user_id}`);

  try {
    // Create a special priority for "impact notification"
    // Concierge will render this as a positive feedback message
    const { error: priorityError } = await supabase
      .from('user_priorities')
      .insert({
        user_id: task.user_id,
        priority_rank: 3, // Medium priority (positive feedback, not urgent)
        item_type: 'expert_impact_notification',
        item_id: responseId,
        value_score: 70,
        status: 'active',
      });

    if (priorityError) {
      if (priorityError.code === '23505') {
        console.log(`[${task.id}] Impact notification already exists, skipping`);
        return {
          success: true,
          data: { skipped: true, reason: 'Notification already exists' },
        };
      }

      return {
        success: false,
        error: `Failed to create priority: ${priorityError.message}`,
        shouldRetry: true,
      };
    }

    // Update response status to track close-the-loop
    await supabase
      .from('community_responses')
      .update({
        status: 'closed_loop',
        closed_loop_at: new Date().toISOString(),
        closed_loop_message: impactDescription,
      })
      .eq('id', responseId);

    console.log(`[${task.id}] ✓ Created impact notification priority for expert`);

    return {
      success: true,
      data: {
        responseId,
        impactDescription,
        creditsAwarded,
        usefulnessScore,
      },
    };

  } catch (error) {
    console.error(`[${task.id}] Error handling notify_expert_of_impact:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      shouldRetry: true,
    };
  }
}
