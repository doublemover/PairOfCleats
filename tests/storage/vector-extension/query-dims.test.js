#!/usr/bin/env node
import assert from 'node:assert/strict';
import { queryVectorAnn } from '../../../tools/sqlite/vector-extension.js';

const captured = [];
const db = {
  prepare(sql) {
    assert.ok(
      typeof sql === 'string' && sql.includes('MATCH ?'),
      'expected MATCH query for vector extension'
    );
    return {
      all(...params) {
        captured.push(params[0]);
        return [];
      }
    };
  }
};

const baseConfig = {
  enabled: true,
  table: 'dense_vectors_ann',
  column: 'embedding',
  encoding: 'float32',
  dims: 4
};

queryVectorAnn(db, baseConfig, [1, 2], 5, null);
queryVectorAnn(db, baseConfig, [1, 2, 3, 4, 5], 5, null);

assert.equal(captured.length, 2, 'expected two ANN invocations');

const padded = new Float32Array(captured[0].buffer, captured[0].byteOffset, captured[0].byteLength / 4);
assert.deepEqual(Array.from(padded), [1, 2, 0, 0], 'expected zero padding for short query embedding');

const clipped = new Float32Array(captured[1].buffer, captured[1].byteOffset, captured[1].byteLength / 4);
assert.deepEqual(Array.from(clipped), [1, 2, 3, 4], 'expected clipping for oversized query embedding');

console.log('vector extension query dims test passed');
