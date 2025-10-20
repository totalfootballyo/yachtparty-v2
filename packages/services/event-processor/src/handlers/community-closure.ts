/**
 * Community Request Closure Handler
 *
 * Handles automatic closure of community requests based on:
 * 1. Expiration (7 days since creation)
 * 2. All targeted experts have responded
 */

import { createServiceClient } from '@yachtparty/shared';

/**
 * Close expired community requests.
 *
 * Called by pg_cron job every hour to check for:
 * - Requests past their expires_at date
 * - Requests where all targeted experts have responded
 */
export async function closeExpiredCommunityRequests(): Promise<{
  closedCount: number;
  requestIds: string[];
}> {
  const supabase = createServiceClient();
  const closedRequestIds: string[] = [];

  console.log('[Community Closure] Starting closure check...');

  // 1. Find requests that have expired (past expires_at)
  const { data: expiredRequests, error: expiredError } = await supabase
    .from('community_requests')
    .select('id, question, expires_at, created_at')
    .eq('status', 'open')
    .lte('expires_at', new Date().toISOString());

  if (expiredError) {
    console.error('[Community Closure] Error fetching expired requests:', expiredError);
    throw expiredError;
  }

  console.log(`[Community Closure] Found ${expiredRequests?.length || 0} expired requests`);

  // 2. Find requests where all experts responded
  const { data: openRequests, error: openError } = await supabase
    .from('community_requests')
    .select('id, question, target_user_ids, responses_count')
    .in('status', ['open', 'responses_received']);

  if (openError) {
    console.error('[Community Closure] Error fetching open requests:', openError);
    throw openError;
  }

  const fullyRespondedRequests = (openRequests || []).filter((req: any) => {
    const targetCount = req.target_user_ids?.length || 0;
    const responseCount = req.responses_count || 0;
    return targetCount > 0 && responseCount >= targetCount;
  });

  console.log(`[Community Closure] Found ${fullyRespondedRequests.length} fully-responded requests`);

  // 3. Combine both sets of requests to close
  const requestsToClose = [
    ...(expiredRequests || []),
    ...fullyRespondedRequests,
  ].reduce((acc: any[], req: any) => {
    // Deduplicate by ID
    if (!acc.find((r) => r.id === req.id)) {
      acc.push(req);
    }
    return acc;
  }, []);

  console.log(`[Community Closure] Total requests to close: ${requestsToClose.length}`);

  // 4. Close each request
  for (const request of requestsToClose) {
    try {
      // Update request status
      await supabase
        .from('community_requests')
        .update({
          status: 'closed',
          closed_loop_at: new Date().toISOString(),
          closed_loop_message: 'Request closed - thank you to all experts who contributed insights.',
        })
        .eq('id', request.id);

      // Update all responses for this request
      await supabase
        .from('community_responses')
        .update({
          status: 'closed_loop',
          closed_loop_at: new Date().toISOString(),
        })
        .eq('request_id', request.id)
        .in('status', ['provided', 'rewarded']); // Don't update already closed-loop responses

      // Expire any remaining active priorities for this request
      await supabase
        .from('user_priorities')
        .update({
          status: 'expired',
        })
        .eq('item_type', 'community_request')
        .eq('item_id', request.id)
        .eq('status', 'active');

      closedRequestIds.push(request.id);
      console.log(`[Community Closure] ✓ Closed request ${request.id}: "${request.question?.substring(0, 50)}..."`);
    } catch (error) {
      console.error(`[Community Closure] Failed to close request ${request.id}:`, error);
    }
  }

  console.log(`[Community Closure] ✓ Closed ${closedRequestIds.length} requests`);

  return {
    closedCount: closedRequestIds.length,
    requestIds: closedRequestIds,
  };
}

/**
 * Health check endpoint for the closure cron job
 */
export async function getCommunityRequestsHealth(): Promise<{
  openRequests: number;
  expiredRequests: number;
  fullyRespondedRequests: number;
}> {
  const supabase = createServiceClient();

  // Count open requests
  const { count: openCount } = await supabase
    .from('community_requests')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'open');

  // Count expired requests
  const { count: expiredCount } = await supabase
    .from('community_requests')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'open')
    .lte('expires_at', new Date().toISOString());

  // Get requests for checking if fully responded
  const { data: openRequests } = await supabase
    .from('community_requests')
    .select('id, target_user_ids, responses_count')
    .in('status', ['open', 'responses_received']);

  const fullyRespondedCount = (openRequests || []).filter((req: any) => {
    const targetCount = req.target_user_ids?.length || 0;
    const responseCount = req.responses_count || 0;
    return targetCount > 0 && responseCount >= targetCount;
  }).length;

  return {
    openRequests: openCount || 0,
    expiredRequests: expiredCount || 0,
    fullyRespondedRequests: fullyRespondedCount,
  };
}
