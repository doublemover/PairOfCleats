# Chunk identity and sizing contract

## Identity
- `chunk.metaV2.chunkId` is the stable, external identifier across builds.
- `chunk.id` is an index-local numeric id and is not stable across builds.

## Shape
- Each chunk includes `file`, `ext`, and positional metadata where available.
- Token-derived fields (`tokens`, `ngrams`, `chargrams`, `minhashSig`) align with postings.
- `start`/`end` offsets are **UTF-16 code unit indices** into the decoded file text; consumers should use `text.slice(start, end)` to recover the chunk span.
- `startLine`/`endLine` are 1-based line numbers derived from the same decoded text.

## Sizing
- Chunk boundaries follow segmentation rules per language/format.
- Size guards prevent pathological chunks; oversized files/segments are split or skipped with a recorded reason.
- Per-chunk limits can be enforced via `indexing.chunking.maxBytes` / `indexing.chunking.maxLines`.

## References
- `docs/metadata-schema-v2.md`
- `docs/parser-backbone.md`
- `docs/ast-feature-list.md`
