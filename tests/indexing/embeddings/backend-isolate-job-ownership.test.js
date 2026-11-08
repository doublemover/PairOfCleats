#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createAbortError } from '../../../src/shared/abort.js';
import { runIsolatedBackendJobs } from '../../../tools/build/embeddings/backend-isolate.js';

const jobs = ['merged', 'doc', 'code'].map(target => ({ target, payload: { vectorsPath: `/fixture/${target}` } }));
const line = record => `\u001ePOC_ANN:${JSON.stringify(record)}\n`;
const start = target => line({ type: 'start', target });
const done = (target, result = { skipped: false, count: 2 }) => line({ type: 'result', target, result });
const emitFragmented = (options, value) => {
  options.onStdout(value.slice(0, 3)); options.onStdout(value.slice(3, 17)); options.onStdout(value.slice(17));
};
let starts = 0;
const completed = await runIsolatedBackendJobs({ backend: 'hnsw', jobs, spawn: async (command, args, options) => {
  starts++;
  assert.equal(command, process.execPath);
  assert.deepEqual(args.slice(0, 2), ['--input-type=module', '-e']);
  assert.equal(options.rejectOnNonZeroExit, false);
  assert.equal(options.captureStdout, false, 'bounded protocol parsing does not duplicate the captured stdout tail');
  const request = JSON.parse(options.input);
  assert.equal(request.jobs.length, 3);
  options.onStdout('native diagnostic before protocol');
  for (const job of request.jobs) emitFragmented(options, start(job.target) + done(job.target));
  return { exitCode: 0, stderr: '' };
} });
assert.equal(starts, 1, 'all channels share one bounded-lived native child');
assert.equal(completed.work.childStarts, 1);
assert.equal(completed.work.completedVariants, 3);
assert.ok(Object.values(completed.results).every(result => result.count === 2));

const attempted = [], failures = [];
const crashed = await runIsolatedBackendJobs({ backend: 'lancedb', jobs,
  recordFailure: record => { failures.push(record); return Object.freeze({ written: true, evidencePath: '/fixture/immutable-evidence.json' }); },
  spawn: async (_command, _args, options) => {
    const request = JSON.parse(options.input); attempted.push(request.jobs.map(job => job.target));
    if (attempted.length === 1) {
      options.onStdout(start('merged') + done('merged') + start('doc'));
      return { exitCode: 3221225477, stderr: 'native crash', signal: null };
    }
    assert.deepEqual(request.jobs.map(job => job.target), ['code'], 'neither a completed nor a crashed job is retried');
    options.onStdout(start('code') + done('code')); return { exitCode: 0 };
  } });
assert.equal(crashed.results.merged.count, 2);
assert.equal(crashed.results.doc.reason, 'isolate failed');
assert.equal(crashed.results.code.count, 2, 'an unstarted sibling remains independently attempted');
assert.equal(crashed.work.childStarts, 2);
assert.equal(crashed.work.crashedVariants, 1);
assert.equal(failures[0].target, 'doc');
assert.equal(crashed.results.doc.error.diagnosticEvidence.evidencePath, '/fixture/immutable-evidence.json');

let failedStarts = 0;
const startup = await runIsolatedBackendJobs({ backend: 'hnsw', jobs, spawn: async () => {
  failedStarts++; return { exitCode: 2, stderr: 'native module import failed' };
} });
assert.equal(failedStarts, 1, 'startup failure without a started target is not retried');
assert.ok(Object.values(startup.results).every(result => result.reason === 'isolate failed'));
const protocol = await runIsolatedBackendJobs({ backend: 'hnsw', jobs, spawn: async (_command, _args, options) => {
  options.onStdout(start('merged') + done('merged') + done('merged')); return { exitCode: 0 };
} });
assert.ok(Object.values(protocol.results).every(result => result.skipped), 'invalid protocol cannot admit earlier untrusted receipts');

const controller = new AbortController();
const ownershipError = Object.assign(createAbortError(), { cacheOwnershipPending: true,
  cacheOwnershipReleased: () => false });
await assert.rejects(runIsolatedBackendJobs({ backend: 'hnsw', jobs, signal: controller.signal,
  spawn: async () => { controller.abort(); throw ownershipError; } }), error => error === ownershipError);
await assert.rejects(runIsolatedBackendJobs({ backend: 'hnsw', jobs: [{ target: 'merged', payload: { vectorsPath: '/fixture', vectors: [[1]] } }] }),
  /Invalid bounded native backend jobs/);
console.log('ANN child job ownership amortizes startup, preserves independent outcomes and retains cancellation leases; inert transport only.');
