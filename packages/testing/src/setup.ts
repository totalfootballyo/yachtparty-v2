/**
 * Global Test Setup
 *
 * Configures test environment, mocks, and utilities for all tests.
 */

import { mockSupabase, resetSupabaseMock } from './mocks/supabase.mock';
import { mockTwilio, resetTwilioMock } from './mocks/twilio.mock';
import { mockAnthropic, resetAnthropicMock } from './mocks/anthropic.mock';

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
process.env.TWILIO_ACCOUNT_SID = 'test-twilio-sid';
process.env.TWILIO_AUTH_TOKEN = 'test-twilio-token';
process.env.TWILIO_PHONE_NUMBER = '+15555555555';

// Configure Jest
jest.setTimeout(10000); // 10 second timeout

// Global test utilities
global.mockSupabase = mockSupabase;
global.mockTwilio = mockTwilio;
global.mockAnthropic = mockAnthropic;

// Reset all mocks before each test
beforeEach(() => {
  resetSupabaseMock();
  resetTwilioMock();
  resetAnthropicMock();
  jest.clearAllMocks();
});

// Cleanup after each test
afterEach(() => {
  jest.restoreAllMocks();
});

// Handle unhandled promise rejections in tests
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection in test:', reason);
  throw reason;
});

// Suppress console output during tests (optional)
// Uncomment these lines to reduce noise in test output
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
//   error: jest.fn(),
// };

export {};
