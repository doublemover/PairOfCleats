import path from 'node:path';
import { throwIfAborted } from '../../shared/abort.js';
import {
  acquireFileLock,
  readLockInfo
} from '../../shared/locks/file-lock.js';
import {
  attachLockSignalCleanup,
  createLockReleaseHandle
} from '../lock-release.js';

const DEFAULT_STALE_MS = 30 * 60 * 1000;

/**
 * Acquire a repo-scoped index lock to prevent concurrent writes.
 * @param {{repoCacheRoot:string,storageContext?:{repoRoot:string,userConfig:object,env?:object}|null,waitMs?:number,pollMs?:number,staleMs?:number,requireSettlement?:boolean,metadata?:object|null,log?:(msg:string)=>void}} input
 * @returns {Promise<{lockPath:string,release:()=>Promise<void>}|null>}
 */
export async function acquireIndexLock({
  repoCacheRoot,
  waitMs = 0,
  pollMs = 1000,
  staleMs = DEFAULT_STALE_MS,
  requireSettlement = false,
  metadata = null,
  storageContext = null,
  signal = null,
  log = () => {}
}) {
  throwIfAborted(signal);
  const storageModule = storageContext ? await import('./storage-session.js') : null;
  throwIfAborted(signal);
  const storage = storageModule ? storageModule.acquireIndexStorageSession(repoCacheRoot, storageContext) : null;
  const lockPath = path.join(repoCacheRoot, 'locks', 'index.lock');
  let lock;
  try { lock = await acquireFileLock({
    lockPath,
    waitMs,
    pollMs,
    staleMs,
    signal,
    metadata: {
      scope: 'index',
      ...(metadata && typeof metadata === 'object' ? metadata : {}),
      ...(requireSettlement || storage ? { resourceSettlementVersion: 1 } : {})
    },
    onStale: ({ reason, pid }) => {
      if (reason === 'dead-pid' && Number.isFinite(pid)) {
        log(`Removed stale index lock at ${lockPath} (pid ${pid} not running).`);
        return;
      }
      log(`Removed stale index lock at ${lockPath}.`);
    }
  }); } catch (error) {
    // A rejected acquisition exposes no returned file-lock owner. Preserve the
    // category admission rather than infer that its internal write/close settled.
    throw storage ? storageModule.retainIndexStorageFailure(error, storage.session) : error;
  }
  if (!lock) {
    storage?.session.releaseAfterSettlement({ resourceId: storage.session.resourceId, settled: true, pending: false });
    const detailInfo = await readLockInfo(lockPath);
    const detail = detailInfo?.pid ? ` (pid ${detailInfo.pid})` : '';
    log(`Index lock held, skipping build${detail}.`);
    return null;
  }

  const handle = createLockReleaseHandle({
    lock,
    lockPath,
    releaseLabel: 'index-lock.release',
    log
  });
  if (!storage) return handle;
  const owner = storageModule.attachIndexStorageSession(handle, storage);
  try { storage.revalidate(); }
  catch (error) {
    try { await owner.release(); }
    catch (cleanupError) {
      const combined = new AggregateError([error, cleanupError], error.message, { cause: error });
      throw storageModule.retainIndexStorageFailure(combined, storage.session, owner, () => cleanupError.cacheOwnershipReleased?.() === true);
    }
    throw error;
  }
  return owner;
}

/**
 * Read the current repo-scoped index lock metadata, if present.
 *
 * @param {string} repoCacheRoot
 * @returns {Promise<object|null>}
 */
export async function readIndexLockInfo(repoCacheRoot) {
  const lockPath = path.join(repoCacheRoot, 'locks', 'index.lock');
  return await readLockInfo(lockPath);
}

/**
 * Attach deterministic signal cleanup for an owned index lock without making
 * the low-level lock helper authoritative over process signal ownership.
 *
 * Callers that own process lifecycle can opt in so SIGINT/SIGTERM remove the
 * current process-scoped lock synchronously before higher-level abort/exit
 * handling runs. Resource fences always require their owner's explicit release.
 *
 * @param {{lockPath?:string,payload?:object}} lock
 * @param {{signals?:string[]}} [options]
 * @returns {() => void}
 */
export function attachIndexLockSignalCleanup(
  lock,
  {
    signals = null,
    preserveDefaultTermination = true,
    reemitSignal = null
  } = {}
) {
  return attachLockSignalCleanup(lock, {
    signals,
    preserveDefaultTermination,
    reemitSignal
  });
}
