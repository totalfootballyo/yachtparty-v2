-- =====================================================
-- RENAME LINKEDIN RESEARCH TABLE & CREATE PROSPECTS
-- =====================================================
-- Step 1: Rename existing 'prospects' to 'linkedin_research_prospects'
-- Step 2: Create new 'prospects' table for innovator uploads
-- =====================================================

-- Step 1: Rename the existing LinkedIn research table
ALTER TABLE IF EXISTS prospects
  RENAME TO linkedin_research_prospects;

-- Rename all indexes for linkedin_research_prospects
ALTER INDEX IF EXISTS prospects_pkey
  RENAME TO linkedin_research_prospects_pkey;

-- Drop any indexes that might conflict with new prospects table
DROP INDEX IF EXISTS idx_prospects_email;
DROP INDEX IF EXISTS idx_prospects_phone;
DROP INDEX IF EXISTS idx_prospects_linkedin;
DROP INDEX IF EXISTS idx_prospects_innovator_id;
DROP INDEX IF EXISTS idx_prospects_status;
DROP INDEX IF EXISTS idx_prospects_upload_batch;
DROP INDEX IF EXISTS idx_prospects_converted_user;

-- Create update_updated_at_column function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Create the new prospects table for innovator uploads
CREATE TABLE prospects (
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
  upload_source TEXT,
  upload_batch_id UUID,

  -- Status Tracking
  status TEXT NOT NULL DEFAULT 'pending',
  converted_to_user_id UUID REFERENCES users(id),
  converted_at TIMESTAMPTZ,

  -- Context & Notes
  prospect_notes TEXT,
  target_solution_categories TEXT[],

  -- Metadata
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT at_least_one_contact_method CHECK (
    email IS NOT NULL OR
    phone_number IS NOT NULL OR
    linkedin_url IS NOT NULL
  )
);

-- Create indexes for prospects
CREATE INDEX idx_prospects_email ON prospects(email) WHERE email IS NOT NULL;
CREATE INDEX idx_prospects_phone ON prospects(phone_number) WHERE phone_number IS NOT NULL;
CREATE INDEX idx_prospects_linkedin ON prospects(linkedin_url) WHERE linkedin_url IS NOT NULL;
CREATE INDEX idx_prospects_innovator_id ON prospects(innovator_id);
CREATE INDEX idx_prospects_status ON prospects(status);
CREATE INDEX idx_prospects_upload_batch ON prospects(upload_batch_id) WHERE upload_batch_id IS NOT NULL;
CREATE INDEX idx_prospects_converted_user ON prospects(converted_to_user_id) WHERE converted_to_user_id IS NOT NULL;

-- Add updated_at trigger
CREATE TRIGGER update_prospects_updated_at
  BEFORE UPDATE ON prospects
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Create helper function
CREATE OR REPLACE FUNCTION find_matching_prospects(
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_linkedin TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'pending'
) RETURNS SETOF prospects AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM prospects
  WHERE status = p_status
    AND (
      (p_email IS NOT NULL AND email = p_email) OR
      (p_phone IS NOT NULL AND phone_number = p_phone) OR
      (p_linkedin IS NOT NULL AND linkedin_url = p_linkedin)
    )
  ORDER BY uploaded_at ASC;
END;
$$ LANGUAGE plpgsql;

-- Enable RLS
ALTER TABLE prospects ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY innovators_read_own_prospects ON prospects
  FOR SELECT
  USING (auth.uid() = innovator_id);

CREATE POLICY innovators_insert_prospects ON prospects
  FOR INSERT
  WITH CHECK (auth.uid() = innovator_id);

CREATE POLICY innovators_update_own_prospects ON prospects
  FOR UPDATE
  USING (auth.uid() = innovator_id);

CREATE POLICY service_role_all_prospects ON prospects
  FOR ALL
  USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- Verify
SELECT 'Migration completed successfully!' AS status;
SELECT 'Old prospects table renamed to: linkedin_research_prospects' AS step_1;
SELECT 'New prospects table created for innovator uploads' AS step_2;
SELECT COUNT(*) AS column_count FROM information_schema.columns WHERE table_name = 'prospects';
