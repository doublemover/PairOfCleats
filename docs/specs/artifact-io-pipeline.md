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

## Atomic Writes
- Write to temp dir: .tmp/<artifact>/
- Verify shard counts, offsets, and manifest.
- Atomic swap into final artifact directory.
- Cleanup temp on success or failure.

## Failure Handling
- Any missing shard or invalid offsets is a hard error in strict mode.
- If offsets missing or invalid, reader falls back to full JSONL scan.
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
