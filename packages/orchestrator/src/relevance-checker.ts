/**
 * Message Relevance Checker
 *
 * Uses LLM to determine if a queued message is still relevant
 * given the user's recent conversation context.
 *
 * Classifications:
 * - RELEVANT: Message still makes sense, send it
 * - STALE: User changed topic, message no longer appropriate
 * - CONTEXTUAL: Message provides helpful context for user's new question
 */

import Anthropic from '@anthropic-ai/sdk';
import { SupabaseClient } from '@supabase/supabase-js';

export interface RelevanceResult {
  relevant: boolean;
  shouldReformulate: boolean;
  reason: string;
  classification: 'RELEVANT' | 'STALE' | 'CONTEXTUAL';
}

export interface QueuedMessage {
  id: string;
  user_id: string;
  message_data: any;
  created_at: string;
  scheduled_for: string;
}

export interface Message {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

export class RelevanceChecker {
  private anthropic: Anthropic;
  private supabase: SupabaseClient;

  constructor(anthropic: Anthropic, supabase: SupabaseClient) {
    this.anthropic = anthropic;
    this.supabase = supabase;
  }

  /**
   * Check if a queued message is still relevant given recent conversation context
   */
  async checkMessageRelevance(message: QueuedMessage): Promise<RelevanceResult> {
    try {
      // Get user's messages since this message was queued
      const recentMessages = await this.getRecentMessages(
        message.user_id,
        message.created_at
      );

      // If no new messages, message is still relevant
      if (recentMessages.length === 0) {
        return {
          relevant: true,
          shouldReformulate: false,
          reason: 'no_new_context',
          classification: 'RELEVANT'
        };
      }

      // Use LLM to classify relevance
      const decision = await this.classifyRelevance(message, recentMessages);

      return {
        relevant: decision.classification !== 'STALE',
        shouldReformulate: decision.shouldReformulate,
        reason: decision.reason,
        classification: decision.classification
      };
    } catch (error) {
      console.error('Error checking message relevance:', error);
      // Default to relevant on error to avoid blocking
      return {
        relevant: true,
        shouldReformulate: false,
        reason: 'error_defaulting_to_relevant',
        classification: 'RELEVANT'
      };
    }
  }

  /**
   * Get user's messages since a specific timestamp
   */
  private async getRecentMessages(
    userId: string,
    sinceTimestamp: string
  ): Promise<Message[]> {
    const { data, error } = await this.supabase
      .from('messages')
      .select('id, role, content, created_at')
      .eq('user_id', userId)
      .gte('created_at', sinceTimestamp) // Messages AFTER queued message
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) {
      console.error('Error fetching recent messages:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Use LLM to classify message relevance
   */
  private async classifyRelevance(
    queuedMessage: QueuedMessage,
    recentMessages: Message[]
  ): Promise<{
    classification: 'RELEVANT' | 'STALE' | 'CONTEXTUAL';
    shouldReformulate: boolean;
    reason: string;
  }> {
    const prompt = this.buildRelevancePrompt(queuedMessage, recentMessages);

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        temperature: 0.2, // Lower temperature for more consistent classification
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Claude');
      }

      // Parse JSON response
      const decision = JSON.parse(content.text);

      // Validate response structure
      if (
        !decision.classification ||
        !['RELEVANT', 'STALE', 'CONTEXTUAL'].includes(decision.classification)
      ) {
        throw new Error('Invalid classification from Claude');
      }

      return {
        classification: decision.classification,
        shouldReformulate: decision.shouldReformulate || false,
        reason: decision.reason || 'no_reason_provided'
      };
    } catch (error) {
      console.error('Error calling Claude for relevance check:', error);
      // Default to RELEVANT on error
      return {
        classification: 'RELEVANT',
        shouldReformulate: false,
        reason: 'error_in_llm_call'
      };
    }
  }

  /**
   * Build prompt for relevance classification
   */
  private buildRelevancePrompt(
    queuedMessage: QueuedMessage,
    recentMessages: Message[]
  ): string {
    const messagesContext = recentMessages
      .reverse() // Chronological order
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    return `Classify queued message relevance given recent conversation context.

QUEUED MESSAGE (waiting to send):
Created at: ${queuedMessage.created_at}
Message data: ${JSON.stringify(queuedMessage.message_data, null, 2)}

USER'S MESSAGES SINCE THIS WAS QUEUED:
${messagesContext}

TASK:
Determine if the queued message is still relevant given the user's recent messages.

CLASSIFICATION RULES:
- RELEVANT: Message still makes sense in current context, user hasn't changed topics
- STALE: User clearly changed topics, message would be confusing or unhelpful
- CONTEXTUAL: Message provides helpful background for user's new question/direction

REFORMULATION:
Should we reformulate the message to better fit current context? Only if CONTEXTUAL and message needs updating.

Return ONLY valid JSON (no markdown, no extra text):
{
  "classification": "RELEVANT" | "STALE" | "CONTEXTUAL",
  "shouldReformulate": boolean,
  "reason": "brief explanation (max 50 words)"
}`;
  }

  /**
   * Batch check multiple messages for relevance
   * (More efficient than individual checks)
   */
  async batchCheckRelevance(
    messages: QueuedMessage[]
  ): Promise<Map<string, RelevanceResult>> {
    const results = new Map<string, RelevanceResult>();

    // Check messages sequentially to avoid rate limits
    // TODO: Optimize with batching if Claude supports it
    for (const message of messages) {
      const result = await this.checkMessageRelevance(message);
      results.set(message.id, result);
    }

    return results;
  }

  /**
   * Log relevance check to database for monitoring
   */
  async logRelevanceCheck(
    messageId: string,
    result: RelevanceResult,
    inputTokens: number,
    outputTokens: number
  ): Promise<void> {
    try {
      await this.supabase.from('agent_actions_log').insert({
        agent_type: 'message_orchestrator',
        action_type: 'relevance_check',
        model_used: 'claude-sonnet-4-20250514',
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: this.calculateCost(inputTokens, outputTokens),
        input_data: { message_id: messageId },
        output_data: result
      });
    } catch (error) {
      console.error('Error logging relevance check:', error);
    }
  }

  /**
   * Calculate cost for Claude API call
   * Sonnet 4: $3 per million input tokens, $15 per million output tokens
   */
  private calculateCost(inputTokens: number, outputTokens: number): number {
    const inputCost = (inputTokens / 1_000_000) * 3.0;
    const outputCost = (outputTokens / 1_000_000) * 15.0;
    return inputCost + outputCost;
  }
}
