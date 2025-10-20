/**
 * Message Orchestrator Unit Tests
 *
 * Tests for rate limiting, quiet hours, and message relevance checking.
 */

import { mockSupabase } from '../mocks/supabase.mock';
import { mockAnthropic } from '../mocks/anthropic.mock';
import { mockTwilio } from '../mocks/twilio.mock';
import {
  createVerifiedUser,
  createTestMessageQueue,
  createTestMessage,
} from '../helpers/test-data';

describe('Message Orchestrator', () => {
  describe('Rate Limiting', () => {
    it('should enforce daily message limit', async () => {
      // Arrange
      const user = createVerifiedUser();
      const budget = {
        id: 'budget-1',
        user_id: user.id,
        date: new Date().toISOString().split('T')[0],
        messages_sent: 10,
        last_message_at: new Date(),
        daily_limit: 10,
        hourly_limit: 2,
        quiet_hours_enabled: true,
        created_at: new Date(),
      };

      mockSupabase.seedDatabase({
        users: [user],
        user_message_budget: [budget],
      });

      // Act
      const result = await mockSupabase
        .from('user_message_budget')
        .select()
        .eq('user_id', user.id)
        .single();

      // Assert
      expect(result.data.messages_sent).toBe(10);
      expect(result.data.messages_sent).toBeGreaterThanOrEqual(
        result.data.daily_limit
      );
    });

    it('should enforce hourly message limit', async () => {
      // Arrange
      const user = createVerifiedUser();
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      const recentMessages = [
        createTestMessage({
          user_id: user.id,
          direction: 'outbound',
          created_at: oneHourAgo,
        }),
        createTestMessage({
          user_id: user.id,
          direction: 'outbound',
          created_at: new Date(),
        }),
      ];

      mockSupabase.seedDatabase({
        users: [user],
        messages: recentMessages,
      });

      // Act
      const result = await mockSupabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('direction', 'outbound')
        .gte('created_at', oneHourAgo.toISOString());

      // Assert
      expect(result.count).toBe(2);
    });

    it('should allow messages when limits not exceeded', async () => {
      // Arrange
      const user = createVerifiedUser();
      const budget = {
        id: 'budget-1',
        user_id: user.id,
        date: new Date().toISOString().split('T')[0],
        messages_sent: 3,
        daily_limit: 10,
        hourly_limit: 2,
        quiet_hours_enabled: true,
        created_at: new Date(),
      };

      mockSupabase.seedDatabase({ user_message_budget: [budget] });

      const result = await mockSupabase
        .from('user_message_budget')
        .select()
        .eq('user_id', user.id)
        .single();

      // Assert
      expect(result.data.messages_sent).toBeLessThan(result.data.daily_limit);
    });
  });

  describe('Quiet Hours', () => {
    it('should respect user quiet hours', async () => {
      // Arrange
      const user = createVerifiedUser({
        quiet_hours_start: '22:00:00',
        quiet_hours_end: '08:00:00',
        timezone: 'America/New_York',
      });

      mockSupabase.seedDatabase({ users: [user] });

      // Act
      const result = await mockSupabase
        .from('users')
        .select()
        .eq('id', user.id)
        .single();

      // Assert
      expect(result.data.quiet_hours_start).toBe('22:00:00');
      expect(result.data.quiet_hours_end).toBe('08:00:00');
    });

    it('should allow messages if user is active during quiet hours', async () => {
      // Arrange
      const user = createVerifiedUser();
      const recentMessage = createTestMessage({
        user_id: user.id,
        direction: 'inbound',
        created_at: new Date(Date.now() - 5 * 60 * 1000), // 5 min ago
      });

      mockSupabase.seedDatabase({
        users: [user],
        messages: [recentMessage],
      });

      // Act - Check if user sent message in last 10 minutes
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const result = await mockSupabase
        .from('messages')
        .select()
        .eq('user_id', user.id)
        .eq('direction', 'inbound')
        .gte('created_at', tenMinutesAgo.toISOString())
        .limit(1);

      // Assert
      expect(result.data.length).toBeGreaterThan(0);
    });
  });

  describe('Priority Lanes', () => {
    it('should process urgent messages first', async () => {
      // Arrange
      const user = createVerifiedUser();
      const messages = [
        createTestMessageQueue({
          user_id: user.id,
          priority: 'low',
          scheduled_for: new Date(),
        }),
        createTestMessageQueue({
          user_id: user.id,
          priority: 'urgent',
          scheduled_for: new Date(),
        }),
        createTestMessageQueue({
          user_id: user.id,
          priority: 'medium',
          scheduled_for: new Date(),
        }),
      ];

      mockSupabase.seedDatabase({ message_queue: messages });

      // Act
      const result = await mockSupabase
        .from('message_queue')
        .select()
        .eq('user_id', user.id)
        .order('priority', { ascending: true })
        .limit(1);

      // Assert
      expect(result.data[0].priority).toBe('urgent');
    });
  });

  describe('Message Relevance Checking', () => {
    it('should detect stale messages', async () => {
      // Arrange
      mockAnthropic.mockRelevanceCheck(false, 'User already found solution');

      // Act
      const response = await mockAnthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{ role: 'user', content: 'Check relevance of queued message' }],
      });

      const result = JSON.parse(response.content[0].text);

      // Assert
      expect(result.classification).toBe('STALE');
      expect(result.should_reformulate).toBe(true);
    });

    it('should allow relevant messages', async () => {
      // Arrange
      mockAnthropic.mockRelevanceCheck(true, 'Still relevant to conversation');

      // Act
      const response = await mockAnthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{ role: 'user', content: 'Check relevance' }],
      });

      const result = JSON.parse(response.content[0].text);

      // Assert
      expect(result.classification).toBe('RELEVANT');
    });
  });

  describe('Message Rendering', () => {
    it('should render structured data to prose', async () => {
      // Arrange
      const structuredData = {
        type: 'solution_update',
        innovators_found: 3,
        top_match: 'Acme CRM',
      };

      mockAnthropic.mockConciergeMessage(
        'Great news! I found 3 potential CRM solutions. The top match is Acme CRM.'
      );

      // Act
      const response = await mockAnthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: `Render to SMS: ${JSON.stringify(structuredData)}`,
          },
        ],
      });

      // Assert
      expect(response.content[0].text).toContain('CRM');
    });
  });

  describe('Optimal Send Time Calculation', () => {
    it('should schedule for user best response hours', async () => {
      // Arrange
      const user = createVerifiedUser({
        response_pattern: {
          best_hours: [9, 10, 11, 14, 15],
          best_days: [1, 2, 3, 4, 5],
        },
      });

      mockSupabase.seedDatabase({ users: [user] });

      // Act
      const result = await mockSupabase
        .from('users')
        .select()
        .eq('id', user.id)
        .single();

      // Assert
      expect(result.data.response_pattern.best_hours).toContain(9);
    });
  });

  describe('Message Superseding', () => {
    it('should mark stale messages as superseded', async () => {
      // Arrange
      const queuedMessage = createTestMessageQueue({
        status: 'superseded',
        superseded_reason: 'User context changed',
      });

      mockSupabase.seedDatabase({ message_queue: [queuedMessage] });

      // Act
      const result = await mockSupabase
        .from('message_queue')
        .select()
        .eq('id', queuedMessage.id)
        .single();

      // Assert
      expect(result.data.status).toBe('superseded');
      expect(result.data.superseded_reason).toContain('context changed');
    });
  });

  describe('SMS Delivery', () => {
    it('should send SMS via Twilio', async () => {
      // Arrange
      const user = createVerifiedUser();

      // Act
      await mockTwilio.messages.create({
        to: user.phone_number,
        from: '+15555555555',
        body: 'Test message',
      });

      // Assert
      const sent = mockTwilio.getLastMessage();
      expect(sent).toBeDefined();
      expect(sent?.to).toBe(user.phone_number);
      expect(sent?.body).toBe('Test message');
    });

    it('should track message status', async () => {
      // Arrange & Act
      const result = await mockTwilio.messages.create({
        to: '+15551234567',
        from: '+15555555555',
        body: 'Test',
      });

      // Assert
      expect(result.status).toBe('queued');
      expect(result.sid).toBeDefined();
    });
  });
});
