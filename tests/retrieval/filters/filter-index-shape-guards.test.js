#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildFilterIndex,
  hydrateFilterIndex,
  serializeFilterIndex
} from '../../../src/retrieval/filter-index.js';

const index = buildFilterIndex([
  {
    id: 1,
    file: 'src/a.js',
    ext: '.js',
    kind: 'function',
    last_author: new Set(['Alice']),
    chunk_authors: new Set(['Bob']),
    metaV2: { lang: 'javascript' }
  }
], { includeBitmaps: false });

assert.ok(index.byAuthor.get('alice')?.has(1), 'expected iterable last_author to be indexed');
assert.ok(index.byChunkAuthor.get('bob')?.has(1), 'expected iterable chunk_authors to be indexed');

index.fileChunksById = [{ broken: true }];
const serialized = serializeFilterIndex(index);
assert.deepEqual(
  serialized.fileChunksById,
  [[]],
  'expected serializeFilterIndex to fail closed for non-iterable file chunk buckets'
);

const hydrated = hydrateFilterIndex({
  byExt: { '.js': [1] },
  byKind: { function: [1] },
  byAuthor: { alice: [1] },
  byChunkAuthor: { bob: [1] },
  byVisibility: {},
  fileById: ['src/a.js'],
  fileChunksById: [{ broken: true }, [1, 2]],
  fileChargrams: {}
});

assert.deepEqual(
  Array.from(hydrated.fileChunksById[0] || []),
  [],
  'expected hydrateFilterIndex to coerce malformed file chunk buckets to empty sets'
);
assert.deepEqual(
  Array.from(hydrated.fileChunksById[1] || []),
  [1, 2],
  'expected hydrateFilterIndex to preserve valid file chunk buckets'
);

const empty = buildFilterIndex({ not: 'iterable' }, { includeBitmaps: false });
assert.equal(empty.fileById.length, 0, 'expected non-iterable chunkMeta inputs to fail closed');

console.log('filter-index shape guards test passed');
