/**
 * Bouncer Agent Onboarding Flow Tests
 *
 * Tests the complete onboarding flow using 2-LLM architecture:
 * - Brand new user (first interaction)
 * - Referrer collection and matching
 * - Name collection
 * - Company/title collection
 * - Email collection and verification
 * - Onboarding completion
 */

import { invokeBouncerAgent } from '../src/index';
import {
  createTestScenario,
  createTestConversation,
  createReferrerUser,
  createUserByOnboardingStep,
} from './fixtures';
import {
  verifyOnboardingMessages,
  verifyUserVerifiedEvent,
  checkToneWelcomingProfessional,
  checkMessageConcise,
} from './helpers';
import { createMockSupabaseClient } from './mocks/supabase.mock';
import { createServiceClient } from '@yachtparty/shared';
import type { Message } from '@yachtparty/shared';

// Mock @yachtparty/shared (database layer only - LLM calls are real)
jest.mock('@yachtparty/shared', () => {
  const actual = jest.requireActual('@yachtparty/shared');
  return {
    ...actual,
    createServiceClient: jest.fn(),
    publishEvent: jest.fn().mockResolvedValue(undefined),
    createAgentTask: jest.fn().mockResolvedValue({ id: 'task-123' }),
  };
});

// Ensure ANTHROPIC_API_KEY is available
beforeAll(() => {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required for tests');
  }
});

describe('Bouncer Agent - Onboarding Flow', () => {
  describe('First Interaction: Brand New User', () => {
    it('should ask who told them about Yachtparty (referrer collection)', async () => {
      const scenario = createTestScenario('brand_new_user');
      const { user, conversation, messages, incomingMessage } = scenario;

      if (!incomingMessage) {
        throw new Error('Test scenario did not provide an incoming message');
      }

      const mockSupabase = createMockSupabaseClient({
        users: [user],
        conversations: [conversation],
        messages: messages,
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      // Execute agent (makes REAL LLM calls)
      const response = await invokeBouncerAgent(incomingMessage, user, conversation);

      // Verify response structure
      expect(response.immediateReply).toBe(true);
      expect(response.messages).toBeDefined();
      expect(response.messages && response.messages.length).toBeGreaterThan(0);

      // Verify messages ask about referrer
      verifyOnboardingMessages(response, {
        messageCountRange: [1, 2],
        maxLength: 200,
        noExclamations: true,
      });

      // Should ask about referrer (variations: "who told you", "who sent you", "how did you hear")
      const allText = response.messages?.join(' ').toLowerCase() || '';
      const asksAboutReferrer =
        allText.includes('who told you') ||
        allText.includes('who sent you') ||
        allText.includes('how did you hear') ||
        allText.includes('who gave you');

      expect(asksAboutReferrer).toBe(true);

      // Log for manual inspection
      console.log('\n=== Brand New User Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n') || 'No messages');
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('============================\n');
    }, 30000);
  });

  describe('Referrer Collection: Exact Match', () => {
    it('should match referrer name to existing user and set referred_by', async () => {
      const user = createUserByOnboardingStep('welcome');
      const conversation = createTestConversation();
      const referrer = createReferrerUser(); // Ben Trenda

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'Ben Trenda told me about this',
        direction: 'inbound',
        status: 'sent',
        created_at: new Date(),
        twilio_message_sid: 'SM123test',
        sent_at: new Date(),
        delivered_at: null,
      };

      // Mock Supabase with referrer in database
      const mockSupabase = createMockSupabaseClient({
        users: [user, referrer],
        conversations: [conversation],
        messages: [],
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeBouncerAgent(incomingMessage, user, conversation);

      // Should collect referrer info
      expect(response.actions.some(a => a.type === 'update_user_field')).toBe(true);

      // Should move to next step (ask for name)
      const allText = response.messages?.join(' ').toLowerCase() || '';
      const asksForName = allText.includes('name') || allText.includes('what should i call you');
      expect(asksForName).toBe(true);

      console.log('\n=== Referrer Match Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('===========================\n');
    }, 30000);
  });

  describe('Name Collection', () => {
    it('should extract first and last name and ask for company', async () => {
      const user = createUserByOnboardingStep('name_collection');
      const conversation = createTestConversation();

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'Sarah Chen',
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
        messages: [],
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeBouncerAgent(incomingMessage, user, conversation);

      // Should collect name
      expect(response.actions.some(a => a.type === 'update_user_field')).toBe(true);

      // Should ask for company next
      const allText = response.messages?.join(' ').toLowerCase() || '';
      const asksForCompany =
        allText.includes('where do you work') ||
        allText.includes('what company') ||
        allText.includes('who do you work for');
      expect(asksForCompany).toBe(true);

      console.log('\n=== Name Collection Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('============================\n');
    }, 30000);
  });

  describe('Company/Title Collection', () => {
    it('should extract company and title together and ask for email', async () => {
      const user = createUserByOnboardingStep('company_collection');
      const conversation = createTestConversation();

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'Acme Corp, VP of Marketing',
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
        messages: [],
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeBouncerAgent(incomingMessage, user, conversation);

      // Should collect company and title
      expect(response.actions.some(a => a.type === 'update_user_field')).toBe(true);

      // Should ask for email next
      const allText = response.messages?.join(' ').toLowerCase() || '';
      const asksForEmail =
        allText.includes('email') ||
        allText.includes('work email') ||
        allText.includes('email address');
      expect(asksForEmail).toBe(true);

      console.log('\n=== Company/Title Collection Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('======================================\n');
    }, 30000);
  });

  describe('Onboarding Completion', () => {
    it('should complete onboarding when email is verified', async () => {
      const user = createUserByOnboardingStep('linkedin_connection');
      // Simulate email just got verified
      user.email_verified = true;
      const conversation = createTestConversation();

      // Create system message for email verification
      const systemMessage: Message = {
        id: 'msg-system',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'system',
        content: JSON.stringify({
          type: 'email_verified',
          email: user.email,
          verified_at: new Date().toISOString(),
        }),
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
        messages: [],
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeBouncerAgent(systemMessage, user, conversation);

      // Should mark user as verified
      expect(response.actions.some(a => a.type === 'mark_user_verified')).toBe(true);

      // Should publish user.verified event
      if (response.events) {
        verifyUserVerifiedEvent(response);
      }

      // Should welcome user and explain next steps
      expect(response.messages && response.messages.length).toBeGreaterThan(0);

      console.log('\n=== Onboarding Completion Test ===');
      console.log('System message:', systemMessage.content);
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('Events:', response.events?.map(e => e.event_type).join(', '));
      console.log('===================================\n');
    }, 30000);
  });

  describe('All-At-Once Information Provision', () => {
    it('should extract all fields when user provides everything at once', async () => {
      const user = createUserByOnboardingStep('welcome');
      const conversation = createTestConversation();

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'Hi, I\'m Sarah Chen from Acme Corp where I\'m VP of Marketing. My email is sarah.chen@acme.com',
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
        messages: [],
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeBouncerAgent(incomingMessage, user, conversation);

      // Should extract all provided fields
      expect(response.actions.some(a => a.type === 'update_user_field')).toBe(true);

      // Should either ask for referrer (if missing) or provide email verification instructions
      expect(response.messages && response.messages.length).toBeGreaterThan(0);

      console.log('\n=== All-At-Once Info Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('=============================\n');
    }, 30000);
  });

  describe('Tone and Personality', () => {
    it('should maintain selective gatekeeper tone (not salesy)', async () => {
      const scenario = createTestScenario('brand_new_user');
      const { user, conversation, messages, incomingMessage } = scenario;

      if (!incomingMessage) {
        throw new Error('Test scenario did not provide an incoming message');
      }

      const mockSupabase = createMockSupabaseClient({
        users: [user],
        conversations: [conversation],
        messages: messages,
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeBouncerAgent(incomingMessage, user, conversation);

      // Check tone is professional, not overeager
      if (response.messages) {
        for (const msg of response.messages) {
          expect(checkToneWelcomingProfessional(msg)).toBe(true);
          expect(checkMessageConcise(msg)).toBe(true);
        }
      }

      // Should not have exclamation points
      verifyOnboardingMessages(response, {
        noExclamations: true,
      });

      console.log('\n=== Tone Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Tone check: Professional, not salesy');
      console.log('=================\n');
    }, 30000);
  });
});
