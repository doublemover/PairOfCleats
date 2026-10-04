# Shared IO + Serialization Performance

This document captures the shared JSON streaming and artifact IO performance work introduced in Phase 2. The focus is on bounded buffers, streaming decode/encode, and lightweight telemetry for large reads.

## JSON Streaming Controls
- `writeJsonLinesFile`, `writeJsonLinesSharded`, `writeJsonArrayFile`, and `writeJsonObjectFile` now accept `highWaterMark`.
- `writeJsonLinesFile` and `writeJsonLinesFileAsync` accept `maxBytes` to fail fast when a single JSONL row exceeds the budget.
- Sharded JSONL writers swap the entire parts directory atomically (temp dir → final) to avoid partial outputs.
- `highWaterMark` is applied to the JSON write stream buffer.
- `highWaterMark` is applied to compression transforms (gzip/zstd).
- `highWaterMark` is applied to the byte counter transform.
- The value is clamped to a safe range (16 KB to 8 MB) to prevent unbounded buffers.

Plain `writeChunk` calls honor the same drain/error/timeout handling without
collecting per-write timings that their callers discard. Writers that consume
`writeChunkWithTiming` still receive its flush and backpressure measurements.
A tiny real-encoder fixture preserves exact JSON bytes on both accepted and
backpressured streams while removing 140 unused clock reads; controlled failures
retain listener cleanup and the same errors. This removes observer work without
claiming whole-artifact throughput or memory gains.

## Zstd Chunk Boundaries
- Zstd compression chunk sizes are clamped to 64 KB to 4 MB.
- This reduces repeated buffer concatenations and keeps compression buffers bounded.

## Artifact Read Telemetry
A lightweight observer can record large artifact reads without tying shared IO to a specific metrics backend.

API (from `src/shared/artifact-io.js`):
- `setArtifactReadObserver(fn, { thresholdBytes })`
- `hasArtifactReadObserver()`
- `recordArtifactRead(entry)`
- `DEFAULT_ARTIFACT_READ_THRESHOLD`

Recorded fields for JSON/JSONL reads:
- `path`: artifact path
- `format`: `json` or `jsonl`
- `compression`: `null`, `gzip`, or `zstd`
- `rawBytes`: compressed or on-disk byte size
- `bytes`: inflated byte size (when available)
- `rows`: parsed row count when available
- `durationMs`: total read + parse duration

Telemetry only fires when:
- an observer is registered, and
- the read meets or exceeds `thresholdBytes` (default 8 MB).

## Manifest + Meta Hot Cache
- `pieces/manifest.json` and `*.meta.json` reads use a small stat-keyed in-memory cache to avoid repeated JSON parsing in tight loops.
- Cache entries are keyed by file path + size + mtime; changes invalidate automatically.

## Cache-Key Memo Retention
The two active module-global cache-key memos each retain at most an 8 MiB
string/reference proxy, for a 16 MiB aggregate per JavaScript isolate, alongside
their existing 65,536-entry ceilings. The proxy counts UTF-16 code units at two
bytes each and declared key/value reference slots at eight bytes; shared strings
may be counted conservatively twice. Map/object headers, backing-string behavior
and native/process memory are unmeasured. Worker isolates have independent module
instances, so these limits do not establish a whole-process or whole-build RSS
bound.

Reads and replacements retain FIFO order. Oversized entries stay outside the
memo; eviction falls back to the same serialization and SHA-1 computation without
changing keys, namespaces or versions. Tiny weighted controls and actual memo
fixtures verify replacement/eviction, exact digests and both aggregate limits.
The private single-property builder policy remains unchanged: current source
inventory finds it only in a benchmark and contract tests, with no production
caller. No strong registry was added to retain arbitrary builder instances.

## JSONL Reader Fast Paths
- JSONL parsing uses a buffer scanner (no readline) to avoid per-line interface overhead.
- Reader highWaterMark adapts to file size for better throughput on large artifacts.
- Small JSONL files use a buffer scan fast path to avoid stream overhead.
- Zstd reads use streaming decompression for large shards; buffer decompression is limited to small files.
- Sharded JSONL reads support bounded parallelism with deterministic ordering.
- Validation modes: strict (required keys checked) vs trusted (skip required-key checks for hot paths).
- Missing shard parts are treated as errors in strict mode (surface missing paths early).
- Non-strict readers still reject detectably partial shard sequences (gap detection in shard indexes).
- Packed minhash readers validate sidecar checksums when checksum metadata is present.
- Streaming row iterators are the default for large JSONL reads; materialized arrays require explicit opt-in.
- Streaming iterators support backpressure and optional in-flight row caps.

## Expectations
- Large JSONL reads stay streaming (line-by-line) for gzip, zstd, and plain files.
- Large array writes are streaming and avoid building full JSON strings in memory.
- IO telemetry stays opt-in and low-overhead when disabled.

## Offsets Metadata
- Offsets sidecars use the unified `u64-le` format with an explicit `version`.
- Sharded JSONL meta records offsets `format`, `version`, `compression`, and `suffix`.
