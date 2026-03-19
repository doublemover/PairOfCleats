#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildProgressTimeoutBudget,
  evaluateProgressTimeout,
  PROGRESS_TIMEOUT_CLASSES,
  PROGRESS_TIMEOUT_POLICY_VERSION,
  resolveProgressTimeoutRepoTier
} from '../../../src/shared/indexing/progress-timeout-policy.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

assert.equal(
  resolveProgressTimeoutRepoTier({ repoFileCount: 60_000 }),
  'xlarge',
  'expected xlarge repo tier'
);

const budget = buildProgressTimeoutBudget({
  phase: 'stage1-ordered-backpressure',
  baseTimeoutMs: 30_000,
  repoFileCount: 25_000,
  scheduledFileCount: 18_000,
  activeBatchCount: 6,
  languages: ['protobuf', 'starlark', 'javascript'],
  completedUnits: 500,
  totalUnits: 18_000,
  elapsedMs: 180_000
});
assert.equal(budget.schemaVersion, PROGRESS_TIMEOUT_POLICY_VERSION, 'expected policy version');
assert.equal(budget.repoTier, 'large', 'expected large repo tier');
assert.ok(budget.budgetMs > budget.baseTimeoutMs, 'expected workload-aware timeout multiplier');

const queueDecision = evaluateProgressTimeout({
  budget,
  heartbeatAgeMs: budget.budgetMs + 5000,
  queueMovementAgeMs: budget.budgetMs + 5000,
  byteProgressAgeMs: budget.budgetMs + 5000,
  queueExpected: true,
  byteProgressExpected: true
});
assert.equal(queueDecision.timedOut, true, 'expected queue-stall timeout');
assert.equal(queueDecision.timeoutClass, PROGRESS_TIMEOUT_CLASSES.noQueueMovement, 'expected no_queue_movement');

const byteDecision = evaluateProgressTimeout({
  budget,
  heartbeatAgeMs: budget.budgetMs + 5000,
  queueMovementAgeMs: 1000,
  byteProgressAgeMs: budget.budgetMs + 5000,
  queueExpected: false,
  byteProgressExpected: true
});
assert.equal(byteDecision.timedOut, true, 'expected byte-progress timeout');
assert.equal(byteDecision.timeoutClass, PROGRESS_TIMEOUT_CLASSES.noByteProgress, 'expected no_byte_progress');

const heartbeatDecision = evaluateProgressTimeout({
  budget,
  heartbeatAgeMs: budget.budgetMs + 5000,
  queueMovementAgeMs: null,
  byteProgressAgeMs: null
});
assert.equal(heartbeatDecision.timedOut, true, 'expected heartbeat timeout');
assert.equal(heartbeatDecision.timeoutClass, PROGRESS_TIMEOUT_CLASSES.noHeartbeat, 'expected no_heartbeat');

const hardDecision = evaluateProgressTimeout({
  budget: buildProgressTimeoutBudget({
    phase: 'bench-process-wall-clock',
    baseTimeoutMs: 1000,
    maxTimeoutMs: 1000,
    wallClockCapMs: 1000
  }),
  wallClockElapsedMs: 1200
});
assert.equal(hardDecision.timedOut, true, 'expected wall-clock timeout');
assert.equal(hardDecision.timeoutClass, PROGRESS_TIMEOUT_CLASSES.globalWallClockCap, 'expected global wall clock cap');

const externalDecision = evaluateProgressTimeout({
  budget,
  externalToolTimedOut: true
});
assert.equal(externalDecision.timedOut, true, 'expected external tool timeout');
assert.equal(
  externalDecision.timeoutClass,
  PROGRESS_TIMEOUT_CLASSES.externalToolTimeout,
  'expected external tool timeout class'
);

const ensemblReplayDecision = evaluateProgressTimeout({
  budget,
  heartbeatAgeMs: budget.budgetMs + 10_000,
  queueMovementAgeMs: 1500,
  byteProgressAgeMs: budget.budgetMs + 10_000,
  queueExpected: true,
  byteProgressExpected: false
});
assert.equal(
  ensemblReplayDecision.timedOut,
  false,
  'expected Ensembl-style ordered queue movement to suppress false idle timeout'
);

const envoyReplayDecision = evaluateProgressTimeout({
  budget,
  heartbeatAgeMs: budget.budgetMs + 10_000,
  queueMovementAgeMs: budget.budgetMs + 10_000,
  byteProgressAgeMs: 1200,
  queueExpected: true,
  byteProgressExpected: true
});
assert.equal(
  envoyReplayDecision.timedOut,
  false,
  'expected Envoy-style byte progress to suppress false idle timeout'
);

const basedosdadosReplayDecision = evaluateProgressTimeout({
  budget: buildProgressTimeoutBudget({
    phase: 'bench-process-wall-clock',
    baseTimeoutMs: 120_000,
    maxTimeoutMs: 120_000,
    wallClockCapMs: 120_000,
    repoFileCount: 15_000,
    scheduledFileCount: 12_000,
    activeBatchCount: 6,
    languages: ['sql', 'python'],
    completedUnits: 20,
    totalUnits: 400,
    elapsedMs: 120_000
  }),
  wallClockElapsedMs: 120_500
});
assert.equal(
  basedosdadosReplayDecision.timeoutClass,
  PROGRESS_TIMEOUT_CLASSES.globalWallClockCap,
  'expected Basedosdados-style heavy run to classify as a real wall clock cap'
);

console.log('progress timeout policy test passed');
