import path from 'node:path';
import {
  acquireFileLock,
  readLockInfo
} from '../shared/locks/file-lock.js';
import {
  attachLockSignalCleanup,
  createLockReleaseHandle
} from './lock-release.js';

const DEFAULT_STALE_MS = 30 * 60 * 1000;
const registryLeases = new WeakMap();

const resolveDomainName = (domain) => {
  const normalized = String(domain || '').trim().toLowerCase();
  if (!normalized) {
    throw new TypeError('domain is required for registry locks.');
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(normalized) || normalized === '.' || normalized === '..') {
    throw new TypeError('Registry lock domain must be one safe path token.');
  }
  return normalized;
};

export const resolveRegistryLockPath = (repoCacheRoot, domain) => (
  path.join(repoCacheRoot, 'locks', `${resolveDomainName(domain)}.lock`)
);

export async function acquireRegistryLock({
  repoCacheRoot,
  domain,
  waitMs = 0,
  pollMs = 1000,
  staleMs = DEFAULT_STALE_MS,
  metadata = null,
  log = () => {}
}) {
  const normalizedDomain = resolveDomainName(domain);
  const lockPath = resolveRegistryLockPath(repoCacheRoot, normalizedDomain);
  const lock = await acquireFileLock({
    lockPath,
    waitMs,
    pollMs,
    staleMs,
    metadata: {
      scope: normalizedDomain,
      ...(metadata && typeof metadata === 'object' ? metadata : {})
    },
    onStale: ({ reason, pid }) => {
      if (reason === 'dead-pid' && Number.isFinite(pid)) {
        log(`Removed stale ${normalizedDomain} lock at ${lockPath} (pid ${pid} not running).`);
        return;
      }
      log(`Removed stale ${normalizedDomain} lock at ${lockPath}.`);
    }
  });
  if (!lock) {
    return null;
  }

  const handle = createLockReleaseHandle({
    lock,
    lockPath,
    releaseLabel: `${normalizedDomain}-lock.release`,
    log
  });
  const lease = { root: path.resolve(repoCacheRoot), domain: normalizedDomain,
    lockPath: path.resolve(lockPath), lockId: lock.payload.lockId, active: true };
  const release = handle.release;
  handle.release = async () => {
    // Borrowed mutation authority ends when retirement starts, even if the
    // original lock still needs explicit cleanup after a failed release.
    lease.active = false;
    return release();
  };
  registryLeases.set(handle, lease);
  return handle;
}

/** Only live capabilities minted by this owner may bypass reacquisition. */
export const assertBorrowedRegistryLock = async (handle, repoCacheRoot, domain) => {
  const lease = registryLeases.get(handle);
  const expectedPath = path.resolve(resolveRegistryLockPath(repoCacheRoot, domain));
  if (!lease?.active || handle.signalCleaned || lease.root !== path.resolve(repoCacheRoot)
    || lease.domain !== resolveDomainName(domain) || lease.lockPath !== expectedPath
    || handle.payload?.lockId !== lease.lockId) {
    throw Object.assign(new Error('Borrowed registry lock is not an active capability for this registry.'), {
      code: 'ERR_REGISTRY_LOCK_OWNERSHIP'
    });
  }
  const current = await readLockInfo(expectedPath);
  if (!current?.lockId || current.lockId !== lease.lockId) {
    lease.active = false;
    throw Object.assign(new Error('Borrowed registry lock no longer owns its on-disk lease.'), {
      code: 'ERR_REGISTRY_LOCK_OWNERSHIP'
    });
  }
};

export async function readRegistryLockInfo(repoCacheRoot, domain) {
  return await readLockInfo(resolveRegistryLockPath(repoCacheRoot, domain));
}

export function attachRegistryLockSignalCleanup(
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
