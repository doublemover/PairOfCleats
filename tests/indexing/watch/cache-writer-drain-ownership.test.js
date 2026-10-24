import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { acquireIndexLock } from '../../../src/index/build/lock.js';
import { drainCacheWriters } from '../../../src/index/build/cache-writer-drain.js';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { createTempWatchRepo, createWatchDeps, createWatchRuntime, startCodeWatch } from './helpers.js';

for (const scenario of ['drained', 'timed-out', 'pending-child']) {
  const timedOut = scenario === 'timed-out';
  const pendingChild = scenario === 'pending-child';
  const fixture = await createTempWatchRepo({ prefix: 'poc-watch-writer-drain-', files: {
    input: { rel: 'input.js', content: 'export const input=1;\n' }
  } });
  const runtime = await createWatchRuntime({ repoRoot: fixture.repoRoot });
  runtime.scheduler = createBuildScheduler({ enabled: true, cpuTokens: 1 });
  runtime.cleanupTimeoutMs = timedOut ? 20 : 1000;
  let entered, release, shutdown, ownerLock, ownerRuntime, running;
  const began = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const stopping = new Promise(resolve => { shutdown = resolve; });
  const marker = path.join(runtime.repoCacheRoot, 'writer-finished');
  const operationError = Object.assign(new Error('original watch build failure'), { code: 'ERR_WATCH_FIXTURE_BUILD' });
  if (pendingChild) Object.assign(operationError, { cacheOwnershipPending: true,
    result: { termination: { scope: 'spawned-child-close-only', closeObserved: false, closeTimedOut: true } } });
  const { deps, getOnEvent } = createWatchDeps({ entries: [fixture.files.input],
    buildIndexForMode: async ({ runtime: attempt }) => {
      ownerRuntime = attempt;
      if (pendingChild) throw operationError;
      running = attempt.scheduler.schedule('cache-write', { cpu: 1 }, async () => {
        entered(); await held; await fs.writeFile(marker, 'complete');
      });
      await began;
      throw operationError;
    } });
  deps.acquireIndexLockWithBackoff = async input => {
    ownerLock = await acquireIndexLock({ repoCacheRoot: input.repoCacheRoot, requireSettlement: true }); return ownerLock;
  };
  const watch = startCodeWatch({ runtime, deps, onStateChange: state => {
    if (state.shutdownSignal === 'cache-writer-teardown') shutdown();
  } });
  const outcome = watch.watchPromise.then(value => ({ value }), error => ({ error }));
  try {
    await watch.ready;
    await getOnEvent()({ type: 'change', absPath: fixture.files.input.abs });
    await stopping;
    assert.ok(ownerRuntime.cacheWriterLease.assertOwned(runtime.repoCacheRoot));
    assert.equal(await acquireIndexLock({ repoCacheRoot: runtime.repoCacheRoot }), null, 'contender cannot enter while a watch writer is live');
    if (pendingChild) {
      const result = await outcome;
      assert.equal(result.error, operationError, 'pending ownership preserves the original typed operational error');
      assert.ok(ownerRuntime.cacheWriterLease.assertOwned(runtime.repoCacheRoot));
      assert.equal(await acquireIndexLock({ repoCacheRoot: runtime.repoCacheRoot }), null,
        'idle scheduler controls cannot release a lease whose child close remains unobserved');
      // The marker consumer does not claim a full process-tree reap. Upstream
      // subprocess acceptance separately proves actual child-close observation.
      ownerRuntime.cacheWriterLease.invalidate(); await ownerLock.release();
    } else if (timedOut) {
      const result = await outcome;
      assert.equal(result.error.code, operationError.code);
      assert.equal(result.error.cause, operationError, 'cleanup failure preserves the operational error');
      assert.equal(result.error.cleanupError.code, 'ERR_SCHEDULER_DRAIN_TIMEOUT');
      assert.ok(ownerRuntime.cacheWriterLease.assertOwned(runtime.repoCacheRoot), 'incomplete drain preserves lease authority');
      assert.equal(await acquireIndexLock({ repoCacheRoot: runtime.repoCacheRoot }), null);
      release(); await running;
      // The failed watch keeps ownership. This task-owned fixture explicitly
      // reaps its stopped controls before releasing that retained test lease.
      await runtime.scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 });
      ownerRuntime.cacheWriterLease.invalidate(); await ownerLock.release();
    } else {
      let done = false; outcome.then(() => { done = true; });
      await Promise.resolve(); assert.equal(done, false);
      release(); await running;
      assert.equal((await outcome).error, operationError);
      assert.equal(await fs.readFile(marker, 'utf8'), 'complete');
    }
    const contender = await acquireIndexLock({ repoCacheRoot: runtime.repoCacheRoot });
    assert.ok(contender); await contender.release();
  } finally {
    release?.(); await running?.catch(() => {});
    watch.abortController.abort(); await outcome;
    await runtime.scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 });
    ownerRuntime?.cacheWriterLease?.invalidate(); await ownerLock?.release();
    await fs.rm(fixture.tempRoot, { recursive: true, force: true });
  }
}
const workers = [new Worker('setInterval(() => {}, 1000)', { eval: true }), new Worker('setInterval(() => {}, 1000)', { eval: true })];
try {
  await Promise.all(workers.map(worker => once(worker, 'online')));
  const owners = workers.map(worker => ({
    stats: () => ({ activeTasks: 0, queuedTasks: 0 }),
    destroy: () => worker.terminate()
  }));
  let registryDrained = false;
  await drainCacheWriters({ workerPool: owners[0], quantizePool: owners[1], cacheWriterDrain: () => {
    assert.ok(workers.every(worker => worker.threadId === -1), 'both distinct worker owners terminate before registry confirmation');
    registryDrained = true;
  } }, { shutdown: true, timeoutMs: 1000 });
  assert.equal(registryDrained, true);
} finally { await Promise.allSettled(workers.map(worker => worker.terminate())); }
console.log('Watch lease ownership joins live writers, retains ownership on drain failure, and preserves the original error.');
