#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { killProcessTree } from '../../src/shared/kill-tree.js';
import { skip } from '../helpers/skip.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';
import { sleep } from '../../src/shared/sleep.js';

if (process.platform !== 'win32') {
  skip('windows orphan descendant fallback test skipped on non-windows');
}

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `kill-tree-windows-orphan-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });
const childPidPath = path.join(tempRoot, 'child.pid');

const parentScript = [
  "const { spawn } = require('node:child_process');",
  "const fs = require('node:fs');",
  "const pidPath = process.argv[1];",
  "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000);'], {",
  "  detached: true,",
  "  stdio: 'ignore'",
  "});",
  'child.unref();',
  'fs.writeFileSync(pidPath, String(child.pid));',
  'process.exit(0);'
].join('\n');

const parent = spawn(process.execPath, ['-e', parentScript, childPidPath], {
  stdio: 'ignore',
  detached: false
});

if (!parent.pid) {
  throw new Error('missing parent pid');
}

await new Promise((resolve, reject) => {
  parent.once('error', reject);
  parent.once('exit', () => resolve());
});

let childPid = null;
for (let attempt = 0; attempt < 50; attempt += 1) {
  try {
    const value = String(await fs.readFile(childPidPath, 'utf8')).trim();
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      childPid = Math.floor(parsed);
      break;
    }
  } catch {}
  await sleep(50);
}

assert.ok(Number.isFinite(childPid) && childPid > 0, 'expected spawned descendant child pid');

const assertProcessAlive = (pid) => {
  try {
    process.kill(pid, 0);
  } catch (error) {
    throw new Error(`expected process ${pid} alive before fallback kill (${error?.code || error})`);
  }
};

const assertProcessDead = (pid) => {
  try {
    process.kill(pid, 0);
    throw new Error(`expected process ${pid} to be terminated`);
  } catch (error) {
    if (error?.code === 'EPERM') {
      throw new Error(`expected process ${pid} terminated, but process still alive (EPERM)`);
    }
  }
};

try {
  assertProcessAlive(childPid);
  const result = await killProcessTree(parent.pid, {
    killTree: true,
    detached: false,
    graceMs: 0,
    awaitGrace: true
  });
  assert.equal(result?.terminated, true, 'expected orphan descendant fallback to terminate process tree');
  assert.equal(
    Number(result?.fallbackTerminated || 0) > 0 || result?.fallbackAttempted === false,
    true,
    'expected fallback kill metadata when parent already exited'
  );

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertProcessDead(childPid);
      break;
    } catch (error) {
      if (attempt === 19) throw error;
      await sleep(50);
    }
  }
} finally {
  if (Number.isFinite(childPid) && childPid > 0) {
    await killProcessTree(childPid, {
      killTree: true,
      detached: true,
      graceMs: 0
    });
  }
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('kill-tree windows orphan descendant fallback test passed');
