#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import {
  claimNextJob,
  enqueueJob,
  ensureQueueDir,
  inspectJobReplayState,
  loadQueue,
  requeueStaleJobs,
  retryQuarantinedJob,
  saveQueue
} from '../../../tools/service/queue.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'service-queue-replay-inspection');
const queueDir = path.join(tempRoot, 'queue');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await ensureQueueDir(queueDir);

const baseJob = {
  createdAt: new Date().toISOString(),
  repo: '/tmp/repo-replay-inspection',
  repoRoot: '/tmp/repo-replay-inspection',
  mode: 'code',
  reason: 'test',
  stage: 'stage1',
  buildId: 'build-inspect'
};

await enqueueJob(queueDir, { ...baseJob, id: 'job-original', maxRetries: 0 }, null, 'index');
const claimed = await claimNextJob(queueDir, 'index', {
  ownerId: 'worker-inspect',
  leaseMs: 5
});
assert.equal(claimed?.status, 'running');

const queue = await loadQueue(queueDir, 'index');
const running = queue.jobs.find((job) => job.id === 'job-original');
const expiredAt = new Date(Date.now() - 1000).toISOString();
running.lease.expiresAt = expiredAt;
running.lastHeartbeatAt = expiredAt;
await saveQueue(queueDir, queue, 'index');

const stale = await requeueStaleJobs(queueDir, 'index', { maxRetries: 0 });
assert.equal(stale.quarantined, 1, 'expected exhausted job to move into quarantine');

const retried = await retryQuarantinedJob(queueDir, 'job-original', 'index');
assert.equal(retried?.ok, true);
assert.ok(retried?.job?.id, 'expected manual retry to create a fresh queue job');

const inspection = await inspectJobReplayState(queueDir, retried.job.id, 'index');
assert.equal(inspection?.deliverySemantics, 'at-least-once');
assert.equal(inspection?.job?.delivery?.replayOfJobId, 'job-original');
assert.equal(inspection?.job?.replayHistory?.some((entry) => entry?.action === 'manual-retry-created'), true);
assert.equal(inspection?.relatedJobs?.some((entry) => entry?.id === 'job-original'), true);

console.log('service queue replay inspection test passed');
