#!/usr/bin/env node
import assert from 'node:assert/strict';

import { normalizeEmbeddingProvider } from '../src/shared/onnx-embeddings.js';

assert.equal(normalizeEmbeddingProvider(undefined), 'xenova');
assert.equal(normalizeEmbeddingProvider('  '), 'xenova');
assert.equal(normalizeEmbeddingProvider('TRANSFORMERS'), 'xenova');
assert.equal(normalizeEmbeddingProvider('onnxruntime-node'), 'onnx');
assert.equal(normalizeEmbeddingProvider('xenova'), 'xenova');

assert.throws(
  () => normalizeEmbeddingProvider('provider-a'),
  /Unknown embedding provider/i,
  'expected unknown provider to throw rather than silently falling back'
);

console.log('embedding provider strict validation test passed');
