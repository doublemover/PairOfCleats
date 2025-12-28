# Complete Plan

This document consolidates all phase docs and tracks implementation status. Phase markdown files are removed after merge; this is the single source of truth.

## Status key
- done: implemented and validated
- partial: implemented with known gaps or follow-ups
- todo: not implemented
- in-progress: actively being implemented

## Baseline goals (status: done)
- [x] Per-repo indexing with a central cache outside the repo.
- [x] On-demand indexing with incremental caching and optional CI artifacts.
- [x] MCP server interface for status/build/search/model download.
- [x] Non-git repos supported with a strong recommendation to use git.

## Cache layout (status: done)
- <cache>/repos/<repoId>/index-code/
- <cache>/repos/<repoId>/index-prose/
- <cache>/repos/<repoId>/repometrics/
- <cache>/repos/<repoId>/index-sqlite/index-code.db
- <cache>/repos/<repoId>/index-sqlite/index-prose.db
- <cache>/models/
- <cache>/extensions/

Repo identity:
- Prefer git toplevel + remote URL (hash to repoId).
- If no git, hash absolute path.

## Model download and bootstrap (status: done)
- [x] Detect models in cache; prompt to download when missing.
- [x] Provide download helpers (node/python) and bootstrap path.

## Git handling (status: done)
- [x] Warn when git is missing and continue without git metadata.
- [x] Store commit hash and dirty flag when git is present.

## MCP surface (status: done)
- [x] index_status(repoPath)
- [x] build_index(repoPath, mode=all, incremental=true)
- [x] search(repoPath, query, filters...)
- [x] download_models()
- [x] report_artifacts()

## Phase 2: SQLite Candidate Generation (status: done)
Goal: Use SQLite to generate candidate sets while keeping scoring/rendering in JS.
Work items:
- [x] Candidate set creation via token, phrase, and chargram tables.
- [x] BM25 stats sourced from SQLite (doc_lengths + token_stats).
- [x] Fallback to file-backed artifacts when SQLite is missing or incomplete.
- [x] Docs updated to describe SQLite candidate generation.
Notes:
- Query tokenization remains in search.js; SQLite provides candidates only.
- Dense vectors and minhash are still JS-side.

## Phase 3: Parity + Performance Validation (status: done)
Goal: Validate SQLite vs file-backed parity and capture baseline metrics.
Work items:
- [x] Parity harness (tests/parity.js) with overlap and score deltas.
- [x] Query set in tests/parity-queries.txt.
- [x] Report output (docs/phase3-parity-report.json).
- [x] Benchmark harness (tests/bench.js) for latency and artifact sizes.

## Phase 4: Incremental Indexing (status: done)
Goal: Reuse per-file bundles to avoid re-embedding unchanged files.
Work items:
- [x] Per-file cache manifest and bundles outside the repo.
- [x] Incremental build path in build_index.js.
- [x] SQLite incremental updates in tools/build-sqlite-index.js.
- [x] Incremental tests (tests/sqlite-incremental.js).
Notes:
- Global postings are rebuilt from cached bundles (not in-place deltas for file-backed JSON).

## Phase 5: CI Artifact Generation + Detection (status: done)
Goal: Build and restore index artifacts in CI.
Work items:
- [x] Build script (tools/ci-build-artifacts.js) with manifest output.
- [x] Restore script (tools/ci-restore-artifacts.js) with commit checks.
- [x] Bootstrap restore when ci-artifacts/manifest.json exists.
- [x] Docs for GitHub and GitLab usage.

## Phase 6: Tests + Benchmarks (status: done)
Goal: Expand deterministic tests and perf harnesses.
Work items:
- [x] Fixture repos under tests/fixtures (sample, mixed).
- [x] Fixture smoke, parity, eval harnesses.
- [x] Bench harness (tests/bench.js) + bench-ann script.
- [x] Query cache, cleanup, uninstall, sqlite incremental/compact, mcp server tests.
- [x] Add CI workflow to run smoke + parity in GitHub Actions.

## Phase 7: Language Expansion (status: partial)
Goal: Provide stable chunking + metadata for prioritized languages.

Python (status: partial)
- [x] Python AST enrichment when python is available; heuristic fallback.
- [x] Class/function/method chunking with docstrings and signatures.
- [ ] Improve call graph accuracy for nested functions.
- [ ] Add type-aware docs for dataclasses/attrs.

Swift (status: partial)
- [x] Brace-aware chunking for declarations.
- [x] Doc comment extraction and signature metadata.
- [ ] Improve parsing of generics and extensions.

ObjC/C/C++ (status: partial)
- [x] Regex-driven chunking for C-family and ObjC blocks.
- [x] Selector extraction for ObjC methods.
- [ ] Improve call graph and include resolution heuristics.

Rust (status: partial)
- [x] Heuristic chunking for structs/enums/traits/mods/impls/fns.
- [x] Basic metadata extraction and imports/exports.
- [ ] Improve macro-heavy parsing and impl block method grouping.

## Phase 8: SQLite Scoring (FTS5) + ANN Extension (status: partial)
Goal: Optional SQLite-only sparse ranking plus optional vector extension for ANN.
Work items:
- [x] FTS5 ranking path (sqlite-fts backend) with shared renderer.
- [x] Configurable FTS5 weighting and optional normalization.
- [x] ANN extension support (sqlite-vec) with loadable binary.
- [x] Archive download support for extension binaries (zip/tar/tgz).
- [x] ANN extension test harness (tests/sqlite-ann-extension.js).
- [ ] Evaluate FTS5 vs BM25 parity on larger benchmarks and retune weights.

## Phase 9: Scoring Calibration (status: done)
Goal: Deterministic ranking and tunable BM25 parameters.
Work items:
- [x] Deterministic tie-breakers in ranking and merging.
- [x] Configurable BM25 parameters (search.bm25.k1/b).
- [x] Documentation for tuning and parity expectations.

## Phase 10: SQLite Split (status: done)
Goal: Split code/prose DBs to reduce lock contention.
Work items:
- [x] index-code.db and index-prose.db layout.
- [x] Build/search use split DBs.
- [x] CI artifacts handle split DBs.
- [x] Legacy index.db cleanup.

## Phase 11: Parallel Indexing (status: done)
Goal: Parallel file processing with deterministic ordering.
Work items:
- [x] File worker pool with deterministic output ordering.
- [x] Separate concurrency for import scanning.
- [x] Configurable concurrency via .pairofcleats.json and CLI.

## Phase 12: MCP Server Packaging (status: done)
Goal: MCP stdio server for index lifecycle and search.
Work items:
- [x] JSON-RPC 2.0 server with content-length framing.
- [x] Tools: index_status/build_index/search/download_models/report_artifacts.
- [x] Git-optional behavior with warnings.

## Phase 13: Language Fidelity Review + Enhancements (status: todo)
Goal: Evaluate current fidelity of each supported language and enhance parsing.
Work items:
- [ ] Build a per-language evaluation checklist (chunking, metadata, relations).
- [ ] Expand fixtures per language and add targeted regression tests.
- [ ] Implement improvements per language and update docs.

## Phase 14: CI Coverage and Full Script Coverage (status: todo)
Goal: Ensure every npm script is exercised and documented.
Work items:
- [ ] Add CI workflow for smoke + parity + core harnesses.
- [ ] Add a meta-test runner that exercises all scripts (with stub embeddings).
- [ ] Record expected runtime and platform constraints.

## Phase 15: New Languages and Features (status: todo)
Goal: Add new languages and new indexing/search features after baseline completion.
Work items:
- [ ] Select additional languages (post-baseline) and add support.
- [ ] Add new search/index features based on usage gaps.
- [ ] Update docs and tests for each addition.
