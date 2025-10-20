/**
 * Test Data Factories
 *
 * Provides factory functions to create test data with sensible defaults.
 * Makes it easy to create consistent test data across all test files.
 */

import type {
  User,
  Conversation,
  Message,
  Event,
  AgentTask,
  UserPriority,
  SolutionWorkflow,
  IntroOpportunity,
  CommunityRequest,
  MessageQueue,
} from '@yachtparty/shared/types/database';

/**
 * Generate a unique ID for testing
 */
function generateId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate a test phone number
 */
function generatePhoneNumber(): string {
  const areaCode = Math.floor(Math.random() * 900) + 100;
  const prefix = Math.floor(Math.random() * 900) + 100;
  const line = Math.floor(Math.random() * 9000) + 1000;
  return `+1${areaCode}${prefix}${line}`;
}

/**
 * Create a test user
 */
export function createTestUser(overrides?: Partial<User>): User {
  const id = overrides?.id || generateId();
  const phoneNumber = overrides?.phone_number || generatePhoneNumber();

  return {
    id,
    phone_number: phoneNumber,
    email: overrides?.email || null,
    first_name: overrides?.first_name || null,
    last_name: overrides?.last_name || null,
    company: overrides?.company || null,
    title: overrides?.title || null,
    linkedin_url: overrides?.linkedin_url || null,
    verified: overrides?.verified ?? false,
    innovator: overrides?.innovator ?? false,
    expert_connector: overrides?.expert_connector ?? false,
    expertise: overrides?.expertise || null,
    poc_agent_id: overrides?.poc_agent_id || null,
    poc_agent_type: overrides?.poc_agent_type || 'bouncer',
    quiet_hours_start: overrides?.quiet_hours_start || null,
    quiet_hours_end: overrides?.quiet_hours_end || null,
    timezone: overrides?.timezone || 'America/New_York',
    response_pattern: overrides?.response_pattern || null,
    credit_balance: overrides?.credit_balance ?? 0,
    status_level: overrides?.status_level || 'member',
    created_at: overrides?.created_at || new Date(),
    updated_at: overrides?.updated_at || new Date(),
    last_active_at: overrides?.last_active_at || new Date(),
  };
}

/**
 * Create a verified test user (shortcut)
 */
export function createVerifiedUser(overrides?: Partial<User>): User {
  return createTestUser({
    verified: true,
    poc_agent_type: 'concierge',
    first_name: 'John',
    last_name: 'Doe',
    email: 'john.doe@example.com',
    company: 'Test Corp',
    ...overrides,
  });
}

/**
 * Create a test conversation
 */
export function createTestConversation(
  overrides?: Partial<Conversation>
): Conversation {
  const userId = overrides?.user_id || generateId();

  return {
    id: overrides?.id || generateId(),
    user_id: userId,
    phone_number: overrides?.phone_number || generatePhoneNumber(),
    status: overrides?.status || 'active',
    conversation_summary: overrides?.conversation_summary || null,
    last_summary_message_id: overrides?.last_summary_message_id || null,
    messages_since_summary: overrides?.messages_since_summary ?? 0,
    created_at: overrides?.created_at || new Date(),
    updated_at: overrides?.updated_at || new Date(),
    last_message_at: overrides?.last_message_at || new Date(),
  };
}

/**
 * Create a test message
 */
export function createTestMessage(overrides?: Partial<Message>): Message {
  const conversationId = overrides?.conversation_id || generateId();
  const userId = overrides?.user_id || generateId();

  return {
    id: overrides?.id || generateId(),
    conversation_id: conversationId,
    user_id: userId,
    role: overrides?.role || 'user',
    content: overrides?.content || 'Test message',
    direction: overrides?.direction || 'inbound',
    twilio_message_sid: overrides?.twilio_message_sid || null,
    status: overrides?.status || null,
    created_at: overrides?.created_at || new Date(),
    sent_at: overrides?.sent_at || null,
    delivered_at: overrides?.delivered_at || null,
  };
}

/**
 * Create a test event
 */
export function createTestEvent(overrides?: Partial<Event>): Event {
  return {
    id: overrides?.id || generateId(),
    event_type: overrides?.event_type || 'user.message.received',
    aggregate_id: overrides?.aggregate_id || generateId(),
    aggregate_type: overrides?.aggregate_type || 'user',
    payload: overrides?.payload || {},
    metadata: overrides?.metadata || null,
    processed: overrides?.processed ?? false,
    version: overrides?.version ?? 1,
    created_at: overrides?.created_at || new Date().toISOString(),
    created_by: overrides?.created_by || 'test-agent',
  };
}

/**
 * Create a test agent task
 */
export function createTestAgentTask(overrides?: Partial<AgentTask>): AgentTask {
  return {
    id: overrides?.id || generateId(),
    task_type: overrides?.task_type || 're_engagement_check',
    agent_type: overrides?.agent_type || 'bouncer',
    user_id: overrides?.user_id || null,
    context_id: overrides?.context_id || null,
    context_type: overrides?.context_type || null,
    scheduled_for: overrides?.scheduled_for || new Date(),
    priority: overrides?.priority || 'medium',
    status: overrides?.status || 'pending',
    retry_count: overrides?.retry_count ?? 0,
    max_retries: overrides?.max_retries ?? 3,
    last_attempted_at: overrides?.last_attempted_at || null,
    context_json: overrides?.context_json || {},
    result_json: overrides?.result_json || null,
    error_log: overrides?.error_log || null,
    created_at: overrides?.created_at || new Date(),
    created_by: overrides?.created_by || 'test-agent',
    completed_at: overrides?.completed_at || null,
  };
}

/**
 * Create a test user priority
 */
export function createTestUserPriority(
  overrides?: Partial<UserPriority>
): UserPriority {
  return {
    id: overrides?.id || generateId(),
    user_id: overrides?.user_id || generateId(),
    priority_rank: overrides?.priority_rank ?? 1,
    item_type: overrides?.item_type || 'intro_opportunity',
    item_id: overrides?.item_id || generateId(),
    value_score: overrides?.value_score ?? 80,
    status: overrides?.status || 'active',
    created_at: overrides?.created_at || new Date().toISOString(),
    expires_at: overrides?.expires_at || null,
    presented_at: overrides?.presented_at || null,
  };
}

/**
 * Create a test solution workflow
 */
export function createTestSolutionWorkflow(
  overrides?: Partial<SolutionWorkflow>
): SolutionWorkflow {
  return {
    id: overrides?.id || generateId(),
    user_id: overrides?.user_id || generateId(),
    request_description:
      overrides?.request_description || 'Need help finding a CRM solution',
    category: overrides?.category || 'sales_tools',
    current_step: overrides?.current_step || 'initial_research',
    status: overrides?.status || 'in_progress',
    perplexity_results: overrides?.perplexity_results || null,
    matched_innovators: overrides?.matched_innovators || null,
    community_insights: overrides?.community_insights || null,
    expert_recommendations: overrides?.expert_recommendations || null,
    quality_threshold_met: overrides?.quality_threshold_met ?? false,
    last_decision_at: overrides?.last_decision_at || null,
    next_action: overrides?.next_action || null,
    pending_tasks: overrides?.pending_tasks || [],
    completed_tasks: overrides?.completed_tasks || [],
    conversation_log: overrides?.conversation_log || [],
    created_at: overrides?.created_at || new Date(),
    updated_at: overrides?.updated_at || new Date(),
    completed_at: overrides?.completed_at || null,
  };
}

/**
 * Create a test intro opportunity
 */
export function createTestIntroOpportunity(
  overrides?: Partial<IntroOpportunity>
): IntroOpportunity {
  return {
    id: overrides?.id || generateId(),
    connector_user_id: overrides?.connector_user_id || generateId(),
    innovator_id: overrides?.innovator_id || null,
    prospect_id: overrides?.prospect_id || null,
    prospect_name: overrides?.prospect_name || 'Jane Smith',
    prospect_company: overrides?.prospect_company || 'Acme Corp',
    prospect_title: overrides?.prospect_title || 'VP of Sales',
    prospect_linkedin_url:
      overrides?.prospect_linkedin_url ||
      'https://linkedin.com/in/janesmith',
    innovator_name: overrides?.innovator_name || null,
    bounty_credits: overrides?.bounty_credits ?? 100,
    status: overrides?.status || 'open',
    connector_response: overrides?.connector_response || null,
    feed_item_id: overrides?.feed_item_id || null,
    intro_email: overrides?.intro_email || null,
    intro_scheduled_at: overrides?.intro_scheduled_at || null,
    intro_completed_at: overrides?.intro_completed_at || null,
    created_at: overrides?.created_at || new Date(),
    updated_at: overrides?.updated_at || new Date(),
    expires_at: overrides?.expires_at || null,
  };
}

/**
 * Create a test community request
 */
export function createTestCommunityRequest(
  overrides?: Partial<CommunityRequest>
): CommunityRequest {
  return {
    id: overrides?.id || generateId(),
    requesting_agent_type: overrides?.requesting_agent_type || 'solution_saga',
    requesting_user_id: overrides?.requesting_user_id || null,
    context_id: overrides?.context_id || null,
    context_type: overrides?.context_type || null,
    question: overrides?.question || 'What CRM tools do you recommend?',
    category: overrides?.category || 'sales_tools',
    expertise_needed: overrides?.expertise_needed || ['sales', 'crm'],
    target_user_ids: overrides?.target_user_ids || null,
    status: overrides?.status || 'open',
    responses_count: overrides?.responses_count ?? 0,
    closed_loop_at: overrides?.closed_loop_at || null,
    closed_loop_message: overrides?.closed_loop_message || null,
    created_at: overrides?.created_at || new Date(),
    expires_at:
      overrides?.expires_at ||
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
  };
}

/**
 * Create a test message queue entry
 */
export function createTestMessageQueue(
  overrides?: Partial<MessageQueue>
): MessageQueue {
  return {
    id: overrides?.id || generateId(),
    user_id: overrides?.user_id || generateId(),
    agent_id: overrides?.agent_id || 'concierge_v1',
    message_data: overrides?.message_data || { type: 'update', content: 'Test' },
    final_message: overrides?.final_message || null,
    scheduled_for: overrides?.scheduled_for || new Date(),
    priority: overrides?.priority || 'medium',
    status: overrides?.status || 'queued',
    superseded_by_message_id: overrides?.superseded_by_message_id || null,
    superseded_reason: overrides?.superseded_reason || null,
    conversation_context_id: overrides?.conversation_context_id || null,
    requires_fresh_context: overrides?.requires_fresh_context ?? false,
    sent_at: overrides?.sent_at || null,
    delivered_message_id: overrides?.delivered_message_id || null,
    created_at: overrides?.created_at || new Date(),
  };
}

/**
 * Create a complete test scenario (user + conversation + messages)
 */
export function createTestScenario(config?: {
  userOverrides?: Partial<User>;
  conversationOverrides?: Partial<Conversation>;
  messageCount?: number;
}): {
  user: User;
  conversation: Conversation;
  messages: Message[];
} {
  const user = createTestUser(config?.userOverrides);
  const conversation = createTestConversation({
    user_id: user.id,
    phone_number: user.phone_number,
    ...config?.conversationOverrides,
  });

  const messageCount = config?.messageCount || 3;
  const messages: Message[] = [];

  for (let i = 0; i < messageCount; i++) {
    messages.push(
      createTestMessage({
        conversation_id: conversation.id,
        user_id: user.id,
        role: i % 2 === 0 ? 'user' : 'concierge',
        direction: i % 2 === 0 ? 'inbound' : 'outbound',
        content: `Message ${i + 1}`,
        created_at: new Date(Date.now() - (messageCount - i) * 60000), // 1 min apart
      })
    );
  }

  return { user, conversation, messages };
}

/**
 * Create an onboarding scenario (unverified user with incomplete data)
 */
export function createOnboardingScenario(): {
  user: User;
  conversation: Conversation;
  messages: Message[];
} {
  return createTestScenario({
    userOverrides: {
      verified: false,
      poc_agent_type: 'bouncer',
      first_name: 'New',
      email: null,
      company: null,
    },
    messageCount: 2,
  });
}

/**
 * Create a verified user scenario (complete profile, using Concierge)
 */
export function createVerifiedScenario(): {
  user: User;
  conversation: Conversation;
  messages: Message[];
} {
  return createTestScenario({
    userOverrides: {
      verified: true,
      poc_agent_type: 'concierge',
      first_name: 'John',
      last_name: 'Doe',
      email: 'john@example.com',
      company: 'Acme Inc',
      linkedin_url: 'https://linkedin.com/in/johndoe',
    },
    messageCount: 5,
  });
}
