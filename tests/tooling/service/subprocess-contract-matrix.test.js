#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { resolveLoggedSubprocessPolicy, runLoggedSubprocess } from '../../../tools/service/subprocess-log.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-subprocess-contract-'));
applyTestEnv({ cacheRoot: tempRoot });

try {
  for (const absent of [undefined, null, '', ' ']) {
    assert.deepEqual(resolveLoggedSubprocessPolicy({ maxOutputBytes: absent, timeoutMs: absent, env: {} }),
      { maxOutputBytes: 262144, timeoutMs: null });
    assert.deepEqual(resolveLoggedSubprocessPolicy({ maxOutputBytes: absent, timeoutMs: absent,
      env: { PAIROFCLEATS_SERVICE_SUBPROCESS_MAX_OUTPUT_BYTES: '65536', PAIROFCLEATS_SERVICE_SUBPROCESS_TIMEOUT_MS: '30000' } }),
    { maxOutputBytes: 65536, timeoutMs: 30000 });
  }
  for (const invalid of ['bad', NaN, Infinity]) {
    assert.deepEqual(resolveLoggedSubprocessPolicy({ maxOutputBytes: invalid, timeoutMs: invalid, env: {} }),
      { maxOutputBytes: 262144, timeoutMs: null });
  }
  assert.deepEqual(resolveLoggedSubprocessPolicy({ maxOutputBytes: 8192, timeoutMs: 2000,
    env: { PAIROFCLEATS_SERVICE_SUBPROCESS_MAX_OUTPUT_BYTES: '65536', PAIROFCLEATS_SERVICE_SUBPROCESS_TIMEOUT_MS: '30000' } }),
  { maxOutputBytes: 8192, timeoutMs: 2000 });
  assert.deepEqual(resolveLoggedSubprocessPolicy({ maxOutputBytes: 0, timeoutMs: 0,
    env: { PAIROFCLEATS_SERVICE_SUBPROCESS_TIMEOUT_MS: '30000' } }),
  { maxOutputBytes: 1024, timeoutMs: null }, 'explicit zero selects minimum capture and disables timeout');
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

  await withTemporaryEnv({ PAIROFCLEATS_SERVICE_SUBPROCESS_TIMEOUT_MS: '1000',
    PAIROFCLEATS_SERVICE_SUBPROCESS_MAX_OUTPUT_BYTES: '4096' }, async () => {
    const { createJobExecutor } = await import('../../../tools/service/indexer-service/job-executor.js');
    const fixtureRoot = path.join(tempRoot, 'executor');
    await fs.mkdir(fixtureRoot);
    await fs.writeFile(path.join(fixtureRoot, 'build_index.js'), "process.stdout.write('w'.repeat(8192));setTimeout(() => {}, 2500);\n");
    const diagnostics = [], originalError = console.error;
    console.error = message => diagnostics.push(message);
    try {
      const executor = createJobExecutor({ isEmbeddingsQueue: false, serviceExecutionMode: 'subprocess',
        daemonWorkerConfig: {}, resolvedQueueName: 'index', embeddingExtraEnv: {}, toolRoot: fixtureRoot,
        resolveRepoRuntimeEnv: () => ({}), completeNonRetriableFailure: async () => {} });
      const logPath = path.join(tempRoot, 'worker-policy.log');
      const result = await executor.executeClaimedJob({ job: { id: 'policy', repo: fixtureRoot, mode: 'code' },
        jobLifecycle: { registerPromise: promise => promise }, logPath });
      assert.equal(result.runResult.exitCode, 1);
      assert.equal(result.handled, false, 'timeout returns through normal job completion policy');
      const log = await fs.readFile(logPath, 'utf8');
      assert.match(log, /maxCaptureBytes=4096/);
      assert.match(log, /timeoutMs=1000/);
      assert.match(log, /job timeout/);
      assert.equal(diagnostics.length, 1);
      assert.match(diagnostics[0], /timed out/);
    } finally { console.error = originalError; }
  });
  console.log('tooling service subprocess contract matrix test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
