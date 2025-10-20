/**
 * Message Orchestrator HTTP Server
 *
 * Wraps the MessageOrchestrator class with an HTTP interface for Cloud Run deployment.
 *
 * Endpoints:
 * - POST /schedule-message: Queue a message for delivery
 * - GET /health: Health check endpoint
 *
 * Background: Runs processDueMessages() every 30 seconds
 */

import express, { Request, Response } from 'express';
import { MessageOrchestrator, QueueMessageParams } from './index';

const app = express();
app.use(express.json());

// Initialize orchestrator
const orchestrator = new MessageOrchestrator();

/**
 * Health check endpoint
 */
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    service: 'message-orchestrator',
    timestamp: new Date().toISOString()
  });
});

/**
 * Schedule a message for delivery
 * POST /schedule-message
 */
app.post('/schedule-message', async (req: Request, res: Response) => {
  try {
    const params: QueueMessageParams = req.body;

    // Validate required fields
    if (!params.userId || !params.agentId || !params.messageData || !params.priority) {
      return res.status(400).json({
        error: 'Missing required fields: userId, agentId, messageData, priority'
      });
    }

    const messageId = await orchestrator.queueMessage(params);

    res.status(200).json({
      success: true,
      messageId
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
 * Background processor
 * Runs every 30 seconds to process due messages
 */
async function processQueue() {
  try {
    console.log('Processing message queue...');
    await orchestrator.processDueMessages();
    console.log('Queue processing complete');
  } catch (error) {
    console.error('Error processing queue:', error);
  }
}

// Start background processor
setInterval(processQueue, 30000); // Every 30 seconds
console.log('Background processor started (30s interval)');

// Start server
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Message Orchestrator server listening on port ${port}`);

  // Run initial queue processing
  processQueue().catch(console.error);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});
