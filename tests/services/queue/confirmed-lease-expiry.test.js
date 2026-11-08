import assert from 'node:assert/strict';
import { createManualClock } from '../../helpers/manual-clock.js';
import { createQueueClaimFixture } from '../../helpers/queue-claim.js';
import { createLifecycleRegistry } from '../../../src/shared/lifecycle/registry.js';
import { startClaimRenewal } from '../../../tools/service/indexer-service/claim-renewal.js';
import { createQueueWorker } from '../../../tools/service/indexer-service/queue-worker.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const originalError = console.error, diagnostics = [];
console.error = (...args) => { diagnostics.push(args); };
try {
  for (const scenario of ['transient', 'reject', 'stuck-replay', 'stuck-heartbeat', 'same-expiry', 'late-success', 'rollback']) {
    const clock = createManualClock(), release = deferred();
    const lifecycle = createLifecycleRegistry({ name: `lease-${scenario}` });
    const job = createQueueClaimFixture({ id: 'same-job', lease: { version: 7 } }, { ownerId: 'worker-A', leaseMs: 1000 });
    const control = { jobId: job.id, abortController: new AbortController(), leaseLost: null };
    let aborts = 0, renewals = 0, reads = 0;
    control.abortController.signal.addEventListener('abort', () => { aborts++; });
    const receipt = () => ({ ...job, lease: { ...job.lease, expiresAt: new Date(Date.now() + 1000).toISOString() } });
    try {
      startClaimRenewal({ job, ownerId: 'worker-A', jobLifecycle: lifecycle, claimControl: control,
        leasePolicy: { leaseMs: 1000, renewIntervalMs: 250 }, now: clock.now,
        loadReplayState: async () => { reads++; if (scenario === 'stuck-replay') await release.promise; return {}; },
        touchHeartbeat: async options => {
          renewals++;
          assert.equal(options.ownerId, 'worker-A'); assert.equal(options.expectedLeaseVersion, 7);
          if (scenario === 'reject' || (scenario === 'transient' && renewals === 1)) throw new Error('controlled temporary storage failure');
          if (scenario === 'stuck-heartbeat' || scenario === 'late-success') await release.promise;
          return scenario === 'same-expiry' || scenario === 'rollback' ? job : receipt();
        } });
      await clock.advance(250);
      if (scenario === 'rollback') Date.now = () => clock.now() - 500;
      await clock.advance(700);
      if (scenario === 'transient') {
        assert.equal(control.abortController.signal.aborted, false);
        assert.ok(Date.parse(control.leaseDiagnostics().lastConfirmedExpiry) > Date.parse(job.lease.expiresAt));
        await clock.advance(1000); assert.equal(control.abortController.signal.aborted, false);
      } else {
        assert.equal(control.abortController.signal.aborted, true, scenario + ' loses authority at the independent deadline');
        assert.equal(control.leaseLost.code, 'QUEUE_LEASE_EXPIRED'); assert.equal(aborts, 1);
        const calls = renewals;
        const snapshot = control.leaseDiagnostics();
        assert.equal(snapshot.lastConfirmedExpiry, job.lease.expiresAt);
        assert.equal(snapshot.cleanupPending, true);
        if (scenario.startsWith('stuck-') || scenario === 'late-success') {
          assert.equal(reads, 1); assert.ok(snapshot.renewalInFlightAgeMs >= 700);
          let joined = false;
          const joining = lifecycle.close().then(() => { joined = true; });
          await clock.settle(); assert.equal(joined, false, 'expiry does not forge settlement of outstanding renewal I/O');
          release.resolve(); await joining; await clock.settle();
          assert.equal(control.checkLeaseAuthority(), false, 'late confirmation cannot revive the old execution');
          assert.equal(control.leaseDiagnostics().lastConfirmedExpiry, job.lease.expiresAt);
          if (scenario === 'stuck-replay') assert.equal(renewals, 0, 'no heartbeat admitted after stale replay read settles');
        }
        await clock.advance(2000); assert.equal(renewals, calls); assert.equal(aborts, 1);
      }
    } finally { release.resolve(); await lifecycle.close(); await clock.settle(); clock.restore(); }
    assert.equal(clock.timers.size, 0);
  }

  {
    const clock = createManualClock(), lifecycles = [], controls = [];
    try {
      for (const version of [1, 2]) {
        const lifecycle = createLifecycleRegistry({ name: `same-id-${version}` }); lifecycles.push(lifecycle);
        const job = createQueueClaimFixture({ id: 'reused-id', lease: { version } }, { ownerId: `worker-${version}`, leaseMs: 1000 });
        const control = { abortController: new AbortController() }; controls.push(control);
        startClaimRenewal({ job, ownerId: job.lease.owner, jobLifecycle: lifecycle, claimControl: control,
          leasePolicy: { leaseMs: 1000, renewIntervalMs: 250 }, now: clock.now, loadReplayState: async () => null,
          touchHeartbeat: async () => {
            if (version === 1) throw new Error('old claim cannot confirm');
            return { ...job, lease: { ...job.lease, expiresAt: new Date(Date.now() + 1000).toISOString() } };
          } });
      }
      await clock.advance(950);
      assert.equal(controls[0].abortController.signal.aborted, true);
      assert.equal(controls[1].abortController.signal.aborted, false);
      await lifecycles[0].close(); await clock.advance(500);
      assert.equal(controls[1].abortController.signal.aborted, false, 'old claim retirement cannot cancel replacement claim');
    } finally { await Promise.all(lifecycles.map(lifecycle => lifecycle.close())); await clock.settle(); clock.restore(); }
    assert.equal(clock.timers.size, 0);
  }

  {
    const clock = createManualClock(), replay = deferred(), cleanup = deferred();
    let signal, finalizeCalls = 0, touchCalls = 0, settled = false;
    const updates = [], metrics = { processed: 0, succeeded: 0, failed: 0, retried: 0 };
    const worker = createQueueWorker({ queueDir: 'expiry-fixture', resolvedQueueName: 'index', staleQueueMaxRetries: 0,
      monitorBuildProgress: false, startBuildProgressMonitor: () => async () => {},
      claimNextJob: async (_dir, _queue, options) => createQueueClaimFixture({ id: 'owned' }, options),
      requeueStaleJobs: async () => {}, ensureQueueDir: async () => {}, loadJobReplayState: () => replay.promise,
      touchJobHeartbeat: async () => { touchCalls++; },
      resolveLeasePolicy: () => ({ leaseMs: 1000, renewIntervalMs: 5000 }),
      executeClaimedJob: async ({ abortSignal, jobLifecycle }) => {
        signal = abortSignal; jobLifecycle.registerCleanup(() => cleanup.promise);
        await new Promise(resolve => abortSignal.addEventListener('abort', resolve, { once: true }));
        return { handled: false, runResult: { exitCode: 0 } };
      },
      finalizeJobRun: async () => { finalizeCalls++; }, buildDefaultRunResult: () => ({ exitCode: 1 }), printPayload: () => {},
      updateShutdownWorkerState: async update => { updates.push(update); } });
    const work = worker.processQueueOnce(metrics).finally(() => { settled = true; });
    try {
      await clock.settle(); assert.ok(signal);
      await clock.advance(950);
      assert.equal(signal.aborted, true); assert.equal(settled, false);
      assert.deepEqual(updates.at(-1).activeJobs, ['owned']);
      replay.resolve({}); await clock.settle(); assert.equal(settled, false);
      cleanup.resolve(); await work;
      assert.equal(finalizeCalls, 0); assert.equal(touchCalls, 0);
      assert.equal(metrics.failed, 1); assert.equal(metrics.succeeded, 0);
      assert.deepEqual(updates.at(-1).activeJobs, []);
    } finally { replay.resolve({}); cleanup.resolve(); await work; await clock.settle(); clock.restore(); }
    assert.equal(clock.timers.size, 0);
  }
  for (const malformed of [{}, { owner: 'wrong', version: 1, expiresAt: new Date(Date.now() + 1000).toISOString() }]) {
    const lifecycle = createLifecycleRegistry(), control = { abortController: new AbortController() };
    startClaimRenewal({ job: { id: 'unconfirmed', status: 'running', lease: malformed }, ownerId: 'expected',
      leasePolicy: { leaseMs: 1000 }, jobLifecycle: lifecycle, claimControl: control,
      loadReplayState: async () => assert.fail('no replay work without authority'), touchHeartbeat: async () => assert.fail('no heartbeat without authority') });
    assert.equal(control.leaseLost.code, 'QUEUE_LEASE_UNCONFIRMED');
    assert.equal(control.abortController.signal.aborted, true); await lifecycle.close();
  }
  assert.ok(diagnostics.some(args => args[1]?.event === 'queue-lease-authority-lost'
    && args[1].cleanupPending && args[1].lastConfirmedExpiry));
} finally { console.error = originalError; }
console.log('Confirmed queue authority expires independently of renewal I/O and remains fenced through exact cleanup.');
