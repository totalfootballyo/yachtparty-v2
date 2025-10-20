-- =====================================================
-- MANUAL DATABASE MIGRATIONS
-- Run these in Supabase Dashboard SQL Editor
-- =====================================================
--
-- Instructions:
-- 1. Go to https://supabase.com/dashboard/project/YOUR_PROJECT/sql
-- 2. Copy this entire file
-- 3. Paste into SQL Editor
-- 4. Click "Run" button
-- 5. Verify success messages appear
--
-- =====================================================

-- =====================================================
-- MIGRATION 1: event_dead_letters table
-- Purpose: Dead letter queue for events that failed after max retries
-- =====================================================

CREATE TABLE IF NOT EXISTS event_dead_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Original event information
  event_id UUID NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,

  -- Failure information
  error_message TEXT NOT NULL,
  retry_count INTEGER NOT NULL,

  -- Timestamps
  original_created_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for event_dead_letters table
CREATE INDEX IF NOT EXISTS idx_dead_letters_event_id ON event_dead_letters(event_id);
CREATE INDEX IF NOT EXISTS idx_dead_letters_event_type ON event_dead_letters(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dead_letters_created ON event_dead_letters(created_at DESC);

COMMENT ON TABLE event_dead_letters IS 'Dead letter queue for events that failed processing after max retries';
COMMENT ON COLUMN event_dead_letters.event_id IS 'Original event ID from events table for traceability';
COMMENT ON COLUMN event_dead_letters.error_message IS 'Last error message that caused failure';
COMMENT ON COLUMN event_dead_letters.retry_count IS 'Number of retry attempts before moving to dead letter queue';
COMMENT ON COLUMN event_dead_letters.original_created_at IS 'When the original event was created';

-- =====================================================
-- MIGRATION 2: increment_message_budget function
-- Purpose: Atomically increment user message count for rate limiting
-- =====================================================

CREATE OR REPLACE FUNCTION increment_message_budget(p_user_id UUID, p_date DATE)
RETURNS VOID AS $$
BEGIN
  INSERT INTO user_message_budget (user_id, date, messages_sent, last_message_at, created_at)
  VALUES (p_user_id, p_date, 1, NOW(), NOW())
  ON CONFLICT (user_id, date)
  DO UPDATE SET
    messages_sent = user_message_budget.messages_sent + 1,
    last_message_at = NOW(),
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION increment_message_budget IS 'Atomically increment daily message count for rate limiting';

-- =====================================================
-- VERIFICATION QUERIES
-- Run these to verify migrations succeeded
-- =====================================================

-- Check event_dead_letters table exists
SELECT
  table_name,
  table_type
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'event_dead_letters';

-- Check event_dead_letters indexes
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'event_dead_letters';

-- Check increment_message_budget function exists
SELECT
  routine_name,
  routine_type,
  data_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'increment_message_budget';

-- =====================================================
-- TEST QUERIES (Optional)
-- Test the migrations work correctly
-- =====================================================

-- Test 1: Insert test record into event_dead_letters
INSERT INTO event_dead_letters (
  event_id,
  event_type,
  payload,
  error_message,
  retry_count,
  original_created_at
) VALUES (
  gen_random_uuid(),
  'test.event',
  '{"test": true}'::jsonb,
  'Test error message',
  5,
  NOW()
)
RETURNING id, event_type, created_at;

-- Test 2: Test increment_message_budget function
-- (Replace with actual user_id from your users table)
-- SELECT increment_message_budget('your-user-id-here'::uuid, CURRENT_DATE);

-- View test record
SELECT * FROM event_dead_letters WHERE event_type = 'test.event';

-- Clean up test record
DELETE FROM event_dead_letters WHERE event_type = 'test.event';

-- =====================================================
-- COMPLETION MESSAGE
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '✅ All migrations completed successfully!';
  RAISE NOTICE '   - event_dead_letters table created';
  RAISE NOTICE '   - increment_message_budget function created';
  RAISE NOTICE '   ';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '   1. Deploy event-processor service';
  RAISE NOTICE '   2. Deploy task-processor service';
  RAISE NOTICE '   3. Test end-to-end message flow';
END $$;
