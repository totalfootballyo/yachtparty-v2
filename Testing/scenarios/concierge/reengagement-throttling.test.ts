/**
 * Concierge Agent - Re-engagement Throttling Tests
 *
 * Tests Phase 3.5 re-engagement throttling implementation:
 * - 7-day minimum between re-engagement attempts
 * - 3-strike pause (no more than 3 unanswered attempts in 90 days)
 * - Proper logging of throttling actions
 *
 * These tests validate the anti-spam throttling logic implemented in
 * packages/agents/concierge/src/index.ts lines 333-456
 */

import { ConversationRunner } from '../../framework/ConversationRunner';
import { createTestDbClient } from '../../../packages/testing/src/helpers/db-utils';
import { cleanupTestData } from '../../framework/TestDataSetup';
import type { SimulatedPersona } from '../../framework/SimulatedUser';

describe('Concierge Agent - Re-engagement Throttling (Phase 3.5)', () => {
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
   * Scenario 1: First re-engagement (should send)
   *
   * User has been inactive for 7 days with no prior re-engagement attempts.
   * Agent should send a thoughtful re-engagement message.
   */
  it('should send first re-engagement message after 7 days of inactivity', async () => {
    // Create test persona
    const persona: SimulatedPersona = {
      name: 'Alex Chen',
      personality: 'engaged',
      initialContext: {
        company: 'DataCorp',
        title: 'VP Engineering',
        goal: 'Find executive coach for team',
      },
      responseStyle: {
        length: 'medium',
        enthusiasm: 'moderate',
        questions: true,
      },
    };

    // Run initial conversation to establish user
    console.log('\n📝 Setting up initial conversation...');
    const initialResult = await runner.runSimulation(
      persona,
      'concierge',
      5,
      'reengagement-test-1',
      false // Don't collect DB context yet
    );

    const userId = initialResult.user.id;
    testUserIds.push(userId);

    console.log(`✅ User created: ${userId}`);
    console.log(`✅ Initial conversation complete\n`);

    // Wait briefly to ensure messages are saved
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Simulate 7 days of inactivity (no re-engagement attempts)
    // (No setup needed - this is the baseline case)

    // Trigger re-engagement check by invoking agent with re_engagement_check system message
    const { invokeConciergeAgent } = await import('../../../packages/agents/concierge/src/index');

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

    // Create re-engagement check message
    const reengagementMessage = {
      id: crypto.randomUUID(),
      conversation_id: conversation!.id,
      user_id: userId,
      role: 'system' as const,
      content: JSON.stringify({
        type: 're_engagement_check',
        daysSinceLastMessage: 7,
        priorityCount: 2,
        hasActiveGoals: true,
      }),
      direction: 'inbound' as const,
      status: 'sent' as const,
      created_at: new Date(),
      twilio_message_sid: null,
      sent_at: null,
      delivered_at: null,
    };

    console.log('🔄 Triggering re-engagement check (7 days since last message)...');

    const response = await invokeConciergeAgent(
      reengagementMessage,
      user!,
      conversation!,
      testDbClient
    );

    console.log('Response:', response);

    // Validate: Agent should send message (not throttled)
    expect(response.immediateReply).toBe(true);
    expect(response.messages).toBeDefined();
    expect(response.messages!.length).toBeGreaterThan(0);

    console.log(`✅ Agent sent re-engagement message`);
    console.log(`Message: ${response.messages?.join('\n')}`);

    // Collect database context for judge
    const dbContext = await runner.collectDatabaseContext(userId, conversation!.id);

    // Validate: Agent should log re_engagement_message_sent
    const sentAction = dbContext.agentActionsLogged?.find(
      a => a.action_type === 're_engagement_message_sent'
    );
    expect(sentAction).toBeDefined();
    console.log(`✅ Logged re_engagement_message_sent action`);

    // Validate: Should NOT log throttled or paused
    const throttledAction = dbContext.agentActionsLogged?.find(
      a => a.action_type === 're_engagement_throttled'
    );
    const pausedAction = dbContext.agentActionsLogged?.find(
      a => a.action_type === 're_engagement_paused'
    );
    expect(throttledAction).toBeUndefined();
    expect(pausedAction).toBeUndefined();

    console.log(`✅ No throttling actions logged (correct)\n`);
  }, 60000);

  /**
   * Scenario 2: Throttled re-engagement (7-day rule)
   *
   * User inactive, but last re-engagement was only 3 days ago.
   * Agent should be SILENT and log re_engagement_throttled.
   */
  it('should throttle re-engagement if last attempt was <7 days ago', async () => {
    // Create test persona
    const persona: SimulatedPersona = {
      name: 'Jordan Lee',
      personality: 'terse',
      initialContext: {
        company: 'StartupCo',
        title: 'Founder',
        goal: 'Find investors',
      },
      responseStyle: {
        length: 'short',
        enthusiasm: 'low',
        questions: false,
      },
    };

    // Run initial conversation
    console.log('\n📝 Setting up initial conversation...');
    const initialResult = await runner.runSimulation(
      persona,
      'concierge',
      3,
      'reengagement-test-2',
      false
    );

    const userId = initialResult.user.id;
    testUserIds.push(userId);

    console.log(`✅ User created: ${userId}`);

    // Simulate past re-engagement attempt 3 days ago (user did respond)
    console.log('📝 Simulating re-engagement attempt 3 days ago...');
    await runner.setupPastReengagements(userId, [
      { daysAgo: 3, userResponded: true },
    ]);

    console.log(`✅ Past re-engagement simulated\n`);

    // Trigger re-engagement check
    const { invokeConciergeAgent } = await import('../../../packages/agents/concierge/src/index');

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

    const reengagementMessage = {
      id: crypto.randomUUID(),
      conversation_id: conversation!.id,
      user_id: userId,
      role: 'system' as const,
      content: JSON.stringify({
        type: 're_engagement_check',
        daysSinceLastMessage: 5,
        priorityCount: 1,
        hasActiveGoals: true,
      }),
      direction: 'inbound' as const,
      status: 'sent' as const,
      created_at: new Date(),
      twilio_message_sid: null,
      sent_at: null,
      delivered_at: null,
    };

    console.log('🔄 Triggering re-engagement check (5 days since last message, but 3 days since last attempt)...');

    const response = await invokeConciergeAgent(
      reengagementMessage,
      user!,
      conversation!,
      testDbClient
    );

    console.log('Response:', response);

    // Validate: Agent should NOT send message (throttled)
    expect(response.immediateReply).toBe(false);
    expect(!response.messages || response.messages.length === 0).toBe(true);

    console.log(`✅ Agent correctly throttled (silent)`);

    // Collect database context
    const dbContext = await runner.collectDatabaseContext(userId, conversation!.id);

    // Validate: Should log re_engagement_throttled
    const throttledAction = dbContext.agentActionsLogged?.find(
      a => a.action_type === 're_engagement_throttled'
    );
    expect(throttledAction).toBeDefined();
    console.log(`✅ Logged re_engagement_throttled action`);

    // Validate: Should NOT log message_sent
    const recentSentActions = dbContext.agentActionsLogged?.filter(
      a => a.action_type === 're_engagement_message_sent'
    );
    // Should only have the one from 3 days ago, not a new one
    expect(recentSentActions?.length).toBe(1);

    console.log(`✅ No new re_engagement_message_sent logged (correct)\n`);
  }, 60000);

  /**
   * Scenario 3: 3-strike pause
   *
   * User hasn't responded to 3 re-engagement attempts in 90 days.
   * Agent should be SILENT and log re_engagement_paused.
   */
  it('should pause re-engagement after 3 unanswered attempts in 90 days', async () => {
    // Create test persona
    const persona: SimulatedPersona = {
      name: 'Pat Rivera',
      personality: 'skeptical',
      initialContext: {
        company: 'TechFirm',
        title: 'CTO',
        goal: 'Evaluate community',
      },
      responseStyle: {
        length: 'medium',
        enthusiasm: 'low',
        questions: true,
      },
    };

    // Run initial conversation
    console.log('\n📝 Setting up initial conversation...');
    const initialResult = await runner.runSimulation(
      persona,
      'concierge',
      3,
      'reengagement-test-3',
      false
    );

    const userId = initialResult.user.id;
    testUserIds.push(userId);

    console.log(`✅ User created: ${userId}`);

    // Simulate 3 unanswered re-engagement attempts in the past 90 days
    console.log('📝 Simulating 3 unanswered re-engagement attempts...');
    await runner.setupPastReengagements(userId, [
      { daysAgo: 70, userResponded: false },
      { daysAgo: 50, userResponded: false },
      { daysAgo: 30, userResponded: false },
    ]);

    console.log(`✅ 3 unanswered attempts simulated (70, 50, 30 days ago)\n`);

    // Trigger re-engagement check
    const { invokeConciergeAgent } = await import('../../../packages/agents/concierge/src/index');

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

    const reengagementMessage = {
      id: crypto.randomUUID(),
      conversation_id: conversation!.id,
      user_id: userId,
      role: 'system' as const,
      content: JSON.stringify({
        type: 're_engagement_check',
        daysSinceLastMessage: 10,
        priorityCount: 2,
        hasActiveGoals: true,
      }),
      direction: 'inbound' as const,
      status: 'sent' as const,
      created_at: new Date(),
      twilio_message_sid: null,
      sent_at: null,
      delivered_at: null,
    };

    console.log('🔄 Triggering re-engagement check (after 3 unanswered attempts)...');

    const response = await invokeConciergeAgent(
      reengagementMessage,
      user!,
      conversation!,
      testDbClient
    );

    console.log('Response:', response);

    // Validate: Agent should NOT send message (paused)
    expect(response.immediateReply).toBe(false);
    expect(!response.messages || response.messages.length === 0).toBe(true);

    console.log(`✅ Agent correctly paused (silent)`);

    // Collect database context
    const dbContext = await runner.collectDatabaseContext(userId, conversation!.id);

    // Validate: Should log re_engagement_paused
    const pausedAction = dbContext.agentActionsLogged?.find(
      a => a.action_type === 're_engagement_paused'
    );
    expect(pausedAction).toBeDefined();
    expect(pausedAction?.input_data?.requiresManualOverride).toBe(true);
    console.log(`✅ Logged re_engagement_paused action with requiresManualOverride=true`);

    // Validate: Should NOT log message_sent
    const recentSentActions = dbContext.agentActionsLogged?.filter(
      a => a.action_type === 're_engagement_message_sent'
    );
    // Should only have the 3 from past attempts, not a new one
    expect(recentSentActions?.length).toBe(3);

    console.log(`✅ No new re_engagement_message_sent logged (correct)\n`);
  }, 60000);
});
