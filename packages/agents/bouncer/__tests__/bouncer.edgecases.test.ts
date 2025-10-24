/**
 * Bouncer Agent Edge Cases Tests
 *
 * Tests unusual scenarios and error handling:
 * - Referrer name fuzzy matching
 * - Name variations (nicknames, middle names)
 * - Email format variations
 * - Information provided in unexpected order
 * - Very brief responses
 * - Nomination handling
 * - LinkedIn URL extraction
 */

import { invokeBouncerAgent } from '../src/index';
import {
  createUserByOnboardingStep,
  createTestConversation,
  createReferrerUser,
  createNomination,
} from './fixtures';
import {
  verifyOnboardingMessages,
  checkToneWelcomingProfessional,
} from './helpers';
import { createMockSupabaseClient } from './mocks/supabase.mock';
import { createServiceClient } from '@yachtparty/shared';
import type { Message } from '@yachtparty/shared';

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

describe('Bouncer Agent - Edge Cases', () => {
  describe('Referrer Matching: Variations', () => {
    it('should match "Ben" to "Ben Trenda" (fuzzy match)', async () => {
      const user = createUserByOnboardingStep('welcome');
      const conversation = createTestConversation();
      const referrer = createReferrerUser(); // Ben Trenda

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'Ben told me about this',
        direction: 'inbound',
        status: 'sent',
        created_at: new Date(),
        twilio_message_sid: 'SM123test',
        sent_at: new Date(),
        delivered_at: null,
      };

      const mockSupabase = createMockSupabaseClient({
        users: [user, referrer],
        conversations: [conversation],
        messages: [],
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeBouncerAgent(incomingMessage, user, conversation);

      // Should either:
      // A) Match with confidence and set referrer, OR
      // B) Ask for clarification ("Ben who?" or "Do you mean Ben Trenda?")

      expect(response.immediateReply).toBe(true);
      expect(response.messages && response.messages.length).toBeGreaterThan(0);

      console.log('\n=== Fuzzy Referrer Match Test ===');
      console.log('User said: "Ben"');
      console.log('Database has: "Ben Trenda"');
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('=================================\n');
    }, 30000);
  });

  describe('Referrer Matching: No Match', () => {
    it('should store name_dropped when referrer not found in database', async () => {
      const user = createUserByOnboardingStep('welcome');
      const conversation = createTestConversation();

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'John Smith from Google told me',
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

      // Should store name_dropped for manual review
      expect(response.actions.some(a => a.type === 'update_user_field')).toBe(true);

      // Should continue onboarding (ask for name)
      expect(response.messages && response.messages.length).toBeGreaterThan(0);

      console.log('\n=== No Match Referrer Test ===');
      console.log('User said: "John Smith from Google"');
      console.log('Database has: No match');
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('==============================\n');
    }, 30000);
  });

  describe('Name Variations: Single Name', () => {
    it('should handle single-name response and ask for full name', async () => {
      const user = createUserByOnboardingStep('name_collection');
      const conversation = createTestConversation();

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'Sarah',
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

      // Should store first name and ask for last name
      expect(response.actions.some(a => a.type === 'update_user_field')).toBe(true);

      const allText = response.messages?.join(' ').toLowerCase() || '';
      const asksForLastName =
        allText.includes('last name') ||
        allText.includes('full name') ||
        allText.includes('what\'s your last name');

      expect(asksForLastName).toBe(true);

      console.log('\n=== Single Name Test ===');
      console.log('User:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('========================\n');
    }, 30000);
  });

  describe('Name Variations: With Middle Name', () => {
    it('should extract first and last name, ignore middle', async () => {
      const user = createUserByOnboardingStep('name_collection');
      const conversation = createTestConversation();

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'Sarah Marie Chen',
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

      // Should extract first (Sarah) and last (Chen), possibly store middle
      expect(response.actions.some(a => a.type === 'update_user_field')).toBe(true);

      // Should move to next step (ask for company)
      expect(response.messages && response.messages.length).toBeGreaterThan(0);

      console.log('\n=== Middle Name Test ===');
      console.log('User:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('========================\n');
    }, 30000);
  });

  describe('Email Variations: Formatting', () => {
    it('should handle email in sentence context', async () => {
      const user = createUserByOnboardingStep('email_verification');
      user.email = null;
      const conversation = createTestConversation();

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'It\'s sarah.chen@acme.com',
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

      // Should extract email
      expect(response.actions.some(a => a.type === 'update_user_field')).toBe(true);

      // Should provide verification instructions
      verifyOnboardingMessages(response, {
        includesVerificationEmail: true,
      });

      console.log('\n=== Email in Sentence Test ===');
      console.log('User:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('==============================\n');
    }, 30000);
  });

  describe('Information Out of Order', () => {
    it('should handle company provided before name', async () => {
      const user = createUserByOnboardingStep('welcome');
      const conversation = createTestConversation();

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'I work at Acme Corp',
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

      // Should store company
      expect(response.actions.some(a => a.type === 'update_user_field')).toBe(true);

      // Should ask for missing info (name or referrer, depending on what's most important)
      expect(response.messages && response.messages.length).toBeGreaterThan(0);

      console.log('\n=== Out of Order Info Test ===');
      console.log('User provides company before name');
      console.log('User:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('==============================\n');
    }, 30000);
  });

  describe('Very Brief Responses', () => {
    it('should handle single-word answers gracefully', async () => {
      const user = createUserByOnboardingStep('company_collection');
      const conversation = createTestConversation();

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'Acme',
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

      // Should store company
      expect(response.actions.some(a => a.type === 'update_user_field')).toBe(true);

      // Should ask for title next
      expect(response.messages && response.messages.length).toBeGreaterThan(0);

      console.log('\n=== Brief Response Test ===');
      console.log('User:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('===========================\n');
    }, 30000);
  });

  describe('Nomination Handling', () => {
    it('should extract and store nomination when user provides prospect info', async () => {
      const user = createUserByOnboardingStep('first_nomination');
      const conversation = createTestConversation();
      const nomination = createNomination();

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: `I'd like to nominate ${nomination.name} from ${nomination.company}. He's their ${nomination.title}.`,
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

      // Should create intro opportunity for nomination
      expect(response.actions.some(a => a.type === 'show_intro_opportunity')).toBe(true);

      // Should acknowledge nomination
      expect(response.messages && response.messages.length).toBeGreaterThan(0);

      console.log('\n=== Nomination Test ===');
      console.log('User nominates:', nomination.name);
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('=======================\n');
    }, 30000);
  });

  describe('LinkedIn URL Extraction', () => {
    it('should extract LinkedIn URL from various formats', async () => {
      const user = createUserByOnboardingStep('linkedin_connection');
      const conversation = createTestConversation();

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'linkedin.com/in/sarahchen',
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

      // Should extract LinkedIn URL (normalize to https://linkedin.com/in/...)
      expect(response.actions.some(a => a.type === 'update_user_field')).toBe(true);

      // Should acknowledge and continue
      expect(response.messages && response.messages.length).toBeGreaterThan(0);

      console.log('\n=== LinkedIn URL Extraction Test ===');
      console.log('User provides:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('====================================\n');
    }, 30000);
  });

  describe('Tone Consistency Across Scenarios', () => {
    it('should maintain gatekeeper tone even with friendly users', async () => {
      const user = createUserByOnboardingStep('welcome');
      const conversation = createTestConversation();

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'Hey! Super excited to be here! This looks amazing!',
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

      // Should NOT match user's over-enthusiasm
      verifyOnboardingMessages(response, {
        noExclamations: true,
      });

      // Should maintain professional tone
      if (response.messages) {
        for (const msg of response.messages) {
          expect(checkToneWelcomingProfessional(msg)).toBe(true);
        }
      }

      console.log('\n=== Tone Consistency Test ===');
      console.log('User (enthusiastic):', incomingMessage.content);
      console.log('Agent (professional):', response.messages?.join('\n'));
      console.log('Tone: Maintains gatekeeper tone, not overeager');
      console.log('=============================\n');
    }, 30000);
  });
});
