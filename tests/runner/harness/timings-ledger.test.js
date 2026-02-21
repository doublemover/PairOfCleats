#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { repoRoot } from '../../helpers/root.js';

const ROOT = repoRoot();
const runnerPath = path.join(ROOT, 'tests', 'run.js');

const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-timings-'));
const timingsPath = path.join(tmpDir, 'timings.json');

const result = spawnSync(process.execPath, [
  runnerPath,
  '--lane', 'all',
  '--match', 'harness/pass-target',
  '--json',
  '--timings-file', timingsPath
], { encoding: 'utf8' });

if (result.status !== 0) {
  console.error('timings ledger test failed: runner exited non-zero');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

let payload;
try {
  payload = JSON.parse(await fsPromises.readFile(timingsPath, 'utf8'));
} catch {
  console.error('timings ledger test failed: missing or invalid timings file');
  process.exit(1);
}

if (payload.schemaVersion !== 1) {
  console.error('timings ledger test failed: expected schemaVersion=1');
  process.exit(1);
}
if (payload.pathPolicy !== 'repo-relative-posix' || payload.timeUnit !== 'ms') {
  console.error('timings ledger test failed: expected pathPolicy/timeUnit contract');
  process.exit(1);
}
if (!payload.watchdog || typeof payload.watchdog.triggered !== 'boolean') {
  console.error('timings ledger test failed: expected watchdog block');
  process.exit(1);
}
if (!Array.isArray(payload.tests) || payload.tests.length !== 1) {
  console.error('timings ledger test failed: expected one test entry');
  process.exit(1);
}
const row = payload.tests[0];
if (typeof row.path !== 'string' || row.path.includes('\\')) {
  console.error('timings ledger test failed: expected POSIX-normalized test path');
  process.exit(1);
}
if (!Number.isFinite(Number(row.durationMs))) {
  console.error('timings ledger test failed: expected numeric durationMs');
  process.exit(1);
}

console.log('timings ledger test passed');
