#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { repoRoot } from '../../helpers/root.js';

const ROOT = repoRoot();
const runnerPath = path.join(ROOT, 'tests', 'run.js');

const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-stability-'));
const stabilityPath = path.join(tmpDir, 'stability.json');
const historyDir = path.join(tmpDir, 'history');

const result = spawnSync(process.execPath, [
  runnerPath,
  '--lane',
  'all',
  '--match',
  'harness/pass-target',
  '--json',
  '--stability-file',
  stabilityPath,
  '--stability-history-dir',
  historyDir
], {
  encoding: 'utf8'
});

if (result.status !== 0) {
  console.error('stability artifact contract test failed: runner exited non-zero');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

let payload;
try {
  payload = JSON.parse(await fsPromises.readFile(stabilityPath, 'utf8'));
} catch {
  console.error('stability artifact contract test failed: missing stability artifact');
  process.exit(1);
}

if (payload.schemaVersion !== 1 || payload.pathPolicy !== 'repo-relative-posix' || payload.timeUnit !== 'ms') {
  console.error('stability artifact contract test failed: missing artifact contract fields');
  process.exit(1);
}
if (!payload.summary || payload.summary.tests !== 1) {
  console.error('stability artifact contract test failed: incorrect summary values');
  process.exit(1);
}
if (!Array.isArray(payload.tests) || payload.tests.length !== 1) {
  console.error('stability artifact contract test failed: expected one test row');
  process.exit(1);
}
if (!Array.isArray(payload.families) || payload.families.length !== 1) {
  console.error('stability artifact contract test failed: expected one family row');
  process.exit(1);
}
const archived = (await fsPromises.readdir(historyDir)).filter((entry) => entry.endsWith('.json'));
if (!archived.length) {
  console.error('stability artifact contract test failed: expected archived stability history file');
  process.exit(1);
}

console.log('stability artifact contract test passed');
