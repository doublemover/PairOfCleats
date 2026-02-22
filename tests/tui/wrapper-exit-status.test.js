#!/usr/bin/env node
import assert from 'node:assert/strict';
import { exitLikeChild } from '../../src/tui/wrapper-exit.js';

const createFakeProc = () => {
  const calls = {
    exit: [],
    kill: []
  };
  return {
    calls,
    proc: {
      pid: 4242,
      exit: (code) => {
        calls.exit.push(code);
      },
      kill: (pid, signal) => {
        calls.kill.push({ pid, signal });
      }
    }
  };
};

{
  const { calls, proc } = createFakeProc();
  exitLikeChild({ status: 0, signal: null }, proc);
  assert.deepEqual(calls.exit, [0], 'status=0 should exit(0)');
  assert.equal(calls.kill.length, 0, 'status exit should not signal-kill');
}

{
  const { calls, proc } = createFakeProc();
  exitLikeChild({ status: 3, signal: null }, proc);
  assert.deepEqual(calls.exit, [3], 'non-zero status should be preserved');
  assert.equal(calls.kill.length, 0, 'status exit should not signal-kill');
}

{
  const { calls, proc } = createFakeProc();
  exitLikeChild({ status: null, signal: 'SIGINT' }, proc);
  assert.equal(calls.exit.length, 0, 'signal path should not synthesize exit code');
  assert.deepEqual(calls.kill, [{ pid: 4242, signal: 'SIGINT' }], 'signal should be re-emitted');
}

{
  const { calls, proc } = createFakeProc();
  exitLikeChild({ status: null, signal: '' }, proc);
  assert.deepEqual(calls.exit, [1], 'missing signal+status should fallback to exit(1)');
  assert.equal(calls.kill.length, 0, 'fallback should not signal-kill');
}

{
  const { calls, proc } = createFakeProc();
  proc.kill = () => {
    throw new Error('kill failed');
  };
  exitLikeChild({ status: null, signal: 'SIGTERM' }, proc);
  assert.deepEqual(calls.exit, [1], 'failed signal re-emission should fallback to exit(1)');
}

console.log('tui wrapper exit status test passed');

