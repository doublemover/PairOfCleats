# Deterministic Ordering Spec

## Goals
- Provide consistent ordering rules across artifacts to guarantee determinism.

## Non-goals
- Backward compatibility with older ordering rules.

## Ordering Rules
- chunk_meta: order by file, chunkUid, chunkId/id, start, then name.
- relations: order by srcId, dstId, edgeType, then callSiteId.
- file_relations: order by file path.
- graph_relations: order by graph name, node id, then sorted neighbor ids.
- graph edges: order by src, dst, kind, then weight.
- repo map: order by file, name, kind, signature, then startLine.

## Tie-breakers
- Use stable string comparisons on normalized paths.
- Use numeric ordering for IDs and offsets.

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

## Breaking Changes
Ordering changes are allowed; consumers must follow this spec.
