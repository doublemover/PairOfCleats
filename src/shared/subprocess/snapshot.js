import {
  TRACKED_SUBPROCESS_SNAPSHOT_DEFAULT_LIMIT,
  PROCESS_SNAPSHOT_DEFAULT_FRAME_LIMIT,
  PROCESS_SNAPSHOT_DEFAULT_HANDLE_TYPE_LIMIT,
  resolveKillGraceMs,
  resolveSnapshotLimit,
  resolveFrameLimit,
  resolveHandleTypeLimit,
  toIsoTimestamp,
  toNumber,
  toSafeArgList,
  toSafeArgsPreview
} from './options.js';
import {
  trackedSubprocesses,
  normalizeTrackedOwnershipId,
  normalizeTrackedOwnershipPrefix,
  normalizeTrackedScope,
  resolveEntryOwnershipId,
  entryMatchesTrackedFilters
} from './tracking.js';

const coerceTypeName = (value) => {
  if (!value) return 'unknown';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || 'unknown';
  }
  if (typeof value === 'function') {
    const trimmed = String(value.name || '').trim();
    return trimmed || 'anonymous';
  }
  if (typeof value === 'object' && typeof value.constructor?.name === 'string') {
    const trimmed = value.constructor.name.trim();
    if (trimmed) return trimmed;
  }
  return typeof value;
};

const summarizeResourceTypes = (list, typeLimit) => {
  const counts = new Map();
  for (const entry of list) {
    const type = coerceTypeName(entry);
    counts.set(type, (counts.get(type) || 0) + 1);
  }
  const sorted = Array.from(counts.entries())
    .sort((left, right) => {
      const delta = right[1] - left[1];
      if (delta !== 0) return delta;
      return left[0].localeCompare(right[0]);
    })
    .slice(0, typeLimit)
    .map(([type, count]) => ({ type, count }));
  return {
    count: list.length,
    byType: sorted
  };
};

const captureProcessStackSnapshot = (frameLimit = PROCESS_SNAPSHOT_DEFAULT_FRAME_LIMIT) => {
  const safeFrameLimit = resolveFrameLimit(frameLimit);
  let reportError = null;
  try {
    if (process.report && typeof process.report.getReport === 'function') {
      const report = process.report.getReport();
      const stackFrames = Array.isArray(report?.javascriptStack?.stack)
        ? report.javascriptStack.stack
          .map((entry) => String(entry || '').trim())
          .filter(Boolean)
        : [];
      return {
        source: 'process.report',
        message: typeof report?.javascriptStack?.message === 'string'
          ? report.javascriptStack.message
          : null,
        frames: stackFrames.slice(0, safeFrameLimit)
      };
    }
  } catch (error) {
    reportError = error?.message || String(error);
  }
  const fallbackStack = String(new Error('process snapshot').stack || '');
  const fallbackFrames = fallbackStack
    .split(/\r?\n/)
    .slice(1, safeFrameLimit + 1)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return {
    source: 'error.stack',
    message: reportError,
    frames: fallbackFrames
  };
};

const snapshotTrackedSubprocesses = ({
  scope = null,
  ownershipId = null,
  ownershipPrefix = null,
  limit = TRACKED_SUBPROCESS_SNAPSHOT_DEFAULT_LIMIT,
  includeArgs = false
} = {}) => {
  const normalizedScope = normalizeTrackedScope(scope);
  const normalizedOwnershipId = normalizeTrackedOwnershipId(ownershipId) || normalizedScope;
  const normalizedOwnershipPrefix = normalizeTrackedOwnershipPrefix(ownershipPrefix);
  const safeLimit = resolveSnapshotLimit(limit);
  const nowMs = Date.now();
  const entries = [];
  for (const entry of trackedSubprocesses.values()) {
    if (!entryMatchesTrackedFilters(entry, {
      ownershipId: normalizedOwnershipId,
      ownershipPrefix: normalizedOwnershipPrefix
    })) {
      continue;
    }
    const pid = Number.isFinite(Number(entry?.child?.pid)) ? Number(entry.child.pid) : null;
    const startedAtMs = toNumber(entry?.startedAtMs);
    const args = toSafeArgList(entry?.args);
    const snapshotEntry = {
      pid,
      scope: normalizeTrackedScope(entry?.scope),
      ownershipId: resolveEntryOwnershipId(entry),
      command: typeof entry?.command === 'string' && entry.command.trim()
        ? entry.command.trim()
        : null,
      name: typeof entry?.name === 'string' && entry.name.trim() ? entry.name.trim() : null,
      startedAt: toIsoTimestamp(startedAtMs),
      elapsedMs: Number.isFinite(startedAtMs) ? Math.max(0, nowMs - startedAtMs) : null,
      killTree: entry?.killTree !== false,
      killSignal: typeof entry?.killSignal === 'string' ? entry.killSignal : null,
      killGraceMs: resolveKillGraceMs(entry?.killGraceMs),
      detached: entry?.detached === true
    };
    if (includeArgs) {
      snapshotEntry.args = args;
    } else {
      snapshotEntry.argsPreview = toSafeArgsPreview(args);
      snapshotEntry.argCount = args.length;
    }
    entries.push(snapshotEntry);
  }
  entries.sort((left, right) => {
    const leftElapsed = Number.isFinite(left?.elapsedMs) ? left.elapsedMs : -1;
    const rightElapsed = Number.isFinite(right?.elapsedMs) ? right.elapsedMs : -1;
    if (leftElapsed !== rightElapsed) return rightElapsed - leftElapsed;
    const leftPid = Number.isFinite(left?.pid) ? left.pid : Number.MAX_SAFE_INTEGER;
    const rightPid = Number.isFinite(right?.pid) ? right.pid : Number.MAX_SAFE_INTEGER;
    if (leftPid !== rightPid) return leftPid - rightPid;
    return String(left?.ownershipId || '').localeCompare(String(right?.ownershipId || ''));
  });
  return {
    scope: normalizedScope,
    ownershipId: normalizedOwnershipId,
    ownershipPrefix: normalizedOwnershipPrefix,
    total: entries.length,
    returned: Math.min(entries.length, safeLimit),
    truncated: entries.length > safeLimit,
    entries: entries.slice(0, safeLimit)
  };
};

const captureProcessSnapshot = ({
  includeStack = true,
  frameLimit = PROCESS_SNAPSHOT_DEFAULT_FRAME_LIMIT,
  handleTypeLimit = PROCESS_SNAPSHOT_DEFAULT_HANDLE_TYPE_LIMIT
} = {}) => {
  const nowMs = Date.now();
  const safeHandleTypeLimit = resolveHandleTypeLimit(handleTypeLimit);
  const getActiveHandles = process['_getActiveHandles'];
  const getActiveRequests = process['_getActiveRequests'];
  let activeHandles = [];
  let activeRequests = [];
  try {
    activeHandles = typeof getActiveHandles === 'function'
      ? getActiveHandles.call(process)
      : [];
  } catch {
    activeHandles = [];
  }
  try {
    activeRequests = typeof getActiveRequests === 'function'
      ? getActiveRequests.call(process)
      : [];
  } catch {
    activeRequests = [];
  }
  const usage = typeof process.memoryUsage === 'function'
    ? process.memoryUsage()
    : {};
  return {
    capturedAt: toIsoTimestamp(nowMs),
    pid: process.pid,
    uptimeSec: Math.max(0, Math.floor(typeof process.uptime === 'function' ? process.uptime() : 0)),
    memory: {
      rssBytes: Number.isFinite(Number(usage?.rss)) ? Number(usage.rss) : null,
      heapTotalBytes: Number.isFinite(Number(usage?.heapTotal)) ? Number(usage.heapTotal) : null,
      heapUsedBytes: Number.isFinite(Number(usage?.heapUsed)) ? Number(usage.heapUsed) : null,
      externalBytes: Number.isFinite(Number(usage?.external)) ? Number(usage.external) : null,
      arrayBuffersBytes: Number.isFinite(Number(usage?.arrayBuffers)) ? Number(usage.arrayBuffers) : null
    },
    activeHandles: summarizeResourceTypes(activeHandles, safeHandleTypeLimit),
    activeRequests: summarizeResourceTypes(activeRequests, safeHandleTypeLimit),
    stack: includeStack ? captureProcessStackSnapshot(frameLimit) : null
  };
};

export { snapshotTrackedSubprocesses, captureProcessSnapshot };
