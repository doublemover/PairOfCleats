import { runSyncCommandWithTimeout, toSyncCommandExitCode } from '../subprocess/sync-command.js';
import { DEFAULT_SIGNAL, scheduleUnrefTimer, wait } from './shared.js';

const isAlivePosix = (pid) => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'EPERM') return true;
    return false;
  }
};

const isAliveSinglePosix = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
};

const isIgnorablePosixKillError = (error) => (
  error?.code === 'ESRCH'
  || error?.code === 'EPERM'
);

const tryKillPosix = (targetPid, signal) => {
  try {
    process.kill(targetPid, signal);
    return true;
  } catch (error) {
    if (isIgnorablePosixKillError(error)) {
      return false;
    }
    throw error;
  }
};

const parsePosixPidList = (value) => (
  String(value || '')
    .split(/\r?\n/)
    .map((line) => Number.parseInt(String(line || '').trim(), 10))
    .filter((entry) => Number.isFinite(entry) && entry > 0)
    .map((entry) => Math.floor(entry))
);

const discoverPosixDescendantPidsSync = (rootPid, {
  maxNodes = 512,
  timeoutMs = 1000
} = {}) => {
  if (process.platform === 'win32') return [];
  const queue = [rootPid];
  const seen = new Set([rootPid]);
  const descendants = [];
  while (queue.length > 0 && descendants.length < maxNodes) {
    const currentPid = queue.shift();
    const result = runSyncCommandWithTimeout(
      'ps',
      ['-o', 'pid=', '--ppid', String(currentPid)],
      {
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
        timeoutMs
      }
    );
    if (toSyncCommandExitCode(result) !== 0) continue;
    for (const childPid of parsePosixPidList(result.stdout)) {
      if (seen.has(childPid)) continue;
      seen.add(childPid);
      descendants.push(childPid);
      queue.push(childPid);
    }
  }
  return descendants;
};

const killPosixPidQuiet = (pid, signal) => {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
};

const isAnyPosixPidAlive = (pids) => (
  Array.isArray(pids) && pids.some((pid) => isAliveSinglePosix(pid))
);

const killPosixPidList = (pids, signal) => {
  if (!Array.isArray(pids) || !pids.length) return false;
  let signaled = false;
  for (const pid of pids) {
    if (!Number.isFinite(Number(pid)) || Number(pid) <= 0) continue;
    signaled = killPosixPidQuiet(Math.floor(Number(pid)), signal) || signaled;
  }
  return signaled;
};

export const killPosixGroup = async (pid, {
  signal,
  graceMs,
  useProcessGroup,
  killTreeRequested = false,
  awaitGrace = true
}) => {
  const target = useProcessGroup ? -pid : pid;
  const fallbackDescendants = killTreeRequested
    ? discoverPosixDescendantPidsSync(pid)
    : [];
  const fallbackTargets = fallbackDescendants.slice().reverse();
  let terminated = false;
  let forced = false;
  if (killTreeRequested) {
    terminated = killPosixPidList(fallbackTargets, signal || DEFAULT_SIGNAL) || terminated;
  }
  if (tryKillPosix(target, signal || DEFAULT_SIGNAL)) {
    terminated = true;
  } else if (useProcessGroup && tryKillPosix(pid, signal || DEFAULT_SIGNAL)) {
    terminated = true;
  }
  if (graceMs > 0 && awaitGrace) {
    await wait(graceMs, { unrefTimer: false });
  }
  if (!awaitGrace) {
    if (graceMs > 0) {
      scheduleUnrefTimer(graceMs, () => {
        const aliveLater = useProcessGroup ? isAlivePosix(pid) : isAliveSinglePosix(pid);
        const fallbackAlive = killTreeRequested && isAnyPosixPidAlive(fallbackDescendants);
        if (!aliveLater && !fallbackAlive) return;
        if (killTreeRequested) {
          killPosixPidList(fallbackTargets, 'SIGKILL');
        }
        if (!tryKillPosix(target, 'SIGKILL') && useProcessGroup) {
          tryKillPosix(pid, 'SIGKILL');
        }
      });
      return { terminated, forced: false };
    }
    const aliveNow = useProcessGroup ? isAlivePosix(pid) : isAliveSinglePosix(pid);
    const fallbackAlive = killTreeRequested && isAnyPosixPidAlive(fallbackDescendants);
    if (aliveNow || fallbackAlive) {
      forced = true;
      if (killTreeRequested) {
        terminated = killPosixPidList(fallbackTargets, 'SIGKILL') || terminated;
      }
      if (tryKillPosix(target, 'SIGKILL') || (useProcessGroup && tryKillPosix(pid, 'SIGKILL'))) {
        terminated = true;
      }
    }
    return { terminated, forced };
  }
  const alive = useProcessGroup ? isAlivePosix(pid) : isAliveSinglePosix(pid);
  const fallbackAlive = killTreeRequested && isAnyPosixPidAlive(fallbackDescendants);
  if (alive || fallbackAlive) {
    forced = true;
    if (killTreeRequested) {
      terminated = killPosixPidList(fallbackTargets, 'SIGKILL') || terminated;
    }
    if (tryKillPosix(target, 'SIGKILL') || (useProcessGroup && tryKillPosix(pid, 'SIGKILL'))) {
      terminated = true;
    }
  }
  return { terminated, forced };
};

export const killPosixGroupSync = (pid, {
  signal,
  useProcessGroup,
  killTreeRequested = false
}) => {
  const target = useProcessGroup ? -pid : pid;
  const fallbackDescendants = killTreeRequested
    ? discoverPosixDescendantPidsSync(pid)
    : [];
  const fallbackTargets = fallbackDescendants.slice().reverse();
  let terminated = false;
  let forced = false;
  if (killTreeRequested) {
    terminated = killPosixPidList(fallbackTargets, signal || DEFAULT_SIGNAL) || terminated;
  }
  if (tryKillPosix(target, signal || DEFAULT_SIGNAL)) {
    terminated = true;
  } else if (useProcessGroup && tryKillPosix(pid, signal || DEFAULT_SIGNAL)) {
    terminated = true;
  }
  const alive = useProcessGroup ? isAlivePosix(pid) : isAliveSinglePosix(pid);
  const fallbackAlive = killTreeRequested && isAnyPosixPidAlive(fallbackDescendants);
  if (alive || fallbackAlive) {
    forced = true;
    if (killTreeRequested) {
      terminated = killPosixPidList(fallbackTargets, 'SIGKILL') || terminated;
    }
    if (tryKillPosix(target, 'SIGKILL') || (useProcessGroup && tryKillPosix(pid, 'SIGKILL'))) {
      terminated = true;
    }
  }
  return { terminated, forced };
};
