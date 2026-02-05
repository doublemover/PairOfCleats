# Deterministic Ordering Spec

## Goals
- Provide consistent ordering rules across artifacts to guarantee determinism.

## Non-goals
- Backward compatibility with older ordering rules.

## Ordering Rules
- chunk_meta: order by chunkUid, then fileId, then startByte.
- relations: order by srcId, dstId, edgeType, then callSiteId.
- graph edges: order by src, dst, kind, then weight.
- repo map: order by filePath, then symbolKey.

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
- Hash ordered outputs with xxhash64.
- Record in build truth ledger.
- Ledger stage keys are `stage:mode` (e.g., `stage2:code`) when mode-specific.
- Seed inputs (`discoveryHash`, `fileListHash`, `fileCount`) are recorded for diagnosis.

## Breaking Changes
Ordering changes are allowed; consumers must follow this spec.
