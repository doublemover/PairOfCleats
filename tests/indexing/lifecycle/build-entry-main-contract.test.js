#!/usr/bin/env node
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { main } from '../../../build_index.js';

ensureTestingEnv(process.env);

const stdout = new PassThrough();
let stdoutText = '';
stdout.on('data', (chunk) => {
  stdoutText += String(chunk);
});

const stderr = new PassThrough();
let stderrText = '';
stderr.on('data', (chunk) => {
  stderrText += String(chunk);
});

const exitCode = await main({
  rawArgs: ['--config-dump', '--json'],
  rawArgv: ['node', 'build_index.js', '--config-dump', '--json'],
  env: process.env,
  stdout,
  stderr
});

assert.equal(exitCode, 0, `expected config-dump main() exit 0, stderr=${stderrText}`);
assert.equal(stderrText, '', 'expected config-dump main() to avoid stderr output');
const payload = JSON.parse(stdoutText || '{}');
assert.equal(typeof payload, 'object', 'expected config-dump JSON payload');
assert.equal(payload.schemaVersion, 1, 'expected config-dump payload schemaVersion');
assert.equal(typeof payload.runtime, 'object', 'expected config-dump payload to include runtime');
assert.equal(typeof payload.concurrency, 'object', 'expected config-dump payload to include concurrency');
assert.equal(typeof payload.queues, 'object', 'expected config-dump payload to include queues');

console.log('build entry main contract test passed');
