/**
 * Priority Scoring with LLM
 *
 * Uses Claude API to calculate value scores (0-100) for user priorities.
 * Implements prompt caching for cost optimization.
 *
 * @module priority-scorer
 */

import Anthropic from '@anthropic-ai/sdk';
import type { User } from '@yachtparty/shared';
import type { CategorizedEvents, EventContext } from './event-processor';

/**
 * Enable prompt caching to reduce LLM costs by ~40%.
 */
const ENABLE_PROMPT_CACHING = process.env.ENABLE_PROMPT_CACHING !== 'false';

/**
 * Claude model to use for priority scoring.
 */
const MODEL = 'claude-sonnet-4-20250514';

/**
 * Priority score result from LLM.
 */
export interface PriorityScore {
  /** Type of priority item */
  itemType: 'intro_opportunity' | 'community_request' | 'solution_update';

  /** Unique identifier of the item */
  itemId: string;

  /** Value score (0-100, 100 = highest value) */
  score: number;

  /** LLM reasoning for this score */
  reasoning: string;

  /** When this item expires (becomes stale) */
  expiresAt: string;

  /** Item metadata for context */
  metadata?: Record<string, unknown>;
}

/**
 * Calculates priority scores for all items using Claude LLM.
 *
 * Uses prompt caching to optimize costs:
 * - System prompt (~2000 tokens, static)
 * - User profile (~500 tokens, updated every 6h)
 * - Scoring rubric (~1000 tokens, static)
 *
 * @param user - User record with profile and preferences
 * @param categorized - Categorized events to score
 * @param context - Additional context (existing intros, requests, etc.)
 * @param anthropic - Anthropic client instance
 * @returns Array of scored and ranked priorities
 */
export async function calculatePriorityScores(
  user: User,
  categorized: CategorizedEvents,
  context: EventContext,
  anthropic: Anthropic
): Promise<PriorityScore[]> {
  const startTime = Date.now();
  console.log(`[Priority Scorer] Calculating scores for user ${user.id}`);

  try {
    // Build items to score
    const items = buildItemsToScore(categorized, context);

    if (items.length === 0) {
      console.log('[Priority Scorer] No items to score');
      return [];
    }

    console.log(`[Priority Scorer] Scoring ${items.length} items`);

    // Build prompt with caching
    const messages = buildScoringPrompt(user, items);

    // Call Claude API
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      messages,
      system: buildSystemPrompt(),
    });

    // Parse response
    const scores = parseScoreResponse(response, items);

    // Log LLM call metrics
    const latencyMs = Date.now() - startTime;
    await logLLMCall(
      user.id,
      response.usage.input_tokens,
      response.usage.output_tokens,
      latencyMs,
      items.length
    );

    console.log(
      `[Priority Scorer] Calculated ${scores.length} scores in ${latencyMs}ms ` +
        `(${response.usage.input_tokens} input tokens, ${response.usage.output_tokens} output tokens)`
    );

    return scores;
  } catch (error) {
    console.error('[Priority Scorer] Error calculating scores:', error);
    throw error;
  }
}

/**
 * Builds system prompt for priority scoring.
 * This is static and cacheable.
 */
function buildSystemPrompt(): string {
  return `You are the Account Manager for Yachtparty, a professional networking platform.

Your role is to score and rank opportunities for users based on their value and relevance.

Scoring Criteria (0-100):

**High Value (80-100):**
- Direct match to user's expertise or needs
- High network impact potential
- Time-sensitive opportunities
- Strong mutual benefit
- Active engagement from parties

**Medium Value (50-79):**
- Relevant but not perfect match
- Moderate network impact
- Standard timeframe
- Good potential benefit
- Some engagement indicators

**Low Value (20-49):**
- Tangential relevance
- Low network impact
- Non-urgent
- Unclear benefit
- Limited engagement

**Very Low Value (0-19):**
- Not relevant to user
- No clear value
- Expired or stale
- No engagement

Consider:
1. User's profile (expertise, role, past behavior)
2. Item freshness (newer = higher priority)
3. Network value (benefit to platform)
4. Engagement signals (responses, acceptance history)
5. Strategic fit (aligns with user goals)

Output Format:
Return a JSON array of scored items. Each item must include:
- itemId: string
- itemType: string
- score: number (0-100)
- reasoning: string (brief explanation)
- expiresAt: ISO 8601 timestamp

Sort items by score (highest first).`;
}

/**
 * Builds scoring prompt with user context and items.
 * Uses cache_control markers for prompt caching.
 */
function buildScoringPrompt(
  user: User,
  items: ItemToScore[]
): Anthropic.MessageParam[] {
  // Build user profile section (cacheable)
  const userProfile = `
User Profile:
- Name: ${user.first_name} ${user.last_name}
- Company: ${user.company || 'Unknown'}
- Title: ${user.title || 'Unknown'}
- Expertise: ${user.expertise?.join(', ') || 'None listed'}
- Expert Connector: ${user.expert_connector ? 'Yes' : 'No'}
- Credit Balance: ${user.credit_balance}
- Account Age: ${calculateAccountAge(user.created_at)}
- Last Active: ${user.last_active_at || 'Unknown'}

Response Patterns:
${user.response_pattern ? JSON.stringify(user.response_pattern, null, 2) : 'No data yet'}
`;

  // Build items section (not cacheable - changes every run)
  const itemsText = items
    .map(
      (item, index) => `
Item ${index + 1}:
- ID: ${item.id}
- Type: ${item.type}
- Created: ${item.createdAt}
- Details: ${JSON.stringify(item.details, null, 2)}
`
    )
    .join('\n');

  const prompt = `${userProfile}

Items to Score (${items.length} total):
${itemsText}

Task:
Score each item based on its value to this specific user. Consider their expertise, role, past behavior, and the item's freshness.

Return a JSON array with scores for all items, sorted by score (highest first).

Example format:
\`\`\`json
[
  {
    "itemId": "intro_123",
    "itemType": "intro_opportunity",
    "score": 85,
    "reasoning": "Direct match to user's expertise in SaaS sales, high network value",
    "expiresAt": "2025-11-01T00:00:00Z"
  }
]
\`\`\`

Now score these ${items.length} items:`;

  // Return messages array with cache control
  if (ENABLE_PROMPT_CACHING) {
    return [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: userProfile,
            // @ts-ignore - cache_control is valid but not in type definitions yet
            cache_control: { type: 'ephemeral' }, // Cache user profile
          },
          {
            type: 'text',
            text: itemsText + '\n\n' + prompt.split('Items to Score')[1],
          },
        ],
      },
    ];
  } else {
    return [{ role: 'user', content: prompt }];
  }
}

/**
 * Item to score structure.
 */
interface ItemToScore {
  id: string;
  type: 'intro_opportunity' | 'community_request' | 'solution_update';
  createdAt: string;
  details: Record<string, unknown>;
}

/**
 * Builds list of items to score from categorized events and context.
 */
function buildItemsToScore(
  categorized: CategorizedEvents,
  context: EventContext
): ItemToScore[] {
  const items: ItemToScore[] = [];

  // Add intro opportunities
  for (const intro of context.introOpportunities || []) {
    if (intro.status === 'open') {
      items.push({
        id: intro.id,
        type: 'intro_opportunity',
        createdAt: typeof intro.created_at === 'string' ? intro.created_at : intro.created_at.toISOString(),
        details: {
          prospectName: intro.prospect_name,
          prospectCompany: intro.prospect_company,
          prospectTitle: intro.prospect_title,
          innovatorName: intro.innovator_name,
          bountyCredits: intro.bounty_credits,
        },
      });
    }
  }

  // Add community requests
  for (const request of context.communityRequests || []) {
    if (request.status === 'open') {
      items.push({
        id: request.id,
        type: 'community_request',
        createdAt: typeof request.created_at === 'string' ? request.created_at : request.created_at.toISOString(),
        details: {
          question: request.question,
          category: request.category,
          expertiseNeeded: request.expertise_needed,
          expiresAt: request.expires_at,
        },
      });
    }
  }

  // Add solution updates from events
  for (const event of categorized.solutionUpdates) {
    const payload = event.payload as any;
    items.push({
      id: payload.workflowId || event.id,
      type: 'solution_update',
      createdAt: event.created_at.toString(),
      details: {
        requestDescription: payload.requestDescription,
        findings: payload.findings,
        completedAt: payload.completedAt,
      },
    });
  }

  return items;
}

/**
 * Parses LLM response into priority scores.
 */
function parseScoreResponse(
  response: Anthropic.Message,
  items: ItemToScore[]
): PriorityScore[] {
  try {
    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text content in response');
    }

    // Extract JSON from response (may be wrapped in markdown)
    const text = textContent.text;
    const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/\[([\s\S]*)\]/);

    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const jsonStr = jsonMatch[1] || jsonMatch[0];
    const scores = JSON.parse(jsonStr) as PriorityScore[];

    // Validate scores
    for (const score of scores) {
      if (!score.itemId || !score.itemType || typeof score.score !== 'number') {
        console.warn('[Priority Scorer] Invalid score format:', score);
      }

      // Clamp score to 0-100
      score.score = Math.max(0, Math.min(100, score.score));

      // Default expiration to 7 days if not provided
      if (!score.expiresAt) {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);
        score.expiresAt = expiresAt.toISOString();
      }
    }

    // Sort by score (highest first)
    scores.sort((a, b) => b.score - a.score);

    return scores;
  } catch (error) {
    console.error('[Priority Scorer] Error parsing scores:', error);
    console.error('Response:', JSON.stringify(response, null, 2));

    // Return default scores if parsing fails
    return items.map((item, index) => ({
      itemId: item.id,
      itemType: item.type,
      score: 50 - index, // Default descending scores
      reasoning: 'Failed to parse LLM response, using default score',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }));
  }
}

/**
 * Calculates account age in days.
 */
function calculateAccountAge(createdAt: string | Date): string {
  const created = new Date(createdAt);
  const now = new Date();
  const ageMs = now.getTime() - created.getTime();
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));

  if (ageDays < 1) return 'Less than 1 day';
  if (ageDays === 1) return '1 day';
  if (ageDays < 30) return `${ageDays} days`;
  if (ageDays < 365) return `${Math.floor(ageDays / 30)} months`;
  return `${Math.floor(ageDays / 365)} years`;
}

/**
 * Logs LLM call metrics to agent_actions_log.
 */
async function logLLMCall(
  userId: string,
  inputTokens: number,
  outputTokens: number,
  latencyMs: number,
  itemsScored: number
): Promise<void> {
  const { createServiceClient } = await import('@yachtparty/shared');
  const supabase = createServiceClient();

  // Calculate cost (Claude Sonnet pricing)
  // Input: $3.00 per million tokens
  // Output: $15.00 per million tokens
  const inputCost = (inputTokens / 1_000_000) * 3.0;
  const outputCost = (outputTokens / 1_000_000) * 15.0;
  const totalCost = inputCost + outputCost;

  await supabase.from('agent_actions_log').insert({
    agent_type: 'account_manager',
    action_type: 'llm_call',
    user_id: userId,
    model_used: MODEL,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: totalCost,
    latency_ms: latencyMs,
    input_data: {
      itemsScored,
      promptCachingEnabled: ENABLE_PROMPT_CACHING,
    },
    output_data: {
      scoresGenerated: itemsScored,
    },
  });
}
