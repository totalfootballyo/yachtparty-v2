/**
 * Account Manager - Introduction Flow Prioritization
 *
 * Handles prioritization for three intro flows:
 * 1. intro_opportunities - System matches connector to prospect
 * 2. connection_requests - Requestor wants to meet introducee
 * 3. intro_offers - User offers to introduce someone
 *
 * @module account-manager/intro-prioritization
 */

import type { SupabaseClient } from '@supabase/supabase-js';

interface PriorityItem {
  id: string;
  score: number;
  reason: string;
  data: {
    item_type: string;
    item_id: string;
    [key: string]: any;
  };
}

/**
 * Calculate days between two dates
 */
function daysBetween(date1: Date, date2: Date): number {
  const diffMs = Math.abs(date2.getTime() - date1.getTime());
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Load intro_opportunities for this user where they are the connector
 * Score based on: bounty_credits, prospect relevance, connection strength
 */
export async function loadIntroOpportunities(
  userId: string,
  supabase: SupabaseClient
): Promise<PriorityItem[]> {
  const { data: opportunities, error } = await supabase
    .from('intro_opportunities')
    .select('*, prospect:prospect_id(*), innovator:innovator_id(*)')
    .eq('connector_user_id', userId)
    .eq('status', 'open')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[Account Manager] Error loading intro_opportunities:', error);
    return [];
  }

  if (!opportunities || opportunities.length === 0) return [];

  return opportunities.map((opp) => {
    let score = 50; // Base score

    // Higher bounty = higher priority
    score += Math.min(opp.bounty_credits / 2, 30); // Max +30 for 60 credits

    // LinkedIn connection strength matters
    if (opp.connection_strength === 'first_degree') score += 15;
    else if (opp.connection_strength === 'second_degree') score += 5;

    // Recent prospects more urgent
    const daysSinceCreated = daysBetween(new Date(opp.created_at), new Date());
    if (daysSinceCreated < 3) score += 10;

    return {
      id: opp.id,
      score,
      reason: `Intro opportunity: Connect ${opp.prospect.name} at ${opp.prospect.company} to ${opp.innovator.first_name} (${opp.bounty_credits} credits)`,
      data: {
        item_type: 'intro_opportunity',
        item_id: opp.id,
        prospect_name: opp.prospect.name,
        prospect_company: opp.prospect.company,
        bounty_credits: opp.bounty_credits,
      },
    };
  });
}

/**
 * Load connection_requests where this user is the introducee (target)
 * Score based on: vouching signals, requestor relevance, intro_context quality
 */
export async function loadConnectionRequests(
  userId: string,
  supabase: SupabaseClient
): Promise<PriorityItem[]> {
  const { data: requests, error } = await supabase
    .from('connection_requests')
    .select('*')
    .eq('introducee_user_id', userId)
    .eq('status', 'open')
    .order('created_at', { ascending: false});

  if (error) {
    console.error('[Account Manager] Error loading connection_requests:', error);
    return [];
  }

  if (!requests || requests.length === 0) return [];

  return requests.map((req) => {
    let score = 60; // Base score (higher than intro_opportunities - direct request)

    // Vouching increases priority significantly
    const vouchCount = req.vouched_by_user_ids?.length || 0;
    score += vouchCount * 20; // Each vouch adds 20 points

    // Requestor credits spent shows seriousness
    score += Math.min(req.requestor_credits_spent / 5, 15); // Max +15

    // Time-sensitive: newer requests more urgent
    const daysSinceCreated = daysBetween(new Date(req.created_at), new Date());
    if (daysSinceCreated < 2) score += 15;
    else if (daysSinceCreated > 14) score -= 10; // Stale requests less urgent

    return {
      id: req.id,
      score,
      reason: `Connection request: ${req.requestor_name} wants to meet you${vouchCount > 0 ? ` (${vouchCount} vouch${vouchCount > 1 ? 'es' : ''})` : ''}`,
      data: {
        item_type: 'connection_request',
        item_id: req.id,
        requestor_name: req.requestor_name,
        requestor_company: req.requestor_company,
        intro_context: req.intro_context,
        vouch_count: vouchCount,
      },
    };
  });
}

/**
 * Load intro_offers where this user is introducee OR connector
 * Two-phase flow: introducee accepts first, then connector confirms
 */
export async function loadIntroOffers(
  userId: string,
  supabase: SupabaseClient
): Promise<PriorityItem[]> {
  // Get offers where user is introducee (pending their response)
  const { data: introduceeOffers, error: introduceeError } = await supabase
    .from('intro_offers')
    .select('*, offering_user:offering_user_id(first_name, last_name)')
    .eq('introducee_user_id', userId)
    .eq('status', 'pending_introducee_response')
    .order('created_at', { ascending: false });

  if (introduceeError) {
    console.error('[Account Manager] Error loading introducee intro_offers:', introduceeError);
  }

  // Get offers where user is connector (pending their confirmation)
  const { data: connectorOffers, error: connectorError } = await supabase
    .from('intro_offers')
    .select('*, introducee:introducee_user_id(first_name, last_name)')
    .eq('offering_user_id', userId)
    .eq('status', 'pending_connector_confirmation')
    .order('created_at', { ascending: false });

  if (connectorError) {
    console.error('[Account Manager] Error loading connector intro_offers:', connectorError);
  }

  const priorities: PriorityItem[] = [];

  // Prioritize introducee offers (user needs to accept/decline)
  (introduceeOffers || []).forEach((offer) => {
    let score = 55; // Base score

    // Higher bounty = more urgent
    score += Math.min(offer.bounty_credits / 2, 25);

    // Context-based scoring
    if (offer.context_type === 'community_request') score += 10; // User asked for this
    if (offer.context_type === 'nomination') score += 5; // Someone nominated this person

    // Recent offers more urgent
    const daysSinceCreated = daysBetween(new Date(offer.created_at), new Date());
    if (daysSinceCreated < 2) score += 10;

    priorities.push({
      id: offer.id,
      score,
      reason: `Intro offer: ${offer.offering_user.first_name} can introduce you to ${offer.prospect_name}${offer.bounty_credits > 0 ? ` (${offer.bounty_credits} credits)` : ''}`,
      data: {
        item_type: 'intro_offer',
        item_id: offer.id,
        role: 'introducee',
        prospect_name: offer.prospect_name,
        prospect_company: offer.prospect_company,
        offering_user_name: `${offer.offering_user.first_name} ${offer.offering_user.last_name}`,
        bounty_credits: offer.bounty_credits,
      },
    });
  });

  // Prioritize connector confirmation (user offered intro, introducee accepted)
  (connectorOffers || []).forEach((offer) => {
    let score = 70; // High priority - user already committed to this

    // Recent acceptances most urgent
    const daysSinceCreated = daysBetween(new Date(offer.created_at), new Date());
    if (daysSinceCreated < 1) score += 15; // Less than 1 day old - very urgent

    priorities.push({
      id: offer.id,
      score,
      reason: `Confirm intro: ${offer.introducee.first_name} accepted your offer to meet ${offer.prospect_name}`,
      data: {
        item_type: 'intro_offer',
        item_id: offer.id,
        role: 'connector',
        prospect_name: offer.prospect_name,
        introducee_name: `${offer.introducee.first_name} ${offer.introducee.last_name}`,
      },
    });
  });

  return priorities;
}

/**
 * When intro_opportunity accepted → pause other opportunities for same prospect
 */
export async function handleIntroOpportunityAccepted(
  introOpportunityId: string,
  supabase: SupabaseClient
): Promise<void> {
  // Get the accepted opportunity
  const { data: accepted, error: selectError } = await supabase
    .from('intro_opportunities')
    .select('prospect_id')
    .eq('id', introOpportunityId)
    .single();

  if (selectError || !accepted) {
    console.error('[Account Manager] Error fetching accepted intro_opportunity:', selectError);
    return;
  }

  // Pause all other open opportunities for this prospect
  const { error: updateError } = await supabase
    .from('intro_opportunities')
    .update({ status: 'paused' })
    .eq('prospect_id', accepted.prospect_id)
    .eq('status', 'open')
    .neq('id', introOpportunityId);

  if (updateError) {
    console.error('[Account Manager] Error pausing other intro_opportunities:', updateError);
  } else {
    console.log(
      `[Account Manager] Paused other intro_opportunities for prospect ${accepted.prospect_id}`
    );
  }
}

/**
 * When intro_opportunity completed → cancel others for same prospect
 */
export async function handleIntroOpportunityCompleted(
  introOpportunityId: string,
  supabase: SupabaseClient
): Promise<void> {
  // Get the completed opportunity
  const { data: completed, error: selectError } = await supabase
    .from('intro_opportunities')
    .select('prospect_id')
    .eq('id', introOpportunityId)
    .single();

  if (selectError || !completed) {
    console.error('[Account Manager] Error fetching completed intro_opportunity:', selectError);
    return;
  }

  // Cancel all other opportunities for this prospect
  const { error: updateError } = await supabase
    .from('intro_opportunities')
    .update({ status: 'cancelled' })
    .eq('prospect_id', completed.prospect_id)
    .in('status', ['open', 'paused'])
    .neq('id', introOpportunityId);

  if (updateError) {
    console.error('[Account Manager] Error cancelling other intro_opportunities:', updateError);
  } else {
    console.log(
      `[Account Manager] Cancelled other intro_opportunities for prospect ${completed.prospect_id}`
    );
  }
}
