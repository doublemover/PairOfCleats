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

const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-report-'));
const reportPath = path.join(tmpDir, 'report.json');

runNode([
  runnerPath,
  '--lane',
  'all',
  '--match',
  'harness/pass-target',
  '--report-file',
  reportPath,
  '--json'
], 'runner report file contract', ROOT, env, { stdio: 'pipe' });

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
