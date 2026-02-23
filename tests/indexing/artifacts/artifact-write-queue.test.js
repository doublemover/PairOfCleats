#!/usr/bin/env node
import assert from 'node:assert/strict';

import { applyTestEnv } from '../../helpers/test-env.js';
import { SCHEDULER_QUEUE_NAMES } from '../../../src/index/build/runtime/scheduler.js';
import { createArtifactWriteQueue } from '../../../src/index/build/artifacts/write-queue.js';

applyTestEnv({ testing: '1' });

const normalizeTimes = [101, 102];
const normalizeQueue = createArtifactWriteQueue({
  massiveWriteIoTokens: 2,
  massiveWriteMemTokens: 3,
  resolveArtifactWriteMemTokens: () => 0,
  now: () => normalizeTimes.shift()
});
normalizeQueue.enqueueWrite('alpha.json', async () => {}, {
  priority: 'not-a-number',
  estimatedBytes: -1,
  laneHint: 42
});
normalizeQueue.enqueueWrite('beta.json', async () => {}, {
  priority: '5',
  estimatedBytes: '2048',
  laneHint: 'light'
});
assert.deepEqual(
  normalizeQueue.writes.map((entry) => ({
    label: entry.label,
    priority: entry.priority,
    estimatedBytes: entry.estimatedBytes,
    laneHint: entry.laneHint,
    eagerStart: entry.eagerStart,
    prefetched: entry.prefetched,
    prefetchStartedAt: entry.prefetchStartedAt,
    seq: entry.seq,
    enqueuedAt: entry.enqueuedAt
  })),
  [
    {
      label: 'alpha.json',
      priority: 0,
      estimatedBytes: null,
      laneHint: null,
      eagerStart: false,
      prefetched: null,
      prefetchStartedAt: null,
      seq: 0,
      enqueuedAt: 101
    },
    {
      label: 'beta.json',
      priority: 5,
      estimatedBytes: 2048,
      laneHint: 'light',
      eagerStart: false,
      prefetched: null,
      prefetchStartedAt: null,
      seq: 1,
      enqueuedAt: 102
    }
  ],
  'expected enqueue metadata normalization and deterministic sequence ordering'
);

const eagerTimes = [501, 502];
let schedulerCall = null;
let tokenResolverInput = null;
let eagerJobRuns = 0;
const scheduledPromise = Promise.resolve({ bytes: 99 });
const eagerQueue = createArtifactWriteQueue({
  scheduler: {
    schedule: (queueName, tokens, job) => {
      schedulerCall = { queueName, tokens, job };
      return scheduledPromise;
    }
  },
  massiveWriteIoTokens: 9,
  massiveWriteMemTokens: 11,
  resolveArtifactWriteMemTokens: (estimatedBytes) => (estimatedBytes == null ? 0 : 3),
  resolveSchedulerTokens: (input) => {
    tokenResolverInput = input;
    return { io: 4, mem: 6 };
  },
  now: () => eagerTimes.shift()
});
const eagerJob = async () => {
  eagerJobRuns += 1;
  return { bytes: 1 };
};
eagerQueue.enqueueWrite('gamma.json', eagerJob, {
  priority: 2,
  estimatedBytes: '4096',
  laneHint: 'massive',
  eagerStart: true
});
assert.equal(eagerJobRuns, 0, 'expected eager scheduler path to hand off execution to scheduler');
assert.equal(schedulerCall?.queueName, SCHEDULER_QUEUE_NAMES.stage2Write, 'expected stage2 write queue scheduling');
assert.deepEqual(schedulerCall?.tokens, { io: 4, mem: 6 }, 'expected resolved eager scheduler tokens');
assert.equal(schedulerCall?.job, eagerJob, 'expected scheduler to receive the original write job');
assert.equal(tokenResolverInput?.estimatedBytes, 4096, 'expected eager token resolver estimated bytes');
assert.equal(tokenResolverInput?.laneHint, 'massive', 'expected eager token resolver lane hint');
assert.equal(tokenResolverInput?.massiveWriteIoTokens, 9, 'expected eager token resolver IO token context');
assert.equal(tokenResolverInput?.massiveWriteMemTokens, 11, 'expected eager token resolver mem token context');
assert.equal(
  typeof tokenResolverInput?.resolveArtifactWriteMemTokens,
  'function',
  'expected eager token resolver to receive write mem resolver callback'
);
assert.equal(
  tokenResolverInput?.resolveArtifactWriteMemTokens(4096),
  3,
  'expected eager token resolver to receive write mem token resolver'
);
assert.equal(eagerQueue.writes[0].prefetched, scheduledPromise, 'expected prefetched promise to be tracked on queue entry');
assert.equal(eagerQueue.writes[0].prefetchStartedAt, 501, 'expected eager prefetch start timestamp');
assert.equal(eagerQueue.writes[0].enqueuedAt, 502, 'expected enqueue timestamp after eager prefetch start');
await eagerQueue.writes[0].prefetched;

const fallbackTimes = [701, 702];
let fallbackJobRuns = 0;
const fallbackQueue = createArtifactWriteQueue({
  massiveWriteIoTokens: 1,
  massiveWriteMemTokens: 1,
  resolveArtifactWriteMemTokens: () => 1,
  resolveSchedulerTokens: () => ({ io: 1, mem: 1 }),
  now: () => fallbackTimes.shift()
});
fallbackQueue.enqueueWrite('delta.json', async () => {
  fallbackJobRuns += 1;
  return { bytes: 7 };
}, { eagerStart: true });
assert.equal(fallbackJobRuns, 1, 'expected eager path to run immediately when scheduler is unavailable');
assert.equal(typeof fallbackQueue.writes[0].prefetched?.then, 'function', 'expected prefetched promise-like handle');
assert.equal(fallbackQueue.writes[0].prefetchStartedAt, 701, 'expected fallback eager prefetch start timestamp');
assert.equal(fallbackQueue.writes[0].enqueuedAt, 702, 'expected fallback enqueue timestamp');
await fallbackQueue.writes[0].prefetched;

console.log('artifact write queue helper test passed');
