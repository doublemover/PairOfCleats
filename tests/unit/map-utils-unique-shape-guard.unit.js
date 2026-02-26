#!/usr/bin/env node
import assert from 'node:assert/strict';
import { unique } from '../../src/map/utils.js';

assert.deepEqual(unique('abc'), [], 'string input should be treated as scalar, not iterable list');
assert.deepEqual(unique({ a: 1, b: 2 }), [], 'plain object input should not throw and should return empty list');
assert.deepEqual(
  unique(new Set(['alpha', 'alpha', '', null, 'beta'])),
  ['alpha', 'beta'],
  'iterable inputs should dedupe and drop falsey entries'
);

console.log('map utils unique shape guard unit test passed');
