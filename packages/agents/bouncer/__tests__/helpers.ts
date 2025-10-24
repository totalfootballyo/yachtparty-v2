/**
 * Test Helpers for Bouncer Agent Testing
 *
 * Provides assertion helpers to verify correct behavior of:
 * - Onboarding step progression
 * - User data collection
 * - Email verification flow
 * - Re-engagement logic
 * - Tool execution (collect_user_info, send_verification_email, complete_onboarding)
 */

import type { AgentResponse, AgentActionType } from '@yachtparty/shared';

/**
 * Verify Agent Response Structure
 */
export function verifyAgentResponse(
  response: AgentResponse,
  expected: {
    immediateReply?: boolean;
    hasMessages?: boolean;
    messageCount?: number;
    hasActions?: boolean;
    actionTypes?: AgentActionType[];
    hasEvents?: boolean;
  }
) {
  const errors: string[] = [];

  // Verify immediateReply
  if (expected.immediateReply !== undefined && response.immediateReply !== expected.immediateReply) {
    errors.push(`Expected immediateReply=${expected.immediateReply}, got ${response.immediateReply}`);
  }

  // Verify has messages
  if (expected.hasMessages !== undefined) {
    const hasMessages = (response.messages?.length ?? 0) > 0;
    if (hasMessages !== expected.hasMessages) {
      errors.push(`Expected hasMessages=${expected.hasMessages}, got ${hasMessages}`);
    }
  }

  // Verify message count
  if (expected.messageCount !== undefined) {
    const actualCount = response.messages?.length ?? 0;
    if (actualCount !== expected.messageCount) {
      errors.push(`Expected ${expected.messageCount} messages, got ${actualCount}`);
    }
  }

  // Verify has actions
  if (expected.hasActions !== undefined) {
    const hasActions = response.actions.length > 0;
    if (hasActions !== expected.hasActions) {
      errors.push(`Expected hasActions=${expected.hasActions}, got ${hasActions}`);
    }
  }

  // Verify action types
  if (expected.actionTypes) {
    const actualTypes = response.actions.map(a => a.type);
    const missingTypes = expected.actionTypes.filter(t => !actualTypes.includes(t));
    const extraTypes = actualTypes.filter(t => !expected.actionTypes!.includes(t));

    if (missingTypes.length > 0) {
      errors.push(`Missing expected actions: ${missingTypes.join(', ')}`);
    }
    if (extraTypes.length > 0) {
      errors.push(`Unexpected actions: ${extraTypes.join(', ')}`);
    }
  }

  // Verify has events
  if (expected.hasEvents !== undefined) {
    const hasEvents = (response.events?.length ?? 0) > 0;
    if (hasEvents !== expected.hasEvents) {
      errors.push(`Expected hasEvents=${expected.hasEvents}, got ${hasEvents}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Agent Response Verification Failed:\n${errors.join('\n')}`);
  }

  return true;
}

/**
 * Verify messages have appropriate onboarding tone
 */
export function verifyOnboardingMessages(
  response: AgentResponse,
  expected: {
    messageCountRange?: [number, number];
    maxLength?: number;
    noExclamations?: boolean;
    mentionsField?: string; // Check if message mentions a specific field
    includesVerificationEmail?: boolean;
  }
) {
  const errors: string[] = [];

  if (!response.messages) {
    throw new Error('response.messages is undefined - agent did not return messages');
  }

  const messageCount = response.messages.length;

  // Verify message count range
  if (expected.messageCountRange) {
    const [min, max] = expected.messageCountRange;
    if (messageCount < min || messageCount > max) {
      errors.push(`Expected ${min}-${max} messages, got ${messageCount}`);
    }
  }

  // Verify max length
  if (expected.maxLength) {
    for (let i = 0; i < response.messages.length; i++) {
      if (response.messages[i].length > expected.maxLength) {
        errors.push(`Message ${i + 1} exceeds ${expected.maxLength} characters (${response.messages[i].length})`);
      }
    }
  }

  // Verify no exclamation points (professional tone)
  if (expected.noExclamations) {
    for (let i = 0; i < response.messages.length; i++) {
      if (response.messages[i].includes('!')) {
        errors.push(`Message ${i + 1} contains exclamation point: "${response.messages[i]}"`);
      }
    }
  }

  // Verify field is mentioned
  if (expected.mentionsField) {
    const allText = response.messages.join(' ').toLowerCase();
    const fieldLower = expected.mentionsField.toLowerCase();
    if (!allText.includes(fieldLower)) {
      errors.push(`Messages do not mention expected field: "${expected.mentionsField}"`);
    }
  }

  // Verify verification email is included
  if (expected.includesVerificationEmail) {
    const allText = response.messages.join(' ');
    if (!allText.includes('verify-') || !allText.includes('@verify.yachtparty.xyz')) {
      errors.push('Messages do not include verification email address');
    }
  }

  // Verify messages are not empty
  for (let i = 0; i < response.messages.length; i++) {
    if (!response.messages[i] || response.messages[i].trim().length === 0) {
      errors.push(`Message ${i + 1} is empty`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Onboarding Messages Verification Failed:\n${errors.join('\n')}`);
  }

  return true;
}

/**
 * Verify action has expected parameters
 */
export function verifyActionParams(
  response: AgentResponse,
  actionType: AgentActionType,
  expectedParams: Record<string, any>
) {
  const action = response.actions.find(a => a.type === actionType);

  if (!action) {
    throw new Error(`Action type '${actionType}' not found in response`);
  }

  const errors: string[] = [];

  for (const [key, expectedValue] of Object.entries(expectedParams)) {
    const actualValue = action.params[key];

    if (typeof expectedValue === 'object' && expectedValue !== null) {
      // Deep comparison for objects
      if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
        errors.push(`Param '${key}': expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`);
      }
    } else {
      // Simple comparison for primitives
      if (actualValue !== expectedValue) {
        errors.push(`Param '${key}': expected ${expectedValue}, got ${actualValue}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Action Params Verification Failed for '${actionType}':\n${errors.join('\n')}`);
  }

  return true;
}

/**
 * Verify user.verified event was published
 */
export function verifyUserVerifiedEvent(response: AgentResponse) {
  if (!response.events || response.events.length === 0) {
    throw new Error('No events published');
  }

  const verifiedEvent = response.events.find(e => e.event_type === 'user.verified');

  if (!verifiedEvent) {
    throw new Error('user.verified event not found');
  }

  if (!verifiedEvent.payload?.userId) {
    throw new Error('user.verified event missing userId in payload');
  }

  return true;
}

/**
 * Verify re-engagement task was created
 */
export function verifyReengagementTaskCreated(response: AgentResponse) {
  const taskAction = response.actions.find(a => a.type === 'create_task');

  if (!taskAction) {
    throw new Error('No create_task action found');
  }

  if (!taskAction.params?.task_type || taskAction.params.task_type !== 're_engagement_check') {
    throw new Error(`Expected task_type='re_engagement_check', got '${taskAction.params?.task_type}'`);
  }

  return true;
}

/**
 * Verify referrer was set correctly
 */
export function verifyReferrerSet(response: AgentResponse, expectedReferrerId: string) {
  const referrerAction = response.actions.find(a => a.type === 'set_referrer');

  if (!referrerAction) {
    throw new Error('No set_referrer action found');
  }

  if (referrerAction.params.referred_by !== expectedReferrerId) {
    throw new Error(`Expected referred_by='${expectedReferrerId}', got '${referrerAction.params.referred_by}'`);
  }

  return true;
}

/**
 * Verify name was stored in name_dropped field
 */
export function verifyNameDroppedStored(response: AgentResponse, expectedName: string) {
  const nameDroppedAction = response.actions.find(a => a.type === 'store_name_dropped');

  if (!nameDroppedAction) {
    throw new Error('No store_name_dropped action found');
  }

  if (nameDroppedAction.params.name_dropped !== expectedName) {
    throw new Error(`Expected name_dropped='${expectedName}', got '${nameDroppedAction.params.name_dropped}'`);
  }

  return true;
}

/**
 * Verify nomination was stored
 */
export function verifyNominationStored(response: AgentResponse) {
  const introAction = response.actions.find(a => a.type === 'show_intro_opportunity');

  if (!introAction) {
    throw new Error('No show_intro_opportunity action found');
  }

  if (!introAction.params.intro_opportunity_id) {
    throw new Error('show_intro_opportunity missing intro_opportunity_id');
  }

  if (!introAction.params.nomination) {
    throw new Error('show_intro_opportunity missing nomination');
  }

  return true;
}

/**
 * Check if tone is welcoming and professional (not overeager)
 */
export function checkToneWelcomingProfessional(message: string): boolean {
  const overEagerPatterns = [
    /awesome/i,
    /amazing/i,
    /excited/i,
    /can't wait/i,
    /so glad/i,
    /wonderful/i,
  ];

  for (const pattern of overEagerPatterns) {
    if (pattern.test(message)) {
      return false;
    }
  }

  return true;
}

/**
 * Check if message is concise (under 3 sentences typically)
 */
export function checkMessageConcise(message: string): boolean {
  const sentences = message.split(/[.!?]+/).filter(s => s.trim().length > 0);
  return sentences.length <= 4; // Allow some flexibility
}

/**
 * Verify email verification flow
 */
export function verifyEmailVerificationFlow(response: AgentResponse, userId: string) {
  const errors: string[] = [];

  // Check for verification task action
  const verificationAction = response.actions.find(a => a.type === 'create_verification_task');
  if (!verificationAction) {
    errors.push('No create_verification_task action found');
  } else {
    // Verify parameters
    if (verificationAction.params.user_id !== userId) {
      errors.push(`Expected user_id='${userId}', got '${verificationAction.params.user_id}'`);
    }

    if (!verificationAction.params.verification_email) {
      errors.push('Missing verification_email in params');
    } else {
      // Verify email format
      const email = verificationAction.params.verification_email;
      if (!email.startsWith('verify-') || !email.endsWith('@verify.yachtparty.xyz')) {
        errors.push(`Invalid verification email format: ${email}`);
      }
    }
  }

  // Check messages include verification email
  if (response.messages && response.messages.length > 0) {
    const allText = response.messages.join(' ');
    if (!allText.includes('verify-') || !allText.includes('@verify.yachtparty.xyz')) {
      errors.push('Messages do not include verification email address');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Email Verification Flow Verification Failed:\n${errors.join('\n')}`);
  }

  return true;
}

/**
 * Verify onboarding completion
 */
export function verifyOnboardingComplete(response: AgentResponse, userId: string) {
  const errors: string[] = [];

  // Check for mark_user_verified action
  const verifiedAction = response.actions.find(a => a.type === 'mark_user_verified');
  if (!verifiedAction) {
    errors.push('No mark_user_verified action found');
  } else {
    if (verifiedAction.params.user_id !== userId) {
      errors.push(`Expected user_id='${userId}', got '${verifiedAction.params.user_id}'`);
    }
    if (!verifiedAction.params.verified_at) {
      errors.push('Missing verified_at timestamp');
    }
  }

  // Check for user.verified event
  if (!response.events || response.events.length === 0) {
    errors.push('No events published');
  } else {
    const verifiedEvent = response.events.find(e => e.event_type === 'user.verified');
    if (!verifiedEvent) {
      errors.push('user.verified event not found');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Onboarding Completion Verification Failed:\n${errors.join('\n')}`);
  }

  return true;
}

/**
 * Helper to check if user info was collected
 */
export function verifyUserInfoCollected(
  response: AgentResponse,
  expectedFields: string[]
) {
  const updateAction = response.actions.find(a => a.type === 'update_user_field');

  if (!updateAction) {
    throw new Error('No update_user_field action found');
  }

  const errors: string[] = [];
  const collectedFields = Object.keys(updateAction.params.fields || {});

  for (const field of expectedFields) {
    if (!collectedFields.includes(field)) {
      errors.push(`Expected field '${field}' not collected`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`User Info Collection Verification Failed:\n${errors.join('\n')}`);
  }

  return true;
}
