# Bouncer Agent Test Analysis

**Analysis Date:** October 21, 2025
**Analyst:** Claude Code
**Context:** Comprehensive review of Bouncer agent tests for robustness, realism, and coverage

---

## Executive Summary

The Bouncer agent is the **front-line UX** for Yachtparty, responsible for onboarding new users. Test quality is critical because:
- Users who don't complete onboarding never reach the platform
- **Email verification** is a major drop-off point (users get all the way there and ghost)
- Tone must be perfect: professional gatekeeper, not pushy salesperson
- Conversation is predictable (agent drives), but user responses vary (typos, corrections, questions, lies)

### Overall Assessment:

**STRENGTHS:**
1. ✅ **Good fixture infrastructure** - `createUserByOnboardingStep()` creates users at specific states
2. ✅ **Strong helper functions** - Verifies tone, message length, exclamation points
3. ✅ **Re-engagement testing** - Tests 24h/48h timing for drop-offs
4. ✅ **Social judgment prompts** - Bouncer decision prompts emphasize social awareness

**CRITICAL GAPS:**
1. ❌ **Message history doesn't match user state** in several tests
2. ❌ **Missing email verification drop-off scenarios** (the #1 drop-off point)
3. ❌ **No tests for mid-process questions** ("what is this?", "why do you need this?")
4. ❌ **No tests for common user mistakes** (typos, corrections, multi-part responses)
5. ❌ **Missing re-engagement tone verification** for bouncer persona

---

## Test-by-Test Analysis

### 1. bouncer.onboarding.test.ts

#### Test: "First Interaction: Brand New User"
**Purpose:** Tests that agent asks who told them about Yachtparty

**User Mock State:**
```typescript
first_name: null
last_name: null
company: null
title: null
email: null
email_verified: false
```

**Message History:**
```typescript
messages: []  // Empty - brand new conversation
```

**Incoming Message:**
```typescript
"Hi there"
```

✅ **PASS - A. Typical Message History:** Yes - empty history for brand new user is correct

✅ **PASS - B. History Matches User State:** Yes - user has no data, history is empty

✅ **PASS - C. Testing What We Mean:** Yes - tests referrer collection on first contact

**RECOMMENDATION:** Add variation: "hey", "hello", "Hi" (different greetings)

---

#### Test: "Referrer Collection: Exact Match"
**Purpose:** Tests matching "Ben Trenda" to existing verified user

**User Mock State:**
```typescript
first_name: null (SHOULD HAVE BEEN ASKED FOR BY NOW)
last_name: null
company: null
title: null
referred_by: null
```

**Message History:**
```typescript
messages: []  // PROBLEM: Should have agent asking "who told you" first
```

**Incoming Message:**
```typescript
"Ben Trenda told me about this"
```

❌ **FAIL - B. History Doesn't Match User State:**
- User has `referred_by: null` (correct - not yet filled)
- But message history is empty (WRONG - agent should have asked "who told you?" first)
- User is responding to a question that was never asked in the conversation history

**CORRECT SEQUENCE SHOULD BE:**
```typescript
messages: [
  { role: 'user', content: 'Hi' },
  { role: 'bouncer', content: 'Hey... who told you about this?' },
]

// THEN user responds:
incomingMessage: { content: 'Ben Trenda told me about this' }
```

✅ **PASS - C. Testing What We Mean:** Yes - tests referrer matching logic

**RECOMMENDATION:** Fix message history to include agent's referrer question

---

#### Test: "Name Collection"
**Purpose:** Tests extracting first and last name

**User Mock State:**
```typescript
first_name: null
last_name: null
company: null
title: null
referred_by: null (SHOULD HAVE referrer_id IF they answered)
```

**Message History:**
```typescript
messages: []  // PROBLEM: Should show referrer question + answer
```

**Incoming Message:**
```typescript
"Sarah Chen"
```

❌ **FAIL - B. History Doesn't Match User State:**
- User still has `referred_by: null` (meaning either they didn't answer or no match was found)
- Message history is empty (should have referrer exchange)
- User is providing name without context of previous Q&A

**CORRECT SEQUENCE:**
```typescript
messages: [
  { role: 'user', content: 'Hi' },
  { role: 'bouncer', content: 'Hey... who told you about this?' },
  { role: 'user', content: 'Ben Trenda' },
  { role: 'bouncer', content: 'Got it, thanks. I\'m the bouncer so I had to ask. What\'s your name?' },
]

// THEN user responds:
incomingMessage: { content: 'Sarah Chen' }
```

✅ **PASS - C. Testing What We Mean:** Yes - tests name extraction

**RECOMMENDATION:** Fix message history + set `referred_by` to referrer ID or `name_dropped` to name

---

#### Test: "Company/Title Collection"
**Purpose:** Tests extracting company and job title

**User Mock State:**
```typescript
first_name: 'Sarah'
last_name: 'Chen'
company: null
title: null
email: null
```

**Message History:**
```typescript
messages: []  // PROBLEM: Should have full conversation up to name collection
```

**Incoming Message:**
```typescript
"Acme Corp, VP of Marketing"
```

❌ **FAIL - B. History Doesn't Match User State:**
- User HAS first_name and last_name (meaning agent already asked and user provided)
- Message history is empty (should show referrer → name → company question)

**CORRECT SEQUENCE:**
```typescript
messages: [
  { role: 'user', content: 'Hi' },
  { role: 'bouncer', content: 'Hey... who told you about this?' },
  { role: 'user', content: 'Ben' },
  { role: 'bouncer', content: 'Got it, Ben. Do you have a last name too, or are you like Madonna?' },
  { role: 'user', content: 'Sarah Chen' },
  { role: 'bouncer', content: 'Everyone here is a verified industry leader, so I need to ask where you work and what you do there.' },
]

// THEN user responds:
incomingMessage: { content: 'Acme Corp, VP of Marketing' }
```

✅ **PASS - C. Testing What We Mean:** Yes - tests company/title extraction

**RECOMMENDATION:** Build full conversation history showing progression

---

#### Test: "Onboarding Completion"
**Purpose:** Tests completion when email is verified

**User Mock State:**
```typescript
first_name: 'Sarah'
last_name: 'Chen'
company: 'Acme Corp'
title: 'VP of Marketing'
email: 'sarah.chen@acme.com'
email_verified: true (JUST CHANGED TO TRUE)
```

**Message History:**
```typescript
messages: []  // PROBLEM: Should show full onboarding conversation
```

**System Message:**
```json
{
  "type": "email_verified",
  "email": "sarah.chen@acme.com",
  "verified_at": "2025-10-21T..."
}
```

❌ **FAIL - B. History Doesn't Match User State:**
- User has ALL required fields (meaning full onboarding happened)
- Message history is empty (should show referrer → name → company → email verification request)

**CORRECT SEQUENCE:**
```typescript
messages: [
  // ... (referrer, name, company exchanges)
  { role: 'bouncer', content: 'VP of Marketing at Acme. Nice. Please send a quick email from your work address to verify-{userId}@verify.yachtparty.xyz. We\'ll never sell your contact info, just need to verify your role.' },
  { role: 'user', content: 'ok sent' },  // Or just silence, then system message
]

// THEN system message arrives:
systemMessage: { role: 'system', content: '{"type": "email_verified", ...}' }
```

✅ **PASS - C. Testing What We Mean:** Yes - tests completion flow

**RECOMMENDATION:** Add realistic conversation history showing full onboarding journey

---

#### Test: "All-At-Once Information Provision"
**Purpose:** Tests user providing all info at once

**User Mock State:**
```typescript
first_name: null
last_name: null
company: null
title: null
email: null
referred_by: null (SHOULD BE SET IF USER MENTIONED REFERRER)
```

**Message History:**
```typescript
messages: []  // TECHNICALLY OK if this is first message after "who told you?"
```

**Incoming Message:**
```typescript
"Hi, I'm Sarah Chen from Acme Corp where I'm VP of Marketing. My email is sarah.chen@acme.com"
```

⚠️ **PARTIAL - B. History Doesn't Match User State:**
- User provides name, company, title, email all at once
- BUT also hasn't answered referrer question yet
- Message history should show referrer question:

**CORRECT SEQUENCE:**
```typescript
messages: [
  { role: 'user', content: 'Hi' },
  { role: 'bouncer', content: 'Hey... who told you about this?' },
]

// THEN user dumps everything:
incomingMessage: { content: "Hi, I'm Sarah Chen from Acme Corp where I'm VP of Marketing. My email is sarah.chen@acme.com" }
```

✅ **PASS - C. Testing What We Mean:** Yes - tests all-at-once extraction

**RECOMMENDATION:** Add referrer question to history (user might skip answering it, but agent should have asked)

---

#### Test: "Tone and Personality"
**Purpose:** Tests selective gatekeeper tone

**User Mock State:**
```typescript
first_name: null
last_name: null
company: null
...
```

**Message History:**
```typescript
messages: []  // Same as "Brand New User" test
```

**Incoming Message:**
```typescript
"Hi there"
```

✅ **PASS - All Criteria:** Same as "Brand New User" test - correctly structured

**RECOMMENDATION:** None - this test is correctly structured

---

### 2. bouncer.reengagement.test.ts

#### Test: "First Re-engagement Attempt (24h after dropout)"
**Purpose:** Tests soft follow-up after 24 hours of silence

**User Mock State:**
```typescript
first_name: 'Sarah'
last_name: 'Chen'
company: 'Acme Corp'
title: 'VP Marketing'
email: null  // MISSING - user dropped off before email verification
email_verified: false
```

**Message History:**
```typescript
messages: createTestMessages('partial_info') = [
  { role: 'user', content: 'Hi' },
  { role: 'bouncer', content: 'Welcome to Yachtparty! What\'s your name?' },
  { role: 'user', content: 'Sarah Chen' },
  { role: 'bouncer', content: 'Nice to meet you, Sarah. Where do you work?' },
]
```

**System Message:**
```json
{
  "type": "re_engagement_check",
  "attemptCount": 1,
  "lastInteractionAt": "25 hours ago",
  "currentStep": "email_verification",
  "missingFields": ["email"]
}
```

❌ **FAIL - B. History Doesn't Match User State:**
- User has `first_name`, `last_name`, `company`, `title` filled
- Message history ends with "Where do you work?" (meaning they haven't answered company/title yet)
- **MISMATCH:** User profile says they answered (Sarah Chen, Acme Corp, VP Marketing) but conversation shows they never answered the company question

**CORRECT SEQUENCE:**
```typescript
messages: [
  { role: 'user', content: 'Hi' },
  { role: 'bouncer', content: 'Hey... who told you about this?' },
  { role: 'user', content: 'Ben' },
  { role: 'bouncer', content: 'Got it, Ben. What\'s your name?' },
  { role: 'user', content: 'Sarah Chen' },
  { role: 'bouncer', content: 'Everyone here is a verified industry leader, so I need to ask where you work and what you do there.' },
  { role: 'user', content: 'Acme Corp, VP of Marketing' },
  { role: 'bouncer', content: 'VP of Marketing at Acme. Nice. Please send a quick email from your work address to verify-{userId}@verify.yachtparty.xyz. We\'ll never sell your contact info, just need to verify your role.' },
  // USER GOES SILENT FOR 25 HOURS
]

// THEN system triggers re-engagement:
systemMessage: { role: 'system', content: '{"type": "re_engagement_check", ...}' }
```

✅ **PASS - A. Typical Message History:** Yes - conversation that trails off is typical

✅ **PASS - C. Testing What We Mean:** Yes - tests re-engagement after drop-off

**CRITICAL ISSUE:** This is testing **email verification drop-off** (the #1 drop-off point) but the message history doesn't reflect that the user was actually asked to verify their email!

**RECOMMENDATION:** Fix message history to show complete conversation up to email verification request

---

#### Test: "Second Re-engagement Attempt"
**Same issues as first re-engagement test** - message history doesn't match user state

---

#### Test: "After 2 Attempts: No More Re-engagement"
**Purpose:** Verifies agent stops after 2 attempts

✅ **PASS - C. Testing What We Mean:** Yes - correctly tests 2-attempt limit

**RECOMMENDATION:** Same fix as above - proper message history

---

### 3. bouncer.edgecases.test.ts

*(Need to read this file to complete analysis)*

---

## Critical Missing Tests

### A. Email Verification Drop-off Scenarios

**THE #1 DROP-OFF POINT** - Users get all the way to email verification and then:

1. ❌ **Missing: User says "ok" but doesn't send email**
   ```typescript
   messages: [
     // ... full onboarding ...
     { role: 'bouncer', content: 'Please send email to verify-{userId}@verify.yachtparty.xyz' },
     { role: 'user', content: 'ok' },  // Says they will, but doesn't
     // ... 25 hours pass ...
   ]
   // Re-engagement message should reference this: "Haven't gotten your email yet..."
   ```

2. ❌ **Missing: User asks why they need to verify**
   ```typescript
   messages: [
     { role: 'bouncer', content: 'Please send email to verify-{userId}@verify.yachtparty.xyz' },
     { role: 'user', content: 'why do you need my email?' },
   ]
   // Agent should explain: verify role, never sell info, selective community
   ```

3. ❌ **Missing: User asks "what do I write in the email?"**
   ```typescript
   { role: 'user', content: 'what do I write in the email?' }
   // Agent: "Just send a blank email - we just need to see it comes from your work address"
   ```

4. ❌ **Missing: User sends from wrong email**
   ```typescript
   { role: 'user', content: 'sent from my personal email' }
   // Agent: "Need to send from work email (sarah.chen@acme.com) to verify your role"
   ```

5. ❌ **Missing: User says "I'll do it later"**
   ```typescript
   { role: 'user', content: 'I\'ll send it later' }
   // Agent: "Got it. Just send when you get a chance."
   // Then 25h later: re-engagement
   ```

---

### B. Mid-Process Questions

Users often ask questions during onboarding:

1. ❌ **Missing: "What is this anyway?"**
   ```typescript
   // User asks after providing name
   messages: [
     { role: 'user', content: 'Sarah Chen' },
     { role: 'bouncer', content: 'Got it, Sarah. Where do you work?' },
     { role: 'user', content: 'wait what is this anyway?' },
   ]
   // Agent should give product explanation from personality prompt
   ```

2. ❌ **Missing: "How does this work?"**
   ```typescript
   { role: 'user', content: 'how does this work?' }
   // Agent explains while keeping conversation moving forward
   ```

3. ❌ **Missing: "Why do you need this?"** (about any field)
   ```typescript
   { role: 'bouncer', content: 'Where do you work?' },
   { role: 'user', content: 'why do you need to know where I work?' },
   // Agent: "Everyone here is a verified industry leader - need to verify your role"
   ```

---

### C. Common User Mistakes

1. ❌ **Missing: Typo + Correction**
   ```typescript
   messages: [
     { role: 'bouncer', content: 'What\'s your name?' },
     { role: 'user', content: 'Sarha Chen' },  // Typo
   ]
   // Agent processes "Sarha Chen"

   messages: [
     // ... next question ...
     { role: 'user', content: 'sorry, Sarah not Sarha' },  // Correction
   ]
   // Agent should understand and update first_name
   ```

2. ❌ **Missing: Multi-part responses**
   ```typescript
   { role: 'bouncer', content: 'What\'s your name?' },
   { role: 'user', content: 'Sarah' },  // Only first name
   { role: 'user', content: 'Chen' },  // Then last name (2 messages)
   // Agent should handle this gracefully
   ```

3. ❌ **Missing: Confused responses**
   ```typescript
   { role: 'bouncer', content: 'Who told you about Yachtparty?' },
   { role: 'user', content: 'I heard about it from a friend' },  // Vague
   // Agent should ask for name: "What's your friend's name?"
   ```

---

### D. Re-engagement Tone Verification

The re-engagement tests verify **timing** and **logic**, but not **bouncer persona**:

✅ Current test checks for:
- `allText.includes('still')` or `'just checking'` (soft tone)

❌ Missing verification for **bouncer-specific language:**
- Should mention "I'm just the bouncer"
- Should say "need to keep the line moving"
- Should NOT say generic re-engagement phrases like "checking in!"

**RECOMMENDATION:** Add tone verification:
```typescript
// For re-engagement at email_verification drop-off:
const hasBou ncerPersona =
  allText.includes('bouncer') ||
  allText.includes('keep the line moving') ||
  allText.includes('move on to the next person');

expect(hasBouncerPersona).toBe(true);
```

---

## Fixture and Helper Recommendations

### Fixture Improvements

1. **Create `createFullOnboardingHistory()` helper:**
   ```typescript
   export function createFullOnboardingHistory(upToStep: OnboardingStep): Message[] {
     // Returns realistic message history showing progression
     // from welcome → referrer → name → company → email verification
   }
   ```

2. **Create `createDropOffScenario()` helper:**
   ```typescript
   export function createDropOffScenario(dropOffPoint: 'referrer' | 'name' | 'company' | 'email_verification') {
     // Returns user state + message history matching the drop-off point
   }
   ```

3. **Add variation helpers:**
   ```typescript
   export function createTypicalUserGreetings(): string[] {
     return ['Hi', 'Hello', 'Hey', 'Hi there', 'yo'];
   }

   export function createTypicalCompanyResponses(): string[] {
     return [
       'Acme Corp, VP of Marketing',
       'I work at Acme Corp as VP of Marketing',
       'VP of Marketing at Acme Corp',
       'Acme - VP Marketing',
     ];
   }
   ```

---

## Priority Test Additions

### MUST ADD (Critical for Production):

1. **Email Verification Drop-off with Re-engagement**
   - User is asked to verify email
   - User says "ok" but doesn't send
   - 25h later: re-engagement message references email verification
   - Message history: COMPLETE onboarding conversation up to email verification

2. **Mid-Process Questions**
   - "What is this anyway?" → Agent explains while staying in character
   - "Why do you need my email?" → Agent explains verification

3. **Typo Corrections**
   - User provides "Sarha Chen" → Agent accepts
   - User corrects to "Sarah" → Agent updates without re-asking

### SHOULD ADD (Important for Quality):

4. **Email Verification Confusion**
   - "What do I write in the email?"
   - "Can I use personal email?"
   - "I'll send it later"

5. **Bouncer Tone in Re-engagement**
   - Verify "bouncer" persona language in re-engagement messages
   - Verify "keep the line moving" framing

### NICE TO HAVE (Enhancement):

6. **Multi-part Responses**
   - User sends first name, then last name in 2 messages
   - Agent waits and processes both

7. **Vague Referrer Responses**
   - "A friend told me" → Agent asks "What's your friend's name?"

---

## Summary: Test Robustness Assessment

| Category | Current State | Target State | Gap Analysis |
|----------|---------------|--------------|--------------|
| **Message History Realism** | ⚠️ 3/10 | 10/10 | Most tests have empty/incomplete history |
| **State-History Match** | ❌ 2/10 | 10/10 | User state doesn't match conversation |
| **Email Drop-off Coverage** | ❌ 1/10 | 10/10 | Missing critical drop-off scenarios |
| **Mid-Process Questions** | ❌ 0/10 | 8/10 | No tests for "what is this?" |
| **User Mistakes** | ❌ 0/10 | 7/10 | No typo/correction tests |
| **Tone Verification** | ✅ 8/10 | 10/10 | Good helpers, missing bouncer-specific |
| **Re-engagement Logic** | ✅ 8/10 | 10/10 | Good timing tests, needs tone verification |

**OVERALL ROBUSTNESS SCORE: 3.5/10** ⚠️

---

## Action Plan

### Phase 1: Fix Existing Tests (HIGH PRIORITY)

1. ✅ Create `createFullOnboardingHistory()` helper
2. ✅ Update all onboarding tests to use realistic message history
3. ✅ Ensure user state matches message history in every test
4. ✅ Fix re-engagement tests to show complete conversation up to drop-off

**Files to Modify:**
- `fixtures.ts` - Add history builder helpers
- `bouncer.onboarding.test.ts` - Update 5 tests with proper history
- `bouncer.reengagement.test.ts` - Update 3 tests with proper history

**Estimated Time:** 2-3 hours

---

### Phase 2: Add Critical Missing Tests (HIGH PRIORITY)

5. ✅ Add email verification drop-off + re-engagement test
6. ✅ Add "What is this anyway?" mid-process question test
7. ✅ Add "Why do you need my email?" question test
8. ✅ Add typo correction test

**Files to Create/Modify:**
- `bouncer.email-verification-dropoff.test.ts` (NEW) - 4-5 tests
- `bouncer.mid-process-questions.test.ts` (NEW) - 3-4 tests
- `bouncer.user-mistakes.test.ts` (NEW) - 2-3 tests

**Estimated Time:** 3-4 hours

---

### Phase 3: Enhance Re-engagement Tests (MEDIUM PRIORITY)

9. ✅ Add bouncer persona verification to re-engagement tests
10. ✅ Add re-engagement at different drop-off points (not just email_verification)

**Files to Modify:**
- `bouncer.reengagement.test.ts` - Add persona checks
- `helpers.ts` - Add `checkBouncerPersona()` helper

**Estimated Time:** 1-2 hours

---

### Phase 4: Add Variation Tests (NICE TO HAVE)

11. ✅ Add multi-part response tests
12. ✅ Add vague referrer response tests
13. ✅ Add different greeting variations

**Files to Create:**
- `bouncer.user-variations.test.ts` (NEW) - 5-6 tests

**Estimated Time:** 2 hours

---

## Conclusion

The Bouncer tests have **good infrastructure** (fixtures, helpers) but **critical gaps** in:

1. **Realistic message history** - Most tests don't build proper conversation context
2. **Email verification drop-off** - Missing tests for the #1 drop-off point
3. **Mid-process questions** - No tests for users asking "what is this?"
4. **User mistakes** - No tests for typos, corrections, multi-part responses

**RECOMMENDATION:** Prioritize Phase 1 and Phase 2 immediately. These are **production-critical** for the front-line UX. The Bouncer must be bulletproof because users who don't complete onboarding never reach the platform.

---

**Next Step:** Review this analysis, prioritize fixes, and implement Phase 1 + Phase 2.
