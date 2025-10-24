-- Harmonize intro_opportunities name fields with prospects table
-- Business requirement: Consistent schema between prospects and intro_opportunities
--
-- Changes:
-- 1. Add first_name and last_name columns (matching prospects table)
-- 2. Remove prospect_name column (denormalized single field)
--
-- Prerequisites: DELETE all intro_opportunities records before running
-- (No prod data exists, test data will be regenerated)

-- Add structured name columns
ALTER TABLE intro_opportunities
ADD COLUMN first_name VARCHAR(255),
ADD COLUMN last_name VARCHAR(255);

-- Drop denormalized prospect_name column
ALTER TABLE intro_opportunities
DROP COLUMN prospect_name;

-- Add NOT NULL constraints after columns exist
ALTER TABLE intro_opportunities
ALTER COLUMN first_name SET NOT NULL,
ALTER COLUMN last_name SET NOT NULL;

COMMENT ON COLUMN intro_opportunities.first_name IS 'Prospect first name - matches prospects.first_name schema';
COMMENT ON COLUMN intro_opportunities.last_name IS 'Prospect last name - matches prospects.last_name schema';

-- Note: This harmonizes the schema to prevent future errors where code must
-- remember to use "prospect_name" in intro_opportunities vs "first_name + last_name"
-- in prospects table. Now both tables use the same naming structure.

// migration completed in both prod and test dbs on 10/24/2025
