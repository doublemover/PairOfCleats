#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveSqliteBatchSize } from '../../../src/storage/sqlite/utils.js';

const MB = 1024 * 1024;

assert.equal(resolveSqliteBatchSize({ batchSize: 10 }), 50, 'min clamp expected');
assert.equal(resolveSqliteBatchSize({ batchSize: 5000 }), 2000, 'max clamp expected');

assert.equal(resolveSqliteBatchSize({ inputBytes: 3000 * MB }), 200, 'large inputBytes should reduce batch size');
assert.equal(resolveSqliteBatchSize({ inputBytes: 700 * MB }), 400, 'mid inputBytes should reduce batch size');
assert.equal(resolveSqliteBatchSize({ inputBytes: 200 * MB }), 700, 'smaller inputBytes should reduce batch size');
assert.equal(resolveSqliteBatchSize({ inputBytes: 10 * MB }), 1000, 'small inputBytes should keep default');

assert.equal(
  resolveSqliteBatchSize({ inputBytes: 200 * MB, rowCount: 1_000_000 }),
  200,
  'rowCount should cap batch size'
);
assert.equal(
  resolveSqliteBatchSize({ inputBytes: 200 * MB, rowCount: 100_000 }),
  700,
  'rowCount should not increase batch size'
);

console.log('sqlite batch size adaptive test passed');
