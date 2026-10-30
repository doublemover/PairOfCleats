import assert from 'node:assert/strict';
import { resolveEmbeddingRuntime } from '../../../src/index/build/runtime/embeddings.js';
import { __setAdapterFactoryForTests, disposeEmbeddingAdapterCaches } from '../../../src/shared/embedding-adapter.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const contains = (error, target, seen = new Set()) => {
  if (error === target) return true;
  if (!error || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error);
  return (Object.hasOwn(error, 'cause') && contains(error.cause, target, seen))
    || (error.errors || []).some(child => contains(child, target, seen));
};
let nativeSettled = false, notificationSettled = false, inferenceCalls = 0, disposeCalls = 0;
const nativeFailure = Object.assign(new Error('original inference still owns native work'), {
  cacheOwnershipPending: true, cacheOwnershipReleased() { return nativeSettled; }
});
const notificationFailure = Object.assign(new Error('original notification still owns independent work'), {
  cacheOwnershipPending: true, cacheOwnershipReleased() { return notificationSettled; }
});
__setAdapterFactoryForTests(() => ({ provider: 'xenova', embedderPromise: null,
  embedOne: async () => { inferenceCalls++; throw nativeFailure; },
  dispose: async () => { disposeCalls++; } }));
const runtimes = [];
const makeRuntime = async onEmbeddingObservation => {
  const runtime = await resolveEmbeddingRuntime({ rootDir: process.cwd(), userConfig: {},
    indexingConfig: { embeddings: { mode: 'stub' } }, envConfig: {}, argv: { dims: 8 }, cpuConcurrency: 1,
    onEmbeddingObservation });
  runtimes.push(runtime);
  return runtime;
};
try {
  const runtime = await makeRuntime(async ({ observation }) => {
    if (observation.state === 'failed') throw notificationFailure;
  });
  let operation;
  await assert.rejects(runtime.getChunkEmbedding('failure before runtime teardown'), error => {
    operation = error;
    assert.equal(contains(error, nativeFailure), true);
    assert.equal(contains(error, notificationFailure), true, 'notification failure cannot replace the original native rejection');
    return true;
  });
  let retainedClose;
  await assert.rejects(runtime.closeEmbeddingRuntime(), error => {
    retainedClose = error;
    assert.equal(error.cacheOwnershipReleased(), false);
    assert.equal(typeof error.closeEmbeddingRuntime, 'function');
    return contains(error, nativeFailure) && contains(error, notificationFailure);
  });
  assert.equal(disposeCalls, 0, 'rejected promises leaving the active set cannot release their original parent lease');
  nativeFailure.cacheOwnershipPending = false;
  nativeFailure.cacheOwnershipReleased = () => true;
  notificationFailure.cacheOwnershipPending = false;
  notificationFailure.cacheOwnershipReleased = () => true;
  await assert.rejects(retainedClose.closeEmbeddingRuntime());
  assert.equal(disposeCalls, 0, 'replacement markers/observers cannot authorize parent disposal');
  nativeSettled = true;
  await assert.rejects(runtime.closeEmbeddingRuntime());
  assert.equal(disposeCalls, 0, 'the notification owns an independent prerequisite');
  notificationSettled = true;
  await retainedClose.closeEmbeddingRuntime();
  assert.equal(disposeCalls, 1);
  assert.equal(retainedClose.cacheOwnershipReleased(), true);
  assert.equal(operation.cacheOwnershipReleased(), true);
  assert.equal(inferenceCalls, 1, 'explicit close never reruns inference');

  __setAdapterFactoryForTests(() => ({ provider: 'xenova', embedderPromise: null,
    embedOne: async () => { throw undefined; }, dispose: async () => { disposeCalls++; } }));
  const falsey = await makeRuntime(async ({ observation }) => { if (observation.state === 'failed') throw false; });
  await assert.rejects(falsey.getChunkEmbedding('falsey failure composition'), error => {
    assert.equal(contains(error, undefined), true);
    assert.equal(contains(error, false), true);
    return true;
  });
  await falsey.closeEmbeddingRuntime();
  const disabled = await resolveEmbeddingRuntime({ rootDir: process.cwd(), userConfig: {},
    indexingConfig: { embeddings: { mode: 'off' } }, envConfig: {}, argv: {}, cpuConcurrency: 1 });
  runtimes.push(disabled);
  await disabled.closeEmbeddingRuntime();
  await assert.rejects(disabled.getChunkEmbedding('late disabled admission'), { code: 'ERR_EMBEDDING_RUNTIME_CLOSED' });
  await assert.rejects(disabled.getChunkEmbeddings([]), { code: 'ERR_EMBEDDING_RUNTIME_CLOSED' });
} finally {
  nativeSettled = true; notificationSettled = true;
  await Promise.allSettled(runtimes.map(runtime => runtime.closeEmbeddingRuntime()));
  await disposeEmbeddingAdapterCaches();
  __setAdapterFactoryForTests(null);
}
console.log('inline close retains original rejected inference and independent notification ownership');
