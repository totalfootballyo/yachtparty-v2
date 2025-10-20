# Yachtparty Database Schema

**Last Updated:** October 18, 2025
**Source:** Supabase Production Database

---

## Overview

The Yachtparty database uses PostgreSQL with event sourcing, task queues, and message orchestration patterns.

**Total Tables:** 19
**Extensions:** pg_cron, uuid-ossp, http

---

## Table Descriptions

### Core Tables

#### `users`
**Purpose:** User accounts and profiles

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| phone_number | varchar | NO | - | User's phone (unique) |
| email | varchar | YES | null | User's email |
| first_name | varchar | YES | null | First name |
| last_name | varchar | YES | null | Last name |
| company | varchar | YES | null | Company name |
| title | varchar | YES | null | Job title |
| linkedin_url | varchar | YES | null | LinkedIn profile |
| verified | boolean | YES | false | Phone verified |
| email_verified | boolean | YES | false | Email verified |
| innovator | boolean | YES | false | Is solution provider |
| expert_connector | boolean | YES | false | Can make intros |
| expertise | text[] | YES | null | Areas of expertise |
| poc_agent_id | varchar | YES | null | Primary agent ID |
| poc_agent_type | varchar | YES | null | Primary agent type |
| quiet_hours_start | time | YES | null | Do not disturb start |
| quiet_hours_end | time | YES | null | Do not disturb end |
| timezone | varchar | YES | null | User timezone |
| response_pattern | jsonb | YES | null | Activity patterns |
| credit_balance | integer | YES | 0 | Current credits |
| status_level | varchar | YES | 'member' | User tier |
| referred_by | uuid | YES | null | Referrer user ID |
| name_dropped | varchar | YES | null | Referral name |
| created_at | timestamptz | YES | now() | Account created |
| updated_at | timestamptz | YES | now() | Last updated |
| last_active_at | timestamptz | YES | null | Last activity |

**Indexes:**
- Primary key on `id`
- Unique on `phone_number`
- Index on `email`
- Index on `verified`

---

#### `conversations`
**Purpose:** SMS conversation threads

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| user_id | uuid | NO | - | FK to users |
| phone_number | varchar | NO | - | User's phone |
| status | varchar | YES | 'active' | active/archived |
| conversation_summary | text | YES | null | AI summary |
| last_summary_message_id | uuid | YES | null | Last summarized msg |
| messages_since_summary | integer | YES | 0 | Count since summary |
| created_at | timestamptz | YES | now() | Created |
| updated_at | timestamptz | YES | now() | Last updated |
| last_message_at | timestamptz | YES | null | Last message time |

**Indexes:**
- Primary key on `id`
- Index on `user_id`
- Index on `phone_number`

---

#### `messages`
**Purpose:** Individual SMS messages

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| conversation_id | uuid | NO | - | FK to conversations |
| user_id | uuid | NO | - | FK to users |
| role | varchar | NO | - | user/assistant |
| content | text | NO | - | Message text |
| direction | varchar | NO | - | inbound/outbound |
| twilio_message_sid | varchar | YES | null | Twilio ID |
| status | varchar | YES | null | Twilio status |
| created_at | timestamptz | YES | now() | Created |
| sent_at | timestamptz | YES | null | Sent time |
| delivered_at | timestamptz | YES | null | Delivered time |

**Indexes:**
- Primary key on `id`
- Index on `conversation_id`
- Index on `user_id`
- Index on `created_at`

---

### Event Sourcing & Tasks

#### `events`
**Purpose:** Event sourcing table for inter-agent communication

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| event_type | varchar | NO | - | Event type identifier |
| aggregate_id | uuid | YES | null | Entity ID |
| aggregate_type | varchar | YES | null | Entity type |
| payload | jsonb | NO | - | Event data |
| metadata | jsonb | YES | null | Additional context |
| processed | boolean | YES | false | Processed by event-processor |
| version | integer | YES | 1 | Event version |
| created_at | timestamptz | YES | now() | Event time |
| created_by | varchar | YES | null | Creating service |

**Indexes:**
- Primary key on `id`
- Index on `event_type`
- Index on `aggregate_id, aggregate_type`
- Index on `processed, created_at`

**Trigger:** `notify_event()` - PostgreSQL NOTIFY on insert

---

#### `agent_tasks`
**Purpose:** Task queue for background agent work

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| task_type | varchar | NO | - | Task type |
| agent_type | varchar | NO | - | Target agent |
| user_id | uuid | YES | null | FK to users |
| context_id | uuid | YES | null | Related entity |
| context_type | varchar | YES | null | Entity type |
| scheduled_for | timestamptz | NO | - | When to run |
| priority | varchar | YES | 'medium' | low/medium/high |
| status | varchar | YES | 'pending' | pending/processing/completed/failed |
| retry_count | integer | YES | 0 | Attempts made |
| max_retries | integer | YES | 3 | Max attempts |
| last_attempted_at | timestamptz | YES | null | Last try |
| context_json | jsonb | NO | - | Task data |
| result_json | jsonb | YES | null | Result data |
| error_log | text | YES | null | Error details |
| created_at | timestamptz | YES | now() | Created |
| created_by | varchar | YES | null | Creating service |
| completed_at | timestamptz | YES | null | Completion time |

**Indexes:**
- Primary key on `id`
- Index on `status, scheduled_for`
- Index on `agent_type, status`
- Index on `user_id`

**Processing:** Polled by task-processor every 2 minutes using `FOR UPDATE SKIP LOCKED`

---

### Message Orchestration

#### `message_queue`
**Purpose:** Outbound message queue with rate limiting

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| user_id | uuid | NO | - | FK to users |
| agent_id | varchar | NO | - | Sending agent |
| message_data | jsonb | NO | - | Message metadata |
| final_message | text | YES | null | Rendered text |
| scheduled_for | timestamptz | NO | - | Send time |
| priority | varchar | YES | 'medium' | low/medium/high |
| status | varchar | YES | 'queued' | queued/sent/superseded/failed |
| superseded_by_message_id | uuid | YES | null | Newer message |
| superseded_reason | varchar | YES | null | Why superseded |
| conversation_context_id | uuid | YES | null | Conversation ref |
| requires_fresh_context | boolean | YES | false | Re-render before send |
| sequence_id | uuid | YES | null | Multi-message sequence |
| sequence_position | integer | YES | null | Position in sequence |
| sequence_total | integer | YES | null | Total in sequence |
| sent_at | timestamptz | YES | null | Sent time |
| delivered_message_id | uuid | YES | null | FK to messages |
| created_at | timestamptz | YES | now() | Created |

**Indexes:**
- Primary key on `id`
- Index on `user_id, status, scheduled_for`
- Index on `status, scheduled_for`
- Index on `sequence_id`

**Processing:** Polled by message-orchestrator

---

#### `user_message_budget`
**Purpose:** Rate limiting per user

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| user_id | uuid | NO | - | FK to users |
| date | date | NO | - | Budget date |
| messages_sent | integer | YES | 0 | Count today |
| last_message_at | timestamptz | YES | null | Last sent |
| daily_limit | integer | YES | 5 | Max per day |
| hourly_limit | integer | YES | 2 | Max per hour |
| quiet_hours_enabled | boolean | YES | true | Respect quiet hours |
| created_at | timestamptz | YES | now() | Created |

**Indexes:**
- Primary key on `id`
- Unique on `user_id, date`

---

### Agent-Specific Tables

#### `user_priorities`
**Purpose:** Account Manager's priority list for each user

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| user_id | uuid | NO | - | FK to users |
| priority_rank | integer | NO | - | Rank (1 = highest) |
| item_type | varchar | NO | - | Type of item |
| item_id | uuid | NO | - | Item reference |
| value_score | numeric | YES | null | 0-100 score |
| status | varchar | YES | 'active' | active/presented/actioned/expired |
| created_at | timestamptz | YES | now() | Created |
| expires_at | timestamptz | YES | null | Expiration |
| presented_at | timestamptz | YES | null | When shown to user |

**Valid item_types:**
- `intro_opportunity`
- `community_request`
- `community_response` ✅ (NEW)
- `expert_impact_notification` ✅ (NEW)
- `solution_update`

**Indexes:**
- Primary key on `id`
- Unique on `user_id, item_type, item_id`
- Index on `user_id, status, priority_rank`

---

#### `solution_workflows`
**Purpose:** Solution Saga state machine tracking

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| user_id | uuid | NO | - | FK to users |
| request_description | text | NO | - | What user needs |
| category | varchar | YES | null | Solution category |
| current_step | varchar | NO | - | Current stage |
| status | varchar | YES | 'in_progress' | in_progress/completed/cancelled |
| perplexity_results | jsonb | YES | null | AI research |
| matched_innovators | jsonb | YES | null | Solution providers |
| community_insights | jsonb | YES | null | Expert responses |
| expert_recommendations | jsonb | YES | null | Curated results |
| quality_threshold_met | boolean | YES | false | Met quality bar |
| last_decision_at | timestamptz | YES | null | Last LLM decision |
| next_action | varchar | YES | null | Next step |
| pending_tasks | jsonb | YES | '[]' | Pending work |
| completed_tasks | jsonb | YES | '[]' | Done work |
| conversation_log | jsonb | YES | '[]' | Decision log |
| created_at | timestamptz | YES | now() | Created |
| updated_at | timestamptz | YES | now() | Updated |
| completed_at | timestamptz | YES | null | Completed |

**Indexes:**
- Primary key on `id`
- Index on `user_id, status`

---

#### `intro_opportunities`
**Purpose:** Introduction matching and bounty tracking

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| connector_user_id | uuid | NO | - | FK to users (connector) |
| innovator_id | uuid | YES | null | FK to innovators |
| prospect_id | uuid | YES | null | FK to prospects |
| prospect_name | varchar | NO | - | Prospect name |
| prospect_company | varchar | YES | null | Company |
| prospect_title | varchar | YES | null | Title |
| prospect_linkedin_url | varchar | YES | null | LinkedIn |
| innovator_name | varchar | YES | null | Innovator name |
| bounty_credits | integer | YES | 50 | Reward amount |
| status | varchar | YES | 'open' | open/accepted/declined/completed |
| connector_response | text | YES | null | Response text |
| feed_item_id | uuid | YES | null | Feed reference |
| intro_email | varchar | YES | null | Email for intro |
| intro_scheduled_at | timestamptz | YES | null | When scheduled |
| intro_completed_at | timestamptz | YES | null | When completed |
| created_at | timestamptz | YES | now() | Created |
| updated_at | timestamptz | YES | now() | Updated |
| expires_at | timestamptz | YES | null | Expiration |

**Indexes:**
- Primary key on `id`
- Index on `connector_user_id, status`
- Index on `innovator_id`

---

### Community (Agent of Humans)

#### `community_requests`
**Purpose:** Expert insight requests

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| requesting_agent_type | varchar | NO | - | Which agent requested |
| requesting_user_id | uuid | YES | null | FK to users (requester) |
| context_id | uuid | YES | null | Related entity |
| context_type | varchar | YES | null | Entity type |
| question | text | NO | - | The question |
| category | varchar | YES | null | Question category |
| expertise_needed | text[] | YES | null | Required expertise |
| target_user_ids | uuid[] | YES | null | Targeted experts |
| requester_context | text | YES | null | Why they're asking, their situation ✅ |
| desired_outcome | varchar | YES | null | backchannel/introduction/quick_thoughts/ongoing_advice ✅ |
| urgency | varchar | YES | 'medium' | low/medium/high ✅ |
| request_summary | varchar(100) | YES | null | Short 3-5 word description ✅ |
| status | varchar | YES | 'open' | open/responses_received/closed |
| responses_count | integer | YES | 0 | # of responses |
| closed_loop_at | timestamptz | YES | null | When closed ✅ |
| closed_loop_message | text | YES | null | Closure message ✅ |
| created_at | timestamptz | YES | now() | Created |
| expires_at | timestamptz | YES | now() + 7 days | Auto-close time ✅ |

**Indexes:**
- Primary key on `id`
- Index on `status, expires_at`
- Index on `requesting_user_id`

**Closure:** Handled by Google Cloud Scheduler calling event-processor every hour

---

#### `community_responses`
**Purpose:** Expert answers to community requests

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| request_id | uuid | NO | - | FK to community_requests |
| user_id | uuid | NO | - | FK to users (expert) |
| response_text | text | NO | - | LLM-summarized answer |
| verbatim_answer | text | NO | - | Original expert text |
| usefulness_score | integer | YES | null | 0-10 LLM rating |
| impact_description | text | YES | null | Impact on requester |
| credits_awarded | integer | YES | null | Credits earned |
| credited_at | timestamptz | YES | null | When credited |
| status | varchar | YES | 'provided' | provided/rewarded/closed_loop |
| closed_loop_message | text | YES | null | Impact notification ✅ |
| closed_loop_at | timestamptz | YES | null | When notified ✅ |
| created_at | timestamptz | YES | now() | Created |

**Indexes:**
- Primary key on `id`
- Index on `request_id`
- Index on `user_id`
- Index on `status`

---

### Credits & Gamification

#### `credit_events`
**Purpose:** Credit transaction log (append-only)

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| user_id | uuid | NO | - | FK to users |
| event_type | varchar | NO | - | Type of credit event |
| amount | integer | NO | - | Credits (+ or -) |
| reference_type | varchar | NO | - | What triggered it |
| reference_id | uuid | NO | - | Reference entity |
| idempotency_key | varchar | NO | - | Prevent duplicates |
| description | text | YES | null | Human description |
| created_at | timestamptz | YES | now() | Transaction time |
| processed | boolean | YES | false | Applied to balance |

**Indexes:**
- Primary key on `id`
- Unique on `idempotency_key`
- Index on `user_id, created_at`
- Index on `processed`

**Trigger:** `update_user_credit_cache()` - Updates user.credit_balance

---

#### `user_credit_balances`
**Purpose:** Materialized view of credit balances

| Column | Type | Description |
|--------|------|-------------|
| user_id | uuid | FK to users |
| balance | bigint | Current balance |
| transaction_count | bigint | Total transactions |
| last_transaction_at | timestamptz | Last credit event |

**Type:** Materialized View (auto-updated by trigger)

---

### Supporting Tables

#### `innovators`
**Purpose:** Solution provider profiles

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| user_id | uuid | NO | - | FK to users |
| company_name | varchar | NO | - | Company name |
| solution_description | text | YES | null | What they offer |
| categories | text[] | YES | null | Solution categories |
| target_customer_profile | text | YES | null | ICP description |
| video_url | varchar | YES | null | Demo video |
| credits_balance | integer | YES | 0 | Current credits |
| active | boolean | YES | true | Active status |
| created_at | timestamptz | YES | now() | Created |

**Indexes:**
- Primary key on `id`
- Unique on `user_id`
- Index on `active`

---

#### `prospects`
**Purpose:** Non-platform individuals for matching

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| email | text | YES | null | Email |
| phone_number | text | YES | null | Phone |
| linkedin_url | text | YES | null | LinkedIn |
| first_name | text | YES | null | First name |
| last_name | text | YES | null | Last name |
| company | text | YES | null | Company |
| title | text | YES | null | Title |
| innovator_id | uuid | NO | - | FK to innovators (owner) |
| uploaded_at | timestamptz | NO | now() | Upload time |
| upload_source | text | YES | null | Source (csv/manual/api) |
| upload_batch_id | uuid | YES | null | Batch identifier |
| status | text | NO | 'pending' | pending/converted/inactive |
| converted_to_user_id | uuid | YES | null | FK to users |
| converted_at | timestamptz | YES | null | Conversion time |
| prospect_notes | text | YES | null | Notes |
| target_solution_categories | text[] | YES | null | Interested in |
| metadata | jsonb | YES | null | Additional data |
| created_at | timestamptz | NO | now() | Created |
| updated_at | timestamptz | NO | now() | Updated |

**Indexes:**
- Primary key on `id`
- Index on `innovator_id`
- Index on `status`
- Index on `email` (for lookup)

---

#### `linkedin_research_prospects`
**Purpose:** LinkedIn research tracking (prevents duplicate work)

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| name | varchar | NO | - | Prospect name |
| company | varchar | YES | null | Company |
| title | varchar | YES | null | Title |
| linkedin_url | varchar | YES | null | LinkedIn |
| email | varchar | YES | null | Email |
| mutual_connections | jsonb | YES | null | Shared connections |
| last_researched_at | timestamptz | YES | null | Last lookup |
| users_researching | uuid[] | YES | null | Users who researched |
| created_at | timestamptz | YES | now() | Created |

**Indexes:**
- Primary key on `id`
- Index on `linkedin_url`
- Index on `name, company`

---

### Logging & Monitoring

#### `agent_instances`
**Purpose:** Agent configuration and lifecycle tracking

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| agent_type | varchar | NO | - | Agent type |
| user_id | uuid | YES | null | FK to users (if user-specific) |
| config_json | jsonb | YES | null | Configuration |
| prompt_version | varchar | YES | null | Prompt version |
| status | varchar | YES | 'active' | active/terminated |
| last_active_at | timestamptz | YES | now() | Last activity |
| created_at | timestamptz | YES | now() | Created |
| terminated_at | timestamptz | YES | null | Terminated |

**Indexes:**
- Primary key on `id`
- Index on `agent_type, status`

---

#### `agent_actions_log`
**Purpose:** Comprehensive logging of all LLM calls and agent decisions

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| agent_type | varchar | NO | - | Which agent |
| agent_instance_id | uuid | YES | null | FK to agent_instances |
| action_type | varchar | NO | - | What action |
| user_id | uuid | YES | null | FK to users |
| context_id | uuid | YES | null | Related entity |
| context_type | varchar | YES | null | Entity type |
| model_used | varchar | YES | null | LLM model |
| input_tokens | integer | YES | null | Tokens in |
| output_tokens | integer | YES | null | Tokens out |
| cost_usd | numeric | YES | null | API cost |
| latency_ms | integer | YES | null | Response time |
| input_data | jsonb | YES | null | Input data |
| output_data | jsonb | YES | null | Output data |
| error | text | YES | null | Error details |
| created_at | timestamptz | YES | now() | Action time |

**Indexes:**
- Primary key on `id`
- Index on `agent_type, created_at`
- Index on `user_id`
- Index on `action_type`

---

## Key Architectural Patterns

### Event Sourcing
All inter-agent communication goes through the `events` table:
```sql
INSERT INTO events (event_type, aggregate_id, payload, created_by)
VALUES ('community.request_needed', user_id, {...}, 'concierge_agent');
```

The `notify_event()` trigger sends PostgreSQL NOTIFY, which event-processor listens to.

### Task Queue
Background work goes into `agent_tasks`:
```sql
INSERT INTO agent_tasks (task_type, agent_type, user_id, context_json, scheduled_for)
VALUES ('community_request_available', 'account_manager', expert_id, {...}, NOW());
```

Task-processor polls with `FOR UPDATE SKIP LOCKED` pattern.

### Message Orchestration
All outbound messages go through `message_queue` for:
- Rate limiting (via `user_message_budget`)
- Priority management
- Message sequencing
- Superseding (cancel older messages)

### Credit System
Credits are append-only in `credit_events`, with trigger updating:
- `users.credit_balance` (cached)
- `user_credit_balances` (materialized view)

---

## Missing Tables from Code

None! All tables in code exist in the schema.

## New Tables Not Yet Documented

1. **linkedin_research_prospects** - Appears to be for deduplication of LinkedIn lookups

---

## Schema Verification Status

✅ **All Agent of Humans tables present and correct**
✅ **Message sequences fields added to message_queue**
✅ **Email verification field added to users**
✅ **Closure fields added to community_requests and community_responses**

**Last Schema Audit:** October 18, 2025
