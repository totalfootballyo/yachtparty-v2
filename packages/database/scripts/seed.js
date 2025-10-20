#!/usr/bin/env node
/**
 * Database Seed Script
 *
 * Seeds the database with test data for development and testing.
 *
 * Usage:
 *   node seed.js
 */

require('dotenv').config({ path: '../../.env' });
const { Client } = require('pg');

class DatabaseSeeder {
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

  async seedUsers() {
    console.log('\n→ Seeding users...');

    const users = [
      {
        phone: '+15551234567',
        firstName: 'Alice',
        lastName: 'Johnson',
        email: 'alice@example.com',
        company: 'TechCorp',
        title: 'VP of Sales',
        verified: true,
        agentType: 'concierge',
        expertise: ['sales', 'enterprise_software', 'b2b'],
        expertConnector: true
      },
      {
        phone: '+15551234568',
        firstName: 'Bob',
        lastName: 'Smith',
        email: 'bob@innovator.com',
        company: 'InnovateCo',
        title: 'CEO',
        verified: true,
        agentType: 'innovator',
        innovator: true,
        expertise: ['product', 'fundraising', 'startups']
      },
      {
        phone: '+15551234569',
        firstName: 'Charlie',
        lastName: 'Brown',
        email: null,
        company: null,
        title: null,
        verified: false,
        agentType: 'bouncer',
        expertise: []
      },
      {
        phone: '+15551234570',
        firstName: 'Diana',
        lastName: 'Prince',
        email: 'diana@consultant.com',
        company: 'Prince Consulting',
        title: 'Principal Consultant',
        verified: true,
        agentType: 'concierge',
        expertise: ['marketing', 'strategy', 'b2b'],
        expertConnector: true
      }
    ];

    for (const user of users) {
      await this.client.query(`
        INSERT INTO users (
          phone_number, first_name, last_name, email, company, title,
          verified, poc_agent_type, innovator, expert_connector, expertise,
          credit_balance, timezone
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (phone_number) DO NOTHING
      `, [
        user.phone, user.firstName, user.lastName, user.email,
        user.company, user.title, user.verified, user.agentType,
        user.innovator || false, user.expertConnector || false,
        user.expertise, 100, 'America/Los_Angeles'
      ]);
    }

    console.log(`✓ Seeded ${users.length} users`);
  }

  async seedInnovators() {
    console.log('\n→ Seeding innovators...');

    // Get Bob's user ID
    const { rows } = await this.client.query(
      `SELECT id FROM users WHERE email = 'bob@innovator.com'`
    );

    if (rows.length === 0) {
      console.log('⚠ Skipping innovators - user not found');
      return;
    }

    const userId = rows[0].id;

    await this.client.query(`
      INSERT INTO innovators (
        user_id, company_name, solution_description, categories,
        target_customer_profile, active, credits_balance
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_id) DO NOTHING
    `, [
      userId,
      'InnovateCo',
      'AI-powered customer engagement platform for enterprise sales teams',
      ['sales_enablement', 'ai', 'enterprise_software'],
      'Enterprise B2B companies with 100+ sales reps',
      true,
      500
    ]);

    console.log('✓ Seeded innovators');
  }

  async seedConversations() {
    console.log('\n→ Seeding conversations...');

    const { rows: users } = await this.client.query(
      `SELECT id, phone_number FROM users WHERE verified = true LIMIT 2`
    );

    if (users.length < 2) {
      console.log('⚠ Skipping conversations - not enough users');
      return;
    }

    for (const user of users) {
      const { rows } = await this.client.query(`
        INSERT INTO conversations (user_id, phone_number, status)
        VALUES ($1, $2, 'active')
        RETURNING id
      `, [user.id, user.phone_number]);

      const conversationId = rows[0].id;

      // Add some messages
      await this.client.query(`
        INSERT INTO messages (conversation_id, user_id, role, content, direction, status)
        VALUES
          ($1, $2, 'user', 'Hi! I''m looking for a CRM solution for my team.', 'inbound', 'delivered'),
          ($1, $2, 'concierge', 'Great! I can help with that. How large is your team?', 'outbound', 'delivered'),
          ($1, $2, 'user', 'We have about 50 sales reps.', 'inbound', 'delivered')
      `, [conversationId, user.id]);
    }

    console.log(`✓ Seeded ${users.length} conversations`);
  }

  async seedCommunityRequests() {
    console.log('\n→ Seeding community requests...');

    const { rows: users } = await this.client.query(
      `SELECT id FROM users WHERE verified = true LIMIT 1`
    );

    if (users.length === 0) {
      console.log('⚠ Skipping community requests - no verified users');
      return;
    }

    const userId = users[0].id;

    await this.client.query(`
      INSERT INTO community_requests (
        requesting_agent_type, requesting_user_id, question,
        category, expertise_needed, status
      ) VALUES (
        'solution_saga',
        $1,
        'Anyone have experience with enterprise CRM implementations for teams of 50+?',
        'sales_enablement',
        ARRAY['sales', 'enterprise_software'],
        'open'
      )
    `, [userId]);

    console.log('✓ Seeded community requests');
  }

  async seedProspects() {
    console.log('\n→ Seeding prospects...');

    await this.client.query(`
      INSERT INTO prospects (name, company, title, linkedin_url)
      VALUES
        ('John Doe', 'BigCorp Inc', 'CTO', 'https://linkedin.com/in/johndoe'),
        ('Jane Smith', 'StartupXYZ', 'VP Engineering', 'https://linkedin.com/in/janesmith')
    `);

    console.log('✓ Seeded prospects');
  }

  async clearAllData() {
    console.log('\n⚠ Clearing existing seed data...');

    // Clear in reverse dependency order
    await this.client.query('DELETE FROM community_responses');
    await this.client.query('DELETE FROM community_requests');
    await this.client.query('DELETE FROM intro_opportunities');
    await this.client.query('DELETE FROM solution_workflows');
    await this.client.query('DELETE FROM user_priorities');
    await this.client.query('DELETE FROM agent_actions_log');
    await this.client.query('DELETE FROM agent_tasks');
    await this.client.query('DELETE FROM credit_events');
    await this.client.query('DELETE FROM message_queue');
    await this.client.query('DELETE FROM messages');
    await this.client.query('DELETE FROM conversations');
    await this.client.query('DELETE FROM innovators');
    await this.client.query('DELETE FROM prospects');
    await this.client.query('DELETE FROM events');
    await this.client.query('DELETE FROM users');

    console.log('✓ Cleared existing data');
  }

  async seed() {
    await this.clearAllData();
    await this.seedUsers();
    await this.seedInnovators();
    await this.seedConversations();
    await this.seedCommunityRequests();
    await this.seedProspects();
  }
}

async function main() {
  const seeder = new DatabaseSeeder();

  try {
    await seeder.connect();

    console.log('\n=== Seeding Database ===');
    await seeder.seed();
    console.log('\n✓ Database seeded successfully!\n');

    await seeder.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Seeding error:', error.message);
    await seeder.disconnect();
    process.exit(1);
  }
}

main();
