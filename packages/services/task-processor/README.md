# Task Processor Service

Always-on Cloud Run service that processes scheduled agent tasks from the `agent_tasks` table.

## Overview

The Task Processor is a core component of the Yachtparty multi-agent system. It polls the `agent_tasks` table every 30 seconds for pending tasks and routes them to appropriate handlers based on task type.

### Key Features

- **Background Polling**: Checks for pending tasks every 30 seconds
- **Task Routing**: Routes tasks to specific handlers by task_type
- **Retry Logic**: Automatic retries with exponential backoff (max 3 attempts)
- **Status Tracking**: Updates task status through lifecycle (pending → processing → completed/failed)
- **Comprehensive Logging**: Logs all actions to agent_actions_log table
- **Webhook Support**: Can process specific tasks via POST /process-task endpoint
- **Health Monitoring**: GET /health endpoint with processing statistics

## Task Types Supported

### Implemented Handlers

1. **research_solution**
   - Publishes event to trigger Solution Saga workflow
   - Used when agents need to research solutions for users

2. **schedule_followup**
   - Creates followup messages for users
   - Handles scheduled re-engagement

3. **update_user_profile**
   - Updates user record fields
   - Validates field allowlist for security

4. **re_engagement_check**
   - Follows up with inactive users during onboarding
   - Implements multi-attempt strategy with conversation pausing

### Placeholder Handlers

These task types are defined but not yet implemented:

- `process_community_request` - Route expert requests
- `notify_user_of_priorities` - Alert users of opportunities
- `solution_workflow_timeout` - Check for overdue responses
- `create_conversation_summary` - Summarize conversations
- `intro_followup_check` - Verify intro completion
- `community_request_available` - Notify experts
- `send_introduction` - Send introduction emails
- `verify_user` - Process user verifications

## Architecture

### Polling Loop

```
Every 30 seconds:
  1. Query agent_tasks WHERE status='pending' AND scheduled_for <= NOW()
  2. Order by priority (urgent → high → medium → low), then scheduled_for
  3. Process up to 10 tasks per poll
  4. For each task:
     - Update status to 'processing'
     - Execute handler
     - Update to 'completed' or 'failed'
     - Log to agent_actions_log
```

### Retry Strategy

Failed tasks are automatically retried with exponential backoff:

- **Attempt 1**: Immediate
- **Attempt 2**: +1 minute
- **Attempt 3**: +2 minutes
- **Attempt 4**: +4 minutes (final)

After max retries, task is marked as permanently failed.

### Task Status Lifecycle

```
pending → processing → completed
                    → failed (with retries)
                    → failed (permanent)
```

## Environment Variables

Required:

- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_KEY` - Service role key (bypasses RLS)

Optional:

- `PORT` - HTTP server port (default: 8080)
- `POLLING_INTERVAL_MS` - Polling interval in milliseconds (default: 30000)
- `MAX_TASKS_PER_POLL` - Max tasks per polling cycle (default: 10)
- `MAX_RETRIES` - Max retry attempts (default: 3)

## Development

### Local Development

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env
# Edit .env with your Supabase credentials

# Run in development mode (with auto-reload)
npm run dev

# Run in production mode
npm run build
npm start
```

### Testing

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

### Docker

```bash
# Build Docker image
npm run docker:build

# Run container locally
npm run docker:run
```

## Deployment

### Deploy to Cloud Run

```bash
# Build and deploy
gcloud run deploy task-processor \
  --source . \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars SUPABASE_URL=https://your-project.supabase.co,SUPABASE_SERVICE_KEY=your-key \
  --min-instances 1 \
  --max-instances 3 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300
```

**Important**: Set `--min-instances 1` to ensure always-on polling.

### Monitoring

Check service health:

```bash
curl https://task-processor-xxx.run.app/health
```

Response includes:

```json
{
  "status": "healthy",
  "service": "task-processor",
  "timestamp": "2025-10-15T12:00:00.000Z",
  "stats": {
    "tasksProcessed": 142,
    "tasksSucceeded": 138,
    "tasksFailed": 4,
    "successRate": "97.2%",
    "lastProcessedAt": "2025-10-15T11:59:30.000Z"
  },
  "polling": {
    "enabled": true,
    "intervalMs": 30000,
    "maxTasksPerPoll": 10
  }
}
```

## API Endpoints

### GET /health

Health check endpoint for Cloud Run.

**Response**: Service health and statistics

### POST /process-task

Process a specific task immediately (webhook endpoint).

**Body**:
```json
{
  "task_id": "uuid-of-task"
}
```

**Response**:
```json
{
  "success": true,
  "taskId": "uuid-of-task"
}
```

### POST /trigger-poll

Manually trigger a polling cycle (for testing).

**Response**:
```json
{
  "success": true,
  "message": "Polling triggered"
}
```

## Adding New Task Handlers

1. **Create handler file**: `src/handlers/your-handler.ts`

```typescript
import { createServiceClient } from '@yachtparty/shared';
import type { Task, TaskResult } from '../types.js';

export async function handleYourTask(task: Task): Promise<TaskResult> {
  const context = task.context_json;
  const supabase = createServiceClient();

  try {
    // Your task logic here

    return {
      success: true,
      data: { /* result data */ },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      shouldRetry: true,
    };
  }
}
```

2. **Register handler**: Add to `src/handlers/index.ts`

```typescript
import { handleYourTask } from './your-handler.js';

export const taskHandlers: Record<TaskType, TaskHandler> = {
  // ...existing handlers
  your_task_type: handleYourTask,
};
```

3. **Add task type**: Update `src/types.ts`

```typescript
export type TaskType =
  | 'existing_types'
  | 'your_task_type';
```

4. **Test**: Create test in `src/__tests__/handlers/your-handler.test.ts`

## Database Schema

Tasks are stored in the `agent_tasks` table:

```sql
CREATE TABLE agent_tasks (
  id UUID PRIMARY KEY,
  task_type VARCHAR(100) NOT NULL,
  agent_type VARCHAR(50) NOT NULL,
  user_id UUID REFERENCES users(id),
  context_id UUID,
  context_type VARCHAR(50),
  scheduled_for TIMESTAMPTZ NOT NULL,
  priority VARCHAR(20) DEFAULT 'medium',
  status VARCHAR(50) DEFAULT 'pending',
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  last_attempted_at TIMESTAMPTZ,
  context_json JSONB NOT NULL,
  result_json JSONB,
  error_log TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by VARCHAR(100),
  completed_at TIMESTAMPTZ
);
```

## Logging

All task processing is logged to `agent_actions_log`:

```sql
INSERT INTO agent_actions_log (
  agent_type,
  action_type,
  user_id,
  context_id,
  context_type,
  latency_ms,
  input_data,
  output_data,
  error
) VALUES (
  'task_processor',
  'process_research_solution',
  'user-uuid',
  'task-uuid',
  'agent_task',
  1234,
  {...},
  {...},
  NULL
);
```

## Troubleshooting

### Tasks not processing

1. Check service is running: `curl https://your-service.run.app/health`
2. Check min-instances: Should be >= 1 for always-on polling
3. Check logs: `gcloud run services logs read task-processor`
4. Verify database connectivity

### High failure rate

1. Check error logs in `agent_tasks.error_log`
2. Review `agent_actions_log` for patterns
3. Verify handler implementations
4. Check Supabase quotas and rate limits

### Slow processing

1. Increase `max_retries` for transient errors
2. Increase `MAX_TASKS_PER_POLL` if backlog grows
3. Reduce `POLLING_INTERVAL_MS` for faster processing
4. Scale to multiple instances (requires FOR UPDATE SKIP LOCKED)

## Production Considerations

### Idempotency

All handlers should be idempotent - safe to retry without side effects. Use:

- Unique constraint checks before inserts
- Upserts instead of inserts where appropriate
- Transaction isolation where needed

### Concurrency

Current implementation processes tasks sequentially. For concurrent processing:

1. Use `FOR UPDATE SKIP LOCKED` in query
2. Scale to multiple Cloud Run instances
3. Each instance processes different tasks

### Cost Optimization

- **Min instances**: Balance availability vs. cost
- **CPU allocation**: 1 CPU sufficient for most workloads
- **Memory**: 512Mi recommended, scale if handlers are memory-intensive
- **Polling interval**: Longer intervals reduce costs but increase latency

## Related Services

- **twilio-webhook**: Creates tasks during user interactions
- **sms-sender**: Sends messages created by task handlers
- **realtime-processor**: Alternative event-driven architecture (not currently used)

## References

- [CURRENT_STATUS.md](../../../CURRENT_STATUS.md) - Project status
- [AGENT_INTERFACES.md](../../../AGENT_INTERFACES.md) - Agent patterns
- [requirements.md](../../../requirements.md) - System requirements
- [sms-sender](../sms-sender/) - Reference service architecture
