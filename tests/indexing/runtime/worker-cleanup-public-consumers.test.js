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

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/runtime/worker-cleanup-public-consumers/')[1];
assert.ok(['shared-teardown', 'split-teardown', 'shared-cache', 'split-cache'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`worker-cleanup-${selected}`);
applyTestEnv({ cacheRoot: path.join(dir, 'test-cache'), embeddings: 'off' });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const reject = async operation => { let failed = false, value; try { await operation(); } catch (error) { failed = true; value = error; }
  assert.equal(failed, true); return value; };
const contains = (error, wanted, seen = new Set()) => {
  if (error === wanted) return true;
  if (!error || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error); return contains(error.cause, wanted, seen) || (Array.isArray(error.errors) && error.errors.some(row => contains(row, wanted, seen)));
};
const hooks = registerHooks({ load(url, context, next) {
  const loaded = next(url, context);
  if (!url.endsWith('/src/index/build/crash-log.js')) return loaded;
  const original = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString('utf8');
  const source = original.replace('export async function createCrashLogger(', 'async function originalCreateCrashLogger(');
  assert.notEqual(source, original);
  return { ...loaded, source: source + '\nexport const createCrashLogger=async(...args)=>{const owner=await originalCreateCrashLogger(...args);const close=owner.close.bind(owner);return {...owner,close:async()=>{globalThis.__workerCleanupLogger?.("attempt",owner);await close();globalThis.__workerCleanupLogger?.("closed",owner);}}};\n' };
} });
const nativeDestroy = Piscina.prototype.destroy;
let target, fail = false, entered, finish, primary;
const attempts = new Map();
Piscina.prototype.destroy = async function (...args) {
  attempts.set(this, (attempts.get(this) || 0) + 1);
  if (this === target && fail) { entered.resolve(); await finish.promise; throw primary; }
  return nativeDestroy.apply(this, args);
};
try {
  const { createRuntimeWorkerPools } = await import('../../../src/index/build/runtime/workers.js');
  const { teardownRuntime } = await import('../../../src/integrations/core/build-index/runtime.js');
  await withTemporaryEnv({ PAIROFCLEATS_HOME: path.join(dir, 'home') }, async () => {
    const coordinationRoot = path.join(dir, 'home', 'state', 'storage-access');
    const values = [null, false, 0, '', Object.freeze(new Error('original frozen rejection')), new Error('original worker rejection')];
    for (let index = 0; index < values.length; index++) {
      primary = values[index]; entered = deferred(); finish = deferred();
      const repo = path.join(dir, `repo-${index}`); await fs.mkdir(repo);
      const config = { cache: { root: path.join(dir, `cache-${index}`) } };
      const storage = acquireBuildRuntimeStorage(repo, config), cache = resolveRepoCacheRootPath(repo, config);
      const loggerError = Object.freeze(new Error('independent original logger close rejection'));
      let loggerFail = index === 0, loggerAttempts = 0, loggerConfirmed = 0;
      const originalLoggers = new Set();
      globalThis.__workerCleanupLogger = (phase, owner) => {
        originalLoggers.add(owner);
        if (phase === 'attempt') { loggerAttempts++; if (loggerFail) throw loggerError; }
        else loggerConfirmed++;
      };
      const built = await createRuntimeWorkerPools({ workerPoolConfig: { enabled: true, maxWorkers: selected.startsWith('split') ? 2 : 1,
        splitByTask: selected.startsWith('split'), cleanupTimeoutMs: 1000, idleTimeoutMs: 60000 },
      repoCacheRoot: cache, dictWords: new Set(['alpha']), dictConfig: {}, postingsConfig: {}, debugCrash: true, log() {} });
      const runtime = { ...built, root: repo, indexRuntimeStorage: storage, log() {} };
      assert.ok(runtime.workerPool); const original = runtime.workerPool.pool;
      target = original.pool; assert.ok(target instanceof Piscina);
      if (index === values.length - 1) {
        await runtime.workerPool.tokenizeChunk({ text: 'alpha', mode: 'code', ext: '.js' });
        assert.ok(target.completed > 0 && target.threads.length > 0, 'actual native positive retains live original Worker handles');
      }
      const siblings = [runtime.quantizePool].filter(pool => pool && pool !== runtime.workerPool);
      fail = true;
      const cleanup = () => selected.endsWith('teardown') ? teardownRuntime(runtime)
        : drainCacheWriters(runtime, { shutdown: true, timeoutMs: 1000 });
      let error, firstCleanup, fixtureFailure, fixtureFailed = false;
      try {
        firstCleanup = cleanup(); const failure = reject(() => firstCleanup);
        await entered.promise;
        const concurrent = runtime.workerPools.destroy(); concurrent.catch(() => {});
        assert.equal(runtime.workerPools.isSettled(), false);
        assert.equal(runtime.workerPool.pool, original);
        assert.equal(attempts.get(target), 1);
        assert.equal((await inspectStorageAccess(cache, { coordinationRoot })).protected, true);
        finish.resolve(); error = await failure; await concurrent.catch(() => {});
        assert.equal(contains(error, primary), true, 'falsey/frozen original values survive actual factory/aggregate/public consumer composition');
        if (index === 0) assert.equal(contains(error, loggerError), true);
        assert.equal(error.cacheOwnershipReleased(), false);
        assert.equal(runtime.workerPool.pool, original);
        for (const sibling of siblings) assert.equal(sibling.isSettled(), true);
        let invalidations = 0, releases = 0;
        const lease = { assertOwned() {}, invalidate() { invalidations++; } };
        await reject(() => releaseCacheWriterOwnership({ lease, operationError: error,
          release() { releases++; return releaseBuildRuntimeStorage(runtime); } }));
        assert.equal(invalidations, 0); assert.equal(releases, 0);
        fail = false; loggerFail = false;
        await cleanup();
        assert.equal(attempts.get(target), 2, 'the retained failed original owner is reached on explicit retry');
        assert.equal(runtime.workerPool.pool, null); assert.equal(runtime.workerPools.isSettled(), true);
        assert.equal(error.cacheOwnershipReleased(), true);
        assert.equal(loggerConfirmed, 1); assert.equal(loggerAttempts, index === 0 ? 2 : 1);
        for (const sibling of siblings) assert.equal(sibling.isSettled(), true);
        if (selected.endsWith('cache')) await releaseCacheWriterOwnership({ lease, operationError: error,
          release() { releases++; return releaseBuildRuntimeStorage(runtime); } });
        assert.equal((await inspectStorageAccess(cache, { coordinationRoot })).protected, false);
        const count = attempts.get(target); await runtime.workerPools.destroy(); assert.equal(attempts.get(target), count);
        console.log(JSON.stringify({ selected, rejectionCase: index, destroyAttempts: count, loggerAttempts,
          loggerConfirmed, originalReleased: error.cacheOwnershipReleased(), poolsSettled: runtime.workerPools.isSettled() }));
      } catch (failure) {
        fixtureFailed = true; fixtureFailure = failure; throw failure;
      } finally {
        fail = false; loggerFail = false; finish.resolve();
        // Join the already accepted first negative control before retrying its
        // retained original owner. Never let fixture cleanup mask an assertion.
        await firstCleanup?.catch(() => {});
        try {
          await runtime.workerPools.destroy();
          // Actual Worker exit callbacks may publish crash evidence during the
          // explicit retry, after the earlier independent logger close. Join
          // those original evidence writers before deleting their directory.
          assert.equal(originalLoggers.size, 1);
          for (const logger of originalLoggers) await logger.flush();
          releaseBuildRuntimeStorage(runtime);
        }
        catch (failure) {
          if (fixtureFailed) throw new AggregateError([fixtureFailure, failure], 'Consumer assertion and original cleanup both failed.', { cause: fixtureFailure });
          throw failure;
        }
      }
    }
  });
} finally {
  Piscina.prototype.destroy = nativeDestroy; hooks.deregister(); delete globalThis.__workerCleanupLogger;
  await fs.rm(dir, { recursive: true, force: true });
}
console.log(`Actual worker runtime ${selected} preserves original cleanup capability, category lease and precise failure presence.`);
