import { realpathSync } from 'node:fs';
import { writeFailureReceipt } from './failure-receipt.js';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import PQueue from 'p-queue';
import { killProcessTree } from '../helpers/kill-tree.js';
import { collectOutput, extractSkipReason } from './run-logging.js';
import { normalizeResult } from './run-results.js';

const sanitizeId = (value) => value.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 120) || 'test';
const UINT32_RANGE = 0x1_0000_0000;
const INT32_MAX = 0x7fffffff;
const INT32_MIN = -0x80000000;
const UINT32_MAX = 0xffffffff;
const expandExitCodeAliases = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return [];
  const code = Math.trunc(numeric);
  if (code < INT32_MIN || code > UINT32_MAX) return [code];
  const unsigned = code < 0 ? code + UINT32_RANGE : code;
  const signed = unsigned > INT32_MAX ? unsigned - UINT32_RANGE : unsigned;
  return signed === unsigned ? [signed] : [signed, unsigned];
};

const normalizeRedoExitCodes = (value) => {
  const normalized = new Set();
  if (!value) return normalized;
  const append = (entry) => {
    for (const code of expandExitCodeAliases(entry)) {
      normalized.add(code);
    }
  };
  if (Array.isArray(value)) {
    for (const entry of value) {
      append(entry);
    }
    return normalized;
  }
  append(value);
  return normalized;
};

const isRedoExit = (result, redoExitCodes) => {
  const codes = normalizeRedoExitCodes(redoExitCodes);
  if (!codes.size || result.status !== 'failed' || result.timedOut) return false;
  return expandExitCodeAliases(result.exitCode).some((code) => codes.has(code));
};

const resolveTimeoutOverride = (value) => {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1000, Math.floor(parsed));
};

const resolveTestTimeout = ({ test, defaultTimeoutMs, overrides }) => {
  const override = overrides && typeof overrides === 'object'
    ? resolveTimeoutOverride(overrides[test.id] ?? overrides[test.relPath])
    : null;
  if (!override) return defaultTimeoutMs;
  return Math.min(defaultTimeoutMs, override);
};

const writeLogFile = async ({
  logDir,
  test,
  attempt,
  stdout,
  stderr,
  status,
  exitCode,
  signal,
  timedOut,
  timeoutClass,
  skipReason,
  termination
}) => {
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
    `timeoutClass: ${timeoutClass || ''}`,
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
  const handle = await fsPromises.open(filePath, 'w');
  try { await handle.writeFile(lines.join('\n'), 'utf8'); if (status === 'failed') await handle.sync(); }
  finally { await handle.close(); }
  return filePath;
};

const runTestOnce = async ({
  test,
  passThrough,
  env,
  cwd,
  timeoutMs,
  captureOutput,
  timeoutGraceMs,
  skipExitCode,
  maxOutputBytes,
  onChildStart = null,
  onChildStop = null,
  onActivity = null
}) => new Promise((resolve) => {
  const start = Date.now();
  const args = [test.path, ...passThrough];
  const testEnv = { ...env };
  if (!testEnv.PAIROFCLEATS_TEST_LANE && typeof test.lane === 'string' && test.lane.trim()) {
    testEnv.PAIROFCLEATS_TEST_LANE = test.lane.trim();
  }
  if (!testEnv.PAIROFCLEATS_TEST_ID && typeof test.id === 'string' && test.id.trim()) {
    testEnv.PAIROFCLEATS_TEST_ID = test.id.trim();
  }
  if (!testEnv.PAIROFCLEATS_TEST_CACHE_SUFFIX) {
    testEnv.PAIROFCLEATS_TEST_CACHE_SUFFIX = sanitizeId(test.id);
  }
  if (!testEnv.PAIROFCLEATS_TEST_PID_FILE && (test.id === 'harness/timeout-target' || test.id === 'runner/harness/timeout-target')) {
    testEnv.PAIROFCLEATS_TEST_PID_FILE = path.join(os.tmpdir(), `pairofcleats-timeout-${process.pid}.json`);
  }
  const child = spawn(process.execPath, args, {
    cwd,
    env: testEnv,
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  let timedOut = false;
  let interruption = null;
  let timeoutHandle = null;
  let resolved = false;
  let termination = null;
  const interrupt = reason => {
    if (resolved || interruption) return;
    interruption = { kind: 'watchdog', reason, at: new Date().toISOString() };
    timedOut = true;
  };
  if (typeof onChildStart === 'function' && Number.isFinite(child.pid)) onChildStart(child.pid, interrupt);
  if (typeof onActivity === 'function') onActivity();
  const execution = { executable: process.execPath, resolvedExecutable: realpathSync(process.execPath), args, cwd,
    runtime: { node: process.version, v8: process.versions.v8, modules: process.versions.modules, platform: process.platform, arch: process.arch, basis: 'same executable as parent' },
    pid: child.pid ?? null, startedAt: new Date(start).toISOString(), captureOutput, lastPhase: null, spawnError: null, statusSource: null };
  const observed = { stdout: 0, stderr: 0 }, tails = { stdout: '', stderr: '' };
  const observe = stream => chunk => {
    observed[stream] += chunk.length;
    tails[stream] = (tails[stream] + chunk).slice(-4096);
    const markers = tails[stream].split(/\r?\n/).filter(line => /^\[(?:cleanup|closeout|init|build|tooling)\]/.test(line));
    if (markers.length) execution.lastPhase = { stream, line: markers.at(-1).slice(0, 1024), observedAt: new Date().toISOString() };
  };
  const stopTimer = () => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    timeoutHandle = null;
  };
  const finish = (result) => {
    if (resolved) return;
    resolved = true;
    stopTimer();
    if (typeof onChildStop === 'function' && Number.isFinite(child.pid)) {
      onChildStop(child.pid);
    }
    execution.endedAt = new Date().toISOString();
    for (const stream of ['stdout', 'stderr']) execution[stream] = { observedStringUnits: observed[stream], retainedStringUnits: (result[stream] || '').length,
      truncated: observed[stream] > (result[stream] || '').length, configuredLimit: maxOutputBytes, limitUnit: 'javascript-string-units' };
    execution.interruption = interruption;
    resolve(normalizeResult({ ...result, execution, interruption }));
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
  const getStdout = collectOutput(child.stdout, maxOutputBytes, observe('stdout'));
  const getStderr = collectOutput(child.stderr, maxOutputBytes, observe('stderr'));
  if (child.stdout && typeof onActivity === 'function') {
    child.stdout.on('data', onActivity);
  }
  if (child.stderr && typeof onActivity === 'function') {
    child.stderr.on('data', onActivity);
  }
  child.on('error', (error) => {
    execution.statusSource = 'test-process-spawn-error';
    execution.spawnError = { name: error.name, code: error.code || null, errno: error.errno ?? null, syscall: error.syscall || null, message: error.message };
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
    if (!execution.statusSource) execution.statusSource = 'test-process-close-event';
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

const runTestWithRetries = async ({
  test,
  passThrough,
  env,
  cwd,
  timeoutMs,
  captureOutput,
  retries,
  logDir,
  timeoutGraceMs,
  skipExitCode,
  maxOutputBytes,
  redoExitCodes,
  attemptOffset = 0,
  onChildStart = null,
  onChildStop = null,
  onActivity = null,
  getRunInterruption = () => null
}) => {
  const maxAttempts = retries + 1;
  const logs = [];
  let lastResult = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptNumber = attemptOffset + attempt;
    const stopped = getRunInterruption();
    if (stopped) return normalizeResult({ status: 'failed', attempts: attemptNumber - 1, logs, interruption: stopped });
    const result = await runTestOnce({
      test,
      passThrough,
      env,
      cwd,
      timeoutMs,
      captureOutput,
      timeoutGraceMs,
      skipExitCode,
      maxOutputBytes,
      onChildStart,
      onChildStop,
      onActivity
    });
    lastResult = result;
    const logPath = await writeLogFile({
      logDir,
      test,
      attempt: attemptNumber,
      stdout: result.stdout,
      stderr: result.stderr,
      status: result.status,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      timeoutClass: result.timeoutClass,
      skipReason: result.skipReason,
      termination: result.termination
    });
    if (logPath) logs.push(logPath);
    const receiptPath = await writeFailureReceipt({ test, attempt: attemptNumber, result, logPath });
    if (receiptPath) logs.push(receiptPath);
    if (result.interruption?.kind === 'watchdog') return normalizeResult({ ...result, attempts: attemptNumber, logs });
    if (result.status === 'passed' || result.status === 'skipped') {
      return normalizeResult({ ...result, attempts: attemptNumber, logs });
    }
    if (isRedoExit(result, redoExitCodes)) {
      return normalizeResult({ ...result, status: 'redo', attempts: attemptNumber, logs });
    }
  }
  return normalizeResult({ ...(lastResult || { status: 'failed' }), attempts: attemptOffset + maxAttempts, logs });
};

const createRetryRunOptions = ({
  test,
  context,
  activeChildren,
  markActivity,
  redoExitCodes = context.redoExitCodes,
  attemptOffset = 0
}) => ({
  test,
  passThrough: context.passThrough,
  env: context.baseEnv,
  cwd: context.root,
  timeoutMs: resolveTestTimeout({
    test,
    defaultTimeoutMs: context.timeoutMs,
    overrides: context.timeoutOverrides
  }),
  captureOutput: context.captureOutput,
  retries: context.retries,
  logDir: context.runLogDir,
  timeoutGraceMs: context.timeoutGraceMs,
  skipExitCode: context.skipExitCode,
  maxOutputBytes: context.maxOutputBytes,
  redoExitCodes,
  attemptOffset,
  onChildStart: (pid, interrupt) => {
    activeChildren.set(pid, interrupt);
    markActivity();
  },
  onChildStop: (pid) => {
    activeChildren.delete(pid);
    markActivity();
  },
  onActivity: markActivity,
  getRunInterruption: () => context.watchdogState?.triggered
    ? { kind: 'watchdog', reason: context.watchdogState.reason } : null
});

export const runTests = async ({ selection, context, reportResult, reportDirect }) => {
  const results = new Array(selection.length);
  context.watchdogState ||= { triggered: false, reason: null };
  let failFastTriggered = false;
  const redoQueue = [];
  const queue = new PQueue({ concurrency: context.jobs });
  const activeChildren = new Map();
  let watchdogTriggered = false;
  let lastActivityAt = Date.now();
  const markActivity = () => {
    lastActivityAt = Date.now();
  };
  let watchdogTimer = null;
  const watchdogMs = Number(context.watchdogMs);
  if (Number.isFinite(watchdogMs) && watchdogMs > 0) {
    watchdogTimer = setInterval(async () => {
      if (!activeChildren.size || watchdogTriggered) return;
      if (Date.now() - lastActivityAt < watchdogMs) return;
      failFastTriggered = true;
      watchdogTriggered = true;
      if (context.watchdogState && typeof context.watchdogState === 'object') {
        context.watchdogState.triggered = true;
        context.watchdogState.reason = `no test activity for ${Math.floor(watchdogMs)}ms`;
      }
      const reason = `no test activity for ${Math.floor(watchdogMs)}ms`;
      // Mark every active attempt before the first await or termination signal.
      for (const interrupt of activeChildren.values()) interrupt(reason);
      for (const pid of Array.from(activeChildren.keys())) {
        try {
          await (context.terminateWatchdogChild || killProcessTree)(pid, { graceMs: context.timeoutGraceMs });
        } catch {}
      }
      markActivity();
    }, 500);
    if (typeof watchdogTimer.unref === 'function') watchdogTimer.unref();
  }
  try {
    selection.forEach((test, index) => {
      queue.add(async () => {
        let result = null;
        if (test.presetStatus === 'skipped') {
          result = normalizeResult({ status: 'skipped', durationMs: 0, skipReason: test.skipReason || '' });
        } else if (watchdogTriggered) {
          result = normalizeResult({ status: 'failed', durationMs: 0, interruption: { kind: 'watchdog', reason: 'run watchdog stopped admission' } });
        } else if (context.failFast && failFastTriggered) {
          result = normalizeResult({ status: 'skipped', durationMs: 0, skipReason: '' });
        } else {
          if (context.initReporter?.start) {
            context.initReporter.start(test);
          }
          result = await runTestWithRetries(createRetryRunOptions({
            test,
            context,
            activeChildren,
            markActivity
          }));
        }
        const fullResult = { ...test, ...normalizeResult(result) };
        if (fullResult.status === 'redo') {
          redoQueue.push({ test, index, prior: fullResult });
        }
        if (context.failFast && fullResult.status === 'failed') {
          failFastTriggered = true;
        }
        results[index] = fullResult;
        markActivity();
        if (reportResult) reportResult(fullResult, index);
      });
    });
    await queue.onIdle();
    if (redoQueue.length && !watchdogTriggered) {
      const redoRunner = new PQueue({ concurrency: context.jobs });
      redoQueue.forEach(({ test, index, prior }) => {
        redoRunner.add(async () => {
          if (context.initReporter?.start) {
            context.initReporter.start(test, { label: 'REDO', labelMode: 'redo' });
          }
          const result = await runTestWithRetries(createRetryRunOptions({
            test,
            redoExitCodes: null,
            attemptOffset: prior.attempts,
            context,
            activeChildren,
            markActivity
          }));
          const mergedLogs = [...(prior.logs || []), ...(result.logs || [])];
          const finalResult = { ...test, ...normalizeResult({ ...result, logs: mergedLogs }) };
          results[index] = finalResult;
          markActivity();
          if (reportResult) {
            reportResult(finalResult, index);
          }
          if (reportDirect && reportDirect !== reportResult) {
            reportDirect(finalResult);
          }
        });
      });
      await redoRunner.onIdle();
    }
    return results;
  } finally {
    if (watchdogTimer) clearInterval(watchdogTimer);
    if (activeChildren.size > 0) {
      const reapTargets = Array.from(activeChildren.keys());
      activeChildren.clear();
      await Promise.allSettled(
        reapTargets.map((pid) => killProcessTree(pid, { graceMs: context.timeoutGraceMs }))
      );
    }
  }
};
