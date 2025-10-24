# Bouncer Agent Test Infrastructure

This directory contains the test infrastructure for the Bouncer Agent, which handles user onboarding through verification.

## Structure

```
__tests__/
├── README.md                    # This file
├── fixtures.ts                  # Test data generators
├── helpers.ts                   # Assertion helpers
└── mocks/
    └── supabase.mock.ts        # Supabase client mock
```

## Test Fixtures (`fixtures.ts`)

Provides builder functions to create realistic test data for various onboarding scenarios:

### User Creation
- `createTestUser(overrides)` - Create a test user with configurable fields
- `createUserByOnboardingStep(step)` - Create user in specific onboarding state
- `createReferrerUser(overrides)` - Create a verified referrer user

### Onboarding Steps
- `'welcome'` - Brand new user, no info collected
- `'name_collection'` - Collecting name
- `'company_collection'` - Has name, collecting company/title
- `'email_verification'` - Has basic info, verifying email
- `'linkedin_connection'` - Email verified, connecting LinkedIn
- `'first_nomination'` - LinkedIn connected, collecting nomination
- `'complete'` - All steps complete, user verified

### Conversation & Messages
- `createTestConversation(overrides)` - Create conversation
- `createTestMessages(pattern)` - Create message histories
  - `'new_user'` - First interaction
  - `'partial_info'` - Mid-onboarding
  - `'waiting_verification'` - Email verification pending

### Test Scenarios
- `createTestScenario(type)` - Complete scenarios with context
  - `'brand_new_user'` - User just said "Hi"
  - `'partial_onboarding'` - User has provided name
  - `'email_pending'` - Waiting for email verification
  - `'ready_to_verify'` - All info collected, ready to complete

### Other Helpers
- `createOnboardingProgress(overrides)` - Onboarding state
- `createNomination(overrides)` - Nomination data
- `createReengagementContext(overrides)` - Re-engagement scenario

## Test Helpers (`helpers.ts`)

Assertion helpers to verify agent behavior:

### Response Verification
- `verifyAgentResponse(response, expected)` - Check response structure
- `verifyOnboardingMessages(response, expected)` - Validate message tone/content

### Onboarding Flow Verification
- `verifyUserInfoCollected(response, fields)` - Check fields were collected
- `verifyEmailVerificationFlow(response, userId)` - Email flow correct
- `verifyOnboardingComplete(response, userId)` - Onboarding finished

### Action Verification
- `verifyActionParams(response, actionType, params)` - Check action parameters
- `verifyReengagementTaskCreated(response)` - Re-engagement scheduled
- `verifyReferrerSet(response, referrerId)` - Referrer linked
- `verifyNameDroppedStored(response, name)` - Name stored for review
- `verifyNominationStored(response)` - Nomination captured

### Event Verification
- `verifyUserVerifiedEvent(response)` - user.verified event published

### Tone Checkers
- `checkToneWelcomingProfessional(message)` - Not overeager
- `checkMessageConcise(message)` - Under 4 sentences

## Supabase Mock (`mocks/supabase.mock.ts`)

Mock implementation of Supabase client for testing without database:

### Setup
```typescript
import { createMockSupabaseClient } from './mocks/supabase.mock';

const mockClient = createMockSupabaseClient({
  users: [createTestUser()],
  messages: createTestMessages('new_user'),
  conversations: [createTestConversation()],
});
```

### Features
- In-memory data storage
- Query filtering (eq, ilike, in, gte, contains)
- Ordering and limiting
- Insert/update tracking
- Referral lookup (ilike for name matching)

### Verification
```typescript
// Check what was inserted
const insertedEvents = mockClient._getInsertedData('events');

// Check what was updated
const updatedUsers = mockClient._getUpdatedData('users');
```

## Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test bouncer.onboarding.test.ts

# Run with coverage
npm test -- --coverage

# Watch mode
npm test -- --watch
```

## Writing Tests

### Basic Structure
```typescript
import { describe, it, expect, jest } from '@jest/globals';
import { createTestUser, createTestConversation, createTestScenario } from './fixtures';
import { verifyAgentResponse, verifyUserInfoCollected } from './helpers';
import { createMockSupabaseClient } from './mocks/supabase.mock';

describe('Bouncer Agent - Name Collection', () => {
  it('should collect first and last name', async () => {
    const scenario = createTestScenario('brand_new_user');

    // Mock Supabase
    const mockClient = createMockSupabaseClient({
      users: [scenario.user],
      conversations: [scenario.conversation],
      messages: scenario.messages,
    });

    // Invoke agent
    const response = await invokeBouncerAgent(
      scenario.incomingMessage,
      scenario.user,
      scenario.conversation
    );

    // Verify response
    verifyAgentResponse(response, {
      immediateReply: true,
      hasMessages: true,
      hasActions: true,
    });

    // Verify name was collected
    verifyUserInfoCollected(response, ['first_name', 'last_name']);
  });
});
```

### Testing Onboarding Flow
```typescript
it('should progress through onboarding steps', async () => {
  const user = createUserByOnboardingStep('name_collection');

  // User provides company info
  const message = createIncomingMessage('I work at Acme Corp as VP Marketing');

  const response = await invokeBouncerAgent(message, user, conversation);

  // Should collect company and title
  verifyUserInfoCollected(response, ['company', 'title']);

  // Should ask for email next
  verifyOnboardingMessages(response, {
    mentionsField: 'email',
  });
});
```

### Testing Email Verification
```typescript
it('should send verification email', async () => {
  const user = createUserByOnboardingStep('email_verification');

  const response = await invokeBouncerAgent(message, user, conversation);

  verifyEmailVerificationFlow(response, user.id);
  verifyOnboardingMessages(response, {
    includesVerificationEmail: true,
  });
});
```

### Testing Re-engagement
```typescript
it('should re-engage after 24 hours', async () => {
  const scenario = createTestScenario('email_pending');

  const response = await invokeBouncerAgent(
    scenario.systemMessage, // Re-engagement trigger
    scenario.user,
    scenario.conversation
  );

  verifyAgentResponse(response, {
    immediateReply: true,
    hasMessages: true,
  });
});
```

## Best Practices

1. **Use Fixtures** - Always use fixture builders for test data
2. **Test Onboarding Flow** - Verify step-by-step progression
3. **Verify Actions** - Check that correct database actions occur
4. **Check Tone** - Ensure professional, welcoming tone
5. **Test Edge Cases** - Referral matching, nomination storage, etc.
6. **Mock Dependencies** - Use Supabase mock for isolation

## Coverage Goals

- **Onboarding Steps**: Test each step transition
- **User Info Collection**: All field types (name, email, LinkedIn, etc.)
- **Verification Flow**: Email verification, LinkedIn connection
- **Re-engagement**: Task creation, attempt limits
- **Referrals**: Name matching, name_dropped storage
- **Nominations**: Intro opportunity creation
- **Edge Cases**: Missing fields, invalid data, etc.
