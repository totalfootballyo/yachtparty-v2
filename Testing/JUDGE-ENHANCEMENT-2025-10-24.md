# Judge Agent Enhancement - October 24, 2025

## Problem Identified

The judge was unable to see the LLM's reasoning when evaluating re-engagement decisions:

1. **Data was logged** to `agent_actions_log.output_data` (including `reasoning` field)
2. **Data was NOT retrieved** by `ConversationRunner.collectDatabaseContext()`
3. **Judge was blind** to WHY the agent made decisions

## Changes Made

### 1. Data Collection Enhancement

**File:** `Testing/framework/ConversationRunner.ts:138`

```typescript
// BEFORE
.select('action_type, created_at, input_data')

// AFTER
.select('action_type, created_at, input_data, output_data')
```

**Impact:** Judge now sees all decision-making data including LLM reasoning.

### 2. TypeScript Interface Update

**File:** `Testing/framework/JudgeAgent.ts:24`

```typescript
export interface DatabaseContext {
  agentActionsLogged?: Array<{
    action_type: string;
    created_at: string;
    input_data?: any;
    output_data?: any;  // ✅ Added - Contains LLM reasoning, decision details, metrics
  }>;
  // ...
}
```

### 3. Context Display Enhancement

**File:** `Testing/framework/JudgeAgent.ts:148-154`

Judge now displays:
- Input data
- Output data
- **Highlighted reasoning** when present: `🧠 Agent Reasoning: "..."`

**Example output the judge sees:**
```
Agent Actions Logged:
- re_engagement_decision_no_message at 2025-10-24T18:15:00.000Z
  Input: {"daysSinceLastMessage":7,"priorityCount":2}
  Output: {"reasoning":"User has sparse conversation history...","extendDays":14}
  🧠 Agent Reasoning: "User has sparse conversation history with no clear engagement patterns. Re-engagement at this time may feel intrusive."
```

### 4. Evaluation Criteria - Business/User Balance

**File:** `Testing/framework/JudgeAgent.ts:215-239`

Added sophisticated evaluation framework for re-engagement decisions:

**Two Competing Priorities:**

1. **User Empathy (Avoid Spam):**
   - High-value business leaders will delete apps that bombard them
   - Low-value opportunities (weak connections, small bounties) should NOT warrant re-engagement
   - Sparse conversation history suggests low engagement - agent should be conservative
   - Appropriate restraint is GOOD

2. **Business Needs (Drive Revenue):**
   - Revenue-generating actions are critical: intros, connection requests
   - High-value opportunities (strong connections, large bounties, vouched requests) SHOULD warrant outreach
   - Users with active goals and engaged history represent investment that needs nurturing
   - Being too conservative with compelling opportunities is BAD

**Decision Matrix:**

| Context | Opportunity Value | Expected Decision | Judge Evaluation |
|---------|------------------|-------------------|------------------|
| Sparse  | Low-value        | No message        | ✅ CORRECT       |
| Sparse  | Low-value        | Message sent      | ❌ SPAM RISK     |
| Rich    | High-value       | Message sent      | ✅ CORRECT       |
| Rich    | High-value       | No message        | ❌ MISSED OPP    |

**Judge Instructions:**
> "Judge with taste, not rules. Look for the agent's reasoning in output_data to understand its decision-making."

## Calibration Strategy

The judge prompt introduces subjective evaluation ("taste") rather than hard rules. This is intentional:

1. **Variety of Scenarios:** Running many test scenarios will expose the judge to edge cases
2. **Observable Reasoning:** With access to LLM reasoning, judge can evaluate decision quality
3. **Iterative Refinement:** Judge criteria can be tuned based on test results over time
4. **Business Alignment:** Judge balances user retention (anti-spam) with revenue generation (engagement)

## What This Enables

### For Passing Tests
Tests can now distinguish between:
- ✅ **Appropriate conservatism:** Agent correctly declines low-value re-engagement
- ❌ **Over-conservatism:** Agent misses compelling opportunities

### For Debugging
When tests fail, we can now see:
- Agent's reasoning for the decision
- Input context (daysSinceLastMessage, priorityCount, etc.)
- Output metrics (extendDays, threadsAddressed, etc.)

### For Production Confidence
- Validates that LLM social judgment is working as designed
- Ensures agents protect users from spam while capturing revenue opportunities
- Provides audit trail of decision-making for analysis

## Key Insight

**Re-engagement decisions are NOT binary pass/fail.** The judge now evaluates whether the decision was *appropriate given the context*, which aligns with the sophisticated social judgment we've built into the system.

This reflects the reality that our users are high-value business leaders who:
- Will delete apps that spam them (need conservative behavior)
- Represent significant revenue potential (need proactive engagement with valuable opportunities)

The judge's "taste" mirrors the taste we expect from the agent itself.

## Files Modified

1. `Testing/framework/ConversationRunner.ts` - Data collection
2. `Testing/framework/JudgeAgent.ts` - Interface and prompt
3. `Testing/JUDGE-ENHANCEMENT-2025-10-24.md` - This document

## Next Steps

1. Run tests with enhanced judge to see actual reasoning
2. Observe judge evaluations across variety of scenarios
3. Refine decision matrix thresholds if needed
4. Consider adding explicit context/value scoring to test scenarios
