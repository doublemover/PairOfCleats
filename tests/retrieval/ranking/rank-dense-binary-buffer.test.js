#!/usr/bin/env node
import assert from 'node:assert/strict';
import { rankDenseVectors } from '../../../src/retrieval/rankers.js';

const dims = 2;
const scale = 2 / 255;
const minVal = -1;
const buffer = new Uint8Array([
  255, 128, // doc 0 -> approx [1, 0]
  128, 255  // doc 1 -> approx [0, 1]
]);

const idx = {
  denseVec: {
    dims,
    scale,
    minVal,
    maxVal: 1,
    levels: 256,
    buffer
  }
};

const results = rankDenseVectors(idx, [1, 0], 2, null);
assert.equal(results.length, 2, 'expected dense ranking results');
assert.equal(results[0].idx, 0, 'expected first vector to rank highest');

console.log('rank dense binary buffer test passed');
