/**
 * Update User Profile Task Handler
 *
 * Handles update_user_profile tasks by updating
 * user records in the database.
 */

import { createServiceClient } from '@yachtparty/shared';
import type { Task, TaskResult, ProfileUpdateContext } from '../types';

/**
 * Handle update_user_profile task
 *
 * Updates a specific field in the users table.
 * Validates field exists and value is appropriate type.
 */
export async function handleUpdateUserProfile(task: Task): Promise<TaskResult> {
  const context = task.context_json as ProfileUpdateContext;
  const supabase = createServiceClient();

  console.log(`[${task.id}] Processing update_user_profile task for user ${task.user_id}`);

  try {
    // Validate context
    if (!context.field || context.value === undefined) {
      return {
        success: false,
        error: 'Missing field or value in context',
        shouldRetry: false,
      };
    }

    // Whitelist of allowed fields to update
    const allowedFields = [
      'email',
      'first_name',
      'last_name',
      'company',
      'title',
      'linkedin_url',
      'verified',
      'expert_connector',
      'expertise',
      'quiet_hours_start',
      'quiet_hours_end',
      'timezone',
      'response_pattern',
    ];

    if (!allowedFields.includes(context.field)) {
      return {
        success: false,
        error: `Field '${context.field}' is not allowed to be updated`,
        shouldRetry: false,
      };
    }

    // Update user record
    const { error: updateError } = await supabase
      .from('users')
      .update({
        [context.field]: context.value,
        updated_at: new Date().toISOString(),
      })
      .eq('id', task.user_id);

    if (updateError) {
      return {
        success: false,
        error: `Failed to update user: ${updateError.message}`,
        shouldRetry: true,
      };
    }

    console.log(`[${task.id}] Updated user ${task.user_id} field '${context.field}'`);

    // Log action
    await supabase.from('agent_actions_log').insert({
      agent_type: 'task_processor',
      action_type: 'update_user_profile',
      user_id: task.user_id,
      context_id: task.id,
      context_type: 'agent_task',
      input_data: context,
      output_data: { field: context.field, success: true },
    });

    return {
      success: true,
      data: {
        field: context.field,
        value: context.value,
        source: context.source,
      },
    };
  } catch (error) {
    console.error(`[${task.id}] Error handling update_user_profile:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      shouldRetry: true,
    };
  }
}
