import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { registerChildProcessForCleanup } from '../../src/shared/subprocess.js';
import { killChildProcessTree } from '../../src/shared/kill-tree.js';

const DEFAULT_INGEST_COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

const toTimeoutMs = (value, fallback = DEFAULT_INGEST_COMMAND_TIMEOUT_MS) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1_000, Math.floor(parsed));
};

export const runLineStreamingCommand = async ({
  command,
  args = [],
  cwd = undefined,
  timeoutMs = DEFAULT_INGEST_COMMAND_TIMEOUT_MS,
  onStdoutLine = null,
  onStderrChunk = null
}) => {
  const child = spawn(command, Array.isArray(args) ? args : [], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const unregisterChild = registerChildProcessForCleanup(child, {
    killTree: true,
    detached: false
  });
  const resolvedTimeoutMs = toTimeoutMs(timeoutMs);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    killChildProcessTree(child, {
      killTree: true,
      detached: false,
      graceMs: 0,
      awaitGrace: false
    }).catch(() => {});
  }, resolvedTimeoutMs);
  timeout.unref?.();
  const rl = readline.createInterface({
    input: child.stdout,
    crlfDelay: Infinity
  });

  let streamError = null;
  const onStdoutError = (error) => {
    streamError = error || new Error('stdout stream failed');
    rl.close();
  };
  child.stdout.once('error', onStdoutError);
  if (typeof onStderrChunk === 'function') {
    child.stderr.on('data', (chunk) => {
      onStderrChunk(chunk);
    });
  }

  try {
    for await (const line of rl) {
      if (typeof onStdoutLine === 'function') {
        await onStdoutLine(line);
      }
    }
    const exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolve(code ?? 0));
    });
    if (streamError) throw streamError;
    if (timedOut) {
      const err = new Error(`Command timed out after ${resolvedTimeoutMs}ms: ${command}`);
      err.code = 'ERR_INGEST_COMMAND_TIMEOUT';
      err.timeoutMs = resolvedTimeoutMs;
      throw err;
    }
    if (exitCode !== 0) {
      const err = new Error(`${command} exited with code ${exitCode}`);
      err.code = 'ERR_INGEST_COMMAND_EXIT';
      err.exitCode = exitCode;
      throw err;
    }
    return { exitCode };
  } finally {
    clearTimeout(timeout);
    child.stdout.off('error', onStdoutError);
    rl.close();
    unregisterChild();
  }
};

