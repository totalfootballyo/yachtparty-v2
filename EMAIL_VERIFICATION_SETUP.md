# Email Verification Setup Guide

**Purpose:** Complete guide for implementing email verification in Yachtparty Bouncer agent

**Status:** Implementation Complete - Requires Email Service Configuration

**Last Updated:** October 15, 2025

---

## Overview

The Bouncer agent requires users to verify their email address by sending an email to a unique verification address:

```
verify-{user_id}@verify.yachtparty.xyz
```

When an email is received at this address, it's forwarded to the `/verify-email` webhook endpoint, which:
1. Extracts the user_id from the recipient address
2. Marks the user as verified in the database
3. Transitions the user from Bouncer to Concierge agent
4. Sends a confirmation SMS

---

## Implementation Status

### ✅ What's Implemented

**Backend Endpoint:** `/verify-email` webhook endpoint
- Location: `/packages/services/twilio-webhook/src/index.ts` (lines 813-1013)
- Method: POST
- Accepts JSON or form-encoded email data
- Validates recipient format and domain
- Updates user record and sends confirmation SMS
- Logs verification events to `agent_actions_log`

**Error Handling:**
- Invalid email format (400)
- User not found (404)
- Already verified (200 with message)
- Database errors (500)

**Edge Cases Covered:**
- Multiple email webhook formats (Maileroo, AWS SES, generic)
- Array or string recipient formats
- Already verified users
- Missing conversations (no SMS sent)
- Logging for debugging

### ❌ What's Not Done

**Email Service Setup:**
- DNS configuration for `verify.yachtparty.xyz` domain
- Email forwarding service (Maileroo, AWS SES, or Cloudflare Email Routing)
- Webhook configuration pointing to Cloud Run endpoint

**Production Requirements:**
- SSL certificate for Cloud Run endpoint
- Email service authentication (if required)
- Rate limiting on webhook endpoint (optional but recommended)

---

## Email Service Options

### Option 1: Maileroo (Recommended - Simplest)

**Why Maileroo:**
- Built specifically for email forwarding webhooks
- Simple REST API
- Affordable ($5-20/month)
- No infrastructure management

**Setup Steps:**

1. **Sign up at [maileroo.com](https://maileroo.com)**

2. **Add Domain:**
   - Add `verify.yachtparty.xyz` as custom domain
   - Follow DNS setup instructions (MX records, SPF, DKIM)

3. **Configure Webhook:**
   ```
   Webhook URL: https://twilio-webhook-{your-cloud-run-url}.run.app/verify-email
   Method: POST
   Format: JSON
   ```

4. **Set up Catch-All Route:**
   - Create route matching: `verify-*@verify.yachtparty.xyz`
   - Action: Forward to webhook
   - Include fields: to, from, subject, text, html

**Expected Webhook Payload:**
```json
{
  "to": "verify-a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6@verify.yachtparty.xyz",
  "from": "user@company.com",
  "subject": "Email Verification",
  "text": "Verifying my email for Yachtparty",
  "html": "<p>Verifying my email for Yachtparty</p>",
  "headers": { ... }
}
```

**Testing:**
```bash
# Test webhook endpoint
curl -X POST https://your-cloud-run-url.run.app/verify-email \
  -H "Content-Type: application/json" \
  -d '{
    "to": "verify-{test-user-uuid}@verify.yachtparty.xyz",
    "from": "test@example.com",
    "subject": "Test Verification"
  }'
```

---

### Option 2: AWS SES (Enterprise - Most Flexible)

**Why AWS SES:**
- Part of AWS infrastructure
- Highly scalable
- Advanced features (filtering, analytics)
- Cost-effective at scale ($0.10 per 1000 emails)

**Setup Steps:**

1. **Verify Domain in SES:**
   ```bash
   aws ses verify-domain-identity --domain verify.yachtparty.xyz
   ```

2. **Configure DNS Records:**
   - Add TXT record for domain verification
   - Add MX record pointing to SES inbound endpoint
   - Region: us-east-1 recommended

3. **Create Receipt Rule Set:**
   ```bash
   aws ses create-receipt-rule-set --rule-set-name yachtparty-verification
   aws ses set-active-receipt-rule-set --rule-set-name yachtparty-verification
   ```

4. **Create Receipt Rule with SNS:**
   ```json
   {
     "Name": "forward-verification-emails",
     "Enabled": true,
     "Recipients": ["verify-*@verify.yachtparty.xyz"],
     "Actions": [
       {
         "SNSAction": {
           "TopicArn": "arn:aws:sns:us-east-1:{account}:email-verification"
         }
       }
     ]
   }
   ```

5. **Create SNS Topic and Subscription:**
   ```bash
   aws sns create-topic --name email-verification
   aws sns subscribe \
     --topic-arn arn:aws:sns:us-east-1:{account}:email-verification \
     --protocol https \
     --notification-endpoint https://your-cloud-run-url.run.app/verify-email
   ```

6. **Confirm SNS Subscription:**
   - SNS will POST to your endpoint with SubscribeURL
   - Visit the SubscribeURL to confirm

**Expected Webhook Payload:**
```json
{
  "Type": "Notification",
  "Message": "{\"notificationType\":\"Received\",\"mail\":{\"source\":\"user@company.com\",\"destination\":[\"verify-{uuid}@verify.yachtparty.xyz\"],\"messageId\":\"...\",\"timestamp\":\"...\"},\"content\":\"...\"}"
}
```

**Note:** You'll need to parse the nested JSON in the Message field.

---

### Option 3: Cloudflare Email Routing (Free - Best for Testing)

**Why Cloudflare:**
- Completely free
- Simple setup if domain already on Cloudflare
- Good for testing and low-volume production

**Setup Steps:**

1. **Add Domain to Cloudflare:**
   - Add `verify.yachtparty.xyz` or configure subdomain routing

2. **Enable Email Routing:**
   - Go to Cloudflare Dashboard > Email > Email Routing
   - Enable Email Routing

3. **Configure Custom Addresses:**
   - Unfortunately, Cloudflare doesn't support wildcard forwarding directly
   - Workaround: Use Cloudflare Workers to intercept emails

4. **Create Worker for Email Handling:**
   ```javascript
   addEventListener("email", event => {
     event.waitUntil(handleEmail(event.email));
   });

   async function handleEmail(email) {
     const to = email.to;
     const from = email.from;

     // Extract user_id from recipient
     const match = to.match(/verify-([a-f0-9-]+)@verify\.yachtparty\.xyz/);
     if (!match) return;

     // Forward to webhook
     await fetch("https://your-cloud-run-url.run.app/verify-email", {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({
         to: to,
         from: from,
         subject: email.headers.get("subject"),
         text: await email.text()
       })
     });
   }
   ```

5. **Set Email Worker Route:**
   - Route: `verify-*@verify.yachtparty.xyz`
   - Worker: email-verification-handler

**Note:** Cloudflare Email Routing is in beta and has limitations. Best for testing only.

---

## DNS Configuration

**Required DNS Records (for all options):**

```dns
# MX Record (for receiving email)
verify.yachtparty.xyz.  3600  IN  MX  10  inbound-smtp.{region}.amazonaws.com.  # AWS SES
# OR
verify.yachtparty.xyz.  3600  IN  MX  10  mx.maileroo.com.  # Maileroo

# SPF Record (email authentication)
verify.yachtparty.xyz.  3600  IN  TXT  "v=spf1 include:amazonses.com ~all"
# OR
verify.yachtparty.xyz.  3600  IN  TXT  "v=spf1 include:maileroo.com ~all"

# DKIM Record (email signing)
# Provided by email service after domain verification
maileroo._domainkey.verify.yachtparty.xyz.  3600  IN  TXT  "v=DKIM1; k=rsa; p={public-key}"
```

**Verification:**
```bash
# Check MX record
dig MX verify.yachtparty.xyz

# Check SPF record
dig TXT verify.yachtparty.xyz

# Check DKIM record
dig TXT maileroo._domainkey.verify.yachtparty.xyz
```

---

## Cloud Run Endpoint Configuration

**Update Cloud Run Service:**

The endpoint is already implemented, but you need to ensure it's accessible:

1. **Allow Unauthenticated Access for Webhook:**
   ```bash
   gcloud run services add-iam-policy-binding twilio-webhook \
     --region=us-central1 \
     --member="allUsers" \
     --role="roles/run.invoker"
   ```

2. **Or Use API Key Authentication:**
   If you want to secure the webhook, add an API key check:

   ```typescript
   // In /verify-email endpoint
   const apiKey = req.headers['x-api-key'] || req.query.api_key;
   if (apiKey !== process.env.EMAIL_WEBHOOK_API_KEY) {
     return res.status(403).json({ error: 'Forbidden' });
   }
   ```

   Add to .env:
   ```bash
   EMAIL_WEBHOOK_API_KEY=your-secure-random-key-here
   ```

3. **Get Cloud Run URL:**
   ```bash
   gcloud run services describe twilio-webhook \
     --region=us-central1 \
     --format="value(status.url)"
   ```

   Example output:
   ```
   https://twilio-webhook-abc123-uc.a.run.app
   ```

4. **Webhook URL to Configure in Email Service:**
   ```
   https://twilio-webhook-abc123-uc.a.run.app/verify-email
   ```

---

## Testing the Implementation

### 1. Manual Testing (Recommended First)

Test the endpoint directly with curl:

```bash
# Get a real user UUID from your database
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_KEY="your-service-key"

# Find a test user
curl -X GET "$SUPABASE_URL/rest/v1/users?limit=1" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY"

# Extract user_id from response (e.g., a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6)

# Test verification endpoint
CLOUD_RUN_URL="https://your-cloud-run-url.run.app"
USER_ID="a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6"

curl -X POST "$CLOUD_RUN_URL/verify-email" \
  -H "Content-Type: application/json" \
  -d "{
    \"to\": \"verify-$USER_ID@verify.yachtparty.xyz\",
    \"from\": \"test@example.com\",
    \"subject\": \"Test Verification\"
  }"

# Expected response:
# {
#   "success": true,
#   "message": "User verified successfully",
#   "userId": "a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6",
#   "verified": true,
#   "poc_agent_type": "concierge"
# }
```

### 2. Check User Record

```bash
# Verify user was updated
curl -X GET "$SUPABASE_URL/rest/v1/users?id=eq.$USER_ID" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY"

# Check fields:
# - verified: true
# - poc_agent_type: "concierge"
# - updated_at: recent timestamp
```

### 3. Check SMS Was Sent

```bash
# Check messages table for confirmation SMS
curl -X GET "$SUPABASE_URL/rest/v1/messages?user_id=eq.$USER_ID&direction=eq.outbound&order=created_at.desc&limit=1" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY"

# Expected:
# - role: "concierge"
# - content: "{FirstName}, you're verified. Welcome to Yachtparty. What can I help you with?"
# - status: "pending" or "sent"
```

### 4. End-to-End Testing

Once email service is configured:

1. **Create Test User via SMS:**
   - Send SMS to Twilio number: "hey"
   - Note the user_id from logs

2. **Send Verification Email:**
   - From your real email (e.g., Gmail)
   - To: `verify-{user_id}@verify.yachtparty.xyz`
   - Subject: "Verification"
   - Body: "Verifying my email"

3. **Check Cloud Run Logs:**
   ```bash
   gcloud run services logs read twilio-webhook \
     --region=us-central1 \
     --limit=50
   ```

   Look for:
   - "📧 Received email verification webhook"
   - "✅ Extracted user_id: ..."
   - "✅ User ... marked as verified"
   - "📱 Confirmation SMS queued"

4. **Verify SMS Received:**
   - Should receive SMS: "{Name}, you're verified. Welcome to Yachtparty. What can I help you with?"

5. **Test Agent Transition:**
   - Send another SMS to test user
   - Should get Concierge response (not Bouncer)

---

## Error Handling & Edge Cases

### Edge Case 1: User Already Verified

**Scenario:** User sends verification email twice

**Behavior:**
- Endpoint returns 200 OK
- Response: `{ "success": true, "message": "User already verified" }`
- No SMS sent
- No database update

**Logs:**
```
ℹ️  User {uuid} already verified
```

### Edge Case 2: Invalid User ID

**Scenario:** Email sent to non-existent user (e.g., `verify-invalid-uuid@verify.yachtparty.xyz`)

**Behavior:**
- Endpoint returns 404 Not Found
- Response: `{ "error": "Not Found", "message": "User not found" }`

**Logs:**
```
❌ User not found: invalid-uuid
```

### Edge Case 3: Invalid Email Format

**Scenario:** Email sent to wrong format (e.g., `hello@verify.yachtparty.xyz`)

**Behavior:**
- Endpoint returns 400 Bad Request
- Response: `{ "error": "Bad Request", "message": "Invalid verification email format" }`

**Logs:**
```
❌ Invalid verification email format: hello@verify.yachtparty.xyz
```

### Edge Case 4: No Active Conversation

**Scenario:** User deleted conversation or verification email sent weeks later

**Behavior:**
- User still marked as verified
- No SMS sent (no conversation to send to)
- Returns 200 OK

**Logs:**
```
✅ User {uuid} marked as verified, transitioned to Concierge
ℹ️  No active conversation found for user {uuid}, skipping confirmation SMS
```

### Edge Case 5: Email Service Sends Duplicate Webhooks

**Scenario:** Email service retries webhook due to network issues

**Behavior:**
- First request: User verified, SMS sent
- Subsequent requests: "User already verified" response
- Idempotent: No duplicate SMS

**Logs:**
```
# First request
✅ User {uuid} marked as verified
📱 Confirmation SMS queued

# Second request
ℹ️  User {uuid} already verified
```

---

## Monitoring & Debugging

### Key Metrics to Track

1. **Verification Success Rate:**
   ```sql
   SELECT
     COUNT(*) FILTER (WHERE verified = true) as verified_users,
     COUNT(*) FILTER (WHERE verified = false) as unverified_users,
     COUNT(*) FILTER (WHERE verified = true)::float / COUNT(*) as verification_rate
   FROM users
   WHERE created_at >= NOW() - INTERVAL '7 days';
   ```

2. **Time to Verification:**
   ```sql
   SELECT
     AVG(updated_at - created_at) as avg_verification_time,
     PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY updated_at - created_at) as median_verification_time
   FROM users
   WHERE verified = true
     AND created_at >= NOW() - INTERVAL '7 days';
   ```

3. **Verification Events Log:**
   ```sql
   SELECT
     user_id,
     input_data->>'from' as sender_email,
     input_data->>'to' as recipient_address,
     created_at
   FROM agent_actions_log
   WHERE action_type = 'email_verification_completed'
   ORDER BY created_at DESC
   LIMIT 20;
   ```

### Common Issues & Solutions

**Issue: Emails not arriving at webhook**

Check:
1. DNS records configured correctly (`dig MX verify.yachtparty.xyz`)
2. Email service webhook URL is correct
3. Cloud Run service is running (`gcloud run services list`)
4. Email service logs for delivery failures

**Issue: Webhook receives email but fails to verify**

Check:
1. Cloud Run logs for errors (`gcloud run services logs read`)
2. User exists in database
3. Recipient address matches format: `verify-{uuid}@verify.yachtparty.xyz`
4. Database connection working (check other endpoints)

**Issue: User verified but no SMS sent**

Check:
1. User has active conversation
2. SMS sender service is running
3. messages table for pending message
4. SMS sender logs for Twilio API errors

---

## Production Checklist

Before going live:

- [ ] DNS records configured and verified
- [ ] Email service account created and domain verified
- [ ] Webhook URL configured in email service
- [ ] Cloud Run endpoint tested manually (curl)
- [ ] End-to-end test completed (send real email)
- [ ] Error handling tested (invalid UUIDs, duplicate verifications)
- [ ] Monitoring queries set up in Supabase
- [ ] Alert configured for verification failures
- [ ] Documentation shared with team
- [ ] Backup plan if email service fails (manual verification process)

---

## Cost Estimates

**Maileroo:**
- Free tier: 1,000 emails/month
- Paid: $5/month for 10,000 emails
- Estimated cost: $5-10/month

**AWS SES:**
- $0.10 per 1,000 emails received
- SNS: $0.50 per 1 million requests
- Estimated cost: $1-5/month

**Cloudflare Email Routing:**
- Free (unlimited, but limited features)
- Estimated cost: $0/month

**Recommended: Start with Maileroo for simplicity, migrate to AWS SES if volume increases.**

---

## Support & Troubleshooting

**Email Service Support:**
- Maileroo: support@maileroo.com
- AWS SES: AWS Support Console
- Cloudflare: Cloudflare Support

**Yachtparty Implementation:**
- Code: `/packages/services/twilio-webhook/src/index.ts` lines 813-1013
- Logs: `gcloud run services logs read twilio-webhook`
- Database: Check `users`, `messages`, `agent_actions_log` tables

---

**Last Updated:** October 15, 2025
**Status:** Ready for Email Service Configuration
**Next Steps:** Choose email service provider and configure DNS/webhooks
