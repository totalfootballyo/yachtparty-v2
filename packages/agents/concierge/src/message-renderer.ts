/**
 * Message Rendering from Structured Data
 *
 * Converts structured data from background agents (Solution Saga, Account Manager)
 * into conversational prose using Claude API.
 *
 * Maintains consistent voice and style across all agent-generated messages.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getStructuredDataRenderingPrompt } from './prompts';

/**
 * Solution update structured data from Solution Saga
 */
export interface SolutionUpdateData {
  workflowId: string;
  requestDescription: string;
  findings: {
    summary?: string;
    matchedInnovators?: Array<{
      id: string;
      name: string;
      relevance: number;
      reason: string;
      contactInfo?: any;
    }>;
    potentialVendors?: string[];
    communityInsights?: Array<{
      expertId: string;
      expertName: string;
      recommendation: string;
      usefulness: number;
    }>;
    clarifyingQuestions?: Array<{
      question: string;
      priority: 'low' | 'medium' | 'high';
    }>;
  };
  nextSteps?: string;
}

/**
 * Intro opportunity structured data from Social Butterfly / Demand Agent
 */
export interface IntroOpportunityData {
  introId: string;
  prospectName: string;
  prospectCompany?: string;
  prospectTitle?: string;
  prospectLinkedinUrl?: string;
  innovatorName?: string;
  bountyCredits: number;
  relevanceReason: string;
  talkingPoints?: string[];
}

/**
 * Community request structured data from Agent of Humans
 */
export interface CommunityRequestData {
  requestId: string;
  question: string;
  category?: string;
  context: string;
  creditsOffered: number;
  urgency?: 'low' | 'medium' | 'high';
}

/**
 * Community response structured data - delivering expert insight to requester
 */
export interface CommunityResponseData {
  responseId: string;
  originalQuestion: string;
  expertInsight: string;
  expertName?: string;
  category?: string;
  creditsAwarded?: number;
}

/**
 * Expert impact notification - close-the-loop feedback to expert
 */
export interface ExpertImpactNotificationData {
  responseId: string;
  originalQuestion: string;
  impactDescription: string;
  creditsAwarded: number;
  usefulnessScore?: number;
}

/**
 * Render solution update into conversational prose.
 *
 * Transforms structured research findings from Solution Saga into a natural,
 * helpful update message.
 *
 * @param data - Solution update structured data
 * @param anthropic - Anthropic SDK client
 * @returns Conversational message text
 */
export async function renderSolutionUpdate(
  data: SolutionUpdateData,
  anthropic: Anthropic
): Promise<string> {
  const prompt = getStructuredDataRenderingPrompt(data, 'solution_update');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const messageText = response.content[0].type === 'text' ? response.content[0].text : '';

  return messageText.trim();
}

/**
 * Render intro opportunity into conversational prose.
 *
 * Transforms structured intro details into an engaging pitch that explains
 * why the connection would be valuable.
 *
 * @param data - Intro opportunity structured data
 * @param anthropic - Anthropic SDK client
 * @returns Conversational message text
 */
export async function renderIntroOpportunity(
  data: IntroOpportunityData,
  anthropic: Anthropic
): Promise<string> {
  const prompt = getStructuredDataRenderingPrompt(data, 'intro_opportunity');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 800,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const messageText = response.content[0].type === 'text' ? response.content[0].text : '';

  return messageText.trim();
}

/**
 * Render community request into conversational prose.
 *
 * Transforms structured request details into a genuine question that
 * makes the user feel valued for their expertise.
 *
 * @param data - Community request structured data
 * @param anthropic - Anthropic SDK client
 * @returns Conversational message text
 */
export async function renderCommunityRequest(
  data: CommunityRequestData,
  anthropic: Anthropic
): Promise<string> {
  const prompt = getStructuredDataRenderingPrompt(data, 'community_request');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const messageText = response.content[0].type === 'text' ? response.content[0].text : '';

  return messageText.trim();
}

/**
 * Render community response into conversational prose.
 *
 * Delivers an expert's insight to the original requester in a way that
 * feels valuable and acknowledges both the expert and the insight.
 *
 * @param data - Community response structured data
 * @param anthropic - Anthropic SDK client
 * @returns Conversational message text
 */
export async function renderCommunityResponse(
  data: CommunityResponseData,
  anthropic: Anthropic
): Promise<string> {
  const prompt = `You are delivering an expert insight to someone who asked a question to the community.

**Original Question:** ${data.originalQuestion}

**Expert Insight:** ${data.expertInsight}

${data.expertName ? `**Expert:** ${data.expertName}` : ''}
${data.creditsAwarded ? `**Credits Awarded to Expert:** ${data.creditsAwarded}` : ''}

Craft a warm message that:
1. References their original question briefly
2. Delivers the expert insight clearly
3. ${data.expertName ? `Credits ${data.expertName} for their expertise` : 'Thanks the expert for their insight'}
4. Makes the user feel the value they received
5. Is concise (3-4 sentences max)

Tone: Professional, helpful, genuine appreciation for both the expert and the value delivered.

Return ONLY the message text (no JSON wrapper, no quotes).`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const messageText = response.content[0].type === 'text' ? response.content[0].text : '';

  return messageText.trim();
}

/**
 * Render expert impact notification into conversational prose.
 *
 * Close-the-loop message to expert showing the impact of their response.
 * Makes experts feel valued and encourages future participation.
 *
 * @param data - Expert impact notification structured data
 * @param anthropic - Anthropic SDK client
 * @returns Conversational message text
 */
export async function renderExpertImpactNotification(
  data: ExpertImpactNotificationData,
  anthropic: Anthropic
): Promise<string> {
  const prompt = `You are sending positive feedback to an expert who helped answer a community question.

**Question They Answered:** ${data.originalQuestion}

**Impact:** ${data.impactDescription}

**Credits Earned:** ${data.creditsAwarded}
${data.usefulnessScore ? `**Usefulness Score:** ${data.usefulnessScore}/10` : ''}

Craft a warm, appreciative message that:
1. Thanks them for their contribution
2. Briefly mentions what question they answered
3. Shows the concrete impact their insight had
4. Mentions the credits they earned
5. Makes them feel their expertise is genuinely valued
6. Keeps it concise (2-3 sentences)

Tone: Genuine appreciation, professional, makes them feel their time was worthwhile.

Return ONLY the message text (no JSON wrapper, no quotes).`;

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

  const messageText = response.content[0].type === 'text' ? response.content[0].text : '';

  return messageText.trim();
}

/**
 * Render generic structured data into prose.
 *
 * Fallback renderer for any structured data that doesn't fit
 * the specific types above.
 *
 * @param data - Any structured data object
 * @param context - Brief description of what this data represents
 * @param anthropic - Anthropic SDK client
 * @returns Conversational message text
 */
export async function renderGenericStructuredData(
  data: any,
  context: string,
  anthropic: Anthropic
): Promise<string> {
  const prompt = `Convert this structured data into a natural, conversational message.

Context: ${context}
Data: ${JSON.stringify(data, null, 2)}

Generate a warm, professional message that:
- Clearly communicates the information
- Is easy to understand
- Feels personal, not automated
- Matches a senior professional's communication style

Return ONLY the message text (no JSON wrapper, no quotes).`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 800,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const messageText = response.content[0].type === 'text' ? response.content[0].text : '';

  return messageText.trim();
}

/**
 * Format token usage and cost information for logging.
 *
 * @param usage - Claude API usage object
 * @returns Formatted usage information
 */
export function formatUsageInfo(usage: {
  input_tokens: number;
  output_tokens: number;
}): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUSD: number;
} {
  // Claude Sonnet 4 pricing (as of Dec 2024):
  // Input: $0.003 per 1K tokens
  // Output: $0.015 per 1K tokens
  const inputCost = (usage.input_tokens / 1000) * 0.003;
  const outputCost = (usage.output_tokens / 1000) * 0.015;

  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.input_tokens + usage.output_tokens,
    estimatedCostUSD: inputCost + outputCost,
  };
}
