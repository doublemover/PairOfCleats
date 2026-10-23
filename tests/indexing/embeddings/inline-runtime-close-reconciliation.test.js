import assert from 'node:assert/strict';
import { resolveEmbeddingRuntime } from '../../../src/index/build/runtime/embeddings.js';
import { __setAdapterFactoryForTests, disposeEmbeddingAdapterCaches } from '../../../src/shared/embedding-adapter.js';
import { getInlineEmbeddingBatcher } from '../../../src/shared/embedding-inline-batcher.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
let disposeCalls = 0, batcherCloseCalls = 0;
let enter, release;
const entered = new Promise(resolve => { enter = resolve; });
const gate = new Promise(resolve => { release = resolve; });
const batcherFailure = new Error('original batcher cleanup failed');
const disposeFailure = new Error('original native disposal failed');
__setAdapterFactoryForTests(() => ({ provider: 'xenova', embedderPromise: null,
  embedOne: async () => { enter(); await gate; return new Float32Array(8).fill(1); },
  dispose: async () => { disposeCalls++; if (disposeCalls === 1) throw disposeFailure; } }));
const contains = (error, target, seen = new Set()) => {
  if (error === target) return true;
  if (!error || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error);
  return contains(error.cause, target, seen) || (error.errors || []).some(child => contains(child, target, seen));
};
try {
  const runtime = await resolveEmbeddingRuntime({ rootDir: process.cwd(), userConfig: {},
    indexingConfig: { embeddings: { mode: 'stub' } }, envConfig: {}, argv: { dims: 8 }, cpuConcurrency: 1 });
  const batcher = getInlineEmbeddingBatcher(runtime.getChunkEmbeddings);
  const originalClose = batcher.close;
  batcher.close = async () => { batcherCloseCalls++; if (batcherCloseCalls === 1) throw batcherFailure; return originalClose(); };
  const work = runtime.getChunkEmbedding('held original inference');
  await entered;
  const firstClose = runtime.closeEmbeddingRuntime();
  assert.equal(runtime.closeEmbeddingRuntime(), firstClose, 'concurrent closes join the same original attempt');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(disposeCalls, 0, 'failed batcher close cannot authorize disposal before inference settles');
  release();
  await work;
  await assert.rejects(firstClose, error => {
    assert.equal(contains(error, batcherFailure), true);
    assert.equal(contains(error, disposeFailure), true);
    return true;
  });
  assert.equal(disposeCalls, 1, 'independent embedder cleanup still runs after the batcher failure');
  await assert.rejects(runtime.getChunkEmbedding('late admission'), { code: 'ERR_EMBEDDING_RUNTIME_CLOSED' });
  await runtime.closeEmbeddingRuntime();
  assert.equal(disposeCalls, 2, 'a later explicit close retries the original failed lease');
  assert.equal(batcherCloseCalls, 2);
  await runtime.closeEmbeddingRuntime();
  assert.equal(disposeCalls, 2, 'confirmed cleanup is never repeated');
  assert.equal(batcherCloseCalls, 2);
  const pendingRuntime = await resolveEmbeddingRuntime({ rootDir: process.cwd(), userConfig: {},
    indexingConfig: { embeddings: { mode: 'stub' } }, envConfig: {}, argv: { dims: 8 }, cpuConcurrency: 1 });
  await pendingRuntime.getChunkEmbedding('pending child close evidence');
  const pendingBatcher = getInlineEmbeddingBatcher(pendingRuntime.getChunkEmbeddings);
  const pendingOriginalClose = pendingBatcher.close;
  let pendingCloseCalls = 0, childSettled = false;
  const childFailure = Object.assign(new Error('original batcher child has not settled'), {
    cacheOwnershipPending: true, cacheOwnershipReleased() { return childSettled; }
  });
  pendingBatcher.close = async () => {
    pendingCloseCalls++;
    if (pendingCloseCalls === 1) throw childFailure;
    return pendingOriginalClose();
  };
  await assert.rejects(pendingRuntime.closeEmbeddingRuntime(), error => error === childFailure);
  const confirmedDisposals = disposeCalls;
  await assert.rejects(pendingRuntime.closeEmbeddingRuntime(), error => error === childFailure);
  assert.equal(disposeCalls, confirmedDisposals, 'pending child observation does not repeat confirmed lease release');
  childSettled = true;
  await pendingRuntime.closeEmbeddingRuntime();
  assert.equal(pendingCloseCalls, 2, 'once-confirmed batcher close is not replayed to poll its original child');
  assert.equal(disposeCalls, confirmedDisposals);
  await disposeEmbeddingAdapterCaches();
} finally { release(); __setAdapterFactoryForTests(null); }
console.log('inline runtime closes preserve independent failures and reconcile original lease disposal');
