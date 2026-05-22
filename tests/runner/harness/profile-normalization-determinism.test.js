#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { repoRoot } from '../../helpers/root.js';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const ROOT = repoRoot();
const runnerPath = path.join(ROOT, 'tests', 'run.js');
const env = applyTestEnv({ syncProcess: false });

const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-profile-order-'));
const profilePath = path.join(tmpDir, 'profile.json');

runNode([
  runnerPath,
  '--lane',
  'all',
  '--match',
  'harness/pass-target',
  '--match',
  'harness/skip-target',
  '--profile',
  profilePath,
  '--json'
], 'runner profile normalization determinism', ROOT, env, { stdio: 'pipe' });

let payload;
try {
  payload = JSON.parse(await fsPromises.readFile(profilePath, 'utf8'));
} catch {
  console.error('profile normalization test failed: invalid profile artifact');
  process.exit(1);
}

const tests = Array.isArray(payload.tests) ? payload.tests : [];
if (tests.length !== 2) {
  console.error('profile normalization test failed: expected two test rows');
  process.exit(1);
}

const ids = tests.map((entry) => entry.id);
const sortedIds = ids.slice().sort((a, b) => a.localeCompare(b));
if (ids.join('\n') !== sortedIds.join('\n')) {
  console.error('profile normalization test failed: expected deterministic id ordering');
  process.exit(1);
}

const decimals = (value) => {
  const text = String(value);
  const parts = text.split('.');
  return parts[1] ? parts[1].length : 0;
};

for (const row of tests) {
  if (typeof row.path !== 'string' || row.path.includes('\\')) {
    console.error('profile normalization test failed: path must be POSIX normalized');
    process.exit(1);
  }
  if (!Number.isFinite(Number(row.durationMs)) || decimals(row.durationMs) > 3) {
    console.error('profile normalization test failed: duration precision must be <= 3 decimals');
    process.exit(1);
  }
}

console.log('profile normalization test passed');
