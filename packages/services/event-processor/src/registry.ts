/**
 * Event Handler Registry
 *
 * Central registry for mapping event types to their handlers.
 * This enables:
 * - Type-safe event routing
 * - Easy addition of new event types
 * - Clear documentation of supported events
 */

import type { EventType } from '@yachtparty/shared';
import type { Event, EventHandler, EventHandlerRegistration } from './types';

// Import handlers
import {
  handleSolutionResearchNeeded,
  handleCommunityQuestionAsked,
  handleIntroRequested,
  handleProfileUpdated,
} from './handlers/user-events';

import {
  handleMessageReceived,
  handleResponseRecorded,
} from './handlers/conversation-events';

import {
  handleSolutionResearchComplete,
  handleIntroCompleted,
  handleCommunityResponseReceived,
  handleAccountManagerComplete,
} from './handlers/system-events';

/**
 * Event handler registry
 * Maps event types to their handler functions
 */
const eventHandlers = new Map<EventType, EventHandlerRegistration>();

/**
 * Register an event handler
 */
function registerHandler(
  eventType: EventType,
  handler: EventHandler,
  description: string
): void {
  eventHandlers.set(eventType, {
    eventType,
    handler,
    description,
  });
}

/**
 * Initialize all event handlers
 */
export function initializeHandlers(): void {
  console.log('Initializing event handlers...');

  // User Events
  registerHandler(
    'user.inquiry.solution_needed',
    handleSolutionResearchNeeded,
    'Creates research task for Solution Saga when user needs solution research'
  );

  registerHandler(
    'community.request_needed',
    handleCommunityQuestionAsked,
    'Creates community request and notifies matching experts'
  );

  registerHandler(
    'user.intro_inquiry',
    handleIntroRequested,
    'Creates task for Account Manager to handle intro request'
  );

  registerHandler(
    'user.verified',
    handleProfileUpdated,
    'Handles user verification completion, notifies Account Manager'
  );

  // Conversation Events
  registerHandler(
    'user.message.received',
    handleMessageReceived,
    'Updates user activity timestamps when message received'
  );

  registerHandler(
    'user.response.recorded',
    handleResponseRecorded,
    'Tracks user responses for learning and optimization'
  );

  // System Events
  registerHandler(
    'solution.research_complete',
    handleSolutionResearchComplete,
    'Delivers completed solution research findings to user'
  );

  registerHandler(
    'intro.completed',
    handleIntroCompleted,
    'Awards credits and notifies parties when intro completes'
  );

  registerHandler(
    'community.response_received',
    handleCommunityResponseReceived,
    'Processes expert response and delivers to requester'
  );

  registerHandler(
    'account_manager.processing.completed',
    handleAccountManagerComplete,
    'Logs Account Manager processing results'
  );

  console.log(`✓ Registered ${eventHandlers.size} event handlers`);
}

/**
 * Get handler for event type
 * Returns undefined if no handler registered
 */
export function getEventHandler(eventType: EventType): EventHandler | undefined {
  const registration = eventHandlers.get(eventType);
  return registration?.handler;
}

/**
 * Check if handler exists for event type
 */
export function hasHandler(eventType: EventType): boolean {
  return eventHandlers.has(eventType);
}

/**
 * Get all registered event types
 */
export function getRegisteredEventTypes(): EventType[] {
  return Array.from(eventHandlers.keys());
}

/**
 * Get handler information
 */
export function getHandlerInfo(eventType: EventType): EventHandlerRegistration | undefined {
  return eventHandlers.get(eventType);
}

/**
 * Get all handler registrations
 */
export function getAllHandlers(): EventHandlerRegistration[] {
  return Array.from(eventHandlers.values());
}

/**
 * Route event to appropriate handler
 * Main entry point for event processing
 */
export async function routeEvent(event: Event): Promise<void> {
  const handler = getEventHandler(event.event_type);

  if (!handler) {
    console.warn(`⚠️  No handler registered for event type: ${event.event_type}`);
    return;
  }

  try {
    await handler(event);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`✗ Handler error for ${event.event_type}:`, errorMessage);
    throw error; // Re-throw to trigger retry logic
  }
}

/**
 * Get registry statistics
 */
export function getRegistryStats(): {
  totalHandlers: number;
  eventTypes: EventType[];
} {
  return {
    totalHandlers: eventHandlers.size,
    eventTypes: getRegisteredEventTypes(),
  };
}
