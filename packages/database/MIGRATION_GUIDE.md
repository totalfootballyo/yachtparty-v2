# Yachtparty Database Migration Guide

## Quick Setup for Supabase

You have **two options** to run migrations on your Supabase project:

---

## Option 1: Supabase SQL Editor (Easiest - 2 minutes)

### Step 1: Get the Combined Migration File

We've created a combined migration file at:
```
packages/database/combined_migration.sql
```

This includes:
- ✅ Core tables (users, conversations, messages, events, agent_tasks, message_queue, user_message_budget)
- ✅ Agent tables (user_priorities, solution_workflows, intro_opportunities, community_requests, etc.)
- ✅ Supporting tables (prospects, innovators, agent_instances, agent_actions_log)
- ✅ All triggers and functions

### Step 2: Open Supabase SQL Editor

1. Go to https://supabase.com/dashboard/project/wdjmhpmwiunkltkodbqh
2. Click **SQL Editor** in the left sidebar
3. Click **New Query**

### Step 3: Paste and Run

1. Open `combined_migration.sql` in your text editor
2. Copy the entire contents (1,044 lines)
3. Paste into the SQL Editor
4. Click **Run** (or press Cmd+Enter)

### Step 4: Verify

After running, verify tables were created:
1. Click **Table Editor** in left sidebar
2. You should see all tables:
   - users
   - conversations
   - messages
   - events
   - agent_tasks
   - message_queue
   - user_message_budget
   - user_priorities
   - solution_workflows
   - intro_opportunities
   - community_requests
   - community_responses
   - credit_events
   - prospects
   - innovators
   - agent_instances
   - agent_actions_log

✅ **Done!** Skip to "Get API Credentials" below.

---

## Option 2: Command Line with psql (Advanced)

### Step 1: Get Database Connection String

1. Go to https://supabase.com/dashboard/project/wdjmhpmwiunkltkodbqh/settings/database
2. Under **Connection String**, select **URI**
3. Copy the connection string (it looks like):
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.wdjmhpmwiunkltkodbqh.supabase.co:5432/postgres
   ```
4. Replace `[YOUR-PASSWORD]` with your actual database password

### Step 2: Run Migrations with psql

```bash
cd "/Users/bt/Desktop/CODE/Yachtparty v.2/packages/database"

# Set your connection string
export DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@db.wdjmhpmwiunkltkodbqh.supabase.co:5432/postgres"

# Run combined migration
psql $DATABASE_URL -f combined_migration.sql

# Or run migrations individually:
psql $DATABASE_URL -f migrations/001_core_tables.sql
psql $DATABASE_URL -f migrations/002_agent_tables.sql
psql $DATABASE_URL -f migrations/003_supporting_tables.sql
psql $DATABASE_URL -f migrations/004_triggers.sql
```

### Step 3: Verify

```bash
# List all tables
psql $DATABASE_URL -c "\dt"

# Check table counts
psql $DATABASE_URL -c "SELECT COUNT(*) FROM users;"
```

---

## Get API Credentials

After migrations are complete, get your API credentials:

### Step 1: Get Project URL and Service Key

1. Go to https://supabase.com/dashboard/project/wdjmhpmwiunkltkodbqh/settings/api
2. Copy these values:

**Project URL:**
```
https://wdjmhpmwiunkltkodbqh.supabase.co
```

**service_role key (secret):**
```
eyJhbGci... (long JWT token starting with eyJ)
```

⚠️ **Important:** The service_role key is SECRET - never commit it to git!

### Step 2: Create .env File

Create `.env` file in the project root:

```bash
cd "/Users/bt/Desktop/CODE/Yachtparty v.2"

cat > .env << 'EOF'
# Supabase
SUPABASE_URL=https://wdjmhpmwiunkltkodbqh.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGci...YOUR_SERVICE_ROLE_KEY_HERE...

# Anthropic (get from https://console.anthropic.com/)
ANTHROPIC_API_KEY=sk-ant-api03-...YOUR_ANTHROPIC_KEY_HERE...

# Bouncer Agent Config
BOUNCER_AGENT_ID=bouncer_v1
PROMPT_VERSION=bouncer_v1.0
EOF
```

### Step 3: Copy to Bouncer Agent Directory

```bash
cd "/Users/bt/Desktop/CODE/Yachtparty v.2"
cp .env packages/agents/bouncer/.env
```

---

## Test the Setup

Once migrations are complete and .env is configured:

```bash
cd "/Users/bt/Desktop/CODE/Yachtparty v.2"

# Install dependencies
npm install

# Run the test chat
cd packages/agents/bouncer
npm run test-chat
```

You should see:
```
═══════════════════════════════════════════════════════════
           BOUNCER AGENT TEST CHAT
═══════════════════════════════════════════════════════════
User ID: 12345678-1234-1234-1234-123456789012
Phone: +15555550100
Status: Not Verified
Current Step: new_user
───────────────────────────────────────────────────────────
Commands: /help /reset /status /exit
═══════════════════════════════════════════════════════════
```

---

## Troubleshooting

### "relation does not exist"

Migrations didn't run successfully. Check:
- Did you paste the entire SQL file?
- Any errors in the SQL Editor output?
- Try running migrations individually to find the failing statement

### "Cannot connect to database"

Check:
- SUPABASE_URL is correct (should end with .supabase.co)
- SUPABASE_SERVICE_KEY is the service_role key (not anon key)
- No extra spaces or quotes in .env file

### "Invalid API key" from Anthropic

Get your API key:
1. Go to https://console.anthropic.com/
2. Sign in or create account
3. Click **API Keys** → **Create Key**
4. Copy the key (starts with `sk-ant-api03-`)
5. Add to .env file

---

## Note about pg_cron (Migration 005)

The `005_pg_cron.sql` migration is **optional** for testing. It requires the `pg_cron` extension which:
- ✅ Available on Supabase Pro/Team plans
- ❌ Not available on Supabase Free tier

**For testing, you can skip this migration.** The Account Manager agent can be run manually instead of on schedule.

To run it later (if you upgrade):
```bash
psql $DATABASE_URL -f migrations/005_pg_cron.sql
```

---

## Next Steps

1. ✅ Run migrations (Option 1 or 2)
2. ✅ Get API credentials
3. ✅ Create .env files
4. ✅ Test with `npm run test-chat`
5. → Test onboarding flow
6. → Integrate with Twilio
7. → Deploy to production

---

**Questions?** Check the Supabase documentation:
- https://supabase.com/docs/guides/database/overview
- https://supabase.com/docs/guides/api
