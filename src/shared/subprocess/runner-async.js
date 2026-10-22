import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
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

const awaitBoundedClose = async (promise, waitTimeoutMs) => {
  const boundedMs = resolveTimeoutAbortReapWaitMs(waitTimeoutMs);
  if (boundedMs <= 0) return;
  let timer;
  try {
    await Promise.race([promise, new Promise(resolve => { timer = setTimeout(resolve, boundedMs); })]);
  } finally { clearTimeout(timer); }
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
  closed,
  wasCloseObserved,
  reject
}) => async (createError) => {
  try {
    if (typeof child.unref === 'function') child.unref();
  } catch {}
  let treeCleanupResult = null, treeCleanupError = null;
  const treeCleanup = killChildProcessTree(child, {
    killTree,
    killSignal,
    graceMs: timeoutAbortKillGraceMs,
    detached,
    awaitGrace: true
  }).then(result => { treeCleanupResult = result; }, error => { treeCleanupError = error; });
  cleanup({ keepTrackedRegistration: true });
  // A parent can close while a descendant is still inside its configured
  // termination grace. Keep the caller's capacity lease until the existing
  // tree owner has finished escalation, as well as observing bounded close.
  await Promise.all([treeCleanup, awaitBoundedClose(closed, timeoutAbortReapWaitMs)]);
  const result = buildResult({
    pid: child.pid,
    exitCode: null,
    signal: null,
    startedAt,
    stdout: stdoutCollector.toOutput(outputMode),
    stderr: stderrCollector.toOutput(outputMode),
    outputCapture: { stdout: stdoutCollector.stats(), stderr: stderrCollector.stats() }
  });
  const closeObserved = wasCloseObserved();
  result.termination = { scope: 'spawned-child-close-only', method: 'child-close-event',
    closeObserved, closeTimedOut: !closeObserved, waitMs: timeoutAbortReapWaitMs,
    treeCleanupSettled: true, treeCleanupFailed: treeCleanupError !== null,
    treeCleanupForced: treeCleanupResult?.forced ?? null };
  const error = createError(result);
  if (!closeObserved || treeCleanupError) {
    error.cacheOwnershipPending = true;
    // This closure belongs to this exact spawned handle. A delayed actual close
    // may reconcile missing-close evidence; a rejected tree cleanup cannot.
    Object.defineProperty(error, 'cacheOwnershipReleased', { value: () => wasCloseObserved() && !treeCleanupError });
  }
  reject(error);
};

/**
 * Spawn one owned executable with bounded capture and exact child-close evidence.
 * Cancellation rejection can retain cleanup ownership: callers must preserve
 * their leases while cacheOwnershipPending is true. Direct-child close never
 * establishes arbitrary descendant quiescence. Callback hooks are synchronous.
 *
 * @param {string} command Executable, not shell text.
 * @param {string[]} args
 * @param {import('./types.js').SpawnSubprocessOptions} [options]
 * @returns {Promise<import('./types.js').SubprocessResult>}
 * @see docs/contracts/subprocess.md
 */
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
    const onStdout = typeof options.onStdout === 'function' ? options.onStdout : null;
    const onStderr = typeof options.onStderr === 'function' ? options.onStderr : null;
    // Construct before spawning so an invalid decoder encoding cannot leak a child.
    const stdoutDecoder = onStdout ? new StringDecoder(encoding) : null;
    const stderrDecoder = onStderr ? new StringDecoder(encoding) : null;
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
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio,
      shell: false,
      detached,
      windowsVerbatimArguments: options.windowsVerbatimArguments === true
    });
    let closeObserved = false, stdinErrorHandler = null;
    const closed = new Promise(resolve => child.once('close', () => {
      closeObserved = true;
      if (stdinErrorHandler && child.stdin) child.stdin.off('error', stdinErrorHandler);
      resolve();
    }));
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
    if (options.unref === true) {
      child.unref();
    }
    let settled = false;
    let timeoutId = null;
    let abortHandler = null;
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
        stderr: stderrCollector.toOutput(outputMode),
        outputCapture: { stdout: stdoutCollector.stats(), stderr: stderrCollector.stats() }
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
      closed,
      wasCloseObserved: () => closeObserved,
      reject
    });
    const failOwnedOperation = (message, error) => {
      if (settled) return;
      settled = true;
      void terminateAndReject(result => new SubprocessError(message, result, error));
    };
    const onOutputHandlerError = (streamName, error) => {
      if (settled) return;
      settled = true;
      void terminateAndReject((result) => new SubprocessError(
        `Subprocess ${streamName} callback failed`,
        result,
        error
      ));
    };
    const handleOutput = (collector, handler, decoder, streamName) => (chunk) => {
      if (settled) return;
      collector.push(chunk);
      if (!handler) return;
      try {
        const text = decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
        if (text) handler(text);
      } catch (error) {
        onOutputHandlerError(streamName, error);
      }
    };
    const flushOutput = (decoder, handler, streamName) => {
      if (!decoder || settled) return;
      try {
        const text = decoder.end();
        if (text) handler(text);
      } catch (error) { onOutputHandlerError(streamName, error); }
    };
    onStdoutData = captureStdout || onStdout
      ? handleOutput(stdoutCollector, onStdout, stdoutDecoder, 'stdout')
      : null;
    onStderrData = captureStderr || onStderr
      ? handleOutput(stderrCollector, onStderr, stderrDecoder, 'stderr')
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
      // `error` can occur after a successful spawn. It never substitutes for
      // the exact child's close or releases its cleanup registration early.
      failOwnedOperation(err?.message || 'Subprocess failed', err);
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      flushOutput(stdoutDecoder, onStdout, 'stdout');
      flushOutput(stderrDecoder, onStderr, 'stderr');
      if (settled) return;
      settled = true;
      cleanup();
      finalize(code, signal);
    });
    stdinErrorHandler = error => failOwnedOperation('Subprocess stdin failed', error);
    if (child.stdin) child.stdin.on('error', stdinErrorHandler);
    // All owners/listeners exist before caller hooks or input can fail/cancel.
    if (typeof options.onSpawn === 'function') {
      try { options.onSpawn(child); }
      catch (error) { failOwnedOperation('Subprocess onSpawn callback failed', error); }
    }
    if (abortSignal?.aborted) abortHandler();
    if (!settled && options.input != null && child.stdin) {
      try { child.stdin.end(options.input); }
      catch (error) { failOwnedOperation('Subprocess stdin failed', error); }
    }
  });
}
