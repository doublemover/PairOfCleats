#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createQueueWorker } from '../../../tools/service/indexer-service/queue-worker.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const buildWorker = ({
  claimedJob,
  executeMs,
  policy,
  touchImpl = async () => ({ ok: true })
}) => {
  const touched = [];
  let claimed = false;
  let finalized = 0;
  const worker = createQueueWorker({
    queueDir: 'queue-dir',
    resolvedQueueName: 'index',
    staleQueueMaxRetries: 1,
    monitorBuildProgress: false,
    startBuildProgressMonitor: () => async () => {},
    touchJobHeartbeat: async (...args) => {
      touched.push(args);
      return touchImpl(...args);
    },
    requeueStaleJobs: async () => ({ stale: 0, retried: 0, failed: 0 }),
    claimNextJob: async () => {
      if (claimed) return null;
      claimed = true;
      return {
        ...claimedJob,
        lease: {
          owner: 'queue-worker:test',
          version: 1
        }
      };
    },
    ensureQueueDir: async () => {},
    executeClaimedJob: async () => {
      await sleep(executeMs);
      return {
        handled: false,
        runResult: {
          exitCode: 0,
          signal: null,
          executionMode: 'subprocess',
          daemon: null
        }
      };
    },
    finalizeJobRun: async () => {
      finalized += 1;
    },
    buildDefaultRunResult: () => ({
      exitCode: 1,
      executionMode: 'subprocess',
      daemon: null
    }),
    printPayload: () => {},
    resolveLeasePolicy: () => policy,
    jobHeartbeatIntervalMs: 5
  });
  return { worker, touched, getFinalized: () => finalized };
};

const slowCase = buildWorker({
  claimedJob: { id: 'slow-job', repo: '/tmp/repo', stage: 'stage3' },
  executeMs: 650,
  policy: {
    leaseMs: 1200,
    renewIntervalMs: 250,
    progressIntervalMs: 250,
    workloadClass: 'slow',
    maxRenewalGapMs: 750,
    maxConsecutiveRenewalFailures: 3
  }
});
await slowCase.worker.processQueueOnce({ processed: 0, succeeded: 0, failed: 0, retried: 0 });
assert.equal(slowCase.getFinalized(), 1, 'expected slow job to finalize');
assert.equal(slowCase.touched.length >= 2, true, 'expected slow job to renew multiple times');

const burstyCase = buildWorker({
  claimedJob: { id: 'bursty-job', repo: '/tmp/repo', stage: 'stage2' },
  executeMs: 260,
  policy: {
    leaseMs: 1200,
    renewIntervalMs: 300,
    progressIntervalMs: 250,
    workloadClass: 'bursty',
    maxRenewalGapMs: 900,
    maxConsecutiveRenewalFailures: 3
  }
});
await burstyCase.worker.processQueueOnce({ processed: 0, succeeded: 0, failed: 0, retried: 0 });
assert.equal(burstyCase.getFinalized(), 1, 'expected bursty job to finalize');
assert.equal(burstyCase.touched.length <= 1, true, 'expected bounded renewal writes for bursty job');

let renewalFailures = 0;
const renewalLossCase = buildWorker({
  claimedJob: { id: 'loss-job', repo: '/tmp/repo', stage: 'stage3' },
  executeMs: 350,
  policy: {
    leaseMs: 1200,
    renewIntervalMs: 250,
    progressIntervalMs: 250,
    workloadClass: 'slow',
    maxRenewalGapMs: 750,
    maxConsecutiveRenewalFailures: 2
  },
  touchImpl: async () => {
    renewalFailures += 1;
    throw new Error('synthetic renewal loss');
  }
});
await renewalLossCase.worker.processQueueOnce({ processed: 0, succeeded: 0, failed: 0, retried: 0 });
assert.equal(renewalLossCase.getFinalized(), 1, 'expected renewal loss to avoid crashing job finalization');
assert.equal(renewalFailures >= 1, true, 'expected renewal loss path to attempt renewals');

console.log('service queue worker renewal test passed');
