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
  "cacheSignature": "string"
}
```

## Safety requirements
- Reject unsafe or out-of-root `current.json` promotion.
- Readers fail closed on invalid roots.

## Docs impact
- Update any build state docs to reflect schema fields and writer guarantees.
