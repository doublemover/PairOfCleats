#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runLoggedSubprocess } from '../../../tools/service/subprocess-log.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-subprocess-contract-'));
applyTestEnv({ cacheRoot: tempRoot });

try {
  const cancelLogPath = path.join(tempRoot, 'cancel.log');
  const cancelController = new AbortController();
  setTimeout(() => cancelController.abort(), 100);
  const cancelled = await runLoggedSubprocess({
    command: process.execPath,
    args: ['-e', "setTimeout(() => process.stdout.write('late'), 5000);"],
    logPath: cancelLogPath,
    signal: cancelController.signal,
    timeoutMs: 5000
  });
  assert.equal(cancelled.exitCode, 1);
  assert.equal(cancelled.timedOut, false);
  assert.ok(cancelled.errorCode === 'SUBPROCESS_ABORT' || cancelled.errorCode === 'ABORT_ERR');
  assert.ok(Number.isFinite(cancelled.logBytesWritten) && cancelled.logBytesWritten > 0);
  assert.match(await fs.readFile(cancelLogPath, 'utf8'), /job error Operation aborted/);

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
  assert.ok(stdoutSection);
  assert.ok(Buffer.byteLength(stdoutSection[1], 'utf8') <= bounded.maxOutputBytes);

  const timeoutLogPath = path.join(tempRoot, 'timeout.log');
  const timedOut = await runLoggedSubprocess({
    command: process.execPath,
    args: ['-e', "setTimeout(() => process.stdout.write('late'), 2000);"],
    logPath: timeoutLogPath,
    timeoutMs: 1000
  });
  assert.equal(timedOut.timedOut, true);
  assert.equal(timedOut.exitCode, 1);
  assert.ok(Number.isFinite(timedOut.logBytesWritten) && timedOut.logBytesWritten > 0);
  assert.match(await fs.readFile(timeoutLogPath, 'utf8'), /job timeout/);

  const signalLogPath = path.join(tempRoot, 'signal.log');
  const signaled = await runLoggedSubprocess({
    command: process.execPath,
    args: ['-e', "process.stdout.write('ignored');"],
    logPath: signalLogPath,
    spawnSubprocessImpl: async () => ({
      exitCode: null,
      signal: 'SIGINT',
      durationMs: 11,
      stdout: '',
      stderr: 'interrupted'
    })
  });
  assert.equal(signaled.exitCode, 1);
  assert.equal(signaled.signal, 'SIGINT');
  assert.equal(signaled.timedOut, false);
  assert.match(await fs.readFile(signalLogPath, 'utf8'), /job exit 1 signal=SIGINT/);

  console.log('tooling service subprocess contract matrix test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
