/**
 * Prospect-to-User Upgrade Logic
 *
 * Handles automatic upgrade flow when a prospect joins as a user.
 * Uses fuzzy matching to find all potential prospect records.
 *
 * @module prospect-upgrade
 */

import { createServiceClient } from './supabase';
import { findMatchingProspects } from './prospect-matching';
import type { ProspectMatch } from './prospect-matching';
import { publishEvent } from './events';

/**
 * Result of prospect upgrade operation.
 */
export interface ProspectUpgradeResult {
  success: boolean;
  prospectsMatched: number;
  introOpportunitiesCreated: number;
  creditEventsCreated: number;
  matches: Array<{
    prospectId: string;
    innovatorId: string;
    matchScore: number;
    introOpportunityId?: string;
  }>;
  errors: string[];
}

/**
 * Upgrades matching prospects to intro opportunities when user joins.
 *
 * Flow:
 * 1. Find all matching prospect records (fuzzy matching, 70+ score)
 * 2. For each match:
 *    - Update prospect status to 'converted'
 *    - Set converted_to_user_id and converted_at
 *    - Create intro_opportunity for the innovator
 *    - Award credits to innovator
 *    - Publish events
 * 3. Return detailed results
 *
 * Note: If multiple innovators uploaded the same prospect, ALL get intro opportunities.
 *
 * @param userId - User ID of the newly joined user
 * @returns Upgrade result with match details
 */
export async function upgradeProspectsToUser(
  userId: string
): Promise<ProspectUpgradeResult> {
  const supabase = createServiceClient();

  try {
    // 1. Fetch user record
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return {
        success: false,
        prospectsMatched: 0,
        introOpportunitiesCreated: 0,
        creditEventsCreated: 0,
        matches: [],
        errors: ['User not found']
      };
    }

    // 2. Fetch all pending prospects
    const { data: prospects, error: prospectsError } = await supabase
      .from('prospects')
      .select('*')
      .eq('status', 'pending');

    if (prospectsError) {
      return {
        success: false,
        prospectsMatched: 0,
        introOpportunitiesCreated: 0,
        creditEventsCreated: 0,
        matches: [],
        errors: [prospectsError.message]
      };
    }

    if (!prospects || prospects.length === 0) {
      // No prospects to match - this is fine
      return {
        success: true,
        prospectsMatched: 0,
        introOpportunitiesCreated: 0,
        creditEventsCreated: 0,
        matches: [],
        errors: []
      };
    }

    // 3. Find matching prospects using fuzzy matching
    const matches: ProspectMatch[] = findMatchingProspects(
      prospects,
      {
        email: user.email,
        phone_number: user.phone_number,
        linkedin_url: user.linkedin_url,
        first_name: user.first_name,
        last_name: user.last_name,
        company: user.company
      },
      { minScore: 70 } // High confidence matches only
    );

    if (matches.length === 0) {
      // No matches - this is fine
      return {
        success: true,
        prospectsMatched: 0,
        introOpportunitiesCreated: 0,
        creditEventsCreated: 0,
        matches: [],
        errors: []
      };
    }

    // 4. Process each match
    const results: Array<{
      prospectId: string;
      innovatorId: string;
      matchScore: number;
      introOpportunityId?: string;
    }> = [];

    const errors: string[] = [];
    let introOpportunitiesCreated = 0;
    let creditEventsCreated = 0;

    for (const match of matches) {
      const prospect = prospects.find((p: any) => p.id === match.prospectId);
      if (!prospect) continue;

      try {
        // Update prospect status
        const { error: updateError } = await supabase
          .from('prospects')
          .update({
            status: 'converted',
            converted_to_user_id: userId,
            converted_at: new Date().toISOString()
          })
          .eq('id', prospect.id);

        if (updateError) {
          errors.push(`Failed to update prospect ${prospect.id}: ${updateError.message}`);
          continue;
        }

        // Create intro opportunity
        const { data: introOpportunity, error: introError } = await supabase
          .from('intro_opportunities')
          .insert({
            connector_user_id: prospect.innovator_id,
            prospect_id: prospect.id,
            prospect_name: `${user.first_name} ${user.last_name}`.trim(),
            prospect_company: user.company,
            prospect_title: user.title,
            prospect_linkedin_url: user.linkedin_url,
            prospect_email: user.email,
            prospect_phone: user.phone_number,
            status: 'open',
            bounty_credits: 50, // Standard intro bounty
            converted_user_id: userId,
            metadata: {
              auto_created: true,
              match_score: match.score,
              match_confidence: match.confidence,
              matched_fields: match.matchedFields
            }
          })
          .select()
          .single();

        if (introError) {
          errors.push(`Failed to create intro opportunity for prospect ${prospect.id}: ${introError.message}`);
          continue;
        }

        introOpportunitiesCreated++;

        // Award credits to innovator (prospect conversion reward)
        const { error: creditError } = await supabase
          .from('credit_events')
          .insert({
            user_id: prospect.innovator_id,
            event_type: 'prospect_converted',
            amount: 25, // Conversion bonus
            description: `Prospect ${user.first_name} ${user.last_name} joined the platform`,
            reference_type: 'intro_opportunity',
            reference_id: introOpportunity.id,
            idempotency_key: `prospect_converted_${prospect.id}_${userId}`,
            created_by: 'system'
          });

        if (!creditError) {
          creditEventsCreated++;
        }

        // Publish events
        await publishEvent({
          event_type: 'prospects.converted',
          aggregate_id: prospect.id,
          aggregate_type: 'prospect',
          payload: {
            prospect_id: prospect.id,
            user_id: userId,
            innovator_id: prospect.innovator_id,
            match_score: match.score,
            intro_opportunity_id: introOpportunity.id
          },
          created_by: 'system'
        });

        await publishEvent({
          event_type: 'intro.opportunity_created',
          aggregate_id: introOpportunity.id,
          aggregate_type: 'intro_opportunity',
          payload: {
            connector_user_id: prospect.innovator_id,
            prospect_name: `${user.first_name} ${user.last_name}`.trim(),
            auto_created: true,
            from_prospect_upgrade: true
          },
          created_by: 'system'
        });

        results.push({
          prospectId: prospect.id,
          innovatorId: prospect.innovator_id,
          matchScore: match.score,
          introOpportunityId: introOpportunity.id
        });

      } catch (error: any) {
        errors.push(`Error processing prospect ${prospect.id}: ${error.message}`);
      }
    }

    // 5. Return results
    return {
      success: errors.length === 0,
      prospectsMatched: matches.length,
      introOpportunitiesCreated,
      creditEventsCreated,
      matches: results,
      errors
    };

  } catch (error: any) {
    return {
      success: false,
      prospectsMatched: 0,
      introOpportunitiesCreated: 0,
      creditEventsCreated: 0,
      matches: [],
      errors: [error.message || 'Unknown error during prospect upgrade']
    };
  }
}

/**
 * Checks if a user should trigger prospect upgrade.
 *
 * Criteria:
 * - User is verified (completed onboarding)
 * - User has at least one contact method (email, phone, LinkedIn)
 * - Has not been checked for prospect matches before
 *
 * @param userId - User ID to check
 * @returns True if upgrade should be triggered
 */
export async function shouldTriggerProspectUpgrade(
  userId: string
): Promise<boolean> {
  const supabase = createServiceClient();

  const { data: user, error } = await supabase
    .from('users')
    .select('verified, email, phone_number, linkedin_url, metadata')
    .eq('id', userId)
    .single();

  if (error || !user) {
    return false;
  }

  // Must be verified
  if (!user.verified) {
    return false;
  }

  // Must have at least one contact method
  if (!user.email && !user.phone_number && !user.linkedin_url) {
    return false;
  }

  // Check if already processed
  const metadata = user.metadata as any;
  if (metadata?.prospect_upgrade_checked) {
    return false;
  }

  return true;
}

/**
 * Marks user as checked for prospect upgrades.
 *
 * Sets metadata flag to prevent duplicate processing.
 *
 * @param userId - User ID to mark
 */
export async function markProspectUpgradeChecked(
  userId: string
): Promise<void> {
  const supabase = createServiceClient();

  const { data: user } = await supabase
    .from('users')
    .select('metadata')
    .eq('id', userId)
    .single();

  const metadata = (user?.metadata || {}) as any;
  metadata.prospect_upgrade_checked = true;
  metadata.prospect_upgrade_checked_at = new Date().toISOString();

  await supabase
    .from('users')
    .update({ metadata })
    .eq('id', userId);
}
