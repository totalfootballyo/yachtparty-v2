/**
 * Update User Profile Handler Tests
 */

import { handleUpdateUserProfile } from '../../handlers/profile.js';
import { createServiceClient } from '@yachtparty/shared';
import type { Task } from '../../types.js';

jest.mock('@yachtparty/shared');

describe('handleUpdateUserProfile', () => {
  let mockSupabase: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = {
      from: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn(),
      })),
    };
    (createServiceClient as jest.Mock).mockReturnValue(mockSupabase);
  });

  it('should update user profile field successfully', async () => {
    const task: Task = {
      id: 'task-123',
      task_type: 'update_user_profile',
      agent_type: 'bouncer',
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
        field: 'first_name',
        value: 'Sarah',
        source: 'onboarding',
      },
      result_json: null,
      error_log: null,
      created_at: new Date().toISOString(),
      created_by: 'bouncer_agent',
      completed_at: null,
    };

    mockSupabase.from().update().eq = jest.fn().mockResolvedValue({ error: null });

    const result = await handleUpdateUserProfile(task);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      field: 'first_name',
      value: 'Sarah',
      source: 'onboarding',
    });
    expect(mockSupabase.from).toHaveBeenCalledWith('users');
  });

  it('should reject disallowed field updates', async () => {
    const task: Task = {
      id: 'task-123',
      task_type: 'update_user_profile',
      agent_type: 'bouncer',
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
        field: 'credit_balance', // Not in allowlist
        value: 1000,
      },
      result_json: null,
      error_log: null,
      created_at: new Date().toISOString(),
      created_by: 'malicious_agent',
      completed_at: null,
    };

    const result = await handleUpdateUserProfile(task);

    expect(result.success).toBe(false);
    expect(result.error).toContain('not allowed to be updated');
    expect(result.shouldRetry).toBe(false);
  });

  it('should fail when field or value is missing', async () => {
    const task: Task = {
      id: 'task-123',
      task_type: 'update_user_profile',
      agent_type: 'bouncer',
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
        // Missing field and value
      },
      result_json: null,
      error_log: null,
      created_at: new Date().toISOString(),
      created_by: 'bouncer_agent',
      completed_at: null,
    };

    const result = await handleUpdateUserProfile(task);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Missing field or value in context');
    expect(result.shouldRetry).toBe(false);
  });
});
