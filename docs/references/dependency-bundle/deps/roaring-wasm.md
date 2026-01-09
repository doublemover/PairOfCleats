# `roaring-wasm`

**Area:** Compressed bitsets / postings sets

## Why this matters for PairOfCleats
Represent large sets of doc/chunk IDs compactly and support fast union/intersection for filterable search.

## Implementation notes (practical)
- Be explicit about serialization format and pass required format args.
- Keep interoperability in mind if artifacts are shared across languages/implementations.

## Where it typically plugs into PairOfCleats
- Posting lists: store token→bitmap, filter facets→bitmap.
- Query-time set operations for fast filtering.

## Deep links (implementation-relevant)
1. README: serialization formats + streaming APIs (format arg required) — https://github.com/SalvatorePreviti/roaring-wasm/blob/master/README.md
2. Roaring format background (interoperability; why roaring bitmaps) — https://github.com/RoaringBitmap/RoaringBitmap#readme

## Suggested extraction checklist
- [ ] Define artifact formats and version them (schema/version header + migration plan).
- [ ] Ensure determinism: stable ordering, stable encodings, stable hashing inputs.
- [ ] Measure: write/read throughput and artifact size; record p95/p99 for bulk load.
- [ ] Plan for corruption detection (hashes) and safe partial rebuilds.