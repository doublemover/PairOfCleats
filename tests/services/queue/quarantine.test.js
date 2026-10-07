#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import {
  claimNextJob,
  enqueueJob,
  ensureQueueDir,
  loadQuarantine,
  loadQueue,
  purgeQuarantinedJobs,
  quarantineJob,
  quarantineSummary,
  requeueStaleJobs,
  retryQuarantinedJob,
  saveQueue
} from '../../../tools/service/queue.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'service-queue-quarantine');
const queueDir = path.join(tempRoot, 'queue');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await ensureQueueDir(queueDir);

const baseJob = {
  createdAt: new Date().toISOString(),
  repo: '/tmp/repo-quarantine',
  repoRoot: '/tmp/repo-quarantine',
  mode: 'code',
  reason: 'test',
  stage: 'stage1'
};

await enqueueJob(queueDir, { ...baseJob, id: 'job-poison', buildId: 'build-poison' }, null, 'index');
const claimed = await claimNextJob(queueDir, 'index', { ownerId: 'worker-poison' });
assert.equal(claimed?.status, 'running', 'expected poison job to be claimed');

const quarantined = await quarantineJob(queueDir, claimed.id, 'poison-payload', 'index', {
  ownerId: 'worker-poison',
  expectedLeaseVersion: claimed.lease?.version ?? null,
  sourceStatus: 'running',
  result: {
    exitCode: 1,
    error: 'poison payload detected'
  }
});
assert.equal(quarantined?.quarantine?.reason, 'poison-payload', 'expected quarantine reason to be recorded');

const primaryQueue = await loadQueue(queueDir, 'index');
assert.equal(primaryQueue.jobs.length, 0, 'expected poisoned job to be removed from the hot queue');

const quarantineStore = await loadQuarantine(queueDir, 'index');
const poisonEntry = quarantineStore.jobs.find((job) => job.id === claimed.id);
assert.equal(poisonEntry?.quarantine?.state, 'quarantined', 'expected poison job to remain active in quarantine');
assert.ok(poisonEntry?.logPath, 'expected quarantine record to preserve log path');
assert.ok(poisonEntry?.reportPath, 'expected quarantine record to preserve report path');

const quarantineCounts = await quarantineSummary(queueDir, 'index');
assert.equal(quarantineCounts.quarantined, 1, 'expected one active quarantined job');

const retryResult = await retryQuarantinedJob(queueDir, claimed.id, 'index');
assert.equal(retryResult?.ok, true, 'expected quarantined job retry to succeed');
assert.notEqual(retryResult?.job?.id, claimed.id, 'expected retried job to use a fresh queue id');

const afterRetryQueue = await loadQueue(queueDir, 'index');
assert.equal(afterRetryQueue.jobs.length, 1, 'expected retried job to re-enter the hot queue');
assert.equal(afterRetryQueue.jobs[0].status, 'queued', 'expected retried job to enqueue as queued');

const afterRetryQuarantine = await loadQuarantine(queueDir, 'index');
const retriedEntry = afterRetryQuarantine.jobs.find((job) => job.id === claimed.id);
assert.equal(retriedEntry?.quarantine?.state, 'retried', 'expected quarantine record to retain retry lineage');
assert.equal(retriedEntry?.quarantine?.retryJobId, retryResult?.job?.id, 'expected quarantine record to reference the new queue job');

const purgeResult = await purgeQuarantinedJobs(queueDir, 'index', { jobId: claimed.id });
assert.equal(purgeResult.removed, 1, 'expected targeted purge to remove retried quarantine record');
assert.equal((await loadQuarantine(queueDir, 'index')).jobs.length, 0, 'expected quarantine store to be empty after purge');

const staleRoot = resolveTestCachePath(root, 'service-queue-quarantine-stale');
const staleQueueDir = path.join(staleRoot, 'queue');
await fsPromises.rm(staleRoot, { recursive: true, force: true });
await ensureQueueDir(staleQueueDir);

await enqueueJob(staleQueueDir, {
  ...baseJob,
  id: 'job-stale',
  buildId: 'build-stale',
  maxRetries: 0
}, null, 'index');
const staleClaim = await claimNextJob(staleQueueDir, 'index', {
  ownerId: 'worker-stale',
  leaseMs: 5
});
assert.equal(staleClaim?.status, 'running', 'expected stale job to start running');

const staleQueue = await loadQueue(staleQueueDir, 'index');
const staleRunning = staleQueue.jobs.find((job) => job.id === 'job-stale');
const expiredAt = new Date(Date.now() - 1000).toISOString();
staleRunning.lease.expiresAt = expiredAt;
staleRunning.lastHeartbeatAt = expiredAt;
await saveQueue(staleQueueDir, staleQueue, 'index');

const staleSweep = await requeueStaleJobs(staleQueueDir, 'index', { maxRetries: 0 });
assert.equal(staleSweep.failed, 1, 'expected stale exhaustion to count as failed');
assert.equal(staleSweep.quarantined, 1, 'expected stale exhaustion to move the job into quarantine');
assert.equal((await loadQueue(staleQueueDir, 'index')).jobs.length, 0, 'expected exhausted stale job to leave the hot queue');

const staleQuarantine = await loadQuarantine(staleQueueDir, 'index');
const staleEntry = staleQuarantine.jobs.find((job) => job.id === 'job-stale');
assert.equal(staleEntry?.quarantine?.reason, 'lease-expired-fail', 'expected stale quarantine reason to be recorded');

console.log('service queue quarantine test passed');
