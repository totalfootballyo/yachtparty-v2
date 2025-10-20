#!/usr/bin/env node
/**
 * Database Migration Script
 *
 * Runs SQL migration files in order to set up the Yachtparty database schema.
 *
 * Usage:
 *   node migrate.js          - Run all pending migrations
 *   node migrate.js up       - Run all pending migrations
 *   node migrate.js down     - Rollback last migration
 */

require('dotenv').config({ path: '../../.env' });
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '../migrations');
const MIGRATIONS_TABLE = 'schema_migrations';

class MigrationRunner {
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

  async ensureMigrationsTable() {
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    console.log(`✓ Migrations table ready`);
  }

  async getExecutedMigrations() {
    const result = await this.client.query(
      `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY name`
    );
    return result.rows.map(row => row.name);
  }

  async getPendingMigrations() {
    const executed = await this.getExecutedMigrations();
    const allFiles = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    return allFiles.filter(file => !executed.includes(file));
  }

  async runMigration(filename) {
    const filePath = path.join(MIGRATIONS_DIR, filename);
    const sql = fs.readFileSync(filePath, 'utf8');

    console.log(`\n→ Running migration: ${filename}`);

    try {
      // Start transaction
      await this.client.query('BEGIN');

      // Execute migration SQL
      await this.client.query(sql);

      // Record migration
      await this.client.query(
        `INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES ($1)`,
        [filename]
      );

      // Commit transaction
      await this.client.query('COMMIT');

      console.log(`✓ Migration completed: ${filename}`);
      return true;
    } catch (error) {
      // Rollback on error
      await this.client.query('ROLLBACK');
      console.error(`✗ Migration failed: ${filename}`);
      console.error(error.message);
      return false;
    }
  }

  async migrateUp() {
    const pending = await this.getPendingMigrations();

    if (pending.length === 0) {
      console.log('\n✓ No pending migrations');
      return true;
    }

    console.log(`\nFound ${pending.length} pending migration(s):`);
    pending.forEach(m => console.log(`  - ${m}`));

    for (const migration of pending) {
      const success = await this.runMigration(migration);
      if (!success) {
        console.error('\n✗ Migration process stopped due to error');
        return false;
      }
    }

    console.log('\n✓ All migrations completed successfully!');
    return true;
  }

  async migrateDown() {
    const executed = await this.getExecutedMigrations();

    if (executed.length === 0) {
      console.log('\n✓ No migrations to rollback');
      return true;
    }

    const lastMigration = executed[executed.length - 1];
    console.log(`\n→ Rolling back migration: ${lastMigration}`);
    console.warn('⚠ WARNING: This will DROP tables/triggers created by this migration!');

    // Note: For production, you'd want to create separate down migration files
    // For now, we'll just remove the migration record
    console.log('⚠ Automatic rollback not implemented - manual intervention required');
    console.log('   To rollback, manually drop the affected tables/functions and run:');
    console.log(`   DELETE FROM ${MIGRATIONS_TABLE} WHERE name = '${lastMigration}';`);

    return false;
  }

  async showStatus() {
    const executed = await this.getExecutedMigrations();
    const pending = await this.getPendingMigrations();

    console.log('\n=== Migration Status ===\n');

    if (executed.length > 0) {
      console.log('Executed migrations:');
      executed.forEach(m => console.log(`  ✓ ${m}`));
    } else {
      console.log('No executed migrations');
    }

    console.log('');

    if (pending.length > 0) {
      console.log('Pending migrations:');
      pending.forEach(m => console.log(`  ○ ${m}`));
    } else {
      console.log('No pending migrations');
    }

    console.log('');
  }
}

async function main() {
  const command = process.argv[2] || 'up';

  const runner = new MigrationRunner();

  try {
    await runner.connect();
    await runner.ensureMigrationsTable();

    switch (command) {
      case 'up':
        await runner.migrateUp();
        break;
      case 'down':
        await runner.migrateDown();
        break;
      case 'status':
        await runner.showStatus();
        break;
      default:
        console.error(`Unknown command: ${command}`);
        console.log('Usage: node migrate.js [up|down|status]');
        process.exit(1);
    }

    await runner.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Migration error:', error.message);
    await runner.disconnect();
    process.exit(1);
  }
}

main();
