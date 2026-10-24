/** Capacity is LRU; expiry uses insertion timestamps despite hit reordering. */
export const createSymbolRefCacheMaintenance = (cache, { maxEntries, ttlMs }) => {
  let nextExpiry = Infinity, expiryVisits = 0, capacityEvictions = 0;
  return {
    inserted(timestamp) { nextExpiry = Math.min(nextExpiry, timestamp + ttlMs); },
    prune(now) {
      while (cache.size > maxEntries) {
        cache.delete(cache.keys().next().value); capacityEvictions += 1;
      }
      if (now <= nextExpiry) return;
      const cutoff = now - ttlMs;
      nextExpiry = Infinity;
      for (const [key, entry] of cache) {
        expiryVisits += 1;
        if (!entry || Number(entry.ts) < cutoff) cache.delete(key);
        else nextExpiry = Math.min(nextExpiry, Number(entry.ts) + ttlMs);
      }
    },
    stats() { return { nextExpiry, expiryVisits, capacityEvictions }; }
  };
};
