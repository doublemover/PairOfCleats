#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { enqueueEmbeddingJob } from '../../../src/index/build/indexer/embedding-queue.js';
import { createBoundedWriterQueue } from '../../../tools/build/embeddings/writer-queue.js';
import {
  normalizeEmbeddingsMaintenanceConfig,
  shouldQueueSqliteMaintenance
} from '../../../tools/build/embeddings/maintenance.js';
import { loadQueue } from '../../../tools/service/queue.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { rmDirRecursive } from '../../helpers/temp.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

{
  const defaults = normalizeEmbeddingsMaintenanceConfig({});
  assert.equal(defaults.background, true);
  assert.equal(defaults.sqliteWalMaxBytes, 128 * 1024 * 1024);
  assert.equal(defaults.sqliteMinDbBytes, 512 * 1024 * 1024);
  assert.equal(defaults.sqliteMinDenseCount, 100000);

  assert.deepEqual(
    shouldQueueSqliteMaintenance({
      config: {},
      dbBytes: 9e9,
      walBytes: 9e9,
      denseCount: 9e9
    }),
    { queue: true, reason: 'wal-threshold' }
  );
  assert.deepEqual(
    shouldQueueSqliteMaintenance({
      config: {
        background: true,
        sqliteWalMaxBytes: 1024,
        sqliteMinDbBytes: 2048,
        sqliteMinDenseCount: 10
      },
      dbBytes: 100,
      walBytes: 1024,
      denseCount: 0
    }),
    { queue: true, reason: 'wal-threshold' }
  );
  assert.deepEqual(
    shouldQueueSqliteMaintenance({
      config: {
        background: true,
        sqliteWalMaxBytes: 999999,
        sqliteMinDbBytes: 5000,
        sqliteMinDenseCount: 5
      },
      dbBytes: 5000,
      walBytes: 0,
      denseCount: 5
    }),
    { queue: true, reason: 'db-and-dense-threshold' }
  );
  assert.deepEqual(
    shouldQueueSqliteMaintenance({
      config: {
        background: true,
        sqliteWalMaxBytes: 999999,
        sqliteMinDbBytes: 5000,
        sqliteMinDenseCount: 5
      },
      dbBytes: 4000,
      walBytes: 100,
      denseCount: 4
    }),
    { queue: false, reason: 'below-threshold' }
  );
}

{
  const root = process.cwd();
  const tempRoot = resolveTestCachePath(root, 'embedding-queue-contract-matrix-defaults');
  const queueDir = path.join(tempRoot, 'queue');
  const buildRoot = path.join(tempRoot, 'builds', 'b1');
  const indexDir = path.join(buildRoot, 'index-code');

  await rmDirRecursive(tempRoot, { retries: 8, delayMs: 150 });
  await fs.mkdir(indexDir, { recursive: true });

  const runtime = {
    root: tempRoot,
    buildRoot,
    embeddingService: true,
    embeddingQueue: {
      dir: queueDir,
      maxQueued: null
    }
  };

  for (let i = 0; i < 10; i += 1) {
    const job = await enqueueEmbeddingJob({ runtime, mode: 'code', indexDir });
    assert.ok(job, `expected job ${i + 1} to enqueue`);
  }

  const overflow = await enqueueEmbeddingJob({ runtime, mode: 'code', indexDir });
  assert.equal(overflow, null);

  await rmDirRecursive(tempRoot, { retries: 8, delayMs: 150 });
}

{
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-embedding-queue-'));
  applyTestEnv({ cacheRoot: tempRoot });

  const repoRoot = path.join(tempRoot, 'repo');
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
  assert.equal(skipped, null);

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

  assert.ok(job);
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
    queueAfterDotDotPrefix.jobs.some(
      (entry) => entry.buildId === 'b3' && entry.indexDir === path.resolve(indexDir3)
    )
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
    queueAfterBuildRootIndexDir.jobs.some(
      (entry) => entry.buildId === 'b4' && entry.indexDir === path.resolve(buildRoot4)
    )
  );

  await rmDirRecursive(tempRoot, { retries: 8, delayMs: 150 });
}

{
  let dynamicLimit = 3;
  const adjustments = [];
  const writer = createBoundedWriterQueue({
    scheduleIo: (fn) => delay(10).then(fn),
    maxPending: 3,
    resolveMaxPending: () => dynamicLimit,
    onAdjust: (event) => {
      adjustments.push(event);
    }
  });

  const tasks = [];
  for (let i = 0; i < 12; i += 1) {
    if (i === 4) dynamicLimit = 1;
    if (i === 8) dynamicLimit = 2;
    tasks.push(writer.enqueue(async () => {}));
  }
  await Promise.all(tasks);
  await writer.onIdle();

  const stats = writer.stats();
  assert.equal(stats.pending, 0);
  assert.ok(stats.adjustments >= 2);
  assert.ok(stats.minDynamicMaxPending <= 1);
  assert.ok(stats.peakDynamicMaxPending >= 3);
  assert.ok(adjustments.length >= 2);
}

{
  let resolveFirst = null;
  const firstGate = new Promise((resolve) => {
    resolveFirst = resolve;
  });
  let resolveSecond = null;
  const secondGate = new Promise((resolve) => {
    resolveSecond = resolve;
  });

  let firstStarted = false;
  let secondStarted = false;

  const writer = createBoundedWriterQueue({
    scheduleIo: (fn) => fn(),
    maxPending: 1
  });

  await writer.enqueue(async () => {
    firstStarted = true;
    await firstGate;
  });
  assert.equal(firstStarted, true);
  assert.equal(secondStarted, false);

  let secondEnqueued = false;
  const enqueueSecond = writer.enqueue(async () => {
    secondStarted = true;
    await secondGate;
  }).then(() => {
    secondEnqueued = true;
  });

  await delay(25);
  assert.equal(secondEnqueued, false);
  assert.equal(secondStarted, false);

  resolveFirst?.();
  await enqueueSecond;
  assert.equal(secondStarted, true);

  resolveSecond?.();
  await writer.onIdle();

  const stats = writer.stats();
  assert.equal(stats.maxPending, 1);
  assert.equal(stats.scheduled, 2);
  assert.ok(stats.waits >= 1);
  assert.ok(stats.peakPending <= stats.maxPending);
}

console.log('embedding writer and queue contract matrix test passed');
