# Concierge Agent Testing

## Overview

This directory contains test infrastructure and smoke tests for the Concierge Agent's 2-LLM architecture.

## Test Structure

### Fixtures (`fixtures.ts`)
Reusable test data builders for:
- User profiles with various characteristics
- Conversation histories (engaged, frustrated, terse)
- Priorities with different value scores
- Outstanding community requests

**Key Functions:**
- `createTestUser()` - Build user with configurable properties
- `createTestConversation()` - Build test conversation
- `createTestMessages()` - Generate conversation patterns
- `createTestPriorities()` - Generate priorities by value tier
- `createTestScenario()` - Complete scenarios (happy_path, multi_thread, user_frustrated)

### Helpers (`helpers.ts`)
2-LLM verification utilities:

**Call 1 Verification:**
- `verifyCall1Decision()` - Assert correct tools, scenario, tone, context
- `verifyReengagementDecision()` - Assert should_message logic, extend_days, threads

**Call 2 Verification:**
- `verifyCall2Messages()` - Assert message count, sequences, tone, length
- `verifyAgentResponse()` - Assert response structure, actions, events

**Tone Checkers:**
- `checkToneHelpfulNotOvereager()` - Verify no excessive enthusiasm
- `checkToneBrief()` - Verify concise messaging (≤4 sentences)

## Smoke Tests (Week 4)

Basic tests to validate 2-LLM architecture works:

1. **Happy Path: User Message** (`concierge.smoke.test.ts`)
   - User asks a question
   - Call 1 selects `publish_community_request` tool
   - Call 2 composes acknowledgment message
   - Verifies: Tool selection, message tone, no exclamations

2. **Re-engagement: Multi-Thread** (`concierge.smoke.test.ts`)
   - Multiple priorities (high + medium)
   - Outstanding community request
   - Call 1 decides to message with 2-3 threads
   - Call 2 creates message sequence
   - Verifies: should_message=true, thread selection, sequence parsing

3. **Re-engagement: User Frustrated** (`concierge.smoke.test.ts`)
   - Conversation shows user frustration
   - Multiple high-value priorities available
   - Call 1 decides NOT to message
   - Task extended by 60-90 days
   - Verifies: should_message=false, reasoning, extend_days

## Comprehensive Tests (Week 6)

After Innovator is implemented, expand to:

### Concierge Test Scenarios (10-15 tests)
- All 5 tools (publish_community_request, request_solution_research, create_intro_opportunity, store_user_goal, record_community_response)
- Multi-threading with 2-3+ threads
- Social judgment edge cases (subtle frustration, overwhelmed, eager)
- Message sequence variations (single, sequence_2, sequence_3)
- Self-reflection (leaked JSON detection)

### Bouncer Test Scenarios (8-10 tests)
- Onboarding paths (eager, reluctant, confused)
- Re-engagement (1st attempt, 2nd attempt, pause after 3rd)
- Profile extraction accuracy
- Goal detection

### Innovator Test Scenarios (12-15 tests)
- All 9 tools
- Complex workflows
- Multi-agent coordination

### Integration Tests
- End-to-end flows (user → twilio-webhook → agent → SMS)
- Cross-agent communication (events)
- Task scheduling and execution

## Running Tests

```bash
# Run all tests
npm test

# Run smoke tests only
npm test -- concierge.smoke.test.ts

# Run with coverage
npm test -- --coverage

# Watch mode
npm test -- --watch
```

## Mocking Strategy (Week 6)

### Anthropic API
Mock LLM responses for deterministic testing:
```typescript
jest.mock('@anthropic-ai/sdk');
```

### Supabase
Mock database calls with in-memory data:
```typescript
jest.mock('@yachtparty/shared', () => ({
  createServiceClient: jest.fn(),
}));
```

### Test Isolation
Each test should:
1. Set up fresh fixtures
2. Mock external dependencies
3. Verify Call 1 and Call 2 independently
4. Clean up state

## Success Criteria

Tests pass when:
- ✅ Call 1 selects correct tools (95%+ accuracy)
- ✅ Call 1 makes correct re-engagement decisions (no_message when appropriate)
- ✅ Call 2 maintains personality (no JSON leaks, no exclamations)
- ✅ Message sequences parse correctly (split by "---")
- ✅ Tone is brief and helpful (not overeager)
- ✅ All tool parameters are complete and valid
- ✅ Re-engagement extends tasks appropriately (7-90 days)
- ✅ Social judgment detects frustration
- ✅ Multi-threading addresses 2-3 topics naturally
