#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createQueueWorker } from '../../../tools/service/indexer-service/queue-worker.js';

const payloads = [];
let claimed = false;
const worker = createQueueWorker({
  queueDir: 'queue-dir',
  resolvedQueueName: 'index',
  staleQueueMaxRetries: 1,
  monitorBuildProgress: false,
  startBuildProgressMonitor: () => async () => {},
  touchJobHeartbeat: async () => ({ ok: true }),
  requeueStaleJobs: async () => ({ stale: 0, retried: 0, failed: 0, quarantined: 0 }),
  claimNextJob: async () => {
    if (claimed) return null;
    claimed = true;
    return {
      id: 'job-a',
      repo: '/tmp/repo',
      stage: 'stage1',
      lease: {
        owner: 'worker-metrics',
        version: 1
      }
    };
  },
  ensureQueueDir: async () => {},
  executeClaimedJob: async () => ({
    handled: false,
    runResult: {
      exitCode: 0,
      signal: null,
      executionMode: 'subprocess',
      daemon: null
    }
  }),
  finalizeJobRun: async ({ metrics }) => {
    metrics.succeeded += 1;
  },
  buildDefaultRunResult: () => ({
    exitCode: 1,
    executionMode: 'subprocess',
    daemon: null
  }),
  printPayload: (payload) => {
    payloads.push(payload);
  },
  summarizeBackpressure: async () => ({
    state: 'congested',
    reasons: ['max_running'],
    slo: {
      state: 'degraded',
      actions: {
        enqueue: 'defer-heavy',
        workerMode: 'priority-only'
      }
    }
  }),
  resolveLeasePolicy: () => ({
    leaseMs: 1000,
    renewIntervalMs: 250,
    progressIntervalMs: 250,
    workloadClass: 'balanced',
    maxRenewalGapMs: 750,
    maxConsecutiveRenewalFailures: 3
  }),
  jobHeartbeatIntervalMs: 250
});

await worker.runBatch(1);
assert.equal(payloads.length, 1, 'expected one worker batch payload');
assert.equal(payloads[0].backpressure?.state, 'congested', 'expected worker metrics payload to include backpressure state');
assert.equal(payloads[0].backpressure?.reasons.includes('max_running'), true, 'expected worker metrics payload to include reasons');
assert.equal(payloads[0].backpressure?.slo?.state, 'degraded', 'expected worker metrics payload to include SLO state');
assert.equal(payloads[0].backpressure?.slo?.actions?.workerMode, 'priority-only', 'expected worker metrics payload to expose priority-only mode');

console.log('service queue worker backpressure metrics test passed');
