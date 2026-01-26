#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { enqueueEmbeddingJob } from '../src/index/build/indexer/embedding-queue.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'embedding-queue-defaults');
const queueDir = path.join(tempRoot, 'queue');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(queueDir, { recursive: true });

const runtime = {
  root: tempRoot,
  embeddingService: true,
  embeddingQueue: {
    dir: queueDir,
    maxQueued: null
  }
};

for (let i = 0; i < 10; i += 1) {
  const job = await enqueueEmbeddingJob({ runtime, mode: 'code' });
  if (!job) {
    console.error(`embedding queue defaults test failed: expected job ${i + 1} to enqueue`);
    process.exit(1);
  }
}

const overflow = await enqueueEmbeddingJob({ runtime, mode: 'code' });
if (overflow) {
  console.error('embedding queue defaults test failed: expected queue to be full at default maxQueued');
  process.exit(1);
}

console.log('embedding queue defaults test passed');

