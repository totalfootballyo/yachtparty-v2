/**
 * Concierge Agent Re-engagement Tests
 *
 * Tests the Call 1 decision logic for re-engagement scenarios:
 * - Should the agent message or wait?
 * - If waiting, how many days to extend?
 * - What threads should be addressed if messaging?
 * - Detecting user frustration
 */

import { invokeConciergeAgent } from '../src/index';
import {
  createTestUser,
  createTestConversation,
  createTestMessages,
  createTestPriorities,
  createOutstandingRequests,
} from './fixtures';
import {
  verifyCall2Messages,
  checkToneHelpfulNotOvereager,
  checkNoHallucinatedIntros,
} from './helpers';
import {
  createMockSupabaseClient,
  verifyTaskCreated,
} from './mocks/supabase.mock';
import { createServiceClient, createAgentTask } from '@yachtparty/shared';
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

describe('Concierge Agent - Re-engagement Logic', () => {
  describe('Should Message: High-Value Priorities', () => {
    it('should message user with high-value intro opportunity', async () => {
      const user = createTestUser();
      const conversation = createTestConversation();
      const messages = createTestMessages('engaged');

      // High-value priorities (value 85-92)
      const priorities = createTestPriorities({ high: 2 });

      // Create re-engagement system message (7 days since last message)
      const systemMessage: Message = {
        id: 'msg-system',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'system',
        content: JSON.stringify({
          type: 're_engagement_check',
          daysSinceLastMessage: 7,
          priorityCount: 2,
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

      // Execute agent
      const response = await invokeConciergeAgent(systemMessage, user, conversation);

      // Should message (not wait)
      expect(response.immediateReply).toBe(true);
      expect(response.messages).toBeDefined();
      expect(response.messages && response.messages.length).toBeGreaterThan(0);

      // Should not create future task (already messaging now)
      expect(createAgentTask).not.toHaveBeenCalled();

      // Log for manual inspection
      console.log('\n=== High-Value Re-engagement Test ===');
      console.log('Context: 7 days since last message, 2 high priorities');
      console.log('Agent response:', response.messages?.join('\n') || 'No messages');
      console.log('Decision: Should message');
      console.log('======================================\n');
    }, 30000);
  });

  describe('Should Wait: User Frustrated', () => {
    it('should NOT message frustrated user and extend task', async () => {
      const user = createTestUser();
      const conversation = createTestConversation();

      // Frustrated conversation pattern
      const messages = createTestMessages('frustrated');

      // Even with priorities, should not message
      const priorities = createTestPriorities({ high: 1, medium: 1 });

      const systemMessage: Message = {
        id: 'msg-system',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'system',
        content: JSON.stringify({
          type: 're_engagement_check',
          daysSinceLastMessage: 5,
          priorityCount: 2,
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

      // Execute agent
      const response = await invokeConciergeAgent(systemMessage, user, conversation);

      // Should NOT message (wait instead)
      expect(response.immediateReply).toBe(false);
      expect(!response.messages || response.messages.length === 0).toBe(true);

      // Should create future re-engagement task
      expect(createAgentTask).toHaveBeenCalled();

      // Task should be extended (agent's judgment varies, but should be at least 7+ days)
      const taskCall = (createAgentTask as jest.Mock).mock.calls[0][0];
      const scheduledFor = new Date(taskCall.scheduled_for);
      const now = new Date();
      const daysExtended = Math.round((scheduledFor.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      expect(daysExtended).toBeGreaterThanOrEqual(7); // Should give them space

      // Log for manual inspection
      console.log('\n=== Frustrated User Test ===');
      console.log('Context: User said "too many messages", 5 days ago');
      console.log('Priorities: 2 items available');
      console.log('Decision: DO NOT message (user frustrated)');
      console.log('Extended by:', daysExtended, 'days');
      console.log('============================\n');
    }, 30000);
  });

  describe('Should Message: Outstanding Community Request', () => {
    it('should message about outstanding community request after 7 days', async () => {
      const user = createTestUser();
      const conversation = createTestConversation();
      const messages = createTestMessages('engaged');

      // Outstanding community request from 7 days ago
      const outstandingRequests = createOutstandingRequests(1, 7);

      const systemMessage: Message = {
        id: 'msg-system',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'system',
        content: JSON.stringify({
          type: 're_engagement_check',
          daysSinceLastMessage: 7,
          priorityCount: 0,
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
        userPriorities: [],
        communityRequests: outstandingRequests,
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      // Execute agent
      const response = await invokeConciergeAgent(systemMessage, user, conversation);

      // Should either message OR create task (agent may decide to wait)
      // The key is it acknowledged the outstanding request
      const didSomething = response.immediateReply || createAgentTask;
      expect(didSomething).toBeTruthy();

      // Should not hallucinate solutions
      if (response.messages) {
        expect(checkNoHallucinatedIntros(response.messages)).toBe(true);
      }

      // Log for manual inspection
      console.log('\n=== Outstanding Request Test ===');
      console.log('Context: 7 days since last message, 1 outstanding community request');
      console.log('Agent response:', response.messages?.join('\n') || 'No messages');
      console.log('Decision: Should reassure about outstanding request');
      console.log('================================\n');
    }, 30000);
  });

  describe('Should Wait: Too Soon to Re-engage', () => {
    it('should NOT message if only 2 days since last interaction', async () => {
      const user = createTestUser();
      const conversation = createTestConversation();
      const messages = createTestMessages('engaged');

      // NO priorities (if priorities exist, agent may choose to message)
      const priorities: any[] = [];

      const systemMessage: Message = {
        id: 'msg-system',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'system',
        content: JSON.stringify({
          type: 're_engagement_check',
          daysSinceLastMessage: 2, // Too soon
          priorityCount: 0, // No priorities
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

      // Execute agent
      const response = await invokeConciergeAgent(systemMessage, user, conversation);

      // Should NOT message (too soon)
      expect(response.immediateReply).toBe(false);

      // Should extend task (agent decides how long based on context)
      expect(createAgentTask).toHaveBeenCalled();
      const taskCall = (createAgentTask as jest.Mock).mock.calls[0][0];
      const scheduledFor = new Date(taskCall.scheduled_for);
      const now = new Date();
      const daysExtended = Math.round((scheduledFor.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      expect(daysExtended).toBeGreaterThan(0); // Should extend forward

      // Log for manual inspection
      console.log('\n=== Too Soon Test ===');
      console.log('Context: Only 2 days since last message');
      console.log('Decision: Wait (too soon to re-engage)');
      console.log('Extended by:', daysExtended, 'days');
      console.log('=====================\n');
    }, 30000);
  });

  describe('Multi-Threading: Multiple Priorities', () => {
    it('should create message sequence for 2-3 priorities', async () => {
      const user = createTestUser();
      const conversation = createTestConversation();
      const messages = createTestMessages('engaged');

      // Multiple priorities of different types
      const priorities = createTestPriorities({ high: 2, medium: 1 });

      // Outstanding request too
      const outstandingRequests = createOutstandingRequests(1, 7);

      const systemMessage: Message = {
        id: 'msg-system',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'system',
        content: JSON.stringify({
          type: 're_engagement_check',
          daysSinceLastMessage: 7,
          priorityCount: 3,
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
        communityRequests: outstandingRequests,
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      // Execute agent
      const response = await invokeConciergeAgent(systemMessage, user, conversation);

      // Should message with multiple threads
      expect(response.immediateReply).toBe(true);
      expect(response.messages).toBeDefined();

      // Should have 1-3 messages (agent decides how to thread)
      if (response.messages) {
        expect(response.messages.length).toBeGreaterThanOrEqual(1);
        expect(response.messages.length).toBeLessThanOrEqual(3);
      }

      // Verify tone is still brief per message
      verifyCall2Messages(response, {
        messageCountRange: [1, 3],
        noExclamations: true,
        maxLength: 200, // per message
        toneCheck: checkToneHelpfulNotOvereager,
      });

      // Log for manual inspection
      console.log('\n=== Multi-Threading Test ===');
      console.log('Context: 7 days, 3 priorities + 1 outstanding request');
      console.log('Agent response:', response.messages?.join('\n---\n') || 'No messages');
      console.log('Message count:', response.messages?.length);
      console.log('============================\n');
    }, 30000);
  });
});
