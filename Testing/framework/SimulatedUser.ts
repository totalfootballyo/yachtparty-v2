/**
 * Simulated User
 *
 * Uses Claude API to simulate realistic user responses based on persona.
 * Each persona has a distinct personality, communication style, and behavior pattern.
 */

import Anthropic from '@anthropic-ai/sdk';

export interface SimulatedPersona {
  name: string;
  personality: string;
  systemPrompt: string;
  initialContext: {
    referrer?: string;
    company?: string;
    expertise?: string;
    title?: string;
  };
}

export class SimulatedUser {
  private anthropic: Anthropic;
  private persona: SimulatedPersona;
  private conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  constructor(persona: SimulatedPersona) {
    this.persona = persona;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable required for SimulatedUser');
    }

    this.anthropic = new Anthropic({ apiKey });
  }

  /**
   * Simulates user response to agent message.
   * Returns what the user would type in response.
   *
   * @param agentMessage - The message from the agent
   * @returns Simulated user response
   */
  async respondTo(agentMessage: string): Promise<string> {
    // Add agent message to history as 'user' (input to the simulation)
    this.conversationHistory.push({
      role: 'user',
      content: agentMessage
    });

    // Get simulated user response from Claude with retry logic
    let response: Anthropic.Messages.Message | undefined;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      attempts++;

      response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        temperature: 0.8,  // Higher temperature for varied, natural responses
        system: this.persona.systemPrompt,
        messages: this.conversationHistory
      });

      // If we got content, break out of retry loop
      if (response.content && response.content.length > 0) {
        break;
      }

      // If empty response and not last attempt, wait and retry
      if (attempts < maxAttempts) {
        console.warn(`Simulated user response empty (attempt ${attempts}/${maxAttempts}), retrying...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempts)); // Exponential backoff
      }
    }

    // Extract text content from response
    if (!response || !response.content || response.content.length === 0) {
      console.error('Simulated user response has no content after retries:', JSON.stringify(response, null, 2));
      throw new Error('Simulated user response has no content after 3 attempts');
    }

    const textBlock = response.content.find(block => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      console.error('No text block in simulated user response:', JSON.stringify(response.content, null, 2));
      throw new Error('No text content in simulated user response');
    }

    const userMessage = textBlock.text;

    // Add user response to history as 'assistant' (output from the simulation)
    this.conversationHistory.push({
      role: 'assistant',
      content: userMessage
    });

    return userMessage;
  }

  /**
   * Gets the first message the user would send to start the conversation.
   * Usually something like "hi" or "hey" with optional context.
   */
  async getInitialMessage(): Promise<string> {
    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 100,
      temperature: 0.8,
      system: this.persona.systemPrompt,
      messages: [{
        role: 'user',
        content: 'You are starting a new conversation with a professional networking service. Send your first message to start the conversation. Keep it brief and natural.'
      }]
    });

    const initialMessage = response.content[0].type === 'text'
      ? response.content[0].text
      : 'hi';

    // Add to history as 'assistant' (output from the simulation)
    this.conversationHistory.push({
      role: 'assistant',
      content: initialMessage
    });

    return initialMessage;
  }

  /**
   * Resets the conversation history for this simulated user.
   * Useful for running multiple test scenarios with the same persona.
   */
  reset(): void {
    this.conversationHistory = [];
  }

  /**
   * Gets the current conversation history.
   */
  getHistory(): Array<{ role: 'user' | 'assistant'; content: string }> {
    return [...this.conversationHistory];
  }

  /**
   * Gets the persona being simulated.
   */
  getPersona(): SimulatedPersona {
    return this.persona;
  }
}
