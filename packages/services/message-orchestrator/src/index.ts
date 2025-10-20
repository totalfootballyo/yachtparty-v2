/**
 * Message Orchestrator Service
 *
 * Cloud Run service that handles message rate limiting, scheduling, and delivery.
 *
 * Architecture:
 * - HTTP webhook endpoints for queuing messages
 * - Periodic polling (every 30 seconds) to process due messages
 * - Rate limiting: max 1 message per 30 seconds per user
 * - Quiet hours enforcement: 10pm-8am local time (no messages)
 * - Message scheduling and batch delivery optimization
 *
 * Endpoints:
 * - POST /schedule-message - Queue a message for delivery
 * - POST /process-queue - Trigger queue processing (called by cron)
 * - GET /health - Health check
 */

import express from 'express';
import type { Request, Response } from 'express';
import { config } from 'dotenv';
import { MessageOrchestrator, QueueMessageParams } from '@yachtparty/orchestrator';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
config();

// Environment validation
const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'ANTHROPIC_API_KEY',
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

const orchestrator = new MessageOrchestrator({
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_KEY,
  anthropicKey: process.env.ANTHROPIC_API_KEY,
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
  twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER
});

const PORT = parseInt(process.env.PORT || '8080', 10);

// Service state
let messagesQueued = 0;
let messagesProcessed = 0;
let lastProcessTime: Date | null = null;

// Start background queue processor
let processorInterval: NodeJS.Timeout | null = null;

async function startQueueProcessor() {
  if (processorInterval) {
    return; // Already running
  }

  console.log('Starting queue processor (every 30 seconds)');

  // Initial processing
  await processQueue();

  // Schedule periodic processing every 30 seconds
  processorInterval = setInterval(async () => {
    await processQueue();
  }, 30000); // 30 seconds
}

async function processQueue() {
  try {
    console.log('Processing message queue...');
    lastProcessTime = new Date();

    await orchestrator.processDueMessages();

    messagesProcessed++;
    console.log('Queue processing complete');
  } catch (error) {
    console.error('Error processing queue:', error);
  }
}

function stopQueueProcessor() {
  if (processorInterval) {
    clearInterval(processorInterval);
    processorInterval = null;
    console.log('Queue processor stopped');
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
 * POST /schedule-message
 * Queue a message for delivery with rate limiting and scheduling
 *
 * Body: {
 *   userId: string,
 *   agentId: string,
 *   messageData: any,
 *   priority?: 'urgent' | 'high' | 'medium' | 'low',
 *   canDelay?: boolean,
 *   requiresFreshContext?: boolean,
 *   conversationId?: string
 * }
 */
app.post('/schedule-message', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      userId,
      agentId,
      messageData,
      priority = 'medium',
      canDelay = true,
      requiresFreshContext = false,
      conversationId
    } = req.body;

    // Validate required fields
    if (!userId || !agentId || !messageData) {
      res.status(400).json({
        error: 'Missing required fields',
        required: ['userId', 'agentId', 'messageData']
      });
      return;
    }

    console.log(`Scheduling message for user ${userId}, priority ${priority}`);

    const params: QueueMessageParams = {
      userId,
      agentId,
      messageData,
      priority,
      canDelay,
      requiresFreshContext,
      conversationId
    };

    const messageId = await orchestrator.queueMessage(params);
    messagesQueued++;

    console.log(`Message queued successfully: ${messageId}`);

    res.status(200).json({
      success: true,
      messageId,
      status: 'queued'
    });
  } catch (error) {
    console.error('Error scheduling message:', error);
    res.status(500).json({
      error: 'Failed to schedule message',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * POST /process-queue
 * Manually trigger queue processing (can be called by cron)
 */
app.post('/process-queue', async (req: Request, res: Response): Promise<void> => {
  try {
    console.log('Manual queue processing triggered');

    await processQueue();

    res.status(200).json({
      success: true,
      message: 'Queue processed successfully',
      lastProcessTime
    });
  } catch (error) {
    console.error('Error processing queue:', error);
    res.status(500).json({
      error: 'Failed to process queue',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (_req: Request, res: Response) => {
  const health = {
    status: 'healthy',
    service: 'message-orchestrator',
    timestamp: new Date().toISOString(),
    stats: {
      messagesQueued,
      messagesProcessed,
      lastProcessTime: lastProcessTime?.toISOString() || null,
      processorRunning: processorInterval !== null
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
  console.log('Message Orchestrator Service Starting');
  console.log('='.repeat(60));
  console.log(`Supabase URL: ${process.env.SUPABASE_URL}`);
  console.log(`Twilio Phone Number: ${process.env.TWILIO_PHONE_NUMBER}`);
  console.log(`Port: ${PORT}`);
  console.log('='.repeat(60));

  const server = app.listen(PORT, () => {
    console.log('\n✓ Message Orchestrator service is running');
    console.log(`  Listening on port ${PORT}`);
    console.log(`  POST /schedule-message - Queue a message`);
    console.log(`  POST /process-queue    - Process queue manually`);
    console.log(`  GET  /health           - Health check`);
    console.log('  Press Ctrl+C to shutdown gracefully\n');
  });

  // Start background queue processor
  await startQueueProcessor();

  // Graceful shutdown
  const shutdown = () => {
    console.log('\nShutdown signal received. Closing server...');

    // Stop queue processor
    stopQueueProcessor();

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
