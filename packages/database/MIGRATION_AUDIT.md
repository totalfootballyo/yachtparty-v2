# Database Migration Files Audit

**Date:** October 18, 2025
**Auditor:** Claude Code
**Purpose:** Review all migration files for redundancy and clarity

---

## Current Migration Files

### Migration Files (`packages/database/migrations/`)

| File | Type | Lines | Status | Purpose |
|------|------|-------|--------|---------|
| 001_core_tables.sql | CREATE | 339 | ⚠️ Historical | Initial schema creation |
| 002_agent_tables.sql | CREATE | ? | ⚠️ Historical | Agent-specific tables |
| 003_supporting_tables.sql | CREATE | ? | ⚠️ Historical | Supporting tables |
| 004_triggers.sql | CREATE | ? | ⚠️ Historical | Triggers and functions |
| 005_pg_cron.sql | CREATE | ? | ⚠️ Historical | pg_cron jobs |
| 006_event_dead_letters.sql | ALTER | ? | ✅ Keep | Dead letter queue |
| 007_referral_tracking.sql | ALTER | ? | ✅ Keep | Referral fields |
| 008_email_verified_field.sql | ALTER | 27 | ✅ Keep | Email verification |
| 009_message_sequences.sql | ALTER | 30 | ✅ Keep | Message sequences |
| 009_community_request_closure_REFERENCE_QUERY.sql | SELECT | 42 | ✅ Keep | Reference query |
| 010_prospects_table.sql | CREATE | ? | ✅ Keep | Prospects table |

### Root Files (`packages/database/`)

| File | Size | Status | Purpose |
|------|------|--------|---------|
| combined_migration.sql | 1052 lines | ❌ Remove | Outdated combination of 001 + 004 |

---

## Analysis

### 1. `combined_migration.sql` (❌ REMOVE)

**What it contains:**
- Content from `001_core_tables.sql` (users, conversations, messages, events, etc.)
- Content from `004_triggers.sql` (notify_event, update_credit_cache, etc.)

**Problems:**
1. **Misleading name** - Not actually "combined" - only has 2 of 10+ migrations
2. **Outdated** - Missing recent fields:
   - `users.email_verified` (added in migration 008)
   - `message_queue.sequence_*` fields (added in migration 009)
   - `prospects` table (added in migration 010)
3. **Can't be run** - CREATE TABLE commands would fail since tables exist
4. **Confusing** - Having both this AND numbered migrations creates confusion about source of truth

**Recommendation:** **DELETE** - Serves no purpose, creates confusion

---

### 2. Migrations 001-005 (⚠️ HISTORICAL - ARCHIVE OR REMOVE)

**What they are:**
- Initial schema creation with CREATE TABLE commands
- Created the base tables that are now in production

**Status:**
- ✅ Already applied to production database
- ❌ Cannot be run again (tables already exist)
- ❌ Incomplete compared to current schema (missing recent additions)

**Options:**

#### Option A: **DELETE** (Recommended)
- Current schema is fully documented in `SCHEMA.md`
- These CREATE TABLE commands can't be run anyway
- Reduces confusion about what to run
- Cleaner repository

#### Option B: **ARCHIVE**
- Move to `packages/database/migrations/archive/historical/`
- Keep as historical reference
- Clear they shouldn't be run

**Recommendation:** **DELETE** or move to archive folder
- The current schema source of truth is `SCHEMA.md`
- These files can't be executed anyway
- If you ever need to recreate the database, use a pg_dump from production

---

### 3. Migrations 006-010 (✅ KEEP)

**What they are:**
- ALTER TABLE and CREATE TABLE migrations for new features
- Represent actual changes made to production schema

**Files:**
- `006_event_dead_letters.sql` - Adds dead letter queue
- `007_referral_tracking.sql` - Adds referral tracking fields
- `008_email_verified_field.sql` - Adds email_verified to users
- `009_message_sequences.sql` - Adds sequence fields to message_queue
- `010_prospects_table.sql` - Creates prospects table

**Why keep:**
- ✅ Valid migration history
- ✅ Can inform future migrations
- ✅ Show evolution of schema
- ✅ Could potentially be run on a fresh database (after 001-005)

**Recommendation:** **KEEP ALL** - These are the real migration history

---

### 4. `009_community_request_closure_REFERENCE_QUERY.sql` (✅ KEEP)

**What it is:**
- SELECT query showing closure candidates
- Reference/documentation file (not a real migration)

**Why keep:**
- ✅ Useful for manually checking which requests need closure
- ✅ Already renamed to make purpose clear
- ✅ Well-documented with warnings

**Recommendation:** **KEEP** - Useful reference query

---

## Migration Strategy Going Forward

### Current State
Based on your workflow, it appears migrations are:
1. Written as `.sql` files in `packages/database/migrations/`
2. Manually run in Supabase SQL Editor
3. No automated migration runner

### Recommended Approach

**For New Changes:**
1. Create new numbered migration file (e.g., `011_your_change.sql`)
2. Use ALTER TABLE format (not CREATE TABLE)
3. Include idempotency (IF NOT EXISTS, IF EXISTS, etc.)
4. Add COMMENT statements for documentation
5. Run manually in Supabase SQL Editor
6. Update `SCHEMA.md` to reflect changes

**Example Template:**
```sql
-- =====================================================
-- Migration: 011_description.sql
-- Description: What this migration does
-- Date: YYYY-MM-DD
-- =====================================================

-- Add new column with IF NOT EXISTS pattern
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

-- Add comment
COMMENT ON COLUMN your_table.new_column IS 'Purpose of this field';

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Migration 011_description.sql completed successfully';
END $$;
```

---

## Recommended Actions

### Immediate Cleanup

1. **DELETE** `combined_migration.sql`
   ```bash
   rm packages/database/combined_migration.sql
   ```

2. **ARCHIVE or DELETE** migrations 001-005

   Option A (Delete):
   ```bash
   rm packages/database/migrations/001_core_tables.sql
   rm packages/database/migrations/002_agent_tables.sql
   rm packages/database/migrations/003_supporting_tables.sql
   rm packages/database/migrations/004_triggers.sql
   rm packages/database/migrations/005_pg_cron.sql
   ```

   Option B (Archive):
   ```bash
   mkdir -p packages/database/migrations/archive/historical
   mv packages/database/migrations/00{1,2,3,4,5}_*.sql \
      packages/database/migrations/archive/historical/
   ```

3. **KEEP** migrations 006-010 as migration history

4. **UPDATE** database README to clarify migration strategy

### Documentation Updates

1. ✅ Already created `SCHEMA.md` with current schema
2. Update `README.md` to explain:
   - Migrations 006+ are the real history
   - 001-005 are historical/archived
   - New migrations should be numbered sequentially
   - Migrations are run manually in Supabase

---

## Summary

**Files to Remove:**
- ❌ `combined_migration.sql` (1 file)
- ❌ `001_core_tables.sql` through `005_pg_cron.sql` (5 files) - OR move to archive

**Files to Keep:**
- ✅ `006_event_dead_letters.sql`
- ✅ `007_referral_tracking.sql`
- ✅ `008_email_verified_field.sql`
- ✅ `009_message_sequences.sql`
- ✅ `009_community_request_closure_REFERENCE_QUERY.sql`
- ✅ `010_prospects_table.sql`

**Total Cleanup:** Remove 6 files (or move 5 to archive)

**Result:** Cleaner, less confusing migration directory with only relevant files

---

## Questions for You

1. **Do you want to keep 001-005 as historical reference (archive folder)?**
   - Or just delete them since we have SCHEMA.md?

2. **Do you plan to use an automated migration tool in the future?**
   - If yes, we should structure migrations differently
   - If no, current manual approach is fine

3. **Should I proceed with the cleanup?**
   - Delete combined_migration.sql
   - Delete or archive 001-005
   - Update README

Let me know and I'll execute the cleanup!
