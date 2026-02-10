#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizeEmbeddingDims } from '../../../src/retrieval/ann/dims.js';

const clipped = normalizeEmbeddingDims([1, 2, 3, 4], 2);
assert.equal(clipped.adjusted, true, 'expected clip adjustment');
assert.equal(clipped.queryDims, 4, 'expected original query dims');
assert.equal(clipped.expectedDims, 2, 'expected target dims');
assert.deepEqual(clipped.embedding, [1, 2], 'expected clipped embedding');

const padded = normalizeEmbeddingDims(new Float32Array([3, 4]), 4);
assert.equal(padded.adjusted, true, 'expected pad adjustment');
assert.equal(padded.queryDims, 2, 'expected original typed-array dims');
assert.equal(padded.expectedDims, 4, 'expected target dims');
assert.deepEqual(padded.embedding, [3, 4, 0, 0], 'expected zero-padded embedding');

const unchanged = normalizeEmbeddingDims([7, 8, 9], 3);
assert.equal(unchanged.adjusted, false, 'expected unchanged dimensions');
assert.deepEqual(unchanged.embedding, [7, 8, 9], 'expected unchanged embedding');

console.log('embedding dims normalization test passed');
