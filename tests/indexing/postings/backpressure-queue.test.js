#!/usr/bin/env node
import { createPostingsQueue } from '../../../src/index/build/indexer/steps/process-files/postings-queue.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

console.log('backpressure queue test passed');
