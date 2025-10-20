/**
 * Example usage of Message Orchestrator
 *
 * This file demonstrates how different agents should use the orchestrator
 * to queue and send messages to users.
 */

import { MessageOrchestrator } from '../src';

// Initialize the orchestrator (typically done once per service)
const orchestrator = new MessageOrchestrator({
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_KEY,
  anthropicKey: process.env.ANTHROPIC_API_KEY,
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
  twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER
});

/**
 * Example 1: Concierge Agent - Intro Opportunity
 * Medium priority, can delay for optimal timing, requires fresh context
 */
async function exampleIntroOpportunity() {
  const messageId = await orchestrator.queueMessage({
    userId: 'user_123',
    agentId: 'concierge_main',
    messageData: {
      type: 'intro_opportunity',
      introId: 'intro_456',
      prospectName: 'John Smith',
      prospectCompany: 'Acme Corp',
      prospectTitle: 'VP of Engineering',
      mutualConnection: 'Sarah Johnson',
      bountyCredits: 50,
      reason: 'Both interested in enterprise AI solutions'
    },
    priority: 'medium',
    canDelay: true,
    requiresFreshContext: true
  });

  console.log(`Intro opportunity queued: ${messageId}`);
}

/**
 * Example 2: Solution Saga - Research Update
 * High priority, can delay, requires fresh context
 */
async function exampleSolutionUpdate() {
  const messageId = await orchestrator.queueMessage({
    userId: 'user_789',
    agentId: 'solution_saga_workflow_123',
    messageData: {
      type: 'solution_update',
      workflowId: 'workflow_123',
      requestDescription: 'Looking for enterprise CRM solution',
      findings: {
        matchedInnovators: [
          {
            id: 'inn_1',
            name: 'Acme Corp',
            relevance: 0.9,
            reason: 'Enterprise CRM with custom workflows',
            contactName: 'Jane Doe'
          },
          {
            id: 'inn_2',
            name: 'Beta Solutions',
            relevance: 0.75,
            reason: 'Mid-market CRM with strong integration capabilities'
          }
        ],
        potentialVendors: ['Salesforce', 'HubSpot', 'Pipedrive'],
        expertInsights: [
          {
            expertName: 'Mike Chen',
            recommendation: 'Consider Salesforce if budget allows, great for enterprise'
          }
        ],
        clarifyingQuestions: [
          {
            question: 'What is your budget range?',
            priority: 'high'
          },
          {
            question: 'How many users do you need to support?',
            priority: 'high'
          }
        ]
      }
    },
    priority: 'high',
    canDelay: true,
    requiresFreshContext: true
  });

  console.log(`Solution update queued: ${messageId}`);
}

/**
 * Example 3: Account Manager - Weekly Summary
 * Low priority, can delay, doesn't require fresh context
 */
async function exampleWeeklySummary() {
  const messageId = await orchestrator.queueMessage({
    userId: 'user_456',
    agentId: 'account_manager_main',
    messageData: {
      type: 'weekly_summary',
      week: '2025-10-15',
      stats: {
        introsCompleted: 2,
        creditsEarned: 100,
        communityQuestionsAnswered: 3,
        solutionsMatched: 1
      },
      highlights: [
        'Your intro to Sarah Johnson at TechCorp was completed',
        'You earned 50 credits for helping with the CRM question',
        'New intro opportunity available: John Smith at Acme Corp'
      ]
    },
    priority: 'low',
    canDelay: true,
    requiresFreshContext: false
  });

  console.log(`Weekly summary queued: ${messageId}`);
}

/**
 * Example 4: Community Request - Expert Question
 * High priority, send at optimal time, requires fresh context
 */
async function exampleCommunityRequest() {
  const messageId = await orchestrator.queueMessage({
    userId: 'user_expert_1',
    agentId: 'agent_of_humans',
    messageData: {
      type: 'community_request',
      requestId: 'req_789',
      question: 'What CRM systems work best for enterprise sales teams?',
      category: 'sales_tools',
      context: 'User is looking for enterprise CRM with strong integrations',
      creditsOffered: 25,
      urgency: 'medium'
    },
    priority: 'high',
    canDelay: true,
    requiresFreshContext: false
  });

  console.log(`Community request queued: ${messageId}`);
}

/**
 * Example 5: Urgent System Notification
 * Urgent priority, no delay, no fresh context check
 */
async function exampleUrgentNotification() {
  const messageId = await orchestrator.queueMessage({
    userId: 'user_123',
    agentId: 'system',
    messageData: {
      type: 'payment_required',
      reason: 'Credit card declined',
      action: 'Please update your payment method',
      url: 'https://yachtparty.xyz/billing'
    },
    priority: 'urgent',
    canDelay: false,
    requiresFreshContext: false
  });

  console.log(`Urgent notification queued: ${messageId}`);
}

/**
 * Example 6: Process due messages (called by cron)
 * This would typically run every minute via pg_cron
 */
async function exampleProcessDueMessages() {
  console.log('Processing due messages...');
  await orchestrator.processDueMessages();
  console.log('Processing complete');
}

/**
 * Example 7: Check if user is active
 * Useful for agents deciding whether to send immediately
 */
async function exampleCheckUserActive() {
  const userId = 'user_123';
  const isActive = await orchestrator.isUserActive(userId);

  if (isActive) {
    console.log(`User ${userId} is active - good time to send`);
  } else {
    console.log(`User ${userId} is not active - will schedule for optimal time`);
  }
}

/**
 * Example 8: Manual relevance check
 * Check if a queued message is still relevant
 */
async function exampleCheckRelevance() {
  // This is typically done internally by attemptDelivery,
  // but agents can also check manually if needed
  const message = {
    id: 'msg_123',
    user_id: 'user_456',
    message_data: {
      type: 'solution_update',
      findings: 'CRM recommendations...'
    },
    created_at: '2025-10-15T10:00:00Z'
  };

  // Note: This would need to cast to QueuedMessage type
  // const relevance = await orchestrator.checkMessageRelevance(message as any);
  // console.log(`Message relevance: ${relevance.classification}`);
}

// Export examples for testing
export {
  exampleIntroOpportunity,
  exampleSolutionUpdate,
  exampleWeeklySummary,
  exampleCommunityRequest,
  exampleUrgentNotification,
  exampleProcessDueMessages,
  exampleCheckUserActive,
  exampleCheckRelevance
};

// Run examples if called directly
if (require.main === module) {
  (async () => {
    console.log('Running Message Orchestrator examples...\n');

    // Uncomment to run specific examples:
    // await exampleIntroOpportunity();
    // await exampleSolutionUpdate();
    // await exampleWeeklySummary();
    // await exampleCommunityRequest();
    // await exampleUrgentNotification();
    // await exampleProcessDueMessages();
    // await exampleCheckUserActive();

    console.log('\nExamples complete');
  })();
}
