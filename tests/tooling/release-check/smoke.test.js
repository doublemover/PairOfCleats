#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'release-check-smoke');
const reportPath = path.join(outDir, 'release_check_report.json');
const manifestPath = path.join(outDir, 'release-manifest.json');

await fsPromises.rm(outDir, { recursive: true, force: true });
await fsPromises.mkdir(outDir, { recursive: true });

const result = spawnSync(
  process.execPath,
  [
    path.join(root, 'tools', 'release', 'check.js'),
    '--dry-run',
    '--report',
    reportPath,
    '--manifest',
    manifestPath
  ],
  {
    cwd: root,
    encoding: 'utf8'
  }
);

if (result.status !== 0) {
  console.error('release-check smoke failed');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

const reportRaw = await fsPromises.readFile(reportPath, 'utf8');
const manifestRaw = await fsPromises.readFile(manifestPath, 'utf8');
const report = JSON.parse(reportRaw);
const manifest = JSON.parse(manifestRaw);

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
  'ops-health-contract',
  'ops-failure-injection-contract',
  'ops-config-guardrails-contract',
  'smoke.version',
  'smoke.fixture-index-build',
  'smoke.fixture-index-validate-strict',
  'smoke.fixture-search',
  'smoke.editor-sublime',
  'smoke.editor-vscode',
  'smoke.service-mode'
];

const ids = report.checks.map((step) => step.id);
for (const id of expected) {
  if (!ids.includes(id)) {
    console.error(`release-check smoke failed: missing step ${id}`);
    process.exit(1);
  }
}

console.log('release-check smoke test passed');
