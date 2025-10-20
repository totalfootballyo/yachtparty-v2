# @yachtparty/shared

Shared TypeScript types, interfaces, and utilities used across all Yachtparty services and agents.

## Structure

```
shared/
├── src/
│   ├── types/           # TypeScript type definitions
│   │   ├── database.ts  # Database table types
│   │   ├── events.ts    # Event type definitions
│   │   ├── agents.ts    # Agent-related types
│   │   └── api.ts       # External API types (Twilio, Claude, etc.)
│   ├── utils/           # Utility functions
│   │   ├── supabase.ts  # Supabase client utilities
│   │   ├── events.ts    # Event publishing helpers
│   │   └── validation.ts # Input validation
│   └── index.ts         # Main export file
```

## Usage

```typescript
import {
  User,
  Event,
  AgentTask,
  publishEvent,
  createSupabaseClient
} from '@yachtparty/shared';

// Use types for type safety
const user: User = {
  id: '...',
  phone_number: '+15551234567',
  // ...
};

// Publish events
await publishEvent({
  eventType: 'user.message.received',
  aggregateId: user.id,
  aggregateType: 'user',
  payload: { message: 'Hello' }
});

// Create Supabase client
const supabase = createSupabaseClient();
```

## Key Types

### Database Types
- `User`, `Conversation`, `Message`
- `Event`, `AgentTask`, `MessageQueue`
- `SolutionWorkflow`, `IntroOpportunity`
- `CommunityRequest`, `CommunityResponse`
- `CreditEvent`, `Prospect`, `Innovator`

### Event Types
- `EventType` - Union of all event type strings
- `EventPayload` - Event payload by type
- `PublishEventParams` - Parameters for publishing events

### Agent Types
- `AgentType` - Union of agent type strings
- `AgentContext` - Context loaded for agent invocations
- `AgentResponse` - Standard agent response format

## Building

```bash
npm run build        # Compile TypeScript
npm run dev          # Watch mode for development
```
