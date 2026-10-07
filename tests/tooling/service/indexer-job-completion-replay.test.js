#!/usr/bin/env node
import assert from 'node:assert/strict';

import { createJobCompletion } from '../../../tools/service/indexer-service/job-completion.js';

const completions = [];
const quarantines = [];
const metrics = { processed: 0, succeeded: 0, failed: 0, retried: 0 };

const completion = createJobCompletion({
  queueDir: '/tmp/queue',
  resolvedQueueName: 'embeddings',
  queueMaxRetries: 0,
  completeJob: async (queueDir, jobId, status, result, queueName, options) => {
    completions.push({ queueDir, jobId, status, result, queueName, options });
  },
  quarantineJob: async (queueDir, jobId, reason, queueName, options) => {
    quarantines.push({ queueDir, jobId, reason, queueName, options });
  }
});

const replay = {
  version: 1,
  repair: {
    repaired: true,
    actions: [{ type: 'remove-backend-stage-dir' }]
  },
  current: {
    partialDurableState: true
  }
};

await completion.finalizeJobRun({
  job: {
    id: 'embed-cancelled',
    attempts: 0,
    maxRetries: 0,
    lease: { owner: 'worker-1', version: 3 }
  },
  runResult: {
    exitCode: 130,
    signal: null,
    executionMode: 'subprocess',
    executionClass: 'daemon-governed',
    cancelled: true,
    shutdownMode: 'cancel',
    governance: {
      policy: 'daemon',
      decision: 'subprocess-fallback',
      reason: 'daemon-failure-burst',
      sessionKey: 'daemon-session-1',
      sessionEpoch: 1,
      recycleCount: 1,
      subprocessCooldownRemaining: 0
    },
    replay
  },
  metrics
});
assert.equal(completions[0]?.status, 'queued');
assert.deepEqual(completions[0]?.result?.replay, replay, 'expected cancelled retry payload to preserve replay metadata');
assert.equal(completions[0]?.result?.executionClass, 'daemon-governed');
assert.equal(completions[0]?.result?.governance?.decision, 'subprocess-fallback');

await completion.finalizeJobRun({
  job: {
    id: 'embed-failed',
    attempts: 0,
    maxRetries: 0,
    lease: { owner: 'worker-2', version: 4 }
  },
  runResult: {
    exitCode: 1,
    signal: null,
    executionMode: 'subprocess',
    executionClass: 'daemon-governed',
    cancelled: false,
    governance: {
      policy: 'daemon',
      decision: 'subprocess-fallback',
      reason: 'daemon-failure-burst',
      sessionKey: 'daemon-session-1',
      sessionEpoch: 1,
      recycleCount: 1,
      subprocessCooldownRemaining: 0
    },
    replay
  },
  metrics
});
assert.equal(quarantines[0]?.reason, 'retry-exhausted');
assert.deepEqual(quarantines[0]?.options?.result?.replay, replay, 'expected quarantine payload to preserve replay metadata');
assert.equal(quarantines[0]?.options?.result?.executionClass, 'daemon-governed');
assert.equal(quarantines[0]?.options?.result?.governance?.decision, 'subprocess-fallback');

console.log('indexer service job-completion replay test passed');
