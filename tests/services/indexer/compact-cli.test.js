#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  ensureQueueDir,
  loadQuarantine,
  loadQueue,
  saveQuarantine,
  saveQueue
} from '../../../tools/service/queue.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'indexer-service-compact-cli');
const repoRoot = path.join(tempRoot, 'repo');
const queueDir = path.join(tempRoot, 'queue');
const logsDir = path.join(queueDir, 'logs');
const reportsDir = path.join(queueDir, 'reports');
const configPath = path.join(tempRoot, 'service.json');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await ensureQueueDir(queueDir);
await fsPromises.mkdir(logsDir, { recursive: true });
await fsPromises.mkdir(reportsDir, { recursive: true });

const makeJob = (id, status, createdAt, extra = {}) => ({
  id,
  status,
  queueName: 'index',
  repo: repoRoot,
  repoRoot,
  mode: 'code',
  reason: 'test',
  stage: 'stage1',
  createdAt,
  startedAt: extra.startedAt || null,
  finishedAt: extra.finishedAt || null,
  progress: { sequence: 0, updatedAt: createdAt, kind: null, note: null },
  lease: {
    owner: null,
    version: 0,
    expiresAt: null,
    acquiredAt: null,
    renewedAt: null,
    releasedAt: null,
    releasedReason: null,
    lastOwner: null
  },
  transition: {
    sequence: 1,
    from: 'queued',
    to: status,
    at: extra.finishedAt || createdAt,
    reason: status
  },
  logPath: path.join(logsDir, `${id}.log`),
  reportPath: path.join(reportsDir, `${id}.json`),
  ...(extra.quarantine ? { quarantine: extra.quarantine } : {})
});

const queueJobs = [
  makeJob('job-queued', 'queued', '2026-03-18T10:00:00.000Z'),
  makeJob('job-done-old', 'done', '2026-03-18T09:00:00.000Z', {
    finishedAt: '2026-03-18T09:05:00.000Z'
  }),
  makeJob('job-done-new', 'done', '2026-03-18T09:30:00.000Z', {
    finishedAt: '2026-03-18T09:45:00.000Z'
  })
];
const quarantineJobs = [
  makeJob('job-quarantine-old', 'failed', '2026-03-18T08:00:00.000Z', {
    finishedAt: '2026-03-18T08:05:00.000Z',
    quarantine: {
      state: 'quarantined',
      quarantinedAt: '2026-03-18T08:06:00.000Z',
      reason: 'old',
      sourceStatus: 'failed',
      sourceQueueName: 'index'
    }
  }),
  makeJob('job-quarantine-new', 'failed', '2026-03-18T08:30:00.000Z', {
    finishedAt: '2026-03-18T08:35:00.000Z',
    quarantine: {
      state: 'quarantined',
      quarantinedAt: '2026-03-18T08:36:00.000Z',
      reason: 'new',
      sourceStatus: 'failed',
      sourceQueueName: 'index'
    }
  })
];

for (const job of [...queueJobs, ...quarantineJobs]) {
  await fsPromises.writeFile(job.logPath, `${job.id}\n`, 'utf8');
  await fsPromises.writeFile(job.reportPath, JSON.stringify({ id: job.id }), 'utf8');
}
await fsPromises.writeFile(path.join(logsDir, 'orphan.log'), 'orphan\n', 'utf8');
await fsPromises.writeFile(path.join(reportsDir, 'orphan.json'), '{"orphan":true}', 'utf8');

await saveQueue(queueDir, { jobs: queueJobs }, 'index');
await saveQuarantine(queueDir, { jobs: quarantineJobs }, 'index');

const config = {
  queueDir,
  repos: [
    { id: 'repo', path: repoRoot, syncPolicy: 'none' }
  ],
  queue: {
    retention: {
      doneJobs: 1,
      failedJobs: 0,
      quarantinedJobs: 1,
      retriedQuarantinedJobs: 0
    }
  }
};
await fsPromises.writeFile(configPath, JSON.stringify(config, null, 2));

const result = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'service', 'indexer-service.js'), 'compact', '--config', configPath, '--json'],
  { encoding: 'utf8' }
);
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || 'indexer-service compact failed');
  process.exit(result.status ?? 1);
}

const payload = JSON.parse(result.stdout || '{}');
assert.equal(payload.ok, true);
assert.equal(payload.removed.queue, 1);
assert.equal(payload.removed.quarantine, 1);
assert.equal(payload.removed.logs, 3);
assert.equal(payload.removed.reports, 3);
assert.deepEqual(payload.removedJobIds.queue, ['job-done-old']);
assert.deepEqual(payload.removedJobIds.quarantine, ['job-quarantine-old']);

const queueAfter = await loadQueue(queueDir, 'index');
assert.deepEqual(queueAfter.jobs.map((job) => job.id).sort(), ['job-done-new', 'job-queued']);
const quarantineAfter = await loadQuarantine(queueDir, 'index');
assert.deepEqual(quarantineAfter.jobs.map((job) => job.id), ['job-quarantine-new']);

console.log('indexer service compact cli test passed');
