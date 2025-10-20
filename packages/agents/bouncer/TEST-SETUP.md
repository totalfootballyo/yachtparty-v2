# Bouncer Agent Test Chat - Setup Guide

## Quick Start

To test the Bouncer agent onboarding flow using the interactive test chat:

### 1. Install Dependencies

From the root of the repository:

```bash
# Install all dependencies for the monorepo
npm install

# Or from the bouncer agent directory
cd packages/agents/bouncer
npm install
```

### 2. Set Up Supabase

You need a Supabase project with the following tables:

#### Required Tables

**users**
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone_number TEXT UNIQUE NOT NULL,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  company TEXT,
  title TEXT,
  linkedin_url TEXT,
  verified BOOLEAN DEFAULT false,
  innovator BOOLEAN DEFAULT false,
  expert_connector BOOLEAN DEFAULT false,
  expertise TEXT[],
  poc_agent_id TEXT,
  poc_agent_type TEXT CHECK (poc_agent_type IN ('bouncer', 'concierge', 'innovator')),
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  timezone TEXT,
  response_pattern JSONB,
  credit_balance INTEGER DEFAULT 0,
  status_level TEXT DEFAULT 'member',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_active_at TIMESTAMP WITH TIME ZONE
);
```

**conversations**
```sql
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  status TEXT CHECK (status IN ('active', 'paused', 'completed')) DEFAULT 'active',
  conversation_summary TEXT,
  last_summary_message_id UUID,
  messages_since_summary INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_message_at TIMESTAMP WITH TIME ZONE
);
```

**messages**
```sql
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role TEXT CHECK (role IN ('user', 'concierge', 'bouncer', 'innovator', 'system')),
  content TEXT NOT NULL,
  direction TEXT CHECK (direction IN ('inbound', 'outbound')),
  twilio_message_sid TEXT,
  status TEXT CHECK (status IN ('queued', 'sent', 'delivered', 'failed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  sent_at TIMESTAMP WITH TIME ZONE,
  delivered_at TIMESTAMP WITH TIME ZONE
);
```

**agent_actions_log**
```sql
CREATE TABLE agent_actions_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_type TEXT NOT NULL,
  agent_instance_id TEXT,
  action_type TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  context_id UUID,
  context_type TEXT,
  model_used TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd DECIMAL(10, 6),
  latency_ms INTEGER,
  input_data JSONB,
  output_data JSONB,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**agent_tasks**
```sql
CREATE TABLE agent_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_type TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  context_id UUID,
  context_type TEXT,
  scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
  priority TEXT CHECK (priority IN ('urgent', 'high', 'medium', 'low')) DEFAULT 'medium',
  status TEXT CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')) DEFAULT 'pending',
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  last_attempted_at TIMESTAMP WITH TIME ZONE,
  context_json JSONB,
  result_json JSONB,
  error_log TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by TEXT,
  completed_at TIMESTAMP WITH TIME ZONE
);
```

**events**
```sql
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type TEXT NOT NULL,
  aggregate_id UUID,
  aggregate_type TEXT,
  payload JSONB,
  metadata JSONB,
  processed BOOLEAN DEFAULT false,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by TEXT
);
```

**Optional: intro_opportunities and prospects** (for nomination feature)
```sql
CREATE TABLE prospects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  company TEXT,
  title TEXT,
  linkedin_url TEXT,
  email TEXT,
  mutual_connections JSONB,
  last_researched_at TIMESTAMP WITH TIME ZONE,
  users_researching UUID[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE intro_opportunities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  connector_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  innovator_id UUID REFERENCES users(id) ON DELETE SET NULL,
  prospect_id UUID REFERENCES prospects(id) ON DELETE SET NULL,
  prospect_name TEXT NOT NULL,
  prospect_company TEXT,
  prospect_title TEXT,
  prospect_linkedin_url TEXT,
  innovator_name TEXT,
  bounty_credits INTEGER DEFAULT 50,
  status TEXT CHECK (status IN ('open', 'pending', 'accepted', 'rejected', 'completed', 'removed')) DEFAULT 'open',
  connector_response TEXT,
  feed_item_id UUID,
  intro_email TEXT,
  intro_scheduled_at TIMESTAMP WITH TIME ZONE,
  intro_completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE
);
```

### 3. Configure Environment Variables

Create a `.env` file in `packages/agents/bouncer/`:

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key

# Anthropic Configuration
ANTHROPIC_API_KEY=sk-ant-your-api-key

# Agent Configuration
BOUNCER_AGENT_ID=bouncer_v1
PROMPT_VERSION=bouncer_v1.0

# LinkedIn Configuration (optional)
FOUNDER_LINKEDIN_URL=https://linkedin.com/in/your-profile
```

**Getting your Supabase credentials:**
1. Go to your Supabase project dashboard
2. Navigate to Settings > API
3. Copy your project URL for `SUPABASE_URL`
4. Copy your service_role key for `SUPABASE_SERVICE_KEY` (NOT the anon key)

**Getting your Anthropic API key:**
1. Go to https://console.anthropic.com/
2. Navigate to API Keys
3. Create a new key or copy existing one

### 4. Run the Test Chat

```bash
cd packages/agents/bouncer
npm run test-chat
```

## Usage Examples

### Example Session 1: Happy Path

```
═══════════════════════════════════════════════════════════
           BOUNCER AGENT TEST CHAT
═══════════════════════════════════════════════════════════
User ID: 12345678-1234-1234-1234-123456789012
Phone: +15555550100
Status: Not Verified

Collected Information:
  ✗ First Name: (not provided)
  ✗ Last Name: (not provided)
  ✗ Company: (not provided)
  ✗ Title: (not provided)
  ✗ Email: (not provided)
  ✗ LinkedIn: (not provided)

───────────────────────────────────────────────────────────
Commands: /help /reset /status /exit
═══════════════════════════════════════════════════════════

You: Hi there!

Agent: Hey! Welcome to Yachtparty. I'm here to get you set up.
To start, what's your name?

You: I'm John Smith

Agent: Great to meet you, John! What company do you work for?

[User data updated:]
  • first_name: "null" → "John"
  • last_name: "null" → "Smith"

You: I work at Acme Corporation as VP of Engineering

Agent: Perfect! Last step - I need to verify your email. Send a quick
email from your work address to: verify-abc12345@verify.yachtparty.xyz

[User data updated:]
  • company: "null" → "Acme Corporation"
  • title: "null" → "VP of Engineering"

You: Done! Sent from john.smith@acme.com

Agent: Excellent! You're all verified, John. I'm handing you over to
your personal concierge who will help you get the most out of Yachtparty.

[User data updated:]
  • email: "null" → "john.smith@acme.com"
  • verified: "false" → "true"
  • poc_agent_type: "bouncer" → "concierge"

🎉 User verified! Onboarding complete.
```

### Example Session 2: Multi-field Response

```
You: I'm Jane Doe, CTO at TechStartup Inc

Agent: Perfect! I got your name, company, and title all at once.
Now let's verify your email...

[User data updated:]
  • first_name: "null" → "Jane"
  • last_name: "null" → "Doe"
  • company: "null" → "TechStartup Inc"
  • title: "null" → "CTO"
```

### Example Session 3: Using Commands

```
You: /status

Current Status:

Collected Information:
  ✓ First Name: John
  ✓ Last Name: Smith
  ✗ Company: (not provided)
  ✗ Title: (not provided)
  ✗ Email: (not provided)
  ✗ LinkedIn: (not provided)

Verified: No
Agent Type: bouncer

You: /reset

Resetting test user...
Created new conversation: 87654321-4321-4321-4321-210987654321
User reset successfully!

You: /help

Available Commands:
  /help   - Show this help message
  /reset  - Reset test user (clear all data)
  /status - Show current user state and progress
  /exit   - Exit the test chat
```

## Verifying Database Records

After testing, you can inspect the database to verify everything was recorded correctly:

```sql
-- Check test user
SELECT
  id,
  first_name,
  last_name,
  company,
  title,
  email,
  verified,
  poc_agent_type
FROM users
WHERE phone_number = '+15555550100';

-- View all messages
SELECT
  role,
  content,
  direction,
  created_at
FROM messages
WHERE user_id = 'YOUR_TEST_USER_ID'
ORDER BY created_at ASC;

-- Check agent actions (LLM calls)
SELECT
  action_type,
  model_used,
  input_tokens,
  output_tokens,
  cost_usd,
  latency_ms,
  created_at
FROM agent_actions_log
WHERE user_id = 'YOUR_TEST_USER_ID'
ORDER BY created_at DESC;

-- View scheduled tasks
SELECT
  task_type,
  scheduled_for,
  priority,
  status,
  context_json
FROM agent_tasks
WHERE user_id = 'YOUR_TEST_USER_ID';

-- Check published events
SELECT
  event_type,
  payload,
  created_at,
  created_by
FROM events
WHERE aggregate_id = 'YOUR_TEST_USER_ID'
ORDER BY created_at DESC;
```

## Troubleshooting

### "Missing required environment variables"
- Make sure `.env` file exists in the bouncer directory
- Check that all variables are spelled correctly (no typos)
- Ensure there are no spaces around the `=` sign

### "Failed to connect to database"
- Verify your `SUPABASE_URL` is correct
- Ensure you're using the service_role key, not the anon key
- Check that your Supabase project is active and not paused
- Verify network connectivity

### "No text content in response"
- Check that your `ANTHROPIC_API_KEY` is valid
- Verify you have credits available in your Anthropic account
- Check the Claude API status page
- Review rate limits

### Agent gives generic fallback messages
- Check `agent_actions_log` table for error details
- Review the LLM input/output in the database
- Verify your prompt versions are correct
- Ensure the agent has access to all required context

### TypeScript errors
- Run `npm install` to ensure all dependencies are installed
- Check that `@yachtparty/shared` package is built
- Verify TypeScript version compatibility

## Next Steps

After successful testing:

1. Review the `agent_actions_log` to analyze:
   - Token usage and costs
   - Response latency
   - Prompt caching effectiveness

2. Test edge cases:
   - Very long user messages
   - Emojis and special characters
   - Multiple conversations simultaneously
   - Network interruptions

3. Load testing (if needed):
   - Create multiple test users
   - Simulate concurrent conversations
   - Monitor database performance

4. Integration testing:
   - Test with Twilio webhook
   - Verify email verification webhook
   - Test re-engagement task execution

## Support

For issues or questions:
- Check the main README.md in `packages/agents/bouncer/`
- Review the agent implementation in `src/index.ts`
- Consult the architecture documentation in `requirements.md`
