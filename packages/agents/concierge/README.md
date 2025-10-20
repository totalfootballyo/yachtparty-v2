# Concierge Agent

## Purpose

The Concierge Agent is the **primary interface for verified users** on the Yachtparty platform. It acts as a personalized assistant that:

- Handles all user messages and classifies intents
- Crafts all outbound messages in a consistent, conversational voice
- Optimizes communication timing based on learned user response patterns
- Respects message budget and user preferences
- Surfaces relevant opportunities from the network (intros, solutions, community requests)

## Responsibilities

### 1. Handle All User Messages
- Receive and process every message from verified users
- Classify user intent:
  - General conversation → respond directly
  - Solution inquiry → publish `user.inquiry.solution_needed` event
  - Intro request → create intro workflow
  - Community question → create community request
- Maintain conversation context and natural flow

### 2. Craft All Outbound Messages
The Concierge is the **only agent** that writes prose directly to verified users. Background agents (Account Manager, Solution Saga) output structured data, which the Concierge transforms into natural, conversational messages.

### 3. Optimize Timing
- Learn user response patterns (best times to reach, preferred style)
- Queue non-urgent messages for optimal delivery times
- Respect quiet hours and rate limits
- Deliver immediate responses when user is actively conversing

### 4. Surface Opportunities
- Read top priorities from Account Manager (intro opportunities, solution updates, community requests)
- Decide when to mention opportunities in conversation ("Should I mention this now, or wait?")
- Weave opportunities into natural conversation flow

## Available Actions

The Concierge can execute the following actions:

### Solution Research
- `request_solution_research(description)` - Start Solution Saga workflow

### Introductions
- `show_intro_opportunity(intro_id)` - Present intro to user
- `accept_intro(intro_id)` - User accepts intro
- `reject_intro(intro_id)` - User declines intro

### Community Engagement
- `ask_community_question(question, category)` - Route question to experts
- `record_community_response(response)` - Capture user's expert insight

### User Management
- `update_user_preferences(changes)` - Update user settings
- `schedule_followup(when, reason)` - Schedule future check-in

## Context Loaded on Each Invocation

The Concierge is **stateless** - it loads fresh context from the database on every invocation:

```typescript
interface ConciergeContext {
  // User profile and preferences (~500 tokens, cacheable)
  user: User;

  // Active conversation
  conversation: Conversation;

  // Recent messages (~3000 tokens, cacheable)
  recentMessages: Message[]; // Last 20 messages

  // Conversation summary (if >50 messages)
  conversationSummary?: string;

  // Top priorities from Account Manager (~1000 tokens, cacheable, updated every 6h)
  userPriorities: UserPriority[]; // Top 5 ranked items (can be empty for MVP)

  // Learned preferences
  userPreferences?: ResponsePattern;
}
```

### Prompt Caching Strategy
Uses Claude's Prompt Caching to reduce costs:
- **System prompt** (~4000 tokens, static)
- **User profile** (~500 tokens, infrequent updates)
- **Conversation history** (~3000 tokens, updated per message)
- **User priorities** (~1000 tokens, updated every 6h)

Caching reduces LLM costs by ~40%.

## LLM Decision Points

The Concierge uses Claude to make these judgment calls:

### 1. Intent Classification
**Question:** "What is the user asking for?"

**Prompt:** Analyze user message and classify intent (general conversation, solution inquiry, intro request, community question, feedback)

**Output:** Intent classification + extracted parameters

### 2. Timing Optimization
**Question:** "Should I mention this priority item now, or wait?"

**Prompt:** Given conversation context and user priorities, determine if now is a good time to surface an opportunity

**Output:** Decision (mention now / wait for better opening) + reasoning

### 3. Style Matching
**Question:** "How should I phrase this update?"

**Prompt:** Convert structured data from background agents into conversational prose that matches user's communication style

**Output:** Natural message text

## Event Flow

### Inbound (User → Agent)
1. User sends SMS → Twilio webhook → `messages` table
2. Database trigger → PostgreSQL NOTIFY → Cloud Run subscription
3. Real-Time Message Processor calls `invokeConciergeAgent()`
4. Concierge processes message, makes LLM decisions
5. Returns `AgentResponse` with immediate reply and/or actions

### Outbound (Agent → User)
1. Concierge publishes `message.send.requested` event (or returns immediate reply)
2. Message Orchestrator checks rate limits, quiet hours, relevance
3. Renders structured data to prose (if needed)
4. Sends via Twilio when appropriate

## Response Format

```typescript
interface AgentResponse {
  // Immediate reply (bypasses queue, for active conversations)
  immediateReply?: boolean;
  message?: string;

  // Actions to execute
  actions: AgentAction[];

  // Events to publish
  events?: AgentEvent[];

  // Tasks to schedule
  tasks?: AgentTask[];

  // LLM reasoning (for debugging)
  reasoning?: string;

  // Priorities presented to user
  priorityUpdates?: string[];
}
```

## Personality Guidelines

From requirements.md Section 4.2:

> **Your personality:** Competent, proactive but never pushy. Think senior level partner manager, not a sycophant.

### Do's
- Be conversational and warm
- Learn and adapt to each user's communication style
- Proactively surface relevant opportunities
- Help users find value in the platform
- Make intelligent decisions about timing and relevance

### Don'ts
- Don't be overly formal or robotic
- Don't spam users with opportunities
- Don't assume users remember previous conversations
- Don't push actions aggressively

## Usage Example

```typescript
import { invokeConciergeAgent } from '@yachtparty/agent-concierge';

// User sends message: "I need a new CRM system"
const message = {
  id: 'msg_123',
  conversation_id: 'conv_456',
  user_id: 'user_789',
  role: 'user',
  content: 'I need a new CRM system',
  direction: 'inbound',
  created_at: new Date().toISOString()
};

const user = {
  id: 'user_789',
  verified: true,
  poc_agent_type: 'concierge',
  // ... other user fields
};

const conversation = {
  id: 'conv_456',
  user_id: 'user_789',
  // ... other conversation fields
};

// Invoke agent
const response = await invokeConciergeAgent(message, user, conversation);

// Response might include:
// - Immediate reply: "I can help you find a CRM. What size is your team?"
// - Event published: user.inquiry.solution_needed
// - Action logged: request_solution_research
```

## Logging

All Concierge actions are logged to `agent_actions_log` with:
- LLM call details (model, tokens, cost, latency)
- Intent classifications
- Timing decisions
- Action executions
- Error details (if any)

This enables:
- Cost tracking and optimization
- Debugging conversation flows
- A/B testing different prompts
- Performance monitoring

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode (for development)
npm run dev

# Run tests
npm test
```

## Environment Variables

Required environment variables:

```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key

# Anthropic Claude
ANTHROPIC_API_KEY=your-anthropic-key
```

## Architecture Notes

- **Stateless:** No in-memory state between invocations
- **Event-driven:** Publishes events instead of calling other agents directly
- **Cacheable:** Uses prompt caching to reduce LLM costs
- **Database-first:** All context loaded fresh from Supabase
- **Logged:** Comprehensive action logging for debugging and cost tracking

## Related Agents

- **Bouncer Agent:** Handles onboarding for unverified users
- **Innovator Agent:** Concierge variant for innovator users (extends Concierge capabilities)
- **Account Manager Agent:** Updates user priorities (read by Concierge)
- **Solution Saga:** Researches solutions (outputs structured data for Concierge to render)
- **Message Orchestrator:** Manages outbound message queue and rate limiting
