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

## Phase 11: Query Intent Classification (status: todo)
Goal: Improve defaults based on query shape.
Work items:
- [ ] Add `classifyQuery()` (code-ish vs prose-ish vs path-ish).
- [ ] Use intent to select vector set (`denseVectorMode=auto`) and field weights.
- [ ] Add `--explain` output for intent decisions.
- [ ] Add tests for intent classification.

## Phase 12: Graph-Aware Context Expansion (status: todo)
Goal: Return richer context around top hits for agent workflows.
Work items:
- [ ] Add a context expansion step using call/import relations and repo map.
- [ ] Return primary hits plus labeled context hits.
- [ ] Add filters/limits to control expansion size.
- [ ] Add tests for context expansion behavior.

## Phase 13: Structural Search Integration (status: todo)
Goal: Persist structural matches as index metadata and expose filters.
Work items:
- [ ] Refactor `tools/structural-search.js` into importable modules.
- [ ] Store structural matches in chunk metadata.
- [ ] Add filters: `--struct-pack`, `--struct-rule`, `--struct-tag`.
- [ ] Add tests for structural match ingestion and filtering.

## Phase 14: Build-Time Filter Index Artifact (status: todo)
Goal: Avoid recomputing the path/chargram filter index at search time.
Work items:
- [ ] Build and persist a filter index artifact at index time.
- [ ] Load the artifact in search to avoid recomputation.
- [ ] Add tests for filter index parity.

## Phase 15: Command Surface Simplification (status: todo)
Goal: Reduce and align scripts, flags, and docs.
Work items:
- [ ] Audit scripts and flags for duplication; consolidate to a minimal set.
- [ ] Introduce consistent grouping/naming for CLI commands.
- [ ] Update README and docs to match the simplified surface.

## Phase 16: Module Boundaries + Experimental Isolation (status: todo)
Goal: Make the system easier to reason about and extend.
Work items:
- [ ] Restructure into `src/index/`, `src/retrieval/`, `src/storage/`, `src/integrations/`.
- [ ] Move experimental features under `src/experimental/` and gate behind `profile=full`.
- [ ] Update imports/tests/docs for new module boundaries.

## Phase 17: Benchmarks and Performance Methodology (status: todo)
Goal: Standardize performance evaluation.
Work items:
- [ ] Add microbench suite under `tools/bench/micro/` with p50/p95 reporting.
- [ ] Add component benchmarks (index build without embeddings, dense-only, sparse-only, hybrid).
- [ ] Add warm/cold run definitions and reporting.
- [ ] Document benchmark methodology and expected runtime.

## Phase 18: Typical Repo Benchmark Matrix (status: todo)
Goal: Run typical-size repo benchmarks across configurations and summarize performance.
Work items:
- [ ] Run typical-tier benchmarks for each backend/configuration.
- [ ] Capture build/search metrics, throughput, and memory stats per repo/backend.
- [ ] Summarize results and key deltas (performance, accuracy, stability).
- [ ] Record errors/failures with repo/backend context and logs.
- [ ] Add follow-up fixes or investigation notes if regressions are found.
Notes (current failures to triage):
- [ ] csharp/AutoMapper/AutoMapper: build-index failed (bench-language.log, exit code 134).
- [ ] rust/BurntSushi/ripgrep: one run crashed (bench-language.log, exit code 3221225477) despite later success.
- [ ] kotlin/Kotlin/kotlinx.coroutines: build-index crashed (bench-language.log, exit code 3221225477).
- [ ] bench-language:matrix run 2026-01-04T01-08-37-988Z: all sqlite/sqlite-fts/memory configs failed (matrix.json exit code 1 or 3221226505); inspect per-config logs under benchmarks/results/matrix/2026-01-04T01-08-37-988Z/logs.
- [ ] bench-language:matrix memory backends (auto/on/off): perl/mojolicious/mojo search failed with ERR_STRING_TOO_LONG while loading JSON (src/search/cli-index.js:19).
- [ ] bench-language:matrix sqlite/sqlite-fts backends: perl/mojolicious/mojo build failed with ERR_STRING_TOO_LONG while reading JSON for sqlite build (src/sqlite/utils.js:57, tools/build-sqlite-index.js:90).
- [ ] bench-language:matrix sqlite-fts-auto-headline: php/composer/composer failed due to missing export getKotlinFileStats from src/lang/kotlin.js (language-registry import error).
- [ ] bench-language:matrix sqlite-fts-auto-balanced: kotlin/Kotlin/kotlinx.coroutines crashed with exit code 3221226505 (native crash; no JS stack in log).


