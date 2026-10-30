#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  __setAdapterFactoryForTests,
  disposeEmbeddingAdapterCaches,
  getEmbeddingAdapter,
  warmEmbeddingAdapter
} from '../../../src/shared/embedding-adapter.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
let prewarmCalls = [];
let disposed = 0, created = 0, failPrewarm = false;
const failure = new Error('original prewarm failure');
const selection = { provider: 'onnx', modelId: 'test-model', useStub: true, dims: 8 };

__setAdapterFactoryForTests(() => {
  created++;
  return {
    embed: async () => [],
    embedOne: async () => new Float32Array(8).fill(1),
    embedderPromise: Promise.resolve({ ok: true }),
    provider: 'onnx',
    supportsParallelDispatch: true,
    prewarm: async (options) => {
      prewarmCalls.push(options);
      if (failPrewarm) throw failure;
    },
    dispose: async () => { disposed++; }
  };
});

let warmLease, skippedLease, sibling;
try {
  warmLease = await warmEmbeddingAdapter({
    ...selection,
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
  skippedLease = await warmEmbeddingAdapter({
    ...selection,
    preloadModel: false
  });
  assert.equal(prewarmCalls.length, 0, 'expected no prewarm call when hooks are not requested');
  assert.equal(created, 1, 'prewarm reuse retains the same adapter through independent leases');
  await warmLease.dispose(); warmLease = null;
  assert.equal(disposed, 0, 'returning one warm lease preserves the other');
  await skippedLease.dispose(); skippedLease = null;
  assert.equal(disposed, 1, 'returning the final lease disposes exactly once');

  // A failed prewarm returns only its own lease, preserving a sibling query lease.
  sibling = getEmbeddingAdapter(selection);
  failPrewarm = true;
  await assert.rejects(warmEmbeddingAdapter({ ...selection, prewarmTokenizer: true, throwOnError: true }), error => error === failure);
  assert.equal(disposed, 1);
  assert.deepEqual(await sibling.embedOne('still admitted'), new Float32Array(8).fill(1));
  await sibling.dispose(); sibling = null;
  assert.equal(disposed, 2);
  await disposeEmbeddingAdapterCaches();

} finally {
  await warmLease?.dispose(); await skippedLease?.dispose(); await sibling?.dispose();
  await disposeEmbeddingAdapterCaches();
  __setAdapterFactoryForTests(null);
}
console.log('embedding adapter prewarm hooks test passed');
