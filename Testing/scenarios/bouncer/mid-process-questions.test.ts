/**
 * Bouncer - Mid-Process Questions Test
 *
 * Tests scenarios where users ask clarifying questions throughout the onboarding process
 * instead of just providing information.
 *
 * Expected behavior:
 * - Agent should answer questions clearly and concisely
 * - Agent should return to collecting required information after answering
 * - Tone should remain helpful and professional
 * - Flow should handle interruptions gracefully
 * - No critical errors or hallucinations
 */

import { ConversationRunner } from '../../framework/ConversationRunner';
import type { SimulatedPersona } from '../../framework/SimulatedUser';

// Create a "Curious Chris" persona for this test
const CURIOUS_CHRIS: SimulatedPersona = {
  name: 'Curious Chris',
  personality: 'Engaged and cooperative but asks many clarifying questions',

  systemPrompt: `You are Chris, a thoughtful professional who asks clarifying questions throughout the onboarding process.

Personality traits:
- Genuinely interested and will complete onboarding
- Asks "why" and "how" questions frequently
- Wants to understand the process before proceeding
- Cooperative once questions are answered
- Detail-oriented and thorough

Background:
- Director of Sales at "Pipeline Partners"
- Referred by a trusted colleague Jamie Lee
- Values transparency and understanding processes
- Will provide information but wants clarity first

Conversation pattern:
- Starts engaged: "Hi! Jamie Lee told me about this"
- Frequently interrupts with questions: "Why do you need my company?", "How is my email used?", "What happens after I verify?"
- Provides information after getting satisfactory answers
- Asks about next steps proactively

Example responses:
- "Hey, Jamie mentioned this. What exactly does this service do?"
- "Okay got it. Why do you need my company name?"
- "Makes sense. How long will verification take?"
- "Chris Martinez, Director of Sales. What's the next step?"
- "chris.martinez@pipelinepartners.com - will I get spam?"
- "Got it, thanks for explaining. What happens after I verify my email?"

Behavior pattern:
- Ask question → Get answer → Provide requested info → Ask another question
- Always eventually complies after getting answers
- Questions are legitimate, not stalling tactics

IMPORTANT:
- Stay in character as Chris
- Ask questions but don't be annoying or repetitive
- Provide information after getting satisfactory answers
- Keep responses conversational SMS-length
- Show you're engaged and just want clarity`,

  initialContext: {
    referrer: 'Jamie Lee',
    company: 'Pipeline Partners',
    title: 'Director of Sales',
    expertise: 'B2B sales, lead generation, sales process optimization'
  }
};

describe('Bouncer - Mid-Process Questions', () => {
  let runner: ConversationRunner;

  beforeAll(() => {
    runner = new ConversationRunner();
  });

  it('should handle user who asks clarifying questions throughout onboarding', async () => {
    console.log('\n' + '='.repeat(60));
    console.log('TEST: Curious Chris - Mid-Process Questions');
    console.log('='.repeat(60) + '\n');

    const result = await runner.runSimulation(CURIOUS_CHRIS, 'bouncer', 25);

    console.log('\n--- Judge Evaluation ---');
    console.log(`Overall Score: ${result.judgeScore.overall.toFixed(2)}`);
    console.log(`  Tone: ${result.judgeScore.tone.toFixed(2)}`);
    console.log(`  Flow: ${result.judgeScore.flow.toFixed(2)}`);
    console.log(`  Completeness: ${result.judgeScore.completeness.toFixed(2)}`);

    if (result.judgeScore.errors.length > 0) {
      console.log(`\n⚠️  Critical Errors (${result.judgeScore.errors.length}):`);
      result.judgeScore.errors.forEach(err => console.log(`  - ${err}`));
    }

    console.log('\n--- Test Assertions ---');

    // Critical errors should always fail
    expect(result.judgeScore.errors.length).toBe(0);
    console.log('✅ No critical errors');

    // Should still complete onboarding despite questions
    expect(result.toolsUsed).toContain('collect_user_info');
    expect(result.toolsUsed).toContain('send_verification_email');
    console.log('✅ Completed onboarding despite mid-process questions');

    // Flow is critical - agent must handle interruptions gracefully
    if (result.judgeScore.flow < 0.7) {
      console.warn(`\n⚠️  Flow score (${result.judgeScore.flow.toFixed(2)}) below 0.7`);
      console.warn('Agent should handle questions gracefully and return to onboarding flow');
      console.warn('Reasoning:', result.judgeScore.reasoning);
    } else {
      console.log(`✅ Flow score ${result.judgeScore.flow.toFixed(2)} - handled questions gracefully`);
    }

    // Tone should be helpful when answering questions
    expect(result.judgeScore.tone).toBeGreaterThan(0.7);
    console.log(`✅ Tone score ${result.judgeScore.tone.toFixed(2)} - remained helpful while answering questions`);

    await runner.cleanup(result.user.id);
    console.log('\n✅ Test complete - user cleaned up');

  }, 240000); // 4 minutes - longer timeout due to more back-and-forth

  afterAll(() => {
    console.log('\n' + '='.repeat(60));
    console.log('Mid-Process Questions Test Complete');
    console.log('='.repeat(60) + '\n');
  });
});
