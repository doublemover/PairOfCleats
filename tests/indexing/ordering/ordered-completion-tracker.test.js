#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { createOrderedCompletionTracker } from '../../../src/index/build/indexer/steps/process-files.js';

ensureTestingEnv(process.env);

const tracker = createOrderedCompletionTracker();
tracker.track(Promise.resolve('ok'));
await tracker.wait();

const failedTracker = createOrderedCompletionTracker();
const marker = new Error('ordered append failed');
failedTracker.track(Promise.reject(marker));
await new Promise((resolve) => setTimeout(resolve, 0));

let caught = null;
try {
  await failedTracker.wait();
} catch (err) {
  caught = err;
}

assert.equal(caught, marker, 'expected tracker.wait to rethrow completion failures');

const throwTracker = createOrderedCompletionTracker();
const throwMarker = new Error('ordered completion failed after capacity gate');
throwTracker.track(Promise.reject(throwMarker));
await new Promise((resolve) => setTimeout(resolve, 0));
assert.throws(
  () => throwTracker.throwIfFailed(),
  (err) => err === throwMarker,
  'expected throwIfFailed to surface settled completion failures'
);

const drainingTracker = createOrderedCompletionTracker();
const earlyMarker = new Error('first completion failed quickly');
let settledCount = 0;
drainingTracker.track(Promise.reject(earlyMarker), () => {
  settledCount += 1;
});
drainingTracker.track(
  new Promise((resolve) => setTimeout(() => resolve('slow-success'), 25)),
  () => {
    settledCount += 1;
  }
);
const drainStart = Date.now();
let drainError = null;
try {
  await drainingTracker.wait();
} catch (err) {
  drainError = err;
}
const drainElapsedMs = Date.now() - drainStart;
assert.equal(drainError, earlyMarker, 'expected wait to report first completion failure');
assert.equal(settledCount, 2, 'expected wait to drain all tracked completions before returning');
assert.ok(drainElapsedMs >= 15, 'expected wait to hold until slow completion settled');

const stalledTracker = createOrderedCompletionTracker();
let resolveStalled = null;
stalledTracker.track(new Promise((resolve) => {
  resolveStalled = resolve;
}));
let stallCallbacks = 0;
await stalledTracker.wait({
  stallPollMs: 10,
  onStall: ({ pending, stallCount }) => {
    stallCallbacks += 1;
    assert.equal(pending, 1, 'expected stall callback to report pending completions');
    if (stallCount >= 2) {
      resolveStalled?.();
    }
  }
});
assert.ok(stallCallbacks >= 2, 'expected wait to invoke stall callback while blocked');

const timeoutTracker = createOrderedCompletionTracker();
timeoutTracker.track(new Promise(() => {}));
await assert.rejects(
  () => timeoutTracker.wait({ timeoutMs: 25 }),
  (err) => err?.code === 'ORDERED_COMPLETION_TIMEOUT',
  'expected wait timeout to produce deterministic timeout error'
);

const abortTracker = createOrderedCompletionTracker();
abortTracker.track(new Promise(() => {}));
const abortController = new AbortController();
setTimeout(() => abortController.abort(new Error('abort tracker wait')), 10);
await assert.rejects(
  () => abortTracker.wait({ signal: abortController.signal }),
  (err) => (err?.message || '').includes('abort tracker wait'),
  'expected wait abort signal to reject with abort reason'
);

console.log('ordered completion tracker test passed');
