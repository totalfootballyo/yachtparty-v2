-- Migration 005: pg_cron Scheduled Tasks for Yachtparty
-- Sets up automated background processing for agent tasks and message queue

-- Enable pg_cron extension (requires superuser, should be enabled in Supabase dashboard)
-- This migration assumes pg_cron is already enabled

-- ============================================================================
-- AGENT TASKS PROCESSOR
-- ============================================================================

-- Function: process_tasks_batch()
-- Purpose: Publishes agent.task_ready events for pending tasks
-- Schedule: Every 2 minutes via pg_cron
-- Batch Size: 20 tasks per run
-- Uses FOR UPDATE SKIP LOCKED to prevent duplicate processing

CREATE OR REPLACE FUNCTION process_tasks_batch()
RETURNS void AS $$
DECLARE
  task RECORD;
  tasks_processed INTEGER := 0;
BEGIN
  -- Fetch pending tasks in priority order
  FOR task IN
    SELECT * FROM agent_tasks
    WHERE status = 'pending'
      AND scheduled_for <= now()
    ORDER BY
      CASE priority
        WHEN 'urgent' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
      END,
      scheduled_for ASC
    LIMIT 20
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Publish event for Cloud Run services to process
    INSERT INTO events (
      event_type,
      aggregate_id,
      aggregate_type,
      payload,
      created_by,
      metadata
    )
    VALUES (
      'agent.task_ready',
      task.id,
      'agent_task',
      jsonb_build_object(
        'task_id', task.id,
        'task_type', task.task_type,
        'agent_type', task.agent_type,
        'user_id', task.user_id,
        'context_id', task.context_id,
        'context_type', task.context_type,
        'context', task.context_json,
        'priority', task.priority,
        'retry_count', task.retry_count
      ),
      'task_processor_cron',
      jsonb_build_object(
        'scheduled_for', task.scheduled_for,
        'created_at', task.created_at
      )
    );

    -- Mark task as processing
    UPDATE agent_tasks
    SET
      status = 'processing',
      last_attempted_at = now()
    WHERE id = task.id;

    tasks_processed := tasks_processed + 1;
  END LOOP;

  -- Log processing summary if any tasks were processed
  IF tasks_processed > 0 THEN
    RAISE NOTICE 'Processed % agent tasks', tasks_processed;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION process_tasks_batch() IS
'Processes pending agent tasks by publishing events for Cloud Run services. Runs every 2 minutes via pg_cron.';


-- Schedule: Run every 2 minutes
-- Processes background tasks like:
-- - Re-engagement checks
-- - Account Manager processing
-- - Solution workflow timeouts
-- - Conversation summarization
-- - Intro follow-ups
SELECT cron.schedule(
  'process-agent-tasks',
  '*/2 * * * *',
  $$SELECT process_tasks_batch();$$
);

COMMENT ON FUNCTION cron.schedule IS
'Scheduled job: process-agent-tasks runs every 2 minutes to process pending agent tasks';


-- ============================================================================
-- MESSAGE QUEUE PROCESSOR
-- ============================================================================

-- Function: process_outbound_messages()
-- Purpose: Publishes message.ready_to_send events for queued messages
-- Schedule: Every 1 minute via pg_cron
-- Batch Size: 50 messages per run
-- Handles rate limiting, quiet hours, and priority-based delivery

CREATE OR REPLACE FUNCTION process_outbound_messages()
RETURNS void AS $$
DECLARE
  msg RECORD;
  messages_processed INTEGER := 0;
BEGIN
  -- Fetch queued messages in priority order
  -- Joins with users table to get user context for rate limiting checks
  FOR msg IN
    SELECT
      mq.*,
      u.timezone,
      u.quiet_hours_start,
      u.quiet_hours_end,
      u.last_active_at,
      u.phone_number
    FROM message_queue mq
    JOIN users u ON mq.user_id = u.id
    WHERE mq.status = 'queued'
      AND mq.scheduled_for <= now()
    ORDER BY
      CASE mq.priority
        WHEN 'urgent' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
      END,
      mq.scheduled_for ASC
    LIMIT 50
    FOR UPDATE OF mq SKIP LOCKED
  LOOP
    -- Publish event for Message Orchestrator to handle
    -- The orchestrator will perform rate limit checks, quiet hours validation,
    -- message relevance checks, and final message rendering
    INSERT INTO events (
      event_type,
      aggregate_id,
      aggregate_type,
      payload,
      created_by,
      metadata
    )
    VALUES (
      'message.ready_to_send',
      msg.id,
      'message_queue',
      jsonb_build_object(
        'message_queue_id', msg.id,
        'user_id', msg.user_id,
        'agent_id', msg.agent_id,
        'message_data', msg.message_data,
        'final_message', msg.final_message,
        'priority', msg.priority,
        'scheduled_for', msg.scheduled_for,
        'requires_fresh_context', msg.requires_fresh_context,
        'conversation_context_id', msg.conversation_context_id,
        'user_context', jsonb_build_object(
          'timezone', msg.timezone,
          'quiet_hours_start', msg.quiet_hours_start,
          'quiet_hours_end', msg.quiet_hours_end,
          'last_active_at', msg.last_active_at,
          'phone_number', msg.phone_number
        )
      ),
      'message_queue_processor_cron',
      jsonb_build_object(
        'created_at', msg.created_at,
        'batch_time', now()
      )
    );

    -- Mark message as processing
    -- The Message Orchestrator will update status to 'sent', 'superseded', or 'cancelled'
    UPDATE message_queue
    SET status = 'processing'
    WHERE id = msg.id;

    messages_processed := messages_processed + 1;
  END LOOP;

  -- Log processing summary if any messages were processed
  IF messages_processed > 0 THEN
    RAISE NOTICE 'Published % queued messages for delivery', messages_processed;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION process_outbound_messages() IS
'Processes queued outbound messages by publishing events for Message Orchestrator. Runs every 1 minute via pg_cron.';


-- Schedule: Run every 1 minute
-- Processes messages that were:
-- - Scheduled for optimal send time
-- - Delayed due to quiet hours
-- - Waiting for rate limit slots
-- - Queued by background agents (non-immediate responses)
SELECT cron.schedule(
  'process-message-queue',
  '* * * * *',
  $$SELECT process_outbound_messages();$$
);

COMMENT ON FUNCTION cron.schedule IS
'Scheduled job: process-message-queue runs every 1 minute to process queued outbound messages';


-- ============================================================================
-- CRON JOB MONITORING
-- ============================================================================

-- View: cron_job_status
-- Purpose: Monitor pg_cron job execution history and status
CREATE OR REPLACE VIEW cron_job_status AS
SELECT
  j.jobid,
  j.jobname,
  j.schedule,
  j.command,
  j.active,
  r.runid,
  r.job_pid,
  r.database,
  r.username,
  r.command as last_command,
  r.status as last_status,
  r.return_message as last_return_message,
  r.start_time as last_start_time,
  r.end_time as last_end_time
FROM cron.job j
LEFT JOIN LATERAL (
  SELECT *
  FROM cron.job_run_details
  WHERE jobid = j.jobid
  ORDER BY start_time DESC
  LIMIT 1
) r ON true
WHERE j.jobname IN ('process-agent-tasks', 'process-message-queue')
ORDER BY j.jobname;

COMMENT ON VIEW cron_job_status IS
'Monitoring view for pg_cron jobs - shows current configuration and last execution status';


-- ============================================================================
-- UTILITY FUNCTIONS
-- ============================================================================

-- Function: get_pending_tasks_count()
-- Purpose: Quick count of pending tasks for monitoring
CREATE OR REPLACE FUNCTION get_pending_tasks_count()
RETURNS TABLE (
  agent_type VARCHAR(50),
  priority VARCHAR(20),
  count BIGINT,
  oldest_scheduled_for TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    at.agent_type,
    at.priority,
    COUNT(*) as count,
    MIN(at.scheduled_for) as oldest_scheduled_for
  FROM agent_tasks at
  WHERE at.status = 'pending'
    AND at.scheduled_for <= now()
  GROUP BY at.agent_type, at.priority
  ORDER BY
    CASE at.priority
      WHEN 'urgent' THEN 1
      WHEN 'high' THEN 2
      WHEN 'medium' THEN 3
      WHEN 'low' THEN 4
    END,
    at.agent_type;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_pending_tasks_count() IS
'Returns count of pending tasks grouped by agent type and priority';


-- Function: get_queued_messages_count()
-- Purpose: Quick count of queued messages for monitoring
CREATE OR REPLACE FUNCTION get_queued_messages_count()
RETURNS TABLE (
  priority VARCHAR(20),
  count BIGINT,
  oldest_scheduled_for TIMESTAMPTZ,
  newest_scheduled_for TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    mq.priority,
    COUNT(*) as count,
    MIN(mq.scheduled_for) as oldest_scheduled_for,
    MAX(mq.scheduled_for) as newest_scheduled_for
  FROM message_queue mq
  WHERE mq.status = 'queued'
    AND mq.scheduled_for <= now()
  GROUP BY mq.priority
  ORDER BY
    CASE mq.priority
      WHEN 'urgent' THEN 1
      WHEN 'high' THEN 2
      WHEN 'medium' THEN 3
      WHEN 'low' THEN 4
    END;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_queued_messages_count() IS
'Returns count of queued messages grouped by priority';


-- ============================================================================
-- NOTES
-- ============================================================================

-- IMPORTANT: pg_cron extension must be enabled before running this migration
-- Enable via Supabase dashboard: Database > Extensions > pg_cron

-- Cron schedule format: minute hour day month weekday
-- Examples:
--   */2 * * * *  = Every 2 minutes
--   * * * * *    = Every minute
--   0 */6 * * *  = Every 6 hours at minute 0
--   0 0 * * *    = Daily at midnight

-- To view scheduled jobs:
--   SELECT * FROM cron.job;

-- To view job run history:
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;

-- To unschedule a job:
--   SELECT cron.unschedule('process-agent-tasks');
--   SELECT cron.unschedule('process-message-queue');

-- To manually trigger a job (for testing):
--   SELECT process_tasks_batch();
--   SELECT process_outbound_messages();

-- Monitoring queries:
--   SELECT * FROM cron_job_status;
--   SELECT * FROM get_pending_tasks_count();
--   SELECT * FROM get_queued_messages_count();
