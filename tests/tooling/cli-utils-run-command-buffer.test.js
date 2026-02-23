#!/usr/bin/env node
import assert from 'node:assert/strict';
import { runCommand } from '../../tools/shared/cli-utils.js';

const expectedBytes = 1_200_000;
const result = runCommand(process.execPath, ['-e', `process.stdout.write('x'.repeat(${expectedBytes}))`], {
  stdio: 'pipe',
  encoding: 'utf8',
  maxBuffer: 2 * 1024 * 1024
});

assert.equal(result.status, 0, 'expected child process to succeed');
assert.equal(result.stdout.length, expectedBytes, 'expected maxBuffer to map to subprocess output cap');

console.log('cli-utils run-command buffer passthrough test passed');
