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

const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-logs-'));

const runOnce = () => {
  const result = runNode([
    runnerPath,
    '--lane', 'all',
    '--match', 'harness/pass-target',
    '--json',
    '--log-dir', tmpDir
  ], 'runner log runId contract', ROOT, env, { stdio: 'pipe' });
  return JSON.parse(result.stdout || '{}');
};

const first = runOnce();
const second = runOnce();

if (!first.logDir || !second.logDir) {
  console.error('log runId test failed: missing logDir in JSON');
  process.exit(1);
}
if (first.logDir === second.logDir) {
  console.error('log runId test failed: logDir should differ per run');
  process.exit(1);
}

console.log('log runId test passed');
