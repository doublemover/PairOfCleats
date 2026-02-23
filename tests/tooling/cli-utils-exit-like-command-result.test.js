#!/usr/bin/env node
import assert from 'node:assert/strict';
import { exitLikeCommandResult } from '../../tools/shared/cli-utils.js';

const createProc = ({ killThrows = false } = {}) => {
  const state = {
    exits: [],
    kills: []
  };
  return {
    state,
    proc: {
      pid: 4242,
      exit: (code) => {
        state.exits.push(code);
      },
      kill: (pid, signal) => {
        state.kills.push({ pid, signal });
        if (killThrows) {
          throw new Error('kill failed');
        }
      }
    }
  };
};

{
  const { state, proc } = createProc();
  exitLikeCommandResult({ status: 7, signal: 'SIGINT' }, proc);
  assert.deepEqual(state.exits, [7], 'expected numeric status to exit directly');
  assert.equal(state.kills.length, 0, 'expected no signal propagation when status is present');
}

{
  const { state, proc } = createProc();
  exitLikeCommandResult({ status: null, signal: 'SIGTERM' }, proc);
  assert.equal(state.exits.length, 0, 'expected signal path to avoid direct exit');
  assert.deepEqual(state.kills, [{ pid: 4242, signal: 'SIGTERM' }], 'expected signal propagation');
}

{
  const { state, proc } = createProc({ killThrows: true });
  exitLikeCommandResult({ status: null, signal: 'SIGINT' }, proc);
  assert.deepEqual(state.exits, [1], 'expected fallback exit code when signal propagation throws');
}

{
  const { state, proc } = createProc();
  exitLikeCommandResult({ status: null, signal: '' }, proc);
  assert.deepEqual(state.exits, [1], 'expected fallback exit for unknown command result');
}

console.log('cli-utils exit-like-command-result test passed');
