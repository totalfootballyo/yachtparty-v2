/**
 * Event Categorization and Processing Helpers
 *
 * Provides utilities for fetching, categorizing, and extracting context
 * from events for priority scoring.
 *
 * @module event-processor
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Event, IntroOpportunity, CommunityRequest } from '@yachtparty/shared';

/**
 * Categorized events by type.
 * Groups events into actionable categories for priority scoring.
 */
export interface CategorizedEvents {
  /** New introduction opportunities created */
  newIntros: Event[];

  /** Community requests targeting this user */
  communityRequests: Event[];

  /** Responses received from community experts */
  responses: Event[];

  /** Solution research updates */
  solutionUpdates: Event[];

  /** User responses and feedback */
  userResponses: Event[];

  /** Other uncategorized events */
  other: Event[];
}

/**
 * Additional context needed for priority scoring.
 * Fetched from database based on categorized events.
 */
export interface EventContext {
  /** Intro opportunities (full records) */
  introOpportunities: IntroOpportunity[];

  /** Community requests (full records) */
  communityRequests: CommunityRequest[];

  /** Solution workflows referenced in events */
  solutionWorkflows: any[];

  /** Any additional metadata */
  metadata: Record<string, unknown>;
}

/**
 * Gets the timestamp of the last successful Account Manager run for a user.
 *
 * Queries agent_actions_log for last completed processing event.
 * Returns null if user has never been processed.
 *
 * @param userId - The user ID to check
 * @returns ISO timestamp of last processing, or null if never processed
 */
export async function getLastProcessedTime(userId: string): Promise<string | null> {
  const { createServiceClient } = await import('@yachtparty/shared');
  const supabase = createServiceClient();

  // Query for last successful processing
  const { data, error } = await supabase
    .from('agent_actions_log')
    .select('created_at')
    .eq('agent_type', 'account_manager')
    .eq('action_type', 'processing_completed')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No records found - first time processing
      return null;
    }
    console.warn(`[Event Processor] Error fetching last processed time: ${error.message}`);
    return null;
  }

  return data.created_at;
}

/**
 * Categorizes events into actionable groups.
 *
 * Groups events by type to simplify priority scoring logic.
 *
 * @param events - Array of events to categorize
 * @returns Categorized events object
 */
export function categorizeEvents(events: Event[]): CategorizedEvents {
  const categorized: CategorizedEvents = {
    newIntros: [],
    communityRequests: [],
    responses: [],
    solutionUpdates: [],
    userResponses: [],
    other: [],
  };

  for (const event of events) {
    switch (event.event_type) {
      // Intro events
      case 'intro.opportunity_created':
        categorized.newIntros.push(event);
        break;

      // Community events
      case 'community.request_created':
      case 'community.request_routed':
        categorized.communityRequests.push(event);
        break;

      case 'community.response_received':
        categorized.responses.push(event);
        break;

      // Solution events
      case 'solution.initial_findings':
      case 'solution.research_complete':
        categorized.solutionUpdates.push(event);
        break;

      // User events
      case 'user.response.recorded':
      case 'user.intro_inquiry':
        categorized.userResponses.push(event);
        break;

      // Priority events
      case 'priority.intro_added':
        // Already in priorities table, skip
        break;

      // Default
      default:
        categorized.other.push(event);
        break;
    }
  }

  return categorized;
}

/**
 * Extracts relevant context from categorized events.
 *
 * Fetches full records for items referenced in events to provide
 * complete context for priority scoring.
 *
 * @param userId - The user ID to fetch context for
 * @param categorized - Categorized events
 * @param supabase - Supabase client instance
 * @returns Context object with full records
 */
export async function extractRelevantContext(
  userId: string,
  categorized: CategorizedEvents,
  supabase: SupabaseClient
): Promise<EventContext> {
  const context: EventContext = {
    introOpportunities: [],
    communityRequests: [],
    solutionWorkflows: [],
    metadata: {},
  };

  try {
    // Fetch intro opportunities
    const introIds = categorized.newIntros
      .map((e) => (e.payload as any).introId)
      .filter(Boolean);

    if (introIds.length > 0) {
      const { data: intros, error: introsError } = await supabase
        .from('intro_opportunities')
        .select('*')
        .in('id', introIds)
        .eq('status', 'open');

      if (introsError) {
        console.warn(`[Event Processor] Error fetching intros: ${introsError.message}`);
      } else {
        context.introOpportunities = (intros as IntroOpportunity[]) || [];
      }
    }

    // Also fetch all open intro opportunities for this user (not just from events)
    const { data: allIntros, error: allIntrosError } = await supabase
      .from('intro_opportunities')
      .select('*')
      .eq('connector_user_id', userId)
      .eq('status', 'open');

    if (!allIntrosError && allIntros) {
      // Merge with existing, avoiding duplicates
      const existingIds = new Set(context.introOpportunities.map((i) => i.id));
      for (const intro of allIntros as IntroOpportunity[]) {
        if (!existingIds.has(intro.id)) {
          context.introOpportunities.push(intro);
        }
      }
    }

    // Fetch community requests targeting this user
    const requestIds = categorized.communityRequests
      .map((e) => (e.payload as any).requestId)
      .filter(Boolean);

    if (requestIds.length > 0) {
      const { data: requests, error: requestsError } = await supabase
        .from('community_requests')
        .select('*')
        .in('id', requestIds)
        .eq('status', 'open');

      if (requestsError) {
        console.warn(`[Event Processor] Error fetching requests: ${requestsError.message}`);
      } else {
        context.communityRequests = (requests as CommunityRequest[]) || [];
      }
    }

    // Also fetch all open requests targeting this user
    const { data: allRequests, error: allRequestsError } = await supabase
      .from('community_requests')
      .select('*')
      .contains('target_user_ids', [userId])
      .eq('status', 'open');

    if (!allRequestsError && allRequests) {
      const existingIds = new Set(context.communityRequests.map((r) => r.id));
      for (const request of allRequests as CommunityRequest[]) {
        if (!existingIds.has(request.id)) {
          context.communityRequests.push(request);
        }
      }
    }

    // Fetch solution workflows
    const workflowIds = categorized.solutionUpdates
      .map((e) => (e.payload as any).workflowId)
      .filter(Boolean);

    if (workflowIds.length > 0) {
      const { data: workflows, error: workflowsError } = await supabase
        .from('solution_workflows')
        .select('*')
        .in('id', workflowIds)
        .eq('user_id', userId);

      if (workflowsError) {
        console.warn(`[Event Processor] Error fetching workflows: ${workflowsError.message}`);
      } else {
        context.solutionWorkflows = workflows || [];
      }
    }

    // Add metadata
    context.metadata = {
      totalEvents: Object.values(categorized).flat().length,
      introCount: context.introOpportunities.length,
      requestCount: context.communityRequests.length,
      workflowCount: context.solutionWorkflows.length,
    };

    console.log(
      `[Event Processor] Extracted context: ` +
        `${context.introOpportunities.length} intros, ` +
        `${context.communityRequests.length} requests, ` +
        `${context.solutionWorkflows.length} workflows`
    );

    return context;
  } catch (error) {
    console.error('[Event Processor] Error extracting context:', error);
    // Return partial context instead of throwing
    return context;
  }
}

/**
 * Marks events as processed.
 *
 * Updates the processed flag on events to prevent reprocessing.
 * Uses batch update for efficiency.
 *
 * @param eventIds - Array of event IDs to mark as processed
 * @param supabase - Supabase client instance
 */
export async function markEventsProcessed(
  eventIds: string[],
  supabase: SupabaseClient
): Promise<void> {
  if (eventIds.length === 0) return;

  const { error } = await supabase
    .from('events')
    .update({ processed: true })
    .in('id', eventIds);

  if (error) {
    console.warn(`[Event Processor] Error marking events as processed: ${error.message}`);
  } else {
    console.log(`[Event Processor] Marked ${eventIds.length} events as processed`);
  }
}

/**
 * Gets summary statistics for categorized events.
 *
 * Useful for logging and debugging.
 *
 * @param categorized - Categorized events
 * @returns Summary object with counts
 */
export function getCategorySummary(categorized: CategorizedEvents): Record<string, number> {
  return {
    newIntros: categorized.newIntros.length,
    communityRequests: categorized.communityRequests.length,
    responses: categorized.responses.length,
    solutionUpdates: categorized.solutionUpdates.length,
    userResponses: categorized.userResponses.length,
    other: categorized.other.length,
    total:
      categorized.newIntros.length +
      categorized.communityRequests.length +
      categorized.responses.length +
      categorized.solutionUpdates.length +
      categorized.userResponses.length +
      categorized.other.length,
  };
}

/**
 * Filters events by date range.
 *
 * @param events - Events to filter
 * @param startDate - Start date (inclusive)
 * @param endDate - End date (inclusive)
 * @returns Filtered events
 */
export function filterEventsByDateRange(
  events: Event[],
  startDate: Date,
  endDate: Date
): Event[] {
  return events.filter((event) => {
    const eventDate = new Date(event.created_at);
    return eventDate >= startDate && eventDate <= endDate;
  });
}

/**
 * Groups events by aggregate_id.
 *
 * Useful for processing events per entity.
 *
 * @param events - Events to group
 * @returns Map of aggregate_id to events
 */
export function groupEventsByAggregate(events: Event[]): Map<string, Event[]> {
  const grouped = new Map<string, Event[]>();

  for (const event of events) {
    if (!event.aggregate_id) continue;

    const existing = grouped.get(event.aggregate_id) || [];
    existing.push(event);
    grouped.set(event.aggregate_id, existing);
  }

  return grouped;
}

/**
 * Extracts unique user IDs from events.
 *
 * Useful for batch processing.
 *
 * @param events - Events to extract from
 * @returns Array of unique user IDs
 */
export function extractUserIdsFromEvents(events: Event[]): string[] {
  const userIds = new Set<string>();

  for (const event of events) {
    // Check aggregate_id if aggregate_type is 'user'
    if (event.aggregate_type === 'user' && event.aggregate_id) {
      userIds.add(event.aggregate_id);
    }

    // Check payload for userId fields
    const payload = event.payload as any;
    if (payload?.userId) {
      userIds.add(payload.userId);
    }
    if (payload?.connectorUserId) {
      userIds.add(payload.connectorUserId);
    }
    if (payload?.expertUserId) {
      userIds.add(payload.expertUserId);
    }
  }

  return Array.from(userIds);
}
