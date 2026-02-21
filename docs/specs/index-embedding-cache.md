# Index Embedding Cache

Status: Active v1.0  
Last updated: 2026-02-21T00:00:00Z

## Key contract

Chunk-embedding cache entries are keyed by:

- `chunkHash`
- `modelId`
- `embeddingConfigVersion`

## Determinism requirements

- Stable key generation across runs.
- Strict invalidation when any key component changes.
- Deterministic serialization of cache metadata before reuse.
