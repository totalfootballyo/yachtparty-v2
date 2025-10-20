/**
 * Message Orchestrator
 *
 * Central rate limiting and priority management for all outbound messages.
 * All agents must use this orchestrator to send messages - never call Twilio directly.
 *
 * Core responsibilities:
 * - Queue messages with priority levels
 * - Enforce rate limits (daily/hourly)
 * - Respect quiet hours (with active user exception)
 * - Check message relevance before sending
 * - Render structured data to prose
 * - Calculate optimal send times
 * - Supersede stale messages
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { Twilio } from 'twilio';
import { RateLimiter, RateLimitResult } from './rate-limiter';
import { RelevanceChecker, RelevanceResult, QueuedMessage } from './relevance-checker';

export interface QueueMessageParams {
  userId: string;
  agentId: string;
  messageData: any; // Structured data from agent
  priority: 'urgent' | 'high' | 'medium' | 'low';
  canDelay: boolean; // Can this message be delayed for optimal timing?
  requiresFreshContext: boolean; // Should we check relevance before sending?
  conversationId?: string;
}

export interface MessageQueueRecord extends QueuedMessage {
  agent_id: string;
  final_message: string | null;
  scheduled_for: string;
  priority: string;
  status: string;
  requires_fresh_context: boolean;
  superseded_by_message_id: string | null;
  superseded_reason: string | null;
  conversation_context_id: string | null;
  sent_at: string | null;
  delivered_message_id: string | null;
  sequence_id: string | null;
  sequence_position: number | null;
  sequence_total: number | null;
}

export interface User {
  id: string;
  phone_number: string;
  timezone?: string;
  response_pattern?: any;
  quiet_hours_start?: string;
  quiet_hours_end?: string;
}

export class MessageOrchestrator {
  private supabase: SupabaseClient;
  private anthropic: Anthropic;
  private twilio: Twilio;
  private rateLimiter: RateLimiter;
  private relevanceChecker: RelevanceChecker;

  constructor(config?: {
    supabaseUrl?: string;
    supabaseKey?: string;
    anthropicKey?: string;
    twilioAccountSid?: string;
    twilioAuthToken?: string;
    twilioPhoneNumber?: string;
  }) {
    // Initialize Supabase
    this.supabase = createClient(
      config?.supabaseUrl || process.env.SUPABASE_URL || '',
      config?.supabaseKey || process.env.SUPABASE_SERVICE_KEY || ''
    );

    // Initialize Anthropic
    this.anthropic = new Anthropic({
      apiKey: config?.anthropicKey || process.env.ANTHROPIC_API_KEY || ''
    });

    // Initialize Twilio
    this.twilio = new Twilio(
      config?.twilioAccountSid || process.env.TWILIO_ACCOUNT_SID || '',
      config?.twilioAuthToken || process.env.TWILIO_AUTH_TOKEN || ''
    );

    // Initialize rate limiter and relevance checker
    this.rateLimiter = new RateLimiter(this.supabase);
    this.relevanceChecker = new RelevanceChecker(this.anthropic, this.supabase);
  }

  /**
   * Queue a message for delivery
   * This is the primary entry point for agents
   */
  async queueMessage(params: QueueMessageParams): Promise<string> {
    try {
      console.log(`Queueing message for user ${params.userId} with priority ${params.priority}`);

      // 1. Check if user is currently active
      const userActive = await this.isUserActive(params.userId);

      // 2. Calculate scheduled time
      let scheduledFor = new Date();
      if (!userActive && params.canDelay) {
        scheduledFor = await this.calculateOptimalSendTime(params.userId);
      }

      // 3. Get conversation ID if not provided
      let conversationId = params.conversationId;
      if (!conversationId) {
        const { data: conversation } = await this.supabase
          .from('conversations')
          .select('id')
          .eq('user_id', params.userId)
          .eq('status', 'active')
          .single();

        conversationId = conversation?.id;
      }

      // 4. Insert into message_queue
      const { data, error } = await this.supabase
        .from('message_queue')
        .insert({
          user_id: params.userId,
          agent_id: params.agentId,
          message_data: params.messageData,
          priority: params.priority,
          scheduled_for: scheduledFor.toISOString(),
          status: 'queued',
          requires_fresh_context: params.requiresFreshContext,
          conversation_context_id: conversationId
        })
        .select()
        .single();

      if (error) {
        console.error('Error queueing message:', error);
        throw new Error(`Failed to queue message: ${error.message}`);
      }

      console.log(`Message queued with ID ${data.id}, scheduled for ${scheduledFor.toISOString()}`);
      return data.id;
    } catch (error) {
      console.error('Error in queueMessage:', error);
      throw error;
    }
  }

  /**
   * Process due messages (called by cron every minute)
   * This retrieves messages ready to send and attempts delivery
   *
   * Handles message sequences with all-or-nothing delivery:
   * - Groups messages by sequence_id
   * - Delivers entire sequence together or reschedules entire sequence
   * - Counts sequence as 1 toward message budget
   */
  async processDueMessages(): Promise<void> {
    try {
      console.log('Processing due messages...');

      // Get messages that are due to be sent
      const { data: dueMessages, error } = await this.supabase
        .from('message_queue')
        .select('*, users(*)')
        .eq('status', 'queued')
        .lte('scheduled_for', new Date().toISOString())
        .order('priority', { ascending: true }) // urgent=1, high=2, medium=3, low=4
        .order('scheduled_for', { ascending: true })
        .limit(50);

      if (error) {
        console.error('Error fetching due messages:', error);
        return;
      }

      if (!dueMessages || dueMessages.length === 0) {
        console.log('No due messages to process');
        return;
      }

      console.log(`Found ${dueMessages.length} due messages`);

      // Group messages by sequence_id (null = standalone message)
      const sequences = new Map<string | null, MessageQueueRecord[]>();
      for (const message of dueMessages) {
        const key = message.sequence_id || message.id; // Use message.id as key for standalone messages
        if (!sequences.has(key)) {
          sequences.set(key, []);
        }
        sequences.get(key)!.push(message);
      }

      console.log(`Grouped into ${sequences.size} sequences/messages`);

      // Process each sequence/message
      for (const [sequenceKey, messages] of sequences.entries()) {
        // Sort by sequence_position if it's a sequence
        const sortedMessages = messages.sort((a, b) => {
          if (a.sequence_position && b.sequence_position) {
            return a.sequence_position - b.sequence_position;
          }
          return 0;
        });

        if (sortedMessages[0].sequence_id) {
          // This is a message sequence - handle all-or-nothing delivery
          await this.attemptSequenceDelivery(sortedMessages);
        } else {
          // This is a standalone message
          await this.attemptDelivery(sortedMessages[0]);
        }
      }
    } catch (error) {
      console.error('Error in processDueMessages:', error);
    }
  }

  /**
   * Attempt to deliver a message sequence (all-or-nothing)
   * Checks rate limits, quiet hours for the entire sequence
   * Either sends all messages or reschedules all messages
   * Counts as 1 toward message budget regardless of sequence length
   */
  async attemptSequenceDelivery(messages: MessageQueueRecord[]): Promise<void> {
    try {
      if (messages.length === 0) return;

      const firstMessage = messages[0];
      const sequenceId = firstMessage.sequence_id;
      console.log(`Attempting delivery of sequence ${sequenceId} (${messages.length} messages)`);

      // 1. Check rate limits (sequence counts as 1)
      const rateLimitCheck = await this.checkRateLimits(firstMessage.user_id);
      if (!rateLimitCheck.allowed) {
        console.log(`Rate limit exceeded for user ${firstMessage.user_id}: ${rateLimitCheck.reason}`);
        if (rateLimitCheck.nextAvailableAt) {
          // Reschedule entire sequence
          await this.rescheduleSequence(messages, rateLimitCheck.nextAvailableAt);
        }
        return;
      }

      // 2. Check quiet hours (unless user is active)
      const userActive = await this.isUserActive(firstMessage.user_id);
      if (!userActive) {
        const inQuietHours = await this.isQuietHours(firstMessage.user_id);
        if (inQuietHours) {
          console.log(`User ${firstMessage.user_id} in quiet hours, rescheduling sequence`);
          const quietEnd = this.rateLimiter.getQuietHoursEnd(firstMessage.user_id);
          await this.rescheduleSequence(messages, quietEnd);
          return;
        }
      }

      // 3. Send all messages in sequence
      for (const message of messages) {
        // Render if needed
        if (!message.final_message) {
          console.log(`Rendering message ${message.id} (${message.sequence_position}/${message.sequence_total})`);
          const rendered = await this.renderMessage(message);
          await this.supabase
            .from('message_queue')
            .update({ final_message: rendered })
            .eq('id', message.id);
          message.final_message = rendered;
        }

        // Send SMS
        await this.sendSMS(message);
      }

      // 4. Update budget ONCE for the entire sequence
      await this.incrementMessageBudget(firstMessage.user_id);

      console.log(`Successfully delivered sequence ${sequenceId} (${messages.length} messages, counted as 1)`);
    } catch (error) {
      console.error(`Error delivering sequence ${messages[0]?.sequence_id}:`, error);
      // Log error for monitoring
      await this.logError(messages[0]?.id, error);
    }
  }

  /**
   * Reschedule an entire message sequence
   * All messages in the sequence get the same new scheduled time
   */
  async rescheduleSequence(messages: MessageQueueRecord[], scheduledFor: Date): Promise<void> {
    try {
      const sequenceId = messages[0]?.sequence_id;
      console.log(`Rescheduling sequence ${sequenceId} (${messages.length} messages) for ${scheduledFor.toISOString()}`);

      for (const message of messages) {
        await this.supabase
          .from('message_queue')
          .update({ scheduled_for: scheduledFor.toISOString() })
          .eq('id', message.id);
      }
    } catch (error) {
      console.error('Error rescheduling sequence:', error);
    }
  }

  /**
   * Attempt to deliver a message
   * Checks rate limits, quiet hours, relevance, then sends
   */
  async attemptDelivery(message: MessageQueueRecord): Promise<void> {
    try {
      console.log(`Attempting delivery of message ${message.id}`);

      // 1. Check rate limits
      const rateLimitCheck = await this.checkRateLimits(message.user_id);
      if (!rateLimitCheck.allowed) {
        console.log(`Rate limit exceeded for user ${message.user_id}: ${rateLimitCheck.reason}`);
        if (rateLimitCheck.nextAvailableAt) {
          await this.rescheduleMessage(message.id, rateLimitCheck.nextAvailableAt);
        }
        return;
      }

      // 2. Check quiet hours (unless user is active)
      const userActive = await this.isUserActive(message.user_id);
      if (!userActive) {
        const inQuietHours = await this.isQuietHours(message.user_id);
        if (inQuietHours) {
          console.log(`User ${message.user_id} in quiet hours, rescheduling`);
          const quietEnd = this.rateLimiter.getQuietHoursEnd(message.user_id);
          await this.rescheduleMessage(message.id, quietEnd);
          return;
        }
      }

      // 3. Check relevance if required
      if (message.requires_fresh_context) {
        const relevanceCheck = await this.checkMessageRelevance(message);
        if (!relevanceCheck.relevant) {
          console.log(`Message ${message.id} no longer relevant: ${relevanceCheck.reason}`);
          await this.supersededMessage(message.id, relevanceCheck.reason);

          if (relevanceCheck.shouldReformulate) {
            await this.requestReformulation(message);
          }
          return;
        }
      }

      // 4. Render message if not already rendered
      if (!message.final_message) {
        console.log(`Rendering message ${message.id}`);
        const rendered = await this.renderMessage(message);
        await this.supabase
          .from('message_queue')
          .update({ final_message: rendered })
          .eq('id', message.id);
        message.final_message = rendered;
      }

      // 5. Send SMS
      await this.sendSMS(message);

      // 6. Update budget
      await this.incrementMessageBudget(message.user_id);

      console.log(`Successfully delivered message ${message.id}`);
    } catch (error) {
      console.error(`Error delivering message ${message.id}:`, error);
      // Log error for monitoring
      await this.logError(message.id, error);
    }
  }

  /**
   * Check rate limits for a user
   */
  async checkRateLimits(userId: string): Promise<RateLimitResult> {
    return this.rateLimiter.checkRateLimits(userId);
  }

  /**
   * Check if user is in quiet hours
   */
  async isQuietHours(userId: string): Promise<boolean> {
    return this.rateLimiter.isQuietHours(userId);
  }

  /**
   * Check if user is currently active (sent message in last 10 min)
   */
  async isUserActive(userId: string): Promise<boolean> {
    return this.rateLimiter.isUserActive(userId);
  }

  /**
   * Check if message is still relevant given recent context
   */
  async checkMessageRelevance(message: QueuedMessage): Promise<RelevanceResult> {
    return this.relevanceChecker.checkMessageRelevance(message);
  }

  /**
   * Render structured message data to conversational prose
   * This calls the Concierge agent to craft the final message
   */
  async renderMessage(message: MessageQueueRecord): Promise<string> {
    try {
      // For now, we'll render directly here
      // In production, this should call the Concierge agent
      const user = await this.getUser(message.user_id);

      const prompt = `Convert this structured update into a conversational SMS message.

User context:
- Name: ${user?.phone_number}
- User ID: ${message.user_id}

Structured data from agent:
${JSON.stringify(message.message_data, null, 2)}

Requirements:
- Keep it brief and conversational (SMS style)
- Be warm but professional
- Get to the point quickly
- If there are action items, make them clear
- Don't use emojis unless the message type calls for it

Return ONLY the message text, no JSON, no quotes, no markdown.`;

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        temperature: 0.7,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Claude');
      }

      // Log the render operation
      await this.logRenderOperation(message.id, response.usage);

      return content.text.trim();
    } catch (error) {
      console.error('Error rendering message:', error);
      // Fallback to basic rendering
      return `Update: ${JSON.stringify(message.message_data)}`;
    }
  }

  /**
   * Calculate optimal send time based on user's response patterns
   */
  async calculateOptimalSendTime(userId: string): Promise<Date> {
    try {
      const user = await this.getUser(userId);

      if (user?.response_pattern) {
        const pattern = user.response_pattern;

        // Get current time in user's timezone
        const now = new Date();
        const timezone = user.timezone || 'America/New_York';

        // If current time is in best_hours, send now
        if (pattern.best_hours && pattern.best_hours.length > 0) {
          const currentHour = this.getHourInTimezone(now, timezone);

          if (pattern.best_hours.includes(currentHour)) {
            return now;
          }

          // Find next best hour
          const nextBestHour = this.findNextBestHour(
            currentHour,
            pattern.best_hours
          );
          const nextSendTime = new Date(now);
          nextSendTime.setHours(nextBestHour, 0, 0, 0);

          // If next best hour is earlier today, move to tomorrow
          if (nextSendTime <= now) {
            nextSendTime.setDate(nextSendTime.getDate() + 1);
          }

          return nextSendTime;
        }
      }

      // Default: 10am user local time (next occurrence)
      const defaultTime = new Date();
      defaultTime.setHours(10, 0, 0, 0);

      if (defaultTime <= new Date()) {
        defaultTime.setDate(defaultTime.getDate() + 1);
      }

      return defaultTime;
    } catch (error) {
      console.error('Error calculating optimal send time:', error);
      // Default to now
      return new Date();
    }
  }

  /**
   * Send SMS via Twilio
   * Actually inserts into messages table with status='pending'
   * Database trigger handles actual Twilio send
   */
  async sendSMS(message: MessageQueueRecord): Promise<void> {
    try {
      const user = await this.getUser(message.user_id);
      if (!user) {
        throw new Error(`User ${message.user_id} not found`);
      }

      // Insert into messages table
      const { data: messageRecord, error } = await this.supabase
        .from('messages')
        .insert({
          conversation_id: message.conversation_context_id,
          user_id: message.user_id,
          role: message.agent_id.split('_')[0], // Extract agent type
          content: message.final_message,
          direction: 'outbound',
          status: 'pending' // Trigger will handle actual send
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to insert message: ${error.message}`);
      }

      // Update queue record
      await this.supabase
        .from('message_queue')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          delivered_message_id: messageRecord.id
        })
        .eq('id', message.id);

      console.log(`Message ${message.id} sent, message record ${messageRecord.id} created`);
    } catch (error) {
      console.error('Error sending SMS:', error);
      throw error;
    }
  }

  /**
   * Update user message budget after successful send
   */
  async incrementMessageBudget(userId: string): Promise<void> {
    return this.rateLimiter.incrementMessageBudget(userId);
  }

  /**
   * Reschedule a message for later
   */
  async rescheduleMessage(messageId: string, scheduledFor: Date): Promise<void> {
    try {
      await this.supabase
        .from('message_queue')
        .update({ scheduled_for: scheduledFor.toISOString() })
        .eq('id', messageId);

      console.log(`Message ${messageId} rescheduled for ${scheduledFor.toISOString()}`);
    } catch (error) {
      console.error('Error rescheduling message:', error);
    }
  }

  /**
   * Mark message as superseded (no longer relevant)
   */
  async supersededMessage(messageId: string, reason: string): Promise<void> {
    try {
      await this.supabase
        .from('message_queue')
        .update({
          status: 'superseded',
          superseded_reason: reason
        })
        .eq('id', messageId);

      console.log(`Message ${messageId} superseded: ${reason}`);
    } catch (error) {
      console.error('Error superseding message:', error);
    }
  }

  /**
   * Request reformulation of a stale message
   * Creates a new task for the agent to reformulate based on new context
   */
  private async requestReformulation(message: MessageQueueRecord): Promise<void> {
    try {
      // Create agent task for reformulation
      await this.supabase.from('agent_tasks').insert({
        task_type: 'reformulate_message',
        agent_type: message.agent_id.split('_')[0],
        user_id: message.user_id,
        scheduled_for: new Date().toISOString(),
        priority: 'high',
        context_json: {
          original_message_id: message.id,
          original_message_data: message.message_data,
          reason: 'context_changed'
        }
      });

      console.log(`Reformulation requested for message ${message.id}`);
    } catch (error) {
      console.error('Error requesting reformulation:', error);
    }
  }

  /**
   * Helper: Get user record
   */
  private async getUser(userId: string): Promise<User | null> {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error fetching user:', error);
      return null;
    }

    return data;
  }

  /**
   * Helper: Get hour in timezone
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
      return date.getHours();
    }
  }

  /**
   * Helper: Find next best hour from current hour
   */
  private findNextBestHour(currentHour: number, bestHours: number[]): number {
    const sortedHours = [...bestHours].sort((a, b) => a - b);

    // Find first hour greater than current
    for (const hour of sortedHours) {
      if (hour > currentHour) {
        return hour;
      }
    }

    // If no hour today, return first hour (tomorrow)
    return sortedHours[0];
  }

  /**
   * Log render operation for cost tracking
   */
  private async logRenderOperation(
    messageId: string,
    usage: { input_tokens: number; output_tokens: number }
  ): Promise<void> {
    try {
      const inputCost = (usage.input_tokens / 1_000_000) * 3.0;
      const outputCost = (usage.output_tokens / 1_000_000) * 15.0;

      await this.supabase.from('agent_actions_log').insert({
        agent_type: 'message_orchestrator',
        action_type: 'render_message',
        model_used: 'claude-sonnet-4-20250514',
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cost_usd: inputCost + outputCost,
        input_data: { message_id: messageId },
        output_data: { success: true }
      });
    } catch (error) {
      console.error('Error logging render operation:', error);
    }
  }

  /**
   * Log error for monitoring
   */
  private async logError(messageId: string, error: any): Promise<void> {
    try {
      await this.supabase.from('agent_actions_log').insert({
        agent_type: 'message_orchestrator',
        action_type: 'delivery_error',
        error: error.toString(),
        input_data: { message_id: messageId }
      });
    } catch (logError) {
      console.error('Error logging error:', logError);
    }
  }
}

// Export for use in other packages
export * from './rate-limiter';
export * from './relevance-checker';
