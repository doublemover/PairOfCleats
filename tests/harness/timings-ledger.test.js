#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const runnerPath = path.join(ROOT, 'tests', 'run.js');

const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-timings-'));
const timingsPath = path.join(tmpDir, 'timings.json');

const result = spawnSync(process.execPath, [
  runnerPath,
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

if (!Array.isArray(payload.tests) || payload.tests.length !== 1) {
  console.error('timings ledger test failed: expected one test entry');
  process.exit(1);
}

console.log('timings ledger test passed');
