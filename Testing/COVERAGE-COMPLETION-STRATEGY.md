# Test Coverage Completion Strategy
**Date:** October 24, 2025
**Status:** Recommendation for Completing Remaining Coverage

---

## Current Coverage Status

### ✅ Complete (40% of planned tests)
- Bouncer: 5/5 tests (100%)
- Concierge: 2/5 tests (40%) - **CRITICAL Phase 3.5 & 3.6 covered**
- Innovator: 0/5 tests (0%)
- Account Manager: 0/2 tests (0%)

### ❌ Remaining Gaps (60% of planned tests)
- Concierge: 3 tests (Basic Messages, Intro Offers, Message Sequences)
- Innovator: 5 tests (all)
- Account Manager: 2 tests (unit tests)

**Current Confidence Level:** 75%
**Target Confidence Level:** 95%

---

## Option 1: Sequential Completion (Conservative)

**Approach:** Complete all tests as originally planned

### Timeline: 3-4 weeks

**Week 1: Remaining Concierge Tests**
- Test 1: Basic User Messages (3-4 hours)
- Test 2: Intro Offers (3-4 hours)
- Test 5: Message Sequences (2-3 hours)
- Run all Concierge tests, fix issues

**Week 2: Innovator Tests**
- Test 1: Basic User Messages (3-4 hours)
- Test 2: Intro Opportunities (3-4 hours)
- Test 3: Credit Management (2-3 hours)
- Test 4: Re-engagement (2 hours - mirror Concierge)
- Test 5: Priority Opportunities (2 hours - mirror Concierge)

**Week 3: Account Manager + Cleanup**
- Test 1: Intro Flow Prioritization (4-6 hours)
- Test 2: State Transitions (2-3 hours)
- Run all tests, address failures

**Pros:**
- Comprehensive coverage
- Validates all features thoroughly
- Catches edge cases

**Cons:**
- Time-intensive (60-80 hours total)
- May find issues that aren't production-blocking
- Delays other priorities

---

## Option 2: Smart Mirroring (Efficient) ⭐ RECOMMENDED

**Approach:** Leverage code reuse and focus on high-value tests

### Timeline: 1-2 weeks

**Priority 1: Innovator Critical Tests (4-6 hours)**
- Test 4: Re-engagement Throttling (2 hours)
  - **Copy** `concierge/reengagement-throttling.test.ts`
  - Change agent import to `invokeInnovatorAgent`
  - Adjust persona contexts (credits, prospects instead of community)
  - Run and validate

- Test 5: Priority Opportunities (2 hours)
  - **Copy** `concierge/priority-opportunities.test.ts`
  - Change agent import to `invokeInnovatorAgent`
  - Adjust personas and contexts
  - Run and validate

**Why:** Innovator shares the same throttling and anti-hallucination logic as Concierge. These tests validate Phase 3.5 & 3.6 work for both agents. High confidence gain for minimal effort.

**Priority 2: Account Manager Unit Tests (6-8 hours)**
- Test 1: Intro Flow Prioritization (4-6 hours)
  - NOT simulation tests - unit tests
  - Test `calculateUserPriorities()` directly
  - Test `loadIntroOpportunities()`, `loadConnectionRequests()`, `loadIntroOffers()`
  - Validate scoring algorithms (bounty, vouches, recency)
  - Mock database responses

- Test 2: State Transitions (2-3 hours)
  - Test `handleIntroOpportunityAccepted()` - verify competing opps paused
  - Test `handleIntroOpportunityCompleted()` - verify competing opps cancelled
  - Direct function calls, no simulation

**Why:** Account Manager is new code (Phase 3.4) with complex business logic. Unit tests catch scoring bugs before they surface. State transitions are critical for data integrity.

**Priority 3 (Optional): Concierge Smoke Tests (6-8 hours)**
- Test 1: Basic User Messages (3-4 hours)
  - 3 scenarios covering common user flows
  - Validates 2-LLM architecture works end-to-end
  - Catches regression in core functionality

- Test 2: Intro Offers (3-4 hours)
  - 3 scenarios covering intro offer flows
  - Validates tool usage correctness
  - Tests Phase 3.4 intro_offers feature

**Skip for Now:**
- Test 5: Message Sequences (lower priority - existing tests already exercise multi-message responses)
- Innovator Tests 1-3 (core functionality similar to Concierge, lower risk)

**Pros:**
- Fast (10-20 hours total)
- High confidence gain (85-90%)
- Validates all Phase 3.4-3.6 features
- Focuses on new/risky code

**Cons:**
- Incomplete coverage (but covers high-risk areas)
- May miss edge cases in basic flows

---

## Option 3: Production-Ready Minimum (Lean)

**Approach:** Only test what's necessary for safe production deployment

### Timeline: 1 week

**Critical Tests Only:**
1. ✅ Concierge Re-engagement Throttling (DONE)
2. ✅ Concierge Anti-Hallucination (DONE)
3. Innovator Re-engagement Throttling (2 hours - copy from Concierge)
4. Innovator Anti-Hallucination (2 hours - copy from Concierge)
5. Account Manager Intro Flow Prioritization (4 hours - unit test)
6. Account Manager State Transitions (2 hours - unit test)

**Total Time:** 10 hours

**Coverage Achieved:**
- All Phase 3.4-3.6 features tested
- All new code tested
- Throttling validated for both agents
- Anti-hallucination validated for both agents
- Intro flow business logic validated

**Skip:**
- Basic message flows (existing manual testing covers this)
- Intro offer flows (existing manual testing covers this)
- Credit management (existing manual testing covers this)

**Confidence Level:** 85% (up from 75%)

**Pros:**
- Minimal time investment
- Covers all new/risky code
- Enables safe production deployment
- Can add more tests later based on production issues

**Cons:**
- Relies on manual testing for basic flows
- Lower confidence than full coverage
- May miss edge cases

---

## Comparison Matrix

| Approach | Time | Confidence | Risk | When to Use |
|----------|------|------------|------|-------------|
| Sequential (Option 1) | 3-4 weeks | 95% | Low | When time is abundant, no prod pressure |
| Smart Mirroring (Option 2) | 1-2 weeks | 85-90% | Low-Medium | **Balanced approach - RECOMMENDED** |
| Production Minimum (Option 3) | 1 week | 85% | Medium | When prod deployment is urgent |

---

## My Recommendation: Smart Mirroring (Option 2)

### Why This Approach?

1. **High ROI**: 10-20 hours of work gets 85-90% confidence
2. **Validates Critical Features**: All Phase 3.4-3.6 features tested
3. **Code Reuse**: Leverage existing tests for Innovator
4. **Catches Business Logic Bugs**: Account Manager unit tests prevent scoring errors
5. **Balanced**: Not too much time, not too little coverage

### Implementation Order

**This Week (10 hours):**
1. Copy Concierge Test 3 → Innovator Test 4 (2 hours)
2. Copy Concierge Test 4 → Innovator Test 5 (2 hours)
3. Write Account Manager Test 1: Intro Flow Prioritization (4 hours)
4. Write Account Manager Test 2: State Transitions (2 hours)

**Result:** 85% confidence, all Phase 3 features validated

**Next Week (Optional - 6-8 hours):**
5. Write Concierge Test 1: Basic User Messages (3-4 hours)
6. Write Concierge Test 2: Intro Offers (3-4 hours)

**Result:** 90% confidence, core Concierge flows validated

**Later (Backlog):**
- Innovator Tests 1-3 (basic flows)
- Concierge Test 5 (message sequences)
- Multi-agent coordination tests

---

## Detailed Implementation Guide

### Step 1: Innovator Re-engagement Test (2 hours)

```bash
cd /Users/bt/Desktop/CODE/Yachtparty\ v.2/Testing

# Copy the test
cp scenarios/concierge/reengagement-throttling.test.ts \
   scenarios/innovator/reengagement-throttling.test.ts

# Edit the file
# 1. Change import: invokeConciergeAgent → invokeInnovatorAgent
# 2. Change agent type: 'concierge' → 'innovator'
# 3. Update personas (add credits context instead of community goals)
# 4. Run test
npm test scenarios/innovator/reengagement-throttling.test.ts
```

**Changes Needed:**
- Line 11: `import { invokeConciergeAgent }` → `import { invokeInnovatorAgent }`
- Line 48: `'concierge'` → `'innovator'`
- Personas: Add `credits: 50`, remove `goal: 'Find...'`

### Step 2: Innovator Anti-Hallucination Test (2 hours)

```bash
# Copy the test
cp scenarios/concierge/priority-opportunities.test.ts \
   scenarios/innovator/priority-opportunities.test.ts

# Edit similarly to Step 1
# Run test
npm test scenarios/innovator/priority-opportunities.test.ts
```

### Step 3: Account Manager Unit Test 1 (4 hours)

```typescript
// File: Testing/scenarios/account-manager/intro-flow-prioritization.test.ts

import { calculateUserPriorities } from '../../../packages/agents/account-manager/src/index';
import { createTestDbClient } from '../../../packages/testing/src/helpers/db-utils';
import {
  createIntroOpportunities,
  createConnectionRequests,
  createIntroOffers
} from '../../framework/TestDataSetup';

describe('Account Manager - Intro Flow Prioritization', () => {
  it('should score intro opportunities by bounty + connection strength + recency', async () => {
    // Setup: Create 5 intro_opportunities with different attributes
    // Act: Call calculateUserPriorities()
    // Assert: Verify user_priorities table has correct ranking
  });

  it('should score connection requests with vouching 60 points higher', async () => {
    // Setup: Create 2 connection_requests (one with 3 vouches)
    // Act: Call calculateUserPriorities()
    // Assert: Verify vouched request is prioritized
  });

  it('should prioritize connector role over introducee role', async () => {
    // Setup: Create intro_offers with user in both roles
    // Act: Call calculateUserPriorities()
    // Assert: Verify connector offer ranks higher
  });

  it('should combine and rank all priority types', async () => {
    // Setup: Create mix of goals, intro flows, requests
    // Act: Call calculateUserPriorities()
    // Assert: Verify top 10 priorities are correct
  });
});
```

### Step 4: Account Manager Unit Test 2 (2 hours)

```typescript
// File: Testing/scenarios/account-manager/state-transitions.test.ts

import {
  handleIntroOpportunityAccepted,
  handleIntroOpportunityCompleted
} from '../../../packages/agents/account-manager/src/intro-prioritization';
import { createTestDbClient } from '../../../packages/testing/src/helpers/db-utils';
import { createIntroOpportunities } from '../../framework/TestDataSetup';

describe('Account Manager - State Transitions', () => {
  it('should pause competing opportunities when one is accepted', async () => {
    // Setup: Create 3 intro_opportunities for same prospect
    // Act: Call handleIntroOpportunityAccepted(opportunityA.id)
    // Assert: Verify opportunities B and C have status='paused'
  });

  it('should cancel competing opportunities when one is completed', async () => {
    // Setup: Create 3 opportunities (1 accepted, 2 paused)
    // Act: Call handleIntroOpportunityCompleted(acceptedId)
    // Assert: Verify paused opportunities have status='cancelled'
  });
});
```

---

## Expected Outcomes

### After Week 1 (10 hours)
- ✅ Innovator Phase 3.5 & 3.6 validated
- ✅ Account Manager Phase 3.4 validated
- ✅ All new code from Phases 3.4-3.6 tested
- **Confidence Level: 85%**
- **Safe to deploy to production**

### After Week 2 (Optional, +8 hours)
- ✅ Concierge core flows validated
- ✅ Intro offer functionality tested
- **Confidence Level: 90%**
- **Very safe for production, edge cases covered**

### Future Backlog
- Innovator basic flows
- Message sequence parsing
- Multi-agent coordination
- Performance/load testing

---

## Decision Points

### Choose Option 2 (Smart Mirroring) if:
- ✅ You want balanced coverage (85-90% confidence)
- ✅ You want to validate all Phase 3 features
- ✅ You have 1-2 weeks available
- ✅ You want to deploy safely but not spend 3-4 weeks on tests

### Choose Option 1 (Sequential) if:
- You have 3-4 weeks available
- You want comprehensive coverage
- You want to catch every possible edge case
- Production deployment is not urgent

### Choose Option 3 (Production Minimum) if:
- You must deploy this week
- You trust manual testing for basic flows
- You only want to test new/risky code
- You plan to add more tests based on production feedback

---

## Next Steps

If you choose **Option 2 (Smart Mirroring)**, here's what to do next:

1. **Create directories:**
```bash
mkdir -p /Users/bt/Desktop/CODE/Yachtparty\ v.2/Testing/scenarios/innovator
mkdir -p /Users/bt/Desktop/CODE/Yachtparty\ v.2/Testing/scenarios/account-manager
```

2. **Start with Innovator Test 4** (quickest win):
```bash
cd /Users/bt/Desktop/CODE/Yachtparty\ v.2/Testing
cp scenarios/concierge/reengagement-throttling.test.ts \
   scenarios/innovator/reengagement-throttling.test.ts
```

3. **I can help implement these tests** by:
   - Adapting the Concierge tests for Innovator
   - Writing the Account Manager unit tests
   - Running the tests and debugging any failures

**Would you like me to proceed with Option 2 and start implementing the Innovator tests?**
