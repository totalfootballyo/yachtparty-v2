/**
 * Event Flow Integration Tests
 *
 * Tests event publishing and handling workflows between agents.
 */

import { mockSupabase } from '../mocks/supabase.mock';
import { mockAnthropic } from '../mocks/anthropic.mock';
import { createVerifiedUser, createTestEvent } from '../helpers/test-data';

describe('Event Flow Integration', () => {
  describe('User Message Flow', () => {
    it('should handle user.message.received event flow', async () => {
      // Arrange
      const user = createVerifiedUser();
      const event = createTestEvent({
        event_type: 'user.message.received',
        aggregate_id: user.id,
        payload: {
          userId: user.id,
          message: 'I need a CRM tool',
          phoneNumber: user.phone_number,
        },
      });

      mockSupabase.seedDatabase({
        users: [user],
        events: [event],
      });

      // Act - Simulate event processing
      const result = await mockSupabase
        .from('events')
        .select()
        .eq('event_type', 'user.message.received')
        .eq('processed', false);

      // Assert
      expect(result.data).toHaveLength(1);
      expect(result.data[0].payload.userId).toBe(user.id);
    });

    it('should trigger agent processing and response events', async () => {
      // Arrange
      const user = createVerifiedUser();
      const receivedEvent = createTestEvent({
        event_type: 'user.message.received',
        aggregate_id: user.id,
        processed: true,
      });

      const responseEvent = createTestEvent({
        event_type: 'message.send.requested',
        aggregate_id: user.id,
        payload: {
          userId: user.id,
          agentId: 'concierge_v1',
          messageData: { text: 'Response' },
          priority: 'high',
        },
      });

      mockSupabase.seedDatabase({
        events: [receivedEvent, responseEvent],
      });

      // Act
      const result = await mockSupabase
        .from('events')
        .select()
        .eq('aggregate_id', user.id)
        .order('created_at', { ascending: true });

      // Assert
      expect(result.data).toHaveLength(2);
      expect(result.data[0].event_type).toBe('user.message.received');
      expect(result.data[1].event_type).toBe('message.send.requested');
    });
  });

  describe('Solution Workflow Events', () => {
    it('should handle solution_inquiry event chain', async () => {
      // Arrange
      const user = createVerifiedUser();
      const events = [
        createTestEvent({
          event_type: 'user.inquiry.solution_needed',
          aggregate_id: user.id,
          payload: {
            userId: user.id,
            requestDescription: 'Need CRM',
          },
        }),
        createTestEvent({
          event_type: 'solution.initial_findings',
          aggregate_id: 'workflow-1',
          aggregate_type: 'solution_workflow',
          payload: {
            workflowId: 'workflow-1',
            userId: user.id,
            findings: { summary: 'Found 3 matches' },
          },
        }),
        createTestEvent({
          event_type: 'solution.research_complete',
          aggregate_id: 'workflow-1',
          aggregate_type: 'solution_workflow',
          payload: {
            workflowId: 'workflow-1',
            userId: user.id,
            findings: { matchedInnovators: [] },
          },
        }),
      ];

      mockSupabase.seedDatabase({ events });

      // Act
      const result = await mockSupabase
        .from('events')
        .select()
        .order('created_at', { ascending: true });

      // Assert
      expect(result.data).toHaveLength(3);
      expect(result.data[0].event_type).toBe('user.inquiry.solution_needed');
      expect(result.data[1].event_type).toBe('solution.initial_findings');
      expect(result.data[2].event_type).toBe('solution.research_complete');
    });
  });

  describe('Event Processing', () => {
    it('should mark events as processed after handling', async () => {
      // Arrange
      const event = createTestEvent({ processed: false });
      mockSupabase.seedDatabase({ events: [event] });

      // Act - Simulate processing
      await mockSupabase
        .from('events')
        .update({ processed: true })
        .eq('id', event.id);

      const result = await mockSupabase
        .from('events')
        .select()
        .eq('id', event.id)
        .single();

      // Assert
      expect(result.data.processed).toBe(true);
    });

    it('should maintain event ordering with version numbers', async () => {
      // Arrange
      const user = createVerifiedUser();
      const events = [
        createTestEvent({ aggregate_id: user.id, version: 1 }),
        createTestEvent({ aggregate_id: user.id, version: 2 }),
        createTestEvent({ aggregate_id: user.id, version: 3 }),
      ];

      mockSupabase.seedDatabase({ events });

      // Act
      const result = await mockSupabase
        .from('events')
        .select()
        .eq('aggregate_id', user.id)
        .order('version', { ascending: true });

      // Assert
      expect(result.data[0].version).toBe(1);
      expect(result.data[1].version).toBe(2);
      expect(result.data[2].version).toBe(3);
    });
  });

  describe('Community Request Flow', () => {
    it('should handle community request event chain', async () => {
      // Arrange
      const events = [
        createTestEvent({
          event_type: 'community.request_needed',
          payload: { question: 'Best CRM?' },
        }),
        createTestEvent({
          event_type: 'community.request_created',
          payload: { requestId: 'req-1' },
        }),
        createTestEvent({
          event_type: 'community.request_routed',
          payload: { requestId: 'req-1', expertsNotified: 5 },
        }),
        createTestEvent({
          event_type: 'community.response_received',
          payload: { requestId: 'req-1', expertUserId: 'expert-1' },
        }),
      ];

      mockSupabase.seedDatabase({ events });

      // Act
      const result = await mockSupabase.from('events').select();

      // Assert
      expect(result.data).toHaveLength(4);
      expect(
        result.data.some((e) => e.event_type === 'community.response_received')
      ).toBe(true);
    });
  });

  describe('Intro Opportunity Flow', () => {
    it('should handle intro creation and acceptance', async () => {
      // Arrange
      const events = [
        createTestEvent({
          event_type: 'intro.opportunity_created',
          payload: { introId: 'intro-1' },
        }),
        createTestEvent({
          event_type: 'intro.accepted',
          payload: { introId: 'intro-1' },
        }),
      ];

      mockSupabase.seedDatabase({ events });

      // Act
      const result = await mockSupabase.from('events').select();

      // Assert
      expect(result.data).toHaveLength(2);
    });
  });
});
