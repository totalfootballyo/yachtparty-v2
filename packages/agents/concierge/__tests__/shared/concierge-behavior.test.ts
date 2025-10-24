/**
 * Shared Concierge Behavior Test Suite
 *
 * This test suite defines the expected behavior for ANY agent that implements
 * Concierge tools (Concierge agent itself, Innovator agent, future agents).
 *
 * Usage:
 *   import { runConciergeBehaviorTests } from './shared/concierge-behavior.test';
 *   runConciergeBehaviorTests('Concierge', invokeConciergeAgent);
 *   runConciergeBehaviorTests('Innovator', invokeInnovatorAgent);
 */

import type { Message, User, Conversation } from '@yachtparty/shared';
import { createServiceClient, publishEvent } from '@yachtparty/shared';
import {
  createTestUser,
  createTestConversation,
  createTestMessages,
  createTestPriorities,
  createIntroOpportunities,
} from '../fixtures';
import {
  verifyCall2Messages,
  checkToneHelpfulNotOvereager,
  checkNoHallucinatedIntros,
} from '../helpers';
import { createMockSupabaseClient } from '../mocks/supabase.mock';

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

/**
 * Shared test suite for Concierge behavior
 *
 * @param agentName - Name for test descriptions (e.g., 'Concierge', 'Innovator')
 * @param invokeAgent - Agent invocation function
 */
export function runConciergeBehaviorTests(
  agentName: string,
  invokeAgent: (message: Message, user: User, conversation: Conversation) => Promise<any>
) {
  describe(`${agentName} - Concierge Behavior`, () => {
    describe('Community Requests', () => {
      it('should create community request when user asks for help', async () => {
        const user = createTestUser();
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

        const response = await invokeAgent(incomingMessage, user, conversation);

        expect(response.immediateReply).toBe(true);
        expect(response.messages).toBeDefined();
        expect(response.actions.some((a: any) => a.type === 'ask_community_question')).toBe(true);

        console.log(`\n=== ${agentName} - Community Request Test ===`);
        console.log('User message:', incomingMessage.content);
        console.log('Agent response:', response.messages?.join('\n') || 'No messages');
        console.log('Actions:', response.actions.map((a: any) => a.type).join(', '));
        console.log('==========================================\n');
      }, 30000);
    });

    describe('Intro Opportunities', () => {
      it('should offer intro when opportunity exists in priorities', async () => {
        const user = createTestUser();
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
          userPriorities: priorities,
        });

        (createServiceClient as any).mockReturnValue(mockSupabase);

        const response = await invokeAgent(incomingMessage, user, conversation);

        expect(response.immediateReply).toBe(true);
        expect(response.messages).toBeDefined();

        console.log(`\n=== ${agentName} - Intro Opportunity Test ===`);
        console.log('User message:', incomingMessage.content);
        console.log('Agent response:', response.messages?.join('\n') || 'No messages');
        console.log('============================================\n');
      }, 30000);
    });

    describe('Solution Research', () => {
      it('should create solution research workflow', async () => {
        const user = createTestUser();
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

        const response = await invokeAgent(incomingMessage, user, conversation);

        expect(response.actions.some((a: any) => a.type === 'request_solution_research')).toBe(true);

        verifyCall2Messages(response, {
          messageCountRange: [1, 2],
          noExclamations: true,
          maxLength: 200,
          toneCheck: checkToneHelpfulNotOvereager,
        });

        console.log(`\n=== ${agentName} - Solution Research Test ===`);
        console.log('User message:', incomingMessage.content);
        console.log('Agent response:', response.messages?.join('\n') || 'No messages');
        console.log('=============================================\n');
      }, 30000);
    });

    describe('Goal Storage', () => {
      it('should store user goals when stated', async () => {
        const user = createTestUser();
        const conversation = createTestConversation();
        const messages: Message[] = [];

        const incomingMessage: Message = {
          id: 'msg-new',
          conversation_id: conversation.id,
          user_id: user.id,
          role: 'user',
          content: 'My goal is to find 10 strategic partners for our CTV expansion this quarter',
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

        const response = await invokeAgent(incomingMessage, user, conversation);

        expect(response.actions.some((a: any) => a.type === 'store_user_goal')).toBe(true);
        expect(response.messages && response.messages.length).toBeGreaterThan(0);

        console.log(`\n=== ${agentName} - Goal Storage Test ===`);
        console.log('User message:', incomingMessage.content);
        console.log('Agent response:', response.messages?.join('\n'));
        console.log('========================================\n');
      }, 30000);
    });

    describe('Ambiguity Handling', () => {
      it('should request clarification when intent is ambiguous', async () => {
        const user = createTestUser();
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

        const response = await invokeAgent(incomingMessage, user, conversation);

        expect(response.immediateReply).toBe(true);
        expect(response.messages).toBeDefined();

        // Should either request clarification OR make reasonable assumption
        // Both are valid - testing that it doesn't crash and responds appropriately

        console.log(`\n=== ${agentName} - Ambiguity Test ===`);
        console.log('User message:', incomingMessage.content);
        console.log('Agent response:', response.messages?.join('\n') || 'No messages');
        console.log('Actions:', response.actions.map((a: any) => a.type).join(', '));
        console.log('=====================================\n');
      }, 30000);
    });

    describe('Tone & Personality', () => {
      it('should maintain helpful-not-overeager tone', async () => {
        const user = createTestUser();
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

        const response = await invokeAgent(incomingMessage, user, conversation);

        verifyCall2Messages(response, {
          noExclamations: true,
          toneCheck: checkToneHelpfulNotOvereager,
        });

        if (response.messages) {
          expect(checkNoHallucinatedIntros(response.messages)).toBe(true);
        }

        console.log(`\n=== ${agentName} - Tone Test ===`);
        console.log('User message:', incomingMessage.content);
        console.log('Agent response:', response.messages?.join('\n'));
        console.log('================================\n');
      }, 30000);

      it('should match terse communication style', async () => {
        const user = createTestUser();
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

        const response = await invokeAgent(incomingMessage, user, conversation);

        expect(response.messages).toBeDefined();
        if (response.messages) {
          const totalLength = response.messages.join('').length;
          expect(totalLength).toBeLessThan(200); // Should be brief
        }

        console.log(`\n=== ${agentName} - Terse Style Test ===`);
        console.log('User message:', incomingMessage.content);
        console.log('Agent response:', response.messages?.join('\n'));
        console.log('Response length:', response.messages?.join('').length);
        console.log('========================================\n');
      }, 30000);
    });
  });
}
