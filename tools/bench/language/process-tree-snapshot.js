import path from 'node:path';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';

const MAX_ROWS = 8192;
const fail = message => Object.assign(new Error(message), { code: 'ERR_BENCH_PROCESS_TREE_SNAPSHOT' });
const pidValue = value => Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff;
const birthValue = value => typeof value === 'string' && /^(?:0|[1-9][0-9]{0,18})$/u.test(value)
  && BigInt(value) <= 3155378975999999999n;
export const processIncarnation = row => `${row.pid}:${row.createdAtTicks}`;

// Only identity, ancestry and resident-byte fields are requested. Command lines,
// environment, executable paths and unrelated process rows are never persisted.
const WINDOWS_SNAPSHOT_SCRIPT = `
$ErrorActionPreference = 'Stop'
$WarningPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$rows = @(Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,CreationDate,WorkingSetSize | ForEach-Object {
  [pscustomobject]@{
    pid = [long]$_.ProcessId
    parentPid = [long]$_.ParentProcessId
    createdAtTicks = $(if ($null -eq $_.CreationDate) { $null } else { ([DateTimeOffset]$_.CreationDate).UtcDateTime.Ticks.ToString([Globalization.CultureInfo]::InvariantCulture) })
    rssBytes = $(if ($null -eq $_.WorkingSetSize) { $null } else { [double]$_.WorkingSetSize })
  }
})
if ($rows.Count -gt 8192) { throw 'Process snapshot exceeds its row budget.' }
[pscustomobject]@{ version = 1; observerPid = $PID; rows = $rows } | ConvertTo-Json -Depth 4 -Compress
`;

/** Read-only Windows observer. The existing runner hides its window, bounds
 * output/deadline and retains child termination/close ownership on failures.
 */
export const readWindowsProcessSnapshot = async ({ platform = process.platform, run = spawnSubprocess } = {}) => {
  if (platform !== 'win32') throw Object.assign(new Error('Windows process-tree observation is unsupported on this platform.'),
    { code: 'ERR_BENCH_PROCESS_TREE_PLATFORM' });
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  if (!path.win32.isAbsolute(systemRoot)) throw fail('Windows system root must be absolute.');
  const command = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = await run(command, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_SNAPSHOT_SCRIPT], {
    timeoutMs: 3000, maxOutputBytes: 2 * 1024 * 1024, outputMode: 'string', cleanupOnParentExit: true
  });
  if (result.exitCode !== 0 || result.signal || String(result.stderr || '').trim()) throw fail('Process observer did not complete cleanly.');
  if (result.outputCapture?.stdout?.truncated || result.outputCapture?.stdout?.encodingLoss
    || result.outputCapture?.stderr?.truncated) throw fail('Process snapshot output is incomplete.');
  let snapshot;
  try { snapshot = JSON.parse(String(result.stdout || '').replace(/^\uFEFF/u, '')); }
  catch (cause) { throw Object.assign(fail('Process snapshot is not complete JSON.'), { cause }); }
  if (snapshot?.observerPid !== result.pid) throw fail('Process snapshot does not belong to its observer process.');
  return snapshot;
};

/** A PID is not lifetime identity. Retain already observed incarnations after a
 * parent exits; never adopt an old child merely because its parent PID is reused.
 * This operation supplies measurement evidence, never termination authority.
 */
export const projectOwnedProcessTree = ({ snapshot, rootPid, rootCreatedAtTicks = null,
  knownIdentities = new Set(), maxProcesses = 256 } = {}) => {
  if (!pidValue(rootPid) || rootPid === 0 || !Number.isSafeInteger(maxProcesses) || maxProcesses < 1 || maxProcesses > 4096
    || !(knownIdentities instanceof Set) || knownIdentities.size > 4096
    || snapshot?.version !== 1 || !pidValue(snapshot.observerPid) || snapshot.observerPid === 0 || !Array.isArray(snapshot.rows)
    || snapshot.rows.length > MAX_ROWS) throw fail('Invalid process snapshot contract or bounds.');
  const rows = new Map(), children = new Map();
  for (const row of snapshot.rows) {
    if (!row || !pidValue(row.pid) || !pidValue(row.parentPid) || rows.has(row.pid)
      || row.createdAtTicks !== null && !birthValue(row.createdAtTicks)
      || row.rssBytes !== null && (!Number.isSafeInteger(row.rssBytes) || row.rssBytes < 0)) throw fail('Invalid or duplicate process snapshot row.');
    rows.set(row.pid, { pid: row.pid, parentPid: row.parentPid, createdAtTicks: row.createdAtTicks, rssBytes: row.rssBytes });
    if (!children.has(row.parentPid)) children.set(row.parentPid, []);
    children.get(row.parentPid).push(row.pid);
  }
  const root = rows.get(rootPid);
  if (!root || !birthValue(root.createdAtTicks)) throw fail('The benchmark root has no observed lifetime identity.');
  if (rootCreatedAtTicks !== null && root.createdAtTicks !== rootCreatedAtTicks) throw fail('The benchmark root PID was reused.');
  const excluded = new Set(), excludeQueue = [snapshot.observerPid];
  for (let i = 0; i < excludeQueue.length; i++) {
    const pid = excludeQueue[i];
    if (excluded.has(pid)) continue;
    excluded.add(pid);
    excludeQueue.push(...(children.get(pid) || []));
  }
  if (excluded.has(rootPid)) throw fail('The observer cannot own the benchmark root.');
  const selected = new Map(), queue = [rootPid], ambiguous = new Set();
  const oldParentLinks = new Set();
  let excludedReusedParentLinks = 0;
  // An orphan is included only after this owner observed its exact incarnation.
  for (const row of rows.values()) if (birthValue(row.createdAtTicks) && knownIdentities.has(processIncarnation(row))) queue.push(row.pid);
  for (let i = 0; i < queue.length; i++) {
    const pid = queue[i];
    if (excluded.has(pid) || selected.has(pid)) continue;
    const row = rows.get(pid);
    if (!row) continue;
    if (selected.size === maxProcesses) throw fail('Owned process tree exceeds its observation budget.');
    selected.set(pid, row);
    if (!birthValue(row.createdAtTicks)) ambiguous.add(pid);
    for (const childPid of children.get(pid) || []) {
      if (excluded.has(childPid)) continue;
      const child = rows.get(childPid);
      if (birthValue(row.createdAtTicks) && birthValue(child.createdAtTicks) && BigInt(child.createdAtTicks) < BigInt(row.createdAtTicks)) {
        excludedReusedParentLinks++; oldParentLinks.add(childPid); continue;
      }
      if (ambiguous.has(pid) || !birthValue(child.createdAtTicks)) ambiguous.add(childPid);
      queue.push(childPid);
    }
  }
  const processes = [...selected.values()].sort((a, b) => a.pid - b.pid);
  const missingRss = processes.filter(row => row.rssBytes === null).length;
  const priorParentPids = new Set([...knownIdentities].map(identity => Number(identity.split(':')[0])));
  const unresolved = [...rows.values()].filter(row => !selected.has(row.pid) && !excluded.has(row.pid)
    && !oldParentLinks.has(row.pid) && priorParentPids.has(row.parentPid));
  const total = processes.reduce((sum, row) => sum + (row.rssBytes ?? 0), 0);
  const ambiguousIdentities = processes.filter(row => ambiguous.has(row.pid)).length;
  const complete = ambiguousIdentities === 0 && missingRss === 0 && unresolved.length === 0 && Number.isSafeInteger(total);
  return { rootCreatedAtTicks: root.createdAtTicks, status: complete ? 'complete-snapshot' : 'partial-snapshot',
    rssBytes: complete ? total : null, processes, ambiguousIdentities, missingRss,
    observedOwnedRssBytes: Number.isSafeInteger(total) ? total : null,
    unresolvedParentLinks: unresolved.length,
    unresolvedParentExamples: unresolved.slice(0, 32).map(row => ({ pid: row.pid, parentPid: row.parentPid })),
    excludedObserverProcesses: [...excluded].filter(pid => rows.has(pid)).length, excludedReusedParentLinks,
    identities: processes.filter(row => !ambiguous.has(row.pid)).map(processIncarnation) };
};
