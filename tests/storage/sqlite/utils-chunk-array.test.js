#!/usr/bin/env node
import assert from 'node:assert/strict';

import { chunkArray } from '../../../src/storage/sqlite/utils.js';

assert.deepEqual(chunkArray(null), [], 'expected null input to return empty chunks');
assert.deepEqual(chunkArray(undefined), [], 'expected undefined input to return empty chunks');
assert.deepEqual(chunkArray([]), [], 'expected empty input to return empty chunks');

assert.deepEqual(
  chunkArray([1, 2, 3, 4], 2),
  [[1, 2], [3, 4]],
  'expected chunkArray to split by requested chunk size'
);

assert.deepEqual(
  chunkArray([1, 2, 3], 0),
  [[1, 2, 3]],
  'expected non-positive chunk size to fall back to default sizing'
);

assert.deepEqual(
  chunkArray([1, 2, 3], Number.NaN),
  [[1, 2, 3]],
  'expected invalid chunk size to fall back to default sizing'
);

assert.deepEqual(
  chunkArray([1, 2, 3], 0.5),
  [[1], [2], [3]],
  'expected fractional chunk sizes below one to clamp to one and avoid infinite loops'
);

console.log('sqlite utils chunk array test passed');
