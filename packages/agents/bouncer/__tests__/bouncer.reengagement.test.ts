/**
 * Bouncer Agent Re-engagement Tests
 *
 * Tests the re-engagement logic for incomplete onboarding:
 * - Should re-engage after 24h of inactivity
 * - Should use soft, brief tone
 * - Should respect 2-attempt limit
 * - Should detect when user is not interested
 * - Should pause conversation after 2 attempts with no response
 */

import { invokeBouncerAgent } from '../src/index';
import {
  createTestConversation,
  createTestMessages,
  createUserByOnboardingStep,
  createReengagementContext,
} from './fixtures';
import {
  verifyOnboardingMessages,
} from './helpers';
import { createMockSupabaseClient } from './mocks/supabase.mock';
import { createServiceClient } from '@yachtparty/shared';
import type { Message } from '@yachtparty/shared';

// Mock @yachtparty/shared
jest.mock('@yachtparty/shared', () => {
  const actual = jest.requireActual('@yachtparty/shared');
  return {
    ...actual,
    createServiceClient: jest.fn(),
    publishEvent: jest.fn().mockResolvedValue(undefined),
    createAgentTask: jest.fn().mockResolvedValue({ id: 'task-123' }),
  };
});

beforeAll(() => {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required for tests');
  }
});

describe('Bouncer Agent - Re-engagement Logic', () => {
  describe('First Re-engagement Attempt (24h after dropout)', () => {
    it('should send soft follow-up message', async () => {
      const user = createUserByOnboardingStep('email_verification');
      user.email = null; // Missing email
      const conversation = createTestConversation();
      const messages = createTestMessages('partial_info');

      // Create re-engagement system message (first attempt)
      const reengagementContext = createReengagementContext({
        attemptCount: 1,
        lastInteractionAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25 hours ago
        currentStep: 'email_verification',
        missingFields: ['email'],
      });

      const systemMessage: Message = {
        id: 'msg-system',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'system',
        content: JSON.stringify(reengagementContext),
        direction: 'inbound',
        status: 'sent',
        created_at: new Date(),
        twilio_message_sid: null,
        sent_at: null,
        delivered_at: null,
      };

      const mockSupabase = createMockSupabaseClient({
        users: [user],
        conversations: [conversation],
        messages: messages,
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      // Execute agent
      const response = await invokeBouncerAgent(systemMessage, user, conversation);

      // Should send message
      expect(response.immediateReply).toBe(true);
      expect(response.messages && response.messages.length).toBeGreaterThan(0);

      // Message should be soft and brief
      verifyOnboardingMessages(response, {
        messageCountRange: [1, 2],
        maxLength: 150,
        noExclamations: true,
      });

      // Should use soft tone (not pushy)
      const allText = response.messages?.join(' ').toLowerCase() || '';
      const isSoft =
        allText.includes('still') ||
        allText.includes('just checking') ||
        allText.includes('want to') ||
        allText.includes('should i');
      expect(isSoft).toBe(true);

      console.log('\n=== First Re-engagement Test ===');
      console.log('Context: 25h since last message, attempt 1');
      console.log('Missing fields: email');
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Tone: Soft, brief, not pushy');
      console.log('================================\n');
    }, 30000);
  });

  describe('Second Re-engagement Attempt', () => {
    it('should send final follow-up before pausing', async () => {
      const user = createUserByOnboardingStep('email_verification');
      user.email = null;
      const conversation = createTestConversation();
      const messages = createTestMessages('waiting_verification');

      // Create re-engagement system message (second attempt)
      const reengagementContext = createReengagementContext({
        attemptCount: 2,
        lastInteractionAt: new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString(), // 49 hours ago (24h after first attempt)
        currentStep: 'email_verification',
        missingFields: ['email'],
      });

      const systemMessage: Message = {
        id: 'msg-system',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'system',
        content: JSON.stringify(reengagementContext),
        direction: 'inbound',
        status: 'sent',
        created_at: new Date(),
        twilio_message_sid: null,
        sent_at: null,
        delivered_at: null,
      };

      const mockSupabase = createMockSupabaseClient({
        users: [user],
        conversations: [conversation],
        messages: messages,
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeBouncerAgent(systemMessage, user, conversation);

      // Should send final message
      expect(response.immediateReply).toBe(true);
      expect(response.messages && response.messages.length).toBeGreaterThan(0);

      // Should be even softer / give them an out
      const allText = response.messages?.join(' ').toLowerCase() || '';
      const givesOut =
        allText.includes('close') ||
        allText.includes('not interested') ||
        allText.includes('let me know') ||
        allText.includes('reach out if');
      expect(givesOut).toBe(true);

      console.log('\n=== Second Re-engagement Test ===');
      console.log('Context: 49h since last message, attempt 2');
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Tone: Final attempt, giving user an out');
      console.log('=================================\n');
    }, 30000);
  });

  describe('After 2 Attempts: No More Re-engagement', () => {
    it('should NOT send message after 2 attempts with no response', async () => {
      const user = createUserByOnboardingStep('email_verification');
      user.email = null;
      const conversation = createTestConversation();
      const messages = createTestMessages('waiting_verification');

      // Create re-engagement system message (third attempt - should NOT happen)
      const reengagementContext = createReengagementContext({
        attemptCount: 3, // Beyond limit
        lastInteractionAt: new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString(),
        currentStep: 'email_verification',
        missingFields: ['email'],
      });

      const systemMessage: Message = {
        id: 'msg-system',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'system',
        content: JSON.stringify(reengagementContext),
        direction: 'inbound',
        status: 'sent',
        created_at: new Date(),
        twilio_message_sid: null,
        sent_at: null,
        delivered_at: null,
      };

      const mockSupabase = createMockSupabaseClient({
        users: [user],
        conversations: [conversation],
        messages: messages,
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeBouncerAgent(systemMessage, user, conversation);

      // Should NOT send message (silent)
      expect(response.immediateReply).toBe(false);
      expect(!response.messages || response.messages.length === 0).toBe(true);

      console.log('\n=== Third Attempt (Should NOT Message) Test ===');
      console.log('Context: 73h since last message, attempt 3');
      console.log('Decision: NO message sent (2-attempt limit)');
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('===============================================\n');
    }, 30000);
  });

  describe('User Responds After First Re-engagement', () => {
    it('should continue onboarding normally when user responds', async () => {
      const user = createUserByOnboardingStep('email_verification');
      user.email = null;
      const conversation = createTestConversation();
      const messages = createTestMessages('waiting_verification');

      // User responds to re-engagement with email
      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'sarah.chen@acme.com',
        direction: 'inbound',
        status: 'sent',
        created_at: new Date(),
        twilio_message_sid: 'SM123test',
        sent_at: new Date(),
        delivered_at: null,
      };

      const mockSupabase = createMockSupabaseClient({
        users: [user],
        conversations: [conversation],
        messages: messages,
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeBouncerAgent(incomingMessage, user, conversation);

      // Should collect email and provide verification instructions
      expect(response.actions.some(a => a.type === 'update_user_field')).toBe(true);

      verifyOnboardingMessages(response, {
        includesVerificationEmail: true,
      });

      console.log('\n=== User Responds After Re-engagement Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Decision: Continue onboarding normally');
      console.log('==============================================\n');
    }, 30000);
  });

  describe('Re-engagement with Clear Disinterest', () => {
    it('should detect disinterest and not send follow-up', async () => {
      const user = createUserByOnboardingStep('name_collection');
      const conversation = createTestConversation();

      // Conversation history shows user is not interested
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: conversation.id,
          user_id: user.id,
          role: 'user',
          content: 'Hi',
          direction: 'inbound',
          status: 'sent',
          created_at: new Date(Date.now() - 50 * 60 * 60 * 1000),
          twilio_message_sid: 'SM1',
          sent_at: new Date(Date.now() - 50 * 60 * 60 * 1000),
          delivered_at: null,
        },
        {
          id: 'msg-2',
          conversation_id: conversation.id,
          user_id: user.id,
          role: 'bouncer',
          content: 'Welcome to Yachtparty! Who told you about this?',
          direction: 'outbound',
          status: 'sent',
          created_at: new Date(Date.now() - 49 * 60 * 60 * 1000),
          twilio_message_sid: null,
          sent_at: new Date(Date.now() - 49 * 60 * 60 * 1000),
          delivered_at: null,
        },
        {
          id: 'msg-3',
          conversation_id: conversation.id,
          user_id: user.id,
          role: 'user',
          content: 'not interested',
          direction: 'inbound',
          status: 'sent',
          created_at: new Date(Date.now() - 48 * 60 * 60 * 1000),
          twilio_message_sid: 'SM2',
          sent_at: new Date(Date.now() - 48 * 60 * 60 * 1000),
          delivered_at: null,
        },
      ];

      const reengagementContext = createReengagementContext({
        attemptCount: 1,
        lastInteractionAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        currentStep: 'name_collection',
        missingFields: ['first_name', 'last_name', 'company', 'title', 'email'],
      });

      const systemMessage: Message = {
        id: 'msg-system',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'system',
        content: JSON.stringify(reengagementContext),
        direction: 'inbound',
        status: 'sent',
        created_at: new Date(),
        twilio_message_sid: null,
        sent_at: null,
        delivered_at: null,
      };

      const mockSupabase = createMockSupabaseClient({
        users: [user],
        conversations: [conversation],
        messages: messages,
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeBouncerAgent(systemMessage, user, conversation);

      // Should detect disinterest and not message
      // (OR send very soft final message acknowledging their disinterest)
      const pausedOrNoMessage = response.immediateReply === false;

      expect(pausedOrNoMessage).toBe(true);

      console.log('\n=== Disinterest Detection Test ===');
      console.log('Context: User said "not interested"');
      console.log('Decision:', response.immediateReply ? 'Send soft goodbye' : 'No message');
      console.log('Agent response:', response.messages?.join('\n') || 'No messages');
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('==================================\n');
    }, 30000);
  });

  describe('Re-engagement Tone', () => {
    it('should use softer tone than initial onboarding', async () => {
      const user = createUserByOnboardingStep('company_collection');
      const conversation = createTestConversation();
      const messages = createTestMessages('partial_info');

      const reengagementContext = createReengagementContext({
        attemptCount: 1,
        lastInteractionAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        currentStep: 'company_collection',
        missingFields: ['company', 'title', 'email'],
      });

      const systemMessage: Message = {
        id: 'msg-system',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'system',
        content: JSON.stringify(reengagementContext),
        direction: 'inbound',
        status: 'sent',
        created_at: new Date(),
        twilio_message_sid: null,
        sent_at: null,
        delivered_at: null,
      };

      const mockSupabase = createMockSupabaseClient({
        users: [user],
        conversations: [conversation],
        messages: messages,
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeBouncerAgent(systemMessage, user, conversation);

      // Check for soft language
      if (response.messages && response.messages.length > 0) {
        const allText = response.messages.join(' ').toLowerCase();

        // Should use soft/optional language
        const hasSoftLanguage =
          allText.includes('still') ||
          allText.includes('if you want') ||
          allText.includes('should i') ||
          allText.includes('just checking') ||
          allText.includes('let me know');

        expect(hasSoftLanguage).toBe(true);

        // Should NOT be demanding or list all missing fields
        const isNotDemanding =
          !allText.includes('you need to') &&
          !allText.includes('please provide');

        expect(isNotDemanding).toBe(true);
      }

      console.log('\n=== Re-engagement Tone Test ===');
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Tone check: Soft, non-demanding');
      console.log('===============================\n');
    }, 30000);
  });
});
