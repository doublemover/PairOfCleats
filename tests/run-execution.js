import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import PQueue from 'p-queue';
import { killProcessTree } from './helpers/kill-tree.js';
import { collectOutput, extractSkipReason } from './run-logging.js';
import { normalizeResult } from './run-results.js';

const sanitizeId = (value) => value.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 120) || 'test';

const writeLogFile = async ({ logDir, test, attempt, stdout, stderr, status, exitCode, signal, timedOut, skipReason, termination }) => {
  if (!logDir) return '';
  const safeId = sanitizeId(test.id);
  const filePath = path.join(logDir, `${safeId}.attempt-${attempt}.log`);
  const lines = [
    `id: ${test.id}`,
    `path: ${test.relPath}`,
    `attempt: ${attempt}`,
    `status: ${status}`,
    `exit: ${exitCode ?? 'null'}`,
    `signal: ${signal ?? 'null'}`,
    `timedOut: ${timedOut ? 'true' : 'false'}`,
    `skipReason: ${skipReason || ''}`,
    `termination: ${termination ? JSON.stringify(termination) : ''}`,
    ''
  ];
  if (stdout) {
    lines.push('--- stdout ---', stdout);
  }
  if (stderr) {
    lines.push('--- stderr ---', stderr);
  }
  await fsPromises.writeFile(filePath, lines.join('\n'), 'utf8');
  return filePath;
};

const runTestOnce = async ({ test, passThrough, env, cwd, timeoutMs, captureOutput, timeoutGraceMs, skipExitCode, maxOutputBytes }) => new Promise((resolve) => {
  const start = Date.now();
  const args = [test.path, ...passThrough];
  const testEnv = { ...env };
  if (!testEnv.PAIROFCLEATS_TEST_CACHE_SUFFIX) {
    testEnv.PAIROFCLEATS_TEST_CACHE_SUFFIX = sanitizeId(test.id);
  }
  if (!testEnv.PAIROFCLEATS_TEST_PID_FILE && test.id === 'harness/timeout-target') {
    testEnv.PAIROFCLEATS_TEST_PID_FILE = path.join(os.tmpdir(), `pairofcleats-timeout-${process.pid}.json`);
  }
  const child = spawn(process.execPath, args, {
    cwd,
    env: testEnv,
    detached: process.platform !== 'win32',
    stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  let timedOut = false;
  let timeoutHandle = null;
  let resolved = false;
  let termination = null;
  const stopTimer = () => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    timeoutHandle = null;
  };
  const finish = (result) => {
    if (resolved) return;
    resolved = true;
    stopTimer();
    resolve(normalizeResult(result));
  };
  if (timeoutMs > 0) {
    timeoutHandle = setTimeout(async () => {
      timedOut = true;
      try {
        termination = await killProcessTree(child.pid, { graceMs: timeoutGraceMs });
      } catch (error) {
        termination = { error: error?.message || String(error) };
      }
    }, timeoutMs);
  }
  const getStdout = collectOutput(child.stdout, maxOutputBytes);
  const getStderr = collectOutput(child.stderr, maxOutputBytes);
  child.on('error', (error) => {
    const durationMs = Date.now() - start;
    finish({
      status: 'failed',
      exitCode: null,
      signal: null,
      timedOut: false,
      durationMs,
      stdout: captureOutput ? getStdout() : '',
      stderr: captureOutput ? `${getStderr()}\n${error?.message || error}`.trim() : '',
      termination
    });
  });
  child.on('close', (code, signal) => {
    const durationMs = Date.now() - start;
    const stdout = captureOutput ? getStdout() : '';
    const stderr = captureOutput ? getStderr() : '';
    const skipped = !timedOut && code === skipExitCode;
    finish({
      status: timedOut ? 'failed' : (code === 0 ? 'passed' : (skipped ? 'skipped' : 'failed')),
      exitCode: code,
      signal,
      timedOut,
      durationMs,
      stdout,
      stderr,
      skipReason: skipped ? extractSkipReason(stdout, stderr) : '',
      termination
    });
  });
});

const runTestWithRetries = async ({ test, passThrough, env, cwd, timeoutMs, captureOutput, retries, logDir, timeoutGraceMs, skipExitCode, maxOutputBytes }) => {
  const maxAttempts = retries + 1;
  const logs = [];
  let lastResult = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runTestOnce({
      test,
      passThrough,
      env,
      cwd,
      timeoutMs,
      captureOutput,
      timeoutGraceMs,
      skipExitCode,
      maxOutputBytes
    });
    lastResult = result;
    const logPath = await writeLogFile({
      logDir,
      test,
      attempt,
      stdout: result.stdout,
      stderr: result.stderr,
      status: result.status,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      skipReason: result.skipReason,
      termination: result.termination
    });
    if (logPath) logs.push(logPath);
    if (result.status === 'passed' || result.status === 'skipped') {
      return normalizeResult({ ...result, attempts: attempt, logs });
    }
  }
  return normalizeResult({ ...(lastResult || { status: 'failed' }), attempts: maxAttempts, logs });
};

export const runTests = async ({ selection, context, reportResult }) => {
  const results = new Array(selection.length);
  let failFastTriggered = false;
  const queue = new PQueue({ concurrency: context.jobs });
  selection.forEach((test, index) => {
    queue.add(async () => {
      let result = null;
      if (test.presetStatus === 'skipped') {
        result = normalizeResult({ status: 'skipped', durationMs: 0, skipReason: test.skipReason || '' });
      } else if (context.failFast && failFastTriggered) {
        result = normalizeResult({ status: 'skipped', durationMs: 0, skipReason: '' });
      } else {
        result = await runTestWithRetries({
          test,
          passThrough: context.passThrough,
          env: context.baseEnv,
          cwd: context.root,
          timeoutMs: context.timeoutMs,
          captureOutput: context.captureOutput,
          retries: context.retries,
          logDir: context.runLogDir,
          timeoutGraceMs: context.timeoutGraceMs,
          skipExitCode: context.skipExitCode,
          maxOutputBytes: context.maxOutputBytes
        });
      }
      const fullResult = { ...test, ...normalizeResult(result) };
      if (context.failFast && fullResult.status === 'failed') {
        failFastTriggered = true;
      }
      results[index] = fullResult;
      if (reportResult) reportResult(fullResult, index);
    });
  });
  await queue.onIdle();
  return results;
};
