#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  ensureQueueDir,
  loadQueue,
  requeueStaleJobs,
  saveQueue
} from '../../../tools/service/queue.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'indexer-service-metrics-contract');
const repoRoot = path.join(tempRoot, 'repo');
const queueDir = path.join(tempRoot, 'queue');
const configPath = path.join(tempRoot, 'service.json');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });

const config = {
  queueDir,
  queue: {
    maxQueued: 1,
    maxRunning: 1,
    maxTotal: 2,
    resourceBudgetUnits: 2
  },
  repos: [
    { id: 'repo', path: repoRoot, syncPolicy: 'none' }
  ]
};
await fsPromises.writeFile(configPath, JSON.stringify(config, null, 2));
await ensureQueueDir(queueDir);

await enqueueJob(queueDir, {
  id: 'job-1',
  createdAt: '2026-03-19T00:00:00.000Z',
  repo: repoRoot,
  mode: 'code',
  reason: null,
  stage: 'stage1',
  maxRetries: 2
}, null, 'index');

const runningJob = await claimNextJob(queueDir, 'index', { ownerId: 'worker-1' });
assert.equal(runningJob?.id, 'job-1', 'expected first job to claim');

await enqueueJob(queueDir, {
  id: 'job-2',
  createdAt: '2026-03-19T00:01:00.000Z',
  repo: repoRoot,
  mode: 'code',
  reason: null,
  stage: 'stage2',
  maxRetries: 0
}, null, 'index');

await completeJob(queueDir, 'job-1', 'queued', {
  exitCode: 1,
  retry: true,
  attempts: 1
}, 'index', {
  ownerId: 'worker-1',
  expectedLeaseVersion: runningJob?.lease?.version
});

const queue = await loadQueue(queueDir, 'index');
const staleQueueEntry = queue.jobs.find((job) => job.id === 'job-2');
assert.ok(staleQueueEntry, 'expected second job to be present in queue');
staleQueueEntry.status = 'running';
staleQueueEntry.nextEligibleAt = null;
staleQueueEntry.lease.expiresAt = '2026-03-18T23:59:00.000Z';
staleQueueEntry.lease.owner = 'worker-2';
staleQueueEntry.lease.version = 1;
staleQueueEntry.lease.acquiredAt = '2026-03-18T23:58:00.000Z';
staleQueueEntry.lease.renewedAt = '2026-03-18T23:59:00.000Z';
staleQueueEntry.lastHeartbeatAt = '2026-03-18T23:59:00.000Z';
staleQueueEntry.startedAt = '2026-03-18T23:58:00.000Z';
await saveQueue(queueDir, queue, 'index');

const staleSweep = await requeueStaleJobs(queueDir, 'index', { maxRetries: 0 });
assert.equal(staleSweep.quarantined, 1, 'expected stale lease to quarantine once retry budget is exhausted');

const status = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'service', 'indexer-service.js'), 'status', '--config', configPath, '--json'],
  { encoding: 'utf8', env: process.env }
);
assert.equal(
  status.status,
  0,
  `expected status command to succeed; stderr=${status.stderr || '<empty>'}; stdout=${status.stdout || '<empty>'}`
);

const payload = JSON.parse(status.stdout || '{}');
assert.equal(payload.ok, true, 'expected status payload to succeed');
assert.equal(payload.metrics?.retryRate?.value, 1, 'expected retry rate to reflect one retried active job');
assert.equal(payload.metrics?.retryRate?.retriedActiveJobs, 1, 'expected retried active job count');
assert.equal(payload.metrics?.leaseExpiry?.quarantinedJobs, 1, 'expected one lease-expiry quarantine record');
assert.equal(payload.metrics?.leaseExpiry?.totalRecords, 1, 'expected lease-expiry total records to aggregate current state');
assert.equal(payload.metrics?.queueAge?.oldestQueuedMs >= 0, true, 'expected queue age metrics to be present');
assert.equal(payload.metrics?.saturation?.state, payload.backpressure?.state, 'expected saturation contract to align with backpressure state');
assert.equal(payload.metrics?.saturation?.ratio, payload.backpressure?.saturationRatio, 'expected saturation ratio to align with backpressure ratio');
assert.equal(payload.metrics?.saturation?.sloState, payload.backpressure?.slo?.state, 'expected saturation SLO state to align');

console.log('indexer service metrics contract cli test passed');
