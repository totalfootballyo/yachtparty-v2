/**
 * Jest Setup
 *
 * Loads .env.test before running tests.
 * This ensures TEST_DATABASE_URL, SUPABASE_SERVICE_KEY, and ANTHROPIC_API_KEY
 * are available to all test files.
 */

const dotenv = require('dotenv');
const path = require('path');

// Load .env.test file
const result = dotenv.config({ path: path.join(__dirname, '.env.test') });

if (result.error) {
  console.warn('⚠️  Warning: Could not load .env.test file');
  console.warn('   Make sure Testing/.env.test exists with test database credentials');
  console.warn('   Copy Testing/.env.test.example to Testing/.env.test and fill in values');
}

// Verify required environment variables
const required = ['TEST_DATABASE_URL', 'SUPABASE_SERVICE_KEY', 'ANTHROPIC_API_KEY'];
const missing = required.filter(key => !process.env[key]);

if (missing.length > 0) {
  console.error('❌ Missing required environment variables:', missing.join(', '));
  console.error('   Check your Testing/.env.test file');
  process.exit(1);
}

console.log('✅ Test environment loaded');
console.log(`   Database: ${process.env.TEST_DATABASE_URL}`);
console.log(`   API Key: ${process.env.ANTHROPIC_API_KEY?.substring(0, 20)}...`);
