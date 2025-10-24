# E2E Simulation Testing Implementation Plan

**Date:** October 22, 2025
**Status:** Phase 2 Complete, Moving to Phase 3
**Goal:** Implement end-to-end simulation testing with synthetic user personas, judge agent evaluation, and realistic database state testing

Test DB Info:
Supabase yachtparty-test
password: HJXQ6ODO7hfWanUn
Reference: igxwsyvmffcvxbqmrwpc

If needed in future:

# Dump from production
supabase link --project-ref [prod-ref]
supabase db dump --linked --schema public -f schema.sql

# Restore to test
supabase link --project-ref [test-ref]
psql --file schema.sql --dbname [test-connection-string]


---

## Executive Summary

This plan implements a comprehensive E2E simulation testing infrastructure that tests agents against realistic conversation flows with synthetic user personas. The approach involves:

1. **Complete Supabase client parameterization** across all agents and helper functions
2. **Hosted test database** (Supabase) with full schema mirroring production
3. **Simulation test framework** with synthetic user personas powered by Claude API
4. **Judge agent** for automated conversation quality evaluation
5. **Timestamp manipulation utilities** for re-engagement timing tests
6. **Test organization** in `/Testing` directory, separate from unit tests

**Critical Decision:** We are doing this RIGHT THE FIRST TIME across ALL agents (Bouncer, Concierge, Innovator) to avoid incomplete parameterization and future refactoring.

---

## Part 1: Architecture Audit - What Needs to Change

### 1.1 Agent Entry Points

All three agents need parameterization to accept optional test database client:

| File | Function | Current Signature | New Signature |
|------|----------|------------------|---------------|
| `packages/agents/bouncer/src/index.ts` | `invokeBouncerAgent` | `(message, user, conversation)` | `(message, user, conversation, dbClient?)` |
| `packages/agents/concierge/src/index.ts` | `invokeConciergeAgent` | `(message, user, conversation)` | `(message, user, conversation, dbClient?)` |
| `packages/agents/innovator/src/index.ts` | `invokeInnovatorAgent` | `(message, user, conversation)` | `(message, user, conversation, dbClient?)` |
| `packages/agents/account-manager/src/index.ts` | `invokeAccountManagerAgent` | `(trigger, context)` | `(trigger, context, dbClient?)` |

**Default behavior:** If `dbClient` is not provided, defaults to `createServiceClient()` (production database).

### 1.2 Context Loading Functions

Each agent has a context loading function that queries the database:

| File | Function | Current Usage | Needs Parameterization |
|------|----------|---------------|----------------------|
| `bouncer/src/index.ts:190` | `loadBouncerContext()` | Creates own `createServiceClient()` | ✅ Yes |
| `concierge/src/index.ts` | `loadConciergeContext()` | Creates own `createServiceClient()` | ✅ Yes |
| `innovator/src/index.ts` | `loadInnovatorContext()` | Creates own `createServiceClient()` | ✅ Yes |

**Pattern:**
```typescript
// BEFORE
async function loadBouncerContext(user, conversation) {
  const supabase = createServiceClient();  // ❌ Always production
  const { data: messages } = await supabase.from('messages')...
}

// AFTER
async function loadBouncerContext(
  user,
  conversation,
  dbClient = createServiceClient()  // ✅ Default to production
) {
  const { data: messages } = await dbClient.from('messages')...
}
```

### 1.3 Tool Execution Functions

Each agent has a tool execution function that performs database writes:

| File | Function | Database Operations | Needs Parameterization |
|------|----------|-------------------|----------------------|
| `bouncer/src/index.ts:530` | `executeBouncerTools()` | Updates users, creates nominations | ✅ Yes |
| `concierge/src/index.ts` | `executeTools()` | Creates tasks, updates priorities | ✅ Yes |
| `innovator/src/index.ts` | `executeTools()` | Creates intro offers, updates priorities | ✅ Yes |

**Key Insight:** These functions create their OWN `createServiceClient()` instances. Must be parameterized.

### 1.4 Helper Functions (Bouncer)

**File:** `packages/agents/bouncer/src/onboarding-steps.ts`

| Function | Database Operations | Line | Needs Param |
|----------|-------------------|------|-------------|
| `checkOnboardingProgress()` | None (pure logic) | 46 | ❌ No |
| `collectUserInfo()` | Updates `users` table | ~100 | ✅ Yes |
| `generateVerificationEmail()` | None (pure logic) | ~150 | ❌ No |
| `completeOnboarding()` | Updates `users` table, triggers prospect upgrade | ~200 | ✅ Yes |
| `createReengagementTask()` | Inserts into `scheduled_tasks` | ~250 | ✅ Yes |
| `storeNomination()` | Inserts into `intro_opportunities` | ~300 | ✅ Yes |
| `lookupUserByName()` | Queries `users` table | ~350 | ✅ Yes |

### 1.5 Helper Functions (Concierge/Innovator)

**File:** `packages/agents/concierge/src/community-response.ts`

| Function | Database Operations | Needs Param |
|----------|-------------------|-------------|
| `handleCommunityResponse()` | Queries messages, publishes events | ✅ Yes |

**File:** Similar patterns in Innovator for intro flows

### 1.6 Shared Utilities

**File:** `packages/shared/src/utils/events.ts`

| Function | Current | Needs Change |
|----------|---------|--------------|
| `publishEvent()` | Creates own client | ✅ Parameterize |
| `createAgentTask()` | Creates own client | ✅ Parameterize |

**File:** `packages/shared/src/utils/prospect-upgrade.ts`

| Function | Current | Needs Change |
|----------|---------|--------------|
| `upgradeProspectsToUser()` | Creates own client | ✅ Parameterize |
| `shouldTriggerProspectUpgrade()` | Creates own client | ✅ Parameterize |
| `markProspectUpgradeChecked()` | Creates own client | ✅ Parameterize |

---

## Part 2: Parameterization Strategy

### 2.1 Core Principle: Backward Compatible Defaults

**Every function gets optional `dbClient` parameter with production default:**

```typescript
async function anyFunction(
  ...existingParams,
  dbClient = createServiceClient()  // ✅ Always defaults to production
) {
  // Use dbClient instead of creating new client
  const { data } = await dbClient.from('table')...
}
```

**Benefits:**
- ✅ Zero breaking changes for existing code
- ✅ Production services continue working without modification
- ✅ Test code can inject test database client
- ✅ Clear intent: optional param signals "this is for testing"

### 2.2 Cascading Parameters

Agent entry points pass `dbClient` down the call chain:

```typescript
// Entry point
async function invokeBouncerAgent(
  message, user, conversation,
  dbClient = createServiceClient()
) {
  // Pass to context loader
  const context = await loadBouncerContext(user, conversation, dbClient);

  // Pass to tool executor
  const { actions, events } = await executeBouncerTools(toolUses, context, dbClient);

  // Pass to helper functions
  await collectUserInfo(user.id, fields, dbClient);
}

// Context loader
async function loadBouncerContext(user, conversation, dbClient = createServiceClient()) {
  const { data: messages } = await dbClient.from('messages')...
  return { user, conversation, messages };
}

// Tool executor
async function executeBouncerTools(toolUses, context, dbClient = createServiceClient()) {
  for (const tool of toolUses) {
    await collectUserInfo(userId, fields, dbClient);  // Pass down
  }
}

// Helper function
async function collectUserInfo(userId, fields, dbClient = createServiceClient()) {
  await dbClient.from('users').update(fields).eq('id', userId);
}
```

### 2.3 Files to Modify (Complete List)

**Agent Entry Points (4 files):**
1. `packages/agents/bouncer/src/index.ts`
2. `packages/agents/concierge/src/index.ts`
3. `packages/agents/innovator/src/index.ts`
4. `packages/agents/account-manager/src/index.ts`

**Agent Helper Functions (3 files):**
5. `packages/agents/bouncer/src/onboarding-steps.ts`
6. `packages/agents/concierge/src/community-response.ts`
7. (Innovator intro flow helpers if they exist)

**Shared Utilities (3 files):**
8. `packages/shared/src/utils/events.ts`
9. `packages/shared/src/utils/prospect-upgrade.ts`
10. `packages/shared/src/utils/prospect-upload.ts` (if needed)

**Services (NOT MODIFIED):**
- `twilio-webhook` - No changes needed (production only)
- `task-processor` - No changes needed (production only)
- `event-processor` - No changes needed (production only)

**Total: ~10 files to modify**

---

## Part 3: Test Database Infrastructure

### 3.1 Hosted Supabase Test Instance

**Setup:**
1. Create new Supabase project: `yachtparty-test`
2. Run all production migrations to mirror schema
3. Create seed scripts for synthetic user personas
4. Store credentials in `.env.test` (gitignored)

**Environment Variables:**
```bash
# .env.test (gitignored)
SUPABASE_TEST_URL="https://xyz.supabase.co"
SUPABASE_TEST_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
SUPABASE_TEST_SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
ANTHROPIC_API_KEY="sk-ant-api03-..."
```

### 3.2 Test Database Client Factory

**File:** `packages/shared/src/utils/test-db.ts` (NEW)

```typescript
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

/**
 * Creates Supabase client for test database.
 * Reads from SUPABASE_TEST_URL and SUPABASE_TEST_SERVICE_KEY.
 */
export function createTestDbClient() {
  const url = process.env.SUPABASE_TEST_URL;
  const key = process.env.SUPABASE_TEST_SERVICE_KEY;

  if (!url || !key) {
    throw new Error('SUPABASE_TEST_URL and SUPABASE_TEST_SERVICE_KEY required for simulation tests');
  }

  return createClient<Database>(url, key, {
    auth: { persistSession: false }
  });
}
```

### 3.3 Database Reset Utilities

**File:** `Testing/utils/db-reset.ts` (NEW)

**Design Philosophy:** Support both single-user tests AND multi-user cohort simulations

```typescript
import { createTestDbClient } from '@yachtparty/shared';

/**
 * Test cohort/batch identifier.
 * Stored in user.metadata.test_batch_id to enable selective cleanup.
 */
export type TestBatchId = string;

/**
 * Resets ENTIRE test database to clean state.
 * Use sparingly - prefer resetTestBatch() for isolation.
 *
 * WARNING: Deletes ALL test data including persistent fixture users.
 */
export async function resetTestDatabase() {
  const db = createTestDbClient();

  // Delete in correct order (respecting foreign keys)
  await db.from('messages').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await db.from('user_priorities').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await db.from('intro_opportunities').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await db.from('scheduled_tasks').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await db.from('conversations').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await db.from('users').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await db.from('events').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  console.log('✅ Test database fully reset (ALL data deleted)');
}

/**
 * Resets only users/conversations from a specific test batch.
 *
 * Enables multi-user simulation scenarios:
 * - Batch A: Single-user Bouncer onboarding tests
 * - Batch B: Multi-user community request dynamics
 * - Batch C: Intro flow cross-user interactions
 * - Fixture users: Persist across tests (no batch ID)
 *
 * @param batchId - Test batch identifier (e.g., "bouncer-happy-path-20251022")
 */
export async function resetTestBatch(batchId: TestBatchId) {
  const db = createTestDbClient();

  // Find all users in this batch
  const { data: batchUsers } = await db
    .from('users')
    .select('id')
    .eq('metadata->>test_batch_id', batchId);

  if (!batchUsers || batchUsers.length === 0) {
    console.log(`No users found for batch: ${batchId}`);
    return;
  }

  const userIds = batchUsers.map(u => u.id);

  // Delete conversations and related data for batch users
  const { data: conversations } = await db
    .from('conversations')
    .select('id')
    .in('user_id', userIds);

  const conversationIds = conversations?.map(c => c.id) || [];

  // Delete in correct order
  if (conversationIds.length > 0) {
    await db.from('messages').delete().in('conversation_id', conversationIds);
    await db.from('scheduled_tasks').delete().filter('metadata->>conversation_id', 'in', `(${conversationIds.join(',')})`);
  }

  await db.from('user_priorities').delete().in('user_id', userIds);
  await db.from('intro_opportunities').delete().in('created_by', userIds);
  await db.from('conversations').delete().in('user_id', userIds);
  await db.from('users').delete().in('id', userIds);
  await db.from('events').delete().in('aggregate_id', userIds);

  console.log(`✅ Deleted ${userIds.length} users from batch: ${batchId}`);
}

/**
 * Creates persistent fixture users that survive test resets.
 * Used for multi-user scenarios where some users are "established members"
 * and new test users interact with them.
 *
 * Example: Senior leader user who receives intro requests from test personas
 *
 * @returns User IDs of created fixtures
 */
export async function seedFixtureUsers(): Promise<string[]> {
  const db = createTestDbClient();

  const fixtures = [
    {
      phone: '+15551000001',
      first_name: 'Sarah',
      last_name: 'Chen',
      company: 'Venture Capital Partners',
      title: 'Managing Partner',
      verified: true,
      innovator: true,
      poc_agent_type: 'innovator',
      expertise: 'Series A-C fundraising, SaaS go-to-market',
      // NO test_batch_id - persists across tests
      metadata: { fixture: true, persona: 'senior_leader' }
    },
    {
      phone: '+15551000002',
      first_name: 'Marcus',
      last_name: 'Johnson',
      company: 'TechCorp',
      title: 'CTO',
      verified: true,
      innovator: true,
      poc_agent_type: 'innovator',
      expertise: 'Enterprise infrastructure, engineering leadership',
      metadata: { fixture: true, persona: 'frustrated_senior_leader' }
    },
    {
      phone: '+15551000003',
      first_name: 'Alex',
      last_name: 'Rivera',
      company: 'StartupCo',
      title: 'VP Sales',
      verified: true,
      innovator: true,
      poc_agent_type: 'innovator',
      expertise: 'B2B sales, enterprise deals',
      metadata: { fixture: true, persona: 'over_eager_sales' }
    }
  ];

  const createdIds: string[] = [];

  for (const fixture of fixtures) {
    // Check if fixture already exists
    const { data: existing } = await db
      .from('users')
      .select('id')
      .eq('phone', fixture.phone)
      .single();

    if (existing) {
      createdIds.push(existing.id);
      continue;
    }

    // Create fixture user
    const { data: created } = await db
      .from('users')
      .insert({
        ...fixture,
        status: 'active',
        created_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (created) {
      createdIds.push(created.id);
    }
  }

  console.log(`✅ Seeded ${createdIds.length} fixture users (persistent across tests)`);
  return createdIds;
}

/**
 * Generates unique test batch ID based on timestamp.
 * Use for grouping test users in multi-user scenarios.
 */
export function generateTestBatchId(prefix: string = 'test'): TestBatchId {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
```

### 3.4 Timestamp Manipulation Utilities

**File:** `Testing/utils/time-travel.ts` (NEW)

```typescript
import { createTestDbClient } from '@yachtparty/shared';

/**
 * Shifts all timestamps in a conversation backward by specified hours.
 * Preserves message order and relative timing.
 *
 * USE CASE: Testing "should re-engage after 24 hours" scenarios
 */
export async function shiftConversationTimestamps(
  conversationId: string,
  hoursBackward: number
) {
  const db = createTestDbClient();

  // CRITICAL: Only works on test database
  if (!process.env.SUPABASE_TEST_URL?.includes('test')) {
    throw new Error('shiftConversationTimestamps can ONLY be used on test database');
  }

  const offset = `${hoursBackward} hours`;

  // Shift conversation timestamps
  await db.rpc('shift_conversation_timestamps', {
    conversation_id: conversationId,
    hours_offset: hoursBackward
  });
}

/**
 * Sets current time for testing time-sensitive logic.
 * Returns cleanup function to restore real time.
 */
export function mockCurrentTime(isoTimestamp: string) {
  const originalDateNow = Date.now;
  const mockedTime = new Date(isoTimestamp).getTime();

  Date.now = () => mockedTime;

  return () => {
    Date.now = originalDateNow;
  };
}
```

**Database Function:** (Add to migrations)
```sql
CREATE OR REPLACE FUNCTION shift_conversation_timestamps(
  conversation_id uuid,
  hours_offset integer
) RETURNS void AS $$
BEGIN
  -- Shift messages
  UPDATE messages
  SET created_at = created_at - (hours_offset || ' hours')::interval,
      sent_at = sent_at - (hours_offset || ' hours')::interval
  WHERE conversation_id = conversation_id;

  -- Shift conversation
  UPDATE conversations
  SET created_at = created_at - (hours_offset || ' hours')::interval,
      updated_at = updated_at - (hours_offset || ' hours')::interval,
      last_message_at = last_message_at - (hours_offset || ' hours')::interval
  WHERE id = conversation_id;

  -- Shift scheduled tasks
  UPDATE scheduled_tasks
  SET scheduled_for = scheduled_for - (hours_offset || ' hours')::interval,
      created_at = created_at - (hours_offset || ' hours')::interval
  WHERE metadata->>'conversation_id' = conversation_id::text;
END;
$$ LANGUAGE plpgsql;
```

---

## Part 4: Simulation Test Framework

### 4.1 Test Organization

```
Testing/
├── personas/                  # Synthetic user definitions
│   ├── bouncer-personas.ts   # Onboarding personas
│   │   ├── eager-eddie.ts
│   │   ├── skeptical-sam.ts
│   │   ├── busy-barbara.ts
│   │   ├── terse-tony.ts
│   │   └── confused-charlie.ts
│   └── community-personas.ts  # Multi-user personas
│       ├── over-eager-sales.ts
│       ├── frustrated-senior-leader.ts
│       ├── community-spammer.ts
│       └── lurker-luke.ts
│
├── scenarios/                 # Test scenarios by agent
│   ├── bouncer/
│   │   ├── happy-path-onboarding.test.ts
│   │   ├── email-verification-dropoff.test.ts
│   │   ├── mid-process-questions.test.ts
│   │   └── reengagement-timing.test.ts
│   ├── concierge/
│   │   └── community-request-flow.test.ts
│   ├── innovator/
│   │   └── intro-offer-acceptance.test.ts
│   └── community/              # Multi-user scenarios
│       ├── multi-user-dynamics.test.ts
│       └── intro-coordination.test.ts
│
├── framework/                 # Test infrastructure
│   ├── SimulatedUser.ts      # User persona simulator
│   ├── JudgeAgent.ts         # Conversation evaluator
│   ├── ConversationRunner.ts # Orchestrates test flow
│   └── TestReporter.ts       # Saves transcripts, scores
│
├── utils/                     # Test utilities
│   ├── db-reset.ts           # Batch cleanup, fixture seeding
│   ├── time-travel.ts        # Timestamp manipulation
│   └── seed-data.ts
│
└── transcripts/              # Test outputs (gitignored)
    └── 2025-10-22/
        ├── bouncer-happy-path-eager-eddie.md
        ├── bouncer-happy-path-skeptical-sam.md
        ├── community-multi-user-dynamics.md
        └── judge-scores.json
```

### 4.2 Synthetic User Persona

**File:** `Testing/personas/eager-eddie.ts`

```typescript
import Anthropic from '@anthropic-ai/sdk';

export interface SimulatedPersona {
  name: string;
  personality: string;
  systemPrompt: string;
  initialContext: {
    referrer?: string;
    company?: string;
    expertise?: string;
  };
}

export const EAGER_EDDIE: SimulatedPersona = {
  name: 'Eager Eddie',
  personality: 'Enthusiastic early adopter who over-shares information and asks questions',

  systemPrompt: `You are Eddie, a enthusiastic tech executive testing a new professional networking service.

Personality traits:
- Very eager to try new things
- Tends to over-share information (volunteers name, company, title unprompted)
- Asks clarifying questions ("What happens next?", "How long does this take?")
- Responds quickly with complete answers
- Sometimes mentions dropping names of investors/connections

Background:
- VP of Product at a Series B SaaS startup
- Knows Lindsay Jones (fictional investor) who referred you
- Excited about the premise of curated professional introductions

Conversation style:
- Friendly and casual: "awesome!" "sounds good!" "got it!"
- Asks follow-up questions
- Volunteers information even when not asked directly

Respond naturally to the agent's messages as Eddie would.`,

  initialContext: {
    referrer: 'Lindsay Jones',
    company: 'TechStartup Inc',
    expertise: 'Product strategy for B2B SaaS'
  }
};
```

### 4.3 Simulated User Class

**File:** `Testing/framework/SimulatedUser.ts`

```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { SimulatedPersona } from '../personas/eager-eddie';

export class SimulatedUser {
  private anthropic: Anthropic;
  private persona: SimulatedPersona;
  private conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  constructor(persona: SimulatedPersona) {
    this.persona = persona;
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!
    });
  }

  /**
   * Simulates user response to agent message.
   * Returns what the user would type in response.
   */
  async respondTo(agentMessage: string): Promise<string> {
    // Add agent message to history
    this.conversationHistory.push({
      role: 'assistant',
      content: agentMessage
    });

    // Get simulated user response
    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      temperature: 0.8,  // Higher temp for varied responses
      system: this.persona.systemPrompt,
      messages: this.conversationHistory
    });

    const userMessage = response.content[0].type === 'text'
      ? response.content[0].text
      : '';

    // Add user response to history
    this.conversationHistory.push({
      role: 'user',
      content: userMessage
    });

    return userMessage;
  }

  reset() {
    this.conversationHistory = [];
  }
}
```

### 4.4 Judge Agent

**File:** `Testing/framework/JudgeAgent.ts`

```typescript
import Anthropic from '@anthropic-ai/sdk';

export interface JudgeScore {
  overall: number;        // 0-1 score
  tone: number;           // 0-1 score
  flow: number;           // 0-1 score
  completeness: number;   // 0-1 score
  errors: string[];       // Critical errors found
  reasoning: string;      // Judge's explanation
}

export class JudgeAgent {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!
    });
  }

  /**
   * Evaluates a conversation transcript against expected behavior.
   */
  async evaluateConversation(
    transcript: string,
    expectedBehavior: string,
    toolsUsed: string[]
  ): Promise<JudgeScore> {
    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      temperature: 0.2,  // Low temp for consistent evaluation
      system: this.buildJudgePrompt(expectedBehavior, toolsUsed),
      messages: [{
        role: 'user',
        content: `Evaluate this conversation:\n\n${transcript}`
      }],
      tools: [{
        name: 'submit_evaluation',
        description: 'Submit conversation evaluation scores',
        input_schema: {
          type: 'object',
          properties: {
            overall_score: { type: 'number', description: '0-1 overall quality score' },
            tone_score: { type: 'number', description: '0-1 tone consistency score' },
            flow_score: { type: 'number', description: '0-1 conversation flow score' },
            completeness_score: { type: 'number', description: '0-1 task completion score' },
            critical_errors: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of critical errors (hallucinations, wrong tools, broken flow)'
            },
            reasoning: { type: 'string', description: 'Detailed explanation of scores' }
          },
          required: ['overall_score', 'tone_score', 'flow_score', 'completeness_score', 'critical_errors', 'reasoning']
        }
      }]
    });

    const tool = response.content.find(block => block.type === 'tool_use');
    if (!tool || tool.type !== 'tool_use') {
      throw new Error('Judge did not use evaluation tool');
    }

    const evaluation = tool.input as any;

    return {
      overall: evaluation.overall_score,
      tone: evaluation.tone_score,
      flow: evaluation.flow_score,
      completeness: evaluation.completeness_score,
      errors: evaluation.critical_errors,
      reasoning: evaluation.reasoning
    };
  }

  private buildJudgePrompt(expectedBehavior: string, toolsUsed: string[]): string {
    return `You are a conversation quality evaluator for an AI agent.

Your job is to evaluate whether the agent:
1. Maintained appropriate tone throughout
2. Used the correct tools at the right times
3. Completed the expected task
4. Had natural conversation flow
5. Made any critical errors (hallucinations, wrong actions, broken flow)

Expected Behavior:
${expectedBehavior}

Tools the agent should have used:
${toolsUsed.join(', ')}

Evaluation Criteria:

**Tone (0-1):**
- Professional but not salesy
- Consistent with agent personality (Bouncer = gatekeeper, Concierge = helpful assistant)
- No overly enthusiastic or robotic responses
- Deduct 0.3 for tone breaks

**Flow (0-1):**
- Logical progression through conversation steps
- Appropriate responses to user questions
- No confusing back-and-forth
- Deduct 0.2 per flow disruption

**Completeness (0-1):**
- Agent completed the expected task
- All required information collected
- Correct tools used at correct times
- Deduct 0.5 if task incomplete

**Critical Errors:**
- Hallucinating names/companies from examples (Mike, Roku, Brian, etc.)
- Using wrong tools or skipping required tools
- Providing incorrect information
- Breaking character
- Wrong email format (not verify-{userId}@verify.yachtparty.xyz)

Provide honest, critical evaluation focused on production readiness.`;
  }
}
```

### 4.5 Conversation Runner

**File:** `Testing/framework/ConversationRunner.ts`

```typescript
import { createTestDbClient } from '@yachtparty/shared';
import { invokeBouncerAgent } from '@yachtparty/agent-bouncer';
import type { User, Conversation, Message } from '@yachtparty/shared';
import { SimulatedUser, type SimulatedPersona } from './SimulatedUser';
import { JudgeAgent } from './JudgeAgent';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface SimulationResult {
  transcript: string;
  judgeScore: any;
  toolsUsed: string[];
  messagesExchanged: number;
  durationMs: number;
}

export class ConversationRunner {
  private dbClient: SupabaseClient;
  private judgeAgent: JudgeAgent;

  constructor() {
    this.dbClient = createTestDbClient();
    this.judgeAgent = new JudgeAgent();
  }

  /**
   * Runs a complete simulated conversation between user persona and Bouncer agent.
   */
  async runBouncerSimulation(
    persona: SimulatedPersona,
    maxTurns: number = 20,
    batchId?: string  // Optional batch ID for multi-user scenarios
  ): Promise<SimulationResult> {
    const startTime = Date.now();
    const transcript: string[] = [];
    const toolsUsed: string[] = [];

    // Create test user and conversation
    const { user, conversation } = await this.createTestUser(persona, batchId);

    // Create simulated user
    const simulatedUser = new SimulatedUser(persona);

    // Simulate first message from user (usually just "hi")
    let userMessage = 'hi';
    let turn = 0;

    while (turn < maxTurns) {
      turn++;

      // Record user message in DB
      const { data: savedMessage } = await this.dbClient
        .from('messages')
        .insert({
          conversation_id: conversation.id,
          user_id: user.id,
          role: 'user',
          content: userMessage,
          direction: 'inbound',
          status: 'sent',
          created_at: new Date().toISOString(),
          twilio_message_sid: `TEST_${Date.now()}`
        })
        .select()
        .single();

      transcript.push(`USER: ${userMessage}`);

      // Invoke Bouncer agent with test DB client
      const agentResponse = await invokeBouncerAgent(
        savedMessage as Message,
        user,
        conversation,
        this.dbClient  // ✅ Pass test database client
      );

      // Record agent response in DB
      if (agentResponse.messages && agentResponse.messages.length > 0) {
        const agentMessage = agentResponse.messages.join('\n---\n');

        await this.dbClient
          .from('messages')
          .insert({
            conversation_id: conversation.id,
            user_id: user.id,
            role: 'assistant',
            content: agentMessage,
            direction: 'outbound',
            status: 'sent',
            created_at: new Date().toISOString()
          });

        transcript.push(`AGENT: ${agentMessage}`);

        // Track tools used
        if (agentResponse.actions) {
          toolsUsed.push(...agentResponse.actions.map((a: any) => a.type));
        }

        // Check if onboarding complete
        if (agentResponse.actions?.some((a: any) => a.type === 'mark_user_verified')) {
          console.log('✅ Onboarding complete!');
          break;
        }

        // Simulate user response
        userMessage = await simulatedUser.respondTo(agentMessage);

      } else {
        // No agent response - end conversation
        break;
      }
    }

    // Evaluate conversation with judge
    const judgeScore = await this.judgeAgent.evaluateConversation(
      transcript.join('\n\n'),
      'Complete Bouncer onboarding flow: collect name, company, title, verify email',
      ['collect_user_info', 'send_verification_email', 'complete_onboarding']
    );

    return {
      transcript: transcript.join('\n\n'),
      judgeScore,
      toolsUsed,
      messagesExchanged: turn * 2,
      durationMs: Date.now() - startTime
    };
  }

  private async createTestUser(persona: SimulatedPersona, batchId?: string) {
    // Create user in test DB with optional batch ID for cleanup
    const { data: user } = await this.dbClient
      .from('users')
      .insert({
        phone: `+1555${Math.floor(Math.random() * 10000000)}`,
        status: 'active',
        verified: false,
        poc_agent_type: 'concierge',
        created_at: new Date().toISOString(),
        metadata: batchId ? { test_batch_id: batchId } : {}
      })
      .select()
      .single();

    // Create conversation
    const { data: conversation } = await this.dbClient
      .from('conversations')
      .insert({
        user_id: user.id,
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    return { user, conversation };
  }

  /**
   * Runs multi-user simulation with multiple personas interacting simultaneously.
   * Useful for testing cross-user dynamics, community features, intro flows.
   *
   * @param personas - Array of personas to simulate
   * @param batchId - Test batch ID for selective cleanup
   */
  async runMultiUserSimulation(
    personas: SimulatedPersona[],
    batchId: string
  ): Promise<{ [personaName: string]: SimulationResult }> {
    const results: { [personaName: string]: SimulationResult } = {};

    // Run all personas in parallel (simulates concurrent usage)
    const promises = personas.map(async (persona) => {
      const result = await this.runBouncerSimulation(persona, 20, batchId);
      results[persona.name] = result;
    });

    await Promise.all(promises);

    return results;
  }
}
```

---

## Part 5: Example Simulation Test

**File:** `Testing/scenarios/bouncer/happy-path-onboarding.test.ts`

```typescript
import { ConversationRunner } from '../../framework/ConversationRunner';
import { EAGER_EDDIE } from '../../personas/eager-eddie';
import { SKEPTICAL_SAM } from '../../personas/skeptical-sam';
import { resetTestDatabase } from '../../utils/db-reset';
import fs from 'fs/promises';
import path from 'path';

describe('Bouncer - Happy Path Onboarding', () => {
  let runner: ConversationRunner;

  beforeAll(() => {
    runner = new ConversationRunner();
  });

  beforeEach(async () => {
    // Reset test database before each test
    await resetTestDatabase();
  });

  it('should complete onboarding with Eager Eddie', async () => {
    const result = await runner.runBouncerSimulation(EAGER_EDDIE, 20);

    // Save transcript
    await saveTranscript('bouncer-happy-path-eager-eddie', result);

    // Manual review threshold: flag tests below 0.7 for human inspection
    if (result.judgeScore.overall < 0.7) {
      console.warn('⚠️  Judge score below threshold - manual review recommended');
      console.warn('Reasoning:', result.judgeScore.reasoning);
    }

    // Critical errors should always fail
    expect(result.judgeScore.errors.length).toBe(0);

    // Should use correct tools
    expect(result.toolsUsed).toContain('collect_user_info');
    expect(result.toolsUsed).toContain('send_verification_email');
    expect(result.toolsUsed).toContain('complete_onboarding');

    // Log results for human review
    console.log('\n=== Test Results ===');
    console.log('Judge Score:', result.judgeScore.overall);
    console.log('Tone:', result.judgeScore.tone);
    console.log('Flow:', result.judgeScore.flow);
    console.log('Completeness:', result.judgeScore.completeness);
    console.log('Messages:', result.messagesExchanged);
    console.log('Duration:', `${result.durationMs}ms`);
    console.log('===================\n');
  }, 120000);  // 2 min timeout for LLM calls

  it('should complete onboarding with Skeptical Sam', async () => {
    const result = await runner.runBouncerSimulation(SKEPTICAL_SAM, 20);
    await saveTranscript('bouncer-happy-path-skeptical-sam', result);

    // Same assertions but different conversation flow expected
    expect(result.judgeScore.errors.length).toBe(0);
    expect(result.toolsUsed).toContain('complete_onboarding');
  }, 120000);
});

async function saveTranscript(testName: string, result: any) {
  const dir = path.join(__dirname, '../../transcripts', getDateString());
  await fs.mkdir(dir, { recursive: true });

  const content = `# ${testName}

**Judge Score:** ${result.judgeScore.overall}
**Tone:** ${result.judgeScore.tone}
**Flow:** ${result.judgeScore.flow}
**Completeness:** ${result.judgeScore.completeness}

**Reasoning:**
${result.judgeScore.reasoning}

**Tools Used:**
${result.toolsUsed.join(', ')}

---

## Transcript

${result.transcript}
`;

  await fs.writeFile(path.join(dir, `${testName}.md`), content);
}

function getDateString() {
  return new Date().toISOString().split('T')[0];
}
```

---

## Part 6: Multi-User Simulation Example

**File:** `Testing/scenarios/community/multi-user-dynamics.test.ts`

This example shows how to test community dynamics with multiple simultaneous users:

```typescript
import { ConversationRunner } from '../../framework/ConversationRunner';
import { generateTestBatchId, resetTestBatch, seedFixtureUsers } from '../../utils/db-reset';
import {
  OVER_EAGER_SALES,
  FRUSTRATED_SENIOR_LEADER,
  COMMUNITY_SPAMMER,
  LURKER_LUKE
} from '../../personas/community-personas';

describe('Community - Multi-User Dynamics', () => {
  let runner: ConversationRunner;
  let batchId: string;

  beforeAll(async () => {
    runner = new ConversationRunner();

    // Seed persistent fixture users (established members)
    await seedFixtureUsers();
  });

  beforeEach(() => {
    // Generate unique batch ID for this test run
    batchId = generateTestBatchId('community-dynamics');
  });

  afterEach(async () => {
    // Clean up only THIS test's users, preserve fixtures
    await resetTestBatch(batchId);
  });

  it('should handle 4 simultaneous users with different usage patterns', async () => {
    // Run 4 personas in parallel
    const results = await runner.runMultiUserSimulation(
      [
        OVER_EAGER_SALES,      // Sends many intro requests
        FRUSTRATED_SENIOR_LEADER,  // Gets overwhelmed with requests
        COMMUNITY_SPAMMER,     // Abuses community request feature
        LURKER_LUKE           // Rarely responds but occasionally engages
      ],
      batchId
    );

    // Check cross-user effects
    console.log('\n=== Multi-User Dynamics Test ===');

    for (const [personaName, result] of Object.entries(results)) {
      console.log(`\n${personaName}:`);
      console.log(`  Judge Score: ${result.judgeScore.overall}`);
      console.log(`  Messages: ${result.messagesExchanged}`);
      console.log(`  Tools Used: ${result.toolsUsed.length}`);

      // Flag for manual review if scores diverge
      if (result.judgeScore.overall < 0.6) {
        console.warn(`  ⚠️  Low score - review transcript`);
      }
    }

    // Verify system handled edge cases
    // Over-eager sales should eventually get rate limited
    expect(results['Over Eager Sales'].toolsUsed).toContain('offer_introduction');

    // Frustrated leader should still get good experience despite volume
    expect(results['Frustrated Senior Leader'].judgeScore.tone).toBeGreaterThan(0.7);

    // Community spammer should trigger some kind of moderation
    // (This tests future rate limiting features)

    console.log('\n=================================\n');
  }, 300000);  // 5 min timeout for multi-user test

  it('should test intro flow between two test users', async () => {
    // User A nominates Person X
    // User B gets intro offer for Person X
    // Test cross-user intro coordination

    const userA = await runner.createTestUser(OVER_EAGER_SALES, batchId);
    const userB = await runner.createTestUser(FRUSTRATED_SENIOR_LEADER, batchId);

    // ... test intro flow coordination
    // This demonstrates why we need persistent data across individual simulations
  });
});
```

**Key Benefits of This Approach:**

1. **Test Isolation:** Each test gets unique `batchId`, cleanup only affects that test
2. **Fixture Users:** Sarah Chen (VC) persists across tests as "established member"
3. **Concurrent Simulation:** Tests how agents handle multiple active users
4. **Cross-User Effects:** Can test how one user's behavior affects another's experience
5. **Manual Control:** Tests decide when to clean up vs. preserve data

**Future Multi-User Scenarios:**

```typescript
// Test community request dynamics
- 10 users all asking about "CTV advertising" → Do they get matched?
- One user answers many community questions → Do they get credits?
- Frustrated user gets overwhelmed with intro requests → Does tone stay professional?

// Test intro flow coordination
- User A offers intro to Person X
- User B accepts intro offer for Person X
- System coordinates the 3-way introduction

// Test priority scoring under load
- 5 high-value opportunities arrive simultaneously
- Which user gets which opportunity based on fit score?

// Test re-engagement timing with concurrent users
- 3 users drop off at different points
- Do re-engagement messages go out at correct times?
- Do agents handle resumed conversations correctly?
```

---

## Part 7: Implementation Phases

### Phase 1: Parameterization (2-3 days)

**Goal:** Make all agents and helpers accept optional `dbClient` parameter

**Tasks:**
1. ✅ Modify agent entry points (4 files)
2. ✅ Modify context loaders (3 files)
3. ✅ Modify tool executors (3 files)
4. ✅ Modify helper functions (3 files)
5. ✅ Modify shared utilities (3 files)
6. ✅ Run all existing unit tests to verify no regressions
7. ✅ Deploy to production (backward compatible changes)

**Validation:**
- All existing unit tests pass
- Production services continue working
- Test can inject custom dbClient

### Phase 2: Test Infrastructure (1-2 days)

**Goal:** Set up hosted test database and utilities

**Tasks:**
1. ✅ Create Supabase test project
2. ✅ Run all migrations on test DB
3. ✅ Create `createTestDbClient()` utility
4. ✅ Create `resetTestDatabase()` utility
5. ✅ Create timestamp manipulation utilities
6. ✅ Add SQL function for `shift_conversation_timestamps()`
7. ✅ Test connection and CRUD operations

**Validation:**
- Can connect to test DB
- Can reset database
- Can manipulate timestamps

### Phase 3: Simulation Framework (2-3 days)

**Goal:** Build simulation testing framework

**Tasks:**
1. Create `SimulatedUser` class
2. Create `JudgeAgent` class
3. Create `ConversationRunner` class
4. Create 3 synthetic personas (Eager Eddie, Skeptical Sam, Terse Tony)
5. Create test reporter (saves transcripts)

**Validation:**
- Can run simulated conversation
- Judge provides reasonable scores
- Transcripts saved to `/Testing/transcripts/`

### Phase 4: Initial Tests (1-2 days)

**Goal:** Write first simulation tests for Bouncer

**Tasks:**
1. Happy path onboarding (3 personas)
2. Email verification drop-off
3. Mid-process questions
4. Re-engagement timing (24h, 48h)

**Validation:**
- All tests run successfully
- Judge scores are reasonable (0.7+)
- Critical errors detected (hallucinations, wrong tools)

### Phase 5: Expand to Concierge/Innovator (2-3 days)

**Goal:** Create simulation tests for other agents

**Tasks:**
1. Concierge community request flow
2. Innovator intro offer acceptance
3. Cross-agent workflows (Bouncer → Concierge)

### Phase 6: Integration & Documentation (1 day)

**Goal:** Finalize testing infrastructure

**Tasks:**
1. Document testing approach in `/Testing/README.md`
2. Create runbook for manual test review
3. Create judge calibration process
4. Archive test results

---

## Part 7: Success Metrics

### Test Quality Metrics

| Metric | Target | How to Measure |
|--------|--------|---------------|
| Judge score accuracy | 85%+ agreement with human review | Compare 20 judge scores to human evaluation |
| Critical error detection | 100% of hallucinations caught | Manually inject hallucinations, verify judge catches them |
| Test coverage | All major user journeys tested | Map personas × agents × scenarios |
| False positive rate | <10% | Tests that fail due to acceptable LLM variation |

### Process Metrics

| Metric | Target | How to Measure |
|--------|--------|---------------|
| Test run frequency | Weekly during active development | Track last run date |
| Manual review time | <30 min per test run | Time human review process |
| Cost per test run | <$5 | Track Anthropic API usage |

---

## Part 8: Risk Mitigation

### Risk 1: Incomplete Parameterization

**Risk:** Forgetting to parameterize some functions, leading to test/prod mixing

**Mitigation:**
- ✅ Complete audit before starting (Part 1 of this doc)
- ✅ Grep for all `createServiceClient()` calls
- ✅ Test by running simulation with production DB turned off

**Verification:**
```bash
# Should find ZERO results
grep -r "createServiceClient()" packages/agents/*/src --exclude="*.test.ts"
```

### Risk 2: Test DB Pollution

**Risk:** Test data accidentally written to production

**Mitigation:**
- ✅ Test DB URL contains "test" substring (checked in utilities)
- ✅ Production services never receive dbClient parameter
- ✅ Environment separation (different .env files)

### Risk 3: Re-engagement Timing Complexity

**Risk:** Timestamp manipulation breaks message order or doesn't trigger re-engagement

**Mitigation:**
- ✅ Database function shifts ALL timestamps in conversation atomically
- ✅ Preserves relative message order
- ✅ Unit tests for timestamp manipulation utility

### Risk 4: Judge Calibration Drift

**Risk:** Judge scoring becomes inconsistent or incorrect over time

**Mitigation:**
- ✅ Manual review of first 20 test runs
- ✅ Document judge disagreements
- ✅ Refine judge prompt based on patterns
- ✅ Accept judge as "focusing tool" not "source of truth"

---

---

## Summary: Key Design Decisions

### 1. **Multi-User Testing from Day 1**

The architecture supports both single-user and multi-user simulations:

| Capability | Single-User Tests | Multi-User Tests |
|-----------|------------------|------------------|
| Database cleanup | `resetTestDatabase()` | `resetTestBatch(batchId)` |
| User isolation | Each test creates fresh user | Users grouped by `batchId` |
| Fixture users | Not needed | Persistent "established members" |
| Use cases | Bouncer onboarding, basic flows | Community dynamics, intro coordination |
| Cleanup strategy | Nuke everything | Selective by batch |

**Example Multi-User Scenarios Enabled:**

✅ **Community Request Load Testing**
- 10 users simultaneously ask about "CTV advertising"
- Does matching algorithm handle volume?
- Do high-volume requesters get rate limited?

✅ **Intro Flow Coordination**
- User A offers intro to Person X
- User B accepts intro offer for Person X
- System coordinates 3-way introduction

✅ **Cross-User Tone Testing**
- Frustrated senior leader receives 20 intro requests
- Does Innovator agent maintain professional tone under pressure?

✅ **Re-engagement Timing at Scale**
- 5 users drop off at different times (1h, 12h, 24h, 48h, 72h)
- Do re-engagement messages trigger at correct intervals?
- Does system handle concurrent re-engagement checks?

### 2. **Test Data Lifecycle**

```
┌─────────────────────────────────────────────────┐
│  TEST DATABASE                                  │
│                                                 │
│  Fixture Users (persistent)                     │
│  ├─ Sarah Chen (VC)                             │
│  ├─ Marcus Johnson (Frustrated CTO)             │
│  └─ Alex Rivera (Over-eager Sales)              │
│                                                 │
│  Test Batch A: "bouncer-happy-path-20251022"    │
│  ├─ Eager Eddie (transient)                     │
│  ├─ Skeptical Sam (transient)                   │
│  └─ Deleted after test via resetTestBatch()     │
│                                                 │
│  Test Batch B: "community-dynamics-20251022"    │
│  ├─ Community Spammer (transient)               │
│  ├─ Lurker Luke (transient)                     │
│  ├─ Interacts with fixture users                │
│  └─ Deleted after test via resetTestBatch()     │
│                                                 │
└─────────────────────────────────────────────────┘
```

### 3. **Parameterization Strategy**

**Every function accepts optional `dbClient` with production default:**

```typescript
// ✅ Backward compatible
async function invokeBouncerAgent(
  message, user, conversation,
  dbClient = createServiceClient()  // Defaults to production
)

// ✅ Production services: No changes needed
invokeBouncerAgent(msg, user, conv);  // Uses production DB

// ✅ Tests: Inject test DB
invokeBouncerAgent(msg, user, conv, testDbClient);  // Uses test DB
```

**Benefits:**
- Zero breaking changes
- No risk of test/prod pollution
- Clear intent (optional param = testing)
- Can deploy Phase 1 immediately without building test framework

---

## Next Steps

**Immediate action:** Review this plan with team, get approval for:
1. Hosted Supabase test instance (cost: ~$0-25/mo)
2. API usage for simulation tests (est. $2-5 per test run)
3. Time allocation (10-12 days total across 6 phases)

**Once approved:**
1. Start Phase 1 (parameterization) tomorrow
2. Can be deployed to production incrementally (backward compatible)
3. Complete phases 2-3 before writing any simulation tests

**Future Multi-User Testing Capabilities:**

This architecture enables sophisticated testing that's impossible with static mocks:

- **Community dynamics:** How do agents handle 10 concurrent community requests?
- **Load testing:** What happens when 5 intro offers arrive simultaneously?
- **Cross-user effects:** Does one user's spam affect another user's experience?
- **Priority scoring:** Do high-value users get preferential treatment under load?
- **Re-engagement timing:** Do scheduled tasks fire correctly with concurrent users?
- **Intro coordination:** Does system handle multi-party intro flows correctly?

---

**Author:** Claude Code
**Date:** October 22, 2025
**Status:** Awaiting Approval
