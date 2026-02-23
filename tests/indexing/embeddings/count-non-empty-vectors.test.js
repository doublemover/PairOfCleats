#!/usr/bin/env node
import assert from 'node:assert/strict';
import { countNonEmptyVectors } from '../../../src/shared/embedding-utils.js';

assert.equal(countNonEmptyVectors(null), 0, 'expected null vectors to count as zero');
assert.equal(
  countNonEmptyVectors([new Uint8Array([1, 2]), new Float32Array(0), [1], []]),
  2,
  'expected typed-array entries to count as non-empty vectors'
);

const iterableVectors = new Set([new Uint8Array([3]), new Uint8Array(0)]);
assert.equal(
  countNonEmptyVectors(iterableVectors),
  1,
  'expected iterable vector collections to be counted'
);

console.log('count non-empty vectors test passed');
