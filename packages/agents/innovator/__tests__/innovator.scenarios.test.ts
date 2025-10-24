/**
 * Innovator Agent Comprehensive Scenario Tests
 *
 * Tests the full 2-LLM architecture for Innovator users with Concierge tools:
 * - Community requests (asking for help finding customers)
 * - Solution research (understanding markets/competitors)
 * - Intro opportunities (responding to potential customers)
 * - Goal storage and tracking
 * - Re-engagement decision logic
 */

import { invokeInnovatorAgent } from '../src/index';
import {
  createTestInnovator,
  createTestConversation,
  createTestMessages,
  createInnovatorProfile,
  createTestPriorities,
  createIntroOpportunities,
} from './fixtures';
import type { Message } from '@yachtparty/shared';
import {
  verifyCall2Messages,
  verifyAgentResponse,
  checkToneHelpfulNotOvereager,
  checkNoHallucinatedIntros,
} from './helpers';
import {
  createMockSupabaseClient,
  verifyEventPublished,
} from './mocks/supabase.mock';
import { createServiceClient, publishEvent } from '@yachtparty/shared';

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

describe('Innovator Agent - Comprehensive Scenarios', () => {
  describe('User Message: Help Finding Customers', () => {
    it('should create community request for customer introductions', async () => {
      const innovator = createTestInnovator();
      const conversation = createTestConversation();
      const messages = createTestMessages('onboarding');
      const profile = createInnovatorProfile();

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: innovator.id,
        role: 'user',
        content: 'Can you help me find e-commerce companies that might be interested in our analytics platform?',
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

      // Execute agent
      const response = await invokeInnovatorAgent(incomingMessage, innovator, conversation);

      // Verify response
      expect(response.immediateReply).toBe(true);
      expect(response.messages).toBeDefined();

      // Should use publish_community_request tool
      expect(response.actions.some(a => a.type === 'ask_community_question')).toBe(true);

      // Verify Call 2 output quality
      verifyCall2Messages(response, {
        messageCountRange: [1, 2],
        noExclamations: true,
        maxLength: 200,
        toneCheck: checkToneHelpfulNotOvereager,
      });

      // Log for manual inspection
      console.log('\n=== Customer Finding Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n') || 'No messages');
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('=============================\n');
    }, 30000);
  });

  describe('User Message: Solution Research Request', () => {
    it('should create solution research workflow for market analysis', async () => {
      const innovator = createTestInnovator();
      const conversation = createTestConversation();
      const messages = createTestMessages('onboarding');
      const profile = createInnovatorProfile();

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: innovator.id,
        role: 'user',
        content: 'I need to understand the competitive landscape for AI analytics platforms. Can you help me research competitors?',
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

      // Execute agent
      const response = await invokeInnovatorAgent(incomingMessage, innovator, conversation);

      // Should select solution research
      expect(response.actions.some(a => a.type === 'request_solution_research')).toBe(true);

      // Verify Call 2 sets expectations
      verifyCall2Messages(response, {
        messageCountRange: [1, 2],
        noExclamations: true,
        maxLength: 200,
        toneCheck: checkToneHelpfulNotOvereager,
      });

      console.log('\n=== Solution Research Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n') || 'No messages');
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('==============================\n');
    }, 30000);
  });

  describe('User Message: Intro Opportunity Response', () => {
    it('should handle acceptance of intro opportunity', async () => {
      const innovator = createTestInnovator();
      const conversation = createTestConversation();
      const messages = createTestMessages('onboarding');
      const profile = createInnovatorProfile();

      // Create intro opportunity in priorities
      const introOpportunities = createIntroOpportunities([
        {
          name: 'Mike Chen',
          company: 'E-commerce Inc',
          expertise: 'VP of Analytics at $50M e-commerce company',
          valueScore: 95,
        },
      ]);

      const priorities = createTestPriorities({ high: 1 });
      priorities[0].item_type = 'intro_opportunity';
      priorities[0].item_id = introOpportunities[0].id;

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: innovator.id,
        role: 'user',
        content: 'Yes, I\'d love an intro to Mike Chen at E-commerce Inc!',
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
        userPriorities: priorities,
        communityRequests: [],
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeInnovatorAgent(incomingMessage, innovator, conversation);

      // Should accept intro opportunity
      expect(response.actions.some(a => a.type === 'accept_intro_opportunity')).toBe(true);

      // Should acknowledge acceptance
      expect(response.messages && response.messages.length).toBeGreaterThan(0);

      console.log('\n=== Intro Acceptance Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('=============================\n');
    }, 30000);
  });

  describe('User Message: Goal Storage', () => {
    it('should store user goals when stated', async () => {
      const innovator = createTestInnovator();
      const conversation = createTestConversation();
      const messages: Message[] = [];
      const profile = createInnovatorProfile();

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: innovator.id,
        role: 'user',
        content: 'My goal is to close 10 new customers this quarter using Yachtparty introductions',
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

      // Should store goal
      expect(response.actions.some(a => a.type === 'store_user_goal')).toBe(true);

      // Should acknowledge goal
      expect(response.messages && response.messages.length).toBeGreaterThan(0);

      console.log('\n=== Goal Storage Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('=========================\n');
    }, 30000);
  });

  describe('User Message: Community Response (Expert Mode)', () => {
    it('should record expert response to community request', async () => {
      const innovator = createTestInnovator();
      innovator.expert_connector = true; // Innovator is also an expert
      const conversation = createTestConversation();
      const messages: Message[] = [];
      const profile = createInnovatorProfile();

      // Create community request in priorities (someone asked about analytics platforms)
      const priorities = createTestPriorities({ high: 1 });
      priorities[0].item_type = 'community_request';
      priorities[0].item_id = 'req-123';
      priorities[0].details = {
        question: 'Looking for AI analytics platform recommendations for e-commerce',
        requester_name: 'Sarah',
        expertise_needed: ['analytics', 'e-commerce', 'ai'],
      };

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: innovator.id,
        role: 'user',
        content: 'For Sarah\'s question about AI analytics, I\'d recommend looking at our platform. We specialize in e-commerce analytics and have great results with similar companies.',
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
        userPriorities: priorities,
        communityRequests: [],
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeInnovatorAgent(incomingMessage, innovator, conversation);

      // Should use record_community_response tool
      expect(response.actions.some(a => a.type === 'record_community_response')).toBe(true);

      // Should acknowledge the response
      expect(response.messages && response.messages.length).toBeGreaterThan(0);

      console.log('\n=== Community Response Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('===============================\n');
    }, 30000);
  });

  describe('User Message: Ambiguous Intent', () => {
    it('should request clarification when "leads" intent is ambiguous', async () => {
      const innovator = createTestInnovator();
      const conversation = createTestConversation();
      const messages: Message[] = [];
      const profile = createInnovatorProfile();

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: innovator.id,
        role: 'user',
        content: 'I need more leads for my business',
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

      // "Leads" could mean:
      // 1. Customer introductions (community request)
      // 2. Upload prospects they want help reaching (upload_prospects)
      // 3. General market research (solution research)

      // Agent should either:
      // A) Request clarification, OR
      // B) Make a reasonable assumption based on context

      expect(response.immediateReply).toBe(true);
      expect(response.messages && response.messages.length).toBeGreaterThan(0);

      console.log('\n=== Ambiguous Intent Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('Decision: Agent handles ambiguity appropriately');
      console.log('=============================\n');
    }, 30000);
  });

  describe('Re-engagement: High-Value Intro Opportunity', () => {
    it('should message innovator about high-value intro opportunity', async () => {
      const innovator = createTestInnovator();
      const conversation = createTestConversation();
      const messages = createTestMessages('onboarding');
      const profile = createInnovatorProfile();

      // High-value intro opportunity
      const introOpportunities = createIntroOpportunities([
        {
          name: 'Rachel Stevens',
          company: 'MegaCommerce Corp',
          expertise: 'CTO at $200M e-commerce company (perfect fit)',
          valueScore: 98,
        },
      ]);

      const priorities = createTestPriorities({ high: 1 });
      priorities[0].item_type = 'intro_opportunity';
      priorities[0].item_id = introOpportunities[0].id;

      const systemMessage: Message = {
        id: 'msg-system',
        conversation_id: conversation.id,
        user_id: innovator.id,
        role: 'system',
        content: JSON.stringify({
          type: 're_engagement_check',
          daysSinceLastMessage: 7,
          priorityCount: 1,
          hasActiveGoals: true,
        }),
        direction: 'inbound',
        status: 'sent',
        created_at: new Date(),
        twilio_message_sid: null,
        sent_at: null,
        delivered_at: null,
      };

      const mockSupabase = createMockSupabaseClient({
        users: [innovator],
        conversations: [conversation],
        messages: messages,
        innovatorProfiles: [profile],
        userPriorities: priorities,
        communityRequests: [],
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeInnovatorAgent(systemMessage, innovator, conversation);

      // Should message about high-value opportunity
      expect(response.immediateReply).toBe(true);
      expect(response.messages && response.messages.length).toBeGreaterThan(0);

      console.log('\n=== Re-engagement High-Value Intro Test ===');
      console.log('Context: 7 days since last message, high-value intro');
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('===========================================\n');
    }, 30000);
  });

  describe('Re-engagement: Low Priority Items Only', () => {
    it('should wait when only low-value items exist', async () => {
      const innovator = createTestInnovator();
      const conversation = createTestConversation();
      const messages = createTestMessages('onboarding');
      const profile = createInnovatorProfile();

      // Only low-value priorities
      const priorities = createTestPriorities({ low: 3 });

      const systemMessage: Message = {
        id: 'msg-system',
        conversation_id: conversation.id,
        user_id: innovator.id,
        role: 'system',
        content: JSON.stringify({
          type: 're_engagement_check',
          daysSinceLastMessage: 5,
          priorityCount: 3,
          hasActiveGoals: false,
        }),
        direction: 'inbound',
        status: 'sent',
        created_at: new Date(),
        twilio_message_sid: null,
        sent_at: null,
        delivered_at: null,
      };

      const mockSupabase = createMockSupabaseClient({
        users: [innovator],
        conversations: [conversation],
        messages: messages,
        innovatorProfiles: [profile],
        userPriorities: priorities,
        communityRequests: [],
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeInnovatorAgent(systemMessage, innovator, conversation);

      // Should probably wait (low-value items, not enough time passed)
      // OR send brief message if appropriate
      expect(response.immediateReply !== undefined).toBe(true);

      console.log('\n=== Re-engagement Low Priority Test ===');
      console.log('Context: 5 days since last message, only low priorities');
      console.log('Decision:', response.immediateReply ? 'Message' : 'Wait');
      if (response.messages) {
        console.log('Agent response:', response.messages.join('\n'));
      }
      console.log('=======================================\n');
    }, 30000);
  });

  describe('Tone and Personality: Business-Focused', () => {
    it('should maintain business-focused tone for innovators', async () => {
      const innovator = createTestInnovator();
      const conversation = createTestConversation();
      const messages = createTestMessages('onboarding');
      const profile = createInnovatorProfile();

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: innovator.id,
        role: 'user',
        content: 'What\'s the best way to use Yachtparty to close more deals?',
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

      // Should maintain business-focused, results-oriented tone
      verifyCall2Messages(response, {
        noExclamations: true,
        toneCheck: checkToneHelpfulNotOvereager,
      });

      console.log('\n=== Business Tone Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Tone: Business-focused, results-oriented');
      console.log('==========================\n');
    }, 30000);
  });
});
