# Prospect Matching Strategy

## Problem Statement

When a user joins Yachtparty, we need to match them to prospects that innovators have uploaded. The challenge is that contact information may vary slightly:

**Example:**
- Innovator 1 uploads: `Jason Jones, VP Sales, jason.jones@thetradedesk.com`
- Innovator 2 uploads: `Jason Jones, SVP Revenue, jjones@thetradedesk.com`
- User joins with: `Jason Jones, CRO, jasonjones@thetradedesk.com`

We want to match all three records, but avoid false positives (e.g., a different Jason Jones at Trade Desk).

## Solution: Modular Scoring System

### Core Approach

1. **Score-based matching** - Each potential match gets a score (0-100+)
2. **Multiple signals** - Combine exact matches, fuzzy matches, and contextual data
3. **Configurable thresholds** - Easy to tune based on real-world performance
4. **Modular design** - Simple to upgrade matching algorithm over time

### Scoring System

| Match Type | Score | Confidence | Notes |
|-----------|-------|------------|-------|
| Exact email match | 100 | High | `jason.jones@thetradedesk.com` = `jason.jones@thetradedesk.com` |
| Exact phone match | 100 | High | `+15551234567` = `+15551234567` |
| Exact LinkedIn match | 100 | High | `linkedin.com/in/jasonjones` = `linkedin.com/in/jasonjones` |
| Fuzzy email match | 80 | Medium | `jason.jones@thetradedesk.com` ≈ `jasonjones@thetradedesk.com` |
| Name + email domain | 70 | Medium | Same name, both `@thetradedesk.com` |
| Name + company | 60 | Medium | Jason Jones at "Trade Desk" |
| Email domain + partial user | 40 | Low | `jjones@` vs `jasonjones@` (same domain, "j" prefix) |

### Normalization Rules

**Email:**
```
jason.jones@the-trade-desk.com
  ↓ remove dots, hyphens from user part
  ↓ remove hyphens from domain
jasonjones@thetradedesk.com
```

**Name:**
```
"Jason M. Jones"
  ↓ lowercase, remove middle initials, remove separators
"jasonjones"
```

**Company:**
```
"The Trade Desk, Inc."
  ↓ remove "the" prefix, remove "inc/llc/corp" suffix, remove separators
"tradedesk"
```

### Decision Thresholds

- **Score ≥ 100**: Auto-upgrade (exact match on at least one field)
- **Score 70-99**: Medium confidence (fuzzy email or name+domain)
- **Score 40-69**: Low confidence (partial match, needs manual review - future feature)
- **Score < 40**: No match

### Your Example: How It Works

**Prospect 1** (Innovator 1):
- Email: `jason.jones@thetradedesk.com`
- Name: Jason Jones
- Company: Trade Desk

**Prospect 2** (Innovator 2):
- Email: `jjones@thetradedesk.com`
- Name: Jason Jones
- Company: The Trade Desk

**User joins**:
- Email: `jasonjones@thetradedesk.com`
- Name: Jason Jones
- Company: The Trade Desk

**Matching results:**

1. **Prospect 1 → User**:
   - Fuzzy email match: `jason.jones@` ≈ `jasonjones@` (normalize to same)
   - Score: 80 (medium confidence)
   - ✅ Match

2. **Prospect 2 → User**:
   - Same name: ✅
   - Same email domain: ✅ (`@thetradedesk.com`)
   - Score: 70 (name + email domain)
   - ✅ Match

**Both prospects are upgraded**, creating intro opportunities for both innovators.

### False Positive Prevention

**Different Jason Jones at Trade Desk**:
- Prospect: `jason.jones@thetradedesk.com` (Sales)
- User: `jason.t.jones@thetradedesk.com` (Engineering)

Without additional signals (different email user parts), score would be low (<70), preventing false match.

**Different Jason Jones at different company**:
- Prospect: `jason.jones@thetradedesk.com`
- User: `jason.jones@competitor.com`

Different email domains → score < 70 → no match.

## Implementation

### Location
`packages/shared/src/utils/prospect-matching.ts`

### Key Functions

```typescript
// Calculate match score for a single prospect-user pair
calculateProspectMatchScore(prospect, user): ProspectMatchScore

// Find all matching prospects for a user
findMatchingProspects(prospects[], user, options): ProspectMatchScore[]

// Determine if match should auto-upgrade (score >= 100)
shouldAutoUpgrade(match): boolean
```

### Usage Example

```typescript
import { findMatchingProspects, shouldAutoUpgrade } from '@yachtparty/shared';

async function checkAndUpgradeProspect(newUser: User) {
  const supabase = createServiceClient();

  // Get all pending prospects
  const { data: prospects } = await supabase
    .from('prospects')
    .select('*')
    .eq('status', 'pending');

  // Find matches (score >= 70)
  const matches = findMatchingProspects(prospects, newUser, {
    minScore: 70,
  });

  for (const match of matches) {
    console.log(`Match found: Prospect ${match.prospectId}, Score: ${match.score}`);
    console.log(`Reasoning: ${match.reasoning.join(', ')}`);

    if (shouldAutoUpgrade(match)) {
      // Auto-upgrade exact matches
      await upgradeProspect(match.prospectId, newUser.id);
    } else {
      // Log medium-confidence matches for monitoring
      // (Future: add to manual review queue)
      await logPotentialMatch(match);
    }
  }
}
```

## Future Enhancements

### Phase 2: Better Fuzzy Matching
- Levenshtein distance for typo tolerance
- Soundex/Metaphone for phonetic matching
- ML-based similarity scoring

### Phase 3: Manual Review Workflow
- Queue for matches with score 70-99
- Admin interface to approve/reject
- Learn from decisions to improve algorithm

### Phase 4: Multi-Signal Context
- Job change detection (LinkedIn integration)
- Email forwarding patterns (same person, multiple emails)
- Temporal signals (recent activity correlation)

## Monitoring & Tuning

### Metrics to Track

1. **Match rate**: % of users that match at least one prospect
2. **Multi-match rate**: % of users matching multiple prospects
3. **Score distribution**: Histogram of match scores
4. **False positive rate**: Manual review of auto-upgraded matches
5. **False negative rate**: Missed matches reported by innovators

### Log Format

Every match is logged to `agent_actions_log`:

```json
{
  "agent_type": "bouncer",
  "action_type": "prospect_match_found",
  "user_id": "user-uuid",
  "output_data": {
    "prospect_id": "prospect-uuid",
    "innovator_id": "innovator-uuid",
    "match_score": 80,
    "confidence": "medium",
    "matched_fields": ["email_fuzzy"],
    "reasoning": ["Fuzzy email match (jason.jones@ ≈ jasonjones@)"],
    "auto_upgraded": true
  }
}
```

### Tuning Parameters

Located in `prospect-matching.ts`:

```typescript
export const MATCHING_CONFIG = {
  AUTO_UPGRADE_THRESHOLD: 100,  // Adjust if too conservative
  MIN_MATCH_THRESHOLD: 70,      // Adjust if too many/few matches
  MANUAL_REVIEW_THRESHOLD: 70,  // For future review queue
};
```

## Testing

Comprehensive test suite in `prospect-matching.test.ts` covers:
- Exact matches (email, phone, LinkedIn)
- Fuzzy email variants
- Your Trade Desk example (all 3 scenarios)
- False positive prevention
- Normalization edge cases
- Score sorting and thresholds

Run tests:
```bash
cd packages/shared
npm test prospect-matching
```
