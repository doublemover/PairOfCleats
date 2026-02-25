#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createBuildScheduler,
  createSchedulerQueueAdapter,
  runWithQueue
} from '../../../src/shared/concurrency.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scheduler = createBuildScheduler({
  cpuTokens: 1,
  ioTokens: 1,
  memoryTokens: 1
});

const queue = createSchedulerQueueAdapter({
  scheduler,
  queueName: 'adapter-zero-limits',
  tokens: { cpu: 1 },
  maxPending: 0,
  maxPendingBytes: 0,
  maxInFlightBytes: 0,
  concurrency: 3
});

let releaseFirst = null;
const firstGate = new Promise((resolve) => {
  releaseFirst = resolve;
});
let started = 0;

const runPromise = runWithQueue(
  queue,
  [10, 10, 10],
  async (_item, ctx) => {
    started += 1;
    if (ctx.index === 0) {
      await firstGate;
    }
    return true;
  },
  {
    collectResults: false,
    estimateBytes: (item) => item
  }
);

await sleep(20);

const midStats = scheduler.stats();
assert.equal(started, 1, 'expected first task to hold the only cpu token');
assert.equal(
  midStats?.queues?.['adapter-zero-limits']?.pending,
  2,
  'expected zero maxPending to disable scheduler pending-cap rejections'
);
assert.equal(
  midStats?.queues?.['adapter-zero-limits']?.pendingBytes,
  20,
  'expected zero maxPendingBytes to disable scheduler pending-bytes cap rejections'
);

releaseFirst();
await runPromise;

const finalStats = scheduler.stats();
assert.equal(
  finalStats?.counters?.rejectedByReason?.maxPending,
  0,
  'expected no maxPending rejections when adapter limits are zero'
);
assert.equal(
  finalStats?.counters?.rejectedByReason?.maxPendingBytes,
  0,
  'expected no maxPendingBytes rejections when adapter limits are zero'
);

scheduler.shutdown();

console.log('scheduler adapter zero limits disabled test passed');
