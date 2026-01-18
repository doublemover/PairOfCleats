#!/usr/bin/env node
import assert from 'node:assert/strict';
import { rankDenseVectors } from '../../src/retrieval/rankers.js';

const idx = {
  denseVec: {
    dims: 2,
    scale: 1,
    vectors: [new Uint8Array([2, 2])]
  }
};

const query = [1, 2, 3];
let warnings = 0;
const originalWarn = console.warn;
console.warn = () => {
  warnings += 1;
};

try {
  const hitsA = rankDenseVectors(idx, query, 1, null);
  const hitsB = rankDenseVectors(idx, query, 1, null);
  assert.equal(hitsA.length, 1);
  assert.equal(hitsB.length, 1);
  assert.ok(Math.abs(hitsA[0].sim - 3) < 1e-9, 'expected dot product using truncated dims');
  assert.equal(warnings, 1, 'expected mismatch warning to log once');
} finally {
  console.warn = originalWarn;
}

console.log('dense dims mismatch test passed');
