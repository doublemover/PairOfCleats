# Graph Context Pack Performance

## Purpose
This note documents the graph/context-pack performance work in Phase 10:
shared graph indexes, deterministic ordering, reduced IO for excerpts, and
bounded caches to keep long-lived sessions stable.

## Key Improvements
- Shared `GraphIndex` with precomputed adjacency and node maps to avoid
  per-request rebuilds.
- Optional CSR-backed graph relations (`graph_relations_csr`) for low
  allocation adjacency traversal.
- Lazy edge loading based on requested graph types and edge filters.
- Deterministic ordering for graph/context-pack outputs (stable sorting
  across nodes, edges, and witness paths).
- Bounded LRU caches for graph artifacts and indexes to prevent unbounded
  memory growth.
- Context-pack excerpt IO moved to range reads with small LRU caches and
  prefetch batching to reduce repeated file reads.

## Cache Keys
Graph index cache keys include:
- Index signature
- Repo root (if available)
- Requested graph set
- CSR inclusion flag

This allows reuse across multiple tooling calls in a single process without
mixing incompatible indexes.

## Excerpt IO Strategy
Primary excerpts use:
- `readFileRangeSync` for range-bounded reads.
- Small excerpt LRU keyed by `(file,start,end,maxBytes,maxTokens)`.
- File range cache to reuse raw bytes across different excerpt limits.
- Excerpt hash de-duplication to reduce duplicate string allocations.

## Benchmarks
Use the context-pack latency harness to measure timing and RSS:

```
node tools/bench/graph/context-pack-latency.js --index <indexDir> --seed chunk:<id>
```

The harness reports min/avg/p95 timing and RSS deltas over multiple iterations.

## Validation
Phase 10 adds deterministic output tests, cache reuse tests, and excerpt
range/cache tests to ensure correctness and stability under caching.
