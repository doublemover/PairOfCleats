import { spawnSync } from 'node:child_process';
import { isSyncCommandTimedOut, killTimedOutSyncProcessTree } from './sync-command.js';
import {
  DEFAULT_MAX_OUTPUT_BYTES,
  SHELL_MODE_DISABLED_ERROR,
  toNumber,
  resolveExpectedExitCodes,
  coerceOutputMode,
  coerceStdio,
  shouldCapture,
  buildResult,
  trimOutput
} from './options.js';
import { SubprocessError, SubprocessTimeoutError } from './errors.js';

export function spawnSubprocessSync(command, args, options = {}) {
  const startedAt = Date.now();
  const stdio = coerceStdio(options.stdio);
  const encoding = options.outputEncoding || 'utf8';
  const outputMode = coerceOutputMode(options.outputMode);
  const maxOutputBytes = Number.isFinite(Number(options.maxOutputBytes))
    ? Math.max(0, Math.floor(Number(options.maxOutputBytes)))
    : DEFAULT_MAX_OUTPUT_BYTES;
  const maxBufferBytes = Math.max(maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES);
  const captureStdout = shouldCapture(stdio, options.captureStdout, 1);
  const captureStderr = shouldCapture(stdio, options.captureStderr, 2);
  const rejectOnNonZeroExit = options.rejectOnNonZeroExit !== false;
  const expectedExitCodes = resolveExpectedExitCodes(options.expectedExitCodes);
  const resolvedTimeoutMs = toNumber(options.timeoutMs);
  const killSignal = options.killSignal || 'SIGTERM';
  if (options.shell === true) {
    const normalized = buildResult({
      pid: null,
      exitCode: null,
      signal: null,
      startedAt,
      stdout: captureStdout ? (outputMode === 'lines' ? [] : '') : undefined,
      stderr: captureStderr ? (outputMode === 'lines' ? [] : '') : undefined
    });
    throw new SubprocessError(SHELL_MODE_DISABLED_ERROR, normalized);
  }
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio,
    shell: false,
    input: options.input,
    timeout: Number.isFinite(resolvedTimeoutMs) && resolvedTimeoutMs > 0
      ? Math.max(1, Math.floor(resolvedTimeoutMs))
      : undefined,
    killSignal,
    maxBuffer: maxBufferBytes,
    encoding: captureStdout || captureStderr ? 'buffer' : undefined
  });
  const stdout = captureStdout
    ? trimOutput(result.stdout, maxOutputBytes, encoding, outputMode)
    : undefined;
  const stderr = captureStderr
    ? trimOutput(result.stderr, maxOutputBytes, encoding, outputMode)
    : undefined;
  const normalized = buildResult({
    pid: result.pid ?? null,
    exitCode: result.status ?? null,
    signal: result.signal ?? null,
    startedAt,
    stdout,
    stderr
  });
  if (result.error) {
    if (isSyncCommandTimedOut(result)) {
      killTimedOutSyncProcessTree(
        result?.pid,
        resolvedTimeoutMs,
        options.killTree !== false,
        options.detached === true
      );
    }
    if (result.error?.code === 'ETIMEDOUT') {
      throw new SubprocessTimeoutError('Subprocess timeout', normalized);
    }
    const name = options.name ? `${options.name} ` : '';
    throw new SubprocessError(
      `${name}failed to spawn: ${result.error.message || result.error}`,
      normalized,
      result.error
    );
  }
  if (!rejectOnNonZeroExit || expectedExitCodes.includes(normalized.exitCode ?? -1)) {
    return normalized;
  }
  const name = options.name ? `${options.name} ` : '';
  throw new SubprocessError(`${name}exited with code ${normalized.exitCode ?? 'unknown'}`, normalized);
}

export function runIsolatedNodeScriptSync({
  script,
  args = [],
  nodeArgs = [],
  input = null,
  env,
  cwd,
  maxOutputBytes,
  outputMode = 'string',
  captureStdout = true,
  captureStderr = true,
  rejectOnNonZeroExit = false,
  name = 'node script'
} = {}) {
  if (!script || typeof script !== 'string') {
    throw new Error('runIsolatedNodeScriptSync requires a script string.');
  }
  const resolvedArgs = [...nodeArgs, '-e', script, ...args];
  return spawnSubprocessSync(process.execPath, resolvedArgs, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    input,
    maxOutputBytes,
    captureStdout,
    captureStderr,
    outputMode,
    rejectOnNonZeroExit,
    name
  });
}
