import { killChildProcessTree, killChildProcessTreeSync } from '../kill-tree.js';
import { TRACKED_SUBPROCESS_FORCE_GRACE_MS } from './options.js';
import {
  appendTrackedSubprocessEvent,
  clearEntryTerminating,
  collectTerminationEntries,
  normalizeTrackedOwnershipId,
  normalizeTrackedOwnershipPrefix,
  normalizeTrackedScope,
  removeTrackedSubprocess,
  resolveEntryOwnershipId,
  resolveTerminationState
} from './tracking-runtime.js';

const normalizeTerminationOptions = ({
  reason,
  scope,
  ownershipId,
  ownershipPrefix
}) => {
  const normalizedScope = normalizeTrackedScope(scope);
  const normalizedOwnershipId = normalizeTrackedOwnershipId(ownershipId) || normalizedScope;
  const normalizedOwnershipPrefix = normalizeTrackedOwnershipPrefix(ownershipPrefix);
  return {
    reason,
    scope: normalizedScope,
    ownershipId: normalizedOwnershipId,
    ownershipPrefix: normalizedOwnershipPrefix
  };
};

const createEmptyTerminationSummary = ({
  reason,
  scope,
  ownershipId,
  ownershipPrefix
}) => ({
  reason,
  tracked: 0,
  attempted: 0,
  failures: 0,
  scope,
  ownershipId,
  ownershipPrefix,
  targetedPids: [],
  terminatedPids: [],
  ownershipIds: [],
  terminatedOwnershipIds: [],
  killAudit: []
});

const createKillTarget = ({ entryKey, entry }) => ({
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
});

const createKillAuditEntry = ({
  target,
  terminated,
  forced = false,
  error = null
}) => ({
  pid: target.pid,
  scope: target.scope,
  ownershipId: target.ownershipId,
  terminated,
  forced,
  error
});

const sortKillAudit = (killAudit) => killAudit.sort((left, right) => {
  const leftPid = Number.isFinite(left?.pid) ? left.pid : Number.MAX_SAFE_INTEGER;
  const rightPid = Number.isFinite(right?.pid) ? right.pid : Number.MAX_SAFE_INTEGER;
  if (leftPid !== rightPid) return leftPid - rightPid;
  return String(left?.ownershipId || '').localeCompare(String(right?.ownershipId || ''));
});

const appendKillAuditEvents = (killAudit, reason) => {
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
};

const summarizeKillAudit = (killAudit) => {
  const failures = killAudit.filter((entry) => Boolean(entry.error)).length;
  const targetedPids = killAudit.map((entry) => entry.pid).filter((pid) => Number.isFinite(pid));
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
    failures,
    targetedPids,
    terminatedPids,
    ownershipIds,
    terminatedOwnershipIds
  };
};

const createTerminationSummary = ({
  reason,
  tracked,
  scope,
  ownershipId,
  ownershipPrefix,
  killAudit
}) => {
  appendKillAuditEvents(killAudit, reason);
  return {
    reason,
    tracked,
    attempted: tracked,
    ...summarizeKillAudit(killAudit),
    scope,
    ownershipId,
    ownershipPrefix,
    killAudit
  };
};

export const terminateTrackedSubprocesses = async ({
  reason = 'shutdown',
  force = false,
  scope = null,
  ownershipId = null,
  ownershipPrefix = null
} = {}) => {
  const normalizedOptions = normalizeTerminationOptions({
    reason,
    scope,
    ownershipId,
    ownershipPrefix
  });
  const entries = collectTerminationEntries({
    ownershipId: normalizedOptions.ownershipId,
    ownershipPrefix: normalizedOptions.ownershipPrefix
  });
  if (!entries.length) {
    return createEmptyTerminationSummary(normalizedOptions);
  }
  const killTargets = entries.map(createKillTarget);
  const killAudit = [];
  const liveTargets = [];
  for (const target of killTargets) {
    const terminated = resolveTerminationState(target.child, target.pid);
    if (terminated) {
      removeTrackedSubprocess(target.entryKey, 'terminate_already_exited');
      killAudit.push(createKillAuditEntry({ target, terminated: true }));
      continue;
    }
    liveTargets.push(target);
  }
  const settled = await Promise.allSettled(liveTargets.map((entry) => killChildProcessTree(entry.child, {
    killTree: entry.killTree,
    killSignal: entry.killSignal,
    graceMs: force ? TRACKED_SUBPROCESS_FORCE_GRACE_MS : entry.killGraceMs,
    detached: entry.detached,
    awaitGrace: true
  })));
  const attemptedAudit = settled.map((result, index) => {
    const target = liveTargets[index];
    let terminated = resolveTerminationState(target.child, target.pid);
    let forced = false;
    let error = null;
    if (result.status === 'rejected') {
      error = result.reason?.message || String(result.reason || 'unknown_kill_error');
    } else {
      terminated = resolveTerminationState(target.child, target.pid, result.value?.terminated === true);
      forced = result.value?.forced === true;
    }
    if (terminated) {
      error = null;
      removeTrackedSubprocess(target.entryKey, 'terminate');
    } else {
      clearEntryTerminating(target.entry);
    }
    return createKillAuditEntry({
      target,
      terminated,
      forced,
      error
    });
  });
  killAudit.push(...attemptedAudit);
  sortKillAudit(killAudit);
  return createTerminationSummary({
    ...normalizedOptions,
    tracked: entries.length,
    killAudit
  });
};

export const terminateTrackedSubprocessesSync = ({
  reason = 'shutdown_sync',
  force = true,
  scope = null,
  ownershipId = null,
  ownershipPrefix = null
} = {}) => {
  const normalizedOptions = normalizeTerminationOptions({
    reason,
    scope,
    ownershipId,
    ownershipPrefix
  });
  const entries = collectTerminationEntries({
    ownershipId: normalizedOptions.ownershipId,
    ownershipPrefix: normalizedOptions.ownershipPrefix
  });
  if (!entries.length) {
    return createEmptyTerminationSummary(normalizedOptions);
  }
  const killAudit = entries.map((source) => {
    const target = createKillTarget(source);
    const alreadyTerminated = resolveTerminationState(target.child, target.pid);
    if (alreadyTerminated) {
      removeTrackedSubprocess(target.entryKey, 'terminate_sync_already_exited');
      return createKillAuditEntry({ target, terminated: true });
    }
    let terminated = resolveTerminationState(target.child, target.pid);
    let forcedFlag = false;
    let error = null;
    try {
      const result = killChildProcessTreeSync(target.child, {
        killTree: target.killTree,
        killSignal: target.killSignal,
        detached: target.detached,
        graceMs: force ? TRACKED_SUBPROCESS_FORCE_GRACE_MS : target.killGraceMs
      });
      terminated = resolveTerminationState(target.child, target.pid, result?.terminated === true);
      forcedFlag = result?.forced === true;
    } catch (caughtError) {
      terminated = resolveTerminationState(target.child, target.pid);
      error = caughtError?.message || String(caughtError || 'unknown_kill_error');
    }
    if (terminated) {
      error = null;
      removeTrackedSubprocess(target.entryKey, 'terminate_sync');
    } else {
      clearEntryTerminating(target.entry);
    }
    return createKillAuditEntry({
      target,
      terminated,
      forced: forcedFlag,
      error
    });
  });
  sortKillAudit(killAudit);
  return createTerminationSummary({
    ...normalizedOptions,
    tracked: entries.length,
    killAudit
  });
};
