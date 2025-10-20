-- =====================================================
-- Dead Letter Queue for Failed Events
-- File: 006_event_dead_letters.sql
-- Description: Table for events that failed processing after max retries
-- =====================================================

-- =====================================================
-- TABLE: event_dead_letters
-- Description: Dead letter queue for events that failed after max retries
-- =====================================================

CREATE TABLE IF NOT EXISTS event_dead_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Original event information
  event_id UUID NOT NULL, -- Original event ID from events table
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,

  -- Failure information
  error_message TEXT NOT NULL,
  retry_count INTEGER NOT NULL,

  -- Timestamps
  original_created_at TIMESTAMPTZ NOT NULL, -- When original event was created
  created_at TIMESTAMPTZ DEFAULT now() -- When moved to dead letter queue
);

-- Indexes for event_dead_letters table
CREATE INDEX idx_dead_letters_event_id ON event_dead_letters(event_id);
CREATE INDEX idx_dead_letters_event_type ON event_dead_letters(event_type, created_at DESC);
CREATE INDEX idx_dead_letters_created ON event_dead_letters(created_at DESC);

COMMENT ON TABLE event_dead_letters IS 'Dead letter queue for events that failed processing after max retries';
COMMENT ON COLUMN event_dead_letters.event_id IS 'Original event ID from events table for traceability';
COMMENT ON COLUMN event_dead_letters.error_message IS 'Last error message that caused failure';
COMMENT ON COLUMN event_dead_letters.retry_count IS 'Number of retry attempts before moving to dead letter queue';
COMMENT ON COLUMN event_dead_letters.original_created_at IS 'When the original event was created';

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE 'Migration 006_event_dead_letters.sql completed successfully';
  RAISE NOTICE 'Created table: event_dead_letters';
  RAISE NOTICE 'Created indexes for efficient querying';
END $$;
