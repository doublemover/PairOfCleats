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

const resolveDomainName = (domain) => {
  const normalized = String(domain || '').trim().toLowerCase();
  if (!normalized) {
    throw new TypeError('domain is required for registry locks.');
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

  return createLockReleaseHandle({
    lock,
    lockPath,
    releaseLabel: `${normalizedDomain}-lock.release`,
    log
  });
}

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
