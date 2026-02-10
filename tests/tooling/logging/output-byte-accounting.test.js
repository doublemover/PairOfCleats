#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runLoggedSubprocess } from '../../../tools/service/subprocess-log.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-output-byte-accounting-'));
applyTestEnv({ cacheRoot: tempRoot });

const logPath = path.join(tempRoot, 'job.log');
const result = await runLoggedSubprocess({
  command: process.execPath,
  args: ['-e', "process.stdout.write('abcd'); process.stderr.write('xy');"],
  logPath,
  timeoutMs: 2000,
  maxOutputBytes: 1024
});

assert.equal(result.exitCode, 0);
assert.equal(result.stdoutBytes, 4);
assert.equal(result.stderrBytes, 2);

const logText = await fs.readFile(logPath, 'utf8');
assert.match(logText, /output bytes stdout=4 stderr=2/);
assert.match(logText, /\[stdout\][\s\S]*abcd/);
assert.match(logText, /\[stderr\][\s\S]*xy/);

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('output byte accounting test passed');
