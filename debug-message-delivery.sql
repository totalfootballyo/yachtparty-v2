-- Debug Message Delivery Mechanism
-- Run these queries to understand how messages get sent

-- 1. Check all triggers on messages table
SELECT
    trigger_name,
    event_manipulation,
    action_statement,
    action_timing
FROM information_schema.triggers
WHERE event_object_table = 'messages'
ORDER BY trigger_name;

// result:
//| trigger_name               | event_manipulation | action_statement                              | action_timing |
| -------------------------- | ------------------ | --------------------------------------------- | ------------- |
| on_message_count_check     | INSERT             | EXECUTE FUNCTION check_conversation_summary() | AFTER         |
| on_message_send            | INSERT             | EXECUTE FUNCTION notify_send_sms()            | AFTER         |
| send_sms_on_message_insert | INSERT             | EXECUTE FUNCTION send_sms_webhook()           | AFTER         |

-- 2. Show the actual trigger function code for notify_send_sms
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'notify_send_sms';

//result | pg_get_functiondef                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CREATE OR REPLACE FUNCTION public.notify_send_sms()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.direction = 'outbound' AND NEW.status = 'pending' THEN
    -- Publish notification for SMS sender service
    PERFORM pg_notify('send_sms', row_to_json(NEW)::text);

    -- Mark message as queued for sending
    UPDATE messages
    SET status = 'queued_for_send'
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$
 |

-- 3. Show the actual trigger function code for send_sms_webhook (if exists)
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'send_sms_webhook';

// result: | pg_get_functiondef                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CREATE OR REPLACE FUNCTION public.send_sms_webhook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
  DECLARE
    request_id bigint;
    payload jsonb;
  BEGIN
    -- Build the payload
    payload := jsonb_build_object(
      'type', TG_OP,
      'table', TG_TABLE_NAME,
      'record', row_to_json(NEW),
      'old_record', NULL
    );

    -- Make HTTP request using pg_net (correct syntax)
    SELECT net.http_post(
      url := 'https://sms-sender-ywaprnbliq-uc.a.run.app/send-sms',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := payload
    ) INTO request_id;

    RETURN NEW;
  END;
  $function$
 |

-- 4. Check if pg_cron extension is installed and what jobs exist
SELECT * FROM pg_extension WHERE extname = 'pg_cron';

// result: Success. No rows returned

-- 5. If pg_cron exists, show all scheduled jobs
SELECT
    jobid,
    schedule,
    command,
    nodename,
    nodeport,
    database,
    username,
    active
FROM cron.job
ORDER BY jobid;

// result: ERROR:  42P01: relation "cron.job" does not exist
LINE 10: FROM cron.job

-- 6. Check if pg_net extension is installed (for HTTP webhooks)
SELECT * FROM pg_extension WHERE extname = 'pg_net';

// result: | oid   | extname | extowner | extnamespace | extrelocatable | extversion | extconfig | extcondition |
| ----- | ------- | -------- | ------------ | -------------- | ---------- | --------- | ------------ |
| 29571 | pg_net  | 10       | 16388        | false          | 0.19.5     | null      | null         |

-- 7. Check recent message delivery timing
-- This shows how long messages sit in each status
SELECT
    id,
    status,
    direction,
    created_at,
    sent_at,
    EXTRACT(EPOCH FROM (sent_at - created_at)) as seconds_to_send,
    EXTRACT(EPOCH FROM (now() - created_at)) as age_seconds
FROM messages
WHERE direction = 'outbound'
  AND created_at > now() - interval '1 hour'
ORDER BY created_at DESC
LIMIT 20;

// result:
| id                                   | status | direction | created_at                    | sent_at                    | seconds_to_send | age_seconds |
| ------------------------------------ | ------ | --------- | ----------------------------- | -------------------------- | --------------- | ----------- |
| f4b9b463-bd52-4aa0-ad18-d8b23726e5b2 | sent   | outbound  | 2025-10-20 03:01:27.326026+00 | 2025-10-20 03:01:29.836+00 | 2.509974        | 706.636386  |
| 762ca8ae-ab71-42f7-9a91-50bcfcfe4ff8 | sent   | outbound  | 2025-10-20 02:52:01.225205+00 | 2025-10-20 02:52:53.236+00 | 52.010795       | 1272.737207 |
| 3eb6e3f9-bc17-46f6-ac41-e34b763e46f7 | sent   | outbound  | 2025-10-20 02:36:15.423384+00 | 2025-10-20 02:36:16.849+00 | 1.425616        | 2218.539028 |
| 23c87801-3ead-47c7-b948-d45fbe5133b0 | sent   | outbound  | 2025-10-20 02:35:44.673282+00 | 2025-10-20 02:35:45.549+00 | 0.875718        | 2249.289130 |
| 7def23ff-1e38-4413-8ba5-0b837e331ca8 | sent   | outbound  | 2025-10-20 02:35:30.553105+00 | 2025-10-20 02:35:31.35+00  | 0.796895        | 2263.409307 |
| da5c295c-b434-45b9-b8c0-6957438cdb75 | sent   | outbound  | 2025-10-20 02:35:10.854934+00 | 2025-10-20 02:35:11.338+00 | 0.483066        | 2283.107478 |
| d2e3cbbf-162d-45e4-9b42-cc1996a8cb23 | sent   | outbound  | 2025-10-20 02:33:13.351238+00 | 2025-10-20 02:34:57.248+00 | 103.896762      | 2400.611174 |

-- 8. Check for messages currently stuck in queued_for_send
SELECT
    id,
    status,
    created_at,
    EXTRACT(EPOCH FROM (now() - created_at)) as stuck_for_seconds,
    content
FROM messages
WHERE status = 'queued_for_send'
  AND created_at > now() - interval '1 hour'
ORDER BY created_at DESC;

// result: Success. No rows returned

-- 9. Show pg_notify listeners (if any)
SELECT * FROM pg_stat_activity
WHERE state = 'idle in transaction'
   OR query LIKE '%LISTEN%';

// result:
| datid | datname  | pid    | leader_pid | usesysid | usename       | application_name                | client_addr                           | client_hostname | client_port | backend_start                 | xact_start                    | query_start                   | state_change                  | wait_event_type | wait_event | state  | backend_xid | backend_xmin | query_id             | query                                                                                                                                                                                                           | backend_type   |
| ----- | -------- | ------ | ---------- | -------- | ------------- | ------------------------------- | ------------------------------------- | --------------- | ----------- | ----------------------------- | ----------------------------- | ----------------------------- | ----------------------------- | --------------- | ---------- | ------ | ----------- | ------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 5     | postgres | 112713 | null       | 16483    | authenticator | postgrest                       | ::1                                   | null            | 27007       | 2025-10-15 18:05:47.501687+00 | null                          | 2025-10-15 18:05:47.554632+00 | 2025-10-15 18:05:47.555286+00 | Client          | ClientRead | idle   | null        | null         | 658074698259335373   | LISTEN "pgrst"                                                                                                                                                                                                  | client backend |
| 5     | postgres | 302784 | null       | 16384    | postgres      | supabase/dashboard-query-editor | 2600:1f1c:778:2c00:e017:79a:61e9:bbb9 | null            | 58700       | 2025-10-20 03:14:04.120384+00 | 2025-10-20 03:14:04.437576+00 | 2025-10-20 03:14:04.437576+00 | 2025-10-20 03:14:04.437579+00 | null            | null       | active | null        | 3565         | -2626468777918554107 | SELECT * FROM pg_stat_activity
WHERE state = 'idle in transaction'
   OR query LIKE '%LISTEN%' limit 100;

-- source: dashboard
-- user: 853d4eb3-d069-466f-8134-e61af4457f94
-- date: 2025-10-20T03:14:04.045Z | client backend |