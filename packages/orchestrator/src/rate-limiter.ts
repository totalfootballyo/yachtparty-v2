/**
 * Rate Limiter for Message Orchestrator
 *
 * Enforces:
 * - Daily message limits (default: 10/day)
 * - Hourly message limits (default: 2/hour)
 * - Quiet hours (default: 10pm-8am local time)
 * - User active exception (sent message in last 10 minutes)
 */

import { SupabaseClient } from '@supabase/supabase-js';

export interface RateLimitConfig {
  dailyLimit: number;
  hourlyLimit: number;
  quietHoursStart: number; // Hour in 24h format (e.g., 22 for 10pm)
  quietHoursEnd: number; // Hour in 24h format (e.g., 8 for 8am)
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  nextAvailableAt?: Date;
}

export interface UserMessageBudget {
  id: string;
  user_id: string;
  date: string;
  messages_sent: number;
  last_message_at: Date | null;
  daily_limit: number;
  hourly_limit: number;
  quiet_hours_enabled: boolean;
}

export class RateLimiter {
  private supabase: SupabaseClient;
  private defaultConfig: RateLimitConfig = {
    dailyLimit: 10,
    hourlyLimit: 2,
    quietHoursStart: 22, // 10pm
    quietHoursEnd: 8 // 8am
  };

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Check if user is within rate limits
   */
  async checkRateLimits(userId: string): Promise<RateLimitResult> {
    try {
      // Get or create today's budget
      const budget = await this.getOrCreateBudget(userId);

      // Check daily limit
      if (budget.messages_sent >= budget.daily_limit) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);

        return {
          allowed: false,
          reason: 'daily_limit_reached',
          nextAvailableAt: tomorrow
        };
      }

      // Check hourly limit
      if (budget.last_message_at) {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

        // Count messages sent in last hour
        const { count, error } = await this.supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('direction', 'outbound')
          .gte('created_at', oneHourAgo.toISOString());

        if (error) {
          console.error('Error checking hourly limit:', error);
          // Allow on error to prevent blocking
          return { allowed: true };
        }

        if (count && count >= budget.hourly_limit) {
          const nextHourSlot = new Date(budget.last_message_at);
          nextHourSlot.setHours(nextHourSlot.getHours() + 1);

          return {
            allowed: false,
            reason: 'hourly_limit_reached',
            nextAvailableAt: nextHourSlot
          };
        }
      }

      return { allowed: true };
    } catch (error) {
      console.error('Error in checkRateLimits:', error);
      // Allow on error to prevent blocking
      return { allowed: true };
    }
  }

  /**
   * Check if current time is within user's quiet hours
   * Returns false if quiet hours are disabled or user is active
   */
  async isQuietHours(userId: string, userTimezone?: string): Promise<boolean> {
    try {
      // Get user budget to check quiet hours settings
      const budget = await this.getOrCreateBudget(userId);

      if (!budget.quiet_hours_enabled) {
        return false;
      }

      // Check if user is active (exception to quiet hours)
      const isActive = await this.isUserActive(userId);
      if (isActive) {
        return false; // User is active, quiet hours don't apply
      }

      // Get user's custom quiet hours from users table if set
      const { data: user } = await this.supabase
        .from('users')
        .select('quiet_hours_start, quiet_hours_end, timezone')
        .eq('id', userId)
        .single();

      let quietStart = this.defaultConfig.quietHoursStart;
      let quietEnd = this.defaultConfig.quietHoursEnd;
      let timezone = userTimezone || user?.timezone || 'America/New_York';

      if (user?.quiet_hours_start) {
        const startParts = user.quiet_hours_start.split(':');
        quietStart = parseInt(startParts[0]);
      }
      if (user?.quiet_hours_end) {
        const endParts = user.quiet_hours_end.split(':');
        quietEnd = parseInt(endParts[0]);
      }

      // Get current hour in user's timezone
      const now = new Date();
      const userHour = this.getHourInTimezone(now, timezone);

      // Check if current hour is in quiet hours range
      if (quietStart > quietEnd) {
        // Quiet hours span midnight (e.g., 22:00 to 8:00)
        return userHour >= quietStart || userHour < quietEnd;
      } else {
        // Quiet hours don't span midnight
        return userHour >= quietStart && userHour < quietEnd;
      }
    } catch (error) {
      console.error('Error checking quiet hours:', error);
      return false; // Default to not quiet on error
    }
  }

  /**
   * Check if user sent a message in the last 10 minutes
   * Active users override quiet hours and some rate limits
   */
  async isUserActive(userId: string): Promise<boolean> {
    try {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

      const { data, error } = await this.supabase
        .from('messages')
        .select('id')
        .eq('user_id', userId)
        .eq('direction', 'inbound')
        .gte('created_at', tenMinutesAgo.toISOString())
        .limit(1);

      if (error) {
        console.error('Error checking user activity:', error);
        return false;
      }

      return data && data.length > 0;
    } catch (error) {
      console.error('Error in isUserActive:', error);
      return false;
    }
  }

  /**
   * Get end time of quiet hours for rescheduling
   */
  getQuietHoursEnd(userId: string, userTimezone?: string): Date {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(this.defaultConfig.quietHoursEnd, 0, 0, 0);
    return tomorrow;
  }

  /**
   * Increment message budget after successful send
   */
  async incrementMessageBudget(userId: string): Promise<void> {
    try {
      const today = new Date().toISOString().split('T')[0];

      const { error } = await this.supabase.rpc('increment_message_budget', {
        p_user_id: userId,
        p_date: today
      });

      if (error) {
        console.error('Error incrementing message budget:', error);
      }
    } catch (error) {
      console.error('Error in incrementMessageBudget:', error);
    }
  }

  /**
   * Get or create user's message budget for today
   */
  private async getOrCreateBudget(userId: string): Promise<UserMessageBudget> {
    const today = new Date().toISOString().split('T')[0];

    // Try to get existing budget
    const { data: existing, error: fetchError } = await this.supabase
      .from('user_message_budget')
      .select('*')
      .eq('user_id', userId)
      .eq('date', today)
      .single();

    if (existing && !fetchError) {
      return existing;
    }

    // Create new budget for today
    const { data: created, error: createError } = await this.supabase
      .from('user_message_budget')
      .insert({
        user_id: userId,
        date: today,
        messages_sent: 0,
        daily_limit: this.defaultConfig.dailyLimit,
        hourly_limit: this.defaultConfig.hourlyLimit,
        quiet_hours_enabled: true
      })
      .select()
      .single();

    if (createError) {
      console.error('Error creating message budget:', createError);
      // Return default values
      return {
        id: 'temp',
        user_id: userId,
        date: today,
        messages_sent: 0,
        last_message_at: null,
        daily_limit: this.defaultConfig.dailyLimit,
        hourly_limit: this.defaultConfig.hourlyLimit,
        quiet_hours_enabled: true
      };
    }

    return created;
  }

  /**
   * Get hour in user's timezone
   */
  private getHourInTimezone(date: Date, timezone: string): number {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: timezone
      });
      const hourStr = formatter.format(date);
      return parseInt(hourStr);
    } catch (error) {
      console.error('Error getting timezone hour:', error);
      return date.getHours(); // Fallback to UTC
    }
  }
}
