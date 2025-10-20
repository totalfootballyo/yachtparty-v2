/**
 * Account Manager Agent - Main Entry Point
 *
 * Background processor that maintains user priorities and coordinates workflows.
 * Runs every 6 hours via pg_cron schedule.
 *
 * NOT a conversational agent - never directly messages users.
 * All user communication goes through Concierge Agent.
 *
 * @module account-manager
 */

import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import {
  createServiceClient,
  publishEvent,
  createAgentTask,
  getUser,
  type User,
  type Event,
  type UserPriority,
} from '@yachtparty/shared';
import { categorizeEvents, getLastProcessedTime, extractRelevantContext } from './event-processor';
import { calculatePriorityScores, type PriorityScore } from './priority-scorer';
import { createConciergeNotificationTask, calculateOptimalNotificationTime } from './task-creator';

// Load environment variables
dotenv.config();

// Initialize clients
const supabase = createServiceClient();
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * High-value threshold for creating immediate concierge tasks.
 * Items scoring above this trigger user notification.
 */
const HIGH_VALUE_THRESHOLD = parseInt(process.env.HIGH_VALUE_THRESHOLD || '80', 10);

/**
 * Maximum number of priorities to maintain per user.
 */
const MAX_PRIORITIES_PER_USER = parseInt(process.env.MAX_PRIORITIES_PER_USER || '20', 10);

/**
 * Main processing function for Account Manager.
 *
 * Processes all events since last run for a specific user:
 * 1. Fetches events since last run
 * 2. Categorizes events by type
 * 3. Calculates priority scores using LLM
 * 4. Updates user_priorities table
 * 5. Creates concierge tasks for high-value items
 * 6. Publishes completion event
 *
 * @param userId - The unique identifier of the user to process
 * @throws Error if processing fails (will be retried by pg_cron)
 *
 * @example
 * ```typescript
 * // Process account manager for specific user
 * await processUserAccountManager('user_123');
 * ```
 */
export async function processUserAccountManager(userId: string): Promise<void> {
  const startTime = Date.now();
  console.log(`[Account Manager] Processing user: ${userId}`);

  try {
    // 1. Load user context
    const user = await getUser(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    if (!user.verified) {
      console.log(`[Account Manager] User ${userId} not verified, skipping`);
      return;
    }

    // 2. Get last processed time
    const lastProcessedAt = await getLastProcessedTime(userId);
    console.log(
      `[Account Manager] Last processed at: ${lastProcessedAt || 'never'}`
    );

    // 3. Fetch all events since last run
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('*')
      .eq('aggregate_id', userId)
      .gte('created_at', lastProcessedAt || '2000-01-01T00:00:00Z')
      .order('created_at', { ascending: true });

    if (eventsError) {
      throw new Error(`Failed to fetch events: ${eventsError.message}`);
    }

    if (!events || events.length === 0) {
      console.log(`[Account Manager] No new events for user ${userId}`);
      await logProcessingCompleted(userId, 0, 0, 0, 0);
      return;
    }

    console.log(`[Account Manager] Found ${events.length} events to process`);

    // 4. Categorize events
    const categorized = categorizeEvents(events as Event[]);
    console.log(
      `[Account Manager] Categorized: ${categorized.newIntros.length} intros, ` +
        `${categorized.communityRequests.length} requests, ` +
        `${categorized.responses.length} responses, ` +
        `${categorized.solutionUpdates.length} solution updates`
    );

    // 5. Extract relevant context for priority scoring
    const context = await extractRelevantContext(userId, categorized, supabase);

    // 6. Calculate priority scores using LLM
    const priorityScores = await calculatePriorityScores(
      user,
      categorized,
      context,
      anthropic
    );

    console.log(`[Account Manager] Calculated ${priorityScores.length} priority scores`);

    // 7. Update user_priorities table
    const updatedCount = await updateUserPriorities(userId, priorityScores);
    console.log(`[Account Manager] Updated ${updatedCount} priorities`);

    // 8. Create concierge tasks for high-value items
    const urgentItems = priorityScores.filter((item) => item.score >= HIGH_VALUE_THRESHOLD);
    let tasksCreated = 0;

    if (urgentItems.length > 0) {
      console.log(`[Account Manager] Found ${urgentItems.length} high-value items`);

      // Calculate optimal notification time
      const notificationTime = await calculateOptimalNotificationTime(user);

      // Create single task with all urgent items
      await createConciergeNotificationTask(
        userId,
        urgentItems,
        notificationTime,
        supabase
      );

      tasksCreated = 1;
      console.log(
        `[Account Manager] Created concierge notification task scheduled for ${notificationTime}`
      );
    }

    // 9. Publish completion event
    await publishEvent({
      event_type: 'account_manager.processing.completed',
      aggregate_id: userId,
      aggregate_type: 'user',
      payload: {
        userId,
        processedEvents: events.length,
        urgentItems: urgentItems.length,
        prioritiesUpdated: updatedCount,
        tasksCreated,
        completedAt: new Date().toISOString(),
      },
      created_by: 'account_manager',
    });

    // 10. Log successful processing
    const latencyMs = Date.now() - startTime;
    await logProcessingCompleted(
      userId,
      events.length,
      urgentItems.length,
      updatedCount,
      tasksCreated,
      latencyMs
    );

    console.log(
      `[Account Manager] Completed processing for user ${userId} in ${latencyMs}ms`
    );
  } catch (error) {
    console.error(`[Account Manager] Error processing user ${userId}:`, error);

    // Log error to agent_actions_log
    await logProcessingError(userId, error as Error);

    // Re-throw to trigger retry logic in pg_cron
    throw error;
  }
}

/**
 * Updates user_priorities table with new ranked priorities.
 *
 * Process:
 * 1. Delete expired priorities
 * 2. Mark old active priorities as expired if not in new list
 * 3. Insert/update new priorities with ranks
 *
 * @param userId - The user whose priorities to update
 * @param priorityScores - Ranked priority scores from LLM
 * @returns Number of priorities updated
 */
async function updateUserPriorities(
  userId: string,
  priorityScores: PriorityScore[]
): Promise<number> {
  // Limit to MAX_PRIORITIES_PER_USER
  const topPriorities = priorityScores.slice(0, MAX_PRIORITIES_PER_USER);

  // Start transaction
  const { error: deleteError } = await supabase
    .from('user_priorities')
    .delete()
    .eq('user_id', userId)
    .eq('status', 'expired');

  if (deleteError) {
    throw new Error(`Failed to delete expired priorities: ${deleteError.message}`);
  }

  // Mark old active priorities as expired if not in new list
  const newItemIds = topPriorities.map((p) => p.itemId);
  const { error: expireError } = await supabase
    .from('user_priorities')
    .update({ status: 'expired' })
    .eq('user_id', userId)
    .eq('status', 'active')
    .not('item_id', 'in', `(${newItemIds.join(',')})`);

  if (expireError) {
    console.warn(`[Account Manager] Warning: Failed to expire old priorities: ${expireError.message}`);
  }

  // Upsert new priorities
  const priorityRecords = topPriorities.map((score, index) => ({
    user_id: userId,
    priority_rank: index + 1,
    item_type: score.itemType,
    item_id: score.itemId,
    value_score: score.score,
    status: 'active',
    expires_at: score.expiresAt,
  }));

  // Delete existing active priorities for these items (to re-rank)
  const { error: deleteActiveError } = await supabase
    .from('user_priorities')
    .delete()
    .eq('user_id', userId)
    .in('item_id', newItemIds);

  if (deleteActiveError) {
    console.warn(`[Account Manager] Warning: Failed to delete existing priorities: ${deleteActiveError.message}`);
  }

  // Insert new priorities
  const { error: insertError } = await supabase
    .from('user_priorities')
    .insert(priorityRecords);

  if (insertError) {
    throw new Error(`Failed to insert priorities: ${insertError.message}`);
  }

  return topPriorities.length;
}

/**
 * Logs successful processing completion to agent_actions_log.
 */
async function logProcessingCompleted(
  userId: string,
  eventsProcessed: number,
  urgentItems: number,
  prioritiesUpdated: number,
  tasksCreated: number,
  latencyMs: number = 0
): Promise<void> {
  await supabase.from('agent_actions_log').insert({
    agent_type: 'account_manager',
    action_type: 'processing_completed',
    user_id: userId,
    latency_ms: latencyMs,
    output_data: {
      eventsProcessed,
      urgentItems,
      prioritiesUpdated,
      tasksCreated,
    },
  });
}

/**
 * Logs processing error to agent_actions_log.
 */
async function logProcessingError(userId: string, error: Error): Promise<void> {
  await supabase.from('agent_actions_log').insert({
    agent_type: 'account_manager',
    action_type: 'processing_error',
    user_id: userId,
    error: error.message,
    output_data: {
      stack: error.stack,
    },
  });
}

/**
 * Processes Account Manager for all active verified users.
 *
 * Called by pg_cron every 6 hours. Processes users in batches
 * to avoid overwhelming the system.
 *
 * @example
 * ```typescript
 * // Called by pg_cron
 * await processAllUsers();
 * ```
 */
export async function processAllUsers(): Promise<void> {
  console.log('[Account Manager] Starting batch processing for all users');
  const startTime = Date.now();

  try {
    // Fetch all verified users
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id')
      .eq('verified', true)
      .order('last_active_at', { ascending: false }); // Process most active first

    if (usersError) {
      throw new Error(`Failed to fetch users: ${usersError.message}`);
    }

    if (!users || users.length === 0) {
      console.log('[Account Manager] No verified users to process');
      return;
    }

    console.log(`[Account Manager] Processing ${users.length} users`);

    // Process users sequentially (could be parallelized if needed)
    let successCount = 0;
    let errorCount = 0;

    for (const user of users) {
      try {
        await processUserAccountManager(user.id);
        successCount++;
      } catch (error) {
        console.error(`[Account Manager] Failed to process user ${user.id}:`, error);
        errorCount++;
        // Continue processing other users
      }
    }

    const totalTime = Date.now() - startTime;
    console.log(
      `[Account Manager] Batch processing completed: ` +
        `${successCount} succeeded, ${errorCount} failed in ${totalTime}ms`
    );

    // Log batch processing metrics
    await supabase.from('agent_actions_log').insert({
      agent_type: 'account_manager',
      action_type: 'batch_processing_completed',
      latency_ms: totalTime,
      output_data: {
        totalUsers: users.length,
        successCount,
        errorCount,
      },
    });
  } catch (error) {
    console.error('[Account Manager] Batch processing failed:', error);
    throw error;
  }
}

/**
 * Entry point when running as standalone script.
 *
 * Usage:
 *   npm run dev -- --user-id=user_123  # Process single user
 *   npm run dev -- --all               # Process all users
 */
if (require.main === module) {
  const args = process.argv.slice(2);
  const userIdArg = args.find((arg) => arg.startsWith('--user-id='));
  const allFlag = args.includes('--all');

  if (userIdArg) {
    const userId = userIdArg.split('=')[1];
    processUserAccountManager(userId)
      .then(() => {
        console.log('Processing completed successfully');
        process.exit(0);
      })
      .catch((error) => {
        console.error('Processing failed:', error);
        process.exit(1);
      });
  } else if (allFlag) {
    processAllUsers()
      .then(() => {
        console.log('Batch processing completed successfully');
        process.exit(0);
      })
      .catch((error) => {
        console.error('Batch processing failed:', error);
        process.exit(1);
      });
  } else {
    console.error('Usage: npm run dev -- --user-id=USER_ID or npm run dev -- --all');
    process.exit(1);
  }
}
