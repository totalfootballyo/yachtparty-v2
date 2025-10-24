# Agent Hallucination Analysis
## Test Results Comparison: Concierge vs Innovator

**Date:** October 20, 2025
**Test Suite:** E2E tests with real LLM calls
**Issue:** Innovator agent producing dangerous hallucinations

---

## 🚨 CRITICAL FINDINGS

### 1. Innovator Hallucinates People That Don't Exist

**Test:** Typo Correction Test (`multi-message.test.ts`)

**Context:**
- User asks: "Can you introduce me to someone at Roku?"
- Agent asks: "Who specifically?"
- User says: "Bran" then corrects to "Brian"
- Test data: **ZERO intro opportunities** (empty arrays)

**Results:**

| Agent | Response | Analysis |
|-------|----------|----------|
| **Concierge** | "Got it. Let me see if I can make that intro happen." | ✅ **Appropriate** - Acknowledges request without committing or fabricating |
| **Innovator** | "I can connect you with **Brian Martinez at Roku**. He leads their advertising platform partnerships. Handles deals with streaming services and ad tech companies." | ❌ **DANGEROUS** - Completely fabricated person, role, and bio |

---

### 2. Innovator Hallucinates Intro Details

**Test:** Topic Change Detection Test (`multi-message.test.ts`)

**Context:**
- User asks: "Actually, do you know anyone at Hulu?"
- Test data: Has ONE intro opportunity for "Sarah Chen at Hulu" in fixtures (for testing)

**Results:**

| Agent | Response | Analysis |
|-------|----------|----------|
| **Concierge** | "Got it. Let me see if I can make that intro happen." | ✅ **Appropriate** - Generic acknowledgment |
| **Innovator** | "I can connect you with **Sarah Chen at Hulu**. **She scaled their CTV platform from 0 to $500M.** Worth a conversation?" | ❌ **DANGEROUS** - Fabricated bio and achievements |

**Critical Issues:**
1. ❌ Commits to intro before consent ("I can connect you with...")
2. ❌ Names person before they've agreed to intro
3. ❌ Fabricates detailed bio ($0 to $500M)
4. ❌ Violates privacy - shouldn't reveal people on platform until they agree

---

### 3. Innovator Hallucinates Context

**Test:** Initial CTV Request (`inherited-smoke.test.ts`)

**User Message:**
```
"Do you know anyone who has experience with CTV advertising platforms?
I'd love to get recommendations from someone who's used them."
```

**NO budget or integration requirements mentioned.**

**Innovator Response:**
```
"Got it. I'll ask around the community for CTV platform recommendations and
get back to you in the next day or two. With THAT BUDGET and INTEGRATION NEEDS,
you'll want to hear from someone who's actually run campaigns at scale."
```

❌ References "that budget" - **never mentioned**
❌ References "integration needs" - **never mentioned**

---

### 4. Innovator Makes Assumptions vs Asking Clarifying Questions

**Test:** Unclear Response (`multi-message.test.ts`)

**Context:**
- User asks about "platforms" in CTV advertising context
- Could mean: ad platforms, content platforms, vendors, partners, etc.

**Innovator Response:**
```
"I'll research CTV advertising platforms that can help you scale and get back
to you with some solid options. What's your current monthly ad spend range?"
```

❌ Assumed user wants to advertise (vs sell to platforms, partner with, etc.)
❌ Asked for budget info - **against policy**

---

### 5. More Concerning Patterns

**Timing Promises:** 9 instances of overly specific timing
- "next day or two"
- "within the next couple days"
- "Should have some connections for you within the next day or two"

**Budget References:** Multiple references to budgets that don't exist
- "Found 3 CTV platforms that fit YOUR BUDGET" (no budget mentioned)
- "who work with THAT BUDGET LEVEL" (no budget mentioned)

---

## 📊 Statistical Summary

### Hallucination Comparison

| Issue Type | Concierge | Innovator |
|------------|-----------|-----------|
| Fabricated People | 0 | 2+ |
| Fabricated Bios | 0 | 2+ |
| Premature Intro Commitments | 0 | 2+ |
| Context Hallucinations | 0 | 5+ |
| Policy Violations (budget asks) | 0 | 1+ |

### Test Pass Rates (Mechanical)
- Bouncer: 79% (19/24)
- Concierge: 83% (34/41)
- Innovator: 90% (37/41)

**NOTE:** These pass rates are measuring test mechanics (tool selection, message format), NOT output quality. Many "passed" tests contain dangerous hallucinations.

---

## 🔍 Root Cause Analysis

### Why is Innovator Hallucinating More Than Concierge?

**Identical Settings:**
- ✅ Same temperature (0.7 for Call 2)
- ✅ Same model (claude-sonnet-4-20250514)
- ✅ Same tone guidelines (no exclamations, brief, etc.)

**Potential Causes:**

1. **Different Prompt Extension**
   - Innovator has additional system prompt about being "business-focused" and "professional partner tone"
   - May be encouraging more confident/assertive responses

2. **Test Fixture Contamination**
   - Some tests use `createIntroOpportunities()` helper which creates fake people
   - Innovator may be latching onto these patterns more than Concierge

3. **Higher Confidence in Business Context**
   - Innovator persona may feel more empowered to make business commitments
   - Concierge may be more naturally cautious

---

## ✅ Recommended Actions

### Immediate (Critical)

1. **Add Hallucination Guards to Prompts**
   ```
   CRITICAL: NEVER fabricate or invent:
   - People who don't exist in provided intro_opportunities
   - Job titles, companies, or bios for people
   - Budget numbers, metrics, or context not explicitly stated by user
   - Commitments about introductions before consent is obtained

   If user asks for intro to "Brian at Roku":
   ✅ CORRECT: "Let me check if we have connections at Roku"
   ❌ WRONG: "I can connect you with Brian Martinez who leads..."
   ```

2. **Add Privacy/Consent Rules**
   ```
   INTRO PROTOCOL:
   1. NEVER name specific people until they've agreed to intro
   2. NEVER commit to intros ("I can connect you...") before consent
   3. FIRST check if connection exists
   4. THEN create intro opportunity (which notifies potential connector)
   5. ONLY reveal names after both sides agree
   ```

3. **Add Context Validation**
   ```
   Before referencing information, verify:
   - Was this explicitly stated by user?
   - Is this in the provided data (priorities, profile, etc.)?
   - Or am I inferring/assuming?

   NEVER reference: "that budget", "your integration needs", "given your timeline"
   unless user explicitly mentioned these.
   ```

### Short-Term (Important)

4. **Manual Output Review Process**
   - All test runs must include manual review of agent responses
   - Tests passing ≠ safe outputs
   - Create hallucination checklist for each test run

5. **Update Test Assertions**
   - Current tests only check tool selection, not response content
   - Add assertions for hallucination patterns
   - Example: `expect(response.messages).not.toMatch(/I can connect you with/)`

6. **Lower Temperature for Innovator Call 2**
   - Try 0.5 instead of 0.7
   - See if more conservative responses reduce hallucinations

### Medium-Term (Strategic)

7. **Separate "Check If We Have Intro" from "Offer Intro"**
   - Two-step process: search → consent → reveal
   - Never combine into one response

8. **Add Self-Reflection Step**
   - After Call 2, ask LLM: "Did you reference any information not provided?"
   - Catch hallucinations before they're sent

9. **Create Hallucination Test Suite**
   - Specific tests that try to trigger hallucinations
   - Measure false positive rate (making up people/context)

---

## 📝 Test Output Locations

**Full outputs saved to:**
```bash
/Users/bt/Desktop/CODE/Yachtparty v.2/test-outputs/
├── bouncer-results-[timestamp].log
├── concierge-results-[timestamp].log
└── innovator-results-[timestamp].log
```

**Search for issues:**
```bash
# Find all "I can connect you" commitments
grep -i "i can connect" test-outputs/*.log

# Find fabricated budget references
grep -i "that budget\|your budget" test-outputs/*.log

# Find fabricated people
grep -B 5 -A 5 "Brian Martinez\|Sarah Chen" test-outputs/*.log
```

---

## 🎯 Success Criteria (To Validate Fixes)

Before deploying to production:

- [ ] **Zero fabricated people** in test outputs
- [ ] **Zero fabricated bios/credentials**
- [ ] **Zero premature intro commitments** ("I can connect you...")
- [ ] **Zero context hallucinations** (budget, timeline references without user input)
- [ ] **Zero policy violations** (asking for budget, etc.)
- [ ] **Manual review** of all test outputs confirms safe responses
- [ ] **Re-run tests 3 times** to confirm consistency (accounting for LLM non-determinism)

---

## 📚 Reference: Concierge vs Innovator Prompt Comparison

| Aspect | Concierge | Innovator |
|--------|-----------|-----------|
| Base Prompt | "Helpful and capable. Think competent assistant, not cheerleader." | Same + "Professional partner tone" |
| Temperature (Call 2) | 0.7 | 0.7 |
| Tone Guidelines | "NO exclamation points, NO superlatives, Be helpful not fawning" | Same + "More business-focused, ROI-oriented" |
| Special Instructions | None | "Emphasize conversion rates, intro quality, pipeline metrics" |

**Hypothesis:** The "professional partner" and "business-focused" language may be causing Innovator to be more assertive and hallucinate business details.
