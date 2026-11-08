import assert from 'node:assert/strict';
import { createJobCompletion } from '../../../tools/service/indexer-service/job-completion.js';

// Actual completion/retry owner with inert persistence callbacks. UNVALIDATED:
// no worker, child process, native binding or queue mutation has been executed.
let coercions = 0;
const coercible = {
  valueOf() { coercions++; return 0; },
  toString() { coercions++; return '0'; }
};
const invalid = [undefined, null, false, true, '', '  ', [], [0], {}, coercible,
  0n, Symbol('unavailable-status'), 0.25, -0.25, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1,
  '0.0', '0e0', '0x0', 'Infinity', '9007199254740992'];

for (const exitCode of invalid) {
  for (const maxRetries of [0, 1]) {
    const calls = [];
    const metrics = { processed: 1, succeeded: 0, failed: 0, retried: 0 };
    const completion = createJobCompletion({
      queueDir: 'fixture-queue', resolvedQueueName: 'index', queueMaxRetries: 0,
      completeJob: async (...args) => { calls.push({ type: 'complete', args }); },
      quarantineJob: async (...args) => { calls.push({ type: 'quarantine', args }); }
    });
    const job = { id: 'invalid-exit', attempts: 0, maxRetries,
      lease: { owner: 'original-worker', version: 7 } };
    const runResult = { exitCode, signal: null, executionMode: 'subprocess' };
    assert.equal(completion.normalizeRunResult(runResult).status, 'failed');
    await completion.finalizeJobRun({ job, runResult, metrics });
    assert.equal(calls.length, 1, 'an invalid result reaches the existing failure policy once');
    const [{ type, args }] = calls;
    if (maxRetries) {
      assert.equal(type, 'complete');
      assert.equal(args[2], 'queued');
      assert.equal(args[3].retry, true);
      assert.equal(args[3].error, 'exit 1');
      assert.equal(metrics.retried, 1);
      assert.equal(metrics.failed, 0);
    } else {
      assert.equal(type, 'quarantine');
      assert.equal(args[2], 'retry-exhausted');
      assert.equal(args[4].result.error, 'exit 1');
      assert.equal(metrics.failed, 1);
      assert.equal(metrics.retried, 0);
    }
    assert.equal(metrics.succeeded, 0, 'malformed or unavailable status cannot count as success');
    assert.equal(args[0], 'fixture-queue');
    assert.equal(args[1], job.id);
    assert.equal(args[type === 'quarantine' ? 3 : 4], 'index');
    const options = args[type === 'quarantine' ? 4 : 5];
    assert.deepEqual({ ownerId: options.ownerId, expectedLeaseVersion: options.expectedLeaseVersion },
      { ownerId: 'original-worker', expectedLeaseVersion: 7 });
  }
}
assert.equal(coercions, 0, 'status admission cannot invoke an arbitrary conversion hook');

for (const exitCode of [0, -0, '0', ' 0 ', 2, '2', -1073741819, 3221225477]) {
  const completed = [], quarantined = [];
  const metrics = { processed: 1, succeeded: 0, failed: 0, retried: 0 };
  const completion = createJobCompletion({
    queueDir: 'fixture-queue', resolvedQueueName: 'index', queueMaxRetries: 0,
    completeJob: async (...args) => { completed.push(args); },
    quarantineJob: async (...args) => { quarantined.push(args); }
  });
  const success = Number(exitCode) === 0;
  await completion.finalizeJobRun({ job: { id: 'original-status' }, runResult: { exitCode }, metrics });
  assert.equal(completed.length, success ? 1 : 0);
  assert.equal(quarantined.length, success ? 0 : 1);
  if (success) {
    assert.equal(completed[0][2], 'done');
    assert.equal(completed[0][3].error, null);
  } else {
    assert.equal(quarantined[0][4].result.exitCode, Number(exitCode));
    assert.equal(quarantined[0][4].result.error, `exit ${exitCode}`);
  }
  assert.equal(metrics.succeeded, success ? 1 : 0);
  assert.equal(metrics.failed, success ? 0 : 1);
}
console.log('Service result exit-code admission controls authored; execution deferred.');
