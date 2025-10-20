-- Delete immediate re-engagement tasks (delay < 1 hour)
DELETE FROM agent_tasks
WHERE task_type = 're_engagement_check'
AND (scheduled_for - created_at) < interval '1 hour';

-- Show remaining tasks
SELECT
  id,
  task_type,
  status,
  scheduled_for,
  created_at,
  (scheduled_for - created_at) as delay
FROM agent_tasks
WHERE task_type = 're_engagement_check'
ORDER BY created_at DESC;
