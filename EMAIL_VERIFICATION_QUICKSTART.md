# Email Verification - Quick Start Guide

**5-Minute Setup Guide for Email Verification**

---

## What Was Implemented

✅ **Backend endpoint ready:** POST `/verify-email` webhook
✅ **Error handling:** Validates format, user existence, duplicate verifications
✅ **SMS confirmation:** Automatically sends welcome message
✅ **Agent transition:** Moves user from Bouncer → Concierge
✅ **Logging:** All verifications logged to `agent_actions_log`

---

## What You Need to Do

### Step 1: Choose Email Service (Pick One)

**Option A: Maileroo (Easiest)**
1. Sign up: https://maileroo.com
2. Add domain: `verify.yachtparty.xyz`
3. Set webhook: `https://your-cloud-run-url.run.app/verify-email`
4. Cost: $5/month

**Option B: AWS SES (Most Powerful)**
1. Verify domain in SES console
2. Create receipt rule for `verify-*@verify.yachtparty.xyz`
3. Create SNS topic → subscribe to webhook URL
4. Cost: ~$1/month

**Option C: Cloudflare Email Routing (Free Testing)**
1. Add domain to Cloudflare
2. Create Worker to forward emails to webhook
3. Cost: Free (limited features)

---

### Step 2: Configure DNS

Add these records to your DNS provider:

```dns
# MX Record (adjust for your email service)
verify.yachtparty.xyz.  MX  10  mx.maileroo.com.

# SPF Record
verify.yachtparty.xyz.  TXT  "v=spf1 include:maileroo.com ~all"

# DKIM Record (get from email service)
maileroo._domainkey.verify.yachtparty.xyz.  TXT  "v=DKIM1; ..."
```

---

### Step 3: Get Cloud Run URL

```bash
gcloud run services describe twilio-webhook \
  --region=us-central1 \
  --format="value(status.url)"
```

Output: `https://twilio-webhook-abc123-uc.a.run.app`

Webhook URL: `https://twilio-webhook-abc123-uc.a.run.app/verify-email`

---

### Step 4: Test It

```bash
# 1. Get a test user UUID from database
# 2. Test webhook endpoint
curl -X POST https://your-cloud-run-url.run.app/verify-email \
  -H "Content-Type: application/json" \
  -d '{
    "to": "verify-YOUR-USER-UUID@verify.yachtparty.xyz",
    "from": "test@example.com",
    "subject": "Test"
  }'

# Expected response:
# {"success":true,"message":"User verified successfully",...}
```

---

### Step 5: Verify End-to-End

1. Send SMS to Twilio: "hey"
2. Get verification email from Bouncer: `verify-{uuid}@verify.yachtparty.xyz`
3. Send email to that address
4. Should receive SMS: "You're verified. Welcome to Yachtparty."
5. Send another SMS → should get Concierge response

---

## Webhook Payload Formats Supported

The endpoint accepts multiple formats:

```javascript
// Format 1: Simple
{ "to": "verify-uuid@...", "from": "user@...", "subject": "..." }

// Format 2: Envelope
{ "envelope": { "to": "verify-uuid@...", "from": "..." }, ... }

// Format 3: Email object
{ "email": { "to": "verify-uuid@...", "from": "...", ... } }

// Format 4: AWS SES (via SNS)
{ "Type": "Notification", "Message": "{...}" }
```

---

## Environment Variables

Already set in `.env.example`:

```bash
ANTHROPIC_API_KEY=your-key
SUPABASE_URL=https://...
SUPABASE_SERVICE_KEY=...
EMAIL_VERIFICATION_DOMAIN=verify.yachtparty.xyz  # New
```

---

## How It Works

1. Bouncer tells user: "Email verify-{user_id}@verify.yachtparty.xyz"
2. User sends email from their address
3. Email service forwards to webhook: POST /verify-email
4. Webhook:
   - Extracts user_id from recipient
   - Updates database: `verified=true`, `poc_agent_type='concierge'`
   - Sends confirmation SMS
   - Logs event
5. Next SMS from user → routed to Concierge (not Bouncer)

---

## Monitoring

Check verification rate:

```sql
-- Recent verifications
SELECT
  COUNT(*) FILTER (WHERE verified = true) as verified,
  COUNT(*) FILTER (WHERE verified = false) as unverified
FROM users
WHERE created_at >= NOW() - INTERVAL '7 days';

-- Verification log
SELECT
  user_id,
  input_data->>'from' as email,
  created_at
FROM agent_actions_log
WHERE action_type = 'email_verification_completed'
ORDER BY created_at DESC
LIMIT 10;
```

---

## Troubleshooting

**Emails not arriving?**
- Check DNS: `dig MX verify.yachtparty.xyz`
- Check email service logs
- Verify webhook URL configured correctly

**Webhook failing?**
- Check Cloud Run logs: `gcloud run services logs read twilio-webhook`
- Test manually with curl (see Step 4)
- Verify user UUID exists in database

**No SMS sent?**
- Check user has active conversation
- Check `messages` table for pending message
- Verify sms-sender service is running

---

## Production Checklist

- [ ] Email service configured
- [ ] DNS records added
- [ ] Webhook tested with curl
- [ ] End-to-end test completed
- [ ] Monitoring queries bookmarked
- [ ] Team documentation shared

---

## Next Steps

1. **Today:** Configure email service + DNS
2. **Tomorrow:** Test with real emails
3. **This week:** Monitor verification rate
4. **Optional:** Add rate limiting to webhook (prevent abuse)

---

## Files Modified

- `/packages/services/twilio-webhook/src/index.ts` - Added `/verify-email` endpoint
- `/packages/services/twilio-webhook/.env.example` - Added email config variables
- `/EMAIL_VERIFICATION_SETUP.md` - Complete setup guide (this file)

---

**Time to implement:** ~30 minutes (mostly DNS propagation wait time)

**Estimated cost:** $0-5/month depending on email service

**Status:** Ready for email service configuration
