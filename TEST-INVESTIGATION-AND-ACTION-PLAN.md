# Test Investigation & Action Plan
**Date:** October 21, 2025
**Status:** Investigation Complete - Action Plan Ready

---

## Executive Summary

Investigated 8 specific test issues plus conducted comprehensive test coverage audit. Found:
- **4 hallucination issues** - LLMs copying examples from personality prompts
- **3 malformed tests** - Tests don't actually test what they claim
- **2 prompt gaps** - Missing instructions for re-engagement and email construction
- **Missing test coverage** - No tests for accepting intro_offers or connection_requests

---

## Investigation Findings

### Issue #1: Bouncer Re-engagement Tone ❌ PROMPT GAP

**Test Output:**
```
Agent response: Hey Sarah. Still need to know where you work and what you do there to get you verified.
```

**Expected:**
```
Still interested in getting verified? I'm just the bouncer and need to keep the line moving.
```

**Root Cause:** Re-engagement decision prompt (`decision.ts:72-158`) does NOT mention "bouncer" persona or "keep the line moving" language.

**File:** `/packages/agents/bouncer/src/decision.ts`
**Lines:** 72-158 (buildReengagementDecisionPrompt)

**Finding:** The re-engagement prompt focuses on "social judgment" but doesn't emphasize the bouncer persona that's core to the agent's identity.

**Fix Required:**
- Add bouncer persona reminder to re-engagement decision prompt
- Add example: "I'm just the bouncer and need to keep the line moving"
- Ensure personality prompt (Call 2) also has re-engagement examples with bouncer tone

---

### Issue #2: hello@yachtparty.com Hallucination ❌ HALLUCINATION

**Test Output:**
```
User message: Acme Corp, VP of Marketing
Agent response: VP of Marketing at Acme Corp. Got it. Please send a quick email from your work address to hello@yachtparty.com.
```

**Expected:**
```
VP of Marketing at Acme Corp. Nice. Please send a quick email to verify-{userId}@verify.yachtparty.xyz.
```

**Root Cause Investigation:**
1. ✅ Checked `/packages/agents/bouncer/src` for `hello@yachtparty.com` - **NOT FOUND**
2. ✅ Verified `generateVerificationEmail()` correctly generates `verify-{userId}@verify.yachtparty.xyz`
3. ❓ **Need to verify:** Does LLM Call 1 pass the verification email to Call 2?

**Files to Check:**
- `/packages/agents/bouncer/src/index.ts` lines 400-520 (handleUserMessage function)
- Look for where `generateVerificationEmail()` is called
- Check if result is passed to Call 2 personality prompt

**Hypothesis:** LLM Call 1 generates the email but it's not being passed to Call 2, so Call 2 hallucinates a generic address.

**Fix Required:**
1. Verify tool results are passed to Call 2
2. Add explicit instruction in personality prompt: "NEVER use hello@yachtparty.com - always use the verify-{userId}@verify.yachtparty.xyz address provided in tool results"
3. Consider adding "Nice" acknowledgment example for company/title collection

---

### Issue #3: Email Collection Test ⚠️ MALFORMED TEST

**Test Name:** "Email Collection Test"
**File:** `bouncer.onboarding.test.ts`

**Problem:** Test assumes user will voluntarily provide email address, but Bouncer agent **never asks** for email. The agent asks for company/title, then generates a verification email address automatically.

**Current Flow:**
1. Ask for company/title
2. User provides: "Acme Corp, VP of Marketing"
3. Agent generates `verify-{userId}@verify.yachtparty.xyz` automatically
4. Agent says: "Send email to verify-{userId}@verify.yachtparty.xyz"

**Test assumes:**
1. Agent asks for email
2. User replies: "sarah.chen@acme.com"
3. Agent uses that email somehow

**Fix Required:** Delete or rewrite this test to match actual flow

---

### Issue #4: Middle Name Multi-Message Response ⚠️ MINOR ISSUE

**Test Output:**
```
User: Sarah Marie Chen
Agent response: Got it, Sarah. Do you have a last name too, or are you like Madonna?
Wait, that was your full name wasn't it. My bad.
Everyone here is a verified industry leader, so I need to ask where you work and what you do there.
```

**Analysis:** Agent is self-correcting, which is actually good behavior, but the multi-message format is strange. Call 1 should have recognized this as a full name and passed that info to Call 2.

**Fix Required:**
- Add guidance in Call 1 decision prompt about detecting middle names
- Example: "Sarah Marie Chen" = first: Sarah, last: Chen (middle name ignored)

---

### Issue #5: Innovator "CTV vendors?" Ambiguity ✅ WORKING AS INTENDED

**Test Output:**
```
User message: CTV vendors?
Agent response: I'll research CTV vendors and get back to you with options.
```

**User Note:** "This one is actually an ambiguous message from the user so it should have resulted in asking for clarification. Let's not make any major changes to fix this."

**Finding:** This IS ambiguous. Agent should ask "What about CTV vendors - looking to buy, partner, integrate?"

**Fix Required:** Low priority - add to ambiguity detection examples

---

### Issue #6: Brian/Roku Hallucination ❌ HALLUCINATION

**Test Output:**
```
Prior message: "Bran"
Current message: "Brian"
Agent response: Got it. I'll reach out to the community to see if we have connections at Roku and get back to you when I have something.
```

**Expected:** Agent should acknowledge "Brian" as a corrected name, not hallucinate that Brian works at Roku.

**Root Cause - FOUND:**

**File:** `/packages/agents/innovator/src/personality.ts`
**Line 155:**
```typescript
example: 'Heard back from Mike at Roku. He recommends starting with their self-serve platform before going enterprise.',
```

**File:** `/packages/agents/innovator/src/decision.ts`
**Line 344:**
```typescript
WRONG: User says "I want to meet Brian at Roku" + NO ID exists → DO NOT use any intro tool, use publish_community_request
```

**Finding:** The prompts contain "Mike at Roku" and "Brian at Roku" as examples. LLM is copying these.

**Fix Required:**
1. Remove specific company/name pairs from examples
2. Use generic examples: "{name} at {company}"
3. Add guard rails: "NEVER use names from examples. Only use names/companies the user explicitly mentioned."
4. Change examples to non-tech companies (less likely to be confused with user's actual requests)

---

### Issue #7: "Found 3 platforms" Hallucination ❌ HALLUCINATION

**Test Output:**
```
Context: 7 days since last message, 1 outstanding community request
Agent response: Found 3 CTV advertising platforms that match your criteria. Want the breakdown?
```

**Expected:** Agent should acknowledge outstanding request: "Still working on your CTV question. I'll circle back when I hear from the community."

**Test Context:**
- NO priorities (empty array)
- 1 outstanding community_request
- Agent is re-engaging after 7 days

**Root Cause - FOUND:**

**File:** `/packages/agents/innovator/src/personality.ts`
**Line 219:**
```typescript
solution_update: {
  example: 'Found 3 CTV advertising platforms that match your criteria. Want the breakdown?',
}
```

**File:** `/packages/agents/concierge/src/personality.ts`
**Lines 92, 156:**
```typescript
- "Found 3 CTV platforms that might fit your Q1 launch. Want me to send details?"
example: 'Found 3 options for CTV platforms: Roku (enterprise), Vizio (mid-market), Samsung (developer-friendly)...'
```

**Finding:** LLM is copying the EXACT example when it doesn't have actual solution research data.

**Fix Required:**
1. Change examples to use `{solution_count}` and `{topic}` placeholders
2. Add explicit guard rail: "NEVER say 'Found 3 platforms' unless you ACTUALLY have 3 platforms in the priority data"
3. For re-engagement with outstanding requests: "Acknowledge the outstanding request FIRST, then mention any new priorities"

---

### Issue #8: Multi-Threading Test - Same Hallucination ❌ HALLUCINATION

**Same as Issue #7** - "Found 3 platforms" when there's actually 2 high priorities + 1 outstanding request.

**Expected:** "Still working on your CTV question. In the meantime, found a couple intro opportunities that might interest you. Want to hear about them?"

**Fix:** Same as Issue #7 + add instruction to differentiate between priority types

---

### Issue #9: Intro Opportunity Test Malformation ⚠️ MALFORMED TEST

**Test Name:** "Innovator - Intro Opportunity Test"
**File:** `innovator.shared-concierge-behavior.test.ts`

**Test Output:**
```
User message: Do you know anyone who has experience with CTV advertising platforms?
Agent response: Got it. I'll reach out to the community to see who has CTV advertising platform experience...
```

**Problem:** This test claims to test "Intro Opportunity selection" but:
1. User message is a community question, not responding to an intro opportunity
2. NO intro_opportunity exists in test priorities
3. Agent correctly selects `ask_community_question` tool

**What the test SHOULD do:**
1. Create an intro_opportunity in user_priorities: "Mike Chen at Roku - CTV expert"
2. User message (proactive check-in from agent OR user asks "what do you have for me?")
3. Agent Call 1 finds intro_opportunity in priorities
4. Agent Call 1 decides to present it: next_scenario = 'present_intro_opportunity'
5. Agent Call 2 generates: "Mike Chen at Roku has deep CTV experience. Want an intro?"

**Fix Required:** Completely rewrite this test

---

### Issue #10: Solution Research Over-promising ❌ HALLUCINATION

**Test Output:**
```
User message: Can you help me research CTV advertising platforms? I need to compare features and pricing.
Agent response: I'll research CTV advertising platforms and pull together feature/pricing comparisons for you.
Should have something comprehensive back to you once I've vetted the options.
```

**User Note:** "Hallucinating and over-promising"

**Analysis:** Agent is promising "comprehensive...feature/pricing comparisons" when Solution Saga may not deliver that level of detail.

**Fix Required:**
- Tone down solution research examples in personality prompt
- Current: "pull together feature/pricing comparisons"
- Better: "I'll research CTV platforms and share what I find"
- Add guard rail: "Don't promise specific deliverables (e.g., 'feature comparisons', 'pricing breakdown') - just say you'll research and share findings"

---

## Test Coverage Audit

### Tools We Have:

**Bouncer:**
1. ✅ collect_user_info (tested)
2. ✅ send_verification_email (tested)
3. ✅ complete_onboarding (tested)
4. ✅ create_reengagement_task (tested)
5. ✅ store_nomination → show_intro_opportunity (tested)
6. ✅ lookup_user_by_name (tested indirectly)

**Innovator:**
1. ✅ ask_community_question (tested - multiple tests)
2. ✅ request_solution_research (tested - multiple tests)
3. ✅ offer_introduction (tested - scenarios.test.ts)
4. ✅ request_connection (tested - scenarios.test.ts)
5. ✅ accept_intro_opportunity (tested - scenarios.test.ts)
6. ✅ decline_intro_opportunity (tested - scenarios.test.ts)
7. ❌ **accept_intro_offer** (NOT TESTED)
8. ❌ **decline_intro_offer** (NOT TESTED)
9. ❌ **confirm_intro_made** (NOT TESTED)
10. ❌ **accept_connection_request** (NOT TESTED)
11. ❌ **decline_connection_request** (NOT TESTED)
12. ✅ store_user_goal (tested but flaky)
13. ✅ update_user_field (tested)

### Missing Tests:

**Critical - Two-Step Intro Flows:**
1. ❌ User accepts intro_offer (Step 1 of two-step flow)
2. ❌ User declines intro_offer
3. ❌ User confirms they made the intro (Step 2 of two-step flow)
4. ❌ User accepts connection_request
5. ❌ User declines connection_request

**Why Missing:**
These tests require:
1. Creating intro_offer or connection_request in priorities
2. User message: "yes" or "no" or "I made the intro"
3. Agent Call 1 finds the priority and selects appropriate tool
4. Agent Call 2 generates confirmation message

**Example Test Needed:**
```typescript
it('should accept intro_offer when user says yes', async () => {
  const user = createTestUser();
  const conversation = createTestConversation();
  const messages = createTestMessages('engaged');

  // Create intro_offer in priorities
  const priorities: UserPriority[] = [{
    id: 'priority-1',
    user_id: user.id,
    item_type: 'intro_offer',
    item_id: 'offer-123',
    value_score: 85,
    status: 'active',
    content: 'John Smith can introduce you to Sarah Chen at Salesforce',
    metadata: {
      offering_user_name: 'John Smith',
      prospect_name: 'Sarah Chen',
      prospect_company: 'Salesforce'
    }
  }];

  const incomingMessage: Message = {
    // ...
    content: 'yes, that would be great'
  };

  const response = await invokeInnovatorAgent(incomingMessage, user, conversation);

  // Should select accept_intro_offer tool
  expect(response.actions.some(a => a.type === 'accept_intro_offer')).toBe(true);
  expect(response.actions.find(a => a.type === 'accept_intro_offer')?.params.intro_offer_id).toBe('offer-123');

  // Should acknowledge
  expect(response.messages?.join(' ')).toMatch(/got it|perfect|great/i);
});
```

---

## Action Plan

### Phase 1: Fix Hallucinations (HIGH PRIORITY)

#### 1.1 Update Innovator Personality Prompts ✅ READY TO IMPLEMENT

**File:** `/packages/agents/innovator/src/personality.ts`

**Changes:**
```typescript
// Line 155 - BEFORE:
example: 'Heard back from Mike at Roku. He recommends starting with their self-serve platform before going enterprise.',

// Line 155 - AFTER:
example: 'Heard back from {name} at {company}. They recommend starting with their self-serve tier first.',

// Line 219 - BEFORE:
example: 'Found 3 CTV advertising platforms that match your criteria. Want the breakdown?',

// Line 219 - AFTER:
example: 'Found {count} options for {topic}. Want the details?',

// ADD GUARD RAIL at top of personality prompt:
**CRITICAL ANTI-HALLUCINATION RULES:**
1. NEVER use names/companies from examples (Mike, Roku, Brian, Sarah, etc.)
2. NEVER say "Found X platforms" unless you have ACTUAL data in priorities
3. NEVER promise specific deliverables ("feature comparisons", "pricing breakdown")
4. For re-engagement with outstanding requests: Acknowledge the outstanding request FIRST
```

#### 1.2 Update Concierge Personality Prompts ✅ READY TO IMPLEMENT

**File:** `/packages/agents/concierge/src/personality.ts`

**Changes:**
```typescript
// Line 92 - BEFORE:
- "Found 3 CTV platforms that might fit your Q1 launch. Want me to send details?"

// Line 92 - AFTER:
- "Found {count} options that might fit your timeline. Want details?"

// Line 156 - BEFORE:
example: 'Found 3 options for CTV platforms: Roku (enterprise), Vizio (mid-market), Samsung (developer-friendly). Which direction interests you most?'

// Line 156 - AFTER:
example: 'Found {count} options for {topic}. Each targets different use cases. Which direction interests you most?'
```

#### 1.3 Update Innovator Decision Prompt ✅ READY TO IMPLEMENT

**File:** `/packages/agents/innovator/src/decision.ts`

**Changes:**
```typescript
// Line 344 - BEFORE:
WRONG: User says "I want to meet Brian at Roku" + NO ID exists → DO NOT use any intro tool, use publish_community_request

// Line 344 - AFTER:
WRONG: User says "I want to meet {name} at {company}" + NO ID exists in priorities → DO NOT use any intro tool, use publish_community_request
```

### Phase 2: Fix Bouncer Re-engagement Tone (MEDIUM PRIORITY)

#### 2.1 Update Re-engagement Decision Prompt ✅ READY TO IMPLEMENT

**File:** `/packages/agents/bouncer/src/decision.ts`

**Add after line 103 (Re-engagement Context section):**
```typescript
## Remember Your Role

You are THE BOUNCER. Even in re-engagement, maintain your persona:
- Professional but not salesy
- Direct and to-the-point
- "I'm just the bouncer - need to keep the line moving"
- Don't let people linger indefinitely

Your job is gatekeeping, not hand-holding.
```

#### 2.2 Add Re-engagement Examples to Personality Prompt ✅ READY TO IMPLEMENT

**File:** `/packages/agents/bouncer/src/personality.ts`

**Add new scenario:**
```typescript
reengagement: {
  situation: 'Following up with inactive user during onboarding',
  guidance: 'Brief check-in. Remind them you're the bouncer. Keep line moving.',
  examples: [
    'Still interested in getting verified? I'm just the bouncer and need to keep the line moving.',
    'Haven't heard from you in a bit. Still want access or should I move on to the next person?',
    'Quick check-in - still need to get your company and title to move forward.'
  ]
}
```

### Phase 3: Fix Email Verification Address Construction (HIGH PRIORITY)

#### 3.1 Investigate Tool Result Passing 🔍 INVESTIGATION NEEDED

**Action:** Read `/packages/agents/bouncer/src/index.ts` lines 430-480 to verify:
1. Where `generateVerificationEmail()` is called
2. Whether result is passed to Call 2
3. If not, add it to tool results

#### 3.2 Add Explicit Instruction to Personality Prompt ✅ READY TO IMPLEMENT

**File:** `/packages/agents/bouncer/src/personality.ts`

**Add to verification email scenario:**
```typescript
**CRITICAL:** Always use the verification email address provided in tool results (verify-{userId}@verify.yachtparty.xyz).
NEVER use hello@yachtparty.com or any other email address.
```

#### 3.3 Improve Company/Title Acknowledgment ✅ READY TO IMPLEMENT

**File:** `/packages/agents/bouncer/src/personality.ts`

**Update example:**
```typescript
// BEFORE:
- "Perfect. Last thing - to verify your role, I need you to send an empty email to: verify-abc@verify.yachtparty.xyz"

// AFTER:
- "VP of Marketing at Acme. Nice. Last step - send a quick email to verify-abc123@verify.yachtparty.xyz to confirm your role."
```

### Phase 4: Fix Malformed Tests (MEDIUM PRIORITY)

#### 4.1 Delete Email Collection Test ✅ READY TO IMPLEMENT

**File:** `/packages/agents/bouncer/__tests__/bouncer.onboarding.test.ts`

**Action:** Delete the "Email Collection Test" entirely (lines ~270-290)

**Reason:** Test doesn't match actual agent flow

#### 4.2 Rewrite Intro Opportunity Test ✅ READY TO IMPLEMENT

**File:** `/packages/agents/innovator/__tests__/innovator.shared-concierge-behavior.test.ts`

**Action:** Replace test with:
```typescript
it('should present intro_opportunity from priorities', async () => {
  const user = createTestUser();
  const conversation = createTestConversation();
  const messages = createTestMessages('engaged');

  // Create intro_opportunity in priorities
  const priorities: UserPriority[] = [{
    id: 'priority-1',
    user_id: user.id,
    item_type: 'intro_opportunity',
    item_id: 'intro-opp-123',
    value_score: 85,
    status: 'active',
    content: 'Mike Chen at Roku - CTV advertising expert',
    metadata: {
      prospect_name: 'Mike Chen',
      prospect_company: 'Roku',
      expertise: 'CTV advertising',
      connector_user_id: 'connector-123'
    }
  }];

  const incomingMessage: Message = {
    // User asks what agent has for them
    content: 'what do you have for me?'
  };

  const response = await invokeInnovatorAgent(incomingMessage, user, conversation);

  // Should present the intro opportunity
  expect(response.messages?.join(' ')).toMatch(/Mike Chen.*Roku.*CTV/i);
  expect(response.actions.some(a => a.type === 'present_intro_opportunity')).toBe(true);
});
```

### Phase 5: Add Missing Test Coverage (HIGH PRIORITY)

#### 5.1 Create intro-offer-acceptance.test.ts ✅ READY TO IMPLEMENT

**File:** `/packages/agents/innovator/__tests__/innovator.intro-offer-acceptance.test.ts`

**Tests to add:**
1. User accepts intro_offer ("yes, that would be great")
2. User declines intro_offer ("no thanks")
3. User confirms they made the intro ("I made the intro")
4. Edge case: User is ambiguous ("maybe")

#### 5.2 Create connection-request-acceptance.test.ts ✅ READY TO IMPLEMENT

**File:** `/packages/agents/innovator/__tests__/innovator.connection-request-acceptance.test.ts`

**Tests to add:**
1. User accepts connection_request
2. User declines connection_request
3. User asks for more context

### Phase 6: Documentation Updates (LOW PRIORITY)

#### 6.1 Update TEST-RESULTS Document ✅ READY TO IMPLEMENT

**File:** `/TEST-RESULTS-2025-10-21.md`

**Action:** Add "Known Issues" section documenting:
1. Hallucination sources (examples in prompts)
2. Malformed tests identified
3. Missing test coverage

---

## Priority Matrix

### Do First (This Week)
1. ✅ Phase 1.1-1.3: Fix hallucinations (personality prompts)
2. ✅ Phase 3.1-3.3: Fix email verification
3. ✅ Phase 5.1-5.2: Add missing test coverage

### Do Soon (Next Sprint)
4. ✅ Phase 2.1-2.2: Fix re-engagement tone
5. ✅ Phase 4.1-4.2: Fix malformed tests

### Do Eventually (Backlog)
6. ✅ Phase 6.1: Documentation updates
7. ⚠️ Issue #5: Improve ambiguity detection for terse messages

---

## Success Metrics

**After fixes, we expect:**
- ❌ Zero hallucinations of "Brian at Roku" or "Mike at Roku"
- ❌ Zero "Found 3 platforms" when no data exists
- ❌ Zero `hello@yachtparty.com` (always uses verify-{userId}@verify.yachtparty.xyz)
- ✅ Re-engagement messages include "bouncer" persona
- ✅ All intro flow tools have test coverage
- ✅ Test pass rate: 95%+ (currently 88%)

---

## Next Steps

1. **User Review:** Review this investigation and confirm approach
2. **Implementation:** Start with Phase 1 (hallucination fixes)
3. **Testing:** Run tests after each phase
4. **Deploy:** Deploy fixes incrementally
5. **Monitor:** Track hallucination rates in production logs

---

**Document Status:** COMPLETE - Ready for implementation
**Estimated Effort:** 8-12 hours total
**Risk Level:** Low (mostly prompt updates, no architecture changes)
