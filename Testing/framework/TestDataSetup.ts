/**
 * Test Data Setup Utilities
 *
 * Helper functions for creating test data in the test database.
 * Used by simulation tests to set up realistic scenarios.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';

/**
 * Create intro_opportunities for testing
 */
export async function createIntroOpportunities(
  dbClient: SupabaseClient,
  connectorUserId: string,
  opportunities: Array<{
    prospectName: string;
    prospectCompany: string;
    prospectTitle?: string;
    bountyCredits: number;
    connectionStrength: 'first_degree' | 'second_degree' | 'third_degree';
    status?: 'open' | 'accepted' | 'paused' | 'cancelled' | 'completed';
  }>
): Promise<string[]> {
  const ids: string[] = [];

  // Create test prospect and innovator IDs
  const testProspectId = crypto.randomUUID();
  const testInnovatorId = crypto.randomUUID();

  for (const opp of opportunities) {
    const { data, error } = await dbClient
      .from('intro_opportunities')
      .insert({
        connector_user_id: connectorUserId,
        innovator_id: testInnovatorId,
        prospect_id: testProspectId,
        prospect_name: opp.prospectName,
        prospect_company: opp.prospectCompany,
        prospect_title: opp.prospectTitle || null,
        bounty_credits: opp.bountyCredits,
        connection_strength: opp.connectionStrength,
        status: opp.status || 'open',
      })
      .select('id')
      .single();

    if (error) {
      console.error('[TestDataSetup] Error creating intro_opportunity:', error);
      throw error;
    }

    if (data) {
      ids.push(data.id);
      console.log(`[TestDataSetup] Created intro_opportunity ${data.id}`);
    }
  }

  return ids;
}

/**
 * Create connection_requests for testing
 */
export async function createConnectionRequests(
  dbClient: SupabaseClient,
  introduceeUserId: string,
  requests: Array<{
    requestorName: string;
    requestorCompany: string;
    introContext: string;
    requestorCreditsSpent: number;
    vouchedByUserIds?: string[];
    status?: 'open' | 'accepted' | 'declined' | 'completed';
  }>
): Promise<string[]> {
  const ids: string[] = [];

  for (const req of requests) {
    const { data, error } = await dbClient
      .from('connection_requests')
      .insert({
        introducee_user_id: introduceeUserId,
        requestor_name: req.requestorName,
        requestor_company: req.requestorCompany,
        intro_context: req.introContext,
        requestor_credits_spent: req.requestorCreditsSpent,
        vouched_by_user_ids: req.vouchedByUserIds || [],
        status: req.status || 'open',
      })
      .select('id')
      .single();

    if (error) {
      console.error('[TestDataSetup] Error creating connection_request:', error);
      throw error;
    }

    if (data) {
      ids.push(data.id);
      console.log(`[TestDataSetup] Created connection_request ${data.id}`);
    }
  }

  return ids;
}

/**
 * Create intro_offers for testing
 */
export async function createIntroOffers(
  dbClient: SupabaseClient,
  offers: Array<{
    offeringUserId: string;
    introduceeUserId: string;
    prospectName: string;
    prospectCompany: string;
    prospectContext: string;
    contextType: 'community_request' | 'nomination' | 'direct_offer';
    bountyCredits: number;
    status?:
      | 'pending_introducee_response'
      | 'pending_connector_confirmation'
      | 'confirmed'
      | 'declined'
      | 'completed';
  }>
): Promise<string[]> {
  const ids: string[] = [];

  for (const offer of offers) {
    const { data, error } = await dbClient
      .from('intro_offers')
      .insert({
        offering_user_id: offer.offeringUserId,
        introducee_user_id: offer.introduceeUserId,
        prospect_name: offer.prospectName,
        prospect_company: offer.prospectCompany,
        prospect_context: offer.prospectContext,
        context_type: offer.contextType,
        context_id: crypto.randomUUID(), // Test context ID
        bounty_credits: offer.bountyCredits,
        status: offer.status || 'pending_introducee_response',
      })
      .select('id')
      .single();

    if (error) {
      console.error('[TestDataSetup] Error creating intro_offer:', error);
      throw error;
    }

    if (data) {
      ids.push(data.id);
      console.log(`[TestDataSetup] Created intro_offer ${data.id}`);
    }
  }

  return ids;
}

/**
 * Create user_priorities for testing (for priority_opportunity scenarios)
 */
export async function createUserPriorities(
  dbClient: SupabaseClient,
  userId: string,
  priorities: Array<{
    itemType: string;
    itemId: string;
    content: string;
    valueScore: number;
    status?: 'active' | 'completed' | 'archived';
    metadata?: Record<string, any>;
  }>
): Promise<string[]> {
  const ids: string[] = [];

  for (const priority of priorities) {
    const { data, error } = await dbClient
      .from('user_priorities')
      .insert({
        user_id: userId,
        priority_rank: 1,
        item_type: priority.itemType,
        item_id: priority.itemId,
        value_score: priority.valueScore,
        status: priority.status || 'active',
        content: priority.content,
        metadata: priority.metadata || {},
      })
      .select('id')
      .single();

    if (error) {
      console.error('[TestDataSetup] Error creating user_priority:', error);
      throw error;
    }

    if (data) {
      ids.push(data.id);
      console.log(`[TestDataSetup] Created user_priority ${data.id}`);
    }
  }

  return ids;
}

/**
 * Simulate past re-engagement attempts for throttling tests
 */
export async function simulatePastReengagements(
  dbClient: SupabaseClient,
  userId: string,
  attempts: Array<{
    daysAgo: number;
    userResponded: boolean;
  }>
): Promise<void> {
  console.log(`[TestDataSetup] Simulating ${attempts.length} past re-engagement attempts`);

  for (const attempt of attempts) {
    const attemptDate = new Date();
    attemptDate.setDate(attemptDate.getDate() - attempt.daysAgo);

    // Log re-engagement attempt
    const { error: logError } = await dbClient.from('agent_actions_log').insert({
      agent_type: 'concierge',
      action_type: 're_engagement_message_sent',
      user_id: userId,
      context_id: crypto.randomUUID(),
      context_type: 'conversation',
      created_at: attemptDate.toISOString(),
      input_data: {
        simulated: true,
        daysAgo: attempt.daysAgo,
      },
    });

    if (logError) {
      console.error('[TestDataSetup] Error logging re-engagement attempt:', logError);
      throw logError;
    }

    console.log(`[TestDataSetup] Logged re-engagement ${attempt.daysAgo} days ago`);

    // If user responded, log a user message after the attempt
    if (attempt.userResponded) {
      const responseDate = new Date(attemptDate);
      responseDate.setHours(responseDate.getHours() + 2); // 2 hours later

      // Get conversation for this user
      const { data: conversations } = await dbClient
        .from('conversations')
        .select('id')
        .eq('user_id', userId)
        .limit(1);

      const conversationId = conversations?.[0]?.id || crypto.randomUUID();

      const { error: msgError } = await dbClient.from('messages').insert({
        user_id: userId,
        conversation_id: conversationId,
        role: 'user',
        content: 'Thanks for checking in',
        direction: 'inbound',
        created_at: responseDate.toISOString(),
      });

      if (msgError) {
        console.error('[TestDataSetup] Error creating user response:', msgError);
        throw msgError;
      }

      console.log(`[TestDataSetup] User responded 2 hours after attempt`);
    }
  }

  console.log(`[TestDataSetup] Completed simulating re-engagement history`);
}

/**
 * Create community_requests for testing
 */
export async function createCommunityRequests(
  dbClient: SupabaseClient,
  userId: string,
  requests: Array<{
    question: string;
    category: string;
    priority: 'low' | 'medium' | 'high';
    status?: 'open' | 'answered' | 'closed';
  }>
): Promise<string[]> {
  const ids: string[] = [];

  for (const request of requests) {
    const { data, error } = await dbClient
      .from('community_requests')
      .insert({
        user_id: userId,
        question: request.question,
        category: request.category,
        priority: request.priority,
        status: request.status || 'open',
      })
      .select('id')
      .single();

    if (error) {
      console.error('[TestDataSetup] Error creating community_request:', error);
      throw error;
    }

    if (data) {
      ids.push(data.id);
      console.log(`[TestDataSetup] Created community_request ${data.id}`);
    }
  }

  return ids;
}

/**
 * Clean up all test data for a user
 */
export async function cleanupTestData(
  dbClient: SupabaseClient,
  userId: string
): Promise<void> {
  console.log(`[TestDataSetup] Cleaning up test data for user ${userId}`);

  // Delete in reverse dependency order
  await dbClient.from('agent_actions_log').delete().eq('user_id', userId);
  await dbClient.from('user_priorities').delete().eq('user_id', userId);
  await dbClient.from('intro_opportunities').delete().eq('connector_user_id', userId);
  await dbClient.from('connection_requests').delete().eq('introducee_user_id', userId);
  await dbClient.from('intro_offers').delete().eq('offering_user_id', userId);
  await dbClient.from('intro_offers').delete().eq('introducee_user_id', userId);
  await dbClient.from('community_requests').delete().eq('user_id', userId);
  await dbClient.from('messages').delete().eq('user_id', userId);
  await dbClient.from('conversations').delete().eq('user_id', userId);
  await dbClient.from('users').delete().eq('id', userId);

  console.log(`[TestDataSetup] Cleanup complete`);
}
