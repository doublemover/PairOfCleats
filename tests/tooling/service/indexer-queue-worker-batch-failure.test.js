import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createQueueWorker } from '../../../tools/service/indexer-service/queue-worker.js';
import { createQueueClaimFixture } from '../../helpers/queue-claim.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

for (const failure of ['claim', 'completion', 'secondary-completion', 'late-claim', 'late-start']) {
  const started = deferred(), fatal = deferred(), cleanup = deferred(), finalized = deferred();
  const lateClaim = deferred();
  const firstError = Object.assign(new Error('first fatal persistence failure'), { code: 'EIO' });
  const secondError = new Error('secondary completion failure');
  const events = [];
  let claims = 0, siblingSignal, returned = false, active = false;
  const worker = createQueueWorker({
    queueDir: 'fixture-queue', resolvedQueueName: 'index', staleQueueMaxRetries: 0,
    monitorBuildProgress: false, startBuildProgressMonitor: () => async () => {},
    touchJobHeartbeat: async () => {}, requeueStaleJobs: async () => {}, ensureQueueDir: async () => {},
    claimNextJob: async (_dir, _queue, options) => {
      claims++;
      if (claims === 1) return createQueueClaimFixture({ id: 'first', repo: 'fixture-repo' }, options);
      if (claims === 2) {
        if (failure === 'claim') {
          await started.promise;
          fatal.resolve();
          throw firstError;
        }
        if (failure === 'late-claim') await lateClaim.promise;
        return createQueueClaimFixture({ id: 'sibling', repo: 'fixture-repo' }, options);
      }
      throw new Error('must not claim new work after fatal failure');
    },
    executeClaimedJob: async ({ job, abortSignal, jobLifecycle }) => {
      if (job.id === 'first' && failure !== 'claim') {
        if (failure !== 'late-claim') await started.promise;
        return { handled: false, runResult: { exitCode: 0 } };
      }
      assert.ok(!['late-claim', 'late-start'].includes(failure),
        'a claim or setup already in flight must finalize cancelled without execution');
      siblingSignal = abortSignal;
      active = true;
      events.push('sibling-start');
      jobLifecycle.registerCleanup(async () => {
        await cleanup.promise;
        active = false;
        events.push('cleanup-settled');
      });
      started.resolve();
      await new Promise(resolve => {
        if (abortSignal.aborted) resolve();
        else abortSignal.addEventListener('abort', resolve, { once: true });
        // Release the original fail-before implementation without leaking timers.
        cleanup.promise.then(resolve);
      });
      return { handled: false, runResult: { exitCode: 130, cancelled: true } };
    },
    finalizeJobRun: async ({ job, runResult }) => {
      if (job.id === 'first' && failure !== 'claim') {
        events.push('fatal');
        fatal.resolve();
        throw firstError;
      }
      if (['late-claim', 'late-start'].includes(failure)) assert.equal(runResult.cancelled, true);
      events.push('sibling-finalized');
      finalized.resolve();
      if (failure === 'secondary-completion') throw secondError;
    },
    buildDefaultRunResult: () => ({ exitCode: 1, cancelled: false }), printPayload: () => {},
    updateShutdownWorkerState: async patch => {
      if (failure === 'late-start' && patch.activeJobs.length === 2 && patch.activeJobs.includes('sibling')) {
        started.resolve();
        await lateClaim.promise;
      }
      if (patch.status === 'stopped') {
        assert.equal(active, false, 'stopped must follow owned cleanup');
        events.push('stopped');
      }
    }
  });
  const result = worker.runWorkLoop({ requestedConcurrency: 2, intervalMs: 1, serviceExecutionMode: 'subprocess' })
    .then(() => { returned = true; return null; }, error => { returned = true; return error; });
  try {
    await fatal.promise;
    await setImmediate();
    if (['late-claim', 'late-start'].includes(failure)) lateClaim.resolve();
    else assert.equal(siblingSignal.aborted, true, 'fatal lane must cancel sibling execution');
    assert.equal(returned, false, 'batch must await delayed abort cleanup or an in-flight claim/setup');
    cleanup.resolve();
    const error = await result;
    if (failure === 'secondary-completion') {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.cause, firstError);
      assert.deepEqual(error.errors, [firstError, secondError]);
    } else assert.equal(error, firstError);
    assert.equal(claims, 2, 'no fresh claim after the fatal lane');
    assert.ok(events.indexOf('stopped') > events.indexOf('sibling-finalized'));
  } finally {
    cleanup.resolve();
    lateClaim.resolve();
    await result;
    await finalized.promise;
  }
}
console.log('fatal queue lanes cancel and await sibling execution, lifecycle and completion before stopping');
