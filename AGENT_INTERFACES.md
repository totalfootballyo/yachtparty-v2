# Agent Interfaces Reference

**Purpose:** This document is the critical reference for sub-agents building new components in the Yachtparty system. It documents how agents and functions ACTUALLY work in the deployed system, including:
- How to invoke existing agents
- What inputs agents expect and what outputs they return
- How to interact with the database
- What shared utilities are available
- How to add new agents and actions

**Last Updated:** 2025-10-15
**Status:** Based on deployed code in production

---

## Table of Contents

1. [Overview](#overview)
2. [Embedded Agents](#embedded-agents)
3. [Agent Response Format](#agent-response-format)
4. [Action System](#action-system)
5. [Database Access](#database-access)
6. [Event Publishing](#event-publishing)
7. [Task Creation](#task-creation)
8. [Adding New Agents](#adding-new-agents)

---

## Overview

The Yachtparty system uses three embedded conversational agents that are directly invoked by the Twilio webhook handler. All agents use Claude Sonnet 4 (`claude-sonnet-4-20250514`) and return structured JSON responses.

**Key Principles:**
- Agents are **stateless** - they load fresh context from database on each invocation
- Agents **never call each other** - use events for inter-agent communication
- Agents return **structured actions** - execution happens after agent response
- All agents share the **same response format** (AgentResponse interface)

**Deployment Location:**
All agents are currently embedded in `/packages/services/twilio-webhook/src/index.ts`

---

## Embedded Agents

### 1. Bouncer Agent

**Purpose:** Onboards new users through verification process. Collects user info, verifies email, requests LinkedIn connection, and gets first nomination.

**Location:** `/packages/services/twilio-webhook/src/index.ts` (lines 434-557)

**Function Signature:**
```typescript
async function invokeBouncerAgent(
  message: Message,
  user: User,
  conversation: Conversation
): Promise<AgentResponse>
```

**When Invoked:**
- Automatically when `user.verified === false`
- Routes all unverified users to Bouncer for onboarding

**Model Configuration:**
```typescript
{
  model: 'claude-sonnet-4-20250514',
  max_tokens: 512,      // Reduced for brevity
  temperature: 0.3      // Lower for consistency
}
```

**Context Loaded:**
```typescript
// Gets recent conversation history (last 10 messages)
const { data: recentMessages } = await supabase
  .from('messages')
  .select('role, content, created_at')
  .eq('conversation_id', conversation.id)
  .order('created_at', { ascending: false })
  .limit(10);
```

**Supported Actions:**
- `update_user_field` - Updates user profile fields (name, email, company, etc.)
- `create_verification_task` - Creates task in agent_tasks table for verification

**Example Usage:**
```typescript
const message = await recordInboundMessage(conversation, user, "hey", messageSid);
const response = await invokeBouncerAgent(message, user, conversation);

// Response structure:
{
  immediateReply: true,
  message: "Hey... who told you about this?",
  actions: [
    {
      type: "update_user_field",
      params: { field: "first_name", value: "Sarah" }
    }
  ]
}
```

**Tone & Personality:**
- Professional gatekeeper with "velvet rope" vibe
- Brief and direct (under 2 sentences when possible)
- NO exclamation points, superlatives, or marketing speak
- Creates mystique, not eagerness

---

### 2. Concierge Agent

**Purpose:** Primary interface for verified users. Helps find value, facilitates connections, surfaces opportunities, and adapts to user communication style.

**Location:** `/packages/services/twilio-webhook/src/index.ts` (lines 564-657)

**Function Signature:**
```typescript
async function invokeConciergeAgent(
  message: Message,
  user: User,
  conversation: Conversation
): Promise<AgentResponse>
```

**When Invoked:**
- When `user.verified === true` AND `user.poc_agent_type === 'concierge'`

**Model Configuration:**
```typescript
{
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  temperature: 0.3 (implied default)
}
```

**Context Loaded:**
```typescript
// 1. Recent conversation history (last 20 messages)
const { data: recentMessages } = await supabase
  .from('messages')
  .select('role, content, created_at')
  .eq('conversation_id', conversation.id)
  .order('created_at', { ascending: false })
  .limit(20);

// 2. User priorities from Account Manager (top 5)
const { data: priorities } = await supabase
  .from('user_priorities')
  .select('*')
  .eq('user_id', user.id)
  .eq('status', 'active')
  .order('priority_rank', { ascending: true })
  .limit(5);
```

**Supported Actions:**
- `request_solution_research` - Initiates solution research workflow
- `show_intro_opportunity` - Presents intro opportunity to user
- `ask_community_question` - Routes question to expert community
- `update_user_preferences` - Updates user preferences
- `schedule_followup` - Schedules future re-engagement

**Example Usage:**
```typescript
const message = await recordInboundMessage(conversation, user, "I need help finding a CRM", messageSid);
const response = await invokeConciergeAgent(message, user, conversation);

// Response structure:
{
  immediateReply: true,
  message: "Got it. Let me look into that for you.",
  actions: [
    {
      type: "request_solution_research",
      params: { description: "User needs CRM for small sales team" }
    }
  ]
}
```

**Personality:**
- Competent, proactive but never pushy
- Think senior level partner manager, not a sycophant
- Adapts to user's communication style

**NOTE:** `user_priorities` table is currently empty in production, so priorities will be `[]`

---

### 3. Innovator Agent

**Purpose:** Concierge variant for innovator users with extended features (profile management, prospect uploads, intro reporting, credit funding).

**Location:** `/packages/services/twilio-webhook/src/index.ts` (lines 665-675)

**Function Signature:**
```typescript
async function invokeInnovatorAgent(
  message: Message,
  user: User,
  conversation: Conversation
): Promise<AgentResponse>
```

**When Invoked:**
- When `user.verified === true` AND `user.poc_agent_type === 'innovator'`

**Current Implementation:**
```typescript
// Currently wraps Concierge agent
// In production, would have extended prompts and actions
return invokeConciergeAgent(message, user, conversation);
```

**Planned Extended Actions:**
- `update_innovator_profile` - Update solution description, categories
- `generate_prospect_upload_link` - Generate link for CSV upload
- `report_intro_progress` - Report on intro completions
- `generate_payment_link` - Generate Stripe payment link for credit funding

---

## Agent Response Format

All agents return the same `AgentResponse` interface:

**TypeScript Interface:**
```typescript
interface AgentResponse {
  immediateReply?: boolean;
  message?: string;
  actions?: Array<{
    type: string;
    params: any;
  }>;
}
```

**Field Descriptions:**

### `immediateReply` (optional boolean)
- `true`: Message written to database immediately, bypasses queue
- `false` or undefined: Message queued for later delivery
- **Current behavior:** All agents set this to `true` for active conversations

### `message` (optional string)
- The prose message to send to the user
- Crafted by the agent in conversational tone
- Stored in `messages` table with `role` = agent type
- Picked up by `sms-sender` for delivery

### `actions` (optional array)
- List of actions to execute after agent response
- Each action has `type` and `params`
- Executed sequentially by `executeAction()` function
- See [Action System](#action-system) for available actions

**Example Response:**
```typescript
{
  immediateReply: true,
  message: "Thanks Sarah. Where do you work?",
  actions: [
    {
      type: "update_user_field",
      params: {
        field: "first_name",
        value: "Sarah"
      }
    },
    {
      type: "update_user_field",
      params: {
        field: "last_name",
        value: "Smith"
      }
    }
  ]
}
```

**Processing Flow:**
```typescript
// 1. Agent returns response
const response = await invokeBouncerAgent(message, user, conversation);

// 2. If immediateReply, write message to database
if (response.immediateReply && response.message) {
  await supabase.from('messages').insert({
    conversation_id: conversation.id,
    user_id: user.id,
    role: user.poc_agent_type,  // 'bouncer', 'concierge', or 'innovator'
    content: response.message,
    direction: 'outbound',
    status: 'pending'
  });
}

// 3. Execute all actions
if (response.actions && response.actions.length > 0) {
  for (const action of response.actions) {
    await executeAction(action, user.id, conversation.id);
  }
}
```

---

## Action System

Actions are the verbs agents use to interact with the system. All actions are executed by the `executeAction()` function after the agent responds.

**Location:** `/packages/services/twilio-webhook/src/index.ts` (lines 380-427)

**Function Signature:**
```typescript
async function executeAction(
  action: { type: string; params: any },
  userId: string,
  conversationId: string
): Promise<void>
```

### Available Actions

#### 1. `update_user_field`

**Purpose:** Updates a single field in the `users` table

**Parameters:**
```typescript
{
  field: string;    // Column name in users table
  value: any;       // New value for the field
}
```

**Implementation:**
```typescript
await supabase
  .from('users')
  .update({ [action.params.field]: action.params.value })
  .eq('id', userId);
```

**Example:**
```typescript
{
  type: "update_user_field",
  params: {
    field: "email",
    value: "sarah@company.com"
  }
}
```

**Common Fields:**
- `first_name`, `last_name`
- `email`, `phone_number`
- `company`, `title`
- `linkedin_url`
- `verified` (boolean)
- `poc_agent_type` ('bouncer' | 'concierge' | 'innovator')

---

#### 2. `create_verification_task`

**Purpose:** Creates a task in `agent_tasks` table for user verification

**Parameters:**
```typescript
{
  // Any context needed for verification
  [key: string]: any;
}
```

**Implementation:**
```typescript
await supabase.from('agent_tasks').insert({
  task_type: 'verify_user',
  agent_type: 'bouncer',
  user_id: userId,
  scheduled_for: new Date().toISOString(),
  priority: 'high',
  context_json: action.params
});
```

**Example:**
```typescript
{
  type: "create_verification_task",
  params: {
    email: "sarah@company.com",
    linkedin_url: "https://linkedin.com/in/sarah"
  }
}
```

**NOTE:** No task processor exists yet - these tasks are written but not consumed

---

#### 3. `request_solution_research`

**Purpose:** Publishes event to trigger solution research workflow

**Parameters:**
```typescript
{
  description: string;  // User's solution request description
}
```

**Implementation:**
```typescript
await supabase.from('events').insert({
  event_type: 'user.inquiry.solution_needed',
  aggregate_id: userId,
  aggregate_type: 'user',
  payload: { description: action.params.description },
  created_by: 'concierge_agent'
});
```

**Example:**
```typescript
{
  type: "request_solution_research",
  params: {
    description: "User needs CRM for small sales team (5 people)"
  }
}
```

**NOTE:** Events are written but no processor exists yet - Solution Saga not deployed

---

#### 4. `schedule_followup`

**Purpose:** Schedules a future re-engagement check

**Parameters:**
```typescript
{
  when: string;     // ISO timestamp
  reason: string;   // Why the followup is needed
}
```

**Implementation:**
```typescript
await supabase.from('agent_tasks').insert({
  task_type: 're_engagement_check',
  agent_type: 'concierge',
  user_id: userId,
  scheduled_for: action.params.when,
  priority: 'medium',
  context_json: { reason: action.params.reason }
});
```

**Example:**
```typescript
{
  type: "schedule_followup",
  params: {
    when: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    reason: "User asked to follow up tomorrow about CRM"
  }
}
```

**NOTE:** No task processor exists yet - these tasks are written but not consumed

---

### Adding New Actions

To add a new action type:

**1. Add to the switch statement in `executeAction()`:**

```typescript
async function executeAction(action: { type: string; params: any }, userId: string, conversationId: string) {
  const supabase = createServiceClient();
  console.log(`⚡ Executing action: ${action.type}`);

  switch (action.type) {
    // ... existing cases ...

    case 'your_new_action':
      // Your implementation here
      await supabase.from('some_table').insert({
        user_id: userId,
        data: action.params.data
      });
      break;

    default:
      console.log(`ℹ️  Unknown action type: ${action.type}`);
  }
}
```

**2. Update agent prompts to include the new action:**

Add to the "Available actions:" section in the agent's prompt:
```typescript
Available actions:
- request_solution_research(description)
- your_new_action(param1, param2)
- schedule_followup(when, reason)
```

**3. Test by triggering the agent:**

Send a test SMS to trigger the agent and verify the action executes correctly.

---

## Database Access

All database operations use Supabase client. The shared package provides utilities for common operations.

### Creating Supabase Client

**Location:** `/packages/shared/src/utils/supabase.ts` (line 64)

**Function:**
```typescript
function createServiceClient(): SupabaseClient
```

**Usage:**
```typescript
import { createServiceClient } from '@yachtparty/shared';

const supabase = createServiceClient();

// Client has full access (bypasses Row Level Security)
const { data, error } = await supabase
  .from('users')
  .select('*')
  .eq('id', userId)
  .single();
```

**Environment Variables Required:**
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_KEY` - Service role key (NOT anon key)

**Important:** Service client bypasses RLS - use only in trusted server environments

---

### Shared Database Utilities

**Location:** `/packages/shared/src/utils/supabase.ts`

#### `getUser(userId: string)`

**Returns:** `User | null`

```typescript
import { getUser } from '@yachtparty/shared';

const user = await getUser('user-uuid-here');
if (user) {
  console.log(`${user.first_name} ${user.last_name}`);
}
```

**Source:** Lines 92-110

---

#### `getConversation(conversationId: string)`

**Returns:** `Conversation | null`

```typescript
import { getConversation } from '@yachtparty/shared';

const conversation = await getConversation('conv-uuid-here');
if (conversation) {
  console.log(`Status: ${conversation.status}`);
}
```

**Source:** Lines 127-145

---

#### `getRecentMessages(conversationId: string, limit?: number)`

**Returns:** `Message[]` (default limit: 20, descending order by created_at)

```typescript
import { getRecentMessages } from '@yachtparty/shared';

// Get last 20 messages
const messages = await getRecentMessages('conv-uuid-here');

// Get last 50 messages
const moreMessages = await getRecentMessages('conv-uuid-here', 50);

// Messages returned newest first
```

**Source:** Lines 166-186

---

#### `getUserPriorities(userId: string, limit?: number)`

**Returns:** `UserPriority[]` (default limit: 10, ascending order by priority_rank)

```typescript
import { getUserPriorities } from '@yachtparty/shared';

// Get top 10 priorities
const priorities = await getUserPriorities('user-uuid-here');

// Get top 5 priorities
const topPriorities = await getUserPriorities('user-uuid-here', 5);

for (const priority of priorities) {
  console.log(`Rank ${priority.priority_rank}: ${priority.item_type} - ${priority.item_id}`);
}
```

**Source:** Lines 213-232

**NOTE:** `user_priorities` table is empty in production - always returns `[]`

---

### Common Database Queries

#### Find or Create User by Phone
```typescript
const supabase = createServiceClient();

// Try to find existing user
const { data: existingUser, error: findError } = await supabase
  .from('users')
  .select('*')
  .eq('phone_number', phoneNumber)
  .single();

if (existingUser) {
  return existingUser;
}

// Create new user
const { data: newUser, error: createError } = await supabase
  .from('users')
  .insert({
    phone_number: phoneNumber,
    poc_agent_type: 'bouncer',
    verified: false,
    credit_balance: 0,
    status_level: 'member'
  })
  .select()
  .single();

return newUser;
```

**Source:** `/packages/services/twilio-webhook/src/index.ts` lines 218-259

---

#### Find Active Conversation for User
```typescript
const supabase = createServiceClient();

const { data: conversation, error } = await supabase
  .from('conversations')
  .select('*')
  .eq('phone_number', user.phone_number)
  .eq('status', 'active')
  .single();

// If not found (error.code === 'PGRST116'), create new one
```

**Source:** `/packages/services/twilio-webhook/src/index.ts` lines 269-309

---

#### Record Inbound Message
```typescript
const supabase = createServiceClient();

const { data: message, error } = await supabase
  .from('messages')
  .insert({
    conversation_id: conversation.id,
    user_id: user.id,
    role: 'user',
    content: messageBody,
    direction: 'inbound',
    twilio_message_sid: messageSid,
    status: 'delivered'
  })
  .select()
  .single();
```

**Source:** `/packages/services/twilio-webhook/src/index.ts` lines 321-349

---

#### Record Outbound Message
```typescript
const supabase = createServiceClient();

const { data: message, error } = await supabase
  .from('messages')
  .insert({
    conversation_id: conversation.id,
    user_id: user.id,
    role: user.poc_agent_type,  // 'bouncer', 'concierge', or 'innovator'
    content: agentMessage,
    direction: 'outbound',
    status: 'pending'
  })
  .select()
  .single();

// sms-sender will pick this up and send via Twilio
```

**Source:** `/packages/services/twilio-webhook/src/index.ts` lines 722-729

---

### Tables Actively Used

| Table | Purpose | Read | Write |
|-------|---------|------|-------|
| `users` | User records | ✅ | ✅ |
| `conversations` | Conversation threads | ✅ | ✅ |
| `messages` | Inbound/outbound messages | ✅ | ✅ |
| `events` | Event log | ❌ | ✅ |
| `agent_tasks` | Scheduled tasks | ❌ | ✅ |

### Tables That Exist But Are Empty

| Table | Purpose | Status |
|-------|---------|--------|
| `user_priorities` | Account Manager priorities | Empty (no Account Manager deployed) |
| `message_queue` | Outbound message queue | Empty (no Message Orchestrator deployed) |
| `user_message_budget` | Rate limiting | Empty (no rate limiting implemented) |
| `solution_workflow` | Solution research saga state | Empty (no Solution Saga deployed) |
| `intro_opportunity` | Introduction opportunities | Empty (no Intro Handler deployed) |
| `community_request` | Expert requests | Empty (no Agent of Humans deployed) |

---

## Event Publishing

Events are the primary mechanism for inter-agent communication. All events are stored in the `events` table for complete audit trail and replay capability.

**Key Principle:** Agents never directly call other agents - they publish events instead.

### Publishing Events

**Location:** `/packages/shared/src/utils/events.ts` (lines 81-108)

**Function:**
```typescript
async function publishEvent<T = unknown>(
  params: PublishEventParams<T>
): Promise<Event>
```

**Parameters:**
```typescript
interface PublishEventParams<T> {
  event_type: EventType;           // e.g., 'user.inquiry.solution_needed'
  aggregate_id: string;            // ID of primary entity
  aggregate_type: AggregateType;   // e.g., 'user', 'conversation'
  payload: T;                      // Event-specific data
  metadata?: Record<string, unknown>;  // Optional tracking metadata
  created_by: string;              // Agent/function creating event
}
```

**Usage Example:**
```typescript
import { publishEvent } from '@yachtparty/shared';

// Publish solution research request
const event = await publishEvent({
  event_type: 'user.inquiry.solution_needed',
  aggregate_id: userId,
  aggregate_type: 'user',
  payload: {
    userId: userId,
    conversationId: conversationId,
    requestDescription: 'User needs CRM for small sales team',
    category: 'sales_software',
    urgency: 'medium'
  },
  created_by: 'concierge_agent'
});
```

**Current Usage in System:**

Only `request_solution_research` action publishes events:
```typescript
// From executeAction() function
case 'request_solution_research':
  await supabase.from('events').insert({
    event_type: 'user.inquiry.solution_needed',
    aggregate_id: userId,
    aggregate_type: 'user',
    payload: { description: action.params.description },
    created_by: 'concierge_agent'
  });
  break;
```

**Source:** `/packages/services/twilio-webhook/src/index.ts` lines 403-411

---

### Event Types

**Location:** `/packages/shared/src/types/events.ts` (lines 20-62)

**Available Event Types:**
```typescript
// User Events
'user.message.received'
'user.onboarding_step.completed'
'user.verification.pending'
'user.verified'
'user.inquiry.solution_needed'
'user.inquiry.detected'
'user.response.recorded'
'user.intro_inquiry'

// Solution Events
'solution.initial_findings'
'solution.research_complete'
'solution.demand_signal'

// Community Events
'community.request_needed'
'community.request_created'
'community.request_routed'
'community.response_received'

// Intro Events
'intro.opportunity_created'
'intro.accepted'
'intro.completed'

// Priority Events
'priority.intro_added'

// Message Events
'message.send.requested'
'message.ready_to_send'

// Agent Task Events
'agent.task_ready'

// Account Manager Events
'account_manager.processing.completed'

// Prospect Events
'prospect.research_needed'
'prospect.research_complete'
```

**Naming Convention:** `{entity}.{action}.{status}`

---

### Event Payloads

Each event type has a specific payload structure. See `/packages/shared/src/types/events.ts` for full definitions.

**Example: Solution Research Request**
```typescript
interface UserInquirySolutionNeededPayload {
  userId: string;
  conversationId: string;
  requestDescription: string;
  category?: string;
  urgency?: 'low' | 'medium' | 'high';
}
```

**Example: Intro Completed**
```typescript
interface IntroCompletedPayload {
  introId: string;
  connectorUserId: string;
  innovatorId?: string;
  prospectId?: string;
  completedAt: string;
  creditsAwarded: number;
}
```

---

### Reading Unprocessed Events

**Function:**
```typescript
async function getUnprocessedEvents(
  eventType?: string,
  limit: number = 100
): Promise<Event[]>
```

**Usage:**
```typescript
import { getUnprocessedEvents, markEventProcessed } from '@yachtparty/shared';

// Get all unprocessed events
const allEvents = await getUnprocessedEvents();

// Get unprocessed user message events
const messageEvents = await getUnprocessedEvents('user.message.received');

// Process events
for (const event of messageEvents) {
  console.log(`Processing ${event.event_type} for ${event.aggregate_id}`);
  await handleEvent(event);
  await markEventProcessed(event.id);
}
```

**Source:** `/packages/shared/src/utils/events.ts` lines 241-266

---

### Important Notes

**⚠️ Events Are Written But Not Currently Processed**

The deployed system writes events to the `events` table but no event processors exist yet. This means:
- Events accumulate in the database with `processed = false`
- No agents are listening for/consuming events
- Event-driven workflows (Solution Saga, Account Manager) are not deployed

**To Deploy Event Processor:**
1. Create Cloud Run service that polls `events` table
2. Use `getUnprocessedEvents()` to fetch pending events
3. Route events to appropriate agent handlers
4. Mark events as processed with `markEventProcessed(eventId)`

---

## Task Creation

Tasks are scheduled for future processing and stored in the `agent_tasks` table. They are designed to be picked up by a scheduled processor (e.g., pg_cron every 2 minutes).

**Location:** `/packages/shared/src/utils/events.ts` (lines 140-171)

**Function:**
```typescript
async function createAgentTask(params: CreateTaskParams): Promise<AgentTask>
```

**Parameters:**
```typescript
interface CreateTaskParams {
  task_type: TaskType;              // e.g., 're_engagement_check'
  agent_type: AgentType;            // e.g., 'bouncer', 'concierge'
  user_id?: string;                 // User this task relates to
  context_id?: string;              // Related entity ID
  context_type?: string;            // Type of context entity
  scheduled_for: Date | string;     // When to execute
  priority: Priority;               // 'urgent' | 'high' | 'medium' | 'low'
  context_json: Record<string, unknown>;  // All data needed to process
  max_retries?: number;             // Default: 3
  created_by: string;               // Agent/function creating task
}
```

**Usage Example:**
```typescript
import { createAgentTask } from '@yachtparty/shared';

// Schedule re-engagement check for 24 hours from now
const task = await createAgentTask({
  task_type: 're_engagement_check',
  agent_type: 'bouncer',
  user_id: userId,
  context_id: conversationId,
  context_type: 'conversation',
  scheduled_for: new Date(Date.now() + 24 * 60 * 60 * 1000),
  priority: 'medium',
  context_json: {
    lastMessage: 'What's your company name?',
    onboardingStep: 'company_collection',
    attemptCount: 1
  },
  created_by: 'bouncer_agent'
});
```

---

### Task Types

**Location:** `/packages/shared/src/types/agents.ts` (lines 98-105)

**Available Task Types:**
```typescript
type TaskType =
  | 're_engagement_check'          // Follow up with inactive user
  | 'process_community_request'    // Route expert request
  | 'notify_user_of_priorities'    // Alert user of opportunities
  | 'solution_workflow_timeout'    // Check if expert responses overdue
  | 'create_conversation_summary'  // Summarize conversation every 50 messages
  | 'intro_followup_check'         // Verify intro completion status
  | 'community_request_available'  // Notify expert of request
```

---

### Priority Levels

**Location:** `/packages/shared/src/types/agents.ts` (lines 60-68)

```typescript
type Priority = 'urgent' | 'high' | 'medium' | 'low';

// Priority meanings:
// - urgent: Immediate processing (user actively conversing)
// - high: Next available slot (intro acceptances, high-value matches)
// - medium: Scheduled optimally (solution updates, weekly summaries)
// - low: Defer if queue full (tips, network updates)
```

---

### Current Usage in System

Tasks are created by two actions:

**1. `create_verification_task`:**
```typescript
await supabase.from('agent_tasks').insert({
  task_type: 'verify_user',
  agent_type: 'bouncer',
  user_id: userId,
  scheduled_for: new Date().toISOString(),
  priority: 'high',
  context_json: action.params
});
```

**2. `schedule_followup`:**
```typescript
await supabase.from('agent_tasks').insert({
  task_type: 're_engagement_check',
  agent_type: 'concierge',
  user_id: userId,
  scheduled_for: action.params.when,
  priority: 'medium',
  context_json: { reason: action.params.reason }
});
```

**Source:** `/packages/services/twilio-webhook/src/index.ts` lines 392-422

---

### Important Notes

**⚠️ No Task Processor Exists Yet**

The deployed system writes tasks to `agent_tasks` table but no processor exists yet. This means:
- Tasks accumulate in the database with `status = 'pending'`
- Scheduled tasks are never executed
- Re-engagement checks don't happen
- Verification tasks don't get processed

**To Deploy Task Processor:**

Create a Cloud Run service that:
1. Runs every 2 minutes (via Cloud Scheduler)
2. Queries for pending tasks scheduled before now
3. Uses `FOR UPDATE SKIP LOCKED` pattern to prevent duplicate processing
4. Invokes appropriate agent for each task
5. Updates task status to 'completed' or 'failed'

**Example Query:**
```sql
SELECT * FROM agent_tasks
WHERE status = 'pending'
  AND scheduled_for <= NOW()
ORDER BY priority ASC, scheduled_for ASC
LIMIT 10
FOR UPDATE SKIP LOCKED;
```

---

## Adding New Agents

To add a new agent to the system, follow these steps:

### 1. Decide Where to Add the Agent

**Option A: Embedded in Twilio Webhook (for POC agents)**
- Add to `/packages/services/twilio-webhook/src/index.ts`
- For agents that respond directly to user messages
- Examples: Bouncer, Concierge, Innovator

**Option B: Separate Cloud Run Service (for background agents)**
- Create new package in `/packages/services/your-agent-name/`
- For agents that process events or scheduled tasks
- Examples: Solution Saga, Account Manager, Intro Handler

---

### 2. Create the Agent Function

**Template for Embedded Agent:**

```typescript
/**
 * Invoke Your Agent for specific user type
 *
 * Description of agent's purpose and responsibilities
 */
async function invokeYourAgent(
  message: Message,
  user: User,
  conversation: Conversation
): Promise<AgentResponse> {
  const supabase = createServiceClient();
  console.log('🎯 Invoking Your Agent');

  // 1. Load additional context if needed
  const { data: recentMessages } = await supabase
    .from('messages')
    .select('role, content, created_at')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: false })
    .limit(20);

  const conversationHistory = recentMessages
    ?.reverse()
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  // 2. Craft your agent prompt
  const prompt = `You are [Agent Name] at Yachtparty.

YOUR ROLE:
[Describe agent's purpose and responsibilities]

TONE:
[Describe personality and communication style]

USER CONTEXT:
${JSON.stringify(user, null, 2)}

CONVERSATION HISTORY:
${conversationHistory || 'No previous messages'}

USER'S LATEST MESSAGE: "${message.content}"

Available actions:
- action_name(param1, param2)
- another_action(param)

Respond with JSON in this format:
{
  "message": "Your response to the user",
  "actions": [
    {"type": "action_name", "params": {"param1": "value"}}
  ],
  "immediateReply": true
}`;

  // 3. Call Claude API
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (content && content.type === 'text') {
      // Parse JSON response
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const agentResponse = JSON.parse(jsonMatch[0]);
        return agentResponse as AgentResponse;
      }
    }

    // Fallback if parsing fails
    return {
      immediateReply: true,
      message: 'Thanks for your message! Let me help you with that.',
      actions: [],
    };
  } catch (error) {
    console.error('Your Agent error:', error);
    throw error;
  }
}
```

---

### 3. Add Routing Logic

**For POC Agents (embedded in twilio-webhook):**

Update `processInboundMessageWithAgent()` function:

```typescript
async function processInboundMessageWithAgent(
  message: Message,
  user: User,
  conversation: Conversation
): Promise<void> {
  const supabase = createServiceClient();
  let response: AgentResponse;

  if (!user.verified) {
    response = await invokeBouncerAgent(message, user, conversation);
  } else if (user.poc_agent_type === 'concierge') {
    response = await invokeConciergeAgent(message, user, conversation);
  } else if (user.poc_agent_type === 'innovator') {
    response = await invokeInnovatorAgent(message, user, conversation);
  } else if (user.poc_agent_type === 'your_agent') {
    response = await invokeYourAgent(message, user, conversation);
  } else {
    throw new Error(`Unknown poc_agent_type: ${user.poc_agent_type}`);
  }

  // ... rest of processing
}
```

**For Background Agents (event-driven):**

Create event handler in your Cloud Run service:

```typescript
import { getUnprocessedEvents, markEventProcessed } from '@yachtparty/shared';

async function processEvents() {
  const events = await getUnprocessedEvents('your.event.type');

  for (const event of events) {
    try {
      const result = await invokeYourAgent(event);

      // Execute actions from agent response
      for (const action of result.actions) {
        await executeAction(action);
      }

      await markEventProcessed(event.id);
    } catch (error) {
      console.error(`Error processing event ${event.id}:`, error);
    }
  }
}

// Call from Cloud Run HTTP handler or scheduled job
```

---

### 4. Add New Actions (if needed)

If your agent needs custom actions, add them to `executeAction()`:

```typescript
async function executeAction(action: { type: string; params: any }, userId: string, conversationId: string) {
  const supabase = createServiceClient();

  switch (action.type) {
    // ... existing actions ...

    case 'your_new_action':
      // Implementation
      const { data, error } = await supabase
        .from('your_table')
        .insert({
          user_id: userId,
          data: action.params.data
        });

      if (error) {
        console.error(`Error executing ${action.type}:`, error);
        throw error;
      }
      break;

    default:
      console.log(`ℹ️  Unknown action type: ${action.type}`);
  }
}
```

---

### 5. Update TypeScript Types

Add your agent type to the shared types:

**In `/packages/shared/src/types/agents.ts`:**

```typescript
export type AgentType =
  | 'bouncer'
  | 'concierge'
  | 'innovator'
  | 'your_agent'  // <-- Add here
  | 'account_manager'
  | 'solution_saga'
  // ... etc
```

Add your action types:
```typescript
export type AgentActionType =
  // ... existing actions ...
  | 'your_new_action'
  | 'another_action'
```

---

### 6. Test Your Agent

**For POC Agents:**
1. Update a test user's `poc_agent_type` to your new agent type
2. Send SMS to trigger the agent
3. Verify agent responds correctly
4. Check actions execute properly

**For Background Agents:**
1. Publish a test event
2. Trigger your Cloud Run service
3. Verify event is processed
4. Check actions execute properly

---

### 7. Deploy

**For Embedded Agents:**
```bash
cd packages/services/twilio-webhook
npm run build
gcloud run deploy twilio-webhook --source .
```

**For Background Agents:**
```bash
cd packages/services/your-agent
npm run build
gcloud run deploy your-agent --source .
```

---

## Best Practices

### Agent Design

1. **Keep agents stateless** - Load all context from database on each invocation
2. **Use events for inter-agent communication** - Never directly call other agents
3. **Return structured actions** - Let execution framework handle database writes
4. **Include reasoning in prompts** - Ask agents to explain their decisions
5. **Handle JSON parsing failures** - Always have a fallback response

### Database Operations

1. **Use shared utilities** - Leverage `createServiceClient()`, `getUser()`, etc.
2. **Handle errors gracefully** - Check for `error.code === 'PGRST116'` (not found)
3. **Use transactions for multi-step operations** - Prevent partial updates
4. **Denormalize for performance** - Store phone_number on conversations for fast lookups

### Action System

1. **Keep actions simple** - Each action should do one thing
2. **Make actions idempotent** - Safe to retry on failure
3. **Log action execution** - Console.log for debugging
4. **Handle unknown action types** - Don't throw errors, just log

### Event Publishing

1. **Use descriptive event types** - Follow naming convention: `{entity}.{action}.{status}`
2. **Include all context in payload** - Events should be self-contained
3. **Add metadata for tracking** - Correlation IDs, agent versions, etc.
4. **Mark events as processed** - Prevent duplicate handling

### Task Scheduling

1. **Include all context in context_json** - Tasks should be processable independently
2. **Set appropriate priorities** - Don't overuse 'urgent'
3. **Set max_retries** - Default is 3, adjust as needed
4. **Schedule reasonable times** - Respect quiet hours

---

## Summary

This document provides the complete reference for working with agents in the Yachtparty system. Key takeaways:

- **Three embedded agents:** Bouncer (onboarding), Concierge (verified users), Innovator (innovator users)
- **All agents return AgentResponse:** `{immediateReply, message, actions}`
- **Actions execute after agent responds:** Database updates, event publishing, task scheduling
- **Use shared utilities:** `createServiceClient()`, `publishEvent()`, `createAgentTask()`
- **Events and tasks are written but not processed:** No processors deployed yet
- **Adding new agents:** Create function, add routing, implement actions, update types, test, deploy

**For questions or clarifications:** Refer to the actual source code referenced throughout this document. All line numbers are current as of 2025-10-15.

---

**Document Version:** 1.0
**Last Updated:** 2025-10-15
**Maintained By:** Yachtparty Engineering Team
