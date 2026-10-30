import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { runQualificationCapsule } from '../../../tools/bench/qualification-capsule.js';
import { captureSweepSource } from '../../../tools/bench/ab-sweep-source.js';
import { applyTestEnv } from '../../helpers/test-env.js';

/** Explicit serial supervisor, not an ordinary test or aggregate child. Select
 * one finite cohort when acquiring original evidence; every arm/repetition gets
 * a fresh process with the unchanged 30s subprocess bound and original cleanup.
 */
await requireBootstrap(); applyTestEnv();
const args = process.argv.slice(2); assert.equal(args.length % 2, 0);
const options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, index) =>
  [args[index * 2].replace(/^--/, ''), args[index * 2 + 1]]));
for (const key of ['manifest', 'cohort', 'out']) assert.ok(options[key], 'Required --' + key);
const allowed = ['cold', 'warm', 'cold-copies', 'warm-copies', 'cold-allocations', 'warm-allocations', 'cold-memory', 'warm-memory'];
assert.ok(allowed.includes(options.cohort), 'Select exactly one bounded cold/warm observation cohort.');
const route = options.route || 'batch'; assert.ok(['batch', 'prepared'].includes(route));
const output = path.resolve(options.out); await fs.mkdir(output);
const source = captureSweepSource(process.cwd()); assert.equal(source.state, 'clean-revision');
const observations = [], comparisons = [];
const cohorts = [options.cohort];
const manifestPath = path.resolve(options.manifest), manifestBytes = await fs.readFile(manifestPath);
const manifestHash = createHash('sha256').update(manifestBytes).digest('hex');
const manifest = JSON.parse(manifestBytes);
const compareVectors = (before, after, tolerance) => {
  assert.equal(before.length, after.length); let maximumAbsoluteError = 0;
  for (const [row, vector] of before.entries()) {
    assert.equal(vector.length, after[row].length);
    for (const [column, value] of vector.entries()) {
      assert.ok(Number.isFinite(value) && Number.isFinite(after[row][column]));
      maximumAbsoluteError = Math.max(maximumAbsoluteError, Math.abs(value - after[row][column]));
    }
  }
  assert.ok(maximumAbsoluteError <= tolerance, 'Same exact full batch must agree between original and current owners.');
  return { rows: before.length, dimensions: before[0].length, maximumAbsoluteError, tolerance };
};
for (const cohort of cohorts) {
  for (let repetition = 0; repetition < 3; repetition++) {
    const pair = {};
    // Alternate starting arm to expose order, rather than assume a controlled
    // OS file cache or assert natural timing gains from a fixed sequence.
    for (const arm of repetition % 2 ? ['current', 'original'] : ['original', 'current']) {
      const name = cohort + '-' + repetition + '-' + arm, destination = path.join(output, name);
      const childArgs = ['tests/fixtures/benchmarks/actual-adapter-costs.js', '--arm', arm, '--cohort', cohort,
        '--route', route, '--manifest', manifestPath, '--out', destination];
      if (options['numerical-reference']) childArgs.push('--numerical-reference', path.resolve(options['numerical-reference']));
      const invocation = path.join(output, name + '-invocation.json');
      const result = await runQualificationCapsule({ args: childArgs, receiptPath: invocation });
      assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
      const filename = path.join(destination, 'receipt.json'), bytes = await fs.readFile(filename), receipt = JSON.parse(bytes);
      assert.equal(receipt.status, 'passed'); assert.equal(receipt.arm, arm); assert.equal(receipt.cohort, cohort); assert.equal(receipt.route, route);
      assert.ok(receipt.elapsedMs < 30000); assert.equal(receipt.manifest.sha256, manifestHash);
      assert.equal(receipt.cleanup.adapterAndCachesOriginalSettled, true); assert.equal(receipt.cleanup.artifactVerificationLeaseReleased, true);
      assert.equal(receipt.corpus.rows.length, manifest.texts.length); assert.ok(receipt.corpus.rows.length >= 32);
      assert.equal(receipt.outputBytes, manifest.texts.length * manifest.dimensions * 4);
      assert.equal(receipt.execution.stub, false); assert.equal(receipt.modelArtifact.status, 'verified');
      if (cohort === 'cold') assert.equal(receipt.samples.length, 1);
      if (cohort === 'warm') assert.equal(receipt.samples.length, 3);
      if (cohort.endsWith('-copies')) assert.ok(receipt.copies);
      if (cohort.endsWith('-memory')) assert.ok(receipt.observedPeak.heapUsed > 0);
      if (cohort.endsWith('-allocations')) {
        assert.equal(receipt.allocations.iterations, cohort.startsWith('cold-') ? 1 : 2);
        const profile = await fs.readFile(receipt.allocations.path);
        assert.equal(profile.length, receipt.allocations.bytes);
        assert.equal(createHash('sha256').update(profile).digest('hex'), receipt.allocations.sha256);
      }
      pair[arm] = receipt;
      observations.push({ cohort, repetition, arm, invocation, receipt: { path: filename, bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex') }, capsuleMs: result.durationMs });
      console.log(JSON.stringify({ cohort, repetition, arm, capsuleMs: result.durationMs }));
    }
    const original = pair.original, current = pair.current;
    for (const key of ['manifest', 'runtime', 'host', 'providerRuntime', 'modelArtifact', 'corpus', 'profile', 'tolerance', 'route', 'numericalReference', 'outputBytes']) {
      assert.deepEqual(current[key], original[key], 'Owner-only comparison must retain exact identity: ' + key);
    }
    assert.deepEqual(current.sourceOwners.map(row => [row.path, row.checkoutSha256]), original.sourceOwners.map(row => [row.path, row.checkoutSha256]));
    assert.ok(original.sourceOwners.every(row => row.executedSha256 === row.original.sha256));
    assert.ok(current.sourceOwners.every(row => row.executedSha256 === row.checkoutSha256));
    assert.notDeepEqual(current.sourceOwners.map(row => row.executedSha256), original.sourceOwners.map(row => row.executedSha256),
      'An unchanged owner repeat cannot be labeled an old/current comparison.');
    const numeric = compareVectors(original.vectors, current.vectors, manifest.tolerance);
    comparisons.push({ cohort, repetition, numeric,
      original: { samples: original.samples, copies: original.copies, allocations: original.allocations,
        observedPeak: original.observedPeak, processResourceUsage: original.processResourceUsage },
      current: { samples: current.samples, copies: current.copies, allocations: current.allocations,
        observedPeak: current.observedPeak, processResourceUsage: current.processResourceUsage } });
    assert.deepEqual(captureSweepSource(process.cwd()), source);
  }
}
assert.equal(createHash('sha256').update(await fs.readFile(manifestPath)).digest('hex'), manifestHash);
await atomicWriteJson(path.join(output, 'final.json'), { schemaVersion: 1, issue: 1544, status: 'passed',
  historicalAuthorWorkspace: true, source, manifest: { path: manifestPath, sha256: manifestHash }, route,
  observations, comparisons, totalChildDeadlineMs: 30000,
  scope: 'Three fresh serial repetitions per selected cohort and arm; clean inference clocks separate from original copy/disposal work and V8/memory observations.',
  limits: 'Exactly two original owner modules over current dependencies; fresh process is not controlled cold storage. Explicit observations, no required speedup threshold, historical whole-tree gain, retained-memory leak, native unload or full model-family qualification inferred.' }, { createOnly: true });
