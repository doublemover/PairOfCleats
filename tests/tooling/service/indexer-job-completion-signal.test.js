#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createJobCompletion } from '../../../tools/service/indexer-service/job-completion.js';

const calls = [];
const quarantineCalls = [];
const metrics = { processed: 0, succeeded: 0, failed: 0, retried: 0 };

const completion = createJobCompletion({
  queueDir: '/tmp/queue',
  resolvedQueueName: 'index',
  queueMaxRetries: 1,
  completeJob: async (queueDir, jobId, status, result, queueName) => {
    calls.push({ queueDir, jobId, status, result, queueName });
  },
  quarantineJob: async (queueDir, jobId, reason, queueName, options) => {
    quarantineCalls.push({ queueDir, jobId, reason, queueName, options });
  }
});

const normalizedSignalFailure = completion.normalizeRunResult({
  exitCode: 1,
  signal: 'SIGTERM',
  executionMode: 'subprocess'
});
assert.equal(normalizedSignalFailure.status, 'failed');
assert.equal(normalizedSignalFailure.signal, 'SIGTERM');

await completion.finalizeJobRun({
  job: { id: 'job-1', attempts: 0, maxRetries: 0 },
  runResult: { exitCode: 1, signal: 'SIGTERM', executionMode: 'subprocess' },
  metrics
});
assert.equal(quarantineCalls[0].reason, 'retry-exhausted');
assert.equal(quarantineCalls[0].options.result.signal, 'SIGTERM');
assert.equal(quarantineCalls[0].options.result.error, 'signal SIGTERM');
assert.equal(metrics.failed, 1);

calls.length = 0;
quarantineCalls.length = 0;
await completion.finalizeJobRun({
  job: { id: 'job-2', attempts: 0, maxRetries: 2 },
  runResult: { exitCode: 1, signal: 'SIGINT', executionMode: 'subprocess' },
  metrics
});
assert.equal(calls[0].status, 'queued');
assert.equal(calls[0].result.retry, true);
assert.equal(calls[0].result.signal, 'SIGINT');
assert.equal(calls[0].result.error, 'signal SIGINT');
assert.equal(metrics.retried, 1);

const normalizedSuccess = completion.normalizeRunResult({
  exitCode: 0,
  signal: null,
  executionMode: 'daemon'
});
assert.equal(normalizedSuccess.status, 'done');
assert.equal(normalizedSuccess.signal, null);

const normalizedStringExit = completion.normalizeRunResult({
  exitCode: '2',
  signal: null,
  executionMode: 'subprocess'
});
assert.equal(normalizedStringExit.exitCode, 2);
assert.equal(normalizedStringExit.status, 'failed');

calls.length = 0;
await completion.finalizeJobRun({
  job: { id: 'job-3', attempts: 0, maxRetries: 0 },
  runResult: { exitCode: 0, signal: null, executionMode: 'daemon' },
  metrics
});
assert.equal(calls[0].status, 'done');
assert.equal(calls[0].result.error, null, 'successful jobs should not emit failure error strings');
assert.equal(metrics.succeeded, 1);

calls.length = 0;
quarantineCalls.length = 0;
await completion.finalizeJobRun({
  job: { id: 'job-4', attempts: '1', maxRetries: '2' },
  runResult: { exitCode: 1, signal: null, executionMode: 'subprocess' },
  metrics
});
assert.equal(calls[0].status, 'queued', 'string attempts/maxRetries should be parsed numerically');
assert.equal(calls[0].result.attempts, 2);

console.log('indexer service job-completion signal test passed');
