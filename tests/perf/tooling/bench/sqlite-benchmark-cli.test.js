#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { runNode } from '../../../helpers/run-node.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('perf/tooling/bench/sqlite-benchmark-cli/')[1];
const cases = { 'build-baseline': ['build-from-bundles', 'baseline'], 'build-current': ['build-from-bundles', 'current'],
  'build-compare': ['build-from-bundles', 'compare'], 'update-baseline': ['incremental-update', 'baseline'],
  'update-current': ['incremental-update', 'current'], 'update-compare': ['incremental-update', 'compare'],
  'artifact-baseline': ['build-from-artifacts', 'baseline'], 'artifact-current': ['build-from-artifacts', 'current'],
  'artifact-compare': ['build-from-artifacts', 'compare'] };
assert.ok(Object.hasOwn(cases, selected), 'runner must select one independently bounded CLI case');
const [entry, mode] = cases[selected];
const result = runNode([path.join(process.cwd(), 'tools', 'bench', 'sqlite', `${entry}.js`),
  '--files', '6', '--chunks', entry === 'build-from-artifacts' ? '12' : '2', '--mode', mode,
  ...(entry === 'build-from-artifacts' ? ['--trials', '2', '--profile', 'wide'] : [])], selected, process.cwd(), applyTestEnv({ syncProcess: false }),
{ stdio: 'pipe', timeoutMs: 30000 });
assert.equal(result.status, 0);
if (entry === 'build-from-artifacts') {
  const matched = result.stdout.match(/artifact-build receipt (.+); descriptive paired timings/u);
  assert.ok(matched, result.stdout);
  const report = JSON.parse(await fs.readFile(matched[1], 'utf8'));
  assert.equal(report.status, 'completed'); assert.equal(report.workload.chunks, 12);
  assert.equal(report.generatedWork.state, 'completed'); assert.ok(report.generatedWork.bytesReclaimed > 0);
  assert.equal(report.generatedWork.callerIndexRetained, true);
  await assert.rejects(fs.stat(report.generatedWork.workRoot), { code: 'ENOENT' });
  assert.ok((await fs.stat(report.receiptPath)).isFile());
  assert.equal(report.workload.profile, 'wide'); assert.equal(report.workload.retainedWideMetadata, true);
  assert.equal(report.threshold.minimumInputBytes, 128 * 1024 * 1024);
  assert.equal(report.threshold.defaultOptimizationEligible, false, 'smoke bytes cannot qualify a large-input optimization');
  assert.equal(report.samples.length, mode === 'compare' ? 4 : 2);
  assert.equal(new Set(report.samples.map(row => row.outPath)).size, report.samples.length);
  assert.equal(new Set(report.samples.map(row => row.observation.contentSha256)).size, 1);
  for (const sample of report.samples) {
    assert.equal(sample.count, 12); assert.equal(sample.observation.chunks, 12);
    assert.equal(sample.observation.postings, 24); assert.equal(sample.observation.files, 10);
    assert.equal(sample.observation.semantic, 'admitted-disabled-family');
    assert.deepEqual(sample.observation.lanes, { sparse: true, dense: false, phrase: false, chargram: false });
    assert.ok(sample.stats.prepare.total > 0);
  }
  if (mode === 'compare') {
    assert.equal(report.paired.length, 2);
    assert.deepEqual(report.samples.map(row => row.label), ['baseline', 'current', 'current', 'baseline']);
  }
  if (mode === 'baseline') {
    const failure = runNode(['--import', './tests/fixtures/benchmarks/artifact-build-publication-failure.js',
      'tools/bench/sqlite/build-from-artifacts.js', '--chunks', '12', '--mode', 'baseline'],
    'artifact build and receipt failures retain original owners', process.cwd(), applyTestEnv({ syncProcess: false }),
    { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
    assert.equal(failure.status, 1, failure.stderr);
    const observation = JSON.parse(failure.stdout.trim().split(/\r?\n/u).at(-1));
    assert.deepEqual(observation, { fixture: 'artifact-build-publication-failure', originalBuild: true, originalPublication: true });
  }
  if (mode === 'current') {
    const failure = runNode(['--import', './tests/fixtures/benchmarks/artifact-work-marker-substitution.js',
      'tools/bench/sqlite/build-from-artifacts.js', '--chunks', '12', '--mode', 'current'],
    'artifact work identity refuses unconfirmed cleanup', process.cwd(), applyTestEnv({ syncProcess: false }),
    { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
    assert.equal(failure.status, 1, failure.stderr);
    const matchedFailure = failure.stdout.match(/artifact-build receipt (.+); descriptive paired timings/u);
    assert.ok(matchedFailure, failure.stdout);
    const retained = JSON.parse(await fs.readFile(matchedFailure[1], 'utf8'));
    assert.equal(retained.status, 'failed'); assert.match(retained.failure.message, /run identity changed/);
    assert.equal(retained.generatedWork.state, 'retained-after-reclamation-failure');
    assert.ok((await fs.stat(retained.generatedWork.workRoot)).isDirectory(), 'ordinary marker substitution preserves the evidence directory');
  }
} else {
  assert.match(result.stdout, /scope=smoke/);
  assert.doesNotMatch(result.stderr || '', /ERR_INDEX_FORMAT_UNSUPPORTED|invalid bundle|update skipped/i);
  const observed = result.stdout.split(/\r?\n/u).filter(line => / observed-work /u.test(line))
    .map(line => JSON.parse(line.slice(line.indexOf(' observed-work ') + ' observed-work '.length)));
  assert.equal(observed.length, mode === 'compare' ? 2 : 1);
  for (const row of observed) {
    assert.equal(row.files, 6); assert.equal(row.chunks, 12); assert.equal(row.postings, 24);
    assert.ok(row.sourceBytes > 0 && row.bundleBytes > 0);
    assert.match(row.stableContentSha256, /^[a-f0-9]{64}$/);
  }
  if (mode === 'compare') {
    assert.deepEqual(observed[0], observed[1]);
    assert.match(result.stdout, /smoke delta.*sustained performance unqualified/u);
  }
  if (entry === 'incremental-update') assert.match(result.stdout, /changedFiles=1 chunks=2/u);
}
console.log(`SQLite ${entry}/${mode} performs and validates the intended smoke workload.`);
