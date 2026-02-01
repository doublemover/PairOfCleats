#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  quantizeEmbeddingVector,
  quantizeEmbeddingVectorUint8
} from '../../../src/shared/embedding-utils.js';

const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => {
  warnings.push(args.join(' '));
};

try {
  const safe = quantizeEmbeddingVector([0, 0.5, -0.5], -1, 1, 256);
  assert.equal(safe.length, 3);
  assert.equal(warnings.length, 0, 'expected no warning for in-range values');

  const clamped = quantizeEmbeddingVectorUint8([999, -999], -1, 1, 256);
  assert.equal(clamped.length, 2);
  assert.equal(clamped[0], 255);
  assert.equal(clamped[1], 0);
  assert.equal(warnings.length, 1, 'expected one clamp warning');
  assert.ok(
    warnings[0].includes('Quantization clamped'),
    'expected clamp warning to mention clamping'
  );

  quantizeEmbeddingVectorUint8([999, -999], -1, 1, 256);
  assert.equal(warnings.length, 1, 'expected clamp warning to be emitted once');
} finally {
  console.warn = originalWarn;
}

console.log('quantization clamp warning test passed');
