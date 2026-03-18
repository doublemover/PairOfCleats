#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  resolveStage1HangPolicy,
  resolveStage1StallAction,
  resolveStage1StallSoftKickTimeoutMs
} from '../../../src/shared/indexing/stage1-watchdog-policy.js';

const runtime = {
  indexingConfig: {
    stage1: {
      softKickMaxAttempts: 7,
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
      progressHeartbeatMs: 9000,
      stallSnapshotMs: 2600,
      hardTimeoutMs: 4000
    }
  }
};

const policy = resolveStage1HangPolicy(runtime, { hardTimeoutMs: 4000 });
assert.equal(policy.progressHeartbeatMs, 1500, 'expected stage-specific heartbeat override');
assert.equal(policy.stallSnapshotMs, 2000, 'expected stage-specific snapshot override');
assert.equal(policy.stallSoftKickMs, 3500, 'expected stage-specific soft-kick override');
assert.equal(policy.stallSoftKickCooldownMs, 1000, 'expected stage-specific cooldown override');
assert.equal(policy.stallSoftKickMaxAttempts, 2, 'expected stage-specific soft-kick attempts override');
assert.equal(policy.stallAbortMs, 9000, 'expected stage-specific stuck threshold override');

assert.equal(
  resolveStage1StallSoftKickTimeoutMs({ configuredSoftKickMs: null, stallAbortMs: 12000 }),
  6000,
  'expected derived soft-kick threshold to track half the abort budget'
);
assert.equal(
  resolveStage1StallSoftKickTimeoutMs({ configuredSoftKickMs: null, stallAbortMs: 0 }),
  0,
  'expected soft-kick to disable when abort is disabled'
);

assert.deepEqual(
  resolveStage1StallAction({
    idleMs: 4500,
    hardAbortMs: policy.stallAbortMs,
    softKickMs: policy.stallSoftKickMs,
    softKickAttempts: 1,
    softKickMaxAttempts: policy.stallSoftKickMaxAttempts,
    lastSoftKickAtMs: 9500,
    softKickCooldownMs: policy.stallSoftKickCooldownMs,
    nowMs: 10000
  }),
  { action: 'none', idleMs: 4500, reason: 'soft_kick_cooldown' },
  'expected cooldown to suppress repeated soft-kicks'
);
assert.deepEqual(
  resolveStage1StallAction({
    idleMs: 9200,
    hardAbortMs: policy.stallAbortMs,
    softKickMs: policy.stallSoftKickMs,
    softKickAttempts: 1,
    softKickMaxAttempts: policy.stallSoftKickMaxAttempts,
    nowMs: 20000
  }),
  { action: 'abort', idleMs: 9200 },
  'expected hard abort once the idle threshold is crossed'
);

console.log('shared stage1 watchdog policy test passed');
