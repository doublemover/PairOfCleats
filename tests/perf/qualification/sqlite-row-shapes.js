import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { runQualificationCapsule } from '../../../tools/bench/qualification-capsule.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { createSqliteBenchWorkspace } from '../../../tools/bench/sqlite/shared.js';
import { sqliteTrialArmOrder } from '../../../tools/bench/sqlite/campaign.js';
import { selectSqliteRowQualification } from '../../../tools/bench/sqlite/qualification-plan.js';
import { captureSweepSource } from '../../../tools/bench/ab-sweep-source.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { admitSqliteBenchmarkPhaseDiagnostics } from '../../../tools/bench/sqlite/phase-diagnostics.js';

// Explicit serial campaign, outside discovery. Each preparation/seed/arm is a
// separately bounded30s capsule. No aggregate-duration or speedup PASS is emitted.
await requireBootstrap(); applyTestEnv();
if (!process.argv[2]) throw new Error('Explicit receipt directory is required.');
const selection = selectSqliteRowQualification(process.argv[3] || 'all');
const output = path.resolve(process.argv[2]); await fs.mkdir(output, { recursive: false });
const source = captureSweepSource(process.cwd());
assert.equal(source.state, 'clean-revision', 'Qualification requires a committed, clean source identity.');
const workspace = await createSqliteBenchWorkspace({ name: 'sqlite-row-shapes' });
const observations = [], captures = new Map(), seeds = new Set();
const run = async request => {
  const result = await runQualificationCapsule({ args: ['tests/fixtures/benchmarks/sqlite-row-shape-worker.js',
    JSON.stringify({ ...request, root: workspace.tempRoot, runIdentity: workspace.workOwner.runIdentity })],
  receiptPath: path.join(output, `invocation-${observations.length + 1}.json`), maxOutputBytes: 4 * 1024 * 1024 });
  const report = JSON.parse(result.stdout), capsule = { request, capsuleMs: result.durationMs, report,
    diagnostics: { state: 'unvalidated', rawStderr: result.stderr } };
  try {
    assert.equal(result.outputCapture.stdout.truncated, false);
    assert.equal(result.outputCapture.stdout.encodingLoss, false);
    assert.equal(result.outputCapture.stderr.truncated, false);
    assert.equal(result.outputCapture.stderr.encodingLoss, false);
    capsule.diagnostics = { ...admitSqliteBenchmarkPhaseDiagnostics({ stderr: result.stderr, report, request }), rawStderr: result.stderr };
  } catch (error) {
    capsule.diagnostics.state = 'failed'; capsule.diagnostics.error = { name: error.name, message: error.message };
    await atomicWriteJson(path.join(output, `capsule-${observations.length + 1}.json`), { historicalAuthorWorkspace: true, source, ...capsule }, { createOnly: true });
    throw error;
  }
  await atomicWriteJson(path.join(output, `capsule-${observations.length + 1}.json`), { historicalAuthorWorkspace: true, source, ...capsule }, { createOnly: true });
  observations.push(capsule); console.log(JSON.stringify({ capsule: observations.length, ...request, capsuleMs: result.durationMs }));
  return report;
};
for (const shape of selection.shapes) {
  const prepared = await run({ command: 'prepare', shape }); captures.set(shape, prepared);
  if (!seeds.has(prepared.initialManifestSha256)) {
    await run({ command: 'seed', phase: 'execute', shape, capture: prepared.descriptor });
    const validated = await run({ command: 'seed', phase: 'validate', shape, capture: prepared.descriptor });
    assert.equal(validated.observation.chunks, prepared.rows);
    seeds.add(prepared.initialManifestSha256);
  }
}
if (captures.has('large-low')) assert.equal(captures.get('large-low').initialManifestSha256, captures.get('large-high').initialManifestSha256);
const arms = [];
for (const { shape, operation, trial } of selection.pairs) {
  const pair = [];
  for (const label of sqliteTrialArmOrder('compare', trial - 1)) {
    const owned = await workspace.createArmWorkspace();
    const coordinate = { command: 'arm', shape, operation, trial, label, capture: captures.get(shape).descriptor,
      armRoot: owned.tempRoot, armIdentity: owned.workOwner.runIdentity };
    const report = { ...coordinate, status: 'running', samples: [], setups: [] };
    if (operation === 'update') {
      const setup = await run({ ...coordinate, round: 0, phase: 'setup' });
      report.setups.push({ trial, label, buildMs: setup.buildMs, validationMs: setup.validationMs,
        preparation: 'independent-native-backup-of-closed-validated-seed', observation: setup.observation });
    }
    for (const round of operation === 'build' ? [0] : [1, 2, 3]) {
      const mutation = await run({ ...coordinate, round, phase: 'execute' });
      const validated = await run({ ...coordinate, round, phase: 'validate' });
      assert.equal(validated.status, 'validated');
      assert.equal(validated.manifestSha256, mutation.sample.manifestSha256);
      assert.equal(validated.observation.inputAdmission.manifestSha256, mutation.sample.manifestSha256);
      assert.equal(validated.observation.chunks, captures.get(shape).rows);
      assert.ok(mutation.sample.stats.tables.chunks.rows > 0);
      report.samples.push({ ...mutation.sample, validationMs: validated.validationMs, observation: validated.observation });
    }
    assert.equal(report.samples.length, operation === 'build' ? 1 : 3);
    report.status = 'completed'; report.generatedWork = await owned.workOwner.reclaim();
    await atomicWriteJson(path.join(owned.tempRoot, 'final.json'), report, { createOnly: true });
    pair.push(report); arms.push(report);
  }
  const baseline = pair.find(row => row.label === 'baseline'), current = pair.find(row => row.label === 'current');
  assert.equal(baseline.status, 'completed'); assert.equal(current.status, 'completed');
  assert.equal(baseline.samples.length, current.samples.length);
  for (let round = 0; round < baseline.samples.length; round++) {
    assert.deepEqual(baseline.samples[round].observation, current.samples[round].observation);
    assert.equal(baseline.samples[round].manifestSha256, current.samples[round].manifestSha256);
  }
}
assert.equal(arms.length, 2 * selection.pairs.length);
assert.equal(observations.length, selection.shapes.length + 2 * seeds.size
  + selection.pairs.reduce((count, pair) => count + 2 * (pair.operation === 'build' ? 2 : 7), 0));
assert.deepEqual(captureSweepSource(process.cwd()), source);
const generatedWork = await workspace.workOwner.reclaim();
await atomicWriteJson(path.join(output, 'final.json'), { historicalAuthorWorkspace: true, source,
  selection,
  qualification: 'actual repeated native work/content observations;OS-cache-uncontrolled;no latency-gain claim',
  trialsPerShapeAndArm: 6, roundsPerUpdateArm: 3,
  largeHighBuildCoverage: captures.has('large-low') ? 'identical admitted initial manifest to large-low' : 'outside-selected-cohort',
  boundaryPolicy: 'Every closed native mutation and its complete validation are independently bounded;all original update rounds and atomic transactions retained;no aggregate-duration PASS.',
  generatedWork, arms, observations }, { createOnly: true });
