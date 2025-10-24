/**
 * Innovator Agent - Shared Concierge Behavior Tests
 *
 * Runs the shared Concierge behavior test suite against the Innovator agent.
 * Since Innovator extends Concierge, all Concierge tests should pass.
 */

import { invokeInnovatorAgent } from '../src/index';
import type { Message, User, Conversation } from '@yachtparty/shared';
import { createServiceClient, publishEvent } from '@yachtparty/shared';

// Import fixtures and helpers from Concierge (shared behavior)
import {
  createTestUser,
  createTestConversation,
  createTestMessages,
  createTestPriorities,
  createIntroOpportunities,
} from '../../concierge/__tests__/fixtures';
import {
  verifyCall2Messages,
  checkToneHelpfulNotOvereager,
  checkNoHallucinatedIntros,
} from '../../concierge/__tests__/helpers';
import { createMockSupabaseClient } from '../../concierge/__tests__/mocks/supabase.mock';

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

describe('Innovator - Concierge Behavior (Inherited)', () => {
  describe('Community Requests', () => {
    it('should create community request when user asks for help', async () => {
      const user = createTestUser();
      user.innovator = true; // Make user an innovator
      const conversation = createTestConversation();
      const messages = createTestMessages('engaged');

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'Do you know anyone who has experience with CTV advertising platforms?',
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
        userPriorities: [],
        communityRequests: [],
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeInnovatorAgent(incomingMessage, user, conversation);

      expect(response.immediateReply).toBe(true);
      expect(response.messages).toBeDefined();
      expect(response.actions.some((a: any) => a.type === 'ask_community_question')).toBe(true);

      console.log('\n=== Innovator - Community Request Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n') || 'No messages');
      console.log('Actions:', response.actions.map((a: any) => a.type).join(', '));
      console.log('==========================================\n');
    }, 30000);
  });

  describe('Intro Opportunities', () => {
    it('should present intro_opportunity from priorities when user asks what agent has', async () => {
      const user = createTestUser();
      user.innovator = true;
      const conversation = createTestConversation();
      const messages = createTestMessages('engaged');

      const introOpportunities = createIntroOpportunities([
        {
          name: 'Sarah Chen',
          company: 'Hulu',
          expertise: 'CTV advertising platform scaling',
          valueScore: 92,
        },
      ]);

      const priorities = createTestPriorities({ high: 1 });
      priorities[0].item_type = 'intro_opportunity';
      priorities[0].item_id = introOpportunities[0].id;
      priorities[0].content = 'Sarah Chen at Hulu - CTV advertising platform scaling expert';
      priorities[0].metadata = {
        prospect_name: 'Sarah Chen',
        prospect_company: 'Hulu',
        expertise: 'CTV advertising platform scaling'
      };

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'what do you have for me?',
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
        userPriorities: priorities,
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeInnovatorAgent(incomingMessage, user, conversation);

      expect(response.immediateReply).toBe(true);
      expect(response.messages).toBeDefined();

      // Should present the intro opportunity mentioning Sarah Chen, Hulu, and CTV
      const allText = response.messages?.join(' ').toLowerCase() || '';
      expect(allText).toMatch(/sarah.*chen|hulu|ctv/i);

      console.log('\n=== Innovator - Intro Opportunity Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n') || 'No messages');
      console.log('Expected: Should present intro opportunity for Sarah Chen at Hulu');
      console.log('==========================================\n');
    }, 30000);
  });

  describe('Solution Research', () => {
    it('should create solution research workflow', async () => {
      const user = createTestUser();
      user.innovator = true;
      const conversation = createTestConversation();
      const messages = createTestMessages('engaged');

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'Can you help me research CTV advertising platforms? I need to compare features and pricing.',
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
        userPriorities: [],
        communityRequests: [],
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeInnovatorAgent(incomingMessage, user, conversation);

      expect(response.actions.some((a: any) => a.type === 'request_solution_research')).toBe(true);

      verifyCall2Messages(response, {
        messageCountRange: [1, 2],
        noExclamations: true,
        maxLength: 200,
        toneCheck: checkToneHelpfulNotOvereager,
      });

      console.log('\n=== Innovator - Solution Research Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n') || 'No messages');
      console.log('==========================================\n');
    }, 30000);
  });

  describe('Goal Storage', () => {
    it('should store user goals when stated', async () => {
      const user = createTestUser();
      user.innovator = true;
      const conversation = createTestConversation();
      const messages: Message[] = [];

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'My goal is to close 10 deals this quarter through Yachtparty connections',
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
        userPriorities: [],
        communityRequests: [],
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeInnovatorAgent(incomingMessage, user, conversation);

      expect(response.actions.some((a: any) => a.type === 'store_user_goal')).toBe(true);
      expect(response.messages && response.messages.length).toBeGreaterThan(0);

      console.log('\n=== Innovator - Goal Storage Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('=====================================\n');
    }, 30000);
  });

  describe('Ambiguity Handling', () => {
    it('should request clarification when intent is ambiguous', async () => {
      const user = createTestUser();
      user.innovator = true;
      const conversation = createTestConversation();
      const messages: Message[] = [];

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'I\'m trying to scale our CTV advertising from $100k to $1M in Q1. Want to find the right partners for that.',
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
        userPriorities: [],
        communityRequests: [],
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeInnovatorAgent(incomingMessage, user, conversation);

      expect(response.immediateReply).toBe(true);
      expect(response.messages).toBeDefined();

      console.log('\n=== Innovator - Ambiguity Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n') || 'No messages');
      console.log('Actions:', response.actions.map((a: any) => a.type).join(', '));
      console.log('==================================\n');
    }, 30000);
  });

  describe('Tone & Personality', () => {
    it('should maintain helpful-not-overeager tone', async () => {
      const user = createTestUser();
      user.innovator = true;
      const conversation = createTestConversation();
      const messages = createTestMessages('engaged');

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'Can you help me find CTV experts?',
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
        userPriorities: [],
        communityRequests: [],
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeInnovatorAgent(incomingMessage, user, conversation);

      verifyCall2Messages(response, {
        noExclamations: true,
        toneCheck: checkToneHelpfulNotOvereager,
      });

      if (response.messages) {
        expect(checkNoHallucinatedIntros(response.messages)).toBe(true);
      }

      console.log('\n=== Innovator - Tone Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('=============================\n');
    }, 30000);

    it('should match terse communication style', async () => {
      const user = createTestUser();
      user.innovator = true;
      const conversation = createTestConversation();
      const messages = createTestMessages('terse');

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'CTV vendors?',
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
        userPriorities: [],
        communityRequests: [],
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeInnovatorAgent(incomingMessage, user, conversation);

      expect(response.messages).toBeDefined();
      if (response.messages) {
        const totalLength = response.messages.join('').length;
        expect(totalLength).toBeLessThan(200);
      }

      console.log('\n=== Innovator - Terse Style Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n'));
      console.log('Response length:', response.messages?.join('').length);
      console.log('====================================\n');
    }, 30000);
  });
});
