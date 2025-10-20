/**
 * Community Response Handling
 *
 * Detects and records expert responses to community requests.
 */

import Anthropic from '@anthropic-ai/sdk';
import { createServiceClient, publishEvent } from '@yachtparty/shared';

/**
 * Check if user recently had a community request presented to them.
 *
 * Returns the most recent community request priority that was presented
 * and is still awaiting a response.
 */
export async function getLastPresentedCommunityRequest(
  userId: string,
  conversationId: string
): Promise<{
  requestId: string;
  question: string;
  presentedAt: string;
  awaitingResponse: boolean;
} | null> {
  const supabase = createServiceClient();

  // Get most recent community_request priority that was presented
  const { data: priorities } = await supabase
    .from('user_priorities')
    .select('*')
    .eq('user_id', userId)
    .eq('item_type', 'community_request')
    .eq('status', 'presented') // Was shown to user
    .order('presented_at', { ascending: false })
    .limit(1);

  if (!priorities || priorities.length === 0) {
    return null;
  }

  const priority = priorities[0];

  // Check if this request already has a response from this user
  const { data: existingResponse } = await supabase
    .from('community_responses')
    .select('id')
    .eq('request_id', priority.item_id)
    .eq('user_id', userId)
    .single();

  if (existingResponse) {
    // User already responded to this request
    return null;
  }

  // Fetch the request details
  const { data: request } = await supabase
    .from('community_requests')
    .select('question, status')
    .eq('id', priority.item_id)
    .single();

  if (!request || request.status === 'closed') {
    return null;
  }

  return {
    requestId: priority.item_id as string,
    question: request.question,
    presentedAt: priority.presented_at as string,
    awaitingResponse: true,
  };
}

/**
 * Detect if a user message is a community response using LLM.
 *
 * Returns true if the message appears to be answering the presented question.
 */
export async function detectCommunityResponse(
  userMessage: string,
  presentedQuestion: string,
  anthropic: Anthropic
): Promise<boolean> {
  const prompt = `You are detecting if a user's message is a response to a specific question.

**Question that was asked:** "${presentedQuestion}"

**User's message:** "${userMessage}"

Does the user's message appear to be answering or responding to the question above?

Consider these criteria:
- Does the message provide information, insight, or opinion related to the question?
- Is it substantive (not just "I don't know" or "no idea")?
- Does it address the topic of the question?

Messages that are NOT responses:
- Unrelated topics
- Simple acknowledgments like "ok", "got it", "thanks"
- Questions about something else
- Off-topic conversations

Return JSON:
{
  "is_response": <boolean>,
  "confidence": <"high" | "medium" | "low">,
  "reasoning": "<brief explanation>"
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });

  const resultText = response.content[0].type === 'text' ? response.content[0].text : '{}';

  try {
    let cleanText = resultText.trim();
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.replace(/^```json\s*\n?/, '').replace(/\n?```\s*$/, '');
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    const detection = JSON.parse(cleanText);

    // Only return true if LLM is confident this is a response
    return detection.is_response && detection.confidence !== 'low';
  } catch (error) {
    console.error('Failed to parse community response detection:', error);
    return false;
  }
}

/**
 * Record a community response in the database.
 *
 * Creates community_responses record, summarizes the response using LLM,
 * and publishes community.response_received event.
 */
export async function recordCommunityResponse(
  requestId: string,
  expertUserId: string,
  verbatimAnswer: string,
  anthropic: Anthropic
): Promise<{
  responseId: string;
  responseSummary: string;
}> {
  const supabase = createServiceClient();

  // 1. Summarize response using LLM
  const summaryPrompt = `Summarize this expert's response concisely in 2-3 sentences. Focus on the key insights and recommendations.

Expert's response:
"${verbatimAnswer}"

Return ONLY the summary text (no JSON wrapper, no quotes).`;

  const summaryResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 300,
    messages: [{ role: 'user', content: summaryPrompt }],
  });

  const responseSummary = summaryResponse.content[0].type === 'text'
    ? summaryResponse.content[0].text.trim()
    : verbatimAnswer;

  // 2. Insert into community_responses
  const { data: response, error: responseError } = await supabase
    .from('community_responses')
    .insert({
      request_id: requestId,
      user_id: expertUserId,
      response_text: responseSummary,
      verbatim_answer: verbatimAnswer,
      status: 'provided',
    })
    .select()
    .single();

  if (responseError) {
    throw new Error(`Failed to record community response: ${responseError.message}`);
  }

  // 3. Update request responses_count and status
  const { data: request } = await supabase
    .from('community_requests')
    .select('responses_count, context_id, context_type, requesting_agent_type, requesting_user_id')
    .eq('id', requestId)
    .single();

  const newCount = (request?.responses_count || 0) + 1;

  await supabase
    .from('community_requests')
    .update({
      responses_count: newCount,
      status: 'responses_received',
    })
    .eq('id', requestId);

  // 4. Mark priority as actioned
  await supabase
    .from('user_priorities')
    .update({ status: 'actioned' })
    .eq('user_id', expertUserId)
    .eq('item_id', requestId)
    .eq('item_type', 'community_request');

  // 5. Publish community.response_received event
  await publishEvent({
    event_type: 'community.response_received',
    aggregate_id: response.id,
    aggregate_type: 'community_response',
    payload: {
      responseId: response.id,
      requestId,
      expertUserId,
      responseSummary,
      verbatimAnswer,
      contextId: request?.context_id,
      contextType: request?.context_type,
    },
    created_by: 'concierge_agent',
  });

  console.log(`[Community Response] Recorded response ${response.id} for request ${requestId}`);

  return {
    responseId: response.id,
    responseSummary,
  };
}
