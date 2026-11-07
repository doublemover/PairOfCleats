import { MinHeap } from '../../shared/min-heap.js';

/** Capacity is LRU. Expiry has a separate bounded insertion-time schedule,
 * independent of hit reordering. Lazy nodes retain keys, never expired values. */
export const createSymbolRefCacheMaintenance = (cache, { maxEntries, ttlMs }) => {
  if (!(cache instanceof Map) || cache.size || !Number.isSafeInteger(maxEntries) || maxEntries < 1
    || maxEntries > Number.MAX_SAFE_INTEGER / 2 || !Number.isSafeInteger(ttlMs) || ttlMs < 0) throw new TypeError('Empty symbol cache and bounded maintenance policy required.');
  const current = new Map();
  let expiryVisits = 0, capacityEvictions = 0, staleDiscards = 0, heapComparisons = 0, compactions = 0, compactedEntries = 0, maxScheduledEntries = 0;
  const makeHeap = () => new MinHeap((a, b) => { heapComparisons++; return a.expiresAt - b.expiresAt; });
  let schedule = makeHeap();
  const compact = () => {
    const next = makeHeap(); compactions++;
    for (const [key, record] of current) {
      compactedEntries++;
      if (cache.get(key) === record.entry) next.push(record.node); else current.delete(key);
    }
    schedule = next;
  };
  return {
    inserted(key, timestamp) {
      const entry = cache.get(key), expiresAt = timestamp + ttlMs;
      if (!entry || entry.ts !== timestamp || !Number.isSafeInteger(timestamp) || !Number.isSafeInteger(expiresAt)) throw new TypeError('Original cached symbol insertion/timestamp required.');
      const node = { key, expiresAt };
      current.set(key, { entry, node }); schedule.push(node);
      maxScheduledEntries = Math.max(maxScheduledEntries, schedule.size);
      // Continuous overflow/reinsertion cannot retain an unbounded tombstone
      // history. Rebuilding every O(capacity) insertions costs O(log capacity)
      // amortized work and still uses the shared heap implementation.
      if (schedule.size > 2 * maxEntries) compact();
    },
    prune(now) {
      if (!Number.isSafeInteger(now)) throw new TypeError('Finite symbol-cache clock required.');
      while (cache.size > maxEntries) {
        const key = cache.keys().next().value;
        cache.delete(key); current.delete(key); capacityEvictions++;
      }
      while (schedule.size) {
        const node = schedule.items[0], record = current.get(node.key);
        if (!record || record.node !== node || cache.get(node.key) !== record.entry) {
          schedule.pop(); staleDiscards++;
          if (record?.node === node) current.delete(node.key);
          continue;
        }
        // Match the resolver's inclusive exact-TTL hit boundary.
        if (now <= node.expiresAt) break;
        schedule.pop(); expiryVisits++; cache.delete(node.key); current.delete(node.key);
      }
    },
    stats() { return { nextExpiry: schedule.items[0]?.expiresAt ?? Infinity, expiryVisits, capacityEvictions, staleDiscards,
      heapComparisons, compactions, compactedEntries, scheduledEntries: schedule.size, trackedEntries: current.size, maxScheduledEntries }; }
  };
};
