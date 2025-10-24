/**
 * Account Manager - State Transitions Tests
 *
 * Tests Phase 3.4 state transition logic for intro flows:
 * - When intro_opportunity accepted → pause competing opportunities for same prospect
 * - When intro_opportunity completed → cancel competing paused opportunities
 *
 * These are UNIT TESTS that directly test the state transition functions in:
 * packages/agents/account-manager/src/intro-prioritization.ts
 */

import { createTestDbClient } from '../../../packages/testing/src/helpers/db-utils';
import { createIntroOpportunities, cleanupTestData } from '../../framework/TestDataSetup';
import crypto from 'crypto';

describe('Account Manager - State Transitions (Phase 3.4)', () => {
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
   * Test 1: Accept Intro Opportunity → Pause Competing
   *
   * When a connector accepts an intro_opportunity, all other opportunities
   * for the same prospect should be automatically paused.
   */
  it('should pause competing opportunities when one is accepted', async () => {
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

    // Create 3 intro_opportunities for the SAME prospect
    const { opportunityIds, prospectId } = await createIntroOpportunities(testDbClient, user!.id, [
      {
        prospectName: 'Sarah Chen',
        prospectCompany: 'TechCorp',
        bountyCredits: 50,
        connectionStrength: 'first_degree',
        status: 'open',
      },
      {
        prospectName: 'Sarah Chen',
        prospectCompany: 'TechCorp',
        bountyCredits: 75,
        connectionStrength: 'second_degree',
        status: 'open',
      },
      {
        prospectName: 'Sarah Chen',
        prospectCompany: 'TechCorp',
        bountyCredits: 60,
        connectionStrength: 'first_degree',
        status: 'open',
      },
    ]);

    console.log(`✅ Created 3 intro opportunities for same prospect`);

    // Verify all are open
    const { data: beforeAccept } = await testDbClient
      .from('intro_opportunities')
      .select('*')
      .in('id', opportunityIds);

    expect(beforeAccept?.every(o => o.status === 'open')).toBe(true);
    console.log(`✅ All opportunities initially 'open'`);

    // Accept the first opportunity
    const acceptedId = opportunityIds[0];
    console.log(`\n🔄 Accepting opportunity ${acceptedId}...`);

    await testDbClient
      .from('intro_opportunities')
      .update({ status: 'accepted' })
      .eq('id', acceptedId);

    // Call state transition handler
    const { handleIntroOpportunityAccepted } = await import(
      '../../../packages/agents/account-manager/src/intro-prioritization'
    );

    await handleIntroOpportunityAccepted(acceptedId, testDbClient);

    // Verify competing opportunities are paused
    const { data: afterAccept } = await testDbClient
      .from('intro_opportunities')
      .select('*')
      .eq('prospect_id', prospectId)
      .order('created_at', { ascending: true });

    console.log('\n📊 Opportunity statuses after accept:');
    afterAccept?.forEach((opp, idx) => {
      console.log(`  ${idx + 1}. ${opp.id.substring(0, 8)}... - ${opp.status}`);
    });

    expect(afterAccept).toBeDefined();
    expect(afterAccept!.length).toBe(3);

    // First one should be accepted
    expect(afterAccept![0].status).toBe('accepted');

    // Other two should be paused
    expect(afterAccept![1].status).toBe('paused');
    expect(afterAccept![2].status).toBe('paused');

    console.log(`\n✅ Test passed: Competing opportunities paused correctly`);
    console.log(`   - Accepted: 1 opportunity`);
    console.log(`   - Paused: 2 competing opportunities\n`);
  }, 30000);

  /**
   * Test 2: Complete Intro Opportunity → Cancel Paused
   *
   * When an accepted intro_opportunity is completed, all paused opportunities
   * for the same prospect should be automatically cancelled.
   */
  it('should cancel paused opportunities when accepted one is completed', async () => {
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

    // Create 3 intro_opportunities for the SAME prospect
    const { opportunityIds, prospectId } = await createIntroOpportunities(testDbClient, user!.id, [
      {
        prospectName: 'Michael Johnson',
        prospectCompany: 'DataCorp',
        bountyCredits: 80,
        connectionStrength: 'first_degree',
        status: 'accepted', // This one is accepted
      },
      {
        prospectName: 'Michael Johnson',
        prospectCompany: 'DataCorp',
        bountyCredits: 60,
        connectionStrength: 'second_degree',
        status: 'paused', // These two are paused
      },
      {
        prospectName: 'Michael Johnson',
        prospectCompany: 'DataCorp',
        bountyCredits: 70,
        connectionStrength: 'first_degree',
        status: 'paused',
      },
    ]);

    console.log(`✅ Created 3 intro opportunities (1 accepted, 2 paused)`);

    // Verify initial state
    const { data: beforeComplete } = await testDbClient
      .from('intro_opportunities')
      .select('*')
      .in('id', opportunityIds)
      .order('created_at', { ascending: true });

    console.log('\n📊 Initial opportunity statuses:');
    beforeComplete?.forEach((opp, idx) => {
      console.log(`  ${idx + 1}. ${opp.id.substring(0, 8)}... - ${opp.status}`);
    });

    expect(beforeComplete![0].status).toBe('accepted');
    expect(beforeComplete![1].status).toBe('paused');
    expect(beforeComplete![2].status).toBe('paused');

    // Complete the accepted opportunity
    const completedId = opportunityIds[0];
    console.log(`\n🔄 Completing opportunity ${completedId}...`);

    await testDbClient
      .from('intro_opportunities')
      .update({ status: 'completed' })
      .eq('id', completedId);

    // Call state transition handler
    const { handleIntroOpportunityCompleted } = await import(
      '../../../packages/agents/account-manager/src/intro-prioritization'
    );

    await handleIntroOpportunityCompleted(completedId, testDbClient);

    // Verify paused opportunities are cancelled
    const { data: afterComplete } = await testDbClient
      .from('intro_opportunities')
      .select('*')
      .eq('prospect_id', prospectId)
      .order('created_at', { ascending: true });

    console.log('\n📊 Opportunity statuses after completion:');
    afterComplete?.forEach((opp, idx) => {
      console.log(`  ${idx + 1}. ${opp.id.substring(0, 8)}... - ${opp.status}`);
    });

    expect(afterComplete).toBeDefined();
    expect(afterComplete!.length).toBe(3);

    // First one should be completed
    expect(afterComplete![0].status).toBe('completed');

    // Other two should be cancelled
    expect(afterComplete![1].status).toBe('cancelled');
    expect(afterComplete![2].status).toBe('cancelled');

    console.log(`\n✅ Test passed: Paused opportunities cancelled correctly`);
    console.log(`   - Completed: 1 opportunity`);
    console.log(`   - Cancelled: 2 paused opportunities\n`);
  }, 30000);

  /**
   * Test 3: Edge Case - No Competing Opportunities
   *
   * Verify handlers don't error when there are no competing opportunities
   */
  it('should handle accept/complete gracefully with no competing opportunities', async () => {
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

    // Create single intro_opportunity (no competitors)
    const { opportunityIds } = await createIntroOpportunities(testDbClient, user!.id, [
      {
        prospectName: 'Unique Prospect',
        prospectCompany: 'UniqueCorp',
        bountyCredits: 50,
        connectionStrength: 'first_degree',
        status: 'open',
      },
    ]);

    const singleId = opportunityIds[0];
    console.log(`✅ Created single intro opportunity (no competitors)`);

    // Accept it
    await testDbClient
      .from('intro_opportunities')
      .update({ status: 'accepted' })
      .eq('id', singleId);

    // Call accept handler - should not error
    const { handleIntroOpportunityAccepted } = await import(
      '../../../packages/agents/account-manager/src/intro-prioritization'
    );

    await expect(
      handleIntroOpportunityAccepted(singleId, testDbClient)
    ).resolves.not.toThrow();

    console.log(`✅ Accept handler succeeded with no competitors`);

    // Complete it
    await testDbClient
      .from('intro_opportunities')
      .update({ status: 'completed' })
      .eq('id', singleId);

    // Call complete handler - should not error
    const { handleIntroOpportunityCompleted } = await import(
      '../../../packages/agents/account-manager/src/intro-prioritization'
    );

    await expect(
      handleIntroOpportunityCompleted(singleId, testDbClient)
    ).resolves.not.toThrow();

    console.log(`✅ Complete handler succeeded with no competitors`);
    console.log(`\n✅ Test passed: Handlers are resilient to edge cases\n`);
  }, 30000);
});
