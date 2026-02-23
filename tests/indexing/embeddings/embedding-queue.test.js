#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyTestEnv } from '../../helpers/test-env.js';
import { enqueueEmbeddingJob } from '../../../src/index/build/indexer/embedding-queue.js';
import { loadQueue } from '../../../tools/service/queue.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-embedding-queue-'));
applyTestEnv({ cacheRoot: tempRoot });

const repoRoot = path.join(tempRoot, 'repo');
await fs.mkdir(repoRoot, { recursive: true });

const queueDir = path.join(tempRoot, 'queue');
const buildRoot = path.join(repoRoot, 'builds', 'b1');
const indexDir = path.join(buildRoot, 'index-code');
await fs.mkdir(indexDir, { recursive: true });

const fullRuntime = {
  root: repoRoot,
  buildId: 'b1',
  buildRoot,
  embeddingService: true,
  embeddingQueue: { dir: queueDir, maxQueued: 0 },
  embeddingIdentity: 'test-model',
  embeddingIdentityKey: 'test-key'
};

const skipped = await enqueueEmbeddingJob({ runtime: fullRuntime, mode: 'code', indexDir });
assert.equal(skipped, null, 'expected queue full to skip enqueue');

const buildRoot2 = path.join(repoRoot, 'builds', 'b2');
const indexDir2 = path.join(buildRoot2, 'index-prose');
await fs.mkdir(indexDir2, { recursive: true });

const okRuntime = {
  ...fullRuntime,
  buildId: 'b2',
  buildRoot: buildRoot2,
  embeddingQueue: { dir: queueDir, maxQueued: 10 }
};

await enqueueEmbeddingJob({ runtime: okRuntime, mode: 'prose', indexDir: indexDir2 });
const queue = await loadQueue(queueDir, 'embeddings');
const job = queue.jobs[0];

assert.ok(job, 'expected queued job');
assert.equal(job.buildId, 'b2');
assert.equal(job.buildRoot, okRuntime.buildRoot);
assert.equal(job.indexDir, path.resolve(indexDir2));
assert.equal(job.mode, 'prose');
assert.equal(job.repoRoot, path.resolve(repoRoot));
assert.equal(job.embeddingPayloadFormatVersion, 2);

const buildRoot3 = path.join(repoRoot, 'builds', 'b3');
const indexDir3 = path.join(buildRoot3, '..index', 'code');
await fs.mkdir(indexDir3, { recursive: true });
await enqueueEmbeddingJob({
  runtime: {
    ...okRuntime,
    buildId: 'b3',
    buildRoot: buildRoot3
  },
  mode: 'code',
  indexDir: indexDir3
});
const queueAfterDotDotPrefix = await loadQueue(queueDir, 'embeddings');
assert.ok(
  queueAfterDotDotPrefix.jobs.some((entry) => entry.buildId === 'b3' && entry.indexDir === path.resolve(indexDir3)),
  'expected queue to accept in-root ..-prefixed indexDir segment'
);

const buildRoot4 = path.join(repoRoot, 'builds', 'b4');
await fs.mkdir(buildRoot4, { recursive: true });
await enqueueEmbeddingJob({
  runtime: {
    ...okRuntime,
    buildId: 'b4',
    buildRoot: buildRoot4
  },
  mode: 'code',
  indexDir: buildRoot4
});
const queueAfterBuildRootIndexDir = await loadQueue(queueDir, 'embeddings');
assert.ok(
  queueAfterBuildRootIndexDir.jobs.some((entry) => entry.buildId === 'b4' && entry.indexDir === path.resolve(buildRoot4)),
  'expected queue to accept indexDir equal to buildRoot'
);

console.log('embedding queue tests passed');
