#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runLoggedSubprocess } from '../../../tools/service/subprocess-log.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-output-byte-buffer-'));
applyTestEnv({ cacheRoot: tempRoot });

const logPath = path.join(tempRoot, 'job.log');
const result = await runLoggedSubprocess({
  command: process.execPath,
  args: ['-e', 'process.exit(0)'],
  logPath,
  timeoutMs: 2000,
  maxOutputBytes: 1024,
  spawnSubprocessImpl: async (_command, _args, options) => {
    options.onStdout?.(Buffer.from('abc'));
    options.onStderr?.(Buffer.from('12'));
    return {
      exitCode: 0,
      signal: null,
      durationMs: 1,
      stdout: 'abc',
      stderr: '12'
    };
  }
});

assert.equal(result.exitCode, 0);
assert.equal(result.stdoutBytes, 3, 'buffer stdout chunks should count by byte length');
assert.equal(result.stderrBytes, 2, 'buffer stderr chunks should count by byte length');

const logText = await fs.readFile(logPath, 'utf8');
assert.match(logText, /output bytes stdout=3 stderr=2/);

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('output byte accounting buffer chunk test passed');
