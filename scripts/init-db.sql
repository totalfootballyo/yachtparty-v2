-- Database Initialization Script for Yachtparty
-- Sets up pg_cron extension and other required PostgreSQL extensions

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- For text search
CREATE EXTENSION IF NOT EXISTS "pg_cron";  -- For scheduled jobs

-- Grant permissions on cron schema
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- Log successful initialization
DO $$
BEGIN
  RAISE NOTICE 'Yachtparty database initialized successfully';
  RAISE NOTICE 'Extensions enabled: uuid-ossp, pg_trgm, pg_cron';
END $$;
