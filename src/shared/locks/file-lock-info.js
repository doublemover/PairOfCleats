import fsSync from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { isFileLockPublicationPending } from './file-lock-publication.js';
import { readJsonResourceText, readJsonResourceTextSync } from '../file-read-resource.js';
import { observeStorageResource } from '../storage/failure-observation.js';
import {
  DISALLOWED_LOCK_METADATA_KEYS,
  RESERVED_LOCK_METADATA_KEYS
} from './file-lock-constants.js';

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

/** ESRCH proves local death; permission/unknown errors never authorize recovery. */
export const isLocalProcessDefinitelyDead = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return false; }
  catch (error) { return error?.code === 'ESRCH'; }
};

/** A resource fence survives its admitting process until its owner settles it.
 * Unknown versions remain protected; neither age nor PID death proves closure.
 */
export const requiresLockResourceSettlement = info => Boolean(info && typeof info === 'object'
  && Object.hasOwn(info, 'resourceSettlementVersion'));

export const isOwnedBy = (info, owner) => {
  if (!owner || typeof owner !== 'object') return false;
  if (requiresLockResourceSettlement(info)) return typeof info.lockId === 'string'
    && info.lockId.length > 0 && owner.lockId === info.lockId;
  if (owner.lockId && info?.lockId) return owner.lockId === info.lockId;
  if (Number.isFinite(owner.pid) && Number.isFinite(Number(info?.pid))) return Number(owner.pid) === Number(info.pid);
  return false;
};

export const removeLockFileSyncIfOwned = (lockPath, owner, { force = false } = {}) => {
  if (!lockPath || isFileLockPublicationPending(lockPath)) return false;
  try {
    const info = readLockInfoSync(lockPath);
    if ((!force || requiresLockResourceSettlement(info)) && !isOwnedBy(info, owner)) return false;
    fsSync.rmSync(lockPath, { force: true });
    return true;
  } catch (error) {
    observeStorageResource(error, { phase: 'file-lock-remove-sync' }).requireSettled();
    return false;
  }
};

export const createLockId = () => {
  try {
    return randomUUID();
  } catch {
    return `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
};

export const createLockPayload = (metadata) => ({
  ...sanitizeLockMetadata(metadata),
  pid: process.pid,
  lockId: createLockId(),
  startedAt: new Date().toISOString()
});

export const resolveLockPid = (info) => {
  const parsed = Number(info?.pid);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const hasLockId = (info) => (
  typeof info?.lockId === 'string'
  && info.lockId.trim().length > 0
);

export const isInvalidLockInfo = (info) => {
  if (!info || typeof info !== 'object') return true;
  const pid = resolveLockPid(info);
  return !pid && !hasLockId(info);
};

export const createLockSnapshotFingerprint = (raw, stat) => {
  const hash = createHash('sha1').update(raw).digest('hex');
  return `${stat?.dev ?? ''}:${stat?.ino ?? ''}:${stat?.ctimeNs ?? stat?.ctimeMs ?? 0}:${stat?.mtimeNs ?? stat?.mtimeMs ?? 0}:${Number(stat?.size) || 0}:${hash}`;
};

export const readLockSnapshot = async (lockPath, staleMs) => {
  try {
    let stat;
    const raw = await readJsonResourceText(lockPath, null, opened => { stat = opened; });
    const ageMs = Date.now() - Number(stat?.mtimeMs || 0);
    return {
      exists: true,
      staleByMtime: ageMs > staleMs,
      ageMs,
      fingerprint: createLockSnapshotFingerprint(raw, stat)
    };
  } catch (error) {
    observeStorageResource(error, { phase: 'file-lock-snapshot' }).requireSettled();
    return {
      exists: false,
      staleByMtime: false,
      ageMs: 0,
      fingerprint: null
    };
  }
};

export const isStableStaleSnapshot = (before, after) => (
  Boolean(before?.exists)
  && Boolean(after?.exists)
  && Boolean(before?.staleByMtime)
  && Boolean(after?.staleByMtime)
  && typeof before?.fingerprint === 'string'
  && before.fingerprint === after?.fingerprint
);

export const buildOwnerFromLockInfo = (info) => {
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
    const raw = readJsonResourceTextSync(lockPath);
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    observeStorageResource(error, { phase: 'file-lock-info-sync' }).requireSettled();
    return null;
  }
};

export const readLockInfo = async (lockPath) => {
  try {
    const raw = await readJsonResourceText(lockPath);
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    observeStorageResource(error, { phase: 'file-lock-info' }).requireSettled();
    return null;
  }
};
