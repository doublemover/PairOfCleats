#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { repoRoot } from '../../helpers/root.js';

const ROOT = repoRoot();
const runnerPath = path.join(ROOT, 'tests', 'run.js');

const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-report-'));
const reportPath = path.join(tmpDir, 'report.json');

const result = spawnSync(process.execPath, [
  runnerPath,
  '--lane',
  'all',
  '--match',
  'harness/pass-target',
  '--report-file',
  reportPath,
  '--json'
], {
  encoding: 'utf8'
});

if (result.status !== 0) {
  console.error('report file contract test failed: runner exited non-zero');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

let payload;
try {
  payload = JSON.parse(await fsPromises.readFile(reportPath, 'utf8'));
} catch {
  console.error('report file contract test failed: missing report artifact');
  process.exit(1);
}

if (payload?.summary?.total !== 1
  || payload?.summary?.passed !== 1
  || !Array.isArray(payload.tests)
  || payload.tests.length !== 1) {
  console.error('report file contract test failed: invalid summary payload');
  process.exit(1);
}

console.log('report file contract test passed');
