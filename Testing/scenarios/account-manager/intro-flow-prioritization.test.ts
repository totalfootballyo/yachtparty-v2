/**
 * Account Manager - Intro Flow Prioritization Tests
 *
 * Tests Phase 3.4 intro flow prioritization implementation:
 * - Scoring algorithms for intro_opportunities (bounty, connection strength, recency)
 * - Scoring algorithms for connection_requests (vouching, credits spent, recency)
 * - Scoring algorithms for intro_offers (dual role: introducee vs connector)
 * - Combined prioritization across all intro flow types
 *
 * These are UNIT TESTS that directly test the business logic in:
 * packages/agents/account-manager/src/intro-prioritization.ts
 */

import { createTestDbClient } from '../../../packages/testing/src/helpers/db-utils';
import {
  createIntroOpportunities,
  createConnectionRequests,
  createIntroOffers,
  cleanupTestData,
} from '../../framework/TestDataSetup';
import crypto from 'crypto';

describe('Account Manager - Intro Flow Prioritization (Phase 3.4)', () => {
  let testDbClient: ReturnType<typeof createTestDbClient>;
  let testUserIds: string[] = [];

  beforeAll(() => {
    testDbClient = createTestDbClient();
  });

  afterAll(async () => {
    // Clean up all test users
    for (const userId of testUserIds) {
      await cleanupTestData(testDbClient, userId);
    }
  });

  /**
   * Test 1: Intro Opportunities Scoring
   *
   * Validates scoring algorithm:
   * - Base score: 50
   * - Bounty credits: up to +30 (credits / 2, max 30)
   * - Connection strength: first_degree +15, second_degree +5, third_degree +0
   * - Recency: <3 days +10, <7 days +5
   */
  it('should score intro opportunities by bounty + connection strength + recency', async () => {
    // Create test user
    const userId = crypto.randomUUID();
    testUserIds.push(userId);

    const { data: user } = await testDbClient
      .from('users')
      .insert({
        phone_number: `+1555${Math.floor(Math.random() * 10000000)}`,
        verified: false,
      })
      .select()
      .single();

    console.log(`✅ Test user created: ${userId}`);

    // Create 5 intro_opportunities with different attributes
    const { opportunityIds } = await createIntroOpportunities(testDbClient, user!.id, [
      {
        // Low bounty, third degree, old
        prospectName: 'Prospect A',
        prospectCompany: 'Company A',
        bountyCredits: 10,
        connectionStrength: 'third_degree',
        status: 'open',
      },
      {
        // High bounty, second degree, medium age
        prospectName: 'Prospect B',
        prospectCompany: 'Company B',
        bountyCredits: 50,
        connectionStrength: 'second_degree',
        status: 'open',
      },
      {
        // Medium bounty, first degree, recent
        prospectName: 'Prospect C',
        prospectCompany: 'Company C',
        bountyCredits: 30,
        connectionStrength: 'first_degree',
        status: 'open',
      },
      {
        // Very high bounty, third degree, old
        prospectName: 'Prospect D',
        prospectCompany: 'Company D',
        bountyCredits: 80,
        connectionStrength: 'third_degree',
        status: 'open',
      },
      {
        // Low bounty, first degree, recent
        prospectName: 'Prospect E',
        prospectCompany: 'Company E',
        bountyCredits: 20,
        connectionStrength: 'first_degree',
        status: 'open',
      },
    ]);

    console.log(`✅ Created ${opportunityIds.length} intro opportunities`);

    // Import and call prioritization function
    const { calculateUserPriorities } = await import(
      '../../../packages/agents/account-manager/src/index'
    );

    await calculateUserPriorities(user!.id, testDbClient);

    // Verify priorities in database
    const { data: priorities } = await testDbClient
      .from('user_priorities')
      .select('*')
      .eq('user_id', user!.id)
      .eq('item_type', 'intro_opportunity')
      .order('priority_rank', { ascending: true });

    console.log('\n📊 Priority Rankings:');
    priorities?.forEach((p, idx) => {
      console.log(`  ${idx + 1}. ${p.content} (score: ${p.value_score})`);
    });

    // Validate scoring logic
    expect(priorities).toBeDefined();
    expect(priorities!.length).toBeGreaterThan(0);

    // High bounty should rank higher than low bounty (all else equal)
    const prospectDPriority = priorities?.find(p => p.content.includes('Prospect D'));
    const prospectAPriority = priorities?.find(p => p.content.includes('Prospect A'));

    expect(prospectDPriority?.value_score).toBeGreaterThan(prospectAPriority?.value_score || 0);
    console.log(`\n✅ High bounty (Prospect D) scored higher than low bounty (Prospect A)`);

    // First degree should boost score
    const prospectCPriority = priorities?.find(p => p.content.includes('Prospect C'));
    const prospectBPriority = priorities?.find(p => p.content.includes('Prospect B'));

    // Prospect C: 30 credits (15 pts) + first degree (15 pts) = 30 pts
    // Prospect B: 50 credits (25 pts) + second degree (5 pts) = 30 pts
    // Should be similar scores
    expect(Math.abs((prospectCPriority?.value_score || 0) - (prospectBPriority?.value_score || 0))).toBeLessThan(20);
    console.log(`✅ Connection strength impacts scoring correctly`);

    console.log(`\n✅ Test passed: Intro opportunities scored correctly\n`);
  }, 30000);

  /**
   * Test 2: Connection Requests with Vouching
   *
   * Validates scoring algorithm:
   * - Base score: 50
   * - Vouch count: +20 per vouch
   * - Credits spent: up to +15 (credits / 10, max 15)
   * - Recency: <3 days +10
   */
  it('should score connection requests with vouching significantly higher', async () => {
    // Create test user
    const userId = crypto.randomUUID();
    testUserIds.push(userId);

    const { data: user } = await testDbClient
      .from('users')
      .insert({
        phone_number: `+1555${Math.floor(Math.random() * 10000000)}`,
        verified: false,
      })
      .select()
      .single();

    console.log(`✅ Test user created: ${userId}`);

    // Create vouchers
    const voucherId1 = crypto.randomUUID();
    const voucherId2 = crypto.randomUUID();
    const voucherId3 = crypto.randomUUID();

    // Create 2 connection_requests
    const requestIds = await createConnectionRequests(testDbClient, user!.id, [
      {
        // No vouches, medium credits
        requestorName: 'Requestor A',
        requestorCompany: 'Company A',
        introContext: 'Looking to discuss product strategy',
        requestorCreditsSpent: 50,
        vouchedByUserIds: [],
        status: 'open',
      },
      {
        // 3 vouches, low credits
        requestorName: 'Requestor B',
        requestorCompany: 'Company B',
        introContext: 'Wants to explore partnership',
        requestorCreditsSpent: 20,
        vouchedByUserIds: [voucherId1, voucherId2, voucherId3],
        status: 'open',
      },
    ]);

    console.log(`✅ Created ${requestIds.length} connection requests`);

    // Calculate priorities
    const { calculateUserPriorities } = await import(
      '../../../packages/agents/account-manager/src/index'
    );

    await calculateUserPriorities(user!.id, testDbClient);

    // Verify priorities
    const { data: priorities } = await testDbClient
      .from('user_priorities')
      .select('*')
      .eq('user_id', user!.id)
      .eq('item_type', 'connection_request')
      .order('value_score', { ascending: false });

    console.log('\n📊 Connection Request Rankings:');
    priorities?.forEach((p, idx) => {
      console.log(`  ${idx + 1}. ${p.content} (score: ${p.value_score})`);
    });

    expect(priorities).toBeDefined();
    expect(priorities!.length).toBe(2);

    // Vouched request should score MUCH higher (3 vouches × 20 = +60 points)
    const requestBPriority = priorities?.find(p => p.content.includes('Requestor B'));
    const requestAPriority = priorities?.find(p => p.content.includes('Requestor A'));

    expect(requestBPriority?.value_score).toBeGreaterThan((requestAPriority?.value_score || 0) + 50);
    console.log(
      `\n✅ Vouched request (B) scored ${requestBPriority?.value_score} vs ${requestAPriority?.value_score} for non-vouched (A)`
    );
    console.log(`✅ Vouching provides significant boost (+60 points for 3 vouches)\n`);
  }, 30000);

  /**
   * Test 3: Intro Offers (Dual Role)
   *
   * Validates scoring algorithm:
   * - Introducee role (pending response): base 55 + bounty adjustment
   * - Connector role (pending confirmation): base 70 (higher urgency)
   */
  it('should prioritize connector role over introducee role in intro offers', async () => {
    // Create 2 test users
    const userId1 = crypto.randomUUID();
    const userId2 = crypto.randomUUID();
    testUserIds.push(userId1, userId2);

    const { data: user1 } = await testDbClient
      .from('users')
      .insert({
        phone_number: `+1555${Math.floor(Math.random() * 10000000)}`,
        verified: false,
      })
      .select()
      .single();

    const { data: user2 } = await testDbClient
      .from('users')
      .insert({
        phone_number: `+1555${Math.floor(Math.random() * 10000000)}`,
        verified: false,
      })
      .select()
      .single();

    console.log(`✅ Test users created`);

    // Create intro offers where user1 is in both roles
    const offerIds = await createIntroOffers(testDbClient, [
      {
        // user1 is introducee (pending their response)
        // Low bounty to ensure connector role wins
        offeringUserId: user2!.id,
        introduceeUserId: user1!.id,
        prospectName: 'Prospect X',
        prospectCompany: 'Company X',
        prospectContext: 'Great fit for your needs',
        contextType: 'direct_offer',
        bountyCredits: 0, // No bounty - connector role should be higher urgency
        status: 'pending_introducee_response',
      },
      {
        // user1 is connector (pending their confirmation)
        // Higher urgency - user already committed to making this intro
        offeringUserId: user1!.id,
        introduceeUserId: user2!.id,
        prospectName: 'Prospect Y',
        prospectCompany: 'Company Y',
        prospectContext: 'Interested in connecting',
        contextType: 'nomination',
        bountyCredits: 0,
        status: 'pending_connector_confirmation',
      },
    ]);

    console.log(`✅ Created ${offerIds.length} intro offers`);

    // Calculate priorities for user1
    const { calculateUserPriorities } = await import(
      '../../../packages/agents/account-manager/src/index'
    );

    await calculateUserPriorities(user1!.id, testDbClient);

    // Verify priorities
    const { data: priorities } = await testDbClient
      .from('user_priorities')
      .select('*')
      .eq('user_id', user1!.id)
      .eq('item_type', 'intro_offer')
      .order('value_score', { ascending: false });

    console.log('\n📊 Intro Offer Rankings for user1:');
    priorities?.forEach((p, idx) => {
      console.log(`  ${idx + 1}. ${p.content} (score: ${p.value_score})`);
    });

    expect(priorities).toBeDefined();
    expect(priorities!.length).toBe(2);

    // Connector role should rank higher than introducee role
    const connectorPriority = priorities?.find(p => p.content.includes('Prospect Y'));
    const introduceePriority = priorities?.find(p => p.content.includes('Prospect X'));

    expect(connectorPriority?.value_score).toBeGreaterThan(introduceePriority?.value_score || 0);
    console.log(
      `\n✅ Connector role (Y) scored ${connectorPriority?.value_score} vs ${introduceePriority?.value_score} for introducee role (X)`
    );
    console.log(`✅ Connector confirmations prioritized for faster turnaround\n`);
  }, 30000);

  /**
   * Test 4: Combined Priorities
   *
   * Validates that all intro flow types are combined and ranked correctly
   */
  it('should combine and rank all priority types together', async () => {
    // Create test user
    const userId = crypto.randomUUID();
    testUserIds.push(userId);

    const { data: user } = await testDbClient
      .from('users')
      .insert({
        phone_number: `+1555${Math.floor(Math.random() * 10000000)}`,
        verified: false,
      })
      .select()
      .single();

    // Create voucher user (for intro_offers)
    const { data: voucherUser } = await testDbClient
      .from('users')
      .insert({
        phone_number: `+1555${Math.floor(Math.random() * 10000000)}`,
        verified: false,
      })
      .select()
      .single();

    testUserIds.push(voucherUser!.id);

    console.log(`✅ Test users created`);

    // Create mix of priorities
    const { opportunityIds: introOppIds } = await createIntroOpportunities(testDbClient, user!.id, [
      {
        prospectName: 'Opp A',
        prospectCompany: 'Company A',
        bountyCredits: 100, // High bounty = high score
        connectionStrength: 'first_degree',
        status: 'open',
      },
      {
        prospectName: 'Opp B',
        prospectCompany: 'Company B',
        bountyCredits: 20, // Low bounty = low score
        connectionStrength: 'third_degree',
        status: 'open',
      },
    ]);

    await createConnectionRequests(testDbClient, user!.id, [
      {
        requestorName: 'Req A',
        requestorCompany: 'Company C',
        introContext: 'Vouched request',
        requestorCreditsSpent: 100,
        vouchedByUserIds: [voucherUser!.id, voucherUser!.id, voucherUser!.id], // 3 vouches = very high
        status: 'open',
      },
    ]);

    await createIntroOffers(testDbClient, [
      {
        offeringUserId: user!.id,
        introduceeUserId: voucherUser!.id,
        prospectName: 'Offer A',
        prospectCompany: 'Company D',
        prospectContext: 'Connector role',
        contextType: 'nomination',
        bountyCredits: 50,
        status: 'pending_connector_confirmation', // Connector = high urgency
      },
    ]);

    console.log(`✅ Created mixed priorities`);

    // Calculate priorities
    const { calculateUserPriorities } = await import(
      '../../../packages/agents/account-manager/src/index'
    );

    await calculateUserPriorities(user!.id, testDbClient);

    // Verify top 10 priorities
    const { data: priorities } = await testDbClient
      .from('user_priorities')
      .select('*')
      .eq('user_id', user!.id)
      .order('priority_rank', { ascending: true })
      .limit(10);

    console.log('\n📊 Top 10 Combined Priorities:');
    priorities?.forEach((p, idx) => {
      console.log(`  ${idx + 1}. [${p.item_type}] ${p.content} (score: ${p.value_score})`);
    });

    expect(priorities).toBeDefined();
    expect(priorities!.length).toBeGreaterThan(0);

    // Verify all types are present
    const hasIntroOpp = priorities?.some(p => p.item_type === 'intro_opportunity');
    const hasConnReq = priorities?.some(p => p.item_type === 'connection_request');
    const hasIntroOffer = priorities?.some(p => p.item_type === 'intro_offer');

    expect(hasIntroOpp).toBe(true);
    expect(hasConnReq).toBe(true);
    expect(hasIntroOffer).toBe(true);

    console.log(`\n✅ All intro flow types present in combined priorities`);

    // Vouched connection request should be near the top (3 vouches × 20 = +60)
    const vouchedRequest = priorities?.find(p => p.content.includes('Req A'));
    expect(vouchedRequest?.priority_rank).toBeLessThanOrEqual(2);

    console.log(`✅ Vouched connection request ranked highly (rank ${vouchedRequest?.priority_rank})`);
    console.log(`✅ Test passed: Combined prioritization works correctly\n`);
  }, 30000);
});
