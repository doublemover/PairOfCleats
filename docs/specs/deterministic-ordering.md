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

## Hashing
- Hash ordered outputs with xxhash64.
- Record in build truth ledger.

## Breaking Changes
Ordering changes are allowed; consumers must follow this spec.
