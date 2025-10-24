/**
 * Concierge Agent Smoke Tests
 *
 * Week 4: Basic validation of 2-LLM architecture
 * - User message happy path
 * - Re-engagement with multi-threading
 * - Re-engagement with user frustration (no message)
 *
 * NOTE: These tests require mocking infrastructure (Anthropic API, Supabase).
 * Full implementation in Week 6.
 */

/**
 * Concierge Agent Smoke Tests
 *
 * Week 6: Real LLM calls with mocked database layer
 * - Makes actual Anthropic API calls for realistic validation
 * - Mocks Supabase database operations
 * - Validates 2-LLM architecture with real prompts
 *
 * NOTE: Requires ANTHROPIC_API_KEY environment variable
 */

import { invokeConciergeAgent } from '../src/index';
import { callUserMessageDecision, callReengagementDecision } from '../src/decision';
import {
  createTestScenario,
  createTestUser,
  createTestConversation,
  createTestMessages,
  createTestPriorities,
} from './fixtures';
import {
  verifyCall1Decision,
  verifyReengagementDecision,
  verifyCall2Messages,
  verifyAgentResponse,
  checkToneHelpfulNotOvereager,
  checkToneBrief,
  checkNoHallucinatedIntros,
} from './helpers';
import {
  createMockSupabaseClient,
  mockPublishEvent,
  verifyEventPublished,
} from './mocks/supabase.mock';
import { createServiceClient, publishEvent, createAgentTask } from '@yachtparty/shared';

// Mock @yachtparty/shared (database layer only - LLM calls are real)
jest.mock('@yachtparty/shared', () => {
  const actual = jest.requireActual('@yachtparty/shared');
  return {
    ...actual,
    createServiceClient: jest.fn(),
    publishEvent: jest.fn().mockResolvedValue(undefined),
    createAgentTask: jest.fn().mockResolvedValue({ id: 'task-123' }),
  };
});

// Ensure ANTHROPIC_API_KEY is available
beforeAll(() => {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required for tests');
  }
});

describe('Concierge Agent - Smoke Tests', () => {
  describe('User Message: Happy Path', () => {
    it('should select publish_community_request tool and compose acknowledgment', async () => {
      // Setup test scenario
      const scenario = createTestScenario('happy_path');
      const { user, conversation, incomingMessage, messages } = scenario;

      // Ensure we have an incoming message
      if (!incomingMessage) {
        throw new Error('Test scenario did not provide an incoming message');
      }

      // Mock Supabase database
      const mockSupabase = createMockSupabaseClient({
        users: [user],
        conversations: [conversation],
        messages: messages,
        userPriorities: [],
        communityRequests: [],
      });

      (createServiceClient as any).mockReturnValue(mockSupabase);

      // Execute agent (makes REAL LLM calls)
      const response = await invokeConciergeAgent(incomingMessage, user, conversation);

      // Verify response structure
      expect(response.immediateReply).toBe(true);
      expect(response.messages).toBeDefined();
      expect(response.messages).not.toBeUndefined();
      if (response.messages) {
        expect(response.messages.length).toBeGreaterThan(0);
      }
      expect(response.actions).toBeDefined();

      // Verify Call 2 output quality
      verifyCall2Messages(response, {
        messageCountRange: [1, 2], // Should be 1-2 messages
        noExclamations: true,
        maxLength: 200,
        toneCheck: checkToneHelpfulNotOvereager,
      });

      // CRITICAL: Verify agent doesn't hallucinate introductions
      if (response.messages && !checkNoHallucinatedIntros(response.messages)) {
        throw new Error('Agent hallucinated introductions that don\'t exist in priorities');
      }

      // Verify agent took appropriate action
      verifyAgentResponse(response, {
        immediateReply: true,
        hasMessages: true,
        hasActions: true,
        actionTypes: ['ask_community_question'],
      });

      // Verify event was published (database interaction)
      expect(publishEvent).toHaveBeenCalled();
      verifyEventPublished(publishEvent as any, {
        event_type: 'community.request_needed',
        aggregate_id: user.id,
        aggregate_type: 'user',
      });

      // Log actual LLM responses for manual inspection
      console.log('\n=== Happy Path Test Results ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n') || 'No messages');
      console.log('Actions taken:', response.actions.map(a => a.type).join(', '));
      console.log('================================\n');
    }, 30000); // 30 second timeout for real LLM calls

    it('should extract all required parameters for publish_community_request tool', async () => {
      // This test verifies that Call 1 extracts:
      // - question (user's question)
      // - expertise_needed (domain keywords)
      // - requester_context (why they're asking)
      // - desired_outcome (usually 'backchannel')
      // - urgency (low/medium/high)
      // - request_summary (3-5 word summary)

      // TODO Week 6: Implement with mocking

      expect(true).toBe(true);
    });
  });

  describe('Re-engagement: Multi-Thread', () => {
    it('should decide to message with 2-3 threads and create sequence', async () => {
      // Setup
      const scenario = createTestScenario('multi_thread');
      const { user, conversation, systemMessage, priorities, outstandingRequests } = scenario;

      // This scenario has:
      // - 2 high-priority items (intro opportunities, value 85-90)
      // - 1 medium-priority item (solution update, value 60)
      // - 1 outstanding community request (7 days old)
      // - Engaged conversation history

      // Expected Call 1 behavior:
      // - should_message: true
      // - threads_to_address: 2-3 threads (high priorities + community request update)
      // - next_scenario: 'multi_thread_response'
      // - message_structure: 'sequence_2' or 'sequence_3'

      // Expected Call 2 behavior:
      // - 2-3 messages separated by "---"
      // - First message: Reassure about community request
      // - Second message: Offer high-priority intro
      // - Third message (optional): Offer second priority or ask preference

      // TODO Week 6: Implement with mocking

      expect(true).toBe(true);
    });

    it('should prioritize threads by value score', async () => {
      // Verify that Call 1 addresses high-value items first
      // High (85-100) > Medium (50-79) > Low (<50)

      // TODO Week 6: Implement with mocking

      expect(true).toBe(true);
    });

    it('should create message sequences with correct delimiter', async () => {
      // Verify that Call 2 uses "---" delimiter
      // Verify that parsing splits into individual messages correctly

      // TODO Week 6: Implement with mocking

      expect(true).toBe(true);
    });
  });

  describe('Re-engagement: User Frustrated', () => {
    it('should decide NOT to message and extend task', async () => {
      // Setup
      const scenario = createTestScenario('user_frustrated');
      const { user, conversation, systemMessage, priorities } = scenario;

      // This scenario has:
      // - Conversation shows frustration ("too many messages")
      // - 1 high-priority item (value 85)
      // - 2 medium-priority items (value 60-65)
      // - 5 days since last message

      // Expected Call 1 behavior:
      // - should_message: false
      // - reasoning: "User expressed message fatigue" or similar
      // - extend_days: 60-90 (respect frustration with longer delay)
      // - next_scenario: 'no_message'

      // Expected Agent behavior:
      // - immediateReply: false
      // - messages: []
      // - New re-engagement task created (scheduled_for = now + extend_days)

      // TODO Week 6: Implement with mocking

      expect(true).toBe(true);
    });

    it('should detect subtle frustration signals', async () => {
      // Test with:
      // - Terse responses ("ok", "sure", single words)
      // - Delays in response times
      // - Shorter messages over time
      // - Lack of follow-up questions

      // Call 1 should detect these patterns and be conservative

      // TODO Week 6: Implement with mocking

      expect(true).toBe(true);
    });

    it('should not be overly sensitive to false positives', async () => {
      // User says "thanks" or "got it" → NOT frustration
      // User is brief but engaged → NOT frustration
      // User asks clarifying questions → NOT frustration

      // Call 1 should still message if value is high

      // TODO Week 6: Implement with mocking

      expect(true).toBe(true);
    });
  });

  describe('Call 1: Tool Parameter Extraction', () => {
    it('should extract expertise_needed with domain keywords', async () => {
      // Question: "Looking for CTV advertising vendors"
      // Expected: expertise_needed: ["ctv", "advertising", "ad_tech"]

      // Question: "Need help with Series A fundraising"
      // Expected: expertise_needed: ["fundraising", "venture_capital", "series_a"]

      // TODO Week 6: Implement with mocking

      expect(true).toBe(true);
    });

    it('should extract requester_context from conversation history', async () => {
      // Conversation mentions "Q1 launch" and "$500k budget"
      // Expected: requester_context includes these details

      // TODO Week 6: Implement with mocking

      expect(true).toBe(true);
    });

    it('should create brief request_summary (3-5 words)', async () => {
      // Question: "Looking for CTV advertising platforms for our Q1 launch"
      // Expected: request_summary: "CTV advertising guidance"

      // Question: "Need introductions to Series A investors"
      // Expected: request_summary: "Series A fundraising intros"

      // TODO Week 6: Implement with mocking

      expect(true).toBe(true);
    });
  });

  describe('Call 2: Personality & Tone', () => {
    it('should maintain brief, helpful tone', async () => {
      // Messages should be:
      // - 2-3 sentences max per message
      // - No exclamation points
      // - No superlatives ("awesome", "amazing")
      // - Professional and capable

      // TODO Week 6: Implement with mocking

      expect(true).toBe(true);
    });

    it('should match user communication style', async () => {
      // If user is brief → Concierge is brief
      // If user is detailed → Concierge provides more context

      // TODO Week 6: Implement with mocking

      expect(true).toBe(true);
    });

    it('should never leak system prompts or JSON', async () => {
      // Call 2 should only output natural language
      // No "type:", "context:", "guidance:" fields
      // No tool names or internal terminology

      // TODO Week 6: Implement with mocking

      expect(true).toBe(true);
    });
  });

  describe('Self-Reflection', () => {
    it('should detect and acknowledge leaked JSON', async () => {
      // If Call 2 accidentally outputs internal messages
      // Next invocation should detect and acknowledge with humor
      // Example: "Whoa. That was all me. Sorry. Let me try that again."

      // TODO Week 6: Implement with mocking

      expect(true).toBe(true);
    });

    it('should detect duplicate messages', async () => {
      // If same message sent twice
      // Should acknowledge: "I just noticed I sent you that twice. My bad."

      // TODO Week 6: Implement with mocking

      expect(true).toBe(true);
    });
  });
});
