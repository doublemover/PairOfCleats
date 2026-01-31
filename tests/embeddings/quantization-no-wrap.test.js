#!/usr/bin/env node
import assert from 'node:assert/strict';
import { clampQuantizedVectorInPlace } from '../../src/shared/embedding-utils.js';
import { packUint8 } from '../../src/storage/sqlite/vector.js';

const values = [300, -5, 255, 0, 256, 42];
const packed = packUint8(values);
const packedValues = Array.from(packed.values());

assert.equal(packedValues[0], 255, 'expected values >255 to clamp to 255');
assert.equal(packedValues[1], 0, 'expected values <0 to clamp to 0');
assert.equal(packedValues[4], 255, 'expected 256 to clamp to 255');
assert.notEqual(packedValues[0], 44, 'expected no uint8 wrap-around');

const clampInput = [255, -1, 999];
const clampedCount = clampQuantizedVectorInPlace(clampInput);
assert.equal(clampedCount, 2, 'expected two clamped values');
assert.deepEqual(clampInput, [255, 0, 255], 'expected clamp to enforce uint8 bounds');

console.log('quantization no-wrap test passed');
