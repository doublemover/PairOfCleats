import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { registerChildProcessForCleanup } from '../../src/shared/subprocess/tracking.js';
import { killChildProcessTree } from '../../src/shared/kill-tree.js';
import { resolveCommandInvocation } from '../../src/shared/subprocess/command-invocation.js';

const toTimeoutMs = (value, fallback = null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1_000, Math.floor(parsed));
};

export const runLineStreamingCommand = async ({
  command,
  args = [],
  cwd = undefined,
  timeoutMs = null,
  onStdoutLine = null,
  onStderrChunk = null,
  env = process.env,
  inputStream = null,
  onSpawn = null,
  onSettlement = null
}) => {
  const detached = process.platform !== 'win32';
  const invocation = resolveCommandInvocation(command, Array.isArray(args) ? args : [], env);
  const child = spawn(invocation.command, invocation.args, {
    cwd,
    env: invocation.env ? { ...env, ...invocation.env } : env,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    detached,
    stdio: [inputStream ? 'pipe' : 'ignore', 'pipe', 'pipe']
  });
  let rl;
  let childClosed = false;
  // Capture terminal events immediately. A slow line consumer can otherwise
  // finish after close/error has fired and wait forever for a second event.
  const terminal = new Promise((resolve) => {
    child.once('error', (error) => { rl?.close(); resolve({ error }); });
    child.once('close', (exitCode, signal) => { childClosed = true; resolve({ exitCode, signal }); });
  });
  const unregisterChild = registerChildProcessForCleanup(child, {
    killTree: true,
    detached
  });
  let termination = null, treeCleanupSettled = false, treeCleanupFailed = false;
  const terminate = () => {
    termination ||= killChildProcessTree(child, {
      killTree: true, detached, graceMs: 0, awaitGrace: false
    }).then(() => { treeCleanupSettled = true; }, () => { treeCleanupSettled = true; treeCleanupFailed = true; });
    return termination;
  };
  const resolvedTimeoutMs = toTimeoutMs(timeoutMs);
  let timedOut = false;
  const timeout = Number.isFinite(resolvedTimeoutMs) && resolvedTimeoutMs > 0
    ? setTimeout(() => {
      timedOut = true;
      void terminate();
    }, resolvedTimeoutMs)
    : null;
  timeout?.unref?.();
  rl = readline.createInterface({
    input: child.stdout,
    crlfDelay: Infinity
  });

  let streamError = null;
  const onStdoutError = (error) => {
    streamError = error || new Error('stdout stream failed');
    rl.close();
    void terminate();
  };
  child.stdout.once('error', onStdoutError);
  const onStderrData = (chunk) => {
    if (typeof onStderrChunk !== 'function' || streamError) return;
    try { onStderrChunk(chunk); }
    catch (error) { streamError = error; rl.close(); void terminate(); }
  };
  child.stderr.on('data', onStderrData);
  const onInputError = error => { streamError = error; rl.close(); void terminate(); };
  child.stdin?.once('error', onInputError);
  inputStream?.once('error', onInputError);

  try {
    onSpawn?.(child);
    inputStream?.pipe(child.stdin);
    for await (const line of rl) {
      if (typeof onStdoutLine === 'function') {
        await onStdoutLine(line);
      }
    }
    const outcome = await terminal;
    if (streamError) throw streamError;
    if (outcome.error) throw outcome.error;
    if (timedOut) {
      const err = new Error(`Command timed out after ${resolvedTimeoutMs}ms: ${command}`);
      err.code = 'ERR_INGEST_COMMAND_TIMEOUT';
      err.timeoutMs = resolvedTimeoutMs;
      throw err;
    }
    if (outcome.signal) {
      const err = new Error(`${command} exited with signal ${outcome.signal}`);
      err.code = 'ERR_INGEST_COMMAND_SIGNAL';
      err.signal = outcome.signal;
      throw err;
    }
    const { exitCode } = outcome;
    if (exitCode !== 0) {
      const err = new Error(`${command} exited with code ${exitCode}`);
      err.code = 'ERR_INGEST_COMMAND_EXIT';
      err.exitCode = exitCode;
      throw err;
    }
    return { exitCode };
  } finally {
    if (timeout) clearTimeout(timeout);
    child.stderr.off('data', onStderrData);
    inputStream?.unpipe(child.stdin);
    inputStream?.off('error', onInputError);
    rl.close();
    await terminate();
    let reapTimer;
    try {
      await Promise.race([terminal, new Promise(resolve => { reapTimer = setTimeout(resolve, 1000); })]);
    } finally { clearTimeout(reapTimer); }
    // If bounded reaping is still pending, retain process-exit ownership until
    // the tracking layer observes close rather than abandoning a live child.
    if (childClosed || !child.pid) unregisterChild();
    const detachErrors = () => { child.stdout.off('error', onStdoutError); child.stdin?.off('error', onInputError); };
    if (childClosed || !child.pid) detachErrors();
    else child.once('close', detachErrors);
    onSettlement?.({ closeObserved: childClosed || !child.pid, treeCleanupSettled, treeCleanupFailed,
      isSettled: () => (childClosed || !child.pid) && treeCleanupSettled && !treeCleanupFailed });
  }
};
