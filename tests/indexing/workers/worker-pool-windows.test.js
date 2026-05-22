#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createWorkerPoolTestResources,
  WORKER_POOL_SAMPLE
} from './worker-pool-fixture.js';

if (process.platform !== 'win32') {
  console.log('worker pool windows test skipped (non-windows).');
  process.exit(0);
}

const root = path.resolve('tests', '.cache', 'worker-pool-windows');
const deepDir = path.join(root, 'space dir', 'unicode-é', 'deep', 'path', 'more');
await fs.mkdir(deepDir, { recursive: true });

const originalCwd = process.cwd();
try {
  process.chdir(deepDir);
  const { syncTokens, workerPool } = await createWorkerPoolTestResources();
  if (!workerPool) {
    console.log('worker pool windows test skipped (worker pool unavailable).');
    process.exit(0);
  }

  const runs = [];
  for (let i = 0; i < 50; i += 1) {
    runs.push(workerPool.tokenizeChunk({
      text: WORKER_POOL_SAMPLE,
      mode: 'code',
      ext: '.js',
      file: `task-${i}`,
      size: WORKER_POOL_SAMPLE.length
    }));
  }
  const results = await Promise.all(runs);
  for (const result of results) {
    if (!result) {
      console.error('worker pool windows test failed: missing token result.');
      process.exit(1);
    }
    if (JSON.stringify(syncTokens.tokens) !== JSON.stringify(result.tokens)) {
      console.error('worker pool windows test failed: tokens mismatch.');
      process.exit(1);
    }
  }

  if (workerPool.pool?.destroy) {
    await workerPool.pool.destroy();
    await workerPool.tokenizeChunk({
      text: WORKER_POOL_SAMPLE,
      mode: 'code',
      ext: '.js',
      file: 'restart',
      size: WORKER_POOL_SAMPLE.length
    });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const restarted = await workerPool.tokenizeChunk({
      text: WORKER_POOL_SAMPLE,
      mode: 'code',
      ext: '.js',
      file: 'restart-2',
      size: WORKER_POOL_SAMPLE.length
    });
    if (!restarted) {
      console.error('worker pool windows test failed: restart did not recover.');
      process.exit(1);
    }
  }

  await workerPool.destroy();
  console.log('worker pool windows test passed');
} finally {
  process.chdir(originalCwd);
}
