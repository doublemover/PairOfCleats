# `lru-cache`

**Area:** Caching / single-flight async work

## Why this matters for PairOfCleats
In-process caching for expensive computations (parsing, embeddings), including single-flight fetch patterns.

## Implementation notes (practical)
- Use TTL and size-based eviction; base sizing on bytes for predictable memory.
- Use `fetchMethod`/FetchOptions to prevent thundering herds on async work.

## Where it typically plugs into PairOfCleats
- Cache compiled schemas, compiled regex, and per-file parse results within an indexing run.

## Deep links (implementation-relevant)
1. Docs: Options (TTL, sizeCalculation, dispose, updateAgeOnGet)  https://isaacs.github.io/node-lru-cache/interfaces/LRUCache.Options.html
2. Docs: FetchOptions / fetchMethod (single-flight cache for async work)  https://isaacs.github.io/node-lru-cache/interfaces/LRUCache.FetchOptions.html

## Suggested extraction checklist
- [x] Identify the exact API entrypoints you will call and the data structures you will persist. (Use `new LRUCache({ max, maxSize, ttl, sizeCalculation })` with get/set wrappers for cache stats (src/shared/cache.js).)
- [x] Record configuration knobs that meaningfully change output/performance. (Cache sizing via maxEntries/maxMb and ttlMs mapped to max/maxSize/ttl (src/shared/cache.js).)
- [x] Add at least one representative test fixture and a regression benchmark. (Fixture: tests/fixture-smoke.js (index build exercises caches). Benchmark: tools/bench-language-repos.js.)