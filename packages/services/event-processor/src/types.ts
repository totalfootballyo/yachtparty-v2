/**
 * Type Definitions for Event Processor Service
 *
 * This file defines the core types used by the event processor,
 * including event structures and handler interfaces.
 */

import type { EventType, EventPayload } from '@yachtparty/shared';

/**
 * Event record from database
 */
export interface Event {
  id: string;
  event_type: EventType;
  aggregate_id: string;
  aggregate_type: string;
  payload: EventPayload;
  metadata?: Record<string, unknown>;
  processed: boolean;
  version: number;
  created_at: string;
  created_by: string;
}

/**
 * Event handler function signature
 * Handlers are async functions that process a specific event type
 */
export type EventHandler = (event: Event) => Promise<void>;

/**
 * Event handler registration entry
 */
export interface EventHandlerRegistration {
  eventType: EventType;
  handler: EventHandler;
  description: string;
}

/**
 * Dead letter event record
 */
export interface DeadLetterEvent {
  id?: string;
  event_id: string;
  event_type: EventType;
  payload: EventPayload;
  error_message: string;
  retry_count: number;
  original_created_at: string;
  created_at?: string;
}

/**
 * Event processing statistics
 */
export interface ProcessingStats {
  totalProcessed: number;
  successCount: number;
  errorCount: number;
  deadLetterCount: number;
  startTime: Date;
  lastProcessedAt?: Date;
}

/**
 * Configuration for event processor
 */
export interface ProcessorConfig {
  pollIntervalMs: number;
  batchSize: number;
  maxRetries: number;
  enablePolling: boolean;
}
