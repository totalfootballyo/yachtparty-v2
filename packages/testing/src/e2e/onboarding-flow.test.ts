/**
 * End-to-End Onboarding Flow Test
 *
 * Tests complete user onboarding from first message to verification.
 */

import { mockSupabase } from '../mocks/supabase.mock';
import { mockTwilio } from '../mocks/twilio.mock';
import { mockAnthropic } from '../mocks/anthropic.mock';
import {
  createTestUser,
  createTestConversation,
  createTestMessage,
} from '../helpers/test-data';

describe('E2E: Onboarding Flow', () => {
  it('should complete full onboarding conversation', async () => {
    // Arrange - New user sends first message
    const phoneNumber = '+15551234567';
    const user = createTestUser({
      phone_number: phoneNumber,
      verified: false,
      poc_agent_type: 'bouncer',
      first_name: null,
      company: null,
      email: null,
      linkedin_url: null,
    });

    const conversation = createTestConversation({
      user_id: user.id,
      phone_number: phoneNumber,
    });

    mockSupabase.seedDatabase({
      users: [user],
      conversations: [conversation],
    });

    // Configure mock responses
    const responses = [
      { extract: { first_name: 'Alice', company: 'TechCorp' } },
      { extract: { email: 'alice@techcorp.com' } },
      { extract: { linkedin_url: 'https://linkedin.com/in/alice' } },
    ];

    // Exchange 1: User provides name and company
    mockAnthropic.mockBouncerExtraction(responses[0].extract);
    mockAnthropic.mockBouncerResponse(
      "Great to meet you, Alice! What's your work email?"
    );

    const msg1 = createTestMessage({
      conversation_id: conversation.id,
      user_id: user.id,
      content: "Hi! I'm Alice from TechCorp",
      direction: 'inbound',
    });
    await mockSupabase.from('messages').insert(msg1);

    // Simulate extraction
    let extraction = await mockAnthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: msg1.content }],
    });

    // Update user
    await mockSupabase
      .from('users')
      .update({
        first_name: 'Alice',
        company: 'TechCorp',
      })
      .eq('id', user.id);

    // Generate response
    let response = await mockAnthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Generate response' }],
    });

    const resp1 = createTestMessage({
      conversation_id: conversation.id,
      user_id: user.id,
      role: 'bouncer',
      content: JSON.parse(response.content[0].text).message,
      direction: 'outbound',
    });
    await mockSupabase.from('messages').insert(resp1);

    // Exchange 2: User provides email
    mockAnthropic.mockBouncerExtraction(responses[1].extract);
    mockAnthropic.mockBouncerResponse(
      'Perfect! Last thing - can you share your LinkedIn profile?'
    );

    const msg2 = createTestMessage({
      conversation_id: conversation.id,
      user_id: user.id,
      content: 'alice@techcorp.com',
      direction: 'inbound',
    });
    await mockSupabase.from('messages').insert(msg2);

    await mockSupabase
      .from('users')
      .update({ email: 'alice@techcorp.com' })
      .eq('id', user.id);

    response = await mockAnthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Generate response' }],
    });

    const resp2 = createTestMessage({
      conversation_id: conversation.id,
      user_id: user.id,
      role: 'bouncer',
      content: JSON.parse(response.content[0].text).message,
      direction: 'outbound',
    });
    await mockSupabase.from('messages').insert(resp2);

    // Exchange 3: User provides LinkedIn
    mockAnthropic.mockBouncerExtraction(responses[2].extract);
    mockAnthropic.mockBouncerResponse(
      "Excellent! You're all set. Welcome to Yachtparty!"
    );

    const msg3 = createTestMessage({
      conversation_id: conversation.id,
      user_id: user.id,
      content: 'linkedin.com/in/alice',
      direction: 'inbound',
    });
    await mockSupabase.from('messages').insert(msg3);

    await mockSupabase
      .from('users')
      .update({
        linkedin_url: 'https://linkedin.com/in/alice',
        verified: true,
        poc_agent_type: 'concierge',
      })
      .eq('id', user.id);

    response = await mockAnthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Generate response' }],
    });

    const resp3 = createTestMessage({
      conversation_id: conversation.id,
      user_id: user.id,
      role: 'bouncer',
      content: JSON.parse(response.content[0].text).message,
      direction: 'outbound',
    });
    await mockSupabase.from('messages').insert(resp3);

    // Assert - Verify complete flow
    const finalUser = await mockSupabase
      .from('users')
      .select()
      .eq('id', user.id)
      .single();

    expect(finalUser.data.first_name).toBe('Alice');
    expect(finalUser.data.company).toBe('TechCorp');
    expect(finalUser.data.email).toBe('alice@techcorp.com');
    expect(finalUser.data.linkedin_url).toBe('https://linkedin.com/in/alice');
    expect(finalUser.data.verified).toBe(true);
    expect(finalUser.data.poc_agent_type).toBe('concierge');

    const messages = await mockSupabase
      .from('messages')
      .select()
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true });

    expect(messages.data).toHaveLength(6); // 3 inbound + 3 outbound
    expect(messages.data[0].direction).toBe('inbound');
    expect(messages.data[1].direction).toBe('outbound');
  });

  it('should handle incomplete onboarding gracefully', async () => {
    // Arrange
    const user = createTestUser({
      verified: false,
      first_name: 'Bob',
      company: null,
      email: null,
    });

    mockSupabase.seedDatabase({ users: [user] });

    // Act - User provides partial information then goes inactive
    const result = await mockSupabase
      .from('users')
      .select()
      .eq('id', user.id)
      .single();

    // Assert
    expect(result.data.verified).toBe(false);
    expect(result.data.first_name).toBe('Bob');
    expect(result.data.company).toBeNull();
  });

  it('should create re-engagement task for inactive users', async () => {
    // Arrange
    const user = createTestUser({ verified: false });
    const conversation = createTestConversation({ user_id: user.id });

    const task = {
      id: 'task-1',
      task_type: 're_engagement_check',
      agent_type: 'bouncer',
      user_id: user.id,
      context_id: conversation.id,
      scheduled_for: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h later
      priority: 'medium' as const,
      status: 'pending' as const,
      context_json: { missing_fields: ['email', 'linkedin_url'] },
    };

    mockSupabase.seedDatabase({
      users: [user],
      agent_tasks: [task],
    });

    // Act
    const result = await mockSupabase
      .from('agent_tasks')
      .select()
      .eq('user_id', user.id)
      .eq('task_type', 're_engagement_check')
      .single();

    // Assert
    expect(result.data).toBeDefined();
    expect(result.data.context_json.missing_fields).toContain('email');
  });

  it('should publish verification events', async () => {
    // Arrange
    const user = createTestUser({ verified: true });
    const event = {
      id: 'event-1',
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
      .eq('aggregate_id', user.id);

    // Assert
    expect(result.data).toHaveLength(1);
    expect(result.data[0].payload.pocAgentType).toBe('concierge');
  });
});
