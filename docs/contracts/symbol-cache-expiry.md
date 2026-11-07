# Symbol-reference cache expiry

Cross-file propagation keeps the existing 20,000-entry LRU and inclusive five-minute
insertion TTL. Hits reorder capacity recency without extending that TTL; cached
negative resolutions remain ordinary entries. Resolver output and semantic producer
identity are unchanged.

The old next-expiry shortcut still performed a full cache scan at each staggered
expiration. Maintenance now uses the shared `MinHeap` to schedule original insertion
deadlines separately from LRU order. Expiration pops only due nodes; capacity
eviction removes the current schedule binding without scanning the cache.

Schedule nodes hold keys/deadlines, not old resolved values. One current binding
per key retains the exact cached entry; lazy nodes cannot remove a replacement.
When nodes exceed twice capacity, maintenance rebuilds the heap from current
bindings. The schedule therefore peaks at twice capacity plus one insertion;
rebuilding costs amortized logarithmic work rather than retaining unbounded history.
Clock rollback does not expire newer entries. Exact-deadline entries stay valid.

The insertion hook now receives the original cache key and timestamp. Its two
repository callers are migrated; the timestamp-only hook is removed. Internal
work counters separate actual expiry pops, stale-node removal, capacity eviction,
heap comparisons and compaction visits. These are operation counts, not heap/RSS
or end-to-end latency claims.

The strengthened, locally unrun owner fixture retains its original boundary,
hit-reordering and negative-value assertions. It adds 20,000 staggered entries,
5,000 expirations, bounded rolling overflow, hot-key reinsertion and backwards-clock
controls. Actual propagation CPU/event-loop and representative consumer qualification
for #1187 remain pending; no measured speedup is claimed.
