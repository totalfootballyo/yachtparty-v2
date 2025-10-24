-- =====================================================
-- Migration 017: Priority Status Tracking & Presentation Counting
-- Date: October 24, 2025
-- Purpose: Track presentation attempts and manage dormant priorities
-- Related: Appendix E - Priority Status Tracking & Proactive Presentation
-- =====================================================

-- 1. Update intro_opportunities
-- Add presentation tracking fields
ALTER TABLE intro_opportunities
  ADD COLUMN IF NOT EXISTS presentation_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_presented_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dormant_at TIMESTAMPTZ;

-- Ensure status column can handle new values (dormant, clarifying)
ALTER TABLE intro_opportunities
  ALTER COLUMN status TYPE VARCHAR(50);

COMMENT ON COLUMN intro_opportunities.presentation_count IS
  'Number of times shown to connector (dedicated re-engagement or natural mention). 2 = dormant.';
COMMENT ON COLUMN intro_opportunities.last_presented_at IS
  'Most recent presentation timestamp.';
COMMENT ON COLUMN intro_opportunities.dormant_at IS
  'Timestamp when marked dormant (2 presentations, no response).';

-- 2. Update connection_requests
-- Add presentation tracking fields
ALTER TABLE connection_requests
  ADD COLUMN IF NOT EXISTS presentation_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_presented_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dormant_at TIMESTAMPTZ;

-- Ensure status column can handle new values
ALTER TABLE connection_requests
  ALTER COLUMN status TYPE VARCHAR(50);

COMMENT ON COLUMN connection_requests.presentation_count IS
  'Number of times shown to introducee. 2 = dormant.';
COMMENT ON COLUMN connection_requests.last_presented_at IS
  'Most recent presentation timestamp.';
COMMENT ON COLUMN connection_requests.dormant_at IS
  'Timestamp when marked dormant (2 presentations, no response).';

-- 3. Update community_requests
-- Add presentation tracking fields
ALTER TABLE community_requests
  ADD COLUMN IF NOT EXISTS presentation_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_presented_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dormant_at TIMESTAMPTZ;

-- Ensure status column can handle new values
ALTER TABLE community_requests
  ALTER COLUMN status TYPE VARCHAR(50);

COMMENT ON COLUMN community_requests.presentation_count IS
  'Number of times shown to expert. 2 = dormant.';
COMMENT ON COLUMN community_requests.last_presented_at IS
  'Most recent presentation timestamp.';
COMMENT ON COLUMN community_requests.dormant_at IS
  'Timestamp when marked dormant (2 presentations, no response).';

-- 4. Update user_priorities
-- Add presentation_count + denormalized fields for fast loading (NO joins needed in Call 1)
ALTER TABLE user_priorities
  ADD COLUMN IF NOT EXISTS presentation_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS item_summary TEXT,
  ADD COLUMN IF NOT EXISTS item_primary_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS item_secondary_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS item_context TEXT,
  ADD COLUMN IF NOT EXISTS item_metadata JSONB;

COMMENT ON COLUMN user_priorities.presentation_count IS
  'Denormalized from source table. Updated when Account Manager runs.';
COMMENT ON COLUMN user_priorities.item_summary IS
  'One-line summary of the priority (e.g., "Intro Sarah Chen to John at Hulu for content partnerships")';
COMMENT ON COLUMN user_priorities.item_primary_name IS
  'Primary person name (prospect/requestor/expert) for intent matching';
COMMENT ON COLUMN user_priorities.item_secondary_name IS
  'Secondary person name (innovator/connector/requestor) if applicable';
COMMENT ON COLUMN user_priorities.item_context IS
  'Context/reason for the priority (intro_context, question, etc.)';
COMMENT ON COLUMN user_priorities.item_metadata IS
  'Additional fields (bounty, vouches, category, etc.) as JSON';

-- 5. Create indexes for dormancy queries
CREATE INDEX IF NOT EXISTS idx_intro_opportunities_dormant
  ON intro_opportunities (status, dormant_at)
  WHERE status = 'dormant';

CREATE INDEX IF NOT EXISTS idx_connection_requests_dormant
  ON connection_requests (status, dormant_at)
  WHERE status = 'dormant';

CREATE INDEX IF NOT EXISTS idx_community_requests_dormant
  ON community_requests (status, dormant_at)
  WHERE status = 'dormant';

-- 6. Create indexes for presentation tracking
CREATE INDEX IF NOT EXISTS idx_intro_opportunities_presentation
  ON intro_opportunities (connector_user_id, presentation_count, last_presented_at);

CREATE INDEX IF NOT EXISTS idx_connection_requests_presentation
  ON connection_requests (introducee_user_id, presentation_count, last_presented_at);

CREATE INDEX IF NOT EXISTS idx_community_requests_presentation
  ON community_requests (id, presentation_count, last_presented_at);

-- 7. Backfill existing data
-- Set presentation_count = 1 for items that have been actioned (implies they were presented)
-- Use created_at as fallback for last_presented_at since updated_at may not exist

UPDATE intro_opportunities
SET presentation_count = 1,
    last_presented_at = COALESCE(updated_at, created_at)
WHERE status IN ('accepted', 'rejected', 'paused', 'completed', 'cancelled')
  AND presentation_count = 0;

UPDATE connection_requests
SET presentation_count = 1,
    last_presented_at = COALESCE(updated_at, created_at)
WHERE status IN ('accepted', 'rejected', 'completed', 'expired')
  AND presentation_count = 0;

UPDATE community_requests
SET presentation_count = 1,
    last_presented_at = created_at
WHERE status IN ('responses_received', 'closed')
  AND presentation_count = 0;

-- =====================================================
-- Migration complete
-- Next steps:
-- 1. Deploy this migration to test DB and prod DB via console SQL editor
-- 2. Verify new columns exist with \d intro_opportunities, \d connection_requests, \d community_requests, \d user_priorities
-- 3. Verify indexes created with \di
-- 4. Check backfill: SELECT status, presentation_count, count(*) FROM intro_opportunities GROUP BY status, presentation_count;
-- =====================================================

// migration complete for both prod and test databases on 10/24/2025