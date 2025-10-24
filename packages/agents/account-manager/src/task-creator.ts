/**
 * Concierge Task Creation and Notification Timing
 *
 * Creates agent tasks for Concierge to notify users of high-value priorities.
 * Learns optimal notification timing from user response patterns.
 *
 * @module task-creator
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { User } from '@yachtparty/shared';
import type { PriorityScore } from './priority-scorer';

/**
 * Creates a concierge notification task for high-value priorities.
 *
 * Task will be picked up by Concierge agent who will craft appropriate
 * prose based on the structured priority data.
 *
 * @param userId - User to notify
 * @param urgentItems - High-value priority items (score >= 80)
 * @param scheduledFor - When to notify (optimal timing)
 * @param supabase - Supabase client instance
 */
export async function createConciergeNotificationTask(
  userId: string,
  urgentItems: PriorityScore[],
  scheduledFor: Date,
  supabase: SupabaseClient
): Promise<void> {
  console.log(
    `[Task Creator] Creating concierge task for ${urgentItems.length} urgent items, ` +
      `scheduled for ${scheduledFor.toISOString()}`
  );

  // Determine priority level based on scores
  const maxScore = Math.max(...urgentItems.map((i) => i.score));
  let priority: 'urgent' | 'high' | 'medium' | 'low' = 'high';

  if (maxScore >= 95) {
    priority = 'urgent';
  } else if (maxScore >= 85) {
    priority = 'high';
  } else {
    priority = 'medium';
  }

  // Create task record
  const { error } = await supabase.from('agent_tasks').insert({
    task_type: 'notify_user_of_priorities',
    agent_type: 'concierge',
    user_id: userId,
    scheduled_for: scheduledFor.toISOString(),
    priority,
    status: 'pending',
    retry_count: 0,
    max_retries: 3,
    context_json: {
      priorities: urgentItems,
      createdBy: 'account_manager',
      createdAt: new Date().toISOString(),
      itemCount: urgentItems.length,
      maxScore,
    },
    created_by: 'account_manager',
  });

  if (error) {
    throw new Error(`Failed to create concierge task: ${error.message}`);
  }

  console.log(`[Task Creator] Created ${priority} priority task for user ${userId}`);
}

/**
 * Calculates optimal notification time based on user response patterns.
 *
 * Learns from user.response_pattern JSONB to determine best times to reach user.
 * Falls back to sensible defaults if no pattern data available.
 *
 * Considers:
 * - User's historical response times
 * - Time zone and quiet hours
 * - Current activity (if user active in last 10 min, notify immediately)
 * - Day of week patterns
 *
 * @param user - User record with response_pattern and preferences
 * @returns Optimal notification timestamp
 */
export async function calculateOptimalNotificationTime(user: User): Promise<Date> {
  console.log(`[Task Creator] Calculating optimal notification time for user ${user.id}`);

  // Check if user is currently active (last message in last 10 minutes)
  const isActive = await isUserCurrentlyActive(user.id);
  if (isActive) {
    console.log('[Task Creator] User is active, scheduling immediate notification');
    return new Date(); // Notify immediately
  }

  // Parse response pattern
  const responsePattern = user.response_pattern as ResponsePattern | null;

  if (responsePattern && responsePattern.bestHours && responsePattern.bestHours.length > 0) {
    // Use learned pattern
    return calculateFromPattern(user, responsePattern);
  } else {
    // Use default timing
    return calculateDefaultTiming(user);
  }
}

/**
 * Response pattern structure stored in user.response_pattern JSONB.
 */
interface ResponsePattern {
  /** Hours of day when user typically responds (0-23) */
  bestHours?: number[];

  /** Days of week when user is most active (0=Sunday, 6=Saturday) */
  bestDays?: number[];

  /** Average response time in minutes */
  avgResponseTimeMinutes?: number;

  /** Time zone identifier */
  timezone?: string;

  /** Last updated timestamp */
  lastUpdated?: string;
}

/**
 * Calculates notification time from learned response pattern.
 */
function calculateFromPattern(user: User, pattern: ResponsePattern): Date {
  const now = new Date();
  const timezone = pattern.timezone || user.timezone || 'America/New_York';

  try {
    // Get current time in user's timezone
    const userTime = new Date(
      now.toLocaleString('en-US', { timeZone: timezone })
    );
    const currentHour = userTime.getHours();
    const currentDay = userTime.getDay();

    // Find next best hour
    const bestHours = pattern.bestHours || [9, 10, 11, 14, 15, 16]; // Default to business hours
    let nextBestHour = bestHours.find((h) => h > currentHour) || bestHours[0];

    // If next best hour is tomorrow
    let daysToAdd = 0;
    if (nextBestHour <= currentHour) {
      daysToAdd = 1;
    }

    // Check if we should wait for a better day
    if (pattern.bestDays && pattern.bestDays.length > 0) {
      const targetDay = (currentDay + daysToAdd) % 7;
      if (!pattern.bestDays.includes(targetDay)) {
        // Find next best day
        for (let i = 1; i <= 7; i++) {
          const checkDay = (currentDay + i) % 7;
          if (pattern.bestDays.includes(checkDay)) {
            daysToAdd = i;
            nextBestHour = bestHours[0]; // Use first best hour on best day
            break;
          }
        }
      }
    }

    // Calculate target time
    const targetTime = new Date(now);
    targetTime.setDate(targetTime.getDate() + daysToAdd);
    targetTime.setHours(nextBestHour, 0, 0, 0);

    // Ensure it's in the future
    if (targetTime <= now) {
      targetTime.setDate(targetTime.getDate() + 1);
    }

    // Check quiet hours
    if (user.quiet_hours_start && user.quiet_hours_end) {
      const quietStart = parseTimeString(user.quiet_hours_start);
      const quietEnd = parseTimeString(user.quiet_hours_end);

      if (isInQuietHours(targetTime, quietStart, quietEnd)) {
        // Schedule for end of quiet hours
        targetTime.setHours(quietEnd.hours, quietEnd.minutes, 0, 0);
      }
    }

    console.log(
      `[Task Creator] Scheduled based on pattern for ${targetTime.toISOString()} ` +
        `(best hour: ${nextBestHour}, days to add: ${daysToAdd})`
    );

    return targetTime;
  } catch (error) {
    console.warn('[Task Creator] Error calculating from pattern:', error);
    return calculateDefaultTiming(user);
  }
}

/**
 * Calculates default notification time when no pattern available.
 *
 * Defaults to next business hours (9 AM - 5 PM) in user's timezone.
 */
function calculateDefaultTiming(user: User): Date {
  const now = new Date();
  const timezone = user.timezone || 'America/New_York';

  try {
    // Get current time in user's timezone
    const userTime = new Date(
      now.toLocaleString('en-US', { timeZone: timezone })
    );
    const currentHour = userTime.getHours();

    // Default notification hours: 9 AM, 2 PM
    const defaultHours = [9, 14];
    let nextHour = defaultHours.find((h) => h > currentHour);

    const targetTime = new Date(now);

    if (nextHour) {
      // Schedule for today
      targetTime.setHours(nextHour, 0, 0, 0);
    } else {
      // Schedule for tomorrow at 9 AM
      targetTime.setDate(targetTime.getDate() + 1);
      targetTime.setHours(9, 0, 0, 0);
    }

    // Check quiet hours
    if (user.quiet_hours_start && user.quiet_hours_end) {
      const quietStart = parseTimeString(user.quiet_hours_start);
      const quietEnd = parseTimeString(user.quiet_hours_end);

      if (isInQuietHours(targetTime, quietStart, quietEnd)) {
        // Schedule for end of quiet hours
        targetTime.setHours(quietEnd.hours, quietEnd.minutes, 0, 0);
      }
    }

    // Skip weekends (Saturday=6, Sunday=0)
    const targetDay = targetTime.getDay();
    if (targetDay === 0) {
      // Sunday -> Monday
      targetTime.setDate(targetTime.getDate() + 1);
    } else if (targetDay === 6) {
      // Saturday -> Monday
      targetTime.setDate(targetTime.getDate() + 2);
    }

    console.log(
      `[Task Creator] Scheduled with default timing for ${targetTime.toISOString()}`
    );

    return targetTime;
  } catch (error) {
    console.warn('[Task Creator] Error calculating default timing:', error);
    // Fallback: 1 hour from now
    const fallback = new Date(now.getTime() + 60 * 60 * 1000);
    console.log(`[Task Creator] Using fallback timing: ${fallback.toISOString()}`);
    return fallback;
  }
}

/**
 * Checks if user is currently active (sent message in last 10 minutes).
 */
async function isUserCurrentlyActive(userId: string): Promise<boolean> {
  const { createServiceClient } = await import('@yachtparty/shared');
  const supabase = createServiceClient();

  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

  const { data, error } = await supabase
    .from('messages')
    .select('id')
    .eq('user_id', userId)
    .eq('direction', 'inbound')
    .gte('created_at', tenMinutesAgo.toISOString())
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    // PGRST116 = no rows found
    console.warn(`[Task Creator] Error checking user activity: ${error.message}`);
  }

  return !!data;
}

/**
 * Time structure for parsing HH:MM:SS strings.
 */
interface TimeOfDay {
  hours: number;
  minutes: number;
  seconds: number;
}

/**
 * Parses time string (HH:MM:SS) into components.
 */
function parseTimeString(timeStr: string): TimeOfDay {
  const parts = timeStr.split(':');
  return {
    hours: parseInt(parts[0] || '0', 10),
    minutes: parseInt(parts[1] || '0', 10),
    seconds: parseInt(parts[2] || '0', 10),
  };
}

/**
 * Checks if a timestamp falls within quiet hours.
 */
function isInQuietHours(
  timestamp: Date,
  quietStart: TimeOfDay,
  quietEnd: TimeOfDay
): boolean {
  const hours = timestamp.getHours();
  const minutes = timestamp.getMinutes();
  const timeInMinutes = hours * 60 + minutes;

  const startMinutes = quietStart.hours * 60 + quietStart.minutes;
  const endMinutes = quietEnd.hours * 60 + quietEnd.minutes;

  // Handle quiet hours that span midnight
  if (startMinutes > endMinutes) {
    // e.g., 22:00 - 08:00
    return timeInMinutes >= startMinutes || timeInMinutes <= endMinutes;
  } else {
    // e.g., 01:00 - 06:00
    return timeInMinutes >= startMinutes && timeInMinutes <= endMinutes;
  }
}

/**
 * Checks if user should be notified now based on current activity.
 *
 * @param user - User record
 * @returns True if user should be notified immediately
 */
export async function shouldNotifyNow(user: User): Promise<boolean> {
  // Check if user is currently active
  const isActive = await isUserCurrentlyActive(user.id);
  if (isActive) {
    return true;
  }

  // Check if current time is in quiet hours
  if (user.quiet_hours_start && user.quiet_hours_end) {
    const now = new Date();
    const quietStart = parseTimeString(user.quiet_hours_start);
    const quietEnd = parseTimeString(user.quiet_hours_end);

    if (isInQuietHours(now, quietStart, quietEnd)) {
      return false;
    }
  }

  // Check if it's a reasonable hour (9 AM - 9 PM)
  const now = new Date();
  const timezone = user.timezone || 'America/New_York';
  const userTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const currentHour = userTime.getHours();

  return currentHour >= 9 && currentHour <= 21;
}

/**
 * Updates user's response pattern based on recent activity.
 *
 * Called after user responds to update learned patterns.
 * This helps improve future notification timing.
 *
 * @param userId - User to update
 * @param responseTime - When user responded
 */
export async function updateResponsePattern(
  userId: string,
  responseTime: Date
): Promise<void> {
  const { createServiceClient, getUser } = await import('@yachtparty/shared');
  const supabase = createServiceClient();

  const user = await getUser(userId);
  if (!user) return;

  const currentPattern = (user.response_pattern as ResponsePattern) || {};

  // Update best hours
  const hour = responseTime.getHours();
  const bestHours = currentPattern.bestHours || [];
  if (!bestHours.includes(hour)) {
    bestHours.push(hour);
    bestHours.sort((a, b) => a - b);
  }

  // Update best days
  const day = responseTime.getDay();
  const bestDays = currentPattern.bestDays || [];
  if (!bestDays.includes(day)) {
    bestDays.push(day);
    bestDays.sort((a, b) => a - b);
  }

  // Update pattern
  const updatedPattern: ResponsePattern = {
    ...currentPattern,
    bestHours,
    bestDays,
    lastUpdated: new Date().toISOString(),
  };

  // Save to database
  const { error } = await supabase
    .from('users')
    .update({ response_pattern: updatedPattern })
    .eq('id', userId);

  if (error) {
    console.warn(`[Task Creator] Error updating response pattern: ${error.message}`);
  }
}
