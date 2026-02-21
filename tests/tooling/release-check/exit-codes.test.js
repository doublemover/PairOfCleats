#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'release-check-exit-codes');
const reportPath = path.join(outDir, 'release_check_report.json');
const manifestPath = path.join(outDir, 'release-manifest.json');

await fsPromises.rm(outDir, { recursive: true, force: true });
await fsPromises.mkdir(outDir, { recursive: true });

const failed = spawnSync(
  process.execPath,
  [
    path.join(root, 'tools', 'release', 'check.js'),
    '--dry-run',
    '--dry-run-fail-step',
    'smoke.fixture-search',
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

if (failed.status === 0) {
  console.error('exit-codes test failed: expected non-zero on forced dry-run failure');
  process.exit(1);
}

const passed = spawnSync(
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

if (passed.status !== 0) {
  console.error('exit-codes test failed: expected zero for successful dry-run');
  process.exit(passed.status ?? 1);
}

console.log('release-check exit-codes test passed');
