# Message Orchestrator - Quick Start Guide

Get up and running with the Message Orchestrator in 5 minutes.

## 1. Installation

```bash
cd packages/orchestrator
npm install
```

## 2. Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJ...your-key

# Anthropic Claude API
ANTHROPIC_API_KEY=sk-ant-api03-...

# Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1234567890
```

## 3. Build

```bash
npm run build
```

## 4. Basic Usage

### Queue a Message

```typescript
import { MessageOrchestrator } from '@yachtparty/orchestrator';

const orchestrator = new MessageOrchestrator();

// Queue a solution update
const messageId = await orchestrator.queueMessage({
  userId: 'user_123',
  agentId: 'solution_saga_workflow_456',
  messageData: {
    type: 'solution_update',
    findings: {
      matchedInnovators: [
        { name: 'Acme Corp', reason: 'Enterprise CRM' }
      ]
    }
  },
  priority: 'high',
  canDelay: true,
  requiresFreshContext: true
});

console.log(`Message queued: ${messageId}`);
```

### Process Due Messages (Cron)

```typescript
// Called every minute by pg_cron
await orchestrator.processDueMessages();
```

## 5. Common Patterns

### Urgent Notification

```typescript
await orchestrator.queueMessage({
  userId: 'user_123',
  agentId: 'system',
  messageData: {
    type: 'payment_required',
    message: 'Please update your payment method'
  },
  priority: 'urgent',      // Immediate delivery
  canDelay: false,         // Don't wait
  requiresFreshContext: false
});
```

### Scheduled Update

```typescript
await orchestrator.queueMessage({
  userId: 'user_123',
  agentId: 'account_manager',
  messageData: {
    type: 'weekly_summary',
    stats: { introsCompleted: 2 }
  },
  priority: 'low',         // Can defer
  canDelay: true,          // Wait for optimal time
  requiresFreshContext: false
});
```

### Context-Sensitive Message

```typescript
await orchestrator.queueMessage({
  userId: 'user_123',
  agentId: 'solution_saga',
  messageData: {
    type: 'solution_update',
    findings: { /* ... */ }
  },
  priority: 'medium',
  canDelay: true,
  requiresFreshContext: true  // Check relevance before sending
});
```

## 6. Check User Activity

```typescript
const isActive = await orchestrator.isUserActive('user_123');

if (isActive) {
  // User is engaged, good time to send
  console.log('User is active - send now');
} else {
  // User not active, schedule for later
  console.log('User inactive - schedule for optimal time');
}
```

## 7. Testing

Run the test suite:

```bash
npm test
```

Run the examples:

```bash
npm run dev
node dist/examples/usage.js
```

## 8. Integration with Your Agent

### For User-Facing Agents (Bouncer, Concierge, Innovator)

**Immediate reply during active conversation:**
```typescript
// Insert directly to messages table (bypasses queue)
await supabase.from('messages').insert({
  conversation_id: conversationId,
  user_id: userId,
  role: 'concierge',
  content: 'Your reply here',
  direction: 'outbound',
  status: 'pending'
});
```

**Proactive message:**
```typescript
// Use orchestrator for rate limiting and timing
await orchestrator.queueMessage({
  userId,
  agentId: 'concierge_main',
  messageData: { /* structured data */ },
  priority: 'medium',
  canDelay: true,
  requiresFreshContext: true
});
```

### For Background Agents (Solution Saga, Account Manager)

**Always use structured data:**
```typescript
await orchestrator.queueMessage({
  userId,
  agentId: 'solution_saga_workflow_123',
  messageData: {
    type: 'solution_update',
    workflowId: 'workflow_123',
    findings: {
      // Structured data here
      // Orchestrator will call Concierge to render to prose
    }
  },
  priority: 'high',
  canDelay: true,
  requiresFreshContext: true
});
```

## 9. Database Setup

The orchestrator uses these database tables:

- `message_queue` - Message queue
- `user_message_budget` - Rate limiting
- `messages` - Sent messages
- `users` - User preferences
- `agent_actions_log` - Operation logging

Ensure these tables exist (see requirements.md for schema).

### Required Database Function

Create this function for budget increment:

```sql
CREATE OR REPLACE FUNCTION increment_message_budget(
  p_user_id UUID,
  p_date DATE
)
RETURNS void AS $$
BEGIN
  UPDATE user_message_budget
  SET
    messages_sent = messages_sent + 1,
    last_message_at = now()
  WHERE user_id = p_user_id AND date = p_date;
END;
$$ LANGUAGE plpgsql;
```

## 10. Monitoring

### Check Queue Status

```sql
SELECT
  priority,
  status,
  COUNT(*) as count
FROM message_queue
WHERE status = 'queued'
GROUP BY priority, status;
```

### Check Rate Limits

```sql
SELECT
  u.phone_number,
  b.messages_sent,
  b.daily_limit,
  b.last_message_at
FROM user_message_budget b
JOIN users u ON b.user_id = u.id
WHERE b.date = CURRENT_DATE
ORDER BY b.messages_sent DESC;
```

### Check Costs

```sql
SELECT
  DATE(created_at) as date,
  COUNT(*) as operations,
  SUM(input_tokens) as total_input_tokens,
  SUM(output_tokens) as total_output_tokens,
  SUM(cost_usd) as total_cost
FROM agent_actions_log
WHERE agent_type = 'message_orchestrator'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

## 11. Troubleshooting

### Messages Not Sending

1. Check rate limits: `SELECT * FROM user_message_budget WHERE user_id = 'xxx'`
2. Check quiet hours: Verify user timezone in `users` table
3. Check message status: `SELECT * FROM message_queue WHERE id = 'xxx'`
4. Check logs: `SELECT * FROM agent_actions_log WHERE agent_type = 'message_orchestrator' ORDER BY created_at DESC`

### High Costs

1. Review relevance check frequency
2. Check if messages are being rendered unnecessarily
3. Monitor token usage in `agent_actions_log`
4. Consider batching relevance checks

### Rate Limits Too Strict

1. Increase limits in `user_message_budget` table
2. Adjust quiet hours in `users` table
3. Lower priority of less important messages

## 12. Next Steps

- Review [README.md](./README.md) for detailed documentation
- Read [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) for architecture details
- Check [examples/usage.ts](./examples/usage.ts) for more examples
- Review requirements.md Section 5 for full specification

## Support

For issues or questions:
1. Check the logs in `agent_actions_log`
2. Review the test suite for expected behavior
3. Consult requirements.md Section 5
4. Check claude.md for architecture patterns

## Version

- Package: @yachtparty/orchestrator
- Version: 0.1.0
- Node.js: >= 18.0.0
- TypeScript: >= 5.0.0
