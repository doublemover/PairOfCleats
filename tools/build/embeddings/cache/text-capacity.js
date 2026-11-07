const capacityRejections = new WeakSet();
const MAX_EVICTION_ROUNDS = 16, MAX_ROWS_PER_ROUND = 16384;
const rejectCapacity = reason => {
  const error = Object.assign(new Error(`Persistent text cache capacity admission rejected: ${reason}.`), {
    code: 'ERR_EMBEDDING_TEXT_CACHE_CAPACITY', reason
  });
  capacityRejections.add(error); throw error;
};
export const isTextCacheCapacityRejection = error => error !== null && typeof error === 'object' && capacityRejections.has(error);

/** Conservative allocation headroom within the existing hard SQLite page cap.
 * It is admission, not a byte-exact SQLite allocation model. No SQLITE_FULL
 * retry can distinguish database capacity from unrelated filesystem pressure.
 * The caller's transaction owns touches, evictions, writes and rollback together.
 */
export const createTextCacheCapacityAdmission = ({ db, pageSize, pageLimit, countStmt, pruneStmt }) => {
  const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
  if (!integer(pageSize, 512) || !integer(pageLimit, 1)) throw new RangeError('Invalid text-cache page geometry.');
  const availablePages = () => {
    const pages = Number(db.pragma('page_count', { simple: true }));
    const free = Number(db.pragma('freelist_count', { simple: true }));
    if (!integer(pages) || !integer(free) || free > pages || pages > pageLimit) throw new Error('Text-cache capacity geometry is unconfirmed.');
    return pageLimit - pages + free;
  };
  return Object.freeze({ pageSize, pageLimit, maxEvictionRounds: MAX_EVICTION_ROUNDS,
    admit(writes) {
      if (db.inTransaction !== true) throw new Error('Text-cache capacity admission requires its write transaction.');
      if (!writes.length) return { evicted: 0, rounds: 0, reservedPages: 0 };
      if (Number(db.pragma('max_page_count', { simple: true })) !== pageLimit
        || Number(db.pragma('page_size', { simple: true })) !== pageSize) throw new Error('Text-cache page limit changed after admission.');
      // Payload/record overflow headroom plus bounded B-tree/index split margin.
      // Hard page/journal/profile limits remain authoritative if this estimate
      // is insufficient; a failed native write rolls back without recovery retry.
      let reservedPages = 16;
      for (const [key, entry] of writes) reservedPages += 4 + 3 * Math.ceil(
        (entry.vectorBlob.byteLength + Buffer.byteLength(key, 'utf8') + 512) / (pageSize - 64));
      if (!integer(reservedPages, 1) || reservedPages >= pageLimit - 8) rejectCapacity('batch-exceeds-page-admission');
      if (availablePages() >= reservedPages) return { evicted: 0, rounds: 0, reservedPages };
      const total = Number(countStmt.get()?.total);
      if (!integer(total)) throw new Error('Text-cache row count is unconfirmed.');
      const perRound = Math.min(MAX_ROWS_PER_ROUND, Math.max(32, writes.length * 2, Math.ceil(total / 8)));
      let evicted = 0, rounds = 0;
      while (rounds < MAX_EVICTION_ROUNDS && evicted < total && availablePages() < reservedPages) {
        const removed = Number(pruneStmt.run(Math.min(perRound, total - evicted)).changes);
        if (!integer(removed) || removed > perRound) throw new Error('Text-cache eviction settlement is unconfirmed.');
        rounds++; evicted += removed;
        if (!removed) break;
      }
      if (availablePages() < reservedPages) rejectCapacity('bounded-eviction-insufficient');
      return { evicted, rounds, reservedPages };
    }
  });
};
