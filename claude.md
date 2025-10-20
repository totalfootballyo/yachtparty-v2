# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Documentation

**All technical requirements, architecture, and implementation details are maintained in `requirements.md`.**

Please refer to `requirements.md` for:
- Complete system architecture
- Database schema
- Agent specifications
- Message flow patterns
- Cloud Run services
- Deployment procedures
- Architectural decisions and learnings

## Quick Reference

**Project Structure:**
- `packages/agents/` - Agent implementations (Bouncer, Concierge, Account Manager)
- `packages/services/` - Cloud Run services (twilio-webhook, sms-sender, etc.)
- `packages/shared/` - Shared TypeScript types
- `packages/database/` - Database migrations
- `deploy-service.sh` - Deployment automation

**Key Commands:**
```bash
# Build all packages
npm run build

# Deploy a service
./deploy-service.sh <service-name>

# Run tests
npm test
```

**Critical Architectural Principles (see requirements.md for full details):**

1. **Synchronous Inbound, Event-Driven Background**
   - User messages processed synchronously by twilio-webhook (<3s requirement)
   - Background tasks (Account Manager, scheduled work) use events
   - See requirements.md Section 2.3 for decision criteria

2. **Message Discipline**
   - Strict rate limiting (10 messages/day default)
   - Message sequences count as 1 toward budget
   - All-or-nothing delivery for sequences

3. **Stateless Agents**
   - Agents load context fresh from DB on each invocation
   - Event sourcing for all inter-agent communication
   - LLM decisions logged in agent_actions_log

4. **Database-First**
   - PostgreSQL handles queuing, events, scheduling
   - No Redis until metrics show need (>30s latency, >70% CPU)

## Development Workflow

When making changes:
1. Read `requirements.md` for context
2. Update code
3. Update `requirements.md` if architecture changes
4. Deploy using `./deploy-service.sh`
5. Document learnings in requirements.md Section 13

## Important Notes

- **Single source of truth:** requirements.md
- **Do not duplicate architecture here** - it creates maintenance burden
- **Update requirements.md** when architectural decisions are made
