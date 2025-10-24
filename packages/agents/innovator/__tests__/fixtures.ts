/**
 * Test Fixtures for Innovator Agent Testing
 *
 * Provides builder functions to create realistic test data:
 * - Innovator users with profiles (company, solution, target customers)
 * - Prospect lists for intro opportunities
 * - Introduction opportunities with match scores
 * - Credit balances and metrics
 * - Extended from Concierge fixtures for consistency
 */

import type { User, Message, Conversation, UserPriority } from '@yachtparty/shared';

/**
 * Innovator profile structure (from innovators table)
 */
export interface InnovatorProfile {
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
 * Prospect structure (from prospects table)
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
 * Intro opportunity structure (from intro_opportunities table)
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
 * Create a test innovator user with configurable properties
 */
export function createTestInnovator(overrides: Partial<User> = {}): User {
  const baseUser: User = {
    id: 'test-innovator-001',
    phone_number: '+15559876543',
    first_name: 'Sarah',
    last_name: 'Johnson',
    email: 'sarah.johnson@innovacorp.com',
    company: 'InnovaCorp',
    title: 'CEO',
    linkedin_url: 'https://linkedin.com/in/sarahjohnson',
    verified: true,
    email_verified: true,
    innovator: true,
    expert_connector: false,
    expertise: null,
    poc_agent_id: null,
    poc_agent_type: 'innovator',
    referred_by: null,
    name_dropped: null,
    quiet_hours_start: null,
    quiet_hours_end: null,
    timezone: 'America/New_York',
    response_pattern: {
      user_goal: 'Find potential customers for our AI-powered analytics platform',
    },
    credit_balance: 100,
    status_level: 'active',
    created_at: new Date('2025-08-01T10:00:00Z'),
    updated_at: new Date('2025-10-15T10:00:00Z'),
    last_active_at: new Date('2025-10-15T10:00:00Z'),
  };

  return { ...baseUser, ...overrides };
}

/**
 * Create an innovator profile
 */
export function createInnovatorProfile(overrides: Partial<InnovatorProfile> = {}): InnovatorProfile {
  const baseProfile: InnovatorProfile = {
    id: 'innovator-profile-001',
    user_id: 'test-innovator-001',
    company_name: 'InnovaCorp',
    solution_description: 'AI-powered analytics platform for e-commerce businesses',
    categories: ['analytics', 'e-commerce', 'ai'],
    target_customer_profile: 'E-commerce companies with $10M+ annual revenue',
    video_url: 'https://example.com/pitch-video.mp4',
    credits_balance: 500,
    active: true,
    created_at: new Date('2025-08-01T10:00:00Z'),
  };

  return { ...baseProfile, ...overrides };
}

/**
 * Create a test conversation for innovator
 */
export function createTestConversation(overrides: Partial<Conversation> = {}): Conversation {
  const baseConversation: Conversation = {
    id: 'test-conv-innovator-001',
    user_id: 'test-innovator-001',
    phone_number: '+15559876543',
    status: 'active',
    conversation_summary: null,
    last_summary_message_id: null,
    messages_since_summary: 0,
    created_at: new Date('2025-08-01T10:00:00Z'),
    updated_at: new Date('2025-10-15T10:00:00Z'),
    last_message_at: new Date('2025-10-15T10:00:00Z'),
  };

  return { ...baseConversation, ...overrides };
}

/**
 * Create test messages for innovator conversations
 */
export function createTestMessages(pattern: 'onboarding' | 'prospect_upload' | 'intro_accepted'): Message[] {
  const baseMessages = {
    conversation_id: 'test-conv-innovator-001',
    user_id: 'test-innovator-001',
    direction: 'inbound' as const,
    status: 'sent' as const,
    twilio_message_sid: null as string | null,
    sent_at: null as Date | null,
    delivered_at: null as Date | null,
  };

  if (pattern === 'onboarding') {
    return [
      {
        ...baseMessages,
        id: 'msg-001',
        role: 'user' as const,
        content: 'I want to find potential customers for my analytics platform',
        created_at: new Date('2025-08-01T14:00:00Z'),
      },
      {
        ...baseMessages,
        id: 'msg-002',
        role: 'innovator' as const,
        content: 'Great! I can help you connect with potential customers. Can you tell me more about your target customer profile?',
        direction: 'outbound' as const,
        created_at: new Date('2025-08-01T14:01:00Z'),
      },
      {
        ...baseMessages,
        id: 'msg-003',
        role: 'user' as const,
        content: 'We target e-commerce companies with $10M+ revenue who need better analytics',
        created_at: new Date('2025-08-01T14:05:00Z'),
      },
    ];
  }

  if (pattern === 'prospect_upload') {
    return [
      {
        ...baseMessages,
        id: 'msg-001',
        role: 'user' as const,
        content: 'I uploaded a list of 50 prospects',
        created_at: new Date('2025-09-01T10:00:00Z'),
      },
      {
        ...baseMessages,
        id: 'msg-002',
        role: 'innovator' as const,
        content: 'Perfect! I\'ll analyze your prospects and look for platform users who can make introductions.',
        direction: 'outbound' as const,
        created_at: new Date('2025-09-01T10:01:00Z'),
      },
    ];
  }

  // intro_accepted
  return [
    {
      ...baseMessages,
      id: 'msg-001',
      role: 'user' as const,
      content: 'Did anyone accept my intro request?',
      created_at: new Date('2025-10-10T14:00:00Z'),
    },
    {
      ...baseMessages,
      id: 'msg-002',
      role: 'innovator' as const,
      content: 'Yes! Mike agreed to introduce you to his contact at Shopify.',
      direction: 'outbound' as const,
      created_at: new Date('2025-10-10T14:01:00Z'),
    },
  ];
}

/**
 * Create test prospects
 */
export function createTestProspects(count: number): Prospect[] {
  const prospects: Prospect[] = [];
  const companies = ['Shopify', 'Amazon', 'Walmart', 'Target', 'eBay'];
  const titles = ['VP of Analytics', 'Head of Data', 'Director of Engineering', 'CTO'];

  for (let i = 0; i < count; i++) {
    prospects.push({
      id: `prospect-${i}`,
      name: `Prospect ${i}`,
      company: companies[i % companies.length],
      title: titles[i % titles.length],
      linkedin_url: `https://linkedin.com/in/prospect-${i}`,
      email: null,
      mutual_connections: null,
      last_researched_at: null,
      users_researching: null,
      created_at: new Date('2025-09-01T10:00:00Z'),
    });
  }

  return prospects;
}

/**
 * Create intro opportunities for testing
 */
export function createIntroOpportunities(configs: Array<{
  prospectName: string;
  prospectCompany: string;
  connectorUserId: string;
  bountyCredits?: number;
  status?: IntroOpportunity['status'];
}>): IntroOpportunity[] {
  return configs.map((config, i) => ({
    id: `intro-opp-${i}`,
    connector_user_id: config.connectorUserId,
    innovator_id: 'test-innovator-001',
    prospect_id: `prospect-${i}`,
    prospect_name: config.prospectName,
    prospect_company: config.prospectCompany,
    prospect_title: 'VP of Analytics',
    prospect_linkedin_url: `https://linkedin.com/in/${config.prospectName.toLowerCase().replace(' ', '-')}`,
    innovator_name: 'Sarah Johnson',
    bounty_credits: config.bountyCredits || 25,
    status: config.status || 'open',
    connector_response: null,
    feed_item_id: null,
    intro_email: null,
    intro_scheduled_at: null,
    intro_completed_at: null,
    created_at: new Date('2025-10-01T10:00:00Z'),
    updated_at: new Date('2025-10-01T10:00:00Z'),
    expires_at: new Date('2025-11-01T10:00:00Z'),
  }));
}

/**
 * Create test priorities for innovator (intro opportunities, prospect research)
 */
export function createTestPriorities(config: {
  highIntros?: number;
  mediumIntros?: number;
  lowIntros?: number;
}): UserPriority[] {
  const priorities: UserPriority[] = [];

  // High priority intro opportunities (value 80-100)
  for (let i = 0; i < (config.highIntros || 0); i++) {
    priorities.push({
      id: `priority-high-intro-${i}`,
      user_id: 'test-innovator-001',
      priority_rank: priorities.length + 1,
      item_type: 'intro_opportunity',
      item_id: `intro-opp-${i}`,
      value_score: 85 + i * 5,
      status: 'active',
      created_at: new Date('2025-10-15T10:00:00Z'),
      expires_at: null,
      presented_at: null,
    });
  }

  // Medium priority intro opportunities (value 50-79)
  for (let i = 0; i < (config.mediumIntros || 0); i++) {
    priorities.push({
      id: `priority-medium-intro-${i}`,
      user_id: 'test-innovator-001',
      priority_rank: priorities.length + 1,
      item_type: 'intro_opportunity',
      item_id: `intro-opp-${i + (config.highIntros || 0)}`,
      value_score: 60 + i * 5,
      status: 'active',
      created_at: new Date('2025-10-14T10:00:00Z'),
      expires_at: null,
      presented_at: null,
    });
  }

  // Low priority intro opportunities (value <50)
  for (let i = 0; i < (config.lowIntros || 0); i++) {
    priorities.push({
      id: `priority-low-intro-${i}`,
      user_id: 'test-innovator-001',
      priority_rank: priorities.length + 1,
      item_type: 'intro_opportunity',
      item_id: `intro-opp-${i + (config.highIntros || 0) + (config.mediumIntros || 0)}`,
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
 * Create intro metrics for testing
 */
export function createIntroMetrics(overrides: Partial<{
  total_intros: number;
  accepted_intros: number;
  completed_intros: number;
  credits_earned: number;
  avg_days_to_accept: number;
}> = {}) {
  return {
    total_intros: overrides.total_intros || 10,
    accepted_intros: overrides.accepted_intros || 6,
    completed_intros: overrides.completed_intros || 3,
    credits_earned: overrides.credits_earned || 75,
    avg_days_to_accept: overrides.avg_days_to_accept || 2.5,
  };
}

/**
 * Create a complete test scenario for Innovator
 */
export function createInnovatorTestScenario(type: 'new_intro_opportunity' | 'prospect_research' | 'intro_accepted') {
  const innovator = createTestInnovator();
  const innovatorProfile = createInnovatorProfile();
  const conversation = createTestConversation();

  if (type === 'new_intro_opportunity') {
    const prospects = createTestProspects(3);
    const intros = createIntroOpportunities([
      {
        prospectName: 'John Smith',
        prospectCompany: 'Shopify',
        connectorUserId: 'connector-001',
        bountyCredits: 25,
        status: 'open',
      },
    ]);

    return {
      innovator,
      innovatorProfile,
      conversation,
      messages: createTestMessages('onboarding'),
      prospects,
      introOpportunities: intros,
      priorities: createTestPriorities({ highIntros: 1 }),
      systemMessage: {
        id: 'msg-system',
        conversation_id: conversation.id,
        user_id: innovator.id,
        role: 'system' as const,
        content: JSON.stringify({
          type: 'new_intro_opportunity',
          intro_id: intros[0].id,
        }),
        direction: 'inbound' as const,
        status: 'pending' as const,
        created_at: new Date().toISOString(),
      },
    };
  }

  if (type === 'prospect_research') {
    const prospects = createTestProspects(5);
    return {
      innovator,
      innovatorProfile,
      conversation,
      messages: createTestMessages('prospect_upload'),
      prospects,
      introOpportunities: [],
      priorities: [],
      systemMessage: {
        id: 'msg-system',
        conversation_id: conversation.id,
        user_id: innovator.id,
        role: 'system' as const,
        content: JSON.stringify({
          type: 'prospect_research_complete',
          prospect_id: prospects[0].id,
          matches_found: 2,
        }),
        direction: 'inbound' as const,
        status: 'pending' as const,
        created_at: new Date().toISOString(),
      },
    };
  }

  // intro_accepted
  const intros = createIntroOpportunities([
    {
      prospectName: 'Jane Doe',
      prospectCompany: 'Amazon',
      connectorUserId: 'connector-002',
      bountyCredits: 25,
      status: 'accepted',
    },
  ]);

  return {
    innovator,
    innovatorProfile,
    conversation,
    messages: createTestMessages('intro_accepted'),
    prospects: createTestProspects(1),
    introOpportunities: intros,
    priorities: createTestPriorities({ highIntros: 1 }),
    incomingMessage: {
      id: 'msg-new',
      conversation_id: conversation.id,
      user_id: innovator.id,
      role: 'user' as const,
      content: 'What\'s the status of my intro requests?',
      direction: 'inbound' as const,
      status: 'sent' as const,
      created_at: new Date(),
      twilio_message_sid: 'SM123test',
      sent_at: new Date(),
      delivered_at: null,
    },
  };
}
