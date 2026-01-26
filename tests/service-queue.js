#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import {
  ensureQueueDir,
  enqueueJob,
  claimNextJob,
  completeJob,
  queueSummary
} from '../tools/service/queue.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'service-queue');
const queueDir = path.join(tempRoot, 'queue');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await ensureQueueDir(queueDir);

const baseJob = {
  createdAt: new Date().toISOString(),
  repo: '/tmp/repo',
  mode: 'all',
  reason: 'test'
};

await enqueueJob(queueDir, { ...baseJob, id: 'job-index' }, null, 'index');
await enqueueJob(queueDir, { ...baseJob, id: 'job-embed' }, null, 'embeddings');

const summaryIndex = await queueSummary(queueDir, 'index');
const summaryEmbed = await queueSummary(queueDir, 'embeddings');
if (summaryIndex.total !== 1 || summaryEmbed.total !== 1) {
  console.error('Queue summary counts mismatch');
  process.exit(1);
}

const job = await claimNextJob(queueDir, 'index');
if (!job || job.status !== 'running') {
  console.error('Expected queued job to transition to running');
  process.exit(1);
}
await completeJob(queueDir, job.id, 'failed', { exitCode: 1 }, 'index');

const summaryAfter = await queueSummary(queueDir, 'index');
if (summaryAfter.failed !== 1) {
  console.error('Expected failed job count to be 1');
  process.exit(1);
}

console.log('service queue test passed');

