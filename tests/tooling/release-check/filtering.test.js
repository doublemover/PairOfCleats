#!/usr/bin/env node
import assert from 'node:assert/strict';
import { loadReleaseCheckArtifacts, runReleaseCheckCli } from '../../helpers/release-check-fixture.js';

const { run, reportPath, manifestPath } = await runReleaseCheckCli({
  outDirName: 'release-check-filtering',
  extraArgs: ['--surfaces', 'vscode,sublime', '--phases', 'build']
});

assert.equal(run.status, 0, `expected filtered release-check to pass: ${run.stderr || run.stdout}`);

const { report, manifest } = await loadReleaseCheckArtifacts({ reportPath, manifestPath });
assert.deepEqual(report.scope, {
  surfaces: ['sublime', 'vscode'],
  phases: ['build']
}, 'expected filtered release-check scope metadata');
assert.deepEqual(report.strict.requiredChecks, ['build'], 'expected filtered required checks');
assert.deepEqual(Object.keys(report.summary.byPhase), ['build'], 'expected only build phase in summary');

const executedIds = report.checks.map((step) => step.id);
assert.deepEqual(executedIds, ['smoke.editor-vscode', 'smoke.editor-sublime'], 'expected only selected build steps');
assert.equal(manifest.surfaces.some((surface) => surface.id === 'vscode'), true, 'expected full surface registry in manifest');

console.log('release-check filtering test passed');
