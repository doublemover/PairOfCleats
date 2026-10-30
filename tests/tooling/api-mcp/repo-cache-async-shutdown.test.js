import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRepoCacheManager } from '../../../src/shared/repo-cache-config.js';
import { createRepoCacheManager as createApiCacheManager } from '../../../tools/api/router/cache.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const { dir } = await prepareIsolatedTestCacheDir('repo-cache-async-shutdown');
applyTestEnv({ cacheRoot: path.join(dir, 'cache') });
const deferred = () => { let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
const contains = (error, expected) => {
  const queue = [error], seen = new Set();
  while (queue.length) { const value = queue.pop(); if (value === expected) return true;
    if (!value || seen.has(value)) continue; seen.add(value);
    if (Object.hasOwn(value, 'cause')) queue.push(value.cause); if (value.errors) queue.push(...value.errors); }
  return false;
};
const catchFailure = action => { let thrown = false, failure;
  try { action(); } catch (error) { thrown = true; failure = error; }
  assert.equal(thrown, true); return failure; };
const root = path.join(dir, 'repo'); await fs.mkdir(root); await fs.writeFile(path.join(root, 'package.json'), '{}');
const other = path.join(dir, 'other'); await fs.mkdir(other); await fs.writeFile(path.join(other, 'package.json'), '{}');
const unhandled = [], onUnhandled = error => unhandled.push(error), managers = [], gates = [];
process.on('unhandledRejection', onUnhandled);
const metrics = [];
try {
  for (const create of [createRepoCacheManager, createApiCacheManager]) {
    for (const outcome of ['sync', 'sync-throw', 'async-success', 'async-reject-before-report', 'async-reject-after-report', 'pending-failure']) {
      let calls = 0, originalEntry, released = false;
      const gate = deferred(), resource = deferred(); gates.push(gate, resource);
      const actualResource = resource.promise.then(() => { released = true; });
      const sentinel = outcome === 'pending-failure'
        ? Object.freeze(Object.assign(new Error('original async hook and independent resource'), {
          cacheOwnershipPending: true, cacheOwnershipReleased: () => released
        })) : Object.freeze(new Error('original shutdown rejection'));
      const manager = create({ defaultRepo: root, repoCache: { maxEntries: 2, shutdown(entry) {
        calls++; assert.equal(entry, originalEntry);
        if (outcome === 'sync-throw') throw sentinel;
        if (outcome === 'sync') return;
        return gate.promise;
      } } }); managers.push(manager);
      originalEntry = manager.getRepoCaches(root);
      const started = performance.now();
      if (outcome === 'sync-throw') {
        const failure = catchFailure(() => manager.closeRepoCaches());
        assert.ok(contains(failure, sentinel)); assert.equal(manager.closeRepoCaches().status, 'settled');
      } else {
        const first = manager.closeRepoCaches();
        assert.equal(first.status, outcome === 'sync' ? 'settled' : 'retiring');
        assert.equal(first.pendingShutdownHooks, outcome === 'sync' ? 0 : 1);
        assert.equal(manager.closeRepoCaches().pendingShutdownHooks, first.pendingShutdownHooks);
        assert.equal(calls, 1, 'repeated explicit reports never replay the captured shutdown hook');
        if (outcome === 'async-success') {
          let complete = false;
          const waiting = manager.awaitRepoRetirement().then(receipt => { complete = true; return receipt; });
          await Promise.resolve(); assert.equal(complete, false);
          gate.resolve(); assert.equal((await waiting).status, 'settled');
        } else if (outcome.startsWith('async-reject') || outcome === 'pending-failure') {
          if (outcome === 'async-reject-after-report') assert.equal(manager.getRetirementReceipt().status, 'retiring');
          gate.reject(sentinel);
          // Let the actual original rejection handler settle, independently of
          // whether a caller has already requested its explicit drain receipt.
          await new Promise(resolve => setImmediate(resolve));
          assert.equal(manager.getRetirementReceipt().status, 'failed');
          const failure = catchFailure(() => manager.closeRepoCaches());
          assert.ok(contains(failure, sentinel));
          if (outcome === 'pending-failure') {
            assert.equal(failure.cacheOwnershipReleased(), false);
            resource.resolve(); await actualResource;
            assert.equal(failure.cacheOwnershipReleased(), true);
            assert.equal(manager.getRetirementReceipt().status, 'failed', 'settled release does not erase the original failed outcome');
            const terminal = catchFailure(() => manager.closeRepoCaches()); assert.ok(contains(terminal, sentinel));
          }
          assert.equal(manager.closeRepoCaches().status, 'settled');
        }
      }
      assert.equal(calls, 1); resource.resolve(); gate.resolve(); await actualResource;
      metrics.push({ facade: create === createRepoCacheManager ? 'shared' : 'api', outcome,
        elapsedMs: performance.now() - started, pendingHooks: manager.getRetirementReceipt().pendingShutdownHooks });
    }
  }
  {
    const hook = deferred(), resource = deferred(); gates.push(hook, resource);
    let released = false, calls = 0;
    const originalResource = resource.promise.then(() => { released = true; });
    Object.defineProperties(hook.promise, { cacheOwnershipPending: { value: true },
      cacheOwnershipReleased: { value: () => released } });
    const manager = createRepoCacheManager({ defaultRepo: root, repoCache: {
      shutdown() { calls++; return hook.promise; }
    } }); managers.push(manager); manager.getRepoCaches(root);
    assert.equal(manager.closeRepoCaches().status, 'retiring'); hook.resolve();
    assert.equal((await manager.awaitRepoRetirement()).status, 'retiring',
      'a fulfilled hook cannot discard its original independent resource observer');
    resource.resolve(); await originalResource;
    assert.equal((await manager.awaitRepoRetirement()).status, 'settled'); assert.equal(calls, 1);
  }
  {
    const hook = deferred(); gates.push(hook);
    const sentinel = Object.freeze(new Error('original implicit-eviction async rejection'));
    const calls = [], manager = createRepoCacheManager({ defaultRepo: root, repoCache: { maxEntries: 1,
      shutdown(entry) { calls.push(entry.repoRoot); return entry.repoRoot === root ? hook.promise : undefined; }
    } }); managers.push(manager); manager.getRepoCaches(root); manager.getRepoCaches(other);
    hook.reject(sentinel); await new Promise(resolve => setImmediate(resolve));
    const failure = catchFailure(() => manager.closeRepoCaches()); assert.ok(contains(failure, sentinel));
    assert.deepEqual(calls, [root, other], 'independent shutdown proceeds after an implicit original rejection');
    assert.equal(manager.closeRepoCaches().status, 'settled');
  }
  {
    const hooks = [], manager = createRepoCacheManager({ defaultRepo: root, repoCache: { maxEntries: 1,
      shutdown(entry) { const gate = deferred(); gates.push(gate); hooks.push({ gate, root: entry.repoRoot }); return gate.promise; } } });
    managers.push(manager); manager.getRepoCaches(root); manager.getRepoCaches(other);
    assert.deepEqual(hooks.map(hook => hook.root), [root]);
    assert.equal(manager.getRetirementReceipt().pendingShutdownHooks, 1, 'actual LRU eviction retains the original hook');
    assert.equal(manager.closeRepoCaches().pendingShutdownHooks, 2, 'independent terminal disposal still starts its hook');
    hooks[0].gate.resolve(); hooks[1].gate.resolve();
    assert.equal((await manager.awaitRepoRetirement()).status, 'settled');
    assert.equal(hooks.length, 2);
  }
  {
    const hooks = [], manager = createRepoCacheManager({ defaultRepo: root, repoCache: {
      shutdown(entry) { const gate = deferred(); gates.push(gate); hooks.push({ gate, buildId: entry.buildId }); return gate.promise; }
    } }); managers.push(manager);
    const entry = manager.getRepoCaches(root);
    const publish = async id => {
      const buildRoot = path.join(entry.buildsRoot, id); await fs.mkdir(path.join(buildRoot, 'index-code'), { recursive: true });
      await fs.writeFile(path.join(buildRoot, 'index-code', 'chunk_meta.json'), '[]');
      await fs.writeFile(entry.buildPointerPath, JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
        buildId: id, buildRoot: path.relative(entry.repoCacheRoot, buildRoot).replaceAll('\\', '/') }));
      await manager.refreshBuildPointer(entry);
    };
    await publish('async-a'); assert.equal(hooks.length, 1); hooks[0].gate.resolve(); await manager.awaitRepoRetirement();
    await publish('async-b'); assert.equal(hooks[1].buildId, 'async-a');
    assert.equal(manager.getRetirementReceipt().status, 'retiring');
    manager.closeRepoCaches(); assert.equal(hooks[2].buildId, 'async-b');
    hooks[1].gate.resolve(); hooks[2].gate.resolve();
    assert.equal((await manager.awaitRepoRetirement()).status, 'settled'); assert.equal(hooks.length, 3);
  }
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(unhandled, []);
  console.log(JSON.stringify({ scope: 'actual manager/LRU/shared policy and API forwarding; controlled original hooks', metrics }));
} finally {
  for (const gate of gates) gate.resolve();
  for (const manager of managers) { try { manager.closeRepoCaches(); await manager.awaitRepoRetirement(); } catch { /* original failures already asserted */ } }
  process.off('unhandledRejection', onUnhandled); await fs.rm(dir, { recursive: true, force: true });
}
