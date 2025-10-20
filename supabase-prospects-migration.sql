-- =====================================================
-- Yachtparty Prospects Feature - Database Migration
-- =====================================================
-- This SQL can be pasted directly into Supabase SQL Editor
--
-- Creates:
-- 1. prospects table (staging area for innovator uploads)
-- 2. Helper function for finding matching prospects
-- 3. All necessary indexes
--
-- To apply: Copy and paste this entire file into Supabase SQL Editor and run
-- =====================================================

-- Create prospects table
CREATE TABLE IF NOT EXISTS prospects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Contact Information
  email TEXT,
  phone_number TEXT,
  linkedin_url TEXT,
  first_name TEXT,
  last_name TEXT,
  company TEXT,
  title TEXT,

  -- Upload Metadata
  innovator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  upload_source TEXT, -- 'csv', 'manual', 'linkedin_scrape', etc.
  upload_batch_id UUID, -- Group prospects from same CSV upload

  -- Status Tracking
  status TEXT NOT NULL DEFAULT 'pending',
    -- 'pending': Uploaded, not contacted
    -- 'contacted': Intro attempt made
    -- 'converted': Joined Yachtparty (upgraded to user)
    -- 'declined': Not interested
    -- 'invalid': Bad data (bounced email, etc.)

  converted_to_user_id UUID REFERENCES users(id),
  converted_at TIMESTAMPTZ,

  -- Context & Notes
  prospect_notes TEXT, -- Why this prospect? What's the angle?
  target_solution_categories TEXT[], -- What solutions might interest them?

  -- Metadata
  metadata JSONB, -- Flexible field for additional data
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT at_least_one_contact_method CHECK (
    email IS NOT NULL OR
    phone_number IS NOT NULL OR
    linkedin_url IS NOT NULL
  )
);

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_prospects_email ON prospects(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospects_phone ON prospects(phone_number) WHERE phone_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospects_linkedin ON prospects(linkedin_url) WHERE linkedin_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospects_innovator_id ON prospects(innovator_id);
CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status);
CREATE INDEX IF NOT EXISTS idx_prospects_upload_batch ON prospects(upload_batch_id) WHERE upload_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospects_converted_user ON prospects(converted_to_user_id) WHERE converted_to_user_id IS NOT NULL;

-- Add updated_at trigger (assumes update_updated_at_column function exists)
DROP TRIGGER IF EXISTS update_prospects_updated_at ON prospects;
CREATE TRIGGER update_prospects_updated_at
  BEFORE UPDATE ON prospects
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE prospects IS 'Staging area for potential users uploaded by innovators. Prospects are upgraded to users when they join Yachtparty.';
COMMENT ON COLUMN prospects.email IS 'Prospect email address (at least one contact method required)';
COMMENT ON COLUMN prospects.phone_number IS 'Prospect phone number (at least one contact method required)';
COMMENT ON COLUMN prospects.linkedin_url IS 'Prospect LinkedIn profile URL (at least one contact method required)';
COMMENT ON COLUMN prospects.innovator_id IS 'UUID of the innovator who uploaded this prospect';
COMMENT ON COLUMN prospects.upload_source IS 'Source of upload: csv, manual, linkedin_scrape, etc.';
COMMENT ON COLUMN prospects.upload_batch_id IS 'Groups prospects from same CSV upload for batch tracking';
COMMENT ON COLUMN prospects.status IS 'Prospect status: pending, contacted, converted, declined, invalid';
COMMENT ON COLUMN prospects.converted_to_user_id IS 'User ID if prospect joined Yachtparty';
COMMENT ON COLUMN prospects.prospect_notes IS 'Innovator notes about why this prospect is a good fit';
COMMENT ON COLUMN prospects.target_solution_categories IS 'Array of solution categories that might interest this prospect';

-- Create helper function to find matching prospects
-- Used during user signup to check if user matches any uploaded prospects
CREATE OR REPLACE FUNCTION find_matching_prospects(
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_linkedin TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'pending'
) RETURNS SETOF prospects AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM prospects
  WHERE status = p_status
    AND (
      (p_email IS NOT NULL AND email = p_email) OR
      (p_phone IS NOT NULL AND phone_number = p_phone) OR
      (p_linkedin IS NOT NULL AND linkedin_url = p_linkedin)
    )
  ORDER BY uploaded_at ASC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION find_matching_prospects IS 'Find prospects matching email, phone, or LinkedIn URL. Used for prospect-to-user upgrade flow.';

-- Grant permissions (adjust as needed for your RLS policies)
-- These are safe defaults - you may want to add RLS policies
ALTER TABLE prospects ENABLE ROW LEVEL SECURITY;

-- Policy: Innovators can read their own prospects
DROP POLICY IF EXISTS innovators_read_own_prospects ON prospects;
CREATE POLICY innovators_read_own_prospects ON prospects
  FOR SELECT
  USING (auth.uid() = innovator_id);

-- Policy: Innovators can insert prospects
DROP POLICY IF EXISTS innovators_insert_prospects ON prospects;
CREATE POLICY innovators_insert_prospects ON prospects
  FOR INSERT
  WITH CHECK (auth.uid() = innovator_id);

-- Policy: Innovators can update their own prospects
DROP POLICY IF EXISTS innovators_update_own_prospects ON prospects;
CREATE POLICY innovators_update_own_prospects ON prospects
  FOR UPDATE
  USING (auth.uid() = innovator_id);

-- Policy: Service role can do everything (for backend operations)
DROP POLICY IF EXISTS service_role_all_prospects ON prospects;
CREATE POLICY service_role_all_prospects ON prospects
  FOR ALL
  USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- Verification query: Check that table was created successfully
DO $$
DECLARE
  table_count INTEGER;
  index_count INTEGER;
BEGIN
  -- Check table exists
  SELECT COUNT(*) INTO table_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name = 'prospects';

  -- Check indexes exist
  SELECT COUNT(*) INTO index_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'prospects';

  -- Report results
  RAISE NOTICE '================================================';
  RAISE NOTICE 'Migration completed successfully!';
  RAISE NOTICE '================================================';
  RAISE NOTICE 'Table created: prospects (% found)', table_count;
  RAISE NOTICE 'Indexes created: % indexes', index_count;
  RAISE NOTICE 'Function created: find_matching_prospects()';
  RAISE NOTICE 'RLS policies: 4 policies created';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '1. Test the table: SELECT * FROM prospects LIMIT 1;';
  RAISE NOTICE '2. Test the function: SELECT find_matching_prospects(''test@example.com'');';
  RAISE NOTICE '3. Deploy updated services with prospect upload logic';
  RAISE NOTICE '================================================';
END $$;
