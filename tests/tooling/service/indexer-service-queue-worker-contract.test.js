#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createQueueWorker } from '../../../tools/service/indexer-service/queue-worker.js';

const createSingleJobQueueWorker = ({
  executeClaimedJob,
  finalizeJobRun,
  printPayload
}) => createQueueWorker({
  queueDir: '/tmp/indexer-queue',
  resolvedQueueName: 'index',
  staleQueueMaxRetries: 2,
  monitorBuildProgress: false,
  startBuildProgressMonitor: () => async () => {},
  touchJobHeartbeat: async () => {},
  requeueStaleJobs: async () => {},
  ensureQueueDir: async () => {},
  claimNextJob: (() => {
    let claimed = false;
    return async () => {
      if (claimed) return null;
      claimed = true;
      return { id: 'job-1', repo: '/tmp/repo', stage: 'stage1' };
    };
  })(),
  executeClaimedJob,
  finalizeJobRun,
  buildDefaultRunResult: () => ({ exitCode: 1, signal: null, executionMode: 'subprocess', daemon: null }),
  printPayload
});

{
  let finalizeCalled = false;
  const payloads = [];
  const worker = createSingleJobQueueWorker({
    executeClaimedJob: async () => ({ handled: true }),
    finalizeJobRun: async () => { finalizeCalled = true; },
    printPayload: (payload) => payloads.push(payload)
  });
  await worker.runBatch(1);
  assert.equal(finalizeCalled, false, 'handled jobs should not call finalizeJobRun');
  assert.equal(payloads.length, 1, 'expected one metrics payload');
  assert.equal(payloads[0].metrics.processed, 1, 'expected one processed job');
  assert.equal(payloads[0].metrics.failed, 1, 'handled jobs should count as failed');
  assert.equal(payloads[0].metrics.succeeded, 0);
  assert.equal(payloads[0].metrics.retried, 0);
}

{
  let finalizeInput = null;
  const payloads = [];
  const worker = createSingleJobQueueWorker({
    executeClaimedJob: async () => {
      throw new Error('exploded before completion');
    },
    finalizeJobRun: async ({ runResult, metrics }) => {
      finalizeInput = runResult;
      metrics.failed += 1;
    },
    printPayload: (payload) => payloads.push(payload)
  });
  await worker.runBatch(1);
  assert.ok(finalizeInput, 'expected finalizeJobRun to run when executor throws');
  assert.equal(finalizeInput.exitCode, 1, 'thrown execution should be normalized as non-zero failure');
  assert.match(String(finalizeInput.error || ''), /exploded before completion/);
  assert.equal(payloads.length, 1, 'expected one metrics payload');
  assert.equal(payloads[0].metrics.failed, 1, 'thrown execution should count as failed');
}

console.log('indexer service queue-worker contract test passed');
