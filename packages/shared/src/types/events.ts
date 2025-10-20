/**
 * Event System Type Definitions
 *
 * This file contains all event types, payload interfaces, and helper types
 * for the Yachtparty event-driven architecture.
 *
 * All inter-agent communication happens via events published to the events table.
 * Agents never directly call other agents, eliminating circular dependencies
 * and enabling replay, debugging, and audit trails.
 */

// ============================================================================
// Event Types (String Union)
// ============================================================================

/**
 * All possible event types in the Yachtparty platform.
 * Events are categorized by domain prefix (user, solution, community, intro, etc.)
 */
export type EventType =
  // User Events
  | 'user.message.received'
  | 'user.onboarding_step.completed'
  | 'user.verification.pending'
  | 'user.verified'
  | 'user.inquiry.solution_needed'
  | 'user.inquiry.detected'
  | 'user.response.recorded'
  | 'user.intro_inquiry'

  // Solution Events
  | 'solution.initial_findings'
  | 'solution.research_complete'
  | 'solution.demand_signal'

  // Community Events
  | 'community.request_needed'
  | 'community.request_created'
  | 'community.request_routed'
  | 'community.request_attached'
  | 'community.response_received'
  | 'community.request_closed'
  | 'community.expert_notified_of_impact'
  | 'community.no_experts_found'

  // Intro Events
  | 'intro.opportunity_created'
  | 'intro.accepted'
  | 'intro.completed'

  // Priority Events
  | 'priority.intro_added'

  // Message Events
  | 'message.send.requested'
  | 'message.ready_to_send'

  // Agent Task Events
  | 'agent.task_ready'

  // Account Manager Events
  | 'account_manager.processing.completed'

  // Prospect Events
  | 'prospect.research_needed'
  | 'prospect.research_complete'
  | 'prospects.batch_uploaded'
  | 'prospects.converted'
  | 'prospects.upgraded_on_signup';

/**
 * Aggregate types for event sourcing.
 * Indicates the primary entity type an event relates to.
 */
export type AggregateType =
  | 'user'
  | 'intro_opportunity'
  | 'solution_request'
  | 'solution_workflow'
  | 'community_request'
  | 'community_response'
  | 'conversation'
  | 'agent_task'
  | 'prospect'
  | 'prospect_batch'
  | 'message';

// ============================================================================
// Event Base Structure
// ============================================================================

/**
 * Base structure common to all events.
 * All events in the system extend this base interface.
 */
export interface EventBase {
  /** Unique identifier for this event */
  id: string;

  /** Type of event (determines payload schema) */
  event_type: EventType;

  /** ID of primary entity this event relates to */
  aggregate_id: string;

  /** Type of entity referenced by aggregate_id */
  aggregate_type: AggregateType;

  /** Additional metadata (agent tracking, correlation IDs, etc.) */
  metadata?: Record<string, unknown>;

  /** Whether this event has been processed */
  processed: boolean;

  /** Version for optimistic locking */
  version: number;

  /** Timestamp when event was created */
  created_at: string;

  /** Agent or function that created this event */
  created_by: string;
}

/**
 * Generic typed event with specific payload.
 * Use this to create strongly-typed event objects.
 */
export interface EventWithPayload<T> extends EventBase {
  payload: T;
}

// ============================================================================
// Event Payload Types
// ============================================================================

// User Event Payloads
// ----------------------------------------------------------------------------

/**
 * Payload for user.message.received event.
 * Triggered when an inbound SMS message arrives from a user.
 */
export interface UserMessageReceivedPayload {
  userId: string;
  conversationId: string;
  message: string;
  phoneNumber: string;
  messageId: string;
}

/**
 * Payload for user.onboarding_step.completed event.
 * Tracks progress through the onboarding flow.
 */
export interface UserOnboardingStepCompletedPayload {
  userId: string;
  step: 'name_collected' | 'company_collected' | 'email_requested' | 'linkedin_requested' | 'nomination_requested';
  data?: Record<string, unknown>;
}

/**
 * Payload for user.verification.pending event.
 * Indicates user is awaiting verification (email or LinkedIn).
 */
export interface UserVerificationPendingPayload {
  userId: string;
  verificationType: 'email' | 'linkedin' | 'both';
  verificationEmail?: string;
}

/**
 * Payload for user.verified event.
 * Indicates user has completed verification and onboarding.
 */
export interface UserVerifiedPayload {
  userId: string;
  verificationCompletedAt: string;
  pocAgentType: 'concierge' | 'innovator';
}

/**
 * Payload for user.inquiry.solution_needed event.
 * Triggered when Concierge detects user needs solution research.
 */
export interface UserInquirySolutionNeededPayload {
  userId: string;
  conversationId: string;
  requestDescription: string;
  category?: string;
  urgency?: 'low' | 'medium' | 'high';
}

/**
 * Payload for user.inquiry.detected event.
 * Generic inquiry classification from Concierge.
 */
export interface UserInquiryDetectedPayload {
  userId: string;
  conversationId: string;
  inquiryType: 'solution' | 'intro' | 'community_question' | 'feedback' | 'general';
  details: Record<string, unknown>;
}

/**
 * Payload for user.response.recorded event.
 * Records user feedback or response to system actions.
 */
export interface UserResponseRecordedPayload {
  userId: string;
  conversationId: string;
  responseType: 'feedback' | 'acceptance' | 'rejection' | 'clarification';
  context: string;
  response: string;
}

/**
 * Payload for user.intro_inquiry event.
 * User is asking about a specific intro opportunity.
 */
export interface UserIntroInquiryPayload {
  userId: string;
  introId: string;
  userQuestion: string;
  conversationId: string;
}

// Solution Event Payloads
// ----------------------------------------------------------------------------

/**
 * Payload for solution.initial_findings event.
 * Solution Saga shares preliminary research results.
 */
export interface SolutionInitialFindingsPayload {
  workflowId: string;
  userId: string;
  findings: {
    summary: string;
    matchedInnovators: Array<{
      id: string;
      name: string;
      relevance: number;
      reason: string;
    }>;
    perplexityInsights?: {
      vendors: string[];
      keyPoints: string[];
    };
    nextSteps: string;
  };
}

/**
 * Payload for solution.research_complete event.
 * Solution Saga has completed full research workflow.
 */
export interface SolutionResearchCompletePayload {
  workflowId: string;
  userId: string;
  requestDescription: string;
  findings: {
    matchedInnovators: Array<{
      id: string;
      name: string;
      relevance: number;
      reason: string;
      contactInfo?: Record<string, unknown>;
    }>;
    potentialVendors?: string[];
    communityInsights?: Array<{
      expertId: string;
      expertName: string;
      recommendation: string;
      usefulness: number;
    }>;
    clarifyingQuestions?: Array<{
      question: string;
      priority: 'low' | 'medium' | 'high';
    }>;
  };
  completedAt: string;
}

/**
 * Payload for solution.demand_signal event.
 * Indicates potential demand for an innovator's solution.
 */
export interface SolutionDemandSignalPayload {
  workflowId: string;
  innovatorId: string;
  prospectUserId: string;
  signalStrength: 'weak' | 'moderate' | 'strong';
  context: string;
}

// Community Event Payloads
// ----------------------------------------------------------------------------

/**
 * Payload for community.request_needed event.
 * An agent needs expert insights from the community.
 */
export interface CommunityRequestNeededPayload {
  requestingAgentType: string;
  requestingUserId?: string;
  contextId?: string;
  contextType?: string;
  question: string;
  category?: string;
  expertiseNeeded: string[];
}

/**
 * Payload for community.request_created event.
 * A community request has been created.
 */
export interface CommunityRequestCreatedPayload {
  requestId: string;
  question: string;
  category?: string;
  expertiseNeeded: string[];
  targetUserIds?: string[];
  expiresAt: string;
}

/**
 * Payload for community.request_routed event.
 * Community request has been routed to experts.
 */
export interface CommunityRequestRoutedPayload {
  requestId: string;
  expertsNotified: number;
  expertUserIds: string[];
}

/**
 * Payload for community.response_received event.
 * An expert has responded to a community request.
 */
export interface CommunityResponseReceivedPayload {
  responseId: string;
  requestId: string;
  expertUserId: string;
  responseSummary: string;
  verbatimAnswer: string;
  contextId?: string;
  contextType?: string;
}

/**
 * Payload for community.request_attached event.
 * A new request was attached to an existing similar request.
 */
export interface CommunityRequestAttachedPayload {
  existingRequestId: string;
  newEventId: string;
  requestingUserId?: string;
  question: string;
}

/**
 * Payload for community.request_closed event.
 * A community request has been closed.
 */
export interface CommunityRequestClosedPayload {
  requestId: string;
  totalResponses: number;
  closedReason: 'expired' | 'sufficient_responses' | 'manual';
  closedAt: string;
}

/**
 * Payload for community.expert_notified_of_impact event.
 * An expert has been notified of their response's impact.
 */
export interface CommunityExpertNotifiedOfImpactPayload {
  expertUserId: string;
  responseId: string;
  requestId: string;
  impactDescription: string;
  creditsAwarded: number;
  usefulnessScore?: number;
}

/**
 * Payload for community.no_experts_found event.
 * No experts were found matching the request criteria.
 */
export interface CommunityNoExpertsFoundPayload {
  category?: string;
  expertiseNeeded: string[];
  question: string;
}

// Intro Event Payloads
// ----------------------------------------------------------------------------

/**
 * Payload for intro.opportunity_created event.
 * A new introduction opportunity has been identified.
 */
export interface IntroOpportunityCreatedPayload {
  introId: string;
  connectorUserId: string;
  prospectInfo: {
    name: string;
    company?: string;
    title?: string;
    linkedinUrl?: string;
  };
  innovatorId?: string;
  prospectId?: string;
  innovatorName?: string;
  bountyCredits: number;
}

/**
 * Payload for intro.accepted event.
 * User has accepted an intro opportunity.
 */
export interface IntroAcceptedPayload {
  introId: string;
  connectorUserId: string;
  acceptedAt: string;
  connectorResponse?: string;
}

/**
 * Payload for intro.completed event.
 * An introduction has been successfully completed.
 */
export interface IntroCompletedPayload {
  introId: string;
  connectorUserId: string;
  innovatorId?: string;
  prospectId?: string;
  completedAt: string;
  creditsAwarded: number;
}

// Priority Event Payloads
// ----------------------------------------------------------------------------

/**
 * Payload for priority.intro_added event.
 * An intro opportunity has been added to user's priority list.
 */
export interface PriorityIntroAddedPayload {
  userId: string;
  introId: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  valueScore?: number;
}

// Message Event Payloads
// ----------------------------------------------------------------------------

/**
 * Payload for message.send.requested event.
 * An agent requests sending a message to a user.
 */
export interface MessageSendRequestedPayload {
  userId: string;
  agentId: string;
  messageData: Record<string, unknown>;
  structuredData?: Record<string, unknown>;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  canDelay?: boolean;
  requiresFreshContext?: boolean;
  conversationContextId?: string;
}

/**
 * Payload for message.ready_to_send event.
 * A queued message is ready for delivery (from Message Orchestrator).
 */
export interface MessageReadyToSendPayload {
  messageQueueId: string;
  userId: string;
  finalMessage: string;
  conversationId: string;
  phoneNumber: string;
}

// Agent Task Event Payloads
// ----------------------------------------------------------------------------

/**
 * Payload for agent.task_ready event.
 * A scheduled task is ready for processing.
 */
export interface AgentTaskReadyPayload {
  taskId: string;
  taskType: string;
  agentType: string;
  context: Record<string, unknown>;
  priority?: 'urgent' | 'high' | 'medium' | 'low';
}

// Account Manager Event Payloads
// ----------------------------------------------------------------------------

/**
 * Payload for account_manager.processing.completed event.
 * Account Manager has completed processing for a user.
 */
export interface AccountManagerProcessingCompletedPayload {
  userId: string;
  processedEvents: number;
  urgentItems: number;
  prioritiesUpdated: number;
  tasksCreated: number;
  completedAt: string;
}

// Prospect Event Payloads
// ----------------------------------------------------------------------------

/**
 * Payload for prospect.research_needed event.
 * Research is needed on a prospect (LinkedIn, etc.).
 */
export interface ProspectResearchNeededPayload {
  prospectId: string;
  innovatorId?: string;
  researchType: 'linkedin_mutual_connections' | 'company_info' | 'contact_discovery';
  linkedinUrl?: string;
}

/**
 * Payload for prospect.research_complete event.
 * Research on a prospect has been completed.
 */
export interface ProspectResearchCompletePayload {
  prospectId: string;
  researchType: string;
  mutualConnectionsFound?: number;
  platformUsersFound?: number;
  results: Record<string, unknown>;
  completedAt: string;
}

/**
 * Payload for prospects.batch_uploaded event.
 * A batch of prospects has been uploaded by an innovator.
 */
export interface ProspectsBatchUploadedPayload {
  innovator_id: string;
  upload_source: string;
  record_count: number;
}

/**
 * Payload for prospects.converted event.
 * A prospect has been converted to a user.
 */
export interface ProspectsConvertedPayload {
  prospect_id: string;
  user_id: string;
  innovator_id: string;
  match_score: number;
  intro_opportunity_id: string;
}

/**
 * Payload for prospects.upgraded_on_signup event.
 * Prospects were upgraded when a user signed up.
 */
export interface ProspectsUpgradedOnSignupPayload {
  prospects_matched: number;
  intro_opportunities_created: number;
  credits_awarded: number;
}

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Parameters for publishing a new event.
 * Used by agents to create events in the system.
 */
export interface PublishEventParams<T = unknown> {
  /** Type of event being published */
  event_type: EventType;

  /** ID of primary entity this event relates to */
  aggregate_id: string;

  /** Type of entity referenced by aggregate_id */
  aggregate_type: AggregateType;

  /** Event payload (type-specific data) */
  payload: T;

  /** Additional metadata (optional) */
  metadata?: Record<string, unknown>;

  /** Agent or function creating this event */
  created_by: string;
}

/**
 * Type guard to check if an event is of a specific type.
 */
export function isEventType<T>(
  event: EventWithPayload<unknown>,
  eventType: EventType
): event is EventWithPayload<T> {
  return event.event_type === eventType;
}

/**
 * Union type of all possible event payloads.
 * Useful for generic event handlers.
 */
export type EventPayload =
  | UserMessageReceivedPayload
  | UserOnboardingStepCompletedPayload
  | UserVerificationPendingPayload
  | UserVerifiedPayload
  | UserInquirySolutionNeededPayload
  | UserInquiryDetectedPayload
  | UserResponseRecordedPayload
  | UserIntroInquiryPayload
  | SolutionInitialFindingsPayload
  | SolutionResearchCompletePayload
  | SolutionDemandSignalPayload
  | CommunityRequestNeededPayload
  | CommunityRequestCreatedPayload
  | CommunityRequestRoutedPayload
  | CommunityRequestAttachedPayload
  | CommunityResponseReceivedPayload
  | CommunityRequestClosedPayload
  | CommunityExpertNotifiedOfImpactPayload
  | CommunityNoExpertsFoundPayload
  | IntroOpportunityCreatedPayload
  | IntroAcceptedPayload
  | IntroCompletedPayload
  | PriorityIntroAddedPayload
  | MessageSendRequestedPayload
  | MessageReadyToSendPayload
  | AgentTaskReadyPayload
  | AccountManagerProcessingCompletedPayload
  | ProspectResearchNeededPayload
  | ProspectResearchCompletePayload
  | ProspectsBatchUploadedPayload
  | ProspectsConvertedPayload
  | ProspectsUpgradedOnSignupPayload;

/**
 * Generic event type with any payload.
 * Use more specific types when possible.
 */
export type Event = EventWithPayload<EventPayload>;

/**
 * Map of event types to their specific payload types.
 * Enables type-safe event handling based on event_type.
 */
export interface EventTypePayloadMap {
  'user.message.received': UserMessageReceivedPayload;
  'user.onboarding_step.completed': UserOnboardingStepCompletedPayload;
  'user.verification.pending': UserVerificationPendingPayload;
  'user.verified': UserVerifiedPayload;
  'user.inquiry.solution_needed': UserInquirySolutionNeededPayload;
  'user.inquiry.detected': UserInquiryDetectedPayload;
  'user.response.recorded': UserResponseRecordedPayload;
  'user.intro_inquiry': UserIntroInquiryPayload;
  'solution.initial_findings': SolutionInitialFindingsPayload;
  'solution.research_complete': SolutionResearchCompletePayload;
  'solution.demand_signal': SolutionDemandSignalPayload;
  'community.request_needed': CommunityRequestNeededPayload;
  'community.request_created': CommunityRequestCreatedPayload;
  'community.request_routed': CommunityRequestRoutedPayload;
  'community.request_attached': CommunityRequestAttachedPayload;
  'community.response_received': CommunityResponseReceivedPayload;
  'community.request_closed': CommunityRequestClosedPayload;
  'community.expert_notified_of_impact': CommunityExpertNotifiedOfImpactPayload;
  'community.no_experts_found': CommunityNoExpertsFoundPayload;
  'intro.opportunity_created': IntroOpportunityCreatedPayload;
  'intro.accepted': IntroAcceptedPayload;
  'intro.completed': IntroCompletedPayload;
  'priority.intro_added': PriorityIntroAddedPayload;
  'message.send.requested': MessageSendRequestedPayload;
  'message.ready_to_send': MessageReadyToSendPayload;
  'agent.task_ready': AgentTaskReadyPayload;
  'account_manager.processing.completed': AccountManagerProcessingCompletedPayload;
  'prospect.research_needed': ProspectResearchNeededPayload;
  'prospect.research_complete': ProspectResearchCompletePayload;
  'prospects.batch_uploaded': ProspectsBatchUploadedPayload;
  'prospects.converted': ProspectsConvertedPayload;
  'prospects.upgraded_on_signup': ProspectsUpgradedOnSignupPayload;
}

/**
 * Type-safe event creator helper.
 * Ensures payload matches event type.
 */
export function createEvent<T extends EventType>(
  eventType: T,
  params: Omit<PublishEventParams<EventTypePayloadMap[T]>, 'event_type'>
): PublishEventParams<EventTypePayloadMap[T]> {
  return {
    event_type: eventType,
    ...params,
  };
}
