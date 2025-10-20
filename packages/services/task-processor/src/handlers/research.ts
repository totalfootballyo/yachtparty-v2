/**
 * Research Solution Task Handler
 *
 * Handles research_solution tasks by publishing events
 * to trigger the Solution Saga agent workflow.
 */

import { createServiceClient, publishEvent } from '@yachtparty/shared';
import type { Task, TaskResult, ResearchContext } from '../types';

/**
 * Handle research_solution task
 *
 * Publishes event to trigger solution research workflow.
 * In future, could directly invoke Perplexity API or other research services.
 */
export async function handleResearchSolution(task: Task): Promise<TaskResult> {
  const context = task.context_json as ResearchContext;
  const supabase = createServiceClient();

  console.log(`[${task.id}] Processing research_solution task for user ${task.user_id}`);

  try {
    // Validate context
    if (!context.description) {
      return {
        success: false,
        error: 'Missing research description in context',
        shouldRetry: false,
      };
    }

    // Publish event to trigger Solution Saga workflow
    const event = await publishEvent({
      event_type: 'user.inquiry.solution_needed',
      aggregate_id: task.user_id || 'unknown',
      aggregate_type: 'user',
      payload: {
        userId: task.user_id,
        conversationId: context.conversationId,
        requestDescription: context.description,
        category: context.category,
        urgency: context.urgency || 'medium',
        taskId: task.id,
      },
      metadata: {
        source: 'task_processor',
        taskType: task.task_type,
      },
      created_by: 'task_processor',
    });

    console.log(`[${task.id}] Published solution research event: ${event.id}`);

    // Log action for debugging
    await supabase.from('agent_actions_log').insert({
      agent_type: 'task_processor',
      action_type: 'research_solution',
      user_id: task.user_id,
      context_id: task.id,
      context_type: 'agent_task',
      input_data: context,
      output_data: { eventId: event.id },
    });

    return {
      success: true,
      data: {
        eventId: event.id,
        description: context.description,
      },
    };
  } catch (error) {
    console.error(`[${task.id}] Error handling research_solution:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      shouldRetry: true,
    };
  }
}
