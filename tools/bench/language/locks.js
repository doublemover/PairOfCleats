import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { formatDuration } from './metrics.js';
import { isProcessAlive, readLockInfo } from '../../../src/shared/locks/file-lock.js';
import { isLocalProcessDefinitelyDead, requiresLockResourceSettlement } from '../../../src/shared/locks/file-lock-info.js';
import { removeLockFileIfOwned } from '../../../src/shared/locks/file-lock-owner.js';

const getLockAgeMs = async (lockPath, info) => {
  if (info?.startedAt) {
    const started = Date.parse(info.startedAt);
    if (Number.isFinite(started)) return Math.max(0, Date.now() - started);
  }
  try {
    const stat = await fsPromises.stat(lockPath);
    return Math.max(0, Date.now() - stat.mtimeMs);
  } catch {
    return null;
  }
};

export const formatLockDetail = (detail) => {
  if (!detail) return '';
  const parts = [];
  if (Number.isFinite(detail.ageMs)) {
    parts.push(`age ${formatDuration(detail.ageMs)}`);
  }
  if (Number.isFinite(detail.pid)) {
    parts.push(`pid ${detail.pid}`);
  }
  return parts.length ? `(${parts.join(', ')})` : '';
};

export const checkIndexLock = async ({
  repoCacheRoot,
  repoLabel,
  lockMode,
  lockWaitMs,
  lockStaleMs,
  onLog
}) => {
  const lockPath = path.join(repoCacheRoot, 'locks', 'index.lock');
  if (!fs.existsSync(lockPath)) return { ok: true };

  const readDetail = async () => {
    const info = await readLockInfo(lockPath);
    const ageMs = await getLockAgeMs(lockPath, info);
    const pid = Number.isFinite(Number(info?.pid)) ? Number(info.pid) : null;
    const resourcePending = requiresLockResourceSettlement(info);
    const alive = resourcePending ? null : pid ? isProcessAlive(pid) : null;
    const detail = { lockPath, ageMs, pid, alive, resourcePending,
      staleByAge: Number.isFinite(ageMs) && ageMs > lockStaleMs };
    // Age is diagnostic, never permission to erase a live/unknown writer. This
    // helper has no owner capability for reconciling a durable resource fence.
    const isStale = !resourcePending && isLocalProcessDefinitelyDead(pid);
    if (isStale) Object.defineProperty(detail, 'owner', { value: info });
    return { detail, isStale };
  };

  const clearIfStale = async (detail) => {
    try {
      if (!await removeLockFileIfOwned(lockPath, detail.owner, { swallowErrors: false })) return false;
      if (onLog) {
        onLog(`[lock] cleared stale lock for ${repoLabel} ${formatLockDetail(detail)}`);
      }
      return true;
    } catch (err) {
      if (onLog) {
        onLog(`[lock] failed to clear stale lock for ${repoLabel}: ${err?.message || err}`);
      }
      return false;
    }
  };

  const initial = await readDetail();
  if (initial.isStale) {
    const cleared = await clearIfStale(initial.detail);
    if (cleared) return { ok: true, cleared: true, detail: initial.detail };
  }

  if (lockMode === 'wait') {
    const deadline = Date.now() + lockWaitMs;
    while (Date.now() < deadline) {
      if (!fs.existsSync(lockPath)) return { ok: true };
      const current = await readDetail();
      if (current.isStale) {
        const cleared = await clearIfStale(current.detail);
        if (cleared) return { ok: true, cleared: true, detail: current.detail };
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return { ok: false, detail: initial.detail };
};
