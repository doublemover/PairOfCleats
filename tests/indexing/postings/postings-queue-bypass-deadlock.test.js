#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildOrderedAppender } from '../../../src/index/build/indexer/steps/process-files/ordered.js';
import { createPostingsQueue } from '../../../src/index/build/indexer/steps/process-files/postings-queue.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const queue = createPostingsQueue({
  maxPending: 1,
  maxPendingRows: 10,
  maxPendingBytes: 1024,
  maxHeapFraction: 1
});

const flushed = [];
const appender = buildOrderedAppender(
  async (result) => {
    flushed.push(result.id);
  },
  {},
  {
    startIndex: 105,
    expectedCount: 2
  }
);

const tailReservation = await queue.reserve({ rows: 10, bytes: 0 });
const tailDone = appender
  .enqueue(106, { id: 106, chunks: Array.from({ length: 10 }, () => ({})) })
  .finally(() => tailReservation.release());

const nextIndex = appender.peekNextIndex();
const headReservation = await queue.reserve({
  rows: 10,
  bytes: 0,
  bypass: Number.isFinite(nextIndex) && 105 <= nextIndex
});
const headDone = appender
  .enqueue(105, { id: 105, chunks: Array.from({ length: 10 }, () => ({})) })
  .finally(() => headReservation.release());

await Promise.race([
  Promise.all([headDone, tailDone]),
  sleep(500).then(() => {
    throw new Error('expected head-of-line reserve bypass to prevent reserve deadlock');
  })
]);

assert.deepEqual(flushed, [105, 106], 'expected ordered flush to progress once head index bypasses reserve backpressure');
const stats = queue.stats();
assert.ok(stats.backpressure.bypass >= 1, 'expected reserve bypass telemetry to increment');
assert.equal(stats.pending.count, 0, 'expected pending reservation count to drain');

console.log('postings queue bypass deadlock test passed');
