#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { getTrackedSubprocessCount } from '../../../src/shared/subprocess/tracking.js';

const controller = new AbortController();
let childPid = null;
await assert.rejects(spawnSubprocess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: 'ignore', signal: controller.signal, timeoutMs: 5000,
  killGraceMs: 0, timeoutAbortReapWaitMs: 100,
  onSpawn: child => { childPid = child.pid; controller.abort('synchronous onSpawn cancellation'); }
}), { code: 'ABORT_ERR', name: 'AbortError' });
assert.ok(Number.isSafeInteger(childPid));
const until = Date.now() + 5000;
let alive;
do {
  try { process.kill(childPid, 0); alive = true; }
  catch (error) { if (error.code !== 'ESRCH') throw error; alive = false; }
  if (!alive && getTrackedSubprocessCount() === 0) break;
  await new Promise(resolve => setTimeout(resolve, 10));
} while (Date.now() < until);
assert.equal(alive, false, 'the child is joined after cancellation during onSpawn');
assert.equal(getTrackedSubprocessCount(), 0);
console.log('Synchronous onSpawn abort is observed after listener installation and leaves no child ownership.');
