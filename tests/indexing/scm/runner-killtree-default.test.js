#!/usr/bin/env node
import assert from 'node:assert/strict';
import { getScmCommandRunner, runScmCommand, setScmCommandRunner } from '../../../src/index/scm/runner.js';

const defaultRunner = getScmCommandRunner();
const calls = [];

try {
  setScmCommandRunner(async (command, args, options = {}) => {
    calls.push({ command, args, options });
    return { exitCode: 0, stdout: '', stderr: '' };
  });

  await runScmCommand('git', ['status']);
  await runScmCommand('git', ['status'], { killTree: true });

  assert.equal(calls.length, 2, 'expected two SCM runner invocations');
  assert.equal(calls[0].options.killTree, false, 'expected SCM default killTree=false');
  assert.equal(calls[1].options.killTree, true, 'expected explicit killTree=true to be preserved');
} finally {
  setScmCommandRunner(defaultRunner);
}

console.log('scm runner killTree default ok');
