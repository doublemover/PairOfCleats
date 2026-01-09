# `xxhash-wasm`

**Area:** Hashing / stable IDs

## Why this matters for PairOfCleats
Fast non-cryptographic hashing for content fingerprints, chunk IDs, and MinHash-style utilities.

## Implementation notes (practical)
- Account for sync vs async init depending on WASM loading strategy.
- Use stable encoding (e.g., UTF-8 bytes) so hashes are deterministic across platforms.

## Where it typically plugs into PairOfCleats
- Chunk IDs: hash `(repoId, path, start, end, content)` or a canonicalized representation.
- Artifact integrity: hash artifact files to detect corruption and enable caching.

## Deep links (implementation-relevant)
1. Repo README: API usage (xxh32/xxh64; sync/async init) — https://github.com/jungomi/xxhash-wasm#readme
2. Algorithm background (xxHash reference; perf characteristics) — https://xxhash.com/

## Suggested extraction checklist
- [ ] Define artifact formats and version them (schema/version header + migration plan).
- [ ] Ensure determinism: stable ordering, stable encodings, stable hashing inputs.
- [ ] Measure: write/read throughput and artifact size; record p95/p99 for bulk load.
- [ ] Plan for corruption detection (hashes) and safe partial rebuilds.