/**
 * Conversation Runner
 *
 * Orchestrates simulation tests by:
 * - Creating test users in test database
 * - Running simulated conversations between persona and agent
 * - Evaluating conversations with judge agent
 * - Saving transcripts and scores
 */

import crypto from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import type { User, Conversation, Message } from '../../packages/shared/src/types/database';
import { SimulatedUser, type SimulatedPersona } from './SimulatedUser';
import { JudgeAgent, type JudgeScore, type DatabaseContext } from './JudgeAgent';
import { TestReporter } from './TestReporter';
import { createTestDbClient } from '../../packages/testing/src/helpers/db-utils';
import {
  createIntroOpportunities,
  createConnectionRequests,
  createIntroOffers,
  simulatePastReengagements as simulateReengagements
} from './TestDataSetup';

// Import agent entry points
import { invokeBouncerAgent } from '../../packages/agents/bouncer/src/index';
import { invokeConciergeAgent } from '../../packages/agents/concierge/src/index';
import { invokeInnovatorAgent } from '../../packages/agents/innovator/src/index';

export interface SimulationResult {
  transcript: string;
  judgeScore: JudgeScore;
  toolsUsed: string[];
  messagesExchanged: number;
  durationMs: number;
  user: User;
  conversation: Conversation;
}

export type AgentType = 'bouncer' | 'concierge' | 'innovator';

export class ConversationRunner {
  private dbClient: SupabaseClient;
  private judgeAgent: JudgeAgent;
  private reporter: TestReporter;

  constructor() {
    this.dbClient = createTestDbClient();
    this.judgeAgent = new JudgeAgent();
    this.reporter = new TestReporter();
  }

  /**
   * Setup Methods - Create test data before running simulations
   */

  /**
   * Creates intro opportunities for a user to test Concierge/Innovator intro flows.
   */
  async setupIntroOpportunities(
    userId: string,
    opportunities: Array<{
      prospectName: string;
      prospectCompany: string;
      prospectTitle?: string;
      bountyCredits: number;
      connectionStrength: 'first_degree' | 'second_degree' | 'third_degree';
      status?: 'open' | 'accepted' | 'paused' | 'cancelled' | 'completed';
    }>
  ): Promise<string[]> {
    return await createIntroOpportunities(this.dbClient, userId, opportunities);
  }

  /**
   * Creates connection requests for a user to test introducee scenarios.
   */
  async setupConnectionRequests(
    userId: string,
    requests: Array<{
      requestorName: string;
      requestorCompany: string;
      introContext: string;
      requestorCreditsSpent: number;
      vouchedByUserIds?: string[];
      status?: 'open' | 'accepted' | 'declined' | 'completed';
    }>
  ): Promise<string[]> {
    return await createConnectionRequests(this.dbClient, userId, requests);
  }

  /**
   * Creates intro offers for testing dual-role intro scenarios.
   */
  async setupIntroOffers(
    offers: Array<{
      offeringUserId: string;
      introduceeUserId: string;
      prospectName: string;
      prospectCompany: string;
      prospectContext: string;
      contextType: 'community_request' | 'nomination' | 'direct_offer';
      bountyCredits: number;
      status?:
        | 'pending_introducee_response'
        | 'pending_connector_confirmation'
        | 'confirmed'
        | 'declined'
        | 'completed';
    }>
  ): Promise<string[]> {
    return await createIntroOffers(this.dbClient, offers);
  }

  /**
   * Simulates past re-engagement attempts for throttling tests.
   * Critical for testing Phase 3.5 re-engagement throttling logic.
   */
  async setupPastReengagements(
    userId: string,
    attempts: Array<{
      daysAgo: number;
      userResponded: boolean;
    }>
  ): Promise<void> {
    return await simulateReengagements(this.dbClient, userId, attempts);
  }

  /**
   * Collects database context for judge evaluation.
   * Call this after simulation completes to pass to judge agent.
   */
  async collectDatabaseContext(userId: string, conversationId: string): Promise<DatabaseContext> {
    // Get agent actions logged during the conversation
    const { data: actions } = await this.dbClient
      .from('agent_actions_log')
      .select('action_type, created_at, input_data')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    // Get state transitions (we'll look for status changes in intro-related tables)
    const stateTransitions: Array<{
      table: string;
      record_id: string;
      old_status: string;
      new_status: string;
    }> = [];

    // Check intro_opportunities for status changes
    const { data: opportunities } = await this.dbClient
      .from('intro_opportunities')
      .select('id, status, updated_at')
      .eq('connector_user_id', userId);

    if (opportunities) {
      opportunities.forEach(opp => {
        // In a real scenario, we'd track old vs new status
        // For now, we'll report current status as a transition
        if (opp.status !== 'open') {
          stateTransitions.push({
            table: 'intro_opportunities',
            record_id: opp.id,
            old_status: 'open',
            new_status: opp.status
          });
        }
      });
    }

    return {
      agentActionsLogged: actions || [],
      stateTransitions
    };
  }

  /**
   * Runs a complete simulated conversation between user persona and specified agent.
   *
   * @param persona - Synthetic user persona to simulate
   * @param agentType - Which agent to test (bouncer, concierge, innovator)
   * @param maxTurns - Maximum conversation turns (default 20)
   * @param batchId - Optional batch ID for multi-user scenarios
   * @param collectDbContext - Whether to collect database context for judge (default false)
   * @returns Simulation result with transcript, scores, and metadata
   */
  async runSimulation(
    persona: SimulatedPersona,
    agentType: AgentType,
    maxTurns: number = 20,
    batchId?: string,
    collectDbContext: boolean = false
  ): Promise<SimulationResult> {
    const startTime = Date.now();
    const transcript: string[] = [];
    const toolsUsed: string[] = [];

    // Create test user and conversation
    const { user, conversation } = await this.createTestUser(agentType, persona, batchId);

    // Create simulated user
    const simulatedUser = new SimulatedUser(persona);

    // Get initial message from simulated user
    let userMessage = await simulatedUser.getInitialMessage();
    let turn = 0;

    console.log(`\n=== Starting ${agentType} simulation with ${persona.name} ===`);
    console.log(`User ID: ${user.id}`);
    console.log(`Conversation ID: ${conversation.id}\n`);

    while (turn < maxTurns) {
      turn++;

      console.log(`Turn ${turn}:`);
      console.log(`USER: ${userMessage}`);

      // Record user message in DB
      const savedMessage = await this.saveUserMessage(
        conversation.id,
        user.id,
        userMessage
      );

      transcript.push(`USER: ${userMessage}`);

      // Invoke the appropriate agent with test DB client
      const agentResponse = await this.invokeAgent(
        agentType,
        savedMessage,
        user,
        conversation
      );

      // Check if agent responded
      if (!agentResponse.messages || agentResponse.messages.length === 0) {
        console.log('AGENT: (no response)');
        console.log('⚠️  Agent did not respond - ending conversation');
        break;
      }

      const agentMessage = agentResponse.messages.join('\n---\n');
      console.log(`AGENT: ${agentMessage}`);

      // Save agent message to DB
      await this.saveAgentMessage(
        conversation.id,
        user.id,
        agentType,
        agentMessage
      );

      transcript.push(`AGENT: ${agentMessage}`);

      // Track tools used
      if (agentResponse.actions) {
        const actionTypes = agentResponse.actions.map((a: any) => a.type);
        toolsUsed.push(...actionTypes);
        console.log(`Tools used: ${actionTypes.join(', ')}`);

        // MOCK: Email verification webhook
        // When agent requests email verification, auto-verify in test environment
        if (actionTypes.includes('create_verification_task')) {
          console.log('🔧 [TEST MOCK] Simulating email verification webhook...');

          // Mock email address if not already set
          const mockEmail = user.email || `${persona.name.toLowerCase().replace(/\s+/g, '.')}@${persona.initialContext.company?.toLowerCase().replace(/\s+/g, '')}.com`;

          // Update user: mark email_verified, save email
          await this.dbClient
            .from('users')
            .update({
              email_verified: true,
              email: mockEmail,
              updated_at: new Date().toISOString()
            })
            .eq('id', user.id);

          console.log(`✅ [TEST MOCK] Email verified: ${mockEmail}`);

          // Trigger email acknowledgment by invoking agent with system message
          const systemMessage: any = {
            id: crypto.randomUUID(),
            conversation_id: conversation.id,
            user_id: user.id,
            role: 'system',
            content: 'email_verified_acknowledgment',
            direction: 'inbound',
            twilio_message_sid: null,
            status: null,
            created_at: new Date(),
            sent_at: null,
            delivered_at: null
          };

          // Get updated user with email_verified = true
          const { data: updatedUser } = await this.dbClient
            .from('users')
            .select('*')
            .eq('id', user.id)
            .single();

          if (updatedUser) {
            const ackResponse = await this.invokeAgent(
              agentType,
              systemMessage,
              updatedUser,
              conversation
            );

            if (ackResponse.messages && ackResponse.messages.length > 0) {
              const ackMessage = ackResponse.messages.join('\n---\n');
              console.log(`AGENT: ${ackMessage}`);

              await this.saveAgentMessage(
                conversation.id,
                user.id,
                agentType,
                ackMessage
              );

              transcript.push(`AGENT: ${ackMessage}`);

              // Let simulated user respond to acknowledgment
              userMessage = await simulatedUser.respondTo(ackMessage);
              console.log(`USER: ${userMessage}`);
            }
          }
        }
      }

      // Check for completion conditions
      if (this.isConversationComplete(agentResponse, agentType)) {
        console.log('✅ Conversation complete!');
        break;
      }

      // Get simulated user's next response
      userMessage = await simulatedUser.respondTo(agentMessage);
      console.log('');
    }

    console.log(`\n=== Simulation complete: ${turn} turns ===\n`);

    // Optionally collect database context for judge evaluation
    let dbContext: DatabaseContext | undefined;
    if (collectDbContext) {
      console.log('Collecting database context for judge evaluation...');
      dbContext = await this.collectDatabaseContext(user.id, conversation.id);
      console.log(`  - Agent actions logged: ${dbContext.agentActionsLogged?.length || 0}`);
      console.log(`  - State transitions: ${dbContext.stateTransitions?.length || 0}`);
    }

    // Evaluate conversation with judge
    console.log('Evaluating conversation with judge agent...');
    const judgeScore = await this.judgeAgent.evaluateConversation(
      transcript.join('\n\n'),
      this.getExpectedBehavior(agentType),
      this.getExpectedTools(agentType),
      toolsUsed,  // Pass the actual tools that were used
      dbContext   // Pass database context if collected
    );

    console.log(`Judge Score: ${judgeScore.overall.toFixed(2)}`);
    console.log(`  Tone: ${judgeScore.tone.toFixed(2)}`);
    console.log(`  Flow: ${judgeScore.flow.toFixed(2)}`);
    console.log(`  Completeness: ${judgeScore.completeness.toFixed(2)}`);
    if (judgeScore.errors.length > 0) {
      console.log(`  Critical Errors: ${judgeScore.errors.length}`);
    }

    // Fetch final user and conversation state from database
    const { data: finalUser } = await this.dbClient
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();

    const { data: finalConversation } = await this.dbClient
      .from('conversations')
      .select('*')
      .eq('id', conversation.id)
      .single();

    // Save transcript and scores
    await this.reporter.saveTranscript(
      `${agentType}-${persona.name.toLowerCase().replace(/ /g, '-')}`,
      {
        transcript: transcript.join('\n\n'),
        judgeScore,
        toolsUsed,
        messagesExchanged: turn * 2,
        durationMs: Date.now() - startTime,
        user: finalUser || user,  // Use final state from DB, fallback to original
        conversation: finalConversation || conversation
      }
    );

    return {
      transcript: transcript.join('\n\n'),
      judgeScore,
      toolsUsed,
      messagesExchanged: turn * 2,
      durationMs: Date.now() - startTime,
      user: finalUser || user,  // Return final state from DB
      conversation: finalConversation || conversation
    };
  }

  /**
   * Creates a test user and conversation in the test database.
   */
  private async createTestUser(
    agentType: AgentType,
    persona: SimulatedPersona,
    batchId?: string
  ): Promise<{ user: User; conversation: Conversation }> {
    // Create user
    const { data: user, error: userError } = await this.dbClient
      .from('users')
      .insert({
        phone_number: `+1555${Math.floor(Math.random() * 10000000)}`,
        verified: false,
        poc_agent_type: agentType === 'bouncer' ? 'concierge' : agentType
      })
      .select()
      .single();

    if (userError || !user) {
      throw new Error(`Failed to create test user: ${userError?.message}`);
    }

    // Create conversation
    const { data: conversation, error: convError } = await this.dbClient
      .from('conversations')
      .insert({
        user_id: user.id,
        phone_number: user.phone_number,
        status: 'active'
      })
      .select()
      .single();

    if (convError || !conversation) {
      throw new Error(`Failed to create conversation: ${convError?.message}`);
    }

    return { user: user as User, conversation: conversation as Conversation };
  }

  /**
   * Saves a user message to the database.
   */
  private async saveUserMessage(
    conversationId: string,
    userId: string,
    content: string
  ): Promise<Message> {
    const { data, error } = await this.dbClient
      .from('messages')
      .insert({
        conversation_id: conversationId,
        user_id: userId,
        role: 'user',
        content,
        direction: 'inbound',
        status: 'sent',
        created_at: new Date().toISOString(),
        twilio_message_sid: `TEST_${Date.now()}`
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to save user message: ${error?.message}`);
    }

    return data as Message;
  }

  /**
   * Saves an agent message to the database.
   */
  private async saveAgentMessage(
    conversationId: string,
    userId: string,
    role: string,
    content: string
  ): Promise<void> {
    const { error } = await this.dbClient
      .from('messages')
      .insert({
        conversation_id: conversationId,
        user_id: userId,
        role,
        content,
        direction: 'outbound',
        status: 'sent',
        created_at: new Date().toISOString()
      });

    if (error) {
      throw new Error(`Failed to save agent message: ${error.message}`);
    }
  }

  /**
   * Invokes the appropriate agent based on agent type.
   */
  private async invokeAgent(
    agentType: AgentType,
    message: Message,
    user: User,
    conversation: Conversation
  ): Promise<any> {
    // Refresh user from DB to get latest state
    const { data: currentUser } = await this.dbClient
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();

    const updatedUser = currentUser as User || user;

    switch (agentType) {
      case 'bouncer':
        return await invokeBouncerAgent(message, updatedUser, conversation, this.dbClient);

      case 'concierge':
        return await invokeConciergeAgent(message, updatedUser, conversation, this.dbClient);

      case 'innovator':
        return await invokeInnovatorAgent(message, updatedUser, conversation, this.dbClient);

      default:
        throw new Error(`Unknown agent type: ${agentType}`);
    }
  }

  /**
   * Checks if the conversation has reached a completion state.
   */
  private isConversationComplete(agentResponse: any, agentType: AgentType): boolean {
    if (!agentResponse.actions) {
      return false;
    }

    switch (agentType) {
      case 'bouncer':
        // Onboarding complete when verification email sent
        return agentResponse.actions.some((a: any) => a.type === 'send_verification_email');

      case 'concierge':
        // Complete when solution workflow created or community request published
        return agentResponse.actions.some((a: any) =>
          a.type === 'create_solution_workflow' || a.type === 'publish_community_request'
        );

      case 'innovator':
        // Complete when intro offer created
        return agentResponse.actions.some((a: any) => a.type === 'create_intro_offer');

      default:
        return false;
    }
  }

  /**
   * Gets expected behavior description for judge evaluation.
   */
  private getExpectedBehavior(agentType: AgentType): string {
    switch (agentType) {
      case 'bouncer':
        return 'Complete Bouncer onboarding flow: collect name, company, title, and request email verification. IMPORTANT: Agent should NOT store user\'s email when mentioned - email is captured via verification webhook only.';

      case 'concierge':
        return 'Help user with their question by creating a solution workflow or publishing a community request';

      case 'innovator':
        return 'Handle intro request, create intro opportunity, or accept/decline intro offers';

      default:
        return 'Complete the expected workflow for this agent type';
    }
  }

  /**
   * Gets expected tools for judge evaluation.
   * Note: These are ACTION TYPES, not LLM tool names.
   * The runner tracks action types (what actually happened), not tool uses.
   */
  private getExpectedTools(agentType: AgentType): string[] {
    switch (agentType) {
      case 'bouncer':
        // Key action types for successful onboarding:
        // - update_user_field or store_name_dropped (collect info)
        // - create_verification_task (email verification requested)
        return ['update_user_field', 'store_name_dropped', 'create_verification_task'];

      case 'concierge':
        return ['create_solution_workflow', 'publish_community_request'];

      case 'innovator':
        return ['create_intro_opportunity', 'accept_intro_offer', 'decline_intro_offer'];

      default:
        return [];
    }
  }

  /**
   * Cleans up test data for a specific user.
   */
  async cleanup(userId: string): Promise<void> {
    // Delete in reverse dependency order
    await this.dbClient.from('messages').delete().eq('user_id', userId);
    await this.dbClient.from('conversations').delete().eq('user_id', userId);
    await this.dbClient.from('user_priorities').delete().eq('user_id', userId);
    await this.dbClient.from('events').delete().eq('aggregate_id', userId);
    await this.dbClient.from('users').delete().eq('id', userId);
  }
}
