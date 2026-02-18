#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createPostingsQueue,
  estimatePostingsPayload
} from '../../../src/index/build/indexer/steps/process-files/postings-queue.js';

const legacyResult = {
  chunks: [
    { id: 1, payload: { token: 'alpha', count: 2 } },
    { id: 2, payload: { token: 'beta', count: 3 } }
  ],
  fileRelations: {
    imports: [{ from: 'src/a.js', to: 'src/b.js' }]
  },
  vfsManifestRows: [{ virtualPath: '/vfs/src/a.js', languageId: 'javascript' }]
};

const legacyPayload = estimatePostingsPayload(legacyResult);
assert.ok(legacyPayload.rows >= 1, 'expected legacy rows estimate');
assert.ok(legacyPayload.bytes >= 1, 'expected legacy bytes estimate');

let serialized = false;
const metadataResult = {
  chunks: [{
    toJSON() {
      serialized = true;
      throw new Error('metadata path should not stringify chunks');
    }
  }],
  postingsPayload: legacyPayload
};

const measured = estimatePostingsPayload(metadataResult);
assert.deepEqual(measured, legacyPayload, 'precomputed payload should preserve legacy rows/bytes');
assert.equal(serialized, false, 'expected metadata path to bypass fallback stringify estimation');

const queue = createPostingsQueue({
  maxPending: 2,
  maxPendingRows: measured.rows,
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
assert.equal(secondResolved, false, 'expected reservation accounting to match legacy backpressure behavior');

first.release();
const second = await secondPromise;
second.release();

const stats = queue.stats();
assert.ok(
  stats.backpressure.byRows >= 1 || stats.backpressure.byBytes >= 1,
  'expected backpressure metrics to reflect reserved metadata rows/bytes'
);
assert.equal(stats.payload.measuredRows, measured.rows + 1, 'expected reserved rows accounting parity');
assert.equal(stats.payload.measuredBytes, measured.bytes + 1, 'expected reserved bytes accounting parity');

console.log('postings payload precomputed metadata test passed');
