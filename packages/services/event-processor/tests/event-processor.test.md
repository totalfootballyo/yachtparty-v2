# Event Processor Test Cases

## Test Suite Overview

This document outlines comprehensive test cases for the Event Processor service. These tests should be implemented using Jest or Vitest with Supabase mocking.

---

## 1. Event Routing Tests

### Test 1.1: Route event to correct handler
**Description:** Verify events are routed to the correct handler based on event_type

**Setup:**
- Mock Supabase client
- Create test event with type 'user.inquiry.solution_needed'

**Steps:**
1. Call `routeEvent(event)`
2. Verify correct handler was invoked
3. Verify handler received correct event data

**Expected Result:**
- `handleSolutionResearchNeeded` handler is called
- Event data passed correctly to handler
- No errors thrown

---

### Test 1.2: Handle unknown event type gracefully
**Description:** Verify service handles events with no registered handler

**Setup:**
- Create event with unknown type 'unknown.event.type'

**Steps:**
1. Call `routeEvent(event)`
2. Check console warnings
3. Verify event is marked as processed

**Expected Result:**
- Warning logged: "No handler registered for event type: unknown.event.type"
- Event marked as processed (to prevent infinite retry)
- No errors thrown

---

### Test 1.3: Handler throws error
**Description:** Verify error handling when handler fails

**Setup:**
- Mock handler to throw error
- Create test event

**Steps:**
1. Call `processEvent(event)`
2. Verify error is caught
3. Check retry count updated

**Expected Result:**
- Error caught and logged
- Event metadata updated with retry_count
- Event NOT marked as processed
- Error re-thrown for retry logic

---

## 2. Retry Logic Tests

### Test 2.1: Retry event after handler failure
**Description:** Verify event is retried after handler fails

**Setup:**
- Create event with metadata.retry_count = 0
- Mock handler to fail

**Steps:**
1. Process event
2. Verify retry_count incremented
3. Verify event not marked as processed

**Expected Result:**
- metadata.retry_count = 1
- metadata.last_error contains error message
- Event remains unprocessed

---

### Test 2.2: Move to dead letter queue after max retries
**Description:** Verify event moves to dead letter queue after max retries

**Setup:**
- Create event with metadata.retry_count = 4 (MAX_RETRIES = 5)
- Mock handler to fail

**Steps:**
1. Process event
2. Verify event moved to event_dead_letters table
3. Verify original event marked as processed

**Expected Result:**
- Record created in event_dead_letters table
- Original event marked as processed
- dead_letter record contains original event data and error

---

### Test 2.3: Successful processing after retry
**Description:** Verify event processes successfully after previous failure

**Setup:**
- Create event with metadata.retry_count = 2
- Mock handler to succeed this time

**Steps:**
1. Process event
2. Verify event marked as processed
3. Verify no additional retries

**Expected Result:**
- Event marked as processed
- processed_at timestamp set
- No further retries

---

## 3. Event Handler Tests

### Test 3.1: handleSolutionResearchNeeded creates task
**Description:** Verify Solution Saga task is created

**Setup:**
- Mock Supabase insert for agent_tasks
- Create event with solution_needed payload

**Steps:**
1. Call handler with event
2. Verify agent_tasks insert called
3. Check task parameters

**Expected Result:**
- agent_tasks.insert called with correct data
- task_type = 'research_solution'
- agent_type = 'solution_saga'
- priority set based on urgency

---

### Test 3.2: handleCommunityQuestionAsked creates request
**Description:** Verify community request created and experts notified

**Setup:**
- Mock Supabase inserts
- Mock expert matching query

**Steps:**
1. Call handler with community request event
2. Verify community_requests insert
3. Verify expert notification tasks created

**Expected Result:**
- community_requests record created
- Matching experts queried
- Notification tasks created for each expert

---

### Test 3.3: handleIntroCompleted awards credits
**Description:** Verify credits awarded when intro completes

**Setup:**
- Mock Supabase updates and inserts
- Create intro completion event

**Steps:**
1. Call handler with intro completed event
2. Verify intro_opportunities status updated
3. Verify credit_events insert
4. Verify notification task created

**Expected Result:**
- intro_opportunities.status = 'completed'
- credit_events record created with correct amount
- User credit_balance updated (via trigger)
- Notification task created

---

### Test 3.4: handleIntentClassified updates conversation metadata
**Description:** Verify conversation metadata updated with intent

**Setup:**
- Mock Supabase select and update
- Create intent classified event

**Steps:**
1. Call handler with intent event
2. Verify conversation metadata updated
3. Check Account Manager notified if high confidence

**Expected Result:**
- Conversation metadata contains last_intent
- intent_confidence stored
- If confidence > 0.8, Account Manager task created

---

## 4. Polling Tests

### Test 4.1: Poll for unprocessed events
**Description:** Verify polling fetches unprocessed events

**Setup:**
- Mock Supabase query to return 3 unprocessed events
- Mock event processing

**Steps:**
1. Call `processUnprocessedEvents()`
2. Verify query called with correct filters
3. Verify all events processed

**Expected Result:**
- Query filters: processed=false, order by created_at
- Limit = BATCH_SIZE (20)
- All 3 events processed sequentially

---

### Test 4.2: Handle empty event queue
**Description:** Verify polling handles no events gracefully

**Setup:**
- Mock Supabase query to return empty array

**Steps:**
1. Call `processUnprocessedEvents()`
2. Verify no processing attempted

**Expected Result:**
- Query executed
- No event processing calls
- No errors or warnings

---

### Test 4.3: Polling respects batch size
**Description:** Verify polling limits to BATCH_SIZE events

**Setup:**
- Mock query to return BATCH_SIZE events
- Set BATCH_SIZE = 5

**Steps:**
1. Call `processUnprocessedEvents()`
2. Verify query limit parameter

**Expected Result:**
- Query called with .limit(5)
- 5 events processed
- No more than batch size processed in single iteration

---

## 5. Webhook Endpoint Tests

### Test 5.1: POST /process-event with valid event_id
**Description:** Verify webhook triggers specific event processing

**Setup:**
- Mock Express request with event_id
- Mock Supabase fetch for event

**Steps:**
1. POST to /process-event with { event_id: 'uuid' }
2. Verify event fetched
3. Verify processing triggered

**Expected Result:**
- Status 202 Accepted
- Response: { success: true, message: '...', event_id: 'uuid' }
- Event processing triggered asynchronously

---

### Test 5.2: POST /process-event with missing event_id
**Description:** Verify webhook returns 400 for missing event_id

**Steps:**
1. POST to /process-event with empty body

**Expected Result:**
- Status 400 Bad Request
- Response: { error: 'event_id is required' }

---

### Test 5.3: POST /process-event with already processed event
**Description:** Verify webhook rejects already processed events

**Setup:**
- Mock event with processed=true

**Steps:**
1. POST to /process-event with processed event_id

**Expected Result:**
- Status 400 Bad Request
- Response: { error: 'Event already processed' }

---

### Test 5.4: POST /process-batch triggers batch processing
**Description:** Verify webhook triggers batch processing

**Steps:**
1. POST to /process-batch
2. Verify processUnprocessedEvents called

**Expected Result:**
- Status 202 Accepted
- Response: { success: true, message: 'Batch processing started' }
- Batch processing triggered asynchronously

---

## 6. Health Check Tests

### Test 6.1: GET /health returns service status
**Description:** Verify health endpoint returns correct information

**Steps:**
1. GET /health

**Expected Result:**
- Status 200 OK
- Response contains:
  - status: 'healthy'
  - service: 'event-processor'
  - timestamp
  - uptime (seconds)
  - stats (totalProcessed, successCount, errorCount, deadLetterCount)
  - config (pollIntervalMs, batchSize, maxRetries)
  - registry (totalHandlers, eventTypes array)

---

## 7. Idempotency Tests

### Test 7.1: Duplicate event processing is safe
**Description:** Verify processing same event multiple times is safe

**Setup:**
- Process event successfully
- Attempt to process same event again

**Steps:**
1. Process event (marks as processed)
2. Query for unprocessed events
3. Verify event not returned

**Expected Result:**
- First processing succeeds
- Event marked as processed
- Second query excludes event (processed=true)

---

### Test 7.2: Concurrent processing of same event
**Description:** Verify concurrent processing doesn't create duplicates

**Setup:**
- Two workers processing same batch
- Use FOR UPDATE SKIP LOCKED pattern (future enhancement)

**Steps:**
1. Start processing event in worker 1
2. Start processing event in worker 2
3. Verify only one succeeds

**Expected Result:**
- One worker processes event
- Other worker skips (row locked)
- No duplicate side effects

---

## 8. Error Handling Tests

### Test 8.1: Database connection failure
**Description:** Verify graceful handling of DB connection loss

**Setup:**
- Mock Supabase to throw connection error

**Steps:**
1. Attempt to fetch events
2. Verify error logged
3. Verify service continues (retry on next poll)

**Expected Result:**
- Error logged with details
- Service doesn't crash
- Next polling iteration attempts reconnection

---

### Test 8.2: Malformed event payload
**Description:** Verify handling of events with invalid payload

**Setup:**
- Create event with malformed JSON payload

**Steps:**
1. Process event
2. Handler attempts to parse payload
3. Verify error caught

**Expected Result:**
- Error logged with event ID
- Event retried up to max retries
- Eventually moved to dead letter queue

---

## 9. Integration Tests

### Test 9.1: End-to-end solution research workflow
**Description:** Full workflow from event creation to task creation

**Setup:**
- Real Supabase test database
- Create user.inquiry.solution_needed event

**Steps:**
1. Insert event into events table
2. Wait for polling cycle
3. Verify event processed
4. Verify agent_task created
5. Verify event marked as processed

**Expected Result:**
- Event processed successfully
- agent_tasks record exists with correct data
- Original event marked as processed

---

### Test 9.2: Dead letter queue workflow
**Description:** Full workflow for failed event

**Setup:**
- Real Supabase test database
- Create event that will fail (invalid user_id)

**Steps:**
1. Insert event
2. Process through 5 retries
3. Verify moved to dead letter queue

**Expected Result:**
- Event fails 5 times
- metadata.retry_count incremented each time
- After 5th failure, moved to event_dead_letters
- Original event marked as processed

---

## 10. Performance Tests

### Test 10.1: Process large batch efficiently
**Description:** Verify performance with large event batches

**Setup:**
- Insert 100 unprocessed events
- Configure BATCH_SIZE=20

**Steps:**
1. Measure time for one polling cycle
2. Verify all events processed within reasonable time

**Expected Result:**
- One cycle processes 20 events
- Processing time < 5 seconds per batch
- All 100 events processed within 30 seconds

---

## Test Implementation Notes

### Mocking Strategy
```typescript
// Mock Supabase client
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: mockData, error: null }),
    })),
  })),
}));
```

### Test Database Setup
```sql
-- Create test events
INSERT INTO events (event_type, aggregate_id, aggregate_type, payload, processed)
VALUES
  ('user.inquiry.solution_needed', 'user-123', 'user', '{"requestDescription": "Need CRM"}', false),
  ('user.verified', 'user-456', 'user', '{"pocAgentType": "concierge"}', false);
```

### Running Tests
```bash
# Run all tests
npm test

# Run specific test file
npm test event-processor.test.ts

# Run with coverage
npm test -- --coverage
```

---

## Coverage Goals

- **Unit Tests:** 90%+ coverage for handlers and registry
- **Integration Tests:** Cover all major workflows
- **Error Cases:** Test all error paths and edge cases
- **Performance:** Baseline metrics for regression detection
