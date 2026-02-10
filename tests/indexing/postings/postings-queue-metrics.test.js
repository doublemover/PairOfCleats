#!/usr/bin/env node
import { createPostingsQueue } from '../../../src/index/build/indexer/steps/process-files/postings-queue.js';

const fail = (message) => {
  console.error(`postings queue metrics test failed: ${message}`);
  process.exit(1);
};

const queue = createPostingsQueue({
  maxPending: 2,
  maxPendingRows: 4,
  maxPendingBytes: 200,
  maxHeapFraction: 1
});

const first = await queue.reserve({ rows: 2, bytes: 60 });
const second = await queue.reserve({ rows: 1, bytes: 20 });

const mid = queue.stats();
if (mid.limits?.maxPending !== 2) fail('limits.maxPending mismatch');
if (mid.pending?.count !== 2) fail('pending count mismatch');
if (mid.pending?.rows !== 3) fail('pending rows mismatch');
if (mid.pending?.bytes !== 80) fail('pending bytes mismatch');
if (mid.highWater?.pending < 2) fail('highWater.pending not updated');
if (mid.highWater?.rows < 3) fail('highWater.rows not updated');
if (mid.highWater?.bytes < 80) fail('highWater.bytes not updated');

second.release();
first.release();

const end = queue.stats();
if (end.pending?.count !== 0) fail('pending count not reset after release');
if (end.pending?.rows !== 0) fail('pending rows not reset after release');
if (end.pending?.bytes !== 0) fail('pending bytes not reset after release');

console.log('postings queue metrics test passed');
