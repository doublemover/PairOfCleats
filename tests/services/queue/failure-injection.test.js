#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { acquireFileLock } from '../../../src/shared/locks/file-lock.js';
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  ensureQueueDir,
  getQueuePaths,
  loadQueue,
  quarantineSummary,
  requeueStaleJobs
} from '../../../tools/service/queue.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'service-queue-failure-injection');
const queueDir = path.join(tempRoot, 'queue');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await ensureQueueDir(queueDir);

const baseJob = {
  createdAt: new Date().toISOString(),
  repo: '/tmp/repo-failure-injection',
  repoRoot: '/tmp/repo-failure-injection',
  mode: 'code',
  reason: 'test',
  stage: 'stage1'
};

await enqueueJob(queueDir, { ...baseJob, id: 'job-duplicate-a', buildId: 'dup-build' }, null, 'index');
await enqueueJob(queueDir, { ...baseJob, id: 'job-duplicate-b', buildId: 'dup-build' }, null, 'index', {
  forceDuplicate: true
});
const duplicateClaim = await claimNextJob(queueDir, 'index', { ownerId: 'worker-duplicate' });
assert.equal(duplicateClaim?.id, 'job-duplicate-a', 'expected original logical work to claim first');
const duplicateQueue = await loadQueue(queueDir, 'index');
const duplicateSuppressed = duplicateQueue.jobs.find((job) => job.id === 'job-duplicate-b');
assert.equal(duplicateSuppressed?.status, 'failed', 'expected duplicate claim injection to suppress stale queued duplicate');
assert.equal(duplicateSuppressed?.result?.reason, 'duplicate-claim-suppressed', 'expected operator-visible duplicate suppression reason');

await enqueueJob(queueDir, { ...baseJob, id: 'job-crash-before-complete', maxRetries: 1 }, null, 'index-crash');
const crashed = await claimNextJob(queueDir, 'index-crash', { ownerId: 'worker-crash', leaseMs: 5 });
const crashQueue = await loadQueue(queueDir, 'index-crash');
const crashRunning = crashQueue.jobs.find((job) => job.id === crashed.id);
const expiredAt = new Date(Date.now() - 1000).toISOString();
crashRunning.lease.expiresAt = expiredAt;
crashRunning.lastHeartbeatAt = expiredAt;
await fsPromises.writeFile(
  getQueuePaths(queueDir, 'index-crash').queuePath,
  JSON.stringify({ jobs: crashQueue.jobs }, null, 2)
);
const crashRecovery = await requeueStaleJobs(queueDir, 'index-crash', { maxRetries: 1 });
assert.equal(crashRecovery.retried, 1, 'expected crash-before-complete injection to requeue deterministically');
const recoveredCrash = (await loadQueue(queueDir, 'index-crash')).jobs.find((job) => job.id === crashed.id);
assert.equal(recoveredCrash?.status, 'queued', 'expected crash-before-complete recovery to return the job to queued');
assert.match(String(recoveredCrash?.lastError || ''), /lease expired before completion/i, 'expected operator-visible crash recovery reason');

await enqueueJob(queueDir, { ...baseJob, id: 'job-heartbeat-loss', maxRetries: 0 }, null, 'index-heartbeat');
const heartbeatLoss = await claimNextJob(queueDir, 'index-heartbeat', { ownerId: 'worker-heartbeat', leaseMs: 5 });
const heartbeatQueue = await loadQueue(queueDir, 'index-heartbeat');
const heartbeatRunning = heartbeatQueue.jobs.find((job) => job.id === heartbeatLoss.id);
heartbeatRunning.lease.expiresAt = expiredAt;
heartbeatRunning.lastHeartbeatAt = expiredAt;
await fsPromises.writeFile(
  getQueuePaths(queueDir, 'index-heartbeat').queuePath,
  JSON.stringify({ jobs: heartbeatQueue.jobs }, null, 2)
);
const heartbeatRecovery = await requeueStaleJobs(queueDir, 'index-heartbeat', { maxRetries: 0 });
assert.equal(heartbeatRecovery.quarantined, 1, 'expected heartbeat-loss injection to quarantine exhausted work');
const heartbeatQuarantine = await quarantineSummary(queueDir, 'index-heartbeat');
assert.equal(heartbeatQuarantine.quarantined, 1, 'expected operator-visible quarantine summary after heartbeat loss');
const heartbeatReport = JSON.parse(await fsPromises.readFile(heartbeatLoss.reportPath, 'utf8'));
assert.equal(heartbeatReport.quarantined, true, 'expected stale heartbeat recovery to rewrite the operator report as quarantined');

await enqueueJob(queueDir, { ...baseJob, id: 'job-crash-after-report', maxRetries: 0 }, null, 'index-after-report');
const crashAfterReport = await claimNextJob(queueDir, 'index-after-report', { ownerId: 'worker-after-report', leaseMs: 5 });
await fsPromises.mkdir(path.dirname(crashAfterReport.reportPath), { recursive: true });
await fsPromises.writeFile(crashAfterReport.reportPath, JSON.stringify({
  updatedAt: new Date().toISOString(),
  status: 'running',
  job: { id: crashAfterReport.id }
}, null, 2));
const afterReportQueue = await loadQueue(queueDir, 'index-after-report');
const afterReportRunning = afterReportQueue.jobs.find((job) => job.id === crashAfterReport.id);
afterReportRunning.lease.expiresAt = expiredAt;
afterReportRunning.lastHeartbeatAt = expiredAt;
await fsPromises.writeFile(
  getQueuePaths(queueDir, 'index-after-report').queuePath,
  JSON.stringify({ jobs: afterReportQueue.jobs }, null, 2)
);
const afterReportRecovery = await requeueStaleJobs(queueDir, 'index-after-report', { maxRetries: 0 });
assert.equal(afterReportRecovery.quarantined, 1, 'expected crash-after-report injection to quarantine deterministically');
const repairedAfterReport = JSON.parse(await fsPromises.readFile(crashAfterReport.reportPath, 'utf8'));
assert.equal(repairedAfterReport.quarantined, true, 'expected stale sweep to replace the stale pre-crash report with quarantined state');

await enqueueJob(queueDir, { ...baseJob, id: 'job-partial-report' }, null, 'index-report');
const partialReportJob = await claimNextJob(queueDir, 'index-report', { ownerId: 'worker-report' });
await fsPromises.mkdir(path.dirname(partialReportJob.reportPath), { recursive: true });
await fsPromises.writeFile(partialReportJob.reportPath, '{"updatedAt":"partial"', 'utf8');
await completeJob(queueDir, partialReportJob.id, 'done', { exitCode: 0 }, 'index-report', {
  ownerId: 'worker-report',
  expectedLeaseVersion: partialReportJob.lease?.version ?? null
});
const repairedReport = JSON.parse(await fsPromises.readFile(partialReportJob.reportPath, 'utf8'));
assert.equal(repairedReport.status, 'done', 'expected partial report injection to be overwritten by final completion report');
assert.equal(repairedReport.job?.id, partialReportJob.id, 'expected repaired report to retain the job identity');

const lockPath = getQueuePaths(queueDir, 'index-lock').lockPath;
await ensureQueueDir(queueDir);
const lock = await acquireFileLock({
  lockPath,
  waitMs: 100,
  pollMs: 25,
  staleMs: 30 * 60 * 1000,
  metadata: { scope: 'failure-injection-test' },
  timeoutBehavior: 'throw',
  timeoutMessage: 'failure-injection-holder-timeout'
});
assert.ok(lock, 'expected to acquire the synthetic lock holder');
let lockError = null;
try {
  await enqueueJob(queueDir, { ...baseJob, id: 'job-lock-timeout' }, null, 'index-lock');
} catch (error) {
  lockError = error;
}
await lock.release();
assert.ok(lockError, 'expected locked queue injection to raise an error');
assert.equal(lockError?.code, 'QUEUE_LOCK_TIMEOUT', 'expected stable operator-visible lock timeout code');
assert.match(String(lockError?.message || ''), /Queue lock timeout\./, 'expected stable operator-visible lock timeout message');

console.log('service queue failure injection test passed');
