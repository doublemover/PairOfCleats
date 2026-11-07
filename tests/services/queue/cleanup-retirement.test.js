import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { createQueueWorker } from '../../../tools/service/indexer-service/queue-worker.js';
import { createJobCompletion } from '../../../tools/service/indexer-service/job-completion.js';
import { captureQueueFailureOwnership, createQueueCleanupRecovery, getQueueCleanupPath,
  QUEUE_CLEANUP_HOLD_SCHEMA_VERSION } from '../../../tools/service/queue-cleanup.js';
import { claimNextJob, completeJob, compactQueueState, enqueueJob, inspectJobReplayState,
  loadQueue, loadQuarantine, quarantineJob, queueSummary, reconcileJobCleanup, requeueStaleJobs,
  replayQueueStateFromJournal, retainJobCleanup, retryQuarantinedJob, saveQueue } from '../../../tools/service/queue.js';
import { inspectRepairState } from '../../../tools/service/repair.js';

const { dir } = await prepareIsolatedTestCacheDir('queue-cleanup-retirement');
const counters = () => ({ processed: 0, succeeded: 0, failed: 0, retried: 0 });
const fixture = async (name, options = {}) => {
  const queueDir = path.join(dir, name); await fs.mkdir(queueDir);
  await enqueueJob(queueDir, { id: name, repo: path.join(queueDir, 'repo'), maxRetries: 3 }, null, 'index');
  let closed = false, executions = 0;
  const originalObserve = () => closed;
  const original = Object.assign(new Error(`original ${name} cleanup failure`), {
    code: 'ORIGINAL_CLOSE_FAILED', cacheOwnershipPending: true, cacheOwnershipReleased: originalObserve });
  const updates = [];
  const completion = createJobCompletion({ queueDir, resolvedQueueName: 'index', queueMaxRetries: 3, completeJob, quarantineJob });
  const build = overrides => createQueueWorker({ queueDir, resolvedQueueName: 'index', staleQueueMaxRetries: 3,
    monitorBuildProgress: true, startBuildProgressMonitor: () => async () => { throw original; },
    touchJobHeartbeat: async () => {}, requeueStaleJobs, claimNextJob, ensureQueueDir: async () => {},
    executeClaimedJob: async () => { executions++; return { handled: false, runResult: { exitCode: 0 } }; },
    finalizeJobRun: completion.finalizeJobRun, buildDefaultRunResult: () => ({ exitCode: 1, cancelled: false }),
    updateShutdownWorkerState: async patch => { updates.push(patch); }, printPayload: () => {},
    queueSummary: () => queueSummary(queueDir, 'index'), ...overrides });
  return { queueDir, original, originalObserve, updates, build, worker: build(options),
    release: () => { closed = true; }, executions: () => executions };
};

{
  const f = await fixture('failed-disposer');
  let retained;
  await assert.rejects(f.worker.runWorkLoop({ requestedConcurrency: 1, intervalMs: 100,
    serviceExecutionMode: 'subprocess' }), error => {
    retained = error;
    return error.code === 'QUEUE_CLEANUP_PENDING' && error.cause === f.original
      && error.cacheOwnershipReleased() === false;
  });
  assert.equal(f.executions(), 1);
  assert.equal(f.updates.at(-1).status, 'cleanup-pending');
  assert.deepEqual(f.updates.at(-1).activeJobs, ['failed-disposer']);
  const snapshot = await loadQueue(f.queueDir, 'index');
  assert.equal(snapshot.jobs[0].status, 'running', 'a nominal exit cannot become done after failed resource cleanup');
  assert.equal(snapshot.cleanupHolds.length, 1);
  assert.equal(snapshot.cleanupHolds[0].leaseVersion, snapshot.jobs[0].lease.version);
  assert.equal((await queueSummary(f.queueDir, 'index')).cleanupPending, 1);
  assert.equal((await inspectJobReplayState(f.queueDir, 'failed-disposer', 'index')).cleanupHolds.length, 1);
  assert.equal((await inspectRepairState(f.queueDir, 'index')).cleanup.pending, 1);

  const fresh = f.build({ monitorBuildProgress: false });
  await assert.rejects(fresh.processQueueOnce(counters()), { code: 'QUEUE_CLEANUP_PENDING' });
  assert.deepEqual(await fresh.recoverPendingCleanup(), { recovered: 0, pending: 0 });
  assert.equal((await loadQueue(f.queueDir, 'index')).cleanupHolds.length, 1, 'a restarted worker has no original release capability');
  snapshot.jobs[0].lease.expiresAt = '2000-01-01T00:00:00.000Z';
  await saveQueue(f.queueDir, snapshot, 'index');
  assert.deepEqual(await requeueStaleJobs(f.queueDir, 'index', { maxRetries: 3 }),
    { stale: 0, retried: 0, failed: 0, quarantined: 0 });
  const claim = snapshot.jobs[0];
  const lease = { ownerId: claim.lease.owner, expectedLeaseVersion: claim.lease.version };
  await assert.rejects(completeJob(f.queueDir, claim.id, 'done', { exitCode: 0 }, 'index', lease), { code: 'QUEUE_CLEANUP_PENDING' });
  await assert.rejects(quarantineJob(f.queueDir, claim.id, 'manual', 'index', lease), { code: 'QUEUE_CLEANUP_PENDING' });
  await assert.rejects(retryQuarantinedJob(f.queueDir, claim.id, 'index'), { code: 'QUEUE_CLEANUP_PENDING' });
  await assert.rejects(enqueueJob(f.queueDir, { id: 'replacement', repo: path.join(f.queueDir, 'other') }, null, 'index'),
    { code: 'QUEUE_CLEANUP_PENDING' });
  await fs.writeFile(claim.logPath, 'original resource evidence');
  await compactQueueState(f.queueDir, 'index', { retentionPolicy: { doneJobs: 0, failedJobs: 0 } });
  assert.equal(await fs.readFile(claim.logPath, 'utf8'), 'original resource evidence');
  assert.equal((await replayQueueStateFromJournal(f.queueDir, 'index')).queue.cleanupHolds.length, 1);
  await assert.rejects(reconcileJobCleanup(f.queueDir, 'index', {}), { code: 'QUEUE_CLEANUP_AUTHORITY' });
  await assert.rejects(reconcileJobCleanup(f.queueDir, 'other', retained.queueCleanupRecovery), { code: 'QUEUE_CLEANUP_AUTHORITY' });

  f.original.cacheOwnershipPending = false; f.original.cacheOwnershipReleased = () => true;
  await assert.rejects(f.worker.recoverPendingCleanup(), { code: 'QUEUE_CLEANUP_PENDING' });
  assert.equal((await loadQueue(f.queueDir, 'index')).cleanupHolds.length, 1, 'mutated flags/observers cannot release the original resource');
  f.release();
  const recovered = await Promise.all([f.worker.recoverPendingCleanup(), f.worker.recoverPendingCleanup()]);
  assert.deepEqual(recovered, [{ recovered: 1, pending: 0 }, { recovered: 1, pending: 0 }]);
  assert.equal(retained.cacheOwnershipReleased(), true);
  assert.equal((await loadQueue(f.queueDir, 'index')).cleanupHolds.length, 0);
  const quarantined = (await loadQuarantine(f.queueDir, 'index')).jobs[0];
  assert.equal(quarantined.status, 'failed'); assert.equal(quarantined.quarantine.reason, 'retry-exhausted');
  assert.equal(quarantined.result.exitCode, 1); assert.equal(f.executions(), 1, 'resource reconciliation cannot retry original execution');
  assert.deepEqual(f.updates.at(-1).activeJobs, []);
  await enqueueJob(f.queueDir, { id: 'after-recovery', repo: path.join(f.queueDir, 'new') }, null, 'index');
  assert.equal((await claimNextJob(f.queueDir, 'index')).id, 'after-recovery');
}

{
  let writes = 0;
  const f = await fixture('receipt-write-failed', { retainJobCleanup: async (...args) => {
    if (++writes === 1) throw Object.assign(new Error('original receipt storage failed'), { code: 'EIO' });
    return retainJobCleanup(...args);
  } });
  await assert.rejects(f.worker.processQueueOnce(counters()), error => error.cause === f.original && error.errors.some(item => item?.code === 'EIO'));
  await assert.rejects(f.worker.processQueueOnce(counters()), { code: 'QUEUE_CLEANUP_PENDING' });
  assert.equal((await loadQueue(f.queueDir, 'index')).cleanupHolds.length, 1, 'later observation persists the original retained capability');
  assert.equal(f.executions(), 1);
  f.release(); await f.worker.recoverPendingCleanup();
}

{
  const queueDir = path.join(dir, 'generation'); await fs.mkdir(queueDir);
  await enqueueJob(queueDir, { id: 'same-id', repo: queueDir }, null, 'index');
  const older = await claimNextJob(queueDir, 'index', { ownerId: 'older' });
  await completeJob(queueDir, older.id, 'queued', {}, 'index', { ownerId: 'older', expectedLeaseVersion: older.lease.version });
  const newer = await claimNextJob(queueDir, 'index', { ownerId: 'newer' });
  let released = false;
  const error = Object.assign(new Error('old exact owner'), { cacheOwnershipReleased: () => released });
  const recovery = createQueueCleanupRecovery({ dirPath: queueDir, queueName: 'index', job: older,
    observations: [captureQueueFailureOwnership(error, { required: true })], causes: [error] });
  await retainJobCleanup(queueDir, 'index', recovery.capability);
  assert.equal((await loadQueue(queueDir, 'index')).jobs[0].lease.owner, 'newer', 'old failure retention cannot overwrite the new lease');
  released = true; await reconcileJobCleanup(queueDir, 'index', recovery.capability);
  const actual = (await loadQueue(queueDir, 'index')).jobs[0];
  assert.equal(actual.lease.owner, newer.lease.owner); assert.equal(actual.lease.version, newer.lease.version);
}
{
  const queueDir = path.join(dir, 'invalid-receipt'); await fs.mkdir(queueDir);
  await enqueueJob(queueDir, { id: 'blocked-by-invalid-receipt', repo: queueDir }, null, 'index');
  for (const payload of [{}, { schemaVersion: QUEUE_CLEANUP_HOLD_SCHEMA_VERSION + 1, holds: [] },
    { schemaVersion: QUEUE_CLEANUP_HOLD_SCHEMA_VERSION, holds: [{ id: 'invented' }] }]) {
    await fs.writeFile(getQueueCleanupPath(queueDir, 'index'), JSON.stringify(payload));
    await assert.rejects(claimNextJob(queueDir, 'index'), { code: 'QUEUE_INVALID_CLEANUP_STATE' });
  }
}
console.log('failed queue disposers retain durable exact-claim fences until original settlement, including reload and recovery');
