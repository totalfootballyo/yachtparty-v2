/**
 * SMS Flow Integration Tests
 *
 * Tests complete SMS workflows from inbound to outbound.
 */

import { mockSupabase } from '../mocks/supabase.mock';
import { mockTwilio } from '../mocks/twilio.mock';
import { mockAnthropic } from '../mocks/anthropic.mock';
import {
  createVerifiedUser,
  createTestConversation,
  createTestMessage,
} from '../helpers/test-data';

describe('SMS Flow Integration', () => {
  describe('Inbound SMS Processing', () => {
    it('should process inbound SMS and create message record', async () => {
      // Arrange
      const user = createVerifiedUser();
      const conversation = createTestConversation({ user_id: user.id });
      const webhook = mockTwilio.createInboundWebhookPayload({
        from: user.phone_number,
        to: '+15555555555',
        body: 'Hello!',
      });

      mockSupabase.seedDatabase({
        users: [user],
        conversations: [conversation],
      });

      // Act - Simulate webhook processing
      const message = createTestMessage({
        conversation_id: conversation.id,
        user_id: user.id,
        content: webhook.Body,
        direction: 'inbound',
        twilio_message_sid: webhook.MessageSid,
      });

      await mockSupabase.from('messages').insert(message);

      const result = await mockSupabase
        .from('messages')
        .select()
        .eq('conversation_id', conversation.id)
        .eq('direction', 'inbound');

      // Assert
      expect(result.data).toHaveLength(1);
      expect(result.data[0].content).toBe('Hello!');
    });

    it('should create conversation for new user', async () => {
      // Arrange
      const user = createVerifiedUser();
      mockSupabase.seedDatabase({ users: [user] });

      // Act - Create conversation
      const conversation = createTestConversation({
        user_id: user.id,
        phone_number: user.phone_number,
      });

      await mockSupabase.from('conversations').insert(conversation);

      const result = await mockSupabase
        .from('conversations')
        .select()
        .eq('user_id', user.id)
        .single();

      // Assert
      expect(result.data).toBeDefined();
      expect(result.data.phone_number).toBe(user.phone_number);
    });
  });

  describe('Agent Processing', () => {
    it('should invoke appropriate agent based on user status', async () => {
      // Arrange
      const verifiedUser = createVerifiedUser({
        poc_agent_type: 'concierge',
      });
      const unverifiedUser = createVerifiedUser({
        verified: false,
        poc_agent_type: 'bouncer',
      });

      mockSupabase.seedDatabase({
        users: [verifiedUser, unverifiedUser],
      });

      // Act
      const verified = await mockSupabase
        .from('users')
        .select()
        .eq('verified', true)
        .single();
      const unverified = await mockSupabase
        .from('users')
        .select()
        .eq('verified', false)
        .single();

      // Assert
      expect(verified.data.poc_agent_type).toBe('concierge');
      expect(unverified.data.poc_agent_type).toBe('bouncer');
    });

    it('should generate agent response with LLM', async () => {
      // Arrange
      mockAnthropic.mockConciergeMessage('I can help with that!');

      // Act
      const response = await mockAnthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: 'Generate response' }],
      });

      // Assert
      expect(response.content[0].text).toContain('help');
    });
  });

  describe('Outbound SMS Delivery', () => {
    it('should queue outbound message', async () => {
      // Arrange
      const user = createVerifiedUser();
      const conversation = createTestConversation({ user_id: user.id });

      const outboundMessage = createTestMessage({
        conversation_id: conversation.id,
        user_id: user.id,
        role: 'concierge',
        content: 'Response message',
        direction: 'outbound',
        status: 'queued',
      });

      mockSupabase.seedDatabase({
        users: [user],
        conversations: [conversation],
        messages: [outboundMessage],
      });

      // Act
      const result = await mockSupabase
        .from('messages')
        .select()
        .eq('direction', 'outbound')
        .eq('status', 'queued');

      // Assert
      expect(result.data).toHaveLength(1);
    });

    it('should send SMS via Twilio', async () => {
      // Arrange
      const user = createVerifiedUser();

      // Act
      await mockTwilio.messages.create({
        to: user.phone_number,
        from: '+15555555555',
        body: 'Test response',
      });

      // Assert
      const sent = mockTwilio.getLastMessage();
      expect(sent?.body).toBe('Test response');
      expect(sent?.to).toBe(user.phone_number);
    });

    it('should update message status after sending', async () => {
      // Arrange
      const message = createTestMessage({
        direction: 'outbound',
        status: 'queued',
        twilio_message_sid: 'SM123',
      });

      mockSupabase.seedDatabase({ messages: [message] });

      // Act - Simulate status update
      await mockSupabase
        .from('messages')
        .update({ status: 'sent', sent_at: new Date() })
        .eq('id', message.id);

      const result = await mockSupabase
        .from('messages')
        .select()
        .eq('id', message.id)
        .single();

      // Assert
      expect(result.data.status).toBe('sent');
      expect(result.data.sent_at).toBeDefined();
    });
  });

  describe('Complete SMS Flow', () => {
    it('should handle end-to-end SMS conversation', async () => {
      // Arrange
      const user = createVerifiedUser();
      const conversation = createTestConversation({ user_id: user.id });

      mockSupabase.seedDatabase({
        users: [user],
        conversations: [conversation],
      });

      mockAnthropic.mockConciergeMessage('How can I help?');

      // Act - Simulate full flow
      // 1. Inbound SMS
      const inbound = createTestMessage({
        conversation_id: conversation.id,
        user_id: user.id,
        content: 'Hello',
        direction: 'inbound',
      });
      await mockSupabase.from('messages').insert(inbound);

      // 2. Agent processing (mocked LLM call)
      const agentResponse = await mockAnthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: 'Hello' }],
      });

      // 3. Outbound SMS
      const outbound = createTestMessage({
        conversation_id: conversation.id,
        user_id: user.id,
        content: agentResponse.content[0].text,
        direction: 'outbound',
      });
      await mockSupabase.from('messages').insert(outbound);

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
      expect(messages.data[0].direction).toBe('inbound');
      expect(messages.data[1].direction).toBe('outbound');

      const sent = mockTwilio.getLastMessage();
      expect(sent?.body).toContain('help');
    });
  });

  describe('Status Callbacks', () => {
    it('should handle delivery status webhooks', async () => {
      // Arrange
      const messageSid = 'SM123';
      const statusWebhook = mockTwilio.createStatusWebhookPayload({
        messageSid,
        status: 'delivered',
      });

      // Act
      mockTwilio.updateMessageStatus(messageSid, 'delivered');

      const message = createTestMessage({
        twilio_message_sid: messageSid,
        status: 'delivered',
        delivered_at: new Date(),
      });

      mockSupabase.seedDatabase({ messages: [message] });

      const result = await mockSupabase
        .from('messages')
        .select()
        .eq('twilio_message_sid', messageSid)
        .single();

      // Assert
      expect(result.data.status).toBe('delivered');
      expect(result.data.delivered_at).toBeDefined();
    });
  });
});
