/**
 * Innovator Agent - Inherited from Concierge Edge Case Tests
 *
 * Tests unusual scenarios and error handling:
 * - Empty messages
 * - Very long messages
 * - Rapid succession messages
 * - Mixed priorities
 * - Self-reflection (detecting leaked JSON)
 */

import { invokeInnovatorAgent } from '../src/index';
import {
  createTestUser,
  createTestConversation,
  createTestMessages,
  createTestPriorities,
} from '../../concierge/__tests__/fixtures';
import {
  verifyCall2Messages,
  checkToneHelpfulNotOvereager,
  checkNoHallucinatedIntros,
} from '../../concierge/__tests__/helpers';
import { createMockSupabaseClient } from '../../concierge/__tests__/mocks/supabase.mock';
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

describe('Innovator Agent - Inherited from Concierge - Edge Cases', () => {
  describe('Input Handling: Very Brief Messages', () => {
    it('should handle single-word messages', async () => {
      const user = createTestUser();
      const conversation = createTestConversation();
      const messages = createTestMessages('terse');

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'help',
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

      // Should handle gracefully and respond appropriately
      expect(response.immediateReply).toBe(true);
      expect(response.messages).toBeDefined();

      console.log('\n=== Brief Message Test ===');
      console.log('User:', incomingMessage.content);
      console.log('Response:', response.messages?.join('\n'));
      console.log('==========================\n');
    }, 30000);
  });

  describe('Input Handling: Very Long Messages', () => {
    it('should handle detailed multi-paragraph messages', async () => {
      const user = createTestUser();
      const conversation = createTestConversation();
      const messages: Message[] = [];

      const longMessage = `I'm working on scaling our CTV advertising business and need help with several things. First, we're currently spending about $100k per month on CTV but want to get to $1M per month by end of Q1. We're using The Trade Desk right now but having issues with their audience targeting. Second, we need better attribution - our current setup doesn't tie CTV views to actual conversions very well. Third, we're looking for someone who can help us understand the competitive landscape better, specifically what our competitors are doing on Roku, Samsung TV Plus, and Fire TV. Finally, we might need to hire a CTV specialist in-house if we can't figure this out with consultants. What do you think the best approach is here?`;

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: longMessage,
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

      // Should handle complex multi-issue messages
      expect(response.immediateReply).toBe(true);
      expect(response.messages).toBeDefined();

      // Should not hallucinate solutions
      if (response.messages) {
        expect(checkNoHallucinatedIntros(response.messages)).toBe(true);
      }

      console.log('\n=== Long Message Test ===');
      console.log('User message length:', longMessage.length, 'chars');
      console.log('Response:', response.messages?.join('\n'));
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('=========================\n');
    }, 30000);
  });

  describe('Priority Handling: Mixed Value Scores', () => {
    it('should handle mix of high, medium, low priorities correctly', async () => {
      const user = createTestUser();
      const conversation = createTestConversation();
      const messages = createTestMessages('engaged');

      // Mix of all priority levels
      const priorities = createTestPriorities({ high: 1, medium: 2, low: 3 });

      const systemMessage: Message = {
        id: 'msg-system',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'system',
        content: JSON.stringify({
          type: 're_engagement_check',
          daysSinceLastMessage: 7,
          priorityCount: 6,
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
        users: [user],
        conversations: [conversation],
        messages: messages,
        userPriorities: priorities,
        communityRequests: [],
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeInnovatorAgent(systemMessage, user, conversation);

      // Should prioritize high-value items
      // May choose to message or wait depending on LLM judgment
      expect(response.immediateReply !== undefined).toBe(true);

      console.log('\n=== Mixed Priorities Test ===');
      console.log('Priorities: 1 high, 2 medium, 3 low');
      console.log('Decision:', response.immediateReply ? 'Message' : 'Wait');
      if (response.messages) {
        console.log('Response:', response.messages.join('\n---\n'));
      }
      console.log('=============================\n');
    }, 30000);
  });

  describe('Tone: Matching User Style Across Patterns', () => {
    it('should adapt tone to match user communication style', async () => {
      // Test with terse user
      const user = createTestUser();
      const conversation = createTestConversation();
      const terseMessages = createTestMessages('terse');

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'CTV?',
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
        messages: terseMessages,
        userPriorities: [],
        communityRequests: [],
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      const response = await invokeInnovatorAgent(incomingMessage, user, conversation);

      // Should be very brief to match user style
      if (response.messages) {
        const avgLength = response.messages.reduce((sum, msg) => sum + msg.length, 0) / response.messages.length;
        expect(avgLength).toBeLessThan(200); // Brief responses to match terse user
      }

      console.log('\n=== Tone Matching Test ===');
      console.log('User style: Terse');
      console.log('Response:', response.messages?.join('\n'));
      const avgLength = response.messages ? response.messages.reduce((s, m) => s + m.length, 0) / response.messages.length : 0;
      console.log('Avg length:', avgLength);
      console.log('==========================\n');
    }, 30000);
  });
});
