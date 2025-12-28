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
- <cache>/repos/<repoId>/incremental/
- <cache>/repos/<repoId>/repometrics/
- <cache>/repos/<repoId>/index-sqlite/index-code.db
- <cache>/repos/<repoId>/index-sqlite/index-prose.db
- <cache>/models/
- <cache>/extensions/

Repo identity:
- Hash the absolute repo path (run from repo root for stable IDs).
- Git metadata is captured separately for status/reporting.

SQLite location:
- Override with `sqlite.dbDir` or `codeDbPath`/`proseDbPath`.
- Point `sqlite.dbDir` at `index-sqlite` to keep DBs in the repo.

## Model download and bootstrap (status: done)
- [x] Detect model availability in MCP status and provide a download_models hint.
- [x] Provide download helper (node) and bootstrap path.

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

## Phase 7: Language Expansion (status: done)
Goal: Provide stable chunking + metadata for prioritized languages.

Python (status: done)
- [x] Python AST enrichment when python is available; heuristic fallback.
- [x] Class/function/method chunking with docstrings and signatures.
- [x] Improve call graph accuracy for nested functions.
- [x] Add type-aware docs for dataclasses/attrs.

Swift (status: done)
- [x] Brace-aware chunking for declarations.
- [x] Doc comment extraction and signature metadata.
- [x] Improve parsing of generics and extensions.

ObjC/C/C++ (status: done)
- [x] Regex-driven chunking for C-family and ObjC blocks.
- [x] Selector extraction for ObjC methods.
- [x] Improve call graph and include resolution heuristics.

Rust (status: done)
- [x] Heuristic chunking for structs/enums/traits/mods/impls/fns.
- [x] Basic metadata extraction and imports/exports.
- [x] Improve macro-heavy parsing and impl block method grouping.

## Phase 7b: AST Completion Passes (status: done)
Goal: Extend AST-backed languages to a "complete" metadata and dataflow feature set.
Work items:
- [x] Define and document the AST feature list and per-language coverage.
- [x] JS AST: signatures/params/modifiers/inheritance + dataflow (reads/writes/mutations/throws/awaits/yields).
- [x] Python AST: signatures/params/types/bases/modifiers + dataflow (reads/writes/mutations/throws/awaits/yields/globals).
- [x] Configurable AST dataflow extraction (default on).
- [x] Add fixtures + language-fidelity assertions for AST metadata.

## Phase 8: SQLite Scoring (FTS5) + ANN Extension (status: partial)
Goal: Optional SQLite-only sparse ranking plus optional vector extension for ANN.
Work items:
- [x] FTS5 ranking path (sqlite-fts backend) with shared renderer.
- [x] Configurable FTS5 weighting and optional normalization.
- [x] ANN extension support (sqlite-vec) with loadable binary.
- [x] Archive download support for extension binaries (zip/tar/tgz).
- [x] ANN extension test harness (tests/sqlite-ann-extension.js).
- [ ] Evaluate FTS5 vs BM25 parity on larger benchmarks and retune weights (deferred).

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

## Phase 13: Language Fidelity Review + Enhancements (status: done)
Goal: Evaluate current fidelity of each supported language and enhance parsing.
Work items:
- [x] Build a per-language evaluation checklist (chunking, metadata, relations).
- [x] Expand fixtures per language and add targeted regression tests.
- [x] Implement improvements per language and update docs.

## Phase 14: CI Coverage and Full Script Coverage (status: done)
Goal: Ensure every npm script is exercised and documented.
Work items:
- [x] Add CI workflow for smoke + parity + core harnesses.
- [x] Add a meta-test runner that exercises all scripts (with stub embeddings).
- [x] Record expected runtime and platform constraints.

## Phase 15: New Languages and Features (status: done)
Goal: Add new languages and new indexing/search features after baseline completion.
Work items:
-- [x] Add Go support (chunking + metadata + relations + fixtures + tests).
-- [x] Add Java support (chunking + metadata + relations + fixtures + tests).
-- [x] Add Perl (lite) support for comedy coverage (chunking + minimal metadata).
-- [x] Add Shell (lite) support (chunking + minimal metadata + fixtures + tests).
-- [x] Add AST-based dataflow metadata (reads/writes/mutations/throws/awaits/yields).
-- [x] Add search filters for AST metadata (decorators/modifiers/returns/throws/reads/writes/mutations/extends/visibility).
-- [x] Render AST metadata in human output.
-- [x] Update docs and tests for each addition.

## Phase 16: Unified Parsing + Tooling Bootstrap (status: done)
Goal: Centralize parsing where possible while keeping native parsers for stable languages, and add tooling detection/install support.
Work items:
- [x] Choose and document a unified parser backbone (tree-sitter) plus native parser mapping for JS/Python.
- [x] Add tooling detection + install scripts with cache-local default installs and optional normal installs.
- [x] Add config: tooling.autoInstallOnDetect, tooling.installScope, tooling.allowGlobalFallback.
- [x] Update bootstrap to detect languages and auto-install tooling when configured.
- [x] Add tests for tooling detection/install logic (stubbed where needed).

## Phase 17: Format Coverage Expansion (status: done)
Goal: Add rich chunking/metadata for common config and docs formats.
Work items:
- [x] Add JSON/TOML/INI/XML parsers and chunking rules.
- [x] Add Dockerfile/Makefile parsing and chunking rules.
- [x] Add GitHub Actions YAML parsing (workflow/job/step chunks).
- [x] Add RST and AsciiDoc heading/section chunking.
- [x] Update fixtures, language-fidelity checklist, and docs for formats.

## Phase 18: Language Expansion (status: done)
Goal: Add baseline parsing/chunking/relations for new languages with the unified backbone.
Work items:
- [x] TypeScript baseline heuristic chunking + metadata (native TS parser integration deferred).
- [x] C# baseline heuristic chunking + metadata (tree-sitter/LSP enrichment deferred).
- [x] Kotlin baseline heuristic chunking + metadata (tree-sitter/LSP enrichment deferred).
- [x] Ruby baseline heuristic chunking + metadata (tree-sitter/LSP enrichment deferred).
- [x] PHP baseline heuristic chunking + metadata (tree-sitter/LSP enrichment deferred).
- [x] Lua baseline heuristic chunking + metadata (tree-sitter/LSP enrichment deferred).
- [x] SQL baseline statement chunking + metadata (dialect parsing in Phase 19).
- [x] Add fixtures and language-fidelity assertions for each.
Notes:
- Tree-sitter/native parser enrichment remains planned alongside Phase 19-22 work.

## Phase 19: SQL Dialect Parsing (status: done)
Goal: Provide dialect-aware SQL parsing and metadata.
Work items:
- [x] Add PostgreSQL/MySQL/SQLite dialect selection rules (extension + override).
- [x] Add per-dialect fixtures and tests.
- [x] Add config for sql.dialect and dialect-by-extension mapping.

## Phase 20: CFG + Dataflow Everywhere (status: done)
Goal: Add control-flow graphs and dataflow metadata across supported languages.
Work items:
- [x] Define shared CFG/dataflow schema in docs/ast-feature-list.md.
- [x] Implement CFG/dataflow for C/C++/ObjC, Rust, Go, Java, Shell.
- [x] Reuse shared engine for JS/Python where applicable.
- [x] Add filters and output rendering for CFG/dataflow metadata.
- [x] Expand fixtures/tests to validate control-flow and dataflow fields.
- [x] Evaluate dynamic language handler imports (pros/cons, perf, DX).

## Phase 21: Type Inference (Intra-file) (status: done)
Goal: Add local type inference for each supported language.
Work items:
- [x] Implement intra-file inference for literals, annotations, and symbol tables.
- [x] Merge inferred types into docmeta and render/filter paths.
- [x] Validate with fixtures and language-fidelity tests.

## Phase 22: Type Inference (Cross-file) (status: done)
Goal: Resolve types across files after intra-file stability is confirmed.       
Work items:
- [x] Add cross-file symbol resolution and import/usage linking.
- [x] Use detected tooling when present for richer type info.
- [x] Validate with tests; provide parity/perf summary after completion.        
Notes:
- Cross-file inference is covered by `tests/type-inference-crossfile.js`; large-repo perf runs are still pending.

## Phase 23: Unified Setup Command (status: todo)
Goal: Provide a single guided command that bundles optional setup steps.
Work items:
- [ ] Add a guided setup script that can install deps, dictionaries, models, extensions, tooling, and build indexes.
- [ ] Support prompts when defaults fail or when optional tooling is detected.
- [ ] Provide non-interactive flags for CI usage.
- [ ] Document and add tests for the unified setup flow.

## Maintenance / Refactor Guardrails (status: todo)
- [ ] Break `build_index.js` into focused modules (discovery/import scan/file processing/posting builders/artifact writers/metrics) to keep growth in check.
