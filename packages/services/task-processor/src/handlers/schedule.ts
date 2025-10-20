/**
 * Schedule Followup Task Handler
 *
 * Handles schedule_followup tasks by creating messages
 * or triggering agent re-engagement.
 */

import { createServiceClient } from '@yachtparty/shared';
import type { Task, TaskResult, FollowupContext } from '../types';

/**
 * Handle schedule_followup task
 *
 * Creates a message or task to re-engage with the user
 * based on the scheduled followup reason.
 */
export async function handleScheduleFollowup(task: Task): Promise<TaskResult> {
  const context = task.context_json as FollowupContext;
  const supabase = createServiceClient();

  console.log(`[${task.id}] Processing schedule_followup task for user ${task.user_id}`);

  try {
    // Validate context
    if (!context.reason) {
      return {
        success: false,
        error: 'Missing followup reason in context',
        shouldRetry: false,
      };
    }

    // Get user and conversation
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', task.user_id)
      .single();

    if (userError || !user) {
      return {
        success: false,
        error: `Failed to get user: ${userError?.message}`,
        shouldRetry: true,
      };
    }

    // Get active conversation
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('*')
      .eq('user_id', task.user_id)
      .eq('status', 'active')
      .single();

    if (convError || !conversation) {
      console.log(`[${task.id}] No active conversation found, skipping followup`);
      return {
        success: true,
        data: { skipped: true, reason: 'No active conversation' },
      };
    }

    // Create a followup message
    const followupMessage = `Hey ${user.first_name || 'there'}, following up on: ${context.reason}`;

    const { error: messageError } = await supabase.from('messages').insert({
      conversation_id: conversation.id,
      user_id: user.id,
      role: user.poc_agent_type || 'concierge',
      content: followupMessage,
      direction: 'outbound',
      status: 'pending',
    });

    if (messageError) {
      return {
        success: false,
        error: `Failed to create followup message: ${messageError.message}`,
        shouldRetry: true,
      };
    }

    console.log(`[${task.id}] Created followup message for user ${user.phone_number}`);

    // Log action
    await supabase.from('agent_actions_log').insert({
      agent_type: 'task_processor',
      action_type: 'schedule_followup',
      user_id: task.user_id,
      context_id: task.id,
      context_type: 'agent_task',
      input_data: context,
      output_data: { conversationId: conversation.id },
    });

    return {
      success: true,
      data: {
        conversationId: conversation.id,
        reason: context.reason,
      },
    };
  } catch (error) {
    console.error(`[${task.id}] Error handling schedule_followup:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      shouldRetry: true,
    };
  }
}
