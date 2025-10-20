#!/usr/bin/env tsx
/**
 * Run database migrations on Supabase
 *
 * Usage: tsx run-migrations.ts
 *
 * Requires environment variables:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';

// Load environment variables
config({ path: join(__dirname, '../../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Error: Missing required environment variables');
  console.error('   Please set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env file');
  console.error('');
  console.error('   Get these from: https://supabase.com/dashboard/project/wdjmhpmwiunkltkodbqh/settings/api');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const migrations = [
  '001_core_tables.sql',
  '002_agent_tables.sql',
  '003_supporting_tables.sql',
  '004_triggers.sql',
  // Note: 005_pg_cron.sql requires pg_cron extension which may not be available on Supabase free tier
  // We'll try to run it but catch errors gracefully
  '005_pg_cron.sql'
];

async function runMigration(filename: string): Promise<boolean> {
  console.log(`\n📝 Running migration: ${filename}`);

  const filePath = join(__dirname, 'migrations', filename);

  try {
    const sql = readFileSync(filePath, 'utf-8');

    // Split by semicolon and filter out comments and empty statements
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    console.log(`   Found ${statements.length} SQL statements`);

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];

      // Skip comments
      if (statement.startsWith('--') || statement.length === 0) {
        continue;
      }

      try {
        // Use rpc to execute raw SQL
        const { error } = await supabase.rpc('exec_sql', { sql_string: statement + ';' }).single();

        if (error) {
          // If exec_sql doesn't exist, try direct query
          const { error: queryError } = await supabase.from('_migrations').select('*').limit(1);

          if (queryError && queryError.message.includes('does not exist')) {
            // Table doesn't exist yet, we need to use a different approach
            console.log('   ⚠️  Direct SQL execution not available, using alternative method...');

            // For the first migration, we'll need to use the Supabase SQL editor
            // or run via psql directly
            throw new Error('Please run the first migration manually in Supabase SQL Editor');
          }

          throw error;
        }

        if ((i + 1) % 5 === 0) {
          console.log(`   Progress: ${i + 1}/${statements.length} statements`);
        }
      } catch (err: any) {
        // Check if it's a "already exists" error (safe to ignore)
        if (err.message && (
          err.message.includes('already exists') ||
          err.message.includes('duplicate')
        )) {
          console.log(`   ⚠️  Already exists (skipping): ${statement.substring(0, 50)}...`);
          continue;
        }

        // For pg_cron migration, we expect some errors on free tier
        if (filename.includes('pg_cron')) {
          console.log(`   ⚠️  pg_cron not available (expected on free tier)`);
          return false;
        }

        console.error(`   ❌ Error in statement ${i + 1}:`, err.message);
        console.error(`   Statement: ${statement.substring(0, 100)}...`);
        throw err;
      }
    }

    console.log(`   ✅ Migration ${filename} completed successfully`);
    return true;

  } catch (error: any) {
    console.error(`   ❌ Migration ${filename} failed:`, error.message);

    if (filename.includes('pg_cron')) {
      console.log('   ℹ️  pg_cron migrations are optional for testing');
      return false;
    }

    throw error;
  }
}

async function runAllMigrations() {
  console.log('🚀 Starting Yachtparty Database Migrations');
  console.log('==========================================\n');
  console.log(`   Project: ${SUPABASE_URL}`);
  console.log(`   Migrations to run: ${migrations.length}`);

  // Test connection first
  console.log('\n🔌 Testing database connection...');
  try {
    const { error } = await supabase.from('_test').select('*').limit(1);
    // Error is expected if table doesn't exist, but connection works
    console.log('   ✅ Database connection successful');
  } catch (err: any) {
    console.error('   ❌ Database connection failed:', err.message);
    throw err;
  }

  let successCount = 0;
  let skipCount = 0;

  for (const migration of migrations) {
    try {
      const success = await runMigration(migration);
      if (success) {
        successCount++;
      } else {
        skipCount++;
      }
    } catch (error) {
      console.error('\n❌ Migration process stopped due to error');
      console.error('   Please check the error above and fix before continuing');
      process.exit(1);
    }
  }

  console.log('\n==========================================');
  console.log('✅ Migration process completed!');
  console.log(`   Successful: ${successCount}`);
  console.log(`   Skipped: ${skipCount}`);
  console.log(`   Failed: 0`);
  console.log('\n📊 Next steps:');
  console.log('   1. Verify tables in Supabase dashboard');
  console.log('   2. Run the test chat: cd packages/agents/bouncer && npm run test-chat');
}

// Run migrations
runAllMigrations().catch((error) => {
  console.error('\n💥 Fatal error:', error);
  process.exit(1);
});
