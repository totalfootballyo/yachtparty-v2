-- Check for existing re-engagement tasks
SELECT
  id,
  task_type,
  agent_type,
  user_id,
  status,
  scheduled_for,
  created_at,
  context_json
FROM agent_tasks
WHERE task_type = 're_engagement_check'
ORDER BY created_at DESC
LIMIT 20;

-- Delete all re-engagement tasks (pending, processing, and completed)
DELETE FROM agent_tasks
WHERE task_type = 're_engagement_check';

-- Verify they're all gone
SELECT COUNT(*) as remaining_tasks
FROM agent_tasks
WHERE task_type = 're_engagement_check';
