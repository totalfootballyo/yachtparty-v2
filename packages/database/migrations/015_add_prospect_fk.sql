-- Add Foreign Key Constraint for intro_opportunities.prospect_id
-- Business requirement: Every intro_opportunity MUST have a valid prospect

-- Add FK constraint with RESTRICT delete
-- This PREVENTS hard deletion of prospects if intro_opportunities exist
-- Enforces soft-delete pattern: prospects should be marked as 'deleted' status instead
ALTER TABLE intro_opportunities
ADD CONSTRAINT intro_opportunities_prospect_id_fkey
FOREIGN KEY (prospect_id)
REFERENCES prospects(id)
ON DELETE RESTRICT;

COMMENT ON CONSTRAINT intro_opportunities_prospect_id_fkey ON intro_opportunities IS
'FK to prospects table. RESTRICT delete: prevents hard deletion of prospects with intro opportunities. Use soft-delete (status=deleted) instead.';

-- Implementation notes for prospect deletion:
-- When innovator removes a prospect from their list:
--   1. Set prospects.status = 'deleted' (soft delete)
--   2. Cancel open intro_opportunities: UPDATE status = 'cancelled' WHERE prospect_id = X AND status IN ('open', 'pending')
--   3. Preserve accepted/completed intro_opportunities for historical record
--
-- When prospect converts to user:
--   1. Set prospects.status = 'converted' (already implemented in prospect-upgrade.ts)
--   2. Keep prospect record for intro_opportunities to reference
--   3. Create new intro_opportunities for the converted user


// migration completed 10/24/2025
