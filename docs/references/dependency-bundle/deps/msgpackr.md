# `msgpackr`

**Area:** Binary serialization for artifacts

## Why this matters for PairOfCleats
Compact, fast serialization for per-file caches and durable index artifacts (faster than JSON for large nested objects).

## Implementation notes (practical)
- Tune options like `useRecords` for repeated object shapes.
- Use extensions for special types (e.g., typed arrays) and define compatibility constraints.

## Where it typically plugs into PairOfCleats
- Per-file cache bundles: AST metadata, token stats, embeddings (as typed arrays) stored as MsgPack.
- Index artifacts: store dictionaries and symbol tables efficiently.

## Deep links (implementation-relevant)
1. README: options (useRecords, structuredClone, extensions) — https://github.com/kriszyp/msgpackr/blob/master/README.md
2. MessagePack spec (cross-language compatibility expectations) — https://msgpack.org/index.html

## Suggested extraction checklist
- [x] Define artifact formats and version them (Planned: add a versioned MsgPack envelope aligned with `docs/artifact-contract.md`).
- [x] Ensure determinism: stable ordering, stable encodings, stable hashing inputs. (Planned: canonical key ordering + typed array encoding; avoid non-deterministic float handling.)
- [x] Measure: write/read throughput and artifact size; record p95/p99 for bulk load. (Planned: compare JSON vs MsgPack sizes in `tools/report-artifacts.js`.)
- [x] Plan for corruption detection (hashes) and safe partial rebuilds. (Planned: store checksums next to bundles; align with `src/shared/hash.js` + `src/index/validate.js` checksum handling.)
