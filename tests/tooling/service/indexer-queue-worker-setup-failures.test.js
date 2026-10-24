#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createQueueWorker } from '../../../tools/service/indexer-service/queue-worker.js';

for (const failure of ['monitor', 'initial-state', 'final-state']) {
  const timers = new Set(), updates = [], diagnostics = [];
  const originalSetInterval = globalThis.setInterval, originalClearInterval = globalThis.clearInterval;
  const originalError = console.error;
  let executions = 0, finalizations = 0, stopped = 0, renewals = 0, calls = 0, finalizedResult;
  globalThis.setInterval = (...args) => { const timer = originalSetInterval(...args); timers.add(timer); return timer; };
  globalThis.clearInterval = timer => { timers.delete(timer); originalClearInterval(timer); };
  console.error = (...args) => diagnostics.push(args.join(' '));
  try {
    const worker = createQueueWorker({
      queueDir: 'fixture-queue', resolvedQueueName: 'index', staleQueueMaxRetries: 2,
      monitorBuildProgress: true,
      startBuildProgressMonitor: () => {
        if (failure === 'monitor') throw Object.assign(new Error('monitor cache admission failed'),
          { code: 'ERR_REPO_CACHE_CLEANUP_BUSY' });
        return async () => { stopped++; };
      },
      touchJobHeartbeat: async () => { renewals++; }, requeueStaleJobs: async () => {},
      claimNextJob: async () => ({ id: 'one', repo: 'fixture-repo' }), ensureQueueDir: async () => {},
      executeClaimedJob: async () => { executions++; return { handled: false, runResult: { exitCode: 0 } }; },
      finalizeJobRun: async ({ runResult }) => { finalizations++; finalizedResult = runResult; },
      buildDefaultRunResult: () => ({ exitCode: 1 }), printPayload: () => {},
      updateShutdownWorkerState: async patch => {
        updates.push(patch); calls++;
        if ((failure === 'initial-state' && calls === 1) || (failure === 'final-state' && calls === 2)) {
          throw new Error(`${failure} write failed`);
        }
      },
      resolveLeasePolicy: () => ({ renewIntervalMs: 250 })
    });
    const outcome = await worker.processQueueOnce({ processed: 0, succeeded: 0, failed: 0, retried: 0 });
    assert.equal(outcome, true);
    assert.equal(finalizations, 1, `${failure}: claimed job must reach completion policy`);
    assert.equal(executions, failure === 'final-state' ? 1 : 0);
    assert.equal(finalizedResult.exitCode, failure === 'final-state' ? 0 : 1);
    assert.equal(timers.size, 0, `${failure}: every partially initialized heartbeat must close`);
    assert.deepEqual(updates.at(-1).activeJobs, [], `${failure}: active controls must clear`);
    assert.equal(stopped, failure === 'monitor' ? 0 : 1);
    assert.equal(diagnostics.length, 1, `${failure}: setup/state failure has one actionable diagnostic`);
    assert.match(diagnostics[0], failure === 'monitor' ? /cache admission failed/ : /write failed/);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(renewals, 0, `${failure}: no renewal survives disposal`);
  } finally {
    for (const timer of timers) originalClearInterval(timer);
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    console.error = originalError;
  }
}

{
  let renewalFinished = false, finalized = false, startRenewal;
  const renewalStarted = new Promise(resolve => { startRenewal = resolve; });
  const worker = createQueueWorker({
    queueDir: 'fixture-queue', resolvedQueueName: 'index', staleQueueMaxRetries: 2,
    monitorBuildProgress: false, startBuildProgressMonitor: () => async () => {},
    touchJobHeartbeat: async () => {
      startRenewal();
      await new Promise(resolve => setTimeout(resolve, 50));
      renewalFinished = true;
    },
    requeueStaleJobs: async () => {}, ensureQueueDir: async () => {},
    claimNextJob: async () => ({ id: 'drain', repo: 'fixture-repo' }),
    executeClaimedJob: async () => {
      await renewalStarted;
      return { handled: false, runResult: { exitCode: 0 } };
    },
    finalizeJobRun: async () => {
      assert.equal(renewalFinished, true, 'completion must await any outstanding lease write');
      finalized = true;
    },
    buildDefaultRunResult: () => ({ exitCode: 1 }), printPayload: () => {},
    resolveLeasePolicy: () => ({ renewIntervalMs: 250 })
  });
  await worker.processQueueOnce({ processed: 0, succeeded: 0, failed: 0, retried: 0 });
  assert.equal(finalized, true);
}
console.log('claimed job setup/state failures finalize and dispose every owned resource');
