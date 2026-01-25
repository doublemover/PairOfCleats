# Phase 3 Signature Canonicalization Spec (Draft)

## Goal
Make incremental signatures deterministic, explainable, and safe by default.

## Canonicalization rules
- `RegExp` -> `{ __type: 'regexp', source, flags }`
- `Set` -> `{ __type: 'set', values: [sorted] }`
- `Map` -> `{ __type: 'map', entries: [[key,value], ...] }` (sorted by key)
- `BigInt` -> `{ __type: 'bigint', value: '<decimal>' }`
- `undefined` -> omitted consistently (no sentinel)

## Stable stringify
- Stable key ordering for all plain objects.
- Arrays preserve order.
- Set/Map ordering is deterministic by rule above.

## Signature versioning
- `signatureVersion = 2` for canonicalized hashing.
- Mismatch => reuse rejected (hard no-reuse).
- Persist `signatureVersion` in incremental manifests and `build_state.json`.

## Diagnostics
- Provide bounded “top-level delta” summary when reuse is rejected.
- Never dump full configs by default.
- Persist a `signatureSummary` (top-level key -> hash) in incremental manifests for diffing.

## Migration notes
- When `signatureVersion` changes, `build_state.json` should record:
  - prior version (if known)
  - new version
  - reuse rejection reason
- CLI/build output should include a short “signature version changed” diagnostic.

## Integration touchpoints
- `src/index/build/indexer/signatures.js`
- `src/index/build/runtime/hash.js`
- `src/index/build/incremental.js`
