#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mergeEmbeddingVectors } from '../src/shared/embedding-utils.js';

const codeOnly = mergeEmbeddingVectors({ codeVector: new Float32Array([2, 4]), docVector: null });
assert.deepEqual(Array.from(codeOnly), [2, 4], 'code-only merge should preserve values');

const docOnly = mergeEmbeddingVectors({ codeVector: null, docVector: new Float32Array([3, 5]) });
assert.deepEqual(Array.from(docOnly), [3, 5], 'doc-only merge should preserve values');

const merged = mergeEmbeddingVectors({
  codeVector: [1, undefined, 3],
  docVector: [1, 1, undefined]
});
assert.ok(merged.every((v) => Number.isFinite(v)), 'merged vector should not contain NaN');

assert.throws(
  () => mergeEmbeddingVectors({ codeVector: [1, 2], docVector: [1] }),
  /dims mismatch/,
  'mismatched dims should throw'
);

console.log('embedding merge vectors semantics test passed');
