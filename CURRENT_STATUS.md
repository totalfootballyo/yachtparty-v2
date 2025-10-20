# Yachtparty Project - Current Status Report

**Date:** October 16, 2025
**Status:** MVP in Progress - Simplified Architecture Deployed
**Document Purpose:** Single source of truth mapping what's ACTUALLY deployed vs. what's documented in requirements.md

---

## Executive Summary

**What Works Right Now:**
- ✅ SMS inbound → Bouncer/Concierge/Innovator agents → SMS outbound (full loop)
- ✅ 2 Cloud Run services deployed and operational
- ✅ Agents embedded in twilio-webhook service (direct invocation, no event queue)
- ✅ Database trigger-based SMS sending (pg_net webhook, not Realtime subscriptions)
- ✅ Core database tables (users, conversations, messages, events, agent_tasks)

**Critical Architectural Deviation:**
We implemented a **simplified, synchronous architecture** due to Supabase Realtime timeout issues. This deviates significantly from the event-driven saga pattern documented in requirements.md, but provides a working MVP.

**What's Missing:**
- ❌ Separate agent packages (agents are embedded in twilio-webhook)
- ❌ Message Orchestrator (rate limiting, priority management)
- ❌ Event-driven coordination between agents
- ❌ 4 of 6 specialized agents (Account Manager, Solution Saga, Agent of Humans, Social Butterfly)
- ❌ Most supporting database tables (user_priorities, solution_workflows, intro_opportunities, etc.)
- ❌ Testing infrastructure

---

## ✅ Actually Deployed & Working

### 1. **twilio-webhook** Service (Cloud Run)

**Deployment Status:** ✅ Live - Revision 00019-w4d
**Location:** `/Users/bt/Desktop/CODE/Yachtparty v.2/packages/services/twilio-webhook/src/index.ts`

**What It Does:**
- Receives inbound SMS from Twilio on POST /sms
- Validates Twilio webhook signatures (lines 128-204)
- Creates/finds users and conversations (lines 218-309)
- Records inbound messages (lines 321-349)
- **DIRECTLY invokes agents** (lines 434-675) - NOT event-driven
- Agents write responses to messages table with status='pending'

**Agent Implementation (Embedded Functions):**

1. **Bouncer Agent** (lines 434-557)
   - For unverified users (user.verified = false)
   - Personality: Velvet rope gatekeeper with mystery/exclusivity positioning
   - Prompt engineering with explicit "NO" rules:
     - NO exclamation points
     - NO superlatives (exclusive, amazing, incredible, exceptional)
     - NO marketing speak or hype language
   - Few-shot examples for common scenarios
   - First contact: "Hey... who told you about this?"
   - Product description: "I'm just the bouncer but here are the basics: Yachtparty helps you get the industry intros, recs, and info you need—vetted by high-level peers. No fees. You earn credits (like equity) for participating..."
   - Model: claude-sonnet-4-20250514
   - Settings: temperature=0.3, max_tokens=512
   - Collects: referral source, name, company, title, email, LinkedIn, first nomination

2. **Concierge Agent** (lines 564-657)
   - For verified users with poc_agent_type='concierge'
   - Personality: Competent, proactive but never pushy (senior partner manager, not sycophant)
   - Pulls user priorities from user_priorities table (top 5)
   - Model: claude-sonnet-4-20250514
   - Settings: temperature=0.3 (implied), max_tokens=1024
   - Available actions: request_solution_research, show_intro_opportunity, ask_community_question, update_user_preferences, schedule_followup

3. **Innovator Agent** (lines 665-675)
   - For verified users with poc_agent_type='innovator'
   - Currently just wraps Concierge agent (placeholder for future innovator-specific features)
   - Location: line 674 `return invokeConciergeAgent(message, user, conversation);`

**Action Execution:**
- Lines 380-427: `executeAction()` function handles agent-returned actions
- Supported actions:
  - `update_user_field` - Updates user record
  - `create_verification_task` - Inserts into agent_tasks table
  - `request_solution_research` - Publishes event (but no handler exists)
  - `schedule_followup` - Creates agent_task for re-engagement

**Environment Variables Required:**
```
TWILIO_AUTH_TOKEN
SUPABASE_URL
SUPABASE_SERVICE_KEY
ANTHROPIC_API_KEY
PORT (default: 8080)
```

**Endpoints:**
- `POST /sms` - Twilio webhook (signature validation required)
- `GET /health` - Health check for Cloud Run

---

### 2. **sms-sender** Service (Cloud Run)

**Deployment Status:** ✅ Live
**Location:** `/Users/bt/Desktop/CODE/Yachtparty v.2/packages/services/sms-sender/src/index.ts`

**What It Does:**
- HTTP webhook endpoint on POST /send-sms
- **Triggered by database pg_net trigger** (NOT Realtime subscriptions)
- Gets conversation for recipient phone number
- Sends via Twilio API with exponential backoff retry (max 3 retries)
- Updates message with twilio_message_sid, status='sent', sent_at

**Database Trigger:**
Location: `/Users/bt/Desktop/CODE/Yachtparty v.2/packages/database/migrations/004_triggers.sql` (lines 186-212)
```sql
CREATE OR REPLACE FUNCTION notify_send_sms()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.direction = 'outbound' AND NEW.status = 'pending' THEN
    PERFORM pg_notify('send_sms', row_to_json(NEW)::text);
    UPDATE messages SET status = 'queued_for_send' WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_message_send
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION notify_send_sms();
```

**Note:** The trigger fires WHEN `NEW.status = 'pending' AND NEW.direction = 'outbound'`

**Retry Logic:**
- Lines 84-123: Exponential backoff with 1s initial delay
- Max 3 retries before marking as 'failed'

**Environment Variables Required:**
```
SUPABASE_URL
SUPABASE_SERVICE_KEY
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_PHONE_NUMBER
PORT (default: 8080)
```

**Endpoints:**
- `POST /send-sms` - Webhook from database trigger
- `GET /health` - Health check

---

### 3. **Database Tables** (Partially Deployed)

**Migration Files:**
```
001_core_tables.sql - Core tables for messaging and events
002_agent_tables.sql - Agent coordination tables
003_supporting_tables.sql - Prospects, innovators, logging
004_triggers.sql - Database triggers and functions
005_pg_cron.sql - Scheduled task processing
```

**Tables That Definitely Exist (used by deployed services):**

From `001_core_tables.sql`:
- ✅ **users** - User records (phone_number, email, verified, poc_agent_type, credit_balance, etc.)
- ✅ **conversations** - Conversation threads (user_id, phone_number, status, conversation_summary, messages_since_summary)
- ✅ **messages** - Individual messages (conversation_id, role, content, direction, status, twilio_message_sid)
- ✅ **events** - Event sourcing table (event_type, aggregate_id, payload, processed)
- ✅ **agent_tasks** - Task queue (task_type, agent_type, user_id, scheduled_for, status, context_json)
- ✅ **message_queue** - Outbound message queue (NOT USED - Message Orchestrator not deployed)
- ✅ **user_message_budget** - Rate limiting (NOT USED - Message Orchestrator not deployed)

From `003_supporting_tables.sql`:
- ✅ **prospects** - Individuals not yet on platform
- ✅ **innovators** - Companies offering solutions
- ✅ **agent_instances** - Agent configuration versions
- ✅ **agent_actions_log** - Comprehensive logging for debugging and cost tracking
- ✅ **conversations.messages_since_summary** - Added column (line 135)

**Tables That Probably Exist (from 002_agent_tables.sql):**
- ❓ **user_priorities** - Account Manager priorities (referenced by Concierge agent but no data)
- ❓ **solution_workflows** - Solution Saga workflows (no agent to use it)
- ❓ **intro_opportunities** - Intro matching (no agent to use it)
- ❓ **community_requests** - Community questions (no agent to use it)
- ❓ **community_responses** - Expert responses (no agent to use it)
- ❓ **credit_events** - Credit transaction log (no credit system implemented)

**Triggers That Exist:**
- ✅ `notify_event()` - Publishes events to PostgreSQL NOTIFY (line 19-42 in 004_triggers.sql)
- ✅ `update_user_credit_cache()` - Updates user credit balance (line 56-77)
- ✅ `check_conversation_summary()` - Triggers summarization every 50 messages (line 86-132)
- ✅ `handle_phone_number_change()` - Archives old phone numbers (line 140-178)
- ✅ `notify_send_sms()` - Triggers SMS sending (line 186-212)

**Note on messages_since_summary:**
This column was added in migration 003 (line 135) but the core conversations table from migration 001 doesn't include it. This suggests migrations 001 AND 003 have been run.

---

### 4. **Shared Package** (@yachtparty/shared)

**Location:** `/Users/bt/Desktop/CODE/Yachtparty v.2/packages/shared/`

**What It Provides:**
- TypeScript type definitions (User, Conversation, Message, etc.)
- Supabase client factory: `createServiceClient()`
- Shared utilities used by all services

**Status:** ✅ Built and working (used by twilio-webhook and sms-sender)

---

## 🔄 Partially Implemented / Not Being Used

### 1. **realtime-processor** Service (Deployed but NOT in Critical Path)

**Deployment Status:** ⚠️ May still be deployed from previous session, but BYPASSED
**Location:** `/Users/bt/Desktop/CODE/Yachtparty v.2/packages/services/realtime-processor/src/index.ts`

**Original Design:**
- Subscribe to Supabase Realtime via WebSocket
- Channel 1: 'user-messages' - INSERT on messages table (inbound)
- Channel 2: 'agent-events' - INSERT on events table
- Route messages to agents based on user state
- Process events for agent coordination

**Why It's Not Used:**
- Supabase Realtime subscriptions consistently timed out
- Simplified to direct invocation in twilio-webhook instead
- Database triggers (pg_net) replaced Realtime for SMS sending

**Code Exists But Unused:**
- Lines 156-192: `subscribeToUserMessages()` - WebSocket subscription
- Lines 198-227: `subscribeToAgentEvents()` - WebSocket subscription
- Lines 237-293: `processInboundMessage()` - Agent routing
- Lines 305-335: `routeEventToAgent()` - Event handling
- Lines 342-419: `invokeBouncerAgent()` - Duplicated in twilio-webhook
- Lines 426-518: `invokeConciergeAgent()` - Duplicated in twilio-webhook
- Lines 526-536: `invokeInnovatorAgent()` - Duplicated in twilio-webhook

**Status:** Code exists, may be deployed, but critical path bypasses it entirely.

---

### 2. **Agent Packages** (Code Exists, Not Deployed)

**Location:** `/Users/bt/Desktop/CODE/Yachtparty v.2/packages/agents/`

**Bouncer Agent Package:**
- ✅ Code: `/packages/agents/bouncer/src/index.ts` (683 lines)
- ✅ Prompt engineering: `/packages/agents/bouncer/src/prompts.ts`
- ✅ Onboarding logic: `/packages/agents/bouncer/src/onboarding-steps.ts`
- ❌ **NOT DEPLOYED** - Embedded version in twilio-webhook is used instead
- **Key Difference:** Package version has:
  - Information extraction as separate LLM call (lines 396-472)
  - Response generation as separate LLM call (lines 477-564)
  - Re-engagement message generation (lines 569-639)
  - Prompt caching for cost optimization (cache_control: ephemeral)
  - Cost tracking in agent_actions_log

**Concierge Agent Package:**
- ✅ Code: `/packages/agents/concierge/src/index.ts`
- ✅ Intent classifier: `/packages/agents/concierge/src/intent-classifier.ts`
- ✅ Message renderer: `/packages/agents/concierge/src/message-renderer.ts`
- ✅ Prompts: `/packages/agents/concierge/src/prompts.ts`
- ❌ **NOT DEPLOYED** - Embedded version in twilio-webhook is used instead

**Account Manager Agent Package:**
- ✅ Code: `/packages/agents/account-manager/src/index.ts`
- ✅ Priority scorer: `/packages/agents/account-manager/src/priority-scorer.ts`
- ✅ Event processor: `/packages/agents/account-manager/src/event-processor.ts`
- ✅ Task creator: `/packages/agents/account-manager/src/task-creator.ts`
- ❌ **NOT DEPLOYED** - No service using this package

**Why Not Deployed:**
- Simplified architecture embeds agents directly in twilio-webhook
- Avoids event-driven complexity that caused Realtime timeout issues
- Trade-off: Less separation of concerns, but working system

---

### 3. **Message Orchestrator** (Code Exists, Not Deployed)

**Location:** `/Users/bt/Desktop/CODE/Yachtparty v.2/packages/orchestrator/`

**What It's Supposed to Do (from requirements.md):**
- Rate limiting (5 messages/day per user max)
- Priority-based delivery
- Quiet hours enforcement
- Message relevance checking before sending
- Superseding stale messages

**Code That Exists:**
- ✅ `/packages/orchestrator/src/index.ts` - Main orchestrator
- ✅ `/packages/orchestrator/src/rate-limiter.ts` - Rate limiting logic
- ✅ `/packages/orchestrator/src/relevance-checker.ts` - Message relevance checking
- ✅ `/packages/orchestrator/src/types.ts` - Type definitions
- ✅ `/packages/orchestrator/src/__tests__/rate-limiter.test.ts` - Tests

**Why It's Not Used:**
- Current MVP has no need for rate limiting (agents send immediate replies)
- No queued messages to prioritize
- message_queue and user_message_budget tables exist but are empty

**Impact:**
- ⚠️ Users can receive unlimited messages (no rate limiting)
- ⚠️ No quiet hours enforcement
- ⚠️ No priority-based delivery
- ⚠️ No relevance checking (could send stale info)

---

## ❌ Documented But Not Built

### 1. **Agents Not Implemented**

From requirements.md Section 4 (Agent Architecture):

**Account Manager Agent**
- **Status:** ❌ Code exists in `/packages/agents/account-manager/` but NOT deployed
- **Purpose:** Track user priorities, intent detection, engagement pattern analysis
- **Why Missing:** Event-driven coordination not implemented
- **Impact:** Concierge has no user priorities to work with (pulls from empty user_priorities table)

**Solution Saga Agent**
- **Status:** ❌ Not implemented at all
- **Purpose:** Multi-step solution research workflow
- **Why Missing:** Complex saga pattern not implemented, Perplexity integration not built
- **Impact:** No automated solution discovery when users ask for recommendations

**Agent of Humans**
- **Status:** ❌ Not implemented at all
- **Purpose:** Routes questions to expert community members
- **Why Missing:** Community request matching not built
- **Impact:** No way to leverage network expertise

**Social Butterfly Agent**
- **Status:** ❌ Not implemented at all
- **Purpose:** Proactive intro matching based on goals, geography, mutual connections
- **Why Missing:** LinkedIn integration not built, intro_opportunities table unused
- **Impact:** No automated intro suggestions

**Intro Agent**
- **Status:** ❌ Not implemented at all
- **Purpose:** Facilitates double opt-in intros
- **Why Missing:** Intro workflow not implemented
- **Impact:** No structured intro process

**Credit Funding Agent**
- **Status:** ❌ Not implemented at all
- **Purpose:** Process credit purchases, funding, withdrawals
- **Why Missing:** Payment integration not built
- **Impact:** No way to fund credit balance (credit_events table exists but unused)

---

### 2. **Database Tables Not Being Used**

Even if these tables exist in the database, no code is populating or reading them:

From `002_agent_tables.sql`:
- ❌ **user_priorities** - Account Manager priorities (table may exist, but no data)
- ❌ **solution_workflows** - Solution Saga workflows (no Solution Saga agent)
- ❌ **intro_opportunities** - Intro matching (no Social Butterfly or Intro agent)
- ❌ **community_requests** - Community questions (no Agent of Humans)
- ❌ **community_responses** - Expert responses (no Agent of Humans)
- ❌ **credit_events** - Credit transactions (no Credit Funding agent)

From `001_core_tables.sql` (exist but unused):
- ❌ **message_queue** - Orchestrator message queue (no Message Orchestrator)
- ❌ **user_message_budget** - Rate limiting (no Message Orchestrator)

**These tables are defined in migrations and may exist in the database, but are effectively dead code.**

---

### 3. **Testing Infrastructure**

From requirements.md Appendix B:

**Test Cases Documented:** 66 test cases across all agents
- Bouncer Agent: 11 test cases
- Concierge Agent: 9 test cases
- Account Manager: 8 test cases
- Solution Saga: 10 test cases
- Agent of Humans: 9 test cases
- Social Butterfly: 10 test cases
- Message Orchestrator: 9 test cases

**Actual Tests Implemented:** ❌ Minimal
- `/packages/orchestrator/src/__tests__/rate-limiter.test.ts` exists
- No other test files found

**Test Scripts in package.json:** ❌ Not configured for most packages

---

### 4. **Features Not Implemented**

From requirements.md:

**Proactive Engagement (Section 1.3):**
- ❌ Re-engagement checks after 24h inactivity (agent_tasks exist but no cron processor)
- ❌ Proactive intro suggestions (no Social Butterfly)
- ❌ Solution research follow-ups (no Solution Saga)

**Network-Positive Incentives:**
- ❌ Credit earning for making intros
- ❌ Credit earning for answering community questions
- ❌ Credit earning for sharing insights
- ❌ Credit earning for successful referrals

**Message Discipline:**
- ❌ Rate limiting (5 messages/day max)
- ❌ Quiet hours enforcement
- ❌ Priority-based delivery
- ❌ Relevance checking before sending

**Event-Driven Saga Orchestration (Section 2.2):**
- ❌ Events published to events table but no processors listening
- ❌ No saga workflows implemented
- ❌ No multi-step agent coordination

**Scheduled Tasks (Section 6.4):**
- ❌ pg_cron extension enabled but no jobs configured
- ❌ Re-engagement checks not running
- ❌ Priority recalculation not running
- ❌ Intro matching not running

**LinkedIn Integration:**
- ❌ Apify integration for mutual connection discovery
- ❌ LinkedIn profile enrichment
- ❌ Mutual connection verification

**Research Capabilities:**
- ❌ Perplexity API integration for solution research
- ❌ Web search for company/product research
- ❌ Expert matching algorithms

---

## 🏗️ Architecture Simplifications

These are **intentional deviations** from requirements.md documented during October 16, 2025 development session:

### Change 1: Direct Agent Invocation (Not Event-Driven)

**Requirements.md Design:**
```
SMS → twilio-webhook → event published → realtime-processor subscribes via WebSocket → agent invoked
```

**Actual Implementation:**
```
SMS → twilio-webhook → agent directly invoked → response written to DB
```

**Why Changed:**
- Supabase Realtime WebSocket subscriptions consistently timed out
- Added latency and complexity without reliability
- Simplified to direct function calls within twilio-webhook service

**Code Location:**
- `/packages/services/twilio-webhook/src/index.ts` lines 685-748
- `processInboundMessageWithAgent()` function directly calls agent functions

**Impact:**
- ✅ PRO: Reliable, fast (no WebSocket timeouts)
- ✅ PRO: Simpler debugging (single service logs)
- ❌ CON: Agents tightly coupled to webhook service
- ❌ CON: Can't scale agents independently
- ❌ CON: No event replay capability

---

### Change 2: Database Triggers for SMS (Not Realtime Subscriptions)

**Requirements.md Design:**
```
Agent writes → messages INSERT → Realtime subscription → sms-sender → Twilio
```

**Actual Implementation:**
```
Agent writes → messages INSERT → pg_net trigger → sms-sender webhook → Twilio
```

**Why Changed:**
- Realtime subscriptions unreliable for critical path (message delivery)
- Database triggers (PostgreSQL NOTIFY) more reliable
- Changed sms-sender from WebSocket subscriber to HTTP webhook endpoint

**Code Location:**
- Trigger: `/packages/database/migrations/004_triggers.sql` lines 186-212
- Service: `/packages/services/sms-sender/src/index.ts` lines 230-259 (POST /send-sms endpoint)

**Impact:**
- ✅ PRO: More reliable (no WebSocket dependency)
- ✅ PRO: Database-native (PostgreSQL NOTIFY is battle-tested)
- ❌ CON: Less flexibility (can't easily change SMS provider)
- ❌ CON: Couples sms-sender to database schema

---

### Change 3: Agents Embedded in Services (Not Separate Packages)

**Requirements.md Design:**
```
Agents as separate npm packages imported by realtime-processor
```

**Actual Implementation:**
```
Agents as embedded functions in twilio-webhook service
```

**Why Changed:**
- Simpler deployment (fewer dependencies)
- Faster iteration during MVP development
- Avoided event-sourcing complexity

**Code Location:**
- Bouncer: `/packages/services/twilio-webhook/src/index.ts` lines 434-557
- Concierge: `/packages/services/twilio-webhook/src/index.ts` lines 564-657
- Innovator: `/packages/services/twilio-webhook/src/index.ts` lines 665-675

**Impact:**
- ✅ PRO: Simpler deployment and testing
- ✅ PRO: No package versioning issues
- ❌ CON: Agent code not reusable
- ❌ CON: Limited to single model (can't A/B test prompts easily)
- ❌ CON: No prompt caching (embedded agents don't use cache_control)

**Note:** More sophisticated agent packages DO exist in `/packages/agents/` but are not deployed.

---

### Change 4: No Message Orchestrator (Immediate Replies Only)

**Requirements.md Design:**
```
Agents → message_queue → Orchestrator checks rate limits/relevance → sends
```

**Actual Implementation:**
```
Agents → messages table (status='pending') → immediate send
```

**Why Changed:**
- MVP doesn't need rate limiting yet (low user volume)
- Immediate replies provide better UX for onboarding
- Reduced complexity

**Impact:**
- ✅ PRO: Faster responses (no queuing delay)
- ✅ PRO: Simpler architecture
- ❌ CON: No rate limiting (could spam users)
- ❌ CON: No quiet hours enforcement
- ❌ CON: No message relevance checking
- ❌ CON: Can't prioritize messages

---

### Change 5: No Event Processing (Events Written But Not Consumed)

**Requirements.md Design:**
```
Agents publish events → realtime-processor routes to handlers → saga workflows
```

**Actual Implementation:**
```
Agents publish events → events table (processed=false) → NO CONSUMERS
```

**Why Changed:**
- Event-driven coordination not needed for simple Bouncer/Concierge flow
- Realtime subscription issues made event processing unreliable
- Synchronous flow simpler to debug

**Code That Writes Events (But Nothing Reads Them):**
- `/packages/services/twilio-webhook/src/index.ts` lines 404-410 (request_solution_research action)
- Events table has notify_event() trigger but no subscribers

**Impact:**
- ✅ PRO: Simpler debugging (no event replay confusion)
- ❌ CON: No audit trail of agent decisions
- ❌ CON: Can't implement sagas (multi-step workflows)
- ❌ CON: Can't replay events for testing
- ❌ CON: Events accumulate in database (processed=false forever)

---

## 📋 Priority Build Order

**Recommended order for building missing components:**

### Phase 1: Complete MVP (Weeks 1-2)

**Goal:** Full onboarding flow with basic verification

1. **Fix Bouncer Agent Email Verification**
   - Generate unique verification email addresses (verify-{user_id}@verify.yachtparty.xyz)
   - Set up email forwarding/webhook to mark users verified
   - Update Bouncer to transition users to Concierge when verified
   - **Files to modify:**
     - `/packages/services/twilio-webhook/src/index.ts` (Bouncer agent logic)
     - Add email verification webhook endpoint

2. **Deploy Separate Bouncer Agent Package**
   - Use existing `/packages/agents/bouncer/` code (more sophisticated than embedded version)
   - Implement prompt caching (40% cost reduction)
   - Add re-engagement task processing
   - **Why:** Better prompt engineering, cost optimization, proper onboarding flow
   - **Files:**
     - `/packages/agents/bouncer/src/index.ts`
     - `/packages/agents/bouncer/src/prompts.ts`
     - `/packages/agents/bouncer/src/onboarding-steps.ts`

3. **Scheduled Task Processor**
   - Process agent_tasks table for re-engagement checks
   - Run via pg_cron every 5 minutes
   - **Why:** Users who drop off during onboarding need follow-up
   - **Files to create:**
     - `/packages/services/task-processor/src/index.ts`
   - **Migrations to apply:**
     - `/packages/database/migrations/005_pg_cron.sql` (may already be applied)

4. **Testing Infrastructure**
   - Set up Jest/Vitest for all packages
   - Implement Bouncer agent test cases (11 from requirements.md Appendix B)
   - Add integration tests for SMS flow
   - **Files to create:**
     - `/packages/agents/bouncer/src/__tests__/index.test.ts`
     - `/packages/services/twilio-webhook/src/__tests__/index.test.ts`

---

### Phase 2: Account Management (Weeks 3-4)

**Goal:** Track user priorities and improve Concierge responses

5. **Deploy Account Manager Agent**
   - Use existing `/packages/agents/account-manager/` code
   - Process conversation messages to extract priorities
   - Populate user_priorities table
   - **Why:** Concierge currently has no context about user goals
   - **Files:**
     - `/packages/agents/account-manager/src/index.ts`
     - `/packages/agents/account-manager/src/priority-scorer.ts`
     - `/packages/agents/account-manager/src/event-processor.ts`

6. **Event Processor Service**
   - Subscribe to events table (via database polling, NOT Realtime)
   - Route events to Account Manager
   - Mark events as processed=true
   - **Why:** Account Manager needs conversation events to track priorities
   - **Files to create:**
     - `/packages/services/event-processor/src/index.ts`

7. **Improve Concierge Agent**
   - Deploy separate Concierge package (better than embedded version)
   - Use user_priorities from Account Manager
   - Implement intent classification
   - **Files:**
     - `/packages/agents/concierge/src/index.ts`
     - `/packages/agents/concierge/src/intent-classifier.ts`
     - `/packages/agents/concierge/src/message-renderer.ts`

---

### Phase 3: Message Discipline (Weeks 5-6)

**Goal:** Prevent message fatigue with rate limiting and scheduling

8. **Deploy Message Orchestrator**
   - Use existing `/packages/orchestrator/` code
   - Implement rate limiting (5 messages/day max)
   - Enforce quiet hours
   - Populate user_message_budget table
   - **Why:** Critical for user experience at scale
   - **Files:**
     - `/packages/orchestrator/src/index.ts`
     - `/packages/orchestrator/src/rate-limiter.ts`
     - `/packages/orchestrator/src/relevance-checker.ts`

9. **Transition to Queued Messages**
   - Change agents to write to message_queue instead of messages
   - Orchestrator approves/schedules messages
   - SMS sender pulls from message_queue
   - **Why:** Enables priority-based delivery and rate limiting
   - **Files to modify:**
     - All agent packages (write to message_queue)
     - `/packages/services/sms-sender/src/index.ts` (read from message_queue)

10. **Message Relevance Checking**
    - LLM check before sending queued messages
    - Supersede stale messages
    - **Why:** Prevents sending outdated info
    - **Files:**
      - `/packages/orchestrator/src/relevance-checker.ts`

---

### Phase 4: Network Value (Weeks 7-10)

**Goal:** Enable intro matching and community expertise

11. **Agent of Humans**
    - Implement community request matching
    - Populate community_requests and community_responses tables
    - Notify experts via SMS when they can help
    - **Files to create:**
      - `/packages/agents/agent-of-humans/src/index.ts`

12. **Social Butterfly Agent**
    - Implement intro opportunity matching
    - Populate intro_opportunities table
    - Match based on user_priorities from Account Manager
    - **Files to create:**
      - `/packages/agents/social-butterfly/src/index.ts`

13. **Intro Agent**
    - Facilitate double opt-in intros
    - Track intro status
    - Award credits for successful intros
    - **Files to create:**
      - `/packages/agents/intro-agent/src/index.ts`

14. **Credit System**
    - Implement credit_events tracking
    - Award credits for network-positive actions
    - Display credit balance to users
    - **Files to modify:**
      - All agents (publish credit_events)
      - `/packages/agents/concierge/` (show credit balance)

---

### Phase 5: Advanced Features (Weeks 11-14)

**Goal:** Solution research and LinkedIn integration

15. **Solution Saga Agent**
    - Implement multi-step research workflow
    - Integrate Perplexity API for research
    - Populate solution_workflows table
    - **Files to create:**
      - `/packages/agents/solution-saga/src/index.ts`

16. **LinkedIn Integration**
    - Set up Apify for mutual connection discovery
    - Enrich user profiles with LinkedIn data
    - Verify mutual connections for intro confidence
    - **Files to create:**
      - `/packages/integrations/linkedin/src/index.ts`

17. **Credit Funding Agent**
    - Implement Stripe integration for credit purchases
    - Process credit funding requests
    - Handle withdrawals/refunds
    - **Files to create:**
      - `/packages/agents/credit-funding/src/index.ts`

---

## 🚨 Critical Gaps

**Blocking MVP Completion:**

### 1. Email Verification Not Implemented

**Problem:** Bouncer asks users to email verify-{user_id}@verify.yachtparty.xyz but nothing happens

**Current State:**
- Bouncer generates verification email in prompt (line 370, 506 in twilio-webhook)
- No email receiving webhook
- Users never get verified (user.verified stays false forever)

**What's Needed:**
- Set up email forwarding to webhook endpoint
- Parse incoming emails to extract user_id
- Update users table to set verified=true, poc_agent_type='concierge'
- Transition user to Concierge agent

**Estimated Effort:** 4 hours

---

### 2. No Task Processor for Scheduled Work

**Problem:** agent_tasks table exists but nothing processes it

**Current State:**
- Bouncer and Concierge create tasks (createReengagementTask, schedule_followup)
- Tasks sit in database with status='pending'
- No cron job or service to execute tasks

**What's Needed:**
- Task processor service (Cloud Run or pg_cron function)
- Query for tasks WHERE status='pending' AND scheduled_for <= NOW()
- Invoke appropriate agent for each task
- Mark tasks as completed/failed

**Estimated Effort:** 8 hours

---

### 3. No User Priority Tracking

**Problem:** Concierge has no context about user goals

**Current State:**
- Concierge queries user_priorities table (twilio-webhook line 586-592)
- Table is empty (no Account Manager populating it)
- Concierge has no idea what users actually want

**What's Needed:**
- Deploy Account Manager agent
- Process conversation messages to extract priorities
- Populate user_priorities table
- Concierge uses priorities in prompts

**Estimated Effort:** 12 hours

---

### 4. No Rate Limiting

**Problem:** Users can receive unlimited messages (spam risk)

**Current State:**
- user_message_budget table exists but unused
- No rate limiting logic in place
- Agents send immediate replies always

**What's Needed:**
- Deploy Message Orchestrator
- Check rate limits before sending
- Queue messages if over limit
- Respect quiet hours

**Estimated Effort:** 16 hours

---

### 5. Event Table Bloat

**Problem:** Events accumulate with processed=false, never cleaned up

**Current State:**
- Events published to events table (e.g., request_solution_research)
- No event processors consuming events
- processed flag stays false forever
- Table grows indefinitely

**What's Needed:**
- Event processor service to consume events
- Mark events as processed=true
- Archive/delete old processed events (90 day retention)

**Estimated Effort:** 8 hours

---

### 6. No Testing Infrastructure

**Problem:** No automated tests, high risk of regressions

**Current State:**
- 66 test cases documented in requirements.md Appendix B
- Only 1 test file exists: `/packages/orchestrator/src/__tests__/rate-limiter.test.ts`
- No CI/CD pipeline

**What's Needed:**
- Set up Jest/Vitest for all packages
- Implement Bouncer test cases (11 cases)
- Implement Concierge test cases (9 cases)
- Add integration tests for full SMS flow
- Set up GitHub Actions CI

**Estimated Effort:** 24 hours

---

## 📊 Status Matrix

**Comparison: requirements.md vs. Actual State**

| Component | Requirements | Actual Status | File Locations | Notes |
|-----------|-------------|---------------|----------------|-------|
| **Services** | | | | |
| twilio-webhook | ✅ Defined | ✅ Deployed | `/packages/services/twilio-webhook/src/index.ts` | Live on Cloud Run revision 00019-w4d |
| sms-sender | ✅ Defined | ✅ Deployed | `/packages/services/sms-sender/src/index.ts` | Live on Cloud Run, webhook-based |
| realtime-processor | ✅ Defined | ⚠️ Deployed but NOT USED | `/packages/services/realtime-processor/src/index.ts` | Bypassed due to Realtime timeouts |
| task-processor | ✅ Defined | ❌ Not built | N/A | Needed for scheduled tasks |
| event-processor | ✅ Defined | ❌ Not built | N/A | Needed for event-driven sagas |
| **Agents** | | | | |
| Bouncer | ✅ Defined | ✅ Working (embedded) | `/packages/services/twilio-webhook/src/index.ts` lines 434-557 | Embedded in twilio-webhook, not separate package |
| Bouncer (package) | ✅ Defined | ✅ Code exists, NOT deployed | `/packages/agents/bouncer/src/index.ts` | More sophisticated than embedded version |
| Concierge | ✅ Defined | ✅ Working (embedded) | `/packages/services/twilio-webhook/src/index.ts` lines 564-657 | Embedded in twilio-webhook |
| Concierge (package) | ✅ Defined | ✅ Code exists, NOT deployed | `/packages/agents/concierge/src/index.ts` | More sophisticated than embedded version |
| Innovator | ✅ Defined | ⚠️ Placeholder | `/packages/services/twilio-webhook/src/index.ts` lines 665-675 | Just wraps Concierge |
| Account Manager | ✅ Defined | ✅ Code exists, NOT deployed | `/packages/agents/account-manager/src/index.ts` | Code complete, no service using it |
| Solution Saga | ✅ Defined | ❌ Not built | N/A | Complex saga pattern not implemented |
| Agent of Humans | ✅ Defined | ❌ Not built | N/A | Community matching not implemented |
| Social Butterfly | ✅ Defined | ❌ Not built | N/A | Intro matching not implemented |
| Intro Agent | ✅ Defined | ❌ Not built | N/A | Double opt-in flow not implemented |
| Credit Funding | ✅ Defined | ❌ Not built | N/A | Payment integration not built |
| **Infrastructure** | | | | |
| Message Orchestrator | ✅ Defined | ✅ Code exists, NOT deployed | `/packages/orchestrator/src/index.ts` | Rate limiting not active |
| Shared Package | ✅ Defined | ✅ Built & working | `/packages/shared/` | Used by all services |
| **Database Tables** | | | | |
| users | ✅ Defined | ✅ Deployed | Migration 001 line 16 | Working |
| conversations | ✅ Defined | ✅ Deployed | Migration 001 line 69 | Working, messages_since_summary added in 003 |
| messages | ✅ Defined | ✅ Deployed | Migration 001 line 100 | Working |
| events | ✅ Defined | ✅ Deployed, NOT consumed | Migration 001 line 136 | Events written but not processed |
| agent_tasks | ✅ Defined | ✅ Deployed, NOT processed | Migration 001 line 199 | Tasks created but no processor |
| message_queue | ✅ Defined | ✅ Deployed, NOT used | Migration 001 line 249 | Orchestrator not active |
| user_message_budget | ✅ Defined | ✅ Deployed, NOT used | Migration 001 line 297 | Rate limiting not active |
| user_priorities | ✅ Defined | ❓ Probably deployed, EMPTY | Migration 002 line 13 | No Account Manager populating it |
| solution_workflows | ✅ Defined | ❓ Probably deployed, EMPTY | Migration 002 line 43 | No Solution Saga using it |
| intro_opportunities | ✅ Defined | ❓ Probably deployed, EMPTY | Migration 002 line 87 | No Social Butterfly using it |
| community_requests | ✅ Defined | ❓ Probably deployed, EMPTY | Migration 002 line 138 | No Agent of Humans using it |
| community_responses | ✅ Defined | ❓ Probably deployed, EMPTY | Migration 002 line 183 | No Agent of Humans using it |
| credit_events | ✅ Defined | ❓ Probably deployed, EMPTY | Migration 002 line 224 | No credit system active |
| prospects | ✅ Defined | ✅ Deployed | Migration 003 line 10 | Table exists, no usage yet |
| innovators | ✅ Defined | ✅ Deployed | Migration 003 line 37 | Table exists, no usage yet |
| agent_instances | ✅ Defined | ✅ Deployed | Migration 003 line 69 | Table exists, no usage yet |
| agent_actions_log | ✅ Defined | ✅ Deployed | Migration 003 line 96 | Table exists, Bouncer package uses it |
| **Triggers** | | | | |
| notify_event() | ✅ Defined | ✅ Deployed | Migration 004 line 19 | Publishes events, no consumers |
| update_user_credit_cache() | ✅ Defined | ✅ Deployed | Migration 004 line 56 | Works, but no credit_events being written |
| check_conversation_summary() | ✅ Defined | ✅ Deployed | Migration 004 line 86 | Works, creates summarization tasks |
| handle_phone_number_change() | ✅ Defined | ✅ Deployed | Migration 004 line 140 | Works |
| notify_send_sms() | ✅ Defined | ✅ Deployed & ACTIVE | Migration 004 line 186 | Triggers sms-sender webhook |
| **Features** | | | | |
| SMS inbound/outbound | ✅ Defined | ✅ Working | twilio-webhook + sms-sender | Full loop operational |
| Email verification | ✅ Defined | ❌ Not implemented | N/A | Bouncer asks for it but nothing processes emails |
| Re-engagement checks | ✅ Defined | ❌ Not running | N/A | Tasks created but no processor |
| Rate limiting | ✅ Defined | ❌ Not active | Orchestrator code exists | No rate limiting in place |
| Quiet hours | ✅ Defined | ❌ Not active | Orchestrator code exists | No quiet hours enforcement |
| Priority-based delivery | ✅ Defined | ❌ Not active | Orchestrator code exists | All messages immediate |
| Relevance checking | ✅ Defined | ❌ Not active | Orchestrator code exists | No stale message detection |
| User priority tracking | ✅ Defined | ❌ Not active | Account Manager code exists | user_priorities table empty |
| Solution research | ✅ Defined | ❌ Not implemented | N/A | No Solution Saga, no Perplexity integration |
| Community Q&A | ✅ Defined | ❌ Not implemented | N/A | No Agent of Humans |
| Intro matching | ✅ Defined | ❌ Not implemented | N/A | No Social Butterfly |
| Credit earning | ✅ Defined | ❌ Not implemented | N/A | No credit_events being written |
| Credit funding | ✅ Defined | ❌ Not implemented | N/A | No payment integration |
| LinkedIn integration | ✅ Defined | ❌ Not implemented | N/A | No Apify integration |
| Event-driven sagas | ✅ Defined | ❌ Not implemented | N/A | Events written but not consumed |
| Scheduled tasks | ✅ Defined | ❌ Not running | N/A | pg_cron enabled but no jobs |
| **Testing** | | | | |
| Bouncer tests (11) | ✅ Defined | ❌ Not implemented | Appendix B | 0 of 11 test cases |
| Concierge tests (9) | ✅ Defined | ❌ Not implemented | Appendix B | 0 of 9 test cases |
| Account Manager tests (8) | ✅ Defined | ❌ Not implemented | Appendix B | 0 of 8 test cases |
| Solution Saga tests (10) | ✅ Defined | ❌ Not implemented | Appendix B | 0 of 10 test cases |
| Agent of Humans tests (9) | ✅ Defined | ❌ Not implemented | Appendix B | 0 of 9 test cases |
| Social Butterfly tests (10) | ✅ Defined | ❌ Not implemented | Appendix B | 0 of 10 test cases |
| Orchestrator tests (9) | ✅ Defined | ⚠️ 1 test file | `/packages/orchestrator/src/__tests__/` | rate-limiter.test.ts exists |
| Integration tests | ✅ Defined | ❌ Not implemented | Appendix B | 0 integration tests |

---

## Summary Statistics

**Services:**
- Deployed & Working: 2 (twilio-webhook, sms-sender)
- Deployed but NOT Used: 1 (realtime-processor)
- Not Built: 2 (task-processor, event-processor)

**Agents:**
- Working (embedded): 2 (Bouncer, Concierge)
- Working (placeholder): 1 (Innovator)
- Code Exists, NOT Deployed: 3 (Bouncer package, Concierge package, Account Manager)
- Not Built: 5 (Solution Saga, Agent of Humans, Social Butterfly, Intro Agent, Credit Funding)

**Database Tables:**
- Deployed & Working: 4 (users, conversations, messages, agent_actions_log)
- Deployed, NOT Used: 11 (events, agent_tasks, message_queue, user_message_budget, user_priorities, solution_workflows, intro_opportunities, community_requests, community_responses, credit_events, prospects, innovators, agent_instances)

**Features:**
- Working: 1 (SMS inbound/outbound loop)
- Partially Working: 1 (Bouncer onboarding without email verification)
- Not Implemented: 15+ (see Status Matrix above)

**Test Coverage:**
- Test Cases Documented: 66
- Test Cases Implemented: ~1 (rate-limiter tests only)
- Coverage: ~1.5%

---

## Appendix A: Architectural Decision Log

**These decisions explain WHY we deviated from requirements.md:**

### ADR-001: Bypass Realtime Subscriptions

**Date:** October 16, 2025
**Status:** Accepted
**Context:** Supabase Realtime WebSocket subscriptions consistently timed out after 30-60 seconds
**Decision:** Use direct function invocation in twilio-webhook instead of realtime-processor
**Consequences:**
- PRO: Reliable, no timeout issues
- PRO: Simpler debugging (single service)
- CON: Agents tightly coupled to webhook service
- CON: Can't scale agents independently

### ADR-002: Database Triggers for SMS

**Date:** October 16, 2025
**Status:** Accepted
**Context:** Realtime unreliable for critical path (message delivery)
**Decision:** Use PostgreSQL NOTIFY + pg_net trigger to invoke sms-sender webhook
**Consequences:**
- PRO: More reliable than WebSocket
- PRO: Database-native solution
- CON: Couples sms-sender to database schema

### ADR-003: Embed Agents in Services

**Date:** October 16, 2025
**Status:** Temporary (for MVP)
**Context:** Faster iteration during MVP development, avoid event-sourcing complexity
**Decision:** Embed Bouncer/Concierge/Innovator as functions in twilio-webhook
**Consequences:**
- PRO: Simpler deployment
- PRO: Faster iteration
- CON: Agent code not reusable
- CON: No prompt caching
- **Migration Path:** Deploy separate agent packages in Phase 1 (see Priority Build Order)

### ADR-004: Skip Message Orchestrator for MVP

**Date:** October 16, 2025
**Status:** Temporary (for MVP)
**Context:** MVP doesn't need rate limiting with low user volume
**Decision:** Send immediate replies, skip message_queue and user_message_budget
**Consequences:**
- PRO: Faster responses
- PRO: Simpler architecture
- CON: No rate limiting (spam risk)
- **Migration Path:** Deploy Orchestrator in Phase 3 (see Priority Build Order)

### ADR-005: Write Events But Don't Process Them

**Date:** October 16, 2025
**Status:** Temporary (for MVP)
**Context:** Event-driven coordination not needed for simple Bouncer/Concierge flow
**Decision:** Agents publish events but no processors consume them
**Consequences:**
- PRO: Simpler debugging
- CON: No audit trail
- CON: Can't implement sagas
- CON: Events accumulate (processed=false)
- **Migration Path:** Deploy event-processor in Phase 2 (see Priority Build Order)

---

## Appendix B: File Structure

**What Exists vs. What's Used:**

```
/Users/bt/Desktop/CODE/Yachtparty v.2/
│
├── packages/
│   │
│   ├── services/
│   │   ├── twilio-webhook/          ✅ DEPLOYED & WORKING
│   │   │   └── src/index.ts         ✅ Main webhook handler (885 lines)
│   │   │                            ✅ Embedded Bouncer (lines 434-557)
│   │   │                            ✅ Embedded Concierge (lines 564-657)
│   │   │                            ✅ Embedded Innovator (lines 665-675)
│   │   │
│   │   ├── sms-sender/              ✅ DEPLOYED & WORKING
│   │   │   └── src/index.ts         ✅ Webhook endpoint (336 lines)
│   │   │
│   │   └── realtime-processor/      ⚠️ DEPLOYED BUT NOT USED
│   │       └── src/index.ts         ⚠️ WebSocket subscriber (722 lines)
│   │
│   ├── agents/
│   │   ├── bouncer/                 ✅ CODE EXISTS, NOT DEPLOYED
│   │   │   ├── src/index.ts         ✅ Main agent (683 lines)
│   │   │   ├── src/prompts.ts       ✅ Prompt engineering
│   │   │   └── src/onboarding-steps.ts ✅ Onboarding logic
│   │   │
│   │   ├── concierge/               ✅ CODE EXISTS, NOT DEPLOYED
│   │   │   ├── src/index.ts         ✅ Main agent
│   │   │   ├── src/intent-classifier.ts ✅ Intent detection
│   │   │   ├── src/message-renderer.ts ✅ Prose generation
│   │   │   └── src/prompts.ts       ✅ Prompt engineering
│   │   │
│   │   └── account-manager/         ✅ CODE EXISTS, NOT DEPLOYED
│   │       ├── src/index.ts         ✅ Main agent
│   │       ├── src/priority-scorer.ts ✅ Priority calculation
│   │       ├── src/event-processor.ts ✅ Event handling
│   │       └── src/task-creator.ts  ✅ Task creation
│   │
│   ├── orchestrator/                ✅ CODE EXISTS, NOT DEPLOYED
│   │   ├── src/index.ts             ✅ Main orchestrator
│   │   ├── src/rate-limiter.ts      ✅ Rate limiting logic
│   │   ├── src/relevance-checker.ts ✅ Relevance checking
│   │   └── src/__tests__/           ✅ 1 test file
│   │       └── rate-limiter.test.ts ✅ Only test in project
│   │
│   ├── shared/                      ✅ BUILT & WORKING
│   │   └── src/                     ✅ Types, client factory
│   │
│   └── database/
│       └── migrations/
│           ├── 001_core_tables.sql      ✅ APPLIED (users, conversations, messages, etc.)
│           ├── 002_agent_tables.sql     ❓ PROBABLY APPLIED (user_priorities, etc.)
│           ├── 003_supporting_tables.sql ✅ APPLIED (prospects, agent_actions_log, etc.)
│           ├── 004_triggers.sql         ✅ APPLIED (notify_send_sms, etc.)
│           └── 005_pg_cron.sql          ❓ PROBABLY APPLIED (no jobs configured)
│
├── requirements.md                  ✅ COMPREHENSIVE (27,749 tokens)
├── DEPLOYMENT.md                    ✅ DEPLOYMENT GUIDE
└── CURRENT_STATUS.md                ✅ THIS FILE
```

---

## Appendix C: Next Steps for Sub-Agents

**When building new components, use this document as the source of truth:**

1. **Check Status Matrix** - Is the component already partially built?
2. **Check Priority Build Order** - Where does this fit in the roadmap?
3. **Check Critical Gaps** - Is this blocking MVP completion?
4. **Check File Structure** - Does code already exist?
5. **Review Architectural Decisions** - Understand why we deviated from requirements.md

**Example: Building Email Verification**

1. Status Matrix: ❌ Not implemented (Critical Gap #1)
2. Priority Build Order: Phase 1, Item #1 (highest priority)
3. File to modify: `/packages/services/twilio-webhook/src/index.ts`
4. Estimated effort: 4 hours
5. Architectural context: Part of Bouncer onboarding flow (embedded in twilio-webhook)

**Example: Deploying Account Manager**

1. Status Matrix: ✅ Code exists at `/packages/agents/account-manager/src/index.ts`, NOT deployed
2. Priority Build Order: Phase 2, Item #5
3. Critical Gap: #3 - No User Priority Tracking
4. Prerequisites: Need event-processor service (Phase 2, Item #6)
5. Estimated effort: 12 hours

---

**Last Updated:** October 16, 2025
**Maintained By:** Claude Code Development Session
**Purpose:** Single source of truth for project status - update as components are built
