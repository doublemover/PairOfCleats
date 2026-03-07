#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createChunkMetaIterator, resolveChunkMetaOrderById } from '../../../src/index/build/artifacts/writers/chunk-meta.js';

const chunks = [
  {
    id: 1,
    chunkId: 'chunk-1',
    file: 'src/beta.js',
    chunkUid: 'uid-beta',
    start: 0,
    end: 10
  },
  {
    id: 0,
    chunkId: 'chunk-0',
    file: 'src/alpha.js',
    chunkUid: 'uid-alpha',
    start: 0,
    end: 5
  }
];

const fileIdByPath = new Map([
  ['src/alpha.js', 0],
  ['src/beta.js', 1]
]);

const order = resolveChunkMetaOrderById(chunks);
assert.ok(Array.isArray(order), 'expected out-of-order chunks to produce an order list');

const iterator = createChunkMetaIterator({
  chunks,
  fileIdByPath,
  resolvedTokenMode: 'none',
  tokenSampleSize: 0,
  maxJsonBytes: null,
  order
});

const rows = Array.from(iterator(0, chunks.length, false));
assert.equal(rows[0].id, 0, 'expected chunk_meta ordered by id');
assert.equal(rows[1].id, 1, 'expected chunk_meta ordered by id');
assert.equal(rows[0].fileId, 0, 'expected fileId mapping in chunk_meta');
assert.equal(rows[1].fileId, 1, 'expected fileId mapping in chunk_meta');

console.log('chunk_meta ordering test passed');
