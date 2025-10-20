# Bouncer Agent

The Bouncer Agent is responsible for onboarding new users to the Yachtparty platform through a conversational SMS verification process.

## Purpose

Acts as the "gatekeeper" for the platform, guiding new users through onboarding with friendly but efficient conversation. The Bouncer is not a sycophant - it maintains a professional, competent tone while collecting required information.

## Responsibilities

The Bouncer Agent handles all interactions with unverified users (`user.verified = false`) and guides them through the following onboarding steps:

### 1. Welcome Message
- Greets user on first interaction
- Explains the platform briefly
- Sets expectations for the onboarding process

### 2. Collect User Information
- **First name and last name**: Personal identification
- **Company and title**: Professional context
- Information is validated and stored in the user record as collected

### 3. Email Verification
- Generates unique verification email address: `verify-{userId}@verify.yachtparty.xyz`
- Instructs user to send an email from their work address to this address
- Email webhook (Maileroo) catches the email and marks verification complete
- Records the sender's email address in user record

### 4. LinkedIn Connection
- Encourages user to connect with founder on LinkedIn
- Creates task for Social Butterfly Agent to verify connection
- LinkedIn verification happens asynchronously

### 5. First Nomination
- Asks user to nominate someone they think would benefit from the platform
- Captures prospect information for network growth

### 6. Completion
- Sets `user.verified = true` in database
- Changes `user.poc_agent_type` from 'bouncer' to 'concierge'
- Publishes `user.verified` event
- Hands off to Concierge Agent for ongoing interactions

## Conversation Flow

The Bouncer uses an **intelligent, context-aware flow** rather than a rigid step-by-step script:

1. **Assess current state**: Load user record to see what information is missing
2. **Natural conversation**: Ask for information in a conversational way
3. **Handle out-of-order responses**: Accept information in any order user provides it
4. **Verify completeness**: Only move forward when all required fields are populated
5. **Re-engagement**: If user goes inactive (24h), create re-engagement task

## Event Triggers

The Bouncer Agent is invoked when:

- **Event**: `user.message.received` WHERE `user.verified = false`
- **Task**: `re_engagement_check` (scheduled 24h after last interaction if incomplete)

## Events Published

- `user.onboarding_step.completed`: When a step is completed (name collected, company collected, etc.)
- `user.verification.pending`: When email verification is pending
- `user.verified`: Final event when onboarding is complete

## State Tracking

The Bouncer Agent is **stateless** - it loads context fresh from the database on each invocation:

### User Record Fields
- `verified`: Overall onboarding status (false until complete)
- `email`: Collected email address
- `first_name`, `last_name`: User name
- `company`, `title`: Professional information
- `linkedin_url`: LinkedIn profile (if provided)

### Conversation History
Recent messages in the conversation show progress and provide context for next response.

### Verification Email
Stored in user record when email verification webhook is triggered.

## LLM Decision Points

The Bouncer uses Claude to make intelligent decisions:

### 1. "Should I follow up with user now, or wait longer?"
Based on conversation tone, user engagement level, and time since last message.

**Inputs**:
- Conversation history
- User's last message sentiment
- Time since last interaction
- Current onboarding progress

**Outputs**:
- `immediate_followup`: Send message now
- `schedule_followup`: Create task for later (specify when)
- `wait`: User is engaged, wait for their next message

### 2. "Is the LinkedIn connection confirmed?"
After Social Butterfly Agent returns mutual connection results.

**Inputs**:
- Social Butterfly research results
- User's LinkedIn URL (if provided)
- Founder's LinkedIn connections

**Outputs**:
- `confirmed`: LinkedIn connection verified
- `not_found`: No connection detected
- `needs_more_time`: Connection pending, check again later

### 3. "What information is the user providing in this message?"
Extracts structured data from conversational user input.

**Inputs**:
- User's message text
- Current user record state
- Missing fields

**Outputs**:
Structured JSON with extracted fields:
```json
{
  "first_name": "John",
  "last_name": "Smith",
  "company": "Acme Corp",
  "title": "VP of Engineering"
}
```

## Prompt Caching Strategy

The Bouncer uses Claude's Prompt Caching to reduce costs and latency:

### Cacheable Components

1. **System Prompt** (~4000 tokens, static)
   - Bouncer personality and role
   - Onboarding requirements
   - Response format instructions
   - Cached across all user interactions

2. **Onboarding Steps Reference** (~1000 tokens, static)
   - Detailed step descriptions
   - Validation requirements
   - Example conversations

3. **User Profile** (~500 tokens, changes per step)
   - Current user record
   - Onboarding progress
   - Re-cached when user data changes

4. **Conversation History** (~3000 tokens, grows per message)
   - Last 20 messages (or since summary)
   - Re-cached on each message
   - Summarized if >50 messages

### Cache Efficiency
- First invocation: ~8500 tokens (no cache)
- Subsequent invocations: ~500 new tokens (system prompt + steps cached)
- **Cost reduction**: ~40% over conversation lifetime

## Error Handling

### User Input Errors
- Unclear responses: Ask clarifying questions
- Invalid email format: Prompt for correction
- Missing information: Guide user to provide specifics

### System Errors
- Email webhook failures: Log error, manual verification fallback
- Database update failures: Retry with exponential backoff
- LinkedIn verification timeout: Skip step, mark as optional

### Rate Limiting
- Maximum 2 messages per hour to user (unless user actively responding)
- Daily limit: 10 messages
- Quiet hours: 10pm-8am user local time (if timezone known)

## Logging

All Bouncer actions are logged to `agent_actions_log` table:

### LLM Calls
```typescript
{
  agent_type: 'bouncer',
  action_type: 'llm_call',
  model_used: 'claude-sonnet-4-20250514',
  input_tokens: 4500,
  output_tokens: 150,
  cost_usd: 0.0145,
  latency_ms: 1234,
  input_data: { user_id, message_content },
  output_data: { decision, extracted_fields }
}
```

### Actions Taken
```typescript
{
  agent_type: 'bouncer',
  action_type: 'update_user_field',
  user_id: 'user_123',
  context_type: 'onboarding',
  output_data: {
    field: 'first_name',
    value: 'John',
    step: 'name_collection'
  }
}
```

## Integration Points

### Email Verification Webhook
**Endpoint**: `POST /webhooks/email-verification`

When user emails `verify-{userId}@verify.yachtparty.xyz`, Maileroo forwards to webhook:
```typescript
{
  to: 'verify-abc123@verify.yachtparty.xyz',
  from: 'john.smith@acme.com',
  subject: 'Email Verification',
  body: '...'
}
```

Webhook extracts user ID, updates `users.email`, marks email as verified.

### Social Butterfly Task Creation
When user provides LinkedIn URL or completes onboarding:
```typescript
createAgentTask({
  task_type: 'verify_linkedin_connection',
  agent_type: 'social_butterfly',
  user_id: userId,
  context_json: {
    user_linkedin_url: user.linkedin_url,
    founder_linkedin_url: 'https://linkedin.com/in/founder'
  },
  scheduled_for: new Date(), // Immediate
  priority: 'medium',
  created_by: 'bouncer_agent'
});
```

## Success Metrics

- **Onboarding completion rate**: % of users who complete all steps
- **Time to verification**: Median time from first message to `user.verified = true`
- **Drop-off points**: Where users abandon onboarding
- **Re-engagement success**: % of users who respond to re-engagement messages
- **First message response rate**: % of new users who respond to initial welcome

## Example Conversation

```
Bouncer: Hey! Welcome to Yachtparty. I'm the Bouncer - I'll get you set up.
Quick question to start: what's your name?

User: John Smith

Bouncer: Great to meet you, John! Where do you work and what's your role there?

User: I'm VP of Engineering at Acme Corp

Bouncer: Perfect. Last thing - I need to verify your email. Send a quick email
from your work address to: verify-abc123@verify.yachtparty.xyz

No need to write anything, just hit send. I'll catch it and we're done.

User: Sent!

Bouncer: Got it! Just verified your email.

One more thing - connect with me on LinkedIn? Here's the founder's profile:
[link]. It helps us build a trusted network.

User: Done

Bouncer: Excellent! You're all set, John. I'm handing you off to your personal
concierge now. They'll help you get value from the platform.

[Bouncer marks user.verified = true, changes poc_agent_type to 'concierge']
```

## Development

### Run in development mode
```bash
npm run dev
```

### Build for production
```bash
npm run build
npm start
```

### Type checking
```bash
npm run typecheck
```

## Testing

### Interactive Test Chat

The Bouncer agent includes an interactive CLI test interface that allows you to test the complete onboarding flow without requiring Twilio integration.

#### Prerequisites

1. **Environment Variables**: Create a `.env` file with your credentials:
```bash
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
ANTHROPIC_API_KEY=sk-ant-...
BOUNCER_AGENT_ID=bouncer_v1
PROMPT_VERSION=bouncer_v1.0
```

2. **Database Setup**: Ensure your Supabase database has all required tables:
   - `users`
   - `conversations`
   - `messages`
   - `agent_actions_log`
   - `agent_tasks`
   - `events`

#### Running the Test Chat

```bash
cd packages/agents/bouncer
npm run test-chat
```

The test chat will:
1. Validate environment variables
2. Test database connection
3. Create or reuse a test user with phone number `+15555550100`
4. Create a new conversation
5. Start an interactive chat session

#### Test Chat Features

**Colorized Output**:
- User messages in green
- Agent responses in blue
- System messages in cyan
- Errors in red
- Metadata in dimmed text

**Real-time State Display**:
- Shows collected user fields (name, company, email, etc.)
- Displays verification status
- Shows current onboarding progress
- Performance metrics (response time, token usage)

**Available Commands**:
- `/help` - Display help information and test scenarios
- `/reset` - Reset test user data and start fresh conversation
- `/status` - Show current user state and progress
- `/exit` - Exit the test chat (or use CTRL+C)

#### Test Scenarios

1. **Basic Happy Path**:
```
You: Hi, I'd like to join Yachtparty
Agent: Great! Let me help you get started. What's your name?
You: John Smith
Agent: Nice to meet you, John! What company do you work for?
You: I work at Acme Corp
Agent: And what's your role there?
You: VP of Engineering
```

2. **Multi-field Response**:
```
You: I'm Jane Doe, VP of Product at TechCo
Agent: Perfect! I got your name, company, and title. Now let's verify your email...
```

3. **Out-of-order Information**:
```
You: I work at StartupXYZ
Agent: Great! What's your name?
You: My email is founder@startupxyz.com
Agent: Thanks! I still need your name though...
```

4. **Vague Responses**:
```
You: I'm a developer
Agent: Thanks! What company do you work for?
You: A tech company
Agent: Could you be more specific about which company?
```

5. **Testing Re-engagement** (requires waiting or manual task trigger):
   - Start onboarding
   - Leave conversation incomplete
   - Check `agent_tasks` table for scheduled re-engagement task

#### What to Look For

**Successful Onboarding Flow**:
1. Agent greets user naturally
2. Agent extracts information from conversational input
3. User fields are updated in real-time (shown in cyan)
4. Agent adapts questions based on what's already collected
5. Email verification instructions are provided
6. LinkedIn connection is encouraged
7. User is marked as verified when all fields are complete
8. `poc_agent_type` changes from 'bouncer' to 'concierge'

**Data Validation**:
- Check that user updates appear in real-time display
- Verify messages are recorded in database
- Confirm agent actions are logged
- Ensure events are published for state changes

**Agent Behavior**:
- Natural, conversational tone (not robotic)
- Handles multi-field responses intelligently
- Asks clarifying questions when needed
- Doesn't repeat questions for already-collected info
- Maintains context throughout conversation

#### Debugging

**View Database Records**:
```sql
-- Check test user
SELECT * FROM users WHERE phone_number = '+15555550100';

-- View conversation messages
SELECT role, content, created_at
FROM messages
WHERE user_id = 'YOUR_TEST_USER_ID'
ORDER BY created_at DESC;

-- Check agent actions
SELECT agent_type, action_type, output_data
FROM agent_actions_log
WHERE user_id = 'YOUR_TEST_USER_ID'
ORDER BY created_at DESC;

-- View scheduled tasks
SELECT task_type, scheduled_for, context_json
FROM agent_tasks
WHERE user_id = 'YOUR_TEST_USER_ID';
```

**Common Issues**:

1. **"Missing required environment variables"**
   - Ensure `.env` file exists and contains all required variables
   - Check that variables are spelled correctly

2. **"Failed to connect to database"**
   - Verify `SUPABASE_URL` is correct
   - Ensure `SUPABASE_SERVICE_KEY` has admin permissions
   - Check network connectivity

3. **"No text content in response"**
   - Verify `ANTHROPIC_API_KEY` is valid
   - Check Claude API status
   - Review rate limits

4. **Agent gives generic fallback messages**
   - Check agent_actions_log for errors
   - Review LLM input/output in logs
   - Verify prompt versions are loaded correctly

#### Testing Checklist

Before deploying changes to production:

- [ ] Complete onboarding flow works end-to-end
- [ ] User data is correctly extracted from messages
- [ ] All fields are validated and stored
- [ ] Re-engagement tasks are created
- [ ] Events are published correctly
- [ ] Messages are recorded in database
- [ ] Agent maintains conversational context
- [ ] Email verification instructions are clear
- [ ] LinkedIn connection is encouraged
- [ ] User is marked verified on completion
- [ ] Agent type changes to 'concierge'
- [ ] Cost metrics are logged
- [ ] No errors in console output

## Dependencies

- `@supabase/supabase-js`: Database access
- `@anthropic-ai/sdk`: Claude API for LLM decisions
- `@yachtparty/shared`: Shared types and utilities
- `dotenv`: Environment variable management

## Environment Variables

Required environment variables (in `.env`):

```bash
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Configuration
BOUNCER_AGENT_ID=bouncer_v1
PROMPT_VERSION=bouncer_v1.0
```

## Architecture Notes

### Stateless Design
The Bouncer loads fresh context on each invocation. No in-memory state is maintained between calls.

### Event-Driven
All communication with other agents happens via events. The Bouncer never directly calls other agents.

### Database-First
All state is stored in Supabase. The user record and conversation history are the source of truth.

### Idempotent
The Bouncer can safely process the same message multiple times without side effects.

## Related Documentation

- [requirements.md Section 4.2](../../requirements.md#42-agent-types-and-responsibilities) - Bouncer Agent specification
- [claude.md](../../claude.md) - Architecture patterns and design principles
- [@yachtparty/shared](../../packages/shared/README.md) - Shared types and utilities
