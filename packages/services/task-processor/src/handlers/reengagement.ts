/**
 * Re-engagement Check Task Handler
 *
 * Handles re_engagement_check tasks by following up
 * with inactive users during onboarding (Bouncer) or
 * long-term engagement (Concierge with LLM decision).
 */

import { createServiceClient } from '@yachtparty/shared';
import type { Task, TaskResult, ReengagementContext } from '../types';

/**
 * Handle re_engagement_check task
 *
 * Routes to appropriate handler based on agent_type:
 * - Bouncer: Onboarding re-engagement (existing logic)
 * - Concierge: LLM-based re-engagement decision
 * - Innovator: LLM-based re-engagement decision with Innovator-specific context
 */
export async function handleReengagementCheck(task: Task): Promise<TaskResult> {
  const context = task.context_json as ReengagementContext;
  const supabase = createServiceClient();

  console.log(`[${task.id}] Processing re_engagement_check task for user ${task.user_id}`);
  console.log(`[${task.id}] Agent type: ${task.agent_type}`);

  // Route based on agent type
  if (task.agent_type === 'concierge') {
    return handleConciergeReengagement(task, context, supabase);
  } else if (task.agent_type === 'innovator') {
    return handleInnovatorReengagement(task, context, supabase);
  } else {
    return handleBouncerReengagement(task, context, supabase);
  }
}

/**
 * Handle Concierge re-engagement with LLM judgment
 */
async function handleConciergeReengagement(
  task: Task,
  context: ReengagementContext,
  supabase: any
): Promise<TaskResult> {
  console.log(`[${task.id}] Processing Concierge re-engagement check`);

  try {
    // Get user
    const { data: user, error: userError} = await supabase
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

    // Get conversation
    const { data: conversation } = await supabase
      .from('conversations')
      .select('*')
      .eq('user_id', task.user_id)
      .eq('status', 'active')
      .single();

    if (!conversation) {
      return {
        success: false,
        error: 'No active conversation found',
        shouldRetry: false,
      };
    }

    // Get recent messages to calculate days since last interaction
    const { data: recentMessages } = await supabase
      .from('messages')
      .select('created_at')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false })
      .limit(1);

    const lastMessage = recentMessages?.[0];
    const daysSinceLastMessage = lastMessage
      ? Math.floor((Date.now() - new Date(lastMessage.created_at).getTime()) / (1000 * 60 * 60 * 24))
      : 999;

    // Get user priorities
    const { data: priorities } = await supabase
      .from('user_priorities')
      .select('*')
      .eq('user_id', task.user_id)
      .eq('status', 'active')
      .order('priority_rank', { ascending: true })
      .limit(5);

    // Create system message with re-engagement context for Concierge to process with LLM judgment
    const systemMessageContent = JSON.stringify({
      type: 're_engagement_check',
      daysSinceLastMessage,
      priorityCount: priorities?.length || 0,
      hasActiveGoals: !!((user.response_pattern as any)?.user_goal),
      guidance: 'Decide whether to reach out based on priorities, user goals, and conversation history. If messaging, be brief and value-focused.'
    });

    const { error: messageError } = await supabase.from('messages').insert({
      conversation_id: conversation.id,
      user_id: user.id,
      role: 'system',
      content: systemMessageContent,
      direction: 'inbound', // System messages trigger agents, they don't get sent to users
      status: 'pending',
    });

    if (messageError) {
      return {
        success: false,
        error: `Failed to create re-engagement system message: ${messageError.message}`,
        shouldRetry: true,
      };
    }

    console.log(`[${task.id}] Created Concierge re-engagement system message for ${user.phone_number}`);

    return {
      success: true,
      data: {
        systemMessageCreated: true,
        daysSinceLastMessage,
      },
    };
  } catch (error) {
    console.error(`[${task.id}] Error handling Concierge re-engagement:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      shouldRetry: true,
    };
  }
}

/**
 * Handle Innovator re-engagement with LLM judgment
 */
async function handleInnovatorReengagement(
  task: Task,
  context: ReengagementContext,
  supabase: any
): Promise<TaskResult> {
  console.log(`[${task.id}] Processing Innovator re-engagement check`);

  try {
    // Get user
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

    // Get conversation
    const { data: conversation } = await supabase
      .from('conversations')
      .select('*')
      .eq('user_id', task.user_id)
      .eq('status', 'active')
      .single();

    if (!conversation) {
      return {
        success: false,
        error: 'No active conversation found',
        shouldRetry: false,
      };
    }

    // Get recent messages to calculate days since last interaction
    const { data: recentMessages } = await supabase
      .from('messages')
      .select('created_at')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false })
      .limit(1);

    const lastMessage = recentMessages?.[0];
    const daysSinceLastMessage = lastMessage
      ? Math.floor((Date.now() - new Date(lastMessage.created_at).getTime()) / (1000 * 60 * 60 * 24))
      : 999;

    // Get user priorities
    const { data: priorities } = await supabase
      .from('user_priorities')
      .select('*')
      .eq('user_id', task.user_id)
      .eq('status', 'active')
      .order('priority_rank', { ascending: true })
      .limit(5);

    // Get pending intros
    const { data: pendingIntros } = await supabase
      .from('intro_opportunities')
      .select('id')
      .eq('innovator_id', task.user_id)
      .in('status', ['pending', 'accepted']);

    // Get innovator profile last updated date
    const { data: innovatorProfile } = await supabase
      .from('innovators')
      .select('updated_at')
      .eq('user_id', task.user_id)
      .single();

    // Create system message with re-engagement context for Innovator to process with LLM judgment
    const systemMessageContent = JSON.stringify({
      type: 're_engagement_check',
      daysSinceLastMessage,
      priorityCount: priorities?.length || 0,
      hasActiveGoals: !!((user.response_pattern as any)?.user_goal),
      pendingIntroCount: pendingIntros?.length || 0,
      creditBalance: user.credits || 0,
      profileLastUpdated: innovatorProfile?.updated_at || null,
      guidance: 'Decide whether to reach out based on priorities, pending intros, profile updates needed, and conversation history. If messaging, be brief and ROI-focused.',
    });

    const { error: messageError } = await supabase.from('messages').insert({
      conversation_id: conversation.id,
      user_id: user.id,
      role: 'system',
      content: systemMessageContent,
      direction: 'inbound', // System messages trigger agents, they don't get sent to users
      status: 'pending',
    });

    if (messageError) {
      return {
        success: false,
        error: `Failed to create re-engagement system message: ${messageError.message}`,
        shouldRetry: true,
      };
    }

    console.log(`[${task.id}] Created Innovator re-engagement system message for ${user.phone_number}`);

    return {
      success: true,
      data: {
        systemMessageCreated: true,
        daysSinceLastMessage,
        pendingIntroCount: pendingIntros?.length || 0,
      },
    };
  } catch (error) {
    console.error(`[${task.id}] Error handling Innovator re-engagement:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      shouldRetry: true,
    };
  }
}

/**
 * Handle Bouncer re-engagement (onboarding flow)
 */
async function handleBouncerReengagement(
  task: Task,
  context: ReengagementContext,
  supabase: any
): Promise<TaskResult> {
  try {
    // Get user
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

    // If user is already verified, skip re-engagement
    if (user.verified) {
      console.log(`[${task.id}] User is already verified, skipping re-engagement`);
      return {
        success: true,
        data: { skipped: true, reason: 'User already verified' },
      };
    }

    // Get conversation
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('*')
      .eq('user_id', task.user_id)
      .eq('status', 'active')
      .single();

    if (convError || !conversation) {
      return {
        success: false,
        error: `Failed to get conversation: ${convError?.message}`,
        shouldRetry: true,
      };
    }

    // Check if user has responded since task was created
    const { data: recentMessages } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversation.id)
      .eq('direction', 'inbound')
      .gte('created_at', task.created_at)
      .order('created_at', { ascending: false })
      .limit(1);

    if (recentMessages && recentMessages.length > 0) {
      console.log(`[${task.id}] User has responded, skipping re-engagement`);
      return {
        success: true,
        data: { skipped: true, reason: 'User has responded' },
      };
    }

    // Create system message to trigger Bouncer agent with re-engagement context
    const attemptCount = context.attemptCount || 1;

    if (attemptCount > 2) {
      // After 2 attempts, pause the conversation - don't send another message
      await supabase
        .from('conversations')
        .update({ status: 'paused' })
        .eq('id', conversation.id);

      console.log(`[${task.id}] Paused conversation after ${attemptCount} attempts (no third message)`);
      return {
        success: true,
        data: { paused: true, attemptCount },
      };
    }

    // Create system message with re-engagement context for Bouncer to process
    const systemMessageContent = JSON.stringify({
      type: 're_engagement_check',
      attemptCount,
      lastInteractionAt: context.last_interaction_at,
      currentStep: context.current_step,
      missingFields: context.missing_fields,
      guidance: 'Soft tone. Ask if they still want to proceed. Do not list all missing fields. Keep line moving.'
    });

    const { error: messageError } = await supabase.from('messages').insert({
      conversation_id: conversation.id,
      user_id: user.id,
      role: 'system',
      content: systemMessageContent,
      direction: 'inbound', // System messages trigger agents, they don't get sent to users
      status: 'pending',
    });

    if (messageError) {
      return {
        success: false,
        error: `Failed to create re-engagement system message: ${messageError.message}`,
        shouldRetry: true,
      };
    }

    console.log(`[${task.id}] Created re-engagement system message (attempt ${attemptCount}) for ${user.phone_number}`);

    // Allow up to 2 re-engagement attempts, then pause if no response

    // Log action
    await supabase.from('agent_actions_log').insert({
      agent_type: 'task_processor',
      action_type: 're_engagement_check',
      user_id: task.user_id,
      context_id: task.id,
      context_type: 'agent_task',
      input_data: context,
      output_data: { attemptCount, sent: true },
    });

    return {
      success: true,
      data: {
        attemptCount,
        messageSent: true,
      },
    };
  } catch (error) {
    console.error(`[${task.id}] Error handling re_engagement_check:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      shouldRetry: true,
    };
  }
}
