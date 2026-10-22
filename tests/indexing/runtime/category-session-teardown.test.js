import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { acquireBuildRuntimeStorage } from '../../../src/index/build/runtime/storage.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { isStorageSessionReleaseFailure } from '../../../src/shared/storage/session.js';

// UNVALIDATED: actual core teardown and category leases; inert native owners.
const hooks = registerHooks({ load(url, context, next) {
  const source = url.endsWith('/src/lang/tree-sitter.js') ? 'export const shutdownTreeSitterWorkerPool = async () => {};'
    : url.endsWith('/src/lang/python.js') ? 'export const shutdownPythonAstPool = async () => {};'
      : url.endsWith('/src/shared/subprocess/tracking-terminate.js')
        ? 'export const terminateTrackedSubprocesses = async options => ({...options,tracked:0,failures:0,killAudit:[]});'
        : url.endsWith('/src/integrations/tooling/providers/lsp/session-pool.js')
          ? 'export const drainLspSessionPool = async () => ({rejected:0,timedOut:false});' : null;
  return source === null ? next(url, context) : { format: 'module', source, shortCircuit: true };
} });
const temporary = await makeTempDir('poc-runtime-category-teardown-');
try {
  const { teardownRuntime } = await import('../../../src/integrations/core/build-index/runtime.js');
  const repo = path.join(temporary, 'repo');
  await fs.mkdir(repo);
  for (const observable of [true, false]) {
    const variant = observable ? 'observable' : 'unknown';
    const home = path.join(temporary, variant, 'home');
    const cache = path.join(temporary, variant, 'cache');
    const coordinationRoot = path.join(home, 'state', 'storage-access');
    const storage = await withTemporaryEnv({ PAIROFCLEATS_HOME: home },
      () => acquireBuildRuntimeStorage(repo, { cache: { root: cache } }));
    let confirmed = false, loggerCloses = 0;
    const primary = Object.freeze(Object.assign(new Error('inert worker owner remains pending'), {
      cacheOwnershipPending: true, code: 'ERR_STORAGE_SESSION_LEASE_CHANGED', storageSession: storage.session,
      ...(observable ? { cacheOwnershipReleased: () => confirmed } : {})
    }));
    assert.equal(isStorageSessionReleaseFailure(primary, storage.session), false, 'matching code/session properties are not an owned metadata-release failure');
    const runtime = { root: repo, log: () => {}, indexRuntimeStorage: storage,
      workerPools: { destroy: async () => { if (!confirmed) throw primary; } },
      closeLogger: async () => { loggerCloses++; } };
    let failure;
    try { await teardownRuntime(runtime); } catch (error) { failure = error; }
    assert.equal(failure.cause, primary, 'frozen native failure is preserved by the actual teardown owner');
    assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal((await inspectStorageAccess(cache, { coordinationRoot })).protected, true);
    assert.equal(loggerCloses, 1, 'other teardown steps still run before reporting resource failure');
    confirmed = true;
    if (observable) {
      await teardownRuntime(runtime);
      assert.equal(failure.cacheOwnershipReleased(), true);
      assert.equal((await inspectStorageAccess(cache, { coordinationRoot })).protected, false);
      await teardownRuntime(runtime);
    } else {
      await assert.rejects(teardownRuntime(runtime), { code: 'ERR_INDEX_RUNTIME_STORAGE_PENDING' });
      assert.equal((await inspectStorageAccess(cache, { coordinationRoot })).protected, true,
        'a later fulfilled teardown cannot override an original missing resource observer');
      assert.equal(failure.cacheOwnershipReleased(), false);
      // This fixture owns no native resources. Remove only its exact metadata
      // for fixture hygiene; do not claim the unknown production owner settled.
      storage.session.releaseAfterSettlement({ resourceId: storage.session.resourceId, settled: true, pending: false });
      assert.equal(failure.cacheOwnershipReleased(), false);
    }
  }
  const metadataHome = path.join(temporary, 'metadata-home'), metadataCache = path.join(temporary, 'metadata-cache');
  const metadataCoordination = path.join(metadataHome, 'state', 'storage-access');
  const metadataOwner = await withTemporaryEnv({ PAIROFCLEATS_HOME: metadataHome },
    () => acquireBuildRuntimeStorage(repo, { cache: { root: metadataCache } }));
  const metadataRuntime = { root: repo, log: () => {}, indexRuntimeStorage: metadataOwner };
  const syncRemove = fsSync.rmSync;
  let deny = true;
  try {
    fsSync.rmSync = (target, options) => {
      if (deny && String(target).startsWith(metadataCoordination + path.sep)) throw Object.assign(new Error('actual runtime lease unlink denied'), { code: 'EACCES' });
      return syncRemove(target, options);
    };
    let failedRelease;
    try { await teardownRuntime(metadataRuntime); } catch (error) { failedRelease = error; }
    assert.equal(isStorageSessionReleaseFailure(failedRelease.cause, metadataOwner.session), true);
    assert.equal(failedRelease.cacheOwnershipReleased(), false);
    assert.equal((await inspectStorageAccess(metadataCache, { coordinationRoot: metadataCoordination })).protected, true);
    deny = false;
    await teardownRuntime(metadataRuntime);
    assert.equal(failedRelease.cacheOwnershipReleased(), true, 'actual metadata retry satisfies the old outward observer without self-blocking');
    assert.equal((await inspectStorageAccess(metadataCache, { coordinationRoot: metadataCoordination })).protected, false);
  } finally { fsSync.rmSync = syncRemove; }

  let index = 0;
  for (const value of [undefined, null, false, 0, '']) {
    const home = path.join(temporary, `clear-${index}`, 'home'), cache = path.join(temporary, `clear-${index++}`, 'cache');
    const coordinationRoot = path.join(home, 'state', 'storage-access');
    const owner = await withTemporaryEnv({ PAIROFCLEATS_HOME: home },
      () => acquireBuildRuntimeStorage(repo, { cache: { root: cache } }));
    let loggerCloses = 0;
    try {
      const failure = await teardownRuntime({ root: repo, log() {}, indexRuntimeStorage: owner,
        semanticReplayVerification: { clear() { throw value; } }, closeLogger() { loggerCloses++; }
      }).then(() => assert.fail('replay cleanup failed'), error => error);
      assert.equal(failure.cause, value, 'the actual teardown retains exact falsey replay cleanup failure');
      assert.equal(loggerCloses, 1, 'replay cleanup failure cannot bypass the logger cleanup step');
      assert.equal(failure.cacheOwnershipReleased(), false);
      assert.equal((await inspectStorageAccess(cache, { coordinationRoot })).protected, true);
    } finally {
      // Inert fixture metadata disposal does not prove resource recovery.
      owner.session.releaseAfterSettlement({ resourceId: owner.session.resourceId, settled: true, pending: false });
    }
  }
  for (const [position, value] of [undefined, null, false, 0, ''].entries()) {
    const home = path.join(temporary, `pool-getter-${position}`, 'home');
    const cache = path.join(temporary, `pool-getter-${position}`, 'cache');
    const coordinationRoot = path.join(home, 'state', 'storage-access');
    const owner = await withTemporaryEnv({ PAIROFCLEATS_HOME: home },
      () => acquireBuildRuntimeStorage(repo, { cache: { root: cache } }));
    let loggerCloses = 0, getterCalls = 0;
    const runtime = { root: repo, log() {}, indexRuntimeStorage: owner,
      get workerPools() { getterCalls++; throw value; }, closeLogger() { loggerCloses++; } };
    try {
      const failure = await teardownRuntime(runtime).then(() => assert.fail('pool acquisition failed'), error => error);
      assert.equal(failure.cause, value);
      assert.equal(getterCalls, 1, 'worker ownership is inspected once inside its cleanup step');
      assert.equal(loggerCloses, 1, 'method selection failure cannot bypass later cleanup');
      assert.equal((await inspectStorageAccess(cache, { coordinationRoot })).protected, true);
    } finally {
      owner.session.releaseAfterSettlement({ resourceId: owner.session.resourceId, settled: true, pending: false });
    }
  }
  for (const plural of [true, false]) {
    let selections = 0, captures = 0, closes = 0, loggerCloses = 0;
    const pool = { get destroy() {
      captures++;
      return function () { assert.equal(this, pool); closes++; };
    } };
    const runtime = { log() {}, closeLogger() { loggerCloses++; } };
    Object.defineProperty(runtime, plural ? 'workerPools' : 'workerPool', { get() {
      if (++selections !== 1) assert.fail('a replacement worker owner cannot be selected');
      return pool;
    } });
    await teardownRuntime(runtime);
    assert.equal(selections, 1); assert.equal(captures, 1); assert.equal(closes, 1); assert.equal(loggerCloses, 1);
  }
  {
    const primary = Object.freeze(new Error('original destroy method inspection failed'));
    let loggerCloses = 0, captures = 0;
    const failure = await teardownRuntime({ log() {},
      workerPools: { get destroy() { captures++; throw primary; } },
      closeLogger() { loggerCloses++; }
    }).then(() => assert.fail('destroy inspection failed'), error => error);
    assert.equal(failure, primary); assert.equal(captures, 1); assert.equal(loggerCloses, 1);
  }
  const unhandled = [], diagnosticFailure = new Error('async cleanup presentation failed');
  const onUnhandled = error => { unhandled.push(error); };
  process.on('unhandledRejection', onUnhandled);
  try {
    let loggerCloses = 0;
    await teardownRuntime({ async log() { throw diagnosticFailure; }, closeLogger() { loggerCloses++; } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(loggerCloses, 1);
    assert.deepEqual(unhandled, [], 'best-effort async presentation remains observed without changing cleanup success');
  } finally { process.off('unhandledRejection', onUnhandled); }
} finally { hooks.deregister(); await rmDirRecursive(temporary); }
console.log('Runtime teardown retains independent pending owners through category settlement.');
