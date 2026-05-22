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

const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-stability-'));
const stabilityPath = path.join(tmpDir, 'stability.json');
const historyDir = path.join(tmpDir, 'history');

runNode([
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
], 'runner stability artifact contract', ROOT, env, { stdio: 'pipe' });

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
