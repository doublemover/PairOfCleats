# Index Embedding Cache

Status: Active v2.0
Last updated: 2026-10-12T00:00:00Z

## Key contract

Chunk-embedding cache entries are keyed by:

- `chunkHash`
- `modelId`
- `embeddingConfigVersion`

## Determinism requirements

- Stable key generation across runs.
- Strict invalidation when any key component changes.
- Deterministic serialization of cache metadata before reuse.

## Verified model space

The canonical embedding identity/fingerprint is version 4 (`embeddings-v4`).
Model artifact evidence participates in every persistent and adapter cache key.
Verified local content includes weights and tokenizer/config assets; qualified
EmbeddingGemma 2 uses its existing immutable revision/dtype profile. Unknown
artifacts explicitly refuse durable reuse and carry an attempt identity so one
build cannot match another unverified build. Matching dimensions alone never
establishes model compatibility. Retrieval checks the same artifact authority
before using a stored dense index. Old identities reject with rebuild guidance;
there is no compatibility migration.
