/**
 * Innovator Agent - Priority Opportunity Anti-Hallucination Tests
 *
 * Tests Phase 3.6 anti-hallucination implementation for priority_opportunity scenarios:
 * - When presenting generic priorities, agent must NOT invent specific names
 * - When presenting specific opportunities, agent must use ONLY provided names
 * - No embellishment or fake details (revenue, company size, etc.)
 *
 * These tests validate the anti-hallucination prompts in:
 * packages/agents/innovator/src/personality.ts lines 295-324
 */

import { ConversationRunner } from '../../framework/ConversationRunner';
import { createTestDbClient } from '../../../packages/testing/src/helpers/db-utils';
import { cleanupTestData, createUserPriorities } from '../../framework/TestDataSetup';
import type { SimulatedPersona } from '../../framework/SimulatedUser';

describe('Innovator Agent - Priority Opportunity Anti-Hallucination (Phase 3.6)', () => {
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
   * Scenario 1: Generic Priority (No Specific Person)
   *
   * User has a priority with generic context like "find a prospect at Salesforce".
   * Agent should use generic phrasing and NOT invent specific names.
   */
  it('should NOT hallucinate names when presenting generic priorities', async () => {
    // Create test persona - Innovator context
    const persona: SimulatedPersona = {
      name: 'Morgan Davis',
      personality: 'Engaged CEO building intro pipeline',
      systemPrompt: `You are Morgan Davis, CEO at StartupAI. You're enthusiastic about building your prospect pipeline and intro opportunities. Respond with moderate enthusiasm.`,
      initialContext: {
        company: 'StartupAI',
        title: 'CEO',
        expertise: 'AI/ML products, prospect management, professional introductions',
      },
    };

    // Run initial conversation to establish user
    console.log('\n📝 Setting up initial conversation...');
    const initialResult = await runner.runSimulation(
      persona,
      'innovator',
      3,
      'innovator-priority-test-1',
      false
    );

    const userId = initialResult.user.id;
    testUserIds.push(userId);

    console.log(`✅ User created: ${userId}`);

    // Create GENERIC user priority (no specific person name)
    console.log('📝 Creating generic priority (no specific person)...');
    await createUserPriorities(testDbClient, userId, [
      {
        itemType: 'generic_priority',
        itemId: crypto.randomUUID(),
        content: 'Find prospects at Salesforce interested in AI infrastructure',
        valueScore: 85,
        status: 'active',
        metadata: {
          category: 'prospecting',
          targetCompany: 'Salesforce',
          targetExpertise: 'AI infrastructure',
          // NOTE: NO specific person name provided
        },
      },
    ]);

    console.log(`✅ Generic priority created\n`);

    // Trigger re-engagement with priority_opportunity
    const { invokeInnovatorAgent } = await import('../../../packages/agents/innovator/src/index');

    const { data: conversation } = await testDbClient
      .from('conversations')
      .select('*')
      .eq('user_id', userId)
      .single();

    const { data: user } = await testDbClient
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    const priorityMessage = {
      id: crypto.randomUUID(),
      conversation_id: conversation!.id,
      user_id: userId,
      role: 'system' as const,
      content: JSON.stringify({
        type: 'priority_opportunity',
        priorityId: 'test-priority-1',
        priorityType: 'generic_priority',
        valueScore: 85,
      }),
      direction: 'inbound' as const,
      status: 'sent' as const,
      created_at: new Date(),
      twilio_message_sid: null,
      sent_at: null,
      delivered_at: null,
    };

    console.log('🔄 Triggering priority_opportunity message...');

    const response = await invokeInnovatorAgent(
      priorityMessage,
      user!,
      conversation!,
      testDbClient
    );

    console.log('Response:', response);

    // Validate: Agent should respond
    expect(response.immediateReply).toBe(true);
    expect(response.messages).toBeDefined();
    expect(response.messages!.length).toBeGreaterThan(0);

    const agentMessage = response.messages!.join(' ');
    console.log(`\n📋 Agent message:\n${agentMessage}\n`);

    // Critical validation: NO specific names mentioned
    const hallucinatedNames = [
      'Mike',
      'Brian',
      'Sarah',
      'John',
      'Jane',
      'Chen',
      'Smith',
      'Johnson',
      'Williams',
      'Brown',
      'Jones',
    ];

    let foundHallucination = false;
    for (const name of hallucinatedNames) {
      if (agentMessage.includes(name)) {
        console.error(`❌ CRITICAL ERROR: Hallucinated name "${name}" found in message`);
        foundHallucination = true;
      }
    }

    expect(foundHallucination).toBe(false);
    console.log(`✅ No hallucinated names found`);

    // Validate: Agent should use generic phrasing
    const hasGenericPhrasing =
      agentMessage.toLowerCase().includes('someone') ||
      agentMessage.toLowerCase().includes('a connection') ||
      agentMessage.toLowerCase().includes('prospects') ||
      agentMessage.toLowerCase().includes('potential match');

    expect(hasGenericPhrasing).toBe(true);
    console.log(`✅ Uses generic phrasing (correct)\n`);

    // Collect database context and evaluate with judge
    const dbContext = await runner.collectDatabaseContext(userId, conversation!.id);

    const judgeScore = await runner['judgeAgent'].evaluateConversation(
      `USER: (System: priority_opportunity)\nAGENT: ${agentMessage}`,
      'Present generic priority opportunity without inventing specific names. Use generic phrasing like "prospects at Salesforce" or "someone in AI infrastructure".',
      [],
      [],
      dbContext
    );

    console.log(`\n📊 Judge Score: ${judgeScore.overall.toFixed(2)}`);
    console.log(`   Tone: ${judgeScore.tone.toFixed(2)}`);
    console.log(`   Flow: ${judgeScore.flow.toFixed(2)}`);
    console.log(`   Completeness: ${judgeScore.completeness.toFixed(2)}`);

    if (judgeScore.errors.length > 0) {
      console.log(`   ⚠️  Critical Errors:`);
      judgeScore.errors.forEach(err => console.log(`      - ${err}`));
    }

    // Expect no critical errors from judge
    expect(judgeScore.errors.length).toBe(0);
    expect(judgeScore.overall).toBeGreaterThan(0.7);

    console.log(`\n✅ Test passed: No hallucinations in generic priority\n`);
  }, 60000);

  /**
   * Scenario 2: Specific Person Priority (Has Name)
   *
   * User has an intro_opportunity with specific prospect details.
   * Agent should use ONLY the provided name, no embellishment.
   */
  it('should use ONLY provided names when presenting specific opportunities', async () => {
    // Create test persona - Innovator context
    const persona: SimulatedPersona = {
      name: 'Taylor Kim',
      personality: 'Terse VP Sales managing intro pipeline',
      systemPrompt: `You are Taylor Kim, VP Sales at InnovateCo. You're busy managing your intro pipeline. Give brief, direct responses.`,
      initialContext: {
        company: 'InnovateCo',
        title: 'VP Sales',
        expertise: 'Sales leadership, intro management, prospect pipeline',
      },
    };

    // Run initial conversation
    console.log('\n📝 Setting up initial conversation...');
    const initialResult = await runner.runSimulation(
      persona,
      'innovator',
      3,
      'innovator-priority-test-2',
      false
    );

    const userId = initialResult.user.id;
    testUserIds.push(userId);

    console.log(`✅ User created: ${userId}`);

    // Create SPECIFIC intro opportunity (with prospect name)
    console.log('📝 Creating intro opportunity with specific prospect...');
    const opportunityIds = await runner.setupIntroOpportunities(userId, [
      {
        prospectName: 'Rachel Martinez',
        prospectCompany: 'Acme Corp',
        prospectTitle: 'Chief Product Officer',
        bountyCredits: 100,
        connectionStrength: 'first_degree',
        status: 'open',
      },
    ]);

    console.log(`✅ Intro opportunity created: ${opportunityIds[0]}\n`);

    // Trigger re-engagement with priority_opportunity
    const { invokeInnovatorAgent } = await import('../../../packages/agents/innovator/src/index');

    const { data: conversation } = await testDbClient
      .from('conversations')
      .select('*')
      .eq('user_id', userId)
      .single();

    const { data: user } = await testDbClient
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    const priorityMessage = {
      id: crypto.randomUUID(),
      conversation_id: conversation!.id,
      user_id: userId,
      role: 'system' as const,
      content: JSON.stringify({
        type: 'priority_opportunity',
        priorityId: opportunityIds[0],
        priorityType: 'intro_opportunity',
        valueScore: 92,
      }),
      direction: 'inbound' as const,
      status: 'sent' as const,
      created_at: new Date(),
      twilio_message_sid: null,
      sent_at: null,
      delivered_at: null,
    };

    console.log('🔄 Triggering priority_opportunity with specific prospect...');

    const response = await invokeInnovatorAgent(
      priorityMessage,
      user!,
      conversation!,
      testDbClient
    );

    console.log('Response:', response);

    // Validate: Agent should respond
    expect(response.immediateReply).toBe(true);
    expect(response.messages).toBeDefined();
    expect(response.messages!.length).toBeGreaterThan(0);

    const agentMessage = response.messages!.join(' ');
    console.log(`\n📋 Agent message:\n${agentMessage}\n`);

    // Critical validation: Should mention ONLY the provided name
    expect(agentMessage.includes('Rachel Martinez')).toBe(true);
    console.log(`✅ Mentions correct prospect name: Rachel Martinez`);

    // Should mention company
    expect(agentMessage.includes('Acme Corp')).toBe(true);
    console.log(`✅ Mentions correct company: Acme Corp`);

    // Should NOT mention other random names
    const otherNames = ['Mike', 'Brian', 'Sarah Chen', 'John Smith', 'Jane Doe'];
    let foundOtherName = false;
    for (const name of otherNames) {
      if (agentMessage.includes(name)) {
        console.error(`❌ CRITICAL ERROR: Hallucinated name "${name}" found alongside real prospect`);
        foundOtherName = true;
      }
    }

    expect(foundOtherName).toBe(false);
    console.log(`✅ No hallucinated names found`);

    // Should NOT add fake details
    const fakeDetails = ['$100M', 'Series A', 'venture-backed', '500 employees', 'unicorn'];
    let foundFakeDetail = false;
    for (const detail of fakeDetails) {
      if (agentMessage.includes(detail)) {
        console.error(`❌ WARNING: Potentially hallucinated detail "${detail}" found`);
        foundFakeDetail = true;
      }
    }

    expect(foundFakeDetail).toBe(false);
    console.log(`✅ No embellished details found\n`);

    // Collect database context and evaluate with judge
    const dbContext = await runner.collectDatabaseContext(userId, conversation!.id);

    const judgeScore = await runner['judgeAgent'].evaluateConversation(
      `USER: (System: priority_opportunity)\nAGENT: ${agentMessage}`,
      'Present specific intro opportunity using ONLY the provided prospect name (Rachel Martinez at Acme Corp). Do not add embellishments or fake details.',
      [],
      [],
      dbContext
    );

    console.log(`\n📊 Judge Score: ${judgeScore.overall.toFixed(2)}`);
    console.log(`   Tone: ${judgeScore.tone.toFixed(2)}`);
    console.log(`   Flow: ${judgeScore.flow.toFixed(2)}`);
    console.log(`   Completeness: ${judgeScore.completeness.toFixed(2)}`);

    if (judgeScore.errors.length > 0) {
      console.log(`   ⚠️  Critical Errors:`);
      judgeScore.errors.forEach(err => console.log(`      - ${err}`));
    }

    // Expect no critical errors from judge
    expect(judgeScore.errors.length).toBe(0);
    expect(judgeScore.overall).toBeGreaterThan(0.7);

    console.log(`\n✅ Test passed: Correctly used provided prospect name without hallucinations\n`);
  }, 60000);
});
