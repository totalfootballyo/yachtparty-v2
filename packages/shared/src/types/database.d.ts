/**
 * Yachtparty Database Type Definitions
 *
 * TypeScript interfaces matching the database schema exactly.
 * Generated from migrations in packages/database/migrations/
 *
 * @see requirements.md Section 3 - Database Schema
 */
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
    verified: boolean;
    email_verified: boolean;
    innovator: boolean;
    expert_connector: boolean;
    expertise: string[] | null;
    poc_agent_id: string | null;
    poc_agent_type: 'bouncer' | 'concierge' | 'innovator' | null;
    referred_by: string | null;
    name_dropped: string | null;
    quiet_hours_start: string | null;
    quiet_hours_end: string | null;
    timezone: string | null;
    response_pattern: any | null;
    credit_balance: number;
    status_level: string;
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
    phone_number: string;
    status: 'active' | 'paused' | 'completed';
    conversation_summary: string | null;
    last_summary_message_id: string | null;
    messages_since_summary: number;
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
    role: 'user' | 'concierge' | 'bouncer' | 'innovator' | 'system';
    content: string;
    direction: 'inbound' | 'outbound';
    twilio_message_sid: string | null;
    status: 'queued' | 'sent' | 'delivered' | 'failed' | null;
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
    event_type: string;
    aggregate_id: string | null;
    aggregate_type: string | null;
    payload: any;
    metadata: any | null;
    processed: boolean;
    version: number;
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
    task_type: string;
    agent_type: string;
    user_id: string | null;
    context_id: string | null;
    context_type: string | null;
    scheduled_for: Date;
    priority: 'urgent' | 'high' | 'medium' | 'low';
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
    retry_count: number;
    max_retries: number;
    last_attempted_at: Date | null;
    context_json: any;
    result_json: any | null;
    error_log: string | null;
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
    message_data: any;
    final_message: string | null;
    scheduled_for: Date;
    priority: 'urgent' | 'high' | 'medium' | 'low';
    status: 'queued' | 'approved' | 'sent' | 'superseded' | 'cancelled';
    superseded_by_message_id: string | null;
    superseded_reason: string | null;
    conversation_context_id: string | null;
    requires_fresh_context: boolean;
    sent_at: Date | null;
    delivered_message_id: string | null;
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
    date: string;
    messages_sent: number;
    last_message_at: Date | null;
    daily_limit: number;
    hourly_limit: number;
    quiet_hours_enabled: boolean;
    created_at: Date;
}
/**
 * UserPriority - Account Manager's ranked list of items for each user
 *
 * Updated every 6 hours by Account Manager. Concierge reads top priorities
 * when crafting user communications.
 */
export interface UserPriority {
    id: string;
    user_id: string;
    priority_rank: number;
    item_type: 'intro_opportunity' | 'community_request' | 'solution_update' | 'community_response' | 'expert_impact_notification';
    item_id: string;
    value_score: number | null;
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
    current_step: string;
    status: 'in_progress' | 'completed' | 'cancelled';
    perplexity_results: any | null;
    matched_innovators: any | null;
    community_insights: any | null;
    expert_recommendations: any | null;
    quality_threshold_met: boolean;
    last_decision_at: Date | null;
    next_action: string | null;
    pending_tasks: any;
    completed_tasks: any;
    conversation_log: any;
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
    connector_user_id: string;
    innovator_id: string | null;
    prospect_id: string | null;
    prospect_name: string;
    prospect_company: string | null;
    prospect_title: string | null;
    prospect_linkedin_url: string | null;
    innovator_name: string | null;
    bounty_credits: number;
    status: 'open' | 'pending' | 'accepted' | 'rejected' | 'completed' | 'removed';
    connector_response: string | null;
    feed_item_id: string | null;
    intro_email: string | null;
    intro_scheduled_at: Date | null;
    intro_completed_at: Date | null;
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
    requesting_agent_type: string;
    requesting_user_id: string | null;
    context_id: string | null;
    context_type: string | null;
    question: string;
    category: string | null;
    expertise_needed: string[] | null;
    target_user_ids: string[] | null;
    status: 'open' | 'responses_received' | 'closed';
    responses_count: number;
    closed_loop_at: Date | null;
    closed_loop_message: string | null;
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
    user_id: string;
    response_text: string;
    verbatim_answer: string;
    usefulness_score: number | null;
    impact_description: string | null;
    credits_awarded: number | null;
    credited_at: Date | null;
    status: 'provided' | 'rewarded' | 'closed_loop';
    closed_loop_message: string | null;
    closed_loop_at: Date | null;
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
    event_type: string;
    amount: number;
    reference_type: string;
    reference_id: string;
    idempotency_key: string;
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
    mutual_connections: any | null;
    last_researched_at: Date | null;
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
    company_name: string;
    solution_description: string | null;
    categories: string[] | null;
    target_customer_profile: string | null;
    video_url: string | null;
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
    config_json: any | null;
    prompt_version: string | null;
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
    agent_type: string;
    agent_instance_id: string | null;
    action_type: string;
    user_id: string | null;
    context_id: string | null;
    context_type: string | null;
    model_used: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
    cost_usd: number | null;
    latency_ms: number | null;
    input_data: any | null;
    output_data: any | null;
    error: string | null;
    created_at: Date;
}
//# sourceMappingURL=database.d.ts.map