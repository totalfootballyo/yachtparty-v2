# Yachtparty Testing Guide

Complete guide to running and maintaining the Yachtparty test suite.

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Test Infrastructure](#test-infrastructure)
4. [Running Tests](#running-tests)
5. [Writing Tests](#writing-tests)
6. [Mocking Strategy](#mocking-strategy)
7. [CI/CD Integration](#cicd-integration)
8. [Troubleshooting](#troubleshooting)

---

## Overview

### Current Test Coverage

- **Test Cases Implemented**: 29+ test cases across unit, integration, and E2E tests
- **Target Coverage**: 70% (statements, branches, functions, lines)
- **Testing Framework**: Jest with TypeScript support
- **Mocked Services**: Supabase, Twilio, Anthropic Claude API

### Test Organization

```
packages/testing/
├── src/
│   ├── unit/                 # Unit tests (isolated components)
│   ├── integration/          # Integration tests (multiple components)
│   ├── e2e/                  # End-to-end tests (full workflows)
│   ├── mocks/                # Mock implementations
│   ├── helpers/              # Test data factories
│   └── setup.ts              # Global test configuration
├── jest.config.js            # Jest configuration
└── package.json              # Test scripts
```

---

## Quick Start

### Install Dependencies

```bash
# From project root
npm install
```

### Run All Tests

```bash
# Run complete test suite
npm test

# Or from packages/testing
cd packages/testing
npm test
```

### Run Specific Test Suites

```bash
# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# E2E tests only
npm run test:e2e

# Generate coverage report
npm run test:coverage

# Watch mode (for development)
npm run test:watch
```

---

## Test Infrastructure

### Testing Framework: Jest

**Why Jest?**
- Excellent TypeScript support with ts-jest
- Built-in mocking capabilities
- Fast parallel test execution
- Comprehensive coverage reporting
- Active community and great documentation

**Configuration** (`jest.config.js`):
- Preset: `ts-jest`
- Test environment: `node`
- Coverage thresholds: 70% for all metrics
- Timeout: 10 seconds per test
- Max workers: 50% of CPU cores

### Mock Implementations

All external services are mocked to ensure:
- ✅ Tests run fast and reliably
- ✅ No external API calls during testing
- ✅ Predictable test behavior
- ✅ No costs incurred from API usage
- ✅ Tests can run offline

**Mocked Services:**

1. **Supabase** (`src/mocks/supabase.mock.ts`)
   - In-memory database storage
   - Full query builder pattern support
   - Realtime subscription simulation
   - Transaction support

2. **Twilio** (`src/mocks/twilio.mock.ts`)
   - Message sending capture
   - Webhook signature validation
   - Message status tracking

3. **Anthropic Claude API** (`src/mocks/anthropic.mock.ts`)
   - Configurable LLM responses
   - Token usage tracking
   - Cost estimation
   - Response pattern matching

---

## Running Tests

### Basic Commands

```bash
# Run all tests
npm test

# Run with coverage report
npm run test:coverage

# Run tests in watch mode (auto-rerun on file changes)
npm run test:watch

# Run a specific test file
npx jest src/unit/bouncer.test.ts

# Run tests matching a pattern
npx jest -t "should extract user information"

# Run with verbose output
npx jest --verbose

# Run tests without coverage (faster)
npx jest --no-coverage
```

### Coverage Reports

After running `npm run test:coverage`, coverage reports are generated in:

```
packages/testing/coverage/
├── lcov-report/index.html    # HTML report (open in browser)
├── coverage-summary.json      # Summary JSON
└── coverage-final.json        # Detailed JSON
```

**View HTML report:**
```bash
open packages/testing/coverage/lcov-report/index.html
```

### Environment Variables

No environment variables required for tests. All external services are mocked.

---

## Writing Tests

### Test Structure (AAA Pattern)

All tests follow the **Arrange-Act-Assert** pattern:

```typescript
describe('Feature Name', () => {
  it('should do something specific', async () => {
    // Arrange: Set up test data and mocks
    const testUser = createTestUser({ verified: true });
    mockSupabase.seedDatabase({ users: [testUser] });
    mockAnthropic.mockBouncerResponse('Welcome!');

    // Act: Execute the function under test
    const result = await functionUnderTest(testUser.id);

    // Assert: Verify the expected outcome
    expect(result).toBeDefined();
    expect(result.message).toBe('Welcome!');
  });
});
```

### Using Test Data Factories

Import test data factories from `helpers/test-data.ts`:

```typescript
import {
  createTestUser,
  createVerifiedUser,
  createTestConversation,
  createTestMessage,
  createTestEvent,
  createOnboardingScenario,
  createVerifiedScenario,
} from '../helpers/test-data';

// Create a basic test user
const user = createTestUser({
  first_name: 'Alice',
  verified: false,
});

// Create a verified user (shortcut)
const verifiedUser = createVerifiedUser({
  company: 'Acme Corp',
});

// Create a complete test scenario
const { user, conversation, messages } = createOnboardingScenario();
```

### Mocking External Services

#### Mocking Supabase

```typescript
import { mockSupabase } from '../mocks/supabase.mock';

// Seed database with test data
mockSupabase.seedDatabase({
  users: [user1, user2],
  conversations: [conversation],
  messages: [message1, message2],
});

// Query works just like real Supabase
const result = await mockSupabase
  .from('users')
  .select()
  .eq('id', user.id)
  .single();

expect(result.data).toBeDefined();
expect(result.data.first_name).toBe('Alice');
```

#### Mocking Anthropic Claude API

```typescript
import { mockAnthropic } from '../mocks/anthropic.mock';

// Mock Bouncer extraction response
mockAnthropic.mockBouncerExtraction({
  first_name: 'Alice',
  company: 'TechCorp',
});

// Mock Concierge intent classification
mockAnthropic.mockConciergeIntent('solution_inquiry', {
  description: 'Need a CRM tool',
  category: 'sales_tools',
});

// Mock custom response pattern
mockAnthropic.mockResponse(/help.*CRM/i, {
  message: 'I can help you find a CRM solution',
  actions: [{ type: 'request_solution_research', params: {} }],
});

// Check token usage
const usage = mockAnthropic.getTokenUsage();
expect(usage.total).toBeGreaterThan(0);

// Get estimated cost
const cost = mockAnthropic.getEstimatedCost();
expect(cost).toBeGreaterThan(0);
```

#### Mocking Twilio

```typescript
import { mockTwilio } from '../mocks/twilio.mock';

// Send a message (gets captured by mock)
await twilioClient.messages.create({
  to: '+15551234567',
  from: '+15559876543',
  body: 'Test message',
});

// Verify message was sent
const lastMessage = mockTwilio.getLastMessage();
expect(lastMessage?.body).toBe('Test message');

// Get all sent messages
const allMessages = mockTwilio.getSentMessages();
expect(allMessages).toHaveLength(1);
```

### Test Categories

#### Unit Tests

Test individual functions/components in isolation.

**Location**: `src/unit/`

**Examples**:
- Bouncer information extraction
- Concierge intent classification
- Message orchestrator rate limiting

```typescript
describe('Bouncer Agent - Information Extraction', () => {
  it('should extract first name from user message', async () => {
    mockAnthropic.mockBouncerExtraction({ first_name: 'Alice' });

    const result = await extractUserInfo("Hi! I'm Alice");

    expect(result.first_name).toBe('Alice');
  });
});
```

#### Integration Tests

Test interactions between multiple components.

**Location**: `src/integration/`

**Examples**:
- Event publishing and handling
- Complete SMS flow (webhook → agent → database → SMS send)

```typescript
describe('SMS Flow Integration', () => {
  it('should handle complete inbound SMS to outbound SMS flow', async () => {
    // Arrange
    mockSupabase.seedDatabase({ users: [user], conversations: [conversation] });
    mockAnthropic.mockBouncerResponse('Thanks! What company do you work for?');

    // Act - Simulate inbound SMS
    await handleInboundSMS({
      From: user.phone_number,
      Body: "I'm Alice",
      MessageSid: 'SM123',
    });

    // Assert - Verify outbound message was created
    const messages = await mockSupabase.from('messages')
      .select()
      .eq('direction', 'outbound');

    expect(messages.data).toHaveLength(1);
    expect(messages.data[0].content).toContain('company');
  });
});
```

#### End-to-End Tests

Test complete user workflows from start to finish.

**Location**: `src/e2e/`

**Examples**:
- Complete onboarding conversation
- Verified user requesting solution

```typescript
describe('E2E: Onboarding Flow', () => {
  it('should complete full onboarding conversation', async () => {
    // Simulate multi-turn conversation
    const user = createTestUser({ verified: false });

    // Turn 1: Initial contact
    await sendSMS(user.phone_number, 'Hey, Sarah referred me');
    expect(mockTwilio.getLastMessage()?.body).toContain('who told you');

    // Turn 2: Provide name
    await sendSMS(user.phone_number, "I'm Alice from TechCorp");
    expect(mockTwilio.getLastMessage()?.body).toContain('email');

    // Turn 3: Provide email
    await sendSMS(user.phone_number, 'alice@techcorp.com');
    expect(mockTwilio.getLastMessage()?.body).toContain('LinkedIn');

    // Verify user data was updated
    const updatedUser = await getUser(user.id);
    expect(updatedUser.first_name).toBe('Alice');
    expect(updatedUser.email).toBe('alice@techcorp.com');
  });
});
```

---

## Mocking Strategy

### Design Principles

1. **Isolation**: Tests should not depend on external services
2. **Determinism**: Tests should produce the same result every time
3. **Speed**: Mocks enable fast test execution
4. **Cost**: No API costs during testing
5. **Offline**: Tests run without internet connection

### Mock Implementation Details

#### Supabase Mock

**Features**:
- In-memory data storage (no real database)
- Full query builder API (`from()`, `select()`, `insert()`, `update()`, `delete()`)
- Filter support (`eq()`, `neq()`, `gte()`, `lte()`, `in()`)
- Ordering and limiting
- Realtime channel simulation
- RPC function mocking

**Usage**:
```typescript
// Seed data
mockSupabase.seedDatabase({
  users: [{ id: '1', first_name: 'Alice', verified: false }],
});

// Query just like real Supabase
const result = await mockSupabase.from('users').select().eq('id', '1').single();
```

#### Anthropic Mock

**Features**:
- Pattern-based response matching
- Token usage tracking
- Cost estimation
- Call history
- Configurable responses for different agent types

**Usage**:
```typescript
// Configure response for specific prompt pattern
mockAnthropic.mockResponse(/extract.*information/i, {
  extracted_fields: { first_name: 'Alice' },
  confidence: 'high',
});

// Or use convenience methods
mockAnthropic.mockBouncerExtraction({ email: 'alice@example.com' });
mockAnthropic.mockConciergeIntent('solution_inquiry');

// Track API usage
const calls = mockAnthropic.getCalls();
const usage = mockAnthropic.getTokenUsage();
const cost = mockAnthropic.getEstimatedCost();
```

#### Twilio Mock

**Features**:
- Message sending capture
- Webhook signature validation
- Message history
- Status tracking

**Usage**:
```typescript
// Messages sent via Twilio are captured
await twilioClient.messages.create({ to: '+15551234567', body: 'Test' });

// Retrieve sent messages
const lastMessage = mockTwilio.getLastMessage();
const allMessages = mockTwilio.getSentMessages();

// Clear history between tests
mockTwilio.reset();
```

---

## CI/CD Integration

### GitHub Actions Workflow

Tests run automatically on:
- **Push** to `main` or `develop` branches
- **Pull requests** to `main` or `develop`

**Workflow file**: `.github/workflows/ci.yml`

**Jobs**:
1. **Test**: Run all tests (unit, integration, E2E)
2. **Build**: Build all packages
3. **Type Check**: Run TypeScript compiler

### Test Results in PRs

The GitHub Actions workflow automatically comments on pull requests with:
- Test pass/fail status
- Coverage summary
- Links to detailed coverage reports

### Coverage Reporting

Coverage reports are uploaded to Codecov (optional) for tracking trends over time.

---

## Troubleshooting

### Common Issues

#### Tests Timing Out

**Symptom**: Tests exceed 10-second timeout

**Solutions**:
- Increase timeout in `jest.config.js`:
  ```javascript
  testTimeout: 30000 // 30 seconds
  ```
- Or per-test:
  ```typescript
  it('long running test', async () => {
    jest.setTimeout(30000);
    // ...
  }, 30000);
  ```
- Check for unresolved promises
- Verify mock implementations

#### Mock Not Working

**Symptom**: Mock not returning expected values

**Solutions**:
- Ensure mocks are reset in `beforeEach`:
  ```typescript
  beforeEach(() => {
    mockSupabase.reset();
    mockAnthropic.reset();
    mockTwilio.reset();
  });
  ```
- Verify mock implementation matches expected interface
- Check that mock response patterns are correct

#### Coverage Not Meeting Threshold

**Symptom**: Coverage below 70% threshold

**Solutions**:
- Run `npm run test:coverage` to see detailed report
- Open HTML report to identify untested files:
  ```bash
  open packages/testing/coverage/lcov-report/index.html
  ```
- Add tests for uncovered branches/functions
- Consider if 70% threshold is appropriate for all files

#### TypeScript Errors

**Symptom**: TypeScript compilation errors in tests

**Solutions**:
- Ensure `@types/jest` is installed
- Check `tsconfig.json` includes test files
- Verify imports from `@yachtparty/shared` are correct
- Run `npx tsc --noEmit` to check for type errors

#### Tests Pass Locally But Fail in CI

**Symptom**: Tests pass on your machine but fail in GitHub Actions

**Solutions**:
- Check Node.js version matches (20.x)
- Verify all dependencies are in `package.json`
- Look for timezone-dependent tests (use UTC)
- Check for tests that depend on file system state

---

## Best Practices

### Writing Effective Tests

1. **One Assertion Per Test**: Each test should verify one specific behavior
2. **Descriptive Names**: Use clear, descriptive test names
3. **Arrange-Act-Assert**: Follow the AAA pattern
4. **Independent Tests**: Tests should not depend on each other
5. **Clean Up**: Use `beforeEach` and `afterEach` for setup/teardown
6. **Test Both Paths**: Test success and failure scenarios
7. **Edge Cases**: Include boundary conditions and edge cases

### Test Maintenance

1. **Keep Tests Fast**: Aim for <1s per test
2. **Avoid Test Duplication**: Use helper functions and factories
3. **Update Tests with Code**: When changing code, update tests immediately
4. **Review Coverage**: Regularly check coverage reports
5. **Refactor Tests**: Keep test code clean and maintainable

### Performance Tips

1. **Use `beforeEach` Wisely**: Only reset what's necessary
2. **Avoid Unnecessary Async**: Don't use `async/await` if not needed
3. **Parallel Execution**: Jest runs tests in parallel by default
4. **Mock Expensive Operations**: Always mock external API calls

---

## Test Coverage Goals

### Current Targets (70% for all metrics)

- **Statements**: 70%
- **Branches**: 70%
- **Functions**: 70%
- **Lines**: 70%

### Priority Areas

1. **Critical Path**: Onboarding flow, message sending, agent routing
2. **Business Logic**: Information extraction, intent classification, priority scoring
3. **Error Handling**: Graceful degradation, retry logic, fallbacks
4. **Integration Points**: Database operations, API calls, event publishing

---

## Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [TypeScript Jest Guide](https://kulshekhar.github.io/ts-jest/)
- [Yachtparty Requirements](./requirements.md)
- [Yachtparty Architecture](./AGENT_INTERFACES.md)

---

## Getting Help

### Debugging Tests

1. Use `console.log()` liberally in tests
2. Run tests with `--verbose` flag
3. Run single test files to isolate issues
4. Check mock call history:
   ```typescript
   console.log(mockAnthropic.getCalls());
   ```

### Common Questions

**Q: How do I test LLM responses?**
A: Use `mockAnthropic.mockResponse()` to configure expected responses.

**Q: How do I test database operations?**
A: Use `mockSupabase` - it works just like the real Supabase client.

**Q: How do I test Twilio SMS sending?**
A: Use `mockTwilio` - all sent messages are captured for verification.

**Q: How do I run just one test?**
A: `npx jest -t "test name pattern"`

**Q: How do I skip a test temporarily?**
A: Change `it()` to `it.skip()` or `describe()` to `describe.skip()`

---

## Summary

The Yachtparty testing infrastructure provides:

✅ **Comprehensive Coverage**: Unit, integration, and E2E tests
✅ **Fast Execution**: All external services mocked
✅ **Developer-Friendly**: Easy-to-use test factories and mocks
✅ **CI/CD Integration**: Automated testing on every PR
✅ **Coverage Reporting**: Track test coverage over time
✅ **Type Safety**: Full TypeScript support throughout

Run `npm test` to get started!
