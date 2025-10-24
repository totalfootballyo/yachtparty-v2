/**
 * Intro Flow Priority Handlers
 *
 * Handles all intro flow events for Account Manager prioritization:
 * - intro.opportunity_created - Add to connector's priorities
 * - connection.request_created - Add to introducee's priorities
 * - intro.offer_created - Add to introducee's priorities
 * - intro.offer_accepted - Add confirmation task to offering_user's priorities
 * - State transitions (accepted, declined, completed, cancelled, confirmed)
 *
 * These handlers manage the user_priorities table to ensure users see
 * intro opportunities, connection requests, and intro offers in their priorities.
 */

import { createClient } from '@supabase/supabase-js';
import type { Event } from '../types';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

/**
 * Handler: intro.opportunity_created
 * Adds intro opportunity to connector's priorities
 *
 * Scoring Logic:
 * - Base score = bounty_credits (25-50)
 * - +20 if prospect is at target company for connector's interests
 * - +10 if connector has high intro success rate
 * - -10 if connector has declined similar intros recently
 */
export async function handleIntroOpportunityCreated(event: Event): Promise<void> {
  console.log(`[intro.opportunity_created] Processing event ${event.id}`);

  const payload = event.payload as unknown as {
    introOpportunityId: string;
    connectorUserId: string;
    prospectName: string;
    prospectCompany?: string;
    prospectTitle?: string;
    innovatorName: string;
    bountyCredits: number;
    expiresAt: string;
  };

  // Fetch intro opportunity record
  const { data: introOpp, error: oppError } = await supabase
    .from('intro_opportunities')
    .select('*')
    .eq('id', payload.introOpportunityId)
    .single();

  if (oppError || !introOpp) {
    console.error(`[intro.opportunity_created] Failed to fetch intro opportunity:`, oppError);
    throw oppError || new Error('Intro opportunity not found');
  }

  // Fetch connector profile for scoring
  const { data: connector, error: connectorError } = await supabase
    .from('users')
    .select('expertise, interests, response_pattern')
    .eq('id', payload.connectorUserId)
    .single();

  if (connectorError) {
    console.error(`[intro.opportunity_created] Failed to fetch connector profile:`, connectorError);
  }

  // Calculate value score
  let valueScore = payload.bountyCredits; // Base: 25-50

  // Bonus: Prospect at target company
  if (connector?.interests && payload.prospectCompany) {
    const interests = connector.interests as string[];
    if (interests.some(interest => payload.prospectCompany?.toLowerCase().includes(interest.toLowerCase()))) {
      valueScore += 20;
    }
  }

  // Bonus: High intro success rate
  if (connector?.response_pattern) {
    const pattern = connector.response_pattern as any;
    if (pattern.intro_success_rate && pattern.intro_success_rate > 0.7) {
      valueScore += 10;
    }
  }

  // Penalty: Declined similar intros recently
  const { data: recentDeclines } = await supabase
    .from('intro_opportunities')
    .select('id')
    .eq('connector_user_id', payload.connectorUserId)
    .eq('status', 'declined')
    .gte('updated_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .limit(1);

  if (recentDeclines && recentDeclines.length > 0) {
    valueScore -= 10;
  }

  // Clamp score to 0-100
  valueScore = Math.max(0, Math.min(100, valueScore));

  // Add to connector's priorities
  const { error: priorityError } = await supabase
    .from('user_priorities')
    .insert({
      user_id: payload.connectorUserId,
      priority_rank: 999, // Will be re-ranked by Account Manager
      item_type: 'intro_opportunity',
      item_id: payload.introOpportunityId,
      value_score: valueScore,
      status: 'active',
      expires_at: payload.expiresAt,
      content: `Intro opportunity: ${payload.prospectName} at ${payload.prospectCompany || 'Unknown'} for ${payload.innovatorName}`,
      metadata: {
        prospect_name: payload.prospectName,
        prospect_company: payload.prospectCompany,
        prospect_title: payload.prospectTitle,
        innovator_name: payload.innovatorName,
        bounty_credits: payload.bountyCredits,
        event_id: event.id,
      },
    });

  if (priorityError) {
    console.error(`[intro.opportunity_created] Failed to add to priorities:`, priorityError);
    throw priorityError;
  }

  console.log(`[intro.opportunity_created] ✓ Added to connector ${payload.connectorUserId} priorities (score: ${valueScore})`);
}

/**
 * Handler: connection.request_created
 * Adds connection request to introducee's priorities
 *
 * Scoring Logic:
 * - Base score = 60
 * - +10 per vouching user (max +30)
 * - +10 if requestor is highly rated innovator
 * - +10 if intro_context is detailed and relevant
 * - -5 if introducee has many pending requests
 */
export async function handleConnectionRequestCreated(event: Event): Promise<void> {
  console.log(`[connection.request_created] Processing event ${event.id}`);

  const payload = event.payload as unknown as {
    connectionRequestId: string;
    innovatorUserId: string;
    introduceeUserId: string;
    introduceeProspectName: string;
    introContext?: string;
    vouchedByUserIds?: string[];
    expiresAt: string;
  };

  // Fetch connection request record
  const { data: connReq, error: reqError } = await supabase
    .from('connection_requests')
    .select('*')
    .eq('id', payload.connectionRequestId)
    .single();

  if (reqError || !connReq) {
    console.error(`[connection.request_created] Failed to fetch connection request:`, reqError);
    throw reqError || new Error('Connection request not found');
  }

  // Fetch innovator profile
  const { data: innovator } = await supabase
    .from('innovators')
    .select('reputation_score')
    .eq('user_id', payload.innovatorUserId)
    .single();

  // Calculate value score
  let valueScore = 60; // Base score

  // Bonus: Vouching users
  if (payload.vouchedByUserIds && payload.vouchedByUserIds.length > 0) {
    valueScore += Math.min(payload.vouchedByUserIds.length * 10, 30);
  }

  // Bonus: Highly rated innovator
  if (innovator?.reputation_score && innovator.reputation_score > 80) {
    valueScore += 10;
  }

  // Bonus: Detailed intro context
  if (payload.introContext && payload.introContext.length > 100) {
    valueScore += 10;
  }

  // Penalty: Many pending requests
  const { data: pendingRequests } = await supabase
    .from('connection_requests')
    .select('id')
    .eq('introducee_user_id', payload.introduceeUserId)
    .eq('status', 'pending')
    .limit(5);

  if (pendingRequests && pendingRequests.length >= 3) {
    valueScore -= 5;
  }

  // Clamp score to 0-100
  valueScore = Math.max(0, Math.min(100, valueScore));

  // Add to introducee's priorities
  const { error: priorityError } = await supabase
    .from('user_priorities')
    .insert({
      user_id: payload.introduceeUserId,
      priority_rank: 999,
      item_type: 'connection_request',
      item_id: payload.connectionRequestId,
      value_score: valueScore,
      status: 'active',
      expires_at: payload.expiresAt,
      content: `Connection request from innovator for ${payload.introduceeProspectName}`,
      metadata: {
        innovator_user_id: payload.innovatorUserId,
        introducee_prospect_name: payload.introduceeProspectName,
        intro_context: payload.introContext,
        vouched_by_count: payload.vouchedByUserIds?.length || 0,
        event_id: event.id,
      },
    });

  if (priorityError) {
    console.error(`[connection.request_created] Failed to add to priorities:`, priorityError);
    throw priorityError;
  }

  console.log(`[connection.request_created] ✓ Added to introducee ${payload.introduceeUserId} priorities (score: ${valueScore})`);
}

/**
 * Handler: intro.offer_created
 * Adds intro offer to introducee's priorities (Step 1 of two-step flow)
 *
 * Scoring Logic (for introducee):
 * - Base score = 70
 * - +15 if offering_user has high reputation/status
 * - +10 if prospect is at target company
 * - +10 if prospect_context shows strong relevance
 */
export async function handleIntroOfferCreated(event: Event): Promise<void> {
  console.log(`[intro.offer_created] Processing event ${event.id}`);

  const payload = event.payload as unknown as {
    introOfferId: string;
    offeringUserId: string;
    introduceeUserId: string;
    introduceeProspectName: string;
    prospectName: string;
    prospectCompany?: string;
    prospectTitle?: string;
    prospectContext?: string;
    expiresAt: string;
  };

  // Fetch intro offer record
  const { data: introOffer, error: offerError } = await supabase
    .from('intro_offers')
    .select('*')
    .eq('id', payload.introOfferId)
    .single();

  if (offerError || !introOffer) {
    console.error(`[intro.offer_created] Failed to fetch intro offer:`, offerError);
    throw offerError || new Error('Intro offer not found');
  }

  // Fetch offering user profile
  const { data: offeringUser } = await supabase
    .from('users')
    .select('expert_connector, credit_balance')
    .eq('id', payload.offeringUserId)
    .single();

  // Fetch introducee interests
  const { data: introducee } = await supabase
    .from('users')
    .select('interests')
    .eq('id', payload.introduceeUserId)
    .single();

  // SPECIAL HANDLING: Check if introducee is an innovator
  // If so, update intro_offer bounty to warm_intro_bounty value
  const { data: innovator } = await supabase
    .from('innovators')
    .select('warm_intro_bounty')
    .eq('user_id', payload.introduceeUserId)
    .single();

  if (innovator) {
    // Update intro_offer bounty_credits to innovator's warm_intro_bounty
    await supabase
      .from('intro_offers')
      .update({
        bounty_credits: innovator.warm_intro_bounty,
        metadata: {
          innovator_bounty: true,
          original_bounty: 25, // Default bounty before innovator adjustment
        },
      })
      .eq('id', payload.introOfferId);

    console.log(
      `[intro.offer_created] Updated bounty to ${innovator.warm_intro_bounty} for innovator ${payload.introduceeUserId}`
    );
  }

  // Calculate value score
  let valueScore = 70; // Base score

  // Bonus: High reputation offering user (expert connector with high credits)
  if (offeringUser?.expert_connector && offeringUser.credit_balance > 100) {
    valueScore += 15;
  }

  // Bonus: Prospect at target company
  if (introducee?.interests && payload.prospectCompany) {
    const interests = introducee.interests as string[];
    if (interests.some(interest => payload.prospectCompany?.toLowerCase().includes(interest.toLowerCase()))) {
      valueScore += 10;
    }
  }

  // Bonus: Detailed prospect context
  if (payload.prospectContext && payload.prospectContext.length > 100) {
    valueScore += 10;
  }

  // Bonus: Higher bounty for innovators
  if (innovator) {
    valueScore += (innovator.warm_intro_bounty - 25); // Add bonus based on higher bounty
  }

  // Clamp score to 0-100
  valueScore = Math.max(0, Math.min(100, valueScore));

  // Add to introducee's priorities (Step 1: "Want this intro?")
  const { error: priorityError } = await supabase
    .from('user_priorities')
    .insert({
      user_id: payload.introduceeUserId,
      priority_rank: 999,
      item_type: 'intro_offer',
      item_id: payload.introOfferId,
      value_score: valueScore,
      status: 'active',
      expires_at: payload.expiresAt,
      content: `Intro offer: ${payload.offeringUserId} can introduce you to ${payload.prospectName} at ${payload.prospectCompany || 'Unknown'}`,
      metadata: {
        offering_user_id: payload.offeringUserId,
        introducee_prospect_name: payload.introduceeProspectName,
        prospect_name: payload.prospectName,
        prospect_company: payload.prospectCompany,
        prospect_title: payload.prospectTitle,
        prospect_context: payload.prospectContext,
        event_id: event.id,
        step: 'introducee_decision', // Track which step we're at
        innovator_bounty: !!innovator, // Track if this is an innovator intro
      },
    });

  if (priorityError) {
    console.error(`[intro.offer_created] Failed to add to priorities:`, priorityError);
    throw priorityError;
  }

  console.log(`[intro.offer_created] ✓ Added to introducee ${payload.introduceeUserId} priorities (score: ${valueScore})`);
}

/**
 * Handler: intro.offer_accepted
 * Moves intro offer to offering_user's priorities for confirmation (Step 2 of two-step flow)
 *
 * After introducee accepts, we need connector to confirm they made the intro.
 */
export async function handleIntroOfferAccepted(event: Event): Promise<void> {
  console.log(`[intro.offer_accepted] Processing event ${event.id}`);

  const payload = event.payload as unknown as {
    introOfferId: string;
    offeringUserId: string;
    introduceeUserId: string;
    prospectName: string;
    bountyCredits: number;
  };

  // Fetch intro offer record
  const { data: introOffer, error: offerError } = await supabase
    .from('intro_offers')
    .select('*')
    .eq('id', payload.introOfferId)
    .single();

  if (offerError || !introOffer) {
    console.error(`[intro.offer_accepted] Failed to fetch intro offer:`, offerError);
    throw offerError || new Error('Intro offer not found');
  }

  // Step 1: Mark introducee's priority as actioned
  const { error: updateError } = await supabase
    .from('user_priorities')
    .update({ status: 'actioned' })
    .eq('item_id', payload.introOfferId)
    .eq('item_type', 'intro_offer')
    .eq('user_id', payload.introduceeUserId);

  if (updateError) {
    console.error(`[intro.offer_accepted] Failed to update introducee priority:`, updateError);
  }

  // Step 2: Add confirmation task to offering_user's priorities
  const { error: confirmError } = await supabase
    .from('user_priorities')
    .insert({
      user_id: payload.offeringUserId,
      priority_rank: 999,
      item_type: 'intro_offer_confirmation',
      item_id: payload.introOfferId,
      value_score: 80, // High priority - user needs to confirm
      status: 'active',
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
      content: `Confirm you made intro: ${payload.prospectName} (${payload.bountyCredits} credits)`,
      metadata: {
        introducee_user_id: payload.introduceeUserId,
        prospect_name: payload.prospectName,
        bounty_credits: payload.bountyCredits,
        event_id: event.id,
        step: 'connector_confirmation', // Track which step we're at
      },
    });

  if (confirmError) {
    console.error(`[intro.offer_accepted] Failed to add confirmation task:`, confirmError);
    throw confirmError;
  }

  console.log(`[intro.offer_accepted] ✓ Moved to offering_user ${payload.offeringUserId} for confirmation`);
}

/**
 * Handler: intro.opportunity_accepted
 * Marks opportunity as actioned in connector's priorities
 */
export async function handleIntroOpportunityAccepted(event: Event): Promise<void> {
  console.log(`[intro.opportunity_accepted] Processing event ${event.id}`);

  const payload = event.payload as unknown as {
    introOpportunityId: string;
    connectorUserId: string;
  };

  const { error } = await supabase
    .from('user_priorities')
    .update({ status: 'actioned' })
    .eq('item_id', payload.introOpportunityId)
    .eq('item_type', 'intro_opportunity')
    .eq('user_id', payload.connectorUserId);

  if (error) {
    console.error(`[intro.opportunity_accepted] Failed to update priority:`, error);
    throw error;
  }

  console.log(`[intro.opportunity_accepted] ✓ Marked as actioned for connector ${payload.connectorUserId}`);
}

/**
 * Handler: intro.opportunity_declined
 * Marks opportunity as expired in connector's priorities
 */
export async function handleIntroOpportunityDeclined(event: Event): Promise<void> {
  console.log(`[intro.opportunity_declined] Processing event ${event.id}`);

  const payload = event.payload as unknown as {
    introOpportunityId: string;
    connectorUserId: string;
  };

  const { error } = await supabase
    .from('user_priorities')
    .update({ status: 'expired' })
    .eq('item_id', payload.introOpportunityId)
    .eq('item_type', 'intro_opportunity')
    .eq('user_id', payload.connectorUserId);

  if (error) {
    console.error(`[intro.opportunity_declined] Failed to update priority:`, error);
    throw error;
  }

  console.log(`[intro.opportunity_declined] ✓ Marked as expired for connector ${payload.connectorUserId}`);
}

/**
 * Handler: intro.opportunity_completed
 * Marks opportunity as actioned and pauses other opportunities for same prospect
 */
export async function handleIntroOpportunityCompleted(event: Event): Promise<void> {
  console.log(`[intro.opportunity_completed] Processing event ${event.id}`);

  const payload = event.payload as unknown as {
    introOpportunityId: string;
    prospectName: string;
  };

  // Fetch the completed intro opportunity
  const { data: completedOpp } = await supabase
    .from('intro_opportunities')
    .select('connector_user_id')
    .eq('id', payload.introOpportunityId)
    .single();

  if (completedOpp) {
    // Mark this opportunity as actioned
    await supabase
      .from('user_priorities')
      .update({ status: 'actioned' })
      .eq('item_id', payload.introOpportunityId)
      .eq('item_type', 'intro_opportunity');
  }

  // Pause other opportunities for same prospect
  const { data: similarOpps } = await supabase
    .from('intro_opportunities')
    .select('id, connector_user_id')
    .ilike('prospect_name', `%${payload.prospectName}%`)
    .eq('status', 'open')
    .neq('id', payload.introOpportunityId);

  if (similarOpps && similarOpps.length > 0) {
    const oppIds = similarOpps.map(opp => opp.id);

    await supabase
      .from('user_priorities')
      .update({ status: 'expired' })
      .in('item_id', oppIds)
      .eq('item_type', 'intro_opportunity');

    console.log(`[intro.opportunity_completed] ✓ Paused ${similarOpps.length} similar opportunities`);
  }
}

/**
 * Handler: connection.request_accepted
 * Marks connection request as actioned in introducee's priorities
 */
export async function handleConnectionRequestAccepted(event: Event): Promise<void> {
  console.log(`[connection.request_accepted] Processing event ${event.id}`);

  const payload = event.payload as unknown as {
    connectionRequestId: string;
    introduceeUserId: string;
  };

  const { error } = await supabase
    .from('user_priorities')
    .update({ status: 'actioned' })
    .eq('item_id', payload.connectionRequestId)
    .eq('item_type', 'connection_request')
    .eq('user_id', payload.introduceeUserId);

  if (error) {
    console.error(`[connection.request_accepted] Failed to update priority:`, error);
    throw error;
  }

  console.log(`[connection.request_accepted] ✓ Marked as actioned for introducee ${payload.introduceeUserId}`);
}

/**
 * Handler: connection.request_declined
 * Marks connection request as expired in introducee's priorities
 */
export async function handleConnectionRequestDeclined(event: Event): Promise<void> {
  console.log(`[connection.request_declined] Processing event ${event.id}`);

  const payload = event.payload as unknown as {
    connectionRequestId: string;
    introduceeUserId: string;
  };

  const { error } = await supabase
    .from('user_priorities')
    .update({ status: 'expired' })
    .eq('item_id', payload.connectionRequestId)
    .eq('item_type', 'connection_request')
    .eq('user_id', payload.introduceeUserId);

  if (error) {
    console.error(`[connection.request_declined] Failed to update priority:`, error);
    throw error;
  }

  console.log(`[connection.request_declined] ✓ Marked as expired for introducee ${payload.introduceeUserId}`);
}

/**
 * Handler: intro.offer_declined
 * Marks intro offer as expired in introducee's priorities
 */
export async function handleIntroOfferDeclined(event: Event): Promise<void> {
  console.log(`[intro.offer_declined] Processing event ${event.id}`);

  const payload = event.payload as unknown as {
    introOfferId: string;
    introduceeUserId: string;
  };

  const { error } = await supabase
    .from('user_priorities')
    .update({ status: 'expired' })
    .eq('item_id', payload.introOfferId)
    .eq('item_type', 'intro_offer')
    .eq('user_id', payload.introduceeUserId);

  if (error) {
    console.error(`[intro.offer_declined] Failed to update priority:`, error);
    throw error;
  }

  console.log(`[intro.offer_declined] ✓ Marked as expired for introducee ${payload.introduceeUserId}`);
}

/**
 * Handler: intro.offer_confirmed
 * Marks confirmation task as actioned in offering_user's priorities
 */
export async function handleIntroOfferConfirmed(event: Event): Promise<void> {
  console.log(`[intro.offer_confirmed] Processing event ${event.id}`);

  const payload = event.payload as unknown as {
    introOfferId: string;
    offeringUserId: string;
  };

  const { error } = await supabase
    .from('user_priorities')
    .update({ status: 'actioned' })
    .eq('item_id', payload.introOfferId)
    .eq('item_type', 'intro_offer_confirmation')
    .eq('user_id', payload.offeringUserId);

  if (error) {
    console.error(`[intro.offer_confirmed] Failed to update priority:`, error);
    throw error;
  }

  console.log(`[intro.offer_confirmed] ✓ Marked confirmation as actioned for offering_user ${payload.offeringUserId}`);
}

/**
 * Handler: intro.opportunity_cancelled
 * Removes opportunity from connector's priorities
 */
export async function handleIntroOpportunityCancelled(event: Event): Promise<void> {
  console.log(`[intro.opportunity_cancelled] Processing event ${event.id}`);

  const payload = event.payload as unknown as {
    introOpportunityId: string;
  };

  const { error } = await supabase
    .from('user_priorities')
    .delete()
    .eq('item_id', payload.introOpportunityId)
    .eq('item_type', 'intro_opportunity');

  if (error) {
    console.error(`[intro.opportunity_cancelled] Failed to remove from priorities:`, error);
    throw error;
  }

  console.log(`[intro.opportunity_cancelled] ✓ Removed from priorities`);
}
