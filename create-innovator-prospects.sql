-- =====================================================
-- CREATE INNOVATOR_PROSPECTS TABLE
-- =====================================================
-- Separate table for prospects uploaded by innovators
-- (keeps existing 'prospects' table for LinkedIn research)
-- =====================================================

-- Create innovator_prospects table
CREATE TABLE IF NOT EXISTS innovator_prospects (
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

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_innovator_prospects_email ON innovator_prospects(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_innovator_prospects_phone ON innovator_prospects(phone_number) WHERE phone_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_innovator_prospects_linkedin ON innovator_prospects(linkedin_url) WHERE linkedin_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_innovator_prospects_innovator_id ON innovator_prospects(innovator_id);
CREATE INDEX IF NOT EXISTS idx_innovator_prospects_status ON innovator_prospects(status);
CREATE INDEX IF NOT EXISTS idx_innovator_prospects_upload_batch ON innovator_prospects(upload_batch_id) WHERE upload_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_innovator_prospects_converted_user ON innovator_prospects(converted_to_user_id) WHERE converted_to_user_id IS NOT NULL;

-- Add updated_at trigger
DROP TRIGGER IF EXISTS update_innovator_prospects_updated_at ON innovator_prospects;
CREATE TRIGGER update_innovator_prospects_updated_at
  BEFORE UPDATE ON innovator_prospects
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Create helper function
CREATE OR REPLACE FUNCTION find_matching_innovator_prospects(
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_linkedin TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'pending'
) RETURNS SETOF innovator_prospects AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM innovator_prospects
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
ALTER TABLE innovator_prospects ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS innovators_read_own_prospects ON innovator_prospects;
CREATE POLICY innovators_read_own_prospects ON innovator_prospects
  FOR SELECT
  USING (auth.uid() = innovator_id);

DROP POLICY IF EXISTS innovators_insert_prospects ON innovator_prospects;
CREATE POLICY innovators_insert_prospects ON innovator_prospects
  FOR INSERT
  WITH CHECK (auth.uid() = innovator_id);

DROP POLICY IF EXISTS innovators_update_own_prospects ON innovator_prospects;
CREATE POLICY innovators_update_own_prospects ON innovator_prospects
  FOR UPDATE
  USING (auth.uid() = innovator_id);

DROP POLICY IF EXISTS service_role_all_prospects ON innovator_prospects;
CREATE POLICY service_role_all_prospects ON innovator_prospects
  FOR ALL
  USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- Verify
SELECT 'Table created successfully!' AS status;
SELECT COUNT(*) AS column_count FROM information_schema.columns
WHERE table_name = 'innovator_prospects';
