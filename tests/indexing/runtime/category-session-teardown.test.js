import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { acquireBuildRuntimeStorage } from '../../../src/index/build/runtime/storage.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';

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
      cacheOwnershipPending: true, ...(observable ? { cacheOwnershipReleased: () => confirmed } : {})
    }));
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
} finally { hooks.deregister(); await rmDirRecursive(temporary); }
console.log('Runtime teardown retains independent pending owners through category settlement.');
