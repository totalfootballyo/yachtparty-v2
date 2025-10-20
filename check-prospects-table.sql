-- Check current state of prospects table
-- Run this to see what we're working with

-- Check if table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables
  WHERE table_schema = 'public'
  AND table_name = 'prospects'
) AS table_exists;

-- If table exists, show its columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'prospects'
ORDER BY ordinal_position;
