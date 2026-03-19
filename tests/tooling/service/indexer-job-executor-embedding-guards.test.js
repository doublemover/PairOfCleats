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
const baseExecutorInput = {
  isEmbeddingsQueue: true,
  serviceExecutionMode: 'subprocess',
  daemonWorkerConfig: {},
  resolvedQueueName: 'embeddings',
  embeddingExtraEnv: {},
  resolveRepoRuntimeEnv: () => ({}),
  completeNonRetriableFailure: async (job, error) => {
    nonRetriableCalls.push({ jobId: job.id, error });
  }
};
const executor = createJobExecutor({
  ...baseExecutorInput,
  toolRoot: process.cwd()
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

const toolRoot = path.join(tempRoot, 'tool-root');
const fakeEmbeddingsScript = path.join(toolRoot, 'tools', 'build', 'embeddings.js');
const indexDir = path.join(buildRoot, 'index-code');
const backendStageDir = path.join(buildRoot, '.embeddings-backend-staging', 'index-code');
await fs.mkdir(path.dirname(fakeEmbeddingsScript), { recursive: true });
await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
await fs.mkdir(backendStageDir, { recursive: true });
await fs.writeFile(fakeEmbeddingsScript, 'process.exit(0);\n');
await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify({
  generatedAt: '2026-03-18T00:00:00.000Z',
  updatedAt: '2026-03-18T00:00:00.000Z',
  embeddings: {
    pending: true,
    ready: false
  }
}, null, 2));
await fs.writeFile(path.join(indexDir, 'dense_vectors_uint8.bin'), 'artifact');
await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify({ ok: true }, null, 2));

const replayExecutor = createJobExecutor({
  ...baseExecutorInput,
  toolRoot
});

const validResult = await replayExecutor.executeClaimedJob({
  job: {
    id: 'job-2',
    repo: tempRoot,
    repoRoot: tempRoot,
    buildRoot,
    indexDir,
    mode: 'code',
    embeddingPayloadFormatVersion: 2
  },
  jobLifecycle: {
    registerPromise: async (promise) => promise
  },
  logPath: path.join(tempRoot, 'embeddings.log')
});

assert.equal(validResult.handled, false, 'expected runnable embeddings job to fall through to subprocess execution');
assert.equal(validResult.runResult?.exitCode, 0);
assert.equal(validResult.runResult?.replay?.repair?.repaired, true, 'expected executor to surface replay repair metadata');
assert.equal(validResult.runResult?.replay?.current?.backendStage?.exists, false, 'expected stale backend stage to be repaired before execution');
assert.equal(validResult.runResult?.replay?.current?.embeddings?.pending, false, 'expected repaired replay state to clear stale pending bit');

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('indexer service job-executor embedding guards test passed');
