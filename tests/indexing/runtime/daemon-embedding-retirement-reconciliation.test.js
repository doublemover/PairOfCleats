import assert from 'node:assert/strict';
import { acquireRuntimeDaemonSession, addDaemonEmbeddingWarmKey, closeRuntimeDaemonSession,
  disposeRuntimeDaemonSessions, drainDaemonEmbeddingLeases, hasDaemonEmbeddingWarmKey,
  removeDaemonEmbeddingWarmKey } from '../../../src/index/build/runtime/daemon-session.js';

const session = acquireRuntimeDaemonSession({ enabled: true, sessionKey: 'original-retirement-reconciliation' });
let oldCalls = 0, replacementCalls = 0, siblingCalls = 0;
let allowOldClose = false;
const originalFailure = new Error('original warm lease failed to close');
const old = { dispose: async () => { oldCalls++; if (!allowOldClose) throw originalFailure; } };
const sibling = { dispose: async () => { siblingCalls++; } };
try {
  addDaemonEmbeddingWarmKey(session, 'same-key', old);
  addDaemonEmbeddingWarmKey(session, 'same-key', sibling);
  for (let index = 0; index < 2; index++) {
    await assert.rejects(drainDaemonEmbeddingLeases(session), error => {
      assert.deepEqual(error.errors, [originalFailure]);
      assert.equal(error.cacheOwnershipReleased(), false);
      return true;
    });
  }
  assert.equal(oldCalls, 1, 'observational drains never retry a failed lease');
  session.embeddingLeaseErrors.length = 0;
  await assert.rejects(drainDaemonEmbeddingLeases(session), error => error.errors[0] === originalFailure);
  assert.equal(oldCalls, 1, 'mutating diagnostics cannot erase ownership or schedule another close');
  old.dispose = async () => { replacementCalls++; };
  allowOldClose = true;
  await removeDaemonEmbeddingWarmKey(session, 'same-key', old);
  assert.equal(oldCalls, 2, 'explicit reconciliation invokes the captured original method');
  assert.equal(replacementCalls, 0);
  assert.equal(siblingCalls, 0, 'reconciling a retired lease cannot dispose its same-key replacement');
  assert.equal(hasDaemonEmbeddingWarmKey(session, 'same-key'), true);
  await closeRuntimeDaemonSession(session);
  assert.equal(siblingCalls, 1);

  const failedShutdown = acquireRuntimeDaemonSession({ enabled: true, sessionKey: 'failed-shutdown-remains-owned' });
  let shutdownCalls = 0, allowShutdown = false;
  const shutdownFailure = new Error('shutdown lease unresolved');
  addDaemonEmbeddingWarmKey(failedShutdown, 'shutdown', { dispose: async () => {
    shutdownCalls++; if (!allowShutdown) throw shutdownFailure;
  } });
  await assert.rejects(closeRuntimeDaemonSession(failedShutdown), error => error.errors[0] === shutdownFailure);
  await assert.rejects(drainDaemonEmbeddingLeases(failedShutdown), error => error.errors[0] === shutdownFailure);
  assert.equal(shutdownCalls, 1);
  allowShutdown = true;
  await disposeRuntimeDaemonSessions();
  assert.equal(shutdownCalls, 2, 'global explicit shutdown still reaches the original failed session');

  const pendingSession = acquireRuntimeDaemonSession({ enabled: true, sessionKey: 'original-pending-child' });
  let nativeCalls = 0, childClosed = false;
  const childFailure = Object.assign(new Error('native child still pending'), {
    cacheOwnershipPending: true, cacheOwnershipReleased() { return childClosed; }
  });
  addDaemonEmbeddingWarmKey(pendingSession, 'pending', { dispose: async () => {
    nativeCalls++; if (nativeCalls === 1) throw childFailure;
  } });
  let retainedFailure;
  await assert.rejects(closeRuntimeDaemonSession(pendingSession), error => { retainedFailure = error; return error.errors[0] === childFailure; });
  await assert.rejects(closeRuntimeDaemonSession(pendingSession), error => error.errors[0] === childFailure);
  assert.equal(nativeCalls, 2);
  assert.equal(retainedFailure.cacheOwnershipReleased(), false, 'fulfilled native disposal cannot erase its original pending child');
  childClosed = true;
  await closeRuntimeDaemonSession(pendingSession);
  assert.equal(nativeCalls, 2, 'confirmed disposal is not replayed merely to check child settlement');
  assert.equal(retainedFailure.cacheOwnershipReleased(), true);
  const falsey = acquireRuntimeDaemonSession({ enabled: true, sessionKey: 'independent-falsey-disposal-failures' });
  let allowFalseyClose = false, firstCalls = 0, secondCalls = 0;
  addDaemonEmbeddingWarmKey(falsey, 'first', { dispose: async () => { firstCalls++; if (!allowFalseyClose) throw undefined; } });
  addDaemonEmbeddingWarmKey(falsey, 'second', { dispose: async () => { secondCalls++; if (!allowFalseyClose) throw false; } });
  for (const close of [() => closeRuntimeDaemonSession(falsey), () => drainDaemonEmbeddingLeases(falsey)]) {
    await assert.rejects(close(), error => {
      assert.deepEqual(error.errors, [undefined, false]);
      return true;
    });
  }
  assert.equal(firstCalls, 1);
  assert.equal(secondCalls, 1, 'one failed disposal cannot skip another warm owner');
  allowFalseyClose = true;
  await closeRuntimeDaemonSession(falsey);
  assert.equal(firstCalls, 2);
  assert.equal(secondCalls, 2);

  const inspected = acquireRuntimeDaemonSession({ enabled: true, sessionKey: 'original-diagnostic-child' });
  let inspectedCalls = 0, inspectorSettled = false;
  const inspector = Object.assign(new Error('original diagnostic inspector still owns work'), {
    cacheOwnershipPending: true, cacheOwnershipReleased() { return inspectorSettled; }
  });
  const inspectedFailure = Object.defineProperty({}, 'message', { configurable: true, get() { throw inspector; } });
  addDaemonEmbeddingWarmKey(inspected, 'inspected', { dispose: async () => {
    inspectedCalls++; if (inspectedCalls === 1) throw inspectedFailure;
  } });
  let inspectedDrain;
  await assert.rejects(closeRuntimeDaemonSession(inspected), error => {
    inspectedDrain = error;
    assert.deepEqual(error.errors, [inspectedFailure, inspector]);
    return true;
  });
  Object.defineProperty(inspectedFailure, 'message', { value: 'replacement diagnostic', configurable: true });
  await assert.rejects(closeRuntimeDaemonSession(inspected), error => error.errors.includes(inspector));
  assert.equal(inspectedCalls, 1, 'an independent original diagnostic child blocks another native disposal call');
  assert.equal(inspectedDrain.cacheOwnershipReleased(), false);
  inspectorSettled = true;
  await closeRuntimeDaemonSession(inspected);
  assert.equal(inspectedCalls, 2, 'explicit reconciliation invokes the original disposer once its inspector settles');
  assert.equal(inspectedDrain.cacheOwnershipReleased(), true);
} finally { await disposeRuntimeDaemonSessions(); }
console.log('daemon embedding retirement preserves original failures, methods and child ownership');
