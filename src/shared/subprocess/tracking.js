import { AsyncLocalStorage } from 'node:async_hooks';
import { killChildProcessTree, killChildProcessTreeSync } from '../kill-tree.js';
import {
  TRACKED_SUBPROCESS_FORCE_GRACE_MS,
  TRACKED_SUBPROCESS_EVENT_DEFAULT_LIMIT,
  TRACKED_SUBPROCESS_EVENT_MAX_LIMIT,
  resolveKillGraceMs,
  resolveEventLimit,
  toNumber,
  toSafeArgList,
  toIsoTimestamp
} from './options.js';
import { installTrackedSubprocessHooks } from './signals.js';

const trackedSubprocesses = new Map();
const trackedSubprocessEvents = [];
const trackedOwnershipIdByAbortSignal = new WeakMap();
const trackedSubprocessScopeContext = new AsyncLocalStorage();

const appendTrackedSubprocessEvent = (event) => {
  const next = event && typeof event === 'object' ? event : {};
  trackedSubprocessEvents.push({
    at: toIsoTimestamp(Date.now()),
    kind: typeof next.kind === 'string' && next.kind.trim() ? next.kind.trim() : 'unknown',
    pid: Number.isFinite(Number(next.pid)) ? Number(next.pid) : null,
    ppid: Number.isFinite(Number(next.ppid)) ? Number(next.ppid) : process.pid,
    scope: normalizeTrackedScope(next.scope),
    ownershipId: normalizeTrackedOwnershipId(next.ownershipId),
    command: typeof next.command === 'string' && next.command.trim() ? next.command.trim() : null,
    args: toSafeArgList(next.args),
    name: typeof next.name === 'string' && next.name.trim() ? next.name.trim() : null,
    reason: typeof next.reason === 'string' && next.reason.trim() ? next.reason.trim() : null,
    terminated: next.terminated === true,
    forced: next.forced === true,
    error: next.error == null ? null : String(next.error)
  });
  const limit = resolveEventLimit(TRACKED_SUBPROCESS_EVENT_MAX_LIMIT);
  if (trackedSubprocessEvents.length > limit) {
    trackedSubprocessEvents.splice(0, trackedSubprocessEvents.length - limit);
  }
};

const normalizeTrackedOwnershipId = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const normalizeTrackedScope = (value) => normalizeTrackedOwnershipId(value);
const normalizeTrackedOwnershipPrefix = (value) => normalizeTrackedOwnershipId(value);

const resolveTrackedOwnershipId = (options = {}) => (
  normalizeTrackedOwnershipId(options.ownershipId ?? options.ownerId)
  || normalizeTrackedOwnershipId(options.scope ?? options.cleanupScope)
);

const resolveTrackedScope = (options = {}) => (
  normalizeTrackedScope(options.scope ?? options.cleanupScope)
  || normalizeTrackedScope(options.ownershipId ?? options.ownerId)
);

const resolveEntryOwnershipId = (entry) => (
  normalizeTrackedOwnershipId(entry?.ownershipId)
  || normalizeTrackedOwnershipId(entry?.scope)
);

const entryMatchesOwnershipId = (entry, ownershipId) => {
  if (!ownershipId) return true;
  return resolveEntryOwnershipId(entry) === ownershipId
    || normalizeTrackedScope(entry?.scope) === ownershipId;
};

const entryMatchesOwnershipPrefix = (entry, ownershipPrefix) => {
  if (!ownershipPrefix) return true;
  const ownershipId = resolveEntryOwnershipId(entry);
  if (ownershipId && ownershipId.startsWith(ownershipPrefix)) return true;
  const scope = normalizeTrackedScope(entry?.scope);
  return Boolean(scope && scope.startsWith(ownershipPrefix));
};

const entryMatchesTrackedFilters = (entry, {
  ownershipId = null,
  ownershipPrefix = null
} = {}) => (
  entryMatchesOwnershipId(entry, ownershipId)
  && entryMatchesOwnershipPrefix(entry, ownershipPrefix)
);

const removeTrackedSubprocess = (entryKey, reason = 'unregister') => {
  const entry = trackedSubprocesses.get(entryKey);
  if (!entry) return null;
  trackedSubprocesses.delete(entryKey);
  try {
    entry.child?.off('close', entry.onClose);
  } catch {}
  appendTrackedSubprocessEvent({
    kind: 'process_untracked',
    pid: entry.child?.pid,
    scope: entry.scope,
    ownershipId: entry.ownershipId,
    command: entry.command,
    args: entry.args,
    name: entry.name,
    reason,
    terminated: reason === 'close'
  });
  return entry;
};

const isChildExited = (child) => Boolean(!child || child.exitCode !== null);

const markEntryTerminating = (entry) => {
  if (!entry || entry.terminating === true) return false;
  entry.terminating = true;
  return true;
};

const clearEntryTerminating = (entry) => {
  if (!entry) return;
  entry.terminating = false;
};

const collectTerminationEntries = ({
  ownershipId = null,
  ownershipPrefix = null
} = {}) => {
  const entries = [];
  for (const [entryKey, entry] of trackedSubprocesses.entries()) {
    if (!entryMatchesTrackedFilters(entry, { ownershipId, ownershipPrefix })) continue;
    if (!markEntryTerminating(entry)) continue;
    entries.push({ entryKey, entry });
  }
  return entries;
};

/**
 * Bind a tracked-subprocess cleanup scope to an AbortSignal for the duration
 * of an async operation.
 *
 * Any subprocess created via `spawnSubprocess(...)` while the binding is
 * active will inherit this scope unless an explicit cleanup scope is provided.
 * When a shared `AbortSignal` is passed through, we also bind the signal so
 * out-of-context signal handlers can resolve the same scope.
 *
 * @template T
 * @param {AbortSignal|null|undefined} signal
 * @param {string|null|undefined} scope
 * @param {() => Promise<T>|T} operation
 * @returns {Promise<T>}
 */
const withTrackedSubprocessSignalScope = async (signal, scope, operation) => {
  if (typeof operation !== 'function') {
    throw new TypeError('withTrackedSubprocessSignalScope requires an operation function.');
  }
  const ownershipId = normalizeTrackedOwnershipId(scope);
  if (!ownershipId) {
    return Promise.resolve().then(() => operation());
  }
  const bindSignal = signal && typeof signal === 'object';
  const previousOwnershipId = bindSignal
    ? normalizeTrackedOwnershipId(trackedOwnershipIdByAbortSignal.get(signal))
    : null;
  const runOperation = async () => {
    if (bindSignal) trackedOwnershipIdByAbortSignal.set(signal, ownershipId);
    try {
      return await operation();
    } finally {
      if (bindSignal) {
        if (previousOwnershipId) {
          trackedOwnershipIdByAbortSignal.set(signal, previousOwnershipId);
        } else {
          trackedOwnershipIdByAbortSignal.delete(signal);
        }
      }
    }
  };
  return trackedSubprocessScopeContext.run(
    { scope: ownershipId, ownershipId },
    runOperation
  );
};

/**
 * Terminate all currently tracked child processes.
 *
 * This is used by lifecycle hooks (exit/signals/uncaught exceptions) and can
 * also be invoked by callers that need deterministic cleanup boundaries.
 *
 * @param {{reason?:string,force?:boolean,scope?:string|null,ownershipId?:string|null,ownershipPrefix?:string|null}} [input]
 * @returns {Promise<{
 *   reason:string,
 *   tracked:number,
 *   attempted:number,
 *   failures:number,
 *   scope:string|null,
 *   ownershipId:string|null,
 *   ownershipPrefix:string|null,
 *   targetedPids:number[],
 *   terminatedPids:number[],
 *   ownershipIds:string[],
 *   terminatedOwnershipIds:string[],
 *   killAudit:Array<{
 *     pid:number|null,
 *     scope:string|null,
 *     ownershipId:string|null,
 *     terminated:boolean,
 *     forced:boolean,
 *     error:string|null
 *   }>
 * }>}
 */
const terminateTrackedSubprocesses = async ({
  reason = 'shutdown',
  force = false,
  scope = null,
  ownershipId = null,
  ownershipPrefix = null
} = {}) => {
  const normalizedScope = normalizeTrackedScope(scope);
  const normalizedOwnershipId = normalizeTrackedOwnershipId(ownershipId) || normalizedScope;
  const normalizedOwnershipPrefix = normalizeTrackedOwnershipPrefix(ownershipPrefix);
  const entries = collectTerminationEntries({
    ownershipId: normalizedOwnershipId,
    ownershipPrefix: normalizedOwnershipPrefix
  });
  if (!entries.length) {
    return {
      reason,
      tracked: 0,
      attempted: 0,
      failures: 0,
      scope: normalizedScope,
      ownershipId: normalizedOwnershipId,
      ownershipPrefix: normalizedOwnershipPrefix,
      targetedPids: [],
      terminatedPids: [],
      ownershipIds: [],
      terminatedOwnershipIds: [],
      killAudit: []
    };
  }
  const killTargets = entries.map(({ entryKey, entry }) => ({
    entryKey,
    entry,
    pid: Number.isFinite(Number(entry?.child?.pid)) ? Number(entry.child.pid) : null,
    scope: normalizeTrackedScope(entry?.scope),
    ownershipId: resolveEntryOwnershipId(entry),
    child: entry.child,
    killTree: entry.killTree,
    killSignal: entry.killSignal,
    killGraceMs: entry.killGraceMs,
    detached: entry.detached
  }));
  const settled = await Promise.allSettled(killTargets.map((entry) => killChildProcessTree(entry.child, {
    killTree: entry.killTree,
    killSignal: entry.killSignal,
    graceMs: force ? TRACKED_SUBPROCESS_FORCE_GRACE_MS : entry.killGraceMs,
    detached: entry.detached,
    awaitGrace: true
  })));
  const killAudit = settled
    .map((result, index) => {
      const target = killTargets[index];
      let terminated = isChildExited(target.child);
      let forced = false;
      let error = null;
      if (result.status === 'rejected') {
        error = result.reason?.message || String(result.reason || 'unknown_kill_error');
      } else {
        terminated = isChildExited(target.child) || result.value?.terminated === true;
        forced = result.value?.forced === true;
      }
      if (terminated) {
        removeTrackedSubprocess(target.entryKey, 'terminate');
      } else {
        clearEntryTerminating(target.entry);
      }
      return {
        pid: target.pid,
        scope: target.scope,
        ownershipId: target.ownershipId,
        terminated,
        forced,
        error
      };
    })
    .sort((left, right) => {
      const leftPid = Number.isFinite(left?.pid) ? left.pid : Number.MAX_SAFE_INTEGER;
      const rightPid = Number.isFinite(right?.pid) ? right.pid : Number.MAX_SAFE_INTEGER;
      if (leftPid !== rightPid) return leftPid - rightPid;
      const leftOwnership = String(left?.ownershipId || '');
      const rightOwnership = String(right?.ownershipId || '');
      return leftOwnership.localeCompare(rightOwnership);
    });
  const failures = killAudit.filter((entry) => Boolean(entry.error)).length;
  for (const audit of killAudit) {
    appendTrackedSubprocessEvent({
      kind: 'process_reaped',
      pid: audit.pid,
      scope: audit.scope,
      ownershipId: audit.ownershipId,
      reason,
      terminated: audit.terminated === true,
      forced: audit.forced === true,
      error: audit.error
    });
  }
  const targetedPids = killAudit
    .map((entry) => entry.pid)
    .filter((pid) => Number.isFinite(pid));
  const terminatedPids = killAudit
    .filter((entry) => entry.terminated === true && Number.isFinite(entry.pid))
    .map((entry) => entry.pid);
  const ownershipIds = [...new Set(
    killAudit
      .map((entry) => entry.ownershipId)
      .filter((value) => typeof value === 'string' && value.length > 0)
  )].sort((left, right) => left.localeCompare(right));
  const terminatedOwnershipIds = [...new Set(
    killAudit
      .filter((entry) => entry.terminated === true)
      .map((entry) => entry.ownershipId)
      .filter((value) => typeof value === 'string' && value.length > 0)
  )].sort((left, right) => left.localeCompare(right));
  return {
    reason,
    tracked: entries.length,
    attempted: entries.length,
    failures,
    scope: normalizedScope,
    ownershipId: normalizedOwnershipId,
    ownershipPrefix: normalizedOwnershipPrefix,
    targetedPids,
    terminatedPids,
    ownershipIds,
    terminatedOwnershipIds,
    killAudit
  };
};

const terminateTrackedSubprocessesSync = ({
  reason = 'shutdown_sync',
  force = true,
  scope = null,
  ownershipId = null,
  ownershipPrefix = null
} = {}) => {
  const normalizedScope = normalizeTrackedScope(scope);
  const normalizedOwnershipId = normalizeTrackedOwnershipId(ownershipId) || normalizedScope;
  const normalizedOwnershipPrefix = normalizeTrackedOwnershipPrefix(ownershipPrefix);
  const entries = collectTerminationEntries({
    ownershipId: normalizedOwnershipId,
    ownershipPrefix: normalizedOwnershipPrefix
  });
  if (!entries.length) {
    return {
      reason,
      tracked: 0,
      attempted: 0,
      failures: 0,
      scope: normalizedScope,
      ownershipId: normalizedOwnershipId,
      ownershipPrefix: normalizedOwnershipPrefix,
      targetedPids: [],
      terminatedPids: [],
      ownershipIds: [],
      terminatedOwnershipIds: [],
      killAudit: []
    };
  }

  const killAudit = entries
    .map(({ entryKey, entry }) => {
      const pid = Number.isFinite(Number(entry?.child?.pid)) ? Number(entry.child.pid) : null;
      const entryScope = normalizeTrackedScope(entry?.scope);
      const entryOwnershipId = resolveEntryOwnershipId(entry);
      let terminated = isChildExited(entry.child);
      let forced = false;
      let error = null;
      try {
        const result = killChildProcessTreeSync(entry.child, {
          killTree: entry.killTree,
          killSignal: entry.killSignal,
          detached: entry.detached,
          graceMs: force ? TRACKED_SUBPROCESS_FORCE_GRACE_MS : entry.killGraceMs
        });
        terminated = isChildExited(entry.child) || result?.terminated === true;
        forced = result?.forced === true;
      } catch (caughtError) {
        terminated = isChildExited(entry.child);
        error = caughtError?.message || String(caughtError || 'unknown_kill_error');
      }
      if (terminated) {
        removeTrackedSubprocess(entryKey, 'terminate_sync');
      } else {
        clearEntryTerminating(entry);
      }
      return {
        pid,
        scope: entryScope,
        ownershipId: entryOwnershipId,
        terminated,
        forced,
        error
      };
    })
    .sort((left, right) => {
      const leftPid = Number.isFinite(left?.pid) ? left.pid : Number.MAX_SAFE_INTEGER;
      const rightPid = Number.isFinite(right?.pid) ? right.pid : Number.MAX_SAFE_INTEGER;
      if (leftPid !== rightPid) return leftPid - rightPid;
      const leftOwnership = String(left?.ownershipId || '');
      const rightOwnership = String(right?.ownershipId || '');
      return leftOwnership.localeCompare(rightOwnership);
    });

  for (const audit of killAudit) {
    appendTrackedSubprocessEvent({
      kind: 'process_reaped',
      pid: audit.pid,
      scope: audit.scope,
      ownershipId: audit.ownershipId,
      reason,
      terminated: audit.terminated === true,
      forced: audit.forced === true,
      error: audit.error
    });
  }

  const failures = killAudit.filter((entry) => entry.error).length;
  const targetedPids = killAudit
    .map((entry) => entry.pid)
    .filter((pid) => Number.isFinite(pid));
  const terminatedPids = killAudit
    .filter((entry) => entry.terminated === true && Number.isFinite(entry.pid))
    .map((entry) => entry.pid);
  const ownershipIds = [...new Set(
    killAudit
      .map((entry) => entry.ownershipId)
      .filter((value) => typeof value === 'string' && value.length > 0)
  )].sort((left, right) => left.localeCompare(right));
  const terminatedOwnershipIds = [...new Set(
    killAudit
      .filter((entry) => entry.terminated === true)
      .map((entry) => entry.ownershipId)
      .filter((value) => typeof value === 'string' && value.length > 0)
  )].sort((left, right) => left.localeCompare(right));

  return {
    reason,
    tracked: entries.length,
    attempted: entries.length,
    failures,
    scope: normalizedScope,
    ownershipId: normalizedOwnershipId,
    ownershipPrefix: normalizedOwnershipPrefix,
    targetedPids,
    terminatedPids,
    ownershipIds,
    terminatedOwnershipIds,
    killAudit
  };
};

const registerChildProcessForCleanup = (child, options = {}) => {
  if (!child || !child.pid) {
    return () => {};
  }
  installTrackedSubprocessHooks(terminateTrackedSubprocesses, terminateTrackedSubprocessesSync);
  const entryKey = Symbol(`tracked-subprocess:${child.pid}`);
  const trackedScopeContext = trackedSubprocessScopeContext.getStore() || null;
  const abortSignal = options.signal && typeof options.signal === 'object'
    ? options.signal
    : null;
  const inheritedOwnershipId = normalizeTrackedOwnershipId(trackedOwnershipIdByAbortSignal.get(abortSignal))
    || normalizeTrackedOwnershipId(trackedScopeContext?.ownershipId ?? trackedScopeContext?.scope);
  const ownershipId = resolveTrackedOwnershipId(options) || inheritedOwnershipId || null;
  const scope = resolveTrackedScope(options) || ownershipId;
  const entry = {
    child,
    killTree: options.killTree !== false,
    killSignal: options.killSignal || 'SIGTERM',
    killGraceMs: resolveKillGraceMs(options.killGraceMs),
    detached: options.detached === true,
    scope,
    ownershipId,
    command: typeof options.command === 'string' ? options.command : null,
    args: toSafeArgList(options.args),
    name: typeof options.name === 'string' ? options.name : null,
    startedAtMs: toNumber(options.startedAtMs) || Date.now(),
    terminating: false,
    onClose: null
  };
  entry.onClose = () => {
    removeTrackedSubprocess(entryKey, 'close');
  };
  trackedSubprocesses.set(entryKey, entry);
  appendTrackedSubprocessEvent({
    kind: 'process_spawned',
    pid: child.pid,
    scope: entry.scope,
    ownershipId: entry.ownershipId,
    command: entry.command,
    args: entry.args,
    name: entry.name,
    reason: 'register'
  });
  child.once('close', entry.onClose);
  return () => {
    removeTrackedSubprocess(entryKey, 'unregister');
  };
};

const getTrackedSubprocessCount = (scope = null) => {
  const ownershipId = normalizeTrackedOwnershipId(scope);
  if (!ownershipId) return trackedSubprocesses.size;
  let count = 0;
  for (const entry of trackedSubprocesses.values()) {
    if (entryMatchesOwnershipId(entry, ownershipId)) count += 1;
  }
  return count;
};

const snapshotTrackedSubprocessEvents = ({
  limit = TRACKED_SUBPROCESS_EVENT_DEFAULT_LIMIT,
  ownershipId = null,
  ownershipPrefix = null
} = {}) => {
  const normalizedOwnershipId = normalizeTrackedOwnershipId(ownershipId);
  const normalizedOwnershipPrefix = normalizeTrackedOwnershipPrefix(ownershipPrefix);
  const resolvedLimit = resolveEventLimit(limit);
  const filtered = trackedSubprocessEvents.filter((event) => (
    entryMatchesTrackedFilters(event, {
      ownershipId: normalizedOwnershipId,
      ownershipPrefix: normalizedOwnershipPrefix
    })
  ));
  const sliced = filtered.slice(-resolvedLimit);
  return {
    ownershipId: normalizedOwnershipId,
    ownershipPrefix: normalizedOwnershipPrefix,
    total: filtered.length,
    returned: sliced.length,
    truncated: filtered.length > sliced.length,
    events: sliced
  };
};

const resetTrackedSubprocessEvents = () => {
  trackedSubprocessEvents.splice(0, trackedSubprocessEvents.length);
};

export {
  trackedSubprocesses,
  trackedSubprocessEvents,
  trackedOwnershipIdByAbortSignal,
  trackedSubprocessScopeContext,
  normalizeTrackedOwnershipId,
  normalizeTrackedScope,
  normalizeTrackedOwnershipPrefix,
  resolveTrackedOwnershipId,
  resolveTrackedScope,
  resolveEntryOwnershipId,
  entryMatchesOwnershipId,
  entryMatchesOwnershipPrefix,
  entryMatchesTrackedFilters,
  withTrackedSubprocessSignalScope,
  terminateTrackedSubprocesses,
  terminateTrackedSubprocessesSync,
  registerChildProcessForCleanup,
  getTrackedSubprocessCount,
  snapshotTrackedSubprocessEvents,
  resetTrackedSubprocessEvents
};
