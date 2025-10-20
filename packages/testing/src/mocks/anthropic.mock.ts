/**
 * Anthropic Claude API Mock Implementation
 *
 * Mocks Claude API for testing LLM-powered agents.
 * Provides configurable responses and token usage tracking.
 */

interface MockResponse {
  pattern?: RegExp;
  response: any;
  tokens?: { input: number; output: number };
}

interface LLMCall {
  model: string;
  messages: any[];
  system?: any;
  max_tokens: number;
  temperature?: number;
  response: any;
  timestamp: Date;
}

class MockAnthropicClient {
  private responses: MockResponse[] = [];
  private calls: LLMCall[] = [];
  private defaultResponse: any;
  private totalInputTokens: number = 0;
  private totalOutputTokens: number = 0;

  constructor() {
    this.reset();
  }

  /**
   * Reset mock state
   */
  reset() {
    this.responses = [];
    this.calls = [];
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.setDefaultResponse();
  }

  /**
   * Set default response for unmatched requests
   */
  setDefaultResponse() {
    this.defaultResponse = {
      id: 'msg_default',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            message: 'Default mock response',
            reasoning: 'No specific mock configured',
          }),
        },
      ],
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    };
  }

  /**
   * Mock messages.create()
   */
  get messages() {
    return {
      create: async (params: {
        model: string;
        messages: any[];
        system?: any;
        max_tokens: number;
        temperature?: number;
      }): Promise<any> => {
        // Find matching response
        const userMessage =
          params.messages[params.messages.length - 1]?.content;
        const matchedResponse = this.findMatchingResponse(userMessage);

        const response = matchedResponse || this.defaultResponse;

        // Track token usage
        this.totalInputTokens += response.usage.input_tokens;
        this.totalOutputTokens += response.usage.output_tokens;

        // Record call
        this.calls.push({
          model: params.model,
          messages: params.messages,
          system: params.system,
          max_tokens: params.max_tokens,
          temperature: params.temperature,
          response,
          timestamp: new Date(),
        });

        return response;
      },
    };
  }

  /**
   * Configure a mock response for a specific prompt pattern
   */
  mockResponse(pattern: string | RegExp, response: any) {
    this.responses.push({
      pattern: typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern,
      response: this.formatResponse(response),
    });
  }

  /**
   * Configure response for Bouncer information extraction
   */
  mockBouncerExtraction(extractedFields: any) {
    this.mockResponse(/extract.*information/i, {
      extracted_fields: extractedFields,
      confidence: 'high',
      needs_clarification: false,
    });
  }

  /**
   * Configure response for Bouncer message generation
   */
  mockBouncerResponse(message: string) {
    this.mockResponse(/generate.*response/i, {
      message,
      next_action: 'collect_info',
      reasoning: 'Continuing onboarding process',
    });
  }

  /**
   * Configure response for Concierge intent classification
   */
  mockConciergeIntent(intent: string, extractedData?: any) {
    this.mockResponse(/classify.*intent/i, {
      intent,
      extracted_data: extractedData || {},
      confidence: 'high',
    });
  }

  /**
   * Configure response for Concierge message rendering
   */
  mockConciergeMessage(message: string) {
    this.mockResponse(/conversational.*message/i, message);
  }

  /**
   * Configure response for Message Orchestrator relevance check
   */
  mockRelevanceCheck(relevant: boolean, reason: string) {
    this.mockResponse(/relevant|stale/i, {
      classification: relevant ? 'RELEVANT' : 'STALE',
      reasoning: reason,
      should_reformulate: !relevant,
    });
  }

  /**
   * Find matching response for a prompt
   */
  private findMatchingResponse(prompt: string): any | null {
    for (const mockResponse of this.responses) {
      if (mockResponse.pattern && mockResponse.pattern.test(prompt)) {
        return mockResponse.response;
      }
    }
    return null;
  }

  /**
   * Format response data into Claude API format
   */
  private formatResponse(data: any): any {
    const isString = typeof data === 'string';
    const content = isString ? data : JSON.stringify(data);

    return {
      id: `msg_${Math.random().toString(36).substr(2, 9)}`,
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: content,
        },
      ],
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: Math.floor(content.length / 4) + 100,
        output_tokens: Math.floor(content.length / 4),
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    };
  }

  /**
   * Get all API calls made
   */
  getCalls(): LLMCall[] {
    return [...this.calls];
  }

  /**
   * Get last API call
   */
  getLastCall(): LLMCall | null {
    return this.calls[this.calls.length - 1] || null;
  }

  /**
   * Get total token usage
   */
  getTokenUsage(): { input: number; output: number; total: number } {
    return {
      input: this.totalInputTokens,
      output: this.totalOutputTokens,
      total: this.totalInputTokens + this.totalOutputTokens,
    };
  }

  /**
   * Get estimated cost (USD)
   */
  getEstimatedCost(): number {
    // Claude Sonnet 4 pricing:
    // Input: $0.003 per 1K tokens
    // Output: $0.015 per 1K tokens
    const inputCost = (this.totalInputTokens / 1000) * 0.003;
    const outputCost = (this.totalOutputTokens / 1000) * 0.015;
    return inputCost + outputCost;
  }

  /**
   * Get call count
   */
  getCallCount(): number {
    return this.calls.length;
  }

  /**
   * Clear call history
   */
  clearCallHistory() {
    this.calls = [];
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
  }

  /**
   * Assert that specific prompt was called
   */
  assertPromptCalled(pattern: string | RegExp): boolean {
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;

    return this.calls.some((call) => {
      const lastMessage = call.messages[call.messages.length - 1];
      return regex.test(lastMessage?.content || '');
    });
  }

  /**
   * Get calls matching a pattern
   */
  getCallsMatching(pattern: string | RegExp): LLMCall[] {
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;

    return this.calls.filter((call) => {
      const lastMessage = call.messages[call.messages.length - 1];
      return regex.test(lastMessage?.content || '');
    });
  }
}

// Export singleton instance
export const mockAnthropic = new MockAnthropicClient();

/**
 * Reset mock to initial state
 */
export function resetAnthropicMock() {
  mockAnthropic.reset();
}

/**
 * Create a mock Anthropic client (for dependency injection)
 */
export function createMockAnthropicClient(): any {
  return mockAnthropic;
}

// Type declarations
declare global {
  var mockAnthropic: MockAnthropicClient;
}

export type { LLMCall };
