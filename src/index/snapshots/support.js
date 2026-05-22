import path from 'node:path';
import { createError, ERROR_CODES } from '../../shared/error-codes.js';
import { readRegistryLockInfo } from '../registry-lock.js';

const RETENTION_TIERS = ['cache', 'forensic', 'pinned'];

const invalidRequest = (message, details = null) => createError(ERROR_CODES.INVALID_REQUEST, message, details);
const queueError = (message, details = null) => createError(ERROR_CODES.QUEUE_OVERLOADED, message, details);

export const normalizeSnapshotRetentionTier = (value, fallback = 'cache') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (!RETENTION_TIERS.includes(normalized)) {
    throw invalidRequest(`Invalid retention tier "${value}". Use ${RETENTION_TIERS.join('|')}.`);
  }
  return normalized;
};

export const buildSnapshotRetention = ({
  retentionTier = null,
  tags = [],
  hasFrozen = false,
  reason = null
} = {}) => {
  const normalizedTags = Array.isArray(tags) ? tags.filter(Boolean) : [];
  const tier = normalizeSnapshotRetentionTier(
    retentionTier,
    normalizedTags.length > 0
      ? 'pinned'
      : (hasFrozen === true ? 'forensic' : 'cache')
  );
  const inferredReason = reason
    || (tier === 'pinned'
      ? (normalizedTags.length > 0 ? 'tagged' : 'manual')
      : (tier === 'forensic' ? 'frozen_snapshot' : 'cache_default'));
  return {
    tier,
    reason: inferredReason
  };
};

export const buildSnapshotLockConflict = async (repoCacheRoot, action, details = {}) => {
  const lockPath = path.join(repoCacheRoot, 'locks', 'snapshots.lock');
  const lockInfo = await readRegistryLockInfo(repoCacheRoot, 'snapshots');
  const ownerPid = Number.isFinite(Number(lockInfo?.pid)) ? Math.trunc(Number(lockInfo.pid)) : null;
  const owner = typeof lockInfo?.owner === 'string' && lockInfo.owner.trim()
    ? lockInfo.owner.trim()
    : (typeof lockInfo?.scope === 'string' && lockInfo.scope.trim() ? lockInfo.scope.trim() : null);
  const operation = typeof lockInfo?.operation === 'string' && lockInfo.operation.trim()
    ? lockInfo.operation.trim()
    : null;
  const detailParts = [];
  if (owner) detailParts.push(owner);
  if (operation) detailParts.push(operation);
  if (ownerPid != null) detailParts.push(`pid ${ownerPid}`);
  const detailText = detailParts.length ? ` (${detailParts.join(', ')})` : '';
  return queueError(`Snapshot registry lock held; unable to ${action}.${detailText}`, {
    conflict: {
      lockPath,
      owner,
      operation,
      ownerPid,
      startedAt: typeof lockInfo?.startedAt === 'string' ? lockInfo.startedAt : null,
      snapshotId: typeof lockInfo?.snapshotId === 'string' ? lockInfo.snapshotId : null
    },
    ...details
  });
};
