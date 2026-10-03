import { DEFAULT_GRACE_MS, DEFAULT_SIGNAL, toGraceMs } from './kill-tree/shared.js';
import { killPosixGroup, killPosixGroupSync } from './kill-tree/posix.js';
import { killWindowsTree, killWindowsTreeSync } from './kill-tree/windows.js';

export const killProcessTree = async (
  pid,
  {
    killTree = true,
    killSignal = DEFAULT_SIGNAL,
    graceMs = DEFAULT_GRACE_MS,
    detached = true,
    awaitGrace = true
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
    return killWindowsTree(numericPid, { graceMs: resolvedGraceMs, awaitGrace });
  }
  const useProcessGroup = killTree !== false && detached === true;
  return killPosixGroup(numericPid, {
    signal: killSignal,
    graceMs: resolvedGraceMs,
    useProcessGroup,
    killTreeRequested: killTree !== false,
    awaitGrace
  });
};

export const killProcessTreeSync = (
  pid,
  {
    killTree = true,
    killSignal = DEFAULT_SIGNAL,
    detached = true
  } = {}
) => {
  const numericPid = Number(pid);
  if (!Number.isFinite(numericPid) || numericPid <= 0) {
    return { terminated: false, forced: false };
  }
  if (process.platform === 'win32') {
    if (!killTree) {
      try {
        process.kill(numericPid);
        return { terminated: true, forced: false };
      } catch {
        return { terminated: false, forced: false };
      }
    }
    return killWindowsTreeSync(numericPid);
  }
  const useProcessGroup = killTree !== false && detached === true;
  return killPosixGroupSync(numericPid, {
    signal: killSignal,
    useProcessGroup,
    killTreeRequested: killTree !== false
  });
};

export const killChildProcessTree = async (child, options = {}) => {
  if (!child || !child.pid) return { terminated: false, forced: false };
  return killProcessTree(child.pid, {
    detached: options.detached,
    killTree: options.killTree,
    killSignal: options.killSignal,
    graceMs: options.graceMs,
    awaitGrace: options.awaitGrace
  });
};

export const killChildProcessTreeSync = (child, options = {}) => {
  if (!child || !child.pid) return { terminated: false, forced: false };
  return killProcessTreeSync(child.pid, {
    detached: options.detached,
    killTree: options.killTree,
    killSignal: options.killSignal
  });
};
