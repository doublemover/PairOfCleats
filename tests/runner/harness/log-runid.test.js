#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { repoRoot } from '../../helpers/root.js';

const ROOT = repoRoot();
const runnerPath = path.join(ROOT, 'tests', 'run.js');

const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-logs-'));

const runOnce = () => {
  const result = spawnSync(process.execPath, [runnerPath, '--match', 'harness/pass-target', '--json', '--log-dir', tmpDir], {
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    console.error('log runId test failed: runner exited non-zero');
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
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
