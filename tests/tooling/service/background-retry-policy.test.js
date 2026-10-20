#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildIndex } from '../../../src/integrations/core/build-index/index.js';
import { runEmbeddingsStage } from '../../../src/integrations/core/build-index/stages.js';
import { enqueueEmbeddingJob } from '../../../src/index/build/indexer/embedding-queue.js';
import { claimNextJob, completeJob, loadQueue, loadQuarantine, quarantineJob } from '../../../tools/service/queue.js';
import { createJobCompletion } from '../../../tools/service/indexer-service/job-completion.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-background-retry-'));
const repo = path.join(root, 'repo'), cache = path.join(root, 'cache'), stage2Queue = path.join(root, 'stage2-queue');
await fs.mkdir(repo);
applyTestEnv({ cacheRoot: cache, testConfig: { indexing: {
  twoStage: { enabled: true, background: true, queue: true },
  embeddings: { queue: { dir: stage2Queue, maxQueued: 10 } },
  typeInference: false, typeInferenceCrossFile: false
}, tooling: { autoEnableOnDetect: false, lsp: { enabled: false } }, sqlite: { use: false } } });
const assertInheritedRetry = async (queueDir, queueName, reason) => {
  const jobs = (await loadQueue(queueDir, queueName)).jobs;
  assert.ok(jobs.length > 0, `${reason}: actual producer must enqueue work`);
  assert.ok(jobs.every(job => job.maxRetries === null));
  const job = await claimNextJob(queueDir, queueName, { ownerId: 'retry-regression' });
  assert.equal(job.reason, reason);
  const completion = createJobCompletion({ queueDir, resolvedQueueName: queueName, queueMaxRetries: 2,
    completeJob, quarantineJob });
  const metrics = { processed: 1, succeeded: 0, failed: 0, retried: 0 };
  await completion.finalizeJobRun({ job, runResult: { exitCode: 1 }, metrics });
  assert.equal(metrics.retried, 1, `${reason}: inherited queue policy retries a transient process failure`);
  assert.equal(metrics.failed, 0);
  assert.deepEqual((await loadQuarantine(queueDir, queueName)).jobs, []);
  const retried = (await loadQueue(queueDir, queueName)).jobs.find(entry => entry.id === job.id);
  assert.equal(retried.status, 'queued'); assert.equal(retried.attempts, 1);
};
try {
  await fs.writeFile(path.join(repo, 'index.js'), 'export function backgroundRetry() { return 42; }\n');
  await buildIndex(repo, { args: ['--mode', 'code', '--no-embeddings', '--no-sqlite', '--threads', '1', '--no-progress'],
    log: () => {}, warn: message => { throw new Error(message); } });
  await assertInheritedRetry(stage2Queue, 'index', 'stage2');
  const build = path.join(root, 'build');
  await fs.mkdir(path.join(build, 'index-code'), { recursive: true });
  const stage3Queue = path.join(root, 'stage3-queue');
  const stage3 = await runEmbeddingsStage({ root: repo, argv: {}, embedModes: ['code'],
    embeddingRuntime: { embeddingEnabled: true, embeddingService: true, queueDir: stage3Queue,
      queueMaxQueued: 10, useStubEmbeddings: false }, userConfig: {}, indexRoot: build,
    includeEmbeddings: true, overallProgressRef: { current: null }, log: () => {}, abortSignal: null,
    repoCacheRoot: cache, runtimeEnv: process.env, recordIndexMetric: () => {}, buildEmbeddingsPath: '' });
  assert.equal(stage3.embeddings.queued, true);
  await assertInheritedRetry(stage3Queue, 'embeddings', 'stage3');
  const indexerQueue = path.join(root, 'indexer-queue');
  assert.ok(await enqueueEmbeddingJob({ runtime: { embeddingService: true, root: repo, buildRoot: build,
    embeddingQueue: { dir: indexerQueue, maxQueued: 10 }, argv: {}, useStubEmbeddings: true },
  mode: 'code', indexDir: path.join(build, 'index-code') }));
  await assertInheritedRetry(indexerQueue, 'embeddings', 'embeddings');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('actual background stage2, stage3 and indexer embedding producers inherit queue retry policy');
