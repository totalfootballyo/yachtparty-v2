/**
 * Agent Type Definitions for Yachtparty Multi-Agent System
 *
 * This file defines all TypeScript types for the agent system including:
 * - Agent types and classifications
 * - Agent context structures
 * - Agent response formats
 * - Task types and priorities
 * - Action types agents can take
 *
 * Based on requirements.md Section 4 and claude.md architectural patterns.
 *
 * @module types/agents
 */

// ============================================================================
// Agent Type Definitions
// ============================================================================

/**
 * All agent types in the Yachtparty system.
 *
 * User-facing agents (write prose):
 * - bouncer: Onboards new users through verification
 * - concierge: Primary interface for verified users
 * - innovator: Concierge variant for innovator users
 *
 * Background agents (output structured data):
 * - account_manager: Processes events and maintains user priorities
 * - solution_saga: Orchestrates multi-step solution research
 * - intro_handler: Facilitates introduction workflows
 * - agent_of_humans: Routes community requests to experts
 * - social_butterfly: Researches prospects and finds connection paths
 * - demand_agent: Identifies and routes demand signals
 */
export type AgentType =
  | 'bouncer'
  | 'concierge'
  | 'innovator'
  | 'account_manager'
  | 'solution_saga'
  | 'intro_handler'
  | 'agent_of_humans'
  | 'social_butterfly'
  | 'demand_agent';

/**
 * Primary point-of-contact agent types assigned to users.
 * These agents handle direct user communication via SMS.
 *
 * Stored in users.poc_agent_type field.
 */
export type POCAgentType = 'bouncer' | 'concierge' | 'innovator';

// ============================================================================
// Priority and Status Enums
// ============================================================================

/**
 * Priority levels for tasks and messages.
 * Determines processing order and delivery urgency.
 *
 * - urgent: Immediate delivery (user actively conversing)
 * - high: Next available slot (intro acceptances, high-value matches)
 * - medium: Scheduled optimally (solution updates, weekly summaries)
 * - low: Defer if queue full (tips, network updates)
 */
export type Priority = 'urgent' | 'high' | 'medium' | 'low';

/**
 * Task processing status.
 * Tracks lifecycle of agent tasks in the queue.
 */
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

/**
 * Message queue status.
 * Tracks lifecycle of queued messages.
 */
export type MessageQueueStatus = 'queued' | 'approved' | 'sent' | 'superseded' | 'cancelled';

// ============================================================================
// Task Type Definitions
// ============================================================================

/**
 * All task types that can be scheduled in the agent_tasks table.
 *
 * Task types map to specific agent workflows:
 * - re_engagement_check: Follow up with inactive onboarding users (Bouncer)
 * - process_community_request: Route expert request to qualified users (Agent of Humans)
 * - notify_user_of_priorities: Alert user of high-value opportunities (Concierge)
 * - solution_workflow_timeout: Check if expert responses are overdue (Solution Saga)
 * - create_conversation_summary: Summarize conversation every 50 messages (System)
 * - intro_followup_check: Verify intro completion status (Intro Handler)
 * - community_request_available: Notify expert of request (Account Manager)
 * - process_community_response: Evaluate expert response usefulness (Solution Saga)
 * - community_response_available: Notify requester of expert response (Account Manager)
 * - notify_expert_of_impact: Close-the-loop with expert about response impact (Account Manager)
 * - research_solution: Initiate solution research workflow (Task Processor)
 * - schedule_followup: Create followup message for user (Task Processor)
 * - update_user_profile: Update user record fields (Task Processor)
 * - send_introduction: Send introduction email (Task Processor)
 * - verify_user: Process user verification (Task Processor)
 */
export type TaskType =
  | 're_engagement_check'
  | 'process_community_request'
  | 'notify_user_of_priorities'
  | 'solution_workflow_timeout'
  | 'create_conversation_summary'
  | 'intro_followup_check'
  | 'community_request_available'
  | 'process_community_response'
  | 'community_response_available'
  | 'notify_expert_of_impact'
  | 'research_solution'
  | 'schedule_followup'
  | 'update_user_profile'
  | 'send_introduction'
  | 'verify_user'
  | 'verify_linkedin_connection';

// ============================================================================
// Database Entity Types
// ============================================================================

/**
 * User record structure.
 * Minimal fields needed for agent context loading.
 */
export interface User {
  id: string;
  phone_number: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  title?: string;
  linkedin_url?: string;
  verified: boolean;
  innovator: boolean;
  expert_connector: boolean;
  expertise?: string[];
  poc_agent_id?: string;
  poc_agent_type?: POCAgentType;
  quiet_hours_start?: string;
  quiet_hours_end?: string;
  timezone?: string;
  response_pattern?: Record<string, any>;
  credit_balance: number;
  status_level: string;
  created_at: string;
  updated_at: string;
  last_active_at?: string;
}

/**
 * Conversation record structure.
 */
export interface Conversation {
  id: string;
  user_id: string;
  phone_number: string;
  status: 'active' | 'paused' | 'completed';
  conversation_summary?: string;
  last_summary_message_id?: string;
  created_at: string;
  updated_at: string;
  last_message_at?: string;
  messages_since_summary?: number;
}

/**
 * Message record structure.
 */
export interface Message {
  id: string;
  conversation_id: string;
  user_id: string;
  role: string;
  content: string;
  direction: 'inbound' | 'outbound';
  twilio_message_sid?: string;
  status?: string;
  created_at: string;
  sent_at?: string;
  delivered_at?: string;
}

/**
 * User priority item structure.
 * Maintained by Account Manager, read by Concierge.
 */
export interface UserPriority {
  id: string;
  user_id: string;
  priority_rank: number;
  item_type: 'intro_opportunity' | 'community_request' | 'solution_update' | 'community_response' | 'expert_impact_notification';
  item_id: string;
  value_score?: number;
  status: 'active' | 'presented' | 'actioned' | 'expired';
  created_at: string;
  expires_at?: string;
  presented_at?: string;
}

// ============================================================================
// Agent Context Structures
// ============================================================================

/**
 * Context loaded by agents on each invocation.
 *
 * Agents are stateless - they load fresh context from database
 * on every invocation and use prompt caching to reduce cost.
 *
 * Cacheable components:
 * - System prompts (~4000 tokens, static)
 * - User profiles (~500 tokens, infrequent updates)
 * - Conversation history (~3000 tokens, updated per message)
 * - User priorities (~1000 tokens, updated every 6h)
 */
export interface AgentContext {
  /**
   * User record including preferences and agent assignment.
   */
  user: User;

  /**
   * Active conversation (if applicable).
   */
  conversation?: Conversation;

  /**
   * Recent messages from conversation.
   * Typically last 20 messages, or messages since last summary.
   */
  recentMessages: Message[];

  /**
   * LLM-generated conversation summary (if >50 messages).
   * Prevents context window explosion.
   */
  conversationSummary?: string;

  /**
   * Top user priorities from Account Manager.
   * Ranked list of highest-value opportunities.
   */
  userPriorities?: UserPriority[];

  /**
   * Learned user preferences and response patterns.
   * Includes best times to reach, preferred communication style, etc.
   */
  userPreferences?: Record<string, any>;
}

// ============================================================================
// Agent Action Types
// ============================================================================

/**
 * Types of actions agents can request.
 * These are the verbs agents use to interact with the system.
 */
export type AgentActionType =
  // User data updates
  | 'update_user_field'
  | 'update_user_preferences'
  | 'mark_user_verified'
  | 'set_referrer'
  | 'store_name_dropped'

  // Solution workflows
  | 'request_solution_research'
  | 'update_solution_workflow'
  | 'complete_solution_workflow'

  // Introduction workflows
  | 'show_intro_opportunity'
  | 'create_intro_opportunity'
  | 'accept_intro'
  | 'reject_intro'
  | 'schedule_intro'

  // Community requests
  | 'ask_community_question'
  | 'create_community_request'
  | 'record_community_response'
  | 'award_credits'

  // User goals and context
  | 'store_user_goal'

  // Task management
  | 'schedule_followup'
  | 'create_task'
  | 'create_verification_task'
  | 'create_agent_task'

  // Priority management
  | 'update_priority_status'
  | 'add_user_priority'
  | 'remove_user_priority'

  // Message orchestration (new for simplified architecture)
  | 'send_message'
  | 'send_message_sequence'
  | 'queue_message'
  | 'cancel_queued_message'

  // Innovator-specific
  | 'update_innovator_profile'
  | 'generate_prospect_upload_link'
  | 'report_intro_progress'
  | 'generate_payment_link';

/**
 * Agent action structure.
 * Specifies what action to take and with what parameters.
 */
export interface AgentAction {
  /**
   * Type of action to execute.
   */
  type: AgentActionType;

  /**
   * Action-specific parameters.
   */
  params: Record<string, any>;

  /**
   * Optional reason or context for the action.
   */
  reason?: string;
}

// ============================================================================
// Agent Response Structure
// ============================================================================

/**
 * Standard response format from agent invocations.
 *
 * All agents return this structure regardless of type.
 * The response specifies what immediate actions to take,
 * what events to publish, and what tasks to schedule.
 */
export interface AgentResponse {
  /**
   * Whether to reply to user immediately (bypasses message queue).
   * Only true when user is actively conversing.
   */
  immediateReply?: boolean;

  /**
   * Message to send to user (if immediateReply is true).
   * For background agents, this contains structured data
   * that Concierge will render into prose.
   *
   * @deprecated Use messages array instead for sequence support
   */
  message?: string;

  /**
   * Array of messages to send as a sequence (if immediateReply is true).
   * Used for message sequences - all messages sent together, counts as 1 toward budget.
   * Each message should be 2-3 sentences max.
   */
  messages?: string[];

  /**
   * Structured message data (for background agents).
   * Concierge reads this to craft conversational prose.
   */
  messageData?: Record<string, any>;

  /**
   * Actions to execute (update database, create tasks, etc.).
   */
  actions: AgentAction[];

  /**
   * Events to publish to event bus.
   * Other agents subscribe to these events.
   */
  events?: AgentEvent[];

  /**
   * Tasks to create in agent_tasks table.
   * Scheduled for future processing.
   */
  tasks?: AgentTask[];

  /**
   * LLM decision reasoning (for debugging).
   * Stored in workflow state for audit trail.
   */
  reasoning?: string;

  /**
   * Priority updates to mark as 'presented'.
   */
  priorityUpdates?: string[];
}

// ============================================================================
// Event Structure
// ============================================================================

/**
 * Event types published to event bus.
 *
 * Events follow naming convention: {entity}.{action}.{status}
 * Examples:
 * - user.message.received
 * - solution.research_complete
 * - intro.opportunity_created
 * - community.response_received
 */
export type EventType = string;

/**
 * Event structure for event sourcing.
 *
 * All inter-agent communication happens via events.
 * Agents never directly call other agents.
 */
export interface AgentEvent {
  /**
   * Type of event (follows naming convention).
   */
  event_type: EventType;

  /**
   * ID of primary entity this event relates to.
   */
  aggregate_id: string;

  /**
   * Type of aggregate entity.
   */
  aggregate_type: 'user' | 'conversation' | 'intro_opportunity' | 'solution_workflow' | 'community_request' | 'agent_task';

  /**
   * Event payload (flexible structure).
   */
  payload: Record<string, any>;

  /**
   * Metadata (agent tracking, correlation IDs).
   */
  metadata?: Record<string, any>;

  /**
   * Agent/function that created this event.
   */
  created_by: string;
}

// ============================================================================
// Task Structure
// ============================================================================

/**
 * Agent task for scheduled processing.
 *
 * Tasks are scheduled in agent_tasks table and processed
 * by pg_cron every 2 minutes.
 */
export interface AgentTask {
  /**
   * Type of task to execute.
   */
  task_type: TaskType;

  /**
   * Agent responsible for processing this task.
   */
  agent_type: AgentType;

  /**
   * User this task relates to (if applicable).
   */
  user_id?: string;

  /**
   * Related entity ID.
   */
  context_id?: string;

  /**
   * Type of context entity.
   */
  context_type?: string;

  /**
   * When to execute this task.
   */
  scheduled_for: Date | string;

  /**
   * Task priority level.
   */
  priority: Priority;

  /**
   * Complete context needed to process task independently.
   */
  context_json: Record<string, any>;

  /**
   * Maximum retry attempts.
   */
  max_retries?: number;
}

// ============================================================================
// Workflow State Types
// ============================================================================

/**
 * Solution workflow state structure.
 *
 * Tracks multi-step solution research saga.
 * State persisted between agent invocations.
 */
export interface SolutionWorkflow {
  id: string;
  user_id: string;
  request_description: string;
  category?: string;
  current_step: 'initial_research' | 'evaluate_initial' | 'awaiting_expert_responses' | 'process_expert_response' | 'final_evaluation' | 'complete';
  status: 'in_progress' | 'completed' | 'cancelled';
  perplexity_results?: Record<string, any>;
  matched_innovators?: any[];
  community_insights?: any[];
  expert_recommendations?: any[];
  quality_threshold_met?: boolean;
  last_decision_at?: string;
  next_action?: string;
  pending_tasks?: any[];
  completed_tasks?: any[];
  conversation_log?: WorkflowDecision[];
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

/**
 * Workflow decision log entry.
 *
 * Stores LLM decision points for debugging and audit trail.
 */
export interface WorkflowDecision {
  step: string;
  decision: string;
  reasoning: string;
  timestamp: string;
  data?: Record<string, any>;
}

/**
 * Introduction opportunity structure.
 */
export interface IntroOpportunity {
  id: string;
  connector_user_id: string;
  innovator_id?: string;
  prospect_id?: string;
  prospect_name: string;
  prospect_company?: string;
  prospect_title?: string;
  prospect_linkedin_url?: string;
  innovator_name?: string;
  bounty_credits: number;
  status: 'open' | 'pending' | 'accepted' | 'rejected' | 'completed' | 'removed';
  connector_response?: string;
  feed_item_id?: string;
  intro_email?: string;
  intro_scheduled_at?: string;
  intro_completed_at?: string;
  created_at: string;
  updated_at: string;
  expires_at?: string;
}

/**
 * Community request structure.
 */
export interface CommunityRequest {
  id: string;
  requesting_agent_type: AgentType;
  requesting_user_id?: string;
  context_id?: string;
  context_type?: string;
  question: string;
  category?: string;
  expertise_needed?: string[];
  target_user_ids?: string[];
  status: 'open' | 'responses_received' | 'closed';
  responses_count: number;
  closed_loop_at?: string;
  closed_loop_message?: string;
  created_at: string;
  expires_at: string;
}

/**
 * Community response structure.
 */
export interface CommunityResponse {
  id: string;
  request_id: string;
  user_id: string;
  response_text: string;
  verbatim_answer: string;
  usefulness_score?: number;
  impact_description?: string;
  credits_awarded?: number;
  credited_at?: string;
  status: 'provided' | 'rewarded' | 'closed_loop';
  closed_loop_message?: string;
  closed_loop_at?: string;
  created_at: string;
}

// ============================================================================
// Agent Configuration Types
// ============================================================================

/**
 * Agent instance configuration.
 *
 * Tracks agent configuration versions for debugging and A/B testing.
 * NOT for stateless execution tracking (use agent_actions_log).
 */
export interface AgentInstance {
  id: string;
  agent_type: AgentType;
  user_id?: string;
  config_json?: Record<string, any>;
  prompt_version?: string;
  status: 'active' | 'inactive' | 'terminated';
  last_active_at: string;
  created_at: string;
  terminated_at?: string;
}

/**
 * Agent action log entry.
 *
 * Comprehensive logging for debugging and cost tracking.
 */
export interface AgentActionLog {
  id: string;
  agent_type: AgentType;
  agent_instance_id?: string;
  action_type: string;
  user_id?: string;
  context_id?: string;
  context_type?: string;
  model_used?: string;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  latency_ms?: number;
  input_data?: Record<string, any>;
  output_data?: Record<string, any>;
  error?: string;
  created_at: string;
}

// ============================================================================
// Message Queue Types
// ============================================================================

/**
 * Queued message structure.
 *
 * Managed by Message Orchestrator for rate limiting and priority.
 */
export interface QueuedMessage {
  id: string;
  user_id: string;
  agent_id: string;
  message_data: Record<string, any>;
  final_message?: string;
  scheduled_for: string;
  priority: Priority;
  status: MessageQueueStatus;
  superseded_by_message_id?: string;
  superseded_reason?: string;
  conversation_context_id?: string;
  requires_fresh_context: boolean;
  sent_at?: string;
  delivered_message_id?: string;
  created_at: string;
}

/**
 * User message budget tracking.
 *
 * Rate limiting state for message frequency control.
 */
export interface UserMessageBudget {
  id: string;
  user_id: string;
  date: string;
  messages_sent: number;
  last_message_at?: string;
  daily_limit: number;
  hourly_limit: number;
  quiet_hours_enabled: boolean;
  created_at: string;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Rate limit check result.
 */
export interface RateLimitResult {
  allowed: boolean;
  nextAvailableAt?: Date;
  reason?: string;
}

/**
 * Message relevance check result.
 */
export interface MessageRelevanceResult {
  relevant: boolean;
  shouldReformulate: boolean;
  reason: string;
  classification?: 'RELEVANT' | 'STALE' | 'CONTEXTUAL';
}

/**
 * LLM decision result (generic).
 */
export interface LLMDecision<T = any> {
  decision: T;
  reasoning: string;
  confidence?: number;
  alternatives?: T[];
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for POC agent types.
 */
export function isPOCAgentType(agentType: string): agentType is POCAgentType {
  return ['bouncer', 'concierge', 'innovator'].includes(agentType);
}

/**
 * Type guard for background agent types.
 */
export function isBackgroundAgentType(agentType: string): agentType is AgentType {
  return ['account_manager', 'solution_saga', 'intro_handler', 'agent_of_humans', 'social_butterfly', 'demand_agent'].includes(agentType);
}

/**
 * Type guard for user-facing agents (write prose).
 */
export function isUserFacingAgent(agentType: string): boolean {
  return isPOCAgentType(agentType);
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get agent type display name.
 */
export function getAgentDisplayName(agentType: AgentType): string {
  const displayNames: Record<AgentType, string> = {
    bouncer: 'Bouncer',
    concierge: 'Concierge',
    innovator: 'Innovator',
    account_manager: 'Account Manager',
    solution_saga: 'Solution Saga',
    intro_handler: 'Intro Handler',
    agent_of_humans: 'Agent of Humans',
    social_butterfly: 'Social Butterfly',
    demand_agent: 'Demand Agent',
  };
  return displayNames[agentType] || agentType;
}

/**
 * Get priority numeric value for sorting.
 */
export function getPriorityValue(priority: Priority): number {
  const priorityValues: Record<Priority, number> = {
    urgent: 1,
    high: 2,
    medium: 3,
    low: 4,
  };
  return priorityValues[priority];
}

/**
 * Compare priorities (for sorting).
 * Returns negative if a < b, positive if a > b, 0 if equal.
 */
export function comparePriorities(a: Priority, b: Priority): number {
  return getPriorityValue(a) - getPriorityValue(b);
}
