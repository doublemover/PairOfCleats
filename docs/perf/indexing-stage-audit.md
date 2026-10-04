# Indexing Stage Audit

This document describes the stage audit checkpoints emitted during index builds. The goal is to capture memory/timing snapshots at key stage boundaries and provide a compact summary for performance triage.

## Output Locations
- `metrics/stage-audit-<mode>.json` (per mode, per build)
- `build_state.json` under `stageCheckpoints` (per mode)
- `build_state.json` under `orderingLedger` (ordering hashes + seeds)

## Determinism
Stage audit files are append-only per build and MUST be deterministic for the same input and config. Checkpoint ordering follows the stage/step execution order and is stable across runs.

## Stages
- `stage1`: discovery + imports + processing + postings
- `stage2`: relations + artifact writes
- `stage3`: embeddings + ANN/LanceDB
- `stage4`: SQLite build

## Schema
Each stage audit file contains:
- `version`: schema version for checkpoints
- `generatedAt`: timestamp
- `buildId`: build identifier (when available)
- `mode`: `code`, `prose`, `extracted-prose`, or `records`
- `checkpoints`: ordered snapshots
- `stages`: per-stage summary
- `highWater`: global high-water marks for memory and extra counters

Checkpoint fields:
- `at`: ISO timestamp
- `elapsedMs`: time since checkpoint recorder start
- `stage`: stage identifier
- `step`: sub-step label
- `memory`: `rss`, `heapUsed`, `heapTotal`, `external`, `arrayBuffers`
- `extra`: stage-specific counters (files, chunks, vocab sizes, vector counts)

Stage summary fields:
- `startedAt`, `finishedAt`, `elapsedMs`
- `checkpointCount`
- `memoryHighWater`
- `extraHighWater`

## Interpreting Results
- Memory spikes are identified by high-water marks across `rss`/`heapUsed`.
- Stage1 counters highlight postings map growth and chunk retention.
- Stage2 counters highlight relation graph sizes and file relation counts.
- Stage3 counters track vector counts and backend availability.
- Stage4 counters track input/output sizes and row counts.

Use these reports to prioritize optimization work before implementing algorithmic changes.

## Stage1 Memory Notes

Successful identical GraphQL and Handlebars inputs reuse their existing bounded,
immutable syntax model before rebuilding a line-start array. Controlled warm
fixtures reduce 64 and 96 line-start additions respectively to zero; the actual
syntax-boundary controls still pass. Only successful models are cached, with one
text/model per parser instance. Source/line/node limits, fallback precedence,
one-time parser setup receipts and collector deadline checks remain unchanged.
This removes repeated line scanning/array construction on model hits; no whole
indexing speed or RSS improvement has been measured.

Handlebars traversal also queues only object children. Scalar path components,
which were previously wrapped in frames and immediately discarded, stay outside
the work stack; child depth and scope are carried directly instead of creating
an unused record for every property. A 128-component path fixture queues two
object frames and zero primitive frames, with the same actual parser ranges and
immutable result. Node/depth limits, child ordering, local partial scopes and
raw/comment/escape boundaries retain their existing behavior.
- File-text byte sizing includes both the selected raw buffer and an owned
  decoded-text data property when the producer retains both. The UTF-8 text
  estimate extends the existing per-entry proxy; it is not exact JS heap size or
  shared-reference accounting across keys. A tiny actual cache-writer/restore
  fixture counts 9 buffer bytes plus 9 text bytes, so two independent entries
  cannot fit a 24-byte proxy budget. Buffer-only/text-only, empty-buffer fallback,
  dynamic accessors and explicit entry-only/disabled cache policies remain
  compatible. This may evict a dual-representation entry earlier; raw buffers
  and text are still retained for their existing consumers.
- Comment byte truncation encodes only the admitted UTF-8 prefix for positive
  integer caps, preserving complete character boundaries and existing byte/text
  results. A tiny actual comment-collector fixture verifies a 31-byte temporary
  buffer instead of encoding the complete 16 KiB source comment first. The source
  string is still retained and its encoded length is checked; this is not a
  whole-index RSS or latency measurement. Fractional/legacy cap inputs retain
  their previous behavior, and file reads/encoding detection are unchanged.
- Token sequences share the token array when no synonyms are present to reduce duplicate retention.
- Field/comment tokens are only materialized when fielded/phrase/chargram sources require them.
- Postings maps are cleared as soon as dense arrays are materialized to keep peak heap lower.
- Token IDs are canonicalized at tokenize time (64-bit hash); chunk meta can retain packed token IDs to reduce memory pressure.
- Chargram postings use rolling 64-bit hashes (`h64:`) with a max token length guard to cap per-chunk growth.
- Stable vocab ordering hashes are recorded in `vocab_order` and the ordering ledger for determinism audits.
- LSP UTF-8/UTF-32 position conversion derives width directly from each code
  point instead of creating a substring for every traversed character. UTF-16
  offsets, CRLF line clamping, partial-byte boundaries and lone-surrogate
  replacement widths retain their existing semantics. Tiny oracle fixtures cover
  4,806 coordinate cases and count removed substring/encoding calls; this is not
  an end-to-end LSP latency measurement or a new coordinate cache.
- Successful explicit LSP pool drain retires unused, never-failed health records
  after session disposal. Active callback leases and pending creation/disposal
  protect their records; failure/recovery/quarantine history remains retained.
  A no-server-start fixture proves eight healthy keys retire while those owners
  survive. Historical failure metadata is still intentionally unbounded, so this
  is a scoped lifetime improvement rather than a complete health-cache budget.
- Diagnostic projection reuses the app-owned overlap lookup for consecutive
  identical source-offset ranges within one immutable document. It retains three
  scalar values rather than a growing query cache; changed ranges and document
  boundaries perform a fresh lookup. Nested target ties, encodings, dedupe/caps
  and custom callback behavior remain compatible. A 48-diagnostic tiny fixture
  performs one target lookup instead of 48; whole-session speed is unmeasured.
- A bounded postings queue now applies backpressure between tokenization and postings apply; queue depth + wait time show up in checkpoint `extra.postingsQueue`.
- Tree-sitter stats are recorded in checkpoint `extra.treeSitter` (grammar
  loads/failures/misses, parser activations, query and chunk cache hits/misses,
  worker fallbacks, parse timeouts/disable counts, batch sizing/deferrals, and
  cache sizes). Those cache counters do not establish native grammar unloading.
- Optional persistent Tree-sitter caching bounds its positive memo rows and
  negative lookup keys using the existing chunk-cache entry limit. Hits refresh
  their LRU position, configuration shrink trims both auxiliary maps, and root
  changes still reset them. Eviction retires memory entries while retaining disk
  cache files; a later lookup may reread them. Defensive chunk/meta clones and
  source/config cache identities remain unchanged. Tiny fixtures verify entry
  bounds and disk/memo parity; this is an entry-count policy, not a byte or native
  grammar residency budget.

## Stage2 Memory Notes
- Columnar file metadata allocates an optional column only when it first receives
  a non-null value, filling earlier rows with the same null prefix. Required
  columns, column/table order, false/zero/empty values and serialized output are
  unchanged; unusual undefined values keep their original behavior. A 64-row
  minimal fixture avoids 15 discarded arrays and 960 null appends, while a
  pre-change mixed snapshot and existing roundtrip control preserve output.
  The original file-meta rows and every retained column remain materialized;
  this is a scoped temporary-allocation reduction rather than a new format or
  whole-build heap measurement.
- After dispatch consumes an original, one-use artifact-planner entry, it drops
  that entry's job closure and prefetch promise. Completed payloads can leave the
  retained planning array while later writes continue. Pending entries, producer
  callbacks and piece metadata remain live until their corresponding attempt
  settles; direct dispatcher entries and caller-frozen entries keep their prior
  callable behavior. A tiny delayed-write fixture verifies these references and
  job/scheduler/metadata failure paths. Other payload owners, queued work and
  scheduler/compression buffers remain unchanged; no whole-build RSS reduction
  has been measured.
- The import-resolution filesystem-existence accelerator computes its three
  seeded Bloom hashes in one UTF-16 character pass. Seeds, bit positions and the
  separate exact-membership hash are unchanged; the callbacks are shared for the
  life of the index rather than allocating a hash tuple for every path. A tiny
  fixture compares 4,224 membership and hash-decision cases, including Bloom
  false positives rejected by exact lookup, and retains incomplete-scan/ignore
  behavior. This removes repeated character reads without an end-to-end resolver
  latency claim.
- `graph_relations` is built from a streamed edge spill/merge pipeline and emitted as sharded JSONL to avoid materializing in-memory graph structures.
- Spill buffers are bounded by bytes/rows and use a staging directory under the index output that is cleaned up after finalization.
- Repo map construction dedupes entries within file/name/kind groups to reduce duplicate retention; legacy variants are removed only after successful writes to preserve rollback safety.
- Filter index maps/sets are released after serialization to reduce retention during artifact writes; filter_index build is best-effort and may be skipped on build/validation errors.
  - When rebuilding artifacts into an existing index directory, filter_index is reused from the prior pieces manifest when available to avoid losing this optional artifact on transient failures.
- Filter index hydration builds bitmap sidecars (including per-file chunk bitmaps for large files) to accelerate file path prefiltering without changing serialized output.

## Stage3 Notes
- Embeddings cache uses append-only shards plus a per-cache lock (`cache.lock`) to prevent concurrent shard corruption when cache scope is global.
- Cache index updates are merged under the lock before atomic replace; pruning is best-effort and evictions are treated as cache misses by readers.
- Cache usage telemetry is recorded under `index_state.embeddings.cacheStats` (attempts/hits/misses/rejected/fastRejects).
- Cache writes are scheduled through a bounded writer queue to avoid retaining unbounded pending payloads while IO is backlogged.
  When saturated, embedding compute awaits before scheduling additional writes (backpressure).
- `build-embeddings` returns writer queue stats per mode (maxPending/pending/peakPending/waits/scheduled/failed) for tuning and regression checks.

## Stage4 Memory Notes
- SQLite inserts are chunked into bounded transactions based on input size to reduce WAL and statement retention.
- Bundle ingestion splits large files into smaller insert batches to avoid oversized transactions.
- Incremental updates only load chunk rows for changed/deleted files instead of scanning the full chunks table.

## Scheduler Notes

Internal telemetry polls pass scalar arguments to the interval-gated capture
helpers instead of constructing two public-options records on every schedule,
stats or interval poll. The public capture options/defaults remain unchanged.
Tiny controls verify one clock read per poll, no unsampled queue walks, separate
live snapshots when callbacks change queue state, forced capture and bounded
record retention; the actual three-task scheduler control also passes. The
removed records are a source-level allocation change, with no measured heap or
throughput result and no change to sampling policy.

Build-state waiter removal mutates its private dense array in order. Settling
an already-detached flush batch leaves the next batch's waiter array untouched,
instead of copying it once per completed waiter. A tiny two-batch fixture observes
four unrelated array copies and sixteen copied references become zero, while
ordered outcomes, pending counts, explicit flush and lifecycle release agree.
Existing required-write, retry, no-wait telemetry and timeout controls also pass.
This avoids temporary array retention; it does not bound waiter count or change
durability, debounce, retry or timeout policy.
- When the build scheduler is enabled, queue depth, token usage, and starvation counters are exposed via scheduler stats.
- Stage progress reporting includes scheduler stats in its metadata payload for each stage transition.
- Stage wiring uses the scheduler queues (`stage1.cpu`, `stage1.io`, `stage1.proc`, `stage1.postings`, `stage2.relations`, `stage2.relations.io`, `stage4.sqlite`) to ensure global backpressure.
- Stage3 embeddings uses scheduler queues (`embeddings.compute`, `embeddings.io`) for batch compute and artifact/cache IO.

## Bench Harness
- `tools/bench/bench-runner.js` batches core phase benches and emits a single JSON report (schema: `docs/schemas/bench-runner-report.schema.json`).
- Example (CI-safe subset):
- `node tools/bench/bench-runner.js --suite sweet16-ci --json .testLogs/bench-sweet16.json --quiet`

## Stage1 Bench + Regression Coverage
- `tools/bench/index/postings-real.js`: end-to-end Stage1 `code` benchmark that generates a fixed corpus via `tests/fixtures/medium/generate.js` (default `--seed postings-real --count 500`) and compares baseline/current runs.
- `tools/bench/index/chargram-postings.js --rolling-hash`: microbench for chargram postings build throughput and key representation (`h64:`) with baseline/current compare.
- `tools/bench/index/tree-sitter-load.js --json`: tree-sitter benchmark comparing cold vs warm parse/chunk throughput and file-order vs batch-by-language policies under `maxLoadedLanguages` eviction pressure.
- Regression tests:
- `tests/indexing/postings/real-bench-contract.test.js`
- `tests/indexing/postings/chargram-bench-contract.test.js`
- `tests/indexing/postings/chunk-meta-determinism.test.js`
- `tests/perf/indexing/postings/heap-plateau.test.js`
- `tests/perf/indexing/postings/stage1-memory-budget.test.js`
- `tests/indexing/tree-sitter/load-bench-contract.test.js`
- `tests/indexing/tree-sitter/parse-determinism.test.js`
- `tests/indexing/tree-sitter/chunk-cache-reuse.test.js`
- `tests/indexing/tree-sitter/memory-plateau.test.js`

## Stage2 Bench + Regression Coverage
- `tools/bench/index/filter-index-build.js`: Stage2 filter_index build microbench; compares baseline/current and prints size/throughput deltas.
- `tools/bench/index/relations-build.js`: Stage2 graph_relations build benchmark; compares baseline graph build vs streaming spill/merge build.
- `tools/bench/index/repo-map-compress.js`: Stage2 repo_map iterator/dedupe benchmark; compares baseline iterator vs current ordering/dedupe.
- Regression tests:
- `tests/perf/indexing/relations/streaming-build.test.js`
- `tests/indexing/relations/determinism-bench-contract.test.js`
- `tests/indexing/relations/collision-guard.test.js`
- `tests/indexing/relations/atomicity-rollback.test.js`
- `tests/indexing/filter-index/atomic-swap.test.js`
- `tests/indexing/filter-index/metrics.test.js`
