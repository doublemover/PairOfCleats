const POOL_TAG = Symbol('candidatePoolId');

export const createCandidatePool = ({
  maxSets = 6,
  maxEntries = 20000
} = {}) => {
  const poolId = Symbol('candidatePool');
  const pool = [];
  const stats = {
    allocations: 0,
    reuses: 0,
    releases: 0,
    drops: 0,
    maxEntries
  };

  const acquire = () => {
    let set = pool.pop();
    if (set) {
      stats.reuses += 1;
      set.clear();
    } else {
      stats.allocations += 1;
      set = new Set();
    }
    set[POOL_TAG] = poolId;
    return set;
  };

  const release = (set) => {
    if (!set || set[POOL_TAG] !== poolId) return;
    const size = set.size;
    set.clear();
    stats.releases += 1;
    if (Number.isFinite(maxEntries) && maxEntries > 0 && size > maxEntries) {
      stats.drops += 1;
      return;
    }
    if (pool.length >= maxSets) return;
    pool.push(set);
  };

  const owns = (set) => Boolean(set && set[POOL_TAG] === poolId);

  return {
    acquire,
    release,
    owns,
    stats
  };
};
