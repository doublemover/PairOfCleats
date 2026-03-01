import { spawnSync } from 'node:child_process';

export const DEFAULT_SYNC_COMMAND_TIMEOUT_MS = 2_000;

const isPositivePid = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
};

export const killTimedOutSyncProcessTree = (
  pid,
  timeoutMs = DEFAULT_SYNC_COMMAND_TIMEOUT_MS,
  killTree = true,
  detached = process.platform !== 'win32'
) => {
  if (!isPositivePid(pid)) return false;
  const numericPid = Math.floor(Number(pid));
  const boundedTimeoutMs = resolveSyncCommandTimeoutMs(timeoutMs, DEFAULT_SYNC_COMMAND_TIMEOUT_MS);
  try {
    if (process.platform === 'win32') {
      const taskkillResult = spawnSync('taskkill', ['/PID', String(numericPid), '/T', '/F'], {
        stdio: 'ignore',
        timeout: boundedTimeoutMs
      });
      return taskkillResult?.status === 0;
    }
    if (killTree && detached) {
      try {
        process.kill(-numericPid, 'SIGTERM');
      } catch {}
    }
    process.kill(numericPid, 'SIGTERM');
  } catch {}
  try {
    if (killTree && detached) {
      try {
        process.kill(-numericPid, 'SIGKILL');
      } catch {}
    }
    process.kill(numericPid, 'SIGKILL');
    return true;
  } catch {}
  return false;
};

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
    const result = spawnSync(command, Array.isArray(args) ? args : [], {
      cwd: options.cwd,
      env: options.env,
      stdio: options.stdio,
      shell: options.shell,
      input: options.input,
      maxBuffer: options.maxBuffer,
      encoding: options.encoding,
      timeout: timeoutMs
    });
    if (isSyncCommandTimedOut(result)) {
      killTimedOutSyncProcessTree(
        result?.pid,
        timeoutMs,
        options.killTree !== false,
        options.detached === true
      );
    }
    return result;
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
