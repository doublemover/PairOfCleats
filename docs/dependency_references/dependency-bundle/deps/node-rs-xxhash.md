# `@node-rs/xxhash`

**Area:** Hashing / stable IDs

## Why this matters for PairOfCleats
Native xxhash can accelerate checksum generation for large artifacts.

## Implementation notes (practical)
- Ensure hex formatting stays stable with the wasm backend.
- Keep stream hashing bounded-memory for large files.

## Where it typically plugs into PairOfCleats
- Artifact checksums, bundle identities, and build manifests.

## Deep links (implementation-relevant)
1. README -- https://github.com/napi-rs/node-rs/tree/main/packages/xxhash

## Suggested extraction checklist
- [ ] Verify native and wasm hashes match on fixed fixtures.
- [ ] Confirm streaming hash performance on large files.
