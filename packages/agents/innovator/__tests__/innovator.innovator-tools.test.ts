/**
 * Innovator Agent - Innovator-Specific Tools Tests
 *
 * Tests the 4 tools unique to Innovator agent:
 * 1. update_innovator_profile - Update solution description, target customers, pricing, etc.
 * 2. upload_prospects - Generate secure upload link for prospect list
 * 3. check_intro_progress - Check status of pending introductions
 * 4. request_credit_funding - Generate payment link for credit top-up
 */

import { invokeInnovatorAgent } from '../src/index';
import {
  createTestInnovator,
  createTestConversation,
  createTestMessages,
  createInnovatorProfile,
  createIntroOpportunities,
} from './fixtures';
import type { Message } from '@yachtparty/shared';
import {
  verifyAgentResponse,
  verifyCall2Messages,
  checkToneHelpfulNotOvereager,
} from './helpers';
import { createMockSupabaseClient } from './mocks/supabase.mock';
import { createServiceClient } from '@yachtparty/shared';

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

describe('Innovator Agent - Innovator-Specific Tools', () => {
  describe('Tool: update_innovator_profile', () => {
    it('should update solution description when user provides new info', async () => {
      const innovator = createTestInnovator();
      const conversation = createTestConversation();
      const messages = createTestMessages('onboarding');
      const profile = createInnovatorProfile();

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: innovator.id,
        role: 'user',
        content: 'Actually, we\'ve pivoted. We now offer AI-powered customer retention analytics for SaaS companies',
        direction: 'inbound',
        status: 'sent',
        created_at: new Date(),
        twilio_message_sid: 'SM123test',
        sent_at: new Date(),
        delivered_at: null,
      };

      const mockSupabase = createMockSupabaseClient({
        users: [innovator],
        conversations: [conversation],
        messages: messages,
        innovatorProfiles: [profile],
        userPriorities: [],
        communityRequests: [],
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeInnovatorAgent(incomingMessage, innovator, conversation);

      // Should update innovator profile
      expect(response.actions.some(a => a.type === 'update_innovator_profile')).toBe(true);

      // Should acknowledge update
      expect(response.messages && response.messages.length).toBeGreaterThan(0);

      console.log('\n=== Update Profile Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('===========================\n');
    }, 30000);

    it('should update target customer profile when user clarifies', async () => {
      const innovator = createTestInnovator();
      const conversation = createTestConversation();
      const messages = createTestMessages('onboarding');
      const profile = createInnovatorProfile();

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: innovator.id,
        role: 'user',
        content: 'We\'re now targeting SaaS companies with 50-500 employees and $5M-$50M ARR',
        direction: 'inbound',
        status: 'sent',
        created_at: new Date(),
        twilio_message_sid: 'SM123test',
        sent_at: new Date(),
        delivered_at: null,
      };

      const mockSupabase = createMockSupabaseClient({
        users: [innovator],
        conversations: [conversation],
        messages: messages,
        innovatorProfiles: [profile],
        userPriorities: [],
        communityRequests: [],
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeInnovatorAgent(incomingMessage, innovator, conversation);

      // Should update target_customer_profile
      expect(response.actions.some(a => a.type === 'update_innovator_profile')).toBe(true);

      console.log('\n=== Update Target Customer Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('====================================\n');
    }, 30000);
  });

  describe('Tool: upload_prospects', () => {
    it('should generate upload link when user wants to share prospect list', async () => {
      const innovator = createTestInnovator();
      const conversation = createTestConversation();
      const messages = createTestMessages('onboarding');
      const profile = createInnovatorProfile();

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: innovator.id,
        role: 'user',
        content: 'I have a list of 50 potential customers I want to upload. Can you help me connect with them?',
        direction: 'inbound',
        status: 'sent',
        created_at: new Date(),
        twilio_message_sid: 'SM123test',
        sent_at: new Date(),
        delivered_at: null,
      };

      const mockSupabase = createMockSupabaseClient({
        users: [innovator],
        conversations: [conversation],
        messages: messages,
        innovatorProfiles: [profile],
        userPriorities: [],
        communityRequests: [],
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeInnovatorAgent(incomingMessage, innovator, conversation);

      // Should generate upload link
      expect(response.actions.some(a => a.type === 'generate_prospect_upload_link')).toBe(true);

      // Should include upload link in message
      if (response.messages) {
        const allText = response.messages.join(' ');
        expect(allText.includes('upload') || allText.includes('link')).toBe(true);
      }

      console.log('\n=== Upload Prospects Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('=============================\n');
    }, 30000);

    it('should handle variations of prospect upload requests', async () => {
      const innovator = createTestInnovator();
      const conversation = createTestConversation();
      const messages = createTestMessages('onboarding');
      const profile = createInnovatorProfile();

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: innovator.id,
        role: 'user',
        content: 'Can I send you my target account list?',
        direction: 'inbound',
        status: 'sent',
        created_at: new Date(),
        twilio_message_sid: 'SM123test',
        sent_at: new Date(),
        delivered_at: null,
      };

      const mockSupabase = createMockSupabaseClient({
        users: [innovator],
        conversations: [conversation],
        messages: messages,
        innovatorProfiles: [profile],
        userPriorities: [],
        communityRequests: [],
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeInnovatorAgent(incomingMessage, innovator, conversation);

      // Should recognize this as upload request
      expect(response.actions.some(a => a.type === 'generate_prospect_upload_link')).toBe(true);

      console.log('\n=== Upload Variation Test ===');
      console.log('User says: "target account list"');
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('=============================\n');
    }, 30000);
  });

  describe('Tool: check_intro_progress', () => {
    it('should report status of pending introductions', async () => {
      const innovator = createTestInnovator();
      const conversation = createTestConversation();
      const messages = createTestMessages('onboarding');
      const profile = createInnovatorProfile();

      // Create pending intro opportunities
      const pendingIntros = createIntroOpportunities([
        {
          name: 'Alice Chen',
          company: 'TechCorp',
          expertise: 'VP Engineering',
          valueScore: 85,
        },
        {
          name: 'Bob Smith',
          company: 'DataInc',
          expertise: 'CTO',
          valueScore: 90,
        },
      ]);

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: innovator.id,
        role: 'user',
        content: 'What\'s the status of my pending introductions?',
        direction: 'inbound',
        status: 'sent',
        created_at: new Date(),
        twilio_message_sid: 'SM123test',
        sent_at: new Date(),
        delivered_at: null,
      };

      const mockSupabase = createMockSupabaseClient({
        users: [innovator],
        conversations: [conversation],
        messages: messages,
        innovatorProfiles: [profile],
        userPriorities: [],
        communityRequests: [],
        pendingIntros: pendingIntros,
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeInnovatorAgent(incomingMessage, innovator, conversation);

      // Should check intro progress
      expect(response.actions.some(a => a.type === 'report_intro_progress')).toBe(true);

      // Should report number of pending intros
      if (response.messages) {
        const allText = response.messages.join(' ');
        expect(allText.includes('2') || allText.includes('two') || allText.includes('pending')).toBe(true);
      }

      console.log('\n=== Check Intro Progress Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Pending intros: 2');
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('=================================\n');
    }, 30000);

    it('should handle no pending intros gracefully', async () => {
      const innovator = createTestInnovator();
      const conversation = createTestConversation();
      const messages = createTestMessages('onboarding');
      const profile = createInnovatorProfile();

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: innovator.id,
        role: 'user',
        content: 'Any updates on my introductions?',
        direction: 'inbound',
        status: 'sent',
        created_at: new Date(),
        twilio_message_sid: 'SM123test',
        sent_at: new Date(),
        delivered_at: null,
      };

      const mockSupabase = createMockSupabaseClient({
        users: [innovator],
        conversations: [conversation],
        messages: messages,
        innovatorProfiles: [profile],
        userPriorities: [],
        communityRequests: [],
        pendingIntros: [], // No pending intros
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeInnovatorAgent(incomingMessage, innovator, conversation);

      // Should report empty state
      expect(response.actions.some(a => a.type === 'report_intro_progress')).toBe(true);

      // Should suggest actions (upload prospects, ask for help, etc.)
      expect(response.messages && response.messages.length).toBeGreaterThan(0);

      console.log('\n=== No Pending Intros Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Pending intros: 0');
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('==============================\n');
    }, 30000);
  });

  describe('Tool: request_credit_funding', () => {
    it('should generate payment link when user wants to add credits', async () => {
      const innovator = createTestInnovator();
      innovator.credit_balance = 10; // Low balance
      const conversation = createTestConversation();
      const messages = createTestMessages('onboarding');
      const profile = createInnovatorProfile();

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: innovator.id,
        role: 'user',
        content: 'I\'m running low on credits. Can I add 500 more credits?',
        direction: 'inbound',
        status: 'sent',
        created_at: new Date(),
        twilio_message_sid: 'SM123test',
        sent_at: new Date(),
        delivered_at: null,
      };

      const mockSupabase = createMockSupabaseClient({
        users: [innovator],
        conversations: [conversation],
        messages: messages,
        innovatorProfiles: [profile],
        userPriorities: [],
        communityRequests: [],
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeInnovatorAgent(incomingMessage, innovator, conversation);

      // Should generate payment link
      expect(response.actions.some(a => a.type === 'generate_payment_link')).toBe(true);

      // Should include payment link in message
      if (response.messages) {
        const allText = response.messages.join(' ');
        expect(allText.includes('payment') || allText.includes('link') || allText.includes('500')).toBe(true);
      }

      console.log('\n=== Request Credits Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Current balance: 10 credits');
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('============================\n');
    }, 30000);

    it('should handle implicit credit requests (low balance mention)', async () => {
      const innovator = createTestInnovator();
      innovator.credit_balance = 5;
      const conversation = createTestConversation();
      const messages = createTestMessages('onboarding');
      const profile = createInnovatorProfile();

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: innovator.id,
        role: 'user',
        content: 'I need more budget to keep making introductions',
        direction: 'inbound',
        status: 'sent',
        created_at: new Date(),
        twilio_message_sid: 'SM123test',
        sent_at: new Date(),
        delivered_at: null,
      };

      const mockSupabase = createMockSupabaseClient({
        users: [innovator],
        conversations: [conversation],
        messages: messages,
        innovatorProfiles: [profile],
        userPriorities: [],
        communityRequests: [],
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeInnovatorAgent(incomingMessage, innovator, conversation);

      // Should recognize this as credit request
      expect(response.actions.some(a => a.type === 'generate_payment_link')).toBe(true);

      console.log('\n=== Implicit Credit Request Test ===');
      console.log('User says: "need more budget"');
      console.log('Current balance: 5 credits');
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('====================================\n');
    }, 30000);
  });

  describe('Tool Combinations', () => {
    it('should handle multiple tools in one message', async () => {
      const innovator = createTestInnovator();
      innovator.credit_balance = 10;
      const conversation = createTestConversation();
      const messages = createTestMessages('onboarding');
      const profile = createInnovatorProfile();

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: innovator.id,
        role: 'user',
        content: 'I\'ve updated my target market to focus on healthcare SaaS companies, and I need to add 1000 credits. Also, can you check the status of my pending intros?',
        direction: 'inbound',
        status: 'sent',
        created_at: new Date(),
        twilio_message_sid: 'SM123test',
        sent_at: new Date(),
        delivered_at: null,
      };

      const mockSupabase = createMockSupabaseClient({
        users: [innovator],
        conversations: [conversation],
        messages: messages,
        innovatorProfiles: [profile],
        userPriorities: [],
        communityRequests: [],
        pendingIntros: [],
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeInnovatorAgent(incomingMessage, innovator, conversation);

      // Should execute multiple tools:
      // 1. update_innovator_profile (target market change)
      // 2. request_credit_funding (1000 credits)
      // 3. check_intro_progress (pending intros status)

      const actionTypes = response.actions.map(a => a.type);
      const hasProfileUpdate = actionTypes.some(t => t === 'update_innovator_profile');
      const hasPaymentLink = actionTypes.some(t => t === 'generate_payment_link');
      const hasIntroCheck = actionTypes.some(t => t === 'report_intro_progress');

      // Should have at least 2 of the 3 actions (LLM may prioritize)
      const toolCount = [hasProfileUpdate, hasPaymentLink, hasIntroCheck].filter(Boolean).length;
      expect(toolCount).toBeGreaterThanOrEqual(2);

      console.log('\n=== Multiple Tools Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('Tools executed:', toolCount, 'of 3 requested');
      console.log('===========================\n');
    }, 30000);
  });
});
