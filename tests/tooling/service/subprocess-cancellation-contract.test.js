#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runLoggedSubprocess } from '../../../tools/service/subprocess-log.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-subprocess-cancel-'));
applyTestEnv({ cacheRoot: tempRoot });

const logPath = path.join(tempRoot, 'cancel.log');
const controller = new AbortController();
setTimeout(() => controller.abort(), 100);

const result = await runLoggedSubprocess({
  command: process.execPath,
  args: ['-e', "setTimeout(() => process.stdout.write('late'), 5000);"],
  logPath,
  signal: controller.signal,
  timeoutMs: 5000
});

assert.equal(result.exitCode, 1);
assert.equal(result.timedOut, false, 'abort should not be reported as timeout');
assert.ok(
  result.errorCode === 'SUBPROCESS_ABORT' || result.errorCode === 'ABORT_ERR',
  `expected abort error code, got ${result.errorCode}`
);
assert.ok(Number.isFinite(result.logBytesWritten) && result.logBytesWritten > 0);

const logText = await fs.readFile(logPath, 'utf8');
assert.match(logText, /job error Operation aborted/);

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('service subprocess cancellation contract test passed');
