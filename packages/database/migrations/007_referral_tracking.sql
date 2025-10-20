-- =====================================================
-- Yachtparty Referral Tracking Migration
-- File: 007_referral_tracking.sql
-- Description: Adds referral tracking fields to users table
-- =====================================================

-- Add referral tracking columns to users table
ALTER TABLE users
  ADD COLUMN referred_by UUID REFERENCES users(id),
  ADD COLUMN name_dropped VARCHAR(255);

-- Add index for referral lookups
CREATE INDEX idx_users_referred_by ON users(referred_by);

-- Add comments for documentation
COMMENT ON COLUMN users.referred_by IS 'UUID of the user who referred this user (if referred by existing user)';
COMMENT ON COLUMN users.name_dropped IS 'Raw name string provided by user during onboarding if referrer cannot be matched to existing user';

-- Log migration completion
DO $$
BEGIN
  RAISE NOTICE 'Migration 007_referral_tracking.sql completed successfully';
  RAISE NOTICE 'Added columns: users.referred_by, users.name_dropped';
  RAISE NOTICE 'Created index: idx_users_referred_by';
END $$;
