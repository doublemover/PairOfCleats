#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { captureProcessSnapshot } from '../../../src/shared/subprocess.js';
import {
  resolveStage1HangPolicy,
  resolveStage1StallAction,
  resolveStage1StallSoftKickTimeoutMs
} from '../../../src/index/build/indexer/steps/process-files.js';

ensureTestingEnv(process.env);

const runtime = {
  indexingConfig: {
    stage1: {
      watchdog: {
        stages: {
          processing: {
            heartbeatMs: 1500,
            snapshotMs: 2000,
            softKickMs: 3500,
            softKickCooldownMs: 1000,
            softKickMaxAttempts: 2,
            stuckThresholdMs: 9000
          }
        }
      }
    }
  },
  stage1Queues: {
    watchdog: {
      hardTimeoutMs: 4000
    }
  }
};

const policy = resolveStage1HangPolicy(runtime, { hardTimeoutMs: 4000 });
assert.equal(policy.progressHeartbeatMs, 1500, 'expected stage-specific heartbeat override');
assert.equal(policy.stallSnapshotMs, 2000, 'expected stage-specific stall snapshot override');
assert.equal(policy.stallSoftKickMs, 3500, 'expected stage-specific soft-kick threshold override');
assert.equal(policy.stallSoftKickCooldownMs, 1000, 'expected stage-specific soft-kick cooldown override');
assert.equal(policy.stallSoftKickMaxAttempts, 2, 'expected stage-specific soft-kick max attempts override');
assert.equal(policy.stallAbortMs, 9000, 'expected stage-specific stuck threshold override');

const fallbackSoftKickMs = resolveStage1StallSoftKickTimeoutMs({
  configuredSoftKickMs: null,
  stallAbortMs: 12_000
});
assert.equal(fallbackSoftKickMs, 6000, 'expected default soft-kick threshold to derive from abort threshold');

const disabledSoftKickMs = resolveStage1StallSoftKickTimeoutMs({
  configuredSoftKickMs: null,
  stallAbortMs: 0
});
assert.equal(disabledSoftKickMs, 0, 'expected soft-kick to disable when stall abort is disabled');

const disabledPolicy = resolveStage1HangPolicy({
  indexingConfig: {
    stage1: {
      watchdog: {
        stages: {
          processing: {
            stallAbortMs: 0
          }
        }
      }
    }
  },
  stage1Queues: {
    watchdog: {}
  }
}, { hardTimeoutMs: 4000 });
assert.equal(disabledPolicy.stallAbortMs, 0, 'expected policy to preserve explicit stall abort disable');
assert.equal(disabledPolicy.stallSoftKickMs, 0, 'expected soft-kick policy to disable with stall abort disable');

const softKickDecision = resolveStage1StallAction({
  idleMs: 3600,
  hardAbortMs: policy.stallAbortMs,
  softKickMs: policy.stallSoftKickMs,
  softKickAttempts: 0,
  softKickMaxAttempts: policy.stallSoftKickMaxAttempts,
  softKickInFlight: false,
  lastSoftKickAtMs: 0,
  softKickCooldownMs: policy.stallSoftKickCooldownMs,
  nowMs: 10_000
});
assert.equal(softKickDecision.action, 'soft-kick', 'expected soft-kick decision before hard abort threshold');

const cooldownDecision = resolveStage1StallAction({
  idleMs: 4500,
  hardAbortMs: policy.stallAbortMs,
  softKickMs: policy.stallSoftKickMs,
  softKickAttempts: 1,
  softKickMaxAttempts: policy.stallSoftKickMaxAttempts,
  softKickInFlight: false,
  lastSoftKickAtMs: 9500,
  softKickCooldownMs: policy.stallSoftKickCooldownMs,
  nowMs: 10_000
});
assert.equal(cooldownDecision.action, 'none', 'expected cooldown to prevent immediate repeated soft-kicks');
assert.equal(cooldownDecision.reason, 'soft_kick_cooldown');

const exhaustedDecision = resolveStage1StallAction({
  idleMs: 6000,
  hardAbortMs: policy.stallAbortMs,
  softKickMs: policy.stallSoftKickMs,
  softKickAttempts: 2,
  softKickMaxAttempts: policy.stallSoftKickMaxAttempts,
  softKickInFlight: false,
  lastSoftKickAtMs: 0,
  softKickCooldownMs: policy.stallSoftKickCooldownMs,
  nowMs: 10_000
});
assert.equal(exhaustedDecision.action, 'none', 'expected exhausted soft-kick attempts to stop retries');
assert.equal(exhaustedDecision.reason, 'soft_kick_attempts_exhausted');

const abortDecision = resolveStage1StallAction({
  idleMs: 9200,
  hardAbortMs: policy.stallAbortMs,
  softKickMs: policy.stallSoftKickMs,
  softKickAttempts: 1,
  softKickMaxAttempts: policy.stallSoftKickMaxAttempts,
  softKickInFlight: false,
  lastSoftKickAtMs: 0,
  softKickCooldownMs: policy.stallSoftKickCooldownMs,
  nowMs: 20_000
});
assert.equal(abortDecision.action, 'abort', 'expected hard abort once idle time exceeds stuck threshold');

const snapshot = captureProcessSnapshot({ includeStack: true, frameLimit: 8, handleTypeLimit: 4 });
assert.equal(snapshot.pid, process.pid, 'expected process snapshot to include current pid');
assert.equal(Array.isArray(snapshot.stack?.frames), true, 'expected process snapshot to include stack frames');
assert.equal(snapshot.stack.frames.length > 0, true, 'expected at least one stack frame in process snapshot');
assert.equal(snapshot.activeHandles.count >= 0, true, 'expected non-negative active handle count');

console.log('process files stall snapshot policy test passed');
