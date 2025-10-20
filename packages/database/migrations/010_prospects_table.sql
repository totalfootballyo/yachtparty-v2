-- =====================================================
-- Yachtparty Prospects Table Migration
-- File: 010_prospects_table.sql
-- Description: Creates prospects table for innovator user uploads
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

-- Add updated_at trigger
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

-- Create helper function to check for matching prospects
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

-- Log migration completion
DO $$
BEGIN
  RAISE NOTICE 'Migration 010_prospects_table.sql completed successfully';
  RAISE NOTICE 'Created table: prospects';
  RAISE NOTICE 'Created indexes: idx_prospects_email, idx_prospects_phone, idx_prospects_linkedin, idx_prospects_innovator_id, idx_prospects_status, idx_prospects_upload_batch, idx_prospects_converted_user';
  RAISE NOTICE 'Created trigger: update_prospects_updated_at';
  RAISE NOTICE 'Created function: find_matching_prospects()';
END $$;
