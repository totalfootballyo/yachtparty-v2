# SMS Sender Service

Always-on Cloud Run service that maintains a persistent WebSocket connection to Supabase Realtime and sends SMS messages via Twilio.

## Architecture

This service implements the SMS delivery mechanism for Yachtparty's message orchestration system. It subscribes to database changes and sends messages when they're ready for delivery.

### How It Works

1. **WebSocket Subscription**: Maintains persistent connection to Supabase Realtime
2. **Event Listening**: Subscribes to `messages` table UPDATE events where `status='queued_for_send'`
3. **Conversation Lookup**: Gets conversation to retrieve recipient phone number
4. **Twilio Delivery**: Sends SMS via Twilio API
5. **Status Update**: Updates message record with `twilio_message_sid`, `status='sent'`, and `sent_at`

### Key Features

- **Always-On**: Long-running container maintains persistent WebSocket connection
- **Real-Time**: Sub-second latency from database trigger to SMS delivery
- **Reliable**: Retry logic with exponential backoff
- **Graceful Shutdown**: Proper signal handling for zero-downtime deployments
- **Health Checks**: HTTP endpoint on port 8080 for Cloud Run health monitoring

## Configuration

### Required Environment Variables

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJhbG...  # Service role key with full access

# Twilio Configuration
TWILIO_ACCOUNT_SID=ACxxxx...
TWILIO_AUTH_TOKEN=xxxx...
TWILIO_PHONE_NUMBER=+1234567890  # Your Twilio phone number (E.164 format)

# Service Configuration
PORT=8080  # Health check endpoint port (default: 8080)
NODE_ENV=production
```

### Environment Variables Explained

- **SUPABASE_SERVICE_KEY**: Must be service role key (not anon key) to bypass RLS policies
- **TWILIO_PHONE_NUMBER**: Must be in E.164 format (+country code + number)
- **PORT**: Used for health check endpoint only, not for WebSocket connection

## Development

### Prerequisites

- Node.js 20+
- npm or pnpm
- Supabase project with required database schema
- Twilio account with A2P 10DLC configuration

### Local Development

```bash
# Install dependencies
npm install

# Create .env file with required variables
cp .env.example .env

# Run in development mode (with hot reload)
npm run dev

# Type checking
npm run type-check

# Build
npm run build

# Run production build locally
npm start
```

### Docker Development

```bash
# Build Docker image
npm run docker:build

# Run container locally
npm run docker:run
```

## Deployment

### Deploy to Google Cloud Run

```bash
# Build and push to Google Container Registry
gcloud builds submit --tag gcr.io/PROJECT_ID/sms-sender

# Deploy to Cloud Run
gcloud run deploy sms-sender \
  --image gcr.io/PROJECT_ID/sms-sender \
  --platform managed \
  --region us-central1 \
  --min-instances 1 \
  --max-instances 10 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 3600 \
  --set-env-vars SUPABASE_URL=https://...,TWILIO_PHONE_NUMBER=+1... \
  --set-secrets SUPABASE_SERVICE_KEY=supabase-service-key:latest,TWILIO_ACCOUNT_SID=twilio-sid:latest,TWILIO_AUTH_TOKEN=twilio-auth:latest \
  --allow-unauthenticated
```

### Important Deployment Settings

- **min-instances: 1**: Must be always-on to maintain WebSocket connection
- **timeout: 3600**: Long timeout for persistent connections
- **memory: 512Mi**: Sufficient for WebSocket connection and Twilio API calls
- **allow-unauthenticated**: Health check endpoint needs to be accessible

## Database Schema Requirements

This service expects the following database structure:

### `messages` Table

```sql
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) NOT NULL,
  user_id UUID REFERENCES users(id) NOT NULL,
  role VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,
  direction VARCHAR(20) NOT NULL,
  twilio_message_sid VARCHAR(100),
  status VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT now(),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ
);
```

### `conversations` Table

```sql
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  phone_number VARCHAR(20) NOT NULL,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Database Trigger

The service relies on a database trigger to mark messages as ready for sending:

```sql
CREATE OR REPLACE FUNCTION notify_send_sms()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.direction = 'outbound' AND NEW.status = 'pending' THEN
    UPDATE messages
    SET status = 'queued_for_send'
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_message_send
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION notify_send_sms();
```

## Monitoring

### Health Check Endpoint

```bash
GET http://your-service.run.app/health

Response: 200 OK
{
  "status": "healthy",
  "service": "sms-sender",
  "timestamp": "2025-10-15T10:30:00Z",
  "websocket": "connected"
}
```

### Logs

Service logs include:

- WebSocket connection status
- Message sending events
- Twilio API responses
- Error conditions and retries

### Key Metrics to Monitor

- **WebSocket Connection**: Should remain connected continuously
- **Message Latency**: Time from `queued_for_send` to `sent` status
- **Twilio Errors**: Failed SMS deliveries
- **Retry Count**: Number of retries per message

## Error Handling

### Retry Logic

- **Max Retries**: 3 attempts per message
- **Backoff**: Exponential (1s, 2s, 4s)
- **Failure State**: Messages marked as `status='failed'` after max retries
- **Error Logging**: All errors logged with context for debugging

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| Invalid phone number | Phone not in E.164 format | Check `conversations.phone_number` format |
| Twilio authentication failed | Wrong credentials | Verify `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` |
| WebSocket disconnected | Network issues | Service auto-reconnects with backoff |
| Message not found | Race condition | Normal, message already processed |

## Security

- **Service Role Key**: Keep `SUPABASE_SERVICE_KEY` secret, never commit to git
- **Twilio Credentials**: Store in Cloud Secret Manager, not environment variables
- **Non-root User**: Container runs as non-root user (nodejs:1001)
- **No Direct Access**: Service only accessible via health check endpoint

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Database Trigger                         │
│  INSERT into messages (direction='outbound', status='pending')│
│                            ↓                                 │
│            UPDATE status='queued_for_send'                   │
└─────────────────────────────────────────────────────────────┘
                            ↓
                 ┌──────────────────────┐
                 │ Supabase Realtime    │
                 │  (PostgreSQL NOTIFY) │
                 └──────────────────────┘
                            ↓
              ┌──────────────────────────┐
              │   SMS Sender Service     │
              │  (WebSocket Subscriber)  │
              ├──────────────────────────┤
              │ 1. Receive UPDATE event  │
              │ 2. Get conversation      │
              │ 3. Send via Twilio       │
              │ 4. Update message status │
              └──────────────────────────┘
                            ↓
                  ┌──────────────┐
                  │  Twilio API  │
                  │  (SMS Send)  │
                  └──────────────┘
                            ↓
                    📱 User receives SMS
```

## Related Services

- **Twilio Webhook**: Receives inbound SMS and creates message records
- **Real-Time Message Processor**: Processes inbound messages and triggers agent responses
- **Message Queue Processor**: Manages outbound message scheduling and rate limiting

## Support

For issues or questions:
- Check service logs in Cloud Run console
- Verify database trigger is functioning
- Test Twilio credentials with Twilio console
- Review Supabase Realtime connection status

## License

UNLICENSED - Private Yachtparty service
