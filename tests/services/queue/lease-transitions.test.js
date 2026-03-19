#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import {
  ensureQueueDir,
  enqueueJob,
  claimNextJob,
  completeJob,
  loadQueue,
  saveQueue,
  queueSummary,
  requeueStaleJobs,
  touchJobHeartbeat
} from '../../../tools/service/queue.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'service-queue-lease-transitions');
const queueDir = path.join(tempRoot, 'queue');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await ensureQueueDir(queueDir);

const baseJob = {
  createdAt: new Date().toISOString(),
  repo: '/tmp/repo',
  repoRoot: '/tmp/repo',
  mode: 'all',
  reason: 'test'
};

await enqueueJob(queueDir, { ...baseJob, id: 'job-complete' }, null, 'index');
const claimed = await claimNextJob(queueDir, 'index', {
  ownerId: 'worker-a',
  leaseMs: 2000
});
assert.equal(claimed?.status, 'running', 'expected queued job to transition to running');
assert.equal(claimed?.lease?.owner, 'worker-a', 'expected lease owner on claim');
assert.equal(claimed?.lease?.version, 1, 'expected first claim to use lease version 1');
assert.ok(claimed?.lease?.expiresAt, 'expected lease expiry metadata on claim');

await assert.rejects(
  () => completeJob(queueDir, claimed.id, 'done', { exitCode: 0 }, 'index', {
    ownerId: 'worker-b',
    expectedLeaseVersion: claimed.lease?.version ?? null
  }),
  /lease owned/i,
  'expected mismatched owner to be rejected'
);

await touchJobHeartbeat(queueDir, claimed.id, 'index', {
  ownerId: 'worker-a',
  expectedLeaseVersion: claimed.lease?.version ?? null,
  leaseMs: 4000
});
const afterHeartbeat = (await loadQueue(queueDir, 'index')).jobs.find((job) => job.id === claimed.id);
assert.equal(afterHeartbeat?.lease?.owner, 'worker-a', 'expected heartbeat to preserve lease owner');
assert.equal(afterHeartbeat?.lease?.version, 1, 'expected heartbeat to keep lease version stable');
assert.ok(Date.parse(afterHeartbeat?.lease?.expiresAt || '') > Date.parse(claimed?.lease?.expiresAt || ''), 'expected heartbeat to extend lease expiry');

await completeJob(queueDir, claimed.id, 'done', { exitCode: 0 }, 'index', {
  ownerId: 'worker-a',
  expectedLeaseVersion: claimed.lease?.version ?? null
});
const completed = (await loadQueue(queueDir, 'index')).jobs.find((job) => job.id === claimed.id);
assert.equal(completed?.status, 'done', 'expected running job to complete successfully');
assert.equal(completed?.lease?.owner, null, 'expected completed job to release active lease');
assert.equal(completed?.lease?.lastOwner, 'worker-a', 'expected completed job to record prior lease owner');

await enqueueJob(queueDir, { ...baseJob, id: 'job-retry' }, null, 'index');
const retried = await claimNextJob(queueDir, 'index', {
  ownerId: 'worker-retry',
  leaseMs: 2000
});
await completeJob(queueDir, retried.id, 'queued', { exitCode: 1, retry: true, attempts: 1 }, 'index', {
  ownerId: 'worker-retry',
  expectedLeaseVersion: retried.lease?.version ?? null
});
const queuedRetry = (await loadQueue(queueDir, 'index')).jobs.find((job) => job.id === retried.id);
assert.equal(queuedRetry?.status, 'queued', 'expected retry path to return job to queued');
assert.equal(queuedRetry?.attempts, 1, 'expected retry path to increment attempts');
assert.ok(queuedRetry?.nextEligibleAt, 'expected retry path to set next eligible timestamp');
assert.equal(queuedRetry?.lease?.owner, null, 'expected retry path to clear active lease');

await enqueueJob(queueDir, { ...baseJob, id: 'job-stale', stage: 'stage2', maxRetries: 1 }, null, 'index-stale');
const staleJob = await claimNextJob(queueDir, 'index-stale', {
  ownerId: 'worker-stale',
  leaseMs: 5
});
await new Promise((resolve) => setTimeout(resolve, 1200));
const staleResult = await requeueStaleJobs(queueDir, 'index-stale', { maxRetries: 1 });
assert.equal(staleResult.stale, 1, 'expected stale sweep to detect expired lease');
assert.equal(staleResult.retried, 1, 'expected stale sweep to retry first expired lease');
const staleQueued = (await loadQueue(queueDir, 'index-stale')).jobs.find((job) => job.id === staleJob.id);
assert.equal(staleQueued?.status, 'queued', 'expected expired lease to requeue job');
assert.equal(staleQueued?.attempts, 1, 'expected stale retry to increment attempts');
assert.equal(staleQueued?.lease?.owner, null, 'expected stale retry to clear lease owner');
assert.ok(staleQueued?.nextEligibleAt, 'expected stale retry to back off before reclaim');

const staleQueuePayload = await loadQueue(queueDir, 'index-stale');
const staleRetryJob = staleQueuePayload.jobs.find((job) => job.id === staleJob.id);
staleRetryJob.nextEligibleAt = new Date(Date.now() - 1000).toISOString();
await saveQueue(queueDir, staleQueuePayload, 'index-stale');

const reclaimed = await claimNextJob(queueDir, 'index-stale', {
  ownerId: 'worker-stale-2',
  leaseMs: 5
});
assert.equal(reclaimed?.id, staleJob.id, 'expected reclaimed job to be the retried stale job');
await new Promise((resolve) => setTimeout(resolve, 1200));
const staleFailure = await requeueStaleJobs(queueDir, 'index-stale', { maxRetries: 1 });
assert.equal(staleFailure.stale, 1, 'expected second stale sweep to detect expired lease again');
assert.equal(staleFailure.failed, 1, 'expected second stale sweep to fail expired job after retries exhausted');
const failedStale = (await loadQueue(queueDir, 'index-stale')).jobs.find((job) => job.id === staleJob.id);
assert.equal(failedStale?.status, 'failed', 'expected expired lease to fail after retry budget exhausted');
assert.match(String(failedStale?.result?.error || ''), /lease expired/i, 'expected lease-expired failure reason');

const summaryIndex = await queueSummary(queueDir, 'index');
const summaryStale = await queueSummary(queueDir, 'index-stale');
assert.equal(summaryIndex.done, 1, 'expected one successful completion in the primary queue');
assert.equal(summaryIndex.queued >= 1, true, 'expected retried queued job to remain queued in the primary queue');
assert.equal(summaryStale.failed, 1, 'expected one terminal failed stale job');

console.log('service queue lease transitions test passed');
