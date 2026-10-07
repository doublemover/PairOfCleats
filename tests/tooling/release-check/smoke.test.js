#!/usr/bin/env node
import { loadReleaseCheckArtifacts, runReleaseCheckCli } from '../../helpers/release-check-fixture.js';
import { getReleaseCheckSurfaceSteps } from '../../../tools/release/surfaces.js';

const { run, root, reportPath, manifestPath } = await runReleaseCheckCli({
  outDirName: 'release-check-smoke'
});

if (run.status !== 0) {
  console.error('release-check smoke failed');
  if (run.stderr) console.error(run.stderr.trim());
  process.exit(run.status ?? 1);
}

const { report, manifest } = await loadReleaseCheckArtifacts({ reportPath, manifestPath });

if (!report || report.schemaVersion !== 1 || !Array.isArray(report.checks) || !report.ok) {
  console.error('release-check smoke failed: report schema invalid');
  process.exit(1);
}

if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.artifacts)) {
  console.error('release-check smoke failed: manifest schema invalid');
  process.exit(1);
}

const expected = [
  'changelog.entry',
  'contracts.drift',
  'toolchain.python',
  ...getReleaseCheckSurfaceSteps(root).map((step) => step.id)
];

const ids = report.checks.map((step) => step.id);
for (const id of expected) {
  if (!ids.includes(id)) {
    console.error(`release-check smoke failed: missing step ${id}`);
    process.exit(1);
  }
}
for (let i = 0; i < expected.length; i += 1) {
  if (ids[i] !== expected[i]) {
    console.error(`release-check smoke failed at index ${i}: expected ${expected[i]}, got ${ids[i]}`);
    process.exit(1);
  }
}

if (!Array.isArray(report.shippedSurfaces) || report.shippedSurfaces.length < 6) {
  console.error('release-check smoke failed: expected shipped surface metadata in report');
  process.exit(1);
}

if (!Array.isArray(manifest.surfaces) || manifest.surfaces.length !== report.shippedSurfaces.length) {
  console.error('release-check smoke failed: manifest/report shipped surface counts differ');
  process.exit(1);
}

console.log('release-check smoke test passed');
