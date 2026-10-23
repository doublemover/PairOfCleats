import fs from 'node:fs/promises';
import path from 'node:path';
import { createAbortError } from '../abort.js';
import { observeStorageResource } from '../storage/failure-observation.js';
import { isFileLockPublicationPending, publishFileLock } from './file-lock-publication.js';
export { isFileLockPublicationSession, isFileLockPublicationPending } from './file-lock-publication.js';
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
 *  onBusy?:(info:{lockPath:string,info:object|null,pid:number|null,reason?:'parent_missing'|'publication-pending',retries?:number})=>void
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
    if (isFileLockPublicationPending(lockPath)) {
      if (deadline != null && Date.now() < deadline) { await sleepWithAbort(resolvedPollMs, lockSignal); continue; }
      safeInvokeHook(onBusy, { lockPath, info: null, pid: process.pid, reason: 'publication-pending' });
      if (timeoutBehavior === 'throw') throw new Error(timeoutMessage || 'Lock timeout.');
      return null;
    }
    const payload = createLockPayload(metadata);
    const expectedOwner = { lockId: payload.lockId, pid: payload.pid, startedAt: payload.startedAt };
    const contents = JSON.stringify(payload);
    const persisted = typeof contents === 'string' ? JSON.parse(contents) : null;
    if (!persisted || Array.isArray(persisted) || persisted.lockId !== expectedOwner.lockId
      || persisted.pid !== expectedOwner.pid || persisted.startedAt !== expectedOwner.startedAt) {
      throw new TypeError('File lock metadata must preserve its generated owner identity.');
    }
    let opened = false;
    try {
      const handle = await fs.open(lockPath, 'wx');
      opened = true;
      return await publishFileLock({ handle, lockPath, payload: persisted, contents, diagnostics: { parentMissingRetries } });
    } catch (err) {
      if (opened) throw err;
      const observation = observeStorageResource(err, { phase: 'file-lock-open' });
      observation.requireSettled();
      let code, syscall;
      try { code = observation.primary.code; syscall = observation.primary.syscall; }
      catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
      observation.requireSettled();
      // Windows can retain a delete-pending file object until another native
      // handle closes. CREATE_NEW reports EPERM (not EEXIST) during that gap.
      // Keep the existing acquisition bound; persistent denial still throws
      // the original filesystem error and never enters stale-owner cleanup.
      if (process.platform === 'win32' && code === 'EPERM' && syscall === 'open'
        && deadline != null && Date.now() < deadline) {
        await sleepWithAbort(resolvedPollMs, lockSignal);
        continue;
      }
      if (code === 'ENOENT') {
        parentMissingRetries += 1;
        incrementParentMissingRetriesMetric();
        let parentReady = false;
        try {
          await fs.mkdir(path.dirname(lockPath), { recursive: true });
          parentReady = true;
        } catch (mkdirErr) {
          const mkdirObservation = observeStorageResource(mkdirErr, { phase: 'file-lock-parent-create' });
          let mkdirCode;
          try {
            mkdirObservation.requireSettled();
            try { mkdirCode = mkdirObservation.primary.code; }
            catch (inspection) { throw mkdirObservation.retain(inspection, { inspectionPresent: true }); }
            mkdirObservation.requireSettled();
          } catch (pending) { throw observation.retain(pending, { inspectionPresent: true }); }
          if (mkdirCode !== 'ENOENT' && mkdirCode !== 'ENOTDIR') {
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
      if (code !== 'EEXIST') throw err;
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
 * Original worker resource prerequisites gate metadata release. Unknown work
 * retains the actual published session for explicit recovery; work is not replayed.
 * @param {object} options
 * @param {(lock:{lockPath:string,payload:object,release:(opts?:{force?:boolean})=>Promise<boolean>})=>Promise<any>} worker
 */
export const withFileLock = async (options, worker) => {
  const lock = await acquireFileLock(options);
  if (!lock) return null;
  let workerResult;
  let workerError = null;
  let workerFailed = false;
  try {
    workerResult = await worker(lock);
  } catch (error) {
    workerFailed = true;
    workerError = error;
  }
  await releaseFileLockOrThrow(lock, { workerError });
  if (workerFailed) throw workerError;
  return workerResult;
};
