#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  normalizeOptionalNumber,
  normalizeOptionalInt,
  normalizeOptionalNonNegativeInt,
  normalizeNonNegativeInt,
  normalizePositiveNumber,
  normalizePositiveInt,
  normalizeCap,
  normalizeDepth,
  normalizeLimit,
  normalizeOptionalLimit,
  normalizeCapNullOnZero
} from '../../../src/shared/limits.js';

assert.equal(normalizeOptionalNumber('3'), 3);
assert.equal(normalizeOptionalNumber('nope'), null);

assert.equal(normalizeOptionalInt(3.8), 3);
assert.equal(normalizeOptionalInt('nope'), null);

assert.equal(normalizeOptionalNonNegativeInt(-5), 0);
assert.equal(normalizeOptionalNonNegativeInt(2.2), 2);
assert.equal(normalizeOptionalNonNegativeInt('nope'), null);

assert.equal(normalizeNonNegativeInt(-2), 0);
assert.equal(normalizeNonNegativeInt('nope', 5), 5);

assert.equal(normalizePositiveNumber(0, 7), 7);
assert.equal(normalizePositiveNumber(2.5, 7), 2.5);

assert.equal(normalizePositiveInt(0, 9), 9);
assert.equal(normalizePositiveInt(3.9, 9), 3);

assert.equal(normalizeCap(3), 3);
assert.equal(normalizeDepth(4), 4);
assert.equal(normalizeLimit(5), 5);
assert.equal(normalizeOptionalLimit(6), 6);

assert.equal(normalizeCapNullOnZero(0, 7), null);
assert.equal(normalizeCapNullOnZero(false, 7), null);
assert.equal(normalizeCapNullOnZero(3.7, 7), 3);
assert.equal(normalizeCapNullOnZero('nope', 7), 7);

console.log('limits normalization ok');
