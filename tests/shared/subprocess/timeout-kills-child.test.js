#!/usr/bin/env node
import assert from 'node:assert/strict';
import { getTrackedSubprocessCount, spawnSubprocess } from '../../../src/shared/subprocess.js';
import { resolveSilentStdio } from '../../helpers/test-env.js';

const args = ['-e', 'setInterval(() => {}, 1000)'];

const waitFor = async (predicate, timeoutMs = 5000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
};

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

const trackedCleared = await waitFor(() => getTrackedSubprocessCount() === 0, 5000);
assert.equal(trackedCleared, true, 'expected timeout subprocess registration to be cleared');

console.log('subprocess timeout kill test passed');
