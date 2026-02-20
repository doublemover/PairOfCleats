#!/usr/bin/env node
import assert from 'node:assert/strict';
import { runScmCommand } from '../../../src/index/scm/runner.js';

const script = [
  'const payload = "x".repeat(1_300_000);',
  'process.stdout.write(`first-entry\\0${payload}\\0last-entry\\0`);'
].join('');

const result = await runScmCommand(process.execPath, ['-e', script], {
  outputMode: 'string',
  captureStdout: true,
  captureStderr: true,
  rejectOnNonZeroExit: false
});

assert.equal(result.exitCode, 0, 'expected subprocess to exit cleanly');
const entries = String(result.stdout || '').split('\0').filter(Boolean);
assert.equal(entries[0], 'first-entry', 'expected SCM runner output not to truncate the leading entries');
assert.equal(entries.at(-1), 'last-entry', 'expected SCM runner output not to truncate trailing entries');

console.log('scm runner max output default ok');
