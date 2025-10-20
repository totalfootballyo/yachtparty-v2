# Prospects Table Design

## Overview
Prospects table serves as a staging area for potential users uploaded by innovators. When prospects join Yachtparty, they're automatically upgraded to users and intro opportunities are created.

## Schema

```sql
CREATE TABLE prospects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Contact Information
  email TEXT,
  phone_number TEXT,
  linkedin_url TEXT,
  first_name TEXT,
  last_name TEXT,
  company TEXT,
  title TEXT,

  -- Upload Metadata
  innovator_id UUID NOT NULL REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  upload_source TEXT, -- 'csv', 'manual', 'linkedin_scrape', etc.
  upload_batch_id UUID, -- Group prospects from same CSV upload

  -- Status Tracking
  status TEXT NOT NULL DEFAULT 'pending',
    -- 'pending': Uploaded, not contacted
    -- 'contacted': Intro attempt made
    -- 'converted': Joined Yachtparty (upgraded to user)
    -- 'declined': Not interested
    -- 'invalid': Bad data (bounced email, etc.)

  converted_to_user_id UUID REFERENCES users(id),
  converted_at TIMESTAMPTZ,

  -- Context & Notes
  prospect_notes TEXT, -- Why this prospect? What's the angle?
  target_solution_categories TEXT[], -- What solutions might interest them?

  -- Metadata
  metadata JSONB, -- Flexible field for additional data
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT at_least_one_contact_method CHECK (
    email IS NOT NULL OR
    phone_number IS NOT NULL OR
    linkedin_url IS NOT NULL
  )
);

-- Indexes for lookups
CREATE INDEX idx_prospects_email ON prospects(email) WHERE email IS NOT NULL;
CREATE INDEX idx_prospects_phone ON prospects(phone_number) WHERE phone_number IS NOT NULL;
CREATE INDEX idx_prospects_linkedin ON prospects(linkedin_url) WHERE linkedin_url IS NOT NULL;
CREATE INDEX idx_prospects_innovator_id ON prospects(innovator_id);
CREATE INDEX idx_prospects_status ON prospects(status);
CREATE INDEX idx_prospects_upload_batch ON prospects(upload_batch_id) WHERE upload_batch_id IS NOT NULL;

-- Updated timestamp trigger
CREATE TRIGGER update_prospects_updated_at
  BEFORE UPDATE ON prospects
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

## Prospect Upload Flow

### 1. Innovator Uploads CSV
```typescript
// Innovator sends message: "I want to upload prospects"
// Innovator agent responds with instructions + generates upload link

// CSV format:
// email,phone,first_name,last_name,company,title,linkedin_url,notes
// john@example.com,,John,Doe,Acme Corp,CTO,https://linkedin.com/in/johndoe,Needs data platform
```

### 2. Processing Upload
```typescript
// Upload handler (new service or function):
// 1. Parse CSV
// 2. Validate each row (at least one contact method)
// 3. Check for duplicates within innovator's prospects
// 4. Insert into prospects table with upload_batch_id
// 5. Return summary: "Uploaded 47 prospects (3 duplicates skipped)"
```

### 3. Prospect-to-User Upgrade Flow

**Trigger Points:**
- New user signs up via phone number (Bouncer onboarding)
- User verifies email
- User connects LinkedIn

**Upgrade Logic:**
```typescript
async function checkAndUpgradeProspect(
  newUser: User,
  contactInfo: {
    email?: string;
    phone?: string;
    linkedinUrl?: string;
  }
): Promise<void> {
  const supabase = createServiceClient();

  // Search for matching prospect
  const { data: prospects } = await supabase
    .from('prospects')
    .select('*')
    .or(`email.eq.${contactInfo.email},phone_number.eq.${contactInfo.phone},linkedin_url.eq.${contactInfo.linkedinUrl}`)
    .eq('status', 'pending')
    .order('uploaded_at', { ascending: true }); // Oldest first

  if (!prospects || prospects.length === 0) {
    return; // No match, regular user
  }

  // Take the first (oldest) matching prospect
  const prospect = prospects[0];

  // 1. Mark prospect as converted
  await supabase
    .from('prospects')
    .update({
      status: 'converted',
      converted_to_user_id: newUser.id,
      converted_at: new Date().toISOString(),
    })
    .eq('id', prospect.id);

  // 2. Create intro opportunity
  await supabase
    .from('intro_opportunities')
    .insert({
      innovator_id: prospect.innovator_id,
      prospect_user_id: newUser.id,
      status: 'pending',
      source: 'prospect_upload',
      context: {
        original_prospect_id: prospect.id,
        upload_notes: prospect.prospect_notes,
        target_categories: prospect.target_solution_categories,
      },
    });

  // 3. Credit the innovator (optional - based on business rules)
  await supabase
    .from('credit_events')
    .insert({
      user_id: prospect.innovator_id,
      event_type: 'prospect_converted',
      credits_change: 10, // Reward for successful prospect
      reference_type: 'prospect',
      reference_id: prospect.id,
      idempotency_key: `prospect_converted_${prospect.id}`,
      description: `Prospect ${prospect.first_name} ${prospect.last_name} joined Yachtparty`,
    });

  // 4. Create task for Intro Agent to generate talking points
  await supabase
    .from('agent_tasks')
    .insert({
      agent_type: 'intro',
      task_type: 'generate_intro_talking_points',
      status: 'pending',
      scheduled_for: new Date().toISOString(),
      context_json: {
        intro_opportunity_id: /* get from insert above */,
        prospect_context: prospect.prospect_notes,
      },
    });
}
```

### 4. Integration Points

**Bouncer Agent** (`packages/agents/bouncer/src/index.ts`):
```typescript
// After user verification completes
async function completeVerification(user: User) {
  // ... existing verification logic ...

  // Check for prospect match
  await checkAndUpgradeProspect(user, {
    phone: user.phone_number,
    email: user.email,
  });
}
```

**User Profile Updates**:
```typescript
// When user adds email or LinkedIn
async function onUserProfileUpdate(user: User, updates: Partial<User>) {
  if (updates.email || updates.linkedin_url) {
    await checkAndUpgradeProspect(user, {
      email: updates.email,
      linkedinUrl: updates.linkedin_url,
    });
  }
}
```

## Deduplication Strategy

**Within same innovator:**
- Prevent duplicate prospects by same innovator
- Check email, phone, linkedin before insert

**Across innovators:**
- Allow multiple innovators to upload same prospect
- When prospect converts, create intro opportunities for ALL innovators who uploaded them
- First uploader gets primary credit, others get partial credit

```sql
-- Find all innovators who uploaded a prospect
SELECT DISTINCT innovator_id
FROM prospects
WHERE (
  email = 'john@example.com' OR
  phone_number = '+15551234567' OR
  linkedin_url = 'https://linkedin.com/in/johndoe'
)
AND status = 'pending';
```

## Analytics & Reporting

Track for each innovator:
- Total prospects uploaded
- Conversion rate (converted / total)
- Average time to conversion
- Top converting sources (CSV, LinkedIn scrape, manual)
- Credit earned from conversions

This data powers the `intro_progress` reporting in Innovator agent.
