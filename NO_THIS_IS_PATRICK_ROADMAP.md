# NO_THIS_IS_PATRICK_ROADMAP

## Scope
This roadmap covers modularization and performance hardening for the 49 specified files:
- `src/contracts/schemas/artifacts.js`
- `src/index/build/artifacts-write.js`
- `src/index/build/artifacts/writers/chunk-meta/writer.js`
- `src/graph/neighborhood.js`
- `src/index/build/build-state.js`
- `src/index/build/file-processor.js`
- `src/index/build/file-processor/cpu.js`
- `src/index/build/file-processor/process-chunks/index.js`
- `src/index/build/import-resolution/language-resolvers.js`
- `src/index/build/incremental.js`
- `src/index/build/indexer/pipeline.js`
- `src/index/build/indexer/steps/process-files.js`
- `src/index/build/indexer/steps/relations.js`
- `src/index/build/runtime/runtime.js`
- `src/index/build/state.js`
- `src/index/build/tokenization.js`
- `src/index/build/tree-sitter-scheduler/plan.js`
- `src/index/build/tree-sitter-scheduler/runner.js`
- `src/index/build/workers/pool.js`
- `src/index/chunking/dispatch.js`
- `src/index/diffs/compute.js`
- `src/index/language-registry/registry-data.js`
- `src/index/scm/providers/git.js`
- `src/index/type-inference-crossfile/pipeline.js`
- `src/index/validate.js`
- `src/integrations/core/build-index/stages.js`
- `src/integrations/tooling/providers/lsp.js`
- `src/lang/sql.js`
- `src/lang/tree-sitter/chunking.js`
- `src/retrieval/cli/load-indexes.js`
- `src/retrieval/cli/run-search-session.js`
- `src/retrieval/cli/run-search.js`
- `src/retrieval/output/format.js`
- `src/shared/artifact-io/json.js`
- `src/shared/artifact-io/loaders/core.js`
- `src/shared/concurrency.js`
- `src/shared/subprocess.js`
- `src/storage/sqlite/build/incremental-update.js`
- `src/storage/sqlite/build/runner.js`
- `tools/bench/language-repos.js`
- `tools/bench/language/metrics.js`
- `tools/build/embeddings/cache.js`
- `tools/build/embeddings/runner.js`
- `tools/reports/show-throughput.js`
- `tools/service/indexer-service.js`
- `tools/tui/supervisor.js`
- `tools/usr/generate-usr-matrix-baselines.mjs`
- `tests/ci-lite/ci-lite.order.txt`
- `tests/fixtures/perf/index/caps-calibration-inputs.json`

## Implementation status (2026-02-23T05:16:00.0000000-05:00)
Status classification used for this roadmap:
- Implemented on branch: file appears in diff against `origin/main`.
- Remaining in scope: file does not yet appear in diff against `origin/main`.

Current snapshot:
- Scoped files: 49
- Implemented on branch: 49
- Remaining in scope: 0

Coverage closeout:
- `tests/fixtures/perf/index/caps-calibration-inputs.json` and companion results fixture were regenerated from deterministic runtime calibration artifacts and are guarded by `tests/indexing/runtime/caps-calibration-fixture-parity.test.js`.

Note:
- 23 scoped files are still over 800 lines. Those are mostly already-refactored surfaces that still have follow-up split opportunities; they are not untouched scope items.

## Follow-up split log (current pass)
- 2026-02-23T05:04:12.2730914-05:00
  Split `src/index/build/indexer/steps/process-files.js` stall diagnostics into `src/index/build/indexer/steps/process-files/stall-diagnostics.js`, and optimized stalled-file selection to bounded top-N collection to reduce watchdog snapshot sort/allocation overhead.
- 2026-02-23T05:07:10.7270007-05:00
  Optimized `src/shared/artifact-io/json.js` hot fallback reads by removing preflight `existsSync` probes in `readJsonFile`/`readJsonLinesEach` and preserving deterministic fallback/error semantics via explicit missing-read classification.
- 2026-02-23T05:07:52.0764099-05:00
  Split scheduler telemetry capture out of `src/shared/concurrency/scheduler-core.js` into `src/shared/concurrency/scheduler-core-telemetry-capture.js`, reducing core-module surface area and preserving queue/trace snapshot behavior with explicit JSDoc on concurrency-sensitive capture paths.
- 2026-02-23T05:08:20.0964593-05:00
  Decomposed `tools/tui/supervisor.js` into focused modules (`constants`, `protocol-flow`, `request-utils`, `progress-decoder`, `watchdog`, `artifacts`, `jobs`) and kept the top-level supervisor as orchestration-only glue, including concurrent artifact stat probing for lower end-of-run overhead.
- 2026-02-23T05:12:01.7734790-05:00
  Split `tools/service/indexer-service.js` into `progress-monitor`, `job-executor`, `job-completion`, and `queue-worker` modules, preserving queue semantics while reducing monolith coupling and deduplicating concurrent stale-job sweep work to lower lock/contention overhead at higher worker concurrency.
- 2026-02-23T05:12:27.7018204-05:00
  Decomposed `tools/bench/language-repos.js` into focused `planning`, `logging`, `lifecycle`, and `run-loop` modules, preserving deterministic execution and adding cache-backed query/runtime/artifact reuse plus one-time repo config guards to reduce repeated setup/scanning overhead across large benchmark matrices.
- 2026-02-23T05:17:48.3241468-05:00
  Extracted runtime dictionary and tree-sitter preload warm-cache logic from `src/index/build/runtime/runtime.js` into `src/index/build/runtime/dictionaries.js` and `src/index/build/runtime/tree-sitter-preload.js`, preserving daemon cache semantics while reducing runtime monolith coupling and trimming repeated signature/preload key work via memoized normalization.
- 2026-02-23T05:20:52.8948618-05:00
  Split `src/index/build/indexer/pipeline.js` policy-context and telemetry summarizers into `src/index/build/indexer/pipeline/policy-context.js` and `src/index/build/indexer/pipeline/summaries.js`, reducing main-pipeline orchestration coupling and consolidating normalization code for reuse and lower duplication risk.
- 2026-02-23T05:28:08.7675465-05:00
  Refactored `tools/usr/generate-usr-matrix-baselines.mjs` into modular `datasets`, `builders`, and `io` units, preserving generated matrix outputs while adding write-elision for unchanged payloads to reduce unnecessary disk churn during baseline refresh runs.
- 2026-02-23T05:29:20.3531152-05:00
  Decomposed `src/index/build/workers/pool.js` into focused `queue`, `lifecycle`, `worker-coordination`, `payload`, and `meta` modules, preserving backpressure/restart/shutdown semantics and reducing hot-path metrics overhead by skipping redundant gauge writes.
- 2026-02-23T05:29:42.9459667-05:00
  Split `src/index/build/tree-sitter-scheduler/plan.js` into `policy-normalization`, `candidate-ranking`, and `assembly` modules, preserving deterministic plan ordering while reducing repeated rebalance work via cached bucketing context during shard assembly.
- 2026-02-23T05:29:59.0378464-05:00
  Refactored `src/storage/sqlite/build/runner.js` into `selection-planning`, `execution-orchestration`, and `reporting-state-transitions` modules, preserving sqlite build mode semantics while reducing redundant chunk-meta/output probing and isolating checkpoint/report flow control.
- 2026-02-23T05:32:16.9516919-05:00
  Optimized `src/shared/concurrency/scheduler-core.js` queue wait sampling by replacing per-event bounded-array shifts with a fixed-size ring buffer, preserving percentile behavior while reducing completion-path allocation/compaction overhead in long-lived schedulers.
- 2026-02-23T05:36:56.8007092-05:00
  Completed the `src/index/build/incremental.js` split into `planning`, `shared`, `state-reconciliation`, and `writeback` modules, preserving the public incremental API through a facade while reducing duplicated IO/hash/bundle helper code and parallelizing reuse checks in planning.

## Architectural assessment (what needs to change)

### 1) Primary bottleneck pattern: orchestration-heavy monoliths
Largest hotspots (`artifacts-write`, `process-files`, `embeddings/runner`, `show-throughput`, `build-state`, `runtime`) combine:
- policy resolution
- IO and serialization
- scheduling/concurrency control
- instrumentation/reporting
- failure/retry paths

This creates high coupling and makes performance work risky because each optimization can affect correctness.

### 2) Duplicated low-level helpers still leak across the codebase
Common patterns are repeatedly re-implemented:
- positive int / clamp / range coercion
- line counting and tree-sitter limit checks
- ad-hoc `runWithConcurrency` wrappers
- path normalization variants
- histogram/percentile summaries
- ETA and duration formatting

This causes inconsistency and unnecessary micro-overhead in hot paths.

### 3) Too much repeated data scanning/serialization in heavy paths
Examples:
- chunk/meta artifacts are scanned and serialized multiple times in different branches
- scheduler planning/runner repeatedly parse index rows and cost metrics
- retrieval/session mode loops perform similar expansion/filter operations
- embeddings and sqlite incremental paths re-read or re-derive state per mode/file

### 4) Correct sequencing is currently an implicit contract
Many flows depend on strict ordering (build state, stage checkpoints, manifest writes, cache flushes, cleanup). Current structure makes this easy to break during refactor.

---

## Existing shared modules to leverage immediately

Mandatory reuse targets in the refactor:
- `src/shared/number-coerce.js`
- `src/shared/path-normalize.js`
- `src/shared/time-format.js`
- `src/shared/lines.js`
- `src/shared/concurrency.js`
- `src/shared/stable-json.js`
- `src/shared/cache-key.js`
- `src/shared/embedding-identity.js`
- `src/shared/embeddings-cache/index.js`
- `src/shared/artifact-io/*` loaders/manifest/checksum pieces

Policy: no new local helper is added if equivalent functionality already exists in one of these.

## Immediate reuse matrix (existing shared modules -> where to apply)
- `src/shared/number-coerce.js`:
  `src/index/build/runtime/runtime.js`, `src/index/build/indexer/steps/process-files.js`, `src/index/diffs/compute.js`, `src/integrations/tooling/providers/lsp.js`, `tools/build/embeddings/runner.js`, `src/index/scm/providers/git.js`
- `src/shared/lines.js`:
  `src/index/build/file-processor/cpu.js`, `src/index/build/tree-sitter-scheduler/plan.js`, `src/lang/tree-sitter/chunking.js`, `tools/bench/language/metrics.js`
- `src/shared/concurrency.js`:
  remove local concurrency wrappers in `src/integrations/tooling/providers/lsp.js` and `src/index/scm/providers/git.js`; standardize queue behavior in `src/retrieval/cli/load-indexes.js`, `tools/build/embeddings/runner.js`, `tools/service/indexer-service.js`
- `src/shared/path-normalize.js`:
  unify path normalization in `src/index/scm/providers/git.js`, `src/index/build/import-resolution/language-resolvers.js`, `src/retrieval/cli/load-indexes.js`, `tools/bench/language-repos.js`
- `src/shared/time-format.js`:
  replace duplicated duration/ETA formatting in `tools/bench/language/metrics.js`, `tools/service/indexer-service.js`, `tools/build/embeddings/runner.js`, `tools/reports/show-throughput.js`
- `src/shared/stable-json.js` and `src/shared/hash.js`:
  unify deterministic signatures in `src/index/build/artifacts-write.js`, `src/index/build/incremental.js`, `src/index/diffs/compute.js`, `src/retrieval/cli/run-search-session.js`, `tools/build/embeddings/cache.js`
- `src/shared/subprocess.js`:
  standardize process lifecycle handling across `src/index/build/tree-sitter-scheduler/runner.js`, `src/retrieval/cli/load-indexes.js`, `tools/service/indexer-service.js`, `tools/tui/supervisor.js`
- `src/shared/artifact-io/*`:
  remove ad-hoc artifact reads in `src/index/validate.js`, `src/retrieval/cli/load-indexes.js`, `tools/build/embeddings/runner.js`, `tools/reports/show-throughput.js`

---

## New shared module candidates to hoist

Create these as stable shared building blocks:
- `src/shared/perf/histogram.js`
- `src/shared/perf/percentiles.js`
- `src/shared/perf/eta.js`
- `src/shared/io/stream-batch.js`
- `src/shared/io/manifest-read-plan.js`
- `src/shared/indexing/tree-sitter-limits.js`
- `src/shared/indexing/chunk-cost.js`
- `src/shared/scheduler/watchdog-policy.js`
- `src/shared/scheduler/stall-policy.js`
- `src/shared/scm/batch-timeout-plan.js`
- `src/shared/cli/render-tables.js`

---

## Shared-code capture catalog (exact consolidation targets)
- Numeric coercion family:
  consolidate `clampPositiveInt`/`clampIntRange`/`toPositiveIntOrNull` variants from `src/integrations/tooling/providers/lsp.js`, `src/index/scm/providers/git.js`, `tools/build/embeddings/runner.js`, `src/index/diffs/compute.js` into `src/shared/number-coerce.js`.
- Tree-sitter line/limit checks:
  consolidate duplicated `countLines` and `exceedsTreeSitterLimits` logic from `src/index/build/file-processor/cpu.js`, `src/index/build/tree-sitter-scheduler/plan.js`, `src/lang/tree-sitter/chunking.js` into `src/shared/indexing/tree-sitter-limits.js`.
- Local concurrency wrappers:
  remove local `runWithConcurrency` implementations in `src/integrations/tooling/providers/lsp.js` and `src/index/scm/providers/git.js`; use `src/shared/concurrency.js`.
- Document extraction text builders:
  consolidate duplicated `buildPdfExtractionText` and `buildDocxExtractionText` paths in `src/index/build/file-processor.js` and `tools/bench/language/metrics.js` into `src/index/extractors/common.js`.
- Duration and ETA formatting:
  consolidate formatters across `tools/bench/language/metrics.js`, `tools/service/indexer-service.js`, `tools/build/embeddings/runner.js`, `tools/reports/show-throughput.js` into `src/shared/time-format.js` plus `src/shared/perf/eta.js`.
- Histogram/percentile math:
  consolidate queue-delay and latency summarizers from `src/index/build/artifacts-write.js`, `src/index/build/indexer/steps/process-files.js`, `tools/bench/language/metrics.js`, `tools/reports/show-throughput.js` into `src/shared/perf/histogram.js` and `src/shared/perf/percentiles.js`.
- Path normalization and repo-relative conversion:
  consolidate `normalize*Path` variants from `src/index/scm/providers/git.js`, `src/index/build/import-resolution/language-resolvers.js`, `src/retrieval/cli/load-indexes.js`, `tools/bench/language-repos.js` into `src/shared/path-normalize.js`.
- Stable signature hashing:
  consolidate deterministic hash/signature helpers from `src/index/build/artifacts-write.js`, `src/index/build/incremental.js`, `src/index/diffs/compute.js`, `src/retrieval/cli/run-search-session.js`, `tools/build/embeddings/cache.js` into `src/shared/stable-json.js` + `src/shared/hash.js`.
- Subprocess lifecycle contracts:
  remove ad-hoc subprocess cleanup behavior in `src/index/build/tree-sitter-scheduler/runner.js`, `src/retrieval/cli/load-indexes.js`, `tools/service/indexer-service.js`, `tools/tui/supervisor.js`; standardize on `src/shared/subprocess.js`.
- Manifest-aware artifact loading:
  eliminate direct file probing in `src/index/validate.js`, `src/retrieval/cli/load-indexes.js`, `tools/build/embeddings/runner.js`, `tools/reports/show-throughput.js`; route through `src/shared/artifact-io/loaders/core.js`.

---

## Execution corrections folded in
- Baseline-first gating: no refactor starts until build/search/embeddings/sqlite baselines and invariants are captured.
- Vertical-slice execution: Stage1, artifact-write, and embeddings/sqlite are delivered first as end-to-end slices.
- Deferred schema breakup: `src/contracts/schemas/artifacts.js` moves to a later maintainability phase after hot-path wins.
- Hot-path hoist discipline: only duplicated code on hot paths is hoisted early; non-hot helper extractions are deferred.
- Single-pass-first optimization: repeated scan/serialize paths are eliminated before broad module splitting.
- Sequencing contracts become code: ordering assumptions are encoded and asserted, not only documented.
- Retrieval/LSP are wave two: they are optimized after indexing throughput is stabilized.
- Contract artifacts are immutable by default: `tests/ci-lite/ci-lite.order.txt` and `tests/fixtures/perf/index/caps-calibration-inputs.json` only change behind explicit contract updates.

---

## Phase plan (by concern, sequencing-safe, performance-first)

## Phase 0: Baseline, invariants, and perf gates (mandatory)
Goal: lock correctness and establish throughput baselines before refactor work.

Primary files:
- `src/index/build/indexer/steps/process-files.js`
- `src/index/build/artifacts-write.js`
- `tools/build/embeddings/runner.js`
- `src/storage/sqlite/build/runner.js`
- `src/index/build/build-state.js`
- `src/index/diffs/compute.js`

Actions:
- Capture baseline wall-clock, RSS, queue depth, retry, and artifact write throughput on representative repos.
- Add invariants for deterministic chunk IDs, artifact ordering, ledger hash, cache key stability, and stage sequencing.
- Freeze acceptance thresholds that each subsequent phase must meet or beat.

Performance wins:
- prevents non-measurable refactors
- avoids hidden regressions during modularization

Exit criteria:
- baseline dashboards and invariant checks are in place and reproducible

## Phase 1: Vertical Slice A - Stage1 hot path
Goal: improve indexing throughput where the most CPU and memory are spent.

Primary files:
- `src/index/build/file-processor.js`
- `src/index/build/file-processor/cpu.js`
- `src/index/build/file-processor/process-chunks/index.js`
- `src/index/build/tokenization.js`
- `src/index/build/state.js`
- `src/index/chunking/dispatch.js`
- `src/lang/sql.js`
- `src/lang/tree-sitter/chunking.js`
- `src/index/build/import-resolution/language-resolvers.js`

Actions:
- Convert to single-pass chunk/token/meta flow where possible.
- Eliminate duplicate line-count and tree-sitter limit implementations via shared helper.
- Extract only hot-path policies first (heavy-file, fallback, token retention, parse guards).
- Defer non-hot helper cleanup.

Performance wins:
- fewer per-file/per-chunk allocations
- fewer repeated scans and heuristic recomputations

Exit criteria:
- stage1 throughput improves vs baseline
- chunk identity and ordering remain deterministic

## Phase 2: Vertical Slice B - Artifact write + validation hot path
Goal: remove repeated serialization and reduce artifact IO overhead.

Primary files:
- `src/index/build/artifacts-write.js`
- `src/index/build/artifacts/writers/chunk-meta/writer.js`
- `src/shared/artifact-io/json.js`
- `src/shared/artifact-io/loaders/core.js`
- `src/index/validate.js`

Actions:
- Make chunk-meta scan/measure single-pass with fan-out to JSONL/columnar/binary writers.
- Separate artifact planning from emitting, but keep sequencing strict.
- Batch optional validation reads with bounded concurrency.
- Keep schema file untouched in this phase.

Performance wins:
- major reduction in repeated scan/serialize work
- lower validation IO latency

Exit criteria:
- artifact write determinism preserved
- validation parity preserved

## Phase 3: Vertical Slice C - Embeddings + SQLite hot path
Goal: maximize stage3/stage4 throughput with safe sequencing.

Primary files:
- `tools/build/embeddings/runner.js`
- `tools/build/embeddings/cache.js`
- `src/storage/sqlite/build/incremental-update.js`
- `src/storage/sqlite/build/runner.js`
- `src/shared/artifact-io/json.js`
- `src/shared/artifact-io/loaders/core.js`

Actions:
- Split embeddings runner by responsibility only where it removes repeated mapping/serialization work.
- Promote cache shard/flush manager and reduce lock churn.
- Refactor sqlite incremental planner/allocator/diff logic for reuse and lower re-read overhead.
- Preserve strict order: compute -> write vectors -> update manifest -> sqlite finalize.

Performance wins:
- less bundle re-read/re-write churn
- fewer cache lock/contention stalls
- better sqlite batch efficiency

Exit criteria:
- dense vector parity and dims invariants hold
- sqlite integrity and WAL/pragma cleanup remain correct

## Phase 4: Runtime, scheduler, pool, and sequencing contracts
Goal: encode ordering assumptions into code and modularize scheduling safely.

Primary files:
- `src/index/build/runtime/runtime.js`
- `src/index/build/indexer/pipeline.js`
- `src/index/build/incremental.js`
- `src/index/build/build-state.js`
- `src/index/build/tree-sitter-scheduler/plan.js`
- `src/index/build/tree-sitter-scheduler/runner.js`
- `src/index/build/workers/pool.js`
- `src/index/build/indexer/steps/process-files.js`
- `src/shared/concurrency.js`
- `src/shared/subprocess.js`
- `src/integrations/core/build-index/stages.js`

Actions:
- Extract watchdog/stall/timeout policy into shared scheduler policy modules.
- Split planner/runner/pool into explicit units with contract checks around sequence points.
- Make stage checkpoint, lock release, and cleanup order explicit and assertable.

Performance wins:
- lower scheduler overhead
- fewer retry loops and less queue policy recomputation

Exit criteria:
- no deadlocks or cleanup leaks
- stage ordering contracts enforced by code-level checks

## Phase 5: Relations, graph, SCM, inference, and diff core
Goal: isolate algorithmic cores and reduce repeated sorting/normalization.

Primary files:
- `src/index/build/indexer/steps/relations.js`
- `src/graph/neighborhood.js`
- `src/index/scm/providers/git.js`
- `src/index/type-inference-crossfile/pipeline.js`
- `src/index/language-registry/registry-data.js`
- `src/index/diffs/compute.js`

Actions:
- Extract budgets, traversal/cache, timeout planner, and diff event bounds into focused modules.
- Keep orchestration thin and reusable.

Performance wins:
- reduced repeated token/path normalization
- bounded diff/event memory use

Exit criteria:
- relation and diff outputs remain deterministic and equivalent

## Phase 6: Retrieval and LSP wave-two optimization
Goal: optimize retrieval after indexing throughput stabilizes.

Primary files:
- `src/retrieval/cli/load-indexes.js`
- `src/retrieval/cli/run-search-session.js`
- `src/retrieval/cli/run-search.js`
- `src/retrieval/output/format.js`
- `src/integrations/tooling/providers/lsp.js`

Actions:
- Table-drive per-mode retrieval/session loops.
- Remove local concurrency wrappers and use shared adapters.
- Defer deeper formatting cleanups unless they move measurable latency.

Performance wins:
- reduced redundant backend loads and expansion passes

Exit criteria:
- CLI behavior and cache semantics preserved

## Phase 7: Tooling/service/reporting modularization
Goal: reduce duplicated bench/report logic and stabilize service orchestration.

Primary files:
- `tools/bench/language-repos.js`
- `tools/bench/language/metrics.js`
- `tools/reports/show-throughput.js`
- `tools/service/indexer-service.js`
- `tools/tui/supervisor.js`
- `tools/usr/generate-usr-matrix-baselines.mjs`

Actions:
- Consolidate bench + report ledger math.
- Split service and supervisor into execution core, heartbeat/watchdog, and protocol/render layers.
- Move USR matrix datasets into static data modules; keep generator as transform/validate.

Performance wins:
- lower repeated JSON parsing and timer churn
- cleaner, faster queue worker loops

Exit criteria:
- CLI output contracts preserved
- queue lifecycle remains deterministic

## Phase 8: Deferred schema and contract modularization
Goal: improve long-term maintainability after hot-path throughput wins are secured.

Primary files:
- `src/contracts/schemas/artifacts.js`
- `src/index/validate.js`
- `src/shared/artifact-io/loaders/core.js`

Actions:
- Split schema catalog by artifact concern.
- Keep compatibility/version contracts strict and migration-safe.

Performance wins:
- modest startup/parse improvements
- mainly maintainability and safer future evolution

Exit criteria:
- no schema drift
- strict compatibility checks remain intact

## Phase 9: Contract artifact governance
Goal: keep data contracts explicit and minimize accidental churn.

Primary files:
- `tests/ci-lite/ci-lite.order.txt`
- `tests/fixtures/perf/index/caps-calibration-inputs.json`

Actions:
- treat both files as immutable contracts by default
- add validators only; do not refactor data layout unless contract evolution is intentional

Exit criteria:
- deterministic ordering and fixture schema remain stable

## Phase 10: Global micro-optimization final pass
Goal: perform targeted low-risk optimizations on the modularized codebase.

Cross-cutting targets:
- object allocation cuts in hottest loops
- sort minimization and pre-sorted reuse
- bounded parallel IO with shared scheduler adapters
- single-pass reuse for chunk/meta/token/relation data

Expected outcomes:
- measurable wall-clock reduction in stage1/stage2/stage3/stage4
- lower peak RSS on large repos

---

## Sequencing guardrails (must hold during all phases)
- Never break stage checkpoint and lock-release order.
- Keep deterministic ordering for chunk IDs, artifact write order, and diff events.
- Preserve cache key/version semantics unless migration is implemented in same phase.
- Preserve cleanup semantics for subprocesses, worker pools, and temporary artifact files.

---

## File-by-file breakup blueprint (exact targets)

- `src/contracts/schemas/artifacts.js`:
  Phase 8; split into `src/contracts/schemas/artifacts/{primitives,chunk-meta,postings,graph,retrieval,storage,build-state,diffs}.js` plus `index.js`; shared reuse `src/shared/validation/ajv-factory.js`.
- `src/index/build/artifacts-write.js`:
  Phase 2; split into `src/index/build/artifacts/{plan,dispatch,lane-policy,telemetry,cleanup,entrypoint}.js`; shared reuse `src/shared/perf/{histogram,percentiles}.js`.
- `src/index/build/artifacts/writers/chunk-meta/writer.js`:
  Phase 2; split into `src/index/build/artifacts/writers/chunk-meta/{scan,trim,emit-jsonl,emit-columnar,emit-binary,index}.js`; shared reuse `src/shared/chunk-meta-cold.js`.
- `src/graph/neighborhood.js`:
  Phase 5; split into `src/graph/neighborhood/{filters,traversal,path-builder,cache,entrypoint}.js`; shared reuse `src/shared/truncation.js`.
- `src/index/build/build-state.js`:
  Phase 4; split into `src/index/build/build-state/{merge,persist,sidecar,events,heartbeat,entrypoint}.js`; shared reuse `src/shared/scheduler/debounce.js`.
- `src/index/build/file-processor.js`:
  Phase 1; split into `src/index/build/file-processor/{preflight,cache-hydration,extraction,cpu-handoff,entrypoint}.js`; shared reuse `src/shared/file-stats.js`.
- `src/index/build/file-processor/cpu.js`:
  Phase 1; split into `src/index/build/file-processor/cpu/{schedule,scm,segments,relations,chunking,entrypoint}.js`; shared reuse `src/shared/indexing/tree-sitter-limits.js`.
- `src/index/build/file-processor/process-chunks/index.js`:
  Phase 1; split into `src/index/build/file-processor/process-chunks/{heavy-policy,tokenize,enrichment,emit,entrypoint}.js`; shared reuse `src/index/build/tokenization.js`.
- `src/index/build/import-resolution/language-resolvers.js`:
  Phase 1; split into `src/index/build/import-resolution/resolvers/{python,ruby,clike,dart,pathlike,shared,index}.js`; shared reuse `src/shared/path-normalize.js`.
- `src/index/build/incremental.js`:
  Phase 4; split into `src/index/build/incremental/{manifest,bundle-read,bundle-write,vfs-prefetch,autotune,entrypoint}.js`; shared reuse `src/shared/bundle-io.js`.
- `src/index/build/indexer/pipeline.js`:
  Phase 4; split into `src/index/build/indexer/pipeline/{feature-flags,stage-plan,stage-exec,health,entrypoint}.js`; shared reuse `src/index/build/stage-checkpoints.js`.
- `src/index/build/indexer/steps/process-files.js`:
  Phase 1 and 4; split into `src/index/build/indexer/steps/process-files/{watchdog,stall-policy,shard-runner,postings-queue,progress,entrypoint}.js`; shared reuse `src/shared/concurrency.js`.
- `src/index/build/indexer/steps/relations.js`:
  Phase 5; split into `src/index/build/indexer/steps/relations/{import-scan,budget-plan,budget-apply,roi,entrypoint}.js`; shared reuse `src/index/build/import-resolution.js`.
- `src/index/build/runtime/runtime.js`:
  Phase 4; split into `src/index/build/runtime/{config-load,queue-plan,dictionary-load,telemetry,entrypoint}.js`; shared reuse `src/shared/dict-utils.js`.
- `src/index/build/state.js`:
  Phase 1; split into `src/index/build/state/{guards,postings,retention,collisions,merge,entrypoint}.js`; shared reuse `src/shared/token-id.js`.
- `src/index/build/tokenization.js`:
  Phase 1; split into `src/index/build/tokenization/{dicts,classification,sequence,chargrams,entrypoint}.js`; shared reuse `src/shared/tokenize.js`.
- `src/index/build/tree-sitter-scheduler/plan.js`:
  Phase 4; split into `src/index/build/tree-sitter-scheduler/plan/{discover,cost-model,bucketing,waves,diagnostics,entrypoint}.js`; shared reuse `src/shared/indexing/chunk-cost.js`.
- `src/index/build/tree-sitter-scheduler/runner.js`:
  Phase 4; split into `src/index/build/tree-sitter-scheduler/runner/{exec,crash-tracker,index-load,adaptive-profile,entrypoint}.js`; shared reuse `src/shared/subprocess.js`.
- `src/index/build/workers/pool.js`:
  Phase 4; split into `src/index/build/workers/pool/{pressure,throttle,numa,lifecycle,entrypoint}.js`; shared reuse `src/shared/bounded-object-pool.js`.
- `src/index/chunking/dispatch.js`:
  Phase 1; split into `src/index/chunking/dispatch/{registry,regex-chunkers,tree-sitter-fallback,entrypoint}.js`; shared reuse `src/lang/tree-sitter/chunking.js`.
- `src/index/diffs/compute.js`:
  Phase 5; split into `src/index/diffs/{load,normalize,chunk-diff,event-bounds,persist,entrypoint}.js`; shared reuse `src/shared/stable-json.js`.
- `src/index/language-registry/registry-data.js`:
  Phase 5; split into `src/index/language-registry/adapters/{managed,heuristic,config-files,index}.js`; shared reuse existing `src/lang/*` adapters.
- `src/index/scm/providers/git.js`:
  Phase 5; split into `src/index/scm/providers/git/{command,timeout-plan,batch-cache,prefetch,entrypoint}.js`; shared reuse `src/shared/scm/batch-timeout-plan.js`.
- `src/index/type-inference-crossfile/pipeline.js`:
  Phase 5; split into `src/index/type-inference-crossfile/{symbol-index,budget,propagation,cache,entrypoint}.js`; shared reuse `src/shared/hash.js`.
- `src/index/validate.js`:
  Phase 2 and 8; split into `src/index/validate/{mode-checks,artifact-checks,ledger-checks,sqlite-checks,entrypoint}.js`; shared reuse `src/shared/artifact-io/loaders/core.js`.
- `src/integrations/core/build-index/stages.js`:
  Phase 4; split into `src/integrations/core/build-index/stages/{stage-runner,phase-lock,promotion,entrypoint}.js`; shared reuse `src/index/build/build-state.js`.
- `src/integrations/tooling/providers/lsp.js`:
  Phase 6; split into `src/integrations/tooling/providers/lsp/{vfs,hover-cache,diagnostics,symbol-pass,entrypoint}.js`; shared reuse `src/shared/concurrency.js`.
- `src/lang/sql.js`:
  Phase 1; split into `src/lang/sql/{splitter,classifier,imports,relations,flow,entrypoint}.js`; shared reuse `src/shared/lines.js`.
- `src/lang/tree-sitter/chunking.js`:
  Phase 1 and 4; split into `src/lang/tree-sitter/chunking/{cache,budget,query-pass,traversal-pass,entrypoint}.js`; shared reuse `src/shared/cache-key.js`.
- `src/retrieval/cli/load-indexes.js`:
  Phase 6; split into `src/retrieval/cli/load-indexes/{metadata,ann-backends,scm-authors,relations,entrypoint}.js`; shared reuse `src/shared/artifact-io.js`.
- `src/retrieval/cli/run-search-session.js`:
  Phase 6; split into `src/retrieval/cli/run-search-session/{cache,mode-run,context-expansion,telemetry,entrypoint}.js`; shared reuse `src/shared/stable-json.js`.
- `src/retrieval/cli/run-search.js`:
  Phase 6; split into `src/retrieval/cli/run-search/{options,backend-select,preflight,execute,entrypoint}.js`; shared reuse existing `src/retrieval/cli/*` helpers.
- `src/retrieval/output/format.js`:
  Phase 6; split into `src/retrieval/output/format/{bundle,full,short,sections,ansi,entrypoint}.js`; shared reuse `src/shared/cli/ansi-utils.js`.
- `src/shared/artifact-io/json.js`:
  Phase 2 and 3; split into `src/shared/artifact-io/json/{read-json,read-jsonl-stream,read-jsonl-buffer,row-queue,entrypoint}.js`; shared reuse `src/shared/artifact-io/compression.js`.
- `src/shared/artifact-io/loaders/core.js`:
  Phase 2 and 3; split into `src/shared/artifact-io/loaders/core/{manifest-plan,jsonl-load,binary-columnar-load,checksum,entrypoint}.js`; shared reuse `src/shared/artifact-io/manifest.js`.
- `src/shared/concurrency.js`:
  Phase 4 and 6; split into `src/shared/concurrency/{queue-core,run-with-queue,adaptive-scheduler,queue-adapter,entrypoint}.js`; shared reuse `src/shared/number-coerce.js`.
- `src/shared/subprocess.js`:
  Phase 4 and 7; split into `src/shared/subprocess/{spawn,tracking,signals,snapshot,errors,entrypoint}.js`; shared reuse `src/shared/kill-tree.js`.
- `src/storage/sqlite/build/incremental-update.js`:
  Phase 3; split into `src/storage/sqlite/build/incremental-update/{guard,docid,diff,write-batches,entrypoint}.js`; shared reuse `src/storage/sqlite/build/manifest.js`.
- `src/storage/sqlite/build/runner.js`:
  Phase 3; split into `src/storage/sqlite/build/runner/{mode-plan,autotune,incremental-path,artifact-path,entrypoint}.js`; shared reuse `src/storage/sqlite/build/runner/options.js`.
- `tools/bench/language-repos.js`:
  Phase 7; split into `tools/bench/language-repos/{target-plan,repo-lifecycle,run-loop,logging,entrypoint}.js`; shared reuse `tools/bench/language/process.js`.
- `tools/bench/language/metrics.js`:
  Phase 7; split into `tools/bench/language/metrics/{ledger,stage-timing,line-stats,regression,entrypoint}.js`; shared reuse `src/shared/time-format.js`.
- `tools/build/embeddings/cache.js`:
  Phase 3; split into `tools/build/embeddings/cache/{index,shards,locking,prune,entrypoint}.js`; shared reuse `src/shared/embeddings-cache/index.js`.
- `tools/build/embeddings/runner.js`:
  Phase 3; split into `tools/build/embeddings/runner/{map-index,compute,backend-write,bundle-refresh,state,entrypoint}.js`; shared reuse existing `tools/build/embeddings/*` modules.
- `tools/reports/show-throughput.js`:
  Phase 7; split into `tools/reports/show-throughput/{load,aggregate,analysis,render,entrypoint}.js`; shared reuse `tools/bench/language/metrics/*`.
- `tools/service/indexer-service.js`:
  Phase 7; split into `tools/service/indexer-service/{queue-worker,executor,progress-monitor,retry-policy,entrypoint}.js`; shared reuse `tools/service/queue.js`.
- `tools/tui/supervisor.js`:
  Phase 7; split into `tools/tui/supervisor/{protocol,flow-control,watchdog,artifact-collector,entrypoint}.js`; shared reuse `src/shared/subprocess.js`.
- `tools/usr/generate-usr-matrix-baselines.mjs`:
  Phase 7; split into `tools/usr/generate-usr-matrix-baselines/{datasets,builders,io,entrypoint}.mjs`; shared reuse `src/shared/eol.js`.
- `tests/ci-lite/ci-lite.order.txt`:
  Phase 9; keep data-only; add validator in test harness, no structural rewrite.
- `tests/fixtures/perf/index/caps-calibration-inputs.json`:
  Phase 9; keep data-only; enforce schema check, no structural rewrite.

---

## Prioritized high-impact wins (implement first inside phases)

1. Baseline and invariant gate completion (Phase 0) before any structural split.
2. Stage1 vertical slice: single-pass file/chunk/token flow and hot helper consolidation (Phase 1).
3. Artifact vertical slice: single-pass chunk-meta planning + bounded parallel validation reads (Phase 2).
4. Embeddings/sqlite vertical slice: mapping/cache/manifest/write path de-dup and lock-contention reduction (Phase 3).
5. Scheduler/runtime sequencing contracts made explicit and assertable in code (Phase 4).
6. Relations/SCM/diff algorithm core extraction with bounded memory event processing (Phase 5).
7. Retrieval/LSP wave-two cleanups after indexing throughput stabilizes (Phase 6).

---

## Implementation quality bar
- Each phase lands with lockstep updates to docs/contracts/tests for touched surfaces.
- No compatibility shim layers left behind after each cutover.
- Determinism and schema compatibility are verified at each phase boundary.
- Every extraction has explicit ownership of IO, policy, and telemetry boundaries.

## Task-Class Decomposition Addendum (8x detail)
This addendum translates phase tasks into concrete module classes/components with ownership boundaries, reusable contracts, and sequencing constraints discovered from the latest deep sweep.

### Phase 1 (Stage1 hot path) class map
- `src/index/build/indexer/steps/process-files.js`:
  classes/components: `Stage1WatchdogPolicy`, `Stage1StallPolicy`, `Stage1ShardSubsetPlanner`, `Stage1RetryCoordinator`, `Stage1PostingsBackpressurePolicy`, `Stage1CleanupController`, `Stage1ProgressEmitter`.
  split modules:
  - `src/index/build/indexer/steps/process-files/watchdog.js`
  - `src/index/build/indexer/steps/process-files/stall-policy.js`
  - `src/index/build/indexer/steps/process-files/shard-subsets.js`
  - `src/index/build/indexer/steps/process-files/retry.js`
  - `src/index/build/indexer/steps/process-files/postings-backpressure.js`
  - `src/index/build/indexer/steps/process-files/cleanup.js`
  contracts/invariants: deterministic subset merge order, stable ownership IDs, timeout and cleanup semantics preserved.
- `src/index/build/file-processor.js`:
  classes/components: `FileReadPolicy`, `FileExtractionPolicy`, `FileIncrementalReusePolicy`, `FileCpuHandoff`.
  split modules:
  - `src/index/build/file-processor/io.js`
  - `src/index/build/file-processor/extraction.js`
  - `src/index/build/file-processor/caching.js`
  - `src/index/build/file-processor/handoff.js`
  contracts/invariants: unchanged skip reasons and incremental reuse behavior; abort path remains strict.
- `src/index/build/file-processor/cpu.js`:
  classes/components: `CpuFileTaskPlanner`, `TreeSitterLimitGate`, `CpuChunkAssembler`, `CpuRelationsEmitter`.
  split modules:
  - `src/index/build/file-processor/cpu/schedule.js`
  - `src/index/build/file-processor/cpu/tree-sitter-gate.js`
  - `src/index/build/file-processor/cpu/chunk-assembly.js`
  - `src/index/build/file-processor/cpu/relations.js`
  contracts/invariants: same parse skip/fallback behavior and chunk payload shape.
- `src/index/build/file-processor/process-chunks/index.js`:
  classes/components: `HeavyFilePolicy`, `BoilerplateDetector`, `ChunkTokenizationOrchestrator`, `ChunkEnrichmentAssembler`.
  split modules:
  - `src/index/build/file-processor/process-chunks/heavy-policy.js`
  - `src/index/build/file-processor/process-chunks/boilerplate.js`
  - `src/index/build/file-processor/process-chunks/token-flow.js`
  - `src/index/build/file-processor/process-chunks/enrichment.js`
  contracts/invariants: heavy-file coalescing remains deterministic, no chunk id drift.
- `src/index/build/tokenization.js`:
  classes/components: `TokenDictionaryResolver`, `TokenClassifier`, `TokenSequenceBuilder`, `TokenBufferManager`.
  split modules:
  - `src/index/build/tokenization/dictionaries.js`
  - `src/index/build/tokenization/classification.js`
  - `src/index/build/tokenization/sequence.js`
  - `src/index/build/tokenization/buffers.js`
  contracts/invariants: token and chargram determinism, unchanged synonym behavior.
- `src/index/build/state.js`:
  classes/components: `PostingsStateStore`, `TokenRetentionPolicy`, `CollisionTracker`, `StateMergeStrategy`, `StateGuardrails`.
  split modules:
  - `src/index/build/state/postings-store.js`
  - `src/index/build/state/token-retention.js`
  - `src/index/build/state/collisions.js`
  - `src/index/build/state/merge.js`
  - `src/index/build/state/guards.js`
  contracts/invariants: token/doc counters and retention semantics remain deterministic.
- `src/index/chunking/dispatch.js`:
  classes/components: `ChunkerRegistry`, `RegexChunkingProfile`, `TreeSitterFallbackChunker`, `ChunkLimitGuard`.
  split modules:
  - `src/index/chunking/dispatch/registry.js`
  - `src/index/chunking/dispatch/regex.js`
  - `src/index/chunking/dispatch/tree-sitter-fallback.js`
  - `src/index/chunking/dispatch/limits.js`
  contracts/invariants: chunk order and limit enforcement stay stable.
- `src/lang/sql.js`:
  classes/components: `SqlStatementSplitter`, `SqlImportCollector`, `SqlRelationBuilder`, `SqlFlowAnalyzer`.
  split modules:
  - `src/lang/sql/chunking.js`
  - `src/lang/sql/imports.js`
  - `src/lang/sql/relations.js`
  - `src/lang/sql/flow.js`
  contracts/invariants: comment-aware split semantics preserved.
- `src/lang/tree-sitter/chunking.js`:
  classes/components: `TreeSitterChunkCache`, `TreeSitterBudgetPlanner`, `TreeSitterQueryPass`, `TreeSitterTraversalPass`.
  split modules:
  - `src/lang/tree-sitter/chunking/cache.js`
  - `src/lang/tree-sitter/chunking/budget.js`
  - `src/lang/tree-sitter/chunking/query-pass.js`
  - `src/lang/tree-sitter/chunking/traversal-pass.js`
  contracts/invariants: cache invalidation and strict-mode fallbacks unchanged.
- `src/index/build/import-resolution/language-resolvers.js`:
  classes/components: `ImporterClassifier`, `RelativeImportResolver`, `NonRelativeImportResolver`, `ResolverCandidateExpander`.
  split modules:
  - `src/index/build/import-resolution/resolvers/classification.js`
  - `src/index/build/import-resolution/resolvers/relative.js`
  - `src/index/build/import-resolution/resolvers/non-relative.js`
  - `src/index/build/import-resolution/resolvers/common-paths.js`
  contracts/invariants: resolver precedence and candidate ordering unchanged.

### Phase 2 (artifact write + validate) class map
- `src/index/build/artifacts-write.js`:
  classes/components: `ArtifactWritePlanBuilder`, `ArtifactLaneConcurrencyPolicy`, `ArtifactWorkClassPolicy`, `ArtifactFsStrategyPolicy`, `AdaptiveWriteConcurrencyController`, `TailWorkerSelector`, `MicroBatchSelector`, `ArtifactWriteDispatcher`, `ArtifactWriteTelemetry`.
  split modules:
  - `src/index/build/artifacts/write-plan.js`
  - `src/index/build/artifacts/lane-policy.js`
  - `src/index/build/artifacts/work-class-policy.js`
  - `src/index/build/artifacts/fs-strategy.js`
  - `src/index/build/artifacts/adaptive-controller.js`
  - `src/index/build/artifacts/tail-worker.js`
  - `src/index/build/artifacts/micro-batch.js`
  - `src/index/build/artifacts/dispatch.js`
  - `src/index/build/artifacts/telemetry.js`
  contracts/invariants: write ordering, piece manifest stability, queue-delay metrics compatibility.
- `src/index/build/artifacts/writers/chunk-meta/writer.js`:
  classes/components: `ChunkMetaScanPlan`, `ChunkMetaHotColdPlanner`, `ChunkMetaJsonlEmitter`, `ChunkMetaColumnarEmitter`, `ChunkMetaBinaryEmitter`, `ChunkMetaCleanupCoordinator`.
  split modules:
  - `src/index/build/artifacts/writers/chunk-meta/planning.js`
  - `src/index/build/artifacts/writers/chunk-meta/hot-cold.js`
  - `src/index/build/artifacts/writers/chunk-meta/jsonl.js`
  - `src/index/build/artifacts/writers/chunk-meta/columnar.js`
  - `src/index/build/artifacts/writers/chunk-meta/binary.js`
  - `src/index/build/artifacts/writers/chunk-meta/cleanup.js`
  contracts/invariants: ordering hash/count parity and hot/cold row parity must hold.
- `src/shared/artifact-io/json.js`:
  classes/components: `JsonReader`, `JsonlStreamReader`, `JsonlRowQueue`, `JsonReadTelemetry`.
  split modules:
  - `src/shared/artifact-io/json/readers.js`
  - `src/shared/artifact-io/json/streams.js`
  - `src/shared/artifact-io/json/queues.js`
  - `src/shared/artifact-io/json/bulk.js`
  contracts/invariants: `maxBytes`, backup fallback, and required-key validation unchanged.
- `src/shared/artifact-io/loaders/core.js`:
  classes/components: `ArtifactManifestResolver`, `BinaryColumnarLoader`, `ArtifactArrayLoader`, `ArtifactRowStreamLoader`.
  split modules:
  - `src/shared/artifact-io/loaders/manifest-resolver.js`
  - `src/shared/artifact-io/loaders/binary-columnar.js`
  - `src/shared/artifact-io/loaders/array.js`
  - `src/shared/artifact-io/loaders/stream.js`
  contracts/invariants: strict vs non-strict manifest fallback behavior preserved.
- `src/index/validate.js`:
  classes/components: `ManifestValidationPass`, `ChunkMetaValidationPass`, `PostingsValidationPass`, `EmbeddingsValidationPass`, `OrderingLedgerValidationPass`.
  split modules:
  - `src/index/validate/manifest.js`
  - `src/index/validate/chunk-meta.js`
  - `src/index/validate/postings.js`
  - `src/index/validate/embeddings.js`
  - `src/index/validate/ordering-ledger.js`
  contracts/invariants: issue/warning semantics and ordering of emitted validation failures preserved.

### Phase 3 (embeddings + sqlite) class map
- `tools/build/embeddings/runner.js`:
  classes/components: `IncrementalChunkMappingIndex`, `EmbeddingsModePlanner`, `EmbeddingsComputeEngine`, `EmbeddingsBackendWriter`, `EmbeddingsCacheCoordinator`, `EmbeddingsStatePersister`, `EmbeddingsValidationGate`.
  split modules:
  - `tools/build/embeddings/runner/mapping-index.js`
  - `tools/build/embeddings/runner/mode-plan.js`
  - `tools/build/embeddings/runner/compute.js`
  - `tools/build/embeddings/runner/backends.js`
  - `tools/build/embeddings/runner/cache.js`
  - `tools/build/embeddings/runner/state.js`
  - `tools/build/embeddings/runner/validate.js`
  contracts/invariants: deterministic mapping resolution and backend artifact parity.
- `tools/build/embeddings/cache.js`:
  classes/components: `EmbeddingsCachePathResolver`, `EmbeddingsCacheIndexStore`, `EmbeddingsCacheShardStore`, `EmbeddingsCacheMaintenance`.
  split modules:
  - `tools/build/embeddings/cache/paths.js`
  - `tools/build/embeddings/cache/index-store.js`
  - `tools/build/embeddings/cache/shard-store.js`
  - `tools/build/embeddings/cache/maintenance.js`
  contracts/invariants: lock and prune semantics preserved.
- `src/index/build/incremental.js`:
  classes/components: `IncrementalManifestStore`, `IncrementalBundleReader`, `IncrementalBundleWriter`, `IncrementalVfsPrefetch`, `IncrementalAutotunePolicy`.
  split modules:
  - `src/index/build/incremental/manifest.js`
  - `src/index/build/incremental/bundle-read.js`
  - `src/index/build/incremental/bundle-write.js`
  - `src/index/build/incremental/vfs-prefetch.js`
  - `src/index/build/incremental/autotune.js`
  contracts/invariants: reuse checks and bundle update ordering unchanged.
- `src/storage/sqlite/build/incremental-update.js`:
  classes/components: `IncrementalManifestGuard`, `IncrementalDocIdAllocator`, `IncrementalChunkInserter`, `IncrementalVectorWriter`.
  split modules:
  - `src/storage/sqlite/build/incremental-update/manifest-guard.js`
  - `src/storage/sqlite/build/incremental-update/docid.js`
  - `src/storage/sqlite/build/incremental-update/chunk-insert.js`
  - `src/storage/sqlite/build/incremental-update/vector.js`
  contracts/invariants: vocab growth guards and dense vector count parity unchanged.
- `src/storage/sqlite/build/runner.js`:
  classes/components: `SqliteRunnerConfig`, `SqliteModePlan`, `SqliteIncrementalPath`, `SqliteArtifactPath`, `SqliteStateReporter`.
  split modules:
  - `src/storage/sqlite/build/runner/config.js`
  - `src/storage/sqlite/build/runner/mode-plan.js`
  - `src/storage/sqlite/build/runner/incremental.js`
  - `src/storage/sqlite/build/runner/build.js`
  - `src/storage/sqlite/build/runner/state.js`
  contracts/invariants: mode selection logic and state updates preserved.

### Phase 4 (runtime + scheduler + workers) class map
- `src/index/build/runtime/runtime.js`:
  classes/components: `RuntimeConfigLoader`, `PlatformPresetResolver`, `StartupCalibrationProbe`, `DaemonCacheBridge`, `RuntimeQueueFactory`, `RuntimeCapabilityResolver`.
  split modules:
  - `src/index/build/runtime/config-load.js`
  - `src/index/build/runtime/platform-preset.js`
  - `src/index/build/runtime/startup-calibration.js`
  - `src/index/build/runtime/daemon-bridge.js`
  - `src/index/build/runtime/queues.js`
  - `src/index/build/runtime/capabilities.js`
  contracts/invariants: build runtime object shape and option defaults remain compatible.
- `src/shared/concurrency.js`:
  classes/components: `TaskQueueFactory`, `QueueWorkRunner`, `BuildSchedulerCore`, `AdaptiveSurfaceController`, `SchedulerTelemetry`, `SchedulerQueueAdapter`.
  split modules:
  - `src/shared/concurrency/task-queues.js`
  - `src/shared/concurrency/run-with-queue.js`
  - `src/shared/concurrency/scheduler-core.js`
  - `src/shared/concurrency/adaptive-surfaces.js`
  - `src/shared/concurrency/scheduler-telemetry.js`
  - `src/shared/concurrency/queue-adapter.js`
  contracts/invariants: queue starvation and rejection semantics preserved.
- `src/index/build/tree-sitter-scheduler/plan.js`:
  classes/components: `TreeSitterJobDiscovery`, `TreeSitterCostEstimator`, `TreeSitterBucketPlanner`, `TreeSitterWavePlanner`, `TreeSitterLaneDiagnostics`.
  split modules:
  - `src/index/build/tree-sitter-scheduler/plan/discovery.js`
  - `src/index/build/tree-sitter-scheduler/plan/cost-model.js`
  - `src/index/build/tree-sitter-scheduler/plan/bucket-planner.js`
  - `src/index/build/tree-sitter-scheduler/plan/wave-planner.js`
  - `src/index/build/tree-sitter-scheduler/plan/diagnostics.js`
  contracts/invariants: identical grammar grouping and execution order for same inputs.
- `src/index/build/tree-sitter-scheduler/runner.js`:
  classes/components: `SchedulerTaskBuilder`, `SchedulerExecRunner`, `SchedulerCrashTracker`, `SchedulerAdaptiveProfileMerger`, `SchedulerLookupLoader`.
  split modules:
  - `src/index/build/tree-sitter-scheduler/runner/tasks.js`
  - `src/index/build/tree-sitter-scheduler/runner/exec.js`
  - `src/index/build/tree-sitter-scheduler/runner/crash-tracker.js`
  - `src/index/build/tree-sitter-scheduler/runner/adaptive-profile.js`
  - `src/index/build/tree-sitter-scheduler/runner/index-loader.js`
  contracts/invariants: crash degradation behavior and lookup results preserved.
- `src/index/build/workers/pool.js`:
  classes/components: `WorkerPressureStateMachine`, `WorkerLanguageThrottle`, `WorkerPoolLifecycle`, `WorkerPoolRestartPolicy`, `WorkerPoolMetricsEmitter`.
  split modules:
  - `src/index/build/workers/pool/pressure.js`
  - `src/index/build/workers/pool/language-throttle.js`
  - `src/index/build/workers/pool/lifecycle.js`
  - `src/index/build/workers/pool/restart-policy.js`
  - `src/index/build/workers/pool/metrics.js`
  contracts/invariants: restart, disable, and fallback behavior unchanged.
- `src/shared/subprocess.js`:
  classes/components: `SubprocessOptionsNormalizer`, `SubprocessTracker`, `SubprocessSignalBridge`, `SubprocessRunner`, `SubprocessSnapshot`.
  split modules:
  - `src/shared/subprocess/options.js`
  - `src/shared/subprocess/tracking.js`
  - `src/shared/subprocess/signals.js`
  - `src/shared/subprocess/runner.js`
  - `src/shared/subprocess/snapshot.js`
  contracts/invariants: timeout/abort and tracked cleanup behavior preserved.
- `src/index/build/build-state.js`:
  classes/components: `BuildStateStore`, `BuildStatePatchQueue`, `CheckpointSliceStore`, `OrderingLedgerStore`, `BuildHeartbeat`.
  split modules:
  - `src/index/build/build-state/store.js`
  - `src/index/build/build-state/patch-queue.js`
  - `src/index/build/build-state/checkpoints.js`
  - `src/index/build/build-state/order-ledger.js`
  - `src/index/build/build-state/heartbeat.js`
  contracts/invariants: write coalescing semantics and ordering ledger schema stability.
- `src/index/build/indexer/pipeline.js`:
  classes/components: `FeatureSettingsResolver`, `TinyRepoFastPathPolicy`, `ModePipelineOrchestrator`, `PipelineCheckpointEmitter`.
  split modules:
  - `src/index/build/indexer/pipeline/features.js`
  - `src/index/build/indexer/pipeline/tiny-repo-policy.js`
  - `src/index/build/indexer/pipeline/orchestrator.js`
  - `src/index/build/indexer/pipeline/checkpoints.js`
  contracts/invariants: stage checkpoint shape and overlap behavior preserved.
- `src/integrations/core/build-index/stages.js`:
  classes/components: `BuildStageRunner`, `EmbeddingsStageRunner`, `SqliteStageRunner`, `PromotionGate`.
  split modules:
  - `src/integrations/core/build-index/stages/stage-runner.js`
  - `src/integrations/core/build-index/stages/embeddings-stage.js`
  - `src/integrations/core/build-index/stages/sqlite-stage.js`
  - `src/integrations/core/build-index/stages/promotion.js`
  contracts/invariants: lock and phase transition ordering preserved.

### Phase 5 (relations + graph + scm + diff + inference) class map
- `src/graph/neighborhood.js`:
  classes/components: `NeighborhoodCapPolicy`, `NeighborhoodCsrIndex`, `NeighborhoodWalker`, `NeighborhoodCache`.
  split modules:
  - `src/graph/neighborhood/caps.js`
  - `src/graph/neighborhood/csr.js`
  - `src/graph/neighborhood/walker.js`
  - `src/graph/neighborhood/cache.js`
  contracts/invariants: node/edge count consistency and truncation accounting.
- `src/index/build/indexer/steps/relations.js`:
  classes/components: `ImportScanPlanner`, `CrossFileBudgetPlanner`, `CrossFileInferenceRunner`, `RelationRiskSummary`.
  split modules:
  - `src/index/build/indexer/steps/relations/import-scan.js`
  - `src/index/build/indexer/steps/relations/cross-file-budget.js`
  - `src/index/build/indexer/steps/relations/cross-file-runner.js`
  - `src/index/build/indexer/steps/relations/risk-summary.js`
  contracts/invariants: retained/dropped budget stats stable and deterministic.
- `src/index/type-inference-crossfile/pipeline.js`:
  classes/components: `CrossFileCacheCoordinator`, `CrossFileBundleSizer`, `CrossFilePropagationEngine`.
  split modules:
  - `src/index/type-inference-crossfile/cache.js`
  - `src/index/type-inference-crossfile/bundler.js`
  - `src/index/type-inference-crossfile/propagation.js`
  contracts/invariants: cached and uncached output parity.
- `src/index/diffs/compute.js`:
  classes/components: `DiffChunkMatcher`, `DiffEventBounder`, `DiffManifestStore`.
  split modules:
  - `src/index/diffs/chunk-diff.js`
  - `src/index/diffs/events.js`
  - `src/index/diffs/manifest.js`
  contracts/invariants: event ordering determinism and manifest compat checks.
- `src/index/scm/providers/git.js`:
  classes/components: `GitTimeoutPlan`, `GitMetaPrefetchCache`, `GitMetaBatchRunner`.
  split modules:
  - `src/index/scm/providers/git/config.js`
  - `src/index/scm/providers/git/prefetch.js`
  - `src/index/scm/providers/git/meta-batch.js`
  contracts/invariants: cooldown and freshness behavior unchanged.
- `src/index/language-registry/registry-data.js`:
  classes/components: `LanguageAdapterRegistry`, `ManagedAdapterFactory`, `HeuristicAdapterFactory`.
  split modules:
  - `src/index/language-registry/adapters/{language}.js`
  - `src/index/language-registry/adapters/managed.js`
  - `src/index/language-registry/adapters/heuristic.js`
  - `src/index/language-registry/adapters/index.js`
  contracts/invariants: adapter interface uniformity.

### Phase 6 (retrieval + LSP) class map
- `src/retrieval/cli/load-indexes.js`:
  classes/components: `IndexMetadataLoader`, `AnnBackendLoader`, `ChunkAuthorHydrator`, `FilterIndexHydrator`.
  split modules:
  - `src/retrieval/cli/load-indexes/metadata.js`
  - `src/retrieval/cli/load-indexes/ann-backends.js`
  - `src/retrieval/cli/load-indexes/chunk-authors.js`
  - `src/retrieval/cli/load-indexes/filter-index.js`
  contracts/invariants: mode coverage and hydration cache semantics.
- `src/retrieval/cli/run-search.js`:
  classes/components: `SearchCliOptionsParser`, `SearchBackendContextFactory`, `SearchPlanRunner`, `SearchTelemetryEmitter`.
  split modules:
  - `src/retrieval/cli/run-search/options.js`
  - `src/retrieval/cli/run-search/backend-context.js`
  - `src/retrieval/cli/run-search/plan-runner.js`
  - `src/retrieval/cli/run-search/telemetry.js`
  contracts/invariants: backend selection and query plan cache behavior.
- `src/retrieval/cli/run-search-session.js`:
  classes/components: `SearchSessionCachePolicy`, `SearchSessionEmbeddingCache`, `SearchSessionModeExpander`, `SearchSessionPersistence`.
  split modules:
  - `src/retrieval/cli/run-search-session/cache-policy.js`
  - `src/retrieval/cli/run-search-session/embedding-cache.js`
  - `src/retrieval/cli/run-search-session/mode-expansion.js`
  - `src/retrieval/cli/run-search-session/persist.js`
  contracts/invariants: cache hit semantics and context expansion stats.
- `src/retrieval/output/format.js`:
  classes/components: `ResultBundleBuilder`, `ResultDisplayMeta`, `FullFormatter`, `ShortFormatter`, `AnsiRenderPolicy`.
  split modules:
  - `src/retrieval/output/format/bundle.js`
  - `src/retrieval/output/format/display-meta.js`
  - `src/retrieval/output/format/full.js`
  - `src/retrieval/output/format/short.js`
  - `src/retrieval/output/format/ansi.js`
  contracts/invariants: output ordering and truncation behavior.
- `src/integrations/tooling/providers/lsp.js`:
  classes/components: `LspVfsBatcher`, `LspHoverCache`, `LspDiagnosticsCollector`, `LspSymbolCollector`.
  split modules:
  - `src/integrations/tooling/providers/lsp/vfs.js`
  - `src/integrations/tooling/providers/lsp/hover-cache.js`
  - `src/integrations/tooling/providers/lsp/diagnostics.js`
  - `src/integrations/tooling/providers/lsp/symbols.js`
  contracts/invariants: concurrency caps and diagnostics truncation semantics.

### Phase 7 (tooling and services) class map
- `tools/bench/language-repos.js`:
  classes/components: `BenchTargetPlanner`, `BenchRepoLifecycle`, `BenchRunLoop`, `BenchProgressLogger`.
  split modules:
  - `tools/bench/language-repos/targets.js`
  - `tools/bench/language-repos/repo-lifecycle.js`
  - `tools/bench/language-repos/run-loop.js`
  - `tools/bench/language-repos/logging.js`
  contracts/invariants: deterministic repo ordering and guardrail outputs.
- `tools/bench/language/metrics.js`:
  classes/components: `BenchMetricFormatter`, `BenchStageLedgerBuilder`, `BenchLineStatsBuilder`, `BenchRegressionAnalyzer`.
  split modules:
  - `tools/bench/language/metrics/format.js`
  - `tools/bench/language/metrics/stage-ledger.js`
  - `tools/bench/language/metrics/line-stats.js`
  - `tools/bench/language/metrics/regression.js`
  contracts/invariants: throughput and hit-rate math compatibility.
- `tools/reports/show-throughput.js`:
  classes/components: `ThroughputDataLoader`, `ThroughputAggregator`, `ThroughputRegressionAnalyzer`, `ThroughputRenderer`.
  split modules:
  - `tools/reports/show-throughput/load.js`
  - `tools/reports/show-throughput/aggregate.js`
  - `tools/reports/show-throughput/analysis.js`
  - `tools/reports/show-throughput/render.js`
  contracts/invariants: report totals and percentiles preserved.
- `tools/service/indexer-service.js`:
  classes/components: `IndexerServiceQueue`, `IndexerServiceExecutor`, `IndexerServiceProgressMonitor`, `IndexerServiceRetryPolicy`.
  split modules:
  - `tools/service/indexer-service/queue.js`
  - `tools/service/indexer-service/executor.js`
  - `tools/service/indexer-service/progress.js`
  - `tools/service/indexer-service/retry.js`
  contracts/invariants: queue semantics and phase transition reporting.
- `tools/tui/supervisor.js`:
  classes/components: `TuiSupervisorProtocol`, `TuiFlowController`, `TuiWatchdog`, `TuiArtifactCollector`.
  split modules:
  - `tools/tui/supervisor/protocol.js`
  - `tools/tui/supervisor/flow-control.js`
  - `tools/tui/supervisor/watchdog.js`
  - `tools/tui/supervisor/artifact-collector.js`
  contracts/invariants: message protocol and cancellation semantics.
- `tools/usr/generate-usr-matrix-baselines.mjs`:
  classes/components: `UsrDatasetRegistry`, `UsrMatrixBuilder`, `UsrBaselineWriter`.
  split modules:
  - `tools/usr/generate-usr-matrix-baselines/datasets.mjs`
  - `tools/usr/generate-usr-matrix-baselines/builders.mjs`
  - `tools/usr/generate-usr-matrix-baselines/io.mjs`
  contracts/invariants: deterministic matrix ordering and schema stability.

### Phase 8 and 9 (schema + data artifacts) class map
- `src/contracts/schemas/artifacts.js`:
  classes/components: `ArtifactSchemaPrimitives`, `ArtifactSchemaChunkMeta`, `ArtifactSchemaPostings`, `ArtifactSchemaGraph`, `ArtifactSchemaDiffs`, `ArtifactSchemaRetrieval`.
  split modules:
  - `src/contracts/schemas/artifacts/primitives.js`
  - `src/contracts/schemas/artifacts/chunk-meta.js`
  - `src/contracts/schemas/artifacts/postings.js`
  - `src/contracts/schemas/artifacts/graph.js`
  - `src/contracts/schemas/artifacts/diffs.js`
  - `src/contracts/schemas/artifacts/retrieval.js`
  - `src/contracts/schemas/artifacts/index.js`
  contracts/invariants: exported schema object keys remain stable.
- `tests/ci-lite/ci-lite.order.txt` and `tests/fixtures/perf/index/caps-calibration-inputs.json`:
  keep data-only.
  add `ContractDataValidator` in harness to enforce schema/ordering with no structural rewrite.

### Shared hoist ownership (new and mandatory)
- `src/shared/indexing/tree-sitter-limits.js`:
  owners: Stage1 + scheduler plan.
  exports: `countLinesBounded`, `resolveTreeSitterLimits`, `exceedsTreeSitterLimits`.
- `src/shared/perf/histogram.js` and `src/shared/perf/percentiles.js`:
  owners: artifact write, process-files, reports.
  exports: `createHistogram`, `summarizeHistogram`, `percentile`.
- `src/shared/perf/eta.js`:
  owners: embeddings and bench/reports.
  exports: `formatEtaSeconds`, `formatDurationShort`.
- `src/shared/scheduler/watchdog-policy.js` and `src/shared/scheduler/stall-policy.js`:
  owners: process-files and runtime.
  exports: watchdog/stall config normalization and action resolution.
- `src/index/cross-file/budgets.js`:
  owners: relations, type-inference, graph.
  exports: budget caps, planner, and deterministic trim helpers.
- `src/shared/io/manifest-read-plan.js`:
  owners: artifact loaders and validate/retrieval/reporting.
  exports: source selection and fallback plan for manifest-driven reads.

### Sequencing-critical cuts (must not be violated)
1. Extract pure policy/value modules first.
2. Extract IO emitters/readers second.
3. Move orchestration glue last.
4. Keep old exports as compatibility facades until the phase cutover commit.
5. Remove compatibility facades in the same phase once all callsites are migrated.

### Additional bugs/perf traps explicitly captured
- Avoid duplicate coercion helpers in `src/index/build/runtime/runtime.js` and `src/index/build/indexer/steps/process-files.js`; migrate to `src/shared/number-coerce.js` wrappers only.
- Ensure `src/index/build/tree-sitter-scheduler/runner.js` crash handling keeps timeout/native crash and injected crash paths distinct; do not collapse into a single error class.
- Preserve deterministic tail-worker selection ordering in `src/index/build/artifacts-write.js` (`estimatedBytes`, `priority`, lane rank, sequence, label).
- Keep cached and non-cached cross-file inference output parity checks after splitting `src/index/type-inference-crossfile/pipeline.js`.
- Preserve queue backpressure semantics and pending-byte accounting while splitting `src/shared/concurrency.js`.
- Preserve `load-indexes` chunk-author hydration cache behavior and bounded concurrency while modularizing retrieval loaders.

### Definition of done for each task-class split
- Module has one responsibility class, explicit input/output contract, and no hidden global mutation.
- Each moved function has at least one direct regression assertion for behavior-sensitive paths.
- Shared module extraction replaces all duplicate local implementations in scoped files in the same phase.
- Throughput baseline is non-regressed at phase gate.
