import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { formatDuration } from './metrics.js';

const isProcessAlive = (pid) => {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
};

const readLockInfo = async (lockPath) => {
  try {
    const raw = await fsPromises.readFile(lockPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

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
    const alive = pid ? isProcessAlive(pid) : null;
    const detail = { lockPath, ageMs, pid, alive };
    const isStale = (Number.isFinite(ageMs) && ageMs > lockStaleMs) || (pid && !alive);
    return { detail, isStale };
  };

  const clearIfStale = async (detail) => {
    try {
      await fsPromises.rm(lockPath, { force: true });
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
