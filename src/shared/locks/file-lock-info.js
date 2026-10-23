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

export const removeLockFileSyncIfOwned = (lockPath, owner, { force = false, expectedIdentity = null } = {}) => {
  if (!lockPath || isFileLockPublicationPending(lockPath)) return false;
  try {
    const { value: info, identity } = readLockRecordSync(lockPath);
    if (expectedIdentity && !sameFileLockIdentity(identity, expectedIdentity)) return false;
    if ((!force || requiresLockResourceSettlement(info)) && !isOwnedBy(info, owner)) return false;
    if (isFileLockPublicationPending(lockPath)) return false;
    const current = fsSync.lstatSync(lockPath, { bigint: true });
    if (!sameFileLockIdentity(captureFileLockIdentity(current), identity) || isFileLockPublicationPending(lockPath)) return false;
    if (fsSync.rmSync(lockPath, { force: true }) !== undefined) throw Object.assign(
      new Error('Original lock metadata removal did not confirm its standard void result.'), { cacheOwnershipPending: true });
    return true;
  } catch (error) {
    const observation = observeStorageResource(error, { phase: 'file-lock-remove-sync' });
    observation.requireSettled();
    if (force && readFileLockFailureCode(error) === 'ENOENT') return true;
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

export const readFileLockFailureCode = error => {
  const observation = observeStorageResource(error, { phase: 'file-lock-metadata-classification' });
  observation.requireSettled(); let code;
  try { code = observation.primary.code; } catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
  observation.requireSettled(); return code;
};
export const captureFileLockIdentity = stat => {
  if (!stat.isFile() || stat.ino === 0n || stat.nlink !== 1n) throw Object.assign(
    new Error('Lock metadata requires an exact ordinary single-link identity.'), { code: 'ERR_FILE_LOCK_METADATA_IDENTITY' });
  return Object.freeze({ dev: String(stat.dev), ino: String(stat.ino), mode: String(stat.mode), nlink: String(stat.nlink), size: String(stat.size),
    mtime: String(stat.mtimeNs ?? stat.mtimeMs), ctime: String(stat.ctimeNs ?? stat.ctimeMs), birthtime: String(stat.birthtimeNs ?? stat.birthtimeMs) });
};
export const sameFileLockIdentity = (left, right) => Boolean(left && right)
  && ['dev', 'ino', 'mode', 'nlink', 'size', 'mtime', 'ctime', 'birthtime'].every(key => left[key] === right[key]);
const parseLockRecordValue = raw => {
  try { const value = JSON.parse(raw); return value && typeof value === 'object' ? value : null; }
  catch (error) { observeStorageResource(error, { phase: 'file-lock-metadata-parse' }).requireSettled(); return null; }
};
/** Internal destructive consumers require a complete read and its exact seal.
 * Ordinary unreadable data is not the same evidence as completed corrupt JSON.
 */
export const readLockRecord = async lockPath => {
  let identity;
  const raw = await readJsonResourceText(lockPath, null, stat => { identity = captureFileLockIdentity(stat); });
  return { value: parseLockRecordValue(raw), identity };
};
export const readLockRecordSync = lockPath => {
  let identity;
  const raw = readJsonResourceTextSync(lockPath, null, stat => { identity = captureFileLockIdentity(stat); });
  return { value: parseLockRecordValue(raw), identity };
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
