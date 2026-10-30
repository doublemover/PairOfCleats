import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { createRunResourceScope } from '../../../src/shared/lifecycle/run-scope.js';
import { acquireBuildRuntimeStorage } from '../../../src/index/build/runtime/storage.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { teardownRuntime } from '../../../src/integrations/core/build-index/runtime.js';

const root = await makeTempDir('run-resource-timeout-');
try {
  for (const failedClose of [false, true]) {
    const cache = path.join(root, String(failedClose), 'cache'), home = path.join(root, String(failedClose), 'home');
    const coordinationRoot = path.join(home, 'state', 'storage-access');
    const storage = await withTemporaryEnv({ PAIROFCLEATS_HOME: home },
      () => acquireBuildRuntimeStorage(root, { cache: { root: cache } }));
    const scope = createRunResourceScope(), workGate = Promise.withResolvers(), closeGate = Promise.withResolvers();
    const entered = Promise.withResolvers(), closeEntered = Promise.withResolvers();
    let resourceClosed = false, closeCalls = 0;
    const original = Object.assign(new Error('original component close failed before physical completion'), {
      cacheOwnershipPending: true, cacheOwnershipReleased: () => resourceClosed
    });
    scope.adopt('fixture-resource', { isSettled: () => resourceClosed, release: async () => {
      closeCalls++; closeEntered.resolve(); await closeGate.promise;
      if (failedClose) throw original;
      resourceClosed = true;
    } });
    const work = scope.track(async () => { entered.resolve(); await workGate.promise; });
    await entered.promise;
    const runtime = { root, resourceScope: scope, indexRuntimeStorage: storage, log: () => {},
      indexingConfig: { stage1: { watchdog: { cleanupTimeoutMs: 20 } } } };
    let failure;
    try { await teardownRuntime(runtime); } catch (error) { failure = error; }
    assert.ok(failure); assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal((await inspectStorageAccess(cache, { coordinationRoot })).protected, true);
    await assert.rejects(scope.track(() => assert.fail('late callback admitted')), { code: 'ABORT_ERR' });
    workGate.resolve(); await work; await closeEntered.promise;
    assert.equal(failure.cacheOwnershipReleased(), false, 'work completion cannot stand in for actual component retirement');
    closeGate.resolve();
    if (failedClose) {
      await assert.rejects(scope.close());
      assert.equal(failure.cacheOwnershipReleased(), false);
      resourceClosed = true;
      await assert.rejects(scope.close(), 'physical settlement never rewrites the original failed close');
    } else await scope.close();
    assert.equal(scope.isSettled(), true);
    assert.equal(failure.cacheOwnershipReleased(), false, 'the resource observer cannot itself release the category lease');
    await teardownRuntime(runtime);
    assert.equal(failure.cacheOwnershipReleased(), true);
    assert.equal((await inspectStorageAccess(cache, { coordinationRoot })).protected, false);
    await teardownRuntime(runtime);
    assert.equal(closeCalls, 1, 'explicit reconciliation observes the original close instead of retrying native disposal');
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Run drain deadlines retain the actual scope until explicit original-owner reconciliation.');
