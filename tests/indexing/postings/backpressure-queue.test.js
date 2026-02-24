#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { createPostingsQueue } from '../../../src/index/build/indexer/steps/process-files/postings-queue.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

ensureTestingEnv(process.env);

const fail = (message) => {
  console.error(`backpressure queue test failed: ${message}`);
  process.exit(1);
};

const queue = createPostingsQueue({
  maxPending: 1,
  maxPendingRows: 2,
  maxPendingBytes: 100,
  maxHeapFraction: 1
});

const first = await queue.reserve({ rows: 2, bytes: 80 });
let secondResolved = false;
const start = Date.now();
const secondPromise = queue.reserve({ rows: 2, bytes: 80 }).then((reservation) => {
  secondResolved = true;
  return reservation;
});

await sleep(50);
if (secondResolved) {
  fail('expected second reservation to block on backpressure');
}

first.release();
const second = await secondPromise;
const waitedMs = Date.now() - start;
if (waitedMs < 40) {
  fail(`expected backpressure wait; waited ${waitedMs}ms`);
}
second.release();

const stats = queue.stats();
if (!stats || typeof stats !== 'object') {
  fail('missing queue stats');
}
if (!stats.backpressure || stats.backpressure.count < 1) {
  fail('expected backpressure count to increment');
}
if (!stats.backpressure || stats.backpressure.waitMs <= 0) {
  fail('expected backpressure wait time to be recorded');
}

const timeoutQueue = createPostingsQueue({
  maxPending: 1,
  maxPendingRows: 2,
  maxPendingBytes: 100,
  maxHeapFraction: 1,
  reserveTimeoutMs: 25
});
const timeoutGuard = await timeoutQueue.reserve({ rows: 2, bytes: 80 });
await assert.rejects(
  () => timeoutQueue.reserve({ rows: 2, bytes: 80 }),
  (err) => err?.code === 'POSTINGS_BACKPRESSURE_TIMEOUT',
  'expected reserve timeout while queue remains saturated'
);
timeoutGuard.release();

const abortQueue = createPostingsQueue({
  maxPending: 1,
  maxPendingRows: 2,
  maxPendingBytes: 100,
  maxHeapFraction: 1
});
const abortGuard = await abortQueue.reserve({ rows: 2, bytes: 80 });
const abortController = new AbortController();
setTimeout(() => abortController.abort(new Error('abort postings reserve wait')), 10);
await assert.rejects(
  () => abortQueue.reserve({ rows: 2, bytes: 80, signal: abortController.signal }),
  (err) => (err?.message || '').includes('abort postings reserve wait'),
  'expected reserve wait to reject when abort signal fires'
);
abortGuard.release();

console.log('backpressure queue test passed');
