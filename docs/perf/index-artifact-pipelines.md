# Index Artifact Pipeline Benchmarks

This document covers the Phase 14 performance benchmarks for index artifact pipelines. Disposable benchmark workspaces live under `.tmp/dev/benchmarks/`, resolved by `tools/shared/dev-artifacts.js`.

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
`build-from-artifacts` supports `--index-dir <path>` for benchmarking real Stage2 output and `--statement-strategy` for forcing prepared vs multi-row behavior.

Bundle build and incremental update keep `--profile smoke` as the cheap default.
Explicit `--profile lexical` and `--profile wide` select serial candidate workloads:

| Profile | Files × chunks | Tokens/chunk | Independent trials | Update rounds | Changed / added / deleted | Shrunk / grown within changed |
| --- | --- | --- | --- | --- | --- | --- |
| smoke | build 20×6; update 12×6 | 2 | 1 | 1 | 1 / 0 / 0 | 0 / 0 |
| lexical | 128×64 | 24 | 6 | 3 | 16 / 4 / 4 | 4 / 4 |
| wide | 256×128 | 48 | 6 | 3 | 32 / 8 / 8 | 8 / 8 |

For a scoped qualification task, use, for example,
`node tools/bench/sqlite/incremental-update.js --profile lexical --mode compare`.
These explicit experiments are outside ordinary unit execution. They have not
been executed as part of the current implementation wave.

`--files`, `--chunks`, `--tokens`, `--vocabulary` and `--trials` override workload
dimensions; vocabulary defaults to 4,096 with common repeated terms. Update-only
`--rounds`, `--changed-files`, `--added-files`, `--deleted-files`, `--shrink-files`
and `--grow-files` separate mutation sizes from total repository size. Shrink and
grow counts are disjoint subsets of changed existing files. Smaller overrides
lose preset-workload eligibility; fewer than six trials remain unqualified.
Admission caps trials at 12, rounds at 6, projected rows at 262,144 and projected
token occurrences at 4,194,304. Production change-ratio and transaction guards
remain active; a refused update fails the experiment instead of becoming a build.

Trials create independent databases and alternate arm order. Update arms begin
from identically prepared/validated starting databases, then apply separately
identified mutation rounds. Immutable source snapshots and exact output/posting/
manifest/filter-fact checks stay outside operation timing. Per-file FTS hits are
required during validation; this does not measure retrieval latency.

The run-owned workspace retains atomic owner/checkpoint/final receipts with raw
samples, paired deltas, per-round median/nearest-rank p95, source/runtime identity,
manifest digests, observed rows/statements/batches and setup/validation timings.
Partial failures preserve a failed receipt and completed samples. The printed
receipt path identifies the exact run. Operation timing includes production
checkpoint/close work; its own telemetry preserves phase detail. Filesystem cache
state is uncontrolled and recorded; new database files do not imply cold OS caches.
The synthetic lexical profiles do not qualify dense/phrase/chargram lanes,
retrieval latency or sustained gains by themselves. Keep existing latency source-hit
assertions, raw warm distributions and thresholds in their separate qualification.

Stage4 notes:
- `chunks_fts` is contentless (`content=''`, `contentless_delete=1`) and is used for MATCH + bm25 ranking only.
- Full builds run an explicit FTS optimize step before `PRAGMA optimize`/`ANALYZE`.
- Most lookup-heavy tables rely on PRIMARY KEY/UNIQUE indexes (and avoid redundant secondary indexes).

### Packed MinHash checksum reuse

Packed MinHash publication passes its already-computed SHA-1 and exact byte
length to the pieces manifest. The metadata sidecar supplies a SHA-1 of its
committed encoded bytes from the streaming writer. Both pieces are registered
only after the binary and metadata job succeeds. Their manifest checksums now
use the supported `sha1:` form instead of the fallback reread's `xxh64:` form;
packed payload and sidecar bytes are unchanged. A failed metadata rename does
not publish the manifest. Other artifact families may still use the checksum
fallback; no total artifact-I/O or timing gain is claimed.
