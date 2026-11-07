import assert from 'node:assert/strict';
import { createIncrementalChunkMappingIndex, resolveChunkFileMapping, resolveBundleChunkVectorIndex,
  toChunkIndex, toUint8Vector, vectorsEqual } from '../../../tools/build/embeddings/runner/mapping.js';

const chunk = (file, extra = {}) => ({ file, id: 0, kind: 'function', name: 'run', start: 0, end: 10, ...extra });
const index = createIncrementalChunkMappingIndex(new Map([
  ['a.js', [{ index: 0, chunk: chunk('a.js') }]], ['b.js', [{ index: 1, chunk: chunk('b.js') }]]
]));
const resolve = (mappingIndex, file, row, options = {}) => resolveBundleChunkVectorIndex({ mappingIndex, normalizedFile: file,
  chunk: row, fileMapping: resolveChunkFileMapping(mappingIndex, file), fallbackState: { cursor: 0 }, vectorCount: 2, ...options });
assert.equal(resolve(index, 'c.js', chunk('c.js')).reason, 'missingParent');
assert.equal(resolve(index, 'a.js', chunk('a.js')).vectorIndex, 0, 'numeric document zero remains addressable');
const ambiguous = createIncrementalChunkMappingIndex(new Map([['a.js', [
  { index: 0, chunk: chunk('a.js', { chunkId: 'duplicate' }) },
  { index: 1, chunk: chunk('a.js', { chunkId: 'duplicate' }) }
]]]));
assert.equal(resolve(ambiguous, 'a.js', chunk('a.js', { chunkId: 'duplicate' })).vectorIndex, null,
  'duplicate local IDs cannot fall through to structural or positional guessing');
const stable = createIncrementalChunkMappingIndex(new Map([['a.js', [{ index: 0, chunk: chunk('a.js', { chunkId: 'unique-stable' }) }]]]));
assert.equal(resolve(stable, 'renamed.js', chunk('renamed.js', { chunkId: 'unique-stable' }), { vectorCount: null }).vectorIndex, 0,
  'a unique stable identity can recover across parent renames without an optional count bound');
assert.equal(resolve(index, 'a.js', chunk('a.js', { id: 999, name: 'unrelated', start: 1000, end: 1010 })).vectorIndex, null,
  'a mismatched structural row is not repaired with the next positional row');
for (const value of [null, undefined, '', ' ', false, 1.5, -1, Infinity]) assert.equal(toChunkIndex(value), null);
assert.equal(toChunkIndex('0'), 0);
for (const row of [[1.5], [-1], [256], [NaN], new Int8Array([-1])]) assert.equal(toUint8Vector(row), null);
assert.equal(vectorsEqual([1.5], [1]), false, 'invalid bundle bytes cannot compare equal after coercion');
console.log('Incremental embedding mapping rejects ambiguous identities and preserves exact vector bytes.');
