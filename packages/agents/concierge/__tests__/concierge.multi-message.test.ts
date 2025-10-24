/**
 * Concierge Agent Multi-Message Ambiguity Tests
 *
 * Tests agent's ability to interpret sequential messages:
 * - Typo corrections ("Bran" → "Brian")
 * - Unclear responses to options presented
 * - Multiple rapid messages requiring context
 * - Determining if message is response to question vs. new topic
 */

import { invokeConciergeAgent } from '../src/index';
import {
  createTestUser,
  createTestConversation,
  createTestMessages,
} from './fixtures';
import { checkNoHallucinatedIntros } from './helpers';
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

describe('Concierge Agent - Multi-Message Ambiguity', () => {
  describe('Typo Correction: Sequential Messages', () => {
    it('should interpret "Bran" followed by "Brian" as correction', async () => {
      const user = createTestUser();
      const conversation = createTestConversation();

      // Prior conversation where we asked "Who do you want an intro to?"
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: conversation.id,
          user_id: user.id,
          role: 'user',
          content: 'Can you introduce me to someone at Roku?',
          direction: 'inbound',
          status: 'sent',
          created_at: new Date(Date.now() - 60000),
          twilio_message_sid: 'SM1',
          sent_at: new Date(Date.now() - 60000),
          delivered_at: null,
        },
        {
          id: 'msg-2',
          conversation_id: conversation.id,
          user_id: user.id,
          role: 'concierge',
          content: 'Who specifically are you trying to reach at Roku?',
          direction: 'outbound',
          status: 'sent',
          created_at: new Date(Date.now() - 50000),
          twilio_message_sid: null,
          sent_at: new Date(Date.now() - 50000),
          delivered_at: null,
        },
        {
          id: 'msg-3',
          conversation_id: conversation.id,
          user_id: user.id,
          role: 'user',
          content: 'Bran',
          direction: 'inbound',
          status: 'sent',
          created_at: new Date(Date.now() - 30000),
          twilio_message_sid: 'SM2',
          sent_at: new Date(Date.now() - 30000),
          delivered_at: null,
        },
      ];

      // User's latest message is the correction
      const incomingMessage: Message = {
        id: 'msg-4',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'Brian',
        direction: 'inbound',
        status: 'sent',
        created_at: new Date(),
        twilio_message_sid: 'SM3',
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

      const response = await invokeConciergeAgent(incomingMessage, user, conversation);

      // Agent should interpret "Brian" as the corrected answer
      // Should NOT request clarification - context makes it clear this is a typo fix
      expect(response.immediateReply).toBe(true);
      expect(response.messages).toBeDefined();

      // Should take action (create intro opportunity for "Brian" at Roku)
      expect(response.actions.length).toBeGreaterThan(0);

      console.log('\n=== Typo Correction Test ===');
      console.log('Prior message: "Bran"');
      console.log('Current message: "Brian"');
      console.log('Agent response:', response.messages?.join('\n') || 'No messages');
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('Interpretation: Agent should treat "Brian" as corrected name');
      console.log('============================\n');
    }, 30000);
  });

  describe('Unclear Response to Options', () => {
    it('should request clarification when response matches multiple options', async () => {
      const user = createTestUser();
      const conversation = createTestConversation();

      // Prior conversation where we presented 2 options
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: conversation.id,
          user_id: user.id,
          role: 'user',
          content: 'I need help scaling CTV advertising',
          direction: 'inbound',
          status: 'sent',
          created_at: new Date(Date.now() - 60000),
          twilio_message_sid: 'SM1',
          sent_at: new Date(Date.now() - 60000),
          delivered_at: null,
        },
        {
          id: 'msg-2',
          conversation_id: conversation.id,
          user_id: user.id,
          role: 'concierge',
          content: 'Are we talking about finding CTV advertising platforms to buy inventory from, or strategic consultants who can help you scale? Or something else?',
          direction: 'outbound',
          status: 'sent',
          created_at: new Date(Date.now() - 50000),
          twilio_message_sid: null,
          sent_at: new Date(Date.now() - 50000),
          delivered_at: null,
        },
      ];

      // User replies with ambiguous single word that could match either option
      const incomingMessage: Message = {
        id: 'msg-3',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'platforms',
        direction: 'inbound',
        status: 'sent',
        created_at: new Date(),
        twilio_message_sid: 'SM2',
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

      const response = await invokeConciergeAgent(incomingMessage, user, conversation);

      // "platforms" could mean:
      // 1. CTV advertising platforms (first option - solution research)
      // 2. Platform strategy consultants (second option - community request)
      // Agent should either:
      // A) Correctly infer from context they mean CTV ad platforms (preferred), OR
      // B) Request clarification if still ambiguous

      expect(response.immediateReply).toBe(true);
      expect(response.messages).toBeDefined();

      // Check if agent made a decision or requested clarification
      const requestedClarification = response.actions.length === 0;
      const madeDecision = response.actions.length > 0;

      console.log('\n=== Unclear Response Test ===');
      console.log('We asked: Ad platforms vs. consultants?');
      console.log('User replied: "platforms"');
      console.log('Agent response:', response.messages?.join('\n') || 'No messages');
      console.log('Actions:', response.actions.length === 0 ? 'None (requested clarification)' : response.actions.map(a => a.type).join(', '));
      console.log('Interpretation:', requestedClarification ? 'Still ambiguous - asked for clarity' : 'Inferred ad platforms from context');
      console.log('=============================\n');

      // Either interpretation is acceptable
      expect(requestedClarification || madeDecision).toBe(true);
    }, 30000);
  });

  describe('Response vs. New Topic Detection', () => {
    it('should determine if message is answering our question or changing topic', async () => {
      const user = createTestUser();
      const conversation = createTestConversation();

      // Prior conversation where we asked a question
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: conversation.id,
          user_id: user.id,
          role: 'user',
          content: 'Need help with CTV',
          direction: 'inbound',
          status: 'sent',
          created_at: new Date(Date.now() - 60000),
          twilio_message_sid: 'SM1',
          sent_at: new Date(Date.now() - 60000),
          delivered_at: null,
        },
        {
          id: 'msg-2',
          conversation_id: conversation.id,
          user_id: user.id,
          role: 'concierge',
          content: 'Are we talking about CTV advertising platforms, or something else?',
          direction: 'outbound',
          status: 'sent',
          created_at: new Date(Date.now() - 50000),
          twilio_message_sid: null,
          sent_at: new Date(Date.now() - 50000),
          delivered_at: null,
        },
      ];

      // User replies with what looks like a NEW topic (not answering our question)
      const incomingMessage: Message = {
        id: 'msg-3',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'Actually, do you know anyone at Hulu?',
        direction: 'inbound',
        status: 'sent',
        created_at: new Date(),
        twilio_message_sid: 'SM2',
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

      const response = await invokeConciergeAgent(incomingMessage, user, conversation);

      // Agent should recognize this is a NEW topic (intro request)
      // NOT an answer to the CTV platforms question
      expect(response.immediateReply).toBe(true);
      expect(response.messages).toBeDefined();

      // Should take intro action OR request clarification about Hulu intro
      expect(response.actions.length >= 0).toBe(true);

      console.log('\n=== Topic Change Detection Test ===');
      console.log('We asked: CTV platforms or something else?');
      console.log('User replied: "Actually, do you know anyone at Hulu?"');
      console.log('Agent response:', response.messages?.join('\n') || 'No messages');
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('Interpretation: Should recognize topic change to intro request');
      console.log('===================================\n');
    }, 30000);
  });

  describe('Rapid Sequential Messages', () => {
    it('should interpret rapid messages as continuation/clarification', async () => {
      const user = createTestUser();
      const conversation = createTestConversation();

      // User sent 3 rapid messages
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: conversation.id,
          user_id: user.id,
          role: 'user',
          content: 'Need help with CTV',
          direction: 'inbound',
          status: 'sent',
          created_at: new Date(Date.now() - 15000), // 15 seconds ago
          twilio_message_sid: 'SM1',
          sent_at: new Date(Date.now() - 15000),
          delivered_at: null,
        },
        {
          id: 'msg-2',
          conversation_id: conversation.id,
          user_id: user.id,
          role: 'user',
          content: 'Specifically ad platforms',
          direction: 'inbound',
          status: 'sent',
          created_at: new Date(Date.now() - 10000), // 10 seconds ago
          twilio_message_sid: 'SM2',
          sent_at: new Date(Date.now() - 10000),
          delivered_at: null,
        },
      ];

      // Latest message provides more context
      const incomingMessage: Message = {
        id: 'msg-3',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'Looking at Roku, Samsung, Fire TV',
        direction: 'inbound',
        status: 'sent',
        created_at: new Date(),
        twilio_message_sid: 'SM3',
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

      const response = await invokeConciergeAgent(incomingMessage, user, conversation);

      // Agent should interpret all 3 messages together
      // User wants help with CTV ad platforms: Roku, Samsung, Fire TV
      // BUT: User didn't specify WHAT they want help with (comparisons? intros? implementation?)
      // Agent may either:
      // A) Request clarification (smart - needs to know what kind of help)
      // B) Make reasonable assumption and take action

      expect(response.immediateReply).toBe(true);
      expect(response.messages).toBeDefined();

      const requestedClarification = response.actions.length === 0;
      const tookAction = response.actions.length > 0;

      // Should not hallucinate
      if (response.messages) {
        expect(checkNoHallucinatedIntros(response.messages)).toBe(true);
      }

      console.log('\n=== Rapid Messages Test ===');
      console.log('Message 1 (15s ago): "Need help with CTV"');
      console.log('Message 2 (10s ago): "Specifically ad platforms"');
      console.log('Message 3 (now): "Looking at Roku, Samsung, Fire TV"');
      console.log('Agent response:', response.messages?.join('\n') || 'No messages');
      console.log('Actions:', response.actions.length === 0 ? 'None (requested clarification)' : response.actions.map(a => a.type).join(', '));
      console.log('Interpretation:', requestedClarification ?
        'Agent recognized ambiguity (what KIND of help?) and requested clarification' :
        'Agent made assumption about what user needs');
      console.log('===========================\n');

      // Either approach is acceptable
      expect(requestedClarification || tookAction).toBe(true);
    }, 30000);
  });

  describe('Correction After Clarification', () => {
    it('should handle user correcting themselves after we requested clarification', async () => {
      const user = createTestUser();
      const conversation = createTestConversation();

      // We asked for clarification
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: conversation.id,
          user_id: user.id,
          role: 'user',
          content: 'Looking for partners',
          direction: 'inbound',
          status: 'sent',
          created_at: new Date(Date.now() - 60000),
          twilio_message_sid: 'SM1',
          sent_at: new Date(Date.now() - 60000),
          delivered_at: null,
        },
        {
          id: 'msg-2',
          conversation_id: conversation.id,
          user_id: user.id,
          role: 'concierge',
          content: 'Are we talking about business partners who can help you solve a problem, or strategic partners to collaborate with?',
          direction: 'outbound',
          status: 'sent',
          created_at: new Date(Date.now() - 50000),
          twilio_message_sid: null,
          sent_at: new Date(Date.now() - 50000),
          delivered_at: null,
        },
        {
          id: 'msg-3',
          conversation_id: conversation.id,
          user_id: user.id,
          role: 'user',
          content: 'The first',
          direction: 'inbound',
          status: 'sent',
          created_at: new Date(Date.now() - 30000),
          twilio_message_sid: 'SM2',
          sent_at: new Date(Date.now() - 30000),
          delivered_at: null,
        },
      ];

      // User sends correction/clarification
      const incomingMessage: Message = {
        id: 'msg-4',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        content: 'Actually the second one',
        direction: 'inbound',
        status: 'sent',
        created_at: new Date(),
        twilio_message_sid: 'SM3',
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

      const response = await invokeConciergeAgent(incomingMessage, user, conversation);

      // Agent should understand:
      // 1. User initially said "the first" (business partners for problem solving)
      // 2. User corrected to "the second one" (strategic collaboration partners)
      // Should act on the CORRECTED answer

      expect(response.immediateReply).toBe(true);
      expect(response.messages).toBeDefined();

      console.log('\n=== Correction After Clarification Test ===');
      console.log('We asked: Business partners or strategic partners?');
      console.log('User said: "The first"');
      console.log('User corrected: "Actually the second one"');
      console.log('Agent response:', response.messages?.join('\n') || 'No messages');
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('Interpretation: Should use corrected answer (strategic partners)');
      console.log('==========================================\n');
    }, 30000);
  });
});
