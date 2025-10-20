/**
 * System Event Handlers
 *
 * Handles system-level events:
 * - solution.research_complete
 * - intro.completed
 * - community.response_received
 * - account_manager.processing.completed
 */

import { createClient } from '@supabase/supabase-js';
import type { Event } from '../types';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

/**
 * Handler: solution.research_complete
 * Notifies user of completed solution research
 */
export async function handleSolutionResearchComplete(event: Event): Promise<void> {
  console.log(`[solution.research_complete] Processing event ${event.id}`);

  const payload = event.payload as unknown as {
    workflowId: string;
    userId: string;
    requestDescription: string;
    findings: {
      matchedInnovators: Array<{ id: string; name: string; relevance: number }>;
      potentialVendors?: string[];
      communityInsights?: Array<{ expertId: string; recommendation: string }>;
    };
    completedAt: string;
  };

  // Get user's conversation
  const { data: conversation, error: conversationError } = await supabase
    .from('conversations')
    .select('id')
    .eq('user_id', payload.userId)
    .eq('status', 'active')
    .single();

  if (conversationError || !conversation) {
    console.error(`[solution.research_complete] Failed to get conversation:`, conversationError);
    throw new Error('No active conversation found for user');
  }

  // Create task for Concierge to deliver findings
  const { data: task, error: taskError } = await supabase
    .from('agent_tasks')
    .insert({
      task_type: 'solution_workflow_timeout', // Reusing this task type for delivery
      agent_type: 'concierge',
      user_id: payload.userId,
      context_id: payload.workflowId,
      context_type: 'solution_workflow',
      scheduled_for: new Date().toISOString(),
      priority: 'high',
      context_json: {
        workflowId: payload.workflowId,
        requestDescription: payload.requestDescription,
        findings: payload.findings,
        conversationId: conversation.id,
        eventId: event.id,
      },
      created_by: 'event_processor',
    })
    .select()
    .single();

  if (taskError) {
    console.error(`[solution.research_complete] Failed to create task:`, taskError);
    throw taskError;
  }

  console.log(`[solution.research_complete] Created Concierge task ${task.id} to deliver findings`);

  // Update solution workflow status
  const { error: workflowError } = await supabase
    .from('solution_workflows')
    .update({
      status: 'completed',
      completed_at: payload.completedAt,
    })
    .eq('id', payload.workflowId);

  if (workflowError) {
    console.error(`[solution.research_complete] Failed to update workflow status:`, workflowError);
  }
}

/**
 * Handler: intro.completed
 * Awards credits and notifies relevant parties
 */
export async function handleIntroCompleted(event: Event): Promise<void> {
  console.log(`[intro.completed] Processing event ${event.id}`);

  const payload = event.payload as unknown as {
    introId: string;
    connectorUserId: string;
    innovatorId?: string;
    prospectId?: string;
    completedAt: string;
    creditsAwarded: number;
  };

  // Update intro opportunity status
  const { error: introError } = await supabase
    .from('intro_opportunities')
    .update({
      status: 'completed',
      completed_at: payload.completedAt,
    })
    .eq('id', payload.introId);

  if (introError) {
    console.error(`[intro.completed] Failed to update intro status:`, introError);
    throw introError;
  }

  // Create credit event
  const { error: creditError } = await supabase
    .from('credit_events')
    .insert({
      user_id: payload.connectorUserId,
      transaction_type: 'earned',
      amount: payload.creditsAwarded,
      description: `Intro completed - ${payload.creditsAwarded} credits earned`,
      source_type: 'intro_completion',
      source_id: payload.introId,
      created_by: 'event_processor',
    })
    .select()
    .single();

  if (creditError) {
    console.error(`[intro.completed] Failed to create credit event:`, creditError);
    throw creditError;
  }

  console.log(`[intro.completed] Awarded ${payload.creditsAwarded} credits to user ${payload.connectorUserId}`);

  // Create task to notify connector of credit award
  const { error: taskError } = await supabase
    .from('agent_tasks')
    .insert({
      task_type: 'notify_user_of_priorities',
      agent_type: 'concierge',
      user_id: payload.connectorUserId,
      context_id: payload.introId,
      context_type: 'intro_opportunity',
      scheduled_for: new Date().toISOString(),
      priority: 'medium',
      context_json: {
        reason: 'intro_completed',
        creditsAwarded: payload.creditsAwarded,
        introId: payload.introId,
        eventId: event.id,
      },
      created_by: 'event_processor',
    });

  if (taskError) {
    console.error(`[intro.completed] Failed to create notification task:`, taskError);
  }

  // If innovator is involved, notify them as well
  if (payload.innovatorId) {
    await notifyInnovatorOfIntro(payload.innovatorId, payload.introId, payload.prospectId);
  }
}

/**
 * Handler: community.response_received
 * Routes community response to appropriate handlers based on context.
 *
 * If context is a solution_workflow:
 *   → Creates task for Solution Saga to evaluate usefulness and award credits
 * If request has a requesting_user_id:
 *   → Creates task for Account Manager to add to requester's priorities
 */
export async function handleCommunityResponseReceived(event: Event): Promise<void> {
  console.log(`[community.response_received] Processing event ${event.id}`);

  const payload = event.payload as unknown as {
    responseId: string;
    requestId: string;
    expertUserId: string;
    responseSummary: string;
    verbatimAnswer: string;
    contextId?: string;
    contextType?: string;
  };

  // Fetch request details
  const { data: request, error: requestError } = await supabase
    .from('community_requests')
    .select('requesting_user_id, requesting_agent_type, context_id, context_type')
    .eq('id', payload.requestId)
    .single();

  if (requestError || !request) {
    console.error(`[community.response_received] Failed to fetch request:`, requestError);
    throw requestError;
  }

  const tasks = [];

  // 1. If this was requested by Solution Saga, create task to evaluate response
  if (request.context_type === 'solution_workflow' && request.context_id) {
    tasks.push({
      task_type: 'process_community_response',
      agent_type: 'solution_saga',
      user_id: request.requesting_user_id || null,
      context_id: request.context_id,
      context_type: 'solution_workflow',
      scheduled_for: new Date().toISOString(),
      priority: 'medium',
      context_json: {
        responseId: payload.responseId,
        requestId: payload.requestId,
        eventId: event.id,
      },
      created_by: 'event_processor',
    });

    console.log(`[community.response_received] Creating task for Solution Saga to evaluate response`);
  }

  // 2. If there's a requesting user, create task to notify them via Account Manager
  if (request.requesting_user_id) {
    tasks.push({
      task_type: 'community_response_available',
      agent_type: 'account_manager',
      user_id: request.requesting_user_id,
      context_id: payload.responseId,
      context_type: 'community_response',
      scheduled_for: new Date().toISOString(),
      priority: 'high',
      context_json: {
        responseId: payload.responseId,
        requestId: payload.requestId,
        expertUserId: payload.expertUserId,
        responseSummary: payload.responseSummary,
        eventId: event.id,
      },
      created_by: 'event_processor',
    });

    console.log(`[community.response_received] Creating task for Account Manager to notify requester`);
  }

  // Insert all tasks
  if (tasks.length > 0) {
    const { error: tasksError } = await supabase
      .from('agent_tasks')
      .insert(tasks);

    if (tasksError) {
      console.error(`[community.response_received] Failed to create tasks:`, tasksError);
      throw tasksError;
    }

    console.log(`[community.response_received] ✓ Created ${tasks.length} task(s)`);
  } else {
    console.log(`[community.response_received] No tasks needed (response recorded but not routed)`);
  }
}

/**
 * Handler: account_manager.processing.completed
 * Logs Account Manager processing results
 */
export async function handleAccountManagerComplete(event: Event): Promise<void> {
  console.log(`[account_manager.processing.completed] Processing event ${event.id}`);

  const payload = event.payload as unknown as {
    userId: string;
    processedEvents: number;
    urgentItems: number;
    prioritiesUpdated: number;
    tasksCreated: number;
    completedAt: string;
  };

  // Log processing results
  const { error: logError } = await supabase
    .from('agent_actions_log')
    .insert({
      agent_type: 'account_manager',
      action_type: 'processing_completed',
      user_id: payload.userId,
      action_data: {
        processedEvents: payload.processedEvents,
        urgentItems: payload.urgentItems,
        prioritiesUpdated: payload.prioritiesUpdated,
        tasksCreated: payload.tasksCreated,
        completedAt: payload.completedAt,
        eventId: event.id,
      },
      created_by: 'event_processor',
    });

  if (logError) {
    console.error(`[account_manager.processing.completed] Failed to log results:`, logError);
  }

  console.log(
    `[account_manager.processing.completed] Account Manager processed ${payload.processedEvents} events, ` +
    `updated ${payload.prioritiesUpdated} priorities, created ${payload.tasksCreated} tasks`
  );

  // If there are urgent items, notify Concierge
  if (payload.urgentItems > 0) {
    await notifyConciergeOfUrgentItems(payload.userId, payload.urgentItems);
  }
}

/**
 * Helper: Notify innovator of new intro
 */
async function notifyInnovatorOfIntro(
  innovatorId: string,
  introId: string,
  prospectId?: string
): Promise<void> {
  const { error: taskError } = await supabase
    .from('agent_tasks')
    .insert({
      task_type: 'notify_user_of_priorities',
      agent_type: 'innovator',
      user_id: innovatorId,
      context_id: introId,
      context_type: 'intro_opportunity',
      scheduled_for: new Date().toISOString(),
      priority: 'high',
      context_json: {
        reason: 'intro_completed',
        introId,
        prospectId,
      },
      created_by: 'event_processor',
    });

  if (taskError) {
    console.error(`Failed to create innovator notification task:`, taskError);
  }
}

/**
 * Helper: Notify Concierge of urgent items
 */
async function notifyConciergeOfUrgentItems(userId: string, urgentCount: number): Promise<void> {
  const { error: taskError } = await supabase
    .from('agent_tasks')
    .insert({
      task_type: 'notify_user_of_priorities',
      agent_type: 'concierge',
      user_id: userId,
      scheduled_for: new Date().toISOString(),
      priority: 'urgent',
      context_json: {
        reason: 'urgent_priorities_detected',
        urgentCount,
      },
      created_by: 'event_processor',
    });

  if (taskError) {
    console.error(`Failed to create urgent notification task:`, taskError);
  }
}
