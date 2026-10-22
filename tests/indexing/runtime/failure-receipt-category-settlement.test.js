import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { createLifecycleRegistry } from '../../../src/shared/lifecycle/registry.js';
import { acquireBuildRuntimeStorage, closeBuildRuntimeInitialization, finalizeBuildRuntimeInitializationFailure } from '../../../src/index/build/runtime/storage.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';

// UNVALIDATED: actual receipt finalization/category owners; inert persistence.
const key = Symbol.for('poc.test.failure-receipt-category');
const state = { write: null };
globalThis[key] = state;
const hooks = registerHooks({ load(url, context, next) {
  if (url.endsWith('/src/index/build/build-state/runtime.js')) return { format: 'module', shortCircuit: true,
    source: 'export const persistRuntimeAttempt = (...args) => globalThis[Symbol.for("poc.test.failure-receipt-category")].write(...args);' };
  return next(url, context);
} });
const temporary = await makeTempDir('poc-failed-receipt-category-');
try {
  const { withRuntimeReceiptInitialization } = await import('../../../src/index/build/runtime/receipt.js');
  const repo = path.join(temporary, 'repo');
  await fs.mkdir(repo);
  for (const failRecord of [true, false]) {
    const variant = failRecord ? 'pending' : 'recorded';
    const home = path.join(temporary, variant, 'home'), cache = path.join(temporary, variant, 'cache');
    const coordinationRoot = path.join(home, 'state', 'storage-access');
    const owner = await withTemporaryEnv({ PAIROFCLEATS_HOME: home },
      () => acquireBuildRuntimeStorage(repo, { cache: { root: cache } }));
    const primary = Object.freeze(Object.assign(new Error('original frozen initialization error'), {
      code: 'EIO', cleanupErrors: 'prior diagnostic is not an array'
    }));
    const secondary = Object.freeze(Object.assign(new Error('failed failure receipt'), { code: 'ENOSPC' }));
    let protectedDuringRecord = false;
    state.write = async () => {
      protectedDuringRecord = (await inspectStorageAccess(cache, { coordinationRoot })).protected;
      if (failRecord) throw secondary;
      return null;
    };
    let failure;
    try {
      await withRuntimeReceiptInitialization(async onAttempt => {
        onAttempt({ attemptId: 'inert-persistence-fixture' }, path.join(cache, 'build'));
        throw await closeBuildRuntimeInitialization({ initialization: createLifecycleRegistry(), error: primary, owner });
      }, { finalizeFailure: input => finalizeBuildRuntimeInitializationFailure({ ...input, owner }) });
    } catch (error) { failure = error; }
    assert.equal(protectedDuringRecord, true, 'unwind completion alone does not release the category before failure recording');
    if (failRecord) {
      assert.equal(failure.cause, primary);
      assert.equal(failure.errors[1], secondary);
      assert.deepEqual(failure.cleanupErrors, [secondary]);
      assert.equal(failure.cacheOwnershipPending, true);
      assert.equal((await inspectStorageAccess(cache, { coordinationRoot })).protected, true);
      owner.session.releaseAfterSettlement({ resourceId: owner.session.resourceId, settled: true, pending: false });
      assert.equal(failure.cacheOwnershipReleased(), false, 'fixture metadata cleanup is not a production recording settlement claim');
    } else {
      assert.equal(failure, primary);
      assert.equal((await inspectStorageAccess(cache, { coordinationRoot })).protected, false);
    }
  }
} finally { hooks.deregister(); delete globalThis[key]; await rmDirRecursive(temporary); }
console.log('Failure recording stays within actual runtime category ownership.');
