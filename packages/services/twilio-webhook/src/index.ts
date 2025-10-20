/**
 * Twilio Webhook Handler - Cloud Run Service
 *
 * Receives inbound SMS messages from Twilio and directly invokes agents
 * for immediate processing and response.
 *
 * Flow:
 * 1. Validate Twilio webhook signature
 * 2. Find or create user by phone number
 * 3. Find or create active conversation
 * 4. Record inbound message in messages table
 * 5. Update conversation timestamps
 * 6. Invoke appropriate agent (Bouncer/Concierge/Innovator) based on user state
 * 7. Agent response written to messages table (sms-sender picks it up)
 *
 * @see requirements.md Section 6.2 - Entry Points
 */

import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import twilioPackage from 'twilio';
const { validateRequest } = twilioPackage;
import { createServiceClient } from '@yachtparty/shared';
import type { User, Conversation, Message } from '@yachtparty/shared';
import { invokeBouncerAgent } from '@yachtparty/agent-bouncer';
import { invokeConciergeAgent } from '@yachtparty/agent-concierge';
import { invokeInnovatorAgent } from '@yachtparty/agent-innovator';
import { invokeAccountManagerAgent } from '@yachtparty/agent-account-manager';
import dotenv from 'dotenv';
import crypto from 'crypto';

// Load environment variables
dotenv.config();

// =====================================================
// CONFIGURATION
// =====================================================

const PORT = process.env.PORT || '8080';
const NODE_ENV = process.env.NODE_ENV || 'production';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN?.trim();
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Validate required environment variables
if (!TWILIO_AUTH_TOKEN) {
  throw new Error('TWILIO_AUTH_TOKEN environment variable is required');
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
}

// =====================================================
// TYPES
// =====================================================

/**
 * Twilio webhook request body structure
 */
interface TwilioWebhookBody {
  /** User's phone number in E.164 format (e.g., +15551234567) */
  From: string;
  /** Message content */
  Body: string;
  /** Twilio message SID for tracking */
  MessageSid: string;
  /** Destination phone number (our Twilio number) */
  To?: string;
  /** Number of media items attached */
  NumMedia?: string;
}

/**
 * Agent response structure
 */
interface AgentResponse {
  immediateReply?: boolean;
  message?: string;
  messages?: string[]; // Array of messages for sequence support
  actions?: Array<{
    type: string;
    params: any;
    reason?: string;
  }>;
  events?: Array<{
    event_type: string;
    aggregate_id: string;
    aggregate_type: string;
    payload: any;
    metadata?: any;
    created_by: string;
  }>;
}

// =====================================================
// EXPRESS APP
// =====================================================

const app = express();

// Parse URL-encoded bodies (Twilio sends form data)
app.use(express.urlencoded({ extended: false }));

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
    });
  });
  next();
});

// =====================================================
// WEBHOOK SIGNATURE VALIDATION MIDDLEWARE
// =====================================================

/**
 * Validates Twilio webhook signatures to prevent spoofing and replay attacks.
 * All requests to /sms must have a valid X-Twilio-Signature header.
 *
 * @see https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
function validateTwilioSignature(req: Request, res: Response, next: NextFunction): void {
  // Skip validation in development if explicitly disabled
  if (NODE_ENV === 'development' && process.env.SKIP_TWILIO_VALIDATION === 'true') {
    console.warn('⚠️  Twilio signature validation skipped (development mode)');
    next();
    return;
  }

  const twilioSignature = req.headers['x-twilio-signature'] as string;

  if (!twilioSignature) {
    console.error('Missing X-Twilio-Signature header');
    res.status(403).json({
      error: 'Forbidden',
      message: 'Missing Twilio signature',
    });
    return;
  }

  // Reconstruct the full URL (required for signature validation)
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['host'];
  const url = `${protocol}://${host}${req.originalUrl}`;

  // Convert body to plain object (req.body has null prototype which can cause issues)
  const params: Record<string, string> = {};
  for (const key in req.body) {
    params[key] = req.body[key];
  }

  // Debug logging
  console.log('Validating Twilio signature', {
    url,
    protocol,
    host,
    originalUrl: req.originalUrl,
    twilioSignature,
    hasAuthToken: !!TWILIO_AUTH_TOKEN,
    authTokenLength: TWILIO_AUTH_TOKEN?.length,
    authTokenPrefix: TWILIO_AUTH_TOKEN?.substring(0, 8) + '...',
    authTokenSuffix: '...' + TWILIO_AUTH_TOKEN?.substring(TWILIO_AUTH_TOKEN.length - 8),
    paramKeys: Object.keys(params).sort(),
  });

  // Try manual signature calculation
  const sortedParams = Object.keys(params).sort().map(key => `${key}${params[key]}`).join('');
  const data = url + sortedParams;
  const expectedSig = crypto.createHmac('sha1', TWILIO_AUTH_TOKEN!).update(Buffer.from(data, 'utf-8')).digest('base64');

  console.log('Manual signature check', {
    dataLength: data.length,
    dataPreview: data.substring(0, 150),
    sortedParamsPreview: sortedParams.substring(0, 100),
    expectedSig,
    receivedSig: twilioSignature,
    match: expectedSig === twilioSignature
  });

  // Validate the signature
  const isValid = validateRequest(
    TWILIO_AUTH_TOKEN!,
    twilioSignature,
    url,
    params
  );

  if (!isValid) {
    console.error('Invalid Twilio signature', { url, body: req.body });
    res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid Twilio signature',
    });
    return;
  }

  next();
}

// =====================================================
// MESSAGE PROCESSING FUNCTIONS
// =====================================================

/**
 * Finds an existing user by phone number or creates a new one.
 * New users are assigned to the Bouncer agent for onboarding.
 *
 * @param phoneNumber - User's phone number in E.164 format
 * @returns User record (existing or newly created)
 * @throws Error if database operation fails
 */
async function findOrCreateUser(phoneNumber: string): Promise<User> {
  const supabase = createServiceClient();

  // Try to find existing user
  const { data: existingUser, error: findError } = await supabase
    .from('users')
    .select('*')
    .eq('phone_number', phoneNumber)
    .single();

  if (existingUser) {
    console.log(`Found existing user: ${existingUser.id}`);
    return existingUser as User;
  }

  // User not found, create new one
  if (findError && findError.code !== 'PGRST116') {
    // PGRST116 is "not found" error
    throw new Error(`Error finding user: ${findError.message}`);
  }

  console.log(`Creating new user for phone: ${phoneNumber}`);

  const { data: newUser, error: createError } = await supabase
    .from('users')
    .insert({
      phone_number: phoneNumber,
      poc_agent_type: 'bouncer', // New users start with Bouncer
      verified: false,
      credit_balance: 0,
      status_level: 'member',
    })
    .select()
    .single();

  if (createError || !newUser) {
    throw new Error(`Error creating user: ${createError?.message}`);
  }

  console.log(`Created new user: ${newUser.id}`);
  return newUser as User;
}

/**
 * Finds an active conversation for the user or creates a new one.
 * Phone number is denormalized for fast webhook lookups.
 *
 * @param user - User record
 * @returns Conversation record (existing or newly created)
 * @throws Error if database operation fails
 */
async function findOrCreateConversation(user: User): Promise<Conversation> {
  const supabase = createServiceClient();

  // Try to find active conversation
  const { data: existingConversation, error: findError } = await supabase
    .from('conversations')
    .select('*')
    .eq('phone_number', user.phone_number)
    .eq('status', 'active')
    .single();

  if (existingConversation) {
    console.log(`Found active conversation: ${existingConversation.id}`);
    return existingConversation as Conversation;
  }

  // Conversation not found, create new one
  if (findError && findError.code !== 'PGRST116') {
    throw new Error(`Error finding conversation: ${findError.message}`);
  }

  console.log(`Creating new conversation for user: ${user.id}`);

  const { data: newConversation, error: createError } = await supabase
    .from('conversations')
    .insert({
      user_id: user.id,
      phone_number: user.phone_number,
      status: 'active',
      messages_since_summary: 0,
    })
    .select()
    .single();

  if (createError || !newConversation) {
    throw new Error(`Error creating conversation: ${createError?.message}`);
  }

  console.log(`Created new conversation: ${newConversation.id}`);
  return newConversation as Conversation;
}

/**
 * Records an inbound message in the messages table.
 *
 * @param conversation - Conversation record
 * @param user - User record
 * @param body - Message content
 * @param messageSid - Twilio message SID
 * @returns Message record
 * @throws Error if database operation fails
 */
async function recordInboundMessage(
  conversation: Conversation,
  user: User,
  body: string,
  messageSid: string
): Promise<Message> {
  const supabase = createServiceClient();

  const { data: message, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      user_id: user.id,
      role: 'user',
      content: body,
      direction: 'inbound',
      twilio_message_sid: messageSid,
      status: 'delivered',
    })
    .select()
    .single();

  if (error || !message) {
    throw new Error(`Error recording message: ${error?.message}`);
  }

  console.log(`Recorded inbound message: ${message.id}`);
  return message as Message;
}

/**
 * Updates conversation timestamps after message receipt.
 *
 * @param conversationId - Conversation ID
 * @throws Error if database operation fails
 */
async function updateConversationTimestamps(conversationId: string): Promise<void> {
  const supabase = createServiceClient();

  const now = new Date().toISOString();

  const { error } = await supabase
    .from('conversations')
    .update({
      last_message_at: now,
      updated_at: now,
    })
    .eq('id', conversationId);

  if (error) {
    throw new Error(`Error updating conversation timestamps: ${error.message}`);
  }

  console.log(`Updated conversation timestamps: ${conversationId}`);
}

/**
 * Execute action returned by agent
 */
async function executeAction(action: { type: string; params: any }, userId: string, conversationId: string) {
  const supabase = createServiceClient();
  console.log(`⚡ Executing action: ${action.type}`);

  switch (action.type) {
    case 'update_user_field':
      // Handle both old format (single field) and new format (multiple fields from Bouncer)
      if (action.params.field && action.params.value !== undefined) {
        // Old format: single field update
        await supabase
          .from('users')
          .update({ [action.params.field]: action.params.value })
          .eq('id', userId);
      } else if (action.params.fields && action.params.extracted) {
        // New format from Bouncer: multiple fields already updated by collectUserInfo
        // This is just a log action, actual update already happened
        console.log(`   Updated fields: ${action.params.fields.join(', ')}`);
      }
      break;

    case 'set_referrer':
      // Referrer was already set by Bouncer agent, this is just a log action
      console.log(`   Set referrer: ${action.params.referred_by} (${action.params.referrer_name})`);
      break;

    case 'store_name_dropped':
      // Name was already stored by Bouncer agent, this is just a log action
      console.log(`   Stored name_dropped: ${action.params.name_dropped}`);
      break;

    case 'create_agent_task':
      // Generic task creation
      // Calculate scheduled_for from scheduled_hours if provided, otherwise use scheduled_for param
      let scheduledFor: string;
      if (action.params.scheduled_hours) {
        const futureDate = new Date();
        futureDate.setHours(futureDate.getHours() + action.params.scheduled_hours);
        scheduledFor = futureDate.toISOString();
      } else {
        scheduledFor = action.params.scheduled_for || new Date().toISOString();
      }

      await supabase.from('agent_tasks').insert({
        task_type: action.params.task_type || 're_engagement_check',
        agent_type: action.params.agent_type || 'bouncer',
        user_id: userId,
        context_id: conversationId,
        context_type: 'conversation',
        scheduled_for: scheduledFor,
        priority: action.params.priority || 'medium',
        context_json: action.params.context_json || {},
      });
      console.log(`   Created task: ${action.params.task_type} scheduled for ${scheduledFor}`);
      break;

    case 'create_verification_task':
      await supabase.from('agent_tasks').insert({
        task_type: 'verify_user',
        agent_type: 'bouncer',
        user_id: userId,
        scheduled_for: new Date().toISOString(),
        priority: 'high',
        context_json: action.params,
      });
      break;

    case 'mark_user_verified':
      await supabase
        .from('users')
        .update({
          verified: true,
          poc_agent_type: 'concierge',
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);
      console.log(`   Marked user verified, transitioned to Concierge`);
      break;

    case 'create_intro_opportunity':
      // Intro opportunity already created by storeNomination, this is just a log
      console.log(`   Created intro opportunity: ${action.params.intro_opportunity_id}`);
      break;

    case 'request_solution_research':
      await supabase.from('events').insert({
        event_type: 'user.inquiry.solution_needed',
        aggregate_id: userId,
        aggregate_type: 'user',
        payload: { description: action.params.description },
        created_by: 'concierge_agent',
      });
      break;

    case 'ask_community_question':
      // Community request event already published by Concierge, this is just a log action
      console.log(`   Asked community question: ${action.params.question}`);
      if (action.params.expertiseNeeded && action.params.expertiseNeeded.length > 0) {
        console.log(`   Expertise needed: ${action.params.expertiseNeeded.join(', ')}`);
      }
      break;

    case 'cancel_community_request':
      // Cancel an outstanding community request
      await supabase
        .from('community_requests')
        .update({
          status: 'cancelled',
          closed_loop_at: new Date().toISOString(),
          closed_loop_message: 'Cancelled by user - no longer needed',
        })
        .eq('id', action.params.request_id);

      // Also mark associated priorities as cancelled
      await supabase
        .from('user_priorities')
        .update({ status: 'cancelled' })
        .eq('item_type', 'community_request')
        .eq('item_id', action.params.request_id)
        .eq('status', 'active');

      console.log(`   Cancelled community request: ${action.params.request_id}`);
      break;

    case 'schedule_followup':
      await supabase.from('agent_tasks').insert({
        task_type: 're_engagement_check',
        agent_type: 'concierge',
        user_id: userId,
        scheduled_for: action.params.when,
        priority: 'medium',
        context_json: { reason: action.params.reason },
      });
      break;

    case 'send_message':
      // Single message - queue with immediate delivery
      await supabase.from('message_queue').insert({
        user_id: userId,
        agent_id: action.params.agent_id || 'concierge',
        message_data: { content: action.params.content },
        final_message: action.params.content,
        priority: action.params.priority || 'medium',
        scheduled_for: new Date().toISOString(),
        status: 'queued',
        requires_fresh_context: false,
        conversation_context_id: conversationId
      });
      console.log(`   Queued message for immediate delivery`);
      break;

    case 'send_message_sequence':
      // Multi-message sequence - generate sequence_id and queue all messages
      const sequenceId = crypto.randomUUID();
      const messages = action.params.messages || [];
      const delaySeconds = action.params.delay_seconds || 1;

      if (messages.length > 5) {
        console.log(`⚠️  Message sequence too long (${messages.length}), limiting to 5`);
        messages.splice(5); // Truncate to 5 messages
      }

      const baseTime = new Date();
      for (let i = 0; i < messages.length; i++) {
        const scheduledTime = new Date(baseTime.getTime() + (i * delaySeconds * 1000));
        await supabase.from('message_queue').insert({
          user_id: userId,
          agent_id: action.params.agent_id || 'concierge',
          message_data: { content: messages[i], sequence_position: i + 1, sequence_total: messages.length },
          final_message: messages[i],
          priority: action.params.priority || 'medium',
          scheduled_for: scheduledTime.toISOString(),
          status: 'queued',
          requires_fresh_context: false,
          conversation_context_id: conversationId,
          sequence_id: sequenceId,
          sequence_position: i + 1,
          sequence_total: messages.length
        });
      }
      console.log(`   Queued message sequence: ${messages.length} messages (sequence ${sequenceId})`);
      break;

    case 'queue_message':
      // Queue message for future delivery
      await supabase.from('message_queue').insert({
        user_id: userId,
        agent_id: action.params.agent_id || 'concierge',
        message_data: { content: action.params.content, reason: action.params.reason },
        final_message: action.params.content,
        priority: action.params.priority || 'medium',
        scheduled_for: action.params.scheduled_for,
        status: 'queued',
        requires_fresh_context: action.params.requires_fresh_context !== false,
        conversation_context_id: conversationId
      });
      console.log(`   Queued message for ${action.params.scheduled_for}`);
      break;

    case 'cancel_queued_message':
      // Cancel a previously queued message
      await supabase
        .from('message_queue')
        .update({
          status: 'cancelled',
          superseded_reason: action.params.reason
        })
        .eq('id', action.params.message_id);
      console.log(`   Cancelled queued message ${action.params.message_id}: ${action.params.reason}`);
      break;

    default:
      console.log(`ℹ️  Unknown action type: ${action.type}`);
  }
}

/**
 * Wrapper for Bouncer Agent package
 *
 * Delegates to the sophisticated Bouncer package which includes:
 * - Velvet rope positioning and mysterious tone
 * - Prompt caching for 40% cost reduction
 * - Comprehensive LLM logging to agent_actions_log
 * - Information extraction and validation
 * - Re-engagement task scheduling
 * - Event publishing for onboarding steps
 */
async function invokeBouncerPackageAgent(
  message: Message,
  user: User,
  conversation: Conversation
): Promise<AgentResponse> {
  console.log('🚪 Invoking Bouncer Agent (package version)');

  // Call the sophisticated Bouncer package
  return await invokeBouncerAgent(message, user, conversation);
}

/**
 * Wrapper for Concierge Agent package
 *
 * Delegates to the sophisticated Concierge package which includes:
 * - Intent classification
 * - Message rendering
 * - Event publishing
 * - Comprehensive logging
 */
async function invokeConciergPackageAgent(
  message: Message,
  user: User,
  conversation: Conversation
): Promise<AgentResponse> {
  console.log('🎩 Invoking Concierge Agent (package version)');

  // Call the sophisticated Concierge package
  return await invokeConciergeAgent(message, user, conversation);
}

/**
 * Wrapper for Innovator Agent package
 *
 * Extends Concierge with innovator-specific capabilities:
 * - Profile management
 * - Prospect uploads
 * - Intro progress reporting
 * - Credit funding
 */
async function invokeInnovatorPackageAgent(
  message: Message,
  user: User,
  conversation: Conversation
): Promise<AgentResponse> {
  console.log('💡 Invoking Innovator Agent (package version)');

  // Call the Innovator package
  return await invokeInnovatorAgent(message, user, conversation);
}

/**
 * Determine if Account Manager should be invoked
 *
 * Triggers:
 * - Initial setup after 3rd inbound message
 * - Explicit goal/challenge/opportunity mentions
 * - Scheduled review (every 14 days)
 */
async function shouldInvokeAccountManager(
  user: User,
  _conversation: Conversation,
  messageContent: string
): Promise<{ trigger: string | null }> {
  const supabase = createServiceClient();

  // Trigger 1: Initial setup after 3rd inbound message
  const { count } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('direction', 'inbound');

  if (count === 3) {
    console.log('📊 Account Manager trigger: initial_setup (3rd message)');
    return { trigger: 'initial_setup' };
  }

  // Trigger 2: Explicit goal/challenge/opportunity mentions
  const keywords = ['goal', 'trying to', 'working on', 'challenge',
                    'problem', 'struggling', 'opportunity', 'looking for'];
  if (keywords.some(kw => messageContent.toLowerCase().includes(kw))) {
    console.log('📊 Account Manager trigger: explicit_mention');
    return { trigger: 'explicit_mention' };
  }

  // Trigger 3: Scheduled review (every 14 days since last run)
  const { data: lastRun } = await supabase
    .from('agent_actions_log')
    .select('created_at')
    .eq('agent_type', 'account_manager')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (lastRun) {
    const daysSince = (Date.now() - new Date(lastRun.created_at).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince >= 14) {
      console.log(`📊 Account Manager trigger: scheduled_review (${Math.round(daysSince)} days since last run)`);
      return { trigger: 'scheduled_review' };
    }
  }

  return { trigger: null };
}

/**
 * Process inbound message and route to appropriate agent
 *
 * Routing logic:
 * - if !verified → route to bouncer (onboarding)
 * - if verified && poc_agent_type='concierge' → route to concierge
 * - if verified && poc_agent_type='innovator' → route to innovator
 */
async function processInboundMessageWithAgent(
  message: Message,
  user: User,
  conversation: Conversation
): Promise<void> {
  const supabase = createServiceClient();
  console.log(`🔄 Processing message ${message.id} from user ${user.id}`);
  console.log(`👤 User: ${user.first_name || 'Unknown'} (verified: ${user.verified}, agent: ${user.poc_agent_type})`);

  // Route to appropriate agent based on user state
  let response: AgentResponse;

  if (!user.verified) {
    console.log('🚪 Routing to Bouncer Agent (package version)');
    response = await invokeBouncerPackageAgent(message, user, conversation);
  } else if (user.poc_agent_type === 'concierge') {
    console.log('🎩 Routing to Concierge Agent (package version)');
    response = await invokeConciergPackageAgent(message, user, conversation);
  } else if (user.poc_agent_type === 'innovator') {
    console.log('💡 Routing to Innovator Agent');
    response = await invokeInnovatorPackageAgent(message, user, conversation);
  } else {
    throw new Error(`Unknown poc_agent_type: ${user.poc_agent_type}`);
  }

  // If agent wants immediate reply, insert to messages table
  // Support both message (deprecated) and messages (new array format)
  if (response.immediateReply) {
    const messagesToSend = response.messages || (response.message ? [response.message] : []);

    if (messagesToSend.length > 0) {
      console.log(`💬 Sending ${messagesToSend.length} immediate repl${messagesToSend.length === 1 ? 'y' : 'ies'}`);

      for (const messageContent of messagesToSend) {
        console.log('Inserting message:', {
          conversation_id: conversation.id,
          user_id: user.id,
          role: user.poc_agent_type,
          direction: 'outbound',
          status: 'pending',
          content_length: messageContent.length,
        });

        const { data: insertedMessage, error: insertError } = await supabase.from('messages').insert({
          conversation_id: conversation.id,
          user_id: user.id,
          role: user.poc_agent_type,
          content: messageContent,
          direction: 'outbound',
          status: 'pending',
        }).select();

        if (insertError) {
          console.error('❌ Error inserting agent reply:', insertError);
          throw new Error(`Failed to insert agent reply: ${insertError.message}`);
        }

        console.log('✅ Agent reply inserted:', insertedMessage?.[0]?.id);
      }
    }
  }

  // Execute actions returned by agent
  // Wrap in try-catch to ensure action failures don't prevent event publishing
  if (response.actions && response.actions.length > 0) {
    console.log(`⚡ Executing ${response.actions.length} actions`);
    for (const action of response.actions) {
      try {
        await executeAction(action, user.id, conversation.id);
      } catch (error) {
        // Log error but continue with other actions
        console.error(`❌ Error executing action ${action.type}:`, error);
        console.error(`   Action params:`, JSON.stringify(action.params, null, 2));
        // Don't throw - we want to continue processing other actions and events
      }
    }
  }

  // Publish events returned by agent (Concierge package returns events)
  if (response.events && response.events.length > 0) {
    console.log(`📢 Publishing ${response.events.length} events`);
    for (const event of response.events) {
      try {
        const { error: eventError } = await supabase.from('events').insert({
          event_type: event.event_type,
          aggregate_id: event.aggregate_id,
          aggregate_type: event.aggregate_type,
          payload: event.payload,
          metadata: event.metadata,
          created_by: event.created_by,
        });
        if (eventError) {
          console.error(`❌ Error publishing event ${event.event_type}:`, eventError);
        }
      } catch (error) {
        console.error(`❌ Error publishing event ${event.event_type}:`, error);
        // Don't throw - we want to continue processing other events
      }
    }
  }

  // Check if Account Manager should run (only for verified users)
  if (user.verified) {
    const accountManagerTrigger = await shouldInvokeAccountManager(user, conversation, message.content);

    if (accountManagerTrigger.trigger) {
      console.log(`📊 Invoking Account Manager: ${accountManagerTrigger.trigger}`);

      try {
        // Get recent messages for context
        const { data: recentMessages } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', conversation.id)
          .order('created_at', { ascending: false })
          .limit(20);

        // Invoke Account Manager (it executes its own actions internally)
        await invokeAccountManagerAgent(message, user, conversation, {
          trigger: accountManagerTrigger.trigger as any,
          recentMessages: recentMessages?.reverse()
        });

        console.log(`✅ Account Manager completed`);
      } catch (error) {
        // Don't fail the whole request if Account Manager fails
        console.error(`⚠️  Account Manager error:`, error);
      }
    }
  }

  console.log(`✅ Message ${message.id} processed successfully`);
}

// =====================================================
// ROUTES
// =====================================================

/**
 * POST /sms
 *
 * Receives inbound SMS messages from Twilio.
 * Validates signature, processes message, and publishes event.
 */
app.post('/sms', validateTwilioSignature, async (req: Request, res: Response) => {
  const body = req.body as TwilioWebhookBody;

  // Validate required fields
  if (!body.From || !body.Body || !body.MessageSid) {
    console.error('Missing required fields in webhook body', body);
    res.status(400).json({
      error: 'Bad Request',
      message: 'Missing required fields: From, Body, MessageSid',
    });
    return;
  }

  console.log('Received SMS webhook', {
    from: body.From,
    messageSid: body.MessageSid,
    bodyLength: body.Body.length,
  });

  try {
    // Process the message through the pipeline
    const user = await findOrCreateUser(body.From);
    const conversation = await findOrCreateConversation(user);
    const message = await recordInboundMessage(
      conversation,
      user,
      body.Body,
      body.MessageSid
    );

    await updateConversationTimestamps(conversation.id);

    // Directly invoke agent and get immediate response
    await processInboundMessageWithAgent(message, user, conversation);

    // Respond to Twilio with empty TwiML (agent response written to database, sms-sender will send it)
    res.status(200).type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  } catch (error) {
    console.error('Error processing webhook', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      from: body.From,
      messageSid: body.MessageSid,
    });

    // Return 500 so Twilio will retry
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to process message',
    });
  }
});

/**
 * POST /verify-email
 *
 * Receives forwarded verification emails from email service (Maileroo, AWS SES, etc.)
 * Parses the recipient address to extract user_id and marks user as verified.
 * Transitions user from Bouncer to Concierge agent.
 *
 * Expected email format: verify-{user_id}@verify.yachtparty.xyz
 *
 * Email webhook payload formats supported:
 * - Standard form data (to, from, subject, text, html)
 * - JSON payload with email object
 */
app.post('/verify-email', express.json(), async (req: Request, res: Response) => {
  console.log('📧 Received email verification webhook');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));

  try {
    // Extract recipient address from various possible formats
    let toAddress: string | undefined;
    let fromAddress: string | undefined;
    let subject: string | undefined;

    // Support multiple email webhook formats
    if (req.body.to) {
      toAddress = req.body.to;
      fromAddress = req.body.from;
      subject = req.body.subject;
    } else if (req.body.recipient) {
      toAddress = req.body.recipient;
      fromAddress = req.body.sender;
      subject = req.body.subject;
    } else if (req.body.recipients && Array.isArray(req.body.recipients)) {
      // Maileroo format
      toAddress = req.body.recipients[0];
      fromAddress = req.body.envelope_sender || req.body.headers?.From?.[0];
      subject = req.body.headers?.Subject?.[0] || '';
    } else if (req.body.envelope?.to) {
      toAddress = Array.isArray(req.body.envelope.to)
        ? req.body.envelope.to[0]
        : req.body.envelope.to;
      fromAddress = req.body.envelope.from;
      subject = req.body.subject || req.body.headers?.subject;
    } else if (req.body.email?.to) {
      toAddress = req.body.email.to;
      fromAddress = req.body.email.from;
      subject = req.body.email.subject;
    }

    if (!toAddress) {
      console.error('❌ Missing recipient address in email webhook');
      res.status(400).json({
        error: 'Bad Request',
        message: 'Missing recipient address (to, recipient, recipients, or envelope.to)',
      });
      return;
    }

    console.log(`📬 To: ${toAddress}, From: ${fromAddress}, Subject: ${subject}`);

    // Parse user_id from recipient address
    // Expected format: verify-{user_id}@verify.yachtparty.xyz
    const recipientMatch = toAddress.match(/verify-([a-f0-9-]+)@verify\.yachtparty\.xyz/i);

    if (!recipientMatch) {
      console.error('❌ Invalid verification email format:', toAddress);
      res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid verification email format. Expected verify-{user_id}@verify.yachtparty.xyz',
      });
      return;
    }

    const userId: string = recipientMatch[1]!;
    console.log(`✅ Extracted user_id: ${userId}`);

    // Validate domain to prevent abuse
    if (!toAddress.toLowerCase().includes('@verify.yachtparty.xyz')) {
      console.error('❌ Invalid verification domain:', toAddress);
      res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid verification domain',
      });
      return;
    }

    const supabase = createServiceClient();

    // Get user record
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      console.error(`❌ User not found: ${userId}`, userError);
      res.status(404).json({
        error: 'Not Found',
        message: 'User not found',
      });
      return;
    }

    console.log(`👤 Found user: ${user.first_name} ${user.last_name} (${user.email})`);

    // Check if already verified
    if (user.verified) {
      console.log(`ℹ️  User ${userId} already verified`);
      res.status(200).json({
        success: true,
        message: 'User already verified',
        userId,
      });
      return;
    }

    // Extract email address from "Name <email>" format if needed
    let emailAddress = fromAddress;
    if (fromAddress) {
      const emailMatch = fromAddress.match(/<(.+?)>/);
      if (emailMatch) {
        emailAddress = emailMatch[1];
      }
    }

    // Update user: mark email_verified, save email (keep poc_agent_type as bouncer)
    const { error: updateError } = await supabase
      .from('users')
      .update({
        email_verified: true,
        email: emailAddress,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (updateError) {
      console.error(`❌ Error updating user ${userId}:`, updateError);
      throw new Error(`Failed to update user: ${updateError.message}`);
    }

    console.log(`✅ User ${userId} email verified, saved email address`);

    // Log verification event to agent_actions_log
    await supabase.from('agent_actions_log').insert({
      agent_type: 'system',
      action_type: 'email_verification_completed',
      user_id: userId,
      context_type: 'email_verification',
      input_data: {
        to: toAddress,
        from: fromAddress,
        subject,
      },
      output_data: {
        email_verified: true,
        email: emailAddress,
      },
      created_at: new Date().toISOString(),
    });

    // Get active conversation for user
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false})
      .limit(1)
      .single();

    if (convError && convError.code !== 'PGRST116') {
      console.error(`⚠️  Error finding conversation for user ${userId}:`, convError);
    }

    // Directly invoke Bouncer to acknowledge email verification
    if (conversation) {
      // Refresh user record with email_verified = true
      const { data: updatedUser } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (updatedUser) {
        // Create a system message to trigger email verified acknowledgment
        const systemMessage: Message = {
          id: crypto.randomUUID(),
          conversation_id: conversation.id,
          user_id: userId,
          role: 'system',
          content: 'email_verified_acknowledgment',
          direction: 'inbound',
          twilio_message_sid: null,
          status: null,
          created_at: new Date(),
          sent_at: null,
          delivered_at: null
        };

        try {
          console.log(`📲 Invoking Bouncer for email verification acknowledgment`);
          const bouncerResponse = await invokeBouncerPackageAgent(
            systemMessage,
            updatedUser as User,
            conversation as Conversation
          );

          // If Bouncer wants to send a message, insert it
          if (bouncerResponse.immediateReply && bouncerResponse.message) {
            await supabase.from('messages').insert({
              conversation_id: conversation.id,
              user_id: userId,
              role: 'bouncer',
              content: bouncerResponse.message,
              direction: 'outbound',
              status: 'pending', // SMS sender will pick this up
            });
            console.log(`✅ Bouncer acknowledgment message queued for user ${userId}`);
          }
        } catch (error) {
          console.error(`⚠️  Error invoking Bouncer for user ${userId}:`, error);
        }
      }
    } else {
      console.log(`ℹ️  No active conversation found for user ${userId}, skipping Bouncer acknowledgment`);
    }

    // Respond to email webhook
    res.status(200).json({
      success: true,
      message: 'Email verified successfully',
      userId,
      email_verified: true,
      bouncer_notified: true,
    });

  } catch (error) {
    console.error('❌ Error processing email verification:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /health
 *
 * Health check endpoint for Cloud Run monitoring.
 * Returns service status, timestamp, and version.
 */
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'twilio-webhook',
    version: '1.0.0',
    environment: NODE_ENV,
  });
});

/**
 * Catch-all route for undefined endpoints
 */
app.all('*', (req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// =====================================================
// ERROR HANDLER
// =====================================================

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
  });

  res.status(500).json({
    error: 'Internal Server Error',
    message: 'An unexpected error occurred',
  });
});

// =====================================================
// SERVER STARTUP
// =====================================================

const server = app.listen(PORT, () => {
  console.log({
    message: 'Twilio Webhook Handler started',
    port: PORT,
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});
