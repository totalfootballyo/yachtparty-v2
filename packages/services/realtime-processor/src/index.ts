/**
 * Real-Time Event Processor for Yachtparty
 *
 * Always-on Cloud Run service that maintains persistent WebSocket connections
 * to Supabase Realtime and processes background events in real-time.
 *
 * Architecture:
 * - Subscribes to 'agent-events' channel via Supabase Realtime (INSERT on events table)
 * - Processes background events such as:
 *   - priority.update: Account Manager detects high-value opportunities → Concierge decides when to notify user
 *   - agent.task_ready: Scheduled tasks are ready for execution
 *   - community.response_received: Expert responded to community request
 *   - solution.research_complete: Solution saga completed research
 *
 * NOTE: Inbound SMS messages are NOT processed here. They are handled synchronously by
 * the twilio-webhook service using the full agent packages.
 *
 * - Provides HTTP health check endpoint on port 8080
 * - Implements graceful shutdown and error handling
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import http from 'http';

// Load environment variables
dotenv.config();

// Types
interface Message {
  id: string;
  conversation_id: string;
  user_id: string;
  role: string;
  content: string;
  direction: 'inbound' | 'outbound';
  twilio_message_sid?: string;
  status?: string;
  created_at: string;
}

interface User {
  id: string;
  phone_number: string;
  first_name?: string;
  last_name?: string;
  verified: boolean;
  poc_agent_type: 'bouncer' | 'concierge' | 'innovator';
  email?: string;
  company?: string;
  title?: string;
  credit_balance: number;
}

interface Conversation {
  id: string;
  user_id: string;
  phone_number: string;
  status: string;
  conversation_summary?: string;
  last_message_at?: string;
  created_at: string;
  users: User;
}

interface Event {
  id: string;
  event_type: string;
  aggregate_id: string;
  aggregate_type: string;
  payload: any;
  metadata?: any;
  processed: boolean;
  created_at: string;
  created_by: string;
}

interface AgentResponse {
  immediateReply?: boolean;
  message?: string;
  actions?: Array<{
    type: string;
    params: any;
  }>;
}

// Service state
const serviceState = {
  startTime: Date.now(),
  lastMessageProcessed: null as Date | null,
  messagesProcessed: 0,
  eventsProcessed: 0,
  subscriptions: {
    'user-messages': 'disconnected' as 'connected' | 'disconnected',
    'agent-events': 'disconnected' as 'connected' | 'disconnected',
  },
  isShuttingDown: false,
};

// Initialize clients
const supabase: SupabaseClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  }
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

/**
 * Main entry point - starts the real-time processor service
 */
async function startRealtimeProcessor() {
  console.log('🚀 Starting Real-Time Message Processor...');

  // Validate environment variables
  if (!process.env.SUPABASE_URL) {
    throw new Error('SUPABASE_URL environment variable is required');
  }
  if (!process.env.SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_SERVICE_KEY environment variable is required');
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required');
  }

  // Start health check server
  const httpServer = startHealthCheckServer();

  // Subscribe to channels
  await subscribeToUserMessages(); // Disabled - twilio-webhook handles inbound messages
  await subscribeToAgentEvents();

  console.log('✅ Real-Time Event Processor is running');
  console.log(`📡 Subscribed to: agent-events only (user-messages disabled)`);
  console.log(`ℹ️  Inbound SMS messages handled by twilio-webhook service`);
  console.log(`🏥 Health check server running on port ${process.env.PORT || 8080}`);

  // Setup graceful shutdown
  process.on('SIGTERM', () => gracefulShutdown(httpServer));
  process.on('SIGINT', () => gracefulShutdown(httpServer));
}

/**
 * Subscribe to user-messages channel (DISABLED - twilio-webhook handles inbound messages)
 *
 * NOTE: Inbound SMS messages are processed synchronously by twilio-webhook service.
 * This subscription is kept for monitoring/logging purposes only.
 */
async function subscribeToUserMessages() {
  // Subscription disabled - twilio-webhook handles all inbound message processing
  console.log('ℹ️  Inbound message processing disabled (handled by twilio-webhook)');
  serviceState.subscriptions['user-messages'] = 'disconnected';
  return null;
}

/**
 * Subscribe to agent-events channel
 * Fires when new events are published by agents
 */
async function subscribeToAgentEvents() {
  const channel = supabase
    .channel('agent-events')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'events',
      },
      async (payload) => {
        const event = payload.new as Event;
        console.log(`🎯 New event: ${event.event_type} (${event.id})`);

        try {
          await routeEventToAgent(event);
          serviceState.eventsProcessed++;
        } catch (error) {
          console.error('❌ Error processing event:', error);
          await logError('event_processing_error', event.id, error);
        }
      }
    )
    .subscribe((status) => {
      console.log(`📡 agent-events subscription status: ${status}`);
      serviceState.subscriptions['agent-events'] = status === 'SUBSCRIBED' ? 'connected' : 'disconnected';
    });

  return channel;
}

// Inbound message processing removed - handled by twilio-webhook service

/**
 * Route event to appropriate agent handler
 *
 * Event types handled:
 * - agent.task_ready - Scheduled tasks ready to execute
 * - message.ready_to_send - Queued messages ready for delivery
 * - community.response_received - Expert responded to community request
 * - solution.research_complete - Solution saga completed research
 * - etc.
 */
async function routeEventToAgent(event: Event) {
  console.log(`📬 Routing event ${event.event_type} to agent`);

  // Mark event as processed (for idempotency)
  await supabase
    .from('events')
    .update({ processed: true })
    .eq('id', event.id);

  // Route based on event type
  switch (event.event_type) {
    case 'agent.task_ready':
      await handleAgentTask(event);
      break;

    case 'message.ready_to_send':
      await handleOutboundMessage(event);
      break;

    case 'community.response_received':
      await handleCommunityResponse(event);
      break;

    case 'solution.research_complete':
      await handleSolutionResearchComplete(event);
      break;

    case 'priority.update':
      await handlePriorityUpdate(event);
      break;

    default:
      console.log(`ℹ️  No handler for event type: ${event.event_type}`);
  }
}

// Inline agent implementations removed - agents are handled by:
// - twilio-webhook (inbound messages via agent packages)
// - This service only handles background events

/**
 * Handle priority update from Account Manager via Concierge agent
 *
 * Concierge makes timing decisions about when to notify user of high-value opportunities.
 * Uses LLM to decide whether to:
 * - Send message now
 * - Queue message for later (specific time)
 * - Skip notification (not valuable enough given context)
 */
async function handleConciergePriorityUpdate(
  user: User,
  conversation: Conversation,
  priorities: any[],
  _metadata: any
): Promise<void> {
  console.log(`🎩 Concierge evaluating ${priorities.length} priorities for user ${user.id}`);

  // Load recent conversation to understand user context and activity
  const { data: recentMessages } = await supabase
    .from('messages')
    .select('role, content, created_at')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: false })
    .limit(10);

  const conversationHistory = recentMessages
    ?.reverse()
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  // Get last user activity time
  const lastUserMessage = recentMessages?.find((m) => m.role === 'user');
  const lastUserActivityTime = lastUserMessage ? new Date(lastUserMessage.created_at) : null;
  const hoursSinceActivity = lastUserActivityTime
    ? (Date.now() - lastUserActivityTime.getTime()) / (1000 * 60 * 60)
    : 999;

  // Build prompt for timing decision
  const prompt = `You are the Concierge agent. Account Manager has identified ${priorities.length} high-value opportunities for ${user.first_name}.

Your job: Decide when and how to notify the user about these opportunities.

User context:
- Name: ${user.first_name} ${user.last_name || ''}
- Company: ${user.company || 'Not specified'}
- Last activity: ${hoursSinceActivity < 24 ? Math.round(hoursSinceActivity) + ' hours ago' : Math.round(hoursSinceActivity / 24) + ' days ago'}

Recent conversation:
${conversationHistory || 'No recent messages'}

Opportunities to consider:
${JSON.stringify(priorities, null, 2)}

Decision criteria:
1. User recency: Are they actively engaged (< 48h since last message) or dormant?
2. Opportunity value: How urgent/valuable are these items (value_score)?
3. Message budget: We have limited daily message quota
4. Timing: Is now a good time, or should we wait for better context?

Respond with JSON:
{
  "decision": "send_now" | "queue_for_later" | "skip",
  "reasoning": "Brief explanation of why",
  "scheduled_for"?: "ISO datetime if queue_for_later (eg: 24h from now)",
  "message": "The message to send (if send_now or queue_for_later)"
}

Guidelines:
- If value_score >= 90 and user active in last 48h → send_now
- If value_score >= 80 and user inactive → queue_for_later (next business morning 9am)
- If value_score < 80 → skip (wait for better opportunities)
- Keep messages BRIEF and conversational
- Focus on the TOP opportunity only (don't overwhelm)`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (content && content.type === 'text') {
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const decision = JSON.parse(jsonMatch[0]);

        console.log(`📊 Concierge decision: ${decision.decision}`);
        console.log(`   Reasoning: ${decision.reasoning}`);

        // Execute decision
        if (decision.decision === 'send_now' && decision.message) {
          // Queue with immediate delivery using new messaging action
          await supabase.from('message_queue').insert({
            user_id: user.id,
            agent_id: 'concierge',
            message_data: {
              content: decision.message,
              trigger: 'priority_update',
              priorityIds: priorities.map((p: any) => p.item_id),
            },
            final_message: decision.message,
            priority: 'high',
            scheduled_for: new Date().toISOString(),
            status: 'queued',
            requires_fresh_context: false,
            conversation_context_id: conversation.id,
          });

          console.log(`✅ Queued immediate message about priority update`);
        } else if (decision.decision === 'queue_for_later' && decision.message && decision.scheduled_for) {
          // Queue for future delivery
          await supabase.from('message_queue').insert({
            user_id: user.id,
            agent_id: 'concierge',
            message_data: {
              content: decision.message,
              trigger: 'priority_update',
              priorityIds: priorities.map((p: any) => p.item_id),
            },
            final_message: decision.message,
            priority: 'medium',
            scheduled_for: decision.scheduled_for,
            status: 'queued',
            requires_fresh_context: true, // Re-evaluate relevance before sending
            conversation_context_id: conversation.id,
          });

          console.log(`✅ Queued message for later delivery at ${decision.scheduled_for}`);
        } else {
          console.log(`⏭️  Skipped notification: ${decision.reasoning}`);
        }

        // Log the decision
        await supabase.from('agent_actions_log').insert({
          agent_type: 'concierge',
          action_type: 'priority_notification_decision',
          user_id: user.id,
          context_id: conversation.id,
          context_type: 'conversation',
          model_used: 'claude-sonnet-4-20250514',
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          input_data: {
            prioritiesCount: priorities.length,
            maxScore: Math.max(...priorities.map((p: any) => p.value_score || 0)),
            hoursSinceActivity,
          },
          output_data: decision,
        });
      }
    }
  } catch (error) {
    console.error('❌ Error in Concierge priority decision:', error);
    throw error;
  }
}

// executeAction() removed - not needed for event-only processing

/**
 * Handle agent task ready event
 */
async function handleAgentTask(event: Event) {
  console.log(`📋 Handling agent task: ${event.payload.task_type}`);

  // In production, this would route to specific agent handlers
  // For now, just log it
  console.log(`Task context:`, event.payload.context);
}

/**
 * Handle outbound message ready event
 */
async function handleOutboundMessage(event: Event) {
  console.log(`📤 Handling outbound message`);

  // In production, this would pass through Message Orchestrator
  // For now, just log it
  console.log(`Message data:`, event.payload);
}

/**
 * Handle community response received event
 */
async function handleCommunityResponse(event: Event) {
  console.log(`💬 Handling community response`);

  // This would trigger Solution Saga or other requesting agent
  console.log(`Response data:`, event.payload);
}

/**
 * Handle solution research complete event
 */
async function handleSolutionResearchComplete(event: Event) {
  console.log(`🔬 Handling solution research complete`);

  // This would notify concierge to craft message for user
  console.log(`Research results:`, event.payload);
}

/**
 * Handle priority update event from Account Manager
 *
 * Account Manager publishes these events when high-value priorities are detected.
 * Concierge must decide when/how to notify the user.
 */
async function handlePriorityUpdate(event: Event) {
  console.log(`⭐ Handling priority update for user ${event.aggregate_id}`);

  const userId = event.aggregate_id;
  const priorities = event.payload.priorities || [];
  const maxScore = event.payload.maxScore || 0;

  console.log(`   ${priorities.length} urgent priorities, max score: ${maxScore}`);

  // Get user and active conversation
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (userError || !user) {
    console.error(`❌ Failed to get user ${userId}:`, userError);
    return;
  }

  // Get active conversation (most recent)
  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('last_message_at', { ascending: false })
    .limit(1)
    .single();

  if (convError || !conversation) {
    console.error(`❌ Failed to get conversation for user ${userId}:`, convError);
    return;
  }

  // Route to Concierge for timing decision and message crafting
  try {
    await handleConciergePriorityUpdate(user, conversation, priorities, event.metadata);
    console.log(`✅ Concierge handled priority update for user ${userId}`);
  } catch (error) {
    console.error(`❌ Error handling priority update:`, error);
    await logError('priority_update_handling_error', event.id, error);
  }
}

/**
 * Log error to database for debugging
 */
async function logError(errorType: string, contextId: string, error: any) {
  try {
    await supabase.from('agent_actions_log').insert({
      agent_type: 'realtime_processor',
      action_type: errorType,
      context_id: contextId,
      context_type: 'error',
      error: error.message || String(error),
      input_data: { stack: error.stack },
      created_at: new Date().toISOString(),
    });
  } catch (logError) {
    console.error('Failed to log error:', logError);
  }
}

/**
 * Start HTTP health check server
 */
function startHealthCheckServer(): http.Server {
  const port = parseInt(process.env.PORT || '8080', 10);

  const server = http.createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      const uptime = Math.floor((Date.now() - serviceState.startTime) / 1000);

      const healthData = {
        status: 'healthy',
        service: 'realtime-processor',
        timestamp: new Date().toISOString(),
        uptime,
        subscriptions: serviceState.subscriptions,
        stats: {
          messagesProcessed: serviceState.messagesProcessed,
          eventsProcessed: serviceState.eventsProcessed,
          lastMessageProcessed: serviceState.lastMessageProcessed,
        },
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(healthData, null, 2));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  server.listen(port, () => {
    console.log(`🏥 Health check server listening on port ${port}`);
  });

  return server;
}

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(httpServer: http.Server) {
  if (serviceState.isShuttingDown) {
    console.log('⏳ Shutdown already in progress...');
    return;
  }

  serviceState.isShuttingDown = true;
  console.log('🛑 Graceful shutdown initiated...');

  // 1. Stop accepting new requests
  httpServer.close(() => {
    console.log('✅ HTTP server closed');
  });

  // 2. Wait for in-flight processing (max 30s)
  console.log('⏳ Waiting for in-flight processing to complete...');
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // 3. Close Supabase connections
  console.log('🔌 Closing WebSocket connections...');
  await supabase.removeAllChannels();

  console.log('✅ Graceful shutdown complete');
  process.exit(0);
}

// Start the service
startRealtimeProcessor().catch((error) => {
  console.error('💥 Fatal error starting service:', error);
  process.exit(1);
});
