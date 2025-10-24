/**
 * Innovator Agent - Connection Request Acceptance Tests
 *
 * Tests the connection request flow where another user wants to connect:
 * 1. User accepts connection_request
 * 2. User declines connection_request
 * 3. User asks for more context before deciding
 *
 * These tests verify that the agent correctly uses:
 * - accept_connection_request tool
 * - decline_connection_request tool
 */

import { invokeInnovatorAgent } from '../src/index';
import type { Message, User, Conversation, UserPriority } from '@yachtparty/shared';
import { createServiceClient, publishEvent } from '@yachtparty/shared';

// Import fixtures and helpers from Concierge (shared behavior)
import {
  createTestUser,
  createTestConversation,
  createTestMessages,
} from '../../concierge/__tests__/fixtures';
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

describe('Innovator - Connection Request Acceptance', () => {
  describe('Accept Connection Request', () => {
    it('should accept connection_request when user says yes', async () => {
      const user = createTestUser();
      user.innovator = true;
      const conversation = createTestConversation();
      const messages = createTestMessages('engaged');

      // Create connection_request in priorities
      const priorities: UserPriority[] = [{
        id: 'priority-1',
        user_id: user.id,
        priority_rank: 1,
        item_type: 'connection_request',
        item_id: 'conn-request-123',
        value_score: 80,
        status: 'active',
        content: 'Alex Martinez (CEO at TechCorp) wants to connect about enterprise software scaling',
        metadata: {
          requesting_user_id: 'user-alex-123',
          requesting_user_name: 'Alex Martinez',
          requesting_user_company: 'TechCorp',
          requesting_user_title: 'CEO',
          connection_reason: 'Looking to discuss enterprise software scaling strategies',
          mutual_interests: ['SaaS growth', 'enterprise sales']
        },
        created_at: new Date('2025-10-15T10:00:00Z'),
        expires_at: null,
        presented_at: new Date('2025-10-15T10:00:00Z'),
      }];

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'yes, I\'d like to connect',
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

      // Should select accept_connection_request tool
      expect(response.actions.some((a: any) => a.type === 'accept_connection_request')).toBe(true);
      const acceptAction = response.actions.find((a: any) => a.type === 'accept_connection_request');
      expect(acceptAction?.params.connection_request_id).toBe('conn-request-123');

      // Should acknowledge acceptance and set expectations
      expect(response.messages).toBeDefined();
      const allText = response.messages?.join(' ').toLowerCase() || '';
      expect(allText).toMatch(/got it|great|i'll let|will connect|reach out/i);

      console.log('\n=== Innovator - Accept Connection Request Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n') || 'No messages');
      console.log('Actions:', response.actions.map((a: any) => a.type).join(', '));
      console.log('=================================================\n');
    }, 30000);
  });

  describe('Decline Connection Request', () => {
    it('should decline connection_request when user says no', async () => {
      const user = createTestUser();
      user.innovator = true;
      const conversation = createTestConversation();
      const messages = createTestMessages('engaged');

      // Create connection_request in priorities
      const priorities: UserPriority[] = [{
        id: 'priority-2',
        user_id: user.id,
        priority_rank: 1,
        item_type: 'connection_request',
        item_id: 'conn-request-456',
        value_score: 75,
        status: 'active',
        content: 'Jordan Lee (VP Marketing at AdTech) wants to connect about advertising technology',
        metadata: {
          requesting_user_id: 'user-jordan-456',
          requesting_user_name: 'Jordan Lee',
          requesting_user_company: 'AdTech',
          requesting_user_title: 'VP Marketing',
          connection_reason: 'Interested in discussing CTV advertising strategies',
          mutual_interests: ['marketing tech', 'advertising']
        },
        created_at: new Date('2025-10-15T10:00:00Z'),
        expires_at: null,
        presented_at: new Date('2025-10-15T10:00:00Z'),
      }];

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'no thanks, not interested right now',
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

      // Should select decline_connection_request tool
      expect(response.actions.some((a: any) => a.type === 'decline_connection_request')).toBe(true);
      const declineAction = response.actions.find((a: any) => a.type === 'decline_connection_request');
      expect(declineAction?.params.connection_request_id).toBe('conn-request-456');

      // Should acknowledge decline
      expect(response.messages).toBeDefined();
      const allText = response.messages?.join(' ').toLowerCase() || '';
      expect(allText).toMatch(/got it|no problem|understood|noted/i);

      console.log('\n=== Innovator - Decline Connection Request Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n') || 'No messages');
      console.log('Actions:', response.actions.map((a: any) => a.type).join(', '));
      console.log('==================================================\n');
    }, 30000);
  });

  describe('Request More Context', () => {
    it('should provide more details when user asks for context', async () => {
      const user = createTestUser();
      user.innovator = true;
      const conversation = createTestConversation();
      const messages = createTestMessages('engaged');

      // Create connection_request in priorities with rich metadata
      const priorities: UserPriority[] = [{
        id: 'priority-3',
        user_id: user.id,
        priority_rank: 1,
        item_type: 'connection_request',
        item_id: 'conn-request-789',
        value_score: 85,
        status: 'active',
        content: 'Sam Chen (Founder at StreamCo) wants to connect about video streaming platforms',
        metadata: {
          requesting_user_id: 'user-sam-789',
          requesting_user_name: 'Sam Chen',
          requesting_user_company: 'StreamCo',
          requesting_user_title: 'Founder & CEO',
          connection_reason: 'Building next-gen video streaming platform, looking for insights on scaling CTV distribution',
          mutual_interests: ['CTV platforms', 'video streaming', 'content distribution'],
          requesting_user_background: 'Former VP Engineering at Netflix, 15 years in streaming tech'
        },
        created_at: new Date('2025-10-15T10:00:00Z'),
        expires_at: null,
        presented_at: new Date('2025-10-15T10:00:00Z'),
      }];

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'tell me more about Sam',
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

      // Should NOT accept or decline yet
      expect(response.actions.some((a: any) => a.type === 'accept_connection_request')).toBe(false);
      expect(response.actions.some((a: any) => a.type === 'decline_connection_request')).toBe(false);

      // Should provide more context about Sam
      expect(response.messages).toBeDefined();
      const allText = response.messages?.join(' ').toLowerCase() || '';
      // Check that response mentions Sam and relevant details
      expect(allText).toMatch(/sam|streamco|founder|netflix|streaming/i);

      console.log('\n=== Innovator - More Context Request Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n') || 'No messages');
      console.log('Actions:', response.actions.map((a: any) => a.type).join(', '));
      console.log('============================================\n');
    }, 30000);
  });
});
