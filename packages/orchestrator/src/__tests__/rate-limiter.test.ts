/**
 * Example tests for Rate Limiter
 *
 * These tests demonstrate the expected behavior of the rate limiting system.
 * To run: npm test (requires Jest to be configured)
 */

import { RateLimiter } from '../rate-limiter';

// Mock Supabase client
const mockSupabase = {
  from: jest.fn(() => mockSupabase),
  select: jest.fn(() => mockSupabase),
  eq: jest.fn(() => mockSupabase),
  gte: jest.fn(() => mockSupabase),
  lte: jest.fn(() => mockSupabase),
  single: jest.fn(),
  insert: jest.fn(() => mockSupabase),
  update: jest.fn(() => mockSupabase),
  limit: jest.fn(() => mockSupabase),
  rpc: jest.fn()
};

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    jest.clearAllMocks();
    rateLimiter = new RateLimiter(mockSupabase as any);
  });

  describe('checkRateLimits', () => {
    it('should allow message when under daily limit', async () => {
      // Mock budget with messages under limit
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: 'budget_1',
          user_id: 'user_123',
          date: '2025-10-15',
          messages_sent: 5,
          last_message_at: new Date(),
          daily_limit: 10,
          hourly_limit: 2,
          quiet_hours_enabled: true
        },
        error: null
      });

      // Mock hourly check - 1 message in last hour
      mockSupabase.select.mockResolvedValueOnce({
        count: 1,
        error: null
      });

      const result = await rateLimiter.checkRateLimits('user_123');

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should block message when daily limit reached', async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: 'budget_1',
          user_id: 'user_123',
          date: '2025-10-15',
          messages_sent: 10,
          last_message_at: new Date(),
          daily_limit: 10,
          hourly_limit: 2,
          quiet_hours_enabled: true
        },
        error: null
      });

      const result = await rateLimiter.checkRateLimits('user_123');

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('daily_limit_reached');
      expect(result.nextAvailableAt).toBeInstanceOf(Date);
    });

    it('should block message when hourly limit reached', async () => {
      const lastMessageAt = new Date();

      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: 'budget_1',
          user_id: 'user_123',
          date: '2025-10-15',
          messages_sent: 5,
          last_message_at: lastMessageAt,
          daily_limit: 10,
          hourly_limit: 2,
          quiet_hours_enabled: true
        },
        error: null
      });

      // Mock hourly check - 2 messages in last hour (limit reached)
      mockSupabase.select.mockResolvedValueOnce({
        count: 2,
        error: null
      });

      const result = await rateLimiter.checkRateLimits('user_123');

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('hourly_limit_reached');
      expect(result.nextAvailableAt).toBeInstanceOf(Date);
    });
  });

  describe('isUserActive', () => {
    it('should return true if user sent message in last 10 minutes', async () => {
      const recentMessage = {
        id: 'msg_1',
        created_at: new Date().toISOString()
      };

      mockSupabase.select.mockResolvedValueOnce({
        data: [recentMessage],
        error: null
      });

      const result = await rateLimiter.isUserActive('user_123');

      expect(result).toBe(true);
      expect(mockSupabase.eq).toHaveBeenCalledWith('user_id', 'user_123');
      expect(mockSupabase.eq).toHaveBeenCalledWith('direction', 'inbound');
    });

    it('should return false if user has not sent recent message', async () => {
      mockSupabase.select.mockResolvedValueOnce({
        data: [],
        error: null
      });

      const result = await rateLimiter.isUserActive('user_123');

      expect(result).toBe(false);
    });
  });

  describe('isQuietHours', () => {
    it('should return false if quiet hours disabled', async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          quiet_hours_enabled: false,
          daily_limit: 10,
          hourly_limit: 2
        },
        error: null
      });

      const result = await rateLimiter.isQuietHours('user_123');

      expect(result).toBe(false);
    });

    it('should return false if user is active', async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          quiet_hours_enabled: true,
          daily_limit: 10,
          hourly_limit: 2
        },
        error: null
      });

      // Mock user is active
      mockSupabase.select.mockResolvedValueOnce({
        data: [{ id: 'msg_1' }],
        error: null
      });

      const result = await rateLimiter.isQuietHours('user_123');

      expect(result).toBe(false);
    });

    // Additional tests for timezone logic would go here
  });

  describe('incrementMessageBudget', () => {
    it('should call increment RPC function', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({
        data: null,
        error: null
      });

      await rateLimiter.incrementMessageBudget('user_123');

      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'increment_message_budget',
        expect.objectContaining({
          p_user_id: 'user_123'
        })
      );
    });

    it('should handle errors gracefully', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database error' }
      });

      // Should not throw
      await expect(
        rateLimiter.incrementMessageBudget('user_123')
      ).resolves.not.toThrow();
    });
  });
});

describe('Rate Limiting Integration Scenarios', () => {
  it('should allow urgent message even during quiet hours if user is active', async () => {
    // This would be an integration test with real database
    // Testing the full flow: user active → quiet hours overridden
  });

  it('should reschedule low-priority messages when rate limit reached', async () => {
    // Integration test: rate limit exceeded → message rescheduled
  });

  it('should process high-priority messages before low-priority ones', async () => {
    // Integration test: priority ordering in message queue
  });
});
