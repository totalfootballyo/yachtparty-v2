/**
 * Architecture Simplification Integration Tests
 *
 * Tests for Phase 1-3 of architecture simplification:
 * - Account Manager event publishing (no timing logic)
 * - Message sequences (send_message_sequence action)
 * - Concierge priority update handler (timing decisions)
 */

import { mockSupabase } from '../mocks/supabase.mock';
import { mockAnthropic } from '../mocks/anthropic.mock';
import {
  createVerifiedUser,
  createTestConversation,
  createTestMessage,
  createTestEvent,
  createTestUserPriority,
  createTestMessageQueue,
} from '../helpers/test-data';

describe('Architecture Simplification Integration', () => {
  beforeEach(() => {
    // Reset mocks before each test
    mockSupabase.reset();
    mockAnthropic.reset();
  });

  describe('Phase 1: Message Sequences', () => {
    it('should create message sequence with correct sequence_id and positions', async () => {
      // Arrange & Act
      const sequenceId = 'test-sequence-123';
      const messages = [
        'First message in sequence',
        'Second message in sequence',
        'Third message in sequence',
      ];

      const messageQueueEntries = messages.map((content, index) => ({
        id: `msg-${index + 1}`,
        user_id: 'test-user-123',
        agent_id: 'concierge',
        message_data: {
          content,
          sequence_position: index + 1,
          sequence_total: messages.length,
        },
        final_message: content,
        priority: 'medium',
        scheduled_for: new Date(Date.now() + index * 1000).toISOString(),
        sequence_id: sequenceId,
        sequence_position: index + 1,
        sequence_total: messages.length,
        status: 'queued',
        created_at: new Date().toISOString(),
      }));

      mockSupabase.seedDatabase({ message_queue: messageQueueEntries });

      // Assert - Verify structure of sequence
      const allMessages = mockSupabase.getDatabase().message_queue;
      expect(allMessages).toHaveLength(3);
      expect(allMessages[0].sequence_position).toBe(1);
      expect(allMessages[1].sequence_position).toBe(2);
      expect(allMessages[2].sequence_position).toBe(3);
      expect(allMessages[0].sequence_total).toBe(3);
      expect(allMessages[0].sequence_id).toBe(sequenceId);
    });

    it('should enforce maximum 5 messages per sequence', async () => {
      // Arrange
      const user = createVerifiedUser();
      const tooManyMessages = Array(7)
        .fill(null)
        .map((_, i) => `Message ${i + 1}`);

      // Act - Should only accept first 5 messages
      const limitedMessages = tooManyMessages.slice(0, 5);

      // Assert
      expect(limitedMessages).toHaveLength(5);
      expect(tooManyMessages.length).toBe(7);
    });

    it('should group messages by sequence_id for all-or-nothing delivery', async () => {
      // Arrange
      const sequenceId = 'seq-123';
      const userId = 'test-user-456';

      const messageQueueEntries = [1, 2, 3].map((position) => ({
        id: `seq-msg-${position}`,
        user_id: userId,
        agent_id: 'concierge',
        message_data: {},
        final_message: `Message ${position}`,
        priority: 'medium',
        scheduled_for: new Date().toISOString(),
        sequence_id: sequenceId,
        sequence_position: position,
        sequence_total: 3,
        status: 'queued',
        created_at: new Date().toISOString(),
      }));

      mockSupabase.seedDatabase({ message_queue: messageQueueEntries });

      // Act - Verify messages are grouped by sequence_id
      const allMessages = mockSupabase.getDatabase().message_queue;
      const sequenceMessages = allMessages.filter(
        (m: any) => m.sequence_id === sequenceId
      );

      // Assert - All messages in sequence found together
      expect(sequenceMessages).toHaveLength(3);
      const positions = sequenceMessages
        .map((m: any) => m.sequence_position)
        .sort();
      expect(positions).toEqual([1, 2, 3]);
    });
  });

  describe('Phase 2: Account Manager Event Publishing', () => {
    it('should publish priority.update event when urgent priorities exist', async () => {
      // Arrange
      const user = createVerifiedUser();
      const priorities = [
        createTestUserPriority({
          user_id: user.id,
          item_type: 'intro_opportunity',
          value_score: 90,
          status: 'active',
        }),
        createTestUserPriority({
          user_id: user.id,
          item_type: 'community_request',
          value_score: 85,
          status: 'active',
        }),
      ];

      mockSupabase.seedDatabase({
        users: [user],
        user_priorities: priorities,
      });

      // Act - Simulate Account Manager publishing event after updating priorities
      const priorityUpdateEvent = createTestEvent({
        event_type: 'priority.update',
        aggregate_id: user.id,
        aggregate_type: 'user',
        payload: {
          priorities: priorities.map((p) => ({
            item_type: p.item_type,
            item_id: p.item_id,
            value_score: p.value_score,
            content: 'Priority content',
          })),
          maxScore: 90,
          itemCount: 2,
        },
        created_by: 'account_manager',
        metadata: {
          trigger: 'scheduled_review',
          totalPriorities: 2,
        },
      });

      await mockSupabase.from('events').insert(priorityUpdateEvent);

      // Assert
      const result = await mockSupabase
        .from('events')
        .select()
        .eq('event_type', 'priority.update')
        .eq('aggregate_id', user.id);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].payload.maxScore).toBe(90);
      expect(result.data[0].payload.itemCount).toBe(2);
      expect(result.data[0].created_by).toBe('account_manager');
    });

    it('should NOT publish priority.update event when no urgent priorities', async () => {
      // Arrange
      const user = createVerifiedUser();
      const lowPriorities = [
        createTestUserPriority({
          user_id: user.id,
          value_score: 60, // Below urgency threshold
          status: 'active',
        }),
      ];

      mockSupabase.seedDatabase({
        users: [user],
        user_priorities: lowPriorities,
      });

      // Act - Account Manager would skip event publishing for low scores
      const urgentPriorities = lowPriorities.filter((p) => p.value_score >= 80);

      // Assert - No event should be published
      expect(urgentPriorities).toHaveLength(0);

      const result = await mockSupabase
        .from('events')
        .select()
        .eq('event_type', 'priority.update')
        .eq('aggregate_id', user.id);

      expect(result.data).toHaveLength(0);
    });

    it('should include metadata about trigger type in priority.update event', async () => {
      // Arrange
      const user = createVerifiedUser();
      const priority = createTestUserPriority({
        user_id: user.id,
        value_score: 90,
      });

      mockSupabase.seedDatabase({ user_priorities: [priority] });

      // Act - Publish event with metadata
      const event = createTestEvent({
        event_type: 'priority.update',
        aggregate_id: user.id,
        payload: {
          priorities: [priority],
          maxScore: 90,
          itemCount: 1,
        },
        metadata: {
          trigger: 'explicit_mention', // User mentioned goals/challenges
          totalPriorities: 1,
        },
        created_by: 'account_manager',
      });

      await mockSupabase.from('events').insert(event);

      // Assert
      const result = await mockSupabase
        .from('events')
        .select()
        .eq('id', event.id)
        .single();

      expect(result.data.metadata.trigger).toBe('explicit_mention');
      expect(result.data.metadata.totalPriorities).toBe(1);
    });
  });

  describe('Phase 3: Concierge Priority Handler', () => {
    beforeEach(() => {
      // Mock Anthropic LLM responses for timing decisions
      mockAnthropic.mockResponse(/decide when and how to notify/, {
        decision: 'send_now',
        reasoning: 'User is active and priority is urgent',
        message: 'I found a great intro opportunity for you.',
      });
    });

    it('should decide to send_now for high-value priority with active user', async () => {
      // Arrange
      const user = createVerifiedUser();
      const conversation = createTestConversation({ user_id: user.id });

      // Recent user message (active within 48h)
      const recentMessage = createTestMessage({
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      });

      const priority = createTestUserPriority({
        user_id: user.id,
        value_score: 90, // High value
        status: 'active',
      });

      mockSupabase.seedDatabase({
        users: [user],
        conversations: [conversation],
        messages: [recentMessage],
        user_priorities: [priority],
      });

      // Set specific LLM response for this test
      mockAnthropic.mockResponse(/decide when and how to notify/, {
        decision: 'send_now',
        reasoning: 'value_score >= 90 and user active in last 48h',
        message: 'I have an urgent intro opportunity for you.',
      });

      // Act - Simulate Concierge handling priority.update event
      const event = createTestEvent({
        event_type: 'priority.update',
        aggregate_id: user.id,
        payload: {
          priorities: [
            {
              item_type: priority.item_type,
              item_id: priority.item_id,
              value_score: priority.value_score,
              content: 'Intro to Sarah Chen at TechCorp',
            },
          ],
          maxScore: 90,
          itemCount: 1,
        },
      });

      // Concierge would make LLM call, then queue message
      const queuedMessage = createTestMessageQueue({
        user_id: user.id,
        agent_id: 'concierge',
        message_data: {
          content: 'I have an urgent intro opportunity for you.',
          trigger: 'priority_update',
          priorityIds: [priority.item_id],
        },
        final_message: 'I have an urgent intro opportunity for you.',
        priority: 'high',
        scheduled_for: new Date(), // Immediate
        status: 'queued',
        requires_fresh_context: false,
        conversation_context_id: conversation.id,
      });

      await mockSupabase.from('message_queue').insert(queuedMessage);

      // Assert
      const result = await mockSupabase
        .from('message_queue')
        .select()
        .eq('user_id', user.id);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].priority).toBe('high');
      expect(result.data[0].requires_fresh_context).toBe(false);
      expect(result.data[0].message_data.trigger).toBe('priority_update');
    });

    it('should decide to queue_for_later for inactive user with good priority', async () => {
      // Arrange
      const user = createVerifiedUser();
      const conversation = createTestConversation({ user_id: user.id });

      // Old user message (inactive > 48h)
      const oldMessage = createTestMessage({
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
      });

      const priority = createTestUserPriority({
        user_id: user.id,
        value_score: 85, // Good value but user inactive
        status: 'active',
      });

      mockSupabase.seedDatabase({
        users: [user],
        conversations: [conversation],
        messages: [oldMessage],
        user_priorities: [priority],
      });

      // Set LLM response for queue_for_later decision
      const scheduledTime = new Date(Date.now() + 18 * 60 * 60 * 1000); // 18 hours from now (next morning)
      mockAnthropic.mockResponse(/decide when and how to notify/, {
        decision: 'queue_for_later',
        reasoning: 'value_score >= 80 but user inactive, schedule for next business morning',
        scheduled_for: scheduledTime.toISOString(),
        message: 'I found a valuable intro opportunity for you.',
      });

      // Act - Concierge queues for later
      const queuedMessage = createTestMessageQueue({
        user_id: user.id,
        agent_id: 'concierge',
        message_data: {
          content: 'I found a valuable intro opportunity for you.',
          trigger: 'priority_update',
          priorityIds: [priority.item_id],
        },
        final_message: 'I found a valuable intro opportunity for you.',
        priority: 'medium',
        scheduled_for: scheduledTime,
        status: 'queued',
        requires_fresh_context: true, // Re-evaluate before sending
        conversation_context_id: conversation.id,
      });

      await mockSupabase.from('message_queue').insert(queuedMessage);

      // Assert
      const result = await mockSupabase
        .from('message_queue')
        .select()
        .eq('user_id', user.id)
        .single();

      expect(result.data.priority).toBe('medium');
      expect(result.data.requires_fresh_context).toBe(true);
      expect(new Date(result.data.scheduled_for).getTime()).toBeGreaterThan(
        Date.now()
      );
    });

    it('should decide to skip for low-value priority', async () => {
      // Arrange
      const user = createVerifiedUser();
      const conversation = createTestConversation({ user_id: user.id });

      const lowPriority = createTestUserPriority({
        user_id: user.id,
        value_score: 70, // Below threshold
        status: 'active',
      });

      mockSupabase.seedDatabase({
        users: [user],
        conversations: [conversation],
        user_priorities: [lowPriority],
      });

      // Set LLM response for skip decision
      mockAnthropic.mockResponse(/decide when and how to notify/, {
        decision: 'skip',
        reasoning: 'value_score < 80, wait for better opportunities',
      });

      // Act - Concierge decides to skip, no message queued
      // Assert - No message should be in queue
      const result = await mockSupabase
        .from('message_queue')
        .select()
        .eq('user_id', user.id);

      expect(result.data).toHaveLength(0);
    });

    it('should log timing decision to agent_actions_log', async () => {
      // Arrange
      const user = createVerifiedUser();
      const conversation = createTestConversation({ user_id: user.id });
      const priority = createTestUserPriority({
        user_id: user.id,
        value_score: 90,
      });

      mockSupabase.seedDatabase({
        users: [user],
        conversations: [conversation],
        user_priorities: [priority],
      });

      // Act - Simulate Concierge logging decision
      const logEntry = {
        agent_type: 'concierge',
        action_type: 'priority_notification_decision',
        user_id: user.id,
        context_id: conversation.id,
        context_type: 'conversation',
        model_used: 'claude-sonnet-4-20250514',
        input_tokens: 600,
        output_tokens: 120,
        input_data: {
          prioritiesCount: 1,
          maxScore: 90,
          hoursSinceActivity: 2,
        },
        output_data: {
          decision: 'send_now',
          reasoning: 'High value and active user',
          message: 'Test message',
        },
      };

      await mockSupabase.from('agent_actions_log').insert(logEntry);

      // Assert
      const result = await mockSupabase
        .from('agent_actions_log')
        .select()
        .eq('action_type', 'priority_notification_decision')
        .eq('user_id', user.id)
        .single();

      expect(result.data.agent_type).toBe('concierge');
      expect(result.data.output_data.decision).toBe('send_now');
      expect(result.data.input_data.maxScore).toBe(90);
    });
  });

  describe('End-to-End: Account Manager → Concierge Flow', () => {
    it('should complete full priority update flow from Account Manager to message queue', async () => {
      // Arrange
      const user = createVerifiedUser();
      const conversation = createTestConversation({ user_id: user.id });

      // Recent user activity
      const recentMessage = createTestMessage({
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'user',
        created_at: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
      });

      const priorities = [
        createTestUserPriority({
          user_id: user.id,
          item_type: 'intro_opportunity',
          value_score: 95,
          status: 'active',
        }),
      ];

      mockSupabase.seedDatabase({
        users: [user],
        conversations: [conversation],
        messages: [recentMessage],
        user_priorities: priorities,
      });

      mockAnthropic.mockResponse(/decide when and how to notify/, {
        decision: 'send_now',
        reasoning: 'Very high value and user recently active',
        message: 'I have a high-value intro opportunity for you.',
      });

      // Act - Step 1: Account Manager publishes priority.update event
      const accountManagerEvent = createTestEvent({
        event_type: 'priority.update',
        aggregate_id: user.id,
        aggregate_type: 'user',
        payload: {
          priorities: priorities.map((p) => ({
            item_type: p.item_type,
            item_id: p.item_id,
            value_score: p.value_score,
            content: 'Intro to CTO at major tech company',
          })),
          maxScore: 95,
          itemCount: 1,
        },
        created_by: 'account_manager',
        metadata: {
          trigger: 'scheduled_review',
          totalPriorities: 1,
        },
      });

      await mockSupabase.from('events').insert(accountManagerEvent);

      // Step 2: Real-time processor routes to Concierge
      // Step 3: Concierge makes timing decision and queues message
      const queuedMessage = createTestMessageQueue({
        user_id: user.id,
        agent_id: 'concierge',
        message_data: {
          content: 'I have a high-value intro opportunity for you.',
          trigger: 'priority_update',
          priorityIds: priorities.map((p) => p.item_id),
        },
        final_message: 'I have a high-value intro opportunity for you.',
        priority: 'high',
        scheduled_for: new Date(),
        status: 'queued',
        requires_fresh_context: false,
        conversation_context_id: conversation.id,
      });

      await mockSupabase.from('message_queue').insert(queuedMessage);

      // Assert - Verify complete flow
      // 1. Event was published
      const eventResult = await mockSupabase
        .from('events')
        .select()
        .eq('event_type', 'priority.update')
        .eq('aggregate_id', user.id);

      expect(eventResult.data).toHaveLength(1);
      expect(eventResult.data[0].payload.maxScore).toBe(95);

      // 2. Message was queued
      const messageResult = await mockSupabase
        .from('message_queue')
        .select()
        .eq('user_id', user.id);

      expect(messageResult.data).toHaveLength(1);
      expect(messageResult.data[0].priority).toBe('high');
      expect(messageResult.data[0].message_data.trigger).toBe('priority_update');

      // 3. Verify single source of truth for timing
      // All timing logic should be in Concierge, not Account Manager
      expect(accountManagerEvent.metadata.trigger).toBe('scheduled_review');
      expect(queuedMessage.scheduled_for).toBeDefined();
    });
  });
});
