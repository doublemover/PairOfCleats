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

## JSONL Reader Fast Paths
- JSONL parsing uses a buffer scanner (no readline) to avoid per-line interface overhead.
- Reader highWaterMark adapts to file size for better throughput on large artifacts.
- Small JSONL files use a buffer scan fast path to avoid stream overhead.
- Zstd reads use streaming decompression for large shards; buffer decompression is limited to small files.
- Sharded JSONL reads support bounded parallelism with deterministic ordering.
- Validation modes: strict (required keys checked) vs trusted (skip required-key checks for hot paths).
- Missing shard parts are treated as errors in strict mode (surface missing paths early).

## Expectations
- Large JSONL reads stay streaming (line-by-line) for gzip, zstd, and plain files.
- Large array writes are streaming and avoid building full JSON strings in memory.
- IO telemetry stays opt-in and low-overhead when disabled.

## Offsets Metadata
- Offsets sidecars use the unified `u64-le` format with an explicit `version`.
- Sharded JSONL meta records offsets `format`, `version`, `compression`, and `suffix`.
