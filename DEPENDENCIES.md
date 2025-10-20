# Yachtparty System Dependencies Map

This document maps the dependencies between all components to determine optimal build order and identify potential circular dependencies.

## Component Dependency Graph

```
┌─────────────────────────────────────────────────────────────┐
│                     Foundation Layer                         │
│  (All components depend on these)                           │
├─────────────────────────────────────────────────────────────┤
│  • Database Schema (Supabase PostgreSQL)                    │
│  • Shared TypeScript Package (@yachtparty/shared)           │
│  • Environment Variables                                     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    Infrastructure Layer                      │
│  (Runtime services)                                         │
├─────────────────────────────────────────────────────────────┤
│  • Twilio Webhook Handler ← Twilio API                     │
│  • Real-Time Message Processor ← Supabase Realtime         │
│  • SMS Sender Service ← Twilio API + Supabase Realtime     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                      Agent Layer                            │
│  (Business logic processors)                                │
├─────────────────────────────────────────────────────────────┤
│  1. Bouncer Agent (no agent dependencies)                   │
│     ├─ Shared types                                         │
│     ├─ Supabase client                                      │
│     ├─ Claude API                                           │
│     └─ Event publishing                                     │
│                                                             │
│  2. Account Manager (no agent dependencies)                 │
│     ├─ Shared types                                         │
│     ├─ Supabase client                                      │
│     ├─ Claude API (for LLM decisions)                       │
│     └─ Event publishing                                     │
│                                                             │
│  3. Concierge Agent                                         │
│     ├─ Shared types                                         │
│     ├─ Supabase client                                      │
│     ├─ Claude API                                           │
│     ├─ Event publishing                                     │
│     └─ Account Manager priorities (optional for MVP)        │
│                                                             │
│  4. Innovator Agent                                         │
│     ├─ Inherits from Concierge                             │
│     └─ Extended features (profiles, prospects, reporting)   │
│                                                             │
│  5. Solution Saga                                           │
│     ├─ Shared types                                         │
│     ├─ Supabase client                                      │
│     ├─ Claude API (for LLM decisions)                       │
│     ├─ Perplexity API (research)                            │
│     ├─ Agent of Humans (community requests)                 │
│     └─ Event publishing                                     │
│                                                             │
│  6. Intro Agent (event handlers)                            │
│     ├─ Shared types                                         │
│     ├─ Supabase client                                      │
│     ├─ Claude API                                           │
│     └─ Event publishing                                     │
│                                                             │
│  7. Agent of Humans (request routing)                       │
│     ├─ Shared types                                         │
│     ├─ Supabase client                                      │
│     └─ Event publishing                                     │
│                                                             │
│  8. Social Butterfly / Demand Agent                         │
│     ├─ Shared types                                         │
│     ├─ Supabase client                                      │
│     ├─ Apify API (LinkedIn)                                 │
│     └─ Event publishing                                     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   Orchestration Layer                        │
│  (Message coordination)                                     │
├─────────────────────────────────────────────────────────────┤
│  • Message Orchestrator                                     │
│    ├─ Shared types                                          │
│    ├─ Supabase client                                       │
│    ├─ Twilio client                                         │
│    ├─ Concierge Agent (for message rendering)              │
│    └─ Rate limiting logic                                   │
└─────────────────────────────────────────────────────────────┘
```

## Build Order (Optimal Sequence)

### Phase 1: MVP Core (Current)

**Already Complete ✅**
1. Database Schema
2. Shared TypeScript Package
3. Cloud Run Infrastructure (3 services)

**Next Priority (In Order)**

**Step 1: Bouncer Agent** ⭐ START HERE
- **Why first**: No dependencies on other agents, enables user onboarding
- **Depends on**: Shared types, Supabase, Claude API
- **Blocks**: Full end-to-end SMS testing, user verification flow
- **Sub-agent suitable**: ✅ Yes

**Step 2: Message Orchestrator** ⭐ HIGH PRIORITY
- **Why second**: Needed for outbound messages from all agents
- **Depends on**: Shared types, Supabase, Twilio (already have), basic Concierge for rendering
- **Blocks**: All outbound messaging (Bouncer needs this!)
- **Sub-agent suitable**: ✅ Yes (with careful prompt)

**Step 3: Concierge Agent (Basic)**
- **Why third**: Enables verified user conversations
- **Depends on**: Shared types, Supabase, Claude API
- **Optional**: Account Manager priorities (can add later)
- **Blocks**: User interactions after onboarding
- **Sub-agent suitable**: ✅ Yes

**Step 4: Account Manager**
- **Why fourth**: Provides priorities for Concierge, but optional for MVP
- **Depends on**: Shared types, Supabase, Claude API
- **Blocks**: Priority-based user communications
- **Sub-agent suitable**: ✅ Yes

### Phase 2: Solution Research

**Step 5: Agent of Humans (Request Routing)**
- Community request matching logic
- No LLM needed (just database queries)
- **Sub-agent suitable**: ✅ Yes

**Step 6: Solution Saga**
- Event-driven state machine
- Perplexity API integration
- Community request creation
- **Sub-agent suitable**: ✅ Yes (complex but doable)

### Phase 3: Intro Workflows

**Step 7: Social Butterfly / Demand Agent**
- LinkedIn research (Apify)
- Mutual connection discovery
- **Sub-agent suitable**: ✅ Yes

**Step 8: Intro Agent (Event Handlers)**
- Introduction facilitation
- Talking points generation
- **Sub-agent suitable**: ✅ Yes

**Step 9: Innovator Agent**
- Extends Concierge
- Profile management
- **Sub-agent suitable**: ✅ Yes

### Phase 4: Testing & Deployment

**Step 10: Testing Infrastructure**
- Unit tests for agents
- Integration tests for event flows
- End-to-end SMS tests
- **Sub-agent suitable**: ✅ Yes

**Step 11: Deployment Scripts**
- Docker Compose for local dev
- Cloud Run deployment automation
- Environment setup scripts
- **Sub-agent suitable**: ✅ Yes

## Dependency Details by Component

### Bouncer Agent
**External Dependencies:**
- Anthropic Claude API (for conversational responses)
- Email verification webhook (Maileroo)
- LinkedIn verification (Social Butterfly - Phase 3)

**Internal Dependencies:**
- @yachtparty/shared (types, utilities)
- Database: users, conversations, messages, events
- Real-Time Processor (to be invoked)

**Provides To:**
- Concierge Agent (verified users transition)

**Critical Path**: ✅ Can be built immediately

---

### Message Orchestrator
**External Dependencies:**
- Twilio API (for sending SMS)

**Internal Dependencies:**
- @yachtparty/shared (types, utilities)
- Database: message_queue, user_message_budget, messages
- Concierge Agent (for message rendering - can stub initially)

**Provides To:**
- All agents (outbound message sending)

**Critical Path**: ⚠️ Needed before agents can send outbound messages

---

### Concierge Agent
**External Dependencies:**
- Anthropic Claude API (for conversational responses)

**Internal Dependencies:**
- @yachtparty/shared (types, utilities)
- Database: users, conversations, messages, events, user_priorities
- Account Manager (for priorities - optional for MVP)
- Real-Time Processor (to be invoked)

**Provides To:**
- Message Orchestrator (message rendering)
- Solution Saga (user inquiry handling)
- Intro workflows

**Critical Path**: ⚠️ Needed after Bouncer for verified user interactions

---

### Account Manager
**External Dependencies:**
- Anthropic Claude API (for LLM priority scoring)

**Internal Dependencies:**
- @yachtparty/shared (types, utilities)
- Database: events, user_priorities, agent_tasks
- pg_cron (scheduled execution every 6 hours)

**Provides To:**
- Concierge Agent (user priorities)

**Critical Path**: ⏸️ Optional for MVP, adds priority intelligence

---

### Solution Saga
**External Dependencies:**
- Anthropic Claude API (for LLM decisions)
- Perplexity API (for solution research)

**Internal Dependencies:**
- @yachtparty/shared (types, utilities)
- Database: solution_workflows, community_requests, events
- Agent of Humans (request routing)
- Concierge Agent (user communication)

**Provides To:**
- User value (solution discovery)

**Critical Path**: ⏸️ Phase 2 feature

---

## External API Dependencies

| API | Used By | Required For | Phase |
|-----|---------|--------------|-------|
| Anthropic Claude | All agents | LLM decisions, conversational responses | 1 (MVP) |
| Twilio | Webhook Handler, SMS Sender, Message Orchestrator | SMS messaging | 1 (MVP) |
| Supabase | All services, all agents | Database, Realtime | 1 (MVP) |
| Perplexity | Solution Saga | Solution research | 2 |
| Apify (LinkedIn) | Social Butterfly | Mutual connection discovery | 3 |
| Maileroo | Bouncer Agent | Email verification | 1 (MVP) |

## Critical Path Analysis

**For End-to-End SMS Testing:**
1. ✅ Database Schema (complete)
2. ✅ Twilio Webhook Handler (complete)
3. ✅ Real-Time Message Processor (complete)
4. 🔄 **Bouncer Agent** ← NEXT
5. 🔄 **Message Orchestrator** ← NEXT
6. ✅ SMS Sender Service (complete)

**Minimum Viable Product (MVP):**
- Bouncer Agent (user onboarding)
- Message Orchestrator (outbound messaging)
- Concierge Agent (basic conversations)

**Everything else is Phase 2+**

## Circular Dependency Prevention

**Design Pattern: Event-Driven Communication**
- Agents never call other agents directly
- All communication via events table
- Message Orchestrator is one-way (agents → users)
- Concierge renders messages on-demand (no callback to Message Orchestrator)

**No Circular Dependencies Exist:**
✅ Bouncer → Events → Real-Time Processor → Bouncer (via event loop)
✅ Concierge → Account Manager (read-only, no callback)
✅ Solution Saga → Agent of Humans → Community (all via events)

## Recommended Implementation Order

### Session 1 (Current) - Use 3 Sub-Agents in Parallel
1. **Bouncer Agent** (Sub-agent A)
2. **Message Orchestrator** (Sub-agent B)
3. **Basic Concierge Agent** (Sub-agent C)

This gives us a complete MVP flow:
- New user texts → Bouncer onboards → User verified → Concierge handles → Messages sent

### Session 2
4. **Account Manager** (Sub-agent D)
5. **Enhanced Concierge** with priorities (Sub-agent E)
6. **Testing infrastructure** (Sub-agent F)

### Session 3 (Phase 2)
7. **Agent of Humans** (Sub-agent G)
8. **Solution Saga** (Sub-agent H)

### Session 4 (Phase 3)
9. **Social Butterfly** (Sub-agent I)
10. **Intro Agent** (Sub-agent J)
11. **Innovator Agent** (Sub-agent K)

## Notes
- All sub-agent assignments will be tracked in SUB_AGENT_ASSIGNMENTS.md
- Each agent should be independently deployable and testable
- Use TypeScript strict mode for all implementations
- Follow event-driven patterns from claude.md
- Log all LLM calls to agent_actions_log for cost tracking

Last updated: 2025-10-15
