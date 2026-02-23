#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createIncrementalChunkMappingIndex,
  resolveBundleChunkVectorIndex
} from '../../../tools/build/embeddings/runner/mapping.js';

const chunksByFile = new Map([
  ['src/a.js', [
    { index: 5, chunk: { id: 5, file: 'src/a.js', chunkId: 'ck:a:5', start: 0, end: 10 } },
    { index: 1, chunk: { id: 1, file: 'src/a.js', chunkId: 'ck:a:1', start: 11, end: 20 } }
  ]]
]);

const mappingIndex = createIncrementalChunkMappingIndex(chunksByFile);
const fileMapping = mappingIndex.fileMappings.get('src/a.js');
assert.ok(fileMapping, 'expected file mapping for src/a.js');

const outOfRangeStableId = resolveBundleChunkVectorIndex({
  chunk: { id: 5, file: 'src/a.js', chunkId: 'ck:a:5', start: 0, end: 10 },
  normalizedFile: 'src/a.js',
  fileMapping,
  mappingIndex,
  fallbackState: { cursor: 0 },
  vectorCount: 2
});
assert.equal(
  outOfRangeStableId.vectorIndex,
  1,
  'expected out-of-range stable-id match to fall through to next in-range fallback mapping'
);

const outOfRangeNumericFallback = resolveBundleChunkVectorIndex({
  chunk: { id: 99 },
  normalizedFile: 'src/missing.js',
  fileMapping: null,
  mappingIndex,
  fallbackState: { cursor: 0 },
  vectorCount: 2
});
assert.equal(outOfRangeNumericFallback.vectorIndex, null, 'expected numeric fallback to honor vector bounds');
assert.equal(outOfRangeNumericFallback.reason, 'missingParent');

console.log('embeddings mapping index bounds test passed');
