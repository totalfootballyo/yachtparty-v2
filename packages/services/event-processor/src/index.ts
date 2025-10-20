/**
 * Event Processor Service
 *
 * Cloud Run service that consumes events from the events table and routes them to appropriate handlers.
 *
 * Architecture:
 * - Polls events table every 10 seconds for unprocessed events
 * - Routes events to registered handlers based on event_type
 * - Marks events as processed after successful handling
 * - Implements retry logic with exponential backoff
 * - Moves failed events to dead letter queue after max retries
 * - Express server for health checks and webhook endpoint
 */

import { createClient } from '@supabase/supabase-js';
import express from 'express';
import type { Request, Response } from 'express';
import { config } from 'dotenv';
import type { Event, ProcessingStats, ProcessorConfig, DeadLetterEvent } from './types';
import { initializeHandlers, routeEvent, getRegistryStats, hasHandler } from './registry';

// Load environment variables
config();

// Environment validation
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'] as const;

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Configuration
const config_: ProcessorConfig = {
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '10000', 10),
  batchSize: parseInt(process.env.BATCH_SIZE || '20', 10),
  maxRetries: parseInt(process.env.MAX_RETRIES || '5', 10),
  enablePolling: process.env.ENABLE_POLLING !== 'false', // Enable by default
};

const PORT = parseInt(process.env.PORT || '8080', 10);

// Service state
let isShuttingDown = false;
let pollingInterval: NodeJS.Timeout | null = null;

const stats: ProcessingStats = {
  totalProcessed: 0,
  successCount: 0,
  errorCount: 0,
  deadLetterCount: 0,
  startTime: new Date(),
};

/**
 * Process a single event
 */
async function processEvent(event: Event): Promise<void> {
  console.log(`[${event.id}] Processing event: ${event.event_type}`);

  try {
    // Check if handler exists
    if (!hasHandler(event.event_type)) {
      console.warn(`[${event.id}] No handler for event type: ${event.event_type}`);
      // Mark as processed even if no handler (prevents infinite retry)
      await markEventProcessed(event.id);
      return;
    }

    // Route to handler
    await routeEvent(event);

    // Mark as processed
    await markEventProcessed(event.id);

    stats.successCount++;
    console.log(`[${event.id}] ✓ Event processed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[${event.id}] ✗ Error processing event:`, errorMessage);

    stats.errorCount++;

    // Implement retry logic
    await handleEventError(event, errorMessage);
  }
}

/**
 * Mark event as processed
 */
async function markEventProcessed(eventId: string): Promise<void> {
  const { error } = await supabase
    .from('events')
    .update({
      processed: true,
      metadata: {
        processed_at: new Date().toISOString(),
        processed_by: 'event_processor',
      },
    })
    .eq('id', eventId);

  if (error) {
    console.error(`[${eventId}] Failed to mark event as processed:`, error);
    throw error;
  }
}

/**
 * Handle event processing error with retry logic
 */
async function handleEventError(event: Event, errorMessage: string): Promise<void> {
  const retryCount = (event.metadata?.retry_count as number) || 0;
  const newRetryCount = retryCount + 1;

  if (newRetryCount >= config_.maxRetries) {
    // Move to dead letter queue
    console.log(`[${event.id}] Max retries (${config_.maxRetries}) reached, moving to dead letter queue`);

    await moveToDeadLetterQueue(event, errorMessage, newRetryCount);

    // Mark original event as processed to prevent further retries
    await markEventProcessed(event.id);

    stats.deadLetterCount++;
  } else {
    // Update retry count in metadata
    const updatedMetadata = {
      ...(event.metadata || {}),
      retry_count: newRetryCount,
      last_error: errorMessage,
      last_error_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('events')
      .update({ metadata: updatedMetadata })
      .eq('id', event.id);

    if (error) {
      console.error(`[${event.id}] Failed to update retry count:`, error);
    } else {
      console.log(`[${event.id}] Updated retry count to ${newRetryCount}/${config_.maxRetries}`);
    }
  }
}

/**
 * Move event to dead letter queue
 */
async function moveToDeadLetterQueue(
  event: Event,
  errorMessage: string,
  retryCount: number
): Promise<void> {
  const deadLetter: DeadLetterEvent = {
    event_id: event.id,
    event_type: event.event_type,
    payload: event.payload,
    error_message: errorMessage,
    retry_count: retryCount,
    original_created_at: event.created_at,
  };

  const { error } = await supabase.from('event_dead_letters').insert(deadLetter);

  if (error) {
    console.error(`[${event.id}] Failed to move to dead letter queue:`, error);
    throw error;
  }

  console.log(`[${event.id}] Moved to dead letter queue`);
}

/**
 * Process unprocessed events
 */
async function processUnprocessedEvents(): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  try {
    // Fetch unprocessed events
    const { data: events, error } = await supabase
      .from('events')
      .select('*')
      .eq('processed', false)
      .order('created_at', { ascending: true })
      .limit(config_.batchSize);

    if (error) {
      console.error('Failed to fetch unprocessed events:', error);
      return;
    }

    if (!events || events.length === 0) {
      return; // No events to process
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Found ${events.length} unprocessed event(s)`);
    console.log('='.repeat(60));

    // Process events sequentially
    for (const event of events) {
      await processEvent(event as Event);
      stats.totalProcessed++;
      stats.lastProcessedAt = new Date();
    }

    console.log(`${'='.repeat(60)}\n`);
  } catch (error) {
    console.error('Error in processUnprocessedEvents:', error);
  }
}

/**
 * Start polling loop
 */
function startPolling(): void {
  if (!config_.enablePolling) {
    console.log('⚠️  Polling disabled via ENABLE_POLLING=false');
    return;
  }

  console.log(`Starting polling loop (interval: ${config_.pollIntervalMs}ms, batch size: ${config_.batchSize})`);

  pollingInterval = setInterval(() => {
    processUnprocessedEvents();
  }, config_.pollIntervalMs);
}

/**
 * Stop polling loop
 */
function stopPolling(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    console.log('Polling loop stopped');
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
 * GET /health
 * Health check endpoint for Cloud Run
 */
app.get('/health', (_req: Request, res: Response) => {
  const uptime = Date.now() - stats.startTime.getTime();
  const registryStats = getRegistryStats();

  const health = {
    status: 'healthy',
    service: 'event-processor',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(uptime / 1000), // seconds
    stats: {
      totalProcessed: stats.totalProcessed,
      successCount: stats.successCount,
      errorCount: stats.errorCount,
      deadLetterCount: stats.deadLetterCount,
      lastProcessedAt: stats.lastProcessedAt?.toISOString(),
    },
    config: {
      pollIntervalMs: config_.pollIntervalMs,
      batchSize: config_.batchSize,
      maxRetries: config_.maxRetries,
      pollingEnabled: config_.enablePolling,
    },
    registry: {
      totalHandlers: registryStats.totalHandlers,
      eventTypes: registryStats.eventTypes,
    },
  };

  res.status(200).json(health);
});

/**
 * POST /process-event
 * Webhook endpoint for manual event processing trigger
 */
app.post('/process-event', async (req: Request, res: Response): Promise<void> => {
  try {
    const { event_id } = req.body;

    if (!event_id) {
      res.status(400).json({ error: 'event_id is required' });
      return;
    }

    // Fetch specific event
    const { data: event, error } = await supabase
      .from('events')
      .select('*')
      .eq('id', event_id)
      .single();

    if (error || !event) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }

    if (event.processed) {
      res.status(400).json({ error: 'Event already processed' });
      return;
    }

    // Process event asynchronously
    processEvent(event as Event)
      .then(() => {
        console.log(`✓ Webhook-triggered event ${event_id} processed`);
      })
      .catch((error) => {
        console.error(`✗ Webhook-triggered event ${event_id} failed:`, error);
      });

    // Respond immediately
    res.status(202).json({
      success: true,
      message: 'Event processing started',
      event_id,
    });
  } catch (error) {
    console.error('Error in /process-event:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /process-batch
 * Webhook endpoint to trigger batch processing
 */
app.post('/process-batch', async (_req: Request, res: Response): Promise<void> => {
  try {
    // Trigger batch processing asynchronously
    processUnprocessedEvents()
      .then(() => {
        console.log('✓ Webhook-triggered batch processing completed');
      })
      .catch((error) => {
        console.error('✗ Webhook-triggered batch processing failed:', error);
      });

    // Respond immediately
    res.status(202).json({
      success: true,
      message: 'Batch processing started',
    });
  } catch (error) {
    console.error('Error in /process-batch:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /close-expired-requests
 * Webhook endpoint for pg_cron to trigger community request closure
 */
app.post('/close-expired-requests', async (_req: Request, res: Response): Promise<void> => {
  try {
    const { closeExpiredCommunityRequests } = await import('./handlers/community-closure');

    console.log('[Community Closure] Endpoint triggered');
    const result = await closeExpiredCommunityRequests();

    res.status(200).json({
      success: true,
      closedCount: result.closedCount,
      requestIds: result.requestIds,
    });
  } catch (error) {
    console.error('Error in /close-expired-requests:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /community-requests-health
 * Check health of community requests system
 */
app.get('/community-requests-health', async (_req: Request, res: Response): Promise<void> => {
  try {
    const { getCommunityRequestsHealth } = await import('./handlers/community-closure');

    const health = await getCommunityRequestsHealth();

    res.status(200).json({
      success: true,
      ...health,
    });
  } catch (error) {
    console.error('Error in /community-requests-health:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
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
  console.log('Event Processor Service Starting');
  console.log('='.repeat(60));
  console.log(`Supabase URL: ${process.env.SUPABASE_URL}`);
  console.log(`Port: ${PORT}`);
  console.log(`Poll Interval: ${config_.pollIntervalMs}ms`);
  console.log(`Batch Size: ${config_.batchSize}`);
  console.log(`Max Retries: ${config_.maxRetries}`);
  console.log('='.repeat(60));

  // Initialize event handlers
  initializeHandlers();

  // Start Express server
  const server = app.listen(PORT, () => {
    console.log('\n✓ Event Processor service is running');
    console.log(`  Listening on port ${PORT}`);
    console.log(`  GET  /health                     - Health check`);
    console.log(`  POST /process-event              - Process specific event`);
    console.log(`  POST /process-batch              - Trigger batch processing`);
    console.log(`  POST /close-expired-requests     - Close expired community requests`);
    console.log(`  GET  /community-requests-health  - Community requests health status`);
    console.log('  Press Ctrl+C to shutdown gracefully\n');
  });

  // Start polling loop
  startPolling();

  // Graceful shutdown
  const shutdown = () => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    console.log('\n\nShutdown signal received. Closing gracefully...');

    // Stop polling
    stopPolling();

    // Close HTTP server
    server.close(() => {
      console.log('✓ HTTP server closed');
      console.log('✓ Event Processor shut down successfully');
      process.exit(0);
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
      console.error('⚠️  Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
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
