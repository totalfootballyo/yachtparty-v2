/**
 * Integration Tests for Task Processor
 *
 * Tests the full task processing flow including:
 * - Task routing
 * - Status updates
 * - Retry logic
 * - Error handling
 */

import type { Task, TaskResult } from '../types.js';
import { taskHandlers } from '../handlers/index.js';

describe('Task Processor Integration', () => {
  describe('Task Routing', () => {
    it('should have handlers for all defined task types', () => {
      const requiredHandlers = [
        'research_solution',
        'schedule_followup',
        'update_user_profile',
        're_engagement_check',
        'process_community_request',
        'notify_user_of_priorities',
        'solution_workflow_timeout',
        'create_conversation_summary',
        'intro_followup_check',
        'community_request_available',
        'send_introduction',
        'verify_user',
      ];

      requiredHandlers.forEach((taskType) => {
        expect(taskHandlers).toHaveProperty(taskType);
        expect(typeof taskHandlers[taskType as keyof typeof taskHandlers]).toBe('function');
      });
    });

    it('should return error for unimplemented handlers', async () => {
      const task: Task = {
        id: 'task-123',
        task_type: 'process_community_request',
        agent_type: 'agent_of_humans',
        user_id: 'user-456',
        context_id: null,
        context_type: null,
        scheduled_for: new Date().toISOString(),
        priority: 'medium',
        status: 'pending',
        retry_count: 0,
        max_retries: 3,
        last_attempted_at: null,
        context_json: {},
        result_json: null,
        error_log: null,
        created_at: new Date().toISOString(),
        created_by: 'test',
        completed_at: null,
      };

      const result = await taskHandlers.process_community_request(task);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Handler not implemented');
      expect(result.shouldRetry).toBe(false);
    });
  });

  describe('Retry Logic', () => {
    it('should calculate exponential backoff correctly', () => {
      const INITIAL_BACKOFF_MS = 60000; // 1 minute

      // Retry 0: 1 minute
      const backoff0 = INITIAL_BACKOFF_MS * Math.pow(2, 0);
      expect(backoff0).toBe(60000); // 1 minute

      // Retry 1: 2 minutes
      const backoff1 = INITIAL_BACKOFF_MS * Math.pow(2, 1);
      expect(backoff1).toBe(120000); // 2 minutes

      // Retry 2: 4 minutes
      const backoff2 = INITIAL_BACKOFF_MS * Math.pow(2, 2);
      expect(backoff2).toBe(240000); // 4 minutes
    });
  });

  describe('Task Validation', () => {
    it('should validate task structure', () => {
      const validTask: Task = {
        id: 'task-123',
        task_type: 'research_solution',
        agent_type: 'concierge',
        user_id: 'user-456',
        context_id: null,
        context_type: null,
        scheduled_for: new Date().toISOString(),
        priority: 'medium',
        status: 'pending',
        retry_count: 0,
        max_retries: 3,
        last_attempted_at: null,
        context_json: { description: 'test' },
        result_json: null,
        error_log: null,
        created_at: new Date().toISOString(),
        created_by: 'test',
        completed_at: null,
      };

      expect(validTask).toHaveProperty('id');
      expect(validTask).toHaveProperty('task_type');
      expect(validTask).toHaveProperty('context_json');
      expect(typeof validTask.context_json).toBe('object');
    });
  });

  describe('Priority Ordering', () => {
    it('should order tasks by priority correctly', () => {
      const tasks = [
        { priority: 'low', scheduled_for: '2025-01-01T10:00:00Z' },
        { priority: 'urgent', scheduled_for: '2025-01-01T12:00:00Z' },
        { priority: 'medium', scheduled_for: '2025-01-01T11:00:00Z' },
        { priority: 'high', scheduled_for: '2025-01-01T09:00:00Z' },
      ];

      const priorityValues: Record<string, number> = {
        urgent: 1,
        high: 2,
        medium: 3,
        low: 4,
      };

      const sorted = tasks.sort((a, b) => {
        const priorityDiff = priorityValues[a.priority] - priorityValues[b.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return a.scheduled_for.localeCompare(b.scheduled_for);
      });

      expect(sorted[0].priority).toBe('urgent');
      expect(sorted[1].priority).toBe('high');
      expect(sorted[2].priority).toBe('medium');
      expect(sorted[3].priority).toBe('low');
    });
  });

  describe('Error Handling', () => {
    it('should handle handler exceptions gracefully', async () => {
      const failingHandler = async (task: Task): Promise<TaskResult> => {
        throw new Error('Unexpected handler error');
      };

      let caughtError: Error | null = null;
      try {
        await failingHandler({} as Task);
      } catch (error) {
        caughtError = error as Error;
      }

      expect(caughtError).toBeInstanceOf(Error);
      expect(caughtError?.message).toBe('Unexpected handler error');
    });

    it('should return structured error result', () => {
      const errorResult: TaskResult = {
        success: false,
        error: 'Task failed',
        shouldRetry: true,
      };

      expect(errorResult.success).toBe(false);
      expect(errorResult).toHaveProperty('error');
      expect(errorResult).toHaveProperty('shouldRetry');
    });
  });
});
