#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { createPostingsQueue } from '../../../src/index/build/indexer/steps/process-files/postings-queue.js';
import {
  buildFileProgressHeartbeatText,
  resolveStage1OrderingIntegrity,
  resolveStage1HangPolicy,
  runApplyWithPostingsBackpressure,
  shouldBypassPostingsBackpressure
} from '../../../src/index/build/indexer/steps/process-files.js';

ensureTestingEnv(process.env);

/**
 * Stage1 policy fixture that mixes stage-level and queue-level watchdog inputs
 * to verify precedence and minimum-clamp behavior.
 */
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

const orderingOk = resolveStage1OrderingIntegrity({
  expectedOrderIndices: [0, 1, 2],
  completedOrderIndices: [0, 1, 2],
  progressCount: 3,
  progressTotal: 3
});
assert.equal(orderingOk.ok, true, 'expected integrity check to pass for fully-settled order set');
assert.equal(orderingOk.progressComplete, true, 'expected progress-complete flag for full progress counts');

const orderingMissing = resolveStage1OrderingIntegrity({
  expectedOrderIndices: [0, 1, 2],
  completedOrderIndices: [0, 2],
  progressCount: 2,
  progressTotal: 3
});
assert.equal(orderingMissing.ok, false, 'expected integrity check to fail when an order index is missing');
assert.deepEqual(orderingMissing.missingIndices, [1], 'expected missing order index details');

const orderingProgressGap = resolveStage1OrderingIntegrity({
  expectedOrderIndices: [0, 1],
  completedOrderIndices: [0, 1],
  progressCount: 1,
  progressTotal: 2
});
assert.equal(orderingProgressGap.ok, false, 'expected integrity check to fail when progress counters are incomplete');
assert.equal(orderingProgressGap.progressComplete, false, 'expected progress-complete flag to reflect incomplete progress');

const orderingFromSet = resolveStage1OrderingIntegrity({
  expectedOrderIndices: [0, 1, 2],
  completedOrderIndices: new Set([0, 1, 2]),
  progressCount: 3,
  progressTotal: 3
});
assert.equal(orderingFromSet.ok, true, 'expected integrity check to accept iterable completed-order sets');

const orderingFromInvalidCompletedShape = resolveStage1OrderingIntegrity({
  expectedOrderIndices: [0, 1],
  completedOrderIndices: { 0: 0, 1: 1 },
  progressCount: 2,
  progressTotal: 2
});
assert.equal(
  orderingFromInvalidCompletedShape.ok,
  false,
  'expected integrity check to fail closed for non-iterable completed-order payloads'
);
assert.deepEqual(
  orderingFromInvalidCompletedShape.missingIndices,
  [0, 1],
  'expected non-iterable completed-order payloads to report all expected indices as missing'
);

const postingsQueue = createPostingsQueue({
  maxPending: 1,
  maxPendingRows: 4,
  maxPendingBytes: 4096,
  maxHeapFraction: 1
});
const blockingReservation = await postingsQueue.reserve({ rows: 1, bytes: 0 });
let applyRan = false;
const applyPromise = runApplyWithPostingsBackpressure({
  sparsePostingsEnabled: true,
  postingsQueue,
  result: { chunks: [{ id: 1 }] },
  runApply: async () => {
    applyRan = true;
  }
});
const blockedState = await Promise.race([
  applyPromise.then(() => 'resolved'),
  new Promise((resolve) => setTimeout(() => resolve('pending'), 20))
]);
assert.equal(blockedState, 'pending', 'expected apply reservation to wait while queue is saturated');
blockingReservation.release();
await applyPromise;
assert.equal(applyRan, true, 'expected apply callback to execute once reservation is available');
assert.equal(postingsQueue.stats().pending.count, 0, 'expected queue reservations to drain after apply');

const signalForwardQueue = createPostingsQueue({
  maxPending: 1,
  maxPendingRows: 4,
  maxPendingBytes: 4096,
  maxHeapFraction: 1
});
const signalForwardController = new AbortController();
let forwardedSignal = null;
await runApplyWithPostingsBackpressure({
  sparsePostingsEnabled: true,
  postingsQueue: signalForwardQueue,
  signal: signalForwardController.signal,
  result: { chunks: [{ id: 'forward-signal' }] },
  runApply: async ({ signal } = {}) => {
    forwardedSignal = signal || null;
  }
});
assert.equal(
  forwardedSignal,
  signalForwardController.signal,
  'expected runApplyWithPostingsBackpressure to forward reserve signal into apply callback'
);

const preAbortedController = new AbortController();
preAbortedController.abort(new Error('pre-aborted helper signal'));
let preAbortedApplyRan = false;
await assert.rejects(
  () => runApplyWithPostingsBackpressure({
    sparsePostingsEnabled: false,
    signal: preAbortedController.signal,
    result: { chunks: [{ id: 'pre-abort' }] },
    runApply: async () => {
      preAbortedApplyRan = true;
    }
  }),
  (err) => err?.code === 'ABORT_ERR',
  'expected runApplyWithPostingsBackpressure to fail fast before apply when signal is already aborted'
);
assert.equal(preAbortedApplyRan, false, 'expected apply callback not to run when signal is pre-aborted');

const timeoutQueue = createPostingsQueue({
  maxPending: 1,
  maxPendingRows: 4,
  maxPendingBytes: 4096,
  maxHeapFraction: 1,
  reserveTimeoutMs: 25
});
const timeoutGuard = await timeoutQueue.reserve({ rows: 1, bytes: 0 });
await assert.rejects(
  () => runApplyWithPostingsBackpressure({
    sparsePostingsEnabled: true,
    postingsQueue: timeoutQueue,
    result: { chunks: [{ id: 'timeout' }] },
    runApply: async () => {}
  }),
  (err) => err?.code === 'POSTINGS_BACKPRESSURE_TIMEOUT',
  'expected runApplyWithPostingsBackpressure to fail fast on reserve timeout'
);
timeoutGuard.release();

const abortQueue = createPostingsQueue({
  maxPending: 1,
  maxPendingRows: 4,
  maxPendingBytes: 4096,
  maxHeapFraction: 1
});
const abortGuard = await abortQueue.reserve({ rows: 1, bytes: 0 });
const reserveAbortController = new AbortController();
setTimeout(() => reserveAbortController.abort(new Error('abort reserve wait in helper test')), 10);
await assert.rejects(
  () => runApplyWithPostingsBackpressure({
    sparsePostingsEnabled: true,
    postingsQueue: abortQueue,
    signal: reserveAbortController.signal,
    result: { chunks: [{ id: 'abort' }] },
    runApply: async () => {}
  }),
  (err) => (err?.message || '').includes('abort reserve wait in helper test'),
  'expected runApplyWithPostingsBackpressure to propagate reserve abort reason'
);
abortGuard.release();

console.log('process-files refactor helper behavior test passed');
