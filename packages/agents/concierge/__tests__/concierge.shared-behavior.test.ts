/**
 * Concierge Agent - Shared Concierge Behavior Tests
 *
 * Runs the shared Concierge behavior test suite against the Concierge agent.
 */

import { invokeConciergeAgent } from '../src/index';
import { runConciergeBehaviorTests } from './shared/concierge-behavior.test';

// Run shared Concierge behavior tests
runConciergeBehaviorTests('Concierge', invokeConciergeAgent);
