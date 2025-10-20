# Message Orchestrator Service

Cloud Run service that handles message rate limiting, scheduling, and delivery optimization for Yachtparty.

## Features

- **Rate Limiting**: Max 1 message per 30 seconds per user
- **Quiet Hours**: No messages 10pm-8am user local time
- **Message Scheduling**: Queue messages for optimal delivery
- **Batch Delivery**: Process messages every 30 seconds
- **Priority Management**: urgent/high/medium/low priority lanes

## Architecture

### Message Flow

**New Flow with Message Orchestrator:**
```
Agent creates message → POST /schedule-message
  → message_queue table (status='queued')
  → Queue processor (every 30 seconds)
  → Rate limiting check
  → Quiet hours check
  → messages table (status='pending')
  → sms-sender → Twilio
```

**Old Flow (bypassed when orchestrator is active):**
```
Agent creates message → messages table (status='pending') → sms-sender → Twilio
```

## Endpoints

### POST /schedule-message
Queue a message for delivery with rate limiting and scheduling.

**Request Body:**
```json
{
  "userId": "user_123",
  "agentId": "concierge_agent_456",
  "messageData": {
    "content": "Your intro request has been matched!"
  },
  "priority": "high",
  "canDelay": true,
  "requiresFreshContext": false,
  "conversationId": "conv_789"
}
```

**Response:**
```json
{
  "success": true,
  "messageId": "msg_queue_123",
  "status": "queued"
}
```

### POST /process-queue
Manually trigger queue processing (normally called automatically every 30 seconds).

**Response:**
```json
{
  "success": true,
  "message": "Queue processed successfully",
  "lastProcessTime": "2025-10-15T12:00:00Z"
}
```

### GET /health
Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "service": "message-orchestrator",
  "timestamp": "2025-10-15T12:00:00Z",
  "stats": {
    "messagesQueued": 150,
    "messagesProcessed": 45,
    "lastProcessTime": "2025-10-15T11:59:30Z",
    "processorRunning": true
  }
}
```

## Environment Variables

Required:
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_KEY` - Supabase service role key
- `ANTHROPIC_API_KEY` - Anthropic API key (for message rendering)
- `TWILIO_ACCOUNT_SID` - Twilio account SID
- `TWILIO_AUTH_TOKEN` - Twilio auth token
- `TWILIO_PHONE_NUMBER` - Twilio phone number

Optional:
- `PORT` - Service port (default: 8080)
- `NODE_ENV` - Environment (default: production)

## Local Development

### Prerequisites
- Node.js 20+
- Access to Supabase database
- Twilio account
- Anthropic API key

### Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env
# Edit .env with your credentials
```

3. Build and run:
```bash
npm run build
npm start
```

Or run in development mode with auto-reload:
```bash
npm run dev
```

## Deployment

### Build Docker Image

From project root:
```bash
docker build -f packages/services/message-orchestrator/Dockerfile -t message-orchestrator .
```

### Deploy to Cloud Run

```bash
gcloud run deploy message-orchestrator \
  --source packages/services/message-orchestrator \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars SUPABASE_URL=$SUPABASE_URL,SUPABASE_SERVICE_KEY=$SUPABASE_SERVICE_KEY,ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY,TWILIO_ACCOUNT_SID=$TWILIO_ACCOUNT_SID,TWILIO_AUTH_TOKEN=$TWILIO_AUTH_TOKEN,TWILIO_PHONE_NUMBER=$TWILIO_PHONE_NUMBER \
  --min-instances 1 \
  --max-instances 10 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300
```

## Integration

### Agent Integration

Agents should call the orchestrator instead of writing directly to the messages table:

**Before (direct message):**
```typescript
await supabase.from('messages').insert({
  conversation_id: conversationId,
  content: 'Your message here',
  status: 'pending'
});
```

**After (with orchestrator):**
```typescript
await fetch(MESSAGE_ORCHESTRATOR_URL + '/schedule-message', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId,
    agentId: 'bouncer_agent',
    messageData: { content: 'Your message here' },
    priority: 'medium',
    canDelay: true,
    conversationId
  })
});
```

### Database Integration

The orchestrator polls the `message_queue` table every 30 seconds and processes messages that are due.

Alternatively, you can set up a database trigger to call the `/process-queue` endpoint when new messages are queued.

## Rate Limiting Rules

### Per-User Limits

Based on the requirements, the orchestrator enforces:

- **30-second cooldown**: Max 1 message per 30 seconds per user
- **Quiet hours**: No messages 10pm-8am in user's local timezone
- **Active user exception**: If user sent a message in the last 10 minutes, quiet hours don't apply

### Priority Lanes

- **urgent**: Immediate delivery (bypasses queue but respects rate limits)
- **high**: Next available slot (intro acceptances, high-value matches)
- **medium**: Optimal timing (default for most messages)
- **low**: Deferred if queue is busy

## Monitoring

### Logs

All operations are logged to stdout:
```
Processing message queue...
Message queued with ID msg_123, scheduled for 2025-10-15T12:00:00Z
Rate limit exceeded for user user_123: hourly_limit_reached
User user_456 in quiet hours, rescheduling
Successfully delivered message msg_789
```

### Metrics

Check the `/health` endpoint for service metrics:
- Messages queued
- Messages processed
- Last process time
- Processor status

### Database Tables

Monitor these tables:
- `message_queue` - Queued messages
- `user_message_budget` - Rate limiting counters
- `messages` - Final sent messages
- `agent_actions_log` - Orchestrator operations

## Troubleshooting

### Messages not being sent

1. Check `/health` endpoint - is processor running?
2. Check `message_queue` table - are messages stuck in 'queued' status?
3. Check logs for rate limit or quiet hours messages
4. Verify user timezone is set correctly in users table

### Rate limiting not working

1. Check `user_message_budget` table is being updated
2. Verify user's last message timestamp
3. Check for active user exception (last inbound message <10 min ago)

### Messages sent during quiet hours

1. Check if user sent a message in last 10 minutes (active exception)
2. Verify user's timezone is correct
3. Check if quiet hours are enabled for user

## Architecture Notes

This service uses:
- **Polling approach** (every 30 seconds) rather than database triggers for simplicity
- **Background processor** runs in same container as HTTP service
- **Graceful shutdown** to complete processing before stopping
- **Idempotent operations** to prevent duplicate sends
