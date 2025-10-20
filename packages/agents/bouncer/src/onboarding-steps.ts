/**
 * Onboarding Steps Helper Functions
 *
 * Utility functions for managing user onboarding workflow.
 * Each function handles a specific step in the onboarding process.
 *
 * @module onboarding-steps
 */

import { createServiceClient, publishEvent, createAgentTask, upgradeProspectsToUser, shouldTriggerProspectUpgrade, markProspectUpgradeChecked } from '@yachtparty/shared';
import type { User, Conversation } from '@yachtparty/shared';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Onboarding progress check result.
 */
export interface OnboardingProgress {
  /** Whether user has completed all onboarding steps */
  isComplete: boolean;

  /** Which required fields are still missing */
  missingFields: string[];

  /** Current onboarding step */
  currentStep: OnboardingStep;

  /** Fields that were just collected (if any) */
  recentlyCollected?: string[];
}

/**
 * Onboarding step enum.
 */
export type OnboardingStep =
  | 'welcome'
  | 'name_collection'
  | 'company_collection'
  | 'email_verification'
  | 'linkedin_connection'
  | 'first_nomination'
  | 'complete';

/**
 * Checks onboarding progress for a user.
 *
 * Determines what information is missing and what the next step should be.
 *
 * @param user - User record to check
 * @param conversation - Current conversation
 * @returns Onboarding progress information
 */
export function checkOnboardingProgress(
  user: User,
  conversation: Conversation
): OnboardingProgress {
  const missingFields: string[] = [];

  // Check required fields
  if (!user.first_name) missingFields.push('first_name');
  if (!user.last_name) missingFields.push('last_name');
  if (!user.company) missingFields.push('company');
  if (!user.title) missingFields.push('title');
  if (!user.email_verified) missingFields.push('email'); // Check email_verified, not just email

  // Determine current step based on what's missing
  let currentStep: OnboardingStep = 'complete';

  if (missingFields.includes('first_name') || missingFields.includes('last_name')) {
    currentStep = 'name_collection';
  } else if (missingFields.includes('company') || missingFields.includes('title')) {
    currentStep = 'company_collection';
  } else if (missingFields.includes('email')) {
    currentStep = 'email_verification';
  } else if (!user.linkedin_url) {
    currentStep = 'linkedin_connection';
  } else if (user.verified) {
    currentStep = 'complete';
  }

  // Check if this is a brand new user (first message)
  if (!user.first_name && !user.last_name && !user.company && conversation.last_message_at === conversation.created_at) {
    currentStep = 'welcome';
  }

  const isComplete = missingFields.length === 0;

  return {
    isComplete,
    missingFields,
    currentStep
  };
}

/**
 * User match result from referral lookup.
 */
export interface ReferralMatch {
  user_id: string;
  first_name: string;
  last_name: string;
  company: string | null;
  score: number; // Relevance score for sorting
}

/**
 * Looks up existing users by name for referral matching.
 *
 * Searches users table by first name, last name, and optionally company.
 * Returns potential matches sorted by relevance.
 *
 * @param providedName - Name string provided by user (e.g., "Ben Trenda" or "Sarah Chen")
 * @param company - Optional company name to narrow search
 * @returns Array of potential matches sorted by relevance score
 */
export async function lookupUserByName(
  providedName: string,
  company?: string
): Promise<ReferralMatch[]> {
  const supabase = createServiceClient();

  // Parse name into first and last name
  const nameParts = providedName.trim().split(/\s+/);
  const firstName = nameParts[0];
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : null;

  // Build query for verified users only
  let query = supabase
    .from('users')
    .select('id, first_name, last_name, company')
    .eq('verified', true);

  // Search by first name (case-insensitive)
  if (firstName) {
    query = query.ilike('first_name', `%${firstName}%`);
  }

  // If we have a last name, add that filter
  if (lastName) {
    query = query.ilike('last_name', `%${lastName}%`);
  }

  const { data: users, error } = await query;

  if (error) {
    console.error('Error looking up users by name:', error);
    return [];
  }

  if (!users || users.length === 0) {
    return [];
  }

  // Score and sort matches
  const matches: ReferralMatch[] = users.map(user => {
    let score = 0;

    // Exact first name match (case insensitive)
    if (user.first_name?.toLowerCase() === firstName?.toLowerCase()) {
      score += 50;
    }

    // Exact last name match (case insensitive)
    if (lastName && user.last_name?.toLowerCase() === lastName.toLowerCase()) {
      score += 50;
    }

    // Company match if provided
    if (company && user.company?.toLowerCase().includes(company.toLowerCase())) {
      score += 30;
    }

    // Bonus for having complete profile
    if (user.first_name && user.last_name && user.company) {
      score += 10;
    }

    return {
      user_id: user.id,
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      company: user.company,
      score
    };
  });

  // Sort by score descending
  return matches.sort((a, b) => b.score - a.score);
}

/**
 * Collects user information from extracted fields and updates user record.
 *
 * @param userId - User ID to update
 * @param extractedFields - Fields extracted from user's message
 * @returns Array of field names that were updated
 */
export async function collectUserInfo(
  userId: string,
  extractedFields: Record<string, any>
): Promise<string[]> {
  const supabase = createServiceClient();
  const updatedFields: string[] = [];
  const updates: Partial<User> = {};

  // Map extracted fields to user record fields
  if (extractedFields.first_name) {
    updates.first_name = extractedFields.first_name;
    updatedFields.push('first_name');
  }

  if (extractedFields.last_name) {
    updates.last_name = extractedFields.last_name;
    updatedFields.push('last_name');
  }

  if (extractedFields.company) {
    updates.company = extractedFields.company;
    updatedFields.push('company');
  }

  if (extractedFields.title) {
    updates.title = extractedFields.title;
    updatedFields.push('title');
  }

  if (extractedFields.linkedin_url) {
    updates.linkedin_url = extractedFields.linkedin_url;
    updatedFields.push('linkedin_url');
  }

  if (extractedFields.email) {
    updates.email = extractedFields.email;
    updatedFields.push('email');
  }

  // Referral tracking fields
  if (extractedFields.referred_by) {
    updates.referred_by = extractedFields.referred_by;
    updatedFields.push('referred_by');
  }

  if (extractedFields.name_dropped) {
    updates.name_dropped = extractedFields.name_dropped;
    updatedFields.push('name_dropped');
  }

  // Update user record if there are changes
  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date();

    const { error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', userId);

    if (error) {
      throw new Error(`Failed to update user ${userId}: ${error.message}`);
    }

    // Publish event for each collected field
    for (const field of updatedFields) {
      await publishEvent({
        event_type: 'user.onboarding_step.completed',
        aggregate_id: userId,
        aggregate_type: 'user',
        payload: {
          step: field,
          value: updates[field as keyof typeof updates]
        },
        created_by: 'bouncer_agent'
      });
    }
  }

  return updatedFields;
}

/**
 * Generates unique verification email address for user.
 *
 * Format: verify-{userId}@verify.yachtparty.xyz
 *
 * @param userId - User ID to generate email for
 * @returns Verification email address
 */
export function generateVerificationEmail(userId: string): string {
  // Use full UUID to match webhook expectations
  return `verify-${userId}@verify.yachtparty.xyz`;
}

/**
 * Checks if user has verified their LinkedIn connection.
 *
 * This creates a task for the Social Butterfly Agent to verify
 * the connection asynchronously.
 *
 * @param userId - User ID to check
 * @param userLinkedInUrl - User's LinkedIn profile URL
 * @returns Task ID of the verification task
 */
export async function checkLinkedInConnection(
  userId: string,
  userLinkedInUrl: string
): Promise<string> {
  // Create task for Social Butterfly Agent
  const task = await createAgentTask({
    task_type: 'verify_linkedin_connection', // Social Butterfly task, not re-engagement
    agent_type: 'social_butterfly',
    user_id: userId,
    context_id: userId,
    context_type: 'user',
    scheduled_for: new Date(), // Immediate - for LinkedIn verification, not re-engagement
    priority: 'medium',
    context_json: {
      user_linkedin_url: userLinkedInUrl,
      founder_linkedin_url: process.env.FOUNDER_LINKEDIN_URL || 'https://linkedin.com/in/founder'
    },
    created_by: 'bouncer_agent'
  });

  // Publish event
  await publishEvent({
    // @ts-expect-error - Event type should be added to shared package EventType enum
    event_type: 'user.linkedin_verification.requested',
    aggregate_id: userId,
    aggregate_type: 'user',
    payload: {
      linkedin_url: userLinkedInUrl,
      task_id: task.id
    },
    created_by: 'bouncer_agent'
  });

  return task.id;
}

/**
 * Completes user onboarding.
 *
 * Sets user.verified = true, changes poc_agent_type to 'concierge',
 * and publishes completion event.
 *
 * @param userId - User ID to complete onboarding for
 * @returns Updated user record
 */
export async function completeOnboarding(userId: string): Promise<User> {
  const supabase = createServiceClient();

  // Update user record
  const { data: user, error } = await supabase
    .from('users')
    .update({
      verified: true,
      poc_agent_type: 'concierge',
      updated_at: new Date()
    })
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to complete onboarding for user ${userId}: ${error.message}`);
  }

  // Publish verification event
  await publishEvent({
    event_type: 'user.verified',
    aggregate_id: userId,
    aggregate_type: 'user',
    payload: {
      verified_at: new Date().toISOString(),
      onboarding_completed: true
    },
    created_by: 'bouncer_agent'
  });

  // Check if we should upgrade any matching prospects
  try {
    const shouldUpgrade = await shouldTriggerProspectUpgrade(userId);

    if (shouldUpgrade) {
      // Trigger prospect upgrade (auto-create intro opportunities)
      const upgradeResult = await upgradeProspectsToUser(userId);

      // Mark as checked (prevent duplicate processing)
      await markProspectUpgradeChecked(userId);

      // Log the results
      if (upgradeResult.success && upgradeResult.prospectsMatched > 0) {
        console.log(`Upgraded ${upgradeResult.prospectsMatched} prospects to intro opportunities for user ${userId}`);

        // Publish event for Account Manager to prioritize
        await publishEvent({
          event_type: 'prospects.upgraded_on_signup',
          aggregate_id: userId,
          aggregate_type: 'user',
          payload: {
            prospects_matched: upgradeResult.prospectsMatched,
            intro_opportunities_created: upgradeResult.introOpportunitiesCreated,
            credits_awarded: upgradeResult.creditEventsCreated
          },
          created_by: 'bouncer_agent'
        });
      }
    }
  } catch (error: any) {
    // Don't fail onboarding if prospect upgrade fails
    console.error('Error during prospect upgrade:', error);
  }

  return user as User;
}

/**
 * Creates re-engagement task for inactive user.
 *
 * Scheduled for 24 hours after current time if user doesn't respond.
 *
 * @param userId - User ID to create task for
 * @param conversationId - Conversation ID
 * @param currentStep - Current onboarding step
 * @param missingFields - Fields still missing
 * @returns Task ID
 */
export async function createReengagementTask(
  userId: string,
  conversationId: string,
  currentStep: OnboardingStep,
  missingFields: string[]
): Promise<string> {
  const supabase = createServiceClient();

  // First, cancel any existing pending re-engagement tasks for this user
  await supabase
    .from('agent_tasks')
    .update({ status: 'cancelled' })
    .eq('user_id', userId)
    .eq('task_type', 're_engagement_check')
    .eq('status', 'pending');

  const scheduledFor = new Date();
  scheduledFor.setHours(scheduledFor.getHours() + 24); // 24 hours from now

  const task = await createAgentTask({
    task_type: 're_engagement_check',
    agent_type: 'bouncer',
    user_id: userId,
    context_id: conversationId,
    context_type: 'conversation',
    scheduled_for: scheduledFor,
    priority: 'medium',
    context_json: {
      current_step: currentStep,
      missing_fields: missingFields,
      last_interaction_at: new Date().toISOString(),
      attemptCount: 1 // Start at 1, will be incremented by task processor
    },
    created_by: 'bouncer_agent'
  });

  return task.id;
}

/**
 * Stores nomination information.
 *
 * Creates intro_opportunity record for the nominated person.
 *
 * @param userId - User ID who made the nomination
 * @param nomination - Nomination details
 * @returns Intro opportunity ID
 */
export async function storeNomination(
  userId: string,
  nomination: {
    name: string;
    company?: string;
    title?: string;
    linkedin_url?: string;
  }
): Promise<string> {
  const supabase = createServiceClient();

  // Create prospect record (if not exists) - for LinkedIn research
  const { data: prospect, error: prospectError } = await supabase
    .from('linkedin_research_prospects')
    .insert({
      name: nomination.name,
      company: nomination.company || null,
      title: nomination.title || null,
      linkedin_url: nomination.linkedin_url || null,
      users_researching: [userId]
    })
    .select()
    .single();

  if (prospectError) {
    // Prospect might already exist, try to find it
    const { data: existingProspect } = await supabase
      .from('linkedin_research_prospects')
      .select('*')
      .eq('name', nomination.name)
      .single();

    if (!existingProspect) {
      throw new Error(`Failed to create prospect: ${prospectError.message}`);
    }
  }

  const prospectId = prospect?.id || '';

  // Create intro_opportunity
  const { data: introOpportunity, error: introError } = await supabase
    .from('intro_opportunities')
    .insert({
      connector_user_id: userId,
      prospect_id: prospectId,
      prospect_name: nomination.name,
      prospect_company: nomination.company || null,
      prospect_title: nomination.title || null,
      prospect_linkedin_url: nomination.linkedin_url || null,
      bounty_credits: 50,
      status: 'open'
    })
    .select()
    .single();

  if (introError) {
    throw new Error(`Failed to create intro opportunity: ${introError.message}`);
  }

  // Publish event
  await publishEvent({
    event_type: 'intro.opportunity_created',
    aggregate_id: introOpportunity.id,
    aggregate_type: 'intro_opportunity',
    payload: {
      connector_user_id: userId,
      prospect_name: nomination.name,
      nominated_during_onboarding: true
    },
    created_by: 'bouncer_agent'
  });

  return introOpportunity.id;
}

/**
 * Validates email format.
 *
 * @param email - Email address to validate
 * @returns True if valid, false otherwise
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validates LinkedIn URL format.
 *
 * @param url - LinkedIn URL to validate
 * @returns True if valid, false otherwise
 */
export function isValidLinkedInUrl(url: string): boolean {
  const linkedInRegex = /^https?:\/\/(www\.)?linkedin\.com\/in\/[\w-]+\/?$/i;
  return linkedInRegex.test(url);
}

/**
 * Gets user-friendly field name for display.
 *
 * @param fieldName - Database field name
 * @returns User-friendly name
 */
export function getFriendlyFieldName(fieldName: string): string {
  const fieldNames: Record<string, string> = {
    first_name: 'first name',
    last_name: 'last name',
    company: 'company',
    title: 'job title',
    email: 'email address',
    linkedin_url: 'LinkedIn profile'
  };

  return fieldNames[fieldName] || fieldName;
}

/**
 * Calculates hours since last message.
 *
 * @param lastMessageAt - Timestamp of last message
 * @returns Hours since last message
 */
export function getHoursSinceLastMessage(lastMessageAt: Date | string): number {
  const lastMessage = typeof lastMessageAt === 'string'
    ? new Date(lastMessageAt)
    : lastMessageAt;

  const now = new Date();
  const diffMs = now.getTime() - lastMessage.getTime();
  return diffMs / (1000 * 60 * 60);
}
