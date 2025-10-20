/**
 * Twilio Mock Implementation
 *
 * Mocks Twilio API for testing SMS functionality.
 * Captures sent messages and provides webhook validation simulation.
 */

interface SentMessage {
  to: string;
  from: string;
  body: string;
  sid: string;
  status: string;
  timestamp: Date;
}

class MockTwilioClient {
  private sentMessages: SentMessage[] = [];
  private webhookValidation: boolean = true;

  constructor() {
    this.reset();
  }

  /**
   * Reset mock state
   */
  reset() {
    this.sentMessages = [];
    this.webhookValidation = true;
  }

  /**
   * Mock messages.create()
   */
  get messages() {
    return {
      create: async (params: {
        to: string;
        from: string;
        body: string;
      }): Promise<any> => {
        const message: SentMessage = {
          to: params.to,
          from: params.from,
          body: params.body,
          sid: this.generateMessageSid(),
          status: 'queued',
          timestamp: new Date(),
        };

        this.sentMessages.push(message);

        return {
          sid: message.sid,
          to: message.to,
          from: message.from,
          body: message.body,
          status: message.status,
          dateCreated: message.timestamp,
          dateSent: null,
          dateUpdated: message.timestamp,
          direction: 'outbound-api',
          errorCode: null,
          errorMessage: null,
          numSegments: '1',
          price: null,
          priceUnit: 'USD',
          apiVersion: '2010-04-01',
          uri: `/2010-04-01/Accounts/test/Messages/${message.sid}.json`,
        };
      },

      /**
       * Mock messages.fetch()
       */
      fetch: async (sid: string): Promise<any> => {
        const message = this.sentMessages.find((m) => m.sid === sid);

        if (!message) {
          throw new Error(`Message ${sid} not found`);
        }

        return {
          sid: message.sid,
          to: message.to,
          from: message.from,
          body: message.body,
          status: message.status,
          dateCreated: message.timestamp,
        };
      },

      /**
       * Mock messages.list()
       */
      list: async (params?: any): Promise<any[]> => {
        let filtered = [...this.sentMessages];

        if (params?.to) {
          filtered = filtered.filter((m) => m.to === params.to);
        }

        if (params?.from) {
          filtered = filtered.filter((m) => m.from === params.from);
        }

        return filtered.map((m) => ({
          sid: m.sid,
          to: m.to,
          from: m.from,
          body: m.body,
          status: m.status,
          dateCreated: m.timestamp,
        }));
      },
    };
  }

  /**
   * Mock webhook validation
   */
  validateRequest(
    authToken: string,
    signature: string,
    url: string,
    params: any
  ): boolean {
    return this.webhookValidation;
  }

  /**
   * Set webhook validation result (for testing)
   */
  setWebhookValidation(isValid: boolean) {
    this.webhookValidation = isValid;
  }

  /**
   * Get all sent messages
   */
  getSentMessages(): SentMessage[] {
    return [...this.sentMessages];
  }

  /**
   * Get messages sent to a specific number
   */
  getMessagesSentTo(phoneNumber: string): SentMessage[] {
    return this.sentMessages.filter((m) => m.to === phoneNumber);
  }

  /**
   * Get last message sent
   */
  getLastMessage(): SentMessage | null {
    return this.sentMessages[this.sentMessages.length - 1] || null;
  }

  /**
   * Clear sent messages history
   */
  clearMessageHistory() {
    this.sentMessages = [];
  }

  /**
   * Update message status (for testing webhooks)
   */
  updateMessageStatus(sid: string, status: string) {
    const message = this.sentMessages.find((m) => m.sid === sid);
    if (message) {
      message.status = status;
    }
  }

  /**
   * Generate mock message SID
   */
  private generateMessageSid(): string {
    return `SM${Math.random().toString(36).substr(2, 32).toUpperCase()}`;
  }

  /**
   * Simulate incoming webhook payload
   */
  createInboundWebhookPayload(params: {
    from: string;
    to: string;
    body: string;
  }): any {
    return {
      MessageSid: this.generateMessageSid(),
      AccountSid: 'test-account-sid',
      MessagingServiceSid: null,
      From: params.from,
      To: params.to,
      Body: params.body,
      NumMedia: '0',
      FromCity: 'New York',
      FromState: 'NY',
      FromZip: '10001',
      FromCountry: 'US',
      ToCity: '',
      ToState: '',
      ToZip: '',
      ToCountry: 'US',
      SmsStatus: 'received',
      SmsSid: this.generateMessageSid(),
      ApiVersion: '2010-04-01',
    };
  }

  /**
   * Simulate status callback webhook payload
   */
  createStatusWebhookPayload(params: {
    messageSid: string;
    status: 'sent' | 'delivered' | 'failed';
  }): any {
    return {
      MessageSid: params.messageSid,
      MessageStatus: params.status,
      ErrorCode: params.status === 'failed' ? '30001' : null,
      ErrorMessage: params.status === 'failed' ? 'Queue overflow' : null,
      SmsSid: params.messageSid,
      SmsStatus: params.status,
      ApiVersion: '2010-04-01',
    };
  }
}

// Export singleton instance
export const mockTwilio = new MockTwilioClient();

/**
 * Reset mock to initial state
 */
export function resetTwilioMock() {
  mockTwilio.reset();
}

/**
 * Create a mock Twilio client (for dependency injection)
 */
export function createMockTwilioClient(): any {
  return mockTwilio;
}

// Type declarations
declare global {
  var mockTwilio: MockTwilioClient;
}

export type { SentMessage };
