# Yachtparty Deployment Guide

## Overview

This guide walks you through deploying Yachtparty to Google Cloud Run.

**Services to Deploy:**
1. **twilio-webhook** - Receives inbound SMS from Twilio
2. **sms-sender** - Sends outbound SMS via Twilio
3. **realtime-processor** - Processes events and invokes agents

---

## Prerequisites

### 1. Google Cloud Setup

✅ **Already configured:**
- gcloud CLI installed
- Authenticated as: `ben@tinymammoth.xyz`
- Project: `yachtparty-474117`
- Region: `us-central1`

### 2. Docker

⚠️ **Required:** Start Docker Desktop before deploying

Check status:
```bash
docker info
```

### 3. Twilio Account

You need:
- Twilio Account SID (starts with "AC...")
- Twilio Auth Token (32-character secret)
- Twilio Phone Number (E.164 format, e.g., +15551234567)

Get these from: https://console.twilio.com/

### 4. Required Credentials

Have these ready:
- ✅ Supabase URL: `https://wdjmhpmwiunkltkodbqh.supabase.co`
- ✅ Supabase Service Key: (already have)
- ⚠️ Twilio Account SID
- ⚠️ Twilio Auth Token
- ⚠️ Twilio Phone Number
- ✅ Anthropic API Key: (already have)
- ✅ Database URL: (already have)

---

## Deployment Steps

### Step 1: Start Docker

Make sure Docker Desktop is running:

```bash
# Check Docker status
docker info

# If not running, start Docker Desktop app
open -a Docker
```

Wait for Docker to fully start (you'll see the whale icon in your menu bar).

### Step 2: Set Up Google Cloud Secrets

Run the secrets setup script:

```bash
cd "/Users/bt/Desktop/CODE/Yachtparty v.2"
./scripts/setup-secrets.sh
```

This will:
- Enable Secret Manager API
- Prompt you for each credential
- Create secrets in Google Secret Manager
- Handle both new secrets and updates

**What to enter:**
1. Supabase URL (press Enter for default)
2. Supabase Service Key (paste from .env file)
3. Twilio Account SID (from Twilio console)
4. Twilio Auth Token (from Twilio console)
5. Twilio Phone Number (must be E.164 format: +15551234567)
6. Anthropic API Key (paste from .env file)
7. Database URL (paste from .env file)

### Step 3: Build Shared Package

Before deploying services, build the shared package they all depend on:

```bash
cd "/Users/bt/Desktop/CODE/Yachtparty v.2/packages/shared"
npm install
npm run build
```

### Step 4: Deploy Services

**Dry run first (recommended):**
```bash
cd "/Users/bt/Desktop/CODE/Yachtparty v.2"
./scripts/deploy.sh --dry-run --skip-tests --skip-migrations
```

**Deploy all services:**
```bash
./scripts/deploy.sh --skip-tests --skip-migrations
```

**Deploy specific service:**
```bash
# Deploy only twilio-webhook
./scripts/deploy.sh --service twilio-webhook --skip-tests --skip-migrations

# Deploy only sms-sender
./scripts/deploy.sh --service sms-sender --skip-tests --skip-migrations

# Deploy only realtime-processor
./scripts/deploy.sh --service realtime-processor --skip-tests --skip-migrations
```

The script will:
1. ✅ Check prerequisites (gcloud, Docker)
2. 📦 Build Docker images for each service
3. ☁️ Push images to Google Container Registry
4. 🚀 Deploy to Cloud Run with correct configuration
5. ✅ Verify deployments with health checks
6. 📊 Print service URLs

### Step 5: Configure Twilio Webhook

After deployment, you'll get URLs like:
```
twilio-webhook: https://twilio-webhook-xxxxx-uc.a.run.app
sms-sender: https://sms-sender-xxxxx-uc.a.run.app
realtime-processor: https://realtime-processor-xxxxx-uc.a.run.app
```

**Configure Twilio:**
1. Go to https://console.twilio.com/
2. Navigate to Phone Numbers → Manage → Active Numbers
3. Click your phone number
4. Under "Messaging", set:
   - **A message comes in**: Webhook
   - **URL**: `https://twilio-webhook-xxxxx-uc.a.run.app/sms`
   - **HTTP Method**: POST
5. Save

### Step 6: Test End-to-End

Send an SMS to your Twilio number:
```
Hey!
```

Expected flow:
1. Twilio → Webhook Handler → Creates user & conversation → Publishes event
2. Realtime Processor → Invokes Bouncer Agent → Generates response → Queues message
3. Orchestrator → Updates message status → Triggers database event
4. SMS Sender → Picks up message → Sends via Twilio

You should receive:
```
Hey! I'm the Bouncer. What's your name?
```

---

## Monitoring & Troubleshooting

### View Logs

```bash
# Twilio webhook logs
gcloud run services logs read twilio-webhook --region=us-central1 --limit=50

# SMS sender logs
gcloud run services logs read sms-sender --region=us-central1 --limit=50

# Realtime processor logs
gcloud run services logs read realtime-processor --region=us-central1 --limit=50
```

### Check Service Status

```bash
# List all services
gcloud run services list --region=us-central1

# Describe specific service
gcloud run services describe twilio-webhook --region=us-central1
```

### Health Checks

```bash
# Check twilio-webhook
curl https://twilio-webhook-xxxxx-uc.a.run.app/health

# Check sms-sender
curl https://sms-sender-xxxxx-uc.a.run.app/health

# Check realtime-processor
curl https://realtime-processor-xxxxx-uc.a.run.app/health
```

