#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

import {
  compactQueueState,
  ensureQueueDir,
  getQueuePaths,
  getQuarantinePaths,
  loadQuarantine,
  loadQueue,
  readQueueJournal,
  replayQueueStateFromJournal,
  saveQuarantine,
  saveQueue
} from '../../../tools/service/queue.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'service-queue-compaction');
const queueDir = path.join(tempRoot, 'queue');
const logsDir = path.join(queueDir, 'logs');
const reportsDir = path.join(queueDir, 'reports');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await ensureQueueDir(queueDir);
await fsPromises.mkdir(logsDir, { recursive: true });
await fsPromises.mkdir(reportsDir, { recursive: true });

const makeJob = (id, status, createdAt, extra = {}) => ({
  id,
  status,
  queueName: 'index',
  repo: `/tmp/${id}`,
  repoRoot: `/tmp/${id}`,
  mode: 'code',
  reason: 'test',
  stage: 'stage1',
  createdAt,
  startedAt: extra.startedAt || null,
  finishedAt: extra.finishedAt || null,
  lastHeartbeatAt: extra.lastHeartbeatAt || null,
  attempts: extra.attempts ?? 0,
  maxRetries: extra.maxRetries ?? 2,
  progress: {
    sequence: 0,
    updatedAt: extra.finishedAt || extra.startedAt || createdAt,
    kind: null,
    note: null
  },
  lease: extra.lease || {
    owner: status === 'running' ? 'worker-compaction' : null,
    version: status === 'running' ? 1 : 0,
    expiresAt: status === 'running' ? new Date(Date.parse(createdAt) + 60000).toISOString() : null,
    acquiredAt: status === 'running' ? createdAt : null,
    renewedAt: status === 'running' ? createdAt : null,
    releasedAt: null,
    releasedReason: null,
    lastOwner: null
  },
  transition: {
    sequence: 1,
    from: 'queued',
    to: status,
    at: extra.finishedAt || extra.startedAt || createdAt,
    reason: status
  },
  logPath: path.join(logsDir, `${id}.log`),
  reportPath: path.join(reportsDir, `${id}.json`),
  ...(extra.quarantine ? { quarantine: extra.quarantine } : {})
});

const writeArtifactsFor = async (jobs) => {
  for (const job of jobs) {
    await fsPromises.writeFile(job.logPath, `log:${job.id}\n`, 'utf8');
    await fsPromises.writeFile(job.reportPath, JSON.stringify({ id: job.id }), 'utf8');
  }
};

const queueJobs = [
  makeJob('job-queued', 'queued', '2026-03-18T10:00:00.000Z'),
  makeJob('job-running', 'running', '2026-03-18T10:01:00.000Z', {
    startedAt: '2026-03-18T10:01:30.000Z',
    lastHeartbeatAt: '2026-03-18T10:01:45.000Z'
  }),
  makeJob('job-done-old', 'done', '2026-03-18T09:00:00.000Z', {
    finishedAt: '2026-03-18T09:05:00.000Z'
  }),
  makeJob('job-done-new', 'done', '2026-03-18T09:30:00.000Z', {
    finishedAt: '2026-03-18T09:45:00.000Z'
  }),
  makeJob('job-failed-old', 'failed', '2026-03-18T08:00:00.000Z', {
    finishedAt: '2026-03-18T08:05:00.000Z',
    lastError: 'old failure'
  }),
  makeJob('job-failed-new', 'failed', '2026-03-18T08:30:00.000Z', {
    finishedAt: '2026-03-18T08:45:00.000Z',
    lastError: 'new failure'
  })
];

const quarantineJobs = [
  makeJob('job-quarantine-old', 'failed', '2026-03-18T07:00:00.000Z', {
    finishedAt: '2026-03-18T07:05:00.000Z',
    quarantine: {
      state: 'quarantined',
      quarantinedAt: '2026-03-18T07:06:00.000Z',
      reason: 'old quarantine',
      sourceStatus: 'failed',
      sourceQueueName: 'index'
    }
  }),
  makeJob('job-quarantine-new', 'failed', '2026-03-18T07:30:00.000Z', {
    finishedAt: '2026-03-18T07:35:00.000Z',
    quarantine: {
      state: 'quarantined',
      quarantinedAt: '2026-03-18T07:36:00.000Z',
      reason: 'new quarantine',
      sourceStatus: 'failed',
      sourceQueueName: 'index'
    }
  }),
  makeJob('job-retried-old', 'failed', '2026-03-18T06:00:00.000Z', {
    finishedAt: '2026-03-18T06:05:00.000Z',
    quarantine: {
      state: 'retried',
      quarantinedAt: '2026-03-18T06:06:00.000Z',
      releasedAt: '2026-03-18T06:10:00.000Z',
      releaseReason: 'manual-retry',
      retryJobId: 'retry-old',
      reason: 'old retried',
      sourceStatus: 'failed',
      sourceQueueName: 'index'
    }
  }),
  makeJob('job-retried-new', 'failed', '2026-03-18T06:30:00.000Z', {
    finishedAt: '2026-03-18T06:35:00.000Z',
    quarantine: {
      state: 'retried',
      quarantinedAt: '2026-03-18T06:36:00.000Z',
      releasedAt: '2026-03-18T06:40:00.000Z',
      releaseReason: 'manual-retry',
      retryJobId: 'retry-new',
      reason: 'new retried',
      sourceStatus: 'failed',
      sourceQueueName: 'index'
    }
  })
];

await writeArtifactsFor([...queueJobs, ...quarantineJobs]);
await fsPromises.writeFile(path.join(logsDir, 'orphan.log'), 'orphan\n', 'utf8');
await fsPromises.writeFile(path.join(reportsDir, 'orphan.json'), '{"orphan":true}', 'utf8');

await saveQueue(queueDir, { jobs: queueJobs }, 'index');
await saveQuarantine(queueDir, { jobs: quarantineJobs }, 'index');

const compacted = await compactQueueState(queueDir, 'index', {
  retentionPolicy: {
    doneJobs: 1,
    failedJobs: 1,
    quarantinedJobs: 1,
    retriedQuarantinedJobs: 1,
    cleanupLogs: true,
    cleanupReports: true,
    rewriteJournal: true
  }
});

assert.equal(compacted.ok, true, 'expected compaction to succeed');
assert.deepEqual(compacted.removedJobIds.queue.sort(), ['job-done-old', 'job-failed-old']);
assert.deepEqual(compacted.removedJobIds.quarantine.sort(), ['job-quarantine-old', 'job-retried-old']);
assert.equal(compacted.removed.logs, 5, 'expected removed job logs plus one orphan log');
assert.equal(compacted.removed.reports, 5, 'expected removed job reports plus one orphan report');

const retainedQueue = await loadQueue(queueDir, 'index');
assert.deepEqual(
  retainedQueue.jobs.map((job) => job.id).sort(),
  ['job-done-new', 'job-failed-new', 'job-queued', 'job-running']
);

const retainedQuarantine = await loadQuarantine(queueDir, 'index');
assert.deepEqual(
  retainedQuarantine.jobs.map((job) => job.id).sort(),
  ['job-quarantine-new', 'job-retried-new']
);

assert.equal(fsSync.existsSync(path.join(logsDir, 'job-done-old.log')), false);
assert.equal(fsSync.existsSync(path.join(logsDir, 'job-failed-old.log')), false);
assert.equal(fsSync.existsSync(path.join(logsDir, 'job-quarantine-old.log')), false);
assert.equal(fsSync.existsSync(path.join(logsDir, 'job-retried-old.log')), false);
assert.equal(fsSync.existsSync(path.join(logsDir, 'orphan.log')), false);
assert.equal(fsSync.existsSync(path.join(reportsDir, 'orphan.json')), false);
assert.equal(fsSync.existsSync(path.join(logsDir, 'job-running.log')), true);
assert.equal(fsSync.existsSync(path.join(reportsDir, 'job-retried-new.json')), true);

const journalEntries = await readQueueJournal(queueDir, 'index');
assert.equal(journalEntries.length, 7, 'expected one compaction event plus retained snapshots');
assert.equal(journalEntries[0]?.eventType, 'compaction');

const replayed = await replayQueueStateFromJournal(queueDir, 'index');
assert.deepEqual(
  replayed.queue.jobs.map((job) => job.id).sort(),
  ['job-done-new', 'job-failed-new', 'job-queued', 'job-running']
);
assert.deepEqual(
  replayed.quarantine.jobs.map((job) => job.id).sort(),
  ['job-quarantine-new', 'job-retried-new']
);

const { queuePath } = getQueuePaths(queueDir, 'index');
const { quarantinePath } = getQuarantinePaths(queueDir, 'index');
await fsPromises.rm(queuePath, { force: true });
await fsPromises.rm(quarantinePath, { force: true });
const replayedWithoutPrimaryFiles = await replayQueueStateFromJournal(queueDir, 'index');
assert.equal(replayedWithoutPrimaryFiles.queue.jobs.length, 4);
assert.equal(replayedWithoutPrimaryFiles.quarantine.jobs.length, 2);

console.log('service queue compaction test passed');
