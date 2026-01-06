# Complete Plan

This document consolidates all phase docs and tracks implementation status. Phase markdown files are removed after merge; this is the single source of truth.
Completed phases live in `COMPLETED_PHASES.md` at the repo root. When a phase is marked done, move it there; that file is long, so scan in small chunks or append new completed phases to the end.

## Status key
- done: implemented and validated
- partial: implemented with known gaps or follow-ups
- todo: not implemented
- in-progress: actively being implemented

## Validation requirements (apply to every phase)
- [ ] Add or update targeted tests for new behavior.
- [ ] Update relevant docs and config schema entries.
- [ ] Run the smallest relevant test suite for the changes (and note skips).

## Deferred / Do Not Surface (status: deferred)
- [ ] Evaluate FTS5 vs BM25 parity on larger benchmarks and retune weights.
  - Do not prioritize or bring this up unless explicitly requested.

## Phase 18: Typical Repo Benchmark Matrix (status: todo)
Goal: Run typical-size repo benchmarks across configurations and summarize performance.
Work items:
- [ ] Run typical-tier benchmarks for each backend/configuration.
- [ ] Capture build/search metrics, throughput, and memory stats per repo/backend.
- [ ] Summarize results and key deltas (performance, accuracy, stability).
- [ ] Record errors/failures with repo/backend context and logs.
- [ ] Add follow-up fixes or investigation notes if regressions are found.
Notes (current failures to triage):
- [ ] bench-language run 2026-01-05T20:06:30.610Z: javascript/microsoft/vscode ended via SIGINT (code 130) after worker pool disabled due to worker failure.
- [ ] bench-language run 2026-01-05T20:07:43.847Z: javascript/microsoft/vscode build failed with TypeError `stmt.body.body.forEach is not a function` in `src/lang/typescript.js` (TSModuleDeclaration).
- [ ] csharp/AutoMapper/AutoMapper: build-index failed (bench-language.log, exit code 134).
- [ ] rust/BurntSushi/ripgrep: one run crashed (bench-language.log, exit code 3221225477) despite later success.
- [ ] kotlin/Kotlin/kotlinx.coroutines: build-index crashed (bench-language.log, exit code 3221225477).
- [ ] perl/mojolicious/mojo: sqlite build failed with ERR_JSON_TOO_LARGE loading chunk_meta.json (~3.41 GB); SQLite index build failed in bench log.
- [ ] Worker-tokenize crash logs with empty `{}` / `[object Object]` messages in bench cache (csharp/AutoMapper, kotlin/kotlinx.coroutines, perl/mojolicious); verify new error-normalization reduces noise and capture actionable details.
- [ ] Bench runs ended via SIGINT (code 130) due to cancellation; rerun required for missing metrics once failures are fixed.
- [ ] bench-language:matrix run 2026-01-04T01-08-37-988Z: all sqlite/sqlite-fts/memory configs failed (matrix.json exit code 1 or 3221226505); inspect per-config logs under benchmarks/results/matrix/2026-01-04T01-08-37-988Z/logs.
- [ ] bench-language:matrix memory backends (auto/on/off): perl/mojolicious/mojo search failed with ERR_STRING_TOO_LONG while loading JSON (artifact-io now converts ERR_STRING_TOO_LONG to ERR_JSON_TOO_LARGE; re-run to confirm).
- [ ] bench-language:matrix sqlite/sqlite-fts backends: perl/mojolicious/mojo build failed with ERR_STRING_TOO_LONG while reading JSON for sqlite build (artifact-io now converts ERR_STRING_TOO_LONG to ERR_JSON_TOO_LARGE; re-run to confirm).
- [ ] bench-language:matrix sqlite-fts-auto-headline: php/composer/composer failed due to missing export getKotlinFileStats from src/lang/kotlin.js (language-registry import error; re-run to confirm after module refactor).
- [ ] bench-language:matrix sqlite-fts-auto-balanced: kotlin/Kotlin/kotlinx.coroutines crashed with exit code 3221226505 (native crash; no JS stack in log).

## Phase 75: Repo-Level Diagnostics (status: todo)
Goal: Expose quick health and performance indicators.
Work items:
- [ ] Emit index stats summary at build end.
- [ ] Add a `pairofcleats status --json` report.
- [ ] Include shard, cache, and stage status.

## Phase 76: Test Suite Rationalization (status: todo)
Goal: Reduce test sprawl while keeping coverage.
Work items:
- [ ] Consolidate overlapping tests into suites.
- [ ] Remove redundant fixtures.
- [ ] Add stage-based integration tests.

## Phase 77: Performance Baseline Suite (status: todo)
Goal: Establish a stable perf regression workflow.
Work items:
- [ ] Add “perf smoke” benchmarks for indexing and sqlite rebuild.
- [ ] Track time/throughput for key repos.
- [ ] Add thresholds for regressions.

## Phase 78: Migration + Rollout Plan (status: todo)
Goal: Ship changes safely with clear rollback.
Work items:
- [ ] Add a migration guide for CLI/config changes.
- [ ] Provide a fallback path for legacy artifacts.
- [ ] Stage rollout in opt-in mode first.

## Phase 79: Legacy Cleanup Pass (status: todo)
Goal: Remove legacy code after migration stability.
Work items:
- [ ] Delete deprecated CLI commands and flags.
- [ ] Remove unused artifact formats.
- [ ] Update docs and tests to match.

## Phase 80: Final Consolidation + Audit (status: todo)
Goal: Verify functionality is preserved with less code and higher performance.
Work items:
- [ ] Run full validation (tests + benchmarks).
- [ ] Confirm perf goals and shard policy targets.
- [ ] Document final architecture and maintenance rules.


