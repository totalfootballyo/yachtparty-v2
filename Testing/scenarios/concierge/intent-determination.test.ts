/**
 * Concierge Agent - Intent Determination Tests (Phase 7 - Appendix E)
 *
 * Tests Call 1 LLM's ability to correctly identify WHICH priority
 * a user is addressing based on denormalized fields:
 * - item_primary_name (prospect/requestor name)
 * - item_secondary_name (innovator/offering user name)
 * - item_context (intro context, bounty details)
 * - presented_at timestamp
 *
 * Critical: User sending unrelated message should NOT mark priorities as actioned.
 */

import { ConversationRunner } from '../../framework/ConversationRunner';
import { createTestDbClient } from '../../../packages/testing/src/helpers/db-utils';
import { cleanupTestData } from '../../framework/TestDataSetup';
import type { SimulatedPersona } from '../../framework/SimulatedUser';
import crypto from 'crypto';
import { invokeConciergeAgent } from '../../../packages/agents/concierge/src/index';

describe('Concierge Agent - Intent Determination (Appendix E Phase 7)', () => {
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
   * Scenario 1: User responds to specific intro_opportunity by mentioning prospect name
   *
   * Setup:
   * - 3 intro_opportunities for user (Alice, Bob, Charlie)
   * - All have been presented (presented_at set)
   *
   * Test:
   * - User says "I'd like to connect with Alice"
   * - Call 1 should identify the Alice opportunity ONLY
   * - Other opportunities should remain unchanged
   */
  it('should correctly identify priority when user mentions prospect name', async () => {
    const persona: SimulatedPersona = {
      name: 'Test User',
      personality: 'Engaged professional',
      systemPrompt: 'You are a test user responding to intro opportunities.',
      initialContext: {
        company: 'TestCo',
        title: 'CEO',
        expertise: 'Technology',
      },
    };

    console.log('\n📝 Setting up user with 3 intro opportunities...');
    const initialResult = await runner.runSimulation(persona, 'concierge', 2, 'intent-test-1');
    const userId = initialResult.user.id;
    const conversationId = initialResult.conversation.id;
    testUserIds.push(userId);

    // Create 3 intro opportunities
    const opportunities = await runner.setupIntroOpportunities(userId, [
      {
        prospectName: 'Alice Johnson',
        prospectCompany: 'Acme Corp',
        prospectTitle: 'VP Engineering',
        bountyCredits: 50,
        connectionStrength: 'first_degree',
        status: 'open',
      },
      {
        prospectName: 'Bob Williams',
        prospectCompany: 'TechCo',
        prospectTitle: 'CTO',
        bountyCredits: 100,
        connectionStrength: 'second_degree',
        status: 'open',
      },
      {
        prospectName: 'Charlie Davis',
        prospectCompany: 'StartupX',
        prospectTitle: 'CEO',
        bountyCredits: 75,
        connectionStrength: 'first_degree',
        status: 'open',
      },
    ]);

    console.log(`✅ Created 3 intro opportunities: ${opportunities.join(', ')}`);

    // Mark all as presented (simulate Account Manager populating user_priorities with denormalized data)
    const now = new Date().toISOString();
    for (const oppId of opportunities) {
      // Get opportunity details
      const { data: opp } = await testDbClient
        .from('intro_opportunities')
        .select('first_name, last_name, prospect_company, bounty_credits')
        .eq('id', oppId)
        .single();

      if (!opp) continue;

      // Create user_priority with denormalized fields
      await testDbClient.from('user_priorities').insert({
        user_id: userId,
        priority_rank: opportunities.indexOf(oppId) + 1,
        item_type: 'intro_opportunity',
        item_id: oppId,
        value_score: 80,
        status: 'presented',
        presentation_count: 1,
        presented_at: now,
        item_summary: `Intro ${opp.first_name} ${opp.last_name} at ${opp.prospect_company}`,
        item_primary_name: `${opp.first_name} ${opp.last_name}`,
        item_secondary_name: null,
        item_context: `Earn ${opp.bounty_credits} credits`,
        item_metadata: {
          bounty_credits: opp.bounty_credits,
          prospect_company: opp.prospect_company,
        },
      });

      // Mark intro_opportunity as presented
      await testDbClient
        .from('intro_opportunities')
        .update({
          status: 'presented',
          presentation_count: 1,
          last_presented_at: now,
        })
        .eq('id', oppId);
    }

    console.log('✅ Marked all opportunities as presented with denormalized data');

    // User responds mentioning Alice
    const { data: user } = await testDbClient
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    const { data: conversation } = await testDbClient
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .single();

    const userMessage = {
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      user_id: userId,
      role: 'user' as const,
      content: "I'd like to connect with Alice Johnson from Acme Corp",
      direction: 'inbound' as const,
      status: 'sent' as const,
      created_at: new Date(),
      twilio_message_sid: 'TEST_MSG_1',
      sent_at: null,
      delivered_at: null,
    };

    console.log('\n🔄 User says: "I\'d like to connect with Alice Johnson from Acme Corp"');

    const response = await invokeConciergeAgent(
      userMessage,
      user!,
      conversation!,
      testDbClient
    );

    console.log('Agent response:', response);

    // Verify Call 1 identified the correct priority
    const { data: actionsLog } = await testDbClient
      .from('agent_actions_log')
      .select('*')
      .eq('user_id', userId)
      .eq('action_type', 'llm_decision')
      .order('created_at', { ascending: false })
      .limit(1);

    console.log('\n📋 LLM Decision:', actionsLog?.[0]?.output_data);

    expect(actionsLog).toBeDefined();
    expect(actionsLog!.length).toBeGreaterThan(0);

    const decision = actionsLog![0].output_data;

    // Should have identified Alice's intro_opportunity
    expect(decision.threads_to_address).toBeDefined();
    const priorityThread = decision.threads_to_address?.find(
      (t: any) => t.type === 'priority_opportunity'
    );

    expect(priorityThread).toBeDefined();
    expect(priorityThread?.item_id).toBe(opportunities[0]); // Alice's opportunity

    // Check that Alice's opportunity was marked as actioned
    const { data: aliceOpp } = await testDbClient
      .from('intro_opportunities')
      .select('status')
      .eq('id', opportunities[0])
      .single();

    expect(aliceOpp?.status).toBe('accepted');
    console.log('✅ Alice\'s opportunity marked as accepted');

    // Check that Bob and Charlie's opportunities remain presented
    const { data: bobOpp } = await testDbClient
      .from('intro_opportunities')
      .select('status')
      .eq('id', opportunities[1])
      .single();

    const { data: charlieOpp } = await testDbClient
      .from('intro_opportunities')
      .select('status')
      .eq('id', opportunities[2])
      .single();

    expect(bobOpp?.status).toBe('presented');
    expect(charlieOpp?.status).toBe('presented');
    console.log('✅ Bob and Charlie\'s opportunities remain presented (unchanged)');

    console.log('\n✅ Test passed: Correctly identified Alice\'s opportunity only\n');
  }, 120000);

  /**
   * Scenario 2: User sends unrelated message - should NOT mark anything as actioned
   *
   * Critical bug fix test: Previously LLMs would mark ALL presented priorities
   * as actioned when user said something unrelated.
   *
   * Setup:
   * - 2 intro_opportunities presented
   * - User says "What's the weather like?"
   *
   * Expected:
   * - NO priorities marked as actioned
   * - Agent responds naturally (not about intros)
   */
  it('should NOT mark priorities as actioned when user sends unrelated message', async () => {
    const persona: SimulatedPersona = {
      name: 'Test User 2',
      personality: 'Casual conversationalist',
      systemPrompt: 'You are a test user making small talk.',
      initialContext: {
        company: 'TestCo',
        title: 'Manager',
        expertise: 'Operations',
      },
    };

    console.log('\n📝 Setting up user with 2 intro opportunities...');
    const initialResult = await runner.runSimulation(persona, 'concierge', 2, 'intent-test-2');
    const userId = initialResult.user.id;
    const conversationId = initialResult.conversation.id;
    testUserIds.push(userId);

    const opportunities = await runner.setupIntroOpportunities(userId, [
      {
        prospectName: 'Emma Thompson',
        prospectCompany: 'DataCorp',
        prospectTitle: 'Data Scientist',
        bountyCredits: 60,
        connectionStrength: 'first_degree',
        status: 'open',
      },
      {
        prospectName: 'Frank Miller',
        prospectCompany: 'CloudSys',
        prospectTitle: 'DevOps Lead',
        bountyCredits: 80,
        connectionStrength: 'second_degree',
        status: 'open',
      },
    ]);

    console.log(`✅ Created 2 intro opportunities`);

    // Mark as presented with denormalized data
    const now = new Date().toISOString();
    for (const oppId of opportunities) {
      const { data: opp } = await testDbClient
        .from('intro_opportunities')
        .select('first_name, last_name, prospect_company, bounty_credits')
        .eq('id', oppId)
        .single();

      if (!opp) continue;

      await testDbClient.from('user_priorities').insert({
        user_id: userId,
        priority_rank: opportunities.indexOf(oppId) + 1,
        item_type: 'intro_opportunity',
        item_id: oppId,
        value_score: 75,
        status: 'presented',
        presentation_count: 1,
        presented_at: now,
        item_summary: `Intro ${opp.first_name} ${opp.last_name} at ${opp.prospect_company}`,
        item_primary_name: `${opp.first_name} ${opp.last_name}`,
        item_context: `Earn ${opp.bounty_credits} credits`,
      });

      await testDbClient
        .from('intro_opportunities')
        .update({
          status: 'presented',
          presentation_count: 1,
          last_presented_at: now,
        })
        .eq('id', oppId);
    }

    console.log('✅ Marked all opportunities as presented');

    // User sends UNRELATED message
    const { data: user } = await testDbClient.from('users').select('*').eq('id', userId).single();
    const { data: conversation } = await testDbClient
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .single();

    const userMessage = {
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      user_id: userId,
      role: 'user' as const,
      content: 'What are some good project management tools?',
      direction: 'inbound' as const,
      status: 'sent' as const,
      created_at: new Date(),
      twilio_message_sid: 'TEST_MSG_2',
      sent_at: null,
      delivered_at: null,
    };

    console.log('\n🔄 User says: "What are some good project management tools?"');

    const response = await invokeConciergeAgent(
      userMessage,
      user!,
      conversation!,
      testDbClient
    );

    console.log('Agent response:', response);

    // CRITICAL: Check that NO intro_opportunities were marked as actioned
    const { data: emma } = await testDbClient
      .from('intro_opportunities')
      .select('status')
      .eq('id', opportunities[0])
      .single();

    const { data: frank } = await testDbClient
      .from('intro_opportunities')
      .select('status')
      .eq('id', opportunities[1])
      .single();

    expect(emma?.status).toBe('presented'); // Should still be 'presented', NOT 'accepted'
    expect(frank?.status).toBe('presented'); // Should still be 'presented', NOT 'accepted'

    console.log('✅ CRITICAL: Both opportunities remain "presented" (NOT actioned)');

    // Verify Call 1 did NOT identify any priority threads
    const { data: actionsLog } = await testDbClient
      .from('agent_actions_log')
      .select('*')
      .eq('user_id', userId)
      .eq('action_type', 'llm_decision')
      .order('created_at', { ascending: false })
      .limit(1);

    const decision = actionsLog?.[0]?.output_data;
    console.log('\n📋 LLM Decision:', decision);

    const priorityThreads = decision?.threads_to_address?.filter(
      (t: any) => t.type === 'priority_opportunity'
    );

    expect(!priorityThreads || priorityThreads.length === 0).toBe(true);
    console.log('✅ Call 1 correctly identified NO priority threads');

    console.log('\n✅ Test passed: Unrelated message did NOT mark priorities as actioned\n');
  }, 120000);

  /**
   * Scenario 3: User responds to connection_request by mentioning requestor name
   *
   * Tests intent matching for connection_requests (different item_type than intro_opportunity)
   */
  it('should correctly identify connection_request when user mentions requestor name', async () => {
    const persona: SimulatedPersona = {
      name: 'Test User 3',
      personality: 'Professional networker',
      systemPrompt: 'You are a test user responding to connection requests.',
      initialContext: {
        company: 'NetworkCo',
        title: 'Director',
        expertise: 'Business Development',
      },
    };

    console.log('\n📝 Setting up user with 2 connection requests...');
    const initialResult = await runner.runSimulation(persona, 'concierge', 2, 'intent-test-3');
    const userId = initialResult.user.id;
    const conversationId = initialResult.conversation.id;
    testUserIds.push(userId);

    const requests = await runner.setupConnectionRequests(userId, [
      {
        requestorName: 'Grace Lee',
        requestorCompany: 'InnovateCo',
        introContext: 'Interested in discussing partnership opportunities',
        requestorCreditsSpent: 50,
        status: 'open',
      },
      {
        requestorName: 'Henry Park',
        requestorCompany: 'GrowthLabs',
        introContext: 'Would like to learn about your approach to BD',
        requestorCreditsSpent: 40,
        status: 'open',
      },
    ]);

    console.log(`✅ Created 2 connection requests`);

    // Mark as presented with denormalized data
    const now = new Date().toISOString();
    for (const reqId of requests) {
      const { data: req } = await testDbClient
        .from('connection_requests')
        .select('requestor_name, requestor_company, intro_context, requestor_credits_spent')
        .eq('id', reqId)
        .single();

      if (!req) continue;

      await testDbClient.from('user_priorities').insert({
        user_id: userId,
        priority_rank: requests.indexOf(reqId) + 1,
        item_type: 'connection_request',
        item_id: reqId,
        value_score: 70,
        status: 'presented',
        presentation_count: 1,
        presented_at: now,
        item_summary: `Connection request from ${req.requestor_name}`,
        item_primary_name: req.requestor_name,
        item_context: req.intro_context,
        item_metadata: {
          requestor_company: req.requestor_company,
          requestor_credits_spent: req.requestor_credits_spent,
        },
      });

      await testDbClient
        .from('connection_requests')
        .update({
          status: 'presented',
          presentation_count: 1,
          last_presented_at: now,
        })
        .eq('id', reqId);
    }

    console.log('✅ Marked all connection requests as presented');

    // User responds mentioning Grace
    const { data: user } = await testDbClient.from('users').select('*').eq('id', userId).single();
    const { data: conversation } = await testDbClient
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .single();

    const userMessage = {
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      user_id: userId,
      role: 'user' as const,
      content: "I'd be interested in meeting Grace Lee",
      direction: 'inbound' as const,
      status: 'sent' as const,
      created_at: new Date(),
      twilio_message_sid: 'TEST_MSG_3',
      sent_at: null,
      delivered_at: null,
    };

    console.log('\n🔄 User says: "I\'d be interested in meeting Grace Lee"');

    const response = await invokeConciergeAgent(
      userMessage,
      user!,
      conversation!,
      testDbClient
    );

    console.log('Agent response:', response);

    // Check that Grace's request was marked as accepted
    const { data: graceReq } = await testDbClient
      .from('connection_requests')
      .select('status')
      .eq('id', requests[0])
      .single();

    expect(graceReq?.status).toBe('accepted');
    console.log('✅ Grace\'s connection request marked as accepted');

    // Check that Henry's request remains presented
    const { data: henryReq } = await testDbClient
      .from('connection_requests')
      .select('status')
      .eq('id', requests[1])
      .single();

    expect(henryReq?.status).toBe('presented');
    console.log('✅ Henry\'s connection request remains presented');

    console.log('\n✅ Test passed: Correctly identified Grace\'s connection request only\n');
  }, 120000);
});
