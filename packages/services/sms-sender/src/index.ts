/**
 * SMS Sender Service
 *
 * Cloud Run service that receives webhook calls from Supabase and sends SMS via Twilio.
 *
 * Architecture:
 * - Receives POST /send-sms webhook from Supabase when messages have status='pending'
 * - Gets conversation for recipient phone number
 * - Sends via Twilio API
 * - Updates message with twilio_message_sid, status='sent', sent_at
 * - GET /health endpoint for Cloud Run health checks
 * - Retry logic with exponential backoff
 */

import { createClient } from '@supabase/supabase-js';
import Twilio from 'twilio';
import express from 'express';
import type { Request, Response } from 'express';
import { config } from 'dotenv';

// Load environment variables
config();

// Environment validation
const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE_NUMBER'
] as const;

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

// Initialize clients
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const twilioClient = Twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER!;
const PORT = parseInt(process.env.PORT || '8080', 10);

// Service state
let messagesProcessed = 0;

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second

/**
 * Message payload from Supabase Realtime
 */
interface MessagePayload {
  id: string;
  conversation_id: string;
  content: string;
  status: string;
  direction: string;
  created_at: string;
}

/**
 * Conversation record
 */
interface Conversation {
  id: string;
  phone_number: string;
  user_id: string;
}

/**
 * Send SMS via Twilio with retry logic
 */
async function sendSMS(
  phoneNumber: string,
  messageContent: string,
  messageId: string,
  retryCount = 0
): Promise<{ success: boolean; messageSid?: string; error?: string }> {
  try {
    const startTime = Date.now();
    console.log(`[${messageId}] Sending SMS to ${phoneNumber} (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);

    const twilioMessage = await twilioClient.messages.create({
      to: phoneNumber,
      from: TWILIO_PHONE_NUMBER,
      body: messageContent
    });

    const twilioLatency = Date.now() - startTime;
    console.log(`[${messageId}] SMS sent successfully. Twilio SID: ${twilioMessage.sid}, Twilio API latency: ${twilioLatency}ms`);

    return {
      success: true,
      messageSid: twilioMessage.sid
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[${messageId}] Twilio error (attempt ${retryCount + 1}):`, errorMessage);

    // Check if we should retry
    if (retryCount < MAX_RETRIES) {
      const retryDelay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
      console.log(`[${messageId}] Retrying in ${retryDelay}ms...`);

      await new Promise(resolve => setTimeout(resolve, retryDelay));
      return sendSMS(phoneNumber, messageContent, messageId, retryCount + 1);
    }

    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Process outbound message
 */
async function processOutboundMessage(message: MessagePayload): Promise<void> {
  const { id: messageId, conversation_id, content } = message;

  console.log(`[${messageId}] Processing outbound message for conversation ${conversation_id}`);

  try {
    // 1. Get conversation to retrieve phone number
    const { data: conversation, error: conversationError } = await supabase
      .from('conversations')
      .select('id, phone_number, user_id')
      .eq('id', conversation_id)
      .single<Conversation>();

    if (conversationError || !conversation) {
      console.error(`[${messageId}] Failed to get conversation:`, conversationError);

      // Update message status to failed
      await supabase
        .from('messages')
        .update({
          status: 'failed',
          sent_at: new Date().toISOString()
        })
        .eq('id', messageId);

      return;
    }

    console.log(`[${messageId}] Found conversation for phone: ${conversation.phone_number}`);

    // 2. Send via Twilio
    const result = await sendSMS(conversation.phone_number, content, messageId);

    // 3. Update message record
    if (result.success) {
      await supabase
        .from('messages')
        .update({
          twilio_message_sid: result.messageSid,
          status: 'sent',
          sent_at: new Date().toISOString()
        })
        .eq('id', messageId);

      console.log(`[${messageId}] Message status updated to 'sent'`);
    } else {
      // Mark as failed after all retries exhausted
      await supabase
        .from('messages')
        .update({
          status: 'failed',
          sent_at: new Date().toISOString()
        })
        .eq('id', messageId);

      console.error(`[${messageId}] Message marked as failed after ${MAX_RETRIES} retries: ${result.error}`);
    }
  } catch (error) {
    console.error(`[${messageId}] Unexpected error processing message:`, error);

    // Update message status to failed
    try {
      await supabase
        .from('messages')
        .update({
          status: 'failed',
          sent_at: new Date().toISOString()
        })
        .eq('id', messageId);
    } catch (updateError) {
      console.error(`[${messageId}] Failed to update message status:`, updateError);
    }
  }
}

/**
 * Express app setup
 */
const app = express();

// Parse JSON bodies
app.use(express.json());

// Request logging middleware
app.use((req: Request, res: Response, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
    });
  });
  next();
});

/**
 * POST /send-sms
 * Webhook endpoint called by Supabase when a message is pending
 */
app.post('/send-sms', async (req: Request, res: Response): Promise<void> => {
  try {
    const { record } = req.body;

    if (!record || !record.id) {
      res.status(400).json({ error: 'Invalid webhook payload' });
      return;
    }

    const message = record as MessagePayload;

    console.log(`Webhook received for message: ${message.id}`);

    // Process message asynchronously but respond immediately to Supabase
    processOutboundMessage(message)
      .then(() => {
        messagesProcessed++;
        console.log(`✓ Message ${message.id} processed successfully`);
      })
      .catch((error) => {
        console.error(`✗ Error processing message ${message.id}:`, error);
      });

    // Respond immediately to webhook
    res.status(200).json({ success: true, messageId: message.id });
  } catch (error) {
    console.error('Error handling webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (_req: Request, res: Response) => {
  const health = {
    status: 'healthy',
    service: 'sms-sender',
    timestamp: new Date().toISOString(),
    stats: {
      messagesProcessed,
    },
  };

  res.status(200).json(health);
});

/**
 * Catch-all route
 */
app.all('*', (req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
  });
});

/**
 * Main entry point
 */
async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('SMS Sender Service Starting');
  console.log('='.repeat(60));
  console.log(`Supabase URL: ${process.env.SUPABASE_URL}`);
  console.log(`Twilio Phone Number: ${TWILIO_PHONE_NUMBER}`);
  console.log(`Port: ${PORT}`);
  console.log('='.repeat(60));

  const server = app.listen(PORT, () => {
    console.log('\n✓ SMS Sender service is running');
    console.log(`  Listening on port ${PORT}`);
    console.log(`  POST /send-sms - Webhook endpoint`);
    console.log(`  GET  /health   - Health check`);
    console.log('  Press Ctrl+C to shutdown gracefully\n');
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\nShutdown signal received. Closing server...');
    server.close(() => {
      console.log('✓ Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Unhandled error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Start the service
main().catch((error) => {
  console.error('Fatal error during startup:', error);
  process.exit(1);
});
