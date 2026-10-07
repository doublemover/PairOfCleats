#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { killProcessTree } from '../../../src/shared/kill-tree.js';
import { SubprocessTimeoutError, spawnSubprocessSync } from '../../../src/shared/subprocess/runner.js';
import {
  isSyncCommandTimedOut,
  runSyncCommandWithTimeout
} from '../../../src/shared/subprocess/sync-command.js';

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
      timeoutMs: 2000
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

  // The raw sync-command owner has the same timeout/reparenting boundary.
  // Ignoring SIGTERM in the descendant also requires the owned-group force path.
  await fs.rm(childPidFile);
  const forceScript = script.replace(
    'setInterval(() => {}, 60000);',
    'process.on(\'SIGTERM\', () => {}); setInterval(() => {}, 60000);'
  );
  const result = runSyncCommandWithTimeout(process.execPath, ['-e', forceScript, childPidFile], {
    stdio: 'ignore',
    timeoutMs: 2000
  });
  assert.equal(isSyncCommandTimedOut(result), true, 'expected raw sync timeout classification');
  spawnedChildPid = Number.parseInt(String(await waitForFile(childPidFile)).trim(), 10);
  assert.ok(Number.isFinite(spawnedChildPid) && spawnedChildPid > 0);
  assert.equal(
    await waitForPidExit(spawnedChildPid, 2500),
    true,
    'expected raw sync timeout to terminate a descendant ignoring SIGTERM'
  );

  if (process.platform !== 'win32') {
    const groupScript = [
      'const { spawnSync } = require("node:child_process");',
      'const group = spawnSync("ps", ["-o", "pgid=", "-p", String(process.pid)], { encoding: "utf8" });',
      'if (group.status !== 0) process.exit(1);',
      'console.log(JSON.stringify({ pid: process.pid, group: Number(group.stdout.trim()) }));'
    ].join(' ');
    const owners = [spawnSubprocessSync, runSyncCommandWithTimeout];
    for (const owner of owners) {
      for (const [options, ownsGroup] of [
        [{ timeoutMs: 2000 }, true],
        [{ timeoutMs: 2000, detached: true }, true],
        [{ timeoutMs: 2000, detached: false }, false],
        [{ timeoutMs: 2000, killTree: false }, false],
        [{ timeoutMs: null }, false]
      ]) {
        const observed = owner(process.execPath, ['-e', groupScript], {
          ...options,
          stdio: ['ignore', 'pipe', 'pipe'],
          encoding: 'utf8'
        });
        const { pid, group } = JSON.parse(String(observed.stdout).trim());
        assert.equal(group === pid, ownsGroup, `${owner.name}: ${JSON.stringify(options)}`);
      }
    }
    const unbounded = spawnSubprocessSync(process.execPath, ['-e', groupScript], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const { pid, group } = JSON.parse(unbounded.stdout);
    assert.notEqual(group, pid, 'unbounded interactive dispatch must not acquire a new session');
  }

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
