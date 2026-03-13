import { spawnSync } from 'node:child_process';

export const DEFAULT_SYNC_COMMAND_TIMEOUT_MS = 5_000;

const isSyncCommandTimeoutDisabled = (value) => value === null;

const isPositivePid = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
};

export const killTimedOutSyncProcessTree = (
  pid,
  timeoutMs = DEFAULT_SYNC_COMMAND_TIMEOUT_MS,
  killTree = true,
  detached = false
) => {
  if (!isPositivePid(pid)) return false;
  const numericPid = Math.floor(Number(pid));
  const boundedTimeoutMs = resolveSyncCommandTimeoutMs(timeoutMs, DEFAULT_SYNC_COMMAND_TIMEOUT_MS);
  const terminatePosixPid = (targetPid, signal) => {
    try {
      process.kill(targetPid, signal);
      return true;
    } catch {
      return false;
    }
  };
  const parsePsPidList = (value) => (
    String(value || '')
      .split(/\r?\n/)
      .map((line) => Number.parseInt(String(line || '').trim(), 10))
      .filter((entry) => Number.isFinite(entry) && entry > 0)
      .map((entry) => Math.floor(entry))
  );
  const discoverPosixDescendantsSync = (rootPid, maxNodes = 512) => {
    if (process.platform === 'win32') return [];
    const queue = [rootPid];
    const seen = new Set([rootPid]);
    const descendants = [];
    while (queue.length > 0 && descendants.length < maxNodes) {
      const currentPid = queue.shift();
      const psResult = spawnSync('ps', ['-o', 'pid=', '--ppid', String(currentPid)], {
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
        timeout: boundedTimeoutMs
      });
      if (Number(psResult?.status) !== 0) continue;
      for (const childPid of parsePsPidList(psResult.stdout)) {
        if (seen.has(childPid)) continue;
        seen.add(childPid);
        descendants.push(childPid);
        queue.push(childPid);
      }
    }
    return descendants;
  };
  try {
    if (process.platform === 'win32') {
      const taskkillResult = spawnSync('taskkill', ['/PID', String(numericPid), '/T', '/F'], {
        stdio: 'ignore',
        timeout: boundedTimeoutMs
      });
      return taskkillResult?.status === 0;
    }
    const descendants = killTree ? discoverPosixDescendantsSync(numericPid) : [];
    const fallbackTargets = descendants.slice().reverse();
    if (killTree && detached) {
      try {
        process.kill(-numericPid, 'SIGTERM');
      } catch {}
    }
    for (const childPid of fallbackTargets) {
      terminatePosixPid(childPid, 'SIGTERM');
    }
    terminatePosixPid(numericPid, 'SIGTERM');
    if (killTree && detached) {
      try {
        process.kill(-numericPid, 'SIGKILL');
      } catch {}
    }
    for (const childPid of fallbackTargets) {
      terminatePosixPid(childPid, 'SIGKILL');
    }
    return terminatePosixPid(numericPid, 'SIGKILL');
  } catch {}
  return false;
};

export const resolveSyncCommandTimeoutMs = (value, fallback = DEFAULT_SYNC_COMMAND_TIMEOUT_MS) => {
  if (isSyncCommandTimeoutDisabled(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return Math.max(1, Math.floor(Number(fallback) || DEFAULT_SYNC_COMMAND_TIMEOUT_MS));
  }
  return Math.max(1, Math.floor(parsed));
};

export const runSyncCommandWithTimeout = (command, args = [], options = {}) => {
  const {
    timeoutMs: rawTimeoutMs,
    killTree = true,
    detached = false,
    ...spawnOptions
  } = options || {};
  const timeoutMs = resolveSyncCommandTimeoutMs(rawTimeoutMs, DEFAULT_SYNC_COMMAND_TIMEOUT_MS);
  try {
    const result = spawnSync(command, Array.isArray(args) ? args : [], {
      ...spawnOptions,
      timeout: timeoutMs === null ? undefined : timeoutMs
    });
    if (isSyncCommandTimedOut(result)) {
      killTimedOutSyncProcessTree(
        result?.pid,
        timeoutMs,
        killTree !== false,
        detached === true
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
