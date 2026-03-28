#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readPackageVersion } from '../../../tools/release/metadata-support.js';
import { loadReleaseCheckArtifacts, runReleaseCheckCli } from '../../helpers/release-check-fixture.js';

const { version } = readPackageVersion(process.cwd());

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
assert.equal(report.releaseVersion, version, 'expected release version fallback when changelog phase is skipped');
assert.deepEqual(report.strict.requiredChecks, ['build'], 'expected filtered required checks');
assert.deepEqual(Object.keys(report.summary.byPhase), ['build'], 'expected only build phase in summary');

const executedIds = report.checks.map((step) => step.id);
assert.deepEqual(executedIds, ['smoke.editor-vscode', 'smoke.editor-sublime'], 'expected only selected build steps');
assert.equal(manifest.surfaces.some((surface) => surface.id === 'vscode'), true, 'expected full surface registry in manifest');

const surfaceOnlyRun = await runReleaseCheckCli({
  outDirName: 'release-check-filtering-surface-only',
  extraArgs: ['--surfaces', 'vscode,sublime']
});

assert.equal(
  surfaceOnlyRun.run.status,
  0,
  `expected surface-only filtered release-check to pass: ${surfaceOnlyRun.run.stderr || surfaceOnlyRun.run.stdout}`
);

const { report: surfaceOnlyReport } = await loadReleaseCheckArtifacts({
  reportPath: surfaceOnlyRun.reportPath,
  manifestPath: surfaceOnlyRun.manifestPath
});
const executedSurfaceOnlyPhases = Array.from(new Set(surfaceOnlyReport.checks.map((step) => step.phase)));
assert.deepEqual(
  surfaceOnlyReport.strict.requiredChecks,
  executedSurfaceOnlyPhases,
  'expected surface-only required checks to match the executed phase set'
);
assert.deepEqual(
  Object.keys(surfaceOnlyReport.summary.byPhase),
  executedSurfaceOnlyPhases,
  'expected surface-only summary to exclude phases with no executed steps'
);

console.log('release-check filtering test passed');
