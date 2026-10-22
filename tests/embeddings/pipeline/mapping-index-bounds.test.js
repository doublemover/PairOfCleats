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

const identical = file => ({ file, id: 0, kind: 'function', name: 'run', start: 0, end: 10 });
const collisions = createIncrementalChunkMappingIndex(new Map([
  ['a.js', [{ index: 0, chunk: { ...identical('a.js'), chunkId: 'duplicate' } }]],
  ['b.js', [{ index: 1, chunk: { ...identical('b.js'), chunkId: 'duplicate' } }]]
]));
for (const chunk of [identical('c.js'), { id: 0 }, { chunkId: 'duplicate' }]) {
  const result = resolveBundleChunkVectorIndex({ chunk, normalizedFile: 'c.js',
    fileMapping: null, mappingIndex: collisions, fallbackState: { cursor: 0 }, vectorCount: 2 });
  assert.deepEqual(result, { vectorIndex: null, reason: 'missingParent' },
    'an unknown file cannot inherit a structural/numeric/ambiguous stable match');
}
const stable = createIncrementalChunkMappingIndex(new Map([
  ['a.js', [{ index: 0, chunk: { ...identical('a.js'), chunkId: 'unique' } }]]
]));
assert.equal(resolveBundleChunkVectorIndex({ chunk: { chunkId: 'unique' }, normalizedFile: 'renamed.js',
  fileMapping: null, mappingIndex: stable, fallbackState: { cursor: 0 }, vectorCount: 1 }).vectorIndex, 0,
'a unique explicit stable identity remains an admissible cross-file recovery');
const whitespacePaths = createIncrementalChunkMappingIndex(new Map([
  ['a.js', [{ index: 0, chunk: identical('a.js') }]],
  [' a.js', [{ index: 1, chunk: identical(' a.js') }]]
]));
assert.equal(whitespacePaths.fileMappings.size, 2, 'mapping file identity also preserves leading whitespace');
assert.equal(whitespacePaths.fileMappings.get(' a.js').fallbackIndices[0], 1);

console.log('embeddings mapping index bounds test passed');
