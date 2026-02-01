#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSubprocess } from '../../src/shared/subprocess.js';
import { resolveSilentStdio } from '../helpers/test-env.js';

const controller = new AbortController();
const args = ['-e', 'setInterval(() => {}, 1000)'];

setTimeout(() => controller.abort(), 100);

let pid = null;
try {
  await spawnSubprocess(process.execPath, args, {
    stdio: resolveSilentStdio('ignore'),
    signal: controller.signal,
    killTree: true
  });
  assert.fail('expected abort');
} catch (err) {
  assert.equal(err?.code, 'ABORT_ERR');
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

console.log('subprocess abort kill test passed');
