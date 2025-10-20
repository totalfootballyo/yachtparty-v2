#!/usr/bin/env node
/**
 * Database Reset Script
 *
 * WARNING: This will DROP ALL TABLES and data!
 * Use only in development environments.
 *
 * Usage:
 *   node reset.js
 */

require('dotenv').config({ path: '../../.env' });
const { Client } = require('pg');
const readline = require('readline');

class DatabaseResetter {
  constructor() {
    this.client = new Client({
      connectionString: process.env.DATABASE_URL,
    });
  }

  async connect() {
    await this.client.connect();
    console.log('✓ Connected to database');
  }

  async disconnect() {
    await this.client.end();
    console.log('✓ Disconnected from database');
  }

  async dropAllTables() {
    console.log('\n→ Dropping all tables...');

    const tables = [
      // Drop in reverse dependency order
      'community_responses',
      'community_requests',
      'intro_opportunities',
      'credit_events',
      'solution_workflows',
      'user_priorities',
      'agent_actions_log',
      'agent_instances',
      'innovators',
      'prospects',
      'message_queue',
      'user_message_budget',
      'messages',
      'conversations',
      'agent_tasks',
      'events',
      'users',
      'schema_migrations'
    ];

    for (const table of tables) {
      try {
        await this.client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
        console.log(`  ✓ Dropped table: ${table}`);
      } catch (error) {
        console.log(`  ⚠ Could not drop ${table}: ${error.message}`);
      }
    }

    // Drop views
    try {
      await this.client.query('DROP VIEW IF EXISTS user_credit_balances CASCADE');
      console.log('  ✓ Dropped view: user_credit_balances');
    } catch (error) {
      console.log(`  ⚠ Could not drop view: ${error.message}`);
    }

    console.log('✓ All tables dropped');
  }

  async dropAllFunctions() {
    console.log('\n→ Dropping all functions...');

    const functions = [
      'notify_event()',
      'update_user_credit_cache()',
      'check_conversation_summary()',
      'handle_phone_number_change()',
      'notify_send_sms()',
      'process_tasks_batch()',
      'process_outbound_messages()',
      'get_pending_tasks_count()',
      'get_queued_messages_count()'
    ];

    for (const func of functions) {
      try {
        await this.client.query(`DROP FUNCTION IF EXISTS ${func} CASCADE`);
        console.log(`  ✓ Dropped function: ${func}`);
      } catch (error) {
        console.log(`  ⚠ Could not drop ${func}: ${error.message}`);
      }
    }

    console.log('✓ All functions dropped');
  }

  async dropCronJobs() {
    console.log('\n→ Dropping cron jobs...');

    try {
      // Check if pg_cron extension exists
      const { rows } = await this.client.query(
        `SELECT * FROM pg_extension WHERE extname = 'pg_cron'`
      );

      if (rows.length > 0) {
        await this.client.query(`SELECT cron.unschedule('process-agent-tasks')`);
        console.log('  ✓ Unscheduled: process-agent-tasks');

        await this.client.query(`SELECT cron.unschedule('process-message-queue')`);
        console.log('  ✓ Unscheduled: process-message-queue');
      } else {
        console.log('  ⚠ pg_cron extension not installed, skipping');
      }
    } catch (error) {
      console.log(`  ⚠ Could not unschedule cron jobs: ${error.message}`);
    }

    console.log('✓ Cron jobs dropped');
  }

  async reset() {
    await this.dropCronJobs();
    await this.dropAllFunctions();
    await this.dropAllTables();
  }
}

function askConfirmation(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes');
    });
  });
}

async function main() {
  console.log('\n⚠️  WARNING: DATABASE RESET ⚠️');
  console.log('This will DROP ALL TABLES, FUNCTIONS, and DATA!');
  console.log('This action CANNOT be undone!\n');

  const confirmed = await askConfirmation('Type "yes" to continue: ');

  if (!confirmed) {
    console.log('\n✓ Reset cancelled');
    process.exit(0);
  }

  const resetter = new DatabaseResetter();

  try {
    await resetter.connect();

    console.log('\n=== Resetting Database ===');
    await resetter.reset();
    console.log('\n✓ Database reset complete!');
    console.log('\nRun "npm run db:migrate" to recreate schema\n');

    await resetter.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Reset error:', error.message);
    await resetter.disconnect();
    process.exit(1);
  }
}

main();
