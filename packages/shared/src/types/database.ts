/**
 * Yachtparty Database Type Definitions
 *
 * TypeScript interfaces matching the database schema exactly.
 * Generated from migrations in packages/database/migrations/
 *
 * @see requirements.md Section 3 - Database Schema
 */

// =====================================================
// CORE TABLES
// =====================================================

/**
 * User - Primary user records for all platform participants
 *
 * Stores core user information, agent assignments, preferences,
 * and credit balance. Each user has a primary agent (Bouncer,
 * Concierge, or Innovator) that manages their interface.
 */
export interface User {
  id: string;
  phone_number: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
  linkedin_url: string | null;

  // User classification
  verified: boolean; // Full approval into network (manual)
  email_verified: boolean; // Email verification completed via webhook
  innovator: boolean;
  expert_connector: boolean;
  expertise: string[] | null;

  // Agent assignment
  poc_agent_id: string | null;
  poc_agent_type: 'bouncer' | 'concierge' | 'innovator' | null;

  // Referral tracking
  referred_by: string | null; // UUID of referring user
  name_dropped: string | null; // Raw referrer name if not matched

  // User preferences
  quiet_hours_start: string | null; // TIME format (HH:MM:SS)
  quiet_hours_end: string | null; // TIME format (HH:MM:SS)
  timezone: string | null;
  response_pattern: any | null; // JSONB: learned patterns

  // Credits and status
  credit_balance: number;
  status_level: string;

  // Metadata
  created_at: Date;
  updated_at: Date;
  last_active_at: Date | null;
}

/**
 * Conversation - Tracks ongoing conversation threads between users and the system
 *
 * Each conversation thread is tracked separately for context isolation.
 * Conversations are summarized every 50 messages to prevent context window explosion.
 */
export interface Conversation {
  id: string;
  user_id: string;
  phone_number: string; // Denormalized for quick webhook lookups
  status: 'active' | 'paused' | 'completed';

  // Context management
  conversation_summary: string | null;
  last_summary_message_id: string | null;
  messages_since_summary: number;

  // Metadata
  created_at: Date;
  updated_at: Date;
  last_message_at: Date | null;
}

/**
 * Message - Individual messages in conversations
 *
 * Stores all inbound and outbound messages with delivery tracking.
 * Role indicates the sender (user or agent type).
 */
export interface Message {
  id: string;
  conversation_id: string;
  user_id: string;

  // Message content
  role: 'user' | 'concierge' | 'bouncer' | 'innovator' | 'system';
  content: string;

  // Delivery tracking
  direction: 'inbound' | 'outbound';
  twilio_message_sid: string | null;
  status: 'queued' | 'sent' | 'delivered' | 'failed' | null;

  // Metadata
  created_at: Date;
  sent_at: Date | null;
  delivered_at: Date | null;
}

/**
 * Event - Event sourcing table for agent coordination
 *
 * All system events are stored here for complete audit trail and replay capability.
 * Agents communicate via events, not direct calls, eliminating circular dependencies.
 */
export interface Event {
  id: string;
  event_type: string; // e.g., 'user.message.received', 'solution.research_complete'

  // Event context
  aggregate_id: string | null;
  aggregate_type: string | null; // e.g., 'user', 'intro_opportunity', 'solution_request'

  // Event data
  payload: any; // JSONB: full event data
  metadata: any | null; // JSONB: agent tracking, correlation IDs

  // Processing tracking
  processed: boolean;
  version: number;

  // Metadata
  created_at: Date;
  created_by: string | null;
}

/**
 * AgentTask - Task queue for scheduled and event-driven agent work
 *
 * Replaces simple follow-up timestamps with full task management.
 * Uses FOR UPDATE SKIP LOCKED pattern to prevent duplicate processing.
 */
export interface AgentTask {
  id: string;

  // Task classification
  task_type: string; // e.g., 're_engagement_check', 'process_community_request'
  agent_type: string; // e.g., 'concierge', 'account_manager', 'solution_saga'

  // Task scope
  user_id: string | null;
  context_id: string | null;
  context_type: string | null;

  // Scheduling
  scheduled_for: Date;
  priority: 'urgent' | 'high' | 'medium' | 'low';

  // Processing state
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  retry_count: number;
  max_retries: number;
  last_attempted_at: Date | null;

  // Task data
  context_json: any; // JSONB: all data needed to process task
  result_json: any | null; // JSONB: result after processing
  error_log: string | null;

  // Metadata
  created_at: Date;
  created_by: string | null;
  completed_at: Date | null;
}

/**
 * MessageQueue - Outbound message queue managed by Message Orchestrator
 *
 * Separates message queuing from delivery. Handles rate limiting,
 * priority management, and message superseding.
 */
export interface MessageQueue {
  id: string;
  user_id: string;
  agent_id: string;

  // Message content
  message_data: any; // JSONB: structured agent output
  final_message: string | null; // Concierge-crafted prose

  // Scheduling and priority
  scheduled_for: Date;
  priority: 'urgent' | 'high' | 'medium' | 'low';

  // Message lifecycle
  status: 'queued' | 'approved' | 'sent' | 'superseded' | 'cancelled';
  superseded_by_message_id: string | null;
  superseded_reason: string | null;

  // Context awareness
  conversation_context_id: string | null;
  requires_fresh_context: boolean;

  // Delivery tracking
  sent_at: Date | null;
  delivered_message_id: string | null;

  // Metadata
  created_at: Date;
}

/**
 * UserMessageBudget - Rate limiting for message frequency control
 *
 * Enforces daily and hourly message limits per user to prevent fatigue.
 * Limits are customizable per user for power users.
 */
export interface UserMessageBudget {
  id: string;
  user_id: string;
  date: string; // DATE format (YYYY-MM-DD)

  // Counters
  messages_sent: number;
  last_message_at: Date | null;

  // Limits (configurable per user)
  daily_limit: number;
  hourly_limit: number;

  // User preferences
  quiet_hours_enabled: boolean;

  // Metadata
  created_at: Date;
}

// =====================================================
// AGENT-SPECIFIC TABLES
// =====================================================

/**
 * UserPriority - Account Manager's ranked list of items for each user
 *
 * Updated every 6 hours by Account Manager. Concierge reads top priorities
 * when crafting user communications.
 */
export interface UserPriority {
  id: string;
  user_id: string;

  // Priority item
  priority_rank: number; // 1 = highest
  item_type: 'intro_opportunity' | 'community_request' | 'solution_update' | 'community_response' | 'expert_impact_notification';
  item_id: string;
  value_score: number | null; // 0-100

  // Lifecycle
  status: 'active' | 'presented' | 'actioned' | 'expired';
  created_at: Date;
  expires_at: Date | null;
  presented_at: Date | null;
}

/**
 * SolutionWorkflow - Saga state tracking for solution research workflows
 *
 * Implements event-driven state machine for multi-step solution research.
 * Complete saga state stored in single row for simpler debugging.
 */
export interface SolutionWorkflow {
  id: string;
  user_id: string;
  request_description: string;
  category: string | null;

  // Workflow state
  current_step: string; // e.g., 'initial_research', 'awaiting_experts', 'final_evaluation'
  status: 'in_progress' | 'completed' | 'cancelled';

  // Research results (accumulated over workflow)
  perplexity_results: any | null; // JSONB
  matched_innovators: any | null; // JSONB
  community_insights: any | null; // JSONB
  expert_recommendations: any | null; // JSONB

  // Decision tracking
  quality_threshold_met: boolean;
  last_decision_at: Date | null;
  next_action: string | null;

  // Saga coordination
  pending_tasks: any; // JSONB array: [{type, id, created_at}]
  completed_tasks: any; // JSONB array
  conversation_log: any; // JSONB array: decision history for debugging

  // Metadata
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

/**
 * IntroOpportunity - Connection opportunities for users to make introductions
 *
 * Tracks introduction opportunities between connectors, prospects, and innovators.
 * Includes bounty credits as incentive for completed introductions.
 */
export interface IntroOpportunity {
  id: string;

  // Parties involved
  connector_user_id: string; // User who can make intro
  innovator_id: string | null; // If innovator is on platform
  prospect_id: string | null; // If prospect not yet on platform

  // Opportunity details
  prospect_name: string;
  prospect_company: string | null;
  prospect_title: string | null;
  prospect_linkedin_url: string | null;
  innovator_name: string | null;

  // Incentive
  bounty_credits: number;

  // Status tracking
  status: 'open' | 'pending' | 'accepted' | 'rejected' | 'completed' | 'removed';
  connector_response: string | null;

  // Feed reference
  feed_item_id: string | null;

  // Intro details (if accepted)
  intro_email: string | null;
  intro_scheduled_at: Date | null;
  intro_completed_at: Date | null;

  // Metadata
  created_at: Date;
  updated_at: Date;
  expires_at: Date | null;
}

/**
 * CommunityRequest - Requests for expert insights from community
 *
 * Agents can request expert insights from the community.
 * Matches experts based on expertise array and routes to qualified users.
 */
export interface CommunityRequest {
  id: string;

  // Request origin
  requesting_agent_type: string; // e.g., 'solution_saga', 'demand_agent'
  requesting_user_id: string | null;
  context_id: string | null;
  context_type: string | null;

  // Request details
  question: string;
  category: string | null;
  expertise_needed: string[] | null;

  // Targeting
  target_user_ids: string[] | null;

  // Status
  status: 'open' | 'responses_received' | 'closed';
  responses_count: number;

  // Close the loop
  closed_loop_at: Date | null;
  closed_loop_message: string | null;

  // Metadata
  created_at: Date;
  expires_at: Date | null;
}

/**
 * CommunityResponse - Expert responses to community requests
 *
 * Stores expert responses with value tracking and credit rewards.
 * Includes close-the-loop messaging to show impact.
 */
export interface CommunityResponse {
  id: string;
  request_id: string;
  user_id: string; // Expert who responded

  // Response content
  response_text: string; // Concierge summary
  verbatim_answer: string; // Exact user words

  // Value tracking
  usefulness_score: number | null; // 1-10, rated by requesting agent
  impact_description: string | null;

  // Credits
  credits_awarded: number | null;
  credited_at: Date | null;

  // Status
  status: 'provided' | 'rewarded' | 'closed_loop';
  closed_loop_message: string | null;
  closed_loop_at: Date | null;

  // Metadata
  created_at: Date;
}

/**
 * CreditEvent - Event sourcing for credits (prevents double-spending)
 *
 * Idempotency key prevents duplicate rewards. User balance is computed
 * from these events (event sourcing pattern).
 */
export interface CreditEvent {
  id: string;
  user_id: string;

  // Transaction details
  event_type: string; // e.g., 'intro_completed', 'community_response', 'referral_joined'
  amount: number; // Can be negative for spending

  // Idempotency
  reference_type: string; // e.g., 'intro_opportunity', 'community_response'
  reference_id: string;
  idempotency_key: string; // Prevents duplicates

  // Audit
  description: string | null;
  created_at: Date;
  processed: boolean;
}

/**
 * UserCreditBalance - Computed view of user credit balances
 *
 * This is a VIEW (not a table) - the single source of truth for balances.
 * users.credit_balance is a cached value for display performance.
 */
export interface UserCreditBalance {
  user_id: string;
  balance: number;
  transaction_count: number;
  last_transaction_at: Date | null;
}

// =====================================================
// SUPPORTING TABLES
// =====================================================

/**
 * Prospect - Individuals not yet on platform (targets for intros/demand gen)
 *
 * Stores information about prospects who aren't yet platform users.
 * Research results include LinkedIn mutual connections.
 */
export interface Prospect {
  id: string;
  name: string;
  company: string | null;
  title: string | null;
  linkedin_url: string | null;
  email: string | null;

  // Research results
  mutual_connections: any | null; // JSONB
  last_researched_at: Date | null;

  // Tracking
  users_researching: string[] | null;

  created_at: Date;
}

/**
 * Innovator - Companies offering solutions (subset of users with extended profile)
 *
 * Extended profile for users classified as innovators. Includes solution
 * details, categories for matching, and separate credit balance.
 */
export interface Innovator {
  id: string;
  user_id: string;

  // Company details
  company_name: string;
  solution_description: string | null;
  categories: string[] | null;
  target_customer_profile: string | null;

  // Video pitch
  video_url: string | null;

  // Status
  credits_balance: number;
  active: boolean;

  created_at: Date;
}

/**
 * AgentInstance - Tracks agent configuration versions (for debugging/monitoring)
 *
 * Used for configuration versioning - tracks which prompt version, model,
 * and configuration was used for each agent deployment. Enables A/B testing.
 */
export interface AgentInstance {
  id: string;
  agent_type: string;
  user_id: string | null;

  // Configuration versioning
  config_json: any | null; // JSONB: model params, feature flags
  prompt_version: string | null; // e.g., "bouncer_v1.2", "concierge_v2.0"

  // Status
  status: string;
  last_active_at: Date | null;

  created_at: Date;
  terminated_at: Date | null;
}

/**
 * AgentActionsLog - Comprehensive logging for debugging and cost tracking
 *
 * Every LLM call and agent action is logged for cost analysis and debugging.
 * Token counts enable usage optimization.
 */
export interface AgentActionsLog {
  id: string;

  // Agent context
  agent_type: string;
  agent_instance_id: string | null;
  action_type: string; // e.g., 'llm_call', 'function_execution', 'event_published'

  // Request context
  user_id: string | null;
  context_id: string | null;
  context_type: string | null;

  // LLM metrics
  model_used: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  latency_ms: number | null;

  // Execution details
  input_data: any | null; // JSONB
  output_data: any | null; // JSONB
  error: string | null;

  created_at: Date;
}
