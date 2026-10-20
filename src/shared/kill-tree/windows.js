import { runSyncCommandWithTimeout, toSyncCommandExitCode } from '../subprocess/sync-command.js';
import { scheduleUnrefTimer, wait } from './shared.js';

const DEFAULT_WINDOWS_TASKKILL_TIMEOUT_MS = 2000;
const WINDOWS_DESCENDANT_DISCOVERY_TIMEOUT_MS = 2000;
const WINDOWS_DESCENDANT_KILL_LIMIT = 2048;
const WINDOWS_TASKLIST_TIMEOUT_MS = 2000;
const WINDOWS_DESCENDANT_KILL_BUDGET_MS = 4000;

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

export const isWindowsPidAlive = (pid) => {
  const numericPid = Number(pid);
  if (!Number.isFinite(numericPid) || numericPid <= 0) return false;
  const result = runSyncCommandWithTimeout(
    'tasklist',
    ['/FI', `PID eq ${Math.floor(numericPid)}`, '/FO', 'CSV', '/NH'],
    {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeoutMs: WINDOWS_TASKLIST_TIMEOUT_MS
    }
  );
  const exitCode = toSyncCommandExitCode(result);
  if (exitCode == null && result?.error) return true;
  const output = String(result?.stdout || '').trim();
  if (!output || /INFO:\s+No tasks are running/i.test(output)) return false;
  const firstLine = output.split(/\r?\n/)[0] || '';
  const parts = firstLine.split('","').map((part) => part.replace(/^"|"$/g, ''));
  const listedPid = Number(parts[1] || '');
  return Number.isFinite(listedPid) ? listedPid === Math.floor(numericPid) : true;
};

const discoverWindowsDescendantPidsSync = (rootPid) => {
  const script = [
    '$ErrorActionPreference = "Stop"',
    '[Console]::Error.WriteLine("lineage:script-start")',
    '$rootPid = [int]$env:POC_ROOT_PID',
    '$children = @{}',
    // Only lineage is needed; do not retrieve every process property and then
    // discard it through a second object projection pipeline.
    '$procs = Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId',
    '[Console]::Error.WriteLine("lineage:snapshot-ready")',
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
  const startedAt = Date.now();
  const result = runSyncCommandWithTimeout(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeoutMs: WINDOWS_DESCENDANT_DISCOVERY_TIMEOUT_MS,
      env: {
        ...process.env,
        POC_ROOT_PID: String(rootPid)
      }
    }
  );
  const exitCode = toSyncCommandExitCode(result);
  const pids = exitCode === 0 ? parseWindowsPidList(result.stdout) : [];
  return { pids, diagnostic: {
    exitCode,
    errorCode: result?.error?.code || null,
    durationMs: Date.now() - startedAt,
    discoveredCount: pids.length,
    stderr: String(result?.stderr || '').slice(-2048)
  } };
};

const killWindowsOrphanDescendantsSync = (
  rootPid,
  { budgetMs = WINDOWS_DESCENDANT_KILL_BUDGET_MS } = {}
) => {
  if (process.platform !== 'win32') {
    return { attempted: false, terminatedCount: 0 };
  }
  const resolvedBudgetMs = Number.isFinite(Number(budgetMs))
    ? Math.max(0, Math.floor(Number(budgetMs)))
    : WINDOWS_DESCENDANT_KILL_BUDGET_MS;
  const discovery = discoverWindowsDescendantPidsSync(rootPid);
  const descendants = discovery.pids.slice(0, WINDOWS_DESCENDANT_KILL_LIMIT);
  if (!descendants.length) {
    return { attempted: false, terminatedCount: 0, discovery: discovery.diagnostic };
  }
  const startedAtMs = Date.now();
  let terminatedCount = 0;
  for (const pid of descendants) {
    if (resolvedBudgetMs > 0 && (Date.now() - startedAtMs) >= resolvedBudgetMs) {
      break;
    }
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
    terminatedCount,
    discovery: discovery.diagnostic
  };
};

const applyWindowsFallbackKill = (pid, state) => {
  if (state.terminated) return;
  const fallback = killWindowsOrphanDescendantsSync(pid);
  state.fallbackAttempted = fallback.attempted;
  state.fallbackTerminated = fallback.terminatedCount;
  state.fallbackDiscovery = fallback.discovery;
  if (fallback.terminatedCount > 0) {
    state.terminated = true;
    state.forced = true;
  }
};

export const killWindowsTree = async (pid, { graceMs, awaitGrace = true }) => {
  const baseArgs = ['/PID', String(pid), '/T'];
  const state = {
    terminated: false,
    forced: false,
    fallbackAttempted: false,
    fallbackTerminated: 0
  };
  try {
    const graceful = runSyncCommandWithTimeout('taskkill', baseArgs, {
      stdio: 'ignore',
      timeoutMs: DEFAULT_WINDOWS_TASKKILL_TIMEOUT_MS
    });
    if (toSyncCommandExitCode(graceful) === 0) {
      state.terminated = true;
      if (graceMs > 0 && awaitGrace) await wait(graceMs, { unrefTimer: false });
    }
  } catch {}
  if (state.terminated && !isWindowsPidAlive(pid)) {
    return { ...state, terminated: true, forced: false };
  }
  if (!awaitGrace) {
    if (graceMs > 0) {
      scheduleUnrefTimer(graceMs, () => {
        if (!isWindowsPidAlive(pid)) return;
        runSyncCommandWithTimeout('taskkill', [...baseArgs, '/F'], {
          stdio: 'ignore',
          timeoutMs: DEFAULT_WINDOWS_TASKKILL_TIMEOUT_MS
        });
      });
      return { ...state, forced: false };
    }
    try {
      const forcedKill = runSyncCommandWithTimeout('taskkill', [...baseArgs, '/F'], {
        stdio: 'ignore',
        timeoutMs: DEFAULT_WINDOWS_TASKKILL_TIMEOUT_MS
      });
      if (toSyncCommandExitCode(forcedKill) === 0) {
        state.terminated = true;
        state.forced = true;
      }
    } catch {}
    return state;
  }
  try {
    const forcedKill = runSyncCommandWithTimeout('taskkill', [...baseArgs, '/F'], {
      stdio: 'ignore',
      timeoutMs: DEFAULT_WINDOWS_TASKKILL_TIMEOUT_MS
    });
    if (toSyncCommandExitCode(forcedKill) === 0) {
      state.terminated = true;
      state.forced = true;
    }
  } catch {}
  applyWindowsFallbackKill(pid, state);
  return state;
};

export const killWindowsTreeSync = (pid) => {
  const baseArgs = ['/PID', String(pid), '/T'];
  const state = {
    terminated: false,
    forced: false,
    fallbackAttempted: false,
    fallbackTerminated: 0
  };
  try {
    const graceful = runSyncCommandWithTimeout('taskkill', baseArgs, {
      stdio: 'ignore',
      timeoutMs: DEFAULT_WINDOWS_TASKKILL_TIMEOUT_MS
    });
    if (toSyncCommandExitCode(graceful) === 0) {
      state.terminated = true;
    }
  } catch {}
  if (state.terminated && !isWindowsPidAlive(pid)) {
    return { ...state, terminated: true, forced: false };
  }
  try {
    const forcedKill = runSyncCommandWithTimeout('taskkill', [...baseArgs, '/F'], {
      stdio: 'ignore',
      timeoutMs: DEFAULT_WINDOWS_TASKKILL_TIMEOUT_MS
    });
    if (toSyncCommandExitCode(forcedKill) === 0) {
      state.terminated = true;
      state.forced = true;
    }
  } catch {}
  applyWindowsFallbackKill(pid, state);
  return state;
};
