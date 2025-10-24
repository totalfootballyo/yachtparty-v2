# Introduction Flows Implementation Status

**Date:** October 21, 2025
**Task:** Replace `create_intro_opportunity` with proper 3-flow introduction system

## ✅ COMPLETED (Phase 1-3)

### Phase 1: Schema & Events
- ✅ Created `connection_requests` table migration
- ✅ Created `intro_offers` table migration
- ✅ Added `warm_intro_bounty` field to `innovators` table (default: 25)
- ✅ Successfully ran migration in Supabase
- ❌ New event types NOT defined (using existing events for now)

### Phase 2: Core Tools
- ✅ Updated `packages/shared/src/types/agents.ts`
  - Removed `create_intro_opportunity`
  - Added 9 new action types:
    1. `accept_intro_opportunity`
    2. `decline_intro_opportunity`
    3. `accept_connection_request`
    4. `decline_connection_request`
    5. `offer_introduction`
    6. `accept_intro_offer`
    7. `decline_intro_offer`
    8. `confirm_intro_offer`
    9. `request_connection` (Innovator-only)

- ✅ Updated `packages/agents/concierge/src/index.ts`
  - Removed `create_intro_opportunity` case
  - Implemented all 8 intro flow tools (except request_connection)
  - Dynamic bounty logic implemented in `accept_intro_offer`

- ✅ Updated `packages/agents/innovator/src/index.ts`
  - Removed `create_intro_opportunity` case
  - Implemented all 9 intro flow tools (including request_connection)
  - Dynamic bounty logic implemented in `accept_intro_offer`

- ❌ Bouncer agent NOT updated (still references `create_intro_opportunity`)

### Phase 3: Agent Prompts
- ✅ Updated `packages/agents/concierge/src/decision.ts`
  - Removed `create_intro_opportunity` tool definition
  - Added all 8 new intro flow tools
  - Added comprehensive CRITICAL disambiguation section
  - Updated tool numbering (now 12 tools)

- ✅ Updated `packages/agents/innovator/src/decision.ts`
  - Removed `create_intro_opportunity` tool definition
  - Added all 9 new intro flow tools
  - Added comprehensive CRITICAL disambiguation section
  - Updated tool numbering (now 17 tools)
  - Updated parameter validation guards

- ❌ Call 2 personality prompts NOT updated with scenario examples

---

## ❌ NOT COMPLETED (Phase 4-6)

### Phase 4: Account Manager
- ❌ Add prioritization for `intro_opportunities`
- ❌ Add prioritization for `connection_requests`
- ❌ Add prioritization for `intro_offers`
- ❌ Handle state transitions (pause/cancel other opportunities)

### Phase 5: Agent of Humans
- ❌ Handle `intro_offers` where introducee is innovator
- ❌ Coordinate two-step acceptance (introducee → connector confirmation)

### Phase 6: Tests
- ❌ Update Bouncer test fixtures (still use `create_intro_opportunity`)
- ❌ Update Innovator test fixtures (still use `create_intro_opportunity`)
- ❌ Update Bouncer test assertions
- ❌ Update Innovator test assertions
- ❌ Add new scenario tests for all 9 intro flow tools
- ❌ Add disambiguation tests (Call 1 tool selection)
- ❌ Add messaging tests (Call 2 tone, no hallucinations, no timelines)

---

## Critical Outstanding Work

### 1. Bouncer Agent Update (HIGH PRIORITY)
**File:** `packages/agents/bouncer/src/index.ts`

Currently uses `create_intro_opportunity` for nominations. Must change to `offer_introduction`.

**Current code:**
```typescript
case 'create_intro_opportunity': {
  // Nomination logic
}
```

**Needs to become:**
```typescript
case 'offer_introduction': {
  // Create intro_offer with context_type='nomination'
  const { data: introOffer } = await supabase
    .from('intro_offers')
    .insert({
      offering_user_id: user.id,
      introducee_user_id: null, // TBD - system/founder?
      prospect_name: input.prospect_name,
      context_type: 'nomination',
      bounty_credits: 0,
      status: 'pending_introducee_response',
    })
    .select()
    .single();
}
```

### 2. Test Updates (HIGH PRIORITY)

All test files still reference `create_intro_opportunity`:
- `packages/agents/bouncer/__tests__/helpers.ts`
- `packages/agents/bouncer/__tests__/bouncer.edgecases.test.ts`
- `packages/agents/innovator/__tests__/helpers.ts`
- `packages/agents/innovator/__tests__/innovator.scenarios.test.ts`

### 3. Comprehensive E2E Tests (CRITICAL)

**Missing test coverage for:**

#### A. Call 1 Tool Selection (Decision Layer)
Tests that verify LLM selects correct tool based on user message + context:

1. **offer_introduction disambiguation:**
   - ✅ "I can introduce you to X" → `offer_introduction`
   - ❌ "Do you know X?" → `publish_community_request` (NOT offer_introduction)
   - ❌ "I want to meet X" → `publish_community_request` (NOT offer_introduction)

2. **accept_intro_opportunity context-dependent:**
   - User says "yes" + priority shows intro_opportunity → `accept_intro_opportunity`
   - User says "sure" + priority shows intro_opportunity → `accept_intro_opportunity`

3. **accept_connection_request context-dependent:**
   - User says "yes" + priority shows connection_request → `accept_connection_request`

4. **accept_intro_offer context-dependent:**
   - User says "yes" + priority shows intro_offer → `accept_intro_offer`

5. **Negative cases (hallucination prevention):**
   - User says "I want intro to Sarah at Hulu" + NO Sarah in priorities → Should NOT use any intro tool
   - User asks "Can you connect me with Brian?" + NO Brian exists → Should use `publish_community_request`

#### B. Call 2 Message Composition (Personality Layer)
Tests that verify LLM composes messages correctly:

1. **Tone verification:**
   - No exclamation points
   - No superlatives ("awesome!", "amazing!")
   - Brief (under 200 chars per message)
   - Helpful but not overeager

2. **No hallucinations:**
   - Does NOT fabricate people names
   - Does NOT commit to intros before consent ("I can connect you with Sarah..." when no Sarah exists)
   - Does NOT reference budget/timeline user never mentioned

3. **No timeline promises:**
   - Does NOT say "in the next couple days"
   - Does NOT say "within 24 hours"
   - CORRECT: "I'll reach out to the community and circle back when I have something"

4. **Accurate action description:**
   - If Call 1 used `publish_community_request`, Call 2 should say "I'll ask the community" (NOT "I'll make that intro")
   - If Call 1 used `offer_introduction`, Call 2 should acknowledge the offer
   - If Call 1 used `accept_intro_offer`, Call 2 should confirm acceptance

#### C. Three-Flow Integration Tests
Tests that verify correct flow selection end-to-end:

1. **intro_opportunities flow (System → Connector):**
   - Account Manager creates intro_opportunity
   - Adds to user priorities
   - Concierge/Innovator presents opportunity
   - User accepts → `accept_intro_opportunity` executed
   - Status updated to 'accepted'

2. **connection_requests flow (Requestor → Introducee):**
   - Innovator uses `request_connection` to request intro
   - connection_request created with status 'open'
   - Introducee sees it in priorities
   - Introducee accepts → `accept_connection_request` executed
   - Status updated to 'accepted'

3. **intro_offers flow (User → Introducee → Connector):**
   - User says "I can introduce you to X"
   - `offer_introduction` creates intro_offer
   - Introducee sees it in priorities
   - Introducee accepts → `accept_intro_offer` executes bounty logic
   - If introducee is innovator → bounty_credits = innovator.warm_intro_bounty
   - If introducee NOT innovator → bounty_credits = 0
   - Status updated to 'pending_connector_confirmation'
   - Connector confirms → `confirm_intro_offer` executed
   - Status updated to 'completed'

---

## Risk Assessment

**HIGH RISK:**
- Tests are currently broken (all fixtures use old tool)
- Bouncer agent still uses old tool (nominations will fail)
- No E2E coverage for new flows (can't validate correctness)
- Account Manager doesn't know about new tables (won't prioritize)

**MEDIUM RISK:**
- No event definitions for new flows (coordination limited)
- Agent of Humans doesn't handle intro_offers (multi-step flows incomplete)
- Call 2 personality examples not updated (may leak old patterns)

**LOW RISK:**
- Schema is correct and deployed
- Core tool implementations are complete
- Type system enforces new action types

---

## Next Steps (Priority Order)

1. **[CRITICAL]** Create comprehensive E2E tests (this document)
2. **[HIGH]** Update Bouncer agent to use `offer_introduction`
3. **[HIGH]** Update all test fixtures to use new tools
4. **[MEDIUM]** Define new event types
5. **[MEDIUM]** Update Call 2 personality scenario examples
6. **[MEDIUM]** Account Manager prioritization
7. **[LOW]** Agent of Humans coordination

---

## Testing Strategy

Given the complexity and context-dependent nature of intro flows, we need E2E tests that:

1. **Test Call 1 in isolation:**
   - Given: User message + conversation history + priorities
   - Verify: Correct tool selected, correct params extracted
   - Example: User says "yes" → verify `accept_intro_opportunity` selected when intro_opportunity in priorities

2. **Test Call 2 in isolation:**
   - Given: Call 1 decision output
   - Verify: Message tone, no hallucinations, accurate description
   - Example: Call 1 selected `publish_community_request` → verify Call 2 says "I'll ask the community"

3. **Test full flow end-to-end:**
   - Given: User message sequence
   - Verify: Database records created, status transitions correct
   - Example: "I can introduce you to X" → intro_offer created → user accepts → bounty set → confirmed

4. **Test negative cases (hallucination prevention):**
   - Given: User asks for intro + NO matching priority
   - Verify: Agent does NOT fabricate intro, uses `publish_community_request` instead

---

**Status:** Ready for comprehensive test implementation
