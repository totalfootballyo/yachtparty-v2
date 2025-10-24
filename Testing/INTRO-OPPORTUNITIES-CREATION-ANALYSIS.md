# Intro Opportunities Creation Analysis

## Summary

**Your assumption was incorrect** - `intro_opportunities` are NOT primarily created by Concierge and Innovator agents during normal conversations.

## Where intro_opportunities Are Created

### ✅ **Primary Creation Point: Prospect Upgrade (Automated)**
**Location:** `packages/shared/src/utils/prospect-upgrade.ts:165-187`

**Trigger:** When a prospect joins as a user (during onboarding)
- Bouncer agent calls `upgradeProspectsToUser()` during onboarding
- System automatically finds all matching prospect records
- Creates intro_opportunity for each innovator who uploaded that prospect
- Awards 25 credits to innovator as conversion bonus

**Fields Set:**
```typescript
{
  connector_user_id: prospect.innovator_id,
  prospect_id: prospect.id,
  prospect_name: user name,
  prospect_company: user.company,
  prospect_title: user.title,
  prospect_linkedin_url: user.linkedin_url,
  status: 'open',
  bounty_credits: 50,
  // ❌ connection_strength: NOT SET
  metadata: { auto_created: true, match_score, ... }
}
```

### ✅ **Secondary Creation Point: Bouncer During Onboarding**
**Location:** `packages/agents/bouncer/src/onboarding-steps.ts:528-541`

**Trigger:** User nominates someone during onboarding
- Creates prospect record
- Creates intro_opportunity immediately
- No conversion needed (direct nomination)

**Fields Set:**
```typescript
{
  connector_user_id: userId,
  prospect_id: prospectId,
  prospect_name: nomination.name,
  prospect_company: nomination.company,
  bounty_credits: 50,
  status: 'open'
  // ❌ connection_strength: NOT SET
}
```

## What Concierge & Innovator Do

**They DO NOT create intro_opportunities.** They only:

### Concierge (`packages/agents/concierge/src/index.ts`)
- **Line 853:** Updates intro_opportunities (accept)
- **Line 876:** Updates intro_opportunities (decline)

### Innovator (`packages/agents/innovator/src/index.ts`)
- **Line 656:** Reads intro_opportunities (loads pending intros)
- **Line 907:** Updates intro_opportunities (accept)
- **Line 930:** Updates intro_opportunities (decline)

## Critical Finding: connection_strength Never Set

**Problem:** The `connection_strength` column is never populated in either creation point.

**Impact:**
- All intro_opportunities have `connection_strength = NULL` or `'unknown'` (after migration default)
- Account Manager prioritization code handles this gracefully (no bonus points, uses base score)
- No code needs to change - system works with 'unknown' values

## Recommendations

### ✅ No Code Changes Needed Now
1. Migration adds `connection_strength` column with default `'unknown'` ✅
2. Account Manager already handles missing/unknown values gracefully ✅
3. Both creation points (prospect-upgrade.ts and bouncer onboarding-steps.ts) don't set it ✅

### 🔮 Future: When LinkedIn Integration Happens
Update these two locations to set `connection_strength`:

**1. `packages/shared/src/utils/prospect-upgrade.ts:167`**
```typescript
.insert({
  // ... existing fields ...
  connection_strength: calculateConnectionStrength(user, prospect), // ADD THIS
})
```

**2. `packages/agents/bouncer/src/onboarding-steps.ts:530`**
```typescript
.insert({
  // ... existing fields ...
  connection_strength: 'unknown', // Or fetch from LinkedIn API
})
```

## Testing Impact

Since neither Concierge nor Innovator create intro_opportunities:
- E2E tests for Concierge/Innovator won't test intro_opportunity **creation**
- E2E tests should focus on intro_opportunity **acceptance/decline** flows
- Account Manager unit tests correctly test the **prioritization** logic
- No additional test changes needed for connection_strength handling
