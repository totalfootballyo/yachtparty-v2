/**
 * Intent Classification Helpers
 *
 * Functions to classify user intent and extract structured data from messages.
 * Uses Claude API to understand what users are asking for.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getIntentClassificationPrompt } from './prompts';

/**
 * User intent types
 */
export type UserIntent =
  | 'general_conversation'
  | 'solution_inquiry'
  | 'intro_request'
  | 'community_question'
  | 'feedback';

/**
 * Intent classification result
 */
export interface IntentClassification {
  intent: UserIntent;
  confidence: number;
  reasoning: string;
  extracted_data: {
    // Solution inquiry
    solution_description?: string;
    category?: 'software' | 'consulting' | 'services' | 'hardware' | 'other';

    // Intro request
    prospect_name?: string;
    prospect_company?: string;
    reason?: string;

    // Community question
    question?: string;
    expertise_needed?: string[];
    requester_context?: string;  // Why they're asking, their situation
    desired_outcome?: 'backchannel' | 'introduction' | 'quick_thoughts' | 'ongoing_advice';
    request_summary?: string;  // Short 3-5 word description

    // Shared fields (used by solution_inquiry and community_question)
    urgency?: 'low' | 'medium' | 'high';
  };
}

/**
 * Classify user intent using Claude API.
 *
 * Determines what the user is asking for and extracts relevant data.
 *
 * @param userMessage - The user's message text
 * @param anthropic - Anthropic SDK client
 * @returns Intent classification with extracted data
 */
export async function classifyUserIntent(
  userMessage: string,
  anthropic: Anthropic
): Promise<IntentClassification> {
  const prompt = getIntentClassificationPrompt(userMessage);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const resultText = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    // Strip markdown code fences if present (Claude sometimes wraps JSON in ```json)
    let cleanedText = resultText.trim();
    if (cleanedText.startsWith('```json')) {
      cleanedText = cleanedText.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    } else if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```\n?/, '').replace(/\n?```$/, '');
    }

    const result = JSON.parse(cleanedText);
    return result as IntentClassification;
  } catch (error) {
    // Fallback if JSON parsing fails
    console.error('Failed to parse intent classification result:', error);
    console.error('Raw response text:', resultText);
    return {
      intent: 'general_conversation',
      confidence: 0.5,
      reasoning: 'Failed to parse LLM response',
      extracted_data: {},
    };
  }
}

/**
 * Extract solution request details from intent classification.
 *
 * @param classification - Intent classification result
 * @returns Solution request details or null if not a solution inquiry
 */
export function extractSolutionRequest(
  classification: IntentClassification
): {
  description: string;
  category?: string;
  urgency?: string;
} | null {
  if (classification.intent !== 'solution_inquiry') {
    return null;
  }

  if (!classification.extracted_data.solution_description) {
    return null;
  }

  return {
    description: classification.extracted_data.solution_description,
    category: classification.extracted_data.category,
    urgency: classification.extracted_data.urgency,
  };
}

/**
 * Extract intro request details from intent classification.
 *
 * @param classification - Intent classification result
 * @returns Intro request details or null if not an intro request
 */
export function extractIntroRequest(
  classification: IntentClassification
): {
  prospect_name?: string;
  prospect_company?: string;
  reason?: string;
} | null {
  if (classification.intent !== 'intro_request') {
    return null;
  }

  return {
    prospect_name: classification.extracted_data.prospect_name,
    prospect_company: classification.extracted_data.prospect_company,
    reason: classification.extracted_data.reason,
  };
}

/**
 * Extract community question details from intent classification.
 *
 * @param classification - Intent classification result
 * @returns Community question details or null if not a community question
 */
export function extractCommunityQuestion(
  classification: IntentClassification
): {
  question: string;
  expertise_needed?: string[];
  requester_context?: string;
  desired_outcome?: 'backchannel' | 'introduction' | 'quick_thoughts' | 'ongoing_advice';
  urgency?: 'low' | 'medium' | 'high';
  request_summary?: string;
} | null {
  if (classification.intent !== 'community_question') {
    return null;
  }

  if (!classification.extracted_data.question) {
    return null;
  }

  return {
    question: classification.extracted_data.question,
    expertise_needed: classification.extracted_data.expertise_needed,
    requester_context: classification.extracted_data.requester_context,
    desired_outcome: classification.extracted_data.desired_outcome,
    urgency: classification.extracted_data.urgency,
    request_summary: classification.extracted_data.request_summary,
  };
}

/**
 * Determine if a message is a simple acknowledgment or greeting.
 *
 * Used to avoid over-processing simple messages like "thanks" or "got it".
 *
 * @param message - User message text
 * @returns True if this is likely a simple acknowledgment
 */
export function isSimpleAcknowledgment(message: string): boolean {
  const normalizedMessage = message.toLowerCase().trim();

  const acknowledgments = [
    'thanks',
    'thank you',
    'got it',
    'ok',
    'okay',
    'sounds good',
    'perfect',
    'great',
    'awesome',
    'cool',
    'yes',
    'yeah',
    'yep',
    'no',
    'nope',
    'nah',
    'hi',
    'hello',
    'hey',
  ];

  // Check if message is just an acknowledgment (with optional punctuation)
  const cleanMessage = normalizedMessage.replace(/[!.?,]/g, '');

  return acknowledgments.includes(cleanMessage);
}

/**
 * Determine if a message indicates user acceptance.
 *
 * Used to detect when user accepts an intro, solution, etc.
 *
 * @param message - User message text
 * @returns True if this indicates acceptance
 */
export function isAcceptanceMessage(message: string): boolean {
  const normalizedMessage = message.toLowerCase().trim();

  const acceptancePatterns = [
    'yes',
    'yeah',
    'yep',
    'sure',
    'sounds good',
    'let\'s do it',
    'i\'m interested',
    'i\'m in',
    'count me in',
    'sign me up',
    'i\'d like that',
    'that would be great',
  ];

  return acceptancePatterns.some((pattern) =>
    normalizedMessage.includes(pattern)
  );
}

/**
 * Determine if a message indicates user rejection.
 *
 * Used to detect when user declines an intro, solution, etc.
 *
 * @param message - User message text
 * @returns True if this indicates rejection
 */
export function isRejectionMessage(message: string): boolean {
  const normalizedMessage = message.toLowerCase().trim();

  const rejectionPatterns = [
    'no thanks',
    'not interested',
    'not right now',
    'maybe later',
    'pass',
    'skip',
    'not for me',
    'nope',
    'nah',
  ];

  return rejectionPatterns.some((pattern) =>
    normalizedMessage.includes(pattern)
  );
}
