#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runLoggedSubprocess } from '../../../tools/service/subprocess-log.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-subprocess-bounds-'));
applyTestEnv({ cacheRoot: tempRoot });

const boundedLogPath = path.join(tempRoot, 'bounded.log');
const bounded = await runLoggedSubprocess({
  command: process.execPath,
  args: ['-e', "process.stdout.write('x'.repeat(4096));"],
  logPath: boundedLogPath,
  maxOutputBytes: 64
});

assert.equal(bounded.exitCode, 0);
assert.equal(bounded.stdoutBytes, 4096);

const boundedLog = await fs.readFile(boundedLogPath, 'utf8');
assert.match(boundedLog, new RegExp(`maxCaptureBytes=${bounded.maxOutputBytes}`));
const stdoutSection = boundedLog.match(/\[stdout\]\n([\s\S]*?)\n\[\/stdout\]/);
assert.ok(stdoutSection, 'expected stdout section in log');
assert.ok(
  Buffer.byteLength(stdoutSection[1], 'utf8') <= bounded.maxOutputBytes,
  'expected capped captured stdout'
);

const timeoutLogPath = path.join(tempRoot, 'timeout.log');
const timedOut = await runLoggedSubprocess({
  command: process.execPath,
  args: ['-e', "setTimeout(() => process.stdout.write('late'), 2000);"],
  logPath: timeoutLogPath,
  timeoutMs: 1000
});

assert.equal(timedOut.timedOut, true, 'expected timeout to be reported');
assert.equal(timedOut.exitCode, 1);
assert.ok(Number.isFinite(timedOut.logBytesWritten) && timedOut.logBytesWritten > 0);

const timeoutLog = await fs.readFile(timeoutLogPath, 'utf8');
assert.match(timeoutLog, /job timeout/);

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('service subprocess buffer bounds test passed');
