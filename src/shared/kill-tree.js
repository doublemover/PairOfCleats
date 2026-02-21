import { spawnSync } from 'node:child_process';

const DEFAULT_GRACE_MS = 5000;
const DEFAULT_SIGNAL = 'SIGTERM';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const toGraceMs = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_GRACE_MS;
  return Math.floor(parsed);
};

const isAlivePosix = (pid) => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'EPERM') return true;
    return false;
  }
};

const killPosixGroup = async (pid, { signal, graceMs, useProcessGroup }) => {
  const target = useProcessGroup ? -pid : pid;
  let terminated = false;
  let forced = false;
  try {
    process.kill(target, signal || DEFAULT_SIGNAL);
    terminated = true;
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
  if (graceMs > 0) {
    await wait(graceMs);
  }
  const alive = useProcessGroup ? isAlivePosix(pid) : (() => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error?.code === 'EPERM';
    }
  })();
  if (alive) {
    forced = true;
    try {
      process.kill(target, 'SIGKILL');
      terminated = true;
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
  return { terminated, forced };
};

const killWindowsTree = async (pid, { graceMs }) => {
  const baseArgs = ['/PID', String(pid), '/T'];
  let terminated = false;
  let forced = false;
  try {
    const graceful = spawnSync('taskkill', baseArgs, { stdio: 'ignore' });
    if (graceful.status === 0) {
      terminated = true;
      if (graceMs > 0) await wait(graceMs);
    }
  } catch {}
  try {
    const forcedKill = spawnSync('taskkill', [...baseArgs, '/F'], { stdio: 'ignore' });
    if (forcedKill.status === 0) {
      terminated = true;
      forced = true;
    }
  } catch {}
  return { terminated, forced };
};

export const killProcessTree = async (
  pid,
  {
    killTree = true,
    killSignal = DEFAULT_SIGNAL,
    graceMs = DEFAULT_GRACE_MS,
    detached = true
  } = {}
) => {
  const numericPid = Number(pid);
  if (!Number.isFinite(numericPid) || numericPid <= 0) {
    return { terminated: false, forced: false };
  }
  const resolvedGraceMs = toGraceMs(graceMs);
  if (process.platform === 'win32') {
    if (!killTree) {
      try {
        process.kill(numericPid);
        return { terminated: true, forced: false };
      } catch {
        return { terminated: false, forced: false };
      }
    }
    return killWindowsTree(numericPid, { graceMs: resolvedGraceMs });
  }
  const useProcessGroup = killTree !== false && detached === true;
  return killPosixGroup(numericPid, {
    signal: killSignal,
    graceMs: resolvedGraceMs,
    useProcessGroup
  });
};

export const killChildProcessTree = async (child, options = {}) => {
  if (!child || !child.pid) return { terminated: false, forced: false };
  return killProcessTree(child.pid, {
    detached: options.detached,
    killTree: options.killTree,
    killSignal: options.killSignal,
    graceMs: options.graceMs
  });
};
