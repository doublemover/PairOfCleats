import fs from 'node:fs';
import path from 'node:path';
import { spawnSubprocess } from '../../src/shared/subprocess.js';

const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;
const MIN_MAX_OUTPUT_BYTES = 1024;
const MAX_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

const toFiniteInt = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed);
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const toUtf8ByteLength = (value) => {
  if (typeof value !== 'string' || !value) return 0;
  return Buffer.byteLength(value, 'utf8');
};

/**
 * Append non-empty lines to log file, creating parent directory on demand.
 *
 * @param {string|null} logPath
 * @param {string[]} lines
 * @param {{onWriteError?:(error:Error)=>void}} [input]
 * @returns {number}
 */
const appendLogLines = (logPath, lines, { onWriteError = null } = {}) => {
  if (!logPath || typeof logPath !== 'string') return 0;
  const payload = Array.isArray(lines)
    ? lines.filter((line) => typeof line === 'string' && line.length > 0).join('\n')
    : '';
  if (!payload) return 0;
  const text = `${payload}\n`;
  const bytes = Buffer.byteLength(text, 'utf8');
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, text);
    return bytes;
  } catch (err) {
    if (typeof onWriteError === 'function') {
      onWriteError(err);
    }
    return 0;
  }
};

export const resolveLoggedSubprocessPolicy = ({
  maxOutputBytes = null,
  timeoutMs = null,
  env = process.env
} = {}) => {
  const envMax = toFiniteInt(env?.PAIROFCLEATS_SERVICE_SUBPROCESS_MAX_OUTPUT_BYTES);
  const envTimeout = toFiniteInt(env?.PAIROFCLEATS_SERVICE_SUBPROCESS_TIMEOUT_MS);
  const rawMax = toFiniteInt(maxOutputBytes);
  const rawTimeout = toFiniteInt(timeoutMs);
  const resolvedMax = clamp(
    rawMax ?? envMax ?? DEFAULT_MAX_OUTPUT_BYTES,
    MIN_MAX_OUTPUT_BYTES,
    MAX_MAX_OUTPUT_BYTES
  );
  const resolvedTimeout = rawTimeout ?? envTimeout ?? null;
  return {
    maxOutputBytes: resolvedMax,
    timeoutMs: Number.isFinite(resolvedTimeout) && resolvedTimeout > 0
      ? Math.max(1000, resolvedTimeout)
      : null
  };
};

/**
 * Render one structured subprocess log block for stdout/stderr/error telemetry.
 *
 * @param {object} input
 * @returns {string[]}
 */
const buildLogBlock = ({
  startedAt,
  endedAt,
  exitCode,
  timedOut,
  timeoutMs,
  stdoutBytes,
  stderrBytes,
  maxOutputBytes,
  stdout,
  stderr,
  errorMessage
}) => {
  const lines = [];
  lines.push(`[${startedAt}] job start`);
  lines.push(
    `[${endedAt}] output bytes stdout=${stdoutBytes} stderr=${stderrBytes} maxCaptureBytes=${maxOutputBytes}`
  );
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    lines.push(`[${endedAt}] timeoutMs=${timeoutMs}`);
  }
  lines.push('[stdout]');
  if (typeof stdout === 'string' && stdout) lines.push(stdout.trimEnd());
  lines.push('[/stdout]');
  lines.push('[stderr]');
  if (typeof stderr === 'string' && stderr) lines.push(stderr.trimEnd());
  lines.push('[/stderr]');
  if (timedOut) {
    lines.push(`[${endedAt}] job timeout exit=${exitCode}`);
  } else if (errorMessage) {
    lines.push(`[${endedAt}] job error ${errorMessage}`);
  }
  lines.push(`[${endedAt}] job exit ${exitCode}`);
  return lines;
};

/**
 * Execute subprocess and optionally capture/write bounded stdout/stderr logs.
 *
 * @param {{
 *   command:string,
 *   args?:string[],
 *   env?:Record<string,string>,
 *   signal?:AbortSignal|null,
 *   extraEnv?:Record<string,string>,
 *   logPath?:string|null,
 *   maxOutputBytes?:number|null,
 *   timeoutMs?:number|null,
 *   onWriteError?:(error:Error)=>void
 * }} [input]
 * @returns {Promise<{
 *   exitCode:number,timedOut:boolean,durationMs:number|null,stdout:string,stderr:string,
 *   stdoutBytes:number,stderrBytes:number,logBytesWritten:number,maxOutputBytes:number,
 *   timeoutMs:number|null,errorCode:string|null,errorMessage:string|null
 * }>}
 */
export const runLoggedSubprocess = async ({
  command,
  args = [],
  env = process.env,
  signal = null,
  extraEnv = {},
  logPath = null,
  maxOutputBytes = null,
  timeoutMs = null,
  onWriteError = null
} = {}) => {
  if (!command) {
    throw new Error('runLoggedSubprocess requires command.');
  }
  const useLog = typeof logPath === 'string' && logPath.trim();
  const policy = resolveLoggedSubprocessPolicy({ maxOutputBytes, timeoutMs, env });
  const startedAt = new Date().toISOString();
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let logBytesWritten = 0;

  const baseOptions = {
    stdio: useLog ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: { ...env, ...extraEnv },
    rejectOnNonZeroExit: false,
    captureStdout: useLog,
    captureStderr: useLog,
    outputMode: 'string',
    maxOutputBytes: policy.maxOutputBytes
  };
  if (signal) {
    baseOptions.signal = signal;
  }

  if (useLog) {
    baseOptions.onStdout = (chunk) => {
      stdoutBytes += toUtf8ByteLength(chunk);
    };
    baseOptions.onStderr = (chunk) => {
      stderrBytes += toUtf8ByteLength(chunk);
    };
  }
  if (Number.isFinite(policy.timeoutMs) && policy.timeoutMs > 0) {
    baseOptions.timeoutMs = policy.timeoutMs;
  }

  try {
    const result = await spawnSubprocess(command, args, baseOptions);
    const endedAt = new Date().toISOString();
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    const exitCode = Number.isFinite(result.exitCode) ? result.exitCode : 1;
    if (useLog) {
      logBytesWritten += appendLogLines(
        logPath,
        buildLogBlock({
          startedAt,
          endedAt,
          exitCode,
          timedOut: false,
          timeoutMs: policy.timeoutMs,
          stdoutBytes,
          stderrBytes,
          maxOutputBytes: policy.maxOutputBytes,
          stdout,
          stderr,
          errorMessage: null
        }),
        { onWriteError }
      );
    }
    return {
      exitCode,
      timedOut: false,
      durationMs: result.durationMs,
      stdout,
      stderr,
      stdoutBytes,
      stderrBytes,
      logBytesWritten,
      maxOutputBytes: policy.maxOutputBytes,
      timeoutMs: policy.timeoutMs,
      errorCode: null,
      errorMessage: null
    };
  } catch (err) {
    const endedAt = new Date().toISOString();
    const timedOut = err?.code === 'SUBPROCESS_TIMEOUT';
    const result = err?.result || {};
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    const exitCode = Number.isFinite(result.exitCode) ? result.exitCode : 1;
    const errorMessage = err?.message || String(err);
    if (useLog) {
      logBytesWritten += appendLogLines(
        logPath,
        buildLogBlock({
          startedAt,
          endedAt,
          exitCode,
          timedOut,
          timeoutMs: policy.timeoutMs,
          stdoutBytes,
          stderrBytes,
          maxOutputBytes: policy.maxOutputBytes,
          stdout,
          stderr,
          errorMessage
        }),
        { onWriteError }
      );
    }
    return {
      exitCode,
      timedOut,
      durationMs: Number.isFinite(result.durationMs) ? result.durationMs : null,
      stdout,
      stderr,
      stdoutBytes,
      stderrBytes,
      logBytesWritten,
      maxOutputBytes: policy.maxOutputBytes,
      timeoutMs: policy.timeoutMs,
      errorCode: err?.code || null,
      errorMessage
    };
  }
};
