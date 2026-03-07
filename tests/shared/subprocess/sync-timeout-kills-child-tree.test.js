#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { killProcessTree } from '../../../src/shared/kill-tree.js';
import {
  SubprocessTimeoutError,
  spawnSubprocessSync
} from '../../../src/shared/subprocess.js';

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const isPidAlive = (pid) => {
  const parsed = Number(pid);
  if (!Number.isFinite(parsed) || parsed <= 0) return false;
  try {
    process.kill(parsed, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
};

const waitForFile = async (filePath, timeoutMs = 2000) => {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch {}
    await sleep(50);
  }
  return null;
};

const waitForPidExit = async (pid, timeoutMs = 2000) => {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    if (!isPidAlive(pid)) return true;
    await sleep(50);
  }
  return !isPidAlive(pid);
};

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-sync-timeout-kill-'));
const childPidFile = path.join(tempRoot, 'child.pid');
let spawnedChildPid = null;

try {
  const script = [
    'const fs = require("node:fs");',
    'const { spawn } = require("node:child_process");',
    'const pidFile = process.argv[1];',
    'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000);"], { stdio: "ignore" });',
    'fs.writeFileSync(pidFile, String(child.pid));',
    'setInterval(() => {}, 60000);'
  ].join(' ');

  assert.throws(
    () => spawnSubprocessSync(process.execPath, ['-e', script, childPidFile], {
      stdio: ['ignore', 'ignore', 'ignore'],
      captureStdout: false,
      captureStderr: false,
      timeoutMs: 120
    }),
    (error) => error instanceof SubprocessTimeoutError,
    'expected sync subprocess timeout error'
  );

  const pidText = await waitForFile(childPidFile);
  assert.ok(pidText, 'expected parent script to persist child pid before timeout');
  spawnedChildPid = Number.parseInt(String(pidText).trim(), 10);
  assert.ok(Number.isFinite(spawnedChildPid) && spawnedChildPid > 0, 'expected valid spawned child pid');
  const reaped = await waitForPidExit(spawnedChildPid, 2500);
  assert.equal(reaped, true, 'expected timed-out sync subprocess to reap spawned child tree');

  console.log('sync subprocess timeout child-tree reap test passed');
} finally {
  if (Number.isFinite(spawnedChildPid) && isPidAlive(spawnedChildPid)) {
    await killProcessTree(spawnedChildPid, {
      killTree: true,
      graceMs: 0,
      awaitGrace: true
    });
  }
  await fs.rm(tempRoot, { recursive: true, force: true });
}
