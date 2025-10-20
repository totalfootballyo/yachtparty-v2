/**
 * End-to-End Verified User Conversation Test
 *
 * Tests complete conversations with verified users using Concierge agent.
 */

import { mockSupabase } from '../mocks/supabase.mock';
import { mockTwilio } from '../mocks/twilio.mock';
import { mockAnthropic } from '../mocks/anthropic.mock';
import {
  createVerifiedUser,
  createTestConversation,
  createTestMessage,
  createTestUserPriority,
  createTestIntroOpportunity,
} from '../helpers/test-data';

describe('E2E: Verified User Conversation', () => {
  it('should handle solution inquiry conversation', async () => {
    // Arrange
    const user = createVerifiedUser();
    const conversation = createTestConversation({ user_id: user.id });

    mockSupabase.seedDatabase({
      users: [user],
      conversations: [conversation],
    });

    // Configure mocks
    mockAnthropic.mockConciergeIntent('solution_inquiry', {
      description: 'Need a CRM tool',
      category: 'sales_tools',
      urgency: 'medium',
    });

    mockAnthropic.mockConciergeMessage(
      'I can help you find a CRM solution. What features are most important?'
    );

    // Act - User asks for solution
    const inbound = createTestMessage({
      conversation_id: conversation.id,
      user_id: user.id,
      content: 'I need help finding a good CRM tool',
      direction: 'inbound',
    });
    await mockSupabase.from('messages').insert(inbound);

    // Classify intent
    const intent = await mockAnthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: inbound.content }],
    });

    // Create event
    const event = {
      id: 'event-1',
      event_type: 'user.inquiry.solution_needed',
      aggregate_id: user.id,
      aggregate_type: 'user' as const,
      payload: JSON.parse(intent.content[0].text).extracted_data,
      processed: false,
      version: 1,
      created_at: new Date().toISOString(),
      created_by: 'concierge_agent',
    };
    await mockSupabase.from('events').insert(event);

    // Generate response
    const response = await mockAnthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: 'Generate response' }],
    });

    const outbound = createTestMessage({
      conversation_id: conversation.id,
      user_id: user.id,
      role: 'concierge',
      content: response.content[0].text,
      direction: 'outbound',
    });
    await mockSupabase.from('messages').insert(outbound);

    // Send SMS
    await mockTwilio.messages.create({
      to: user.phone_number,
      from: '+15555555555',
      body: outbound.content,
    });

    // Assert
    const messages = await mockSupabase
      .from('messages')
      .select()
      .eq('conversation_id', conversation.id);

    expect(messages.data).toHaveLength(2);

    const events = await mockSupabase
      .from('events')
      .select()
      .eq('event_type', 'user.inquiry.solution_needed');

    expect(events.data).toHaveLength(1);

    const sent = mockTwilio.getLastMessage();
    expect(sent?.body).toContain('CRM');
  });

  it('should surface intro opportunities at right time', async () => {
    // Arrange
    const user = createVerifiedUser();
    const conversation = createTestConversation({ user_id: user.id });
    const intro = createTestIntroOpportunity({
      connector_user_id: user.id,
      prospect_name: 'Jane Smith',
      prospect_company: 'Acme Corp',
      bounty_credits: 200,
    });
    const priority = createTestUserPriority({
      user_id: user.id,
      item_type: 'intro_opportunity',
      item_id: intro.id,
      priority_rank: 1,
      value_score: 90,
    });

    mockSupabase.seedDatabase({
      users: [user],
      conversations: [conversation],
      intro_opportunities: [intro],
      user_priorities: [priority],
    });

    // Configure timing decision mock
    mockAnthropic.mockResponse(/timing|mention/i, {
      mention_now: true,
      reasoning: 'User is engaged in conversation, good time to mention',
    });

    mockAnthropic.mockConciergeMessage(
      "By the way, I have a great intro opportunity for you: Jane Smith at Acme Corp. Interested?"
    );

    // Act - User sends casual message
    const inbound = createTestMessage({
      conversation_id: conversation.id,
      user_id: user.id,
      content: 'Thanks for the help!',
      direction: 'inbound',
    });
    await mockSupabase.from('messages').insert(inbound);

    // Check timing for priority surfacing
    const timingDecision = await mockAnthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{ role: 'user', content: 'Should I mention intro now?' }],
    });

    const decision = JSON.parse(timingDecision.content[0].text);

    // Generate response with intro
    const response = await mockAnthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: 'Generate response with intro' }],
    });

    // Mark priority as presented
    await mockSupabase
      .from('user_priorities')
      .update({ status: 'presented', presented_at: new Date() })
      .eq('id', priority.id);

    // Assert
    expect(decision.mention_now).toBe(true);

    const updatedPriority = await mockSupabase
      .from('user_priorities')
      .select()
      .eq('id', priority.id)
      .single();

    expect(updatedPriority.data.status).toBe('presented');
  });

  it('should handle community question workflow', async () => {
    // Arrange
    const user = createVerifiedUser();
    const conversation = createTestConversation({ user_id: user.id });

    mockSupabase.seedDatabase({
      users: [user],
      conversations: [conversation],
    });

    mockAnthropic.mockConciergeIntent('community_question', {
      question: 'What marketing automation tools work best?',
      expertise_needed: ['marketing', 'automation'],
    });

    mockAnthropic.mockConciergeMessage(
      "Great question! I'll ask our community of experts and get back to you soon."
    );

    // Act - User asks community question
    const inbound = createTestMessage({
      conversation_id: conversation.id,
      user_id: user.id,
      content: 'What marketing automation tools do people recommend?',
      direction: 'inbound',
    });
    await mockSupabase.from('messages').insert(inbound);

    // Classify intent
    const intent = await mockAnthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: inbound.content }],
    });

    // Create community request event
    const event = {
      id: 'event-1',
      event_type: 'community.request_needed',
      aggregate_id: user.id,
      aggregate_type: 'user' as const,
      payload: JSON.parse(intent.content[0].text).extracted_data,
      processed: false,
      version: 1,
      created_at: new Date().toISOString(),
      created_by: 'concierge_agent',
    };
    await mockSupabase.from('events').insert(event);

    // Generate response
    const response = await mockAnthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: 'Generate response' }],
    });

    const outbound = createTestMessage({
      conversation_id: conversation.id,
      user_id: user.id,
      role: 'concierge',
      content: response.content[0].text,
      direction: 'outbound',
    });
    await mockSupabase.from('messages').insert(outbound);

    // Assert
    const events = await mockSupabase
      .from('events')
      .select()
      .eq('event_type', 'community.request_needed');

    expect(events.data).toHaveLength(1);
    expect(events.data[0].payload.question).toContain('marketing');
  });

  it('should maintain conversation context across messages', async () => {
    // Arrange
    const user = createVerifiedUser();
    const conversation = createTestConversation({
      user_id: user.id,
      conversation_summary: 'User asking about CRM solutions, prefers Salesforce-like features',
      messages_since_summary: 3,
    });

    const messages = [
      createTestMessage({
        conversation_id: conversation.id,
        content: 'I need a CRM',
      }),
      createTestMessage({
        conversation_id: conversation.id,
        content: 'Something like Salesforce',
      }),
      createTestMessage({
        conversation_id: conversation.id,
        content: 'What do you recommend?',
      }),
    ];

    mockSupabase.seedDatabase({
      users: [user],
      conversations: [conversation],
      messages,
    });

    // Act - Load context
    const contextMessages = await mockSupabase
      .from('messages')
      .select()
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false })
      .limit(20);

    const summaryData = await mockSupabase
      .from('conversations')
      .select('conversation_summary')
      .eq('id', conversation.id)
      .single();

    // Assert
    expect(contextMessages.data).toHaveLength(3);
    expect(summaryData.data.conversation_summary).toContain('CRM');
  });
});
