-- =====================================================
-- Migration: 011_community_request_context.sql
-- Description: Add context fields to community_requests for richer expert messaging
-- Date: 2025-10-19
-- =====================================================

// Ran this: Success. No rows returned.

-- Add requester_context column (why they're asking, their situation)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'community_requests'
    AND column_name = 'requester_context'
  ) THEN
    ALTER TABLE community_requests ADD COLUMN requester_context TEXT;
    RAISE NOTICE 'Added requester_context column to community_requests';
  END IF;
END $$;

COMMENT ON COLUMN community_requests.requester_context IS
  'Background on why requester is asking - helps experts understand context (e.g., "evaluating vendors for Q1 rollout", "considering market entry")';

-- Add desired_outcome column (what type of help they want)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'community_requests'
    AND column_name = 'desired_outcome'
  ) THEN
    ALTER TABLE community_requests ADD COLUMN desired_outcome VARCHAR;
    RAISE NOTICE 'Added desired_outcome column to community_requests';
  END IF;
END $$;

COMMENT ON COLUMN community_requests.desired_outcome IS
  'What type of help: backchannel | introduction | quick_thoughts | ongoing_advice';

-- Add urgency column (timeline)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'community_requests'
    AND column_name = 'urgency'
  ) THEN
    ALTER TABLE community_requests ADD COLUMN urgency VARCHAR DEFAULT 'medium';
    RAISE NOTICE 'Added urgency column to community_requests';
  END IF;
END $$;

COMMENT ON COLUMN community_requests.urgency IS
  'Timeline: low (informational) | medium (weeks) | high (days)';

-- Add request_summary column (short description for tactful mentions)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'community_requests'
    AND column_name = 'request_summary'
  ) THEN
    ALTER TABLE community_requests ADD COLUMN request_summary VARCHAR(100);
    RAISE NOTICE 'Added request_summary column to community_requests';
  END IF;
END $$;

COMMENT ON COLUMN community_requests.request_summary IS
  'Short 3-5 word summary for Concierge to mention tactfully (e.g., "CTV advertising guidance")';

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Migration 011_community_request_context.sql completed successfully';
END $$;
