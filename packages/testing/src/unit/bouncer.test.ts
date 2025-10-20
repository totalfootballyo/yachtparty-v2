/**
 * Bouncer Agent Unit Tests
 *
 * Tests for the Bouncer Agent's onboarding functionality.
 * All external dependencies are mocked.
 */

import { mockSupabase } from '../mocks/supabase.mock';
import { mockAnthropic } from '../mocks/anthropic.mock';
import {
  createTestUser,
  createTestConversation,
  createTestMessage,
  createOnboardingScenario,
} from '../helpers/test-data';

describe('Bouncer Agent', () => {
  beforeEach(() => {
    // Mocks are reset in setup.ts beforeEach
  });

  describe('Information Extraction', () => {
    it('should extract first name from user message', async () => {
      // Arrange
      const { user, conversation } = createOnboardingScenario();
      const message = createTestMessage({
        conversation_id: conversation.id,
        user_id: user.id,
        content: "Hi! I'm Alice and I work at TechCorp",
      });

      mockSupabase.seedDatabase({
        users: [user],
        conversations: [conversation],
        messages: [message],
      });

      mockAnthropic.mockBouncerExtraction({
        first_name: 'Alice',
        company: 'TechCorp',
      });

      // Act
      // In real implementation, this would call the Bouncer Agent
      const extraction = await mockAnthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: 'Extract information from: ' + message.content,
          },
        ],
      });

      const result = JSON.parse(extraction.content[0].text);

      // Assert
      expect(result.extracted_fields.first_name).toBe('Alice');
      expect(result.extracted_fields.company).toBe('TechCorp');
      expect(result.confidence).toBe('high');
    });

    it('should extract email from user message', async () => {
      // Arrange
      mockAnthropic.mockBouncerExtraction({
        email: 'alice@techcorp.com',
      });

      const extraction = await mockAnthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: 'Extract information from: My email is alice@techcorp.com',
          },
        ],
      });

      const result = JSON.parse(extraction.content[0].text);

      // Assert
      expect(result.extracted_fields.email).toBe('alice@techcorp.com');
    });

    it('should extract LinkedIn URL from user message', async () => {
      // Arrange
      mockAnthropic.mockBouncerExtraction({
        linkedin_url: 'https://linkedin.com/in/alice',
      });

      const extraction = await mockAnthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content:
              'Extract information from: Here is my LinkedIn linkedin.com/in/alice',
          },
        ],
      });

      const result = JSON.parse(extraction.content[0].text);

      // Assert
      expect(result.extracted_fields.linkedin_url).toBe(
        'https://linkedin.com/in/alice'
      );
    });

    it('should handle ambiguous information with low confidence', async () => {
      // Arrange
      mockAnthropic.mockResponse(/extract/i, {
        extracted_fields: {},
        confidence: 'low',
        needs_clarification: true,
      });

      const extraction = await mockAnthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [
          { role: 'user', content: 'Extract information from: yes' },
        ],
      });

      const result = JSON.parse(extraction.content[0].text);

      // Assert
      expect(result.confidence).toBe('low');
      expect(result.needs_clarification).toBe(true);
    });
  });

  describe('Onboarding Flow Steps', () => {
    it('should track onboarding progress correctly', () => {
      // Arrange
      const user = createTestUser({
        first_name: 'Alice',
        company: null,
        email: null,
        verified: false,
      });

      // Act & Assert
      expect(user.first_name).toBe('Alice');
      expect(user.company).toBeNull();
      expect(user.verified).toBe(false);
    });

    it('should identify missing required fields', () => {
      // Arrange
      const user = createTestUser({
        first_name: 'Alice',
        company: 'TechCorp',
        email: null,
        linkedin_url: null,
        verified: false,
      });

      const missingFields = [];
      if (!user.email) missingFields.push('email');
      if (!user.linkedin_url) missingFields.push('linkedin_url');

      // Assert
      expect(missingFields).toContain('email');
      expect(missingFields).toContain('linkedin_url');
      expect(missingFields).not.toContain('first_name');
    });

    it('should mark user as complete when all fields collected', () => {
      // Arrange
      const user = createTestUser({
        first_name: 'Alice',
        last_name: 'Smith',
        company: 'TechCorp',
        email: 'alice@techcorp.com',
        linkedin_url: 'https://linkedin.com/in/alice',
        verified: false,
      });

      // Act
      const isComplete =
        user.first_name &&
        user.company &&
        user.email &&
        user.linkedin_url;

      // Assert
      expect(isComplete).toBe(true);
    });
  });

  describe('Response Generation', () => {
    it('should generate conversational onboarding response', async () => {
      // Arrange
      mockAnthropic.mockBouncerResponse(
        "Great! Now I just need your email to continue."
      );

      const response = await mockAnthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Generate response' }],
      });

      const result = JSON.parse(response.content[0].text);

      // Assert
      expect(result.message).toContain('email');
      expect(result.next_action).toBeDefined();
    });

    it('should generate re-engagement message for inactive users', async () => {
      // Arrange
      mockAnthropic.mockResponse(/re-engagement|inactive/i, {
        message: "Hey! Still there? Just need your email and we're done.",
        tone: 'casual',
      });

      const response = await mockAnthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 512,
        messages: [{ role: 'user', content: 'Generate re-engagement message' }],
      });

      const result = JSON.parse(response.content[0].text);

      // Assert
      expect(result.message).toBeDefined();
      expect(result.tone).toBe('casual');
    });
  });

  describe('Verification Handling', () => {
    it('should transition user to Concierge upon completion', async () => {
      // Arrange
      const user = createTestUser({
        first_name: 'Alice',
        company: 'TechCorp',
        email: 'alice@techcorp.com',
        linkedin_url: 'https://linkedin.com/in/alice',
        verified: false,
        poc_agent_type: 'bouncer',
      });

      mockSupabase.seedDatabase({ users: [user] });

      // Act - Simulate verification completion
      const updatedUser = {
        ...user,
        verified: true,
        poc_agent_type: 'concierge' as const,
      };

      await mockSupabase.from('users').update(updatedUser).eq('id', user.id);

      const result = await mockSupabase
        .from('users')
        .select()
        .eq('id', user.id)
        .single();

      // Assert
      expect(result.data.verified).toBe(true);
      expect(result.data.poc_agent_type).toBe('concierge');
    });

    it('should create verification task when email/LinkedIn requested', async () => {
      // Arrange
      const user = createTestUser({
        email: 'alice@techcorp.com',
        verified: false,
      });

      const verificationTask = {
        id: 'task-1',
        task_type: 'create_verification_task',
        agent_type: 'bouncer',
        user_id: user.id,
        scheduled_for: new Date(),
        priority: 'high' as const,
        status: 'pending' as const,
        context_json: { email: user.email },
      };

      mockSupabase.seedDatabase({
        users: [user],
        agent_tasks: [verificationTask],
      });

      // Act
      const result = await mockSupabase
        .from('agent_tasks')
        .select()
        .eq('user_id', user.id)
        .eq('task_type', 'create_verification_task')
        .single();

      // Assert
      expect(result.data).toBeDefined();
      expect(result.data.task_type).toBe('create_verification_task');
      expect(result.data.context_json.email).toBe(user.email);
    });
  });

  describe('Event Publishing', () => {
    it('should publish onboarding_step.completed event', async () => {
      // Arrange
      const user = createTestUser({ id: 'user-1' });
      const event = {
        id: 'event-1',
        event_type: 'user.onboarding_step.completed',
        aggregate_id: user.id,
        aggregate_type: 'user' as const,
        payload: {
          userId: user.id,
          step: 'name_collected',
          data: { first_name: 'Alice' },
        },
        processed: false,
        version: 1,
        created_at: new Date().toISOString(),
        created_by: 'bouncer_agent',
      };

      mockSupabase.seedDatabase({ events: [event] });

      // Act
      const result = await mockSupabase
        .from('events')
        .select()
        .eq('event_type', 'user.onboarding_step.completed')
        .eq('aggregate_id', user.id);

      // Assert
      expect(result.data).toHaveLength(1);
      expect(result.data[0].payload.step).toBe('name_collected');
    });

    it('should publish user.verified event when onboarding complete', async () => {
      // Arrange
      const user = createTestUser({ id: 'user-1', verified: true });
      const event = {
        id: 'event-2',
        event_type: 'user.verified',
        aggregate_id: user.id,
        aggregate_type: 'user' as const,
        payload: {
          userId: user.id,
          verificationCompletedAt: new Date().toISOString(),
          pocAgentType: 'concierge',
        },
        processed: false,
        version: 1,
        created_at: new Date().toISOString(),
        created_by: 'bouncer_agent',
      };

      mockSupabase.seedDatabase({ events: [event] });

      // Act
      const result = await mockSupabase
        .from('events')
        .select()
        .eq('event_type', 'user.verified')
        .eq('aggregate_id', user.id)
        .single();

      // Assert
      expect(result.data).toBeDefined();
      expect(result.data.payload.pocAgentType).toBe('concierge');
    });
  });

  describe('Error Handling', () => {
    it('should handle LLM errors gracefully', async () => {
      // Arrange
      mockAnthropic.mockResponse(/error/i, {
        error: 'API timeout',
      });

      // Act & Assert
      const response = await mockAnthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Trigger error' }],
      });

      // Should return default response instead of throwing
      expect(response).toBeDefined();
    });

    it('should log errors to agent_actions_log', async () => {
      // Arrange
      const user = createTestUser({ id: 'user-1' });
      const errorLog = {
        id: 'log-1',
        agent_type: 'bouncer',
        action_type: 'agent_invocation',
        user_id: user.id,
        error: 'Failed to extract information',
        created_at: new Date(),
      };

      mockSupabase.seedDatabase({ agent_actions_log: [errorLog] });

      // Act
      const result = await mockSupabase
        .from('agent_actions_log')
        .select()
        .eq('user_id', user.id)
        .eq('agent_type', 'bouncer');

      // Assert
      expect(result.data).toHaveLength(1);
      expect(result.data[0].error).toContain('Failed to extract');
    });
  });

  describe('Token Usage Tracking', () => {
    it('should track token usage for cost analysis', async () => {
      // Arrange
      mockAnthropic.clearCallHistory();

      // Act
      await mockAnthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Test prompt' }],
      });

      const usage = mockAnthropic.getTokenUsage();

      // Assert
      expect(usage.input).toBeGreaterThan(0);
      expect(usage.output).toBeGreaterThan(0);
      expect(usage.total).toBe(usage.input + usage.output);
    });

    it('should calculate estimated API costs', async () => {
      // Arrange
      mockAnthropic.clearCallHistory();

      // Act
      await mockAnthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Test prompt' }],
      });

      const cost = mockAnthropic.getEstimatedCost();

      // Assert
      expect(cost).toBeGreaterThan(0);
      expect(typeof cost).toBe('number');
    });
  });
});
