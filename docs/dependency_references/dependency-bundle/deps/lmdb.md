# `lmdb`

**Area:** Persistent KV store (LMDB)

## Why this matters for PairOfCleats
Optionally store large key-value artifacts (postings, per-file bundles) with fast reads and transactional writes.

## Implementation notes (practical)
- Use transactions intentionally; batch writes for throughput.
- Use `getRange` and cursor-like APIs for streaming iteration where needed.

## Where it typically plugs into PairOfCleats
- Alternative backend: LMDB store for postings and metadata when SQLite is undesirable.

## Deep links (implementation-relevant)
1. lmdb-js README (transactions, getRange, compression, async writes) -- https://github.com/DoctorEvidence/lmdb-js/blob/master/README.md
2. LMDB in Node (design notes; recommended write strategy) -- https://dev.doctorevidence.com/lmdb-in-node-29af907aad6e

## Suggested extraction checklist
- [x] Define artifact formats and version them (Planned: mirror `docs/contracts/artifact-contract.md` in LMDB keyspace; store schema under a `meta:schemaVersion` key).
- [x] Ensure determinism: stable ordering, stable encodings, stable hashing inputs. (Planned: order keys by normalized path + chunk ID; reuse `normalizeFilePath` in `src/storage/sqlite/utils.js`.)
- [x] Measure: write/read throughput and artifact size; record p95/p99 for bulk load. (Planned: add LMDB throughput notes to `tools/index/report-artifacts.js` and bench runs.)
- [x] Plan for corruption detection (hashes) and safe partial rebuilds. (Planned: store per-bucket checksums + reuse build_state; full rebuild via `pairofcleats index build`.)

