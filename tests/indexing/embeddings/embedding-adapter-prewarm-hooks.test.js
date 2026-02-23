#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  __resetEmbeddingAdapterCachesForTests,
  __setAdapterFactoryForTests,
  warmEmbeddingAdapter
} from '../../../src/shared/embedding-adapter.js';

let prewarmCalls = [];

__setAdapterFactoryForTests(() => ({
  embed: async () => [],
  embedOne: async () => new Float32Array(0),
  embedderPromise: Promise.resolve({ ok: true }),
  provider: 'onnx',
  supportsParallelDispatch: true,
  prewarm: async (options) => {
    prewarmCalls.push(options);
  }
}));

await warmEmbeddingAdapter({
  provider: 'onnx',
  modelId: 'test-model',
  prewarmTokenizer: true,
  prewarmModel: true,
  prewarmTexts: ['hello', 'hello', 'world']
});

assert.equal(prewarmCalls.length, 1, 'expected prewarm hook to be invoked once');
assert.deepEqual(
  prewarmCalls[0],
  {
    tokenizer: true,
    model: true,
    texts: ['hello', 'world']
  },
  'expected warmEmbeddingAdapter to forward normalized prewarm options'
);

prewarmCalls = [];
await warmEmbeddingAdapter({
  provider: 'onnx',
  modelId: 'test-model',
  preloadModel: false
});
assert.equal(prewarmCalls.length, 0, 'expected no prewarm call when hooks are not requested');

__setAdapterFactoryForTests(null);
__resetEmbeddingAdapterCachesForTests();
console.log('embedding adapter prewarm hooks test passed');
