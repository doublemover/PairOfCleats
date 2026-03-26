import fs from 'node:fs/promises';
import path from 'node:path';
import { createAbortError } from '../abort.js';
import {
  createLockPayload,
  createStaleRemovalFailureError,
  DEFAULT_FILE_LOCK_POLL_MS,
  DEFAULT_FILE_LOCK_STALE_MS,
  DEFAULT_FILE_LOCK_WAIT_MS,
  getFileLockRuntimeMetrics,
  incrementParentMissingRetriesMetric,
  isBenignStaleRemovalRace,
  isStructuredStaleRemovalFailureError,
  readLockInfo,
  readLockInfoSync,
  releaseFileLockOrThrow,
  removeLockFileSyncIfOwned,
  removeStaleLockFile,
  resetFileLockRuntimeMetricsForTests,
  resolveInvalidLockReclaimGraceMs,
  resolveLockPid,
  safeInvokeHook,
  shouldCleanupStaleLock,
  sleepWithAbort,
  toNonNegativeNumber
} from './file-lock-runtime.js';

export {
  DEFAULT_FILE_LOCK_POLL_MS,
  DEFAULT_FILE_LOCK_STALE_MS,
  DEFAULT_FILE_LOCK_WAIT_MS,
  getFileLockRuntimeMetrics,
  isProcessAlive,
  isLockStale,
  readLockInfo,
  readLockInfoSync,
  releaseFileLockOrThrow,
  removeLockFileSyncIfOwned,
  resetFileLockRuntimeMetricsForTests
} from './file-lock-runtime.js';

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
 *  invalidLockGraceMs?:number,
 *  signal?:AbortSignal|null,
 *  staleRemovalImpl?:(input:{lockPath:string,info:object|null,staleMs:number})=>Promise<{removed:boolean,removalMode:'owner'|'force'|'owner-fallback-force'}>,
 *  onStale?:(info:{lockPath:string,info:object|null,pid:number|null,reason:'stale'|'dead-pid',removalMode?:'owner'|'force'|'owner-fallback-force'})=>void,
 *  onBusy?:(info:{lockPath:string,info:object|null,pid:number|null,reason?:'parent_missing',retries?:number})=>void
 * }} input
 * @returns {Promise<{lockPath:string,payload:object,diagnostics:{parentMissingRetries:number},release:(opts?:{force?:boolean})=>Promise<boolean>}|null>}
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
  invalidLockGraceMs = null,
  signal = null,
  staleRemovalImpl = removeStaleLockFile,
  onStale = null,
  onBusy = null
} = {}) => {
  if (!lockPath) return null;
  const resolvedWaitMs = toNonNegativeNumber(waitMs, DEFAULT_FILE_LOCK_WAIT_MS);
  const resolvedPollMs = Math.max(1, toNonNegativeNumber(pollMs, DEFAULT_FILE_LOCK_POLL_MS) || 1);
  const resolvedStaleMs = Math.max(1, Number(staleMs) || DEFAULT_FILE_LOCK_STALE_MS);
  const resolvedInvalidLockGraceMs = resolveInvalidLockReclaimGraceMs({
    staleMs: resolvedStaleMs,
    pollMs: resolvedPollMs,
    overrideMs: invalidLockGraceMs
  });
  const lockSignal = signal && typeof signal.aborted === 'boolean' ? signal : null;
  if (lockSignal?.aborted) throw createAbortError();
  const deadline = resolvedWaitMs > 0 ? Date.now() + resolvedWaitMs : null;
  let parentMissingRetries = 0;

  while (true) {
    if (lockSignal?.aborted) throw createAbortError();
    const payload = createLockPayload(metadata);
    try {
      const handle = await fs.open(lockPath, 'wx');
      let closed = false;
      const closeHandle = async () => {
        if (closed) return;
        closed = true;
        await handle.close();
      };
      try {
        await handle.writeFile(JSON.stringify(payload));
        await closeHandle();
      } catch (writeError) {
        try {
          await closeHandle();
        } catch {}
        await fs.rm(lockPath, { force: true }).catch(() => {});
        throw writeError;
      }
      return {
        lockPath,
        payload,
        diagnostics: {
          parentMissingRetries
        },
        release: async (options = {}) => {
          const info = await readLockInfo(lockPath);
          if (!info || info.lockId !== payload.lockId) return false;
          await fs.rm(lockPath, { force: true });
          return true;
        }
      };
    } catch (err) {
      if (err?.code === 'ENOENT') {
        parentMissingRetries += 1;
        incrementParentMissingRetriesMetric();
        let parentReady = false;
        try {
          await fs.mkdir(path.dirname(lockPath), { recursive: true });
          parentReady = true;
        } catch (mkdirErr) {
          if (mkdirErr?.code !== 'ENOENT' && mkdirErr?.code !== 'ENOTDIR') {
            throw err;
          }
        }
        if (!parentReady && resolvedWaitMs <= 0) {
          throw err;
        }
        if (parentReady) {
          continue;
        }
        if (deadline != null && Date.now() < deadline) {
          await sleepWithAbort(resolvedPollMs, lockSignal);
          continue;
        }
        safeInvokeHook(onBusy, {
          lockPath,
          info: null,
          pid: null,
          reason: 'parent_missing',
          retries: parentMissingRetries
        });
        if (timeoutBehavior === 'throw') {
          throw new Error(timeoutMessage || 'Lock timeout.');
        }
        return null;
      }
      if (err?.code !== 'EEXIST') throw err;
      const info = await readLockInfo(lockPath);
      const cleanupState = await shouldCleanupStaleLock({
        lockPath,
        info,
        staleMs: resolvedStaleMs,
        forceStaleCleanup,
        invalidLockGraceMs: resolvedInvalidLockGraceMs
      });
      if (cleanupState.shouldCleanup) {
        try {
          const { removed, removalMode } = await staleRemovalImpl({
            lockPath,
            info,
            staleMs: resolvedStaleMs
          });
          if (!removed) {
            if (deadline != null && Date.now() < deadline) {
              await sleepWithAbort(resolvedPollMs, lockSignal);
              continue;
            }
            safeInvokeHook(onBusy, { lockPath, info, pid: cleanupState.pid });
            if (timeoutBehavior === 'throw') {
              throw new Error(timeoutMessage || 'Lock timeout.');
            }
            return null;
          }
          safeInvokeHook(onStale, {
            lockPath,
            info,
            pid: cleanupState.pid,
            reason: cleanupState.pid && !cleanupState.alive ? 'dead-pid' : 'stale',
            removalMode
          });
          continue;
        } catch (cleanupError) {
          if (cleanupError?.code === 'ABORT_ERR') throw cleanupError;
          if (isStructuredStaleRemovalFailureError(cleanupError)) throw cleanupError;
          if (isBenignStaleRemovalRace(cleanupError)) {
            if (deadline != null && Date.now() < deadline) {
              await sleepWithAbort(resolvedPollMs, lockSignal);
              continue;
            }
            safeInvokeHook(onBusy, { lockPath, info, pid: cleanupState.pid });
            if (timeoutBehavior === 'throw') {
              throw new Error(timeoutMessage || 'Lock timeout.');
            }
            return null;
          }
          throw createStaleRemovalFailureError({
            lockPath,
            info,
            pid: cleanupState.pid,
            stale: cleanupState.staleCleanup || Boolean(cleanupState.pid && !cleanupState.alive),
            cause: cleanupError,
            phase: 'acquire'
          });
        }
      }
      const pid = resolveLockPid(info);
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
  let workerResult;
  let workerError = null;
  try {
    workerResult = await worker(lock);
  } catch (error) {
    workerError = error;
  }
  await releaseFileLockOrThrow(lock, { workerError });
  if (workerError) throw workerError;
  return workerResult;
};
