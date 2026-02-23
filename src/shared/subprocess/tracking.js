import { AsyncLocalStorage } from 'node:async_hooks';
import { killChildProcessTree } from '../kill-tree.js';
import {
  TRACKED_SUBPROCESS_FORCE_GRACE_MS,
  resolveKillGraceMs,
  toNumber,
  toSafeArgList
} from './options.js';
import { installTrackedSubprocessHooks } from './signals.js';

const trackedSubprocesses = new Map();
const trackedOwnershipIdByAbortSignal = new WeakMap();
const trackedSubprocessScopeContext = new AsyncLocalStorage();

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

const removeTrackedSubprocess = (entryKey) => {
  const entry = trackedSubprocesses.get(entryKey);
  if (!entry) return null;
  trackedSubprocesses.delete(entryKey);
  try {
    entry.child?.off('close', entry.onClose);
  } catch {}
  return entry;
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
  const runOperation = async () => {
    if (bindSignal) trackedOwnershipIdByAbortSignal.set(signal, ownershipId);
    try {
      return await operation();
    } finally {
      if (bindSignal && trackedOwnershipIdByAbortSignal.get(signal) === ownershipId) {
        trackedOwnershipIdByAbortSignal.delete(signal);
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
  const entries = [];
  for (const [entryKey, entry] of trackedSubprocesses.entries()) {
    if (!entryMatchesTrackedFilters(entry, {
      ownershipId: normalizedOwnershipId,
      ownershipPrefix: normalizedOwnershipPrefix
    })) continue;
    const removed = removeTrackedSubprocess(entryKey);
    if (removed) entries.push(removed);
  }
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
  const killTargets = entries.map((entry) => ({
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
    awaitGrace: force === true
  })));
  const failures = settled.filter((result) => result.status === 'rejected').length;
  const killAudit = settled
    .map((result, index) => {
      const target = killTargets[index];
      if (result.status === 'rejected') {
        return {
          pid: target.pid,
          scope: target.scope,
          ownershipId: target.ownershipId,
          terminated: false,
          forced: false,
          error: result.reason?.message || String(result.reason || 'unknown_kill_error')
        };
      }
      return {
        pid: target.pid,
        scope: target.scope,
        ownershipId: target.ownershipId,
        terminated: result.value?.terminated === true,
        forced: result.value?.forced === true,
        error: null
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
  installTrackedSubprocessHooks(terminateTrackedSubprocesses);
  const entryKey = Symbol(`tracked-subprocess:${child.pid}`);
  const scope = resolveTrackedScope(options);
  const ownershipId = resolveTrackedOwnershipId(options) || scope;
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
    onClose: null
  };
  entry.onClose = () => {
    removeTrackedSubprocess(entryKey);
  };
  trackedSubprocesses.set(entryKey, entry);
  child.once('close', entry.onClose);
  return () => {
    removeTrackedSubprocess(entryKey);
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

export {
  trackedSubprocesses,
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
  registerChildProcessForCleanup,
  getTrackedSubprocessCount
};
