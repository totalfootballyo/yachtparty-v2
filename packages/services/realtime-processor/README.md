# Real-Time Message Processor

Always-on Cloud Run service that maintains persistent WebSocket connections to Supabase Realtime and processes messages/events in real-time.

## Overview

This service is the heart of Yachtparty's real-time message processing system. It:

- **Maintains persistent WebSocket connections** to Supabase Realtime (not scale-to-zero)
- **Subscribes to database changes** via PostgreSQL LISTEN/NOTIFY
- **Routes inbound messages** to appropriate agents based on user state
- **Processes agent events** for background workflows
- **Provides health check endpoint** for Cloud Run monitoring

### Architecture

```
User sends SMS → Twilio → Webhook → Messages table INSERT
                                            ↓
                                    Database trigger
                                            ↓
                                PostgreSQL NOTIFY
                                            ↓
                        This service (WebSocket subscription)
                                            ↓
                        Route to agent based on user.poc_agent_type
                                            ↓
                        Bouncer / Concierge / Innovator Agent
                                            ↓
                        Immediate reply or publish events
```

**Target latency**: <3 seconds from SMS received to agent response sent

## Channels Subscribed

### 1. `user-messages` Channel
- **Table**: `messages`
- **Event**: `INSERT`
- **Filter**: `direction=eq.inbound`
- **Purpose**: Process inbound SMS messages from users in real-time

### 2. `agent-events` Channel
- **Table**: `events`
- **Event**: `INSERT`
- **Purpose**: Route events to appropriate agents for background processing

## Environment Variables

Required environment variables (set in `.env` or Cloud Run environment):

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Anthropic API (for agent LLM calls)
ANTHROPIC_API_KEY=your-anthropic-api-key

# Service Configuration
PORT=8080
NODE_ENV=production
LOG_LEVEL=info

# Optional: Error reporting
SENTRY_DSN=your-sentry-dsn
```

### Security Notes

- **Never commit `.env` files** to version control
- Use Cloud Run secrets manager for production credentials
- Service role key bypasses RLS - use with caution
- All environment variables are required for service to start

## Local Development

### Prerequisites

- Node.js 20+
- npm or yarn
- Supabase project with service role key
- Anthropic API key

### Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```bash
cp .env.example .env
# Edit .env with your credentials
```

3. Run in development mode:
```bash
npm run dev
```

The service will:
- Connect to Supabase Realtime
- Subscribe to message and event channels
- Start health check server on port 8080
- Hot-reload on code changes

### Testing WebSocket Connection

Check if service is connected:
```bash
curl http://localhost:8080/health
```

Expected response:
```json
{
  "status": "healthy",
  "service": "realtime-processor",
  "timestamp": "2025-10-15T12:00:00.000Z",
  "uptime": 3600,
  "subscriptions": {
    "user-messages": "connected",
    "agent-events": "connected"
  }
}
```

## Building

### TypeScript Build

Compile TypeScript to JavaScript:
```bash
npm run build
```

Output will be in `dist/` directory.

### Docker Build

Build Docker image:
```bash
npm run docker:build
```

Run locally with Docker:
```bash
npm run docker:run
```

Or manually:
```bash
docker build -t realtime-processor .
docker run -p 8080:8080 --env-file .env realtime-processor
```

## Deployment

### Google Cloud Run

Deploy to Cloud Run with always-on configuration:

```bash
gcloud run deploy realtime-processor \
  --source . \
  --platform managed \
  --region us-central1 \
  --min-instances 1 \
  --max-instances 10 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 3600 \
  --no-allow-unauthenticated \
  --set-env-vars "NODE_ENV=production" \
  --set-secrets "SUPABASE_URL=supabase-url:latest,SUPABASE_SERVICE_ROLE_KEY=supabase-service-key:latest,ANTHROPIC_API_KEY=anthropic-key:latest"
```

### Important Configuration

- **`--min-instances 1`**: Keep at least 1 instance always running (no cold starts)
- **`--timeout 3600`**: Long timeout for persistent WebSocket connections (1 hour)
- **`--memory 512Mi`**: Sufficient memory for WebSocket connections and agent processing
- **`--cpu 1`**: 1 vCPU for handling concurrent message processing
- **`--no-allow-unauthenticated`**: Only accessible to authenticated services

### Cost Considerations

- **Always-on pricing**: ~$36/month for 1 instance (0.5 GB RAM, 1 vCPU)
- Scales up automatically under load (up to 10 instances)
- Uses Supabase Realtime (included in Supabase plan)
- No per-request charges (long-running container)

## Health Checks

Cloud Run health checks hit `GET /health` endpoint:

```bash
curl https://realtime-processor-xxxxx.run.app/health
```

Health check includes:
- Service status
- WebSocket subscription states
- Uptime
- Last message processed timestamp

## Error Handling

### Retry Logic

- **Message processing errors**: Logged and continue (idempotent)
- **Agent invocation failures**: Logged with context for debugging
- **WebSocket disconnections**: Automatic reconnection with exponential backoff
- **Database errors**: Logged and retried (transient failures)

### Graceful Shutdown

On SIGTERM/SIGINT:
1. Stop accepting new messages
2. Wait for in-flight processing to complete (max 30s)
3. Close WebSocket connections gracefully
4. Shut down HTTP server
5. Exit process

```typescript
// Handled automatically by the service
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
```

## Monitoring

### Logs

All logs are structured JSON for Cloud Logging:

```json
{
  "timestamp": "2025-10-15T12:00:00.000Z",
  "level": "info",
  "service": "realtime-processor",
  "event": "message_processed",
  "userId": "user_123",
  "messageId": "msg_456",
  "duration": 1234,
  "agentType": "concierge"
}
```

### Metrics to Monitor

- **Message processing latency**: Target <2s
- **Error rate**: Alert if >2%
- **WebSocket connection status**: Alert on disconnect
- **Memory usage**: Alert if >80%
- **CPU usage**: Alert if >70% sustained

### Cloud Monitoring Alerts

Set up alerts in Google Cloud Monitoring:

1. **High error rate**: Error logs >2% of total
2. **Slow processing**: P95 latency >5 seconds
3. **Connection issues**: WebSocket disconnected
4. **Resource exhaustion**: Memory >80% or CPU >70%

## Architecture Notes

### Why Always-On?

This service cannot scale to zero because:
- **WebSocket connections** require persistent processes
- **Real-time subscriptions** need continuous listening
- **Message latency** requirements (<3s) rule out cold starts

### Event-Driven Design

- Agents communicate via events, never direct calls
- Complete audit trail of all processing
- Enables replay and debugging
- Supports saga pattern workflows

### Stateless Agents

- Agents load context fresh from database
- No in-memory state between invocations
- Prompt caching reduces LLM costs (~40%)
- Each invocation is independent and testable

## Troubleshooting

### WebSocket connection fails

Check:
- Supabase URL and service key are correct
- Network connectivity to Supabase
- Supabase Realtime is enabled for your project

### Messages not being processed

Check:
- Database triggers are active (`on_message_send`, `notify_event`)
- Subscription filters match table structure
- Agent routing logic is correct

### High memory usage

- Check for memory leaks in agent code
- Verify context is not growing unbounded
- Consider increasing memory allocation

### Agent errors

- Check agent logs for specific error details
- Verify Anthropic API key is valid
- Ensure @yachtparty/shared package is up to date

## Related Services

- **twilio-webhook**: HTTP endpoint for inbound SMS (scales from zero)
- **sms-sender**: Sends outbound SMS via Twilio (always-on)
- **scheduled-tasks**: pg_cron processor for background tasks (database-side)

## References

- [Requirements Document](../../../requirements.md) - Section 6.2
- [Architecture Guide](../../../claude.md) - Cloud Run Architecture
- [Supabase Realtime Docs](https://supabase.com/docs/guides/realtime)
- [Cloud Run Documentation](https://cloud.google.com/run/docs)
