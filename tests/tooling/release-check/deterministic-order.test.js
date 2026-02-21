#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'release-check-order');
const reportPath = path.join(outDir, 'release_check_report.json');
const manifestPath = path.join(outDir, 'release-manifest.json');

await fsPromises.rm(outDir, { recursive: true, force: true });
await fsPromises.mkdir(outDir, { recursive: true });

const run = spawnSync(
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

if (run.status !== 0) {
  console.error('deterministic-order test failed: release-check returned non-zero');
  process.exit(run.status ?? 1);
}

const report = JSON.parse(await fsPromises.readFile(reportPath, 'utf8'));
const ids = report.checks.map((entry) => entry.id);
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

if (ids.length !== expected.length) {
  console.error('deterministic-order test failed: unexpected step count');
  process.exit(1);
}

for (let i = 0; i < expected.length; i += 1) {
  if (ids[i] !== expected[i]) {
    console.error(`deterministic-order test failed at index ${i}: expected ${expected[i]}, got ${ids[i]}`);
    process.exit(1);
  }
}

console.log('release-check deterministic order test passed');
