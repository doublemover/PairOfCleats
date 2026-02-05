# Phase 3 Build-State Integrity Spec (Draft)

## Goal
Make `build_state.json` concurrency-safe, validated, and useful for debugging.

## Writer model
- A per-buildRoot writer queue serializes updates.
- `enqueue(patch)` performs read -> deep-merge -> validate -> atomic write.
- Heartbeat writes are coalesced (e.g., max 1 per 5s).

## Required fields
- `schemaVersion`
- `signatureVersion`
- `currentPhase` (replace ambiguous `phase`)
- `orderingLedger` (ordering hashes + seeds)
- Diagnostics: buildId, buildRoot, stage/mode, startedAt/finishedAt, counts, tokenizationKey/cacheSignature.

## Suggested schema excerpt (draft)
```
{
  "schemaVersion": 1,
  "signatureVersion": 2,
  "currentPhase": "build|validate|promote|...",
  "buildId": "string",
  "buildRoot": "string",
  "mode": "code|prose|both",
  "stage": "foreground|background",
  "startedAt": "ISO-8601",
  "finishedAt": "ISO-8601|null",
  "counts": { "files": 0, "chunks": 0 },
  "tokenizationKey": "string",
  "cacheSignature": "string",
  "orderingLedger": {
    "schemaVersion": 1,
    "seeds": { "discoveryHash": "sha1", "fileListHash": "sha1", "fileCount": 0 },
    "stages": { "stage1:code": { "artifacts": { "chunk_meta": { "hash": "sha1" } } } }
  }
}
```

## Ordering ledger requirements
- Ledger updates are merged, not replaced.
- Seed inputs capture discovery/file list hashes to diagnose nondeterminism.
- Per-stage artifact ordering hashes are recorded when artifacts are written.

## Safety requirements
- Reject unsafe or out-of-root `current.json` promotion.
- Readers fail closed on invalid roots.

## Docs impact
- Update any build state docs to reflect schema fields and writer guarantees.
