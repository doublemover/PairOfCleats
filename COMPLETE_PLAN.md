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
- [ ] csharp/AutoMapper/AutoMapper: build-index failed (bench-language.log, exit code 134).
- [ ] rust/BurntSushi/ripgrep: one run crashed (bench-language.log, exit code 3221225477) despite later success.
- [ ] kotlin/Kotlin/kotlinx.coroutines: build-index crashed (bench-language.log, exit code 3221225477).
- [ ] bench-language:matrix run 2026-01-04T01-08-37-988Z: all sqlite/sqlite-fts/memory configs failed (matrix.json exit code 1 or 3221226505); inspect per-config logs under benchmarks/results/matrix/2026-01-04T01-08-37-988Z/logs.
- [ ] bench-language:matrix memory backends (auto/on/off): perl/mojolicious/mojo search failed with ERR_STRING_TOO_LONG while loading JSON (artifact-io now converts ERR_STRING_TOO_LONG to ERR_JSON_TOO_LARGE; re-run to confirm).
- [ ] bench-language:matrix sqlite/sqlite-fts backends: perl/mojolicious/mojo build failed with ERR_STRING_TOO_LONG while reading JSON for sqlite build (artifact-io now converts ERR_STRING_TOO_LONG to ERR_JSON_TOO_LARGE; re-run to confirm).
- [ ] bench-language:matrix sqlite-fts-auto-headline: php/composer/composer failed due to missing export getKotlinFileStats from src/lang/kotlin.js (language-registry import error; re-run to confirm after module refactor).
- [ ] bench-language:matrix sqlite-fts-auto-balanced: kotlin/Kotlin/kotlinx.coroutines crashed with exit code 3221226505 (native crash; no JS stack in log).


