#!/usr/bin/env node
import assert from 'node:assert/strict';
import { toArray, toStringArray } from '../../src/shared/iterables.js';

assert.deepEqual(toArray(null), []);
assert.deepEqual(toArray('abc'), [], 'strings should not be exploded into character arrays');
assert.deepEqual(toArray(new Set([1, 2, 2])), [1, 2], 'iterables should be converted via Array.from');
assert.deepEqual(toArray({ a: 1 }), [], 'non-iterables should resolve to empty list');

assert.deepEqual(
  toStringArray([' alpha ', '', 'BETA', 7, null], { lower: true }),
  ['alpha', 'beta'],
  'toStringArray should normalize, trim, and filter values'
);
assert.deepEqual(toStringArray({ value: 'x' }), []);

console.log('shared iterables shape guards unit test passed');
