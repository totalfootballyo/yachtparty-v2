/**
 * REFERENCE QUERY - Community Request Closure Candidates
 *
 * ⚠️ THIS IS NOT A SCHEMA MIGRATION - IT'S A REFERENCE QUERY
 *
 * This file contains a SELECT query that shows which community requests
 * are ready to be closed (either expired or fully responded).
 *
 * Safe to run: Yes - it just returns query results, makes no changes
 * Expected result: 0 rows if no community requests exist yet
 *
 * Actual closure is handled by:
 * - Google Cloud Scheduler job (runs every hour)
 * - Calls: POST /close-expired-requests on event-processor service
 * - Setup: ./scripts/setup-community-closure-scheduler.sh (already done ✅)
 *
 * Use this query to manually check which requests would be closed.
 */

-- Verification query to check for expired requests
-- (Can be run manually to see what would be closed)

SELECT
  id,
  question,
  status,
  created_at,
  expires_at,
  target_user_ids,
  responses_count,
  CASE
    WHEN expires_at < NOW() THEN 'EXPIRED'
    WHEN responses_count >= COALESCE(array_length(target_user_ids, 1), 0) THEN 'FULLY_RESPONDED'
    ELSE 'STILL_OPEN'
  END as closure_reason
FROM community_requests
WHERE status IN ('open', 'responses_received')
  AND (
    expires_at < NOW()
    OR responses_count >= COALESCE(array_length(target_user_ids, 1), 0)
  );

-- Note: The actual closure is handled by:
-- POST https://event-processor-82471900833.us-central1.run.app/close-expired-requests
