import { spawn, spawnSync } from 'node:child_process';
import { killChildProcessTree } from './kill-tree.js';

const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;
const DEFAULT_KILL_GRACE_MS = 5000;
const TRACKED_SUBPROCESS_FORCE_GRACE_MS = 0;
const TRACKED_SUBPROCESS_TERMINATION_SIGNALS = Object.freeze(['SIGINT', 'SIGTERM']);

const SHELL_MODE_DISABLED_ERROR = (
  'spawnSubprocess shell mode is disabled for security; pass an executable and args with shell=false.'
);

const trackedSubprocesses = new Map();
let trackedSubprocessHooksInstalled = false;
let trackedSubprocessShutdownTriggered = false;
let trackedSubprocessShutdownPromise = null;
const signalForwardInFlight = new Set();

export class SubprocessError extends Error {
  constructor(message, result, cause) {
    super(message);
    this.name = 'SubprocessError';
    this.code = 'SUBPROCESS_FAILED';
    this.result = result;
    if (cause) this.cause = cause;
  }
}

export class SubprocessTimeoutError extends Error {
  constructor(message, result) {
    super(message);
    this.name = 'SubprocessTimeoutError';
    this.code = 'SUBPROCESS_TIMEOUT';
    this.result = result;
  }
}

export class SubprocessAbortError extends Error {
  constructor(message, result) {
    super(message);
    this.name = 'AbortError';
    this.code = 'ABORT_ERR';
    this.result = result;
  }
}

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const resolveMaxOutputBytes = (value) => {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_OUTPUT_BYTES;
  return Math.floor(parsed);
};

const resolveKillGraceMs = (value) => {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_KILL_GRACE_MS;
  return Math.floor(parsed);
};

const resolveExpectedExitCodes = (value) => {
  if (Array.isArray(value) && value.length) {
    const normalized = value
      .map((entry) => Math.trunc(Number(entry)))
      .filter(Number.isFinite);
    return normalized.length ? normalized : [0];
  }
  return [0];
};

const coerceOutputMode = (value) => (value === 'lines' ? 'lines' : 'string');

const coerceStdio = (value) => value ?? 'pipe';

const shouldCapture = (stdio, captureFlag, streamIndex) => {
  if (captureFlag === false) return false;
  if (captureFlag === true) return true;
  if (stdio === 'pipe') return true;
  if (Array.isArray(stdio)) return stdio[streamIndex] === 'pipe';
  return false;
};

const createCollector = ({ enabled, maxOutputBytes, encoding }) => {
  const chunks = [];
  let totalBytes = 0;
  const push = (chunk) => {
    if (!enabled) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    if (!buffer.length) return;
    chunks.push(buffer);
    totalBytes += buffer.length;
    while (totalBytes > maxOutputBytes && chunks.length) {
      const overflow = totalBytes - maxOutputBytes;
      const head = chunks[0];
      if (head.length <= overflow) {
        chunks.shift();
        totalBytes -= head.length;
      } else {
        chunks[0] = head.subarray(overflow);
        totalBytes -= overflow;
      }
    }
  };
  const toOutput = (mode) => {
    if (!enabled) return undefined;
    if (!chunks.length) return mode === 'lines' ? [] : '';
    const text = Buffer.concat(chunks).toString(encoding);
    if (mode !== 'lines') return text;
    const lines = text.split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines;
  };
  return { push, toOutput };
};

const buildResult = ({ pid, exitCode, signal, startedAt, stdout, stderr }) => ({
  pid,
  exitCode,
  signal,
  durationMs: Math.max(0, Date.now() - startedAt),
  stdout,
  stderr
});

const trimOutput = (value, maxBytes, encoding, mode) => {
  if (value == null) return mode === 'lines' ? [] : '';
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), encoding);
  if (buffer.length <= maxBytes) {
    const text = buffer.toString(encoding);
    if (mode !== 'lines') return text;
    const lines = text.split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines;
  }
  const tail = buffer.subarray(buffer.length - maxBytes);
  const text = tail.toString(encoding);
  if (mode !== 'lines') return text;
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
};

const removeTrackedSubprocess = (entryKey) => {
  const entry = trackedSubprocesses.get(entryKey);
  if (!entry) return null;
  trackedSubprocesses.delete(entryKey);
  try {
    entry.child?.off('close', entry.onClose);
  } catch {}
  return entry;
};

export const terminateTrackedSubprocesses = async ({
  reason = 'shutdown',
  force = false
} = {}) => {
  const entries = Array.from(trackedSubprocesses.keys())
    .map((entryKey) => removeTrackedSubprocess(entryKey))
    .filter(Boolean);
  if (!entries.length) {
    return {
      reason,
      tracked: 0,
      attempted: 0,
      failures: 0
    };
  }
  const settled = await Promise.allSettled(entries.map((entry) => killChildProcessTree(entry.child, {
    killTree: entry.killTree,
    killSignal: entry.killSignal,
    graceMs: force ? TRACKED_SUBPROCESS_FORCE_GRACE_MS : entry.killGraceMs,
    detached: entry.detached,
    awaitGrace: force === true
  })));
  const failures = settled.filter((result) => result.status === 'rejected').length;
  return {
    reason,
    tracked: entries.length,
    attempted: entries.length,
    failures
  };
};

const triggerTrackedSubprocessShutdown = (reason) => {
  if (trackedSubprocessShutdownTriggered) return trackedSubprocessShutdownPromise;
  trackedSubprocessShutdownTriggered = true;
  trackedSubprocessShutdownPromise = terminateTrackedSubprocesses({ reason, force: true })
    .catch(() => null);
  return trackedSubprocessShutdownPromise;
};

const forwardSignalToDefault = (signal) => {
  const normalizedSignal = typeof signal === 'string' ? signal.trim() : '';
  if (!normalizedSignal || signalForwardInFlight.has(normalizedSignal)) return;
  signalForwardInFlight.add(normalizedSignal);
  try {
    process.kill(process.pid, normalizedSignal);
  } catch {}
  setImmediate(() => {
    signalForwardInFlight.delete(normalizedSignal);
  });
};

const installTrackedSubprocessHooks = () => {
  if (trackedSubprocessHooksInstalled) return;
  trackedSubprocessHooksInstalled = true;
  process.once('exit', () => {
    triggerTrackedSubprocessShutdown('process_exit');
  });
  process.on('uncaughtExceptionMonitor', () => {
    triggerTrackedSubprocessShutdown('uncaught_exception');
  });
  for (const signal of TRACKED_SUBPROCESS_TERMINATION_SIGNALS) {
    try {
      process.once(signal, () => {
        const hasAdditionalSignalHandlers = process.listenerCount(signal) > 0;
        void triggerTrackedSubprocessShutdown(`signal_${String(signal || '').toLowerCase()}`)
          .finally(() => {
            if (!hasAdditionalSignalHandlers) {
              forwardSignalToDefault(signal);
            }
          });
      });
    } catch {}
  }
};

export const registerChildProcessForCleanup = (child, options = {}) => {
  if (!child || !child.pid) {
    return () => {};
  }
  installTrackedSubprocessHooks();
  const entryKey = Symbol(`tracked-subprocess:${child.pid}`);
  const entry = {
    child,
    killTree: options.killTree !== false,
    killSignal: options.killSignal || 'SIGTERM',
    killGraceMs: resolveKillGraceMs(options.killGraceMs),
    detached: options.detached === true,
    onClose: null
  };
  entry.onClose = () => {
    removeTrackedSubprocess(entryKey);
  };
  trackedSubprocesses.set(entryKey, entry);
  child.once('close', entry.onClose);
  return () => {
    removeTrackedSubprocess(entryKey);
  };
};

export const getTrackedSubprocessCount = () => trackedSubprocesses.size;

export function spawnSubprocess(command, args, options = {}) {
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
        detached
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

export function spawnSubprocessSync(command, args, options = {}) {
  const startedAt = Date.now();
  const stdio = coerceStdio(options.stdio);
  const encoding = options.outputEncoding || 'utf8';
  const outputMode = coerceOutputMode(options.outputMode);
  const maxOutputBytes = resolveMaxOutputBytes(options.maxOutputBytes);
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
