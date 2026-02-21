#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBuildScheduler, createSchedulerQueueAdapter, runWithQueue } from '../../../src/shared/concurrency.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scheduler = createBuildScheduler({
  cpuTokens: 2,
  ioTokens: 1,
  memoryTokens: 1
});

const queue = createSchedulerQueueAdapter({
  scheduler,
  queueName: 'adapter-bytes',
  tokens: { cpu: 1 },
  maxPending: 4,
  maxPendingBytes: 100,
  maxInFlightBytes: 100,
  concurrency: 2
});

let releaseFirst = null;
const firstGate = new Promise((resolve) => {
  releaseFirst = resolve;
});
const started = [];

const runPromise = runWithQueue(
  queue,
  [80, 30],
  async (_item, ctx) => {
    started.push(ctx.index);
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
assert.deepEqual(started, [0], 'expected in-flight byte cap to delay second task start');
assert.equal(midStats?.queues?.['adapter-bytes']?.inFlightBytes, 80);
assert.equal(midStats?.queues?.['adapter-bytes']?.pendingBytes, 30);

await assert.rejects(
  () => scheduler.schedule('adapter-bytes', { cpu: 1, bytes: 90 }, async () => true),
  /maxPendingBytes/
);

releaseFirst();
await runPromise;

const finalStats = scheduler.stats();
assert.equal(finalStats?.queues?.['adapter-bytes']?.inFlightBytes, 0);
assert.equal(finalStats?.queues?.['adapter-bytes']?.pendingBytes, 0);
assert.equal(finalStats?.counters?.rejectedByReason?.maxPendingBytes, 1);
assert.equal(finalStats?.queues?.['adapter-bytes']?.rejectedMaxPendingBytes, 1);

scheduler.shutdown();

console.log('scheduler adapter bytes gating test passed');
