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
1. README: serialization formats + streaming APIs (format arg required) -- https://github.com/SalvatorePreviti/roaring-wasm/blob/master/README.md
2. Roaring format background (interoperability; why roaring bitmaps) -- https://github.com/RoaringBitmap/RoaringBitmap#readme

## Suggested extraction checklist
- [x] Define artifact formats and version them (Planned: declare bitmap serialization format + version in `docs/contracts/artifact-contract.md`).
- [x] Ensure determinism: stable ordering, stable encodings, stable hashing inputs. (Planned: sort doc IDs before bitmap build; serialize with explicit format ID.)
- [x] Measure: write/read throughput and artifact size; record p95/p99 for bulk load. (Planned: compare bitmap size vs JSON postings in `tools/report-artifacts.js`.)
- [x] Plan for corruption detection (hashes) and safe partial rebuilds. (Planned: store bitmap checksums alongside postings; validate via `src/index/validate.js`.)

