#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import {
  __setTransformersModuleLoaderForTests,
  getEmbeddingAdapter
} from '../../../src/shared/embedding-adapter.js';

ensureTestingEnv(process.env);

const pipelineCalls = [];
const embeddingCalls = [];
const env = {};
const modelId = 'Xenova/all-MiniLM-L12-v2';
const modelsDir = '/model-cache';
const embedder = async (texts, options) => {
  embeddingCalls.push({ texts, options });
  return { data: Float32Array.from(texts.flatMap(() => [0.6, 0.8])), dims: [texts.length, 2] };
};
__setTransformersModuleLoaderForTests(async () => ({
  env,
  pipeline: async (...args) => {
    pipelineCalls.push(args);
    return embedder;
  }
}));

try {
  const options = { provider: 'xenova', modelId, modelsDir, normalize: true };
  const adapter = getEmbeddingAdapter(options);
  const vectors = await adapter.embed(['first', 'second']);
  assert.equal(adapter.provider, 'xenova', 'persisted provider identity must remain compatible');
  assert.equal(env.cacheDir, modelsDir, 'existing model cache must be retained');
  assert.deepEqual(pipelineCalls, [
    ['feature-extraction', modelId, { dtype: 'q8' }]
  ], 'Node must load the existing model_quantized.onnx weights, not its fp32 default');
  assert.deepEqual(embeddingCalls, [{
    texts: ['first', 'second'], options: { pooling: 'mean', normalize: true }
  }], 'pooling and normalization must survive the Transformers.js migration');
  assert.deepEqual(vectors, [Float32Array.from([0.6, 0.8]), Float32Array.from([0.6, 0.8])]);
  assert.equal(getEmbeddingAdapter(options), adapter, 'adapter cache identity must remain stable');
  await adapter.embedOne('third');
  assert.equal(pipelineCalls.length, 1, 'the cached pipeline must be reused');
} finally {
  __setTransformersModuleLoaderForTests(null);
}

console.log('Transformers quantized model compatibility test passed');
