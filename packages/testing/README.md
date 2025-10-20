# Yachtparty Testing Infrastructure

Comprehensive testing suite for the Yachtparty multi-agent SMS platform.

## Overview

This package provides a complete testing infrastructure with unit tests, integration tests, and end-to-end tests for all Yachtparty components.

## Test Structure

```
src/
├── setup.ts                  # Global test setup and configuration
├── mocks/                    # Mock implementations
│   ├── supabase.mock.ts      # Mock Supabase client
│   ├── twilio.mock.ts        # Mock Twilio client
│   └── anthropic.mock.ts     # Mock Claude API
├── unit/                     # Unit tests (isolated components)
│   ├── bouncer.test.ts       # Bouncer Agent tests
│   ├── concierge.test.ts     # Concierge Agent tests
│   └── message-orchestrator.test.ts
├── integration/              # Integration tests (multiple components)
│   ├── event-flow.test.ts    # Event publishing and handling
│   └── sms-flow.test.ts      # Complete SMS workflows
├── e2e/                      # End-to-end tests (full user flows)
│   ├── onboarding-flow.test.ts
│   └── verified-conversation.test.ts
└── helpers/                  # Test utilities and factories
    └── test-data.ts          # Test data factories

```

## Running Tests

### Run all tests
```bash
npm test
```

### Run specific test suites
```bash
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests only
npm run test:e2e          # End-to-end tests only
```

### Watch mode (for development)
```bash
npm run test:watch
```

### Coverage report
```bash
npm run test:coverage
```

## Test Coverage Targets

- **Statements**: 70%
- **Branches**: 70%
- **Functions**: 70%
- **Lines**: 70%

## Mocking Strategy

### External Services

All external services are mocked to ensure:
- Tests run fast and reliably
- No external API calls during testing
- Predictable test behavior
- No cost incurred from API usage

**Mocked Services:**
- Supabase (database and realtime)
- Twilio (SMS sending)
- Anthropic Claude API (LLM calls)

### Mock Implementations

#### Supabase Mock
- In-memory data storage
- Query builder pattern support
- Realtime subscription simulation
- Transaction support

#### Twilio Mock
- Message sending capture
- Webhook signature validation
- Message status tracking

#### Anthropic Mock
- Configurable responses
- Token usage tracking
- Response simulation

## Test Patterns

All tests follow the **AAA pattern** (Arrange, Act, Assert):

```typescript
test('should do something', async () => {
  // Arrange: Set up test data and mocks
  const testUser = createTestUser({ verified: true });
  mockSupabase.from('users').select.mockResolvedValue({ data: [testUser] });

  // Act: Execute the function under test
  const result = await functionUnderTest(testUser.id);

  // Assert: Verify the expected outcome
  expect(result).toBeDefined();
  expect(mockSupabase.from).toHaveBeenCalledWith('users');
});
```

## Test Data Factories

Use test data factories from `helpers/test-data.ts` for consistent test data:

```typescript
import { createTestUser, createTestConversation, createTestMessage } from '../helpers/test-data';

const user = createTestUser({ first_name: 'John', verified: true });
const conversation = createTestConversation({ user_id: user.id });
const message = createTestMessage({ conversation_id: conversation.id });
```

## Unit Tests

Unit tests focus on individual components in isolation with all dependencies mocked.

### Bouncer Agent (`unit/bouncer.test.ts`)
- Onboarding flow steps
- Information extraction
- Verification handling
- Completion and transition to Concierge

### Concierge Agent (`unit/concierge.test.ts`)
- Intent classification
- Message rendering
- Priority surfacing
- Workflow initiation

### Message Orchestrator (`unit/message-orchestrator.test.ts`)
- Rate limiting logic
- Quiet hours enforcement
- Priority lanes
- Message relevance checking

## Integration Tests

Integration tests verify interactions between multiple components.

### Event Flow (`integration/event-flow.test.ts`)
- Event publishing
- Event handling by agents
- Saga workflows
- State transitions

### SMS Flow (`integration/sms-flow.test.ts`)
- Inbound SMS → Agent processing → Outbound SMS
- Webhook handling
- Database state changes
- Event publishing

## End-to-End Tests

E2E tests verify complete user workflows from start to finish.

### Onboarding Flow (`e2e/onboarding-flow.test.ts`)
- Complete user onboarding conversation
- Multiple SMS exchanges
- State transitions (unverified → verified)
- Data collection and validation

### Verified Conversation (`e2e/verified-conversation.test.ts`)
- Concierge conversations
- Different intent types (solution, intro, community)
- Workflow initiation
- Priority surfacing

## Best Practices

1. **Isolation**: Each test should be independent and not rely on other tests
2. **Cleanup**: Use `beforeEach` and `afterEach` for setup and teardown
3. **Descriptive Names**: Test names should clearly describe what is being tested
4. **Mock Verification**: Verify that mocks are called with expected parameters
5. **Positive and Negative**: Test both success and failure scenarios
6. **Edge Cases**: Include tests for boundary conditions and edge cases

## Debugging Tests

### Run a single test file
```bash
npx jest src/unit/bouncer.test.ts
```

### Run a single test case
```bash
npx jest -t "should extract user information"
```

### Debug with verbose output
```bash
npx jest --verbose --no-coverage
```

## Continuous Integration

Tests run automatically on:
- Pull requests
- Commits to main branch
- Pre-deployment checks

CI configuration ensures:
- All tests pass
- Coverage thresholds are met
- No linting errors
- TypeScript compilation succeeds

## Contributing

When adding new features:

1. Write tests first (TDD approach recommended)
2. Ensure all tests pass: `npm test`
3. Check coverage: `npm run test:coverage`
4. Update this README if adding new test categories

## Troubleshooting

### Tests timing out
- Increase timeout in `jest.config.js` or use `jest.setTimeout()`
- Check for unresolved promises
- Verify mock implementations

### Mock not working
- Ensure mocks are imported before the tested module
- Check mock reset in `beforeEach`
- Verify mock implementation matches expected interface

### Coverage not meeting threshold
- Identify untested files: `npm run test:coverage`
- Add tests for uncovered branches
- Consider if 70% threshold is appropriate for the file

## Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [Yachtparty Architecture](../../docs/requirements.md)
