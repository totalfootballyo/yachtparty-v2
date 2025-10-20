# Twilio Webhook Handler

Cloud Run service that handles inbound SMS messages from Twilio for the Yachtparty platform.

## Overview

This service receives webhook calls from Twilio when users send SMS messages. It processes inbound messages by:

1. Finding or creating the user and conversation records
2. Recording the inbound message in the database
3. Publishing a `user.message.received` event for agent processing
4. Validating Twilio webhook signatures for security

This service is a critical entry point for all user interactions via SMS and is designed for high reliability and low latency.

## Architecture

- **Runtime**: Node.js 20 on Google Cloud Run
- **Framework**: Express.js HTTP server
- **Database**: Supabase (PostgreSQL)
- **Event System**: PostgreSQL events table with NOTIFY trigger
- **Security**: Twilio webhook signature validation

## Environment Variables

The following environment variables must be configured:

### Required

- `PORT` - Port to listen on (default: 8080)
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_KEY` - Supabase service role key (bypasses RLS)
- `TWILIO_AUTH_TOKEN` - Twilio auth token for webhook signature validation

### Optional

- `NODE_ENV` - Environment (development/production, default: production)
- `LOG_LEVEL` - Logging level (debug/info/warn/error, default: info)

## API Endpoints

### POST /sms

Receives inbound SMS messages from Twilio.

**Request Body** (application/x-www-form-urlencoded):
- `From` - User's phone number (E.164 format, e.g., +15551234567)
- `Body` - Message content
- `MessageSid` - Twilio message SID for tracking

**Response**:
- `200 OK` - Message processed successfully
- `400 Bad Request` - Invalid request format
- `403 Forbidden` - Invalid Twilio signature
- `500 Internal Server Error` - Processing error

### GET /health

Health check endpoint for Cloud Run monitoring.

**Response**:
```json
{
  "status": "healthy",
  "timestamp": "2025-10-15T12:34:56.789Z",
  "service": "twilio-webhook",
  "version": "1.0.0"
}
```

## Event Flow

```
SMS arrives → Twilio → POST /sms
  ↓
Find/create user by phone number
  ↓
Find/create active conversation
  ↓
Record inbound message in messages table
  ↓
Update conversation timestamps
  ↓
Publish 'user.message.received' event
  ↓
Database trigger → PostgreSQL NOTIFY
  ↓
Real-time processor picks up event → Agent processing
```

## Local Development

### Prerequisites

- Node.js 20+
- pnpm
- Access to Supabase instance
- Twilio account with webhook configured

### Setup

1. Install dependencies:
```bash
pnpm install
```

2. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your values
```

3. Start development server:
```bash
pnpm dev
```

The service will start on http://localhost:8080

### Testing with Twilio

Use ngrok or similar tool to expose your local server:

```bash
ngrok http 8080
```

Configure your Twilio phone number webhook URL:
```
https://your-ngrok-url.ngrok.io/sms
```

## Building

Build the TypeScript code:

```bash
pnpm build
```

Output will be in `dist/` directory.

## Deployment

### Build Docker Image

```bash
docker build -t gcr.io/your-project/twilio-webhook:latest .
```

### Push to Google Container Registry

```bash
docker push gcr.io/your-project/twilio-webhook:latest
```

### Deploy to Cloud Run

```bash
gcloud run deploy twilio-webhook \
  --image gcr.io/your-project/twilio-webhook:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080 \
  --min-instances 1 \
  --max-instances 10 \
  --memory 512Mi \
  --cpu 1 \
  --set-env-vars "NODE_ENV=production" \
  --set-secrets "SUPABASE_URL=supabase-url:latest,SUPABASE_SERVICE_KEY=supabase-service-key:latest,TWILIO_AUTH_TOKEN=twilio-auth-token:latest"
```

### Configure Twilio Webhook

After deployment, configure your Twilio phone number webhook:

1. Go to Twilio Console → Phone Numbers → Active Numbers
2. Select your phone number
3. Under "Messaging", set:
   - **A MESSAGE COMES IN**: Webhook
   - **URL**: `https://your-cloud-run-url.run.app/sms`
   - **HTTP Method**: POST

## Monitoring

### Cloud Run Metrics

Monitor these key metrics in Google Cloud Console:

- Request count and latency (p50, p95, p99)
- Error rate (target: <1%)
- Instance count
- CPU and memory utilization

### Logs

View logs using Cloud Logging:

```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=twilio-webhook" \
  --limit 50 \
  --format json
```

### Alerts

Set up alerts for:
- Error rate >2% for 5 minutes
- p95 latency >2 seconds for 5 minutes
- No requests received for 30 minutes (service down)

## Security

### Webhook Signature Validation

All incoming requests to `/sms` are validated using Twilio's signature verification. This ensures requests are genuinely from Twilio and not spoofed.

If signature validation fails, the request is rejected with `403 Forbidden`.

### Authentication

- Service uses Supabase service role key to bypass Row Level Security (RLS)
- All secrets stored in Google Secret Manager
- Non-root user in Docker container
- No sensitive data logged

## Error Handling

The service implements comprehensive error handling:

1. **Invalid request format**: Returns 400 with error details
2. **Invalid Twilio signature**: Returns 403 (prevents replay attacks)
3. **Database errors**: Logged and returns 500
4. **Event publishing errors**: Logged and returns 500

All errors are logged with correlation IDs for debugging.

## Performance

Target latency: <500ms from webhook receipt to event publication

Optimizations:
- Phone number denormalized in conversations table for fast lookup
- Single database transaction for user/conversation/message creation
- Efficient indexes on phone_number fields
- Connection pooling via Supabase pgBouncer

## Troubleshooting

### Messages not being received

1. Check Cloud Run logs for errors
2. Verify Twilio webhook URL is correct
3. Test webhook signature validation
4. Check Supabase connection

### High latency

1. Check database query performance
2. Monitor Cloud Run instance count
3. Review connection pool settings
4. Check for database locks

### Signature validation failures

1. Verify `TWILIO_AUTH_TOKEN` is correct
2. Check webhook URL matches exactly (http vs https)
3. Review Twilio webhook logs

## Related Services

- **Real-time Message Processor**: Subscribes to events and routes to agents
- **SMS Sender**: Sends outbound messages via Twilio
- **Bouncer Agent**: Handles onboarding for unverified users
- **Concierge Agent**: Handles messages for verified users

## References

- [Requirements Doc - Section 6.2](../../requirements.md#62-entry-points)
- [Twilio Webhook Security](https://www.twilio.com/docs/usage/webhooks/webhooks-security)
- [Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Supabase Realtime](https://supabase.com/docs/guides/realtime)
