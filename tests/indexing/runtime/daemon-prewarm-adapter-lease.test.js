import assert from 'node:assert/strict';
import { __setAdapterFactoryForTests, getEmbeddingAdapter, warmEmbeddingAdapter,
  disposeEmbeddingAdapterCaches } from '../../../src/shared/embedding-adapter.js';
import { acquireRuntimeDaemonSession, addDaemonEmbeddingWarmKey, closeRuntimeDaemonSession,
  disposeRuntimeDaemonSessions, drainDaemonEmbeddingLeases, hasDaemonEmbeddingWarmKey,
  createRuntimeDaemonJobContext, probeRuntimeDaemonSessionHealth } from '../../../src/index/build/runtime/daemon-session.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const selection = { provider: 'xenova', modelId: 'recording-daemon-prewarm', useStub: true, dims: 8,
  prewarmTokenizer: true, throwOnError: true };
let created = 0, disposed = 0, prewarmed = 0, failPrewarm = false, query;
const prewarmFailure = new Error('original daemon prewarm failure');
__setAdapterFactoryForTests(() => {
  created++;
  return { provider: 'xenova', embedderPromise: Promise.resolve(null),
    embedOne: async () => new Float32Array(8).fill(1),
    prewarm: async () => { prewarmed++; if (failPrewarm) throw prewarmFailure; },
    dispose: async () => { disposed++; } };
});
try {
  const session = acquireRuntimeDaemonSession({ enabled: true, sessionKey: 'actual-adapter-prewarm-owner' });
  const first = await warmEmbeddingAdapter(selection);
  addDaemonEmbeddingWarmKey(session, 'warm', first);
  query = getEmbeddingAdapter(selection);
  const second = await warmEmbeddingAdapter(selection);
  addDaemonEmbeddingWarmKey(session, 'warm', second);
  await drainDaemonEmbeddingLeases(session);
  assert.equal(hasDaemonEmbeddingWarmKey(session, 'warm'), true);
  assert.equal(created, 1, 'prewarm, reuse and query share one real lease-cache entry');
  assert.equal(prewarmed, 2);
  assert.equal(disposed, 0, 'retiring a replaced daemon lease cannot destroy the query or replacement');
  await closeRuntimeDaemonSession(session);
  await closeRuntimeDaemonSession(session);
  assert.equal(disposed, 0, 'daemon shutdown releases only daemon-owned leases');
  assert.deepEqual(await query.embedOne('query remains live'), new Float32Array(8).fill(1));
  await query.dispose(); query = null;
  assert.equal(disposed, 1, 'the final independent lease authorizes exactly one adapter disposal');

  const failedSession = acquireRuntimeDaemonSession({ enabled: true, sessionKey: 'failed-adapter-prewarm-owner' });
  failPrewarm = true;
  await assert.rejects(warmEmbeddingAdapter(selection), error => error === prewarmFailure);
  assert.equal(created, 2); assert.equal(disposed, 2, 'failed prewarm joins its acquisition cleanup');
  assert.equal(hasDaemonEmbeddingWarmKey(failedSession, 'warm'), false);
  assert.equal(failedSession.embeddingWarmLeases.size, 0, 'failed warmup cannot invent retained readiness');
  await closeRuntimeDaemonSession(failedSession);
  failPrewarm = false;
  const bounded = acquireRuntimeDaemonSession({ enabled: true, sessionKey: 'bounded-adapter-owner',
    health: { maxEmbeddingWarmEntries: 2, maxJobsBeforeRecycle: 2 } });
  const beforeCreated = created, beforeDisposed = disposed;
  for (const key of ['first', 'second', 'third']) {
    const lease = await warmEmbeddingAdapter({ ...selection, modelId: `bounded-${key}` });
    addDaemonEmbeddingWarmKey(bounded, key, lease);
  }
  await drainDaemonEmbeddingLeases(bounded);
  assert.equal(created, beforeCreated + 3); assert.equal(disposed, beforeDisposed + 1);
  assert.equal(hasDaemonEmbeddingWarmKey(bounded, 'first'), false);
  assert.equal(bounded.embeddingWarmLeases.size, 2, 'bounded LRU eviction joins its exact adapter lease');
  query = getEmbeddingAdapter({ ...selection, modelId: 'bounded-third' });
  createRuntimeDaemonJobContext(bounded); createRuntimeDaemonJobContext(bounded);
  const recycle = probeRuntimeDaemonSessionHealth(bounded, { force: true });
  assert.equal(recycle.recycled, true); assert.deepEqual(recycle.reasons, ['jobs>2']);
  await drainDaemonEmbeddingLeases(bounded);
  assert.equal(bounded.embeddingWarmLeases.size, 0);
  assert.equal(disposed, beforeDisposed + 2, 'generation recycling releases each daemon owner while preserving the query sibling');
  assert.deepEqual(await query.embedOne('query after generation recycle'), new Float32Array(8).fill(1));
  await closeRuntimeDaemonSession(bounded);
  await query.dispose(); query = null;
  assert.equal(disposed, beforeDisposed + 3);
  await disposeEmbeddingAdapterCaches();
} finally {
  await query?.dispose();
  await disposeRuntimeDaemonSessions();
  await disposeEmbeddingAdapterCaches();
  __setAdapterFactoryForTests(null);
}
console.log('Actual prewarm adapter leases retain daemon/query ownership through replacement and shutdown');
