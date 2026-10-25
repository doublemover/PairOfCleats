import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { createQueueWorker } from '../../../tools/service/indexer-service/queue-worker.js';
import { createQueueClaimFixture } from '../../helpers/queue-claim.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const base = { queueDir: 'claim-generation-fixture', resolvedQueueName: 'index', staleQueueMaxRetries: 0,
  monitorBuildProgress: false, startBuildProgressMonitor: () => async () => {},
  touchJobHeartbeat: async () => {}, requeueStaleJobs: async () => {}, ensureQueueDir: async () => {},
  buildDefaultRunResult: () => ({ exitCode: 1 }), printPayload: () => {} };

{
  const newerStarted = deferred(), releaseNewer = deferred(), fatalClaim = deferred();
  const failure = new Error('fatal claim after older generation settles');
  let claims = 0, newerSignal, settled = false;
  const updates = [], finalized = [];
  const worker = createQueueWorker({ ...base,
    claimNextJob: async (_dir, _queue, options) => {
      claims++;
      if (claims > 2) { fatalClaim.resolve(); throw failure; }
      return createQueueClaimFixture({ id: 'reused-id', repo: 'fixture-repo', lease: { version: claims } }, options);
    },
    executeClaimedJob: async ({ job, abortSignal, jobLifecycle }) => {
      if (job.lease.version === 1) {
        await newerStarted.promise;
        return { handled: false, runResult: { exitCode: 0 } };
      }
      newerSignal = abortSignal;
      jobLifecycle.registerCleanup(async () => { await releaseNewer.promise; });
      newerStarted.resolve();
      await releaseNewer.promise;
      return { handled: false, runResult: { exitCode: 130, cancelled: true } };
    },
    finalizeJobRun: async ({ job }) => { finalized.push(job.lease.version); },
    updateShutdownWorkerState: async patch => { updates.push(patch); }
  });
  const completion = worker.runBatch(2).then(() => null, error => error).finally(() => { settled = true; });
  try {
    await fatalClaim.promise; await turn();
    assert.equal(newerSignal.aborted, true, 'retiring an old claim cannot erase the newer generation cancellation owner');
    assert.equal(settled, false, 'batch must join the exact newer execution and delayed cleanup');
    assert.deepEqual(updates.at(-1).activeJobs, ['reused-id'], 'shutdown telemetry retains the still-owned ID');
  } finally { releaseNewer.resolve(); }
  assert.equal(await completion, failure);
  assert.deepEqual(finalized, [1, 2]);
  assert.deepEqual(updates.at(-1).activeJobs, []);
}

for (const kind of ['owner', 'version', 'transition', 'missing', 'not-running']) {
  const started = deferred(), finish = deferred();
  const originalInterval = globalThis.setInterval, originalClearInterval = globalThis.clearInterval;
  const originalError = console.error;
  const timers = new Set(), diagnostics = [];
  let heartbeat, signal, finalized = 0, renewalCalls = 0, cleanup = 0;
  globalThis.setInterval = callback => { const timer = { callback }; timers.add(timer); heartbeat = timer; return timer; };
  globalThis.clearInterval = timer => { timers.delete(timer); };
  console.error = (...args) => { diagnostics.push(args.join(' ')); };
  try {
    const worker = createQueueWorker({ ...base,
      claimNextJob: async (_dir, _queue, options) => createQueueClaimFixture({ id: kind, repo: 'fixture-repo',
        lease: { version: 7 } }, options),
      touchJobHeartbeat: async (_dir, _id, _queue, options) => {
        renewalCalls++; assert.equal(options.expectedLeaseVersion, 7);
        if (kind === 'missing') return null;
        if (kind === 'not-running') return { id: kind, status: 'queued' };
        throw Object.assign(new Error(`original ${kind} lease fence`), { code: kind === 'owner'
          ? 'QUEUE_LEASE_MISMATCH' : kind === 'version' ? 'QUEUE_LEASE_VERSION_MISMATCH' : 'QUEUE_INVALID_TRANSITION' });
      },
      executeClaimedJob: async ({ abortSignal, jobLifecycle }) => {
        signal = abortSignal;
        jobLifecycle.registerCleanup(() => { cleanup++; });
        started.resolve(); await finish.promise;
        // A late nominal result cannot supersede the queue owner's lease fence.
        return { handled: false, runResult: { exitCode: 0 } };
      },
      finalizeJobRun: async () => { finalized++; }, resolveLeasePolicy: () => ({ renewIntervalMs: 250 })
    });
    const work = worker.processQueueOnce({ processed: 0, succeeded: 0, failed: 0, retried: 0 });
    await started.promise;
    heartbeat.callback(); await turn();
    assert.equal(signal.aborted, true, `${kind}: definitive lease loss must cancel the original execution`);
    assert.equal(timers.size, 0, `${kind}: no further renewal after a definitive fence`);
    heartbeat.callback(); await turn(); assert.equal(renewalCalls, 1);
    finish.resolve(); assert.equal(await work, true);
    assert.equal(cleanup, 1); assert.equal(finalized, 0, `${kind}: stale results cannot reach completion policy`);
    assert.ok(diagnostics.some(line => line.includes('completion skipped after lease loss')));
  } finally {
    finish.resolve();
    globalThis.setInterval = originalInterval; globalThis.clearInterval = originalClearInterval;
    console.error = originalError;
  }
}
console.log('queue cancellation, retirement and definitive renewal fences belong to exact claim generations');
