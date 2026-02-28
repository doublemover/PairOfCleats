import { spawnSync } from 'node:child_process';

export const DEFAULT_SYNC_COMMAND_TIMEOUT_MS = 2_000;

export const resolveSyncCommandTimeoutMs = (value, fallback = DEFAULT_SYNC_COMMAND_TIMEOUT_MS) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return Math.max(1, Math.floor(Number(fallback) || DEFAULT_SYNC_COMMAND_TIMEOUT_MS));
  }
  return Math.max(1, Math.floor(parsed));
};

export const runSyncCommandWithTimeout = (command, args = [], options = {}) => {
  const timeoutMs = resolveSyncCommandTimeoutMs(options.timeoutMs, DEFAULT_SYNC_COMMAND_TIMEOUT_MS);
  try {
    return spawnSync(command, Array.isArray(args) ? args : [], {
      cwd: options.cwd,
      env: options.env,
      stdio: options.stdio,
      shell: options.shell,
      input: options.input,
      maxBuffer: options.maxBuffer,
      encoding: options.encoding,
      timeout: timeoutMs
    });
  } catch (error) {
    return {
      pid: null,
      status: null,
      signal: null,
      stdout: '',
      stderr: '',
      error
    };
  }
};

export const isSyncCommandTimedOut = (result) => (
  String(result?.error?.code || '').trim().toUpperCase() === 'ETIMEDOUT'
);

export const toSyncCommandExitCode = (result) => {
  const status = result?.status;
  if (typeof status !== 'number') return null;
  return Number.isFinite(status) ? status : null;
};
