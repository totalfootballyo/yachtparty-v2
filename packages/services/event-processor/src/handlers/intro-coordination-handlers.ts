/**
 * Intro Coordination Handlers (Agent of Humans)
 *
 * Handles multi-step intro flow coordination:
 * - Two-step acceptance for intro_offers (introducee → connector confirmation)
 * - Credit awarding when intros complete
 * - Close-loop messaging to both parties
 * - Special handling for intro_offers to innovators (warm_intro_bounty)
 *
 * These handlers implement the "Agent of Humans" coordination logic
 * that facilitates human-to-human introductions on the platform.
 */

import { createClient } from '@supabase/supabase-js';
import type { Event } from '../types';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

/**
 * Handler: intro.offer_confirmed
 * Awards credits to connector and closes loop with both parties
 *
 * This is the final step in the two-step intro_offer flow:
 * 1. Introducee accepts (handled by intro-priority-handlers)
 * 2. Connector confirms they made the intro (this handler)
 * 3. Credits awarded + close-loop messages sent
 */
export async function handleIntroOfferCompleted(event: Event): Promise<void> {
  console.log(`[intro.offer_confirmed] Processing event ${event.id}`);

  const payload = event.payload as unknown as {
    introOfferId: string;
    offeringUserId: string;
    introduceeUserId?: string;
    prospectName?: string;
    bountyCredits?: number;
  };

  // Fetch intro offer to get full details
  const { data: introOffer, error: offerError } = await supabase
    .from('intro_offers')
    .select('*')
    .eq('id', payload.introOfferId)
    .single();

  if (offerError || !introOffer) {
    console.error(`[intro.offer_confirmed] Failed to fetch intro offer:`, offerError);
    throw offerError || new Error('Intro offer not found');
  }

  // STEP 1: Update priority status (marks confirmation as actioned)
  await supabase
    .from('user_priorities')
    .update({ status: 'actioned' })
    .eq('item_id', payload.introOfferId)
    .eq('item_type', 'intro_offer_confirmation')
    .eq('user_id', payload.offeringUserId);

  // STEP 2: Award credits to connector
  await awardCredits(
    payload.offeringUserId,
    introOffer.bounty_credits,
    'intro_offer_completed',
    payload.introOfferId
  );

  console.log(`[intro.offer_confirmed] ✓ Awarded ${introOffer.bounty_credits} credits to ${payload.offeringUserId}`);

  // STEP 3: Close loop with both parties
  await closeLoopWithIntroducee(introOffer);
  await closeLoopWithConnector(introOffer);

  console.log(`[intro.offer_confirmed] ✓ Completed intro offer ${payload.introOfferId}`);
}

/**
 * Handler: intro.opportunity_completed
 * Awards credits to connector when they complete an intro opportunity
 * Also handles priority updates and pausing similar opportunities
 */
export async function handleIntroOpportunityCompletedCredits(event: Event): Promise<void> {
  console.log(`[intro.opportunity_completed] Processing credits for event ${event.id}`);

  const payload = event.payload as unknown as {
    introOpportunityId: string;
    connectorUserId?: string;
    bountyCredits?: number;
    prospectName?: string;
  };

  // Fetch intro opportunity to get full details
  const { data: introOpp, error: oppError } = await supabase
    .from('intro_opportunities')
    .select('*')
    .eq('id', payload.introOpportunityId)
    .single();

  if (oppError || !introOpp) {
    console.error(`[intro.opportunity_completed] Failed to fetch intro opportunity:`, oppError);
    throw oppError || new Error('Intro opportunity not found');
  }

  // STEP 1: Mark this opportunity as actioned in priorities
  await supabase
    .from('user_priorities')
    .update({ status: 'actioned' })
    .eq('item_id', payload.introOpportunityId)
    .eq('item_type', 'intro_opportunity');

  // STEP 2: Pause other opportunities for same prospect
  const { data: similarOpps } = await supabase
    .from('intro_opportunities')
    .select('id, connector_user_id')
    .ilike('prospect_name', `%${introOpp.prospect_name}%`)
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

  // STEP 3: Award credits to connector
  await awardCredits(
    introOpp.connector_user_id,
    introOpp.bounty_credits,
    'intro_opportunity_completed',
    payload.introOpportunityId
  );

  console.log(`[intro.opportunity_completed] ✓ Awarded ${introOpp.bounty_credits} credits to ${introOpp.connector_user_id}`);

  // STEP 4: Close loop with connector
  await supabase.from('events').insert({
    event_type: 'message.send.requested',
    aggregate_id: introOpp.connector_user_id,
    aggregate_type: 'user',
    payload: {
      userId: introOpp.connector_user_id,
      agentId: 'agent_of_humans',
      messageData: {
        template: 'intro_opportunity_completed',
        context: {
          prospect_name: introOpp.prospect_name,
          innovator_name: introOpp.innovator_name,
          credits_earned: introOpp.bounty_credits,
        },
      },
      priority: 'low',
      canDelay: true,
    },
    created_by: 'event_processor',
  });
}

/**
 * Handler: connection.request_completed
 * Notifies both parties that connection was successfully made
 */
export async function handleConnectionRequestCompleted(event: Event): Promise<void> {
  console.log(`[connection.request_completed] Processing event ${event.id}`);

  const payload = event.payload as unknown as {
    connectionRequestId: string;
    innovatorUserId: string;
    introduceeUserId: string;
    introduceeProspectName: string;
  };

  // Fetch connection request
  const { data: connReq, error: reqError } = await supabase
    .from('connection_requests')
    .select('*')
    .eq('id', payload.connectionRequestId)
    .single();

  if (reqError || !connReq) {
    console.error(`[connection.request_completed] Failed to fetch connection request:`, reqError);
    throw reqError || new Error('Connection request not found');
  }

  // Thank introducee for making the intro
  await supabase.from('events').insert({
    event_type: 'message.send.requested',
    aggregate_id: payload.introduceeUserId,
    aggregate_type: 'user',
    payload: {
      userId: payload.introduceeUserId,
      agentId: 'agent_of_humans',
      messageData: {
        template: 'connection_request_thanks',
        context: {
          prospect_name: payload.introduceeProspectName,
          innovator_user_id: payload.innovatorUserId,
        },
      },
      priority: 'low',
      canDelay: true,
    },
    created_by: 'event_processor',
  });

  // Notify innovator the connection was made
  await supabase.from('events').insert({
    event_type: 'message.send.requested',
    aggregate_id: payload.innovatorUserId,
    aggregate_type: 'user',
    payload: {
      userId: payload.innovatorUserId,
      agentId: 'agent_of_humans',
      messageData: {
        template: 'connection_request_completed',
        context: {
          introducee_prospect_name: payload.introduceeProspectName,
          introducee_user_id: payload.introduceeUserId,
        },
      },
      priority: 'medium',
      canDelay: false,
    },
    created_by: 'event_processor',
  });

  console.log(`[connection.request_completed] ✓ Closed loop for connection request ${payload.connectionRequestId}`);
}

/**
 * Helper: Award credits to a user
 */
async function awardCredits(
  userId: string,
  amount: number,
  reason: string,
  contextId: string
): Promise<void> {
  // Update user's credit balance
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('credit_balance')
    .eq('id', userId)
    .single();

  if (userError || !user) {
    console.error(`[awardCredits] Failed to fetch user:`, userError);
    throw userError || new Error('User not found');
  }

  const newBalance = (user.credit_balance || 0) + amount;

  const { error: updateError } = await supabase
    .from('users')
    .update({ credit_balance: newBalance })
    .eq('id', userId);

  if (updateError) {
    console.error(`[awardCredits] Failed to update credit balance:`, updateError);
    throw updateError;
  }

  // Log credit transaction
  await supabase.from('credit_transactions').insert({
    user_id: userId,
    amount,
    transaction_type: 'credit',
    reason,
    context_id: contextId,
    balance_after: newBalance,
  });

  console.log(`[awardCredits] ✓ Awarded ${amount} credits to ${userId} (new balance: ${newBalance})`);
}

/**
 * Helper: Close loop with introducee (person who received the intro)
 */
async function closeLoopWithIntroducee(introOffer: any): Promise<void> {
  const messageText = `Hope the intro to ${introOffer.prospect_name} was helpful. Let us know how it goes.`;

  await supabase.from('events').insert({
    event_type: 'message.send.requested',
    aggregate_id: introOffer.introducee_user_id,
    aggregate_type: 'user',
    payload: {
      userId: introOffer.introducee_user_id,
      agentId: 'agent_of_humans',
      messageData: {
        template: 'intro_offer_close_loop_introducee',
        context: {
          prospect_name: introOffer.prospect_name,
          offering_user_id: introOffer.offering_user_id,
        },
        message: messageText,
      },
      priority: 'low',
      canDelay: true,
    },
    created_by: 'event_processor',
  });

  console.log(`[closeLoopWithIntroducee] ✓ Queued close-loop message for ${introOffer.introducee_user_id}`);
}

/**
 * Helper: Close loop with connector (person who made the intro)
 */
async function closeLoopWithConnector(introOffer: any): Promise<void> {
  // Fetch introducee name for personalization
  const { data: introducee } = await supabase
    .from('users')
    .select('first_name, last_name')
    .eq('id', introOffer.introducee_user_id)
    .single();

  const introduceeName = introducee
    ? `${introducee.first_name} ${introducee.last_name}`
    : 'the introducee';

  const messageText = `Thanks for making that intro to ${introOffer.prospect_name}. ${introduceeName} appreciated it.`;

  await supabase.from('events').insert({
    event_type: 'message.send.requested',
    aggregate_id: introOffer.offering_user_id,
    aggregate_type: 'user',
    payload: {
      userId: introOffer.offering_user_id,
      agentId: 'agent_of_humans',
      messageData: {
        template: 'intro_offer_close_loop_connector',
        context: {
          prospect_name: introOffer.prospect_name,
          introducee_name: introduceeName,
          credits_earned: introOffer.bounty_credits,
        },
        message: messageText,
      },
      priority: 'low',
      canDelay: true,
    },
    created_by: 'event_processor',
  });

  console.log(`[closeLoopWithConnector] ✓ Queued close-loop message for ${introOffer.offering_user_id}`);
}

/**
 * Handler: intro.offer_reminder
 * Sends reminder to connector 3 days after introducee accepts if not yet confirmed
 *
 * NOTE: Innovator bounty logic has been integrated into handleIntroOfferCreated
 * in intro-priority-handlers.ts to avoid duplicate event handling.
 */
export async function handleIntroOfferReminder(event: Event): Promise<void> {
  console.log(`[intro.offer_reminder] Processing event ${event.id}`);

  const payload = event.payload as unknown as {
    introOfferId: string;
    offeringUserId: string;
  };

  // Check if intro_offer is still pending confirmation
  const { data: introOffer, error: offerError } = await supabase
    .from('intro_offers')
    .select('status, prospect_name')
    .eq('id', payload.introOfferId)
    .single();

  if (offerError || !introOffer) {
    console.log(`[intro.offer_reminder] Intro offer ${payload.introOfferId} not found or deleted`);
    return;
  }

  if (introOffer.status !== 'accepted') {
    console.log(`[intro.offer_reminder] Intro offer ${payload.introOfferId} status is ${introOffer.status}, skipping reminder`);
    return;
  }

  // Send reminder message
  await supabase.from('events').insert({
    event_type: 'message.send.requested',
    aggregate_id: payload.offeringUserId,
    aggregate_type: 'user',
    payload: {
      userId: payload.offeringUserId,
      agentId: 'agent_of_humans',
      messageData: {
        template: 'intro_offer_confirmation_reminder',
        context: {
          prospect_name: introOffer.prospect_name,
          intro_offer_id: payload.introOfferId,
        },
      },
      priority: 'medium',
      canDelay: false,
    },
    created_by: 'event_processor',
  });

  console.log(`[intro.offer_reminder] ✓ Sent confirmation reminder to ${payload.offeringUserId}`);
}

/**
 * Helper: Create scheduled reminder task
 * Called after intro_offer_accepted to schedule a reminder 3 days later
 */
export async function scheduleIntroOfferReminder(
  introOfferId: string,
  offeringUserId: string
): Promise<void> {
  const reminderTime = new Date();
  reminderTime.setDate(reminderTime.getDate() + 3); // 3 days from now

  await supabase.from('agent_tasks').insert({
    task_type: 'intro_offer_confirmation_reminder',
    agent_type: 'agent_of_humans',
    user_id: offeringUserId,
    context_id: introOfferId,
    context_type: 'intro_offer',
    scheduled_for: reminderTime.toISOString(),
    priority: 'medium',
    context_json: {
      intro_offer_id: introOfferId,
      reminder_type: 'confirmation_pending',
    },
    created_by: 'event_processor',
  });

  console.log(`[scheduleIntroOfferReminder] ✓ Scheduled reminder for ${offeringUserId} at ${reminderTime.toISOString()}`);
}
