#!/usr/bin/env node
import assert from 'node:assert/strict';
import { estimateJsonBytes } from '../../../src/shared/cache.js';
import {
  createPostingsQueue,
  estimatePostingsPayload
} from '../../../src/index/build/indexer/steps/process-files/postings-queue.js';

const sharedDeep = {
  a: {
    b: {
      c: {
        d: {
          e: {
            f: 'x'.repeat(256)
          }
        }
      }
    }
  }
};

const result = {
  chunks: Array.from({ length: 12 }, (_, id) => ({
    id,
    payload: sharedDeep
  })),
  fileRelations: {
    'src/a.js': [{ kind: 'import', target: 'src/b.js' }]
  },
  vfsManifestRows: [{ virtualPath: '/vfs/a.js', languageId: 'javascript' }]
};

const measured = estimatePostingsPayload(result);
const heuristic = estimateJsonBytes(result.chunks)
  + estimateJsonBytes(result.fileRelations)
  + estimateJsonBytes(result.vfsManifestRows);

assert.ok(measured.bytes > heuristic, 'postings payload bytes should use measured serialization, not heuristic estimates');

const queue = createPostingsQueue({
  maxPending: 4,
  maxPendingRows: 100,
  maxPendingBytes: measured.bytes,
  maxHeapFraction: 1
});

const first = await queue.reserve(measured);
let secondResolved = false;
const secondPromise = queue.reserve({ rows: 1, bytes: 1 }).then((reservation) => {
  secondResolved = true;
  return reservation;
});

await new Promise((resolve) => setTimeout(resolve, 50));
assert.equal(secondResolved, false, 'byte backpressure should block while pending bytes exceed bound');

first.release();
const second = await secondPromise;
second.release();

const stats = queue.stats();
assert.ok(stats.backpressure.byBytes >= 1, 'expected byte backpressure metric to increment');
assert.ok(stats.payload.measuredBytes >= measured.bytes + 1, 'expected measured byte telemetry to accumulate');
assert.ok(stats.gauge.highWaterPendingBytes >= measured.bytes, 'expected pending-bytes gauge high-water mark');

console.log('postings queue byte accounting test passed');
