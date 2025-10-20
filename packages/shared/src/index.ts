/**
 * @yachtparty/shared
 *
 * Shared types, utilities, and configurations for the Yachtparty monorepo.
 * This package provides common functionality used across multiple packages
 * including database types, event schemas, agent interfaces, and utilities.
 */

// Database Types (primary source of truth for entity types)
// Export everything except Event (which conflicts with events.ts)
export type {
  User,
  Conversation,
  Message,
  MessageQueue,
  Innovator,
  Prospect,
  IntroOpportunity,
  SolutionWorkflow,
  CommunityRequest,
  CommunityResponse,
  CreditEvent,
  UserCreditBalance,
  UserPriority,
  UserMessageBudget,
  AgentTask as DatabaseAgentTask,
  AgentInstance,
  AgentActionsLog,
  Event as DatabaseEvent
} from './types/database';

// Event Types (use Event from events.ts as the main Event type)
export type { Event, EventType, EventBase, EventWithPayload, EventPayload, EventTypePayloadMap, PublishEventParams } from './types/events';
export { isEventType, createEvent } from './types/events';

// Agent Types (excluding duplicates from database)
export type {
  AgentType,
  POCAgentType,
  Priority,
  TaskStatus,
  MessageQueueStatus,
  TaskType,
  AgentContext,
  AgentActionType,
  AgentAction,
  AgentResponse,
  AgentEvent,
  AgentTask,
  WorkflowDecision,
  RateLimitResult,
  MessageRelevanceResult,
  LLMDecision
} from './types/agents';

export {
  isPOCAgentType,
  isBackgroundAgentType,
  isUserFacingAgent,
  getAgentDisplayName,
  getPriorityValue,
  comparePriorities
} from './types/agents';

// Supabase Utilities
export * from './utils/supabase';

// Event Utilities
export * from './utils/events';

// Prospect Matching Utilities
export * from './utils/prospect-matching';

// Prospect Upload Utilities
export * from './utils/prospect-upload';

// Prospect Upgrade Utilities
export * from './utils/prospect-upgrade';
