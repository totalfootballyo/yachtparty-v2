/**
 * Event Publishing Utilities
 *
 * Provides utilities for publishing events and managing agent tasks
 * in the Yachtparty event-driven architecture.
 *
 * All inter-agent communication happens via events published to the events table.
 * Agents never directly call other agents, eliminating circular dependencies.
 *
 * @module utils/events
 */

import { createServiceClient } from './supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Event, AgentTask } from '../types/database';
import type { PublishEventParams } from '../types/events';
import type { Priority, TaskType, AgentType } from '../types/agents';

/**
 * Parameters for creating an agent task.
 */
export interface CreateTaskParams {
  /** Type of task to execute */
  task_type: TaskType;

  /** Agent responsible for processing this task */
  agent_type: AgentType;

  /** User this task relates to (optional) */
  user_id?: string;

  /** Related entity ID (optional) */
  context_id?: string;

  /** Type of context entity (optional) */
  context_type?: string;

  /** When to execute this task */
  scheduled_for: Date | string;

  /** Task priority level */
  priority: Priority;

  /** Complete context needed to process task independently */
  context_json: Record<string, unknown>;

  /** Maximum retry attempts (default: 3) */
  max_retries?: number;

  /** Agent or function creating this task */
  created_by: string;
}

/**
 * Publishes an event to the events table.
 *
 * Events are the primary mechanism for inter-agent communication.
 * All events are stored for complete audit trail and replay capability.
 *
 * @param params - Event publication parameters
 * @param dbClient - Optional Supabase client (defaults to production)
 * @returns The created event record
 * @throws Error if event creation fails
 *
 * @example
 * ```typescript
 * // Publish a user message received event
 * const event = await publishEvent({
 *   event_type: 'user.message.received',
 *   aggregate_id: userId,
 *   aggregate_type: 'user',
 *   payload: {
 *     userId,
 *     conversationId,
 *     message: 'Hello!',
 *     phoneNumber: '+15551234567',
 *     messageId: 'msg_123'
 *   },
 *   created_by: 'twilio_webhook'
 * });
 * ```
 */
export async function publishEvent<T = unknown>(
  params: PublishEventParams<T>,
  dbClient: SupabaseClient = createServiceClient()
): Promise<Event> {
  const supabase = dbClient;

  const eventRecord = {
    event_type: params.event_type,
    aggregate_id: params.aggregate_id,
    aggregate_type: params.aggregate_type,
    payload: params.payload,
    metadata: params.metadata || null,
    processed: false,
    version: 1,
    created_by: params.created_by,
  };

  const { data, error } = await supabase
    .from('events')
    .insert(eventRecord)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to publish event ${params.event_type}: ${error.message}`);
  }

  return data as Event;
}

/**
 * Creates an agent task in the agent_tasks table.
 *
 * Tasks are scheduled for future processing and picked up by pg_cron
 * every 2 minutes. Uses FOR UPDATE SKIP LOCKED pattern to prevent
 * duplicate processing.
 *
 * @param params - Task creation parameters
 * @param dbClient - Optional Supabase client (defaults to production)
 * @returns The created agent task record
 * @throws Error if task creation fails
 *
 * @example
 * ```typescript
 * // Schedule a re-engagement check for 24 hours from now
 * const task = await createAgentTask({
 *   task_type: 're_engagement_check',
 *   agent_type: 'bouncer',
 *   user_id: userId,
 *   context_id: conversationId,
 *   context_type: 'conversation',
 *   scheduled_for: new Date(Date.now() + 24 * 60 * 60 * 1000),
 *   priority: 'medium',
 *   context_json: {
 *     lastMessage: 'What's your company name?',
 *     onboardingStep: 'company_collection'
 *   },
 *   created_by: 'bouncer_agent'
 * });
 * ```
 */
export async function createAgentTask(
  params: CreateTaskParams,
  dbClient: SupabaseClient = createServiceClient()
): Promise<AgentTask> {
  const supabase = dbClient;

  const taskRecord = {
    task_type: params.task_type,
    agent_type: params.agent_type,
    user_id: params.user_id || null,
    context_id: params.context_id || null,
    context_type: params.context_type || null,
    scheduled_for: params.scheduled_for,
    priority: params.priority,
    status: 'pending',
    retry_count: 0,
    max_retries: params.max_retries || 3,
    context_json: params.context_json,
    created_by: params.created_by,
  };

  const { data, error } = await supabase
    .from('agent_tasks')
    .insert(taskRecord)
    .select()
    .single();

  if (error) {
    throw new Error(
      `Failed to create agent task ${params.task_type}: ${error.message}`
    );
  }

  return data as AgentTask;
}

/**
 * Marks an event as processed.
 *
 * After an agent successfully processes an event, it should be marked
 * as processed to prevent duplicate handling.
 *
 * @param eventId - The unique identifier of the event
 * @param dbClient - Optional Supabase client (defaults to production)
 * @returns The updated event record
 * @throws Error if update fails
 *
 * @example
 * ```typescript
 * // Process event and mark as complete
 * const event = await getUnprocessedEvents('user.message.received', 1);
 * if (event[0]) {
 *   await handleMessageEvent(event[0]);
 *   await markEventProcessed(event[0].id);
 * }
 * ```
 */
export async function markEventProcessed(
  eventId: string,
  dbClient: SupabaseClient = createServiceClient()
): Promise<Event> {
  const supabase = dbClient;

  const { data, error } = await supabase
    .from('events')
    .update({ processed: true })
    .eq('id', eventId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to mark event ${eventId} as processed: ${error.message}`);
  }

  return data as Event;
}

/**
 * Retrieves unprocessed events from the events table.
 *
 * Used by agents to poll for events they need to handle.
 * Events are ordered by creation time (oldest first) to ensure
 * they are processed in the correct order.
 *
 * @param eventType - Optional event type filter (e.g., 'user.message.received')
 * @param limit - Maximum number of events to retrieve (default: 100)
 * @param dbClient - Optional Supabase client (defaults to production)
 * @returns Array of unprocessed event records (may be empty)
 * @throws Error if query fails
 *
 * @example
 * ```typescript
 * // Get all unprocessed events
 * const allEvents = await getUnprocessedEvents();
 *
 * // Get unprocessed user message events
 * const messageEvents = await getUnprocessedEvents('user.message.received');
 *
 * // Get only the next 10 unprocessed events
 * const nextBatch = await getUnprocessedEvents(undefined, 10);
 *
 * // Process events
 * for (const event of messageEvents) {
 *   console.log(`Processing ${event.event_type} for ${event.aggregate_id}`);
 *   await handleEvent(event);
 *   await markEventProcessed(event.id);
 * }
 * ```
 */
export async function getUnprocessedEvents(
  eventType?: string,
  limit: number = 100,
  dbClient: SupabaseClient = createServiceClient()
): Promise<Event[]> {
  const supabase = dbClient;

  let query = supabase
    .from('events')
    .select('*')
    .eq('processed', false)
    .order('created_at', { ascending: true })
    .limit(limit);

  // Add event type filter if provided
  if (eventType) {
    query = query.eq('event_type', eventType);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch unprocessed events: ${error.message}`);
  }

  return (data as Event[]) || [];
}
