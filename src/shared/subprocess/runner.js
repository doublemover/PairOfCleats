import { spawn, spawnSync } from 'node:child_process';
import { killChildProcessTree } from '../kill-tree.js';
import {
  DEFAULT_MAX_OUTPUT_BYTES,
  SHELL_MODE_DISABLED_ERROR,
  toNumber,
  resolveExpectedExitCodes,
  resolveKillGraceMs,
  resolveMaxOutputBytes,
  coerceOutputMode,
  coerceStdio,
  shouldCapture,
  createCollector,
  buildResult,
  trimOutput
} from './options.js';
import {
  trackedOwnershipIdByAbortSignal,
  trackedSubprocessScopeContext,
  normalizeTrackedOwnershipId,
  normalizeTrackedScope,
  registerChildProcessForCleanup
} from './tracking.js';

class SubprocessError extends Error {
  constructor(message, result, cause) {
    super(message);
    this.name = 'SubprocessError';
    this.code = 'SUBPROCESS_FAILED';
    this.result = result;
    if (cause) this.cause = cause;
  }
}

class SubprocessTimeoutError extends Error {
  constructor(message, result) {
    super(message);
    this.name = 'SubprocessTimeoutError';
    this.code = 'SUBPROCESS_TIMEOUT';
    this.result = result;
  }
}

class SubprocessAbortError extends Error {
  constructor(message, result) {
    super(message);
    this.name = 'AbortError';
    this.code = 'ABORT_ERR';
    this.result = result;
  }
}

function spawnSubprocess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const stdio = coerceStdio(options.stdio);
    const encoding = options.outputEncoding || 'utf8';
    const outputMode = coerceOutputMode(options.outputMode);
    const maxOutputBytes = resolveMaxOutputBytes(options.maxOutputBytes);
    const captureStdout = shouldCapture(stdio, options.captureStdout, 1);
    const captureStderr = shouldCapture(stdio, options.captureStderr, 2);
    const rejectOnNonZeroExit = options.rejectOnNonZeroExit !== false;
    const expectedExitCodes = resolveExpectedExitCodes(options.expectedExitCodes);
    const detached = typeof options.detached === 'boolean'
      ? options.detached
      : process.platform !== 'win32';
    const killTree = options.killTree !== false;
    const killSignal = options.killSignal || 'SIGTERM';
    const killGraceMs = resolveKillGraceMs(options.killGraceMs);
    const cleanupOnParentExit = typeof options.cleanupOnParentExit === 'boolean'
      ? options.cleanupOnParentExit
      : !(options.unref === true && detached === true);
    const abortSignal = options.signal || null;
    const trackedScopeContext = trackedSubprocessScopeContext.getStore() || null;
    const inheritedOwnershipId = normalizeTrackedOwnershipId(options.ownershipId ?? options.ownerId)
      || normalizeTrackedOwnershipId(trackedOwnershipIdByAbortSignal.get(abortSignal))
      || normalizeTrackedOwnershipId(trackedScopeContext?.ownershipId ?? trackedScopeContext?.scope);
    const cleanupScope = normalizeTrackedScope(options.cleanupScope)
      || normalizeTrackedScope(options.scope)
      || inheritedOwnershipId;
    if (abortSignal?.aborted) {
      const result = buildResult({
        pid: null,
        exitCode: null,
        signal: null,
        startedAt,
        stdout: undefined,
        stderr: undefined
      });
      reject(new SubprocessAbortError('Operation aborted', result));
      return;
    }
    const stdoutCollector = createCollector({ enabled: captureStdout, maxOutputBytes, encoding });
    const stderrCollector = createCollector({ enabled: captureStderr, maxOutputBytes, encoding });
    if (options.shell === true) {
      const result = buildResult({
        pid: null,
        exitCode: null,
        signal: null,
        startedAt,
        stdout: undefined,
        stderr: undefined
      });
      reject(new SubprocessError(SHELL_MODE_DISABLED_ERROR, result));
      return;
    }
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio, shell: false, detached });
    let unregisterTrackedChild = () => {};
    if (cleanupOnParentExit) {
      unregisterTrackedChild = registerChildProcessForCleanup(child, {
        killTree,
        killSignal,
        killGraceMs,
        detached,
        scope: cleanupScope,
        ownershipId: inheritedOwnershipId || cleanupScope,
        command,
        args,
        name: options.name || null,
        startedAtMs: startedAt
      });
    }
    if (options.input != null && child.stdin) {
      try {
        child.stdin.write(options.input);
        child.stdin.end();
      } catch {}
    }
    if (typeof options.onSpawn === 'function') {
      try {
        options.onSpawn(child);
      } catch {}
    }
    if (options.unref === true) {
      child.unref();
    }
    let settled = false;
    let timeoutId = null;
    let abortHandler = null;
    const onStdout = typeof options.onStdout === 'function' ? options.onStdout : null;
    const onStderr = typeof options.onStderr === 'function' ? options.onStderr : null;
    const handleOutput = (collector, handler) => (chunk) => {
      collector.push(chunk);
      if (handler) {
        handler(Buffer.isBuffer(chunk) ? chunk.toString(encoding) : String(chunk));
      }
    };
    const onStdoutData = captureStdout || onStdout
      ? handleOutput(stdoutCollector, onStdout)
      : null;
    const onStderrData = captureStderr || onStderr
      ? handleOutput(stderrCollector, onStderr)
      : null;
    if (onStdoutData && child.stdout) {
      child.stdout.on('data', onStdoutData);
    }
    if (onStderrData && child.stderr) {
      child.stderr.on('data', onStderrData);
    }
    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (abortHandler && abortSignal) {
        abortSignal.removeEventListener('abort', abortHandler);
      }
      unregisterTrackedChild();
      if (onStdoutData && child.stdout) child.stdout.off('data', onStdoutData);
      if (onStderrData && child.stderr) child.stderr.off('data', onStderrData);
    };
    const finalize = (exitCode, signal) => {
      const result = buildResult({
        pid: child.pid,
        exitCode,
        signal,
        startedAt,
        stdout: stdoutCollector.toOutput(outputMode),
        stderr: stderrCollector.toOutput(outputMode)
      });
      if (!rejectOnNonZeroExit || expectedExitCodes.includes(exitCode ?? -1)) {
        resolve(result);
        return;
      }
      const name = options.name ? `${options.name} ` : '';
      reject(new SubprocessError(`${name}exited with code ${exitCode ?? 'unknown'}`, result));
    };
    const resolvedTimeoutMs = toNumber(options.timeoutMs);
    if (Number.isFinite(resolvedTimeoutMs) && resolvedTimeoutMs > 0) {
      timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          if (typeof child.unref === 'function') child.unref();
        } catch {}
        killChildProcessTree(child, {
          killTree,
          killSignal,
          graceMs: killGraceMs,
          detached,
          awaitGrace: false
        }).catch(() => {});
        cleanup();
        const result = buildResult({
          pid: child.pid,
          exitCode: null,
          signal: null,
          startedAt,
          stdout: stdoutCollector.toOutput(outputMode),
          stderr: stderrCollector.toOutput(outputMode)
        });
        reject(new SubprocessTimeoutError('Subprocess timeout', result));
      }, Math.max(1, resolvedTimeoutMs));
    }
    abortHandler = () => {
      if (settled) return;
      settled = true;
      try {
        if (typeof child.unref === 'function') child.unref();
      } catch {}
      killChildProcessTree(child, {
        killTree,
        killSignal,
        graceMs: killGraceMs,
        detached,
        awaitGrace: false
      }).catch(() => {});
      cleanup();
      const result = buildResult({
        pid: child.pid,
        exitCode: null,
        signal: null,
        startedAt,
        stdout: stdoutCollector.toOutput(outputMode),
        stderr: stderrCollector.toOutput(outputMode)
      });
      reject(new SubprocessAbortError('Operation aborted', result));
    };
    if (abortSignal) {
      abortSignal.addEventListener('abort', abortHandler, { once: true });
    }
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      const result = buildResult({
        pid: child.pid,
        exitCode: null,
        signal: null,
        startedAt,
        stdout: stdoutCollector.toOutput(outputMode),
        stderr: stderrCollector.toOutput(outputMode)
      });
      reject(new SubprocessError(err?.message || 'Subprocess failed', result, err));
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      finalize(code, signal);
    });
  });
}

function spawnSubprocessSync(command, args, options = {}) {
  const startedAt = Date.now();
  const stdio = coerceStdio(options.stdio);
  const encoding = options.outputEncoding || 'utf8';
  const outputMode = coerceOutputMode(options.outputMode);
  const maxOutputBytes = resolveMaxOutputBytes(options.maxOutputBytes);
  const maxBufferBytes = Math.max(maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES);
  const captureStdout = shouldCapture(stdio, options.captureStdout, 1);
  const captureStderr = shouldCapture(stdio, options.captureStderr, 2);
  const rejectOnNonZeroExit = options.rejectOnNonZeroExit !== false;
  const expectedExitCodes = resolveExpectedExitCodes(options.expectedExitCodes);
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

/**
 * Run a Node.js script in an isolated process (sync).
 * @param {object} params
 * @param {string} params.script
 * @param {string[]} [params.args]
 * @param {string[]} [params.nodeArgs]
 * @param {Buffer|string|null} [params.input]
 * @param {object} [params.env]
 * @param {string} [params.cwd]
 * @param {number} [params.maxOutputBytes]
 * @param {'string'|'lines'} [params.outputMode]
 * @param {boolean} [params.captureStdout]
 * @param {boolean} [params.captureStderr]
 * @param {boolean} [params.rejectOnNonZeroExit]
 * @param {string} [params.name]
 * @returns {{pid:number|null,exitCode:number|null,signal:string|null,durationMs:number,stdout?:string|string[],stderr?:string|string[]}}
 */
/**
 * Run a Node.js inline script in an isolated process.
 * @param {object} params
 * @param {string} params.script
 * @param {string[]} [params.args]
 * @param {string[]} [params.nodeArgs]
 * @param {Buffer|string|null} [params.input]
 * @param {object} [params.env]
 * @param {string} [params.cwd]
 * @param {number} [params.maxOutputBytes]
 * @param {'string'|'lines'} [params.outputMode]
 * @param {boolean} [params.captureStdout]
 * @param {boolean} [params.captureStderr]
 * @param {boolean} [params.rejectOnNonZeroExit]
 * @param {string} [params.name]
 * @returns {{pid:number|null,exitCode:number|null,signal:string|null,durationMs:number,stdout?:string|string[],stderr?:string|string[]}}
 */
function runIsolatedNodeScriptSync({
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

export {
  SubprocessError,
  SubprocessTimeoutError,
  SubprocessAbortError,
  spawnSubprocess,
  spawnSubprocessSync,
  runIsolatedNodeScriptSync
};
