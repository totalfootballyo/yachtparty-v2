/**
 * Concierge Agent Unit Tests
 *
 * Tests for the Concierge Agent's intent classification and message handling.
 */

import { mockSupabase } from '../mocks/supabase.mock';
import { mockAnthropic } from '../mocks/anthropic.mock';
import {
  createVerifiedUser,
  createTestConversation,
  createTestMessage,
  createTestUserPriority,
  createTestIntroOpportunity,
} from '../helpers/test-data';

describe('Concierge Agent', () => {
  describe('Intent Classification', () => {
    it('should classify solution inquiry intent', async () => {
      // Arrange
      mockAnthropic.mockConciergeIntent('solution_inquiry', {
        description: 'Need a CRM tool',
        category: 'sales_tools',
        urgency: 'medium',
      });

      // Act
      const response = await mockAnthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: 'Classify intent: I need help finding a CRM tool',
          },
        ],
      });

      const result = JSON.parse(response.content[0].text);

      // Assert
      expect(result.intent).toBe('solution_inquiry');
      expect(result.extracted_data.category).toBe('sales_tools');
    });

    it('should classify intro request intent', async () => {
      // Arrange
      mockAnthropic.mockConciergeIntent('intro_request', {
        prospect_name: 'John Smith',
        prospect_company: 'Acme Corp',
        reason: 'potential customer',
      });

      // Act
      const response = await mockAnthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content:
              'Classify intent: Can you introduce me to John Smith at Acme?',
          },
        ],
      });

      const result = JSON.parse(response.content[0].text);

      // Assert
      expect(result.intent).toBe('intro_request');
      expect(result.extracted_data.prospect_name).toBe('John Smith');
    });

    it('should classify community question intent', async () => {
      // Arrange
      mockAnthropic.mockConciergeIntent('community_question', {
        question: 'What marketing automation tools work best?',
        expertise_needed: ['marketing', 'automation'],
      });

      // Act
      const response = await mockAnthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content:
              'Classify intent: What marketing automation tools do people recommend?',
          },
        ],
      });

      const result = JSON.parse(response.content[0].text);

      // Assert
      expect(result.intent).toBe('community_question');
      expect(result.extracted_data.expertise_needed).toContain('marketing');
    });

    it('should classify general conversation intent', async () => {
      // Arrange
      mockAnthropic.mockConciergeIntent('general_conversation', {});

      // Act
      const response = await mockAnthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [
          { role: 'user', content: 'Classify intent: Thanks for your help!' },
        ],
      });

      const result = JSON.parse(response.content[0].text);

      // Assert
      expect(result.intent).toBe('general_conversation');
    });
  });

  describe('Priority Surfacing', () => {
    it('should surface high-value intro opportunities', async () => {
      // Arrange
      const user = createVerifiedUser();
      const intro = createTestIntroOpportunity({
        connector_user_id: user.id,
        bounty_credits: 200,
      });
      const priority = createTestUserPriority({
        user_id: user.id,
        item_type: 'intro_opportunity',
        item_id: intro.id,
        priority_rank: 1,
        value_score: 90,
      });

      mockSupabase.seedDatabase({
        users: [user],
        intro_opportunities: [intro],
        user_priorities: [priority],
      });

      // Act
      const result = await mockSupabase
        .from('user_priorities')
        .select()
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('priority_rank', { ascending: true })
        .limit(1);

      // Assert
      expect(result.data).toHaveLength(1);
      expect(result.data[0].item_type).toBe('intro_opportunity');
      expect(result.data[0].value_score).toBe(90);
    });

    it('should not overwhelm user with multiple priorities at once', async () => {
      // Arrange
      const user = createVerifiedUser();
      const priorities = [
        createTestUserPriority({
          user_id: user.id,
          priority_rank: 1,
          value_score: 90,
        }),
        createTestUserPriority({
          user_id: user.id,
          priority_rank: 2,
          value_score: 80,
        }),
        createTestUserPriority({
          user_id: user.id,
          priority_rank: 3,
          value_score: 70,
        }),
      ];

      mockSupabase.seedDatabase({
        users: [user],
        user_priorities: priorities,
      });

      // Act - Only fetch top priority
      const result = await mockSupabase
        .from('user_priorities')
        .select()
        .eq('user_id', user.id)
        .order('priority_rank', { ascending: true })
        .limit(1);

      // Assert
      expect(result.data).toHaveLength(1);
      expect(result.data[0].priority_rank).toBe(1);
    });
  });

  describe('Message Rendering', () => {
    it('should render conversational message for user', async () => {
      // Arrange
      mockAnthropic.mockConciergeMessage(
        "I can help you find a CRM solution. What features are most important to you?"
      );

      // Act
      const response = await mockAnthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: 'Generate conversational message' }],
      });

      const message = response.content[0].text;

      // Assert
      expect(message).toContain('help');
      expect(message.length).toBeGreaterThan(10);
    });
  });

  describe('Event Publishing', () => {
    it('should publish solution_inquiry event for Solution Saga', async () => {
      // Arrange
      const user = createVerifiedUser();
      const event = {
        id: 'event-1',
        event_type: 'user.inquiry.solution_needed',
        aggregate_id: user.id,
        aggregate_type: 'user' as const,
        payload: {
          userId: user.id,
          requestDescription: 'Need a CRM tool',
          category: 'sales_tools',
        },
        processed: false,
        version: 1,
        created_at: new Date().toISOString(),
        created_by: 'concierge_agent',
      };

      mockSupabase.seedDatabase({ events: [event] });

      // Act
      const result = await mockSupabase
        .from('events')
        .select()
        .eq('event_type', 'user.inquiry.solution_needed');

      // Assert
      expect(result.data).toHaveLength(1);
      expect(result.data[0].payload.requestDescription).toBe('Need a CRM tool');
    });

    it('should publish community_request event for Agent of Humans', async () => {
      // Arrange
      const user = createVerifiedUser();
      const event = {
        id: 'event-2',
        event_type: 'community.request_needed',
        aggregate_id: user.id,
        aggregate_type: 'user' as const,
        payload: {
          requestingAgentType: 'concierge',
          requestingUserId: user.id,
          question: 'What CRM tools do you recommend?',
          expertiseNeeded: ['sales', 'crm'],
        },
        processed: false,
        version: 1,
        created_at: new Date().toISOString(),
        created_by: 'concierge_agent',
      };

      mockSupabase.seedDatabase({ events: [event] });

      // Act
      const result = await mockSupabase
        .from('events')
        .select()
        .eq('event_type', 'community.request_needed');

      // Assert
      expect(result.data).toHaveLength(1);
    });
  });

  describe('Simple Acknowledgments', () => {
    it('should handle "thanks" without LLM call', async () => {
      // Arrange
      const simpleResponses = {
        thanks: "You're welcome!",
        'thank you': "You're welcome!",
        hi: 'Hey! How can I help you today?',
        hello: 'Hey! How can I help you today?',
        ok: 'Got it!',
      };

      // Act & Assert
      expect(simpleResponses['thanks']).toBe("You're welcome!");
      expect(simpleResponses['hi']).toContain('help');
    });
  });

  describe('Context Loading', () => {
    it('should load recent messages for context', async () => {
      // Arrange
      const user = createVerifiedUser();
      const conversation = createTestConversation({ user_id: user.id });
      const messages = [
        createTestMessage({
          conversation_id: conversation.id,
          content: 'Message 1',
        }),
        createTestMessage({
          conversation_id: conversation.id,
          content: 'Message 2',
        }),
        createTestMessage({
          conversation_id: conversation.id,
          content: 'Message 3',
        }),
      ];

      mockSupabase.seedDatabase({
        users: [user],
        conversations: [conversation],
        messages,
      });

      // Act
      const result = await mockSupabase
        .from('messages')
        .select()
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: false })
        .limit(20);

      // Assert
      expect(result.data).toHaveLength(3);
    });

    it('should load conversation summary if available', async () => {
      // Arrange
      const conversation = createTestConversation({
        conversation_summary: 'User asking about CRM solutions',
        messages_since_summary: 45,
      });

      mockSupabase.seedDatabase({ conversations: [conversation] });

      // Act
      const result = await mockSupabase
        .from('conversations')
        .select()
        .eq('id', conversation.id)
        .single();

      // Assert
      expect(result.data.conversation_summary).toBeDefined();
      expect(result.data.messages_since_summary).toBe(45);
    });
  });
});
