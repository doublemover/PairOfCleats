import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import {
  claimNextJob, completeJob, describeQueueBackpressure, loadQueue,
  readQueueJournal, replayQueueStateFromJournal, saveQueue
} from '../../../tools/service/queue.js';
import { resolveQueueAdmissionPolicy, resolveQueueSloPolicy } from '../../../tools/service/admission-policy.js';
import { createQueueWorker } from '../../../tools/service/indexer-service/queue-worker.js';

const { dir } = await prepareIsolatedTestCacheDir('queue-priority-dispatch');
const admissionPolicy = resolveQueueAdmissionPolicy({ queueName: 'index',
  queueConfig: { maxQueued: 100, maxRunning: 1, maxTotal: 100, resourceBudgetUnits: 1000 } });
const sloPolicy = resolveQueueSloPolicy({ queueName: 'index', queueConfig: { slo: {
  maxQueueAgeMs: { degraded: 60000, overloaded: 120000 },
  maxRunLatencyMs: { degraded: 1e12, overloaded: 2e12 },
  maxRetryRate: { degraded: 1, overloaded: 1 },
  maxSaturationRatio: { degraded: 1, overloaded: 1 }
} } });
const job = (id, stage = 'stage1', age = 0, extra = {}) => ({ id, stage, mode: 'code',
  repo: path.join(dir, id), queueName: 'index', status: 'queued',
  createdAt: new Date(Date.now() - age).toISOString(), ...extra });
const options = { admissionPolicy, sloPolicy, ownerId: 'priority-dispatch-owner' };
const finish = async (queueDir, claimed) => completeJob(queueDir, claimed.id, 'done', { exitCode: 0 }, 'index', {
  ownerId: claimed.lease.owner, expectedLeaseVersion: claimed.lease.version
});

for (const [state, age, expected] of [['healthy', 0, 'heavy'], ['degraded', 90000, 'light'], ['overloaded', 180000, 'light']]) {
  const queueDir = path.join(dir, state);
  await fs.mkdir(queueDir);
  await saveQueue(queueDir, { jobs: [job('heavy', 'stage3', age), job('light')] }, 'index');
  const status = await describeQueueBackpressure(queueDir, 'index', options);
  assert.equal(status.slo.state, state);
  assert.equal(status.slo.actions.dispatch.policy, state === 'healthy' ? 'fifo' : 'light-first-bounded');
  assert.equal(status.slo.actions.dispatch.maxPriorityBypasses, 3);
  const claimed = await claimNextJob(queueDir, 'index', options);
  assert.equal(claimed.id, expected, `${state}: actual selection must match advertised dispatch`);
  assert.equal(await claimNextJob(queueDir, 'index', options), null, 'priority cannot exceed the locked running cap');
  const journal = await readQueueJournal(queueDir, 'index');
  assert.equal(journal.at(-1).extra.dispatch.policy, status.slo.actions.dispatch.policy);
  await finish(queueDir, claimed);
}

{
  const queueDir = path.join(dir, 'bounded');
  await fs.mkdir(queueDir);
  await saveQueue(queueDir, { jobs: [job('heavy-oldest', 'stage3', 180000), job('standard-next', 'stage2', 180000),
    ...Array.from({ length: 7 }, (_, i) => job(`light-${i}`))] }, 'index');
  const order = [];
  for (let index = 0; index < 9; index++) {
    // Every claim reloads the durable queue; no process-local fairness counter.
    const claimed = await claimNextJob(queueDir, 'index', options);
    order.push(claimed.id);
    if (index === 2) {
      const replay = await replayQueueStateFromJournal(queueDir, 'index');
      assert.equal(replay.queue.jobs.find(entry => entry.id === 'heavy-oldest').dispatchPriorityBypasses, 3);
      const waiting = (await loadQueue(queueDir, 'index')).jobs.find(entry => entry.id === 'heavy-oldest');
      assert.equal(waiting.status, 'queued'); assert.equal(waiting.nextEligibleAt, null);
    }
    await finish(queueDir, claimed);
  }
  assert.deepEqual(order, ['light-0', 'light-1', 'light-2', 'heavy-oldest',
    'light-3', 'light-4', 'light-5', 'standard-next', 'light-6']);
  const reasons = (await readQueueJournal(queueDir, 'index')).filter(entry => entry.eventType === 'claim')
    .map(entry => entry.extra.dispatch.reason);
  assert.equal(reasons[3], 'bounded-non-priority-opportunity');
  assert.equal(reasons[7], 'bounded-non-priority-opportunity');
}

{
  const queueDir = path.join(dir, 'eligible-scope');
  await fs.mkdir(queueDir);
  const deferred = job('deferred-light', 'stage1', 180000, { nextEligibleAt: new Date(Date.now() + 60000).toISOString() });
  const excluded = job('excluded-light', 'stage1', 180000);
  const running = job('running-light', 'stage1', 0, { status: 'running', idempotencyKey: 'duplicate-key' });
  const duplicate = job('duplicate-light', 'stage1', 0, { idempotencyKey: 'duplicate-key' });
  await saveQueue(queueDir, { jobs: [deferred, excluded, running, duplicate, job('heavy', 'stage3', 180000), job('light')] }, 'index');
  const claims = await Promise.all(Array.from({ length: 2 }, () => claimNextJob(queueDir, 'index', {
    ...options, admissionPolicy: { ...admissionPolicy, maxRunning: 2 }, admitJob: entry => entry.id !== excluded.id
  })));
  assert.equal(claims.filter(Boolean).length, 1, 'concurrent lock owners share the same cap');
  assert.equal(claims.find(Boolean).id, 'light');
  const saved = await loadQueue(queueDir, 'index');
  assert.equal(saved.jobs.find(entry => entry.id === duplicate.id).status, 'failed');
  assert.equal(saved.jobs.find(entry => entry.id === excluded.id).status, 'queued');
  assert.equal(saved.jobs.find(entry => entry.id === deferred.id).dispatchPriorityBypasses, 0);
}

{
  const queueDir = path.join(dir, 'actual-worker');
  await fs.mkdir(queueDir);
  await saveQueue(queueDir, { jobs: [job('worker-heavy', 'stage3', 180000), job('worker-light')] }, 'index');
  const executed = [];
  const worker = createQueueWorker({ queueDir, resolvedQueueName: 'index', staleQueueMaxRetries: 0,
    admissionPolicy, sloPolicy, monitorBuildProgress: false, startBuildProgressMonitor: () => async () => {},
    touchJobHeartbeat: async () => {}, requeueStaleJobs: async () => {}, ensureQueueDir: async () => {},
    claimNextJob, executeClaimedJob: async ({ job: claimed }) => {
      executed.push(claimed.id); return { handled: false, runResult: { exitCode: 0 } };
    }, finalizeJobRun: async ({ job: claimed, metrics }) => { await finish(queueDir, claimed); metrics.succeeded++; },
    buildDefaultRunResult: () => ({ exitCode: 1 }), printPayload: () => {} });
  await worker.runBatch(1);
  assert.deepEqual(executed, ['worker-light', 'worker-heavy'], 'worker must forward the effective SLO to actual queue claims');
}
console.log('queue dispatch honors locked pressure, bounded fairness, eligibility, duplicate and concurrent claim fences');
