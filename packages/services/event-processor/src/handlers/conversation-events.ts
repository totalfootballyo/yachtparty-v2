/**
 * Conversation Event Handlers
 *
 * Handles all conversation-related events:
 * - conversation.intent_classified
 * - user.message.received
 * - user.response.recorded
 */

import { createClient } from '@supabase/supabase-js';
import type { Event } from '../types';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

/**
 * Handler: conversation.intent_classified
 * Updates conversation metadata with classified intent
 * Used by Account Manager to track user goals and needs
 */
export async function handleIntentClassified(event: Event): Promise<void> {
  console.log(`[conversation.intent_classified] Processing event ${event.id}`);

  const payload = event.payload as unknown as {
    conversationId: string;
    intent: string;
    confidence: number;
    context?: Record<string, unknown>;
  };

  // Update conversation metadata with intent information
  const { data: conversation, error: fetchError } = await supabase
    .from('conversations')
    .select('metadata')
    .eq('id', payload.conversationId)
    .single();

  if (fetchError) {
    console.error(`[conversation.intent_classified] Failed to fetch conversation:`, fetchError);
    throw fetchError;
  }

  // Merge existing metadata with new intent data
  const updatedMetadata = {
    ...(conversation.metadata as Record<string, unknown> || {}),
    last_intent: payload.intent,
    intent_confidence: payload.confidence,
    intent_classified_at: new Date().toISOString(),
    intent_context: payload.context,
  };

  const { error: updateError } = await supabase
    .from('conversations')
    .update({ metadata: updatedMetadata })
    .eq('id', payload.conversationId);

  if (updateError) {
    console.error(`[conversation.intent_classified] Failed to update conversation:`, updateError);
    throw updateError;
  }

  console.log(`[conversation.intent_classified] Updated conversation ${payload.conversationId} with intent: ${payload.intent}`);

  // If high-confidence intent detected, notify Account Manager
  if (payload.confidence > 0.8) {
    await notifyAccountManager(payload.conversationId, payload.intent);
  }
}

/**
 * Handler: user.message.received
 * Processes inbound user messages for Account Manager tracking
 */
export async function handleMessageReceived(event: Event): Promise<void> {
  console.log(`[user.message.received] Processing event ${event.id}`);

  const payload = event.payload as unknown as {
    userId: string;
    conversationId: string;
    message: string;
    phoneNumber: string;
    messageId: string;
  };

  // Update user last_active_at
  const { error: userError } = await supabase
    .from('users')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', payload.userId);

  if (userError) {
    console.error(`[user.message.received] Failed to update user activity:`, userError);
  }

  // Update conversation last_message_at
  const { error: conversationError } = await supabase
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', payload.conversationId);

  if (conversationError) {
    console.error(`[user.message.received] Failed to update conversation:`, conversationError);
  }

  // Log event for Account Manager processing (if needed for priority scoring)
  console.log(`[user.message.received] Updated activity for user ${payload.userId}`);
}

/**
 * Handler: user.response.recorded
 * Tracks user responses to system actions for learning and optimization
 */
export async function handleResponseRecorded(event: Event): Promise<void> {
  console.log(`[user.response.recorded] Processing event ${event.id}`);

  const payload = event.payload as unknown as {
    userId: string;
    conversationId: string;
    responseType: 'feedback' | 'acceptance' | 'rejection' | 'clarification';
    context: string;
    response: string;
  };

  // Store response in agent_actions_log for analysis
  const { error: logError } = await supabase
    .from('agent_actions_log')
    .insert({
      agent_type: 'system',
      action_type: 'user_response_recorded',
      user_id: payload.userId,
      conversation_id: payload.conversationId,
      action_data: {
        responseType: payload.responseType,
        context: payload.context,
        response: payload.response,
        eventId: event.id,
      },
      created_by: 'event_processor',
    });

  if (logError) {
    console.error(`[user.response.recorded] Failed to log response:`, logError);
  }

  // If user rejected something, notify Account Manager to adjust strategy
  if (payload.responseType === 'rejection') {
    await notifyAccountManager(payload.conversationId, 'user_rejection', {
      context: payload.context,
      response: payload.response,
    });
  }

  console.log(`[user.response.recorded] Logged ${payload.responseType} response for user ${payload.userId}`);
}

/**
 * Helper: Notify Account Manager of important conversation events
 */
async function notifyAccountManager(
  conversationId: string,
  reason: string,
  additionalData?: Record<string, unknown>
): Promise<void> {
  // Get conversation and user info
  const { data: conversation, error: fetchError } = await supabase
    .from('conversations')
    .select('user_id')
    .eq('id', conversationId)
    .single();

  if (fetchError || !conversation) {
    console.error(`Failed to fetch conversation for Account Manager notification:`, fetchError);
    return;
  }

  // Create task for Account Manager
  const { error: taskError } = await supabase
    .from('agent_tasks')
    .insert({
      task_type: 'notify_user_of_priorities',
      agent_type: 'account_manager',
      user_id: conversation.user_id,
      context_id: conversationId,
      context_type: 'conversation',
      scheduled_for: new Date().toISOString(),
      priority: 'medium',
      context_json: {
        reason,
        conversationId,
        ...additionalData,
      },
      created_by: 'event_processor',
    });

  if (taskError) {
    console.error(`Failed to create Account Manager task:`, taskError);
  } else {
    console.log(`Created Account Manager notification task for reason: ${reason}`);
  }
}
