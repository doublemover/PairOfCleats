import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { createJobExecutor } from '../../../tools/service/indexer-service/job-executor.js';
import { createQueueWorker } from '../../../tools/service/indexer-service/queue-worker.js';
import { createJobCompletion } from '../../../tools/service/indexer-service/job-completion.js';
import { retainBuildIndexFailureOutcome } from '../../../src/integrations/core/build-index/outcome.js';
import { claimNextJob, completeJob, enqueueJob, loadQueue, loadQuarantine,
  quarantineJob, queueSummary, requeueStaleJobs } from '../../../tools/service/queue.js';

const { dir } = await prepareIsolatedTestCacheDir('daemon-cleanup-retirement');
const counters = () => ({ processed: 0, succeeded: 0, failed: 0, retried: 0 });
const hasCause = (error, wanted, seen = new Set()) => {
  if (error === wanted) return true;
  if (!error || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error);
  const cause = Object.getOwnPropertyDescriptor(error, 'cause')?.value;
  const errors = Object.getOwnPropertyDescriptor(error, 'errors')?.value;
  return hasCause(cause, wanted, seen) || (Array.isArray(errors) && errors.some(value => hasCause(value, wanted, seen)));
};
const makeExecutor = buildIndexImpl => createJobExecutor({ isEmbeddingsQueue: false,
  serviceExecutionMode: 'daemon', daemonWorkerConfig: { deterministic: true,
    governance: { maxConsecutiveFailures: 1, maxJobsPerSession: 1, subprocessCooldownJobs: 1 } },
  resolvedQueueName: 'index', embeddingExtraEnv: {}, resolveRepoRuntimeEnv: () => ({}),
  toolRoot: process.cwd(), completeNonRetriableFailure: async () => {}, buildIndexImpl,
  runBuildIndexSubprocessImpl: async () => { throw new Error('Pending ownership cannot become a subprocess fallback.'); } });
const originalConsoleError = console.error;
const logs = [];
console.error = (...values) => { logs.push(values.map(String).join(' ')); };
try {
  for (const kind of ['mutable', 'frozen', 'hostile-message', 'abort-cleanup']) {
    const queueDir = path.join(dir, kind); await fs.mkdir(queueDir);
    const repo = path.join(queueDir, 'repo');
    await enqueueJob(queueDir, { id: kind, repo, maxRetries: 3 }, null, 'index');
    await enqueueJob(queueDir, { id: kind + '-sibling', repo: path.join(queueDir, 'sibling') }, null, 'index');
    let released = false, calls = 0;
    const inspection = new Error('message is unreadable');
    const original = Object.assign(new Error('original daemon cleanup'), { code: 'NATIVE_CLOSE_FAILED',
      cacheOwnershipPending: true, cacheOwnershipReleased: () => released });
    if (kind === 'abort-cleanup') original.name = 'AbortError';
    if (kind === 'hostile-message') Object.defineProperty(original, 'message', { get() { throw inspection; } });
    if (kind !== 'mutable') Object.freeze(original);
    const executor = makeExecutor(async (root, options) => {
      assert.equal(options.daemonEnabled, true); calls++;
      if (root === repo) throw retainBuildIndexFailureOutcome(original, { repo: root, requestedStage: 'stage1' });
      return { outcome: { schemaVersion: 1, status: 'index-published' } };
    });
    const completion = createJobCompletion({ queueDir, resolvedQueueName: 'index', queueMaxRetries: 3, completeJob, quarantineJob });
    const updates = [], finalized = [];
    const worker = createQueueWorker({ queueDir, resolvedQueueName: 'index', staleQueueMaxRetries: 3,
      monitorBuildProgress: false, touchJobHeartbeat: async () => {}, requeueStaleJobs, claimNextJob,
      ensureQueueDir: async () => {}, executeClaimedJob: executor.executeClaimedJob,
      finalizeJobRun: async args => { finalized.push(args); return completion.finalizeJobRun(args); },
      buildDefaultRunResult: executor.buildDefaultRunResult, printPayload: () => {},
      updateShutdownWorkerState: async patch => { updates.push(patch); }, queueSummary: () => queueSummary(queueDir, 'index') });
    let retained;
    await assert.rejects(worker.processQueueOnce(counters()), error => {
      retained = error;
      return error.code === 'QUEUE_CLEANUP_PENDING' && hasCause(error, original) && error.cacheOwnershipReleased() === false;
    });
    assert.equal(calls, 1); assert.equal(finalized.length, 0, 'pending cleanup cannot reach normal completion/retry');
    assert.equal(updates.at(-1).status, 'cleanup-pending');
    const pending = await loadQueue(queueDir, 'index');
    const claimed = pending.jobs.find(job => job.id === kind);
    assert.equal(claimed.status, 'running'); assert.equal(pending.cleanupHolds.length, 1);
    assert.equal(pending.cleanupHolds[0].leaseVersion, claimed.lease.version);
    assert.equal(pending.cleanupHolds[0].ownerId, claimed.lease.owner);
    assert.equal(pending.jobs.find(job => job.id === kind + '-sibling').status, 'queued');
    if (kind === 'mutable') {
      original.cacheOwnershipPending = false; original.cacheOwnershipReleased = () => true;
    }
    await assert.rejects(worker.recoverPendingCleanup(), { code: 'QUEUE_CLEANUP_PENDING' });
    assert.equal(calls, 1, 'mutating error flags cannot settle the captured original owner');
    released = true;
    assert.deepEqual(await worker.recoverPendingCleanup(), { recovered: 1, pending: 0 });
    assert.deepEqual(await worker.recoverPendingCleanup(), { recovered: 0, pending: 0 });
    assert.equal(retained.cacheOwnershipReleased(), true);
    assert.equal(finalized.length, 1); assert.equal(finalized[0].job.maxRetries, 0);
    assert.equal((await loadQueue(queueDir, 'index')).cleanupHolds.length, 0);
    assert.equal((await loadQuarantine(queueDir, 'index')).jobs.find(job => job.id === kind).result.exitCode, 1);
    assert.equal(await worker.processQueueOnce(counters()), true);
    assert.equal(calls, 2, 'the sibling uses its own successful build after exact-owner retirement');
    assert.equal((await loadQueue(queueDir, 'index')).jobs.find(job => job.id === kind + '-sibling').status, 'done');
  }
  const fakeLifecycle = { registerPromise: promise => promise };
  const job = { id: 'settled', repo: path.join(dir, 'settled'), mode: 'code', stage: 'stage1', args: [] };
  const run = executor => executor.executeClaimedJob({ job, jobLifecycle: fakeLifecycle, logPath: null });
  const publication = { status: 'published', buildId: 'authored-generation' };
  for (const kind of ['ordinary', 'abort', 'post-publication', 'success']) {
    const outcome = { schemaVersion: 1, status: kind === 'success' ? 'index-published' : 'failed',
      ...(kind === 'post-publication' ? { publication } : {}) };
    const result = await run(makeExecutor(async () => {
      if (kind === 'success') return { outcome };
      const error = Object.assign(new Error('settled ' + kind), { outcome, cacheOwnershipReleased: () => true });
      if (kind === 'abort') error.name = 'AbortError';
      if (kind === 'post-publication') error.publication = publication;
      throw Object.freeze(error);
    }));
    assert.equal(result.runResult.exitCode, kind === 'success' ? 0 : kind === 'abort' ? 130 : 1);
    assert.equal(result.runResult.cancelled, kind === 'abort');
    assert.deepEqual(result.runResult.daemon.outcome, outcome);
    if (kind === 'post-publication') assert.deepEqual(result.runResult.daemon.publication, publication);
    const normalized = createJobCompletion({}).normalizeRunResult(result.runResult);
    assert.deepEqual(normalized.daemon.outcome, outcome, 'completion retains the producing outcome');
  }
  const original = Object.freeze(new Error('settled original'));
  const logFailure = Object.freeze(Object.assign(new Error('diagnostic sink failed'), { code: 'ELOG' }));
  console.error = line => { if (line.startsWith('[indexer] daemon')) throw logFailure; };
  await assert.rejects(run(makeExecutor(async () => { throw original; })),
    error => hasCause(error, original) && hasCause(error, logFailure));
  console.error = (...values) => { logs.push(values.map(String).join(' ')); };
  for (const property of ['message', 'name', 'code', 'outcome', 'publication']) {
    const getterFailure = new Error('unreadable ' + property);
    const error = new Error('diagnostic source');
    Object.defineProperty(error, property, { get() { throw getterFailure; } });
    await assert.rejects(run(makeExecutor(async () => { throw Object.freeze(error); })),
      failure => hasCause(failure, error) && hasCause(failure, getterFailure));
  }
  const frozenBuildError = Object.freeze(new Error('settled frozen build failure'));
  const presented = retainBuildIndexFailureOutcome(frozenBuildError, { repo: job.repo, requestedStage: 'stage1' });
  assert.equal(presented.outcome.status, 'failed');
  assert.deepEqual(presented.outcome.requestedStages, ['stage1']);
  assert.ok(hasCause(presented, frozenBuildError) || presented === frozenBuildError);
} finally {
  console.error = originalConsoleError;
  await fs.rm(dir, { recursive: true, force: true });
}
assert.ok(logs.some(line => line.includes('execution failed before completion')), 'negative diagnostics are explicitly captured');
console.log('Real daemon normalization preserves original ownership through queue holds and exact-once retirement.');
