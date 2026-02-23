#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import {
  resolveEffectiveSlowFileDurationMs,
  resolveFileLifecycleDurations,
  resolveFileHardTimeoutMs,
  resolveFileWatchdogConfig,
  resolveFileWatchdogMs,
  shouldTriggerSlowFileWarning
} from '../../../src/index/build/indexer/steps/process-files.js';

ensureTestingEnv(process.env);

const explicitConfig = resolveFileWatchdogConfig({
  stage1Queues: {
    watchdog: {
      slowFileMs: 1000,
      maxSlowFileMs: 5000,
      hardTimeoutMs: 4000,
      bytesPerStep: 100,
      linesPerStep: 10,
      stepMs: 500
    }
  }
});

const entry = {
  stat: { size: 1000 },
  lines: 100
};
const softTimeoutMs = resolveFileWatchdogMs(explicitConfig, entry);
const hardTimeoutMs = resolveFileHardTimeoutMs(explicitConfig, entry, softTimeoutMs);
assert.equal(softTimeoutMs, 5000, 'expected soft timeout to clamp at configured max');
assert.equal(hardTimeoutMs, 10000, 'expected hard timeout to scale from soft timeout and file size');

const defaultConfig = resolveFileWatchdogConfig({
  stage1Queues: {
    watchdog: {
      slowFileMs: 1000,
      maxSlowFileMs: 2000
    }
  }
});
assert.ok(
  defaultConfig.hardTimeoutMs >= 300000,
  'expected default hard timeout floor for unconfigured watchdog hard timeout'
);

const nullOverrideConfig = resolveFileWatchdogConfig({
  stage1Queues: {
    watchdog: {
      slowFileMs: null,
      maxSlowFileMs: null,
      hardTimeoutMs: null
    }
  }
});
assert.equal(
  nullOverrideConfig.slowFileMs,
  10000,
  'expected null slowFileMs to use default watchdog timeout'
);
assert.equal(
  nullOverrideConfig.maxSlowFileMs,
  120000,
  'expected null maxSlowFileMs to use default watchdog max timeout'
);
assert.ok(
  nullOverrideConfig.hardTimeoutMs >= 300000,
  'expected null hardTimeoutMs to keep hard timeout enabled'
);

const adaptiveHugeRepoConfig = resolveFileWatchdogConfig(
  { stage1Queues: { watchdog: {} } },
  { repoFileCount: 4000 }
);
assert.equal(
  adaptiveHugeRepoConfig.slowFileMs,
  20000,
  'expected huge repo default to raise base slow-file threshold'
);
assert.equal(
  adaptiveHugeRepoConfig.maxSlowFileMs,
  120000,
  'expected adaptive slow-file threshold to preserve max slow timeout floor'
);

const explicitSlowOnHugeRepoConfig = resolveFileWatchdogConfig(
  {
    stage1Queues: {
      watchdog: {
        slowFileMs: 1500
      }
    }
  },
  { repoFileCount: 4000 }
);
assert.equal(
  explicitSlowOnHugeRepoConfig.slowFileMs,
  1500,
  'expected explicit slowFileMs to override adaptive huge-repo threshold'
);

const queueDelayedLifecycle = resolveFileLifecycleDurations({
  enqueuedAtMs: 1_000,
  dequeuedAtMs: 9_000,
  parseStartAtMs: 9_000,
  parseEndAtMs: 9_800,
  writeStartAtMs: 9_810,
  writeEndAtMs: 9_900
});
assert.equal(queueDelayedLifecycle.queueDelayMs, 8_000, 'expected queue delay to capture enqueue->dequeue wait');
assert.equal(queueDelayedLifecycle.activeDurationMs, 800, 'expected active duration to capture parse-only window');
assert.equal(queueDelayedLifecycle.scmProcQueueWaitMs, 0, 'expected scm proc-queue wait to default to zero');
assert.equal(
  queueDelayedLifecycle.activeProcessingDurationMs,
  800,
  'expected effective active processing duration to match active duration when no proc-queue wait is recorded'
);
assert.equal(
  shouldTriggerSlowFileWarning({
    activeDurationMs: queueDelayedLifecycle.activeDurationMs,
    thresholdMs: 1000
  }),
  false,
  'expected slow-file warning gate to ignore long queue delay when active time is below threshold'
);
assert.equal(
  resolveEffectiveSlowFileDurationMs({
    activeDurationMs: 1_300,
    scmProcQueueWaitMs: 650
  }),
  650,
  'expected effective slow-file duration to subtract SCM proc-queue wait'
);
assert.equal(
  shouldTriggerSlowFileWarning({
    activeDurationMs: 1_300,
    thresholdMs: 1_000,
    scmProcQueueWaitMs: 650
  }),
  false,
  'expected slow-file warning gate to suppress warnings when SCM proc-queue wait dominates duration'
);
assert.equal(
  shouldTriggerSlowFileWarning({
    activeDurationMs: 1_200,
    thresholdMs: 1_000
  }),
  true,
  'expected slow-file warning gate to trigger once active processing exceeds threshold'
);

const clampedLifecycle = resolveFileLifecycleDurations({
  enqueuedAtMs: 10_000,
  dequeuedAtMs: 9_000,
  parseStartAtMs: 12_000,
  parseEndAtMs: 11_500,
  scmProcQueueWaitMs: -500
});
assert.equal(clampedLifecycle.queueDelayMs, 0, 'expected negative queue duration to clamp to zero');
assert.equal(clampedLifecycle.activeDurationMs, 0, 'expected negative active duration to clamp to zero');
assert.equal(clampedLifecycle.scmProcQueueWaitMs, 0, 'expected negative SCM proc-queue wait to clamp to zero');
assert.equal(
  clampedLifecycle.activeProcessingDurationMs,
  0,
  'expected effective active processing duration to clamp to zero'
);

console.log('file watchdog hard timeout test passed');

