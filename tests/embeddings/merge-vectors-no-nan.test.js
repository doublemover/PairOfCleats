#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mergeEmbeddingVectors } from '../../src/shared/embedding-utils.js';

const merged = mergeEmbeddingVectors({
  codeVector: [1, undefined, NaN, Infinity],
  docVector: [undefined, 2, 3, 4]
});

assert.equal(merged.length, 4);
for (const value of merged) {
  assert.equal(Number.isFinite(value), true, 'merged vector should not contain NaN');
}

console.log('embedding merge vector no NaN ok');
