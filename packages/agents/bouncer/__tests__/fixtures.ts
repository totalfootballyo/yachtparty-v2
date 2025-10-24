/**
 * Test Fixtures for Bouncer Agent Testing
 *
 * Provides builder functions to create realistic test data:
 * - Users in various onboarding states
 * - Conversation histories for new users
 * - Messages reflecting onboarding flow
 * - Onboarding progress states
 */

import type { User, Message, Conversation } from '@yachtparty/shared';
import type { OnboardingProgress, OnboardingStep } from '../src/onboarding-steps';

/**
 * Create a test user with configurable onboarding state
 */
export function createTestUser(overrides: Partial<User> = {}): User {
  const baseUser: User = {
    id: 'test-user-001',
    phone_number: '+15551234567',
    first_name: null,
    last_name: null,
    email: null,
    company: null,
    title: null,
    linkedin_url: null,
    verified: false,
    email_verified: false,
    innovator: false,
    expert_connector: false,
    expertise: null,
    poc_agent_id: null,
    poc_agent_type: 'bouncer',
    referred_by: null,
    name_dropped: null,
    quiet_hours_start: null,
    quiet_hours_end: null,
    timezone: 'America/Los_Angeles',
    response_pattern: null,
    credit_balance: 0,
    status_level: 'active',
    created_at: new Date('2025-10-01T10:00:00Z'),
    updated_at: new Date('2025-10-01T10:00:00Z'),
    last_active_at: new Date('2025-10-01T10:00:00Z'),
  };

  return { ...baseUser, ...overrides };
}

/**
 * Create a test conversation for onboarding
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
    created_at: new Date('2025-10-01T10:00:00Z'),
    updated_at: new Date('2025-10-01T10:00:00Z'),
    last_message_at: new Date('2025-10-01T10:00:00Z'),
  };

  return { ...baseConversation, ...overrides };
}

/**
 * Create test messages for different onboarding patterns
 */
export function createTestMessages(pattern: 'new_user' | 'partial_info' | 'waiting_verification'): Message[] {
  const baseMessages = {
    conversation_id: 'test-conv-001',
    user_id: 'test-user-001',
    direction: 'inbound' as const,
    status: 'sent' as const,
    twilio_message_sid: null as string | null,
    sent_at: null as Date | null,
    delivered_at: null as Date | null,
  };

  if (pattern === 'new_user') {
    return [
      {
        ...baseMessages,
        id: 'msg-001',
        role: 'user' as const,
        content: 'Hi',
        created_at: new Date('2025-10-01T10:00:00Z'),
      },
      {
        ...baseMessages,
        id: 'msg-002',
        role: 'bouncer' as const,
        content: 'Welcome to Yachtparty! What\'s your name?',
        direction: 'outbound' as const,
        created_at: new Date('2025-10-01T10:00:01Z'),
      },
    ];
  }

  if (pattern === 'partial_info') {
    return [
      {
        ...baseMessages,
        id: 'msg-001',
        role: 'user' as const,
        content: 'Hi',
        created_at: new Date('2025-10-01T10:00:00Z'),
      },
      {
        ...baseMessages,
        id: 'msg-002',
        role: 'bouncer' as const,
        content: 'Welcome to Yachtparty! What\'s your name?',
        direction: 'outbound' as const,
        created_at: new Date('2025-10-01T10:00:01Z'),
      },
      {
        ...baseMessages,
        id: 'msg-003',
        role: 'user' as const,
        content: 'Sarah Chen',
        created_at: new Date('2025-10-01T10:05:00Z'),
      },
      {
        ...baseMessages,
        id: 'msg-004',
        role: 'bouncer' as const,
        content: 'Nice to meet you, Sarah. Where do you work?',
        direction: 'outbound' as const,
        created_at: new Date('2025-10-01T10:05:01Z'),
      },
    ];
  }

  // waiting_verification
  return [
    {
      ...baseMessages,
      id: 'msg-001',
      role: 'user' as const,
      content: 'Sarah Chen at Acme Corp',
      created_at: new Date('2025-10-01T10:00:00Z'),
    },
    {
      ...baseMessages,
      id: 'msg-002',
      role: 'bouncer' as const,
      content: 'Thanks Sarah! To verify, please send an email from your work email to verify-test-user-001@verify.yachtparty.xyz',
      direction: 'outbound' as const,
      created_at: new Date('2025-10-01T10:00:01Z'),
    },
  ];
}

/**
 * Create onboarding progress state
 */
export function createOnboardingProgress(overrides: Partial<OnboardingProgress> = {}): OnboardingProgress {
  const baseProgress: OnboardingProgress = {
    isComplete: false,
    missingFields: ['first_name', 'last_name', 'company', 'title', 'email'],
    currentStep: 'welcome',
  };

  return { ...baseProgress, ...overrides };
}

/**
 * Create users in different onboarding states
 */
export function createUserByOnboardingStep(step: OnboardingStep): User {
  switch (step) {
    case 'welcome':
      return createTestUser({
        first_name: null,
        last_name: null,
        company: null,
        title: null,
        email: null,
        email_verified: false,
        linkedin_url: null,
        verified: false,
      });

    case 'name_collection':
      return createTestUser({
        first_name: null,
        last_name: null,
        company: null,
        title: null,
        email: null,
        email_verified: false,
        linkedin_url: null,
        verified: false,
      });

    case 'company_collection':
      return createTestUser({
        first_name: 'Sarah',
        last_name: 'Chen',
        company: null,
        title: null,
        email: null,
        email_verified: false,
        linkedin_url: null,
        verified: false,
      });

    case 'email_verification':
      return createTestUser({
        first_name: 'Sarah',
        last_name: 'Chen',
        company: 'Acme Corp',
        title: 'VP Marketing',
        email: 'sarah.chen@acme.com',
        email_verified: false,
        linkedin_url: null,
        verified: false,
      });

    case 'linkedin_connection':
      return createTestUser({
        first_name: 'Sarah',
        last_name: 'Chen',
        company: 'Acme Corp',
        title: 'VP Marketing',
        email: 'sarah.chen@acme.com',
        email_verified: true,
        linkedin_url: null,
        verified: false,
      });

    case 'first_nomination':
      return createTestUser({
        first_name: 'Sarah',
        last_name: 'Chen',
        company: 'Acme Corp',
        title: 'VP Marketing',
        email: 'sarah.chen@acme.com',
        email_verified: true,
        linkedin_url: 'https://linkedin.com/in/sarahchen',
        verified: false,
      });

    case 'complete':
      return createTestUser({
        first_name: 'Sarah',
        last_name: 'Chen',
        company: 'Acme Corp',
        title: 'VP Marketing',
        email: 'sarah.chen@acme.com',
        email_verified: true,
        linkedin_url: 'https://linkedin.com/in/sarahchen',
        verified: true,
        poc_agent_type: 'concierge',
      });

    default:
      return createTestUser();
  }
}

/**
 * Create a complete test scenario with user, conversation, messages, and progress
 */
export function createTestScenario(type: 'brand_new_user' | 'partial_onboarding' | 'email_pending' | 'ready_to_verify') {
  if (type === 'brand_new_user') {
    const user = createUserByOnboardingStep('welcome');
    const conversation = createTestConversation({
      created_at: new Date(),
      last_message_at: new Date(),
    });

    return {
      user,
      conversation,
      messages: [],
      progress: createOnboardingProgress({
        currentStep: 'welcome',
        missingFields: ['first_name', 'last_name', 'company', 'title', 'email'],
      }),
      incomingMessage: {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user' as const,
        content: 'Hi there',
        direction: 'inbound' as const,
        status: 'sent' as const,
        created_at: new Date(),
        twilio_message_sid: 'SM123test',
        sent_at: new Date(),
        delivered_at: null,
      },
    };
  }

  if (type === 'partial_onboarding') {
    const user = createUserByOnboardingStep('company_collection');
    const conversation = createTestConversation();

    return {
      user,
      conversation,
      messages: createTestMessages('partial_info'),
      progress: createOnboardingProgress({
        currentStep: 'company_collection',
        missingFields: ['company', 'title', 'email'],
      }),
      incomingMessage: {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user' as const,
        content: 'I work at Acme Corp as VP of Marketing',
        direction: 'inbound' as const,
        status: 'sent' as const,
        created_at: new Date(),
        twilio_message_sid: 'SM123test',
        sent_at: new Date(),
        delivered_at: null,
      },
    };
  }

  if (type === 'email_pending') {
    const user = createUserByOnboardingStep('email_verification');
    const conversation = createTestConversation();

    return {
      user,
      conversation,
      messages: createTestMessages('waiting_verification'),
      progress: createOnboardingProgress({
        currentStep: 'email_verification',
        missingFields: ['email'],
      }),
      systemMessage: {
        id: 'msg-system',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'system' as const,
        content: JSON.stringify({
          type: 're_engagement_check',
          attemptCount: 1,
          lastInteractionAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25 hours ago
        }),
        direction: 'inbound' as const,
        status: 'pending' as const,
        created_at: new Date(),
        twilio_message_sid: null,
        sent_at: null,
        delivered_at: null,
      },
    };
  }

  // ready_to_verify
  const user = createUserByOnboardingStep('linkedin_connection');
  const conversation = createTestConversation();

  return {
    user,
    conversation,
    messages: createTestMessages('waiting_verification'),
    progress: createOnboardingProgress({
      currentStep: 'linkedin_connection',
      missingFields: [],
      isComplete: false,
    }),
    incomingMessage: {
      id: 'msg-new',
      conversation_id: conversation.id,
      user_id: user.id,
      role: 'user' as const,
      content: 'Here\'s my LinkedIn: https://linkedin.com/in/sarahchen',
      direction: 'inbound' as const,
      status: 'sent' as const,
      created_at: new Date(),
      twilio_message_sid: 'SM123test',
      sent_at: new Date(),
      delivered_at: null,
    },
  };
}

/**
 * Create referrer user for testing referral matching
 */
export function createReferrerUser(overrides: Partial<User> = {}): User {
  return createTestUser({
    id: 'referrer-user-001',
    phone_number: '+15559876543',
    first_name: 'Ben',
    last_name: 'Trenda',
    email: 'ben@example.com',
    company: 'Example Corp',
    title: 'Founder',
    verified: true,
    email_verified: true,
    poc_agent_type: 'concierge',
    ...overrides,
  });
}

/**
 * Create nomination data for testing
 */
export function createNomination(overrides: Partial<{
  name: string;
  company: string;
  title: string;
  linkedin_url: string;
}> = {}) {
  return {
    name: 'Mike Johnson',
    company: 'Tech Startup Inc',
    title: 'CTO',
    linkedin_url: 'https://linkedin.com/in/mikejohnson',
    ...overrides,
  };
}

/**
 * Create re-engagement context
 */
export function createReengagementContext(overrides: Partial<{
  type: string;
  attemptCount: number;
  lastInteractionAt: string;
  currentStep: OnboardingStep;
  missingFields: string[];
}> = {}) {
  return {
    type: 're_engagement_check',
    attemptCount: 1,
    lastInteractionAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25 hours ago
    currentStep: 'email_verification' as OnboardingStep,
    missingFields: ['email'],
    ...overrides,
  };
}
