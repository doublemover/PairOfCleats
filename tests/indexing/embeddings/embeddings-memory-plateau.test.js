#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBoundedWriterQueue } from '../../../tools/build/embeddings/writer-queue.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const timeout = setTimeout(() => {
  console.error('embeddings memory plateau test timed out');
  process.exit(1);
}, 10000);

const writer = createBoundedWriterQueue({
  // Simulate slow IO so the queue saturates and applies backpressure.
  scheduleIo: (fn) => delay(10).then(fn),
  maxPending: 2
});

for (let i = 0; i < 50; i += 1) {
  await writer.enqueue(async () => {});
  const stats = writer.stats();
  assert.ok(stats.pending <= stats.maxPending, 'expected pending writes to remain bounded');
}

await writer.onIdle();

const finalStats = writer.stats();
assert.equal(finalStats.pending, 0, 'expected queue to drain onIdle');
assert.ok(finalStats.peakPending <= finalStats.maxPending, 'expected peakPending to remain bounded');

clearTimeout(timeout);

console.log('embeddings memory plateau test passed');

