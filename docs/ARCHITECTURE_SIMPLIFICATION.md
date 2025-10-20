# Architecture Simplification: Message Flow Redesign

**Status:** Proposed
**Date:** 2025-10-18
**Purpose:** Simplify message orchestration by clarifying agent responsibilities and eliminating duplicate logic

## Problem Statement

Current architecture has unclear boundaries between Account Manager, POC Agents, and Message Orchestrator:

### Current Issues

1. **Duplicate Scheduling Logic**
   - Account Manager calculates optimal notification time in `task-creator.ts`
   - Message Orchestrator ALSO calculates optimal send time in `index.ts`
   - Same logic implemented twice

2. **Unclear Responsibilities**
   - Account Manager makes timing decisions (when to notify)
   - Message Orchestrator makes relevance decisions (`requires_fresh_context`)
   - Message Orchestrator renders messages (should be POC agent)
   - Three separate systems involved in sending one message

3. **Message Queue Churn**
   - Messages queued → rescheduled → relevance checked → superseded → reformulation requested → new queue entry
   - A single message can cycle through the queue multiple times
   - `requires_fresh_context` flag creates feedback loops

4. **Missing Multi-Message Support**
   - Agents forced to cram complex info into single SMS
   - No way to naturally break thoughts across multiple messages
   - Poor UX for longer updates

## Proposed Solution

### Clear Separation of Concerns

| Component | Current Responsibilities | New Responsibilities |
|-----------|-------------------------|---------------------|
| **Account Manager** | Analyze events, score priorities, calculate timing, create tasks | Analyze events, score priorities, **output structured findings only** |
| **POC Agents** | Craft prose (?), handle user messages | Handle user messages, **decide when/how to communicate**, render all prose, **manage queued messages** |
| **Message Orchestrator** | Relevance checks, rendering, scheduling, rate limits, quiet hours, timing | **Rate limits only**, **trigger POC agents when send windows open** |

### New Architecture Flow

```
┌─────────────────────┐
│  Account Manager    │
│  (Every 6 hours)    │
└──────────┬──────────┘
           │
           ├─ Publishes events with structured findings
           ├─ Creates priority records
           ├─ NO scheduling decisions
           │
           ▼
┌─────────────────────┐
│   POC Agent         │
│ (Event-triggered)   │
└──────────┬──────────┘
           │
           ├─ Receives priority updates
           ├─ Decides: notify now? wait? ignore?
           ├─ Calculates optimal timing
           ├─ Renders message to prose
           │
           ▼
      Queue Message
           │
           ▼
┌─────────────────────┐
│ Message Orchestrator│
└──────────┬──────────┘
           │
           ├─ Checks rate limits only
           ├─ Queues if no budget
           │
           ├─ Detects send windows:
           │  • User becomes active
           │  • Quiet hours end
           │  • Budget refills
           │
           ├─ Triggers POC Agent:
           │  "You have N queued messages.
           │   User just sent X. Send/modify/cancel?"
           │
           ▼
      POC Agent Decides
           │
           ├─ send_message(text)
           ├─ send_message_sequence([...])
           ├─ cancel_queued_message(id)
           └─ (or do nothing)
```

## Key Changes

### 1. Account Manager Simplification

**Remove:**
- `calculateOptimalNotificationTime()`
- `calculateFromPattern()`
- `calculateDefaultTiming()`
- `shouldNotifyNow()`
- All timing/scheduling logic

**Keep:**
- Priority scoring
- Event processing
- Publishing structured findings

**New Output:**
```typescript
// Account Manager creates event instead of task
{
  type: 'priority_update',
  user_id: userId,
  priorities: [
    { item_type: 'intro_opportunity', item_id: '...', score: 95 },
    { item_type: 'solution_update', item_id: '...', score: 87 }
  ],
  created_by: 'account_manager'
}

// POC Agent (Concierge) handles event
// Decides: "95 score intro = notify immediately"
// Or: "87 score solution = wait until user asks"
```

### 2. POC Agent Enhancements

**New Actions:**

```typescript
// 1. Single message
{
  type: 'send_message',
  content: 'Found a great intro for you.'
}

// 2. Multi-message sequence (NEW)
{
  type: 'send_message_sequence',
  messages: [
    'Found a great intro for you.',
    'Sarah Chen at Stripe. You both know Mike.',
    'Want me to set it up?'
  ],
  delay_seconds: 1  // Stagger by 1 second
}

// 3. Cancel queued message (NEW)
{
  type: 'cancel_queued_message',
  message_id: 'uuid',
  reason: 'User already addressed this'
}

// 4. Queue for later (NEW)
{
  type: 'queue_message',
  content: 'Update on your Stripe intro request',
  scheduled_for: '2025-10-19T09:00:00Z',
  reason: 'Waiting for expert responses'
}
```

**New System Prompt Context:**

```
QUEUED MESSAGES (when applicable):
You have 2 queued messages that haven't been sent yet:

1. ID: abc-123
   Queued: 2 hours ago
   Content: "Found 3 intros for you: [details]"

2. ID: def-456
   Queued: 30 minutes ago
   Content: "Update on your Stripe request"

The user just became active / quiet hours ended.

Review these queued messages and decide:
- send_message(content) - send immediately if still relevant
- send_message_sequence([...]) - send as multi-part if needs expansion
- cancel_queued_message(id, reason) - cancel if superseded
- Do nothing - keep queued for later

Remember: User has NOT seen these yet.
```

### 3. Message Orchestrator Simplification

**Remove:**
- `requires_fresh_context` field and logic
- `checkMessageRelevance()`
- `renderMessage()` (POC agent renders now)
- `calculateOptimalSendTime()` (duplicate logic)
- `supersededMessage()` (POC agent decides)
- `requestReformulation()` (POC agent handles)

**Keep:**
- Rate limit checking
- Quiet hours detection
- Message queue table operations
- Actual SMS delivery via Twilio

**New Responsibilities:**

```typescript
// 1. Detect send windows opening
async onUserActive(userId: string) {
  const queued = await this.getQueuedMessages(userId);
  if (queued.length === 0) return;

  // Trigger POC agent
  await this.invokePOCAgent({
    userId,
    trigger: 'user_became_active',
    queuedMessages: queued
  });
}

async onQuietHoursEnded(userId: string) {
  const queued = await this.getQueuedMessages(userId);
  if (queued.length === 0) return;

  // Trigger POC agent
  await this.invokePOCAgent({
    userId,
    trigger: 'quiet_hours_ended',
    queuedMessages: queued
  });
}

// 2. Handle message sequences
async handleSendMessageSequence(action, userId) {
  const budget = await this.getRemainingBudget(userId);

  // All-or-nothing: send complete sequence or queue it all
  if (budget > 0) {
    await this.sendSequence(action.messages, userId);
    await this.incrementMessageBudget(userId, 1); // Count as 1 turn
  } else {
    await this.queueCompleteSequence(action.messages, userId);
  }
}

// 3. Rate limits only
async checkRateLimits(userId: string): Promise<RateLimitResult> {
  // Daily limit check
  // Hourly limit check
  // Returns: { allowed: boolean, reason?: string }
}
```

### 4. Message Sequence Rules

**Sequence = 1 Conversation Turn:**
- Counts as 1 toward daily message budget
- Whether 2 messages or 5 messages
- Prevents artificial splitting of thoughts

**All-or-Nothing Delivery:**
- If budget > 0: send complete sequence immediately
- If budget = 0: queue complete sequence for tomorrow
- Never split a sequence across days

**Limits:**
- Max 5 messages per sequence
- Prevents abuse
- Forces conciseness

**Timing:**
- Messages staggered by `delay_seconds` (default: 1)
- Sequential timestamps: T+0s, T+1s, T+2s, etc.
- Preserves order

**Examples:**

```typescript
// Good: Breaking up intro list
{
  type: 'send_message_sequence',
  messages: [
    'Found 3 great intros for you.',
    '1. Sarah at Stripe - mutual friend Mike',
    '2. Alex at OpenAI - Stanford connection',
    '3. Jamie at Anthropic - ex-Google',
    'Want me to set any up?'
  ]
}
// Counts as 1 toward budget, all send together or all wait

// Bad: Trying to bypass limits
{
  type: 'send_message_sequence',
  messages: [...50 messages...] // ❌ Rejected: max 5
}
```

## Database Schema Changes

### Remove Fields

```sql
-- message_queue table
ALTER TABLE message_queue
  DROP COLUMN requires_fresh_context,
  DROP COLUMN superseded_by_message_id,
  DROP COLUMN superseded_reason;
```

### Add Fields

```sql
-- message_queue table
ALTER TABLE message_queue
  ADD COLUMN sequence_id UUID,  -- Groups messages in a sequence
  ADD COLUMN sequence_position INTEGER,  -- 1, 2, 3, etc.
  ADD COLUMN sequence_total INTEGER;  -- Total messages in sequence
```

### Message Budget

No schema changes needed. Existing `user_message_budget` table works:
- Each `send_message` = increment by 1
- Each `send_message_sequence` = increment by 1 (regardless of length)

## Migration Strategy

### Phase 1: Add New Capabilities
1. Add `send_message_sequence` action to POC agents
2. Add sequence handling to Message Orchestrator
3. Deploy without removing old code

### Phase 2: Update Account Manager
1. Remove timing calculation logic
2. Output structured findings only
3. Deploy and verify events published correctly

### Phase 3: Update POC Agents
1. Add queued message handling to system prompts
2. Implement timing decisions in agents
3. Test with real scenarios

### Phase 4: Simplify Message Orchestrator
1. Remove `requires_fresh_context` logic
2. Remove rendering logic
3. Remove duplicate timing calculations
4. Add send window triggers

### Phase 5: Database Cleanup
1. Drop unused columns
2. Update indexes
3. Clean up old queued messages

## Benefits

### Clearer Code
- Each component has one clear job
- No duplicate logic
- Easier to debug (one place to look)

### Better UX
- Multi-message support for complex updates
- Intelligent queued message handling
- No split conversations across days

### Lower Costs
- Fewer LLM calls (no duplicate relevance checks)
- Simpler prompts
- Less queue churn

### Easier Maintenance
- Changes to timing logic = one place only
- Changes to message rendering = one place only
- Clear boundaries between components

## Testing Strategy

### Unit Tests
- POC agent: queued message decision-making
- Message Orchestrator: sequence handling, rate limits
- Account Manager: structured output only

### Integration Tests
- User becomes active → queued messages delivered
- Quiet hours end → queued messages delivered
- Message sequence → all-or-nothing delivery
- Budget exhausted → sequence queued complete

### Scenarios to Test
1. User quiet, message queued, user sends message, queued message now irrelevant
2. User quiet, message queued, quiet hours end, message still relevant
3. Agent wants 5-message sequence, budget = 1, entire sequence queued
4. Agent wants 2-message sequence, budget = 3, both send immediately

## Open Questions

1. Should Account Manager still create tasks for Concierge, or just publish events?
   - Leaning toward: publish events, Concierge subscribes

2. Should we support partial sequence sends if some messages already sent?
   - Leaning toward: no, keep it simple

3. What happens if POC agent is slow to respond to queued message trigger?
   - Add timeout (30s), if no response, send original messages

4. Should sequence messages count individually for metrics/analytics?
   - Yes, track as separate messages in DB
   - But count as 1 for budget

## Success Metrics

- Reduce duplicate code by ~40%
- Eliminate message queue churn (0 reschedule/supersede loops)
- Enable multi-message responses
- Maintain or improve message delivery latency
- No increase in LLM costs

---

## Next Steps

1. Review and refine this proposal
2. Get approval on architecture changes
3. Create implementation plan with tasks
4. Start with Phase 1 (add new capabilities)
