#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { repoRoot } from '../../helpers/root.js';

const ROOT = repoRoot();
const runnerPath = path.join(ROOT, 'tests', 'run.js');

const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-watchdog-'));
const pidFile = path.join(tmpDir, 'pids.json');
const timingsPath = path.join(tmpDir, 'timings.json');

const result = spawnSync(process.execPath, [
  runnerPath,
  '--lane',
  'unit',
  '--match',
  'harness/timeout-target',
  '--timeout-ms',
  '20000',
  '--watchdog-ms',
  '400',
  '--timings-file',
  timingsPath,
  '--json'
], {
  encoding: 'utf8',
  env: {
    ...process.env,
    PAIROFCLEATS_TEST_PID_FILE: pidFile,
    PAIROFCLEATS_TEST_ALLOW_TIMEOUT_TARGET: '1'
  }
});

if (result.status === 0) {
  console.error('watchdog kill test failed: runner exited 0');
  process.exit(1);
}

let timings;
try {
  timings = JSON.parse(await fsPromises.readFile(timingsPath, 'utf8'));
} catch {
  console.error('watchdog kill test failed: missing timings ledger');
  process.exit(1);
}

if (!timings.watchdog?.triggered) {
  console.error('watchdog kill test failed: expected watchdog trigger');
  process.exit(1);
}
if (typeof timings.watchdog.reason !== 'string' || !timings.watchdog.reason.includes('no test activity')) {
  console.error('watchdog kill test failed: expected watchdog reason');
  process.exit(1);
}

let pids;
try {
  pids = JSON.parse(await fsPromises.readFile(pidFile, 'utf8'));
} catch {
  console.error('watchdog kill test failed: missing pid file');
  process.exit(1);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await wait(300);

const isAlive = (pid) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
};

if (isAlive(pids.child) || isAlive(pids.grandchild)) {
  console.error('watchdog kill test failed: child process still alive');
  process.exit(1);
}

console.log('watchdog kill test passed');
