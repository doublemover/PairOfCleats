const budgets = new WeakSet();
/** Shared retention only, across services; active page state has its own bound.
 * Old cursors remain replayable until explicit TTL/count/byte eviction. */
export const createSemanticContinuationBudget = ({ maxBytes = 64 * 1024 * 1024 } = {}) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 256 || maxBytes > 256 * 1024 * 1024) throw new TypeError('Invalid semantic continuation retention budget.');
  const retained = new Map(); let used = 0, peak = 0, evictions = 0;
  const remove = token => {
    const entry = retained.get(token); if (!entry) return;
    retained.delete(token); used -= entry.bytes; entry.retire();
  };
  const budget = Object.freeze({
    retain(bytes, expires, retire) {
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maxBytes || !Number.isFinite(expires) || typeof retire !== 'function') {
        throw Object.assign(new Error('Semantic continuation cannot fit the aggregate retention allowance.'), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
      }
      budget.sweep();
      while (used + bytes > maxBytes) { evictions++; remove(retained.keys().next().value); }
      const token = Symbol('semantic continuation');
      retained.set(token, { bytes, expires, retire }); used += bytes; peak = Math.max(peak, used);
      return Object.freeze({ release: () => remove(token) });
    },
    sweep(now = Date.now()) { for (const [token, entry] of retained) if (entry.expires <= now) { evictions++; remove(token); } },
    stats: () => Object.freeze({ accounting: 'conservative-logical-snapshot-bytes; shared state may be charged repeatedly',
      maxBytes, retainedBytes: used, peakRetainedBytes: peak, retainedCursors: retained.size, evictions })
  });
  budgets.add(budget); return budget;
};
export const isSemanticContinuationBudget = budget => budgets.has(budget);
