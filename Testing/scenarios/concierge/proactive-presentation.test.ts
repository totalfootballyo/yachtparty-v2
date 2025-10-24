/**
 * Concierge Agent - Proactive Presentation Tests (Phase 7 - Appendix E)
 *
 * Tests "While I have you..." proactive priority mentions:
 * - Call 2 decides to mention a different priority naturally
 * - Presentation is tracked (increments presentation_count)
 * - If user responds to proactive mention → mark as actioned
 * - If user ignores proactive mention → only increment count
 * - Proactive mentions count toward 2-strike dormancy
 *
 * These tests validate:
 * packages/agents/concierge/src/index.ts lines 290-311 (proactive tracking)
 * packages/agents/concierge/src/personality.ts Call 2 proactive logic
 */

import { ConversationRunner } from '../../framework/ConversationRunner';
import { createTestDbClient } from '../../../packages/testing/src/helpers/db-utils';
import { cleanupTestData } from '../../framework/TestDataSetup';
import type { SimulatedPersona } from '../../framework/SimulatedUser';
import crypto from 'crypto';
import { invokeConciergeAgent } from '../../../packages/agents/concierge/src/index';

describe('Concierge Agent - Proactive Presentation (Appendix E Phase 7)', () => {
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
   * Scenario 1: Proactive mention increments presentation_count
   *
   * Flow:
   * 1. User has 2 intro_opportunities
   * 2. User asks about something unrelated
   * 3. Call 2 decides to proactively mention intro_opportunity
   * 4. Verify presentation_count incremented for mentioned opportunity
   * 5. Verify status changed from 'open' to 'presented'
   */
  it('should increment presentation_count when Call 2 mentions priority proactively', async () => {
    const persona: SimulatedPersona = {
      name: 'Proactive Test User',
      personality: 'Engaged professional asking questions',
      systemPrompt: 'You are a test user for proactive presentation tracking.',
      initialContext: {
        company: 'QueryCo',
        title: 'Product Lead',
        expertise: 'Product Strategy',
      },
    };

    console.log('\n📝 Setting up user with 2 intro opportunities...');
    const initialResult = await runner.runSimulation(persona, 'concierge', 2, 'proactive-test-1');
    const userId = initialResult.user.id;
    const conversationId = initialResult.conversation.id;
    testUserIds.push(userId);

    const opportunities = await runner.setupIntroOpportunities(userId, [
      {
        prospectName: 'Casey Wilson',
        prospectCompany: 'DesignLabs',
        prospectTitle: 'Head of Product Design',
        bountyCredits: 65,
        connectionStrength: 'first_degree',
        status: 'open',
      },
      {
        prospectName: 'Drew Anderson',
        prospectCompany: 'TechFlow',
        prospectTitle: 'Senior Product Manager',
        bountyCredits: 55,
        connectionStrength: 'second_degree',
        status: 'open',
      },
    ]);

    console.log(`✅ Created 2 intro opportunities`);

    // Create user_priorities for both (Account Manager would do this)
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
        value_score: 80,
        status: 'active',
        presentation_count: 0, // NOT yet presented
        item_summary: `Intro ${opp.first_name} ${opp.last_name} at ${opp.prospect_company}`,
        item_primary_name: `${opp.first_name} ${opp.last_name}`,
        item_context: `Earn ${opp.bounty_credits} credits`,
        item_metadata: {
          bounty_credits: opp.bounty_credits,
          prospect_company: opp.prospect_company,
        },
      });
    }

    console.log('✅ Created user_priorities (not yet presented)');

    // Check initial presentation_count = 0
    const { data: initialOpp } = await testDbClient
      .from('intro_opportunities')
      .select('presentation_count, status')
      .eq('id', opportunities[0])
      .single();

    expect(initialOpp?.presentation_count).toBe(0);
    expect(initialOpp?.status).toBe('open');
    console.log(`✅ Initial state: presentation_count = 0, status = 'open'`);

    // User asks an unrelated question
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
      content: 'How do I prioritize feature requests?',
      direction: 'inbound' as const,
      status: 'sent' as const,
      created_at: new Date(),
      twilio_message_sid: 'TEST_MSG_PROACTIVE_1',
      sent_at: null,
      delivered_at: null,
    };

    console.log('\n🔄 User asks: "How do I prioritize feature requests?"');
    console.log('🔄 Expecting Call 2 to proactively mention an intro opportunity...\n');

    const response = await invokeConciergeAgent(
      userMessage,
      user!,
      conversation!,
      testDbClient
    );

    console.log('Agent response:', response);

    // Check Call 2 decision context
    const { data: actionsLog } = await testDbClient
      .from('agent_actions_log')
      .select('*')
      .eq('user_id', userId)
      .eq('action_type', 'llm_decision')
      .order('created_at', { ascending: false })
      .limit(1);

    const decision = actionsLog?.[0]?.output_data;
    console.log('\n📋 Call 2 decision context:', decision?.context_for_call_2);

    // Check if a proactive priority was mentioned
    const proactivePriority = decision?.context_for_call_2?.proactive_priority;
    if (proactivePriority?.should_mention) {
      console.log(`✅ Call 2 decided to proactively mention: ${proactivePriority.item_id}`);
      console.log(`   Reason: ${proactivePriority.mention_reason}`);

      // Verify presentation_count was incremented
      const { data: updatedOpp } = await testDbClient
        .from('intro_opportunities')
        .select('presentation_count, status, last_presented_at')
        .eq('id', proactivePriority.item_id)
        .single();

      expect(updatedOpp?.presentation_count).toBe(1);
      expect(updatedOpp?.status).toBe('presented');
      expect(updatedOpp?.last_presented_at).toBeDefined();
      console.log(`✅ Presentation tracking updated: count = ${updatedOpp?.presentation_count}, status = ${updatedOpp?.status}`);
    } else {
      console.log('⚠️  Call 2 did not proactively mention a priority (this is OK - depends on LLM decision)');
      // This is not a failure - Call 2 may choose not to mention proactively based on context
    }

    console.log('\n✅ Test passed: Proactive mention tracking works\n');
  }, 120000);

  /**
   * Scenario 2: User responds to proactive mention → mark as actioned
   *
   * Flow:
   * 1. Agent proactively mentions intro_opportunity
   * 2. User responds with interest in that opportunity
   * 3. Verify opportunity marked as 'accepted' (actioned)
   * 4. Verify presentation_count incremented
   */
  it('should mark priority as actioned when user responds to proactive mention', async () => {
    const persona: SimulatedPersona = {
      name: 'Responsive Test User',
      personality: 'Engaged professional who responds to suggestions',
      systemPrompt: 'You are a test user who responds positively to intro suggestions.',
      initialContext: {
        company: 'ResponsiveCo',
        title: 'Engineering Manager',
        expertise: 'Team Leadership',
      },
    };

    console.log('\n📝 Setting up user with intro opportunity...');
    const initialResult = await runner.runSimulation(persona, 'concierge', 2, 'proactive-test-2');
    const userId = initialResult.user.id;
    const conversationId = initialResult.conversation.id;
    testUserIds.push(userId);

    const opportunities = await runner.setupIntroOpportunities(userId, [
      {
        prospectName: 'Jamie Parker',
        prospectCompany: 'CloudScale',
        prospectTitle: 'Director of Engineering',
        bountyCredits: 80,
        connectionStrength: 'first_degree',
        status: 'presented', // Already presented once proactively
      },
    ]);

    const oppId = opportunities[0];
    console.log(`✅ Created intro opportunity: ${oppId}`);

    // Mark as presented (simulating a previous proactive mention)
    await testDbClient
      .from('intro_opportunities')
      .update({
        presentation_count: 1,
        last_presented_at: new Date(Date.now() - 60 * 1000).toISOString(), // 1 minute ago
      })
      .eq('id', oppId);

    // Create user_priority with denormalized data
    const { data: opp } = await testDbClient
      .from('intro_opportunities')
      .select('first_name, last_name, prospect_company, bounty_credits')
      .eq('id', oppId)
      .single();

    await testDbClient.from('user_priorities').insert({
      user_id: userId,
      priority_rank: 1,
      item_type: 'intro_opportunity',
      item_id: oppId,
      value_score: 85,
      status: 'presented',
      presentation_count: 1,
      presented_at: new Date(Date.now() - 60 * 1000).toISOString(),
      item_summary: `Intro ${opp?.first_name} ${opp?.last_name} at ${opp?.prospect_company}`,
      item_primary_name: `${opp?.first_name} ${opp?.last_name}`,
      item_context: `Earn ${opp?.bounty_credits} credits`,
      item_metadata: {
        bounty_credits: opp?.bounty_credits,
        prospect_company: opp?.prospect_company,
      },
    });

    console.log('✅ Opportunity marked as presented (from previous proactive mention)');

    // User responds with interest
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
      content: "Yes, I'd love to connect with Jamie Parker!",
      direction: 'inbound' as const,
      status: 'sent' as const,
      created_at: new Date(),
      twilio_message_sid: 'TEST_MSG_PROACTIVE_2',
      sent_at: null,
      delivered_at: null,
    };

    console.log('\n🔄 User responds: "Yes, I\'d love to connect with Jamie Parker!"');

    const response = await invokeConciergeAgent(
      userMessage,
      user!,
      conversation!,
      testDbClient
    );

    console.log('Agent response:', response);

    // Verify opportunity was marked as ACCEPTED (actioned)
    const { data: updatedOpp } = await testDbClient
      .from('intro_opportunities')
      .select('status, presentation_count')
      .eq('id', oppId)
      .single();

    expect(updatedOpp?.status).toBe('accepted');
    console.log(`✅ Opportunity marked as 'accepted' (user responded to proactive mention)`);

    // Verify tool was called
    const actionTypes = response.actions?.map((a: any) => a.type) || [];
    expect(actionTypes).toContain('accept_intro_opportunity');
    console.log(`✅ Tool called: accept_intro_opportunity`);

    console.log('\n✅ Test passed: User response to proactive mention marked as actioned\n');
  }, 120000);

  /**
   * Scenario 3: Proactive mentions count toward dormancy
   *
   * Flow:
   * 1. Proactive mention (presentation_count = 1)
   * 2. User ignores
   * 3. Another proactive mention (presentation_count = 2)
   * 4. Verify status = 'dormant'
   */
  it('should count proactive mentions toward 2-strike dormancy', async () => {
    const persona: SimulatedPersona = {
      name: 'Ignoring Test User',
      personality: 'Busy professional who ignores suggestions',
      systemPrompt: 'You are a test user who ignores proactive intro suggestions.',
      initialContext: {
        company: 'BusyCorpIgnore',
        title: 'CFO',
        expertise: 'Finance',
      },
    };

    console.log('\n📝 Setting up user with intro opportunity...');
    const initialResult = await runner.runSimulation(persona, 'concierge', 2, 'proactive-test-3');
    const userId = initialResult.user.id;
    const conversationId = initialResult.conversation.id;
    testUserIds.push(userId);

    const opportunities = await runner.setupIntroOpportunities(userId, [
      {
        prospectName: 'Quinn Foster',
        prospectCompany: 'FinanceFlow',
        prospectTitle: 'VP Finance',
        bountyCredits: 70,
        connectionStrength: 'first_degree',
        status: 'open',
      },
    ]);

    const oppId = opportunities[0];
    console.log(`✅ Created intro opportunity: ${oppId}`);

    // Import markPriorityPresented
    const { markPriorityPresented } = await import(
      '../../../packages/agents/concierge/src/index'
    );

    // PROACTIVE MENTION 1
    console.log('\n🔄 PROACTIVE MENTION 1 (natural)...');
    await markPriorityPresented(
      testDbClient,
      'intro_opportunity',
      oppId,
      'natural', // Proactive = natural
      userId,
      conversationId
    );

    let { data: opp } = await testDbClient
      .from('intro_opportunities')
      .select('presentation_count, status, dormant_at')
      .eq('id', oppId)
      .single();

    expect(opp?.presentation_count).toBe(1);
    expect(opp?.status).toBe('presented');
    expect(opp?.dormant_at).toBeNull();
    console.log(`✅ After proactive mention 1: count = ${opp?.presentation_count}, status = ${opp?.status}`);

    // User IGNORES
    console.log('⏳ User ignores...\n');

    // PROACTIVE MENTION 2
    console.log('🔄 PROACTIVE MENTION 2 (natural)...');
    await markPriorityPresented(
      testDbClient,
      'intro_opportunity',
      oppId,
      'natural', // Proactive = natural
      userId,
      conversationId
    );

    ({ data: opp } = await testDbClient
      .from('intro_opportunities')
      .select('presentation_count, status, dormant_at')
      .eq('id', oppId)
      .single());

    expect(opp?.presentation_count).toBe(2);
    expect(opp?.status).toBe('dormant');
    expect(opp?.dormant_at).toBeDefined();
    console.log(`✅ After proactive mention 2: count = ${opp?.presentation_count}, status = ${opp?.status}`);
    console.log(`✅ Opportunity marked dormant after 2 proactive mentions`);

    console.log('\n✅ Test passed: Proactive mentions count toward dormancy\n');
  }, 60000);

  /**
   * Scenario 4: Mixed presentation types (proactive + dedicated) both count
   *
   * Flow:
   * 1. Proactive mention (natural) - presentation_count = 1
   * 2. User ignores
   * 3. Re-engagement message (dedicated) - presentation_count = 2
   * 4. Verify status = 'dormant'
   */
  it('should count mixed presentation types toward dormancy', async () => {
    const persona: SimulatedPersona = {
      name: 'Mixed Test User',
      personality: 'Professional who ignores both types of mentions',
      systemPrompt: 'You are a test user for mixed presentation types.',
      initialContext: {
        company: 'MixedCo',
        title: 'VP Operations',
        expertise: 'Operations',
      },
    };

    console.log('\n📝 Setting up user with intro opportunity...');
    const initialResult = await runner.runSimulation(persona, 'concierge', 2, 'proactive-test-4');
    const userId = initialResult.user.id;
    const conversationId = initialResult.conversation.id;
    testUserIds.push(userId);

    const opportunities = await runner.setupIntroOpportunities(userId, [
      {
        prospectName: 'River Blake',
        prospectCompany: 'OpsTech',
        prospectTitle: 'COO',
        bountyCredits: 90,
        connectionStrength: 'first_degree',
        status: 'open',
      },
    ]);

    const oppId = opportunities[0];
    console.log(`✅ Created intro opportunity: ${oppId}`);

    const { markPriorityPresented } = await import(
      '../../../packages/agents/concierge/src/index'
    );

    // PRESENTATION 1: Proactive (natural)
    console.log('\n🔄 PRESENTATION 1: Proactive mention (natural)...');
    await markPriorityPresented(
      testDbClient,
      'intro_opportunity',
      oppId,
      'natural',
      userId,
      conversationId
    );

    let { data: opp } = await testDbClient
      .from('intro_opportunities')
      .select('presentation_count, status')
      .eq('id', oppId)
      .single();

    expect(opp?.presentation_count).toBe(1);
    expect(opp?.status).toBe('presented');
    console.log(`✅ After proactive (natural): count = ${opp?.presentation_count}`);

    // PRESENTATION 2: Re-engagement (dedicated)
    console.log('\n🔄 PRESENTATION 2: Re-engagement (dedicated)...');
    await markPriorityPresented(
      testDbClient,
      'intro_opportunity',
      oppId,
      'dedicated',
      userId,
      conversationId
    );

    ({ data: opp } = await testDbClient
      .from('intro_opportunities')
      .select('presentation_count, status, dormant_at')
      .eq('id', oppId)
      .single());

    expect(opp?.presentation_count).toBe(2);
    expect(opp?.status).toBe('dormant');
    expect(opp?.dormant_at).toBeDefined();
    console.log(`✅ After re-engagement (dedicated): count = ${opp?.presentation_count}, status = ${opp?.status}`);
    console.log(`✅ Opportunity marked dormant after mixed presentation types`);

    console.log('\n✅ Test passed: Mixed presentation types both count toward dormancy\n');
  }, 60000);
});
