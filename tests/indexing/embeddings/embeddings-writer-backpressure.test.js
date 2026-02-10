#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBoundedWriterQueue } from '../../../tools/build/embeddings/writer-queue.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let resolveFirst = null;
const firstGate = new Promise((resolve) => {
  resolveFirst = resolve;
});

let resolveSecond = null;
const secondGate = new Promise((resolve) => {
  resolveSecond = resolve;
});

let firstStarted = false;
let secondStarted = false;

const firstWrite = async () => {
  firstStarted = true;
  await firstGate;
};

const secondWrite = async () => {
  secondStarted = true;
  await secondGate;
};

const writer = createBoundedWriterQueue({
  scheduleIo: (fn) => fn(),
  maxPending: 1
});

const timeout = setTimeout(() => {
  console.error('embeddings writer backpressure test timed out');
  process.exit(1);
}, 5000);

await writer.enqueue(firstWrite);
assert.equal(firstStarted, true, 'expected first write to start immediately');
assert.equal(secondStarted, false, 'expected second write to not start yet');

let secondEnqueued = false;
const enqueueSecond = writer.enqueue(secondWrite).then(() => {
  secondEnqueued = true;
});

await delay(25);
assert.equal(secondEnqueued, false, 'expected enqueue to apply backpressure when saturated');
assert.equal(secondStarted, false, 'expected second write to remain blocked');

resolveFirst?.();
await enqueueSecond;
assert.equal(secondStarted, true, 'expected second write to start after first completes');

resolveSecond?.();
await writer.onIdle();

const stats = writer.stats();
assert.equal(stats.maxPending, 1);
assert.equal(stats.scheduled, 2);
assert.ok(stats.waits >= 1, 'expected at least one backpressure wait');
assert.ok(stats.peakPending <= stats.maxPending);

clearTimeout(timeout);

console.log('embeddings writer backpressure test passed');
