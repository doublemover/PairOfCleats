# Artifact IO Pipeline Spec

## Goals
- Provide a single, consistent reader/writer pipeline for all artifacts.
- Enforce byte-based sharding, offsets, and compression rules uniformly.
- Ensure atomic, safe writes and deterministic reads.

## Non-goals
- Backward compatibility guarantees.
- Changing artifact schemas beyond IO mechanics.

## Pipeline Lifecycle
1) Writer prepares shard plan (byte-based).
2) Writer streams JSONL and writes offsets inline.
3) Writer finalizes manifest metadata and atomically swaps artifacts.
4) Reader resolves artifacts via manifest.
5) Reader loads offsets if present; otherwise streams full JSONL.

## Sharding Rules
- Shard size is controlled by max bytes (default in config).
- Shard naming: baseName.shard-00000.jsonl (or .jsonl.gz/.jsonl.zst).
- Shard metadata includes: shardIndex, byteCount, rowCount, compression, offsetsVersion.

## Offsets Format
- Offsets stored as binary sidecar with fixed width entries.
- Metadata file: baseName.offsets.meta.json
  - version
  - entryWidth
  - shardCount
  - rowCount
- Offsets are written during streaming (no second pass).

## Compression
- Compression mode is per-artifact and must match file suffix.
- Supported modes: none, gzip, zstd.
- Compression settings are recorded in manifest and shard meta.

## Streaming Parser
- JSONL parsing uses buffer scanning (no readline).
- CRLF normalization on read.
- Per-line validation in strict mode; trusted fast-path skips validation.
- Default reader path is streaming row iteration; materialized reads must be explicitly requested.
- Streaming readers apply backpressure via async iteration (no unbounded buffering).
- Readers enforce `MAX_JSON_BYTES` by default unless overridden.

## Atomic Writes
- Write to temp dir: .tmp/<artifact>/
- Verify shard counts, offsets, and manifest.
- Atomic swap into final artifact directory.
- Cleanup temp on success or failure.

## Bundle IO Ownership
- `src/shared/bundle-io.js` is a public re-export facade only.
- `src/shared/bundle-io-paths.js` owns bundle format normalization, bundle file naming, manifest bundle-name validation, and patch/checksum sidecar path derivation.
- `src/shared/bundle-io-constants.js` owns bundle envelope, patch, checksum, and worker constants.
- `src/shared/bundle-io-checksum.js` owns payload normalization, payload-size estimates, checksum descriptors, and checksum verification.
- `src/shared/bundle-io/read.js` owns `readBundleFile`, including msgpack envelope validation, JSON parse validation, JSON patch application before checksum verification, and fail-closed checksum handling.
- `src/shared/bundle-io/write.js` owns `writeBundleFile` and `removeBundleWriteArtifacts`; full writes must clear patch files, and msgpack writes must remove JSON checksum sidecars.
- `src/shared/bundle-io/patch.js` owns `writeBundlePatch`, patch validation/application, patch metadata accounting, append-vs-rewrite behavior, and patch lock scope `bundle-patch-write`.
- `src/shared/bundle-io/support.js` owns worker offload, checksum sidecar writes, patch cleanup, and file-removal helpers. It must not import read, write, or patch owners.
- `src/shared/bundle-patch.js` remains worker-safe and pure; worker code must not import the fs/lock-owning patch module.

## Artifact Loader Ownership
- `src/shared/artifact-io.js` and `src/shared/artifact-io/loaders.js` are public facades; storage/indexing internals should import narrower owners when they need implementation details.
- `src/shared/artifact-io/manifest-entry-selection.js` owns manifest entry indexing, named path lookup, binary-columnar sidecar lookup, piece-by-path matching, and canonical variant selection.
- `src/shared/artifact-io/manifest-sources.js` owns source resolution, fallback behavior, artifact presence, and binary/directory artifact path resolution.
- `src/shared/artifact-io/columnar-rows.js` owns pure columnar row context, materialized inflation, and streaming iteration.
- `src/shared/artifact-io/loaders/shared.js` owns loader errors, cached JSON reads, metadata envelope normalization, shard gap checks, and JSONL offset validation. It must not absorb row-format materialization logic.
- `src/shared/artifact-io/loaders/binary-columnar.js` owns generic framed binary-columnar row payload reading and shared binary-columnar metadata validation.
- `src/shared/artifact-io/loaders/binary-columnar-chunk-meta.js` owns `chunk_meta` binary-columnar layout resolution and file-table row expansion.
- `src/shared/artifact-io/loaders/token-postings.js` owns `token_postings` binary-columnar layout resolution, varint posting decode, and cardinality invariants because `loadTokenPostings` is intentionally synchronous.

## Failure Handling
- Any missing shard or invalid offsets is a hard error in strict mode.
- Non-strict readers still fail when shard sequences are detectably partial (for example, missing `part-000001` between present shard files).
- If offsets missing or invalid, reader falls back to full JSONL scan.
- If JSON/columnar payloads exceed max bytes, non-strict readers may fall back to JSONL shards when available.
- Packed binary artifacts may include checksums in sidecar metadata; when present, readers must verify checksum before accepting the payload.
- All failures are logged with artifact name and shard path.

## Telemetry
Required fields:
- artifact.read.bytes
- artifact.read.rows
- artifact.read.durationMs
- artifact.read.usedOffsets
- artifact.write.bytes
- artifact.write.rows
- artifact.write.durationMs

## Breaking Changes
No backward compatibility requirements. All artifacts must adhere to this spec.
