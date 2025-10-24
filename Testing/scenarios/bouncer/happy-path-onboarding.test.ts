/**
 * Bouncer - Happy Path Onboarding Tests
 *
 * Tests complete onboarding flow with three different personas:
 * - Eager Eddie: Enthusiastic, over-shares
 * - Skeptical Sam: Cautious, asks questions
 * - Terse Tony: Brief responses, busy executive
 *
 * Expected behavior:
 * - Agent collects name, company, title, email
 * - Agent sends verification email
 * - Conversation is professional and flows naturally
 * - No hallucinations or critical errors
 */

import { ConversationRunner } from '../../framework/ConversationRunner';
import { EAGER_EDDIE } from '../../personas/eager-eddie';
import { SKEPTICAL_SAM } from '../../personas/skeptical-sam';
import { TERSE_TONY } from '../../personas/terse-tony';

describe('Bouncer - Happy Path Onboarding', () => {
  let runner: ConversationRunner;

  beforeAll(() => {
    runner = new ConversationRunner();
  });

  describe('Eager Eddie (Over-sharing)', () => {
    it('should complete onboarding with eager, enthusiastic user', async () => {
      console.log('\n' + '='.repeat(60));
      console.log('TEST: Eager Eddie - Happy Path Onboarding');
      console.log('='.repeat(60) + '\n');

      const result = await runner.runSimulation(EAGER_EDDIE, 'bouncer', 20);

      // Validate judge scores
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

      // Critical errors should always fail the test
      expect(result.judgeScore.errors.length).toBe(0);
      console.log('✅ No critical errors');

      // Should use correct tools
      expect(result.toolsUsed).toContain('collect_user_info');
      console.log('✅ Used collect_user_info tool');

      expect(result.toolsUsed).toContain('send_verification_email');
      console.log('✅ Used send_verification_email tool');

      // Judge score should be reasonable (0.7+ for happy path)
      if (result.judgeScore.overall < 0.7) {
        console.warn(`\n⚠️  Judge score (${result.judgeScore.overall.toFixed(2)}) below 0.7 threshold`);
        console.warn('Reasoning:', result.judgeScore.reasoning);
      } else {
        console.log(`✅ Judge score ${result.judgeScore.overall.toFixed(2)} meets threshold`);
      }

      // Cleanup
      await runner.cleanup(result.user.id);
      console.log('\n✅ Test complete - user cleaned up');

    }, 180000); // 3 minute timeout for full simulation with LLM calls
  });

  describe('Skeptical Sam (Cautious)', () => {
    it('should complete onboarding with skeptical, questioning user', async () => {
      console.log('\n' + '='.repeat(60));
      console.log('TEST: Skeptical Sam - Happy Path Onboarding');
      console.log('='.repeat(60) + '\n');

      const result = await runner.runSimulation(SKEPTICAL_SAM, 'bouncer', 20);

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

      // Should complete onboarding despite skepticism
      expect(result.toolsUsed).toContain('collect_user_info');
      expect(result.toolsUsed).toContain('send_verification_email');
      console.log('✅ Completed onboarding flow');

      // Tone is especially important with skeptical user
      if (result.judgeScore.tone < 0.7) {
        console.warn(`\n⚠️  Tone score (${result.judgeScore.tone.toFixed(2)}) below 0.7 - important for skeptical users`);
      } else {
        console.log(`✅ Tone score ${result.judgeScore.tone.toFixed(2)} - handled skepticism well`);
      }

      await runner.cleanup(result.user.id);
      console.log('\n✅ Test complete - user cleaned up');

    }, 180000);
  });

  describe('Terse Tony (Brief Responses)', () => {
    it('should complete onboarding with terse, busy user', async () => {
      console.log('\n' + '='.repeat(60));
      console.log('TEST: Terse Tony - Happy Path Onboarding');
      console.log('='.repeat(60) + '\n');

      const result = await runner.runSimulation(TERSE_TONY, 'bouncer', 20);

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

      // Should extract info from brief responses
      expect(result.toolsUsed).toContain('collect_user_info');
      expect(result.toolsUsed).toContain('send_verification_email');
      console.log('✅ Extracted info from terse responses');

      // Flow is especially important with terse user (agent must be efficient)
      if (result.judgeScore.flow < 0.7) {
        console.warn(`\n⚠️  Flow score (${result.judgeScore.flow.toFixed(2)}) below 0.7 - important for busy users`);
      } else {
        console.log(`✅ Flow score ${result.judgeScore.flow.toFixed(2)} - efficient conversation`);
      }

      await runner.cleanup(result.user.id);
      console.log('\n✅ Test complete - user cleaned up');

    }, 180000);
  });

  afterAll(() => {
    console.log('\n' + '='.repeat(60));
    console.log('All Happy Path Onboarding Tests Complete');
    console.log('='.repeat(60) + '\n');
  });
});
