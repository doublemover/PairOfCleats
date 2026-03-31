#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { ensureQueueDir, saveQueue, saveQuarantine } from '../../../tools/service/queue.js';
import { describeOrphanArtifacts, describeRepairLocks } from '../../../tools/service/repair.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `service-repair-state-${process.pid}-${Date.now()}`);
const queueDir = path.join(tempRoot, 'queue');
const logsDir = path.join(queueDir, 'logs');
const reportsDir = path.join(queueDir, 'reports');

await fs.rm(tempRoot, { recursive: true, force: true });
await ensureQueueDir(queueDir);
await fs.mkdir(logsDir, { recursive: true });
await fs.mkdir(reportsDir, { recursive: true });

const indexJob = {
  id: 'job-index',
  status: 'done',
  queueName: 'index',
  createdAt: '2026-03-31T12:00:00.000Z',
  finishedAt: '2026-03-31T12:05:00.000Z',
  logPath: path.join(logsDir, 'job-index.log'),
  reportPath: path.join(reportsDir, 'job-index.json')
};
const otherQueueJob = {
  id: 'job-other-queue',
  status: 'done',
  queueName: 'embeddings-stage3',
  createdAt: '2026-03-31T12:10:00.000Z',
  finishedAt: '2026-03-31T12:15:00.000Z'
};

await fs.writeFile(indexJob.logPath, 'index\n', 'utf8');
await fs.writeFile(indexJob.reportPath, '{"id":"job-index"}\n', 'utf8');
await fs.writeFile(path.join(logsDir, 'job-other-queue.log'), 'other\n', 'utf8');
await fs.writeFile(path.join(reportsDir, 'job-other-queue.json'), '{"id":"job-other-queue"}\n', 'utf8');
await fs.writeFile(path.join(logsDir, 'orphan.log'), 'orphan\n', 'utf8');
await fs.writeFile(path.join(reportsDir, 'orphan.json'), '{"orphan":true}\n', 'utf8');

await saveQueue(queueDir, { jobs: [indexJob] }, 'index');
await saveQuarantine(queueDir, { jobs: [] }, 'index');
await saveQueue(queueDir, { jobs: [otherQueueJob] }, 'embeddings-stage3');
await saveQuarantine(queueDir, { jobs: [] }, 'embeddings-stage3');

const orphans = await describeOrphanArtifacts(queueDir, 'index');
assert.deepEqual(
  orphans.logs.map((entry) => path.basename(entry)).sort(),
  ['orphan.log'],
  'expected orphan detection to preserve log artifacts referenced by other queue partitions'
);
assert.deepEqual(
  orphans.reports.map((entry) => path.basename(entry)).sort(),
  ['orphan.json'],
  'expected orphan detection to preserve report artifacts referenced by other queue partitions'
);

const malformedLockPath = path.join(queueDir, 'queue.lock');
await fs.writeFile(malformedLockPath, '{not-json}\n', 'utf8');
const locks = await describeRepairLocks(queueDir, 'index');
const queueLock = locks.find((entry) => entry.kind === 'queue');
assert.equal(queueLock?.exists, true, 'expected synthetic queue lock to exist');
assert.equal(queueLock?.safeToUnlock, false, 'expected unreadable lock metadata to stay unsafe to unlock');

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('service repair state test passed');
