#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSchedulerQueueAdapter } from '../../../src/shared/concurrency/queue-adapter.js';
import { runWithQueue } from '../../../src/shared/concurrency/run-with-queue.js';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';

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
  maxInFlightBytes: 100,
  concurrency: 2
});
scheduler.registerQueue('adapter-bytes', { maxPendingBytes: 100, maxInFlightBytes: 100 });

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

const boundedScheduler = createBuildScheduler({ cpuTokens: 1, ioTokens: 1, memoryTokens: 1 });
const bounded = createSchedulerQueueAdapter({ scheduler: boundedScheduler, queueName: 'bounded-io',
  tokens: { io: 1 }, maxPending: 1, concurrency: 1, backpressure: true });
let unblock;
const hold = boundedScheduler.schedule('hold-io', { io: 1 }, () => new Promise(resolve => { unblock = resolve; }));
await sleep(10);
const completed = [];
const work = Array.from({ length: 6 }, (_, index) => bounded.add(async () => { completed.push(index); return index; }));
await sleep(10);
assert.equal(boundedScheduler.stats().queues['bounded-io'].pending, 1);
const controller = new AbortController();
const cancelled = assert.rejects(bounded.add(async () => assert.fail('cancelled admission ran'),
  { signal: controller.signal }), { name: 'AbortError' });
controller.abort();
await cancelled;
unblock();
assert.deepEqual(await Promise.all(work), [0, 1, 2, 3, 4, 5]);
await hold;
await bounded.onIdle();
assert.deepEqual(completed, [0, 1, 2, 3, 4, 5]);
assert.equal(boundedScheduler.stats().counters.rejectedByReason.maxPending, 0);
const holdAgain = boundedScheduler.schedule('hold-io', { io: 1 }, () => new Promise(resolve => { unblock = resolve; }));
await sleep(10);
const queued = assert.rejects(bounded.add(async () => assert.fail('cleared queued task ran')), /cleared/);
const waiting = assert.rejects(bounded.add(async () => assert.fail('cleared admission ran')), /cleared/);
await sleep(10);
bounded.clear();
await Promise.all([queued, waiting]);
await bounded.onIdle();
unblock();
await holdAgain;
await boundedScheduler.shutdown({ awaitRunning: true });
console.log('bounded IO admission preserves capacity, order, cancellation and clearing');
