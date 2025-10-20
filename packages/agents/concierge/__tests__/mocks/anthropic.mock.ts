/**
 * Anthropic API Mock Utilities
 *
 * Provides utilities to mock Anthropic API responses for testing
 * the 2-LLM architecture (Call 1 and Call 2).
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { Call1Output, ReengagementDecisionOutput } from '../../src/decision';

/**
 * Mock Call 1 Response (Decision)
 *
 * Returns a mock Anthropic response that looks like Call 1 output.
 */
export function mockCall1Response(decision: Call1Output): Anthropic.Messages.Message {
  const jsonContent = JSON.stringify(decision, null, 2);

  return {
    id: 'msg_test_call1',
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: `\`\`\`json\n${jsonContent}\n\`\`\``,
      },
    ],
    model: 'claude-sonnet-4-20250514',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 500,
      output_tokens: 200,
    },
  };
}

/**
 * Mock Call 1 Re-engagement Response
 */
export function mockReengagementDecisionResponse(
  decision: ReengagementDecisionOutput
): Anthropic.Messages.Message {
  const jsonContent = JSON.stringify(decision, null, 2);

  return {
    id: 'msg_test_reengagement_call1',
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: `\`\`\`json\n${jsonContent}\n\`\`\``,
      },
    ],
    model: 'claude-sonnet-4-20250514',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 1000,
      output_tokens: 400,
    },
  };
}

/**
 * Mock Call 2 Response (Personality)
 *
 * Returns a mock Anthropic response with message text.
 */
export function mockCall2Response(messageText: string): Anthropic.Messages.Message {
  return {
    id: 'msg_test_call2',
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: messageText,
      },
    ],
    model: 'claude-sonnet-4-20250514',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 600,
      output_tokens: 100,
    },
  };
}

/**
 * Mock Call 2 Response with Message Sequence
 *
 * Returns a mock response with multiple messages separated by "---".
 */
export function mockCall2SequenceResponse(messages: string[]): Anthropic.Messages.Message {
  const messageText = messages.join('\n---\n');
  return mockCall2Response(messageText);
}

/**
 * Create a mock Anthropic client
 *
 * This allows you to control what responses are returned for Call 1 and Call 2.
 */
export function createMockAnthropicClient(responses: {
  call1?: Call1Output | ReengagementDecisionOutput;
  call2?: string | string[];
}): jest.Mocked<Anthropic> {
  const mockCreate = jest.fn();

  // First call (Call 1 - Decision)
  if (responses.call1) {
    const isReengagement = 'should_message' in responses.call1;
    mockCreate.mockResolvedValueOnce(
      isReengagement
        ? mockReengagementDecisionResponse(responses.call1 as ReengagementDecisionOutput)
        : mockCall1Response(responses.call1 as Call1Output)
    );
  }

  // Second call (Call 2 - Personality)
  if (responses.call2) {
    if (Array.isArray(responses.call2)) {
      mockCreate.mockResolvedValueOnce(mockCall2SequenceResponse(responses.call2));
    } else {
      mockCreate.mockResolvedValueOnce(mockCall2Response(responses.call2));
    }
  }

  return {
    messages: {
      create: mockCreate,
    },
  } as any;
}

/**
 * Verify Call 1 was invoked correctly
 */
export function verifyCall1Invocation(
  mockCreate: jest.Mock,
  expectedConfig: {
    temperature?: number;
    maxTokens?: number;
    systemPromptIncludes?: string;
    userMessage?: string;
  }
) {
  const call1Invocation = mockCreate.mock.calls[0][0];

  if (expectedConfig.temperature !== undefined) {
    expect(call1Invocation.temperature).toBe(expectedConfig.temperature);
  }

  if (expectedConfig.maxTokens !== undefined) {
    expect(call1Invocation.max_tokens).toBeGreaterThanOrEqual(expectedConfig.maxTokens);
  }

  if (expectedConfig.systemPromptIncludes) {
    const systemPrompt = Array.isArray(call1Invocation.system)
      ? call1Invocation.system[0].text
      : call1Invocation.system;
    expect(systemPrompt).toContain(expectedConfig.systemPromptIncludes);
  }

  if (expectedConfig.userMessage) {
    const userMsg = call1Invocation.messages.find((m: any) => m.role === 'user');
    expect(userMsg.content).toContain(expectedConfig.userMessage);
  }
}

/**
 * Verify Call 2 was invoked correctly
 */
export function verifyCall2Invocation(
  mockCreate: jest.Mock,
  expectedConfig: {
    temperature?: number;
    maxTokens?: number;
    systemPromptIncludes?: string;
  }
) {
  const call2Invocation = mockCreate.mock.calls[1][0];

  if (expectedConfig.temperature !== undefined) {
    expect(call2Invocation.temperature).toBe(expectedConfig.temperature);
  }

  if (expectedConfig.maxTokens !== undefined) {
    expect(call2Invocation.max_tokens).toBeGreaterThanOrEqual(expectedConfig.maxTokens);
  }

  if (expectedConfig.systemPromptIncludes) {
    const systemPrompt = Array.isArray(call2Invocation.system)
      ? call2Invocation.system[0].text
      : call2Invocation.system;
    expect(systemPrompt).toContain(expectedConfig.systemPromptIncludes);
  }
}
