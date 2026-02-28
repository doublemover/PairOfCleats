import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createAbortError } from '../abort.js';

export const DEFAULT_FILE_LOCK_WAIT_MS = 0;
export const DEFAULT_FILE_LOCK_POLL_MS = 100;
export const DEFAULT_FILE_LOCK_STALE_MS = 30 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sleepWithAbort = (ms, signal = null) => {
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

const safeInvokeHook = (hook, payload, { code = 'LOCK_HOOK_ERROR' } = {}) => {
  if (typeof hook !== 'function') return;
  try {
    hook(payload);
  } catch (err) {
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

const removeStaleLockFile = async ({
  lockPath,
  info,
  staleMs
}) => {
  const staleOwner = buildOwnerFromLockInfo(info);
  if (!staleOwner) {
    return {
      removed: await removeLockFileIfOwned(lockPath, null, { force: true }),
      removalMode: 'force'
    };
  }
  const before = await readLockSnapshot(lockPath, staleMs);
  const removedByOwner = await removeLockFileIfOwned(lockPath, staleOwner);
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
  const forceRemoved = await removeLockFileIfOwned(lockPath, null, { force: true });
  return {
    removed: forceRemoved,
    removalMode: forceRemoved ? 'owner-fallback-force' : 'owner'
  };
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
 *  signal?:AbortSignal|null,
 *  onStale?:(info:{lockPath:string,info:object|null,pid:number|null,reason:'stale'|'dead-pid',removalMode?:'owner'|'force'|'owner-fallback-force'})=>void,
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
  signal = null,
  onStale = null,
  onBusy = null
} = {}) => {
  if (!lockPath) return null;
  const resolvedWaitMs = toNonNegativeNumber(waitMs, DEFAULT_FILE_LOCK_WAIT_MS);
  const resolvedPollMs = Math.max(1, toPositiveNumber(pollMs, DEFAULT_FILE_LOCK_POLL_MS));
  const resolvedStaleMs = toPositiveNumber(staleMs, DEFAULT_FILE_LOCK_STALE_MS);
  const lockSignal = signal && typeof signal.aborted === 'boolean' ? signal : null;
  if (lockSignal?.aborted) throw createAbortError();
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const deadline = resolvedWaitMs > 0 ? Date.now() + resolvedWaitMs : null;

  while (true) {
    if (lockSignal?.aborted) throw createAbortError();
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
          const { removed, removalMode } = await removeStaleLockFile({
            lockPath,
            info,
            staleMs: resolvedStaleMs
          });
          if (!removed) {
            if (deadline != null && Date.now() < deadline) {
              await sleepWithAbort(resolvedPollMs, lockSignal);
              continue;
            }
            safeInvokeHook(onBusy, { lockPath, info, pid });
            if (timeoutBehavior === 'throw') {
              throw new Error(timeoutMessage || 'Lock timeout.');
            }
            return null;
          }
          safeInvokeHook(onStale, {
            lockPath,
            info,
            pid,
            reason: pid && !alive ? 'dead-pid' : 'stale',
            removalMode
          });
          continue;
        } catch {}
      }
      if (deadline != null && Date.now() < deadline) {
        await sleepWithAbort(resolvedPollMs, lockSignal);
        continue;
      }
      safeInvokeHook(onBusy, { lockPath, info, pid });
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
