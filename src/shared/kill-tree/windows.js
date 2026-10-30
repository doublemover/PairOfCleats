import { spawnSync } from 'node:child_process';
import { scheduleUnrefTimer, wait } from './shared.js';
import path from 'node:path';

const DEFAULT_WINDOWS_TASKKILL_TIMEOUT_MS = 2000;
const WINDOWS_DESCENDANT_DISCOVERY_TIMEOUT_MS = 2000;
const WINDOWS_DESCENDANT_KILL_LIMIT = 2048;
const WINDOWS_TASKLIST_TIMEOUT_MS = 2000;
const WINDOWS_DESCENDANT_KILL_BUDGET_MS = 4000;

// Native leaf helpers never launch application work. Bound them directly so a
// stalled taskkill/snapshot cannot recursively enter the tree-cleanup owner.
const runWindowsHelperSync = (command, args, { timeoutMs, ...options }) => {
  try { return spawnSync(command, args, { ...options, timeout: timeoutMs }); }
  catch (error) { return { pid: null, status: null, signal: null, stdout: '', stderr: '', error }; }
};
const toSyncCommandExitCode = result => Number.isFinite(result?.status) ? result.status : null;

/** Node 26 supports 64-bit Windows; bind its native system helper, independently of PATH. */
export const resolveWindowsPowerShellPath = (env = process.env) => {
  const systemRoot = env.SystemRoot || env.SYSTEMROOT || env.windir || env.WINDIR;
  if (typeof systemRoot !== 'string' || !/^[A-Za-z]:[\\/]/.test(systemRoot)) return null;
  return path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
};

// Toolhelp reads the native process snapshot without a WMI provider or C# compiler.
// PROCESSENTRY32W layout: tlhelp32.h; reject anything except complete enumeration.
export const WINDOWS_PROCESS_SNAPSHOT_SCRIPT = String.raw`$ErrorActionPreference = 'Stop'
[Console]::Error.WriteLine('lineage:script-start')
$clock = [Diagnostics.Stopwatch]::StartNew()
if ([IntPtr]::Size -ne 8) { throw 'Process snapshot requires the supported 64-bit Windows runtime.' }
$assembly = [AppDomain]::CurrentDomain.DefineDynamicAssembly([Reflection.AssemblyName]::new('PocProcessSnapshot'), [Reflection.Emit.AssemblyBuilderAccess]::Run)
[Console]::Error.WriteLine('lineage:assembly-ready elapsedMs=' + $clock.ElapsedMilliseconds)
$module = $assembly.DefineDynamicModule('Native')
$builder = $module.DefineType('PocProcessSnapshot', [Reflection.TypeAttributes]'Public, Abstract, Sealed')
$attributeType = [Runtime.InteropServices.DllImportAttribute]
$constructor = $attributeType.GetConstructor([Type[]]@([string]))
$fields = [Reflection.FieldInfo[]]@($attributeType.GetField('SetLastError'), $attributeType.GetField('ExactSpelling'))
$attribute = [Reflection.Emit.CustomAttributeBuilder]::new($constructor, [object[]]@('kernel32.dll'), $fields, [object[]]@($true, $true))
[Console]::Error.WriteLine('lineage:signature-ready elapsedMs=' + $clock.ElapsedMilliseconds)
function Add-NativeMethod([string]$name, [Type]$returnType, [Type[]]$parameters) {
  $method = $builder.DefineMethod($name, [Reflection.MethodAttributes]'Public, Static, PinvokeImpl', $returnType, $parameters)
  $method.SetCustomAttribute($attribute)
  $method.SetImplementationFlags([Reflection.MethodImplAttributes]::PreserveSig)
}
Add-NativeMethod 'CreateToolhelp32Snapshot' ([IntPtr]) ([Type[]]@([uint32], [uint32]))
Add-NativeMethod 'Process32FirstW' ([bool]) ([Type[]]@([IntPtr], [IntPtr]))
Add-NativeMethod 'Process32NextW' ([bool]) ([Type[]]@([IntPtr], [IntPtr]))
Add-NativeMethod 'CloseHandle' ([bool]) ([Type[]]@([IntPtr]))
$native = $builder.CreateType()
[Console]::Error.WriteLine('lineage:interop-ready elapsedMs=' + $clock.ElapsedMilliseconds)
$entrySize = 568
$parentOffset = 32
$buffer = [IntPtr]::Zero
$snapshot = [IntPtr]::new(-1)
$rows = [Text.StringBuilder]::new()
try {
  $buffer = [Runtime.InteropServices.Marshal]::AllocHGlobal($entrySize)
  [Runtime.InteropServices.Marshal]::WriteInt32($buffer, $entrySize)
  $snapshot = $native::CreateToolhelp32Snapshot(2, 0)
  if ($snapshot -eq [IntPtr]::new(-1)) { throw [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error()) }
  [Console]::Error.WriteLine('lineage:snapshot-ready elapsedMs=' + $clock.ElapsedMilliseconds)
  $more = $native::Process32FirstW($snapshot, $buffer)
  while ($more) {
    $processId = [int64][Runtime.InteropServices.Marshal]::ReadInt32($buffer, 8) -band 4294967295L
    $parentId = [int64][Runtime.InteropServices.Marshal]::ReadInt32($buffer, $parentOffset) -band 4294967295L
    [void]$rows.Append($processId).Append(' ').Append($parentId).AppendLine()
    $more = $native::Process32NextW($snapshot, $buffer)
  }
  $lastError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  if ($lastError -ne 18) { throw [ComponentModel.Win32Exception]::new($lastError) }
} finally {
  if ($buffer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer) }
  if ($snapshot -ne [IntPtr]::new(-1)) {
    if (!$native::CloseHandle($snapshot)) { throw [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error()) }
  }
  [Console]::Error.WriteLine('lineage:resources-closed elapsedMs=' + $clock.ElapsedMilliseconds)
}
[Console]::Out.Write($rows.ToString())
[Console]::Error.WriteLine('lineage:rows-written elapsedMs=' + $clock.ElapsedMilliseconds)
`;

/** Keep engine startup distinct from parsing/executing the larger native script.
 * The fixed launcher reads a private stdin payload; no shell/PATH lookup occurs.
 * This preserves the production deadline and makes pre-script stalls observable.
 */
export const createWindowsProcessSnapshotRequest = ({ env = process.env,
  script = WINDOWS_PROCESS_SNAPSHOT_SCRIPT } = {}) => {
  const command = resolveWindowsPowerShellPath(env);
  if (!command) return null;
  return { command, args: ['-NoProfile', '-NonInteractive', '-Command',
    "[Console]::Error.WriteLine('lineage:engine-ready'); & ([ScriptBlock]::Create([Console]::In.ReadToEnd()))"],
  options: { input: script, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8', windowsHide: true,
    timeoutMs: WINDOWS_DESCENDANT_DISCOVERY_TIMEOUT_MS } };
};

/** Walk a complete lineage-only snapshot without per-process shell objects. */
export const resolveWindowsDescendantPids = (value, rootPid) => {
  const children = new Map(), processIds = new Set();
  const raw = String(value || '').trim();
  for (const line of raw ? raw.split(/\r?\n/) : []) {
    const pair = /^(\d+) (\d+)$/.exec(line);
    const pid = Number(pair?.[1]), parent = Number(pair?.[2]);
    if (!pair || !Number.isSafeInteger(pid) || pid < 0 || pid > 0xffffffff
      || !Number.isSafeInteger(parent) || parent < 0 || parent > 0xffffffff || processIds.has(pid)) {
      throw Object.assign(new Error('Invalid Windows process lineage snapshot.'), { code: 'ERR_WINDOWS_PROCESS_SNAPSHOT' });
    }
    processIds.add(pid);
    if (pid === 0) continue; // The native snapshot includes the system idle row.
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(pid);
  }
  const queue = [Number(rootPid)], seen = new Set(queue), descendants = [];
  for (let index = 0; index < queue.length; index += 1) {
    for (const pid of children.get(queue[index]) || []) {
      if (seen.has(pid)) continue;
      seen.add(pid);
      descendants.push(pid);
      queue.push(pid);
    }
  }
  return descendants;
};

export const isWindowsPidAlive = (pid) => {
  const numericPid = Number(pid);
  if (!Number.isFinite(numericPid) || numericPid <= 0) return false;
  const result = runWindowsHelperSync(
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
  const startedAt = Date.now();
  const request = createWindowsProcessSnapshotRequest();
  if (!request) return { pids: [], diagnostic: { exitCode: null,
    errorCode: 'ERR_WINDOWS_SYSTEM_ROOT', durationMs: 0, discoveredCount: 0, stderr: '' } };
  const result = runWindowsHelperSync(
    request.command, request.args, request.options
  );
  const exitCode = toSyncCommandExitCode(result);
  let pids = [], parseError = null;
  if (exitCode === 0 && !result?.error) {
    try { pids = resolveWindowsDescendantPids(result.stdout, rootPid); }
    catch (error) { parseError = error; }
  }
  return { pids, diagnostic: {
    exitCode,
    errorCode: result?.error?.code || parseError?.code || null,
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
      const result = runWindowsHelperSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
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
    const graceful = runWindowsHelperSync('taskkill', baseArgs, {
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
        runWindowsHelperSync('taskkill', [...baseArgs, '/F'], {
          stdio: 'ignore',
          timeoutMs: DEFAULT_WINDOWS_TASKKILL_TIMEOUT_MS
        });
      });
      return { ...state, forced: false };
    }
    try {
      const forcedKill = runWindowsHelperSync('taskkill', [...baseArgs, '/F'], {
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
    const forcedKill = runWindowsHelperSync('taskkill', [...baseArgs, '/F'], {
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
    const graceful = runWindowsHelperSync('taskkill', baseArgs, {
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
    const forcedKill = runWindowsHelperSync('taskkill', [...baseArgs, '/F'], {
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
