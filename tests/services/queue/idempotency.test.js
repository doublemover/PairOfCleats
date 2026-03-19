#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import {
  claimNextJob,
  enqueueJob,
  ensureQueueDir,
  loadQueue,
  queueSummary,
  requeueStaleJobs,
  saveQueue
} from '../../../tools/service/queue.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'service-queue-idempotency');
const queueDir = path.join(tempRoot, 'queue');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await ensureQueueDir(queueDir);

const baseJob = {
  createdAt: new Date().toISOString(),
  repo: '/tmp/repo-idempotency',
  repoRoot: '/tmp/repo-idempotency',
  mode: 'code',
  reason: 'test',
  stage: 'stage1',
  buildId: 'build-a'
};

const first = await enqueueJob(queueDir, { ...baseJob, id: 'job-a' }, null, 'index');
assert.equal(first.ok, true, 'expected first enqueue to succeed');
assert.equal(first.duplicate, undefined, 'expected first enqueue to be a real insert');

const duplicate = await enqueueJob(queueDir, { ...baseJob, id: 'job-b' }, null, 'index');
assert.equal(duplicate.ok, true, 'expected duplicate enqueue to resolve cleanly');
assert.equal(duplicate.duplicate, true, 'expected duplicate enqueue to be suppressed');
assert.equal(duplicate.replaySuppressed, true, 'expected duplicate enqueue to report replay suppression');
assert.equal(duplicate.job?.id, 'job-a', 'expected duplicate enqueue to point at the original job');

const afterDuplicateSummary = await queueSummary(queueDir, 'index');
assert.equal(afterDuplicateSummary.total, 1, 'expected duplicate enqueue to avoid adding a second active job');

await enqueueJob(queueDir, { ...baseJob, id: 'job-c' }, null, 'index', { forceDuplicate: true });
await enqueueJob(queueDir, {
  ...baseJob,
  id: 'job-unique',
  buildId: 'build-b',
  indexDir: '/tmp/repo-idempotency/index-b'
}, null, 'index');

const claimed = await claimNextJob(queueDir, 'index', { ownerId: 'worker-idempotent' });
assert.equal(claimed?.id, 'job-a', 'expected first logical job to claim first');

const claimedQueue = await loadQueue(queueDir, 'index');
const suppressed = claimedQueue.jobs.find((job) => job.id === 'job-c');
assert.equal(suppressed?.status, 'failed', 'expected queued duplicate to be suppressed during claim');
assert.match(String(suppressed?.lastError || ''), /duplicate logical job suppressed/i, 'expected duplicate suppression error');
assert.equal(suppressed?.result?.duplicateOfId, 'job-a', 'expected duplicate metadata to reference claimed job');

const uniqueClaim = await claimNextJob(queueDir, 'index', { ownerId: 'worker-unique' });
assert.equal(uniqueClaim?.id, 'job-unique', 'expected unique job to remain claimable after duplicate suppression');

const replayRoot = resolveTestCachePath(root, 'service-queue-idempotency-replay');
const replayQueueDir = path.join(replayRoot, 'queue');
await fsPromises.rm(replayRoot, { recursive: true, force: true });
await ensureQueueDir(replayQueueDir);

const replayBaseJob = {
  ...baseJob,
  repo: '/tmp/repo-replay',
  repoRoot: '/tmp/repo-replay',
  buildId: 'build-replay'
};

await enqueueJob(replayQueueDir, { ...replayBaseJob, id: 'job-replay' }, null, 'index');
const replayClaim = await claimNextJob(replayQueueDir, 'index', {
  ownerId: 'worker-replay',
  leaseMs: 5
});
assert.equal(replayClaim?.status, 'running', 'expected replay job to start running');

const replayExpiredQueue = await loadQueue(replayQueueDir, 'index');
const replayRunning = replayExpiredQueue.jobs.find((job) => job.id === 'job-replay');
const expiredAt = new Date(Date.now() - 1000).toISOString();
replayRunning.lease.expiresAt = expiredAt;
replayRunning.lastHeartbeatAt = expiredAt;
await saveQueue(replayQueueDir, replayExpiredQueue, 'index');

const staleResult = await requeueStaleJobs(replayQueueDir, 'index', { maxRetries: 2 });
assert.equal(staleResult.retried, 1, 'expected expired replay lease to requeue');

const replayQueue = await loadQueue(replayQueueDir, 'index');
const replayQueued = replayQueue.jobs.find((job) => job.id === 'job-replay');
replayQueued.nextEligibleAt = new Date(Date.now() - 1000).toISOString();
await saveQueue(replayQueueDir, replayQueue, 'index');

const replayDuplicate = await enqueueJob(replayQueueDir, { ...replayBaseJob, id: 'job-replay-2' }, null, 'index');
assert.equal(replayDuplicate.duplicate, true, 'expected replay enqueue to suppress duplicate logical work');
assert.equal(replayDuplicate.job?.id, 'job-replay', 'expected replay suppression to point at the requeued job');

console.log('service queue idempotency test passed');
