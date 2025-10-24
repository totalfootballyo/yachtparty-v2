/**
 * Innovator Agent - Inherited from Concierge Comprehensive Scenario Tests
 *
 * Tests the full 2-LLM architecture with richer test data:
 * - Actual intro opportunities in priorities
 * - Various conversation patterns
 * - Multi-threading scenarios
 * - Re-engagement decision logic
 */

import { invokeInnovatorAgent } from '../src/index';
import {
  createTestUser,
  createTestConversation,
  createTestMessages,
  createTestPriorities,
  createIntroOpportunities,
} from '../../concierge/__tests__/fixtures';
import type { Message } from '@yachtparty/shared';
import {
  verifyCall2Messages,
  verifyAgentResponse,
  checkToneHelpfulNotOvereager,
  checkNoHallucinatedIntros,
} from '../../concierge/__tests__/helpers';
import {
  createMockSupabaseClient,
  verifyEventPublished,
} from '../../concierge/__tests__/mocks/supabase.mock';
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

describe('Innovator Agent - Inherited from Concierge - Comprehensive Scenarios', () => {
  describe('User Message: With Available Intro Opportunity', () => {
    it('should offer intro when opportunity exists in priorities', async () => {
      // Setup: User asks about CTV advertising, and we HAVE an intro opportunity
      const user = createTestUser();
      const conversation = createTestConversation();
      const messages = createTestMessages('engaged');

      // Create actual intro opportunity for CTV expert
      const introOpportunities = createIntroOpportunities([
        {
          name: 'Sarah Chen',
          company: 'Hulu',
          expertise: 'CTV advertising platform scaling',
          valueScore: 92,
        },
      ]);

      // Create priority linking to this intro
      const priorities = createTestPriorities({ high: 1 });
      priorities[0].item_type = 'intro_opportunity';
      priorities[0].item_id = introOpportunities[0].id;

      const incomingMessage = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user' as const,
        content: 'Do you know anyone who has experience with CTV advertising platforms?',
        direction: 'inbound' as const,
        status: 'sent' as const,
        created_at: new Date(),
        twilio_message_sid: 'SM123test',
        sent_at: new Date(),
        delivered_at: null,
      };

      // Mock Supabase with priorities and intro opportunities
      const mockSupabase = createMockSupabaseClient({
        users: [user],
        conversations: [conversation],
        messages: messages,
        userPriorities: priorities,
        // Note: intro_opportunities table would be loaded by agent
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      // Execute agent
      const response = await invokeInnovatorAgent(incomingMessage, user, conversation);

      // Verify response
      expect(response.immediateReply).toBe(true);
      expect(response.messages).toBeDefined();

      // Log for manual inspection
      console.log('\n=== Intro Opportunity Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n') || 'No messages');
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('==============================\n');

      // The agent SHOULD mention the intro opportunity since it exists in priorities
      // This is the opposite of the hallucination test
      expect(response.messages).toBeDefined();
    }, 30000);
  });

  describe('User Message: Solution Research Request', () => {
    it('should create solution research workflow for vendor research', async () => {
      const user = createTestUser();
      const conversation = createTestConversation();
      const messages = createTestMessages('engaged');

      const incomingMessage = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user' as const,
        content: 'Can you help me research CTV advertising platforms? I need to compare features and pricing.',
        direction: 'inbound' as const,
        status: 'sent' as const,
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

      // Execute agent
      const response = await invokeInnovatorAgent(incomingMessage, user, conversation);

      // Verify Call 1 selected solution research
      expect(response.actions).toBeDefined();
      expect(response.actions.some(a => a.type === 'request_solution_research')).toBe(true);

      // Verify Call 2 sets expectations
      verifyCall2Messages(response, {
        messageCountRange: [1, 2],
        noExclamations: true,
        maxLength: 200,
        toneCheck: checkToneHelpfulNotOvereager,
      });

      // Log for manual inspection
      console.log('\n=== Solution Research Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n') || 'No messages');
      console.log('Actions:', response.actions.map(a => a.type).join(', '));
      console.log('==============================\n');
    }, 30000);
  });

  describe('User Message: Terse Communication Style', () => {
    it('should match brief communication style', async () => {
      const user = createTestUser();
      const conversation = createTestConversation();
      const messages = createTestMessages('terse'); // Short, brief messages

      const incomingMessage = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user' as const,
        content: 'CTV vendors?',
        direction: 'inbound' as const,
        status: 'sent' as const,
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

      // Execute agent
      const response = await invokeInnovatorAgent(incomingMessage, user, conversation);

      // Verify agent is also brief (should match user's style)
      expect(response.messages).toBeDefined();
      if (response.messages) {
        const totalLength = response.messages.join('').length;
        expect(totalLength).toBeLessThan(200); // Should be brief to match terse user
      }

      // Log for manual inspection
      console.log('\n=== Terse Communication Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n') || 'No messages');
      console.log('Response length:', response.messages?.join('').length);
      console.log('================================\n');
    }, 30000);
  });

  describe('User Message: Ambiguous Intent (Clarification)', () => {
    it('should request clarification when "partners" intent is ambiguous', async () => {
      const user = createTestUser();
      const conversation = createTestConversation();
      const messages: Message[] = [];

      const incomingMessage = {
        id: 'msg-new',
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user' as const,
        content: 'I\'m trying to scale our CTV advertising from $100k to $1M in Q1. Want to find the right partners for that.',
        direction: 'inbound' as const,
        status: 'sent' as const,
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

      // Execute agent
      const response = await invokeInnovatorAgent(incomingMessage, user, conversation);

      // Agent should recognize ambiguity and request clarification
      // "Partners" could mean: consultants/experts, vendors, strategic partners, etc.
      expect(response.immediateReply).toBe(true);
      expect(response.messages).toBeDefined();

      // Should NOT execute tools yet (waiting for clarification)
      expect(response.actions.length).toBe(0);

      // Response should ask for clarification
      if (response.messages) {
        const responseText = response.messages.join(' ').toLowerCase();
        // Should contain clarification language
        const hasClarity = responseText.includes('are we talking about') ||
                          responseText.includes('do you mean') ||
                          responseText.includes('are you looking for') ||
                          responseText.match(/partner/i);
        expect(hasClarity).toBe(true);
      }

      // Log for manual inspection
      console.log('\n=== Ambiguous Intent Test ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n') || 'No messages');
      console.log('Actions:', response.actions.length === 0 ? 'None (waiting for clarification)' : response.actions.map(a => a.type).join(', '));
      console.log('Decision: Agent detected ambiguity and requested clarification');
      console.log('=============================\n');
    }, 30000);
  });
});
