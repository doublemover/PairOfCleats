#!/usr/bin/env node
import assert from 'node:assert/strict';

import { createEmbedder } from '../../../src/index/embedding.js';
import { getQueryEmbedding } from '../../../src/retrieval/embedding.js';
import {
  BGE_QUERY_PREFIX,
  E5_PASSAGE_PREFIX,
  E5_QUERY_PREFIX,
  formatEmbeddingInput,
  resolveEmbeddingInputFormatting
} from '../../../src/shared/embedding-input-format.js';
import { stubEmbedding } from '../../../src/shared/embedding.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1', embeddings: null });

const dims = 16;
const sampleText = 'find parser fallback logic';

const vectorsClose = (left, right, tolerance = 1e-9) => {
  assert.equal(left.length, right.length, 'vector length mismatch');
  for (let i = 0; i < left.length; i += 1) {
    const delta = Math.abs(Number(left[i]) - Number(right[i]));
    if (delta > tolerance) {
      throw new Error(`vector mismatch at index ${i}: ${left[i]} vs ${right[i]} (delta=${delta})`);
    }
  }
};

const e5Formatting = resolveEmbeddingInputFormatting('Xenova/e5-base-v2');
assert.equal(e5Formatting.family, 'e5', 'expected e5 formatting family');
assert.equal(e5Formatting.queryPrefix, E5_QUERY_PREFIX, 'expected e5 query prefix');
assert.equal(e5Formatting.passagePrefix, E5_PASSAGE_PREFIX, 'expected e5 passage prefix');

const bgeFormatting = resolveEmbeddingInputFormatting('Xenova/bge-base-en-v1.5');
assert.equal(bgeFormatting.family, 'bge', 'expected bge formatting family');
assert.equal(bgeFormatting.queryPrefix, BGE_QUERY_PREFIX, 'expected bge query instruction prefix');
assert.equal(bgeFormatting.passagePrefix, null, 'expected bge passage prefix disabled');

const alreadyPrefixed = formatEmbeddingInput('query: alpha', {
  modelId: 'Xenova/e5-base-v2',
  kind: 'query'
});
assert.equal(alreadyPrefixed, 'query: alpha', 'expected query prefix to be idempotent');

const e5Embedder = createEmbedder({
  rootDir: process.cwd(),
  useStubEmbeddings: true,
  modelId: 'Xenova/e5-base-v2',
  dims,
  modelsDir: null,
  provider: 'xenova',
  onnx: null,
  normalize: true
});
const e5Chunk = await e5Embedder.getChunkEmbedding(sampleText);
vectorsClose(
  e5Chunk,
  stubEmbedding(`${E5_PASSAGE_PREFIX}${sampleText}`, dims, true)
);

const bgeEmbedder = createEmbedder({
  rootDir: process.cwd(),
  useStubEmbeddings: true,
  modelId: 'Xenova/bge-base-en-v1.5',
  dims,
  modelsDir: null,
  provider: 'xenova',
  onnx: null,
  normalize: true
});
const bgeChunk = await bgeEmbedder.getChunkEmbedding(sampleText);
vectorsClose(
  bgeChunk,
  stubEmbedding(sampleText, dims, true)
);

const e5QueryVec = await getQueryEmbedding({
  text: sampleText,
  modelId: 'Xenova/e5-base-v2',
  dims,
  modelDir: null,
  useStub: true,
  provider: 'xenova',
  onnxConfig: null,
  rootDir: process.cwd(),
  normalize: true
});
vectorsClose(
  e5QueryVec,
  stubEmbedding(`${E5_QUERY_PREFIX}${sampleText}`, dims, true)
);

const bgeQueryVec = await getQueryEmbedding({
  text: sampleText,
  modelId: 'Xenova/bge-base-en-v1.5',
  dims,
  modelDir: null,
  useStub: true,
  provider: 'xenova',
  onnxConfig: null,
  rootDir: process.cwd(),
  normalize: true
});
vectorsClose(
  bgeQueryVec,
  stubEmbedding(`${BGE_QUERY_PREFIX}${sampleText}`, dims, true)
);

console.log('model-aware input formatting test passed');
