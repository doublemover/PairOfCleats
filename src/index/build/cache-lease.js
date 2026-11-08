import path from 'node:path';
import { readLockInfoSync } from '../../shared/locks/file-lock.js';

const leases = new WeakSet();
const fail = () => Object.assign(new Error('An active repository cache writer lease is required.'), { code: 'ERR_INDEX_CACHE_OWNERSHIP' });

/** A borrowed lease never transfers release authority to a nested stage. */
export const createIndexCacheLease = (lock, repoCacheRoot) => {
  if (lock?.payload?.resourceSettlementVersion !== 1) throw fail();
  const root = path.resolve(repoCacheRoot);
  let active = true;
  const lease = {
    assertOwned(cacheRoot = root) {
      const current = readLockInfoSync(lock.lockPath);
      if (!active || path.resolve(cacheRoot) !== root || current?.resourceSettlementVersion !== 1
        || current.lockId !== lock.payload?.lockId) throw fail();
      return lock;
    },
    invalidate() { active = false; }
  };
  lease.assertOwned();
  leases.add(lease);
  return lease;
};
export const assertIndexCacheLease = (lease, repoCacheRoot) => {
  if (!leases.has(lease)) throw fail();
  return lease.assertOwned(repoCacheRoot);
};
