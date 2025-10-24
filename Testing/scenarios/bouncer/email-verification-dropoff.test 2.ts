/**
 * Bouncer - Email Verification Drop-off Test
 *
 * Tests scenarios where users provide partial information but don't complete
 * the email verification process.
 *
 * Expected behavior:
 * - Agent should handle partial information gracefully
 * - Agent should not push too hard if user seems uncertain
 * - Tone should remain professional even if user drops off
 * - No critical errors or hallucinations
 */

import { ConversationRunner } from '../../framework/ConversationRunner';
import type { SimulatedPersona } from '../../framework/SimulatedUser';
import { resetTestDatabase } from '../../packages/testing/src/helpers/db-utils';

// Create a "Hesitant Hannah" persona for this test
const HESITANT_HANNAH: SimulatedPersona = {
  name: 'Hesitant Hannah',
  personality: 'Interested initially but becomes uncertain and eventually drops off',

  systemPrompt: `You are Hannah, a professional who starts interested in the service but becomes uncertain as more information is requested.

Personality traits:
- Starts engaged and friendly
- Becomes progressively more hesitant as conversation continues
- Concerned about privacy and commitment
- Eventually decides to "think about it" rather than completing signup
- Polite but firm when deciding to pause

Background:
- VP Marketing at "BrandBoost Agency"
- Your colleague mentioned the service
- Initially curious but risk-averse
- You like to research things thoroughly before committing

Conversation pattern:
- Turns 1-2: Engaged ("Hi! My colleague told me about this")
- Turns 3-4: Starting to hesitate ("Actually, can I think about this?")
- Turns 5+: Politely declining to continue ("I think I need to research this more first", "Let me get back to you")

Example responses:
- "Hey, my colleague Sarah mentioned this could be useful"
- "Hmm, I'm not sure I'm ready to give my email yet"
- "Actually, can I think about this first?"
- "I appreciate the info but I think I need to do some research before I sign up"
- "Let me get back to you on this"

IMPORTANT:
- Stay in character as Hannah
- Show progression from engaged → hesitant → politely declining
- Don't ghost - always respond politely
- Keep responses conversational SMS-length`,

  initialContext: {
    referrer: 'Sarah Thompson',
    company: 'BrandBoost Agency',
    title: 'VP Marketing'
  }
};

describe('Bouncer - Email Verification Drop-off', () => {
  let runner: ConversationRunner;

  beforeAll(() => {
    runner = new ConversationRunner();
  });

  beforeEach(async () => {
    await resetTestDatabase();
  }, 30000);

  it('should handle user who becomes hesitant and drops off gracefully', async () => {
    console.log('\n' + '='.repeat(60));
    console.log('TEST: Hesitant Hannah - Email Verification Drop-off');
    console.log('='.repeat(60) + '\n');

    const result = await runner.runSimulation(HESITANT_HANNAH, 'bouncer', 15);

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

    // Tone is especially critical for drop-off scenarios
    // Agent should not be pushy or salesy when user is hesitant
    if (result.judgeScore.tone < 0.7) {
      console.warn(`\n⚠️  Tone score (${result.judgeScore.tone.toFixed(2)}) below 0.7`);
      console.warn('Agent should handle hesitation professionally without being pushy');
      console.warn('Reasoning:', result.judgeScore.reasoning);
    } else {
      console.log(`✅ Tone score ${result.judgeScore.tone.toFixed(2)} - handled hesitation professionally`);
    }

    // Completeness may be lower since user didn't complete - this is okay
    if (result.judgeScore.completeness < 1.0) {
      console.log(`ℹ️  Completeness ${result.judgeScore.completeness.toFixed(2)} - expected for drop-off scenario`);
    }

    // Flow should still be good even if user drops off
    expect(result.judgeScore.flow).toBeGreaterThan(0.6);
    console.log(`✅ Flow score ${result.judgeScore.flow.toFixed(2)} - conversation progressed naturally`);

    await runner.cleanup(result.user.id);
    console.log('\n✅ Test complete - user cleaned up');

  }, 180000);

  afterAll(() => {
    console.log('\n' + '='.repeat(60));
    console.log('Email Verification Drop-off Test Complete');
    console.log('='.repeat(60) + '\n');
  });
});
