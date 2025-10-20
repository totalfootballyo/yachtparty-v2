/**
 * User Event Handlers
 *
 * Handles all user-related events:
 * - user.solution_research_needed (now: user.inquiry.solution_needed)
 * - user.community_question_asked (now: community.request_needed)
 * - user.intro_requested (now: user.intro_inquiry)
 * - user.profile_updated
 * - user.verified
 */

import { createClient } from '@supabase/supabase-js';
import type { Event } from '../types';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

/**
 * Handler: user.inquiry.solution_needed
 * Creates a research task for the Solution Saga agent
 */
export async function handleSolutionResearchNeeded(event: Event): Promise<void> {
  console.log(`[user.inquiry.solution_needed] Processing event ${event.id}`);

  const payload = event.payload as unknown as {
    userId: string;
    conversationId: string;
    requestDescription: string;
    category?: string;
    urgency?: 'low' | 'medium' | 'high';
  };

  // Create agent task for Solution Saga
  const { data: task, error: taskError } = await supabase
    .from('agent_tasks')
    .insert({
      task_type: 'research_solution',
      agent_type: 'solution_saga',
      user_id: payload.userId,
      context_id: payload.conversationId,
      context_type: 'conversation',
      scheduled_for: new Date().toISOString(),
      priority: payload.urgency === 'high' ? 'high' : 'medium',
      context_json: {
        requestDescription: payload.requestDescription,
        category: payload.category,
        urgency: payload.urgency,
        eventId: event.id,
      },
      created_by: 'event_processor',
    })
    .select()
    .single();

  if (taskError) {
    console.error(`[user.inquiry.solution_needed] Failed to create task:`, taskError);
    throw taskError;
  }

  console.log(`[user.inquiry.solution_needed] Created task ${task.id} for Solution Saga`);

  // Notify relevant agents (for future implementation)
  // This could trigger notifications to Account Manager to track the request
  await publishNotificationEvent(
    'solution.research_initiated',
    payload.userId,
    {
      taskId: task.id,
      requestDescription: payload.requestDescription,
    }
  );
}

/**
 * Handler: community.request_needed
 * Routes community requests to matching experts (Agent of Humans)
 *
 * This is NOT an LLM agent - it's a request routing system that matches
 * questions to experts based on their expertise arrays.
 */
export async function handleCommunityQuestionAsked(event: Event): Promise<void> {
  console.log(`[community.request_needed] Processing event ${event.id}`);

  const payload = event.payload as unknown as {
    requestingAgentType?: string;
    requestingUserId?: string;
    contextId?: string;
    contextType?: string;
    question: string;
    category?: string;
    expertiseNeeded: string[];
    requesterContext?: string;
    desiredOutcome?: string;
    urgency?: string;
    requestSummary?: string;
  };

  // 1. Check for duplicate recent requests (last 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: duplicates } = await supabase
    .from('community_requests')
    .select('id, status')
    .eq('category', payload.category || '')
    .overlaps('expertise_needed', payload.expertiseNeeded)
    .gte('created_at', sevenDaysAgo)
    .eq('status', 'open');

  if (duplicates && duplicates.length > 0) {
    console.log(`[community.request_needed] Found ${duplicates.length} similar recent requests, attaching to ${duplicates[0].id}`);

    // Attach to existing request - publish event to notify requester
    await publishNotificationEvent(
      'community.request_attached',
      payload.requestingUserId || event.aggregate_id,
      {
        existingRequestId: duplicates[0].id,
        newEventId: event.id,
        question: payload.question
      }
    );
    return;
  }

  // 2. Find qualified experts
  const { data: experts } = await supabase
    .from('users')
    .select('id, first_name, last_name, expertise')
    .eq('verified', true)
    .overlaps('expertise', payload.expertiseNeeded)
    .limit(5);

  // Log if no experts found (but still create the request)
  if (!experts || experts.length === 0) {
    console.log(`[community.request_needed] No experts found for expertise: ${payload.expertiseNeeded.join(', ')} - creating request anyway for future fulfillment`);

    // Log for system monitoring
    await supabase.from('events').insert({
      event_type: 'community.no_experts_found',
      aggregate_id: payload.category || 'unknown',
      aggregate_type: 'community_request',
      payload: {
        category: payload.category,
        expertiseNeeded: payload.expertiseNeeded,
        question: payload.question
      },
      created_by: 'event_processor'
    });
  }

  const expertIds = experts ? experts.map(e => e.id) : [];

  // 3. Create ONE community request
  const { data: request, error: requestError } = await supabase
    .from('community_requests')
    .insert({
      requesting_agent_type: payload.requestingAgentType || event.created_by,
      requesting_user_id: payload.requestingUserId,
      question: payload.question,
      category: payload.category,
      expertise_needed: payload.expertiseNeeded,
      target_user_ids: expertIds,
      requester_context: payload.requesterContext,
      desired_outcome: payload.desiredOutcome || 'backchannel',
      urgency: payload.urgency || 'medium',
      request_summary: payload.requestSummary,
      status: 'open',
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
    })
    .select()
    .single();

  if (requestError) {
    console.error(`[community.request_needed] Failed to create request:`, requestError);
    throw requestError;
  }

  console.log(`[community.request_needed] Created request ${request.id}, matched ${expertIds.length} experts`);

  // 4. Create agent_tasks for each expert's Account Manager (if we found experts)
  if (expertIds.length > 0) {
    const notificationTasks = experts!.map((expert) => ({
      task_type: 'community_request_available',
      agent_type: 'account_manager',
      user_id: expert.id,
      context_id: request.id,
      context_type: 'community_request',
      scheduled_for: new Date().toISOString(),
      priority: 'medium',
      context_json: {
        requestId: request.id,
        question: payload.question,
        category: payload.category,
        expertiseNeeded: payload.expertiseNeeded,
        requesterContext: payload.requesterContext,
        desiredOutcome: payload.desiredOutcome,
        urgency: payload.urgency,
        requestSummary: payload.requestSummary,
        contextId: payload.contextId,
        contextType: payload.contextType
      },
      created_by: 'event_processor',
    }));

    const { error: tasksError } = await supabase
      .from('agent_tasks')
      .insert(notificationTasks);

    if (tasksError) {
      console.error(`[community.request_needed] Failed to create notification tasks:`, tasksError);
      throw tasksError;
    }

    console.log(`[community.request_needed] Created ${notificationTasks.length} Account Manager tasks`);

    // 5. Publish community.request_routed event
    await supabase.from('events').insert({
      event_type: 'community.request_routed',
      aggregate_id: request.id,
      aggregate_type: 'community_request',
      payload: {
        requestId: request.id,
        expertsNotified: expertIds.length,
        expertUserIds: expertIds,
        question: payload.question,
        category: payload.category
      },
      created_by: 'event_processor'
    });

    console.log(`[community.request_needed] ✓ Routed to ${expertIds.length} experts`);
  } else {
    console.log(`[community.request_needed] ✓ Request created for future fulfillment (no experts currently available)`);
  }
}

/**
 * Handler: user.intro_inquiry
 * Creates task for Account Manager to handle intro request
 */
export async function handleIntroRequested(event: Event): Promise<void> {
  console.log(`[user.intro_inquiry] Processing event ${event.id}`);

  const payload = event.payload as unknown as {
    userId: string;
    introId?: string;
    userQuestion: string;
    conversationId: string;
  };

  // Create task for Account Manager to handle intro request
  const { data: task, error: taskError } = await supabase
    .from('agent_tasks')
    .insert({
      task_type: 'intro_followup_check',
      agent_type: 'account_manager',
      user_id: payload.userId,
      context_id: payload.introId,
      context_type: 'intro_opportunity',
      scheduled_for: new Date().toISOString(),
      priority: 'high',
      context_json: {
        introId: payload.introId,
        userQuestion: payload.userQuestion,
        conversationId: payload.conversationId,
        eventId: event.id,
      },
      created_by: 'event_processor',
    })
    .select()
    .single();

  if (taskError) {
    console.error(`[user.intro_inquiry] Failed to create task:`, taskError);
    throw taskError;
  }

  console.log(`[user.intro_inquiry] Created task ${task.id} for Account Manager`);
}

/**
 * Handler: user.verified
 * Handles user verification completion - invalidates caches, notifies dependent services
 */
export async function handleProfileUpdated(event: Event): Promise<void> {
  console.log(`[user.verified] Processing event ${event.id}`);

  const payload = event.payload as unknown as {
    userId: string;
    verificationCompletedAt: string;
    pocAgentType: 'concierge' | 'innovator';
  };

  // Invalidate any cached user data (if we had Redis, this would clear cache)
  // For now, just log the event
  console.log(`[user.verified] User ${payload.userId} verified, transitioning to ${payload.pocAgentType}`);

  // Notify Account Manager to initialize user priorities
  const { data: task, error: taskError } = await supabase
    .from('agent_tasks')
    .insert({
      task_type: 'notify_user_of_priorities',
      agent_type: 'account_manager',
      user_id: payload.userId,
      scheduled_for: new Date(Date.now() + 60 * 1000).toISOString(), // 1 minute delay
      priority: 'high',
      context_json: {
        reason: 'user_verified',
        verificationCompletedAt: payload.verificationCompletedAt,
        eventId: event.id,
      },
      created_by: 'event_processor',
    })
    .select()
    .single();

  if (taskError) {
    console.error(`[user.verified] Failed to create Account Manager task:`, taskError);
  } else {
    console.log(`[user.verified] Created Account Manager task ${task.id}`);
  }
}

/**
 * Helper: Publish notification event
 */
async function publishNotificationEvent(
  eventType: string,
  userId: string,
  data: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.from('events').insert({
    event_type: eventType,
    aggregate_id: userId,
    aggregate_type: 'user',
    payload: data,
    created_by: 'event_processor',
  });

  if (error) {
    console.error(`Failed to publish notification event ${eventType}:`, error);
  }
}
