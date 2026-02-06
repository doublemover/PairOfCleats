# Index Artifact Pipeline Benchmarks

This document covers the Phase 14 performance benchmarks for index artifact pipelines. All benchmarks write into `.benchCache/` under the repo root.

## Running The Benchmarks

Run benchmarks from the repo root.

1. `node tools/bench/index/build-state-write.js --mode compare`
2. `node tools/bench/index/import-resolution-graph.js --mode compare`
3. `node tools/bench/index/symbol-artifacts.js --mode compare`
4. `node tools/bench/index/chunk-meta-stream.js --mode compare`
5. `node tools/bench/index/graph-relations.js --mode compare`
6. `node tools/bench/index/chargram-postings.js --mode compare`
7. `node tools/bench/index/jsonl-offset-index.js --mode compare`
8. `node tools/bench/index/postings-packed.js --mode compare`
9. `node tools/bench/index/jsonl-compression-pipeline.js --mode compare`
10. `node tools/bench/index/import-graph-incremental.js --mode compare`
11. `node tools/bench/index/artifact-io-read.js --mode compare`
12. `node tools/bench/artifact-io/jsonl-offset-index.js`
13. `node tools/bench/artifact-io/artifact-io-throughput.js`
14. `node tools/bench/artifact-io/streaming-vs-materialize.js`
15. `node tools/bench/index/file-meta-streaming-load.js --index-dir <path>`

Each benchmark supports `--mode baseline`, `--mode current`, or `--mode compare`.

## Writer guardrails (Phase 16.2.3)
Unsharded JSONL writers now pass `maxBytes` into `writeJsonLinesFile`/`writeJsonLinesFileAsync` so oversized rows fail fast. This keeps byte budgets enforced even when a writer stays in the single-file path.

## Expected Deltas

### Build state write

- Target: fewer writes + lower p50/p95 latency for `updateBuildState`.
- Output: total ms, p50/p95 latency, and write count delta.

### Import resolution graph

- Target: higher nodes+edges throughput and stable cap behavior.
- Output: nodes, edges, throughput, and cap stats.

### Symbol artifacts

- Target: lower peak heap with identical output hash.
- Output: peak heap, duration, and hash match indicator.

### Chunk meta streaming

- Target: lower peak heap with identical output hash and trim stats.
- Output: peak heap, duration, hash, trim stats.

### Graph relations

- Target: higher bytes/sec and stable shard counts.
- Output: bytes/sec, shard counts, and delta.

### Chargram postings

- Target: bounded heap growth with stable throughput.
- Output: heap delta, spill counts, vocab size, and delta.

### JSONL offset index

- Target: lower p50/p95 latency for random row fetch.
- Output: scan vs offset-index latency.

### Packed postings

- Target: size ratio < 1.0 with tolerable decode delta.
- Output: size ratio and decode time delta.

### JSONL compression pipeline

- Target: lower wall time with acceptable size ratio when worker compression is enabled.
- Output: wall time delta, CPU time delta, and size ratio.

### Import graph incremental

- Target: high reuse ratio with faster warm runs.
- Output: reuse ratio, invalidations, and duration delta.

### Artifact IO read

- Target: higher rows/sec with deterministic shard ordering.
- Output: rows/sec, bytes/sec, and delta vs baseline.
- Note: manifest/meta hot-cache reduces repeated parse overhead in tight loops.

### Streaming vs materialized JSONL

- Target: lower heap and competitive rows/sec when using streaming iterator.
- Output: rows/sec, heap delta, and delta vs baseline materialized read.

## SQLite Build (Phase 16.9)
Stage4 SQLite build throughput benchmarks live under `tools/bench/sqlite/`:
- `node tools/bench/sqlite/build-from-artifacts.js --mode compare`
- `node tools/bench/sqlite/build-from-bundles.js --mode compare`
- `node tools/bench/sqlite/incremental-update.js --mode compare`
- `node tools/bench/sqlite/jsonl-streaming.js`

Use these when changing statement strategies (multi-row vs per-row prepared) and transaction boundaries so throughput decisions remain measurable.
