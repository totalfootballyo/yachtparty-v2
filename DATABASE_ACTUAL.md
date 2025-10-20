# DATABASE_ACTUAL.md - Yachtparty Database State Documentation

**Last Updated:** October 15, 2025
**Purpose:** Authoritative reference mapping what's ACTUALLY in the Supabase database vs. requirements.md
**Audience:** Sub-agents, developers, debugging sessions

---

## 1. Executive Summary

### Quick Overview

**Database State:**
- 5 migration files exist, defining 15+ tables
- Migrations 001, 003, 004 have DEFINITELY been applied
- Migrations 002, 005 PROBABLY applied but not confirmed
- 4 tables actively used (users, conversations, messages, agent_actions_log)
- 11+ tables exist but are EMPTY (no data being written)
- 5 triggers active and functioning

**Active vs. Dormant:**
- **Active (Data Flowing):** users, conversations, messages, agent_actions_log
- **Exist But Empty:** events, agent_tasks, message_queue, user_message_budget, user_priorities, solution_workflows, intro_opportunities, community_requests, community_responses, credit_events
- **Infrastructure Only:** prospects, innovators, agent_instances

**Critical Insight:**
The database schema is **fully built** but only ~25% is being used. Most agent-coordination tables exist but remain empty because the event-driven architecture and specialized agents (Account Manager, Solution Saga, etc.) are not deployed.

---

## 2. Migration Status

### Migration 001: Core Tables (`001_core_tables.sql`)

**Status:** ✅ CONFIRMED APPLIED

**Evidence:**
- `conversations` table has `messages_since_summary` column (added in migration 003, line 135)
- This column references the base conversations table from 001
- Therefore 001 must have been applied first

**What It Creates:**

1. **users** (lines 16-50)
   - Status: ✅ Active, populated
   - Used by: twilio-webhook service for user lookup/creation

2. **conversations** (lines 69-83)
   - Status: ✅ Active, populated
   - Used by: twilio-webhook for conversation tracking

3. **messages** (lines 100-118)
   - Status: ✅ Active, populated
   - Used by: twilio-webhook (writes), sms-sender (reads)

4. **events** (lines 136-168)
   - Status: ⚠️ Exists, but processed=false forever
   - Used by: twilio-webhook writes events, but NO consumers
   - Issue: Events accumulate without being processed

5. **agent_tasks** (lines 199-230)
   - Status: ⚠️ Exists, tasks created but NOT processed
   - Used by: Bouncer/Concierge create tasks, but no task processor running

6. **message_queue** (lines 249-276)
   - Status: ❌ Exists but completely unused
   - Reason: Message Orchestrator not deployed

7. **user_message_budget** (lines 297-317)
   - Status: ❌ Exists but completely unused
   - Reason: Rate limiting not active

**Triggers Created:**
- `notify_event()` function (lines 170-184)
- `on_event_created` trigger (lines 186-189)
- Status: ✅ Active, fires on event INSERT

**Extensions Enabled:**
- `pgcrypto` (line 9) - for UUID generation

---

### Migration 002: Agent Tables (`002_agent_tables.sql`)

**Status:** ❓ PROBABLY APPLIED (not confirmed)

**Evidence:**
- CURRENT_STATUS.md mentions these tables "probably applied but not confirmed"
- Concierge agent queries `user_priorities` table (twilio-webhook line 586-592)
- Query doesn't error out, suggesting table exists

**What It Creates:**

1. **user_priorities** (lines 13-31)
   - Status: ⚠️ Exists but EMPTY
   - Reason: Account Manager agent not deployed (would populate this)

2. **solution_workflows** (lines 43-73)
   - Status: ⚠️ Exists but EMPTY
   - Reason: Solution Saga agent not implemented

3. **intro_opportunities** (lines 87-121)
   - Status: ⚠️ Exists but EMPTY
   - Reason: Social Butterfly and Intro agents not implemented

4. **community_requests** (lines 138-166)
   - Status: ⚠️ Exists but EMPTY
   - Reason: Agent of Humans not implemented

5. **community_responses** (lines 183-207)
   - Status: ⚠️ Exists but EMPTY
   - Reason: Agent of Humans not implemented

6. **credit_events** (lines 224-241)
   - Status: ⚠️ Exists but EMPTY
   - Reason: Credit system not active (no credit earning/spending)

**Views Created:**
- `user_credit_balances` (lines 258-266)
- Status: ✅ Exists, returns empty results (no credit_events)

**Triggers Created:**
- `update_user_credit_cache()` function (lines 275-287)
- `on_credit_event_processed` trigger (lines 289-293)
- Status: ✅ Exists, would fire if credit_events were written

---

### Migration 003: Supporting Tables (`003_supporting_tables.sql`)

**Status:** ✅ CONFIRMED APPLIED

**Evidence:**
- `conversations.messages_since_summary` column exists (line 135)
- This column is queried by conversation summary trigger from migration 004

**What It Creates:**

1. **prospects** (lines 10-26)
   - Status: ⚠️ Exists, no usage
   - Purpose: Track individuals not yet on platform
   - Used by: Would be used by Social Butterfly (not implemented)

2. **innovators** (lines 37-55)
   - Status: ⚠️ Exists, no usage
   - Purpose: Extended profile for solution providers
   - Used by: Would be populated during onboarding (not implemented)

3. **agent_instances** (lines 69-84)
   - Status: ⚠️ Exists, no usage
   - Purpose: Track agent configuration versions
   - Used by: Would be used for A/B testing prompts (not implemented)

4. **agent_actions_log** (lines 96-122)
   - Status: ✅ Active (would be used by Bouncer package)
   - Purpose: Comprehensive logging for debugging and cost tracking
   - Used by: Separate agent packages log here (but embedded agents don't)

**Table Alterations:**
- `ALTER TABLE conversations ADD COLUMN messages_since_summary INTEGER DEFAULT 0` (line 135)
- Status: ✅ Applied, used by conversation summary trigger

**Indexes Created:**
- All indexes from lines 28-30, 57-59, 86-88, 124-127
- Status: ✅ Created

---

### Migration 004: Triggers (`004_triggers.sql`)

**Status:** ✅ CONFIRMED APPLIED

**Evidence:**
- SMS sending works via `notify_send_sms()` trigger
- sms-sender receives webhook calls when messages inserted

**What It Creates:**

1. **notify_event() Function & Trigger** (lines 19-41)
   - Status: ✅ Active
   - Fires: After INSERT on events table
   - Action: Publishes to PostgreSQL NOTIFY channel 'agent_events'
   - Usage: Events published but no subscribers listening

2. **update_user_credit_cache() Function & Trigger** (lines 56-77)
   - Status: ✅ Active (dormant - no credit_events)
   - Fires: After INSERT/UPDATE on credit_events WHERE processed=true
   - Action: Updates users.credit_balance
   - Usage: Would fire if credit_events were written

3. **check_conversation_summary() Function & Trigger** (lines 86-132)
   - Status: ✅ Active
   - Fires: After INSERT on messages table
   - Action: Increments messages_since_summary, creates summarization task every 50 messages
   - Usage: Active, creates tasks in agent_tasks table
   - Issue: Tasks created but no processor to execute them

4. **handle_phone_number_change() Function & Trigger** (lines 140-178)
   - Status: ✅ Active
   - Fires: Before UPDATE on users WHERE phone_number changes
   - Action: Archives old number to phone_number_history, closes old conversations
   - Issue: References `phone_number_history` column that doesn't exist in schema!
   - **Schema Gap:** Migration references non-existent column

5. **notify_send_sms() Function & Trigger** (lines 186-212)
   - Status: ✅ Active, CRITICAL PATH
   - Fires: After INSERT on messages WHERE direction='outbound' AND status='pending'
   - Action: Publishes to PostgreSQL NOTIFY channel 'send_sms', updates status to 'queued_for_send'
   - Usage: This is how SMS sending works in production

**Critical Note:**
The `handle_phone_number_change()` trigger references `phone_number_history` column that is NOT defined in any migration. This trigger will ERROR if a phone number is changed.

---

### Migration 005: pg_cron (`005_pg_cron.sql`)

**Status:** ❓ PROBABLY APPLIED (pg_cron enabled but jobs not confirmed)

**Evidence:**
- CURRENT_STATUS.md says "pg_cron extension enabled but no jobs configured"
- Functions would be created even if jobs aren't scheduled

**What It Creates:**

1. **process_tasks_batch() Function** (lines 17-85)
   - Status: ✅ Exists (function created)
   - Purpose: Publishes agent.task_ready events for pending tasks
   - Usage: Should run every 2 minutes via cron, but NOT CONFIRMED

2. **process_outbound_messages() Function** (lines 118-203)
   - Status: ✅ Exists (function created)
   - Purpose: Publishes message.ready_to_send events for queued messages
   - Usage: Should run every 1 minute via cron, but NOT USED (no messages in queue)

3. **Cron Jobs** (lines 98-102, 215-219)
   - `process-agent-tasks` - Every 2 minutes
   - `process-message-queue` - Every 1 minute
   - Status: ❓ Unknown if actually scheduled
   - Check: `SELECT * FROM cron.job;`

4. **Monitoring Views & Functions**
   - `cron_job_status` view (lines 231-256)
   - `get_pending_tasks_count()` function (lines 266-295)
   - `get_queued_messages_count()` function (lines 301-329)
   - Status: ✅ Created, available for monitoring

**To Verify Migration 005:**
```sql
-- Check if pg_cron extension is enabled
SELECT * FROM pg_extension WHERE extname = 'pg_cron';

-- Check if cron jobs are scheduled
SELECT * FROM cron.job WHERE jobname IN ('process-agent-tasks', 'process-message-queue');
```

---

## 3. Table-by-Table Status

### Core Tables (Migration 001)

#### users

**Schema:**
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number VARCHAR(20) UNIQUE NOT NULL,
  email VARCHAR(255),
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  company VARCHAR(255),
  title VARCHAR(255),
  linkedin_url VARCHAR(500),

  -- User classification
  verified BOOLEAN DEFAULT FALSE,
  innovator BOOLEAN DEFAULT FALSE,
  expert_connector BOOLEAN DEFAULT FALSE,
  expertise TEXT[],

  -- Agent assignment
  poc_agent_id VARCHAR(50),
  poc_agent_type VARCHAR(50), -- 'bouncer', 'concierge', 'innovator'

  -- User preferences
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  timezone VARCHAR(50),
  response_pattern JSONB,

  -- Credits and status
  credit_balance INTEGER DEFAULT 0,
  status_level VARCHAR(50) DEFAULT 'member',

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_active_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_users_phone ON users(phone_number);
CREATE INDEX idx_users_verified ON users(verified);
CREATE INDEX idx_users_poc_agent ON users(poc_agent_type, verified);
```

**Status:** ✅ ACTIVELY USED

**Migration:** 001_core_tables.sql (lines 16-56)

**Used By:**
- `/packages/services/twilio-webhook/src/index.ts` (lines 218-309)
  - Finds or creates users by phone_number
  - Updates user fields (name, company, email, etc.)
  - Checks verified status to route to correct agent

**Key Fields in Use:**
- `phone_number` - Lookup key for incoming SMS
- `verified` - Determines Bouncer vs. Concierge routing
- `poc_agent_type` - Agent assignment ('bouncer', 'concierge', 'innovator')
- `first_name`, `last_name`, `company`, `title`, `email`, `linkedin_url` - Collected during onboarding
- `created_at`, `updated_at` - Tracking

**Key Fields NOT Used:**
- `expertise` - Array for community matching (no Agent of Humans)
- `expert_connector` - Flag not set anywhere
- `innovator` - Flag not set anywhere (separate innovators table exists)
- `poc_agent_id` - Not set (only poc_agent_type used)
- `quiet_hours_start`, `quiet_hours_end`, `timezone` - Not enforced (no Message Orchestrator)
- `response_pattern` - JSONB not populated (no ML learning)
- `credit_balance` - Always 0 (no credit system active)
- `status_level` - Always 'member' (not used)
- `last_active_at` - Not updated

**Common Queries:**

```sql
-- Find user by phone number (webhook critical path)
SELECT * FROM users WHERE phone_number = '+14155551234';

-- Create new user from SMS
INSERT INTO users (phone_number, verified, poc_agent_type, created_at)
VALUES ('+14155551234', false, 'bouncer', now())
RETURNING *;

-- Update user info during onboarding
UPDATE users
SET first_name = 'Jane',
    last_name = 'Smith',
    company = 'Acme Corp',
    email = 'jane@acme.com',
    updated_at = now()
WHERE id = 'user-uuid';

-- Mark user as verified and transition to Concierge
UPDATE users
SET verified = true,
    poc_agent_type = 'concierge',
    updated_at = now()
WHERE id = 'user-uuid';
```

**Schema Gap:**
- Missing `phone_number_history JSONB` column referenced by `handle_phone_number_change()` trigger

---

#### conversations

**Schema:**
```sql
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  phone_number VARCHAR(20) NOT NULL, -- Denormalized for quick lookup
  status VARCHAR(50) DEFAULT 'active', -- active, paused, completed

  -- Context management
  conversation_summary TEXT,
  last_summary_message_id UUID,
  messages_since_summary INTEGER DEFAULT 0, -- Added in migration 003

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_message_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_conversations_user ON conversations(user_id);
CREATE INDEX idx_conversations_phone ON conversations(phone_number);
CREATE INDEX idx_conversations_status ON conversations(status, updated_at);
```

**Status:** ✅ ACTIVELY USED

**Migration:** 001_core_tables.sql (lines 69-88) + 003_supporting_tables.sql (line 135)

**Used By:**
- `/packages/services/twilio-webhook/src/index.ts` (lines 232-263)
  - Finds or creates conversation by phone_number
- `check_conversation_summary()` trigger (004_triggers.sql lines 86-132)
  - Increments messages_since_summary
  - Creates summarization task every 50 messages

**Key Fields in Use:**
- `user_id` - Foreign key to users table
- `phone_number` - Denormalized for fast webhook lookups
- `status` - Always 'active' (other states not used)
- `messages_since_summary` - Incremented by trigger, reset after summary task created
- `created_at`, `updated_at` - Tracking

**Key Fields NOT Used:**
- `conversation_summary` - Never populated (no summarization processor)
- `last_summary_message_id` - Never set
- `last_message_at` - Not updated

**Common Queries:**

```sql
-- Find active conversation by phone number (webhook critical path)
SELECT * FROM conversations
WHERE phone_number = '+14155551234'
  AND status = 'active'
ORDER BY created_at DESC
LIMIT 1;

-- Create new conversation
INSERT INTO conversations (user_id, phone_number, status, created_at)
VALUES ('user-uuid', '+14155551234', 'active', now())
RETURNING *;

-- Get message count since last summary
SELECT messages_since_summary FROM conversations WHERE id = 'conv-uuid';
```

---

#### messages

**Schema:**
```sql
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) NOT NULL,
  user_id UUID REFERENCES users(id) NOT NULL,

  -- Message content
  role VARCHAR(50) NOT NULL, -- 'user', 'concierge', 'bouncer', 'innovator', 'system'
  content TEXT NOT NULL,

  -- Delivery tracking
  direction VARCHAR(20) NOT NULL, -- 'inbound', 'outbound'
  twilio_message_sid VARCHAR(100),
  status VARCHAR(50), -- 'queued', 'sent', 'delivered', 'failed', 'pending', 'queued_for_send'

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at DESC);
CREATE INDEX idx_messages_user ON messages(user_id, created_at DESC);
CREATE INDEX idx_messages_twilio ON messages(twilio_message_sid);
```

**Status:** ✅ ACTIVELY USED (Critical Path)

**Migration:** 001_core_tables.sql (lines 100-124)

**Used By:**
- `/packages/services/twilio-webhook/src/index.ts`
  - Writes inbound messages (lines 321-349)
  - Writes outbound messages with status='pending' (lines 750-778)
- `/packages/services/sms-sender/src/index.ts`
  - Reads messages triggered by notify_send_sms()
  - Updates with twilio_message_sid and status='sent' (lines 150-180)
- `notify_send_sms()` trigger (004_triggers.sql lines 186-212)
  - Fires on INSERT WHERE direction='outbound' AND status='pending'
  - Updates status to 'queued_for_send'
- `check_conversation_summary()` trigger (004_triggers.sql lines 86-132)
  - Counts messages to determine when to summarize

**Status Values Used:**
- `pending` - Outbound message created by agent (triggers SMS send)
- `queued_for_send` - Updated by trigger after pg_notify
- `sent` - Updated by sms-sender after Twilio API call
- `delivered` - NOT USED (Twilio delivery webhooks not implemented)
- `failed` - Set by sms-sender on retry exhaustion

**Role Values Used:**
- `user` - Inbound SMS from user
- `bouncer` - Outbound from Bouncer agent
- `concierge` - Outbound from Concierge agent
- `innovator` - Outbound from Innovator agent (currently just wraps Concierge)
- `system` - NOT USED

**Common Queries:**

```sql
-- Get recent conversation history (agent context)
SELECT role, content, created_at
FROM messages
WHERE conversation_id = 'conv-uuid'
ORDER BY created_at DESC
LIMIT 20;

-- Write inbound message
INSERT INTO messages (
  conversation_id,
  user_id,
  role,
  content,
  direction,
  status,
  created_at
) VALUES (
  'conv-uuid',
  'user-uuid',
  'user',
  'Can you help me find a CRM?',
  'inbound',
  NULL,
  now()
) RETURNING *;

-- Write outbound message (triggers SMS send)
INSERT INTO messages (
  conversation_id,
  user_id,
  role,
  content,
  direction,
  status,
  created_at
) VALUES (
  'conv-uuid',
  'user-uuid',
  'concierge',
  'I can help with that. What specific features do you need?',
  'outbound',
  'pending', -- Triggers notify_send_sms()
  now()
) RETURNING *;

-- Update after Twilio send
UPDATE messages
SET twilio_message_sid = 'SM1234567890abcdef',
    status = 'sent',
    sent_at = now()
WHERE id = 'message-uuid';
```

---

#### events

**Schema:**
```sql
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(100) NOT NULL,

  -- Event context
  aggregate_id UUID,
  aggregate_type VARCHAR(50),

  -- Event data
  payload JSONB NOT NULL,
  metadata JSONB,

  -- Processing tracking
  processed BOOLEAN DEFAULT FALSE,
  version INTEGER DEFAULT 1,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by VARCHAR(100)
);

-- Indexes
CREATE INDEX idx_events_type ON events(event_type, created_at DESC);
CREATE INDEX idx_events_aggregate ON events(aggregate_type, aggregate_id, created_at DESC);
CREATE INDEX idx_events_processed ON events(processed, created_at) WHERE NOT processed;
CREATE INDEX idx_events_created ON events(created_at DESC);
```

**Status:** ⚠️ EXISTS BUT NOT CONSUMED

**Migration:** 001_core_tables.sql (lines 136-168)

**Trigger:**
- `notify_event()` (004_triggers.sql lines 19-41)
- Publishes to PostgreSQL NOTIFY channel 'agent_events'
- Status: ✅ Active

**Written By:**
- `/packages/services/twilio-webhook/src/index.ts` (lines 404-410)
  - Publishes 'request_solution_research' event (but no handler exists)

**Issue:**
- Events are written with `processed = false`
- NO event processors are running
- Events accumulate forever without being consumed
- `processed` flag never becomes `true`

**Event Types Potentially Written:**
- `request_solution_research` - From Concierge action
- `agent.task_ready` - From pg_cron task processor (if running)
- `message.ready_to_send` - From pg_cron message processor (if running)

**Impact:**
- Event table grows indefinitely
- No event-driven coordination between agents
- No saga workflows possible
- No audit trail utility (events never marked processed)

**Common Queries (Not Actually Used):**

```sql
-- Get unprocessed events (what an event processor WOULD do)
SELECT * FROM events
WHERE processed = false
  AND created_at >= now() - INTERVAL '1 hour'
ORDER BY created_at ASC
FOR UPDATE SKIP LOCKED
LIMIT 20;

-- Mark event as processed (no code does this)
UPDATE events
SET processed = true
WHERE id = 'event-uuid';
```

---

#### agent_tasks

**Schema:**
```sql
CREATE TABLE agent_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Task classification
  task_type VARCHAR(100) NOT NULL,
  agent_type VARCHAR(50) NOT NULL,

  -- Task scope
  user_id UUID REFERENCES users(id),
  context_id UUID,
  context_type VARCHAR(50),

  -- Scheduling
  scheduled_for TIMESTAMPTZ NOT NULL,
  priority VARCHAR(20) DEFAULT 'medium',

  -- Processing state
  status VARCHAR(50) DEFAULT 'pending',
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  last_attempted_at TIMESTAMPTZ,

  -- Task data
  context_json JSONB NOT NULL,
  result_json JSONB,
  error_log TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by VARCHAR(100),
  completed_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_tasks_due ON agent_tasks(status, scheduled_for, priority) WHERE status = 'pending';
CREATE INDEX idx_tasks_agent ON agent_tasks(agent_type, status, scheduled_for);
CREATE INDEX idx_tasks_user ON agent_tasks(user_id, status);
CREATE INDEX idx_tasks_context ON agent_tasks(context_type, context_id);
```

**Status:** ⚠️ TASKS CREATED BUT NOT PROCESSED

**Migration:** 001_core_tables.sql (lines 199-237)

**Written By:**
- `check_conversation_summary()` trigger (004_triggers.sql lines 99-114)
  - Creates `create_conversation_summary` tasks every 50 messages
- `/packages/services/twilio-webhook/src/index.ts` (lines 417-427)
  - Creates `schedule_followup` tasks for re-engagement

**Issue:**
- Tasks are created with `status = 'pending'`
- NO task processor is running to execute them
- Tasks sit in database forever with status='pending'

**Task Types Created:**
- `create_conversation_summary` - From conversation summary trigger
- `schedule_followup` - From Concierge re-engagement action

**Task Types WOULD Be Created (Not Implemented):**
- `re_engagement_check` - From Bouncer after 24h inactivity
- `process_community_request` - From Agent of Humans
- `evaluate_solution_workflow` - From Solution Saga
- `match_intro_opportunities` - From Social Butterfly

**Common Queries:**

```sql
-- What tasks are pending? (task processor WOULD use this)
SELECT task_type, agent_type, COUNT(*), MIN(scheduled_for) as oldest
FROM agent_tasks
WHERE status = 'pending'
  AND scheduled_for <= now()
GROUP BY task_type, agent_type;

-- Get pending tasks for processing (pg_cron function)
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
FOR UPDATE SKIP LOCKED;
```

---

#### message_queue

**Schema:**
```sql
CREATE TABLE message_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  agent_id VARCHAR(100) NOT NULL,

  -- Message content
  message_data JSONB NOT NULL,
  final_message TEXT,

  -- Scheduling and priority
  scheduled_for TIMESTAMPTZ NOT NULL,
  priority VARCHAR(20) DEFAULT 'medium',

  -- Message lifecycle
  status VARCHAR(50) DEFAULT 'queued',
  superseded_by_message_id UUID REFERENCES message_queue(id),
  superseded_reason VARCHAR(100),

  -- Context awareness
  conversation_context_id UUID REFERENCES conversations(id),
  requires_fresh_context BOOLEAN DEFAULT FALSE,

  -- Delivery tracking
  sent_at TIMESTAMPTZ,
  delivered_message_id UUID REFERENCES messages(id),

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_queue_user_pending ON message_queue(user_id, status, scheduled_for)
  WHERE status IN ('queued', 'approved');
CREATE INDEX idx_queue_due ON message_queue(status, scheduled_for, priority)
  WHERE status = 'approved';
```

**Status:** ❌ COMPLETELY UNUSED

**Migration:** 001_core_tables.sql (lines 249-284)

**Reason Not Used:**
- Message Orchestrator not deployed
- Agents write directly to `messages` table with status='pending'
- No queuing, priority management, or rate limiting
- No relevance checking before sending

**Would Be Used For:**
- Queuing background messages from Account Manager
- Priority-based delivery
- Rate limiting enforcement
- Quiet hours scheduling
- Message relevance checking (superseding stale messages)

**Related Component:**
- `/packages/orchestrator/src/index.ts` - Code exists but not deployed

---

#### user_message_budget

**Schema:**
```sql
CREATE TABLE user_message_budget (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  date DATE NOT NULL,

  -- Counters
  messages_sent INTEGER DEFAULT 0,
  last_message_at TIMESTAMPTZ,

  -- Limits
  daily_limit INTEGER DEFAULT 5,
  hourly_limit INTEGER DEFAULT 2,

  -- User preferences
  quiet_hours_enabled BOOLEAN DEFAULT TRUE,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE (user_id, date)
);

-- Indexes
CREATE INDEX idx_budget_user_date ON user_message_budget(user_id, date DESC);
```

**Status:** ❌ COMPLETELY UNUSED

**Migration:** 001_core_tables.sql (lines 297-322)

**Reason Not Used:**
- Message Orchestrator not deployed
- No rate limiting active
- Users can receive unlimited messages

**Would Be Used For:**
- Rate limiting: 5 messages/day max, 2 messages/hour max
- Quiet hours enforcement
- Per-user customization (power users get higher limits)

**Impact of Not Using:**
- Users could be spammed with unlimited messages
- No quiet hours protection
- No customizable limits

---

### Agent Tables (Migration 002)

#### user_priorities

**Schema:**
```sql
CREATE TABLE user_priorities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,

  -- Priority item
  priority_rank INTEGER NOT NULL, -- 1 = highest
  item_type VARCHAR(50) NOT NULL,
  item_id UUID NOT NULL,
  value_score DECIMAL(5,2),

  -- Lifecycle
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,
  presented_at TIMESTAMPTZ,

  UNIQUE (user_id, item_type, item_id)
);

-- Indexes
CREATE INDEX idx_priorities_user_active ON user_priorities(user_id, status, priority_rank)
  WHERE status = 'active';
```

**Status:** ⚠️ EXISTS BUT EMPTY

**Migration:** 002_agent_tables.sql (lines 13-36)

**Queried By:**
- `/packages/services/twilio-webhook/src/index.ts` (lines 586-592)
- Concierge agent pulls top 5 priorities to include in LLM context
- Query doesn't fail, but returns empty array

**Should Be Populated By:**
- Account Manager agent (not deployed)
- Would analyze conversations to extract user goals
- Would rank opportunities by value score

**Impact:**
- Concierge has NO context about user goals
- Can't prioritize which opportunities to present
- Can't track what user has already been shown

**Item Types (Not Currently Used):**
- `intro_opportunity` - From Social Butterfly
- `community_request` - From Agent of Humans
- `solution_update` - From Solution Saga

---

#### solution_workflows, intro_opportunities, community_requests, community_responses, credit_events

**Status:** ⚠️ ALL EXIST BUT EMPTY

**Reason:** Specialized agents not implemented

| Table | Migration | Purpose | Agent Needed |
|-------|-----------|---------|--------------|
| solution_workflows | 002 lines 43-80 | Track multi-step solution research | Solution Saga |
| intro_opportunities | 002 lines 87-131 | Track intro matching and bounties | Social Butterfly, Intro Agent |
| community_requests | 002 lines 138-176 | Questions for expert community | Agent of Humans |
| community_responses | 002 lines 183-217 | Expert answers to requests | Agent of Humans |
| credit_events | 002 lines 224-251 | Credit transaction log (event sourcing) | All agents (credit earning) |

**All Share Same Issue:**
- Tables defined in schema
- Indexes and triggers created
- But NO agent code writes to them
- Completely dormant

---

### Supporting Tables (Migration 003)

#### prospects

**Schema:**
```sql
CREATE TABLE prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  company VARCHAR(255),
  title VARCHAR(255),
  linkedin_url VARCHAR(500),
  email VARCHAR(255),

  -- Research results
  mutual_connections JSONB,
  last_researched_at TIMESTAMPTZ,

  -- Tracking
  users_researching UUID[],

  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_prospects_linkedin ON prospects(linkedin_url);
```

**Status:** ⚠️ EXISTS, NO USAGE

**Migration:** 003_supporting_tables.sql (lines 10-30)

**Purpose:** Track individuals not yet on platform (targets for intros)

**Would Be Used By:**
- Social Butterfly agent for intro matching
- Demand generation for LinkedIn research
- Apify integration for mutual connection discovery

**Currently:** Completely unused, no data

---

#### innovators

**Schema:**
```sql
CREATE TABLE innovators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) UNIQUE NOT NULL,

  -- Company details
  company_name VARCHAR(255) NOT NULL,
  solution_description TEXT,
  categories TEXT[],
  target_customer_profile TEXT,

  -- Video pitch
  video_url VARCHAR(500),

  -- Status
  credits_balance INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT TRUE,

  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_innovators_categories ON innovators USING GIN(categories);
CREATE INDEX idx_innovators_active ON innovators(active, created_at DESC);
```

**Status:** ⚠️ EXISTS, NO USAGE

**Migration:** 003_supporting_tables.sql (lines 37-60)

**Purpose:** Extended profile for users offering solutions

**Note:** Separate from `users.innovator` boolean flag

**Would Be Used By:**
- Innovator onboarding flow (not implemented)
- Solution matching for community requests
- Bounty payment for intros

**Currently:** Completely unused, no data

---

#### agent_instances

**Schema:**
```sql
CREATE TABLE agent_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_type VARCHAR(50) NOT NULL,
  user_id UUID REFERENCES users(id),

  -- Configuration versioning
  config_json JSONB,
  prompt_version VARCHAR(50),

  -- Status
  status VARCHAR(50) DEFAULT 'active',
  last_active_at TIMESTAMPTZ DEFAULT now(),

  created_at TIMESTAMPTZ DEFAULT now(),
  terminated_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_instances_type_user ON agent_instances(agent_type, user_id);
CREATE INDEX idx_instances_active ON agent_instances(agent_type, status) WHERE status = 'active';
```

**Status:** ⚠️ EXISTS, NO USAGE

**Migration:** 003_supporting_tables.sql (lines 69-89)

**Purpose:** Track agent configuration versions for A/B testing and debugging

**Would Be Used For:**
- Prompt version tracking (e.g., "bouncer_v1.2", "concierge_v2.0")
- Model parameters and feature flags
- Debugging which prompt version user interacted with

**Currently:** Agents embedded in twilio-webhook, no instance tracking

---

#### agent_actions_log

**Schema:**
```sql
CREATE TABLE agent_actions_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Agent context
  agent_type VARCHAR(50) NOT NULL,
  agent_instance_id UUID REFERENCES agent_instances(id),
  action_type VARCHAR(100) NOT NULL,

  -- Request context
  user_id UUID REFERENCES users(id),
  context_id UUID,
  context_type VARCHAR(50),

  -- LLM metrics
  model_used VARCHAR(100),
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd DECIMAL(10,6),
  latency_ms INTEGER,

  -- Execution details
  input_data JSONB,
  output_data JSONB,
  error TEXT,

  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_log_agent_time ON agent_actions_log(agent_type, created_at DESC);
CREATE INDEX idx_log_user ON agent_actions_log(user_id, created_at DESC);
CREATE INDEX idx_log_cost ON agent_actions_log(created_at, cost_usd) WHERE cost_usd IS NOT NULL;
```

**Status:** ✅ READY TO USE (not used by embedded agents)

**Migration:** 003_supporting_tables.sql (lines 96-128)

**Purpose:** Comprehensive logging for debugging and cost tracking

**Would Be Used By:**
- Separate agent packages (Bouncer, Concierge, Account Manager)
- `/packages/agents/bouncer/src/index.ts` logs here (but not deployed)
- Cost tracking across all LLM calls

**Currently:** Embedded agents in twilio-webhook DON'T log here

**Action Types Would Include:**
- `llm_call` - Anthropic API invocations
- `function_execution` - Agent action execution
- `event_published` - Event sourcing tracking

---

## 4. Triggers & Functions

### Active Triggers

#### 1. notify_event()

**Location:** 004_triggers.sql lines 19-41

**Trigger:** `on_event_created` - After INSERT on `events` table

**What It Does:**
```sql
PERFORM pg_notify(
  'agent_events',
  json_build_object(
    'id', NEW.id,
    'event_type', NEW.event_type,
    'aggregate_id', NEW.aggregate_id,
    'payload', NEW.payload
  )::text
);
```

**Status:** ✅ ACTIVE

**Purpose:** Publishes events to PostgreSQL NOTIFY channel for real-time subscriptions

**Current Usage:**
- Trigger fires when events inserted
- Publishes to 'agent_events' channel
- **But no subscribers are listening**
- Events broadcast into void

**Would Be Used By:**
- Event processor service subscribing to 'agent_events'
- Realtime-processor (but bypassed in current architecture)

---

#### 2. update_user_credit_cache()

**Location:** 004_triggers.sql lines 56-77

**Trigger:** `on_credit_event_processed` - After INSERT/UPDATE on `credit_events` WHERE processed=true

**What It Does:**
```sql
UPDATE users
SET credit_balance = (
  SELECT COALESCE(SUM(amount), 0)
  FROM credit_events
  WHERE user_id = NEW.user_id AND processed = true
)
WHERE id = NEW.user_id;
```

**Status:** ✅ ACTIVE (dormant - no credit_events)

**Purpose:** Updates cached credit balance in users table

**Current Usage:**
- Would fire if credit_events were written
- Maintains users.credit_balance as cache
- Source of truth is `user_credit_balances` view

**Design Note:**
- VIEW is authoritative: `SELECT SUM(amount) FROM credit_events`
- users.credit_balance is performance cache
- Trigger keeps cache in sync

---

#### 3. check_conversation_summary()

**Location:** 004_triggers.sql lines 86-132

**Trigger:** `on_message_count_check` - After INSERT on `messages` table

**What It Does:**
1. Increments `conversations.messages_since_summary`
2. Every 50 messages, creates task in `agent_tasks`:
```sql
INSERT INTO agent_tasks (
  task_type,
  agent_type,
  scheduled_for,
  priority,
  context_json,
  created_by
) VALUES (
  'create_conversation_summary',
  'system',
  now(),
  'medium',
  jsonb_build_object('conversation_id', NEW.conversation_id),
  'conversation_summary_trigger'
);
```
3. Resets `messages_since_summary` to 0

**Status:** ✅ ACTIVE

**Purpose:** Prevent context window explosion by triggering summarization

**Current Usage:**
- Trigger fires on every message insert
- Counter increments correctly
- Tasks created in agent_tasks table
- **But no task processor to execute summarization**
- Tasks accumulate with status='pending'

**Evidence in Code:**
- Migration 003 adds `messages_since_summary` column (line 135)
- Trigger references this column (004_triggers.sql line 94-95)

---

#### 4. handle_phone_number_change()

**Location:** 004_triggers.sql lines 140-178

**Trigger:** `on_phone_change` - Before UPDATE on `users` WHERE phone_number changes

**What It Does:**
```sql
-- Archive old number in history
UPDATE users
SET phone_number_history = phone_number_history || jsonb_build_object(
  'phone_number', OLD.phone_number,
  'changed_at', now(),
  'changed_reason', 'user_update'
)
WHERE id = NEW.id;

-- Close all active conversations
UPDATE conversations
SET status = 'closed',
    updated_at = now()
WHERE phone_number = OLD.phone_number
  AND user_id = NEW.id
  AND status = 'active';
```

**Status:** ⚠️ ACTIVE BUT BROKEN

**Purpose:** Handle carrier phone number reassignments safely

**CRITICAL ISSUE:**
- References `phone_number_history` column
- **Column doesn't exist in users table schema!**
- Trigger will ERROR if phone number changed

**Schema Gap:**
```sql
-- MISSING from users table:
phone_number_history JSONB DEFAULT '[]'::jsonb
```

**Fix Required:**
```sql
ALTER TABLE users ADD COLUMN phone_number_history JSONB DEFAULT '[]'::jsonb;
```

---

#### 5. notify_send_sms()

**Location:** 004_triggers.sql lines 186-212

**Trigger:** `on_message_send` - After INSERT on `messages` table

**What It Does:**
```sql
IF NEW.direction = 'outbound' AND NEW.status = 'pending' THEN
  -- Publish notification
  PERFORM pg_notify('send_sms', row_to_json(NEW)::text);

  -- Update status
  UPDATE messages
  SET status = 'queued_for_send'
  WHERE id = NEW.id;
END IF;
```

**Status:** ✅ ACTIVE - CRITICAL PATH

**Purpose:** Triggers SMS delivery via sms-sender webhook

**Current Usage:**
- Fires when agent writes message with status='pending'
- Publishes to PostgreSQL NOTIFY channel 'send_sms'
- Updates status to 'queued_for_send'
- **sms-sender service receives notification via pg_net webhook**
- This is how ALL SMS sending works in production

**Flow:**
1. Agent writes to messages table: `status = 'pending'`
2. Trigger fires, publishes to 'send_sms' channel
3. Updates status to 'queued_for_send'
4. pg_net webhook calls sms-sender HTTP endpoint
5. sms-sender sends via Twilio
6. sms-sender updates message: `status = 'sent'`, sets twilio_message_sid

**Code Using This:**
- `/packages/services/twilio-webhook/src/index.ts` (lines 750-778) - Writes with status='pending'
- `/packages/services/sms-sender/src/index.ts` - Receives webhook, sends SMS

---

### Dormant Functions (Created But Not Called)

#### process_tasks_batch()

**Location:** 005_pg_cron.sql lines 17-85

**Purpose:** Batch process pending tasks from agent_tasks table

**Status:** ❓ Function exists, unclear if cron job scheduled

**What It Does:**
1. Queries pending tasks (FOR UPDATE SKIP LOCKED)
2. Publishes 'agent.task_ready' events
3. Marks tasks as 'processing'

**To Check If Running:**
```sql
SELECT * FROM cron.job WHERE jobname = 'process-agent-tasks';
```

---

#### process_outbound_messages()

**Location:** 005_pg_cron.sql lines 118-203

**Purpose:** Process queued messages from message_queue table

**Status:** ❓ Function exists, not used (message_queue empty)

**Not Needed Because:**
- Message Orchestrator not deployed
- Agents write directly to messages table
- No queued messages to process

---

## 5. Missing vs. Requirements

### What requirements.md Says Should Exist

From requirements.md Section 3 (Database Schema):

| Table | Requirements | Actually Exists | Actually Used |
|-------|--------------|-----------------|---------------|
| **Core Tables** |
| users | ✅ Defined | ✅ Yes | ✅ Yes |
| conversations | ✅ Defined | ✅ Yes | ✅ Yes |
| messages | ✅ Defined | ✅ Yes | ✅ Yes |
| events | ✅ Defined | ✅ Yes | ⚠️ Written but not consumed |
| agent_tasks | ✅ Defined | ✅ Yes | ⚠️ Created but not processed |
| message_queue | ✅ Defined | ✅ Yes | ❌ No (Orchestrator not deployed) |
| user_message_budget | ✅ Defined | ✅ Yes | ❌ No (no rate limiting) |
| **Agent Tables** |
| user_priorities | ✅ Defined | ✅ Probably | ❌ Empty (no Account Manager) |
| solution_workflows | ✅ Defined | ✅ Probably | ❌ Empty (no Solution Saga) |
| intro_opportunities | ✅ Defined | ✅ Probably | ❌ Empty (no Social Butterfly) |
| community_requests | ✅ Defined | ✅ Probably | ❌ Empty (no Agent of Humans) |
| community_responses | ✅ Defined | ✅ Probably | ❌ Empty (no Agent of Humans) |
| credit_events | ✅ Defined | ✅ Probably | ❌ Empty (no credit system) |
| **Supporting Tables** |
| prospects | ✅ Defined | ✅ Yes | ❌ No usage |
| innovators | ✅ Defined | ✅ Yes | ❌ No usage |
| agent_instances | ✅ Defined | ✅ Yes | ❌ No usage |
| agent_actions_log | ✅ Defined | ✅ Yes | ⚠️ Ready but unused |

### Gaps Between Requirements and Reality

#### 1. Schema Gaps

**Missing Column:**
- `users.phone_number_history JSONB` - Referenced by trigger but doesn't exist

**Fix:**
```sql
ALTER TABLE users ADD COLUMN phone_number_history JSONB DEFAULT '[]'::jsonb;
```

#### 2. Functional Gaps

**Event Processing:**
- Requirements: Event-driven saga orchestration
- Reality: Events written but never consumed
- Impact: No multi-agent coordination, no saga workflows

**Message Orchestration:**
- Requirements: Rate limiting, priority-based delivery, relevance checking
- Reality: Direct message delivery with no orchestration
- Impact: Users could be spammed, no quiet hours, no priority management

**Task Processing:**
- Requirements: Scheduled background work (re-engagement, summarization)
- Reality: Tasks created but not executed
- Impact: No conversation summaries, no re-engagement follow-ups

**Credit System:**
- Requirements: Event-sourced credits for network-positive actions
- Reality: credit_events table empty, no credits awarded
- Impact: No incentives for making intros, answering questions

#### 3. Agent Gaps

**Not Implemented:**
- Account Manager - Would populate user_priorities
- Solution Saga - Would populate solution_workflows
- Agent of Humans - Would populate community_requests/responses
- Social Butterfly - Would populate intro_opportunities
- Intro Agent - Would manage intro lifecycle
- Credit Funding Agent - Would process credit purchases

**Impact:**
- Concierge has no user context (empty user_priorities)
- No automated solution research
- No community expertise matching
- No proactive intro matching
- No credit earning mechanism

---

## 6. Schema Reference for Sub-Agents

### Quick Reference Tables

#### Actively Used (Write Here)

| Table | Purpose | Primary Keys | Foreign Keys | Critical Indexes |
|-------|---------|--------------|--------------|------------------|
| users | User records | id (UUID) | - | idx_users_phone |
| conversations | Conversation threads | id (UUID) | user_id → users | idx_conversations_phone |
| messages | Chat messages | id (UUID) | conversation_id → conversations, user_id → users | idx_messages_conversation |

#### Ready to Use (These Work)

| Table | Purpose | When to Use | Example |
|-------|---------|-------------|---------|
| agent_actions_log | Log LLM calls and costs | Separate agent packages | Log every Anthropic API call |
| credit_events | Credit transactions | When implementing credit system | Award credits for intros |
| user_priorities | User goal tracking | When deploying Account Manager | Rank user's top 5 priorities |

#### Exist But Empty (Deploy Agent First)

| Table | Needs Agent | Purpose |
|-------|-------------|---------|
| solution_workflows | Solution Saga | Multi-step research workflows |
| intro_opportunities | Social Butterfly, Intro Agent | Intro matching and tracking |
| community_requests | Agent of Humans | Expert Q&A requests |
| community_responses | Agent of Humans | Expert answers |

### Common Query Patterns

#### 1. Inbound SMS Webhook (Critical Path)

```sql
-- Find or create user
SELECT * FROM users WHERE phone_number = $1;

INSERT INTO users (phone_number, verified, poc_agent_type)
VALUES ($1, false, 'bouncer')
ON CONFLICT (phone_number) DO UPDATE
SET updated_at = now()
RETURNING *;

-- Find or create conversation
SELECT * FROM conversations
WHERE phone_number = $1 AND status = 'active'
ORDER BY created_at DESC
LIMIT 1;

INSERT INTO conversations (user_id, phone_number, status)
VALUES ($1, $2, 'active')
RETURNING *;

-- Record inbound message
INSERT INTO messages (conversation_id, user_id, role, content, direction)
VALUES ($1, $2, 'user', $3, 'inbound')
RETURNING *;

-- Get conversation history for agent context
SELECT role, content, created_at
FROM messages
WHERE conversation_id = $1
ORDER BY created_at DESC
LIMIT 20;
```

#### 2. Agent Response (Critical Path)

```sql
-- Write outbound message (triggers SMS send)
INSERT INTO messages (conversation_id, user_id, role, content, direction, status)
VALUES ($1, $2, 'concierge', $3, 'outbound', 'pending')
RETURNING *;

-- Trigger fires automatically:
-- - notify_send_sms() publishes to 'send_sms' channel
-- - Updates status to 'queued_for_send'
-- - sms-sender receives webhook, sends via Twilio
```

#### 3. User Onboarding Updates

```sql
-- Update user info during Bouncer onboarding
UPDATE users
SET first_name = $1,
    last_name = $2,
    company = $3,
    title = $4,
    email = $5,
    linkedin_url = $6,
    updated_at = now()
WHERE id = $7;

-- Mark user verified, transition to Concierge
UPDATE users
SET verified = true,
    poc_agent_type = 'concierge',
    updated_at = now()
WHERE id = $1;
```

#### 4. Create Re-engagement Task

```sql
-- Schedule follow-up (e.g., 24 hours later)
INSERT INTO agent_tasks (
  task_type,
  agent_type,
  user_id,
  scheduled_for,
  priority,
  context_json,
  created_by
) VALUES (
  'schedule_followup',
  'bouncer',
  $1,
  now() + INTERVAL '24 hours',
  'medium',
  jsonb_build_object(
    'conversation_id', $2,
    'last_step', 'requested_email'
  ),
  'bouncer_agent'
);

-- Note: Task created but won't execute until task processor deployed
```

#### 5. Publish Event (Not Consumed)

```sql
-- Publish event (for future event-driven coordination)
INSERT INTO events (
  event_type,
  aggregate_id,
  aggregate_type,
  payload,
  created_by
) VALUES (
  'request_solution_research',
  $1, -- user_id
  'user',
  jsonb_build_object(
    'request', $2,
    'category', $3
  ),
  'concierge_agent'
);

-- Note: Event written but no processor consumes it
```

### Foreign Key Relationships

```
users (id)
  ↓
  ├─→ conversations (user_id)
  │     ↓
  │     └─→ messages (conversation_id)
  │
  ├─→ messages (user_id)
  ├─→ agent_tasks (user_id)
  ├─→ message_queue (user_id)
  ├─→ user_message_budget (user_id)
  ├─→ user_priorities (user_id)
  ├─→ solution_workflows (user_id)
  ├─→ intro_opportunities (connector_user_id, innovator_id)
  ├─→ community_responses (user_id)
  ├─→ credit_events (user_id)
  ├─→ innovators (user_id)
  └─→ agent_instances (user_id)

conversations (id)
  └─→ message_queue (conversation_context_id)

messages (id)
  └─→ message_queue (delivered_message_id)

agent_instances (id)
  └─→ agent_actions_log (agent_instance_id)

community_requests (id)
  └─→ community_responses (request_id)

message_queue (id)
  └─→ message_queue (superseded_by_message_id)
```

### Index Usage Guide

**When Querying By:**
- Phone number → Use `idx_users_phone` or `idx_conversations_phone`
- Conversation history → Use `idx_messages_conversation` (has created_at DESC)
- User verification → Use `idx_users_verified`
- Agent type → Use `idx_users_poc_agent`
- Pending tasks → Use `idx_tasks_due` (partial index WHERE status='pending')
- Unprocessed events → Use `idx_events_processed` (partial index WHERE NOT processed)

---

## 7. Troubleshooting Guide

### Common Issues

#### Issue: SMS Not Sending

**Symptom:** Message written to database but never delivered

**Debug Steps:**
```sql
-- 1. Check if message was created with correct status
SELECT id, role, content, direction, status, created_at
FROM messages
WHERE id = 'message-uuid';
-- Expected: direction='outbound', status='pending' or 'queued_for_send'

-- 2. Check if trigger fired (status should change to 'queued_for_send')
SELECT status FROM messages WHERE id = 'message-uuid';
-- If still 'pending', trigger didn't fire or failed

-- 3. Check if sms-sender updated it
SELECT status, twilio_message_sid, sent_at
FROM messages
WHERE id = 'message-uuid';
-- Expected: status='sent', twilio_message_sid set, sent_at populated

-- 4. Check sms-sender logs in Cloud Run
-- Look for webhook invocations and Twilio API errors
```

**Common Causes:**
- Trigger not firing: Check if `notify_send_sms()` trigger exists
- pg_net not configured: Check Supabase pg_net webhook setup
- sms-sender not running: Check Cloud Run service status
- Twilio API error: Check sms-sender logs for retry exhaustion

---

#### Issue: User Not Transitioning to Concierge

**Symptom:** User verified but still getting Bouncer responses

**Debug Steps:**
```sql
-- Check user state
SELECT verified, poc_agent_type FROM users WHERE id = 'user-uuid';
-- Expected: verified=true, poc_agent_type='concierge'

-- Check if verification update happened
SELECT verified, poc_agent_type, updated_at FROM users WHERE id = 'user-uuid';
-- updated_at should be recent if verification just happened
```

**Common Causes:**
- Email verification not implemented (most likely)
- User record not updated after email received
- poc_agent_type not set during verification

**Fix:**
- Implement email verification webhook
- Update users: `SET verified=true, poc_agent_type='concierge'`

---

#### Issue: Tasks Created But Not Executing

**Symptom:** agent_tasks table filling up with status='pending'

**Debug Steps:**
```sql
-- Count pending tasks
SELECT task_type, agent_type, COUNT(*)
FROM agent_tasks
WHERE status = 'pending' AND scheduled_for <= now()
GROUP BY task_type, agent_type;

-- Check oldest pending task
SELECT task_type, scheduled_for, created_at
FROM agent_tasks
WHERE status = 'pending'
ORDER BY scheduled_for ASC
LIMIT 1;
```

**Root Cause:**
- No task processor service deployed
- pg_cron job not scheduled or not running

**Fix:**
- Deploy task processor service
- Or verify pg_cron job: `SELECT * FROM cron.job WHERE jobname = 'process-agent-tasks';`

---

#### Issue: Events Accumulating (processed=false)

**Symptom:** events table growing with all rows processed=false

**Debug Steps:**
```sql
-- Count unprocessed events
SELECT event_type, COUNT(*) FROM events
WHERE processed = false
GROUP BY event_type;

-- Check oldest unprocessed event
SELECT event_type, created_at FROM events
WHERE processed = false
ORDER BY created_at ASC
LIMIT 1;
```

**Root Cause:**
- No event processor service deployed
- Event-driven coordination not implemented

**Current Impact:**
- Table grows indefinitely (disk space)
- Events never become processed

**Fix:**
- Deploy event processor service
- Or implement cleanup job: Archive events older than 90 days

---

#### Issue: Conversation Summary Trigger Error

**Symptom:** Error when 50th message inserted

**Debug Steps:**
```sql
-- Check messages_since_summary counter
SELECT id, messages_since_summary FROM conversations WHERE id = 'conv-uuid';

-- Check if summarization tasks are being created
SELECT * FROM agent_tasks
WHERE task_type = 'create_conversation_summary'
  AND context_json->>'conversation_id' = 'conv-uuid';
```

**Root Cause:**
- Counter increments correctly
- Tasks created correctly
- But no processor to execute them

**Impact:**
- No actual impact (tasks just accumulate)
- Summarization doesn't happen but system continues working

---

#### Issue: Phone Number Change Trigger Error

**Symptom:** Error when updating user phone_number

**Debug Steps:**
```sql
-- Try to update phone number (will error)
UPDATE users SET phone_number = '+14155559999' WHERE id = 'user-uuid';
-- ERROR: column "phone_number_history" does not exist
```

**Root Cause:**
- `handle_phone_number_change()` trigger references non-existent column
- Migration 004 defines trigger but column never created

**Fix:**
```sql
ALTER TABLE users ADD COLUMN phone_number_history JSONB DEFAULT '[]'::jsonb;

-- Now phone number updates will work:
UPDATE users SET phone_number = '+14155559999' WHERE id = 'user-uuid';
```

---

### Database Health Checks

#### Quick Health Check Query

```sql
-- Table sizes and row counts
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
  n_live_tup AS row_count
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

#### Active Tables (Should Have Data)

```sql
-- Check active tables
SELECT 'users' as table_name, COUNT(*) as rows FROM users
UNION ALL
SELECT 'conversations', COUNT(*) FROM conversations
UNION ALL
SELECT 'messages', COUNT(*) FROM messages
UNION ALL
SELECT 'agent_actions_log', COUNT(*) FROM agent_actions_log;
```

#### Dormant Tables (Should Be Empty or Low)

```sql
-- Check dormant tables (should be 0 or very low)
SELECT 'events (unprocessed)' as table_name, COUNT(*) as rows
FROM events WHERE processed = false
UNION ALL
SELECT 'agent_tasks (pending)', COUNT(*)
FROM agent_tasks WHERE status = 'pending'
UNION ALL
SELECT 'message_queue', COUNT(*) FROM message_queue
UNION ALL
SELECT 'user_priorities', COUNT(*) FROM user_priorities
UNION ALL
SELECT 'credit_events', COUNT(*) FROM credit_events;
```

#### Trigger Status Check

```sql
-- List all triggers
SELECT
  tgname AS trigger_name,
  tgrelid::regclass AS table_name,
  tgenabled AS enabled,
  pg_get_triggerdef(oid) AS definition
FROM pg_trigger
WHERE tgisinternal = false
ORDER BY tgrelid::regclass::text;
```

---

## Appendix A: Migration Application Commands

### How to Apply Migrations

**Using Supabase CLI:**
```bash
# From project root
supabase db reset  # WARNING: Destroys all data
supabase db push   # Apply new migrations

# Or manually via SQL editor
supabase db exec < packages/database/migrations/001_core_tables.sql
```

**Using psql:**
```bash
# Connect to database
psql $DATABASE_URL

# Apply migration
\i packages/database/migrations/001_core_tables.sql
```

**Using Supabase Dashboard:**
1. Go to SQL Editor
2. Paste migration content
3. Run

### How to Verify Migrations

```sql
-- Check if table exists
SELECT EXISTS (
  SELECT FROM pg_tables
  WHERE schemaname = 'public'
  AND tablename = 'users'
);

-- Check if column exists
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'conversations'
  AND column_name = 'messages_since_summary';

-- Check if trigger exists
SELECT tgname FROM pg_trigger
WHERE tgname = 'on_message_send';

-- Check if function exists
SELECT proname FROM pg_proc
WHERE proname = 'notify_send_sms';

-- Check if extension enabled
SELECT * FROM pg_extension WHERE extname = 'pg_cron';
```

---

## Appendix B: Schema Evolution Notes

### Changes Made Post-Migration

**Migration 003 Adds Column to Migration 001 Table:**
- Base table: `conversations` (created in 001)
- Column added: `messages_since_summary INTEGER DEFAULT 0` (003 line 135)
- This pattern is CORRECT: Later migrations can alter earlier tables

**Trigger References Non-Existent Column:**
- Trigger: `handle_phone_number_change()` (004 lines 140-178)
- References: `users.phone_number_history JSONB`
- Issue: Column never created in any migration
- Fix needed: `ALTER TABLE users ADD COLUMN phone_number_history JSONB DEFAULT '[]'::jsonb;`

### Future Migration Considerations

**When Creating New Migrations:**

1. **Incremental Changes:** Later migrations CAN alter tables from earlier migrations
   - Example: 003 adds column to conversations table from 001
   - Use `ALTER TABLE` statements

2. **Dependencies:** Migration order matters
   - 004 (triggers) depends on 001 (tables) and 003 (columns)
   - 005 (pg_cron) depends on 001 (agent_tasks, message_queue)

3. **Trigger + Schema Sync:** Triggers must reference actual columns
   - Always create column BEFORE trigger that uses it
   - Or include column creation in same migration as trigger

4. **Index Strategy:** Create indexes immediately after tables
   - All indexes defined in same migration as table
   - Partial indexes for common WHERE clauses (e.g., status='pending')

5. **Comments:** Use PostgreSQL COMMENT ON to document intent
   - All migrations include extensive comments
   - Helps future developers understand design decisions

---

## Appendix C: Performance Notes

### Query Performance

**Fast Queries (< 10ms):**
- User lookup by phone_number (indexed)
- Conversation lookup by phone_number (indexed)
- Message history by conversation_id (indexed with DESC)

**Slow Queries to Avoid:**
- Full table scans on messages (millions of rows eventually)
- Unindexed JSONB queries (use GIN indexes for JSONB fields)
- Complex joins without proper indexes

### Index Coverage

**Well-Indexed:**
- users: phone_number, verified, poc_agent_type
- conversations: user_id, phone_number, status
- messages: conversation_id, user_id, twilio_message_sid
- events: event_type, aggregate_type, processed (partial)
- agent_tasks: status+scheduled_for+priority (partial)

**Could Use More Indexes:**
- messages.status (if querying failed messages)
- users.email (if doing email lookups)
- JSONB fields (if querying specific keys frequently)

### Trigger Performance

**Fast Triggers (<  50ms):**
- notify_event() - Just pg_notify
- notify_send_sms() - pg_notify + status update
- update_user_credit_cache() - Single aggregate query

**Potentially Slow Triggers:**
- check_conversation_summary() - Could be slow if many messages
- handle_phone_number_change() - Updates multiple tables

### Scaling Considerations

**Current Bottlenecks (if high volume):**
- messages table growing large (partition by date?)
- events table with processed=false accumulating
- agent_tasks table filling up with pending tasks

**Recommended Optimizations (future):**
- Partition messages by month
- Archive old events (90 day retention)
- Archive completed tasks (30 day retention)
- Add Redis for high-frequency operations

---

**END OF DATABASE_ACTUAL.md**
