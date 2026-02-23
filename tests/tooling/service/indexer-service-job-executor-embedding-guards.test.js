#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createJobExecutor } from '../../../tools/service/indexer-service/job-executor.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-job-executor-'));
const buildRoot = path.join(tempRoot, 'build');
await fs.mkdir(buildRoot, { recursive: true });

const nonRetriableCalls = [];
const executor = createJobExecutor({
  isEmbeddingsQueue: true,
  serviceExecutionMode: 'subprocess',
  daemonWorkerConfig: {},
  resolvedQueueName: 'embeddings',
  embeddingExtraEnv: {},
  resolveRepoRuntimeEnv: () => ({}),
  toolRoot: process.cwd(),
  completeNonRetriableFailure: async (job, error) => {
    nonRetriableCalls.push({ jobId: job.id, error });
  }
});

const result = await executor.executeClaimedJob({
  job: {
    id: 'job-1',
    repo: null,
    repoRoot: null,
    buildRoot,
    mode: 'code'
  },
  jobLifecycle: {
    registerPromise: async (promise) => promise
  },
  logPath: null
});

assert.equal(result.handled, true, 'missing repo path should be handled as non-retriable');
assert.equal(nonRetriableCalls.length, 1);
assert.equal(nonRetriableCalls[0].jobId, 'job-1');
assert.equal(nonRetriableCalls[0].error, 'missing repo path for embedding job');

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('indexer service job-executor embedding guards test passed');
