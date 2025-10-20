/**
 * Jest test setup
 *
 * Configures mocks and environment for testing.
 */

// Mock environment variables
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
process.env.PORT = '8080';

// Mock Supabase client
export const mockSupabase = {
  from: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn(),
  })),
};

// Mock shared utilities
jest.mock('@yachtparty/shared', () => ({
  createServiceClient: jest.fn(() => mockSupabase),
  publishEvent: jest.fn().mockResolvedValue({ id: 'mock-event-id' }),
}));

// Global test timeout
jest.setTimeout(10000);
