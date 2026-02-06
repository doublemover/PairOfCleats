# Deterministic Ordering Spec

## Goals
- Provide consistent ordering rules across artifacts to guarantee determinism.

## Non-goals
- Backward compatibility with older ordering rules.

## Ordering Rules
- chunk_meta: order by file, chunkUid, chunkId/id, start, then name.
- relations: order by srcId, dstId, edgeType, then callSiteId.
- file_relations: order by file path.
- graph_relations (schema v2): order by graph order (callGraph, usageGraph, importGraph), then node id, then sorted neighbor ids.
  - Canonical row JSON shape: `{"graph": "<graphName>", "node": { ... }}`.
  - Canonical key ordering (for ordering hashes): `graph`, then `node`.
  - Canonical node key ordering (for ordering hashes): `id`, `file`, `name`, `kind`, `chunkId`, `chunkUid`, `legacyKey`, `symbolId`, `out`, `in`.
  - Neighbor lists (`out`/`in`) MUST be sorted and deduped deterministically.
- graph edges: order by src, dst, kind, then weight.
- repo map: order by file, name, kind, signature, then startLine.
- filter_index: treated as an optional lookup artifact; when present its serialized maps are unordered JSON objects. Any bitmap acceleration is derived at hydration time and MUST NOT affect ordering hashes.

## Tie-breakers
- Use stable string comparisons on normalized paths.
- Use numeric ordering for IDs and offsets.
- When computing ordering hashes, hash the exact emitted JSONL line representation (no pretty printing) to avoid key-order drift.
  - For artifacts that dedupe after sorting (e.g. repo_map), the dedupe key MUST be computed from the stable sort keys so duplicates are removed deterministically.

## Ordering Helpers
- stableOrder(list, keys)
- stableBucketOrder(list, bucketKey, keys)
- stableOrderMapEntries(map, keys)
- orderRepoMapEntries(entries)

Helpers live in `src/shared/order.js` and must be used for new ordering logic.

## Hashing
- Hash ordered outputs with a streaming `sha1` hasher (xxhash64 is a future upgrade when we have a streaming API).
- Record hashes in build truth ledger with `algo:value` strings.
- Ledger stage keys are `stage:mode` (e.g., `stage2:code`) when mode-specific.
- Seed inputs (`discoveryHash`, `fileListHash`, `fileCount`) are recorded for diagnosis.
- Validation compares ledger hashes against loaded artifacts; `--validate-ordering` upgrades mismatches to errors.

## Benchmarks
- `node tools/bench/index/ordering-ledger.js --mode compare`
  - Runs baseline (ledger off) vs current (ledger on) and prints a delta line with duration/throughput differences.
  - Uses `--ledger on|off` to force a single run.
  - Uses `.index-root/index-code` if present, otherwise generates synthetic rows.

## Tests
- `tests/shared/order/order-hash.test.js` validates ordering hash stability.
- `tests/indexing/determinism/chunk-meta-ordering-drift.test.js` ensures drift is detected.
- `tests/indexing/validate/ledger-validation.test.js` covers warning vs error policy.

## Breaking Changes
Ordering changes are allowed; consumers must follow this spec.
