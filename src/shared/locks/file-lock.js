import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export const DEFAULT_FILE_LOCK_WAIT_MS = 0;
export const DEFAULT_FILE_LOCK_POLL_MS = 100;
export const DEFAULT_FILE_LOCK_STALE_MS = 30 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const toNonNegativeNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const toPositiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const createLockId = () => {
  try {
    return randomUUID();
  } catch {
    return `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
};

const resolveLockPid = (info) => {
  const parsed = Number(info?.pid);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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
    const result = spawnSync(
      'tasklist',
      ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
      { encoding: 'utf8', windowsHide: true }
    );
    if (result.error) return true;
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

const removeLockFileIfOwned = async (lockPath, owner, { force = false } = {}) => {
  if (!lockPath) return false;
  try {
    if (!force) {
      const info = await readLockInfo(lockPath);
      if (!isOwnedBy(info, owner)) return false;
    }
    await fs.rm(lockPath, { force: true });
    return true;
  } catch {
    return false;
  }
};

/**
 * Acquire a file lock by creating a lockfile atomically.
 * @param {{
 *  lockPath:string,
 *  waitMs?:number,
 *  pollMs?:number,
 *  staleMs?:number,
 *  metadata?:object|null,
 *  forceStaleCleanup?:boolean,
 *  timeoutBehavior?:'null'|'throw',
 *  timeoutMessage?:string,
 *  onStale?:(info:{lockPath:string,info:object|null,pid:number|null,reason:'stale'|'dead-pid'})=>void,
 *  onBusy?:(info:{lockPath:string,info:object|null,pid:number|null})=>void
 * }} input
 * @returns {Promise<{lockPath:string,payload:object,release:(opts?:{force?:boolean})=>Promise<boolean>}|null>}
 */
export const acquireFileLock = async ({
  lockPath,
  waitMs = DEFAULT_FILE_LOCK_WAIT_MS,
  pollMs = DEFAULT_FILE_LOCK_POLL_MS,
  staleMs = DEFAULT_FILE_LOCK_STALE_MS,
  metadata = null,
  forceStaleCleanup = false,
  timeoutBehavior = 'null',
  timeoutMessage = 'Lock timeout.',
  onStale = null,
  onBusy = null
} = {}) => {
  if (!lockPath) return null;
  const resolvedWaitMs = toNonNegativeNumber(waitMs, DEFAULT_FILE_LOCK_WAIT_MS);
  const resolvedPollMs = Math.max(1, toPositiveNumber(pollMs, DEFAULT_FILE_LOCK_POLL_MS));
  const resolvedStaleMs = toPositiveNumber(staleMs, DEFAULT_FILE_LOCK_STALE_MS);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const deadline = resolvedWaitMs > 0 ? Date.now() + resolvedWaitMs : null;

  while (true) {
    const payload = {
      pid: process.pid,
      lockId: createLockId(),
      startedAt: new Date().toISOString(),
      ...(metadata && typeof metadata === 'object' ? metadata : {})
    };
    try {
      const handle = await fs.open(lockPath, 'wx');
      try {
        await handle.writeFile(JSON.stringify(payload));
      } finally {
        await handle.close();
      }
      return {
        lockPath,
        payload,
        release: async (options = {}) => removeLockFileIfOwned(lockPath, payload, options)
      };
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
      const info = await readLockInfo(lockPath);
      const pid = resolveLockPid(info);
      const alive = pid ? isProcessAlive(pid) : false;
      const stale = await isLockStale(lockPath, resolvedStaleMs);
      const staleCleanup = stale && (forceStaleCleanup || !pid || (pid && !alive));
      if ((pid && !alive) || staleCleanup) {
        try {
          await fs.rm(lockPath, { force: true });
          if (typeof onStale === 'function') {
            onStale({
              lockPath,
              info,
              pid,
              reason: pid && !alive ? 'dead-pid' : 'stale'
            });
          }
          continue;
        } catch {}
      }
      if (deadline != null && Date.now() < deadline) {
        await sleep(resolvedPollMs);
        continue;
      }
      if (typeof onBusy === 'function') onBusy({ lockPath, info, pid });
      if (timeoutBehavior === 'throw') {
        throw new Error(timeoutMessage || 'Lock timeout.');
      }
      return null;
    }
  }
};

/**
 * Acquire a lock, run work, then release lock.
 * Returns null if lock couldn't be acquired.
 * @param {object} options
 * @param {(lock:{lockPath:string,payload:object,release:(opts?:{force?:boolean})=>Promise<boolean>})=>Promise<any>} worker
 */
export const withFileLock = async (options, worker) => {
  const lock = await acquireFileLock(options);
  if (!lock) return null;
  try {
    return await worker(lock);
  } finally {
    await lock.release();
  }
};
