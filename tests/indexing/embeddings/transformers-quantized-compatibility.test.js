#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import {
  __setTransformersModuleLoaderForTests,
  getEmbeddingAdapter
} from '../../../src/shared/embedding-adapter.js';

ensureTestingEnv(process.env);

const pipelineCalls = [];
const embeddingCalls = [];
const env = {};
const modelId = 'Xenova/all-MiniLM-L12-v2';
const { dir: modelsDir } = await prepareIsolatedTestCacheDir('transformers-quantized-compatibility');
await fs.mkdir(path.join(modelsDir, modelId, 'onnx'), { recursive: true });
await fs.writeFile(path.join(modelsDir, modelId, 'onnx/model_quantized.onnx'), 'controlled local model bytes');
await fs.writeFile(path.join(modelsDir, modelId, 'tokenizer.json'), '{}');
const leases = [];
let disposals = 0;
const embedder = async (texts, options) => {
  embeddingCalls.push({ texts, options });
  return { data: Float32Array.from(texts.flatMap(() => [0.6, 0.8])), dims: [texts.length, 2] };
};
embedder.dispose = async () => { disposals++; };
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
  leases.push(adapter);
  const vectors = await adapter.embed(['first', 'second']);
  assert.equal(adapter.provider, 'xenova', 'persisted provider identity must remain compatible');
  assert.equal(env.cacheDir, undefined, 'the selected cache is passed per acquisition without mutating Transformers global state');
  assert.deepEqual(pipelineCalls, [
    ['feature-extraction', modelId, { dtype: 'q8', cache_dir: modelsDir }]
  ], 'Node must load the existing model_quantized.onnx weights, not its fp32 default');
  assert.deepEqual(embeddingCalls, [{
    texts: ['first', 'second'], options: { pooling: 'mean', normalize: true }
  }], 'pooling and normalization must survive the Transformers.js migration');
  assert.deepEqual(vectors, [Float32Array.from([0.6, 0.8]), Float32Array.from([0.6, 0.8])]);
  const second = getEmbeddingAdapter(options);
  leases.push(second);
  assert.notEqual(second, adapter, 'each caller owns an independent lease over the cached adapter');
  await second.embedOne('third');
  await adapter.dispose();
  assert.equal(pipelineCalls.length, 1, 'the cached pipeline must be reused');
  assert.equal(disposals, 0, 'disposing a lease retains the pipeline owned by another caller');
  await second.dispose();
  assert.equal(disposals, 1);
} finally {
  await Promise.allSettled(leases.map(lease => lease.dispose()));
  __setTransformersModuleLoaderForTests(null);
  await fs.rm(modelsDir, { recursive: true, force: true });
}

console.log('Transformers quantized model compatibility test passed');
