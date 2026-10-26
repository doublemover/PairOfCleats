import assert from 'node:assert/strict';
import { resolveEmbeddingRuntime } from '../../../src/index/build/runtime/embeddings.js';
import { __setAdapterFactoryForTests, disposeEmbeddingAdapterCaches } from '../../../src/shared/embedding-adapter.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
let disposed = 0, created = 0;
let enter, release;
let behavior = 'success';
const initializationFailure = new Error('controlled adapter initialization failure');
const gate = new Promise(resolve => { release = resolve; });
const entered = new Promise(resolve => { enter = resolve; });
__setAdapterFactoryForTests(() => {
  if (behavior === 'initialization-failure') throw initializationFailure;
  created += 1;
  return {
    provider: 'xenova', embedderPromise: null,
    embedOne: async () => {
      if (behavior === 'held') { enter(); await gate; }
      if (behavior === 'failure') throw new Error('controlled inference failure');
      if (behavior === 'cancelled') throw Object.assign(new Error('controlled cancellation'), { name: 'AbortError' });
      return new Float32Array(8).fill(1);
    },
    dispose: async () => { disposed += 1; }
  };
});
const resolve = () => resolveEmbeddingRuntime({ rootDir: process.cwd(), userConfig: {},
  indexingConfig: { embeddings: { mode: 'stub' } }, envConfig: {}, argv: { dims: 8 }, cpuConcurrency: 1 });
try {
  const unused = await resolve();
  await unused.closeEmbeddingRuntime();
  assert.equal(created, 0, 'closing unused runtime cannot initialize the model');
  for (behavior of ['success', 'failure', 'cancelled']) {
    const runtime = await resolve();
    if (behavior === 'success') await runtime.getChunkEmbedding('fixture');
    else await assert.rejects(runtime.getChunkEmbedding('fixture'));
    const before = disposed;
    await runtime.closeEmbeddingRuntime();
    await runtime.closeEmbeddingRuntime();
    assert.equal(disposed, before + 1, `${behavior} releases its lease exactly once`);
    await assert.rejects(runtime.getChunkEmbedding('late'), { code: 'ERR_EMBEDDING_RUNTIME_CLOSED' });
  }
  behavior = 'held';
  const runtime = await resolve();
  const pending = runtime.getChunkEmbedding('held fixture');
  await entered;
  const before = disposed;
  const closing = runtime.closeEmbeddingRuntime();
  await Promise.resolve();
  assert.equal(disposed, before);
  release();
  await pending;
  await closing;
  assert.equal(disposed, before + 1);
  behavior = 'success';
  const siblingOne = await resolve(), siblingTwo = await resolve();
  const createdBefore = created, disposedBefore = disposed;
  await siblingOne.getChunkEmbedding('first runtime lease');
  await siblingTwo.getChunkEmbedding('second runtime lease');
  assert.equal(created, createdBefore + 1, 'compatible attempts share an actual adapter with independent leases');
  await siblingOne.closeEmbeddingRuntime();
  assert.equal(disposed, disposedBefore, 'closing one attempt cannot destroy its sibling adapter');
  await siblingTwo.getChunkEmbedding('sibling still usable');
  await siblingTwo.closeEmbeddingRuntime();
  assert.equal(disposed, disposedBefore + 1);
  behavior = 'initialization-failure';
  const failed = await resolve();
  const beforeFailure = { created, disposed };
  await assert.rejects(failed.getChunkEmbedding('factory failure'), error => error === initializationFailure
    || error.cause === initializationFailure || error.errors?.includes(initializationFailure));
  await failed.closeEmbeddingRuntime();
  await failed.closeEmbeddingRuntime();
  assert.deepEqual({ created, disposed }, beforeFailure, 'failed acquisition cannot invent an adapter or leak a lease');
  await disposeEmbeddingAdapterCaches();
} finally { release(); __setAdapterFactoryForTests(null); }
console.log('inline runtime lease close test passed');
