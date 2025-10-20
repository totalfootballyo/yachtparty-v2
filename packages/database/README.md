# Yachtparty Database Schema

This package contains all database migrations, schemas, and utilities for the Yachtparty platform.

📚 **[View Complete Schema Documentation →](./SCHEMA.md)**

## Structure

```
database/
├── migrations/          # SQL migration files (ALTER TABLE history)
│   ├── 006_event_dead_letters.sql
│   ├── 007_referral_tracking.sql
│   ├── 008_email_verified_field.sql
│   ├── 009_message_sequences.sql
│   ├── 009_community_request_closure_REFERENCE_QUERY.sql  # REFERENCE ONLY
│   └── 010_prospects_table.sql
├── SCHEMA.md           # Complete current schema documentation
├── MIGRATION_AUDIT.md  # Migration cleanup audit (Oct 2025)
├── seeds/              # Seed data for development
└── scripts/            # Migration and utility scripts
```

**Migration Files:**
- **006-010** - Real migration history showing schema evolution
- Initial schema (CREATE TABLE) is documented in `SCHEMA.md`
- Migrations 001-005 were removed (already applied, can't run again)

**Note on Community Request Closure:**
- File `009_community_request_closure_REFERENCE_QUERY.sql` is a **reference/documentation file**
  - Safe to run - just executes a SELECT query showing closure candidates
  - Does not create any schema changes or cron jobs
  - Useful for manually checking which requests would be closed
- Actual closure is handled by **Google Cloud Scheduler**
- Setup: `./scripts/setup-community-closure-scheduler.sh` (already done ✅)

## Running Migrations

### Migration Strategy

**Current State:**
- ✅ Base schema is already deployed (see `SCHEMA.md`)
- ✅ All migrations 006-010 already applied to production
- ✅ No pending migrations to run

**Historical Context:**
- Migrations 001-005 (initial CREATE TABLE statements) were removed
- They created the base schema that's now documented in `SCHEMA.md`
- Can't be run again since tables already exist

**Migration History (Already Applied):**
1. `006_event_dead_letters.sql` - Dead letter queue for failed events
2. `007_referral_tracking.sql` - User referral system
3. `008_email_verified_field.sql` - Email verification workflow
4. `009_message_sequences.sql` - Multi-message sequence support
5. `010_prospects_table.sql` - Enhanced prospect management

**⚠️ Special File:**
- `009_community_request_closure_REFERENCE_QUERY.sql` - **Reference query (safe to run)**
  - SELECT query showing closure candidates
  - Returns 0 rows if no requests exist
  - Does NOT make schema changes
  - Actual closure via Google Cloud Scheduler (see below)

### Community Request Closure Setup

Instead of using a database migration, we use Google Cloud Scheduler to close expired community requests.

**Setup (one-time):**
```bash
./scripts/setup-community-closure-scheduler.sh
```

This creates a Cloud Scheduler job that runs every hour and calls:
```
POST https://event-processor-82471900833.us-central1.run.app/close-expired-requests
```

**Verify it's running:**
```bash
gcloud scheduler jobs describe close-expired-community-requests --location=us-central1
```

**Manual trigger (for testing):**
```bash
curl -X POST https://event-processor-82471900833.us-central1.run.app/close-expired-requests
```

### For Future Schema Changes

**Creating New Migrations:**

1. Create numbered file: `011_your_change_description.sql`
2. Use ALTER TABLE (not CREATE TABLE)
3. Include idempotency checks
4. Add COMMENT statements
5. Run manually in Supabase SQL Editor
6. Update `SCHEMA.md` after applying

**Template:**
```sql
-- =====================================================
-- Migration: 011_description.sql
-- Description: What this migration does
-- Date: YYYY-MM-DD
-- =====================================================

-- Add new column with idempotency
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'your_table'
    AND column_name = 'new_column'
  ) THEN
    ALTER TABLE your_table ADD COLUMN new_column TEXT;
  END IF;
END $$;

-- Add comment for documentation
COMMENT ON COLUMN your_table.new_column IS 'Purpose of this field';

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Migration 011_description.sql completed successfully';
END $$;
```

### Migration Scripts (Not Currently Used)

```bash
# These scripts exist but migrations are currently run manually
npm run migrate
npm run migrate:up
npm run migrate:down
npm run seed
npm run reset
```

## Schema Overview

### Core Tables
- `users` - User accounts
- `conversations` - Conversation threads
- `messages` - Individual messages
- `events` - Event sourcing table
- `agent_tasks` - Task queue for agents
- `message_queue` - Outbound message queue
- `user_message_budget` - Rate limiting

### Agent-Specific Tables
- `user_priorities` - Account Manager priority list
- `solution_workflows` - Solution Saga state tracking
- `intro_opportunities` - Introduction opportunities
- `community_requests` - Expert insight requests
- `community_responses` - Expert responses
- `credit_events` - Credit transaction log

### Supporting Tables
- `prospects` - Non-platform individuals
- `innovators` - Solution provider profiles
- `agent_instances` - Agent configuration tracking
- `agent_actions_log` - Comprehensive logging

## Key Features

### Event Sourcing
All inter-agent communication via `events` table with PostgreSQL NOTIFY triggers for real-time processing.

### Task Queue
`agent_tasks` table with pg_cron processing every 2 minutes using `FOR UPDATE SKIP LOCKED` pattern.

### Message Orchestration
Rate limiting and priority management via `message_queue` and `user_message_budget` tables.

### Conversation Summarization
Automatic summarization every 50 messages to prevent context window explosion.

## Indexes

All tables include appropriate indexes for:
- Primary keys and foreign keys
- Frequently queried fields
- Composite indexes for common query patterns
- Partial indexes for status-based queries

## Triggers

- `notify_event()` - Publishes events to PostgreSQL NOTIFY
- `update_user_credit_cache()` - Updates user credit balance
- `check_conversation_summary()` - Triggers conversation summarization
- `handle_phone_number_change()` - Manages phone number recycling
- `notify_send_sms()` - Notifies SMS sender service

## Security

- Row-level security policies (to be implemented)
- Service role key required for sensitive operations
- Phone numbers stored with proper indexing for lookup performance
