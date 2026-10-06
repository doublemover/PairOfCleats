# Index State + File Meta Performance Notes

## Overview
Phase 15 focuses on reducing JSON serialization/IO cost for `index_state`, `file_meta`, and `minhash_signatures` while keeping artifacts deterministic and compatible.

Key changes:
- `index_state.json` writes are skipped when the stable hash is unchanged.
- `file_meta` can be emitted as JSONL shards or as a columnar/string-table payload.
- `minhash_signatures` can be streamed and packed into a binary format.
- Postings guards record sampled/minified mode, or a skip when no usable signature exists.

## Index State Write Skips
`index_state.json` writes are gated by a stable hash that ignores volatile fields (`generatedAt`, `updatedAt`).
When the stable hash matches, the JSON file is not rewritten and only the sidecar meta file is updated.

Artifacts:
- `index_state.json`
- `index_state.meta.json` with `stableHash`, timestamps, and byte size

## File Meta Formats
`file_meta` can be stored in multiple formats:
- **JSON array** (default for small outputs)
- **JSONL sharded** (when size exceeds `MAX_JSON_BYTES` or format is `jsonl`)
- **Columnar** (string-table compression for repeated fields)

Loaders default to streaming row iteration for JSONL shards; materialized reads are explicit.
`loadFileMetaRows` streams JSONL using offsets when present and falls back to JSONL shards in non-strict mode if a
columnar/JSON payload exceeds `MAX_JSON_BYTES`.

Materialized artifact caches reuse values only within the caller's read profile:
byte limit, validation mode and raw JSON/JSONL or normalized-manifest view. A
smaller limit performs fresh admission instead of returning a value admitted
under a larger limit; decoded compression limits remain enforced. Compatible
profiles still reuse their values, and failed reads cannot populate another
profile. Explicit JSON recovery reads bypass the primary-path cache because a
backup or sibling can have a different source identity. Format/schema versions
and the existing manifest limit normalization are unchanged.

Artifacts:
- `file_meta.json` or `file_meta.parts/*` + `file_meta.meta.json`
- `file_meta.columnar.json` + `file_meta.meta.json`
JSONL shard metadata includes offsets (`offsets` array) when enabled.

The columnar format is an object with:
- `columns`: ordered list of fields
- `arrays`: column arrays
- `tables`: optional string tables (for `file`, `ext`, etc.)

## Minhash Signatures
Minhash signatures are stored in two forms:
- JSON (`minhash_signatures.json`)
- Packed binary (`minhash_signatures.packed.bin` + `.packed.meta.json`)

When available, loaders prefer the packed format. The JSON format remains for compatibility.

### Streaming
When `postings.minhashStream` is enabled (default), ordinary and sampled/minified
signatures are streamed from stable chunks without a full transformed row table.
Sampled JSON emission owns one row at a time; packed emission still allocates its
required complete `4 * rows * dimensions` byte payload. The active artifact writer uses
the same row transformation and preserve sampling identity, order and coercion.
Chunks remain owned until queued writers settle. This removes the additional
sampled row table, not the original chunk signatures or the packed output, and
is not a measured RSS or throughput claim. Explicit `minhashStream: false`
retains materialized emission.

### Guards
If `postings.minhashMaxDocs` is set and the corpus exceeds the limit, an available
signature width selects deterministic stride sampling. Only a corpus with no
usable signature width is skipped. The exact plan or skip is recorded in
`index_state.extensions.minhashGuard`.

## Config Surface
- `indexing.artifacts.fileMetaFormat`: `auto | columnar | jsonl`
- `indexing.artifacts.fileMetaColumnarThresholdBytes`: emit columnar only above this size
- `indexing.artifactCompression.perArtifact`: per-artifact compression overrides
- `postings.minhashMaxDocs`: sample minhash dimensions when doc count exceeds limit
- `postings.minhashStream`: stream minhash rows instead of buffering
- `postings.phraseSpillMaxBytes`: spill phrase postings by byte threshold
- `postings.chargramSpillMaxBytes`: spill chargram postings by byte threshold

## Benchmarks
- `tools/bench/index/index-state-write.js`
- `tools/bench/index/file-meta-compare.js`
- `tools/bench/index/file-meta-streaming-load.js`
- `tools/bench/index/minhash-packed.js`

Run these with `--mode compare` to see baseline vs current output and deltas.
