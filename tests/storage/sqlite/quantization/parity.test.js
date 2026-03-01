#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../../helpers/test-env.js';
import {
  resolveDenseMetaRecord,
  resolveQuantizationParams
} from '../../../../src/storage/sqlite/quantization.js';

applyTestEnv();

assert.deepEqual(
  resolveQuantizationParams({}),
  { minVal: -1, maxVal: 1, levels: 256 }
);
assert.deepEqual(
  resolveQuantizationParams({ min_val: -2, max_val: 2, levels: 1024 }),
  { minVal: -2, maxVal: 2, levels: 256 }
);
assert.deepEqual(
  resolveQuantizationParams({ minVal: 0, maxVal: 0.5, levels: 1 }),
  { minVal: 0, maxVal: 0.5, levels: 2 }
);

const explicitScale = resolveDenseMetaRecord(
  { dims: 16, model: 'stub', min_val: -3, max_val: 3, levels: 128, scale: 0.125 },
  { fallbackDims: 4, fallbackModel: 'fallback' }
);
assert.equal(explicitScale.dims, 16);
assert.equal(explicitScale.model, 'stub');
assert.equal(explicitScale.minVal, -3);
assert.equal(explicitScale.maxVal, 3);
assert.equal(explicitScale.levels, 128);
assert.equal(explicitScale.scale, 0.125);

const derivedScale = resolveDenseMetaRecord(
  { min_val: -1, max_val: 1, levels: 256 },
  { fallbackDims: 8, fallbackModel: 'default-model' }
);
assert.equal(derivedScale.dims, 8);
assert.equal(derivedScale.model, 'default-model');
assert.equal(derivedScale.scale, 2 / 255);

const zeroRangeScale = resolveDenseMetaRecord(
  { min_val: 3, max_val: 3, levels: 200 },
  { fallbackDims: 2, fallbackModel: null, defaultScale: 0.5 }
);
assert.equal(zeroRangeScale.scale, 0.5);

console.log('sqlite quantization parity test passed');
