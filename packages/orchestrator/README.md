# Message Orchestrator

Central rate limiting and priority management for all outbound messages in the Yachtparty platform.

## Purpose

The Message Orchestrator ensures that all outbound communications to users are:
- **Rate-limited**: Respects daily and hourly message limits per user
- **Timed optimally**: Learns user response patterns and delivers at best times
- **Relevant**: Checks if messages are still contextually appropriate before sending
- **Prioritized**: Urgent messages bypass queue, low-priority messages defer when needed

**Critical Rule**: All agents MUST use Message Orchestrator to send messages to users. Never call Twilio directly.

## Core Logic Overview (Section 5.2 from Requirements)

### Message Queue Flow

```
Agent → queueMessage() → message_queue table → processDueMessages() → attemptDelivery() → SMS
```

### Key Operations

1. **queueMessage()**: Agent queues a message with priority and context
2. **processDueMessages()**: Cron (every 1 min) checks for due messages
3. **attemptDelivery()**: Validates rate limits, quiet hours, relevance before sending
4. **checkRateLimits()**: Enforces daily/hourly limits per user
5. **checkMessageRelevance()**: LLM determines if message still makes sense given recent context
6. **renderMessage()**: Converts structured agent data to conversational prose (via Concierge)
7. **isUserActive()**: Checks if user sent message in last 10 minutes (overrides quiet hours)
8. **calculateOptimalSendTime()**: Learns from user response patterns
9. **isQuietHours()**: Respects user's local time quiet hours (10pm-8am)
10. **sendSMS()**: Inserts into messages table (trigger handles actual Twilio send)
11. **incrementMessageBudget()**: Updates user_message_budget counters
12. **rescheduleMessage()**: Moves message to next available slot
13. **supersededMessage()**: Marks message as stale and optionally reformulates

## Rate Limiting Rules (Section 5.3)

### Default Limits (Per User)

- **Daily**: 10 messages max
- **Hourly**: 2 messages max
- **Quiet Hours**: 10pm - 8am user local time

### Exceptions

**User Active (sent message in last 10 minutes)**:
- Override quiet hours
- Override hourly limits
- Deliver queued messages immediately if relevant

**Urgent Priority**:
- Bypass queue (immediate delivery)
- Still respects daily limits (prevents spam)

## Priority Lanes (Section 5.4)

### Urgent (Immediate Delivery)
- User is actively conversing (sent message <10 min ago)
- Critical system notifications (payment issues, account problems)
- **Delivery**: Immediate, bypasses queue

### High (Next Available Slot)
- Intro acceptances
- High-value solution matches
- Community requests to experts
- **Delivery**: Within next available rate limit slot

### Medium (Scheduled Optimally)
- Solution research updates
- Weekly summaries
- New intro opportunities
- **Delivery**: Calculated optimal send time based on user patterns

### Low (Defer if Queue Full)
- Tips and educational content
- Network updates
- **Delivery**: Deferred if higher priority messages waiting

## Integration with Agents

### For User-Facing Agents (Bouncer, Concierge, Innovator)

**Immediate replies during active conversation**:
```typescript
// User is actively chatting - respond immediately (bypasses queue)
await supabase.from('messages').insert({
  conversation_id: conversationId,
  user_id: userId,
  role: 'concierge',
  content: proseMessage, // Already rendered
  direction: 'outbound',
  status: 'pending'
});
// Database trigger handles SMS sending
```

**Proactive messages**:
```typescript
import { MessageOrchestrator } from '@yachtparty/orchestrator';

const orchestrator = new MessageOrchestrator();

// Queue message with structured data
await orchestrator.queueMessage({
  userId: 'user_123',
  agentId: 'concierge_main',
  messageData: {
    type: 'intro_opportunity',
    introId: 'intro_456',
    prospectName: 'John Smith',
    prospectCompany: 'Acme Corp',
    bountyCredits: 50
  },
  priority: 'medium',
  canDelay: true,
  requiresFreshContext: true
});
```

### For Background Agents (Account Manager, Solution Saga)

**Always use structured data** (Concierge renders to prose):
```typescript
// Solution Saga publishes structured findings
await orchestrator.queueMessage({
  userId: 'user_123',
  agentId: 'solution_saga_workflow_789',
  messageData: {
    type: 'solution_update',
    workflowId: 'workflow_789',
    findings: {
      matchedInnovators: [
        {id: 'inn_1', name: 'Acme Corp', relevance: 0.9, reason: 'Enterprise CRM'}
      ],
      potentialVendors: ['Salesforce', 'HubSpot'],
      clarifyingQuestions: [
        {question: 'What is your budget range?', priority: 'high'}
      ]
    }
  },
  priority: 'medium',
  canDelay: true,
  requiresFreshContext: true // Recheck relevance before sending
});
```

## Message Relevance Checking

When `requiresFreshContext: true`, the orchestrator uses LLM to classify:

- **RELEVANT**: Message still makes sense, send it
- **STALE**: User changed topic, supersede and don't send
- **CONTEXTUAL**: Message provides helpful context for user's new question, send it

This prevents scenarios like:
- User asks about CRM solutions → Saga researches → User pivots to hiring → CRM results now stale

## Optimal Send Time Calculation

Learns from `user.response_pattern` JSONB:
```json
{
  "best_hours": [9, 10, 14, 15, 16],
  "avg_response_time_minutes": 45,
  "preferred_days": ["tuesday", "wednesday", "thursday"],
  "engagement_score": 0.85
}
```

Algorithm:
1. If current time in `best_hours` → send now
2. Else calculate next occurrence of best hour
3. Avoid weekends unless user history shows weekend engagement
4. Default to 10am user local time if no pattern data

## Superseding Logic

Messages can be superseded when:
1. **Newer message covers same topic**: "Here's an intro opportunity" supersedes previous pending intro
2. **User context changed**: User asked new question, old queued answer now irrelevant
3. **Agent withdraws**: Solution Saga decides initial findings insufficient, withdraws message

When superseded:
- Set `status = 'superseded'`
- Record `superseded_by_message_id` and `superseded_reason`
- Optionally create new reformulated message

## Database Schema Used

### `message_queue`
- `id`, `user_id`, `agent_id`
- `message_data` (JSONB): Structured agent output
- `final_message` (TEXT): Rendered prose (set before sending)
- `scheduled_for`, `priority`
- `status`: 'queued', 'approved', 'sent', 'superseded', 'cancelled'
- `requires_fresh_context` (BOOLEAN): Recheck relevance before sending
- `superseded_by_message_id`, `superseded_reason`

### `user_message_budget`
- `user_id`, `date`
- `messages_sent`, `last_message_at`
- `daily_limit`, `hourly_limit`
- `quiet_hours_enabled`

### `messages`
- Final sent messages (referenced by `delivered_message_id`)
- Used to check if user is active (last 10 min)

## Cron Schedule

The orchestrator's `processDueMessages()` is called by pg_cron every 1 minute:

```sql
SELECT cron.schedule(
  'process-message-queue',
  '* * * * *',
  $$
    SELECT process_outbound_messages();
  $$
);
```

This database function publishes events for Cloud Run to process.

## Error Handling

- **Rate limit exceeded**: Reschedule for next available slot
- **Quiet hours**: Reschedule for end of quiet hours (or next best_hour)
- **Message stale**: Supersede and optionally reformulate
- **Twilio failure**: Log error, retry up to 3 times
- **LLM timeout**: Skip relevance check, log warning, proceed with send

## Logging

All operations logged to `agent_actions_log`:
- LLM calls for relevance checking
- Render operations
- Rate limit decisions
- Delivery attempts and results

## Cost Optimization

- Batch relevance checks (check multiple queued messages in single LLM call)
- Use prompt caching for user context
- Only render when message passes all checks (avoid wasted renders)

## Testing

```bash
npm run test
```

Key test scenarios:
- Rate limiting enforcement
- Quiet hours respect (with active user exception)
- Message relevance classification
- Priority lane ordering
- Superseding logic

## Environment Variables

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key
ANTHROPIC_API_KEY=sk-ant-...
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1234567890
```

## Example Usage

See `src/index.ts` for complete implementation and examples.

## Architecture Diagram

```
┌─────────────────┐
│  Agent          │
│  (Concierge,    │
│   Solution Saga)│
└────────┬────────┘
         │ queueMessage()
         ▼
┌─────────────────┐
│ Message         │
│ Orchestrator    │
│                 │
│ • Rate Limiting │
│ • Quiet Hours   │
│ • Relevance     │
│ • Priority      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ message_queue   │
│ (Database)      │
└────────┬────────┘
         │ pg_cron (every 1 min)
         ▼
┌─────────────────┐
│ processDue      │
│ Messages()      │
└────────┬────────┘
         │ attemptDelivery()
         ▼
┌─────────────────┐
│ messages table  │
│ (status=pending)│
└────────┬────────┘
         │ Database trigger
         ▼
┌─────────────────┐
│ Twilio SMS      │
└─────────────────┘
```

## Related Documentation

- requirements.md Section 5: Message Orchestrator
- claude.md: Message Flow section
- database schema: `message_queue`, `user_message_budget`, `messages`
