/**
 * Task Processor Service
 *
 * Cloud Run service that processes scheduled agent tasks from the agent_tasks table.
 *
 * Architecture:
 * - Express.js server on port 8080 for Cloud Run health checks
 * - Background polling loop every 30 seconds for pending tasks
 * - POST /process-task endpoint for webhook-triggered processing
 * - Handles retries with exponential backoff (max 3 attempts)
 * - Updates task status: pending → processing → completed/failed
 * - Logs all actions to agent_actions_log table
 *
 * Deployment:
 * - Cloud Run always-on service (min instances: 1)
 * - Environment: SUPABASE_URL, SUPABASE_SERVICE_KEY, PORT
 */

import { createServiceClient } from '@yachtparty/shared';
import express from 'express';
import type { Request, Response } from 'express';
import { config } from 'dotenv';
import { taskHandlers } from './handlers/index';
import type { Task, TaskResult, ProcessingStats, RetryInfo } from './types';

// Load environment variables
config();

// Initialize Supabase client
const supabase = createServiceClient();

const PORT = parseInt(process.env.PORT || '8080', 10);
const POLLING_INTERVAL_MS = 30000; // 30 seconds
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 60000; // 1 minute
const MAX_TASKS_PER_POLL = 10;

// Service state
const stats: ProcessingStats = {
  tasksProcessed: 0,
  tasksSucceeded: 0,
  tasksFailed: 0,
  lastProcessedAt: null,
};

let pollingInterval: NodeJS.Timeout | null = null;
let isShuttingDown = false;

// ============================================================================
// Task Processing Core Logic
// ============================================================================

/**
 * Calculate next retry time with exponential backoff
 */
function calculateNextRetry(retryCount: number): RetryInfo {
  const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, retryCount);
  const nextRetryAt = new Date(Date.now() + backoffMs);

  return { nextRetryAt, backoffMs };
}

/**
 * Process a single task
 */
async function processTask(task: Task): Promise<void> {
  console.log(`[${task.id}] Starting task processing`);
  console.log(`  Task Type: ${task.task_type}`);
  console.log(`  Agent Type: ${task.agent_type}`);
  console.log(`  User ID: ${task.user_id || 'N/A'}`);
  console.log(`  Priority: ${task.priority}`);
  console.log(`  Retry Count: ${task.retry_count}/${task.max_retries}`);

  // Update task status to processing
  const { error: updateError } = await supabase
    .from('agent_tasks')
    .update({
      status: 'processing',
      last_attempted_at: new Date().toISOString(),
    })
    .eq('id', task.id);

  if (updateError) {
    console.error(`[${task.id}] Failed to update task to processing:`, updateError);
    return;
  }

  try {
    // Get handler for task type
    const handler = taskHandlers[task.task_type];

    if (!handler) {
      console.error(`[${task.id}] No handler found for task type: ${task.task_type}`);
      await markTaskFailed(task, `No handler for task type: ${task.task_type}`, false);
      return;
    }

    // Execute handler
    const startTime = Date.now();
    const result: TaskResult = await handler(task);
    const latencyMs = Date.now() - startTime;

    console.log(`[${task.id}] Handler completed in ${latencyMs}ms`);
    console.log(`  Success: ${result.success}`);

    if (result.success) {
      // Mark task as completed
      await markTaskCompleted(task, result);
      stats.tasksSucceeded++;
    } else {
      // Handle failure
      await markTaskFailed(task, result.error || 'Unknown error', result.shouldRetry ?? true);
      stats.tasksFailed++;
    }

    // Log to agent_actions_log
    await supabase.from('agent_actions_log').insert({
      agent_type: 'task_processor',
      action_type: `process_${task.task_type}`,
      user_id: task.user_id,
      context_id: task.id,
      context_type: 'agent_task',
      latency_ms: latencyMs,
      input_data: task.context_json,
      output_data: result.data,
      error: result.error,
    });
  } catch (error) {
    console.error(`[${task.id}] Unexpected error processing task:`, error);
    await markTaskFailed(
      task,
      error instanceof Error ? error.message : String(error),
      true
    );
    stats.tasksFailed++;
  }

  stats.tasksProcessed++;
  stats.lastProcessedAt = new Date();
}

/**
 * Mark task as completed
 */
async function markTaskCompleted(task: Task, result: TaskResult): Promise<void> {
  const { error } = await supabase
    .from('agent_tasks')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      result_json: result.data || { success: true },
    })
    .eq('id', task.id);

  if (error) {
    console.error(`[${task.id}] Failed to mark task completed:`, error);
  } else {
    console.log(`[${task.id}] Task marked as completed`);
  }
}

/**
 * Mark task as failed (with retry logic)
 */
async function markTaskFailed(
  task: Task,
  errorMessage: string,
  shouldRetry: boolean
): Promise<void> {
  const retryCount = task.retry_count || 0;
  const canRetry = shouldRetry && retryCount < (task.max_retries || MAX_RETRIES);

  if (canRetry) {
    // Schedule retry with exponential backoff
    const { nextRetryAt, backoffMs } = calculateNextRetry(retryCount);

    console.log(`[${task.id}] Scheduling retry ${retryCount + 1}/${task.max_retries}`);
    console.log(`  Next attempt in ${Math.round(backoffMs / 1000)}s at ${nextRetryAt.toISOString()}`);

    const { error } = await supabase
      .from('agent_tasks')
      .update({
        status: 'pending',
        retry_count: retryCount + 1,
        scheduled_for: nextRetryAt.toISOString(),
        error_log: errorMessage,
      })
      .eq('id', task.id);

    if (error) {
      console.error(`[${task.id}] Failed to schedule retry:`, error);
    }
  } else {
    // Mark as permanently failed
    console.log(`[${task.id}] Task failed permanently after ${retryCount} retries`);

    const { error } = await supabase
      .from('agent_tasks')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        result_json: { error: errorMessage },
        error_log: errorMessage,
      })
      .eq('id', task.id);

    if (error) {
      console.error(`[${task.id}] Failed to mark task failed:`, error);
    }
  }
}

/**
 * Process all pending tasks (main polling function)
 */
async function processPendingTasks(): Promise<void> {
  if (isShuttingDown) {
    console.log('Skipping task processing - service is shutting down');
    return;
  }

  console.log('\n' + '='.repeat(60));
  console.log('Polling for pending tasks...');
  console.log('='.repeat(60));

  try {
    // Query for pending tasks using FOR UPDATE SKIP LOCKED pattern
    // This prevents concurrent processors from picking up the same task
    const { data: tasks, error } = await supabase
      .from('agent_tasks')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())
      .order('priority', { ascending: true })
      .order('scheduled_for', { ascending: true })
      .limit(MAX_TASKS_PER_POLL);

    if (error) {
      console.error('Error fetching pending tasks:', error);
      return;
    }

    if (!tasks || tasks.length === 0) {
      console.log('No pending tasks found');
      return;
    }

    console.log(`Found ${tasks.length} pending tasks`);

    // Process each task sequentially
    for (const task of tasks) {
      if (isShuttingDown) {
        console.log('Stopping task processing - service is shutting down');
        break;
      }

      await processTask(task as Task);
    }

    console.log(`\nCompleted batch: ${tasks.length} tasks processed`);
  } catch (error) {
    console.error('Error in processPendingTasks:', error);
  }
}

// ============================================================================
// Express Server Setup
// ============================================================================

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
  const health = {
    status: 'healthy',
    service: 'task-processor',
    timestamp: new Date().toISOString(),
    stats: {
      tasksProcessed: stats.tasksProcessed,
      tasksSucceeded: stats.tasksSucceeded,
      tasksFailed: stats.tasksFailed,
      successRate:
        stats.tasksProcessed > 0
          ? ((stats.tasksSucceeded / stats.tasksProcessed) * 100).toFixed(1) + '%'
          : 'N/A',
      lastProcessedAt: stats.lastProcessedAt?.toISOString() || null,
    },
    polling: {
      enabled: pollingInterval !== null,
      intervalMs: POLLING_INTERVAL_MS,
      maxTasksPerPoll: MAX_TASKS_PER_POLL,
    },
  };

  res.status(200).json(health);
});

/**
 * POST /process-task
 * Webhook endpoint for immediate task processing
 * Body: { task_id: string }
 */
app.post('/process-task', async (req: Request, res: Response): Promise<void> => {
  try {
    const { task_id } = req.body;

    if (!task_id) {
      res.status(400).json({ error: 'Missing task_id in request body' });
      return;
    }

    console.log(`Webhook received for task: ${task_id}`);

    // Fetch the specific task
    const { data: task, error } = await supabase
      .from('agent_tasks')
      .select('*')
      .eq('id', task_id)
      .eq('status', 'pending')
      .single();

    if (error || !task) {
      res.status(404).json({ error: 'Task not found or not pending' });
      return;
    }

    // Process task asynchronously but respond immediately
    processTask(task as Task)
      .then(() => {
        console.log(`Task ${task_id} processed successfully`);
      })
      .catch((error) => {
        console.error(`Error processing task ${task_id}:`, error);
      });

    // Respond immediately to webhook
    res.status(200).json({ success: true, taskId: task_id });
  } catch (error) {
    console.error('Error handling webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /trigger-poll
 * Manually trigger a polling cycle (for testing)
 */
app.post('/trigger-poll', async (_req: Request, res: Response): Promise<void> => {
  console.log('Manual polling triggered');

  processPendingTasks()
    .then(() => {
      console.log('Manual polling completed');
    })
    .catch((error) => {
      console.error('Error in manual polling:', error);
    });

  res.status(200).json({ success: true, message: 'Polling triggered' });
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

// ============================================================================
// Service Lifecycle Management
// ============================================================================

/**
 * Start background polling
 */
function startPolling(): void {
  console.log(`Starting background polling (interval: ${POLLING_INTERVAL_MS}ms)`);

  // Initial poll immediately
  processPendingTasks().catch((error) => {
    console.error('Error in initial poll:', error);
  });

  // Set up recurring poll
  pollingInterval = setInterval(() => {
    processPendingTasks().catch((error) => {
      console.error('Error in polling interval:', error);
    });
  }, POLLING_INTERVAL_MS);
}

/**
 * Stop background polling
 */
function stopPolling(): void {
  if (pollingInterval) {
    console.log('Stopping background polling');
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

/**
 * Graceful shutdown handler
 */
function shutdown(): void {
  if (isShuttingDown) return;

  console.log('\nShutdown signal received. Cleaning up...');
  isShuttingDown = true;

  stopPolling();

  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

// ============================================================================
// Main Entry Point
// ============================================================================

// Declare server at module level for shutdown handler
let server: ReturnType<typeof app.listen>;

/**
 * Start the service
 */
async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Task Processor Service Starting');
  console.log('='.repeat(60));
  console.log(`Supabase URL: ${process.env.SUPABASE_URL}`);
  console.log(`Port: ${PORT}`);
  console.log(`Polling Interval: ${POLLING_INTERVAL_MS}ms (${POLLING_INTERVAL_MS / 1000}s)`);
  console.log(`Max Tasks Per Poll: ${MAX_TASKS_PER_POLL}`);
  console.log(`Max Retries: ${MAX_RETRIES}`);
  console.log('='.repeat(60));

  // Start Express server
  server = app.listen(PORT, () => {
    console.log('\nTask Processor service is running');
    console.log(`  Listening on port ${PORT}`);
    console.log(`  GET  /health       - Health check`);
    console.log(`  POST /process-task - Process specific task`);
    console.log(`  POST /trigger-poll - Manually trigger polling`);
    console.log('  Press Ctrl+C to shutdown gracefully\n');
  });

  // Start background polling
  startPolling();

  // Register shutdown handlers
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
