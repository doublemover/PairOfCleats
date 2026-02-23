#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runLoggedSubprocess } from '../../../tools/service/subprocess-log.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-subprocess-signal-'));
const logPath = path.join(tempRoot, 'signal.log');

const result = await runLoggedSubprocess({
  command: process.execPath,
  args: ['-e', "process.stdout.write('ignored');"],
  logPath,
  spawnSubprocessImpl: async () => ({
    exitCode: null,
    signal: 'SIGINT',
    durationMs: 11,
    stdout: '',
    stderr: 'interrupted'
  })
});

assert.equal(result.exitCode, 1);
assert.equal(result.signal, 'SIGINT');
assert.equal(result.timedOut, false);

const logText = await fs.readFile(logPath, 'utf8');
assert.match(logText, /job exit 1 signal=SIGINT/);

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('service subprocess signal contract test passed');
