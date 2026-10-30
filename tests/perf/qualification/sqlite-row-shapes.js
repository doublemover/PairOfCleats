import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { runQualificationCapsule } from '../../../tools/bench/qualification-capsule.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { createSqliteBenchWorkspace } from '../../../tools/bench/sqlite/shared.js';
import { sqliteTrialArmOrder } from '../../../tools/bench/sqlite/campaign.js';
import { SQLITE_ROW_QUALIFICATION_SHAPES } from '../../../tools/bench/sqlite/qualification-plan.js';
import { captureSweepSource } from '../../../tools/bench/ab-sweep-source.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { admitSqliteBenchmarkPhaseDiagnostics } from '../../../tools/bench/sqlite/phase-diagnostics.js';

// Explicit serial campaign, outside discovery. Each preparation/seed/arm is a
// separately bounded30s capsule. No aggregate-duration or speedup PASS is emitted.
await requireBootstrap(); applyTestEnv();
if (!process.argv[2]) throw new Error('Explicit receipt directory is required.');
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
for (const shape of SQLITE_ROW_QUALIFICATION_SHAPES) {
  const prepared = await run({ command: 'prepare', shape }); captures.set(shape, prepared);
  if (!seeds.has(prepared.initialManifestSha256)) {
    await run({ command: 'seed', shape, capture: prepared.descriptor }); seeds.add(prepared.initialManifestSha256);
  }
}
assert.equal(captures.get('large-low').initialManifestSha256, captures.get('large-high').initialManifestSha256);
for (let trial = 1; trial <= 6; trial++) {
  for (const shape of trial % 2 ? SQLITE_ROW_QUALIFICATION_SHAPES : [...SQLITE_ROW_QUALIFICATION_SHAPES].reverse()) {
    for (const operation of shape === 'large-high' ? ['update'] : ['build', 'update']) {
      const arms = [];
      for (const label of sqliteTrialArmOrder('compare', trial - 1)) arms.push(await run({ command: 'arm', shape, operation, trial, label,
        capture: captures.get(shape).descriptor }));
      const baseline = arms.find(row => row.label === 'baseline'), current = arms.find(row => row.label === 'current');
      assert.equal(baseline.status, 'completed'); assert.equal(current.status, 'completed');
      assert.equal(baseline.samples.length, current.samples.length);
      for (let round = 0; round < baseline.samples.length; round++) {
        assert.deepEqual(baseline.samples[round].observation, current.samples[round].observation);
        assert.equal(baseline.samples[round].manifestSha256, current.samples[round].manifestSha256);
      }
    }
  }
}
assert.deepEqual(captureSweepSource(process.cwd()), source);
const generatedWork = await workspace.workOwner.reclaim();
await atomicWriteJson(path.join(output, 'final.json'), { historicalAuthorWorkspace: true, source,
  qualification: 'actual repeated native work/content observations;OS-cache-uncontrolled;no latency-gain claim',
  trialsPerShapeAndArm: 6, roundsPerUpdateArm: 3, largeHighBuildCoverage: 'identical admitted initial manifest to large-low',
  generatedWork, observations }, { createOnly: true });
