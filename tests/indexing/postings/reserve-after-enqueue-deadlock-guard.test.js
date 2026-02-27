#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildOrderedAppender } from '../../../src/index/build/indexer/steps/process-files/ordered.js';
import { createPostingsQueue } from '../../../src/index/build/indexer/steps/process-files/postings-queue.js';
import { runApplyWithPostingsBackpressure } from '../../../src/index/build/indexer/steps/process-files.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const queue = createPostingsQueue({
  maxPending: 1,
  maxPendingRows: 10,
  maxPendingBytes: 1024,
  maxHeapFraction: 1
});

const flushed = [];
const appender = buildOrderedAppender(
  async (result) => runApplyWithPostingsBackpressure({
    sparsePostingsEnabled: true,
    postingsQueue: queue,
    result,
    runApply: async () => {
      flushed.push(result.id);
    }
  }),
  {},
  {
    startIndex: 105,
    expectedCount: 2
  }
);

const guardReservation = await queue.reserve({ rows: 10, bytes: 0 });
const tailDone = appender.enqueue(106, { id: 106, chunks: [{ id: 'tail' }] });
const headDone = appender.enqueue(105, { id: 105, chunks: [{ id: 'head' }] });

const waitingState = await Promise.race([
  Promise.all([headDone, tailDone]).then(() => 'resolved'),
  sleep(30).then(() => 'pending')
]);
assert.equal(waitingState, 'pending', 'expected apply path to wait while external reservation is held');

guardReservation.release();
await Promise.race([
  Promise.all([headDone, tailDone]),
  sleep(500).then(() => {
    throw new Error('expected enqueue-first ordered flow to complete after releasing queue backpressure');
  })
]);

assert.deepEqual(flushed, [105, 106], 'expected ordered flush order after delayed postings reservation');
assert.equal(queue.stats().pending.count, 0, 'expected postings queue reservations to fully drain');

console.log('postings reserve-after-enqueue deadlock guard test passed');
