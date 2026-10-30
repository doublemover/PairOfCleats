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
- Stream framing searches only newly decoded text, retaining unfinished row
  fragments and joining them once when the delimiter or EOF arrives. It never
  searches an already scanned row prefix after a new chunk. The same private
  framing owner serves synchronous and awaited row callbacks; buffered parsing
  retains its existing single-pass walker.
- Raw bytes from the decoded/plain stream are admitted before accumulation.
  `StringDecoder` retains UTF-8 boundary/replacement behavior; CRLF, blank-line
  numbering, strict/trusted validation and unterminated final rows retain their
  existing meaning. Awaited callbacks hold iteration before another row or chunk
  is delivered. Failure/cancellation clears attempt-local fragments in `finally`.
- Private framing counters distinguish logical delimiter-search code units and
  joined code units from engine character comparisons or measured CPU. Linear
  framing work does not remove the admitted complete-row allocation/JSON parse,
  change row limits or establish a measured throughput/memory improvement.

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

### Contained reads and bounded binary windows

Strict manifest paths are admitted under the selected index directory and reject
linked path components, including Windows junction metadata. Opening a file must
also bind the descriptor to that admitted ordinary file; a path check alone is
insufficient when the path can change between admission and open. JSON, JSONL,
binary-columnar sidecars and packed payloads retain this containment contract.

Positioned reads fill their requested range by advancing both destination and
file offsets after every positive short read. Zero progress before the complete
range is an explicit truncation error. Packed token postings retain their token
and byte window limits during retries; a short read never triggers an unbounded
whole-file fallback. A single posting larger than the configured window fails
with an explicit byte-budget error before allocation.

Streaming JSONL owns both compressed input and decoder lifetimes. Completion,
failure, cancellation and early iterator return destroy outstanding streams and
wait for their actual close events. Source errors remain observable through the
decoder. Materialized and streaming readers use the same admitted path authority.

### Publication authority

Replacing an existing sharded family writes an immutable generation beneath the
selected index directory. The enclosing `pieces/manifest.json` replacement is the
single authority change; token postings and chunk metadata compaction publish
their complete replacement inventories together under the existing index lock.
Old canonical files and selected generations remain readable for readers that
already hold the previous manifest. Retention belongs to the existing build
cleanup owner, rather than the writer deleting an old generation immediately.

Publication records require explicit successful validation evidence. Unknown
statuses, absent evidence, failed validation wrappers and manifest/committed
piece identity mismatches fail admission. Name, relative path, format and any
declared count, byte size or checksum must agree; repeated paths are errors.
Cleanup removal failures are reported as failures and cannot establish success.

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
