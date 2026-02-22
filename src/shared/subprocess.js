import { spawn, spawnSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { killChildProcessTree } from './kill-tree.js';

const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;
const DEFAULT_KILL_GRACE_MS = 5000;
const TRACKED_SUBPROCESS_FORCE_GRACE_MS = 0;
const TRACKED_SUBPROCESS_TERMINATION_SIGNALS = Object.freeze(['SIGINT', 'SIGTERM']);
const TRACKED_SUBPROCESS_SNAPSHOT_DEFAULT_LIMIT = 8;
const TRACKED_SUBPROCESS_SNAPSHOT_MAX_LIMIT = 256;
const TRACKED_SUBPROCESS_ARGS_PREVIEW_MAX = 4;
const PROCESS_SNAPSHOT_DEFAULT_FRAME_LIMIT = 12;
const PROCESS_SNAPSHOT_MAX_FRAME_LIMIT = 64;
const PROCESS_SNAPSHOT_DEFAULT_HANDLE_TYPE_LIMIT = 8;
const PROCESS_SNAPSHOT_MAX_HANDLE_TYPE_LIMIT = 64;

const SHELL_MODE_DISABLED_ERROR = (
  'spawnSubprocess shell mode is disabled for security; pass an executable and args with shell=false.'
);

const trackedSubprocesses = new Map();
let trackedSubprocessHooksInstalled = false;
let trackedSubprocessShutdownTriggered = false;
let trackedSubprocessShutdownPromise = null;
const signalForwardInFlight = new Set();
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

export class SubprocessError extends Error {
  constructor(message, result, cause) {
    super(message);
    this.name = 'SubprocessError';
    this.code = 'SUBPROCESS_FAILED';
    this.result = result;
    if (cause) this.cause = cause;
  }
}

export class SubprocessTimeoutError extends Error {
  constructor(message, result) {
    super(message);
    this.name = 'SubprocessTimeoutError';
    this.code = 'SUBPROCESS_TIMEOUT';
    this.result = result;
  }
}

export class SubprocessAbortError extends Error {
  constructor(message, result) {
    super(message);
    this.name = 'AbortError';
    this.code = 'ABORT_ERR';
    this.result = result;
  }
}

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Resolve a conservative subprocess fanout preset for platform/filesystem.
 *
 * Callers can use this as a baseline and still apply explicit config
 * overrides. The preset intentionally prefers stability over maximal fanout on
 * higher startup-cost environments.
 *
 * @param {{platform?:string,cpuCount?:number,filesystemProfile?:'ntfs'|'posix'|'unknown'}} [input]
 * @returns {{maxParallelismHint:number,reason:string}}
 */
export const resolveSubprocessFanoutPreset = (input = {}) => {
  const platform = typeof input.platform === 'string' ? input.platform : process.platform;
  const filesystemProfile = typeof input.filesystemProfile === 'string'
    ? input.filesystemProfile
    : 'unknown';
  const cpuCount = Number.isFinite(Number(input.cpuCount))
    ? Math.max(1, Math.floor(Number(input.cpuCount)))
    : 1;
  if (platform === 'win32' || filesystemProfile === 'ntfs') {
    return {
      maxParallelismHint: Math.max(1, Math.min(cpuCount, Math.ceil(cpuCount * 0.75))),
      reason: 'win32-ntfs-startup-cost'
    };
  }
  if (filesystemProfile === 'posix') {
    return {
      maxParallelismHint: Math.max(1, cpuCount),
      reason: 'posix-default'
    };
  }
  return {
    maxParallelismHint: Math.max(1, Math.min(cpuCount, Math.ceil(cpuCount * 0.85))),
    reason: 'generic-conservative'
  };
};

const resolveMaxOutputBytes = (value) => {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_OUTPUT_BYTES;
  return Math.floor(parsed);
};

const resolveKillGraceMs = (value) => {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_KILL_GRACE_MS;
  return Math.floor(parsed);
};

const resolveExpectedExitCodes = (value) => {
  if (Array.isArray(value) && value.length) {
    const normalized = value
      .map((entry) => Math.trunc(Number(entry)))
      .filter(Number.isFinite);
    return normalized.length ? normalized : [0];
  }
  return [0];
};

const resolveSnapshotLimit = (value, fallback = TRACKED_SUBPROCESS_SNAPSHOT_DEFAULT_LIMIT) => {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(TRACKED_SUBPROCESS_SNAPSHOT_MAX_LIMIT, Math.floor(parsed)));
};

const resolveFrameLimit = (value) => {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return PROCESS_SNAPSHOT_DEFAULT_FRAME_LIMIT;
  return Math.max(1, Math.min(PROCESS_SNAPSHOT_MAX_FRAME_LIMIT, Math.floor(parsed)));
};

const resolveHandleTypeLimit = (value) => {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return PROCESS_SNAPSHOT_DEFAULT_HANDLE_TYPE_LIMIT;
  return Math.max(1, Math.min(PROCESS_SNAPSHOT_MAX_HANDLE_TYPE_LIMIT, Math.floor(parsed)));
};

const toIsoTimestamp = (value) => {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return new Date(parsed).toISOString();
};

const toSafeArgList = (value) => {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry));
};

const toSafeArgsPreview = (args) => (
  Array.isArray(args)
    ? args.slice(0, TRACKED_SUBPROCESS_ARGS_PREVIEW_MAX).map((entry) => String(entry))
    : []
);

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

const coerceOutputMode = (value) => (value === 'lines' ? 'lines' : 'string');

const coerceStdio = (value) => value ?? 'pipe';

const shouldCapture = (stdio, captureFlag, streamIndex) => {
  if (captureFlag === false) return false;
  if (captureFlag === true) return true;
  if (stdio === 'pipe') return true;
  if (Array.isArray(stdio)) return stdio[streamIndex] === 'pipe';
  return false;
};

const createCollector = ({ enabled, maxOutputBytes, encoding }) => {
  const chunks = [];
  let totalBytes = 0;
  const push = (chunk) => {
    if (!enabled) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    if (!buffer.length) return;
    chunks.push(buffer);
    totalBytes += buffer.length;
    while (totalBytes > maxOutputBytes && chunks.length) {
      const overflow = totalBytes - maxOutputBytes;
      const head = chunks[0];
      if (head.length <= overflow) {
        chunks.shift();
        totalBytes -= head.length;
      } else {
        chunks[0] = head.subarray(overflow);
        totalBytes -= overflow;
      }
    }
  };
  const toOutput = (mode) => {
    if (!enabled) return undefined;
    if (!chunks.length) return mode === 'lines' ? [] : '';
    const text = Buffer.concat(chunks).toString(encoding);
    if (mode !== 'lines') return text;
    const lines = text.split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines;
  };
  return { push, toOutput };
};

const buildResult = ({ pid, exitCode, signal, startedAt, stdout, stderr }) => ({
  pid,
  exitCode,
  signal,
  durationMs: Math.max(0, Date.now() - startedAt),
  stdout,
  stderr
});

const trimOutput = (value, maxBytes, encoding, mode) => {
  if (value == null) return mode === 'lines' ? [] : '';
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), encoding);
  if (buffer.length <= maxBytes) {
    const text = buffer.toString(encoding);
    if (mode !== 'lines') return text;
    const lines = text.split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines;
  }
  const tail = buffer.subarray(buffer.length - maxBytes);
  const text = tail.toString(encoding);
  if (mode !== 'lines') return text;
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
};

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
export const withTrackedSubprocessSignalScope = async (signal, scope, operation) => {
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
export const terminateTrackedSubprocesses = async ({
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

/**
 * Trigger one-time tracked-child shutdown for process teardown paths.
 *
 * @param {string} reason
 * @returns {Promise<unknown>}
 */
const triggerTrackedSubprocessShutdown = (reason) => {
  if (trackedSubprocessShutdownTriggered) return trackedSubprocessShutdownPromise;
  trackedSubprocessShutdownTriggered = true;
  trackedSubprocessShutdownPromise = terminateTrackedSubprocesses({ reason, force: true })
    .catch(() => null);
  return trackedSubprocessShutdownPromise;
};

const forwardSignalToDefault = (signal) => {
  const normalizedSignal = typeof signal === 'string' ? signal.trim() : '';
  if (!normalizedSignal || signalForwardInFlight.has(normalizedSignal)) return;
  signalForwardInFlight.add(normalizedSignal);
  try {
    process.kill(process.pid, normalizedSignal);
  } catch {}
  setImmediate(() => {
    signalForwardInFlight.delete(normalizedSignal);
  });
};

/**
 * Install process lifecycle hooks that flush tracked subprocesses before exit.
 *
 * Hooks include explicit termination signals so CI/job cancellation still runs
 * child cleanup even when Node would otherwise terminate by default handling.
 *
 * @returns {void}
 */
const installTrackedSubprocessHooks = () => {
  if (trackedSubprocessHooksInstalled) return;
  trackedSubprocessHooksInstalled = true;
  process.once('exit', () => {
    triggerTrackedSubprocessShutdown('process_exit');
  });
  process.on('uncaughtExceptionMonitor', () => {
    triggerTrackedSubprocessShutdown('uncaught_exception');
  });
  for (const signal of TRACKED_SUBPROCESS_TERMINATION_SIGNALS) {
    try {
      process.once(signal, () => {
        const hasAdditionalSignalHandlers = process.listenerCount(signal) > 0;
        void triggerTrackedSubprocessShutdown(`signal_${String(signal || '').toLowerCase()}`)
          .finally(() => {
            if (!hasAdditionalSignalHandlers) {
              forwardSignalToDefault(signal);
            }
          });
      });
    } catch {}
  }
};

export const registerChildProcessForCleanup = (child, options = {}) => {
  if (!child || !child.pid) {
    return () => {};
  }
  installTrackedSubprocessHooks();
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

export const getTrackedSubprocessCount = (scope = null) => {
  const ownershipId = normalizeTrackedOwnershipId(scope);
  if (!ownershipId) return trackedSubprocesses.size;
  let count = 0;
  for (const entry of trackedSubprocesses.values()) {
    if (entryMatchesOwnershipId(entry, ownershipId)) count += 1;
  }
  return count;
};

export const snapshotTrackedSubprocesses = ({
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

export const captureProcessSnapshot = ({
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

export function spawnSubprocess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const stdio = coerceStdio(options.stdio);
    const encoding = options.outputEncoding || 'utf8';
    const outputMode = coerceOutputMode(options.outputMode);
    const maxOutputBytes = resolveMaxOutputBytes(options.maxOutputBytes);
    const captureStdout = shouldCapture(stdio, options.captureStdout, 1);
    const captureStderr = shouldCapture(stdio, options.captureStderr, 2);
    const rejectOnNonZeroExit = options.rejectOnNonZeroExit !== false;
    const expectedExitCodes = resolveExpectedExitCodes(options.expectedExitCodes);
    const detached = typeof options.detached === 'boolean'
      ? options.detached
      : process.platform !== 'win32';
    const killTree = options.killTree !== false;
    const killSignal = options.killSignal || 'SIGTERM';
    const killGraceMs = resolveKillGraceMs(options.killGraceMs);
    const cleanupOnParentExit = typeof options.cleanupOnParentExit === 'boolean'
      ? options.cleanupOnParentExit
      : !(options.unref === true && detached === true);
    const abortSignal = options.signal || null;
    const trackedScopeContext = trackedSubprocessScopeContext.getStore() || null;
    const inheritedOwnershipId = normalizeTrackedOwnershipId(options.ownershipId ?? options.ownerId)
      || normalizeTrackedOwnershipId(trackedOwnershipIdByAbortSignal.get(abortSignal))
      || normalizeTrackedOwnershipId(trackedScopeContext?.ownershipId ?? trackedScopeContext?.scope);
    const cleanupScope = normalizeTrackedScope(options.cleanupScope)
      || normalizeTrackedScope(options.scope)
      || inheritedOwnershipId;
    if (abortSignal?.aborted) {
      const result = buildResult({
        pid: null,
        exitCode: null,
        signal: null,
        startedAt,
        stdout: undefined,
        stderr: undefined
      });
      reject(new SubprocessAbortError('Operation aborted', result));
      return;
    }
    const stdoutCollector = createCollector({ enabled: captureStdout, maxOutputBytes, encoding });
    const stderrCollector = createCollector({ enabled: captureStderr, maxOutputBytes, encoding });
    if (options.shell === true) {
      const result = buildResult({
        pid: null,
        exitCode: null,
        signal: null,
        startedAt,
        stdout: undefined,
        stderr: undefined
      });
      reject(new SubprocessError(SHELL_MODE_DISABLED_ERROR, result));
      return;
    }
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio, shell: false, detached });
    let unregisterTrackedChild = () => {};
    if (cleanupOnParentExit) {
      unregisterTrackedChild = registerChildProcessForCleanup(child, {
        killTree,
        killSignal,
        killGraceMs,
        detached,
        scope: cleanupScope,
        ownershipId: inheritedOwnershipId || cleanupScope,
        command,
        args,
        name: options.name || null,
        startedAtMs: startedAt
      });
    }
    if (options.input != null && child.stdin) {
      try {
        child.stdin.write(options.input);
        child.stdin.end();
      } catch {}
    }
    if (typeof options.onSpawn === 'function') {
      try {
        options.onSpawn(child);
      } catch {}
    }
    if (options.unref === true) {
      child.unref();
    }
    let settled = false;
    let timeoutId = null;
    let abortHandler = null;
    const onStdout = typeof options.onStdout === 'function' ? options.onStdout : null;
    const onStderr = typeof options.onStderr === 'function' ? options.onStderr : null;
    const handleOutput = (collector, handler) => (chunk) => {
      collector.push(chunk);
      if (handler) {
        handler(Buffer.isBuffer(chunk) ? chunk.toString(encoding) : String(chunk));
      }
    };
    const onStdoutData = captureStdout || onStdout
      ? handleOutput(stdoutCollector, onStdout)
      : null;
    const onStderrData = captureStderr || onStderr
      ? handleOutput(stderrCollector, onStderr)
      : null;
    if (onStdoutData && child.stdout) {
      child.stdout.on('data', onStdoutData);
    }
    if (onStderrData && child.stderr) {
      child.stderr.on('data', onStderrData);
    }
    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (abortHandler && abortSignal) {
        abortSignal.removeEventListener('abort', abortHandler);
      }
      unregisterTrackedChild();
      if (onStdoutData && child.stdout) child.stdout.off('data', onStdoutData);
      if (onStderrData && child.stderr) child.stderr.off('data', onStderrData);
    };
    const finalize = (exitCode, signal) => {
      const result = buildResult({
        pid: child.pid,
        exitCode,
        signal,
        startedAt,
        stdout: stdoutCollector.toOutput(outputMode),
        stderr: stderrCollector.toOutput(outputMode)
      });
      if (!rejectOnNonZeroExit || expectedExitCodes.includes(exitCode ?? -1)) {
        resolve(result);
        return;
      }
      const name = options.name ? `${options.name} ` : '';
      reject(new SubprocessError(`${name}exited with code ${exitCode ?? 'unknown'}`, result));
    };
    const resolvedTimeoutMs = toNumber(options.timeoutMs);
    if (Number.isFinite(resolvedTimeoutMs) && resolvedTimeoutMs > 0) {
      timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          if (typeof child.unref === 'function') child.unref();
        } catch {}
        killChildProcessTree(child, {
          killTree,
          killSignal,
          graceMs: killGraceMs,
          detached,
          awaitGrace: false
        }).catch(() => {});
        cleanup();
        const result = buildResult({
          pid: child.pid,
          exitCode: null,
          signal: null,
          startedAt,
          stdout: stdoutCollector.toOutput(outputMode),
          stderr: stderrCollector.toOutput(outputMode)
        });
        reject(new SubprocessTimeoutError('Subprocess timeout', result));
      }, Math.max(1, resolvedTimeoutMs));
    }
    abortHandler = () => {
      if (settled) return;
      settled = true;
      try {
        if (typeof child.unref === 'function') child.unref();
      } catch {}
      killChildProcessTree(child, {
        killTree,
        killSignal,
        graceMs: killGraceMs,
        detached,
        awaitGrace: false
      }).catch(() => {});
      cleanup();
      const result = buildResult({
        pid: child.pid,
        exitCode: null,
        signal: null,
        startedAt,
        stdout: stdoutCollector.toOutput(outputMode),
        stderr: stderrCollector.toOutput(outputMode)
      });
      reject(new SubprocessAbortError('Operation aborted', result));
    };
    if (abortSignal) {
      abortSignal.addEventListener('abort', abortHandler, { once: true });
    }
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      const result = buildResult({
        pid: child.pid,
        exitCode: null,
        signal: null,
        startedAt,
        stdout: stdoutCollector.toOutput(outputMode),
        stderr: stderrCollector.toOutput(outputMode)
      });
      reject(new SubprocessError(err?.message || 'Subprocess failed', result, err));
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      finalize(code, signal);
    });
  });
}

export function spawnSubprocessSync(command, args, options = {}) {
  const startedAt = Date.now();
  const stdio = coerceStdio(options.stdio);
  const encoding = options.outputEncoding || 'utf8';
  const outputMode = coerceOutputMode(options.outputMode);
  const maxOutputBytes = resolveMaxOutputBytes(options.maxOutputBytes);
  const captureStdout = shouldCapture(stdio, options.captureStdout, 1);
  const captureStderr = shouldCapture(stdio, options.captureStderr, 2);
  const rejectOnNonZeroExit = options.rejectOnNonZeroExit !== false;
  const expectedExitCodes = resolveExpectedExitCodes(options.expectedExitCodes);
  if (options.shell === true) {
    const normalized = buildResult({
      pid: null,
      exitCode: null,
      signal: null,
      startedAt,
      stdout: captureStdout ? (outputMode === 'lines' ? [] : '') : undefined,
      stderr: captureStderr ? (outputMode === 'lines' ? [] : '') : undefined
    });
    throw new SubprocessError(SHELL_MODE_DISABLED_ERROR, normalized);
  }
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio,
    shell: false,
    input: options.input,
    encoding: captureStdout || captureStderr ? 'buffer' : undefined
  });
  const stdout = captureStdout
    ? trimOutput(result.stdout, maxOutputBytes, encoding, outputMode)
    : undefined;
  const stderr = captureStderr
    ? trimOutput(result.stderr, maxOutputBytes, encoding, outputMode)
    : undefined;
  const normalized = buildResult({
    pid: result.pid ?? null,
    exitCode: result.status ?? null,
    signal: result.signal ?? null,
    startedAt,
    stdout,
    stderr
  });
  if (result.error) {
    const name = options.name ? `${options.name} ` : '';
    throw new SubprocessError(
      `${name}failed to spawn: ${result.error.message || result.error}`,
      normalized,
      result.error
    );
  }
  if (!rejectOnNonZeroExit || expectedExitCodes.includes(normalized.exitCode ?? -1)) {
    return normalized;
  }
  const name = options.name ? `${options.name} ` : '';
  throw new SubprocessError(`${name}exited with code ${normalized.exitCode ?? 'unknown'}`, normalized);
}

/**
 * Run a Node.js script in an isolated process (sync).
 * @param {object} params
 * @param {string} params.script
 * @param {string[]} [params.args]
 * @param {string[]} [params.nodeArgs]
 * @param {Buffer|string|null} [params.input]
 * @param {object} [params.env]
 * @param {string} [params.cwd]
 * @param {number} [params.maxOutputBytes]
 * @param {'string'|'lines'} [params.outputMode]
 * @param {boolean} [params.captureStdout]
 * @param {boolean} [params.captureStderr]
 * @param {boolean} [params.rejectOnNonZeroExit]
 * @param {string} [params.name]
 * @returns {{pid:number|null,exitCode:number|null,signal:string|null,durationMs:number,stdout?:string|string[],stderr?:string|string[]}}
 */
/**
 * Run a Node.js inline script in an isolated process.
 * @param {object} params
 * @param {string} params.script
 * @param {string[]} [params.args]
 * @param {string[]} [params.nodeArgs]
 * @param {Buffer|string|null} [params.input]
 * @param {object} [params.env]
 * @param {string} [params.cwd]
 * @param {number} [params.maxOutputBytes]
 * @param {'string'|'lines'} [params.outputMode]
 * @param {boolean} [params.captureStdout]
 * @param {boolean} [params.captureStderr]
 * @param {boolean} [params.rejectOnNonZeroExit]
 * @param {string} [params.name]
 * @returns {{pid:number|null,exitCode:number|null,signal:string|null,durationMs:number,stdout?:string|string[],stderr?:string|string[]}}
 */
export function runIsolatedNodeScriptSync({
  script,
  args = [],
  nodeArgs = [],
  input = null,
  env,
  cwd,
  maxOutputBytes,
  outputMode = 'string',
  captureStdout = true,
  captureStderr = true,
  rejectOnNonZeroExit = false,
  name = 'node script'
} = {}) {
  if (!script || typeof script !== 'string') {
    throw new Error('runIsolatedNodeScriptSync requires a script string.');
  }
  const resolvedArgs = [...nodeArgs, '-e', script, ...args];
  return spawnSubprocessSync(process.execPath, resolvedArgs, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    input,
    maxOutputBytes,
    captureStdout,
    captureStderr,
    outputMode,
    rejectOnNonZeroExit,
    name
  });
}
