#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../../helpers/test-env.js';
import {
  createChunkHashReuseIndex,
  reuseVectorsFromPriorCacheEntry
} from '../../../../tools/build/embeddings/runner/cache-orchestration.js';

applyTestEnv();

const hashIndex = createChunkHashReuseIndex(['dup', 'single', 'dup', 'dup']);
assert.equal(hashIndex.take('dup'), 0);
assert.equal(hashIndex.take('dup'), 2);
assert.equal(hashIndex.take('dup'), 3);
assert.equal(hashIndex.take('dup'), null);
assert.equal(hashIndex.take('single'), 1);
assert.equal(hashIndex.take('missing'), null);

const priorEntry = {
  chunkHashes: ['dup', 'dup', 'uniq'],
  codeVectors: [[1], [2], [3]],
  docVectors: [[11], [12], [13]],
  mergedVectors: [[21], [22], [23]]
};
const cacheState = {
  cacheEligible: true,
  cacheDir: 'cache-dir',
  cacheIndex: {
    files: { 'src/a.js': 'prior-key' },
    entries: { 'prior-key': { chunkHashesFingerprint: 'fp-1' } }
  }
};
const reuse = {
  code: new Array(4),
  doc: new Array(4),
  merged: new Array(4)
};
let readCalls = 0;
await reuseVectorsFromPriorCacheEntry({
  cacheState,
  cacheKey: 'new-key',
  normalizedRel: 'src/a.js',
  chunkHashes: ['dup', 'dup', 'dup', 'uniq'],
  chunkHashesFingerprint: 'fp-1',
  reuse,
  scheduleIo: async (worker) => worker(),
  readCacheEntryImpl: async (cacheDir, cacheKey, cacheIndex) => {
    readCalls += 1;
    assert.equal(cacheDir, 'cache-dir');
    assert.equal(cacheKey, 'prior-key');
    assert.equal(cacheIndex, cacheState.cacheIndex);
    return { entry: priorEntry };
  }
});

assert.equal(readCalls, 1);
assert.deepEqual(reuse.code[0], [1]);
assert.deepEqual(reuse.code[1], [2]);
assert.equal(reuse.code[2], undefined);
assert.deepEqual(reuse.code[3], [3]);
assert.deepEqual(reuse.doc[0], [11]);
assert.deepEqual(reuse.merged[3], [23]);

const mismatchReuse = {
  code: new Array(1),
  doc: new Array(1),
  merged: new Array(1)
};
readCalls = 0;
await reuseVectorsFromPriorCacheEntry({
  cacheState,
  cacheKey: 'new-key',
  normalizedRel: 'src/a.js',
  chunkHashes: ['dup'],
  chunkHashesFingerprint: 'different',
  reuse: mismatchReuse,
  scheduleIo: async (worker) => worker(),
  readCacheEntryImpl: async () => {
    readCalls += 1;
    return { entry: priorEntry };
  }
});
assert.equal(readCalls, 0, 'expected fingerprint mismatch to bypass cache entry read');
assert.equal(mismatchReuse.code[0], undefined);

console.log('cache orchestration chunk-hash reuse index test passed');
