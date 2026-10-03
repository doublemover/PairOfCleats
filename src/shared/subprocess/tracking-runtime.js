import { AsyncLocalStorage } from 'node:async_hooks';
import {
  TRACKED_SUBPROCESS_EVENT_DEFAULT_LIMIT,
  TRACKED_SUBPROCESS_EVENT_MAX_LIMIT,
  resolveEventLimit,
  toIsoTimestamp,
  toNumber,
  toSafeArgList
} from './options.js';

export const trackedSubprocesses = new Map();
export const trackedSubprocessEvents = [];
export const trackedOwnershipIdByAbortSignal = new WeakMap();
export const trackedSubprocessScopeContext = new AsyncLocalStorage();

export const normalizeTrackedOwnershipId = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export const normalizeTrackedScope = (value) => normalizeTrackedOwnershipId(value);
export const normalizeTrackedOwnershipPrefix = (value) => normalizeTrackedOwnershipId(value);

export const resolveTrackedOwnershipId = (options = {}) => (
  normalizeTrackedOwnershipId(options.ownershipId ?? options.ownerId)
  || normalizeTrackedOwnershipId(options.scope ?? options.cleanupScope)
);

export const resolveTrackedScope = (options = {}) => (
  normalizeTrackedScope(options.scope ?? options.cleanupScope)
  || normalizeTrackedScope(options.ownershipId ?? options.ownerId)
);

export const resolveEntryOwnershipId = (entry) => (
  normalizeTrackedOwnershipId(entry?.ownershipId)
  || normalizeTrackedOwnershipId(entry?.scope)
);

export const entryMatchesOwnershipId = (entry, ownershipId) => {
  if (!ownershipId) return true;
  return resolveEntryOwnershipId(entry) === ownershipId
    || normalizeTrackedScope(entry?.scope) === ownershipId;
};

export const entryMatchesOwnershipPrefix = (entry, ownershipPrefix) => {
  if (!ownershipPrefix) return true;
  const ownershipId = resolveEntryOwnershipId(entry);
  if (ownershipId && ownershipId.startsWith(ownershipPrefix)) return true;
  const scope = normalizeTrackedScope(entry?.scope);
  return Boolean(scope && scope.startsWith(ownershipPrefix));
};

export const entryMatchesTrackedFilters = (entry, {
  ownershipId = null,
  ownershipPrefix = null
} = {}) => (
  entryMatchesOwnershipId(entry, ownershipId)
  && entryMatchesOwnershipPrefix(entry, ownershipPrefix)
);

export const appendTrackedSubprocessEvent = (event) => {
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

export const removeTrackedSubprocess = (entryKey, reason = 'unregister') => {
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

export const isChildExited = (child) => Boolean(
  !child
  || child.exitCode !== null
  || child.signalCode !== null
);

const isPidAlive = (pid) => {
  const numericPid = Number(pid);
  if (!Number.isFinite(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(Math.floor(numericPid), 0);
    return true;
  } catch (error) {
    if (error?.code === 'EPERM') return true;
    return false;
  }
};

export const resolveTerminationState = (child, pid, fallbackTerminated = false) => {
  if (fallbackTerminated === true) return true;
  if (isChildExited(child)) return true;
  return !isPidAlive(pid);
};

const markEntryTerminating = (entry) => {
  if (!entry || entry.terminating === true) return false;
  entry.terminating = true;
  return true;
};

export const clearEntryTerminating = (entry) => {
  if (!entry) return;
  entry.terminating = false;
};

export const collectTerminationEntries = ({
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

export const getTrackedSubprocessCount = (scope = null) => {
  const ownershipId = normalizeTrackedOwnershipId(scope);
  if (!ownershipId) return trackedSubprocesses.size;
  let count = 0;
  for (const entry of trackedSubprocesses.values()) {
    if (entryMatchesOwnershipId(entry, ownershipId)) count += 1;
  }
  return count;
};

export const snapshotTrackedSubprocessEvents = ({
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

export const resetTrackedSubprocessEvents = () => {
  trackedSubprocessEvents.splice(0, trackedSubprocessEvents.length);
};
