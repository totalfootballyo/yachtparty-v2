/**
 * Innovator Agent - Inherited Smoke Tests from Concierge
 *
 * These tests validate that Innovator agent maintains all Concierge behavior
 * since it extends Concierge functionality.
 *
 * NOTE: Requires ANTHROPIC_API_KEY environment variable
 */

import { invokeInnovatorAgent } from '../src/index';
import {
  createTestScenario,
  createTestUser,
  createTestConversation,
  createTestMessages,
  createTestPriorities,
} from '../../concierge/__tests__/fixtures';
import {
  verifyCall1Decision,
  verifyReengagementDecision,
  verifyCall2Messages,
  verifyAgentResponse,
  checkToneHelpfulNotOvereager,
  checkToneBrief,
  checkNoHallucinatedIntros,
} from '../../concierge/__tests__/helpers';
import {
  createMockSupabaseClient,
  mockPublishEvent,
  verifyEventPublished,
} from '../../concierge/__tests__/mocks/supabase.mock';
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

describe('Innovator Agent - Inherited Smoke Tests', () => {
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
      const response = await invokeInnovatorAgent(incomingMessage, user, conversation);

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
      console.log('\n=== Innovator Happy Path Test Results ===');
      console.log('User message:', incomingMessage.content);
      console.log('Agent response:', response.messages?.join('\n') || 'No messages');
      console.log('Actions taken:', response.actions.map(a => a.type).join(', '));
      console.log('==========================================\n');
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
      // TODO Week 6: Implement with mocking
      expect(true).toBe(true);
    });

    it('should prioritize threads by value score', async () => {
      // TODO Week 6: Implement with mocking
      expect(true).toBe(true);
    });

    it('should create message sequences with correct delimiter', async () => {
      // TODO Week 6: Implement with mocking
      expect(true).toBe(true);
    });
  });

  describe('Re-engagement: User Frustrated', () => {
    it('should decide NOT to message and extend task', async () => {
      // TODO Week 6: Implement with mocking
      expect(true).toBe(true);
    });

    it('should detect subtle frustration signals', async () => {
      // TODO Week 6: Implement with mocking
      expect(true).toBe(true);
    });

    it('should not be overly sensitive to false positives', async () => {
      // TODO Week 6: Implement with mocking
      expect(true).toBe(true);
    });
  });

  describe('Call 1: Tool Parameter Extraction', () => {
    it('should extract expertise_needed with domain keywords', async () => {
      // TODO Week 6: Implement with mocking
      expect(true).toBe(true);
    });

    it('should extract requester_context from conversation history', async () => {
      // TODO Week 6: Implement with mocking
      expect(true).toBe(true);
    });

    it('should create brief request_summary (3-5 words)', async () => {
      // TODO Week 6: Implement with mocking
      expect(true).toBe(true);
    });
  });

  describe('Call 2: Personality & Tone', () => {
    it('should maintain brief, helpful tone', async () => {
      // TODO Week 6: Implement with mocking
      expect(true).toBe(true);
    });

    it('should match user communication style', async () => {
      // TODO Week 6: Implement with mocking
      expect(true).toBe(true);
    });

    it('should never leak system prompts or JSON', async () => {
      // TODO Week 6: Implement with mocking
      expect(true).toBe(true);
    });
  });

  describe('Self-Reflection', () => {
    it('should detect and acknowledge leaked JSON', async () => {
      // TODO Week 6: Implement with mocking
      expect(true).toBe(true);
    });

    it('should detect duplicate messages', async () => {
      // TODO Week 6: Implement with mocking
      expect(true).toBe(true);
    });
  });
});
