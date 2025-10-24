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

import {
  handleIntroOpportunityCreated,
  handleConnectionRequestCreated,
  handleIntroOfferCreated,
  handleIntroOfferAccepted,
  handleIntroOpportunityAccepted,
  handleIntroOpportunityDeclined,
  handleConnectionRequestAccepted,
  handleConnectionRequestDeclined,
  handleIntroOfferDeclined,
  handleIntroOpportunityCancelled,
} from './handlers/intro-priority-handlers';

import {
  handleIntroOfferCompleted,
  handleIntroOpportunityCompletedCredits,
  handleConnectionRequestCompleted,
  handleIntroOfferReminder,
} from './handlers/intro-coordination-handlers';

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

  // Intro Flow Priority Events
  registerHandler(
    'intro.opportunity_created',
    handleIntroOpportunityCreated,
    'Adds intro opportunity to connector\'s priorities'
  );

  registerHandler(
    'connection.request_created',
    handleConnectionRequestCreated,
    'Adds connection request to introducee\'s priorities'
  );

  registerHandler(
    'intro.offer_created',
    handleIntroOfferCreated,
    'Adds intro offer to introducee\'s priorities (Step 1: acceptance)'
  );

  registerHandler(
    'intro.offer_accepted',
    handleIntroOfferAccepted,
    'Moves intro offer to offering_user\'s priorities for confirmation (Step 2)'
  );

  // Intro Flow State Transitions
  registerHandler(
    'intro.opportunity_accepted',
    handleIntroOpportunityAccepted,
    'Marks intro opportunity as actioned in priorities'
  );

  registerHandler(
    'intro.opportunity_declined',
    handleIntroOpportunityDeclined,
    'Marks intro opportunity as expired in priorities'
  );

  registerHandler(
    'intro.opportunity_completed',
    handleIntroOpportunityCompletedCredits,
    'Marks completed, pauses similar, awards credits, closes loop (comprehensive handler)'
  );

  registerHandler(
    'connection.request_accepted',
    handleConnectionRequestAccepted,
    'Marks connection request as actioned in priorities'
  );

  registerHandler(
    'connection.request_declined',
    handleConnectionRequestDeclined,
    'Marks connection request as expired in priorities'
  );

  registerHandler(
    'intro.offer_declined',
    handleIntroOfferDeclined,
    'Marks intro offer as expired in priorities'
  );

  registerHandler(
    'intro.offer_confirmed',
    handleIntroOfferCompleted,
    'Marks confirmation actioned, awards credits, closes loop (comprehensive handler)'
  );

  registerHandler(
    'intro.opportunity_cancelled',
    handleIntroOpportunityCancelled,
    'Removes cancelled intro opportunity from priorities'
  );

  // Intro Flow Coordination (Agent of Humans)
  // Note: Some events have coordinated handlers that handle both priority updates and additional logic
  // intro.opportunity_completed → handled by handleIntroOpportunityCompletedCredits (priorities + credits + messages)
  // intro.offer_confirmed → handled by handleIntroOfferCompleted (priorities + credits + messages)

  registerHandler(
    'connection.request_completed',
    handleConnectionRequestCompleted,
    'Closes loop with both parties when connection request completed'
  );

  registerHandler(
    'intro.offer_reminder',
    handleIntroOfferReminder,
    'Sends confirmation reminder to connector 3 days after acceptance'
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
