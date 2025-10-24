-- Phase 3.4 Schema Additions
-- Adds missing columns needed by Account Manager prioritization logic

-- Add connection_strength to intro_opportunities
-- This tracks how strong the LinkedIn connection is between connector and prospect
ALTER TABLE intro_opportunities
ADD COLUMN IF NOT EXISTS connection_strength VARCHAR(50) DEFAULT 'unknown';

COMMENT ON COLUMN intro_opportunities.connection_strength IS
'LinkedIn connection strength: first_degree, second_degree, third_degree, or unknown';

-- Add content to user_priorities
-- Human-readable description of why this is a priority
ALTER TABLE user_priorities
ADD COLUMN IF NOT EXISTS content TEXT;

COMMENT ON COLUMN user_priorities.content IS
'Human-readable description of the priority (e.g., "Intro opportunity: Connect Sarah at Acme to John")';

-- Add metadata to user_priorities
-- Additional structured data about the priority item
ALTER TABLE user_priorities
ADD COLUMN IF NOT EXISTS metadata JSONB;

COMMENT ON COLUMN user_priorities.metadata IS
'Additional structured data about the priority item (prospect name, bounty, etc.)';

-- Create index on connection_strength for filtering
CREATE INDEX IF NOT EXISTS idx_intro_opportunities_connection_strength
ON intro_opportunities(connection_strength)
WHERE status = 'open';


/// both prod and test dbs have been migrated

