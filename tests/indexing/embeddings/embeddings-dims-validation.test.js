#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createDimsValidator, isDimsMismatch, validateCachedDims } from '../../../tools/build-embeddings/embed.js';

const validator = createDimsValidator({ mode: 'code', configuredDims: 4 });
validator.assertDims(4);
assert.throws(() => validator.assertDims(5), /embedding dims mismatch/, 'expected configured dims mismatch to throw');

const cachedOk = [[0, 1, 2, 3], [4, 5, 6, 7]];
validateCachedDims({ vectors: cachedOk, expectedDims: 4, mode: 'code' });

assert.throws(
  () => validateCachedDims({ vectors: [[0, 1, 2]], expectedDims: 4, mode: 'code' }),
  /embedding dims mismatch/,
  'expected cached dims mismatch to throw'
);

const mismatchError = new Error('[embeddings] code embedding dims mismatch (configured=4, observed=5).');
assert.equal(isDimsMismatch(mismatchError), true, 'expected dims mismatch error to be detected');

console.log('embeddings dims validation test passed');
