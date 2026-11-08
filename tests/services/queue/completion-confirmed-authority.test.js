import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createManualClock } from '../../helpers/manual-clock.js';
import { createQueueClaimFixture } from '../../helpers/queue-claim.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { createQueueWorker } from '../../../tools/service/indexer-service/queue-worker.js';
import { enqueueJob, claimNextJob, completeJob, loadQueue, saveQueue, getQueuePaths } from '../../../tools/service/queue.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const originalError = console.error;
console.error = () => {};
try {
  for (const scenario of ['fast', 'renewal', 'pending-close', 'telemetry', 'same-expiry', 'late-extension', 'rollback']) {
    const clock = createManualClock(), nativePerformance = Object.getOwnPropertyDescriptor(performance, 'now');
    Object.defineProperty(performance, 'now', { configurable: true, value: clock.now });
    const producer = deferred(), pending = deferred(), renewal = deferred(), telemetry = deferred();
    const phases = []; let returned = false, signal, claim, finalized = 0, settled = false;
    const metrics = { processed: 0, succeeded: 0, failed: 0, retried: 0 };
    const worker = createQueueWorker({ queueDir: 'closed-authority-fixture', resolvedQueueName: 'index', staleQueueMaxRetries: 0,
      monitorBuildProgress: false, startBuildProgressMonitor: () => async () => {},
      requeueStaleJobs: async () => {}, ensureQueueDir: async () => {}, loadJobReplayState: async () => ({}),
      claimNextJob: async (_dir, _queue, options) => {
        claim = createQueueClaimFixture({ id: 'closeout' }, options); return claim;
      },
      resolveLeasePolicy: () => ({ leaseMs: 1000, renewIntervalMs: 250 }),
      touchJobHeartbeat: async () => {
        phases.push('renewal-start');
        if (['renewal', 'same-expiry', 'late-extension', 'rollback'].includes(scenario)) await renewal.promise;
        return scenario === 'late-extension' ? { ...claim, lease: { ...claim.lease,
          expiresAt: new Date(Date.now() + 5000).toISOString() } } : claim;
      },
      executeClaimedJob: async ({ abortSignal, jobLifecycle }) => {
        signal = abortSignal;
        jobLifecycle.registerCleanup(() => { phases.push('close-hooks'); });
        if (scenario === 'pending-close') jobLifecycle.registerPromise(pending.promise, { label: 'original pending closeout work' });
        await producer.promise; returned = true; phases.push('producer-success');
        return { handled: false, runResult: { exitCode: 0 } };
      },
      updateShutdownWorkerState: async () => {
        if (returned) { phases.push('shutdown-telemetry'); if (scenario === 'telemetry') await telemetry.promise; }
      },
      finalizeJobRun: async ({ metrics: current }) => { phases.push('finalization'); finalized++; current.succeeded++; },
      buildDefaultRunResult: () => ({ exitCode: 1 }), printPayload() {} });
    const work = worker.processQueueOnce(metrics).finally(() => { settled = true; });
    try {
      await clock.settle(); assert.ok(signal);
      const authorityTimers = new Set(clock.timers.values());
      assert.equal(authorityTimers.size, 2, 'the claim owns exactly its renewal interval and confirmed-expiry deadline');
      if (scenario !== 'fast') await clock.advance(250);
      producer.resolve(); await clock.settle();
      assert.ok(phases.includes('close-hooks'));
      if (scenario !== 'fast') {
        assert.equal(settled, false, `${scenario}: the original drain remains held`);
        const drainingTimers = [...clock.timers.values()];
        assert.ok(drainingTimers.every(timer => !authorityTimers.has(timer)),
          'both original renewal/expiry timers are stopped before joining closeout work');
        assert.equal(drainingTimers.length, scenario === 'telemetry' ? 0 : 1);
        if (drainingTimers.length) assert.equal(drainingTimers[0].interval, 1000,
          'awaitWithKeepalive owns the sole referenced timer while the original lifecycle drains');
        assert.equal(signal.aborted, false, 'producer returned before confirmed authority expired');
        await clock.advance(1000); phases.push('expiry-crossed');
        if (scenario === 'rollback') Date.now = () => clock.now() - 1000;
      }
      pending.resolve(); renewal.resolve(); telemetry.resolve(); await work;
      assert.equal(finalized, scenario === 'fast' ? 1 : 0);
      assert.equal(metrics.succeeded, scenario === 'fast' ? 1 : 0);
      assert.equal(metrics.failed, scenario === 'fast' ? 0 : 1);
      assert.equal(signal.aborted, scenario !== 'fast');
      if (scenario !== 'fast') assert.equal(signal.reason.code, 'QUEUE_LEASE_EXPIRED');
      console.log(JSON.stringify({ scenario, phases, metrics, retainedTimers: clock.timers.size }));
    } finally {
      producer.resolve(); pending.resolve(); renewal.resolve(); telemetry.resolve(); await work;
      clock.restore();
      if (nativePerformance) Object.defineProperty(performance, 'now', nativePerformance);
      else delete performance.now;
    }
    assert.equal(clock.timers.size, 0);
  }

  const { dir } = await prepareIsolatedTestCacheDir('locked-queue-completion-authority');
  const nativeNow = Date.now, nativeRead = fs.readFile;
  try {
    for (const scenario of ['future', 'equal', 'expired', 'load-race', 'replacement-owner', 'replacement-version']) {
      const queueDir = path.join(dir, scenario);
      await enqueueJob(queueDir, { id: `authority-${scenario}`, repo: dir, repoRoot: dir, mode: 'code', reason: 'test' }, null, 'index');
      const claim = await claimNextJob(queueDir, 'index', { ownerId: 'worker-original', leaseMs: 10000 });
      const expiry = Date.parse(claim.lease.expiresAt), before = await loadQueue(queueDir, 'index');
      const { queuePath } = getQueuePaths(queueDir, 'index');
      if (scenario.startsWith('replacement-')) {
        if (scenario.endsWith('owner')) before.jobs[0].lease.owner = 'worker-replacement';
        else before.jobs[0].lease.version++;
        await saveQueue(queueDir, before, 'index');
      }
      const originalBytes = await fs.readFile(queuePath, 'utf8');
      if (scenario === 'equal') Date.now = () => expiry;
      if (scenario === 'expired') Date.now = () => expiry + 1;
      let raced = false;
      if (scenario === 'load-race') fs.readFile = async function (file, ...args) {
        const value = await nativeRead.call(this, file, ...args);
        if (path.resolve(String(file)) === path.resolve(queuePath)) { raced = true; Date.now = () => expiry; }
        return value;
      };
      try {
        const completion = completeJob(queueDir, claim.id, 'done', { exitCode: 0 }, 'index', {
          ownerId: 'worker-original', expectedLeaseVersion: claim.lease.version });
        if (scenario === 'future') assert.equal((await completion).status, 'done');
        else await assert.rejects(completion, { code: scenario === 'replacement-owner' ? 'QUEUE_LEASE_MISMATCH'
          : scenario === 'replacement-version' ? 'QUEUE_LEASE_VERSION_MISMATCH' : 'QUEUE_LEASE_EXPIRED' });
      } finally { Date.now = nativeNow; fs.readFile = nativeRead; }
      if (scenario === 'load-race') assert.equal(raced, true);
      if (scenario !== 'future') assert.equal(await fs.readFile(queuePath, 'utf8'), originalBytes, 'denied completion cannot alter the same or replacement claim');
    }
  } finally { Date.now = nativeNow; fs.readFile = nativeRead; await fs.rm(dir, { recursive: true, force: true }); }
} finally { console.error = originalError; }
console.log('Confirmed authority survives original closeout drains and is fenced again inside the actual locked terminal transition.');
