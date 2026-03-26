import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createAbortError } from '../abort.js';
import { runSyncCommandWithTimeout, toSyncCommandExitCode } from '../subprocess/sync-command.js';

export const DEFAULT_FILE_LOCK_WAIT_MS = 0;
export const DEFAULT_FILE_LOCK_POLL_MS = 100;
export const DEFAULT_FILE_LOCK_STALE_MS = 30 * 60 * 1000;
const DEFAULT_WINDOWS_TASKLIST_TIMEOUT_MS = 2000;
const INVALID_LOCK_RECLAIM_GRACE_MS_DEFAULT = 5000;
const INVALID_LOCK_RECLAIM_GRACE_MS_MAX = 60000;
const RESERVED_LOCK_METADATA_KEYS = new Set(['pid', 'lockId', 'startedAt']);
const DISALLOWED_LOCK_METADATA_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const BENIGN_STALE_REMOVAL_RACE_CODES = new Set(['ENOENT', 'ENOTDIR']);
const lockRuntimeMetrics = {
  hookFailures: 0,
  parentMissingRetries: 0,
  staleRemoveOwnerFailedForceSucceeded: 0
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const sleepWithAbort = (ms, signal = null) => {
  if (!signal || typeof signal.aborted !== 'boolean') return sleep(ms);
  if (signal.aborted) return Promise.reject(createAbortError());
  return new Promise((resolve, reject) => {
    const timerId = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timerId);
      signal.removeEventListener('abort', onAbort);
      reject(createAbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
};

export const toNonNegativeNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const toPositiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const resolveInvalidLockReclaimGraceMs = ({
  staleMs,
  pollMs,
  overrideMs = null
} = {}) => {
  const override = Number(overrideMs);
  if (Number.isFinite(override) && override >= 0) {
    return Math.min(INVALID_LOCK_RECLAIM_GRACE_MS_MAX, Math.floor(override));
  }
  const staleWindow = Number(staleMs);
  const pollWindow = Number(pollMs);
  const staleBound = Number.isFinite(staleWindow) && staleWindow > 0
    ? Math.floor(Math.max(INVALID_LOCK_RECLAIM_GRACE_MS_DEFAULT, staleWindow * 0.1))
    : INVALID_LOCK_RECLAIM_GRACE_MS_DEFAULT;
  const pollBound = Number.isFinite(pollWindow) && pollWindow > 0
    ? Math.floor(Math.max(INVALID_LOCK_RECLAIM_GRACE_MS_DEFAULT, pollWindow * 8))
    : INVALID_LOCK_RECLAIM_GRACE_MS_DEFAULT;
  return Math.min(INVALID_LOCK_RECLAIM_GRACE_MS_MAX, Math.max(staleBound, pollBound));
};

const isBenignStaleRemovalRace = (error) => {
  const code = String(error?.code || '').toUpperCase();
  return BENIGN_STALE_REMOVAL_RACE_CODES.has(code);
};

const sanitizeLockMetadata = (metadata) => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const sanitized = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (DISALLOWED_LOCK_METADATA_KEYS.has(key)) continue;
    if (RESERVED_LOCK_METADATA_KEYS.has(key)) continue;
    sanitized[key] = value;
  }
  return sanitized;
};

export const createStaleRemovalFailureError = ({
  lockPath,
  info,
  pid,
  stale,
  cause,
  phase = 'stale_remove'
}) => {
  const message = [
    `[file-lock] stale lock cleanup failed for "${lockPath}"`,
    `phase=${phase}`,
    `cause=${String(cause?.code || cause?.name || 'UNKNOWN')}`
  ].join(' ');
  const error = new Error(message, { cause });
  error.code = 'ERR_FILE_LOCK_STALE_REMOVE_FAILED';
  error.lockPath = lockPath;
  error.phase = phase;
  error.pid = Number.isFinite(pid) ? pid : null;
  error.stale = Boolean(stale);
  error.causeCode = String(cause?.code || '');
  error.lockInfo = info && typeof info === 'object' ? info : null;
  return error;
};

export const isStructuredStaleRemovalFailureError = (error) => (
  error?.code === 'ERR_FILE_LOCK_STALE_REMOVE_FAILED'
);

const createLockReleaseFailureError = ({
  lockPath,
  cause = null,
  releaseResult,
  workerError = null
}) => {
  const causeCode = String(cause?.code || cause?.name || '');
  const resultCode = releaseResult === false ? 'RELEASE_RETURNED_FALSE' : 'RELEASE_THROW';
  const detailCode = causeCode || resultCode || 'UNKNOWN';
  const message = [
    `[file-lock] lock release failed for "${lockPath}"`,
    `cause=${detailCode}`
  ].join(' ');
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = 'ERR_FILE_LOCK_RELEASE_FAILED';
  error.lockPath = lockPath;
  error.causeCode = causeCode;
  error.releaseResult = releaseResult === undefined ? null : releaseResult;
  error.workerError = workerError || null;
  return error;
};

export const releaseFileLockOrThrow = async (
  lock,
  { workerError = null, releaseOptions = undefined } = {}
) => {
  if (!lock || typeof lock.release !== 'function') {
    throw new TypeError('releaseFileLockOrThrow requires a lock with a release() function.');
  }
  let releaseResult = null;
  let releaseError = null;
  try {
    releaseResult = await lock.release(releaseOptions);
  } catch (error) {
    releaseError = error;
  }
  if (releaseError || releaseResult !== true) {
    throw createLockReleaseFailureError({
      lockPath: typeof lock.lockPath === 'string' ? lock.lockPath : '<unknown-lock>',
      cause: releaseError,
      releaseResult,
      workerError
    });
  }
  return true;
};

export const createLockId = () => {
  try {
    return randomUUID();
  } catch {
    return `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
};

export const resolveLockPid = (info) => {
  const parsed = Number(info?.pid);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const hasLockId = (info) => (
  typeof info?.lockId === 'string'
  && info.lockId.trim().length > 0
);

const isInvalidLockInfo = (info) => {
  if (!info || typeof info !== 'object') return true;
  const pid = resolveLockPid(info);
  return !pid && !hasLockId(info);
};

const createLockSnapshotFingerprint = (raw, stat) => {
  const hash = createHash('sha1').update(raw).digest('hex');
  return `${Number(stat?.mtimeMs) || 0}:${Number(stat?.size) || 0}:${hash}`;
};

const readLockSnapshot = async (lockPath, staleMs) => {
  try {
    const [stat, raw] = await Promise.all([
      fs.stat(lockPath),
      fs.readFile(lockPath, 'utf8')
    ]);
    const ageMs = Date.now() - Number(stat?.mtimeMs || 0);
    return {
      exists: true,
      staleByMtime: ageMs > staleMs,
      ageMs,
      fingerprint: createLockSnapshotFingerprint(raw, stat)
    };
  } catch {
    return {
      exists: false,
      staleByMtime: false,
      ageMs: 0,
      fingerprint: null
    };
  }
};

const isStableStaleSnapshot = (before, after) => (
  Boolean(before?.exists)
  && Boolean(after?.exists)
  && Boolean(before?.staleByMtime)
  && Boolean(after?.staleByMtime)
  && typeof before?.fingerprint === 'string'
  && before.fingerprint === after?.fingerprint
);

export const safeInvokeHook = (hook, payload, { code = 'LOCK_HOOK_ERROR' } = {}) => {
  if (typeof hook !== 'function') return;
  try {
    hook(payload);
  } catch (err) {
    lockRuntimeMetrics.hookFailures += 1;
    const message = err?.message || String(err || 'unknown lock hook failure');
    try {
      process.emitWarning(`[file-lock] hook failed: ${message}`, { code });
    } catch {}
  }
};

const buildOwnerFromLockInfo = (info) => {
  if (!info || typeof info !== 'object') return null;
  const owner = {};
  if (typeof info.lockId === 'string' && info.lockId.trim()) {
    owner.lockId = info.lockId.trim();
  }
  const pid = resolveLockPid(info);
  if (pid) owner.pid = pid;
  return Object.keys(owner).length ? owner : null;
};

export const readLockInfoSync = (lockPath) => {
  try {
    const raw = fsSync.readFileSync(lockPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

export const readLockInfo = async (lockPath) => {
  try {
    const raw = await fs.readFile(lockPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

export const isProcessAlive = (pid) => {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch (err) {
    if (err?.code === 'EPERM') return true;
    return false;
  }
  if (process.platform !== 'win32') return true;
  try {
    const result = runSyncCommandWithTimeout(
      'tasklist',
      ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeoutMs: DEFAULT_WINDOWS_TASKLIST_TIMEOUT_MS
      }
    );
    if (toSyncCommandExitCode(result) == null && result?.error) {
      return true;
    }
    const output = String(result.stdout || '').trim();
    if (!output || /INFO:\s+No tasks are running/i.test(output)) return false;
    const line = output.split(/\r?\n/)[0] || '';
    const parts = line.split('","').map((part) => part.replace(/^"|"$/g, ''));
    const parsedPid = Number(parts[1] || '');
    return Number.isFinite(parsedPid) ? parsedPid === pid : true;
  } catch {
    return true;
  }
};

export const isLockStale = async (lockPath, staleMs = DEFAULT_FILE_LOCK_STALE_MS) => {
  const maxAge = toPositiveNumber(staleMs, DEFAULT_FILE_LOCK_STALE_MS);
  try {
    const info = await readLockInfo(lockPath);
    if (info?.startedAt) {
      const startedAt = Date.parse(info.startedAt);
      if (Number.isFinite(startedAt) && Date.now() - startedAt > maxAge) return true;
    }
    const stat = await fs.stat(lockPath);
    return Date.now() - stat.mtimeMs > maxAge;
  } catch {
    return false;
  }
};

const isOwnedBy = (info, owner) => {
  if (!owner || typeof owner !== 'object') return false;
  if (owner.lockId && info?.lockId) return owner.lockId === info.lockId;
  if (Number.isFinite(owner.pid) && Number.isFinite(Number(info?.pid))) {
    return Number(owner.pid) === Number(info.pid);
  }
  return false;
};

export const removeLockFileSyncIfOwned = (lockPath, owner, { force = false } = {}) => {
  if (!lockPath) return false;
  try {
    if (!force) {
      const info = readLockInfoSync(lockPath);
      if (!isOwnedBy(info, owner)) return false;
    }
    fsSync.rmSync(lockPath, { force: true });
    return true;
  } catch {
    return false;
  }
};

const removeLockFileIfOwned = async (lockPath, owner, { force = false, swallowErrors = true } = {}) => {
  if (!lockPath) return false;
  try {
    if (!force) {
      const info = await readLockInfo(lockPath);
      if (!isOwnedBy(info, owner)) return false;
    }
    await fs.rm(lockPath, { force: true });
    return true;
  } catch (err) {
    if (!swallowErrors) throw err;
    return false;
  }
};

export const removeStaleLockFile = async ({
  lockPath,
  info,
  staleMs
}) => {
  const staleOwner = buildOwnerFromLockInfo(info);
  if (!staleOwner) {
    return {
      removed: await removeLockFileIfOwned(lockPath, null, {
        force: true,
        swallowErrors: false
      }),
      removalMode: 'force'
    };
  }
  const before = await readLockSnapshot(lockPath, staleMs);
  const removedByOwner = await removeLockFileIfOwned(lockPath, staleOwner, {
    swallowErrors: false
  });
  if (removedByOwner) {
    return {
      removed: true,
      removalMode: 'owner'
    };
  }
  if (!before.exists) {
    return {
      removed: true,
      removalMode: 'owner'
    };
  }
  const after = await readLockSnapshot(lockPath, staleMs);
  if (!isStableStaleSnapshot(before, after)) {
    return {
      removed: false,
      removalMode: 'owner'
    };
  }
  const forceRemoved = await removeLockFileIfOwned(lockPath, null, {
    force: true,
    swallowErrors: false
  });
  if (forceRemoved) {
    lockRuntimeMetrics.staleRemoveOwnerFailedForceSucceeded += 1;
  }
  return {
    removed: forceRemoved,
    removalMode: forceRemoved ? 'owner-fallback-force' : 'owner'
  };
};

export const createLockPayload = (metadata) => ({
  ...sanitizeLockMetadata(metadata),
  pid: process.pid,
  lockId: createLockId(),
  startedAt: new Date().toISOString()
});

export const shouldCleanupStaleLock = async ({
  lockPath,
  info,
  staleMs,
  forceStaleCleanup,
  invalidLockGraceMs
}) => {
  const pid = resolveLockPid(info);
  const alive = pid ? isProcessAlive(pid) : false;
  const invalidLock = isInvalidLockInfo(info);
  let invalidLockGraceElapsed = false;
  if (invalidLock) {
    const snapshot = await readLockSnapshot(lockPath, staleMs);
    invalidLockGraceElapsed = snapshot.exists && snapshot.ageMs >= invalidLockGraceMs;
  }
  const stale = await isLockStale(lockPath, staleMs);
  const staleCleanup = invalidLockGraceElapsed
    || (stale && (forceStaleCleanup || !pid || (pid && !alive)));
  return {
    pid,
    alive,
    stale,
    staleCleanup,
    shouldCleanup: Boolean((pid && !alive) || staleCleanup)
  };
};

export const getFileLockRuntimeMetrics = () => ({
  hookFailures: Number(lockRuntimeMetrics.hookFailures) || 0,
  parentMissingRetries: Number(lockRuntimeMetrics.parentMissingRetries) || 0,
  staleRemoveOwnerFailedForceSucceeded: Number(lockRuntimeMetrics.staleRemoveOwnerFailedForceSucceeded) || 0
});

export const resetFileLockRuntimeMetricsForTests = () => {
  lockRuntimeMetrics.hookFailures = 0;
  lockRuntimeMetrics.parentMissingRetries = 0;
  lockRuntimeMetrics.staleRemoveOwnerFailedForceSucceeded = 0;
};

export const incrementParentMissingRetriesMetric = () => {
  lockRuntimeMetrics.parentMissingRetries += 1;
};

export { isBenignStaleRemovalRace };
