import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
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
  return `${Number(stat?.mtimeMs) || 0}:${Number(stat?.size) || 0}:${hash}`;
};

export const readLockSnapshot = async (lockPath, staleMs) => {
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
