-- =====================================================
-- Migration: 009_message_sequences.sql
-- Description: Add message sequence support to message_queue table
-- Date: 2025-10-18
-- Purpose: Architecture simplification - enable multi-message sequences
-- =====================================================

-- Add sequence fields to message_queue table
ALTER TABLE message_queue
  ADD COLUMN sequence_id UUID,
  ADD COLUMN sequence_position INTEGER,
  ADD COLUMN sequence_total INTEGER;

-- Create index for sequence queries
CREATE INDEX idx_queue_sequence ON message_queue(sequence_id, sequence_position)
  WHERE sequence_id IS NOT NULL;

-- Add comments
COMMENT ON COLUMN message_queue.sequence_id IS 'Groups messages that are part of a multi-message sequence';
COMMENT ON COLUMN message_queue.sequence_position IS '1-indexed position within sequence (1, 2, 3, etc.)';
COMMENT ON COLUMN message_queue.sequence_total IS 'Total number of messages in this sequence';

-- Log migration completion
DO $$
BEGIN
  RAISE NOTICE 'Migration 009_message_sequences.sql completed successfully';
  RAISE NOTICE 'Added sequence_id, sequence_position, sequence_total columns to message_queue';
  RAISE NOTICE 'Created index idx_queue_sequence for sequence queries';
END $$;
