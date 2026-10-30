#!/usr/bin/env node
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { getTrackedSubprocessCount } from '../../../src/shared/subprocess/tracking.js';

for (const mode of ['running-child-error', 'input-error', 'spawn-callback']) {
  let child, closed = false;
  const primary = Object.assign(new Error('owned ' + mode), { code: 'EPIPE' });
  try {
    const error = await spawnSubprocess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: ['pipe', 'ignore', 'ignore'], killTree: false, timeoutMs: 1000,
      timeoutAbortReapWaitMs: 500,
      onSpawn: owned => {
        child = owned;
        child.once('close', () => { closed = true; });
        if (mode === 'spawn-callback') throw primary;
        if (mode === 'input-error') child.stdin.emit('error', primary);
        else child.once('spawn', () => child.emit('error', primary));
      }
    }).then(() => assert.fail('owned operation failure must reject'), value => value);
    assert.equal(error.code, 'SUBPROCESS_FAILED', mode);
    assert.equal(error.cause, primary, 'retain the original input/callback/child failure');
    assert.equal(closed, true, mode + ': failure is not a substitute for actual close');
    assert.equal(error.result.termination.closeObserved, true);
    assert.equal(error.result.termination.closeTimedOut, false);
    assert.equal(getTrackedSubprocessCount(), 0, 'only actual close retires cleanup ownership');
  } finally {
    if (child && !closed) {
      const closure = once(child, 'close');
      child.kill(); await closure;
    }
  }
}
const text = 'original stdin 😀\nsecond line';
const echoed = await spawnSubprocess(process.execPath, ['-e',
  'let input="";process.stdin.setEncoding("utf8");process.stdin.on("data",x=>input+=x);process.stdin.on("end",()=>process.stdout.write(input));'],
{ input: text, stdio: ['pipe', 'pipe', 'ignore'], killTree: false, timeoutMs: 1000 });
assert.equal(echoed.stdout, text, 'listener-before-input ordering preserves original stdin bytes');
console.log('Subprocess input, callback and post-spawn errors preserve primary failures and actual closure.');
