import assert from 'node:assert/strict';
import { createJobCompletion } from '../../../tools/service/indexer-service/job-completion.js';

// UNVALIDATED: actual completion policy with controlled persistence promises.
// No child, native binding, queue mutation or fixture has been executed.
const policies = [
  { exitCode: 0, maxRetries: 0, metric: 'succeeded', kind: 'complete', status: 'done' },
  { exitCode: 2, maxRetries: 1, metric: 'retried', kind: 'complete', status: 'queued' },
  { exitCode: 2, maxRetries: 0, metric: 'failed', kind: 'quarantine', status: 'retry-exhausted' }
];
const freshMetrics = () => ({ processed: 1, succeeded: 0, failed: 0, retried: 0 });
const job = { id: 'persistence-owned', attempts: 0, lease: { owner: 'original-worker', version: 11 } };
const start = (policy, persist) => {
  const calls = [], metrics = freshMetrics();
  const call = kind => async (...args) => {
    calls.push({ kind, args });
    assert.equal(kind, policy.kind);
    assert.equal(args[2], policy.status);
    const options = args[kind === 'complete' ? 5 : 4];
    assert.equal(options.ownerId, job.lease.owner);
    assert.equal(options.expectedLeaseVersion, job.lease.version);
    return persist();
  };
  const completion = createJobCompletion({ queueDir: 'inert-fixture-queue', resolvedQueueName: 'index',
    queueMaxRetries: 0, completeJob: call('complete'), quarantineJob: call('quarantine') });
  const result = completion.finalizeJobRun({ job: { ...job, maxRetries: policy.maxRetries },
    runResult: { exitCode: policy.exitCode }, metrics });
  // Observe rejection immediately, including every falsey throw value.
  const outcome = result.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
  return { metrics, calls, outcome };
};

for (const policy of policies) {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const active = start(policy, () => pending);
  assert.equal(active.calls.length, 1);
  assert.deepEqual(active.metrics, freshMetrics(), 'in-flight persistence cannot claim a durable result');
  resolve({ ...job, status: policy.status });
  assert.equal((await active.outcome).ok, true);
  assert.deepEqual(active.metrics, { ...freshMetrics(), [policy.metric]: 1 });

  for (const error of [undefined, null, false, 0, '', Object.freeze(new Error('write failed')),
    Object.freeze(Object.assign(new Error('stale lease'), { code: 'QUEUE_LEASE_VERSION_MISMATCH' }))]) {
    let reject;
    const pendingFailure = new Promise((_, fail) => { reject = fail; });
    const failed = start(policy, () => pendingFailure);
    assert.deepEqual(failed.metrics, freshMetrics());
    reject(error);
    const outcome = await failed.outcome;
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, error, 'original persistence rejection remains exact');
    assert.deepEqual(failed.metrics, freshMetrics(), 'failed publication cannot count a success, retry or quarantine');
  }
  const absent = start(policy, () => null);
  assert.equal((await absent.outcome).ok, true);
  assert.deepEqual(absent.metrics, freshMetrics(), 'a queue owner returning no matching job made no transition');
  const legacy = start(policy, () => undefined);
  assert.equal((await legacy.outcome).ok, true);
  assert.equal(legacy.metrics[policy.metric], 1, 'existing callback void fulfillment remains compatible');
}

console.log('indexer job completion persistence metrics passed');
