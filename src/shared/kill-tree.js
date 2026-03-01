import { runSyncCommandWithTimeout, toSyncCommandExitCode } from './subprocess/sync-command.js';

const DEFAULT_GRACE_MS = 5000;
const DEFAULT_SIGNAL = 'SIGTERM';
const DEFAULT_WINDOWS_TASKKILL_TIMEOUT_MS = 2000;
const WINDOWS_DESCENDANT_DISCOVERY_TIMEOUT_MS = 2000;
const WINDOWS_DESCENDANT_KILL_LIMIT = 256;

const wait = (ms, { unrefTimer = true } = {}) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  if (unrefTimer && typeof timer.unref === 'function') {
    timer.unref();
  }
});

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

const scheduleUnrefTimer = (ms, fn) => {
  const timer = setTimeout(() => {
    try {
      fn();
    } catch {}
  }, ms);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  return timer;
};

const killPosixGroup = async (pid, {
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
    // Some POSIX hosts reject group signaling for short-lived detached children.
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

const killPosixGroupSync = (pid, {
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

const killWindowsTree = async (pid, { graceMs, awaitGrace = true }) => {
  const baseArgs = ['/PID', String(pid), '/T'];
  let terminated = false;
  let forced = false;
  let fallbackAttempted = false;
  let fallbackTerminated = 0;
  try {
    const graceful = runSyncCommandWithTimeout('taskkill', baseArgs, {
      stdio: 'ignore',
      timeoutMs: DEFAULT_WINDOWS_TASKKILL_TIMEOUT_MS
    });
    if (toSyncCommandExitCode(graceful) === 0) {
      terminated = true;
      if (graceMs > 0 && awaitGrace) await wait(graceMs, { unrefTimer: false });
    }
  } catch {}
  if (!awaitGrace) {
    if (graceMs > 0) {
      scheduleUnrefTimer(graceMs, () => {
        runSyncCommandWithTimeout('taskkill', [...baseArgs, '/F'], {
          stdio: 'ignore',
          timeoutMs: DEFAULT_WINDOWS_TASKKILL_TIMEOUT_MS
        });
      });
      return { terminated, forced: false, fallbackAttempted, fallbackTerminated };
    }
    try {
      const forcedKill = runSyncCommandWithTimeout('taskkill', [...baseArgs, '/F'], {
        stdio: 'ignore',
        timeoutMs: DEFAULT_WINDOWS_TASKKILL_TIMEOUT_MS
      });
      if (toSyncCommandExitCode(forcedKill) === 0) {
        terminated = true;
        forced = true;
      }
    } catch {}
    return { terminated, forced, fallbackAttempted, fallbackTerminated };
  }
  try {
    const forcedKill = runSyncCommandWithTimeout('taskkill', [...baseArgs, '/F'], {
      stdio: 'ignore',
      timeoutMs: DEFAULT_WINDOWS_TASKKILL_TIMEOUT_MS
    });
    if (toSyncCommandExitCode(forcedKill) === 0) {
      terminated = true;
      forced = true;
    }
  } catch {}
  if (!terminated) {
    const fallback = killWindowsOrphanDescendantsSync(pid);
    fallbackAttempted = fallback.attempted;
    fallbackTerminated = fallback.terminatedCount;
    if (fallback.terminatedCount > 0) {
      terminated = true;
      forced = true;
    }
  }
  return { terminated, forced, fallbackAttempted, fallbackTerminated };
};

const killWindowsTreeSync = (pid) => {
  const baseArgs = ['/PID', String(pid), '/T'];
  let terminated = false;
  let forced = false;
  let fallbackAttempted = false;
  let fallbackTerminated = 0;
  try {
    const graceful = runSyncCommandWithTimeout('taskkill', baseArgs, {
      stdio: 'ignore',
      timeoutMs: DEFAULT_WINDOWS_TASKKILL_TIMEOUT_MS
    });
    if (toSyncCommandExitCode(graceful) === 0) {
      terminated = true;
    }
  } catch {}
  try {
    const forcedKill = runSyncCommandWithTimeout('taskkill', [...baseArgs, '/F'], {
      stdio: 'ignore',
      timeoutMs: DEFAULT_WINDOWS_TASKKILL_TIMEOUT_MS
    });
    if (toSyncCommandExitCode(forcedKill) === 0) {
      terminated = true;
      forced = true;
    }
  } catch {}
  if (!terminated) {
    const fallback = killWindowsOrphanDescendantsSync(pid);
    fallbackAttempted = fallback.attempted;
    fallbackTerminated = fallback.terminatedCount;
    if (fallback.terminatedCount > 0) {
      terminated = true;
      forced = true;
    }
  }
  return { terminated, forced, fallbackAttempted, fallbackTerminated };
};

const parseWindowsPidList = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry) && entry > 0)
      .map((entry) => Math.floor(entry));
  } catch {
    return [];
  }
};

const discoverWindowsDescendantPidsSync = (rootPid) => {
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$rootPid = [int]$env:POC_ROOT_PID',
    '$children = @{}',
    '$procs = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId',
    'foreach ($p in $procs) {',
    '  $pp = [int]$p.ParentProcessId',
    '  if (-not $children.ContainsKey($pp)) { $children[$pp] = New-Object System.Collections.Generic.List[int] }',
    '  [void]$children[$pp].Add([int]$p.ProcessId)',
    '}',
    '$queue = New-Object System.Collections.Generic.Queue[int]',
    '$seen = New-Object System.Collections.Generic.HashSet[int]',
    '$out = New-Object System.Collections.Generic.List[int]',
    '$queue.Enqueue($rootPid)',
    '[void]$seen.Add($rootPid)',
    'while ($queue.Count -gt 0) {',
    '  $current = $queue.Dequeue()',
    '  if (-not $children.ContainsKey($current)) { continue }',
    '  foreach ($childPid in $children[$current]) {',
    '    if ($childPid -le 0) { continue }',
    '    if (-not $seen.Add($childPid)) { continue }',
    '    [void]$out.Add($childPid)',
    '    $queue.Enqueue($childPid)',
    '  }',
    '}',
    '$out | ConvertTo-Json -Compress'
  ].join('; ');
  const result = runSyncCommandWithTimeout(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeoutMs: WINDOWS_DESCENDANT_DISCOVERY_TIMEOUT_MS,
      env: {
        ...process.env,
        POC_ROOT_PID: String(rootPid)
      }
    }
  );
  if (toSyncCommandExitCode(result) !== 0) return [];
  return parseWindowsPidList(result.stdout);
};

const killWindowsOrphanDescendantsSync = (rootPid) => {
  if (process.platform !== 'win32') {
    return { attempted: false, terminatedCount: 0 };
  }
  const descendants = discoverWindowsDescendantPidsSync(rootPid).slice(0, WINDOWS_DESCENDANT_KILL_LIMIT);
  if (!descendants.length) {
    return { attempted: false, terminatedCount: 0 };
  }
  let terminatedCount = 0;
  for (const pid of descendants) {
    if (!Number.isFinite(pid) || pid <= 0 || pid === rootPid) continue;
    try {
      const result = runSyncCommandWithTimeout('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        timeoutMs: DEFAULT_WINDOWS_TASKKILL_TIMEOUT_MS
      });
      if (toSyncCommandExitCode(result) === 0) {
        terminatedCount += 1;
      }
    } catch {}
  }
  return {
    attempted: true,
    terminatedCount
  };
};

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
