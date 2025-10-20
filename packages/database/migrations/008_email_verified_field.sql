-- =====================================================
-- Yachtparty Email Verification Field Migration
-- File: 008_email_verified_field.sql
-- Description: Separates email verification from full network approval
-- =====================================================

-- Add email_verified column to users table
-- This tracks whether the user's email has been verified via the verification webhook
-- Separate from 'verified' which indicates full approval into the network
ALTER TABLE users
  ADD COLUMN email_verified BOOLEAN DEFAULT FALSE;

-- Add index for filtering by email verification status
CREATE INDEX idx_users_email_verified ON users(email_verified);

-- Add comments for documentation
COMMENT ON COLUMN users.email_verified IS 'TRUE when user has verified their email address via verify-{user_id}@verify.yachtparty.xyz. Does not indicate full network approval (see verified field).';
COMMENT ON COLUMN users.verified IS 'TRUE when user is fully approved into the network and transitioned to Concierge agent. Set manually or by approval process after email_verified is true.';

-- Log migration completion
DO $$
BEGIN
  RAISE NOTICE 'Migration 008_email_verified_field.sql completed successfully';
  RAISE NOTICE 'Added column: users.email_verified';
  RAISE NOTICE 'Created index: idx_users_email_verified';
END $$;
