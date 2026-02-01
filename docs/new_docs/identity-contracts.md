# Phase 9 — Identity contracts (implementation-facing notes)

> **Source of truth:** `docs/specs/identity-contract.md`  
> This Phase 9 document exists to answer: “where in the codebase does this happen, and what do we touch?”

## What Phase 9 assumes is already true

By the start of Phase 9, every chunk in `chunk_meta` should already have:
- `metaV2.chunkUid` (`ck64:v1:...`)
- `metaV2.virtualPath` (segment-aware)
- `metaV2.segment.segmentUid` (or `null`)

These are defined in the identity spec and are validated by the identity-focused tests.

## Code touchpoints (searchless)

### Segment UIDs and virtual paths
- `src/index/segments.js`
  - `assignSegmentUids()` — assigns `segmentUid` to segments before chunking
  - `chunkSegments()` — uses `segmentUid` to build stable segment virtual paths

### Chunk UIDs
- `src/index/identity/chunk-uid.js`
  - `computeSegmentUid()` — stable segment UID from text/type/lang
  - `computeChunkUid()` — stable chunk UID from span + pre/post context
  - `assignChunkUids()` — attaches `chunkUid` and `chunkUidAlgoVersion`

### metaV2 emission
- `src/index/metadata-v2.js`
  - `buildMetaV2()` — copies `chunkUid`, `virtualPath`, `segment.segmentUid` into `metaV2`

## Validation touchpoints

- `src/index/validate/checks.js`
  - `validateChunkIdentity()` — checks chunkUid presence/uniqueness in strict mode
  - `validateMetaV2Types()` — ensures metaV2 types are sane

## Tests (existing)

- `tests/indexing/identity/chunkuid-stability-lineshift.test.js`
- `tests/indexing/identity/chunkuid-collision-disambiguation.test.js`

## Phase 9 note: do not fork the identity algorithm

Phase 9 work MUST NOT introduce new prefixes or alternate UID algorithms in parallel with `docs/specs/identity-contract.md`.
If Phase 9 needs additional identity fields, extend the spec and the existing implementation (do not create a second identity module).
