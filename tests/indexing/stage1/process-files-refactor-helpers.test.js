#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import {
  buildFileProgressHeartbeatText,
  resolveStage1HangPolicy,
  shouldBypassPostingsBackpressure
} from '../../../src/index/build/indexer/steps/process-files.js';

ensureTestingEnv(process.env);

const policy = resolveStage1HangPolicy(
  {
    indexingConfig: {
      stage1: {
        softKickMaxAttempts: 7,
        watchdog: {
          stages: {
            processing: {
              heartbeatMs: 1500,
              stallAbortMs: 500
            }
          }
        }
      }
    },
    stage1Queues: {
      watchdog: {
        progressHeartbeatMs: 9000,
        stallSnapshotMs: 2600
      }
    }
  },
  { hardTimeoutMs: 5000 }
);

assert.equal(policy.progressHeartbeatMs, 1500, 'expected stage-specific heartbeat override');
assert.equal(policy.stallSnapshotMs, 2600, 'expected queue watchdog stall-snapshot fallback');
assert.equal(policy.stallAbortMs, 1000, 'expected configured stall-abort to honor minimum clamp');
assert.equal(policy.stallSoftKickMaxAttempts, 7, 'expected stage-level soft-kick attempts override');

assert.equal(
  shouldBypassPostingsBackpressure({
    orderIndex: 10,
    nextOrderedIndex: 8,
    bypassWindow: 2
  }),
  true,
  'expected bypass for near-front entries inside bypass window'
);
assert.equal(
  shouldBypassPostingsBackpressure({
    orderIndex: 11,
    nextOrderedIndex: 8,
    bypassWindow: 2
  }),
  false,
  'expected no bypass when entry is outside the bypass window'
);
assert.equal(
  shouldBypassPostingsBackpressure({
    orderIndex: Number.NaN,
    nextOrderedIndex: 8,
    bypassWindow: 2
  }),
  false,
  'expected invalid order index inputs to disable bypass'
);

const clampedHeartbeat = buildFileProgressHeartbeatText({
  count: 12,
  total: 5,
  startedAtMs: 1000,
  nowMs: 2000,
  inFlight: -2,
  trackedSubprocesses: -7
});
assert.match(
  clampedHeartbeat,
  /\[watchdog\] progress 5\/5 \(100\.0%\) elapsed=1s rate=5\.00 files\/s eta=0s inFlight=0 trackedSubprocesses=0/,
  'expected heartbeat accounting to clamp count and non-negative telemetry fields'
);

console.log('process-files refactor helper behavior test passed');
