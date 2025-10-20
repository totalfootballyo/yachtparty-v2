/**
 * Research Solution Handler Tests
 */

import { handleResearchSolution } from '../../handlers/research.js';
import { publishEvent } from '@yachtparty/shared';
import type { Task } from '../../types.js';

// Mock publishEvent
jest.mock('@yachtparty/shared');

describe('handleResearchSolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should publish solution research event successfully', async () => {
    const task: Task = {
      id: 'task-123',
      task_type: 'research_solution',
      agent_type: 'concierge',
      user_id: 'user-456',
      context_id: 'conv-789',
      context_type: 'conversation',
      scheduled_for: new Date().toISOString(),
      priority: 'high',
      status: 'pending',
      retry_count: 0,
      max_retries: 3,
      last_attempted_at: null,
      context_json: {
        description: 'User needs CRM for small sales team',
        category: 'sales_software',
        urgency: 'high',
        conversationId: 'conv-789',
      },
      result_json: null,
      error_log: null,
      created_at: new Date().toISOString(),
      created_by: 'concierge_agent',
      completed_at: null,
    };

    (publishEvent as jest.Mock).mockResolvedValueOnce({
      id: 'event-123',
      event_type: 'user.inquiry.solution_needed',
    });

    const result = await handleResearchSolution(task);

    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('eventId', 'event-123');
    expect(result.data).toHaveProperty('description', 'User needs CRM for small sales team');
    expect(publishEvent).toHaveBeenCalledWith({
      event_type: 'user.inquiry.solution_needed',
      aggregate_id: 'user-456',
      aggregate_type: 'user',
      payload: expect.objectContaining({
        userId: 'user-456',
        conversationId: 'conv-789',
        requestDescription: 'User needs CRM for small sales team',
        category: 'sales_software',
        urgency: 'high',
        taskId: 'task-123',
      }),
      metadata: expect.any(Object),
      created_by: 'task_processor',
    });
  });

  it('should fail when description is missing', async () => {
    const task: Task = {
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
      context_json: {
        // Missing description
        category: 'sales_software',
      },
      result_json: null,
      error_log: null,
      created_at: new Date().toISOString(),
      created_by: 'concierge_agent',
      completed_at: null,
    };

    const result = await handleResearchSolution(task);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Missing research description in context');
    expect(result.shouldRetry).toBe(false);
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('should handle event publishing errors with retry', async () => {
    const task: Task = {
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
      context_json: {
        description: 'User needs project management tool',
      },
      result_json: null,
      error_log: null,
      created_at: new Date().toISOString(),
      created_by: 'concierge_agent',
      completed_at: null,
    };

    (publishEvent as jest.Mock).mockRejectedValueOnce(new Error('Database connection failed'));

    const result = await handleResearchSolution(task);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Database connection failed');
    expect(result.shouldRetry).toBe(true);
  });
});
