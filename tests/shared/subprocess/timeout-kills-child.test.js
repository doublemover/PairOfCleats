#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSubprocess } from '../../../src/shared/subprocess.js';
import { resolveSilentStdio } from '../../helpers/test-env.js';

const args = ['-e', 'setInterval(() => {}, 1000)'];

let pid = null;
try {
  await spawnSubprocess(process.execPath, args, {
    stdio: resolveSilentStdio('ignore'),
    timeoutMs: 200,
    killTree: true
  });
  assert.fail('expected timeout');
} catch (err) {
  assert.equal(err?.code, 'SUBPROCESS_TIMEOUT');
  pid = err?.result?.pid ?? null;
}

if (pid && process.platform !== 'win32') {
  await new Promise((resolve) => setTimeout(resolve, 150));
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch {
    alive = false;
  }
  assert.equal(alive, false, 'expected subprocess to be killed');
}

console.log('subprocess timeout kill test passed');
