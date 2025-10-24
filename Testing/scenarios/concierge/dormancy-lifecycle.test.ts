/**
 * Concierge Agent - Dormancy Lifecycle Tests (Phase 7 - Appendix E)
 *
 * Tests the 2-strike dormancy rule:
 * - After 2 presentations with no user response → mark as dormant
 * - Dormant items excluded from Account Manager recalculation
 * - Re-engagement tasks cancelled when item becomes dormant
 * - Dormant items have dormant_at timestamp set
 *
 * These tests validate:
 * packages/agents/concierge/src/index.ts markPriorityPresented() function
 * packages/agents/account-manager/src/intro-prioritization.ts dormancy filters
 */

import { ConversationRunner } from '../../framework/ConversationRunner';
import { createTestDbClient } from '../../../packages/testing/src/helpers/db-utils';
import { cleanupTestData } from '../../framework/TestDataSetup';
import type { SimulatedPersona } from '../../framework/SimulatedUser';
import crypto from 'crypto';
import { invokeConciergeAgent } from '../../../packages/agents/concierge/src/index';
import { calculateUserPriorities } from '../../../packages/agents/account-manager/src/index';

describe('Concierge Agent - Dormancy Lifecycle (Appendix E Phase 7)', () => {
  let runner: ConversationRunner;
  let testDbClient: ReturnType<typeof createTestDbClient>;
  let testUserIds: string[] = [];

  beforeAll(() => {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY environment variable required for tests');
    }

    runner = new ConversationRunner();
    testDbClient = createTestDbClient();
  });

  afterAll(async () => {
    // Clean up all test users
    for (const userId of testUserIds) {
      await cleanupTestData(testDbClient, userId);
    }
  });

  /**
   * Scenario 1: intro_opportunity becomes dormant after 2 presentations
   *
   * Flow:
   * 1. Create intro_opportunity (presentation_count = 0)
   * 2. Present to user via proactive mention (presentation_count = 1)
   * 3. User ignores, no response
   * 4. Re-engagement presents again (presentation_count = 2)
   * 5. User ignores again
   * 6. Status should be 'dormant', dormant_at should be set
   */
  it('should mark intro_opportunity as dormant after 2 presentations with no response', async () => {
    const persona: SimulatedPersona = {
      name: 'Dormancy Test User',
      personality: 'Busy executive who ignores some messages',
      systemPrompt: 'You are a test user who sometimes ignores intro opportunities.',
      initialContext: {
        company: 'TestCorp',
        title: 'VP Product',
        expertise: 'Product Management',
      },
    };

    console.log('\n📝 Setting up user with intro opportunity...');
    const initialResult = await runner.runSimulation(persona, 'concierge', 2, 'dormancy-test-1');
    const userId = initialResult.user.id;
    const conversationId = initialResult.conversation.id;
    testUserIds.push(userId);

    const opportunities = await runner.setupIntroOpportunities(userId, [
      {
        prospectName: 'Sam Rodriguez',
        prospectCompany: 'TechVentures',
        prospectTitle: 'Senior PM',
        bountyCredits: 50,
        connectionStrength: 'first_degree',
        status: 'open',
      },
    ]);

    const oppId = opportunities[0];
    console.log(`✅ Created intro opportunity: ${oppId}`);

    // Get user and conversation
    const { data: user } = await testDbClient.from('users').select('*').eq('id', userId).single();
    const { data: conversation } = await testDbClient
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .single();

    // PRESENTATION 1: Proactive mention via Call 2
    console.log('\n🔄 PRESENTATION 1: Proactive mention (natural)...');

    // Simulate markPriorityPresented being called
    const { markPriorityPresented } = await import(
      '../../../packages/agents/concierge/src/index'
    );

    // Mark as presented for the first time
    await markPriorityPresented(
      testDbClient,
      'intro_opportunity',
      oppId,
      'natural', // Proactive mention
      userId,
      conversationId
    );

    // Check presentation_count = 1, status = 'presented'
    let { data: opp } = await testDbClient
      .from('intro_opportunities')
      .select('presentation_count, status, dormant_at, last_presented_at')
      .eq('id', oppId)
      .single();

    expect(opp?.presentation_count).toBe(1);
    expect(opp?.status).toBe('presented');
    expect(opp?.dormant_at).toBeNull();
    expect(opp?.last_presented_at).toBeDefined();
    console.log(`✅ After presentation 1: count = ${opp?.presentation_count}, status = ${opp?.status}`);

    // User IGNORES (no response)
    console.log('⏳ User ignores presentation 1...\n');

    // Wait a bit (simulate time passing)
    await new Promise((resolve) => setTimeout(resolve, 100));

    // PRESENTATION 2: Re-engagement message (dedicated)
    console.log('🔄 PRESENTATION 2: Re-engagement (dedicated)...');

    await markPriorityPresented(
      testDbClient,
      'intro_opportunity',
      oppId,
      'dedicated', // Re-engagement
      userId,
      conversationId
    );

    // Check presentation_count = 2, status = 'dormant'
    ({ data: opp } = await testDbClient
      .from('intro_opportunities')
      .select('presentation_count, status, dormant_at, last_presented_at')
      .eq('id', oppId)
      .single());

    expect(opp?.presentation_count).toBe(2);
    expect(opp?.status).toBe('dormant');
    expect(opp?.dormant_at).toBeDefined(); // Should have timestamp
    expect(opp?.last_presented_at).toBeDefined();
    console.log(`✅ After presentation 2: count = ${opp?.presentation_count}, status = ${opp?.status}`);
    console.log(`✅ dormant_at timestamp set: ${opp?.dormant_at}`);

    console.log('\n✅ Test passed: Opportunity marked dormant after 2 presentations\n');
  }, 60000);

  /**
   * Scenario 2: Dormant items excluded from Account Manager recalculation
   *
   * Flow:
   * 1. Create 3 intro_opportunities
   * 2. Mark one as dormant (presentation_count = 2)
   * 3. Run Account Manager calculateUserPriorities()
   * 4. Verify dormant opportunity NOT included in user_priorities
   */
  it('should exclude dormant items from Account Manager recalculation', async () => {
    const persona: SimulatedPersona = {
      name: 'Account Manager Test User',
      personality: 'Active networker',
      systemPrompt: 'You are a test user for Account Manager integration.',
      initialContext: {
        company: 'GrowthCo',
        title: 'Head of Sales',
        expertise: 'Enterprise Sales',
      },
    };

    console.log('\n📝 Setting up user with 3 intro opportunities...');
    const initialResult = await runner.runSimulation(persona, 'concierge', 2, 'dormancy-test-2');
    const userId = initialResult.user.id;
    testUserIds.push(userId);

    const opportunities = await runner.setupIntroOpportunities(userId, [
      {
        prospectName: 'Taylor Smith',
        prospectCompany: 'AlphaCo',
        prospectTitle: 'Director Sales',
        bountyCredits: 60,
        connectionStrength: 'first_degree',
        status: 'open',
      },
      {
        prospectName: 'Jordan Lee',
        prospectCompany: 'BetaCo',
        prospectTitle: 'VP Marketing',
        bountyCredits: 70,
        connectionStrength: 'first_degree',
        status: 'open',
      },
      {
        prospectName: 'Morgan Chen',
        prospectCompany: 'GammaCo',
        prospectTitle: 'CEO',
        bountyCredits: 100,
        connectionStrength: 'second_degree',
        status: 'open',
      },
    ]);

    console.log(`✅ Created 3 intro opportunities`);

    // Mark the first opportunity as DORMANT
    const dormantOppId = opportunities[0];
    await testDbClient
      .from('intro_opportunities')
      .update({
        presentation_count: 2,
        status: 'dormant',
        dormant_at: new Date().toISOString(),
        last_presented_at: new Date().toISOString(),
      })
      .eq('id', dormantOppId);

    console.log(`✅ Marked opportunity ${dormantOppId} as dormant (presentation_count = 2)`);

    // Run Account Manager to calculate priorities
    console.log('\n🔄 Running Account Manager calculateUserPriorities()...');
    await calculateUserPriorities(userId, testDbClient);

    // Check user_priorities table
    const { data: priorities } = await testDbClient
      .from('user_priorities')
      .select('item_id, item_type, item_primary_name')
      .eq('user_id', userId)
      .eq('item_type', 'intro_opportunity');

    console.log(`\n📋 Account Manager created ${priorities?.length || 0} intro_opportunity priorities`);
    console.log('Priorities:', priorities);

    // Should have 2 priorities (NOT 3 - dormant one excluded)
    expect(priorities?.length).toBe(2);

    // Verify dormant opportunity is NOT in the list
    const dormantInPriorities = priorities?.some((p) => p.item_id === dormantOppId);
    expect(dormantInPriorities).toBe(false);
    console.log(`✅ Dormant opportunity ${dormantOppId} excluded from priorities`);

    // Verify the other 2 ARE included
    const jordanInPriorities = priorities?.some((p) => p.item_id === opportunities[1]);
    const morganInPriorities = priorities?.some((p) => p.item_id === opportunities[2]);
    expect(jordanInPriorities).toBe(true);
    expect(morganInPriorities).toBe(true);
    console.log('✅ Other 2 opportunities included in priorities');

    console.log('\n✅ Test passed: Dormant items excluded from Account Manager recalculation\n');
  }, 60000);

  /**
   * Scenario 3: Re-engagement tasks cancelled when item becomes dormant
   *
   * Flow:
   * 1. Create intro_opportunity with scheduled re-engagement
   * 2. Mark as presented twice → becomes dormant
   * 3. Verify re-engagement scheduled_events are cancelled
   */
  it('should cancel re-engagement tasks when item becomes dormant', async () => {
    const persona: SimulatedPersona = {
      name: 'Re-engagement Test User',
      personality: 'Busy professional',
      systemPrompt: 'You are a test user for re-engagement cancellation.',
      initialContext: {
        company: 'BusyCo',
        title: 'COO',
        expertise: 'Operations',
      },
    };

    console.log('\n📝 Setting up user with intro opportunity and re-engagement...');
    const initialResult = await runner.runSimulation(persona, 'concierge', 2, 'dormancy-test-3');
    const userId = initialResult.user.id;
    const conversationId = initialResult.conversation.id;
    testUserIds.push(userId);

    const opportunities = await runner.setupIntroOpportunities(userId, [
      {
        prospectName: 'Alex Martinez',
        prospectCompany: 'FutureTech',
        prospectTitle: 'CTO',
        bountyCredits: 90,
        connectionStrength: 'first_degree',
        status: 'presented', // Already presented once
      },
    ]);

    const oppId = opportunities[0];
    console.log(`✅ Created intro opportunity: ${oppId}`);

    // Set presentation_count = 1 (already presented once)
    await testDbClient
      .from('intro_opportunities')
      .update({
        presentation_count: 1,
        last_presented_at: new Date().toISOString(),
      })
      .eq('id', oppId);

    // Create a mock re-engagement scheduled_event
    const { data: scheduledEvent } = await testDbClient
      .from('scheduled_events')
      .insert({
        user_id: userId,
        event_type: 're_engagement',
        scheduled_for: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Tomorrow
        status: 'pending',
        event_data: {
          context_type: 'intro_opportunity',
          context_id: oppId,
          priority_id: crypto.randomUUID(),
        },
      })
      .select('id')
      .single();

    console.log(`✅ Created scheduled re-engagement event: ${scheduledEvent?.id}`);

    // Import markPriorityPresented
    const { markPriorityPresented } = await import(
      '../../../packages/agents/concierge/src/index'
    );

    // Present for the SECOND time → should become dormant and cancel re-engagement
    console.log('\n🔄 Presenting opportunity for 2nd time (should trigger dormancy)...');
    await markPriorityPresented(
      testDbClient,
      'intro_opportunity',
      oppId,
      'dedicated',
      userId,
      conversationId
    );

    // Verify opportunity is dormant
    const { data: opp } = await testDbClient
      .from('intro_opportunities')
      .select('presentation_count, status, dormant_at')
      .eq('id', oppId)
      .single();

    expect(opp?.presentation_count).toBe(2);
    expect(opp?.status).toBe('dormant');
    expect(opp?.dormant_at).toBeDefined();
    console.log(`✅ Opportunity marked dormant after 2nd presentation`);

    // Verify re-engagement event was cancelled
    const { data: event } = await testDbClient
      .from('scheduled_events')
      .select('status')
      .eq('id', scheduledEvent!.id)
      .single();

    expect(event?.status).toBe('cancelled');
    console.log(`✅ Re-engagement event cancelled: ${scheduledEvent?.id}`);

    console.log('\n✅ Test passed: Re-engagement tasks cancelled when item became dormant\n');
  }, 60000);

  /**
   * Scenario 4: connection_request dormancy lifecycle
   *
   * Tests that dormancy logic works for connection_requests, not just intro_opportunities
   */
  it('should mark connection_request as dormant after 2 presentations', async () => {
    const persona: SimulatedPersona = {
      name: 'Connection Request Test User',
      personality: 'Selective networker',
      systemPrompt: 'You are a test user for connection request dormancy.',
      initialContext: {
        company: 'SelectiveCo',
        title: 'Founder',
        expertise: 'Startups',
      },
    };

    console.log('\n📝 Setting up user with connection request...');
    const initialResult = await runner.runSimulation(persona, 'concierge', 2, 'dormancy-test-4');
    const userId = initialResult.user.id;
    const conversationId = initialResult.conversation.id;
    testUserIds.push(userId);

    const requests = await runner.setupConnectionRequests(userId, [
      {
        requestorName: 'Riley Johnson',
        requestorCompany: 'StartupHub',
        introContext: 'Interested in learning about your startup journey',
        requestorCreditsSpent: 45,
        status: 'open',
      },
    ]);

    const reqId = requests[0];
    console.log(`✅ Created connection request: ${reqId}`);

    // Get user and conversation
    const { data: user } = await testDbClient.from('users').select('*').eq('id', userId).single();
    const { data: conversation } = await testDbClient
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .single();

    // Import markPriorityPresented
    const { markPriorityPresented } = await import(
      '../../../packages/agents/concierge/src/index'
    );

    // PRESENTATION 1
    console.log('\n🔄 PRESENTATION 1...');
    await markPriorityPresented(
      testDbClient,
      'connection_request',
      reqId,
      'natural',
      userId,
      conversationId
    );

    let { data: req } = await testDbClient
      .from('connection_requests')
      .select('presentation_count, status, dormant_at')
      .eq('id', reqId)
      .single();

    expect(req?.presentation_count).toBe(1);
    expect(req?.status).toBe('presented');
    expect(req?.dormant_at).toBeNull();
    console.log(`✅ After presentation 1: count = ${req?.presentation_count}, status = ${req?.status}`);

    // PRESENTATION 2
    console.log('\n🔄 PRESENTATION 2...');
    await markPriorityPresented(
      testDbClient,
      'connection_request',
      reqId,
      'dedicated',
      userId,
      conversationId
    );

    ({ data: req } = await testDbClient
      .from('connection_requests')
      .select('presentation_count, status, dormant_at')
      .eq('id', reqId)
      .single());

    expect(req?.presentation_count).toBe(2);
    expect(req?.status).toBe('dormant');
    expect(req?.dormant_at).toBeDefined();
    console.log(`✅ After presentation 2: count = ${req?.presentation_count}, status = ${req?.status}`);
    console.log(`✅ dormant_at timestamp set: ${req?.dormant_at}`);

    console.log('\n✅ Test passed: connection_request marked dormant after 2 presentations\n');
  }, 60000);
});
