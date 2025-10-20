# Event Processor Service

An always-on Cloud Run service that consumes events from the `events` table and routes them to appropriate handlers. Core component of Yachtparty's event-driven architecture.

## Overview

The Event Processor implements the event sourcing pattern, enabling:
- Decoupled agent communication via events
- Complete audit trail of all system actions
- Event replay for debugging and testing
- Saga orchestration for multi-step workflows
- Retry logic with dead letter queue for failed events

## Architecture

```
┌─────────────────┐
│  Events Table   │  <-- Agents publish events here
└────────┬────────┘
         │
         │ (Poll every 10s)
         │
┌────────▼────────┐
│ Event Processor │
│  (Cloud Run)    │
└────────┬────────┘
         │
         ├─► User Event Handlers
         ├─► Conversation Event Handlers
         └─► System Event Handlers
                 │
                 └─► Create tasks, update DB, notify agents
```

### Key Components

- **Polling Loop:** Queries `events` table every 10 seconds for unprocessed events
- **Event Registry:** Maps event types to handler functions
- **Event Handlers:** Process specific event types (user, conversation, system)
- **Retry Logic:** Exponential backoff with max 5 retries
- **Dead Letter Queue:** Failed events moved to `event_dead_letters` table
- **Express Server:** Health checks and webhook endpoints

## Features

### Event Processing
- Polls `events` table at configurable interval (default: 10s)
- Processes events in order (FIFO by created_at)
- Batch processing (default: 20 events per cycle)
- Marks events as processed after successful handling

### Error Handling
- Automatic retry with exponential backoff
- Configurable max retries (default: 5)
- Dead letter queue for permanently failed events
- Comprehensive error logging with event IDs

### Monitoring
- Health check endpoint with detailed stats
- Processing metrics (total, success, error, dead letter counts)
- Registry information (handlers, event types)
- Uptime and last processed timestamp

### Extensibility
- Easy to add new event types
- Handler registration in central registry
- Type-safe event routing
- Clear separation of concerns by domain

## Event Handlers

### User Events
- `user.inquiry.solution_needed` - Creates Solution Saga research task
- `community.request_needed` - Creates community request, notifies experts
- `user.intro_inquiry` - Creates Account Manager intro followup task
- `user.verified` - Initializes user priorities, invalidates caches

### Conversation Events
- `user.message.received` - Updates user activity timestamps
- `user.response.recorded` - Logs user responses for learning
- *Note: `conversation.intent_classified` not yet in events types but handler exists*

### System Events
- `solution.research_complete` - Delivers findings to user via Concierge
- `intro.completed` - Awards credits, updates status, notifies parties
- `community.response_received` - Delivers expert response to requester
- `account_manager.processing.completed` - Logs Account Manager results

## Configuration

### Environment Variables

Required:
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
```

Optional:
```bash
PORT=8080                    # HTTP server port
POLL_INTERVAL_MS=10000       # Polling interval (10 seconds)
BATCH_SIZE=20                # Events per batch
MAX_RETRIES=5                # Max retry attempts
ENABLE_POLLING=true          # Enable/disable polling loop
NODE_ENV=production          # Environment
LOG_LEVEL=info               # Logging level
```

## API Endpoints

### GET /health
Health check endpoint for Cloud Run

**Response:**
```json
{
  "status": "healthy",
  "service": "event-processor",
  "timestamp": "2025-10-15T12:00:00Z",
  "uptime": 3600,
  "stats": {
    "totalProcessed": 150,
    "successCount": 145,
    "errorCount": 3,
    "deadLetterCount": 2,
    "lastProcessedAt": "2025-10-15T11:59:50Z"
  },
  "config": {
    "pollIntervalMs": 10000,
    "batchSize": 20,
    "maxRetries": 5,
    "pollingEnabled": true
  },
  "registry": {
    "totalHandlers": 10,
    "eventTypes": ["user.inquiry.solution_needed", "..."]
  }
}
```

### POST /process-event
Manually trigger processing of specific event

**Request:**
```json
{
  "event_id": "uuid-of-event"
}
```

**Response (202 Accepted):**
```json
{
  "success": true,
  "message": "Event processing started",
  "event_id": "uuid-of-event"
}
```

### POST /process-batch
Manually trigger batch processing

**Response (202 Accepted):**
```json
{
  "success": true,
  "message": "Batch processing started"
}
```

## Database Schema

### events table
```sql
CREATE TABLE events (
  id UUID PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  aggregate_id UUID,
  aggregate_type VARCHAR(50),
  payload JSONB NOT NULL,
  metadata JSONB,
  processed BOOLEAN DEFAULT FALSE,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by VARCHAR(100)
);
```

### event_dead_letters table
```sql
CREATE TABLE event_dead_letters (
  id UUID PRIMARY KEY,
  event_id UUID NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  error_message TEXT NOT NULL,
  retry_count INTEGER NOT NULL,
  original_created_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

## Development

### Local Setup

1. Install dependencies:
```bash
npm install
```

2. Set up environment:
```bash
cp .env.example .env
# Edit .env with your Supabase credentials
```

3. Run in development mode:
```bash
npm run dev
```

### Build

```bash
npm run build
```

### Type Checking

```bash
npm run type-check
```

## Testing

See `tests/event-processor.test.md` for comprehensive test cases.

### Test Coverage Goals
- Unit tests: 90%+ coverage
- Integration tests: All major workflows
- Error cases: All error paths
- Performance: Baseline metrics

### Running Tests
```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test
npm test -- event-processor.test.ts
```

## Deployment

### Deploy to Cloud Run

1. Build and deploy:
```bash
cd /Users/bt/Desktop/CODE/Yachtparty\ v.2/packages/services/event-processor

gcloud run deploy event-processor \
  --source . \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars SUPABASE_URL=https://your-project.supabase.co \
  --set-env-vars SUPABASE_SERVICE_KEY=your-service-key \
  --set-env-vars POLL_INTERVAL_MS=10000 \
  --set-env-vars BATCH_SIZE=20 \
  --set-env-vars MAX_RETRIES=5 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300 \
  --max-instances 1 \
  --min-instances 1
```

2. Verify deployment:
```bash
# Get service URL
export SERVICE_URL=$(gcloud run services describe event-processor \
  --region us-central1 --format 'value(status.url)')

# Check health
curl $SERVICE_URL/health
```

### Important: Single Instance Deployment

The Event Processor should run with `--max-instances 1` to prevent duplicate event processing. While the service is designed to be idempotent, running multiple instances can cause:
- Duplicate task creation
- Multiple notifications to users
- Unnecessary database load

For high-availability, implement distributed locking (e.g., with Redis) before scaling horizontally.

### Cloud Scheduler (Optional)

For additional reliability, configure Cloud Scheduler to ping the service:

```bash
gcloud scheduler jobs create http event-processor-keepalive \
  --schedule="*/5 * * * *" \
  --uri="${SERVICE_URL}/health" \
  --http-method=GET \
  --location=us-central1
```

## Monitoring

### Logs

View logs in Cloud Console:
```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=event-processor" \
  --limit 50 \
  --format json
```

### Key Metrics

Monitor these in Cloud Console:
- Request count (health checks)
- Error rate (handler failures)
- CPU utilization
- Memory usage
- Request latency (processing time)

### Alerts

Set up alerts for:
- Error rate > 5%
- Dead letter count increasing
- Service unavailable (health check fails)
- Memory usage > 80%

## Adding New Event Types

### 1. Define Event Type

Add to `@yachtparty/shared/src/types/events.ts`:
```typescript
export type EventType =
  | 'existing.types'
  | 'your.new.event'; // Add here

export interface YourNewEventPayload {
  userId: string;
  data: string;
}
```

### 2. Create Handler

Create handler function in appropriate file:
```typescript
// src/handlers/your-domain-events.ts
export async function handleYourNewEvent(event: Event): Promise<void> {
  console.log(`[your.new.event] Processing event ${event.id}`);

  const payload = event.payload as YourNewEventPayload;

  // Your processing logic here
  await supabase.from('your_table').insert({
    user_id: payload.userId,
    data: payload.data,
  });

  console.log(`[your.new.event] Processed successfully`);
}
```

### 3. Register Handler

Add to `src/registry.ts`:
```typescript
import { handleYourNewEvent } from './handlers/your-domain-events';

export function initializeHandlers(): void {
  // ... existing handlers ...

  registerHandler(
    'your.new.event',
    handleYourNewEvent,
    'Description of what this handler does'
  );
}
```

### 4. Test Handler

Create test in `tests/`:
```typescript
describe('handleYourNewEvent', () => {
  it('processes event correctly', async () => {
    const event = createMockEvent('your.new.event', payload);
    await handleYourNewEvent(event);
    expect(mockSupabase.from).toHaveBeenCalledWith('your_table');
  });
});
```

### 5. Deploy

```bash
npm run build
gcloud run deploy event-processor --source .
```

## Troubleshooting

### Events Not Processing

Check:
1. Service is running: `curl $SERVICE_URL/health`
2. Events exist: `SELECT COUNT(*) FROM events WHERE processed = false;`
3. Polling enabled: Check ENABLE_POLLING env var
4. Service logs for errors

### High Error Rate

Check:
1. Dead letter queue: `SELECT * FROM event_dead_letters ORDER BY created_at DESC LIMIT 10;`
2. Event metadata for retry counts: `SELECT id, event_type, metadata->'retry_count' FROM events WHERE processed = false;`
3. Handler logs for specific error messages
4. Database connectivity and permissions

### Performance Issues

Check:
1. Batch size (may be too large): Reduce BATCH_SIZE
2. Poll interval (may be too frequent): Increase POLL_INTERVAL_MS
3. Database query performance: Check indexes on events table
4. Handler execution time: Profile specific handlers

### Dead Letter Queue Growing

Check:
1. Common error patterns: `SELECT error_message, COUNT(*) FROM event_dead_letters GROUP BY error_message;`
2. Specific event types failing: `SELECT event_type, COUNT(*) FROM event_dead_letters GROUP BY event_type;`
3. Fix root cause and manually replay events if needed

## Event Sourcing Patterns

### Idempotency

All handlers should be idempotent - safe to execute multiple times:
```typescript
// Good: Upsert operation
await supabase.from('tasks').upsert({
  id: taskId, // Deterministic ID
  ...data
});

// Bad: Insert without checking
await supabase.from('tasks').insert(data); // Creates duplicate!
```

### Event Ordering

Events are processed in order (FIFO) per batch, but:
- Batches may overlap in rare cases
- Use event versioning for critical order dependencies
- Consider aggregate-based ordering if needed

### Replay

To replay events (for debugging or recovery):
```sql
-- Mark events as unprocessed
UPDATE events
SET processed = false, metadata = metadata || '{"replayed": true}'::jsonb
WHERE id IN ('event-id-1', 'event-id-2');

-- Service will process on next poll cycle
```

## Security

- Service uses Supabase service role key (bypasses RLS)
- No authentication on endpoints (internal service only)
- For production: Add authentication middleware
- For production: Validate event payloads before processing
- Keep service role key secure (use Secret Manager)

## Performance Characteristics

- **Throughput:** ~120 events/minute (20 per batch, 10s interval)
- **Latency:** ~100-500ms per event (depends on handler)
- **Memory:** ~200MB baseline, ~400MB under load
- **CPU:** ~5-10% baseline, ~30% under load

Scale by:
- Increasing BATCH_SIZE (more events per cycle)
- Decreasing POLL_INTERVAL_MS (more frequent polls)
- Adding distributed locking + multiple instances (advanced)

## Future Enhancements

- [ ] Distributed locking for horizontal scaling
- [ ] Priority queue (process high-priority events first)
- [ ] Event replay UI for manual intervention
- [ ] Dead letter queue dashboard
- [ ] Webhook delivery for external integrations
- [ ] Event filtering and conditional routing
- [ ] Metrics export to Prometheus/Datadog
- [ ] Circuit breaker for failing handlers

## Contributing

When adding new handlers:
1. Follow existing handler patterns
2. Add comprehensive error handling
3. Log with event IDs for traceability
4. Write unit tests with 90%+ coverage
5. Update this README with new event types
6. Test idempotency thoroughly

## License

UNLICENSED - Proprietary to Yachtparty

## Support

For issues or questions:
- Check logs first: `gcloud logging read ...`
- Review test cases: `tests/event-processor.test.md`
- Check CURRENT_STATUS.md for system state
- Contact: engineering@yachtparty.com
