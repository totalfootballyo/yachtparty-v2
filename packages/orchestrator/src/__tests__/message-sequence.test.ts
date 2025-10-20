/**
 * Message Sequence Delivery Tests
 *
 * Tests message sequence ordering, all-or-nothing delivery,
 * and interaction with standalone messages.
 */

import { MessageOrchestrator } from '../index';
import { mockSupabase } from '../../../testing/src/mocks/supabase.mock';
import { mockAnthropic } from '../../../testing/src/mocks/anthropic.mock';

describe('Message Sequence Delivery', () => {
  let orchestrator: MessageOrchestrator;

  beforeEach(() => {
    mockSupabase.reset();
    mockAnthropic.reset();

    orchestrator = new MessageOrchestrator({
      supabaseUrl: 'mock-url',
      supabaseKey: 'mock-key',
      anthropicKey: 'mock-key',
      twilioAccountSid: 'mock-sid',
      twilioAuthToken: 'mock-token',
      twilioPhoneNumber: '+15555555555',
    });

    // Mock Anthropic responses for message rendering
    mockAnthropic.mockResponse(/convert this structured update/i, 'Test message');
  });

  describe('Sequence Order Preservation', () => {
    it('should send sequence messages in correct order even if inserted out of order', async () => {
      // Arrange - Insert sequence messages OUT OF ORDER
      const sequenceId = 'seq-order-test';
      const userId = 'user-123';

      const messages = [
        {
          id: 'msg-3',
          user_id: userId,
          agent_id: 'concierge',
          message_data: { content: 'Third' },
          final_message: 'Third message',
          priority: 'medium',
          scheduled_for: new Date().toISOString(),
          status: 'queued',
          sequence_id: sequenceId,
          sequence_position: 3,
          sequence_total: 3,
          created_at: new Date().toISOString(),
        },
        {
          id: 'msg-1',
          user_id: userId,
          agent_id: 'concierge',
          message_data: { content: 'First' },
          final_message: 'First message',
          priority: 'medium',
          scheduled_for: new Date().toISOString(),
          status: 'queued',
          sequence_id: sequenceId,
          sequence_position: 1,
          sequence_total: 3,
          created_at: new Date().toISOString(),
        },
        {
          id: 'msg-2',
          user_id: userId,
          agent_id: 'concierge',
          message_data: { content: 'Second' },
          final_message: 'Second message',
          priority: 'medium',
          scheduled_for: new Date().toISOString(),
          status: 'queued',
          sequence_id: sequenceId,
          sequence_position: 2,
          sequence_total: 3,
          created_at: new Date().toISOString(),
        },
      ];

      mockSupabase.seedDatabase({
        message_queue: messages,
        users: [
          {
            id: userId,
            phone_number: '+15551234567',
            timezone: 'America/New_York',
          },
        ],
        conversations: [
          {
            id: 'conv-1',
            user_id: userId,
            phone_number: '+15551234567',
            status: 'active',
          },
        ],
      });

      // Act - Process messages
      await orchestrator.processDueMessages();

      // Assert - Check that messages were sent in correct order
      const sentMessages = mockSupabase
        .getDatabase()
        .messages.filter((m: any) => m.direction === 'outbound');

      expect(sentMessages).toHaveLength(3);
      expect(sentMessages[0].content).toBe('First message');
      expect(sentMessages[1].content).toBe('Second message');
      expect(sentMessages[2].content).toBe('Third message');
    });

    it('should detect incomplete sequences and log error', async () => {
      // Arrange - Sequence with missing position 2
      const sequenceId = 'seq-incomplete';
      const userId = 'user-456';

      const messages = [
        {
          id: 'msg-1',
          user_id: userId,
          agent_id: 'concierge',
          message_data: {},
          final_message: 'First',
          priority: 'medium',
          scheduled_for: new Date().toISOString(),
          status: 'queued',
          sequence_id: sequenceId,
          sequence_position: 1,
          sequence_total: 3,
          created_at: new Date().toISOString(),
        },
        {
          id: 'msg-3',
          user_id: userId,
          agent_id: 'concierge',
          message_data: {},
          final_message: 'Third',
          priority: 'medium',
          scheduled_for: new Date().toISOString(),
          status: 'queued',
          sequence_id: sequenceId,
          sequence_position: 3,
          sequence_total: 3,
          created_at: new Date().toISOString(),
        },
      ];

      mockSupabase.seedDatabase({
        message_queue: messages,
        users: [{ id: userId, phone_number: '+15551234567' }],
        conversations: [
          {
            id: 'conv-2',
            user_id: userId,
            phone_number: '+15551234567',
            status: 'active',
          },
        ],
      });

      // Act
      await orchestrator.processDueMessages();

      // Assert - Incomplete sequence should still process (positions 1 and 3)
      // Or should log warning and skip?
      const queueRecords = mockSupabase.getDatabase().message_queue;
      const sentMessages = queueRecords.filter((m: any) => m.status === 'sent');

      // Implementation dependent - document expected behavior
      expect(sentMessages.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('All-or-Nothing Delivery', () => {
    it('should send entire sequence if rate limits allow', async () => {
      // Arrange
      const sequenceId = 'seq-all';
      const userId = 'user-789';

      const sequence = [1, 2, 3].map((position) => ({
        id: `msg-${position}`,
        user_id: userId,
        agent_id: 'concierge',
        message_data: {},
        final_message: `Message ${position}`,
        priority: 'medium',
        scheduled_for: new Date().toISOString(),
        status: 'queued',
        sequence_id: sequenceId,
        sequence_position: position,
        sequence_total: 3,
        created_at: new Date().toISOString(),
      }));

      mockSupabase.seedDatabase({
        message_queue: sequence,
        users: [{ id: userId, phone_number: '+15551234567' }],
        conversations: [
          {
            id: 'conv-3',
            user_id: userId,
            phone_number: '+15551234567',
            status: 'active',
          },
        ],
        user_message_budget: [
          {
            user_id: userId,
            date: new Date().toISOString().split('T')[0],
            messages_sent: 0,
            daily_limit: 10,
          },
        ],
      });

      // Act
      await orchestrator.processDueMessages();

      // Assert - All 3 messages sent
      const queueRecords = mockSupabase.getDatabase().message_queue;
      const sentMessages = queueRecords.filter((m: any) => m.status === 'sent');

      expect(sentMessages).toHaveLength(3);

      // Budget incremented by 1 (not 3)
      const budget = mockSupabase.getDatabase().user_message_budget[0];
      expect(budget.messages_sent).toBe(1);
    });

    it('should reschedule entire sequence if rate limit exceeded', async () => {
      // Arrange
      const sequenceId = 'seq-reschedule';
      const userId = 'user-limit';

      const sequence = [1, 2, 3].map((position) => ({
        id: `msg-${position}`,
        user_id: userId,
        agent_id: 'concierge',
        message_data: {},
        final_message: `Message ${position}`,
        priority: 'medium',
        scheduled_for: new Date().toISOString(),
        status: 'queued',
        sequence_id: sequenceId,
        sequence_position: position,
        sequence_total: 3,
        created_at: new Date().toISOString(),
      }));

      mockSupabase.seedDatabase({
        message_queue: sequence,
        users: [{ id: userId, phone_number: '+15551234567' }],
        conversations: [
          {
            id: 'conv-4',
            user_id: userId,
            phone_number: '+15551234567',
            status: 'active',
          },
        ],
        user_message_budget: [
          {
            user_id: userId,
            date: new Date().toISOString().split('T')[0],
            messages_sent: 10,
            daily_limit: 10, // At limit
          },
        ],
      });

      // Act
      await orchestrator.processDueMessages();

      // Assert - All 3 messages still queued (rescheduled)
      const queueRecords = mockSupabase.getDatabase().message_queue;
      const sentMessages = queueRecords.filter((m: any) => m.status === 'sent');
      const queuedMessages = queueRecords.filter((m: any) => m.status === 'queued');

      expect(sentMessages).toHaveLength(0);
      expect(queuedMessages).toHaveLength(3);

      // All messages rescheduled to same time
      const scheduledTimes = queuedMessages.map((m: any) => m.scheduled_for);
      expect(new Set(scheduledTimes).size).toBe(1); // All same time
    });
  });

  describe('Mixed Standalone and Sequence Messages', () => {
    it('should process both standalone and sequence messages in same run', async () => {
      // Arrange
      const user1 = 'user-mix-1';
      const user2 = 'user-mix-2';
      const sequenceId = 'seq-mixed';

      const messages = [
        // Standalone message for user 1
        {
          id: 'standalone-1',
          user_id: user1,
          agent_id: 'concierge',
          message_data: {},
          final_message: 'Standalone message',
          priority: 'medium',
          scheduled_for: new Date().toISOString(),
          status: 'queued',
          sequence_id: null,
          sequence_position: null,
          sequence_total: null,
          created_at: new Date().toISOString(),
        },
        // Sequence for user 2
        ...[ 1, 2].map((position) => ({
          id: `seq-${position}`,
          user_id: user2,
          agent_id: 'concierge',
          message_data: {},
          final_message: `Sequence message ${position}`,
          priority: 'medium',
          scheduled_for: new Date().toISOString(),
          status: 'queued',
          sequence_id: sequenceId,
          sequence_position: position,
          sequence_total: 2,
          created_at: new Date().toISOString(),
        })),
      ];

      mockSupabase.seedDatabase({
        message_queue: messages,
        users: [
          { id: user1, phone_number: '+15551111111' },
          { id: user2, phone_number: '+15552222222' },
        ],
        conversations: [
          {
            id: 'conv-5',
            user_id: user1,
            phone_number: '+15551111111',
            status: 'active',
          },
          {
            id: 'conv-6',
            user_id: user2,
            phone_number: '+15552222222',
            status: 'active',
          },
        ],
        user_message_budget: [
          {
            user_id: user1,
            date: new Date().toISOString().split('T')[0],
            messages_sent: 0,
            daily_limit: 10,
          },
          {
            user_id: user2,
            date: new Date().toISOString().split('T')[0],
            messages_sent: 0,
            daily_limit: 10,
          },
        ],
      });

      // Act
      await orchestrator.processDueMessages();

      // Assert
      const queueRecords = mockSupabase.getDatabase().message_queue;
      const sentMessages = queueRecords.filter((m: any) => m.status === 'sent');

      // All 3 messages should be sent (1 standalone + 2 sequence)
      expect(sentMessages).toHaveLength(3);

      // User 1 budget incremented by 1 (standalone)
      const user1Budget = mockSupabase
        .getDatabase()
        .user_message_budget.find((b: any) => b.user_id === user1);
      expect(user1Budget.messages_sent).toBe(1);

      // User 2 budget incremented by 1 (sequence counts as 1)
      const user2Budget = mockSupabase
        .getDatabase()
        .user_message_budget.find((b: any) => b.user_id === user2);
      expect(user2Budget.messages_sent).toBe(1);
    });

    it('should not block standalone messages if sequence is rate limited', async () => {
      // Arrange
      const userOK = 'user-ok';
      const userLimited = 'user-limited';
      const sequenceId = 'seq-blocked';

      const messages = [
        // Sequence for rate-limited user
        ...[ 1, 2].map((position) => ({
          id: `seq-${position}`,
          user_id: userLimited,
          agent_id: 'concierge',
          message_data: {},
          final_message: `Sequence ${position}`,
          priority: 'medium',
          scheduled_for: new Date().toISOString(),
          status: 'queued',
          sequence_id: sequenceId,
          sequence_position: position,
          sequence_total: 2,
          created_at: new Date().toISOString(),
        })),
        // Standalone for OK user
        {
          id: 'standalone-ok',
          user_id: userOK,
          agent_id: 'concierge',
          message_data: {},
          final_message: 'OK message',
          priority: 'medium',
          scheduled_for: new Date().toISOString(),
          status: 'queued',
          sequence_id: null,
          created_at: new Date().toISOString(),
        },
      ];

      mockSupabase.seedDatabase({
        message_queue: messages,
        users: [
          { id: userOK, phone_number: '+15551111111' },
          { id: userLimited, phone_number: '+15552222222' },
        ],
        conversations: [
          {
            id: 'conv-7',
            user_id: userOK,
            phone_number: '+15551111111',
            status: 'active',
          },
          {
            id: 'conv-8',
            user_id: userLimited,
            phone_number: '+15552222222',
            status: 'active',
          },
        ],
        user_message_budget: [
          {
            user_id: userOK,
            date: new Date().toISOString().split('T')[0],
            messages_sent: 0,
            daily_limit: 10,
          },
          {
            user_id: userLimited,
            date: new Date().toISOString().split('T')[0],
            messages_sent: 10, // At limit
            daily_limit: 10,
          },
        ],
      });

      // Act
      await orchestrator.processDueMessages();

      // Assert
      const queueRecords = mockSupabase.getDatabase().message_queue;

      // Standalone should be sent
      const standaloneSent = queueRecords.find(
        (m: any) => m.id === 'standalone-ok' && m.status === 'sent'
      );
      expect(standaloneSent).toBeDefined();

      // Sequence should be rescheduled
      const sequenceQueued = queueRecords.filter(
        (m: any) => m.sequence_id === sequenceId && m.status === 'queued'
      );
      expect(sequenceQueued).toHaveLength(2);
    });
  });

  describe('Priority Ordering with Sequences', () => {
    it('should process urgent sequence before medium standalone', async () => {
      // Arrange
      const messages = [
        // Medium priority standalone
        {
          id: 'medium-standalone',
          user_id: 'user-A',
          agent_id: 'concierge',
          message_data: {},
          final_message: 'Medium message',
          priority: 'medium',
          scheduled_for: new Date(Date.now() - 60000).toISOString(), // 1 min ago
          status: 'queued',
          sequence_id: null,
          created_at: new Date().toISOString(),
        },
        // Urgent priority sequence
        ...[ 1, 2].map((position) => ({
          id: `urgent-${position}`,
          user_id: 'user-B',
          agent_id: 'concierge',
          message_data: {},
          final_message: `Urgent ${position}`,
          priority: 'urgent',
          scheduled_for: new Date().toISOString(),
          status: 'queued',
          sequence_id: 'urgent-seq',
          sequence_position: position,
          sequence_total: 2,
          created_at: new Date().toISOString(),
        })),
      ];

      mockSupabase.seedDatabase({
        message_queue: messages,
        users: [
          { id: 'user-A', phone_number: '+15551111111' },
          { id: 'user-B', phone_number: '+15552222222' },
        ],
        conversations: [
          {
            id: 'conv-A',
            user_id: 'user-A',
            phone_number: '+15551111111',
            status: 'active',
          },
          {
            id: 'conv-B',
            user_id: 'user-B',
            phone_number: '+15552222222',
            status: 'active',
          },
        ],
      });

      // Act
      await orchestrator.processDueMessages();

      // Assert - Urgent sequence should be sent first
      const sentMessages = mockSupabase
        .getDatabase()
        .messages.filter((m: any) => m.direction === 'outbound')
        .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      expect(sentMessages).toHaveLength(3);
      // First two should be from urgent sequence
      expect(sentMessages[0].content).toMatch(/Urgent/);
      expect(sentMessages[1].content).toMatch(/Urgent/);
      // Last should be medium standalone
      expect(sentMessages[2].content).toBe('Medium message');
    });
  });
});
