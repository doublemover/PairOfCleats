#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  __resetEmbeddingAdapterCachesForTests,
  __setTransformersModuleLoaderForTests,
  getEmbeddingAdapter
} from '../../../src/shared/embedding-adapter.js';

let loaderCalls = 0;
__setTransformersModuleLoaderForTests(async () => {
  loaderCalls += 1;
  if (loaderCalls === 1) {
    throw new Error('transient loader failure');
  }
  return {
    env: {},
    pipeline: async () => async (texts) => texts.map(() => new Float32Array([1, 0, 0]))
  };
});

const adapter = getEmbeddingAdapter({
  provider: 'xenova',
  modelId: 'stub-model',
  modelsDir: null,
  rootDir: process.cwd(),
  useStub: false,
  normalize: true
});

let firstError = null;
try {
  await adapter.embedOne('alpha');
} catch (err) {
  firstError = err;
}
assert.ok(firstError, 'expected first provider init to fail');

const second = await adapter.embedOne('alpha');
assert.ok(second instanceof Float32Array, 'expected retry to produce embedding output');
assert.equal(second.length, 3, 'expected stable vector dimensions after retry');
assert.equal(loaderCalls, 2, 'expected failed initialization to be retried');

__resetEmbeddingAdapterCachesForTests();
__setTransformersModuleLoaderForTests(null);

console.log('provider init retry contract test passed');
