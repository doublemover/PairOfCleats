#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { runNode } from '../../helpers/run-node.js';
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

  // Test-owned Node commands must reap their descendants too. Otherwise a
  // timeout can leave a child holding the fixture directory on Windows.
  await fs.rm(childPidFile);
  const helperResult = runNode(['-e', forceScript, childPidFile], 'owned helper timeout', tempRoot, process.env, {
    stdio: 'ignore', timeoutMs: 2000, allowFailure: true
  });
  assert.equal(helperResult.error?.code, 'ETIMEDOUT');
  spawnedChildPid = Number.parseInt(String(await waitForFile(childPidFile)).trim(), 10);
  assert.ok(Number.isFinite(spawnedChildPid) && spawnedChildPid > 0);
  assert.equal(await waitForPidExit(spawnedChildPid, 2500), true,
    'expected timed-out runNode helper to reap its owned descendant');

  const delayedOutput = ['-e', 'setTimeout(() => console.log("completed"), 50)'];
  for (const timeout of [0, null, undefined, 2000]) {
    const overridden = runNode(delayedOutput, 'timeout override', tempRoot, process.env, {
      stdio: 'pipe', timeoutMs: 1, allowFailure: true, spawnOptions: { timeout }
    });
    assert.equal(overridden.status, 0, `spawnOptions.timeout=${timeout} overrides the helper deadline`);
    assert.equal(overridden.stdout.trim(), 'completed');
  }
  assert.throws(() => runNode(['-e', ''], 'invalid timeout', tempRoot, process.env, {
    timeoutMs: -1, stdio: 'ignore', allowFailure: true
  }), { code: 'ERR_OUT_OF_RANGE' }, 'invalid spawn options must still throw synchronously');
  const overriddenCwd = path.join(tempRoot, 'override cwd');
  await fs.mkdir(overriddenCwd);
  const transport = runNode(['-e', 'process.stdout.write(JSON.stringify({cwd:process.cwd(),value:process.env.TEST_HELPER_SENTINEL}));process.stderr.write("fixture stderr");process.exit(7)'],
    'transport contract', tempRoot, process.env, {
      stdio: 'pipe', encoding: 'buffer', timeoutMs: 2000, allowFailure: true,
      spawnOptions: { cwd: overriddenCwd, env: { ...process.env, TEST_HELPER_SENTINEL: 'fixture-only' } },
      onFailure() { assert.fail('allowFailure must bypass the failure callback'); }
    });
  assert.equal(transport.status, 7);
  assert.equal(Buffer.isBuffer(transport.stdout), true, 'buffer encoding is preserved');
  assert.equal(Buffer.isBuffer(transport.stderr), true);
  assert.deepEqual(JSON.parse(transport.stdout.toString()), {
    cwd: await fs.realpath(overriddenCwd), value: 'fixture-only'
  }, 'cwd and environment overrides reach the real child');
  assert.equal(transport.stderr.toString(), 'fixture stderr');
  const failureMarker = path.join(tempRoot, 'failure-callback');
  const helperUrl = pathToFileURL(path.join(process.cwd(), 'tests/helpers/run-node.js')).href;
  const callbackScript = `import fs from 'node:fs'; import { runNode } from ${JSON.stringify(helperUrl)};
    runNode(['-e', 'console.error("fixture failure"); process.exit(7)'], 'callback fixture', process.cwd(), process.env, {
      stdio: 'pipe', timeoutMs: 2000, onFailure(result) { fs.writeFileSync(${JSON.stringify(failureMarker)}, String(result.status)); }
    });`;
  const failed = runNode(['--input-type=module', '--eval', callbackScript], 'failure contract', tempRoot, process.env, {
    stdio: 'pipe', timeoutMs: 3000, allowFailure: true
  });
  assert.equal(failed.status, 7, 'default failure handling preserves the child exit status');
  assert.match(failed.stderr, /Failed: callback fixture/);
  assert.match(failed.stderr, /fixture failure/);
  assert.equal(await fs.readFile(failureMarker, 'utf8'), '7', 'onFailure runs before exiting');

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
    for (const [helperOptions, ownsGroup] of [
      [{ timeoutMs: 2000 }, true],
      [{ timeoutMs: 2000, spawnOptions: { detached: false } }, false],
      [{ timeoutMs: null, spawnOptions: { detached: true } }, true],
      [{ timeoutMs: 0 }, false],
      [{ timeoutMs: null }, false],
      [{}, false],
      [{ timeoutMs: 2000, spawnOptions: { timeout: 0 } }, false],
      [{ timeoutMs: 2000, spawnOptions: { timeout: undefined } }, false],
      [{ timeoutMs: 0, spawnOptions: { timeout: 2000 } }, true]
    ]) {
      const observed = runNode(['-e', groupScript], 'helper group contract', tempRoot, process.env, {
        ...helperOptions, stdio: 'pipe', allowFailure: true
      });
      assert.equal(observed.status, 0, observed.stderr);
      const { pid, group } = JSON.parse(observed.stdout);
      assert.equal(group === pid, ownsGroup, `runNode: ${JSON.stringify(helperOptions)}`);
    }
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
