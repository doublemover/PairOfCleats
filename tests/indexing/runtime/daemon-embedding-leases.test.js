import assert from 'node:assert/strict';
import { acquireRuntimeDaemonSession, addDaemonEmbeddingWarmKey, closeRuntimeDaemonSession, createRuntimeDaemonJobContext, disposeRuntimeDaemonSessions, drainDaemonEmbeddingLeases, hasDaemonEmbeddingWarmKey } from '../../../src/index/build/runtime/daemon-session.js';

let disposed = 0;
const lease = () => ({ dispose: async () => { disposed += 1; } });
const session = acquireRuntimeDaemonSession({ enabled: true, sessionKey: 'recording-embedding-leases',
  health: { maxEmbeddingWarmEntries: 1, maxJobsBeforeRecycle: 1 } });
try {
  addDaemonEmbeddingWarmKey(session, 'one', lease());
  assert.equal(hasDaemonEmbeddingWarmKey(session, 'one'), true);
  addDaemonEmbeddingWarmKey(session, 'two', lease());
  await drainDaemonEmbeddingLeases(session);
  assert.equal(disposed, 1, 'capacity eviction releases the removed lease');
  assert.equal(hasDaemonEmbeddingWarmKey(session, 'one'), false);
  assert.equal(session.embeddingWarmLeases.size, 1);
  createRuntimeDaemonJobContext(session);
  createRuntimeDaemonJobContext(session);
  await drainDaemonEmbeddingLeases(session);
  assert.equal(disposed, 2, 'recycling releases the current warm generation');
  assert.equal(session.embeddingWarmLeases.size, 0);
  addDaemonEmbeddingWarmKey(session, 'three', lease());
  await closeRuntimeDaemonSession(session);
  await closeRuntimeDaemonSession(session);
  assert.equal(disposed, 3, 'shutdown releases exactly once');
  for (let index = 0; index < 10; index++) {
    const next = acquireRuntimeDaemonSession({ enabled: true, sessionKey: `recording-embedding-eviction-${index}` });
    addDaemonEmbeddingWarmKey(next, 'warm', lease());
  }
  await disposeRuntimeDaemonSessions();
  assert.equal(disposed, 13, 'global eviction and shutdown retain deterministic lease owners');
} finally { await disposeRuntimeDaemonSessions(); }
console.log('daemon embedding leases test passed');
