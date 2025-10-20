/**
 * 2-LLM Verification Helpers for Concierge Agent Testing
 *
 * Provides assertion helpers to verify correct behavior of:
 * - Call 1 (Decision): Tool selection, scenario choice, context for Call 2
 * - Call 2 (Personality): Message composition, sequence parsing, tone
 * - Re-engagement Logic: Should message decisions, extend_days
 */

import type { Call1Output, ReengagementDecisionOutput } from '../src/decision';
import type { AgentResponse, AgentActionType } from '@yachtparty/shared';

/**
 * Verify Call 1 Decision Output (User Message)
 */
export function verifyCall1Decision(
  decision: Call1Output,
  expected: {
    tools?: string[]; // Expected tool names
    scenario?: Call1Output['next_scenario']; // Expected scenario
    tone?: Call1Output['context_for_call_2']['tone']; // Expected tone
    hasPrimaryTopic?: boolean; // Should have primary_topic
  }
) {
  const errors: string[] = [];

  // Verify tools
  if (expected.tools) {
    const actualTools = decision.tools_to_execute.map(t => t.tool_name);
    const missingTools = expected.tools.filter(t => !actualTools.includes(t));
    const extraTools = actualTools.filter(t => !expected.tools!.includes(t));

    if (missingTools.length > 0) {
      errors.push(`Missing expected tools: ${missingTools.join(', ')}`);
    }
    if (extraTools.length > 0) {
      errors.push(`Unexpected tools selected: ${extraTools.join(', ')}`);
    }
  }

  // Verify scenario
  if (expected.scenario && decision.next_scenario !== expected.scenario) {
    errors.push(`Expected scenario '${expected.scenario}', got '${decision.next_scenario}'`);
  }

  // Verify tone
  if (expected.tone && decision.context_for_call_2.tone !== expected.tone) {
    errors.push(`Expected tone '${expected.tone}', got '${decision.context_for_call_2.tone}'`);
  }

  // Verify primary topic exists
  if (expected.hasPrimaryTopic) {
    if (!decision.context_for_call_2.primary_topic || decision.context_for_call_2.primary_topic.trim().length === 0) {
      errors.push('Missing primary_topic in context_for_call_2');
    }
  }

  // Verify tool parameters are complete
  for (const tool of decision.tools_to_execute) {
    if (!tool.tool_name) {
      errors.push('Tool missing tool_name');
    }
    if (!tool.params || Object.keys(tool.params).length === 0) {
      errors.push(`Tool '${tool.tool_name}' missing params`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Call 1 Decision Verification Failed:\n${errors.join('\n')}`);
  }

  return true;
}

/**
 * Verify Call 1 Re-engagement Decision Output
 */
export function verifyReengagementDecision(
  decision: ReengagementDecisionOutput,
  expected: {
    shouldMessage?: boolean; // Should the agent message the user?
    extendDaysRange?: [number, number]; // Expected range if not messaging
    threadsMin?: number; // Minimum threads to address if messaging
    threadsMax?: number; // Maximum threads to address if messaging
    scenario?: Call1Output['next_scenario']; // Expected scenario
    messageStructure?: 'single' | 'sequence_2' | 'sequence_3'; // Expected message structure
  }
) {
  const errors: string[] = [];

  // Verify should_message decision
  if (expected.shouldMessage !== undefined && decision.should_message !== expected.shouldMessage) {
    errors.push(`Expected should_message=${expected.shouldMessage}, got ${decision.should_message}`);
  }

  // Verify extend_days range (if not messaging)
  if (!decision.should_message && expected.extendDaysRange) {
    const [min, max] = expected.extendDaysRange;
    const extendDays = decision.extend_days || 0;
    if (extendDays < min || extendDays > max) {
      errors.push(`Expected extend_days between ${min}-${max}, got ${extendDays}`);
    }
  }

  // Verify reasoning exists (if not messaging)
  if (!decision.should_message && !decision.reasoning) {
    errors.push('Missing reasoning for not messaging');
  }

  // Verify threads to address (if messaging)
  if (decision.should_message) {
    const threadCount = decision.threads_to_address?.length || 0;

    if (expected.threadsMin !== undefined && threadCount < expected.threadsMin) {
      errors.push(`Expected at least ${expected.threadsMin} threads, got ${threadCount}`);
    }

    if (expected.threadsMax !== undefined && threadCount > expected.threadsMax) {
      errors.push(`Expected at most ${expected.threadsMax} threads, got ${threadCount}`);
    }

    // Verify threads have required fields
    if (decision.threads_to_address) {
      for (const thread of decision.threads_to_address) {
        if (!thread.type) errors.push('Thread missing type');
        if (!thread.item_id) errors.push('Thread missing item_id');
        if (!thread.priority) errors.push('Thread missing priority');
        if (!thread.message_guidance) errors.push('Thread missing message_guidance');
      }
    }
  }

  // Verify scenario
  if (expected.scenario && decision.next_scenario !== expected.scenario) {
    errors.push(`Expected scenario '${expected.scenario}', got '${decision.next_scenario}'`);
  }

  // Verify message structure (if messaging)
  if (decision.should_message && expected.messageStructure) {
    const actualStructure = decision.context_for_call_2?.message_structure;
    if (actualStructure !== expected.messageStructure) {
      errors.push(`Expected message_structure '${expected.messageStructure}', got '${actualStructure}'`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Re-engagement Decision Verification Failed:\n${errors.join('\n')}`);
  }

  return true;
}

/**
 * Verify Call 2 Messages Output
 */
export function verifyCall2Messages(
  response: AgentResponse,
  expected: {
    messageCount?: number; // Expected number of messages
    messageCountRange?: [number, number]; // Expected range
    hasSequences?: boolean; // Should messages be in sequence?
    toneCheck?: (msg: string) => boolean; // Custom tone validator
    noExclamations?: boolean; // Should not have exclamation points
    maxLength?: number; // Max characters per message
  }
) {
  const errors: string[] = [];

  // Guard: messages should be defined
  if (!response.messages) {
    throw new Error('response.messages is undefined - agent did not return messages');
  }

  const messageCount = response.messages.length;

  // Verify message count
  if (expected.messageCount !== undefined && messageCount !== expected.messageCount) {
    errors.push(`Expected ${expected.messageCount} messages, got ${messageCount}`);
  }

  // Verify message count range
  if (expected.messageCountRange) {
    const [min, max] = expected.messageCountRange;
    if (messageCount < min || messageCount > max) {
      errors.push(`Expected ${min}-${max} messages, got ${messageCount}`);
    }
  }

  // Verify sequences
  if (expected.hasSequences && messageCount === 1) {
    errors.push('Expected message sequences, but only 1 message returned');
  }

  // Verify no exclamation points
  if (expected.noExclamations) {
    for (let i = 0; i < response.messages.length; i++) {
      if (response.messages[i].includes('!')) {
        errors.push(`Message ${i + 1} contains exclamation point: "${response.messages[i]}"`);
      }
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

  // Verify tone with custom checker
  if (expected.toneCheck) {
    for (let i = 0; i < response.messages.length; i++) {
      if (!expected.toneCheck(response.messages[i])) {
        errors.push(`Message ${i + 1} failed tone check: "${response.messages[i]}"`);
      }
    }
  }

  // Verify messages are not empty
  for (let i = 0; i < response.messages.length; i++) {
    if (!response.messages[i] || response.messages[i].trim().length === 0) {
      errors.push(`Message ${i + 1} is empty`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Call 2 Messages Verification Failed:\n${errors.join('\n')}`);
  }

  return true;
}

/**
 * Check if message contains hallucinated introductions
 */
export function checkNoHallucinatedIntros(messages: string[]): boolean {
  // Common patterns that suggest hallucination
  const hallucinationPatterns = [
    /I can connect you with \w+/i,
    /I'll connect you with \w+/i,
    /I know someone at \w+/i,
    /\w+ at \w+ (would be|is) great for/i,
  ];

  for (const message of messages) {
    for (const pattern of hallucinationPatterns) {
      if (pattern.test(message)) {
        return false; // Found hallucination
      }
    }
  }

  return true; // No hallucinations found
}

/**
 * Verify Agent Response Structure
 */
export function verifyAgentResponse(
  response: AgentResponse,
  expected: {
    immediateReply?: boolean;
    hasMessages?: boolean;
    hasActions?: boolean;
    actionTypes?: AgentActionType[]; // Expected action types
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

  if (errors.length > 0) {
    throw new Error(`Agent Response Verification Failed:\n${errors.join('\n')}`);
  }

  return true;
}

/**
 * Helper to check if tone is appropriate (helpful, not overeager)
 */
export function checkToneHelpfulNotOvereager(message: string): boolean {
  const overEagerPatterns = [
    /awesome/i,
    /amazing/i,
    /excited/i,
    /can't wait/i,
    /so glad/i,
  ];

  for (const pattern of overEagerPatterns) {
    if (pattern.test(message)) {
      return false;
    }
  }

  return true;
}

/**
 * Helper to check if tone is brief (under 3 sentences typically)
 */
export function checkToneBrief(message: string): boolean {
  const sentences = message.split(/[.!?]+/).filter(s => s.trim().length > 0);
  return sentences.length <= 4; // Allow some flexibility
}
