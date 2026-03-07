#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  INTEGER_COERCE_MODE_STRICT,
  coerceClampedFraction,
  coerceFiniteNumber,
  coerceIntAtLeast,
  coerceNonNegativeInt,
  coerceNumberAtLeast,
  coercePositiveInt,
  coercePositiveIntMinOne,
  coerceUnitFraction
} from '../../src/shared/number-coerce.js';

assert.equal(coercePositiveInt('10.9'), 10);
assert.equal(coercePositiveInt('-1'), null);
assert.equal(coercePositiveIntMinOne('0.4'), 1);
assert.equal(coercePositiveIntMinOne('1.9'), 1);
assert.equal(coerceNonNegativeInt('0.9'), 0);
assert.equal(coerceNonNegativeInt('-2'), null);
assert.equal(coercePositiveInt('10.9', { mode: INTEGER_COERCE_MODE_STRICT }), null);
assert.equal(coercePositiveInt('10', { mode: INTEGER_COERCE_MODE_STRICT }), 10);
assert.equal(coercePositiveIntMinOne('1.9', { mode: INTEGER_COERCE_MODE_STRICT }), null);
assert.equal(coerceNonNegativeInt('0.9', { mode: INTEGER_COERCE_MODE_STRICT }), null);
assert.equal(coerceNonNegativeInt('0', { mode: INTEGER_COERCE_MODE_STRICT }), 0);

assert.equal(coerceFiniteNumber('2.5'), 2.5);
assert.equal(coerceFiniteNumber('bad', 7), 7);
assert.equal(coerceFiniteNumber('bad'), null);

assert.equal(coerceNumberAtLeast('2.5', 1), 2.5);
assert.equal(coerceNumberAtLeast('-5', 1), 1);
assert.equal(coerceNumberAtLeast('not-a-number', 1), null);

assert.equal(coerceIntAtLeast('8.9', 4), 8);
assert.equal(coerceIntAtLeast('-3', 4), 4);
assert.equal(coerceIntAtLeast('bad', 4), null);
assert.equal(coerceIntAtLeast('8.9', 4, { mode: INTEGER_COERCE_MODE_STRICT }), null);
assert.equal(coerceIntAtLeast('-3', 4, { mode: INTEGER_COERCE_MODE_STRICT }), 4);

assert.equal(coerceClampedFraction('1.5', { min: 0, max: 1 }), 1);
assert.equal(coerceClampedFraction('-0.2', { min: 0, max: 1 }), null);
assert.equal(coerceUnitFraction('0.5'), 0.5);
assert.equal(coerceUnitFraction('0'), null);

console.log('number coerce helpers test passed');
