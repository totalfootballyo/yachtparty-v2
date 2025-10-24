/**
 * Bouncer - Re-engagement Test
 *
 * Tests basic re-engagement scenarios where users return after dropping off.
 *
 * NOTE: This is a simplified version. Full timing tests (24h, 48h intervals)
 * require timestamp manipulation utilities which will be added later.
 *
 * Expected behavior:
 * - Agent should recognize returning user
 * - Agent should pick up where conversation left off
 * - Tone should be welcoming, not repetitive
 * - Should not ask for information already collected
 * - No critical errors or hallucinations
 */

import { ConversationRunner } from '../../framework/ConversationRunner';
import type { SimulatedPersona } from '../../framework/SimulatedUser';

// Create a "Returning Rachel" persona
const RETURNING_RACHEL: SimulatedPersona = {
  name: 'Returning Rachel',
  personality: 'Provided some info initially, dropped off, now returning to complete',

  systemPrompt: `You are Rachel, a professional who started the onboarding process, got busy, and is now returning to complete it.

Personality traits:
- Busy but organized
- Remembers giving some information before
- Wants to pick up where she left off
- Slightly apologetic for dropping off
- Ready to complete now

Background:
- COO at "OperationsHub Inc"
- Referred by colleague Mike Chen
- Started onboarding last time but got pulled into a meeting
- Already provided name and company previously
- Ready to finish the process now

Conversation pattern:
- Opens with reference to previous conversation: "Hi, I'm back - got pulled into a meeting last time"
- Expects agent to remember what was already discussed
- Provides remaining information efficiently
- Appreciates not having to repeat already-given info

Example responses:
- "Hi, it's me again - sorry I disappeared last time, got called into a meeting"
- "Yeah, I think I already gave you my name and company before"
- "Rachel Kim, we talked about this already remember?"
- "Okay let's finish this - what else do you need?"
- "rachel.kim@operationshub.io - can we wrap this up?"

IMPORTANT:
- Stay in character as Rachel
- Reference the fact that you've talked before
- Show slight impatience if asked for info you already provided
- Be cooperative and ready to finish
- Keep responses conversational SMS-length`,

  initialContext: {
    referrer: 'Mike Chen',
    company: 'OperationsHub Inc',
    title: 'COO',
    expertise: 'Operations, process optimization, team leadership'
  }
};

describe('Bouncer - Re-engagement', () => {
  let runner: ConversationRunner;

  beforeAll(() => {
    runner = new ConversationRunner();
  });

  it('should handle returning user who wants to complete onboarding', async () => {
    console.log('\n' + '='.repeat(60));
    console.log('TEST: Returning Rachel - Re-engagement');
    console.log('='.repeat(60) + '\n');

    console.log('NOTE: This test validates re-engagement behavior.');
    console.log('Full timing tests (24h/48h intervals) will be added when');
    console.log('timestamp manipulation utilities are implemented.\n');

    const result = await runner.runSimulation(RETURNING_RACHEL, 'bouncer', 20);

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

    // Should complete onboarding
    expect(result.toolsUsed).toContain('collect_user_info');
    expect(result.toolsUsed).toContain('send_verification_email');
    console.log('✅ Completed onboarding for returning user');

    // Tone should be welcoming for returning user
    if (result.judgeScore.tone < 0.7) {
      console.warn(`\n⚠️  Tone score (${result.judgeScore.tone.toFixed(2)}) below 0.7`);
      console.warn('Agent should be welcoming and efficient with returning users');
    } else {
      console.log(`✅ Tone score ${result.judgeScore.tone.toFixed(2)} - welcoming to returning user`);
    }

    // Flow should be efficient (not asking for already-given info)
    expect(result.judgeScore.flow).toBeGreaterThan(0.6);
    console.log(`✅ Flow score ${result.judgeScore.flow.toFixed(2)} - efficient re-engagement`);

    await runner.cleanup(result.user.id);
    console.log('\n✅ Test complete - user cleaned up');

  }, 180000);

  afterAll(() => {
    console.log('\n' + '='.repeat(60));
    console.log('Re-engagement Test Complete');
    console.log('\n' + '='.repeat(60));
    console.log('TODO: Add timestamp manipulation utilities for full timing tests');
    console.log('      - Test 24h re-engagement messaging');
    console.log('      - Test 48h re-engagement messaging');
    console.log('      - Test scheduled task execution');
    console.log('='.repeat(60) + '\n');
  });
});
