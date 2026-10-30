import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import Piscina from 'piscina';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { acquireBuildRuntimeStorage, releaseBuildRuntimeStorage } from '../../../src/index/build/runtime/storage.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { drainCacheWriters, releaseCacheWriterOwnership } from '../../../src/index/build/cache-writer-drain.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/runtime/worker-retry-evidence-ownership/')[1];
assert.ok(['shared-cache', 'shared-teardown', 'split-cache', 'split-teardown'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`worker-retry-evidence-${selected}`);
applyTestEnv({ cacheRoot: path.join(dir, 'test-cache'), embeddings: 'off' });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const rejected = async operation => {
  let failed = false, value;
  try { await operation(); } catch (error) { failed = true; value = error; }
  assert.equal(failed, true, 'the original cleanup attempt must reject'); return value;
};
const contains = (error, expected, seen = new Set()) => {
  if (error === expected) return true;
  if (!error || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error);
  return contains(error.cause, expected, seen) || (Array.isArray(error.errors) && error.errors.some(value => contains(value, expected, seen)));
};
const hooks = registerHooks({ load(url, context, next) {
  const loaded = next(url, context);
  if (!url.endsWith('/src/index/build/crash-log.js')) return loaded;
  const original = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString('utf8');
  const source = original.replace('export async function createCrashLogger(', 'async function originalCreateCrashLogger(');
  assert.notEqual(source, original);
  return { ...loaded, source: source + `
export const createCrashLogger=async(...args)=>{
  const owner=await originalCreateCrashLogger(...args);
  await globalThis.__lateWorkerEvidence?.('created',owner);
  return {...owner,
    close:async()=>{await owner.close();await globalThis.__lateWorkerEvidence?.('closed',owner);},
    flush:async()=>{await globalThis.__lateWorkerEvidence?.('flush',owner);await owner.flush();}
  };
};
` };
} });
const nativeDestroy = Piscina.prototype.destroy, nativeRename = fs.rename;
let target = null, rejectDestroy = false, primary, attempts = 0;
Piscina.prototype.destroy = async function (...args) {
  if (this === target) { attempts++; if (rejectDestroy) throw primary; }
  return nativeDestroy.apply(this, args);
};
try {
  const { createRuntimeWorkerPools } = await import('../../../src/index/build/runtime/workers.js');
  const { teardownRuntime } = await import('../../../src/integrations/core/build-index/runtime.js');
  await withTemporaryEnv({ PAIROFCLEATS_HOME: path.join(dir, 'home') }, async () => {
    const coordinationRoot = path.join(dir, 'home', 'state', 'storage-access');
    for (const scenario of ['gated-write', 'flush-rejection']) {
      const repo = path.join(dir, scenario); await fs.mkdir(repo);
      const config = { cache: { root: path.join(dir, 'cache-' + scenario) } };
      const storage = acquireBuildRuntimeStorage(repo, config), cache = resolveRepoCacheRootPath(repo, config);
      const entered = deferred(), release = deferred();
      const flushError = Object.freeze(new Error('original retry evidence flush rejection'));
      const initialFlushError = Object.freeze(new Error('independent initial evidence flush rejection'));
      let logger = null, loggerCloses = 0, rejectFlush = false, armed = false;
      let rejectInitialFlush = scenario === 'flush-rejection';
      let publicationStarted = 0, publicationFinished = 0, fixtureFailed = false;
      globalThis.__lateWorkerEvidence = async (phase, owner) => {
        if (phase === 'created') { assert.equal(logger, null); logger = owner; }
        else if (phase === 'closed') loggerCloses++;
        else if (phase === 'flush') {
          if (rejectInitialFlush) throw initialFlushError;
          if (rejectFlush) { await entered.promise; throw flushError; }
        }
      };
      fs.rename = async function (from, to, ...args) {
        if (armed && path.resolve(String(to)) === logger.paths.statePath) {
          armed = false; publicationStarted++; entered.resolve(); await release.promise;
          const result = await nativeRename.call(this, from, to, ...args); publicationFinished++; return result;
        }
        return nativeRename.call(this, from, to, ...args);
      };
      const built = await createRuntimeWorkerPools({ workerPoolConfig: { enabled: true,
        maxWorkers: selected.startsWith('split') ? 2 : 1, splitByTask: selected.startsWith('split'),
        cleanupTimeoutMs: 1000, idleTimeoutMs: 60000 }, repoCacheRoot: cache,
      dictWords: new Set(['alpha']), dictConfig: {}, postingsConfig: {}, debugCrash: true, log() {} });
      const runtime = { ...built, root: repo, indexRuntimeStorage: storage, log() {} };
      target = runtime.workerPool.pool.pool; assert.ok(target instanceof Piscina);
      await runtime.workerPool.tokenizeChunk({ text: 'alpha', mode: 'code', ext: '.js' });
      assert.ok(target.completed > 0 && target.threads.length > 0, 'use an actual original live Worker, not only a recording pool');
      attempts = 0; primary = scenario === 'gated-write' ? null : 0; rejectDestroy = true;
      const cleanup = () => selected.endsWith('teardown') ? teardownRuntime(runtime)
        : drainCacheWriters(runtime, { shutdown: true, timeoutMs: 1000 });
      let active = null, cleanupReturned = false;
      try {
        const first = await rejected(cleanup);
        assert.equal(contains(first, primary), true); assert.equal(first.cacheOwnershipReleased(), false);
        if (scenario === 'flush-rejection') assert.ok(contains(first, initialFlushError),
          'falsey worker failure and independent original evidence failure both survive composition');
        assert.equal(loggerCloses, 1, 'the independent original logger already closed before worker retry');
        rejectInitialFlush = false;
        rejectDestroy = false; rejectFlush = scenario === 'flush-rejection'; armed = true;
        active = cleanup().then(() => { cleanupReturned = true; return { ok: true }; }, error => { cleanupReturned = true; return { ok: false, error }; });
        await Promise.race([entered.promise, active.then(() => assert.fail('cleanup returned before the real retry-exit state writer was admitted'))]);
        assert.equal(publicationStarted, 1); assert.equal(publicationFinished, 0);
        if (scenario === 'flush-rejection') {
          const failed = await active; assert.equal(failed.ok, false); assert.ok(contains(failed.error, flushError));
          assert.equal(failed.error.cacheOwnershipReleased(), false);
        } else assert.equal(cleanupReturned, false, 'normal teardown/cache drain joins actual publication rather than fixture cleanup');
        assert.equal(runtime.workerPools.isSettled(), false); assert.equal(first.cacheOwnershipReleased(), false);
        assert.equal((await inspectStorageAccess(cache, { coordinationRoot })).protected, true);
        let releases = 0, invalidations = 0;
        const lease = { assertOwned() {}, invalidate() { invalidations++; } };
        await rejected(() => releaseCacheWriterOwnership({ lease, operationError: first,
          release() { releases++; return releaseBuildRuntimeStorage(runtime); } }));
        assert.equal(releases, 0); assert.equal(invalidations, 0);
        rejectFlush = false; release.resolve();
        if (scenario === 'flush-rejection') await cleanup();
        else assert.equal((await active).ok, true);
        assert.equal(publicationFinished, 1); assert.equal(runtime.workerPools.isSettled(), true);
        assert.equal(first.cacheOwnershipReleased(), true); assert.equal(attempts, 2);
        assert.equal(loggerCloses, 1, 'joining late writes cannot physically close a successful logger twice');
        const persisted = JSON.parse(await fs.readFile(logger.paths.statePath, 'utf8'));
        assert.equal(persisted.evidenceOwnerId, logger.identity.evidenceOwnerId);
        assert.equal(persisted.error.phase, 'worker-exit');
        if (selected.endsWith('cache')) await releaseCacheWriterOwnership({ lease, operationError: first,
          release() { releases++; return releaseBuildRuntimeStorage(runtime); } });
        assert.equal(releases, selected.endsWith('cache') ? 1 : 0);
        assert.equal(invalidations, selected.endsWith('cache') ? 1 : 0);
        assert.equal((await inspectStorageAccess(cache, { coordinationRoot })).protected, false);
        await runtime.workerPools.destroy(); assert.equal(attempts, 2); assert.equal(loggerCloses, 1);
        console.log(JSON.stringify({ selected, scenario, attempts, loggerCloses, publicationStarted, publicationFinished }));
      } catch (error) { fixtureFailed = true; throw error; }
      finally {
        rejectDestroy = false; rejectFlush = false; rejectInitialFlush = false; armed = false; release.resolve(); await active;
        await runtime.workerPools.destroy();
        // Emergency cleanup only after an already failing assertion. This is
        // never the barrier that makes the production acceptance above pass.
        if (fixtureFailed) await logger.flush();
        releaseBuildRuntimeStorage(runtime); fs.rename = nativeRename;
      }
    }
  });
} finally {
  Piscina.prototype.destroy = nativeDestroy; fs.rename = nativeRename;
  hooks.deregister(); delete globalThis.__lateWorkerEvidence;
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Actual runtime aggregates retain late original retry-exit evidence before cleanup and lease retirement.');
