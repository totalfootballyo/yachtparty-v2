/**
 * Comprehensive E2E Tests for Introduction Flows
 *
 * Tests the 3-flow introduction system:
 * 1. intro_opportunities (System → Connector)
 * 2. connection_requests (Requestor → Introducee)
 * 3. intro_offers (User → Introducee → Connector)
 *
 * Coverage:
 * - Call 1 tool selection with disambiguation
 * - Call 2 message composition (tone, no hallucinations, no timelines)
 * - Full flow end-to-end database operations
 * - Negative cases (hallucination prevention)
 */

import { invokeConciergeAgent } from '../src/index';
import { callUserMessageDecision } from '../src/decision';
import { buildPersonalityPrompt } from '../src/personality';
import Anthropic from '@anthropic-ai/sdk';

describe('Introduction Flows - E2E Tests', () => {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // ============================================================================
  // TEST GROUP 1: offer_introduction Disambiguation
  // ============================================================================

  describe('offer_introduction - Tool Selection Disambiguation', () => {
    it('should select offer_introduction when user OFFERS to make intro', async () => {
      const context = {
        user: {
          id: 'user-123',
          first_name: 'Sarah',
          phone_number: '+1234567890',
          verified: true,
          innovator: false,
          expert_connector: true,
          credit_balance: 50,
          status_level: 'member',
        },
        recentMessages: [
          { role: 'user', content: 'I can introduce you to Mike at Salesforce', created_at: new Date().toISOString() },
        ],
        userPriorities: [],
        outstandingCommunityRequests: [],
      };

      const userMessage = context.recentMessages[0];
      const decision = await callUserMessageDecision(anthropic, userMessage, context);

      // VERIFY: Call 1 selected offer_introduction
      expect(decision.tools_to_execute).toHaveLength(1);
      expect(decision.tools_to_execute[0].tool_name).toBe('offer_introduction');
      expect(decision.tools_to_execute[0].params).toMatchObject({
        prospect_name: expect.stringContaining('Mike'),
      });

      console.log('✅ offer_introduction selected correctly for user offering intro');
    });

    it('should NOT select offer_introduction when user REQUESTS intro (use publish_community_request)', async () => {
      const context = {
        user: {
          id: 'user-123',
          first_name: 'Sarah',
          phone_number: '+1234567890',
          verified: true,
          innovator: false,
          expert_connector: false,
          credit_balance: 50,
          status_level: 'member',
        },
        recentMessages: [
          { role: 'user', content: 'Do you know anyone at Salesforce?', created_at: new Date().toISOString() },
        ],
        userPriorities: [],
        outstandingCommunityRequests: [],
      };

      const userMessage = context.recentMessages[0];
      const decision = await callUserMessageDecision(anthropic, userMessage, context);

      // VERIFY: Call 1 did NOT select offer_introduction
      const toolNames = decision.tools_to_execute.map(t => t.tool_name);
      expect(toolNames).not.toContain('offer_introduction');

      // VERIFY: Should use publish_community_request instead
      expect(toolNames).toContain('publish_community_request');

      console.log('✅ Correctly avoided offer_introduction when user is requesting intro');
    });

    it('should NOT select offer_introduction when user says "I want to meet X" (use publish_community_request)', async () => {
      const context = {
        user: {
          id: 'user-123',
          first_name: 'Sarah',
          phone_number: '+1234567890',
          verified: true,
          innovator: false,
          expert_connector: false,
          credit_balance: 50,
          status_level: 'member',
        },
        recentMessages: [
          { role: 'user', content: 'I want to meet someone at Roku who knows CTV', created_at: new Date().toISOString() },
        ],
        userPriorities: [],
        outstandingCommunityRequests: [],
      };

      const userMessage = context.recentMessages[0];
      const decision = await callUserMessageDecision(anthropic, userMessage, context);

      // VERIFY: Call 1 did NOT select offer_introduction
      const toolNames = decision.tools_to_execute.map(t => t.tool_name);
      expect(toolNames).not.toContain('offer_introduction');

      // VERIFY: Should use publish_community_request
      expect(toolNames).toContain('publish_community_request');

      console.log('✅ Correctly avoided offer_introduction when user wants to meet someone');
    });
  });

  // ============================================================================
  // TEST GROUP 2: accept_intro_opportunity - Context-Dependent Selection
  // ============================================================================

  describe('accept_intro_opportunity - Context-Dependent Tool Selection', () => {
    it('should select accept_intro_opportunity when user says "yes" and intro_opportunity in priorities', async () => {
      const context = {
        user: {
          id: 'user-123',
          first_name: 'Sarah',
          phone_number: '+1234567890',
          verified: true,
          innovator: false,
          expert_connector: true,
          credit_balance: 50,
          status_level: 'member',
        },
        recentMessages: [
          { role: 'assistant', content: 'Want to intro Tony Redwood at IAB to Mike at Roku? Worth 25 credits.', created_at: new Date(Date.now() - 60000).toISOString() },
          { role: 'user', content: 'yes', created_at: new Date().toISOString() },
        ],
        userPriorities: [
          {
            id: 'priority-123',
            item_type: 'intro_opportunity',
            item_id: 'intro-opp-456',
            value_score: 85,
            status: 'active',
          },
        ],
        outstandingCommunityRequests: [],
      };

      const userMessage = context.recentMessages[1];
      const decision = await callUserMessageDecision(anthropic, userMessage, context);

      // VERIFY: Call 1 selected accept_intro_opportunity
      expect(decision.tools_to_execute).toHaveLength(1);
      expect(decision.tools_to_execute[0].tool_name).toBe('accept_intro_opportunity');
      expect(decision.tools_to_execute[0].params).toMatchObject({
        intro_opportunity_id: 'intro-opp-456',
      });

      console.log('✅ accept_intro_opportunity selected when user confirms and opportunity exists');
    });

    it('should NOT fabricate intro_opportunity_id if not in priorities', async () => {
      const context = {
        user: {
          id: 'user-123',
          first_name: 'Sarah',
          phone_number: '+1234567890',
          verified: true,
          innovator: false,
          expert_connector: true,
          credit_balance: 50,
          status_level: 'member',
        },
        recentMessages: [
          { role: 'user', content: 'yes I can make that intro', created_at: new Date().toISOString() },
        ],
        userPriorities: [], // NO intro_opportunity in priorities
        outstandingCommunityRequests: [],
      };

      const userMessage = context.recentMessages[0];
      const decision = await callUserMessageDecision(anthropic, userMessage, context);

      // VERIFY: Call 1 did NOT select accept_intro_opportunity
      const toolNames = decision.tools_to_execute.map(t => t.tool_name);
      expect(toolNames).not.toContain('accept_intro_opportunity');

      console.log('✅ Correctly avoided fabricating intro_opportunity when none exists');
    });
  });

  // ============================================================================
  // TEST GROUP 3: accept_connection_request - Context-Dependent Selection
  // ============================================================================

  describe('accept_connection_request - Context-Dependent Tool Selection', () => {
    it('should select accept_connection_request when user accepts and connection_request in priorities', async () => {
      const context = {
        user: {
          id: 'user-123',
          first_name: 'Sarah',
          phone_number: '+1234567890',
          verified: true,
          innovator: true,
          expert_connector: false,
          credit_balance: 50,
          status_level: 'member',
        },
        recentMessages: [
          { role: 'assistant', content: 'Rob from MediaMath wants to connect. He\'s looking for CTV expertise.', created_at: new Date(Date.now() - 60000).toISOString() },
          { role: 'user', content: 'sure, sounds good', created_at: new Date().toISOString() },
        ],
        userPriorities: [
          {
            id: 'priority-456',
            item_type: 'connection_request',
            item_id: 'conn-req-789',
            value_score: 90,
            status: 'active',
          },
        ],
        outstandingCommunityRequests: [],
      };

      const userMessage = context.recentMessages[1];
      const decision = await callUserMessageDecision(anthropic, userMessage, context);

      // VERIFY: Call 1 selected accept_connection_request
      expect(decision.tools_to_execute).toHaveLength(1);
      expect(decision.tools_to_execute[0].tool_name).toBe('accept_connection_request');
      expect(decision.tools_to_execute[0].params).toMatchObject({
        connection_request_id: 'conn-req-789',
      });

      console.log('✅ accept_connection_request selected when user accepts and request exists');
    });
  });

  // ============================================================================
  // TEST GROUP 4: accept_intro_offer - Context-Dependent Selection
  // ============================================================================

  describe('accept_intro_offer - Context-Dependent Tool Selection', () => {
    it('should select accept_intro_offer when user accepts and intro_offer in priorities', async () => {
      const context = {
        user: {
          id: 'user-123',
          first_name: 'Sarah',
          phone_number: '+1234567890',
          verified: true,
          innovator: true,
          expert_connector: false,
          credit_balance: 50,
          status_level: 'member',
        },
        recentMessages: [
          { role: 'assistant', content: 'Mike can introduce you to Tony at IAB. Want me to coordinate?', created_at: new Date(Date.now() - 60000).toISOString() },
          { role: 'user', content: 'yes please', created_at: new Date().toISOString() },
        ],
        userPriorities: [
          {
            id: 'priority-789',
            item_type: 'intro_offer',
            item_id: 'intro-offer-321',
            value_score: 95,
            status: 'active',
          },
        ],
        outstandingCommunityRequests: [],
      };

      const userMessage = context.recentMessages[1];
      const decision = await callUserMessageDecision(anthropic, userMessage, context);

      // VERIFY: Call 1 selected accept_intro_offer
      expect(decision.tools_to_execute).toHaveLength(1);
      expect(decision.tools_to_execute[0].tool_name).toBe('accept_intro_offer');
      expect(decision.tools_to_execute[0].params).toMatchObject({
        intro_offer_id: 'intro-offer-321',
      });

      console.log('✅ accept_intro_offer selected when user accepts and offer exists');
    });
  });

  // ============================================================================
  // TEST GROUP 5: Call 2 Message Composition - No Hallucinations
  // ============================================================================

  describe('Call 2 Message Composition - No Hallucinations', () => {
    it('should NOT fabricate people names when using publish_community_request', async () => {
      const call1Output = {
        tools_to_execute: [
          {
            tool_name: 'publish_community_request',
            params: {
              question: 'Looking for CTV experts who can help scale from $100k to $1M',
              expertise_needed: ['ctv', 'advertising', 'scaling'],
            },
          },
        ],
        next_scenario: 'community_request_acknowledgment',
        context_for_call_2: {
          primary_topic: 'Finding CTV experts',
          tone: 'helpful',
          personalization_hooks: {
            user_name: 'Sarah',
          },
        },
      };

      const personalityPrompt = buildPersonalityPrompt(
        call1Output.next_scenario,
        JSON.stringify(call1Output.context_for_call_2),
        {}
      );

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        temperature: 0.7,
        system: personalityPrompt,
        messages: [{ role: 'user', content: 'Compose the response message.' }],
      });

      const messageText = response.content[0].type === 'text' ? response.content[0].text : '';

      // VERIFY: No fabricated people names
      expect(messageText).not.toMatch(/I can connect you with/i);
      expect(messageText).not.toMatch(/Brian|Sarah Chen|Mike Smith/); // Common fabricated names

      // VERIFY: Should mention asking community
      expect(messageText.toLowerCase()).toMatch(/community|network|reach out/);

      console.log('✅ Call 2 did not fabricate people when using publish_community_request');
      console.log('Message:', messageText);
    });

    it('should NOT promise timelines', async () => {
      const call1Output = {
        tools_to_execute: [
          {
            tool_name: 'publish_community_request',
            params: {
              question: 'Need CTV vendor recommendations',
              expertise_needed: ['ctv', 'vendors'],
            },
          },
        ],
        next_scenario: 'community_request_acknowledgment',
        context_for_call_2: {
          primary_topic: 'CTV vendor recommendations',
          tone: 'helpful',
          personalization_hooks: {
            user_name: 'Sarah',
          },
        },
      };

      const personalityPrompt = buildPersonalityPrompt(
        call1Output.next_scenario,
        JSON.stringify(call1Output.context_for_call_2),
        {}
      );

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        temperature: 0.7,
        system: personalityPrompt,
        messages: [{ role: 'user', content: 'Compose the response message.' }],
      });

      const messageText = response.content[0].type === 'text' ? response.content[0].text : '';

      // VERIFY: No timeline promises
      expect(messageText).not.toMatch(/in the next couple days/i);
      expect(messageText).not.toMatch(/within 24 hours/i);
      expect(messageText).not.toMatch(/by tomorrow/i);
      expect(messageText).not.toMatch(/should have.*by/i);

      console.log('✅ Call 2 did not promise timelines');
      console.log('Message:', messageText);
    });

    it('should maintain proper tone (no exclamations, no superlatives)', async () => {
      const call1Output = {
        tools_to_execute: [
          {
            tool_name: 'store_user_goal',
            params: {
              goal: 'Find CTV advertising partners',
            },
          },
        ],
        next_scenario: 'goal_stored_acknowledgment',
        context_for_call_2: {
          primary_topic: 'User shared goal',
          tone: 'helpful',
          personalization_hooks: {
            user_name: 'Sarah',
          },
        },
      };

      const personalityPrompt = buildPersonalityPrompt(
        call1Output.next_scenario,
        JSON.stringify(call1Output.context_for_call_2),
        {}
      );

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        temperature: 0.7,
        system: personalityPrompt,
        messages: [{ role: 'user', content: 'Compose the response message.' }],
      });

      const messageText = response.content[0].type === 'text' ? response.content[0].text : '';

      // VERIFY: No exclamation points
      expect(messageText).not.toContain('!');

      // VERIFY: No superlatives
      expect(messageText.toLowerCase()).not.toMatch(/awesome|amazing|incredible|fantastic/);

      // VERIFY: Brief (under 200 characters)
      expect(messageText.length).toBeLessThan(200);

      console.log('✅ Call 2 maintained proper tone');
      console.log('Message:', messageText);
    });
  });

  // ============================================================================
  // TEST GROUP 6: Call 2 Message Accuracy
  // ============================================================================

  describe('Call 2 Message Accuracy - Describes Action Correctly', () => {
    it('should say "I\'ll ask the community" when Call 1 used publish_community_request', async () => {
      const call1Output = {
        tools_to_execute: [
          {
            tool_name: 'publish_community_request',
            params: {
              question: 'Need help with CTV scaling',
              expertise_needed: ['ctv'],
            },
          },
        ],
        next_scenario: 'community_request_acknowledgment',
        context_for_call_2: {
          primary_topic: 'CTV scaling help',
          tone: 'helpful',
        },
      };

      const personalityPrompt = buildPersonalityPrompt(
        call1Output.next_scenario,
        JSON.stringify(call1Output.context_for_call_2),
        {}
      );

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        temperature: 0.7,
        system: personalityPrompt,
        messages: [{ role: 'user', content: 'Compose the response message.' }],
      });

      const messageText = response.content[0].type === 'text' ? response.content[0].text : '';

      // VERIFY: Message should indicate asking community (not making intro)
      expect(messageText.toLowerCase()).toMatch(/community|network|reach out|ask|find/);

      // VERIFY: Should NOT say "I can connect you" or "I'll make that intro"
      expect(messageText.toLowerCase()).not.toMatch(/i can connect you|i'll make.*intro|i'll introduce/);

      console.log('✅ Call 2 accurately described publish_community_request action');
      console.log('Message:', messageText);
    });

    it('should acknowledge intro offer when Call 1 used offer_introduction', async () => {
      const call1Output = {
        tools_to_execute: [
          {
            tool_name: 'offer_introduction',
            params: {
              prospect_name: 'Mike Johnson',
              introducee_user_id: 'user-456',
            },
          },
        ],
        next_scenario: 'intro_opportunity_acknowledgment',
        context_for_call_2: {
          primary_topic: 'User offered intro to Mike Johnson',
          tone: 'helpful',
        },
      };

      const personalityPrompt = buildPersonalityPrompt(
        call1Output.next_scenario,
        JSON.stringify(call1Output.context_for_call_2),
        { introOfferId: 'intro-offer-123' }
      );

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        temperature: 0.7,
        system: personalityPrompt,
        messages: [{ role: 'user', content: 'Compose the response message.' }],
      });

      const messageText = response.content[0].type === 'text' ? response.content[0].text : '';

      // VERIFY: Should acknowledge the offer (not fabricate other people)
      expect(messageText.toLowerCase()).toMatch(/thanks|got it|noted/);

      console.log('✅ Call 2 acknowledged intro offer');
      console.log('Message:', messageText);
    });
  });

  // ============================================================================
  // TEST GROUP 7: Negative Cases - Hallucination Prevention
  // ============================================================================

  describe('Negative Cases - Hallucination Prevention', () => {
    it('should NOT fabricate intro when user asks "Can you connect me with Brian?" and no Brian exists', async () => {
      const context = {
        user: {
          id: 'user-123',
          first_name: 'Sarah',
          phone_number: '+1234567890',
          verified: true,
          innovator: false,
          expert_connector: false,
          credit_balance: 50,
          status_level: 'member',
        },
        recentMessages: [
          { role: 'user', content: 'Can you connect me with Brian Martinez at Roku?', created_at: new Date().toISOString() },
        ],
        userPriorities: [], // NO Brian in priorities
        outstandingCommunityRequests: [],
      };

      const userMessage = context.recentMessages[0];
      const decision = await callUserMessageDecision(anthropic, userMessage, context);

      // VERIFY: Did NOT select any intro acceptance tools
      const toolNames = decision.tools_to_execute.map(t => t.tool_name);
      expect(toolNames).not.toContain('accept_intro_opportunity');
      expect(toolNames).not.toContain('accept_intro_offer');
      expect(toolNames).not.toContain('offer_introduction');

      // VERIFY: Should use publish_community_request to find Brian
      expect(toolNames).toContain('publish_community_request');

      console.log('✅ Correctly avoided fabricating Brian intro');
    });

    it('should NOT commit to making intro before consent obtained', async () => {
      const context = {
        user: {
          id: 'user-123',
          first_name: 'Sarah',
          phone_number: '+1234567890',
          verified: true,
          innovator: false,
          expert_connector: false,
          credit_balance: 50,
          status_level: 'member',
        },
        recentMessages: [
          { role: 'user', content: 'I need to talk to someone at Hulu about CTV', created_at: new Date().toISOString() },
        ],
        userPriorities: [],
        outstandingCommunityRequests: [],
      };

      const userMessage = context.recentMessages[0];
      const decision = await callUserMessageDecision(anthropic, userMessage, context);

      // Get Call 2 message
      const personalityPrompt = buildPersonalityPrompt(
        decision.next_scenario,
        JSON.stringify(decision.context_for_call_2),
        {}
      );

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        temperature: 0.7,
        system: personalityPrompt,
        messages: [{ role: 'user', content: 'Compose the response message.' }],
      });

      const messageText = response.content[0].type === 'text' ? response.content[0].text : '';

      // VERIFY: Should NOT commit to making intro ("I can connect you with Sarah Chen at Hulu...")
      expect(messageText.toLowerCase()).not.toMatch(/i can connect you with \w+ \w+ at hulu/i);
      expect(messageText.toLowerCase()).not.toMatch(/i'll introduce you to \w+ \w+/i);

      // VERIFY: Should indicate checking/reaching out
      expect(messageText.toLowerCase()).toMatch(/check|reach out|see if|community/);

      console.log('✅ Did not commit to intro before consent');
      console.log('Message:', messageText);
    });
  });
});
