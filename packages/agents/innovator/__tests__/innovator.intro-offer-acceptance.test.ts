/**
 * Innovator Agent - Intro Offer Acceptance Tests
 *
 * Tests the two-step intro offer flow:
 * 1. User accepts intro_offer (Step 1)
 * 2. User declines intro_offer
 * 3. User confirms they made the intro (Step 2)
 * 4. Edge case: User is ambiguous about acceptance
 *
 * These tests verify that the agent correctly uses:
 * - accept_intro_offer tool
 * - decline_intro_offer tool
 * - confirm_intro_made tool
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

describe('Innovator - Intro Offer Acceptance', () => {
  describe('Accept Intro Offer (Step 1)', () => {
    it('should accept intro_offer when user says yes', async () => {
      const user = createTestUser();
      user.innovator = true;
      const conversation = createTestConversation();
      const messages = createTestMessages('engaged');

      // Create intro_offer in priorities
      const priorities: UserPriority[] = [{
        id: 'priority-1',
        user_id: user.id,
        priority_rank: 1,
        item_type: 'intro_offer',
        item_id: 'offer-123',
        value_score: 85,
        status: 'active',
        content: 'John Smith can introduce you to Sarah Chen at Salesforce',
        metadata: {
          offering_user_name: 'John Smith',
          prospect_name: 'Sarah Chen',
          prospect_company: 'Salesforce',
          expertise: 'Enterprise SaaS scaling'
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
        content: 'yes, that would be great',
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

      // Should select accept_intro_offer tool
      expect(response.actions.some((a: any) => a.type === 'accept_intro_offer')).toBe(true);
      const acceptAction = response.actions.find((a: any) => a.type === 'accept_intro_offer');
      expect(acceptAction?.params.intro_offer_id).toBe('offer-123');

      // Should acknowledge acceptance
      expect(response.messages).toBeDefined();
      const allText = response.messages?.join(' ').toLowerCase() || '';
      expect(allText).toMatch(/got it|perfect|great|i'll let|will let/i);

      console.log('\n=== Innovator - Accept Intro Offer Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n') || 'No messages');
      console.log('Actions:', response.actions.map((a: any) => a.type).join(', '));
      console.log('==========================================\n');
    }, 30000);
  });

  describe('Decline Intro Offer', () => {
    it('should decline intro_offer when user says no', async () => {
      const user = createTestUser();
      user.innovator = true;
      const conversation = createTestConversation();
      const messages = createTestMessages('engaged');

      // Create intro_offer in priorities
      const priorities: UserPriority[] = [{
        id: 'priority-2',
        user_id: user.id,
        priority_rank: 1,
        item_type: 'intro_offer',
        item_id: 'offer-456',
        value_score: 85,
        status: 'active',
        content: 'Mike Johnson can introduce you to Brian Lee at Adobe',
        metadata: {
          offering_user_name: 'Mike Johnson',
          prospect_name: 'Brian Lee',
          prospect_company: 'Adobe',
          expertise: 'Creative platform strategy'
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
        content: 'no thanks, not right now',
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

      // Should select decline_intro_offer tool
      expect(response.actions.some((a: any) => a.type === 'decline_intro_offer')).toBe(true);
      const declineAction = response.actions.find((a: any) => a.type === 'decline_intro_offer');
      expect(declineAction?.params.intro_offer_id).toBe('offer-456');

      // Should acknowledge decline
      expect(response.messages).toBeDefined();
      const allText = response.messages?.join(' ').toLowerCase() || '';
      expect(allText).toMatch(/got it|no problem|understood|noted/i);

      console.log('\n=== Innovator - Decline Intro Offer Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n') || 'No messages');
      console.log('Actions:', response.actions.map((a: any) => a.type).join(', '));
      console.log('===========================================\n');
    }, 30000);
  });

  describe('Confirm Intro Made (Step 2)', () => {
    it('should confirm intro was made when user reports completion', async () => {
      const user = createTestUser();
      user.innovator = true;
      const conversation = createTestConversation();
      const messages = createTestMessages('engaged');

      // Create intro_offer in 'introducee_accepted' status (waiting for confirmation)
      const priorities: UserPriority[] = [{
        id: 'priority-3',
        user_id: user.id,
        priority_rank: 1,
        item_type: 'intro_offer',
        item_id: 'offer-789',
        value_score: 85,
        status: 'active',
        content: 'Waiting for confirmation: Sarah Chen intro via John Smith',
        metadata: {
          offering_user_name: 'John Smith',
          prospect_name: 'Sarah Chen',
          prospect_company: 'Salesforce',
          expertise: 'Enterprise SaaS scaling',
          intro_status: 'introducee_accepted',
          waiting_for_confirmation: true
        },
        created_at: new Date('2025-10-10T10:00:00Z'),
        expires_at: null,
        presented_at: new Date('2025-10-10T10:00:00Z'),
      }];

      const incomingMessage: Message = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'I made the intro to Sarah',
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

      // Should select confirm_intro_made tool
      expect(response.actions.some((a: any) => a.type === 'confirm_intro_made')).toBe(true);
      const confirmAction = response.actions.find((a: any) => a.type === 'confirm_intro_made');
      expect(confirmAction?.params.intro_offer_id).toBe('offer-789');

      // Should acknowledge completion
      expect(response.messages).toBeDefined();
      const allText = response.messages?.join(' ').toLowerCase() || '';
      expect(allText).toMatch(/great|perfect|thanks|appreciate/i);

      console.log('\n=== Innovator - Confirm Intro Made Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n') || 'No messages');
      console.log('Actions:', response.actions.map((a: any) => a.type).join(', '));
      console.log('==========================================\n');
    }, 30000);
  });

  describe('Ambiguous Response Handling', () => {
    it('should request clarification when user response is ambiguous', async () => {
      const user = createTestUser();
      user.innovator = true;
      const conversation = createTestConversation();
      const messages = createTestMessages('engaged');

      // Create intro_offer in priorities
      const priorities: UserPriority[] = [{
        id: 'priority-4',
        user_id: user.id,
        priority_rank: 1,
        item_type: 'intro_offer',
        item_id: 'offer-999',
        value_score: 85,
        status: 'active',
        content: 'Emma Wilson can introduce you to Chris Park at Netflix',
        metadata: {
          offering_user_name: 'Emma Wilson',
          prospect_name: 'Chris Park',
          prospect_company: 'Netflix',
          expertise: 'Content streaming technology'
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
        content: 'maybe, let me think about it',
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

      // Should NOT select accept or decline tool when ambiguous
      expect(response.actions.some((a: any) => a.type === 'accept_intro_offer')).toBe(false);
      expect(response.actions.some((a: any) => a.type === 'decline_intro_offer')).toBe(false);

      // Should acknowledge and offer to clarify later
      expect(response.messages).toBeDefined();
      const allText = response.messages?.join(' ').toLowerCase() || '';
      expect(allText).toMatch(/no problem|take your time|let me know|when you're ready/i);

      console.log('\n=== Innovator - Ambiguous Response Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n') || 'No messages');
      console.log('Actions:', response.actions.map((a: any) => a.type).join(', '));
      console.log('==========================================\n');
    }, 30000);
  });
});
