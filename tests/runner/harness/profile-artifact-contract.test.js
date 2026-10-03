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

const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-profile-'));
const profilePath = path.join(tmpDir, 'profile.json');

runNode([
  runnerPath,
  '--lane',
  'all',
  '--match',
  'harness/pass-target',
  '--profile',
  profilePath,
  '--json'
], 'runner profile artifact contract', ROOT, env, { stdio: 'pipe' });

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
