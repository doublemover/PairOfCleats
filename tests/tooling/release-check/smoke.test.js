#!/usr/bin/env node
import { loadReleaseCheckArtifacts, runReleaseCheckCli } from '../../helpers/release-check-fixture.js';

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
  'smoke.version',
  'smoke.fixture-index-build',
  'smoke.fixture-index-validate-strict',
  'smoke.fixture-search',
  'smoke.editor-sublime',
  'smoke.editor-vscode',
  'smoke.tui-build',
  'smoke.service-mode'
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

console.log('release-check smoke test passed');
