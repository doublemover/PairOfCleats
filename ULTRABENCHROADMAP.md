# ULTRABENCHROADMAP

Created: 2026-02-22T05:02:01-05:00
Source run: `benchmarks/results/logs/bench-language/run-20260222-042200-all.log`

## Mission
Drive bench-lang to a reliability-first, throughput-first architecture with strict failure containment, deterministic diagnostics, and measurable query-quality gains.

Primary targets:
- Zero hard crashes in parser/scanner paths.
- P95 index-build time reduction of at least 40% on large repos.
- Eliminate false-positive watchdog noise by separating queue wait from true processing time.
- Increase low-performing repo hit rates toward 100% without degrading relevance.
- Make bottlenecks obvious in live logs and persisted diagnostics.

## Baseline Snapshot (from run-20260222-042200)
- Completed repos: 20
- Passed: 17
- Failed: 3 (all Perl)
- In progress during analysis: `ruby/rspec/rspec`
- Average passed build index time: ~102.3s
- Average passed build sqlite time: ~10.47s
- Average passed query avg/search: ~361.8ms
- Average passed memory/sqlite hit rate: ~87.6% / ~88.2%
- Watchdog slow-file lines in passed repos: 527 (plus 125+ in in-progress rspec during snapshot)
- Notable failure signatures:
  - `3221225477` and `3221226356` during Perl indexing
- Notable warning signatures:
  - Git blame timeout fallback at 5000ms (zlib, rspec)
  - Frequent `records` sqlite fallback to artifacts
  - Large extracted-prose `noMapping` skip counts on some repos

## Phase 0: Reliability Blockers (Must-fix First)

### UB-001: Hard-fail parser crash containment for native Perl
- Status: [x]
- Problem:
  - Perl repos fail with native process exits, taking down entire bench for those repos.
- Tasks:
  - Add parser-provider guardrail for Perl: isolate parser activation/parse into a dedicated crash-fenced worker process.
  - On non-zero native exit, capture parser provider, language, file, file size, parser version, ABI, and callsite stage.
  - Auto-fallback path: WASM parser or grammar-disabled chunking only for affected files (not whole repo), with explicit quality-degradation marker.
  - Emit one structured crash event per unique signature to avoid log spam.
  - Persist crash forensic bundle before cache cleanup.
- Tests:
  - Add failure-injection test that simulates parser worker crash and verifies graceful per-file fallback.
  - Add bench integration test ensuring repo continues and summary marks degraded parser mode.
- Exit criteria:
  - Perl repos no longer fail hard due parser crash.
  - Crash evidence file exists and survives cleanup.
- Completion: 2026-02-22T06:07:17.9008380-05:00
- Validation:
  - `node tests/indexing/tree-sitter/tree-sitter-scheduler-crash-fallback.test.js`
  - `node tests/lang/perl/perl-scheduler-crash-recovery.test.js`
  - `node tests/indexing/tree-sitter/tree-sitter-scheduler-stage1-contract.test.js`
  - `node tests/indexing/tree-sitter/tree-sitter-scheduler-native-language-contract.test.js`
  - `node tests/indexing/tree-sitter/tree-sitter-scheduler-swift-subprocess.test.js`
  - `node tests/indexing/crash-log-announcement.test.js`
- Improvement Intent (What): parser crash resilience
- Improvement Method (How): crash-fenced parser workers, per-file fallback, signature-based quarantine.
- Integrated Betterments: add crash-signature bucketing (parser ABI + grammar commit + file fingerprint) to prevent duplicate triage; add per-file quarantine cache to skip re-crashing files within a run; add deterministic fallback-quality score so degraded runs are explicitly graded.
- Touchpoints: `src/index/build/tree-sitter-scheduler/subprocess-exec.js`, `src/index/build/tree-sitter-scheduler/runner.js`, `src/index/build/tree-sitter-scheduler/executor.js`, `src/index/chunking/tree-sitter.js`, `src/index/build/indexer/steps/process-files.js`, `src/index/build/crash-log.js`, `tests/indexing/tree-sitter/tree-sitter-scheduler-native-language-contract.test.js`, `tests/lang/perl/perl-package-chunks.test.js`

### UB-002: Per-file timeout cleanup scoping
- Status: [x]
- Problem:
  - Timeout cleanup can still risk over-broad process termination if not fully scoped to file-owned subprocesses.
- Tasks:
  - Enforce per-file subprocess ownership IDs in registry.
  - Terminate only children belonging to the timed-out file context.
  - Add kill-audit trail in debug log showing exact terminated PIDs + ownership IDs.
- Tests:
  - Multi-file concurrency test with one intentional timeout; verify unrelated parser workers survive.
- Exit criteria:
  - Timeout recovery is local; no cascading file failures.
- Completion: 2026-02-22T06:22:10.0851476-05:00
- Validation:
  - `node tests/indexing/stage1/process-files-cleanup-timeout.test.js`
  - `node tests/shared/subprocess/tracked-shutdown-cleanup.test.js`
  - `node tests/shared/subprocess/tracked-signal-scope-binding.test.js`
  - `node tests/shared/subprocess/timeout-kills-child.test.js`
- Improvement Intent (What): timeout isolation correctness
- Improvement Method (How): strict subprocess ownership and scoped TERM->KILL cleanup.
- Integrated Betterments: enforce child-process ownership tokens at spawn time (not inferred later); add TERM->KILL escalation with bounded grace and measured latency; add chaos test lane with mixed successful and timed-out files to prove no cross-owner termination.
- Touchpoints: `src/index/build/indexer/steps/process-files.js`, `src/shared/subprocess.js`, `src/index/build/runtime/runtime.js`, `tests/indexing/stage1/process-files-cleanup-timeout.test.js`, `tests/shared/subprocess/tracked-shutdown-cleanup.test.js`, `tests/shared/subprocess/tracked-signal-scope-binding.test.js`

### UB-003: Crash-log retention policy
- Status: [x]
- Problem:
  - Crash logs can disappear after cache cleanup, reducing postmortem quality.
- Tasks:
  - On repo failure, copy crash artifacts to run-level durable diagnostics dir under results/logs.
  - Include parser/env/runtime metadata and last N scheduler events.
- Tests:
  - Failure test verifies crash evidence exists after cleanup.
- Exit criteria:
  - Every hard failure has durable forensics in run logs.
- Completion: 2026-02-22T06:22:10.0851476-05:00
- Validation:
  - `node tests/indexing/crash-log-retention.test.js`
  - `node tests/perf/bench/bench-language-process-scheduler-events.test.js`
  - `node tests/perf/bench/bench-language-report-crash-retention.test.js`
  - `node tests/indexing/crash-log-announcement.test.js`
- Improvement Intent (What): failure forensics quality
- Improvement Method (How): durable crash bundles with scheduler and queue snapshots.
- Integrated Betterments: write crash bundles atomically with checksum to avoid partial logs; include last scheduler decisions and queue state snapshot for root cause context; add retention policy tiers (failed repo, failed run, flaky signature) with automatic pruning.
- Touchpoints: `src/index/build/crash-log.js`, `tools/bench/language/logging.js`, `tools/bench/language/process.js`, `tools/bench/language/report.js`, `tests/indexing/crash-log-announcement.test.js`

## Phase 1: Indexing Throughput (Largest Wall-clock Wins)

### UB-010: Stage timing profiler with machine-readable output
- Status: [x]
- Problem:
  - Build index dominates time but stage-level attribution is incomplete.
- Tasks:
  - Emit per-stage timers: discovery, import scan, SCM meta, parse/chunk, inference, artifact write, embedding, sqlite build.
  - Include per-language and per-file-size-bin breakdown.
  - Persist as JSON next to repo benchmark report.
- Tests:
  - Contract test for schema keys and non-negative durations.
- Exit criteria:
  - We can rank exact contributors instead of inferring from aggregate runtime.
- Completion: 2026-02-22T06:48:10-05:00
- Validation:
  - `node tests/tooling/reports/bench-language-stage-timing-report.test.js`
  - `node tests/tooling/reports/metrics-dashboard.test.js`
  - `node tests/tooling/reports/bench-language-metrics-extracted-prose-lines.test.js`
  - `node tests/tooling/reports/show-throughput-language-normalization.test.js`
  - `node tests/tooling/reports/show-throughput-ignore-usr.test.js`
- Improvement Intent (What): bottleneck attribution accuracy
- Improvement Method (How): stage-level timing schema with variance and critical-path outputs.
- Integrated Betterments: include monotonic-clock stamps to avoid wall-clock skew artifacts; add per-stage variance and p95/p99 breakdown instead of averages only; emit stage critical-path graph so optimization target ordering is data-driven.
- Touchpoints: `src/index/build/indexer/steps/process-files.js`, `src/index/build/indexer/steps/relations.js`, `src/index/build/runtime/runtime.js`, `tools/bench/language/metrics.js`, `tools/bench/language/report.js`, `tests/tooling/reports/summary/summary-report.test.js`, `tests/tooling/reports/metrics-dashboard.test.js`

### UB-011: Queue-wait vs active-work watchdog semantics
- Status: [x]
- Problem:
  - Most watchdog slow-file events are near 10s and likely include queue waiting.
- Tasks:
  - Track per-file lifecycle timestamps: enqueued, dequeued, parse start/end, write start/end.
  - Watchdog should trigger on active processing duration, not queue wait.
  - Add separate queue-delay telemetry line and histogram.
- Tests:
  - Synthetic contention test ensures queue delay does not trigger slow-file warning.
- Exit criteria:
  - Slow-file warnings represent real slow processing, not scheduler delay.
- Completion: 2026-02-22T06:48:10-05:00
- Validation:
  - `node tests/indexing/stage1/file-watchdog-hard-timeout.test.js`
  - `node tests/indexing/stage1/process-files-progress-heartbeat.test.js`
- Improvement Intent (What): watchdog signal quality
- Improvement Method (How): split queue-wait vs active-work timing and threshold tuning.
- Integrated Betterments: split watchdog into queue-delay, parse-time, and write-time channels with separate thresholds; auto-tune thresholds by repo size percentile and language mix; add false-positive budget SLO and fail diagnostics when exceeded.
- Touchpoints: `src/index/build/indexer/steps/process-files.js`, `src/index/build/runtime/runtime.js`, `tests/indexing/stage1/process-files-progress-heartbeat.test.js`, `tests/indexing/stage1/file-watchdog-hard-timeout.test.js`, `tests/perf/scheduler-starvation-detection.test.js`

### UB-012: Adaptive concurrency controller by stage and pressure
- Status: [x]
- Problem:
  - Static concurrency is suboptimal across mixed repo shapes.
- Tasks:
  - Introduce feedback loop using CPU utilization, runnable queue depth, GC pressure, file backlog, and I/O latency.
  - Separate controllers for parse, inference, artifact write, sqlite, and embeddings.
  - Add floor/ceiling by machine profile.
- Tests:
  - Load test with small/mid/large repos verifies no throughput regression and no starvation.
- Exit criteria:
  - P95 build time drops; no increase in failure rate.
- Completion: 2026-02-22T07:13:25.5229095-05:00
- Validation:
  - `node tests/shared/concurrency/scheduler-adaptive-surfaces.test.js`
  - `node tests/shared/concurrency/scheduler-contract.test.js`
  - `node tests/shared/concurrency/scheduler-write-backpressure.test.js`
  - `node tests/shared/concurrency/scheduler-adapter-bytes-gating.test.js`
  - `node tests/perf/scheduler-core.test.js`
  - `node tests/perf/scheduler-fairness.test.js`
  - `node tests/perf/scheduler-starvation-detection.test.js`
  - `node tests/perf/indexing/runtime/scheduler-telemetry.test.js`
  - `node tests/indexing/runtime/scheduler-autotune-profile.test.js`
  - `node tests/indexing/artifacts/artifact-write-adaptive-concurrency-controller.test.js`
- Improvement Intent (What): end-to-end throughput stability
- Improvement Method (How): adaptive concurrency with hysteresis and replayable decisions.
- Integrated Betterments: gate adaptive decisions behind hysteresis to prevent concurrency oscillation; use control-loop cooldown windows to avoid overreacting to transient spikes; log every adaptive decision with input features for offline replay.
- Touchpoints: `src/shared/concurrency.js`, `src/index/build/runtime/scheduler.js`, `src/index/build/runtime/runtime.js`, `tests/shared/concurrency/scheduler-adaptive-surfaces.test.js`, `tests/indexing/runtime/scheduler-autotune-profile.test.js`, `tests/indexing/artifacts/artifact-write-adaptive-concurrency-controller.test.js`

### UB-013: Ruby-heavy scheduler lane rebalance
- Status: [x]
- Problem:
  - Large Ruby repos can still run with low lane parallelism while file counts are high.
- Tasks:
  - Improve lane planner cost model to split high-cardinality language waves into multiple balanced pools.
  - Rebalance by estimated parse cost (line count + token density) rather than file count only.
  - Enable dynamic lane splitting when tail latency exceeds threshold.
- Tests:
  - Scheduler test for ruby-heavy fixtures validates lane count > 1 and lower p95 file latency.
- Exit criteria:
  - Reduced tail latency and lower watchdog events on ruby-heavy repos.
- Completion: 2026-02-22T06:44:50-05:00
- Validation:
  - `node tests/indexing/tree-sitter/tree-sitter-scheduler-adaptive-planner.test.js`
  - `node tests/indexing/tree-sitter/tree-sitter-scheduler-adaptive-profile.test.js`
  - `node tests/indexing/tree-sitter/tree-sitter-scheduler-warm-pool-tasks.test.js`
  - `node tests/perf/scheduler-fairness.test.js`
- Improvement Intent (What): scheduler tail-latency reduction
- Improvement Method (How): weighted lane splitting, lane stealing, and fairness checks.
- Integrated Betterments: rebalance using estimated AST node count not just file bytes/lines; add periodic lane stealing for long-running lanes; validate fairness with starvation regression tests on synthetic skewed corpora.
- Touchpoints: `src/index/build/tree-sitter-scheduler/plan.js`, `src/index/build/tree-sitter-scheduler/policy.js`, `src/index/build/tree-sitter-scheduler/adaptive-profile.js`, `tests/indexing/tree-sitter/tree-sitter-scheduler-adaptive-planner.test.js`, `tests/perf/scheduler-fairness.test.js`, `tests/perf/scheduler-core.test.js`

### UB-014: Cross-file inference budget tuning by evidence
- Status: [x]
- Problem:
  - Inference can overrun on huge code graphs without clear ROI tracking.
- Tasks:
  - Add inference ROI metrics: link additions, retained links after filtering, query contribution.
  - Auto-tune call/usage budgets by repo scale and language.
  - Add early-stop heuristics when marginal gain flattens.
- Tests:
  - Quality/perf A/B tests on large repos.
- Exit criteria:
  - Lower build time with no relevance drop.
- Completion: 2026-02-22T07:20:31.7330513-05:00
- Validation:
  - `node tests/indexing/risk/interprocedural/artifacts-written.test.js`
  - `node tests/indexing/risk/interprocedural/summary-only-status.test.js`
- Improvement Intent (What): inference cost efficiency
- Improvement Method (How): ROI-based edge retention and confidence-weighted pruning.
- Integrated Betterments: track downstream retrieval lift per inference edge class before keeping expensive links; add confidence-weighted pruning for weak relation edges; add hard cap by memory budget to prevent inference blowups.
- Touchpoints: `src/index/build/indexer/steps/relations.js`, `src/index/build/file-processor/relations.js`, `src/index/language-registry/simple-relations.js`, `tests/indexing/risk/interprocedural/artifacts-written.test.js`, `tests/indexing/risk/interprocedural/summary-only-status.test.js`

## Phase 2: Artifact + SQLite Pipeline Optimization

### UB-020: Artifact tail-stall elimination
- Status: [x]
- Problem:
  - Some repos show tail rescue and long artifact stall windows (notably fastlane).
- Tasks:
  - Implement small-file coalescing and write batching.
  - Pre-size streams for large JSONL writes.
  - Add dedicated tail worker mode for final N artifacts.
  - Add file-system strategy toggles for NTFS-specific behavior.
- Tests:
  - Artifact writer benchmark with many small artifacts and mixed sizes.
- Exit criteria:
  - Max stall for artifact writes reduced substantially (target <4s).
- Completion: 2026-02-22T07:48:45.6634023-05:00
- Validation:
  - `node tests/indexing/artifacts/artifact-write-adaptive-concurrency-controller.test.js`
  - `node tests/indexing/artifacts/artifact-write-ultra-light-lane-concurrency.test.js`
  - `node tests/perf/artifact-io/streaming-vs-full.test.js`
- Improvement Intent (What): artifact write tail latency
- Improvement Method (How): write coalescing, tail-first scheduling, and latency class telemetry.
- Integrated Betterments: add write coalescing for micro-artifacts under a byte threshold; pre-sort tail artifacts by predicted write cost to reduce long-tail stalls; capture filesystem-level write latency histogram to tune queue classes.
- Touchpoints: `src/index/build/artifacts-write.js`, `src/index/build/artifacts/writer.js`, `src/shared/artifact-io.js`, `src/shared/artifact-io/jsonl.js`, `src/shared/artifact-io/binary-columnar.js`, `src/shared/json-stream.js`, `src/shared/json-stream/streams.js`, `src/shared/json-stream/jsonl-batch.js`, `tests/indexing/artifacts/artifact-write-adaptive-concurrency-controller.test.js`, `tests/indexing/artifacts/artifact-write-ultra-light-lane-concurrency.test.js`, `tests/perf/artifact-io/streaming-vs-full.test.js`

### UB-021: Persistent binary artifact preference
- Status: [x]
- Problem:
  - JSON serialization overhead remains significant for large metadata sets.
- Tasks:
  - Expand binary-columnar coverage for frequently reloaded artifacts.
  - Keep JSON only for diagnostics and contracts, not primary runtime path.
  - Add compatibility tests for deterministic binary output.
- Tests:
  - Determinism + parity tests binary vs JSON fallback reads.
- Exit criteria:
  - Lower write/read wall time and reduced memory spikes.
- Completion: 2026-02-22T07:24:49.5329514-05:00
- Validation:
  - `node tests/shared/artifact-io/prefer-binary-columnar-loaders.test.js`
  - `node tests/indexing/contracts/loader-matrix-parity.test.js`
  - `node tests/indexing/artifacts/packed-artifact-fastpath.test.js`
  - `node tests/indexing/chunk-meta/chunk-meta-hot-cold-split.test.js`
- Improvement Intent (What): artifact I/O speed
- Improvement Method (How): binary-first storage/load path with strict schema evolution.
- Integrated Betterments: adopt binary-first read path with JSON as strict debug fallback only; add schema evolution metadata with explicit hard cutovers; add cross-platform binary compatibility checks (endianness/version guards).
- Touchpoints: `src/shared/artifact-io/loaders/binary-columnar.js`, `src/shared/artifact-io/loaders/chunk-meta.js`, `src/shared/artifact-io/loaders/token-postings.js`, `src/shared/artifact-io/manifest.js`, `src/shared/chunk-meta-cold.js`, `tests/shared/artifact-io/prefer-binary-columnar-loaders.test.js`, `tests/indexing/artifacts/packed-artifact-fastpath.test.js`

### UB-022: Records incremental-bundle parity
- Status: [x]
- Problem:
  - `records` path repeatedly falls back to artifacts.
- Tasks:
  - Implement records incremental bundle producer/consumer.
  - Add capability bit in bundle manifest.
  - Keep fallback only for truly unsupported repos.
- Tests:
  - Records incremental integration test on fixture with non-empty records.
- Exit criteria:
  - Records path uses incremental bundles where available.
- Completion: 2026-02-22T07:40:52.8074912-05:00
- Validation:
  - `node tests/storage/sqlite/sqlite-incremental-no-change.test.js`
  - `node tests/storage/sqlite/sqlite-skip-empty-records-rebuild.test.js`
- Improvement Intent (What): records-path incremental speed
- Improvement Method (How): records bundle parity and manifest capability support.
- Integrated Betterments: create records bundle schema parity checklist so code/prose/records stay aligned; add compatibility validator for records incremental manifests; add targeted benchmark proving records incremental ROI on non-empty repos.
- Touchpoints: `src/integrations/triage/index-records.js`, `src/index/build/indexer/steps/incremental.js`, `src/storage/sqlite/build/runner.js`, `src/storage/sqlite/build/index.js`, `src/storage/sqlite/build/imports.js`, `tools/bench/sqlite/build-from-bundles.js`, `tests/storage/sqlite/sqlite-incremental-no-change.test.js`, `tests/storage/sqlite/sqlite-skip-empty-records-rebuild.test.js`

### UB-023: SQLite ingest parallelism and transaction shape tuning
- Status: [ ]
- Problem:
  - SQLite build still contributes meaningful runtime share.
- Tasks:
  - Tune chunk ingest batch size by page size and WAL state.
  - Use staged temp tables with optimized index creation order.
  - Add repo-size adaptive transaction boundaries.
- Tests:
  - SQLite microbench suite on representative corpus sizes.
- Exit criteria:
  - Lower sqlite build ms without corruption or query regressions.
- Improvement Intent (What): sqlite ingest throughput
- Improvement Method (How): adaptive batch/transaction shapes and optimized index build ordering.
- Integrated Betterments: introduce adaptive transaction chunk sizes based on WAL growth and fsync latency; defer secondary index creation until after bulk load for large batches; add rollback-safe partial-rebuild checkpointing for long sqlite jobs.
- Touchpoints: `src/storage/sqlite/build/runner.js`, `src/storage/sqlite/build/index.js`, `src/storage/sqlite/utils.js`, `tools/bench/sqlite/incremental-update.js`, `tests/storage/sqlite/sqlite-incremental-transaction-boundary.test.js`, `tests/storage/sqlite/sqlite-jsonl-streaming-zstd.test.js`

## Phase 3: SCM Metadata Cost and Robustness

### UB-030: Opt-in blame policy hardening
- Status: [x]
- Problem:
  - Blame calls can timeout and add variance; value may be low by default.
- Tasks:
  - Make blame explicitly opt-in for bench profiles unless needed for specific features.
  - Cache blame at commit+path granularity.
  - Add progressive timeout ladder and batch cancellation strategy.
- Tests:
  - SCM policy tests verifying defaults and caps.
- Exit criteria:
  - Near-zero blame timeout warnings in default bench runs.
- Completion: 2026-02-22T06:49:58.6031483-05:00
- Validation:
  - `node tests/indexing/scm/scm-config-bench-annotate-default.test.js`
  - `node tests/indexing/git/git-blame-commit-cache-scope.test.js`
  - `node tests/indexing/git/git-blame-timeout-ladder-backoff.test.js`
  - `node tests/indexing/git/git-meta-timeout-backoff.test.js`
  - `node tests/indexing/git/git-meta-warning-details.test.js`
  - `node tests/indexing/git/git-meta-blame-failure-scope.test.js`
  - `node tests/indexing/git/git-meta-skip-blame-no-history.test.js`
  - `node tests/indexing/scm/git-provider-meta-batch-parallel.test.js`
  - `node tests/indexing/scm/index-build-git-provider.test.js`
  - `node tests/indexing/file-processor/scm-annotate-fast-timeout.test.js`
- Improvement Intent (What): SCM overhead reduction
- Improvement Method (How): opt-in blame policy with explicit value-vs-cost controls.
- Integrated Betterments: include per-repo SCM metadata policy summary at run start for transparency; add denylist/allowlist controls per language or repo tier; add an explicit "metadata value vs cost" score to justify blame usage.
- Touchpoints: `src/index/scm/providers/git.js`, `src/index/scm/file-meta-snapshot.js`, `src/index/scm/runner.js`, `src/index/build/runtime/runtime.js`, `tests/indexing/git/git-meta-timeout-backoff.test.js`, `tests/indexing/git/git-meta-warning-details.test.js`

### UB-031: Repository-level git metadata prefetch
- Status: [x]
- Problem:
  - Per-file metadata gathering can be expensive when repeated.
- Tasks:
  - Prefetch commit metadata in bounded batches once per repo.
  - Use indexed map for file lookup during indexing.
  - Add freshness guard keyed by repo HEAD.
- Tests:
  - Throughput test compares per-file vs prefetch model.
- Exit criteria:
  - Lower SCM overhead and reduced subprocess churn.
- Completion: 2026-02-22T07:08:37.7066082-05:00
- Validation:
  - `node tests/indexing/scm/file-meta-snapshot-reuse.test.js`
  - `node tests/indexing/scm/git-provider-meta-batch-parallel.test.js`
  - `node tests/indexing/file-processor/scm-file-meta-snapshot-fastpath.test.js`
  - `node tests/indexing/scm/build-state-repo-provenance.test.js`
  - `node tests/indexing/scm/index-build-git-provider.test.js`
- Improvement Intent (What): git metadata collection speed
- Improvement Method (How): batched prefetch, locality-aware execution, and reusable caches.
- Integrated Betterments: batch git calls by directory locality to improve cache hits in git internals; keep a short-lived process pool for git subprocess reuse; add corruption-safe cache invalidation keyed by HEAD and index config signature.
- Touchpoints: `src/index/scm/providers/git.js`, `src/index/scm/cache.js`, `src/index/scm/file-meta-snapshot.js`, `src/index/scm/runtime.js`, `tests/indexing/scm/git-provider-meta-batch-parallel.test.js`, `tests/indexing/scm/file-meta-snapshot-reuse.test.js`

### UB-032: Multi-SCM abstraction (Git + JJ readiness)
- Status: [ ]
- Problem:
  - Current tuning is Git-centric.
- Tasks:
  - Define SCM provider contract for metadata capabilities.
  - Implement Git parity adapter and JJ experimental adapter.
  - Feature-gate SCM-specific fields in output contracts.
- Tests:
  - Provider contract test lane with fake SCM fixtures.
- Exit criteria:
  - SCM layer handles provider differences cleanly.
- Improvement Intent (What): SCM extensibility/robustness
- Improvement Method (How): capability contracts and provider conformance testing.
- Integrated Betterments: define strict SCM capability matrix (author, time, branch, churn) and fail closed for unsupported fields; enforce provider conformance tests with golden fixtures; add JJ parity dashboard to track feature gaps over time.
- Touchpoints: `src/index/scm/provider.js`, `src/index/scm/registry.js`, `src/index/scm/providers/git.js`, `src/index/scm/providers/jj.js`, `src/index/scm/providers/jj-parse.js`, `tests/indexing/scm/provider-shape.test.js`, `tests/indexing/scm/jj-head-parse.test.js`

## Phase 4: Query Performance + Quality (Hit-rate program)

### UB-040: Low-hit repo triage and targeted retrieval tuning
- Status: [ ]
- Problem:
  - Some repos have materially low hit rates (`z`, `inspect.lua`, `luasocket`, `pandoc`, `fastlane`).
- Tasks:
  - Build per-query miss taxonomy: lexical miss, rank miss, filter miss, chunk granularity miss.
  - Tune tokenization, stemming/splitting, and field weighting by language profile.
  - Add query rewrite heuristics for short symbol-like queries.
- Tests:
  - Repo-specific query regression suites with expected hit thresholds.
- Exit criteria:
  - Hit rates for low performers rise toward 100% without relevance regressions.
- Improvement Intent (What): retrieval hit-rate lift
- Improvement Method (How): miss taxonomy + language-aware token/rank tuning.
- Integrated Betterments: build per-query failure labels (tokenization, ranking, filtering, missing chunk) and persist them; add language-specific stemming/splitting pipelines with override hooks; add targeted re-ranking experiments for symbol-heavy queries.
- Touchpoints: `src/retrieval/query-parse.js`, `src/retrieval/query-intent.js`, `src/retrieval/rankers.js`, `src/retrieval/routing-policy.js`, `src/retrieval/pipeline/rank-stage.js`, `tests/retrieval/query/golden-query-corpus.test.js`, `tests/retrieval/query/query-intent.test.js`

### UB-041: ANN candidate strategy optimization
- Status: [ ]
- Problem:
  - ANN path may not be ideal for small or sparse indexes.
- Tasks:
  - Dynamic ANN bypass when index size/query class predicts lower benefit.
  - Tune efSearch / candidate count by modality and repo scale.
  - Add per-query backend routing using learned heuristics.
- Tests:
  - Search latency and hit-rate A/B tests memory vs sqlite vs ann mixed mode.
- Exit criteria:
  - Lower avg/search latency with stable or better hit rate.
- Improvement Intent (What): ANN latency-quality balance
- Improvement Method (How): per-query ANN routing and adaptive candidate budgets.
- Integrated Betterments: implement per-query ANN on/off oracle using cheap prefeatures; tune candidate budget dynamically from first-pass confidence and entropy; add safety fallback to sparse-only when ANN confidence is low.
- Touchpoints: `src/retrieval/pipeline/ann-stage.js`, `src/retrieval/scoring/ann-candidate-policy.js`, `src/retrieval/ann/providers/hnsw.js`, `src/retrieval/ann/providers/lancedb.js`, `src/retrieval/ann/providers/sqlite-vec.js`, `tests/retrieval/ann-candidate-policy.test.js`, `tests/retrieval/ann/hnsw-ann.test.js`

### UB-042: Extracted-prose mapping coverage uplift
- Status: [ ]
- Problem:
  - High `skipped noMapping` in extracted-prose on several repos reduces usable embedding population.
- Tasks:
  - Improve source-span mapping heuristics for extracted chunks.
  - Add fallback mapping via nearest-anchor + structural hints.
  - Log mapping failure categories (boundary mismatch, missing parent, parser omission).
- Tests:
  - Mapping-quality fixtures with known extracted-prose anchors.
- Exit criteria:
  - Significant reduction in noMapping skips on high-skip repos.
- Improvement Intent (What): extracted-prose embedding coverage
- Improvement Method (How): improved span mapping with reason-coded fallbacks.
- Integrated Betterments: store mapping failure reason codes for every skipped extracted chunk; add nearest-anchor fallback with confidence threshold; add mapping replay tool to validate improvements without full reindex.
- Touchpoints: `src/index/chunking/formats/document-common.js`, `src/index/chunk-id.js`, `src/index/identity/chunk-uid.js`, `tools/build/embeddings/runner.js`, `tests/indexing/extracted-prose/extraction-report.test.js`, `tests/indexing/chunking/document-anchor-stability.test.js`

### UB-043: Import resolution quality improvements
- Status: [ ]
- Problem:
  - Unresolved imports present in pandoc and rspec logs.
- Tasks:
  - Extend language-specific import resolvers for relative/test fixture patterns.
  - Add optional resolver plugins for repo-local conventions.
  - Track unresolved-to-resolved delta after resolver changes.
- Tests:
  - Import resolver fixture tests per language.
- Exit criteria:
  - Reduced unresolved imports on known problem repos.
- Improvement Intent (What): import graph completeness
- Improvement Method (How): resolver plugins, alias handling, and unresolved class reduction.
- Integrated Betterments: add unresolved import class taxonomy in output (fixture, optional, missing dep, parse error); add repo-local path alias support in resolver plugins; add import resolution precision/recall score in reports.
- Touchpoints: `src/index/build/import-resolution-cache.js`, `src/index/build/indexer/steps/relations.js`, `src/index/build/imports.js`, `tests/indexing/imports/import-resolution.test.js`, `tests/indexing/imports/import-graph-unresolved-refresh.test.js`, `tests/indexing/imports/import-resolution-language-coverage.test.js`

## Phase 5: Logging, Diagnostics, and Operator UX

### UB-050: Structured diagnostics stream
- Status: [ ]
- Problem:
  - Important runtime issues are mixed with verbose output and duplicated in all/repo logs.
- Tasks:
  - Emit compact interactive stream + full JSON event stream to file.
  - Include event types: parser_crash, scm_timeout, queue_delay_hotspot, artifact_tail_stall, fallback_used.
  - Add stable event IDs for deduping.
- Tests:
  - Snapshot tests for interactive output and JSON schema tests.
- Exit criteria:
  - Operators can quickly identify exact root causes without scanning huge logs.
- Improvement Intent (What): diagnostic clarity
- Improvement Method (How): structured event stream + dedupe/rate limiting + compact summaries.
- Integrated Betterments: standardize diagnostic event schema with versioned contracts; add event dedupe keys and per-category rate limits; include lightweight human-readable summaries that reference durable JSON event files.
- Touchpoints: `tools/bench/language/logging.js`, `tools/bench/language/process.js`, `tools/bench/language/report.js`, `src/index/build/crash-log.js`, `src/index/build/indexer/steps/process-files.js`, `tests/perf/bench/bench-language-progress-parse.test.js`, `tests/tooling/reports/summary/summary-report.test.js`

### UB-051: Hang detection and forced-progress policy
- Status: [ ]
- Problem:
  - Historical hangs had poor diagnosability and delayed recovery.
- Tasks:
  - Define stage-specific heartbeat intervals and stuck thresholds.
  - Auto-dump stack/queue/process snapshot when heartbeat misses threshold.
  - Optionally kick stage (soft reset) before hard fail.
- Tests:
  - Simulated deadlock/hang fixtures validating diagnostics and recovery actions.
- Exit criteria:
  - No silent stalls; every stall produces actionable diagnostics.
- Improvement Intent (What): hang recovery reliability
- Improvement Method (How): staged recovery policy and mandatory stuck-state snapshots.
- Integrated Betterments: add staged recovery policy (warn, soft kick, selective restart, hard fail); record thread/queue/process snapshots before any forced termination; add "stuck on file" definitive marker with last active operation.
- Touchpoints: `src/index/build/indexer/steps/process-files.js`, `src/shared/subprocess.js`, `tools/tui/supervisor.js`, `tests/indexing/stage1/process-files-progress-heartbeat.test.js`, `tests/runner/harness/watchdog-kills-tree.test.js`, `tests/shared/subprocess/abort-kills-child.test.js`

### UB-052: Run report synthesis tool
- Status: [ ]
- Problem:
  - Manual log triage is too expensive.
- Tasks:
  - Build `bench-lang summarize` command that outputs:
    - pass/fail matrix
    - top bottlenecks
    - warning/fallback counts
    - regression diffs vs previous run
  - Export markdown + JSON.
- Tests:
  - CLI snapshot tests on fixture run-logs.
- Exit criteria:
  - One command yields comprehensive triage.
- Improvement Intent (What): triage velocity
- Improvement Method (How): one-command run synthesis with prioritized regressions.
- Integrated Betterments: support baseline-vs-current diff mode with significance thresholds; include auto-prioritized remediation candidates in summary output; add machine-readable output for CI gating and trend dashboards.
- Touchpoints: `tools/bench/language/report.js`, `tools/bench/language/metrics.js`, `tools/bench/language/process.js`, `tools/reports/show-throughput.js`, `tests/tooling/reports/summary/summary-report.test.js`, `tests/tooling/reports/show-throughput-ignore-usr.test.js`

## Phase 6: Large, Sweeping Improvements (High Leverage)

### UB-060: Persistent daemonized indexing service mode
- Status: [ ]
- Opportunity:
  - Cold-start and repeated setup costs remain material across repos.
- Tasks:
  - Introduce long-lived indexing daemon with warm parser pools, warm embeddings runtime, and warmed dictionaries.
  - Add per-repo isolated job contexts to preserve determinism.
- Tests:
  - Determinism tests daemon vs one-shot mode.
- Exit criteria:
  - Reduced per-repo startup overhead and improved throughput on batch runs.
- Improvement Intent (What): repeated-run startup overhead
- Improvement Method (How): daemonized warm runtime with deterministic isolation mode.
- Integrated Betterments: isolate daemon worker state per job namespace to avoid cross-run contamination; add deterministic mode that reproduces one-shot ordering exactly; add daemon health probes and auto-recycle on leak signatures.
- Touchpoints: `src/index/build/runtime/runtime.js`, `src/index/build/indexer/indexer.js`, `src/index/build/tree-sitter-scheduler/runner.js`, `src/shared/embedding-adapter.js`, `src/shared/cache-roots.js`, `tools/bench/language/process.js`

### UB-061: Distributed stage execution (optional cluster mode)
- Status: [ ]
- Opportunity:
  - Massive repos can exceed single-host optimal throughput.
- Tasks:
  - Partition by file shards across workers; centralize artifact merge.
  - Maintain deterministic merge ordering.
- Tests:
  - Multi-worker deterministic output tests.
- Exit criteria:
  - Substantial wall-clock reduction on very large repos.
- Improvement Intent (What): large-repo wall-clock
- Improvement Method (How): distributed shard execution with deterministic merge.
- Integrated Betterments: enforce deterministic shard merge order with stable IDs; add network/backpressure-aware scheduling for distributed workers; add partial failure recovery that retries shard subsets only.
- Touchpoints: `src/index/build/indexer/indexer.js`, `src/index/build/indexer/steps/process-files.js`, `src/index/build/artifacts-write.js`, `src/shared/subprocess.js`, `tools/bench/bench-runner.js`

### UB-062: Learned auto-profile selection
- Status: [ ]
- Opportunity:
  - Static profile selection misses repo-specific optimal settings.
- Tasks:
  - Train lightweight model using repo features to select concurrency, laneing, and retrieval parameters.
  - Add confidence bounds and safe fallback defaults.
- Tests:
  - Offline replay evaluation against historical bench runs.
- Exit criteria:
  - Better median and p95 performance without manual tuning.
- Improvement Intent (What): profile selection quality
- Improvement Method (How): learned policy with conservative objective and shadow rollout.
- Integrated Betterments: train with conservative objective that penalizes regressions heavily; require explainable feature importances for chosen profile; add shadow-evaluation mode before enabling profile decisions.
- Touchpoints: `src/index/build/runtime/runtime.js`, `src/index/build/tree-sitter-scheduler/adaptive-profile.js`, `src/retrieval/routing-policy.js`, `tools/bench/language/metrics.js`, `tools/bench/language/report.js`

### UB-063: Storage format modernization
- Status: [ ]
- Opportunity:
  - Further reductions possible with consolidated columnar formats.
- Tasks:
  - Evaluate replacing high-churn JSON artifacts with Arrow/Parquet-like local format where feasible.
  - Keep deterministic ordering and backward-free hard cutover contracts.
- Tests:
  - Full parity and determinism suite on representative repos.
- Exit criteria:
  - Lower I/O, smaller disk footprint, faster reload.
- Improvement Intent (What): artifact storage efficiency
- Improvement Method (How): modernized formats with parity gates and hard cutovers.
- Integrated Betterments: run full artifact parity checks before each format cutover; enforce strict deprecation timeline and remove legacy readers in same phase; add binary corruption sentinel checks on load.
- Touchpoints: `src/shared/artifact-io/manifest.js`, `src/shared/artifact-io/compression.js`, `src/shared/artifact-io/loaders/core.js`, `src/shared/artifact-schema-index.js`, `tests/shared/artifact-io/artifact-io-spec-contract.test.js`

## Second Sweep: Additional Opportunities Discovered

### UB-070: Small-repo overhead floor reduction
- Status: [ ]
- Observation:
  - Tiny repos still pay substantial fixed costs.
- Tasks:
  - Add fast path profile for tiny repos (<5k lines): reduced preprocessing overhead, tighter stage graph, minimal artifact set.
- Exit criteria:
  - Significantly lower wall-clock for small repos.
- Improvement Intent (What): small-repo runtime floor
- Improvement Method (How): tiny-repo fast-path and reduced stage graph.
- Integrated Betterments: create tiny-repo fast-path profile with reduced stage graph and fewer artifacts; use startup cache warming from previous runs; add hard upper-bound runtime target for tiny repos.
- Touchpoints: `src/index/build/runtime/runtime.js`, `src/index/build/indexer/steps/process-files.js`, `tools/bench/language/config.js`, `tests/perf/bench/bench-language-repos.test.js`

### UB-071: Language-aware chunk sizing
- Status: [ ]
- Observation:
  - Uniform chunking can hurt both throughput and retrieval quality.
- Tasks:
  - Tune chunk size/window by language and file role (library, tests, config).
- Exit criteria:
  - Better hit rates and fewer chunks for same coverage.
- Improvement Intent (What): chunking quality/efficiency
- Improvement Method (How): language-role-aware chunk sizing with sensitivity checks.
- Integrated Betterments: tune chunk size by language and file role (src/test/docs/config); add anti-fragmentation guardrails for short files; include chunk-size sensitivity analysis in benchmark reports.
- Touchpoints: `src/index/chunking.js`, `src/index/chunking/dispatch.js`, `src/index/chunking/limits.js`, `src/index/chunking/formats/markdown.js`, `tests/indexing/chunking/chunking-limits.test.js`, `tests/lang/typescript/typescript-chunk-boundaries.test.js`

### UB-072: Query-set quality expansion for benchmarks
- Status: [ ]
- Observation:
  - Current query sets may not fully stress semantic and long-tail retrieval.
- Tasks:
  - Expand benchmark queries with weighted intent classes and adversarial cases.
- Exit criteria:
  - Better signal for relevance and latency regressions.
- Improvement Intent (What): benchmark signal quality
- Improvement Method (How): richer/adversarial query sets and anti-overfit rotation.
- Integrated Betterments: add adversarial and long-tail query classes per language; include negative controls to detect false-positive-heavy ranking; rotate query subsets to prevent overfitting to static corpus.
- Touchpoints: `tools/bench/query-generator.js`, `tests/retrieval/query/golden/corpus.json`, `tests/retrieval/query/golden/expected.json`, `tests/retrieval/query/golden-query-corpus.test.js`

### UB-073: OS/filesystem profile presets
- Status: [ ]
- Observation:
  - NTFS write behavior and process startup costs differ from POSIX assumptions.
- Tasks:
  - Add platform-specific defaults for artifact writer, subprocess fanout, and fsync policy.
- Exit criteria:
  - Lower platform-specific variance and better out-of-box performance.
- Improvement Intent (What): platform throughput consistency
- Improvement Method (How): OS/filesystem-specific presets and startup calibration.
- Integrated Betterments: maintain platform-specific concurrency presets by filesystem type; include startup overhead calibration probe at run begin; auto-select tuned defaults unless explicitly overridden.
- Touchpoints: `src/index/build/runtime/runtime.js`, `src/index/build/artifacts-write.js`, `src/shared/subprocess.js`, `src/shared/cache-roots.js`, `tests/storage/sqlite/sqlite-wal-size-limit.test.js`

### UB-074: Memory headroom exploitation profile
- Status: [ ]
- Observation:
  - High available RAM indicates room for bigger caches and wider in-memory batching.
- Tasks:
  - Add high-memory profile that scales caches, postings buffers, and merge batch sizes safely.
- Exit criteria:
  - Increased throughput on high-RAM systems without OOM risk.
- Improvement Intent (What): memory-to-throughput conversion
- Improvement Method (How): headroom-aware cache/buffer scaling with safety guards.
- Integrated Betterments: use headroom-aware cache expansion with safety guard thresholds; add preemptive compaction triggers before memory cliffs; expose memory policy telemetry per stage.
- Touchpoints: `src/index/build/runtime/runtime.js`, `src/index/build/artifacts-write.js`, `src/index/build/indexer/steps/process-files.js`, `src/shared/cache/policy.js`, `tests/indexing/embeddings/embeddings-memory-plateau.test.js`

### UB-075: Deterministic performance regression gates
- Status: [ ]
- Observation:
  - Regressions are detectable but not consistently blocked.
- Tasks:
  - Define CI budgets by stage and repo tier.
  - Hard-fail regressions beyond tolerance windows.
- Exit criteria:
  - Performance regressions caught pre-merge.
- Improvement Intent (What): regression prevention
- Improvement Method (How): deterministic perf budgets and confidence-aware CI gates.
- Integrated Betterments: define per-stage budget gates with confidence intervals; separate hard-fail regressions from warning-only drift; add flake-resistant regression detection with repeated micro-runs.
- Touchpoints: `tests/run.js`, `tests/runner/run-reporting.js`, `tests/runner/harness/timings-ledger.test.js`, `tests/perf/bench/bench-language-repo-preflight.test.js`

## Runtime-First Execution Order (Hard Cutover)
Last revised: 2026-02-22T05:44:04.8332760-05:00

1. Wave 1 (Reliability + zero-work elimination): UB-001, UB-002, UB-003, UB-083, UB-084, UB-088.
2. Wave 2 (Core throughput path): UB-010, UB-011, UB-012, UB-013, UB-014, UB-020, UB-021, UB-022, UB-023, UB-079, UB-080.
3. Wave 3 (SCM + query runtime costs): UB-030, UB-031, UB-090, UB-091, UB-040, UB-041, UB-042, UB-043, UB-081, UB-082.
4. Wave 4 (Regression control + operator signal): UB-050, UB-051, UB-052, UB-075, UB-095, UB-098.
5. Wave 5 (Strategic/deferred programs): UB-032, UB-060, UB-061, UB-062, UB-063, UB-070, UB-071, UB-072, UB-073, UB-074, UB-076, UB-077, UB-078, UB-085, UB-086, UB-087, UB-089, UB-092, UB-093, UB-094, UB-096, UB-097.

### Runtime Consolidation Rules
- Merge UB-012 + UB-074 + UB-094 into one memory/concurrency controller cutover to avoid competing control loops.
- Merge UB-023 + UB-096 + UB-097 into one sqlite/artifact ingest queue-shape and fanout tuning cutover.
- Merge UB-040 + UB-092 + UB-093 into one low-hit remediation loop with before/after scorecards.
- Merge UB-083 + UB-084 + UB-088 into one modality-sparsity elision pipeline.
- Merge UB-030 + UB-090 + UB-091 into one SCM "cheap-by-default" policy (opt-in expensive hydration).
- Merge UB-050 + UB-052 + UB-095 + UB-098 into one low-overhead diagnostics and confidence stream.

## Definition of Done for This Roadmap
- No native parser crashes causing repo-level bench failure.
- Watchdog noise reduced by at least 80% while preserving true-slow-file detection.
- P95 build index time reduced by at least 40% on large-tier repos.
- Lowest-performing hit-rate repos improved to at least 90% with relevance parity.
- One-command run summary available with root-cause categorization.

## Third Sweep: Additional Advanced Opportunities

### UB-076: Early extracted-prose eligibility prefilter
- Status: [ ]
- Observation:
  - Some repos scan hundreds of extracted-prose files but produce very few extracted-prose chunks.
- Tasks:
  - Add lightweight prefilter to skip files with low extracted-content likelihood before full extracted-prose pass.
  - Record skip reasons for auditability.
- Exit criteria:
  - Reduced extracted-prose stage time on low-yield repos.
- Improvement Intent (What): extracted-prose preprocessing cost
- Improvement Method (How): low-cost eligibility probes and measured prefilter precision.
- Integrated Betterments: use low-cost lexical probes before extracted-prose scheduling; add opt-out override for repositories where extraction is critical; log precision/recall of prefilter decisions.
- Touchpoints: `src/index/chunking/formats/document-common.js`, `src/index/build/file-processor/skip.js`, `src/index/build/indexer/steps/process-files.js`, `tests/indexing/extracted-prose/extraction-report.test.js`

### UB-077: Code dictionary acquisition program
- Status: [ ]
- Observation:
  - Logs repeatedly show no code dictionary files for gated languages.
- Tasks:
  - Build language-specific dictionary packs from top benchmark corpora.
  - Version and ship dictionaries by language profile.
- Exit criteria:
  - Improved token normalization and hit rate for symbol-heavy queries.
- Improvement Intent (What): tokenization quality
- Improvement Method (How): curated language dictionary packs with versioning and rollback.
- Integrated Betterments: build dictionary ingestion pipeline with dedupe and quality scoring; version dictionary packs by language and benchmark epoch; add rollback path for dictionary regressions.
- Touchpoints: `src/shared/dictionary.js`, `src/retrieval/cli-dictionary.js`, `src/index/build/file-processor/relations.js`, `assets/dictionary/` (new), `tests/retrieval/query/query-intent-path-heuristics.test.js`

### UB-078: Minhash/summary strategy for large indexes
- Status: [ ]
- Observation:
  - Large indexes skip minhash signatures entirely at current threshold.
- Tasks:
  - Replace binary skip with sampled/minified minhash mode.
  - Evaluate incremental minhash generation to reduce full-pass cost.
- Exit criteria:
  - Better dedupe/similarity metadata with bounded overhead.
- Improvement Intent (What): minhash utility on large indexes
- Improvement Method (How): sampled/minified signatures instead of hard skipping.
- Integrated Betterments: use sampled minhash mode instead of all-or-nothing skipping; add adaptive signature density by corpus size; include similarity-quality checks to confirm utility.
- Touchpoints: `src/index/minhash.js`, `src/index/build/postings/minhash.js`, `src/shared/artifact-io/loaders/minhash.js`, `tests/indexing/artifacts/minhash-packed-roundtrip.test.js`, `tests/indexing/artifacts/minhash-max-docs-guard.test.js`

### UB-079: Local mirror clone cache for bench repos
- Status: [ ]
- Observation:
  - Re-clone and cold fetch overhead can add avoidable run time variance.
- Tasks:
  - Maintain local bare mirrors with periodic fetch.
  - Create working copies from local mirror references instead of full remote clone.
- Exit criteria:
  - Reduced clone/setup wall time and network variance.
- Improvement Intent (What): repo acquisition overhead
- Improvement Method (How): local mirror clone cache with integrity checks.
- Integrated Betterments: adopt local mirror fetch with staggered refresh windows; validate mirror integrity before checkout; add fallback to direct clone only on mirror failure.
- Touchpoints: `tools/bench/language/repos.js`, `tools/bench/language/process.js`, `tools/bench/language/config.js`, `tools/bench/language/locks.js`, `tests/perf/bench/bench-language-lock.test.js`

### UB-080: Artifact compression and mmap-friendly layout
- Status: [ ]
- Observation:
  - Artifact volume is high; read-path can benefit from contiguous layout.
- Tasks:
  - Introduce optional compressed containers for cold artifacts.
  - Re-layout hot artifacts for mmap-friendly contiguous reads.
- Exit criteria:
  - Lower disk footprint and faster warm-load behavior.
- Improvement Intent (What): artifact footprint and load speed
- Improvement Method (How): hot/warm/cold compression tiers and mmap-friendly layout.
- Integrated Betterments: classify artifacts into hot/warm/cold tiers before compression decisions; optimize layout for sequential mmap reads in hot paths; add compression CPU budget guardrails.
- Touchpoints: `src/shared/artifact-io/compression.js`, `src/shared/artifact-io/fs.js`, `src/shared/artifact-io/loaders/core.js`, `src/shared/chunk-meta-cold.js`, `tests/shared/artifact-io/jsonl-stream-roundtrip.test.js`, `tests/shared/artifact-io/artifact-io-bench-contract.test.js`

### UB-081: Query-time adaptive rerank budget
- Status: [ ]
- Observation:
  - Query latency outliers likely spend disproportionate time in candidate handling.
- Tasks:
  - Use dynamic rerank budget based on query entropy and first-pass confidence.
  - Cap expensive rerank on low-value tails while preserving top precision.
- Exit criteria:
  - Reduced p95 query latency with stable top-k quality.
- Improvement Intent (What): query p95 latency
- Improvement Method (How): adaptive rerank budgets based on intent and confidence.
- Integrated Betterments: apply rerank budget caps by query intent and candidate confidence; add p95 latency guard that trims rerank depth when needed; track quality delta of rerank cuts.
- Touchpoints: `src/retrieval/pipeline/rank-stage.js`, `src/retrieval/pipeline/topk.js`, `src/retrieval/scoring/ann-candidate-policy.js`, `src/retrieval/routing-policy.js`, `tests/retrieval/ann-candidate-policy-explain.test.js`, `tests/retrieval/filters/query-syntax/phrases-and-scorebreakdown.test.js`

### UB-082: Import graph cache invalidation precision
- Status: [ ]
- Observation:
  - Import cache invalidation appears during heavy runs and may be over-broad.
- Tasks:
  - Shift to fine-grained invalidation by file-set diff and dependency neighborhood.
  - Avoid global invalidations unless schema/engine changes.
- Exit criteria:
  - Fewer expensive import recomputes on incremental runs.
- Improvement Intent (What): import cache correctness/perf
- Improvement Method (How): neighborhood-level invalidation and stale-edge detection.
- Integrated Betterments: invalidate import cache by dependency neighborhood instead of global hash only; add stale-edge detector to prevent silent cache poisoning; include invalidation reason telemetry.
- Touchpoints: `src/index/build/import-resolution-cache.js`, `src/index/build/indexer/steps/relations.js`, `src/index/build/imports.js`, `tests/indexing/imports/cache-invalidation.test.js`, `tests/indexing/imports/import-graph-incremental-reuse.test.js`

## Fourth Sweep: Second Log Pass Additions (Newly Finished Repos)

### UB-083: Zero-modality stage elision (index build)
- Status: [x]
- Observation:
  - Repos like `ruby/ruby/rake` run prose/extracted/records stages with zero chunks and still pay artifact-write overhead.
- Tasks:
  - Skip stage execution entirely when modality file count and chunk count are both zero.
  - Emit one concise "stage elided" metric event per modality.
- Exit criteria:
  - No artifact-write work for empty modalities.
- Completion: 2026-02-22T06:22:10.0851476-05:00
- Validation:
  - `node tests/indexing/stage1/process-files-zero-modality-elision.test.js`
- Improvement Intent (What): empty-modality index overhead
- Improvement Method (How): stage elision before queue/materialization setup.
- Integrated Betterments: elide empty modality stages before queue construction to reduce overhead; cache modality emptiness by signature for repeat runs; add explicit "elided stage" counters in reports.
- Touchpoints: `src/index/build/indexer/steps/process-files.js`, `src/index/build/indexer/indexer.js`, `src/index/build/runtime/runtime.js`, `tests/indexing/language-fixture/chunk-meta-exists.test.js`

### UB-084: Zero-modality sqlite elision
- Status: [x]
- Observation:
  - Empty modalities still run sqlite build/fallback paths.
- Tasks:
  - Skip sqlite build for modalities with zero chunks and zero vectors.
  - Store explicit zero-state in manifest to keep load path deterministic.
- Exit criteria:
  - Reduced sqlite build time on sparse repos.
- Completion: 2026-02-22T06:22:10.0851476-05:00
- Validation:
  - `node tests/storage/sqlite/sqlite-skip-empty-code-rebuild.test.js`
  - `node tests/storage/sqlite/sqlite-skip-empty-records-rebuild.test.js`
- Improvement Intent (What): empty-modality sqlite overhead
- Improvement Method (How): sqlite build bypass with deterministic zero-state markers.
- Integrated Betterments: skip sqlite writers for empty modalities and bypass no-op manifests where safe; preserve deterministic zero-state markers for load-time correctness; add guard tests for accidental table creation.
- Touchpoints: `src/storage/sqlite/build/runner.js`, `src/storage/sqlite/build/index.js`, `src/index/validate/sqlite-report.js`, `tests/storage/sqlite/sqlite-skip-empty-code-rebuild.test.js`, `tests/storage/sqlite/sqlite-skip-empty-records-rebuild.test.js`

### UB-085: Generic high-cardinality grammar lane fanout
- Status: [x]
- Observation:
  - Large single-language batches still appear as one lane (for example ruby/php heavy waves).
- Tasks:
  - Expand laneing logic to split any grammar with high estimated parse cost, not just selected languages.
  - Use weighted partitioning by estimated AST complexity and file size.
- Exit criteria:
  - Lower tail latency and fewer near-10s watchdog events on large mono-language waves.
- Completion: 2026-02-22T06:44:50-05:00
- Validation:
  - `node tests/indexing/tree-sitter/tree-sitter-scheduler-adaptive-planner.test.js`
  - `node tests/indexing/tree-sitter/tree-sitter-scheduler-adaptive-profile.test.js`
  - `node tests/indexing/tree-sitter/tree-sitter-scheduler-warm-pool-tasks.test.js`
  - `node tests/perf/scheduler-fairness.test.js`
- Improvement Intent (What): mono-language batch latency
- Improvement Method (How): universal high-cardinality grammar lane fanout.
- Integrated Betterments: implement universal lane-splitting threshold by predicted parser cost; add dynamic lane merge when workload shrinks; capture lane imbalance metrics to guide future tuning.
- Touchpoints: `src/index/build/tree-sitter-scheduler/plan.js`, `src/index/build/tree-sitter-scheduler/policy.js`, `src/index/build/tree-sitter-scheduler/adaptive-profile.js`, `tests/indexing/tree-sitter/tree-sitter-scheduler-adaptive-planner.test.js`

### UB-086: Watchdog near-threshold anomaly detector
- Status: [x]
- Observation:
  - A large fraction of slow-file lines cluster around 10s, indicating threshold-bound behavior.
- Tasks:
  - Add near-threshold detector and emit warning when near-threshold fraction exceeds configurable limit.
  - Auto-suggest runtime tuning in diagnostics output.
- Exit criteria:
  - Operators can distinguish true slow files vs threshold artifacts immediately.
- Completion: 2026-02-22T06:56:23.3753592-05:00
- Validation:
  - `node tests/indexing/stage1/watchdog-near-threshold-anomaly.test.js`
  - `node tests/indexing/stage1/file-watchdog-hard-timeout.test.js`
  - `node tests/indexing/stage1/process-files-progress-heartbeat.test.js`
  - `node tests/tooling/reports/bench-language-stage-timing-report.test.js`
- Improvement Intent (What): watchdog false-positive visibility
- Improvement Method (How): near-threshold anomaly ratios with auto tuning hints.
- Integrated Betterments: compute near-threshold ratio per stage and repo; trigger targeted diagnostics when ratio exceeds budget; recommend adaptive threshold settings directly in summary output.
- Touchpoints: `src/index/build/indexer/steps/process-files.js`, `src/index/build/runtime/runtime.js`, `tools/bench/language/logging.js`, `tests/indexing/stage1/process-files-progress-heartbeat.test.js`

### UB-087: Extracted-prose low-yield bailout
- Status: [ ]
- Observation:
  - Some repos scan many extracted-prose files with tiny chunk yield (for example rspec).
- Tasks:
  - Add dynamic bailout when extracted-prose yield ratio is below threshold after warmup sample.
  - Keep deterministic sampling and explicit quality marker.
- Exit criteria:
  - Reduced extracted-prose stage time on low-yield repos.
- Improvement Intent (What): low-yield extracted-prose runtime waste
- Improvement Method (How): ROI-based bailout after deterministic warmup sample.
- Integrated Betterments: add extracted-prose warmup sample and ROI-based continuation decision; keep deterministic sampling seeds for reproducibility; expose bailout reason and expected quality impact.
- Touchpoints: `src/index/chunking/formats/document-common.js`, `src/index/build/indexer/steps/process-files.js`, `tools/build/embeddings/runner.js`, `tests/indexing/extracted-prose/extraction-report.test.js`

### UB-088: Modality sparsity profile cache
- Status: [x]
- Observation:
  - Same repo characteristics recur across runs.
- Tasks:
  - Cache per-repo modality sparsity profile keyed by repo signature.
  - Pre-apply stage skip/elision policy on subsequent runs.
- Exit criteria:
  - Faster repeat benchmarks with unchanged source trees.
- Completion: 2026-02-22T06:22:10.0851476-05:00
- Validation:
  - `node tests/indexing/cache/modality-sparsity-profile.test.js`
  - `node tests/indexing/stage1/process-files-zero-modality-elision.test.js`
- Improvement Intent (What): repeat-run efficiency
- Improvement Method (How): modality sparsity profile cache keyed by repo signature.
- Integrated Betterments: persist modality sparsity profile with strict signature invalidation; add aging policy for stale profiles; allow explicit manual override for experimentation.
- Touchpoints: `src/index/build/runtime/runtime.js`, `src/index/build/indexer/indexer.js`, `src/shared/cache.js`, `src/shared/cache-key.js`, `tests/indexing/cache/workspace-global-cache-reuse.test.js`

### UB-089: Import unresolved taxonomy and suppression policy
- Status: [x]
- Observation:
  - Unresolved imports in rspec/pandoc include likely fixture-only or intentionally missing modules.
- Tasks:
  - Classify unresolved imports by category (fixture, optional dep, typo, path normalization).
  - Suppress known-benign categories from hot log path while preserving file diagnostics.
- Exit criteria:
  - Lower noise with better actionable unresolved import reporting.
- Completion: 2026-02-22T07:17:05.7728265-05:00
- Validation:
  - `node tests/indexing/imports/import-resolution-language-coverage.test.js`
  - `node tests/indexing/imports/import-graph-unresolved-refresh.test.js`
- Improvement Intent (What): unresolved-import log usefulness
- Improvement Method (How): category taxonomy + benign suppression in live output.
- Integrated Betterments: enrich unresolved taxonomy with confidence and suggested remediation; suppress known-benign categories in live stream but persist full file logs; add unresolved trend tracking across runs.
- Touchpoints: `src/index/build/indexer/steps/relations.js`, `src/index/build/import-resolution-cache.js`, `src/index/build/imports.js`, `tests/indexing/imports/import-graph-unresolved-refresh.test.js`, `tests/indexing/imports/import-resolution-language-coverage.test.js`

### UB-090: SCM timeout adaptive policy by file cost
- Status: [ ]
- Observation:
  - Blame timeouts still appear on selected files despite 5000ms cap.
- Tasks:
  - Add adaptive timeout and retry budget by file size/history depth.
  - Add path-level cooldown list for repeat offenders during run.
- Exit criteria:
  - Fewer SCM timeout warnings and better overall run stability.
- Improvement Intent (What): SCM timeout rate
- Improvement Method (How): file-cost-adaptive timeout/retry policy with cooldown paths.
- Integrated Betterments: adapt SCM timeout from historical file/repo behavior; use progressive fallback from blame->commit metadata->stub; emit per-path timeout heatmap for tuning.
- Touchpoints: `src/index/scm/providers/git.js`, `src/index/scm/file-meta-snapshot.js`, `src/index/scm/runner.js`, `tests/indexing/git/git-meta-timeout-backoff.test.js`, `tests/indexing/git/git-meta-warning-details.test.js`

### UB-091: SCM metadata lazy hydration at query time
- Status: [ ]
- Observation:
  - Some SCM fields are not needed during indexing for every file.
- Tasks:
  - Persist minimal SCM stub at build time and lazily hydrate expensive fields only when query filters require them.
  - Cache hydrated metadata by build signature.
- Exit criteria:
  - Lower indexing overhead without losing filter capability.
- Improvement Intent (What): indexing-time SCM cost
- Improvement Method (How): lazy hydration of expensive SCM fields only when queried.
- Integrated Betterments: decouple mandatory vs optional SCM fields in contracts; lazily hydrate optional fields only on matching filters; cache hydrated values with strict build-signature keys.
- Touchpoints: `src/index/scm/file-meta-snapshot.js`, `src/retrieval/output/filters/meta.js`, `src/retrieval/output/filters/file.js`, `src/retrieval/cli/load-indexes.js`, `tests/retrieval/filters/git-metadata/chunk-author.test.js`

### UB-092: Benchmark query-set specialization by language family
- Status: [ ]
- Observation:
  - Generic query sets may under-represent language-specific retrieval failures.
- Tasks:
  - Extend per-language query corpus with structural and idiomatic queries.
  - Add weighted scoring for symbol, type, API, and behavior intent classes.
- Exit criteria:
  - Better precision in identifying language-specific retrieval regressions.
- Improvement Intent (What): language-specific benchmark precision
- Improvement Method (How): specialized query packs per language family.
- Integrated Betterments: maintain language-family benchmark packs and rotate query seeds; add per-language relevance labels for deeper quality signal; include miss-class distribution in reports.
- Touchpoints: `tools/bench/query-generator.js`, `benchmarks/repos.json`, `tests/retrieval/query/golden/corpus.json`, `tests/retrieval/query/golden-query-corpus.test.js`

### UB-093: Low-hit remediation loop (auto-generated patch suggestions)
- Status: [ ]
- Observation:
  - Persistent low-hit repos are identifiable (`z`, `inspect.lua`, `pandoc`, `luasocket`, `rake`, `fastlane`).
- Tasks:
  - Generate miss reports that propose tokenizer/ranker tuning candidates.
  - Track acceptance and post-change delta automatically.
- Exit criteria:
  - Faster cycle from low-hit detection to actionable code change.
- Improvement Intent (What): low-hit remediation cycle time
- Improvement Method (How): automated miss clustering and ranked tuning suggestions.
- Integrated Betterments: auto-generate ranked remediation proposals from miss clusters; map each suggestion to affected ranking/tokenization components; require before/after scorecards before acceptance.
- Touchpoints: `tools/bench/language/report.js`, `tools/bench/language/metrics.js`, `src/retrieval/query-intent.js`, `src/retrieval/rankers.js`, `tests/retrieval/query/query-intent.test.js`

### UB-094: RSS-aware embedding/write scheduling
- Status: [ ]
- Observation:
  - Large repos show high RSS in query stage; scheduling can better exploit headroom safely.
- Tasks:
  - Integrate rss pressure feedback into embedding and artifact writer concurrency controllers.
  - Prefer throughput expansion when memory headroom is abundant.
- Exit criteria:
  - Improved throughput on high-memory hosts without instability.
- Improvement Intent (What): throughput under high RAM
- Improvement Method (How): rss-aware embedding/write scheduling policies.
- Integrated Betterments: incorporate rss, gc pause, and allocator pressure into scheduler decisions; permit burst concurrency only while under headroom thresholds; record memory-driven adaptation decisions.
- Touchpoints: `src/index/build/artifacts-write.js`, `tools/build/embeddings/runner.js`, `src/index/build/runtime/runtime.js`, `tests/indexing/embeddings/embeddings-memory-plateau.test.js`

### UB-095: Stage-level throughput ledger per modality
- Status: [ ]
- Observation:
  - Throughput lines exist but are hard to compare longitudinally.
- Tasks:
  - Persist modality throughput ledger (`chunks/s`, `tokens/s`, `bytes/s`) per stage and repo.
  - Add diff tooling for regressions across runs.
- Exit criteria:
  - Fast identification of where throughput regressed.
- Improvement Intent (What): throughput regression detection
- Improvement Method (How): persistent stage/modality throughput ledger and deltas.
- Integrated Betterments: persist throughput ledger per modality and stage with run signatures; compute regression deltas against rolling baseline; expose top regressions in one-line run summary.
- Touchpoints: `tools/bench/language/metrics.js`, `tools/bench/language/report.js`, `tools/reports/show-throughput.js`, `tests/tooling/reports/show-throughput-language-normalization.test.js`

### UB-096: Artifact writer work-class queues
- Status: [ ]
- Observation:
  - Large and tiny artifact writes compete in same adaptive queue.
- Tasks:
  - Separate artifact writes into small/medium/large queues with independent concurrency knobs.
  - Prioritize draining long-tail large artifacts earlier.
- Exit criteria:
  - Lower tail stalls and better write-time predictability.
- Improvement Intent (What): artifact writer tail behavior
- Improvement Method (How): work-class queues with class-specific concurrency.
- Integrated Betterments: classify artifact writes into size classes with independent queue policies; preemptively drain large artifacts earlier; monitor tail-latency by class for feedback tuning.
- Touchpoints: `src/index/build/artifacts-write.js`, `src/shared/scheduler/debounce.js`, `tests/indexing/artifacts/artifact-write-adaptive-concurrency-controller.test.js`, `tests/indexing/artifacts/dynamic-write-concurrency-preserves-order.test.js`

### UB-097: Incremental bundle parser worker autotune by modality
- Status: [ ]
- Observation:
  - Fixed parser worker count may be suboptimal across modalities and repo sizes.
- Tasks:
  - Tune parser worker fanout separately for code/prose/extracted-prose based on bundle count and file size.
  - Add safety caps for low-count modalities.
- Exit criteria:
  - Lower sqlite build time and smoother CPU utilization.
- Improvement Intent (What): sqlite bundle parse efficiency
- Improvement Method (How): modality-aware parser worker autotuning.
- Integrated Betterments: auto-tune bundle parser workers from modality bundle count and average bundle bytes; add rapid convergence guard to avoid oscillation; store tuned values for repeat repos.
- Touchpoints: `src/storage/sqlite/build/runner.js`, `tools/bench/sqlite/build-from-bundles.js`, `src/index/build/runtime/runtime.js`, `tests/storage/sqlite/sqlite-incremental-memory-profile.test.js`

### UB-098: Bench run progress confidence index
- Status: [ ]
- Observation:
  - During long runs, operators need confidence score for hang-risk and ETA accuracy.
- Tasks:
  - Compute confidence index from heartbeat regularity, queue age, in-flight spread, and stall events.
  - Display confidence in interactive progress output and persist to report.
- Exit criteria:
  - Better operator trust and faster anomaly triage.
- Improvement Intent (What): operator trust in progress/ETA
- Improvement Method (How): confidence index derived from heartbeat/stall/queue metrics.
- Integrated Betterments: compute progress confidence from heartbeat, stall rate, queue age variance, and throughput stability; surface confidence in progress UI and report files; trigger proactive diagnostics when confidence drops sharply.
- Touchpoints: `tools/bench/language/process.js`, `tools/bench/language/logging.js`, `tools/bench/language/report.js`, `tests/perf/bench/bench-language-progress-parse.test.js`


