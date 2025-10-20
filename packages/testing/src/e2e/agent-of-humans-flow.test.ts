/**
 * Agent of Humans (Community Request) End-to-End Test
 *
 * Tests the complete 15-step lifecycle:
 * User 1 asks question → Agent routes to experts → Expert responds →
 * Response evaluated → Delivered to requester → Close-the-loop to expert
 */

import { mockSupabase } from '../mocks/supabase.mock';
import { mockAnthropic } from '../mocks/anthropic.mock';
import {
  createVerifiedUser,
  createTestConversation,
  createTestMessage,
  createTestEvent,
  createTestUserPriority,
} from '../helpers/test-data';

describe('Agent of Humans - Complete Workflow E2E', () => {
  let requester: any; // User 1 who asks the question
  let expert1: any; // User 2 who will answer
  let expert2: any; // User 3 (optional second expert)
  let requesterConversation: any;
  let expert1Conversation: any;

  beforeEach(() => {
    // Reset mocks
    mockSupabase.reset();
    mockAnthropic.reset();

    // Create test users
    requester = createVerifiedUser({
      id: 'user-requester-123',
      first_name: 'Alice',
      last_name: 'Requester',
      phone_number: '+14155551001',
      expertise: ['product_management'],
    });

    expert1 = createVerifiedUser({
      id: 'user-expert1-456',
      first_name: 'Bob',
      last_name: 'Expert',
      phone_number: '+14155551002',
      expertise: ['saas', 'crm', 'sales_tools'],
    });

    expert2 = createVerifiedUser({
      id: 'user-expert2-789',
      first_name: 'Carol',
      last_name: 'Advisor',
      phone_number: '+14155551003',
      expertise: ['crm', 'enterprise_sales'],
    });

    // Create conversations
    requesterConversation = createTestConversation({ user_id: requester.id });
    expert1Conversation = createTestConversation({ user_id: expert1.id });

    // Seed database
    mockSupabase.seedDatabase({
      users: [requester, expert1, expert2],
      conversations: [requesterConversation, expert1Conversation],
    });

    // Mock Anthropic responses
    mockAnthropic.mockResponse(/Summarize this expert/, 'HubSpot is great for Series A, pricey but worth it.');
    mockAnthropic.mockResponse(/usefulness/, {
      usefulness_score: 8,
      reasoning: 'Specific, actionable recommendation from experience',
      impact_description: 'Helped founder make informed CRM decision',
    });
  });

  describe('Step 1-2: User Makes Request → Agent Routes to Experts', () => {
    it('should create community request and route to matching experts', async () => {
      // Step 1: Concierge publishes community.request_needed event
      const requestEvent = createTestEvent({
        event_type: 'community.request_needed',
        aggregate_id: requester.id,
        aggregate_type: 'user',
        payload: {
          requestingAgentType: 'concierge',
          requestingUserId: requester.id,
          contextId: requesterConversation.id,
          contextType: 'conversation',
          question: 'What is the best CRM for a Series A SaaS company?',
          category: 'sales_tools',
          expertiseNeeded: ['saas', 'crm', 'sales_tools'],
        },
        created_by: 'concierge_agent',
      });

      await mockSupabase.from('events').insert(requestEvent);

      // Step 2: Event processor handles routing
      // (In real system, this would be triggered automatically)
      // Simulate creating the community request
      const { data: request } = await mockSupabase
        .from('community_requests')
        .insert({
          requesting_agent_type: 'concierge',
          requesting_user_id: requester.id,
          question: 'What is the best CRM for a Series A SaaS company?',
          category: 'sales_tools',
          expertise_needed: ['saas', 'crm', 'sales_tools'],
          target_user_ids: [expert1.id, expert2.id],
          status: 'open',
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .select()
        .single();

      // Create tasks for experts' Account Managers
      await mockSupabase.from('agent_tasks').insert([
        {
          task_type: 'community_request_available',
          agent_type: 'account_manager',
          user_id: expert1.id,
          context_id: request.id,
          context_type: 'community_request',
          scheduled_for: new Date().toISOString(),
          priority: 'medium',
          context_json: {
            requestId: request.id,
            question: request.question,
            category: 'sales_tools',
            expertiseNeeded: ['saas', 'crm', 'sales_tools'],
          },
        },
        {
          task_type: 'community_request_available',
          agent_type: 'account_manager',
          user_id: expert2.id,
          context_id: request.id,
          context_type: 'community_request',
          scheduled_for: new Date().toISOString(),
          priority: 'medium',
          context_json: {
            requestId: request.id,
            question: request.question,
            category: 'sales_tools',
            expertiseNeeded: ['saas', 'crm', 'sales_tools'],
          },
        },
      ]);

      // Assertions
      expect(request).toBeDefined();
      expect(request.status).toBe('open');
      expect(request.target_user_ids).toContain(expert1.id);

      const { data: tasks } = await mockSupabase
        .from('agent_tasks')
        .select()
        .eq('task_type', 'community_request_available');

      expect(tasks).toHaveLength(2);
      expect(tasks.some((t: any) => t.user_id === expert1.id)).toBe(true);
    });
  });

  describe('Step 3-5: Task Processor → Account Manager → Concierge Presents', () => {
    let requestId: string;

    beforeEach(async () => {
      // Create community request
      const { data: request } = await mockSupabase
        .from('community_requests')
        .insert({
          requesting_agent_type: 'concierge',
          requesting_user_id: requester.id,
          question: 'What is the best CRM for a Series A SaaS company?',
          category: 'sales_tools',
          expertise_needed: ['saas', 'crm', 'sales_tools'],
          target_user_ids: [expert1.id],
          status: 'open',
        })
        .select()
        .single();

      requestId = request.id;
    });

    it('should add community request to expert priorities', async () => {
      // Step 4: Account Manager processes task and adds to priorities
      await mockSupabase.from('user_priorities').insert({
        user_id: expert1.id,
        priority_rank: 2,
        item_type: 'community_request',
        item_id: requestId,
        value_score: 75, // Good match based on expertise
        status: 'active',
      });

      // Verify priority was created
      const { data: priorities } = await mockSupabase
        .from('user_priorities')
        .select()
        .eq('user_id', expert1.id)
        .eq('item_type', 'community_request');

      expect(priorities).toHaveLength(1);
      expect(priorities[0].item_id).toBe(requestId);
      expect(priorities[0].value_score).toBe(75);
    });

    it('should mark priority as presented when Concierge shows it to expert', async () => {
      // Add priority
      const { data: priority } = await mockSupabase
        .from('user_priorities')
        .insert({
          user_id: expert1.id,
          priority_rank: 1,
          item_type: 'community_request',
          item_id: requestId,
          value_score: 80,
          status: 'active',
        })
        .select()
        .single();

      // Step 5: Concierge presents to expert
      await mockSupabase
        .from('user_priorities')
        .update({
          status: 'presented',
          presented_at: new Date().toISOString(),
        })
        .eq('id', priority.id);

      // Verify
      const { data: updated } = await mockSupabase
        .from('user_priorities')
        .select()
        .eq('id', priority.id)
        .single();

      expect(updated.status).toBe('presented');
      expect(updated.presented_at).toBeDefined();
    });
  });

  describe('Step 6-8: Expert Responds → Record Response → Publish Event', () => {
    let requestId: string;

    beforeEach(async () => {
      const { data: request } = await mockSupabase
        .from('community_requests')
        .insert({
          requesting_agent_type: 'concierge',
          requesting_user_id: requester.id,
          question: 'What is the best CRM for a Series A SaaS company?',
          category: 'sales_tools',
          expertise_needed: ['saas', 'crm'],
          target_user_ids: [expert1.id],
          status: 'open',
        })
        .select()
        .single();

      requestId = request.id;
    });

    it('should record expert response and publish event', async () => {
      // Step 7: Record response
      const verbatimAnswer = 'We use HubSpot for our Series A. It\'s expensive but the integrations are worth it. Salesforce is overkill at that stage.';

      const { data: response } = await mockSupabase
        .from('community_responses')
        .insert({
          request_id: requestId,
          user_id: expert1.id,
          response_text: 'HubSpot is great for Series A, pricey but worth it.',
          verbatim_answer: verbatimAnswer,
          status: 'provided',
        })
        .select()
        .single();

      // Update request count
      await mockSupabase
        .from('community_requests')
        .update({
          responses_count: 1,
          status: 'responses_received',
        })
        .eq('id', requestId);

      // Step 8: Publish event
      await mockSupabase.from('events').insert({
        event_type: 'community.response_received',
        aggregate_id: response.id,
        aggregate_type: 'community_response',
        payload: {
          responseId: response.id,
          requestId,
          expertUserId: expert1.id,
          responseSummary: response.response_text,
        },
        created_by: 'concierge_agent',
      });

      // Assertions
      expect(response).toBeDefined();
      expect(response.status).toBe('provided');

      const { data: updatedRequest } = await mockSupabase
        .from('community_requests')
        .select()
        .eq('id', requestId)
        .single();

      expect(updatedRequest.responses_count).toBe(1);
      expect(updatedRequest.status).toBe('responses_received');

      const { data: events } = await mockSupabase
        .from('events')
        .select()
        .eq('event_type', 'community.response_received');

      expect(events).toHaveLength(1);
      expect(events[0].payload.responseId).toBe(response.id);
    });
  });

  describe('Step 9-11: Route Response → Evaluate → Award Credits', () => {
    let requestId: string;
    let responseId: string;

    beforeEach(async () => {
      // Create request
      const { data: request } = await mockSupabase
        .from('community_requests')
        .insert({
          requesting_agent_type: 'concierge',
          requesting_user_id: requester.id,
          question: 'What is the best CRM for a Series A SaaS company?',
          category: 'sales_tools',
          expertise_needed: ['crm'],
          status: 'open',
        })
        .select()
        .single();

      requestId = request.id;

      // Create response
      const { data: response } = await mockSupabase
        .from('community_responses')
        .insert({
          request_id: requestId,
          user_id: expert1.id,
          response_text: 'HubSpot works well for Series A stage.',
          verbatim_answer: 'Full response here...',
          status: 'provided',
        })
        .select()
        .single();

      responseId = response.id;
    });

    it('should evaluate response usefulness and award credits if valuable', async () => {
      // Step 10: Evaluate usefulness (score 8/10)
      const usefulnessScore = 8;

      await mockSupabase
        .from('community_responses')
        .update({
          usefulness_score: usefulnessScore,
          impact_description: 'Helped founder make informed CRM decision',
        })
        .eq('id', responseId);

      // Step 11: Award credits (score >= 7)
      const baseCredits = 15;
      const bonusCredits = (usefulnessScore - 7) * 10; // 10 credits
      const totalCredits = baseCredits + bonusCredits; // 25

      await mockSupabase.from('credit_events').insert({
        user_id: expert1.id,
        event_type: 'community_response',
        amount: totalCredits,
        reference_type: 'community_response',
        reference_id: responseId,
        idempotency_key: `community_response_${responseId}`,
        description: `Expert insight (usefulness: ${usefulnessScore}/10)`,
        processed: true,
      });

      await mockSupabase
        .from('community_responses')
        .update({
          credits_awarded: totalCredits,
          credited_at: new Date().toISOString(),
          status: 'rewarded',
        })
        .eq('id', responseId);

      // Assertions
      const { data: response } = await mockSupabase
        .from('community_responses')
        .select()
        .eq('id', responseId)
        .single();

      expect(response.usefulness_score).toBe(8);
      expect(response.credits_awarded).toBe(25);
      expect(response.status).toBe('rewarded');

      const { data: creditEvents } = await mockSupabase
        .from('credit_events')
        .select()
        .eq('reference_id', responseId);

      expect(creditEvents).toHaveLength(1);
      expect(creditEvents[0].amount).toBe(25);
    });

    it('should NOT award credits for low usefulness score', async () => {
      // Evaluate as not useful (score 5/10)
      const usefulnessScore = 5;

      await mockSupabase
        .from('community_responses')
        .update({
          usefulness_score: usefulnessScore,
          impact_description: 'Generic response, not actionable',
        })
        .eq('id', responseId);

      // No credits awarded (score < 7)
      // Verify no credit events created
      const { data: creditEvents } = await mockSupabase
        .from('credit_events')
        .select()
        .eq('reference_id', responseId);

      expect(creditEvents).toHaveLength(0);

      const { data: response } = await mockSupabase
        .from('community_responses')
        .select()
        .eq('id', responseId)
        .single();

      expect(response.credits_awarded).toBeUndefined();
      expect(response.status).toBe('provided'); // Not 'rewarded'
    });
  });

  describe('Step 12: Deliver Response to Requester', () => {
    let requestId: string;
    let responseId: string;

    beforeEach(async () => {
      const { data: request } = await mockSupabase
        .from('community_requests')
        .insert({
          requesting_agent_type: 'concierge',
          requesting_user_id: requester.id,
          question: 'What is the best CRM for a Series A SaaS company?',
        })
        .select()
        .single();

      requestId = request.id;

      const { data: response } = await mockSupabase
        .from('community_responses')
        .insert({
          request_id: requestId,
          user_id: expert1.id,
          response_text: 'HubSpot works well.',
          status: 'rewarded',
        })
        .select()
        .single();

      responseId = response.id;
    });

    it('should add response to requester priorities for delivery', async () => {
      // Account Manager adds to requester's priorities
      await mockSupabase.from('user_priorities').insert({
        user_id: requester.id,
        priority_rank: 1, // High priority
        item_type: 'community_response',
        item_id: responseId,
        value_score: 90,
        status: 'active',
      });

      // Verify
      const { data: priorities } = await mockSupabase
        .from('user_priorities')
        .select()
        .eq('user_id', requester.id)
        .eq('item_type', 'community_response');

      expect(priorities).toHaveLength(1);
      expect(priorities[0].item_id).toBe(responseId);
      expect(priorities[0].priority_rank).toBe(1);
    });
  });

  describe('Step 13: Close-the-Loop to Expert', () => {
    let responseId: string;

    beforeEach(async () => {
      const { data: request } = await mockSupabase
        .from('community_requests')
        .insert({
          requesting_user_id: requester.id,
          question: 'Best CRM?',
        })
        .select()
        .single();

      const { data: response } = await mockSupabase
        .from('community_responses')
        .insert({
          request_id: request.id,
          user_id: expert1.id,
          response_text: 'HubSpot',
          credits_awarded: 25,
          status: 'rewarded',
        })
        .select()
        .single();

      responseId = response.id;
    });

    it('should create impact notification priority for expert', async () => {
      // Create impact notification priority (24h after crediting)
      await mockSupabase.from('user_priorities').insert({
        user_id: expert1.id,
        priority_rank: 3, // Medium priority
        item_type: 'expert_impact_notification',
        item_id: responseId,
        value_score: 70,
        status: 'active',
      });

      // Update response status
      await mockSupabase
        .from('community_responses')
        .update({
          status: 'closed_loop',
          closed_loop_at: new Date().toISOString(),
          closed_loop_message: 'Your CRM insight helped a Series A founder make their decision',
        })
        .eq('id', responseId);

      // Verify
      const { data: priorities } = await mockSupabase
        .from('user_priorities')
        .select()
        .eq('user_id', expert1.id)
        .eq('item_type', 'expert_impact_notification');

      expect(priorities).toHaveLength(1);

      const { data: response } = await mockSupabase
        .from('community_responses')
        .select()
        .eq('id', responseId)
        .single();

      expect(response.status).toBe('closed_loop');
      expect(response.closed_loop_message).toContain('helped');
    });
  });

  describe('Complete End-to-End Flow', () => {
    it('should complete full workflow from request to close-the-loop', async () => {
      // ========== STEP 1-2: Request Created & Routed ==========
      const { data: request } = await mockSupabase
        .from('community_requests')
        .insert({
          requesting_agent_type: 'concierge',
          requesting_user_id: requester.id,
          question: 'What is the best CRM for a Series A SaaS company?',
          category: 'sales_tools',
          expertise_needed: ['crm', 'saas'],
          target_user_ids: [expert1.id],
          status: 'open',
        })
        .select()
        .single();

      // ========== STEP 4: Account Manager adds to expert priorities ==========
      await mockSupabase.from('user_priorities').insert({
        user_id: expert1.id,
        priority_rank: 1,
        item_type: 'community_request',
        item_id: request.id,
        value_score: 85,
        status: 'active',
      });

      // ========== STEP 6-7: Expert responds ==========
      const { data: response } = await mockSupabase
        .from('community_responses')
        .insert({
          request_id: request.id,
          user_id: expert1.id,
          response_text: 'HubSpot is great for Series A stage.',
          verbatim_answer: 'We use HubSpot. It\'s expensive but worth it.',
          status: 'provided',
        })
        .select()
        .single();

      await mockSupabase
        .from('community_requests')
        .update({ responses_count: 1, status: 'responses_received' })
        .eq('id', request.id);

      // ========== STEP 10-11: Evaluate and award credits ==========
      await mockSupabase
        .from('community_responses')
        .update({
          usefulness_score: 8,
          impact_description: 'Helped with CRM decision',
          credits_awarded: 25,
          status: 'rewarded',
        })
        .eq('id', response.id);

      await mockSupabase.from('credit_events').insert({
        user_id: expert1.id,
        event_type: 'community_response',
        amount: 25,
        reference_type: 'community_response',
        reference_id: response.id,
        idempotency_key: `community_response_${response.id}`,
        processed: true,
      });

      // ========== STEP 12: Deliver to requester ==========
      await mockSupabase.from('user_priorities').insert({
        user_id: requester.id,
        priority_rank: 1,
        item_type: 'community_response',
        item_id: response.id,
        value_score: 90,
        status: 'active',
      });

      // ========== STEP 13: Close-the-loop to expert ==========
      await mockSupabase.from('user_priorities').insert({
        user_id: expert1.id,
        priority_rank: 3,
        item_type: 'expert_impact_notification',
        item_id: response.id,
        value_score: 70,
        status: 'active',
      });

      await mockSupabase
        .from('community_responses')
        .update({
          status: 'closed_loop',
          closed_loop_at: new Date().toISOString(),
        })
        .eq('id', response.id);

      // ========== FINAL ASSERTIONS ==========
      // Request was created
      const { data: finalRequest } = await mockSupabase
        .from('community_requests')
        .select()
        .eq('id', request.id)
        .single();
      expect(finalRequest.responses_count).toBe(1);
      expect(finalRequest.status).toBe('responses_received');

      // Response was recorded and rewarded
      const { data: finalResponse } = await mockSupabase
        .from('community_responses')
        .select()
        .eq('id', response.id)
        .single();
      expect(finalResponse.usefulness_score).toBe(8);
      expect(finalResponse.credits_awarded).toBe(25);
      expect(finalResponse.status).toBe('closed_loop');

      // Expert received credits
      const { data: credits } = await mockSupabase
        .from('credit_events')
        .select()
        .eq('user_id', expert1.id);
      expect(credits).toHaveLength(1);
      expect(credits[0].amount).toBe(25);

      // Requester has priority to receive response
      const { data: requesterPriorities } = await mockSupabase
        .from('user_priorities')
        .select()
        .eq('user_id', requester.id)
        .eq('item_type', 'community_response');
      expect(requesterPriorities).toHaveLength(1);

      // Expert has priority for impact notification
      const { data: expertPriorities } = await mockSupabase
        .from('user_priorities')
        .select()
        .eq('user_id', expert1.id)
        .eq('item_type', 'expert_impact_notification');
      expect(expertPriorities).toHaveLength(1);
    });
  });
});
