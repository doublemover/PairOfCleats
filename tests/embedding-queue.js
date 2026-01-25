#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyTestEnv } from './helpers/test-env.js';
import { enqueueEmbeddingJob } from '../src/index/build/indexer/embedding-queue.js';
import { loadQueue } from '../tools/service/queue.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-embedding-queue-'));
applyTestEnv({ cacheRoot: tempRoot });

const repoRoot = path.join(tempRoot, 'repo');
await fs.mkdir(repoRoot, { recursive: true });

const queueDir = path.join(tempRoot, 'queue');
const buildRoot = path.join(repoRoot, 'builds', 'b1');
const indexRoot = path.join(buildRoot, 'index-code');
await fs.mkdir(indexRoot, { recursive: true });

const fullRuntime = {
  root: repoRoot,
  buildId: 'b1',
  buildRoot,
  embeddingService: true,
  embeddingQueue: { dir: queueDir, maxQueued: 0 },
  embeddingIdentity: 'test-model',
  embeddingIdentityKey: 'test-key'
};

const skipped = await enqueueEmbeddingJob({ runtime: fullRuntime, mode: 'code', indexRoot });
assert.equal(skipped, null, 'expected queue full to skip enqueue');

const okRuntime = {
  ...fullRuntime,
  buildId: 'b2',
  buildRoot: path.join(repoRoot, 'builds', 'b2'),
  embeddingQueue: { dir: queueDir, maxQueued: 10 }
};

await enqueueEmbeddingJob({ runtime: okRuntime, mode: 'prose', indexRoot });
const queue = await loadQueue(queueDir, 'embeddings');
const job = queue.jobs[0];

assert.ok(job, 'expected queued job');
assert.equal(job.buildId, 'b2');
assert.equal(job.buildRoot, okRuntime.buildRoot);
assert.equal(job.indexRoot, path.resolve(indexRoot));
assert.equal(job.mode, 'prose');

console.log('embedding queue tests passed');
