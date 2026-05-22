import { spawn } from 'node:child_process';
import { killChildProcessTree } from '../kill-tree.js';
import { isAbortSignal } from '../abort.js';
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
  buildResult
} from './options.js';
import {
  trackedOwnershipIdByAbortSignal,
  trackedSubprocessScopeContext,
  normalizeTrackedOwnershipId,
  normalizeTrackedScope
} from './tracking-runtime.js';
import {
  registerChildProcessForCleanup
} from './tracking-register.js';
import {
  SubprocessAbortError,
  SubprocessError,
  SubprocessTimeoutError
} from './errors.js';

const DEFAULT_TIMEOUT_ABORT_REAP_WAIT_MS = 500;

const resolveTimeoutAbortReapWaitMs = (value) => {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_TIMEOUT_ABORT_REAP_WAIT_MS;
  return Math.max(0, Math.floor(parsed));
};

const waitMs = (ms) => new Promise((resolve) => {
  setTimeout(resolve, Math.max(1, Math.floor(ms)));
});

const awaitBoundedReap = async (promise, waitTimeoutMs) => {
  if (!promise || typeof promise.then !== 'function') return;
  const boundedMs = resolveTimeoutAbortReapWaitMs(waitTimeoutMs);
  if (boundedMs <= 0) {
    await promise.catch(() => {});
    return;
  }
  const boundedWait = waitMs(boundedMs);
  await Promise.race([
    promise.catch(() => {}),
    boundedWait
  ]);
  await boundedWait;
};

const resolveCleanupScope = (options, abortSignal) => {
  const trackedScopeContext = trackedSubprocessScopeContext.getStore() || null;
  const inheritedOwnershipId = normalizeTrackedOwnershipId(options.ownershipId ?? options.ownerId)
    || normalizeTrackedOwnershipId(trackedOwnershipIdByAbortSignal.get(abortSignal))
    || normalizeTrackedOwnershipId(trackedScopeContext?.ownershipId ?? trackedScopeContext?.scope);
  const cleanupScope = normalizeTrackedScope(options.cleanupScope)
    || normalizeTrackedScope(options.scope)
    || inheritedOwnershipId;
  return {
    cleanupScope,
    inheritedOwnershipId
  };
};

const terminateAndRejectFactory = ({
  child,
  cleanup,
  killTree,
  killSignal,
  timeoutAbortKillGraceMs,
  detached,
  timeoutAbortReapWaitMs,
  startedAt,
  stdoutCollector,
  stderrCollector,
  outputMode,
  reject
}) => async (createError) => {
  try {
    if (typeof child.unref === 'function') child.unref();
  } catch {}
  const killPromise = killChildProcessTree(child, {
    killTree,
    killSignal,
    graceMs: timeoutAbortKillGraceMs,
    detached,
    awaitGrace: true
  });
  cleanup({ keepTrackedRegistration: true });
  await awaitBoundedReap(killPromise, timeoutAbortReapWaitMs);
  const result = buildResult({
    pid: child.pid,
    exitCode: null,
    signal: null,
    startedAt,
    stdout: stdoutCollector.toOutput(outputMode),
    stderr: stderrCollector.toOutput(outputMode)
  });
  reject(createError(result));
};

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
    const timeoutAbortKillGraceMs = options.killGraceMs == null ? 0 : killGraceMs;
    const timeoutAbortReapWaitMs = resolveTimeoutAbortReapWaitMs(
      options.timeoutAbortReapWaitMs
        ?? (timeoutAbortKillGraceMs + 500)
    );
    const cleanupOnParentExit = typeof options.cleanupOnParentExit === 'boolean'
      ? options.cleanupOnParentExit
      : !(options.unref === true && detached === true);
    const abortSignal = isAbortSignal(options.signal) ? options.signal : null;
    if (options.signal != null && !abortSignal) {
      const result = buildResult({
        pid: null,
        exitCode: null,
        signal: null,
        startedAt,
        stdout: undefined,
        stderr: undefined
      });
      reject(new SubprocessError('Invalid AbortSignal passed to spawnSubprocess.', result));
      return;
    }
    const { cleanupScope, inheritedOwnershipId } = resolveCleanupScope(options, abortSignal);
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
    let onStdoutData = null;
    let onStderrData = null;
    const cleanup = ({ keepTrackedRegistration = false } = {}) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (abortHandler && abortSignal) {
        abortSignal.removeEventListener('abort', abortHandler);
      }
      if (!keepTrackedRegistration) {
        unregisterTrackedChild();
      }
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
    const terminateAndReject = terminateAndRejectFactory({
      child,
      cleanup,
      killTree,
      killSignal,
      timeoutAbortKillGraceMs,
      detached,
      timeoutAbortReapWaitMs,
      startedAt,
      stdoutCollector,
      stderrCollector,
      outputMode,
      reject
    });
    const onOutputHandlerError = (streamName, error) => {
      if (settled) return;
      settled = true;
      void terminateAndReject((result) => new SubprocessError(
        `Subprocess ${streamName} callback failed`,
        result,
        error
      ));
    };
    const handleOutput = (collector, handler, streamName) => (chunk) => {
      if (settled) return;
      collector.push(chunk);
      if (!handler) return;
      const text = Buffer.isBuffer(chunk) ? chunk.toString(encoding) : String(chunk);
      try {
        handler(text);
      } catch (error) {
        onOutputHandlerError(streamName, error);
      }
    };
    onStdoutData = captureStdout || onStdout
      ? handleOutput(stdoutCollector, onStdout, 'stdout')
      : null;
    onStderrData = captureStderr || onStderr
      ? handleOutput(stderrCollector, onStderr, 'stderr')
      : null;
    if (onStdoutData && child.stdout) {
      child.stdout.on('data', onStdoutData);
    }
    if (onStderrData && child.stderr) {
      child.stderr.on('data', onStderrData);
    }
    const resolvedTimeoutMs = toNumber(options.timeoutMs);
    if (Number.isFinite(resolvedTimeoutMs) && resolvedTimeoutMs > 0) {
      timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        void terminateAndReject((result) => new SubprocessTimeoutError('Subprocess timeout', result));
      }, Math.max(1, resolvedTimeoutMs));
    }
    abortHandler = () => {
      if (settled) return;
      settled = true;
      void terminateAndReject((result) => new SubprocessAbortError('Operation aborted', result));
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
