#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { repoRoot } from '../../helpers/root.js';

const ROOT = repoRoot();
const runnerPath = path.join(ROOT, 'tests', 'run.js');

const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-profile-'));
const profilePath = path.join(tmpDir, 'profile.json');

const result = spawnSync(process.execPath, [
  runnerPath,
  '--lane',
  'all',
  '--match',
  'harness/pass-target',
  '--profile',
  profilePath,
  '--json'
], {
  encoding: 'utf8'
});

if (result.status !== 0) {
  console.error('profile artifact contract test failed: runner exited non-zero');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

let payload;
try {
  payload = JSON.parse(await fsPromises.readFile(profilePath, 'utf8'));
} catch {
  console.error('profile artifact contract test failed: missing profile artifact');
  process.exit(1);
}

if (payload.schemaVersion !== 1 || payload.pathPolicy !== 'repo-relative-posix' || payload.timeUnit !== 'ms') {
  console.error('profile artifact contract test failed: missing profile contract fields');
  process.exit(1);
}
if (!payload.summary || payload.summary.tests !== 1 || payload.summary.passed !== 1) {
  console.error('profile artifact contract test failed: incorrect summary values');
  process.exit(1);
}
if (!Array.isArray(payload.tests) || payload.tests.length !== 1) {
  console.error('profile artifact contract test failed: expected one test row');
  process.exit(1);
}

console.log('profile artifact contract test passed');
