# Index State + File Meta Performance Notes

## Overview
Phase 15 focuses on reducing JSON serialization/IO cost for `index_state`, `file_meta`, and `minhash_signatures` while keeping artifacts deterministic and compatible.

Key changes:
- `index_state.json` writes are skipped when the stable hash is unchanged.
- `file_meta` can be emitted as JSONL shards or as a columnar/string-table payload.
- `minhash_signatures` can be streamed and packed into a binary format.
- Postings guards record skip events for minhash when the corpus exceeds configured thresholds.

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
When `postings.minhashStream` is enabled (default), minhash signatures are streamed from chunks and do not require a full in-memory array.

### Guards
If `postings.minhashMaxDocs` is set and the corpus exceeds the limit, minhash emission is skipped and a guard entry is recorded in `index_state.extensions.minhashGuard`.

## Config Surface
- `indexing.artifacts.fileMetaFormat`: `auto | columnar | jsonl`
- `indexing.artifacts.fileMetaColumnarThresholdBytes`: emit columnar only above this size
- `indexing.artifactCompression.perArtifact`: per-artifact compression overrides
- `postings.minhashMaxDocs`: skip minhash when doc count exceeds limit
- `postings.minhashStream`: stream minhash rows instead of buffering
- `postings.phraseSpillMaxBytes`: spill phrase postings by byte threshold
- `postings.chargramSpillMaxBytes`: spill chargram postings by byte threshold

## Benchmarks
- `tools/bench/index/index-state-write.js`
- `tools/bench/index/file-meta-compare.js`
- `tools/bench/index/file-meta-streaming-load.js`
- `tools/bench/index/minhash-packed.js`

Run these with `--mode compare` to see baseline vs current output and deltas.
