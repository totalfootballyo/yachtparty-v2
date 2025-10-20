/**
 * Test Fixtures for Concierge Agent Testing
 *
 * Provides builder functions to create realistic test data:
 * - User profiles with various characteristics
 * - Conversation histories (engaged, frustrated, terse)
 * - Priorities with different value scores
 * - Outstanding community requests
 */

import type { User, Message, Conversation, UserPriority } from '@yachtparty/shared';

/**
 * Create a test user with configurable properties
 */
export function createTestUser(overrides: Partial<User> = {}): User {
  const baseUser: User = {
    id: 'test-user-001',
    phone_number: '+15551234567',
    first_name: 'Jason',
    last_name: 'Smith',
    email: 'jason.smith@example.com',
    company: 'Acme Corp',
    title: 'VP of Marketing',
    linkedin_url: null,
    verified: true,
    email_verified: true,
    innovator: false,
    expert_connector: false,
    expertise: null,
    poc_agent_id: null,
    poc_agent_type: 'concierge',
    referred_by: null,
    name_dropped: null,
    quiet_hours_start: null,
    quiet_hours_end: null,
    timezone: 'America/Los_Angeles',
    response_pattern: {
      user_goal: 'Find CTV advertising vendors for Q1 launch',
    },
    credit_balance: 100,
    status_level: 'active',
    created_at: new Date('2025-09-01T10:00:00Z'),
    updated_at: new Date('2025-10-15T10:00:00Z'),
    last_active_at: new Date('2025-10-15T10:00:00Z'),
  };

  return { ...baseUser, ...overrides };
}

/**
 * Create a test conversation
 */
export function createTestConversation(overrides: Partial<Conversation> = {}): Conversation {
  const baseConversation: Conversation = {
    id: 'test-conv-001',
    user_id: 'test-user-001',
    phone_number: '+15551234567',
    status: 'active',
    conversation_summary: null,
    last_summary_message_id: null,
    messages_since_summary: 0,
    created_at: new Date('2025-09-01T10:00:00Z'),
    updated_at: new Date('2025-10-15T10:00:00Z'),
    last_message_at: new Date('2025-10-15T10:00:00Z'),
  };

  return { ...baseConversation, ...overrides };
}

/**
 * Create test messages with different conversation patterns
 */
export function createTestMessages(pattern: 'engaged' | 'frustrated' | 'terse'): Message[] {
  const baseMessages = {
    conversation_id: 'test-conv-001',
    user_id: 'test-user-001',
    direction: 'inbound' as const,
    status: 'sent' as const,
    twilio_message_sid: null as string | null,
    sent_at: null as Date | null,
    delivered_at: null as Date | null,
  };

  if (pattern === 'engaged') {
    return [
      {
        ...baseMessages,
        id: 'msg-001',
        role: 'user' as const,
        content: 'I\'m looking for CTV advertising vendors for our Q1 launch. We\'re planning to spend around $500k and need something that integrates with our existing ad stack.',
        created_at: new Date('2025-10-10T14:00:00Z'),
      },
      {
        ...baseMessages,
        id: 'msg-002',
        role: 'concierge' as const,
        content: 'Got it. I\'ll look into CTV vendors and get back to you in the next couple days.',
        direction: 'outbound' as const,
        created_at: new Date('2025-10-10T14:01:00Z'),
      },
      {
        ...baseMessages,
        id: 'msg-003',
        role: 'user' as const,
        content: 'Perfect, thanks!',
        created_at: new Date('2025-10-10T14:05:00Z'),
      },
    ];
  }

  if (pattern === 'frustrated') {
    return [
      {
        ...baseMessages,
        id: 'msg-001',
        role: 'user' as const,
        content: 'I need CTV vendor recommendations.',
        created_at: new Date('2025-10-05T10:00:00Z'),
      },
      {
        ...baseMessages,
        id: 'msg-002',
        role: 'concierge' as const,
        content: 'Got it. I\'ll look into CTV vendors and get back to you in the next couple days.',
        direction: 'outbound' as const,
        created_at: new Date('2025-10-05T10:01:00Z'),
      },
      {
        ...baseMessages,
        id: 'msg-003',
        role: 'concierge' as const,
        content: 'I can also connect you with Mike at Roku if you want to learn about their platform.',
        direction: 'outbound' as const,
        created_at: new Date('2025-10-08T09:00:00Z'),
      },
      {
        ...baseMessages,
        id: 'msg-004',
        role: 'user' as const,
        content: 'I\'m getting too many messages. Can you just send me the CTV vendor list when you have it?',
        created_at: new Date('2025-10-08T09:30:00Z'),
      },
      {
        ...baseMessages,
        id: 'msg-005',
        role: 'concierge' as const,
        content: 'Got it, will do.',
        direction: 'outbound' as const,
        created_at: new Date('2025-10-08T09:31:00Z'),
      },
    ];
  }

  // terse
  return [
    {
      ...baseMessages,
      id: 'msg-001',
      role: 'user' as const,
      content: 'CTV vendors?',
      created_at: new Date('2025-10-12T16:00:00Z'),
    },
    {
      ...baseMessages,
      id: 'msg-002',
      role: 'concierge' as const,
      content: 'I\'ll look into CTV vendors and get back to you.',
      direction: 'outbound' as const,
      created_at: new Date('2025-10-12T16:01:00Z'),
    },
    {
      ...baseMessages,
      id: 'msg-003',
      role: 'concierge' as const,
      content: 'I can connect you with Sarah at Hulu if you want to learn about their CTV strategy.',
      direction: 'outbound' as const,
      created_at: new Date('2025-10-14T10:00:00Z'),
    },
    {
      ...baseMessages,
      id: 'msg-004',
      role: 'user' as const,
      content: 'ok',
      created_at: new Date('2025-10-14T11:00:00Z'),
    },
  ];
}

/**
 * Create test priorities with different value scores
 */
export function createTestPriorities(config: {
  high?: number;
  medium?: number;
  low?: number;
}): UserPriority[] {
  const priorities: UserPriority[] = [];

  // High priority items (value 80-100)
  for (let i = 0; i < (config.high || 0); i++) {
    priorities.push({
      id: `priority-high-${i}`,
      user_id: 'test-user-001',
      priority_rank: priorities.length + 1,
      item_type: 'intro_opportunity',
      item_id: `intro-${i}`,
      value_score: 85 + i * 5,
      status: 'active',
      created_at: new Date('2025-10-15T10:00:00Z'),
      expires_at: null,
      presented_at: null,
    });
  }

  // Medium priority items (value 50-79)
  for (let i = 0; i < (config.medium || 0); i++) {
    priorities.push({
      id: `priority-medium-${i}`,
      user_id: 'test-user-001',
      priority_rank: priorities.length + 1,
      item_type: 'solution_update',
      item_id: `solution-${i}`,
      value_score: 60 + i * 5,
      status: 'active',
      created_at: new Date('2025-10-14T10:00:00Z'),
      expires_at: null,
      presented_at: null,
    });
  }

  // Low priority items (value <50)
  for (let i = 0; i < (config.low || 0); i++) {
    priorities.push({
      id: `priority-low-${i}`,
      user_id: 'test-user-001',
      priority_rank: priorities.length + 1,
      item_type: 'community_response',
      item_id: `response-${i}`,
      value_score: 30 + i * 5,
      status: 'active',
      created_at: new Date('2025-10-13T10:00:00Z'),
      expires_at: null,
      presented_at: null,
    });
  }

  return priorities;
}

/**
 * Create outstanding community requests
 */
export function createOutstandingRequests(count: number, daysAgo: number = 7): Array<{
  id: string;
  question: string;
  created_at: string; // Keep as string for simple test data
}> {
  const requests = [];
  const baseDate = new Date();
  baseDate.setDate(baseDate.getDate() - daysAgo);

  for (let i = 0; i < count; i++) {
    requests.push({
      id: `request-${i}`,
      question: `Looking for recommendations on ${['CTV vendors', 'marketing automation', 'analytics platforms', 'CRM systems'][i % 4]}`,
      created_at: new Date(baseDate.getTime() - i * 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  return requests;
}

/**
 * Create intro opportunities for testing
 */
export function createIntroOpportunities(configs: Array<{
  name: string;
  company: string;
  expertise: string;
  valueScore?: number;
}>): any[] {
  return configs.map((config, i) => ({
    id: `intro-${i}`,
    requesting_user_id: 'test-user-001',
    target_user_id: `target-user-${i}`,
    target_user_name: config.name,
    target_user_company: config.company,
    target_user_expertise: config.expertise,
    introduction_reason: `${config.name} has experience with ${config.expertise}`,
    value_score: config.valueScore || 85,
    status: 'pending_concierge_offer',
    created_at: new Date().toISOString(),
  }));
}

/**
 * Create a complete test scenario with user, conversation, messages, and priorities
 */
export function createTestScenario(type: 'happy_path' | 'multi_thread' | 'user_frustrated') {
  const user = createTestUser();
  const conversation = createTestConversation();

  if (type === 'happy_path') {
    return {
      user,
      conversation,
      messages: createTestMessages('engaged'), // Clean 3-message history
      priorities: [],
      outstandingRequests: [],
      introOpportunities: [], // No intros available
      incomingMessage: {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user' as const,
        content: 'Do you know anyone who has experience with CTV advertising platforms? I\'d love to get recommendations from someone who\'s used them.',
        direction: 'inbound' as const,
        status: 'sent' as const,
        created_at: new Date(),
        twilio_message_sid: 'SM123test',
        sent_at: new Date(),
        delivered_at: null,
      },
    };
  }

  if (type === 'multi_thread') {
    return {
      user,
      conversation,
      messages: createTestMessages('engaged'),
      priorities: createTestPriorities({ high: 2, medium: 1 }),
      outstandingRequests: createOutstandingRequests(1, 7),
      systemMessage: {
        id: 'msg-system',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'system' as const,
        content: JSON.stringify({
          type: 're_engagement_check',
          daysSinceLastMessage: 7,
          priorityCount: 3,
          hasActiveGoals: true,
        }),
        direction: 'inbound' as const,
        status: 'pending' as const,
        created_at: new Date().toISOString(),
      },
    };
  }

  // user_frustrated
  return {
    user,
    conversation,
    messages: createTestMessages('frustrated'),
    priorities: createTestPriorities({ high: 1, medium: 2 }),
    outstandingRequests: [],
    systemMessage: {
      id: 'msg-system',
      conversation_id: conversation.id,
      user_id: user.id,
      role: 'system' as const,
      content: JSON.stringify({
        type: 're_engagement_check',
        daysSinceLastMessage: 5,
        priorityCount: 3,
        hasActiveGoals: true,
      }),
      direction: 'inbound' as const,
      status: 'pending' as const,
      created_at: new Date().toISOString(),
    },
  };
}
