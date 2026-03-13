#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBoundedWriterQueue } from '../../../tools/build/embeddings/writer-queue.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let dynamicLimit = 3;
const adjustments = [];
const writer = createBoundedWriterQueue({
  scheduleIo: (fn) => delay(10).then(fn),
  maxPending: 3,
  resolveMaxPending: () => dynamicLimit,
  onAdjust: (event) => {
    adjustments.push(event);
  }
});

const tasks = [];
for (let i = 0; i < 12; i += 1) {
  if (i === 4) dynamicLimit = 1;
  if (i === 8) dynamicLimit = 2;
  tasks.push(writer.enqueue(async () => {}));
}
await Promise.all(tasks);
await writer.onIdle();

const stats = writer.stats();
assert.equal(stats.pending, 0, 'expected queue to drain');
assert.ok(stats.adjustments >= 2, 'expected dynamic max-pending adjustments');
assert.ok(stats.minDynamicMaxPending <= 1, 'expected dynamic floor tracking');
assert.ok(stats.peakDynamicMaxPending >= 3, 'expected dynamic ceiling tracking');
assert.ok(adjustments.length >= 2, 'expected adjustment callbacks to fire');

console.log('embeddings writer adaptive pending test passed');
