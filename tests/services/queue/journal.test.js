#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import {
  claimNextJob,
  completeJob,
  enqueueJob,
  ensureQueueDir,
  getQuarantinePaths,
  getQueuePaths,
  loadQuarantine,
  loadQueue,
  quarantineJob,
  readQueueJournal,
  replayQueueStateFromJournal,
  touchJobHeartbeat
} from '../../../tools/service/queue.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'service-queue-journal');
const queueDir = path.join(tempRoot, 'queue');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await ensureQueueDir(queueDir);

const baseJob = {
  createdAt: new Date().toISOString(),
  repo: '/tmp/repo-journal',
  repoRoot: '/tmp/repo-journal',
  mode: 'code',
  reason: 'test',
  stage: 'stage1',
  observability: {
    surface: 'service',
    operation: 'queue_enqueue',
    correlation: {
      correlationId: 'queue-correlation-test',
      requestId: 'queue-request-test'
    },
    context: {
      repoRoot: '/tmp/repo-journal'
    }
  }
};

await enqueueJob(queueDir, { ...baseJob, id: 'job-retry' }, null, 'index');
const claimedRetry = await claimNextJob(queueDir, 'index', { ownerId: 'worker-journal' });
await touchJobHeartbeat(queueDir, claimedRetry.id, 'index', {
  ownerId: 'worker-journal',
  expectedLeaseVersion: claimedRetry.lease?.version ?? null
});
await completeJob(queueDir, claimedRetry.id, 'queued', {
  exitCode: 1,
  retry: true,
  attempts: 1,
  error: 'retry requested'
}, 'index', {
  ownerId: 'worker-journal',
  expectedLeaseVersion: claimedRetry.lease?.version ?? null
});
const retryQueue = await loadQueue(queueDir, 'index');
const retriable = retryQueue.jobs.find((job) => job.id === 'job-retry');
retriable.nextEligibleAt = new Date(Date.now() - 1000).toISOString();
await fsPromises.writeFile(
  getQueuePaths(queueDir, 'index').queuePath,
  JSON.stringify({ jobs: retryQueue.jobs }, null, 2)
);
const reclaimedRetry = await claimNextJob(queueDir, 'index', { ownerId: 'worker-journal-2' });
await completeJob(queueDir, reclaimedRetry.id, 'done', { exitCode: 0 }, 'index', {
  ownerId: 'worker-journal-2',
  expectedLeaseVersion: reclaimedRetry.lease?.version ?? null
});

await enqueueJob(queueDir, { ...baseJob, id: 'job-poison', buildId: 'build-poison' }, null, 'index');
const claimedPoison = await claimNextJob(queueDir, 'index', { ownerId: 'worker-poison' });
await quarantineJob(queueDir, claimedPoison.id, 'poison-payload', 'index', {
  ownerId: 'worker-poison',
  expectedLeaseVersion: claimedPoison.lease?.version ?? null,
  sourceStatus: 'running',
  result: {
    exitCode: 1,
    error: 'poison payload detected'
  }
});

const journal = await readQueueJournal(queueDir, 'index');
assert.equal(journal.length >= 7, true, 'expected multiple journal entries to be recorded');
assert.equal(journal.some((entry) => entry.eventType === 'enqueue'), true, 'expected enqueue events in the journal');
assert.equal(journal.some((entry) => entry.eventType === 'claim'), true, 'expected claim events in the journal');
assert.equal(journal.some((entry) => entry.eventType === 'heartbeat'), true, 'expected heartbeat events in the journal');
assert.equal(journal.some((entry) => entry.eventType === 'retry-scheduled'), true, 'expected retry events in the journal');
assert.equal(journal.some((entry) => entry.eventType === 'quarantine'), true, 'expected quarantine events in the journal');
assert.equal(
  journal.every((entry) => entry.observability?.correlation?.correlationId === 'queue-correlation-test'),
  true,
  'expected queue journal entries to preserve observability correlation'
);

const liveQueue = await loadQueue(queueDir, 'index');
const liveQuarantine = await loadQuarantine(queueDir, 'index');
const replayed = await replayQueueStateFromJournal(queueDir, 'index');

const replayRetry = replayed.queue.jobs.find((job) => job.id === 'job-retry');
assert.equal(replayRetry?.status, 'done', 'expected replayed queue state to reconstruct completed jobs');
const liveRetry = liveQueue.jobs.find((job) => job.id === 'job-retry');
assert.equal(replayRetry?.transition?.to, liveRetry?.transition?.to, 'expected replayed completion state to match live queue state');

const replayPoison = replayed.quarantine.jobs.find((job) => job.id === 'job-poison');
const livePoison = liveQuarantine.jobs.find((job) => job.id === 'job-poison');
assert.equal(replayPoison?.quarantine?.reason, livePoison?.quarantine?.reason, 'expected replayed quarantine reason to match live quarantine state');

await fsPromises.rm(getQueuePaths(queueDir, 'index').queuePath, { force: true });
await fsPromises.rm(getQuarantinePaths(queueDir, 'index').quarantinePath, { force: true });
const recovered = await replayQueueStateFromJournal(queueDir, 'index');
assert.equal(recovered.queue.jobs.find((job) => job.id === 'job-retry')?.status, 'done', 'expected journal replay to recover queue state without queue.json');
assert.equal(recovered.quarantine.jobs.find((job) => job.id === 'job-poison')?.quarantine?.reason, 'poison-payload', 'expected journal replay to recover quarantine state without quarantine.json');

console.log('service queue journal test passed');
