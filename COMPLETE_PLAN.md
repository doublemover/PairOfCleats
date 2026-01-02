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

## Phase 8: SQLite Scoring (FTS5) + ANN Extension (status: done)
Goal: Optional SQLite-only sparse ranking plus optional vector extension for ANN.
Work items:
- [x] FTS5 ranking path (sqlite-fts backend) with shared renderer.
- [x] Configurable FTS5 weighting and optional normalization.
- [x] ANN extension support (sqlite-vec) with loadable binary.
- [x] Archive download support for extension binaries (zip/tar/tgz).
- [x] ANN extension test harness (tests/sqlite-ann-extension.js).

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

## Phase 23: Unified Setup Command (status: done)
Goal: Provide a single guided command that bundles optional setup steps.
Work items:
- [x] Add a guided setup script that can install deps, dictionaries, models, extensions, tooling, and build indexes.
- [x] Support prompts when defaults fail or when optional tooling is detected.
- [x] Provide non-interactive flags for CI usage.
- [x] Document and add tests for the unified setup flow.

## Maintenance / Refactor Guardrails (status: done)
- [x] Break `build_index.js` into focused modules (discovery/import scan/file processing/posting builders/artifact writers/metrics) to keep growth in check.

## Deferred / Do Not Surface (status: deferred)
- [ ] Evaluate FTS5 vs BM25 parity on larger benchmarks and retune weights.     
  - Do not prioritize or bring this up unless explicitly requested.

## Draft specs: LSP tooling provider roadmap (status: done)
Note: Captured for reference; implemented in the current codebase.
- [x] Draft 1: Shared JSON-RPC framing + reusable LSP client plumbing.
- [x] Draft 2: Swift tooling detection/install registry (`sourcekit-lsp`).
- [x] Draft 3: Cross-file inference refactor into tooling providers with ordering fixes.
- [x] Draft 4: TypeScript Compiler API upgrades (tsconfig-aware + broader coverage).

## Phase 24: Indexing Core Reliability (status: done)
- [x] Fix chunk weight wiring (`weightt` typo) and add a regression test for weight effects.
- [x] Use precomputed token frequencies in BM25 row building; remove unused `wordFreq`/`sparse` artifacts if they remain unused.
- [x] Add a config option to disable per-chunk `git blame` (or downgrade to file-level) for large repos.
- [x] Add empty-repo/zero-chunk coverage to ensure postings/metrics stay stable.

## Phase 25: Language Parsing Hardening (status: done)
- [x] Improve TypeScript import parsing for multi-line imports/exports and dynamic `import()` calls.
- [x] Add JSX/Stage-3 parsing support (espree or tree-sitter) to avoid fallback chunking in `.jsx/.tsx`.
- [x] Extend cross-file inference beyond TS (Go/Rust/Java via tooling hooks).
- [x] Add fixtures/tests for `.tsx/.mts/.cts` and Python AST fallback.

## Phase 26: Search + Scoring Consistency (status: done)
- [x] Unify MinHash implementation between indexing and search; add a compatibility test.
- [x] Decide on `sparse_postings_varint.bin`: consume it or remove it from outputs.
- [x] Add caching for search summaries and unify shared CLI/output code with sqlite search.
- [x] Expand filter coverage tests (return types, inferred types, returns/async flags).

## Phase 27: SQLite Incremental Safety (status: done)
- [x] Validate schema version before incremental updates and force rebuild when mismatched.
- [x] Detect embedding model changes (id/dims) and rebuild or re-ingest dense vectors.
- [x] Add optional vocab pruning/compaction for long-lived incremental DBs.
- [x] Add tests for schema mismatch and vector-ann table sync after deletions.

## Phase 28: Tooling + Cache UX (status: done)
- [x] Make `clean-artifacts --all` preserve models/dicts or add keep flags aligned with uninstall behavior.
- [x] Add `setup --json` summary output for CI automation.
- [x] Add Node-based archive extraction fallback for extension downloads.
- [x] Deduplicate shared helper logic across setup/bootstrap/clean/uninstall scripts.

## Phase 29: MCP + Docs Quality (status: done)
- [x] Refresh `ROADMAP.md` or mark it as historical to avoid contradicting `COMPLETE_PLAN.md`.
- [x] Add async MCP build support (stream output vs `spawnSync`) and document error payloads.
- [x] Add MCP error-path tests (invalid repo path, missing indexes).
- [x] Add a docs consistency test to catch stale plan/roadmap references.

## Phase 30: Scoring + JSON Consolidation (status: done)
Goal: Standardize scoring outputs across backends and make JSON payloads consistent and inspectable.
Work items:
- [x] Align score labels and semantics across memory/sqlite/sqlite-fts paths (including ANN fallback).
- [x] Add score breakdowns (BM25/FTS/ANN components, normalization flags, weights).
- [x] Ensure `--json-compact` preserves the same fields across backends and filters.
- [x] Update compare/parity harnesses to consume the unified score schema.
- [x] Add targeted tests for score breakdown parity.
Notes:
- Enhancement thread 1 (scoring transparency) is implemented here.

## Phase 31: Index Pipeline Pluginization (status: done)
Goal: Replace large conditional flows with a registry-based indexing pipeline.
Work items:
- [x] Build a per-language/format registry for scanners, parsers, and enrichers.
- [x] Centralize shared helpers (tokenize, metadata normalization, relations).
- [x] Reduce build_index control flow into steps with explicit inputs/outputs.
- [x] Add fixtures/tests for registry ordering and missing-handler fallbacks.
Notes:
- Enhancement thread 3 (parser SDK) is implemented here.

## Phase 32: Language Semantics Depth (status: done)
Goal: Improve type inference, control flow, and dataflow richness with interprocedural context.
Work items:
- [x] Expand intra-file type inference precision (literal unions, generics, propagation).
- [x] Add interprocedural summaries (callsite argument/return linking).
- [x] Extend dataflow with alias tracking for supported languages.
- [x] Add fidelity fixtures covering new semantic edges.
Notes:
- Enhancement thread 2 (language semantics) is implemented here.

## Phase 33: Continuous Indexing (status: done)
Goal: Support live updates via watchers and git hooks with safe concurrency.
Work items:
- [x] Add a watch mode to trigger incremental indexing on file changes.
- [x] Add optional git hook installers (post-commit / post-merge).
- [x] Add lock/health checks to avoid concurrent writes.
- [x] Document workflows for CI and local dev.
Notes:
- Enhancement thread 4 (continuous update loop) is implemented here.

## Phase 34: Artifact Lifecycle + Cache Hygiene (status: done)
Goal: Manage cache size, retention, and shared artifacts safely.
Work items:
- [x] Add cache quota and GC policy (age/size-based eviction).
- [x] Add artifact health checks and cold-cache rebuild hints.
- [x] Expand report-artifacts with per-repo and global rollups.
- [x] Add tests for GC and quota handling.
Notes:
- Enhancement thread 5 (cache/artifact hygiene) is implemented here.

## Phase 35: MCP UX Enhancements (status: done)
Goal: Make MCP interactions richer, safer, and more transparent.
Work items:
- [x] Stream progress for long-running MCP tasks (index build, download).
- [x] Add remediation hints on common errors (missing models/dicts/sqlite).
- [x] Add MCP tool to inspect config + cache status with warnings.
- [x] Add MCP-focused tests for error and progress payloads.
Notes:
- Enhancement thread 6 (MCP UX) is implemented here.

## Phase 36: Agent-Focused SAST Features (status: done)
Goal: Provide lightweight risk signals and flows for agent workflows.
Work items:
- [x] Add taint-like flow summaries for sources/sinks (configurable).
- [x] Add risky API usage detectors with metadata tags.
- [x] Add search filters for risk categories and flows.
- [x] Add fixtures/tests for sample flows.
Notes:
- Enhancement thread 7 (SAST-adjacent) is implemented here.

## Phase 37: Triage Records + Context Packs (Phase 0: spec review + plan) (status: done)
Goal: Review the v1 triage spec, map touched systems, and capture assumptions for a safe rollout.
Work items:
- [x] Review newfeature.md and current build/search/config flows to map integration points.
- [x] Confirm cache-only storage for triage artifacts (no repo writes).
- [x] Document assumptions and guardrails before implementation.
Assumptions/guardrails:
- Keep `build_index --mode all` semantics as code+prose only; records are opt-in via `--mode records`.
- Triage records live under the repo cache by default; no triage data written to the repo tree.
- Promote only selected fields into `docmeta.record` to avoid bloating chunk metadata.
- Record indexing can be a full rebuild in v1 (expected low volume); incremental support is optional.
- Meta filtering uses case-insensitive matching and ignores missing fields rather than erroring.
- Context packs can invoke `search.js` via a child process in v1 (no core search refactor required).

## Phase 38: Triage Records + Context Packs (Phase 1: config + paths + schema) (status: done)
Goal: Add triage config and path resolution, plus shared helpers for stable record IDs.
Work items:
- [x] Add `triage` config defaults to `.pairofcleats.json` and config loaders.
- [x] Extend `tools/dict-utils.js` with `getTriageRecordsDir()` and allow `getIndexDir(..., 'records')`.
- [x] Define shared helpers for recordId generation and promoted field extraction.

## Phase 39: Triage Records + Context Packs (Phase 2: ingest + normalize + render + decisions) (status: done)
Goal: Ingest findings into normalized records and render human/indexable views.
Work items:
- [x] Implement `tools/triage/ingest.js` with Dependabot, AWS Inspector, and generic adapters.
- [x] Add normalization modules in `src/triage/normalize/` with parse warnings and metadata routing.
- [x] Add `src/triage/render.js` to render canonical markdown views.
- [x] Implement `tools/triage/decision.js` to create decision records linked to findings.

## Phase 40: Triage Records + Context Packs (Phase 3: records indexing) (status: done)
Goal: Build a dedicated records index with prose-style tokenization and optional incremental caching.
Work items:
- [x] Allow `--mode records` in build args and route to a new records indexer.
- [x] Add `src/triage/index-records.js` to build `index-records` from record markdown + JSON.
- [x] Store promoted fields in `docmeta.record` and keep artifacts small.

## Phase 41: Triage Records + Context Packs (Phase 4: records search + meta filters) (status: done)
Goal: Enable records search with metadata-first filtering and JSON output support.
Work items:
- [x] Extend `search.js` to include `--mode records` and optional `--meta`/`--meta-json`.
- [x] Add record output section and JSON `records` payloads in `src/search/output.js`.
- [x] Add generic file/ext filters if not already present and apply them to records.

## Phase 42: Triage Records + Context Packs (Phase 5: context packs + MCP + tests + docs) (status: done)
Goal: Produce LLM-ready context packs, expose MCP tools, and add tests/fixtures/docs.
Work items:
- [x] Implement `tools/triage/context-pack.js` (history + repo evidence).
- [x] Add MCP tool wrappers for ingest/decision/context packs and allow `records` mode in MCP build/search.
- [x] Add triage fixtures + `tests/triage-records.js` and script wiring in `package.json`.
- [x] Update README + docs to describe triage workflows and new CLI/MCP tools.

## Phase 43: Prioritized Issues - P0 Correctness (status: done)
Goal: Fix correctness issues and broken/unused CLI behavior.
Work items:
- [x] Fix `--churn` CLI parsing, numeric thresholds, cache keys, and docs.
- [x] Replace churn metric with git numstat-based churn; add tests.
- [x] Fix Unicode offset drift between indexing and rendering; add fixture test.
- [x] Remove or implement build `--chunk` option; update docs/tests.
- [x] Enable GitHub Actions workflows under `.github/workflows` with CI.

## Phase 44: Prioritized Issues - P1 High ROI (status: done)
Goal: Bring MCP/CLI parity and improve indexing robustness.
Work items:
- [x] Expand MCP `search` filters to CLI parity and default to `--json-compact`.
- [x] Add MCP ops tools for download/build/maintain workflows.
- [x] Add `--path` alias filter and ensure CLI/MCP path/ext filters are consistent.
- [x] Auto-detect repo root for CLI/tools; add `--repo` overrides.
- [x] Add file-size guardrails with skip/partial index reporting.
- [x] Graceful shutdown for watch mode with lock cleanup.

## Phase 45: Prioritized Issues - P2 Enhancements (status: done)
Goal: Improve search UX and reduce index footprint.
Work items:
- [x] Add negative terms and quoted phrases to query parsing.
- [x] Add modified-since/after filters (git-aware recency).
- [x] Add chunk-author filter and output rendering.
- [x] Make chargram/phrase-ngrams configurable and handle missing artifacts.
- [x] Clarify score fields (`score`, `annScore`, `scoreBreakdown`) in JSON + docs.
- [x] Remove redundant `call` vs `calls` filtering path.

## Phase 46: Prioritized Issues - P3 Maintainability (status: done)
Goal: Improve packaging, configuration safety, and testability.
Work items:
- [x] Add `pairofcleats` CLI entrypoint with subcommands.
- [x] Add config schema + validation command.
- [x] Pin dependency versions (remove `*`) and document policy.
- [x] Refactor `search.js` into modules for testability.

## Phase 47: Audit Fixes - P0/P1 (status: done)
Goal: Close audit-listed correctness and UX issues.
Work items:
- [x] Fix invalid regex in `src/search/filters.js` and add ext filter test.
- [x] Make search filters strict when metadata is missing (`signature`, `param`, `calls`, `uses`).
- [x] Update CLI usage/help text to include all supported flags.
- [x] Add friendly "index missing" error with next-step hint.
- [x] Add targeted tests for filter strictness and missing index UX.

## Phase 48: Minimal API Server (status: done)
Goal: Provide a lightweight local HTTP JSON API for search/index status.
Work items:
- [x] Draft design doc for minimal API endpoints and payloads.
- [x] Implement `pairofcleats server` (HTTP JSON only) with search/status.
- [x] Add tests for API responses and CLI launch/stop behavior.

## Phase 49: CLI Explainability (status: done)
Goal: Improve human-readable scoring explanations.
Work items:
- [x] Add `--explain` / `--why` to CLI output to surface score breakdowns.
- [x] Document explainability output in README/docs.
- [x] Add tests covering explainability output.

## Phase 50: Editor Integration (status: done)
Goal: CLI-first integration followed by a minimal VS Code extension.
Work items:
- [x] Define CLI contract for editor use (JSON compact + file/line hints).
- [x] Prototype VS Code extension that shells out to `pairofcleats search`.
- [x] Add integration docs and basic extension tests.

## Phase 51: Streaming Enhancements (status: done)
Goal: Add WebSocket/streaming responses on top of the minimal API.
Work items:
- [x] Add streaming endpoints for long-running searches/index status.
- [x] Add client-side examples and tests.

## Phase 52: AST/Dataflow Enrichment Pass (status: done)
Goal: Expand AST-derived control-flow and heuristic dataflow coverage for richer metadata.
Work items:
- [x] Add heuristic alias detection to shared dataflow extraction.
- [x] Extend Python AST extraction to include control-flow counts and surface `controlFlow` in docmeta.
- [x] Add TypeScript alias coverage to language fidelity tests.
- [x] Refresh AST/dataflow docs and run language fidelity checks.

## Phase 53: Search CLI Modularization (status: done)
Goal: Break `src/search/cli.js` into focused modules for maintainability without changing behavior.
Work items:
- [x] Extract argument parsing + mode validation into a dedicated helper.
- [x] Move index loading/signature + query cache key helpers into shared CLI utilities.
- [x] Encapsulate SQLite connection setup and ANN extension probing in a helper module.
- [x] Keep output/rendering and pipeline wiring stable; update any impacted tests.

## Phase 54: Shared Language Parsing Helpers (status: done)
Goal: Reduce repeated doc/signature/modifier logic across heuristic language handlers.
Work items:
- [x] Expand `src/lang/shared.js` with configurable doc comment extraction utilities.
- [x] Replace per-language doc comment helpers with shared utilities where possible.
- [x] Add regression coverage for docstring extraction on representative fixtures.

## Phase 55: Index Validation Tooling (status: done)
Goal: Add a dedicated index/cache validation command for quick health checks.
Work items:
- [x] Implement `tools/index-validate.js` with human + JSON output and exit codes.
- [x] Check required artifacts based on config (phrase/chargram postings, sqlite DBs).
- [x] Add npm script and surface a setup/bootstrap hint for the validator.
- [x] Document usage in README and relevant setup docs.

## Phase 56: Regression Coverage + Docs Parity (status: done)
Goal: Ensure new refactors are covered and documentation matches current behavior.
Work items:
- [x] Add tests for index validation and docstring extraction updates.
- [x] Refresh README maintenance/setup sections to include new tooling.
- [x] Confirm `COMPLETE_PLAN.md` statuses are updated after each phase.

## Phase 57: Dictionary Tokenization Robustness (status: todo)
Goal: Prevent dictionary-based splitting from devolving unknown identifiers into single-character tokens and add a benchmark harness for segmentation options.
Work items:
- [ ] Update `splitWordsWithDict` to preserve unknown spans instead of emitting single characters.
- [ ] Align query token expansion to the updated dictionary-splitting behavior.
- [ ] Add a benchmark/experiment harness to compare greedy vs DP segmentation (coverage + token counts).
- [ ] Add regression tests for unknown identifiers in indexing and query parsing.

## Phase 58: Git Blame Range Correctness (status: todo)
Goal: Ensure blame ranges are computed on line numbers (not character offsets) so chunk authors are accurate.
Work items:
- [ ] Compute start/end line numbers before calling `getGitMeta` and pass line ranges to git blame.
- [ ] Reconcile 0-based vs 1-based line expectations and remove inconsistent +1 adjustments.
- [ ] Add fixture coverage that validates `chunk_authors` population.

## Phase 59: YAML Chunking Fix + Configurable Top-Level Strategy (status: todo)
Goal: Avoid overlapping YAML chunks and allow configurable sectioning defaults.
Work items:
- [ ] Default YAML to a single root chunk to avoid overlap and incorrect ranges.
- [ ] Add an optional config to enable top-level key chunking via line/indent scanning.
- [ ] Ensure key scanning uses line offsets (no `indexOf` on values).
- [ ] Add format-fidelity tests for YAML chunk boundaries and configurable strategy.

## Phase 60: External Docs URL Correctness (status: todo)
Goal: Ensure scoped npm package links are correct.
Work items:
- [ ] Preserve `@` in scoped package URLs and URL-encode path segments.
- [ ] Add regression tests for npm scoped module URLs in external docs.

## Phase 61: ANN vs Sparse Scoring Selection (status: todo)
Goal: Make ANN selection scale-safe by using sparse-first fallback and enable benchmarking of normalized blends.
Work items:
- [ ] Change score selection to prefer sparse scores unless sparse is absent/weak.
- [ ] Add optional normalized blend mode with tunable weights (disabled by default).
- [ ] Add benchmark harness to compare sparse-only, ANN-fallback, and blend strategies.
- [ ] Update score docs/tests to reflect selection logic and config knobs.

## Phase 62: Python AST Worker Pool (status: done)
Goal: Remove per-file Python AST spawn sync blocking by using a long-lived worker pool with recovery and scaling.
Work items:
- [x] Replace sync Python AST parsing with an async worker pool (stdio JSONL) and keep heuristics as fallback.
- [x] Support multi-tenant behavior: restart crashed workers, scale up to max workers when queue waits grow.
- [x] Add config defaults for python AST workers (enabled, workerCount, maxWorkers, timeouts).
- [x] Update language registry/build pipeline to await async AST metadata.
- [x] Add tests for Python AST worker behavior (skip when Python is unavailable).
- [x] Update docs/config references for new python AST options.

## Phase 63: Search Performance Indexes + Auto SQLite (status: done)
Goal: Reduce per-query overhead by caching lookup maps and prefiltering by common attributes.
Work items:
- [x] Precompute vocab lookup maps at index load (phrase/chargram) and reuse in query pipeline.
- [x] Add filter index for ext/kind/author/chunkAuthor/visibility to avoid full scans.
- [x] Add `search.sqliteAutoChunkThreshold` (default 5000) to auto-select SQLite on larger repos.
- [x] Add tests for filter index behavior and SQLite auto-selection.
- [x] Document auto-backend selection and filter index behavior.

## Phase 64: Dense Vector Merge + Separate Doc/Code Vectors (status: done)
Goal: Prevent quantization clipping and preserve doc/code embeddings for future use.
Work items:
- [x] Normalize merged embeddings ((doc+code)/2, L2 normalize) before quantization.
- [x] Persist separate doc/code dense vector artifacts alongside merged vectors.
- [x] Update metrics/docs/tests to reflect new dense artifacts.

## Phase 65: Incremental Manifest Refresh (status: done)
Goal: Avoid repeated hashing when cached bundles are reused via hash fallback.
Work items:
- [x] Emit updated manifest entries on cached bundle hits (even when reusing bundles).
- [x] Add regression tests for manifest refresh behavior.

## Phase 66: Benchmark Runner Resilience (status: todo)
Goal: Make benchmark runs robust against stale index locks and long-running builds.
Work items:
- [ ] Detect stale index locks during benchmark builds and either wait/retry or clear safely.
- [ ] Add an option for per-run cache roots (or per-repo lock namespaces) to avoid lock collisions.
- [ ] Emit a clear failure summary when a benchmark build is skipped due to locks.
- [ ] Add a regression test that simulates a stale lock during bench runs.
- [ ] Document lock handling and recommended bench workflows.

## Phase 67: BUGFIX - Indexing Correctness + Performance (status: todo)
Goal: Resolve critical indexing correctness bugs and high-impact performance regressions.
Work items:
- [ ] Fix git blame ranges to use line numbers (not character offsets) and eliminate off-by-one adjustments; validate chunk authors are populated.
- [ ] Ensure git metadata runs from the repo root (or uses `simpleGit({ baseDir })`) so `--repo` indexing works reliably.
- [ ] Replace YAML `indexOf`-based chunking with line/indent boundaries to avoid overlap and negative offsets.
- [ ] Stop dictionary splitting from devolving unknown spans into single-character tokens (preserve unknown spans).
- [ ] Avoid unbounded memory growth during indexing by streaming results instead of retaining all file chunks in memory.
- [ ] Skip `embed_doc` model calls when docstrings are empty to reduce embedding work on code-only chunks.
- [ ] Reduce `splitWordsWithDict` worst-case cost (add a bounded fallback/DP path) to avoid O(n²) token splitting.
- [ ] Make ANN vs sparse score selection scale-safe (normalize or sparse-first fallback).
- [ ] Tighten filter semantics for `--type`/`--author` so missing metadata does not pass and multi-value types are handled.
- [ ] Prevent exclude-only queries from triggering ANN embeddings that ignore exclusion semantics.
- [ ] Avoid O(N) MinHash scanning without a candidate set; gate or reduce fallback cost.
- [ ] Bound search summary caches (`fileTextCache`/`summaryCache`) to prevent unbounded growth in long-running processes.
- [ ] Prevent SQLite incremental updates from growing doc ids unbounded (avoid sparse `chunkMeta` + vector arrays).
- [ ] Avoid loading all SQLite chunks/vectors for FTS-only searches; stream or lazy-load where possible.
- [ ] Clarify ANN fallback behavior when sqlite-vec is unavailable (avoid silent JS ANN mismatch per mode).
- [ ] Fix tooling extension verification crash (missing `path` import in `tools/verify-extensions.js`).
- [ ] Fix `--url name=url` parsing in download-dicts/download-extensions to split on the first `=` so URLs with query strings work.
- [ ] Reduce tooling detection memory overhead by avoiding full `filePaths` accumulation just to detect workflow/config files.
- [ ] Skip full repo scans in tooling detect/install when language/tool overrides are provided (avoid unnecessary I/O on large repos).
- [ ] Honor `--no-ann` in benchmark runs (currently `tests/bench.js` always forces `--ann`).
- [ ] Fix bench runner `runProcess` to resolve/reject on spawn errors (missing binaries currently hang the run).
- [ ] Make bench runner process termination reliable on POSIX (spawn detached or kill child PID directly instead of `process.kill(-pid)` without a process group).
- [ ] Remove `spawnSync` usage from API server handlers so concurrent HTTP requests don’t block the event loop (`/search` + `/status`).
- [ ] Avoid unbounded stdout/stderr buffering in MCP tool runners; cap or stream output to prevent memory spikes during long index builds.
- [ ] Replace the MCP server's inline JSON-RPC parser with the shared parser, add a size guard, and avoid Buffer.concat churn to prevent unbounded memory growth.
- [ ] Ensure bootstrap/CI build scripts honor runtime Node options (max-old-space) so large repo indexing doesn’t ignore configured heap limits.
- [ ] Update git hook installer to respect runtime Node options (or call `pairofcleats build-index`) so incremental hook runs don’t ignore heap config.
- [ ] Ensure compare-models/combined-summary spawn child Node processes with runtime Node options from config (avoid OOM on large repos).
- [ ] Ensure benchmark runners (`tests/bench.js`, `tools/bench-language-repos.js`) derive NODE_OPTIONS from the target repo config (not the tool repo), so max-old-space settings apply to large repo benches.
- [ ] Avoid eager repo-size scans in cache GC when only age-based cleanup is requested; compute sizes lazily to reduce IO cost.
- [ ] Fix triage ingest path resolution so `--in` is relative to `--repo` (not CWD) when a repo override is provided.
- [ ] Ensure triage ingest/context-pack invoke search/build with runtime Node options (respect configured heap limits).
- [ ] Remove or regenerate unused SQLite fixture artifacts (including WAL/SHM) to reduce repo bloat and avoid WAL mode confusion in tests.
- [ ] Fix Lua chunker block termination to handle `end` lines with trailing comments (avoid unterminated decl blocks).
- [ ] Expand SQL statement splitting to handle dollar-quoted strings / dialect delimiters (e.g., `$$`, `$tag$`, `DELIMITER`) so function/procedure bodies are not split mid-statement.
- [ ] Update Python heuristic chunker to recognize `async def` when AST tooling is unavailable.
- [ ] Fix BM25 document-frequency tracking to count unique tokens per chunk (current `df` increments per occurrence, inflating IDF).
- [ ] Guard `buildPostings` against empty chunk sets (avoid reduce-on-empty crashes and handle missing embeddings gracefully).
- [ ] Make context-window estimation resilient to unreadable/invalid-encoding sample files (skip failures instead of aborting indexing).
- [ ] Fix triage record JSON sidecar lookup to respect nested directories (use the Markdown file’s directory, not the records root).

## Phase 68: Documentation Parity + Excellence (status: todo)
Goal: Ensure all docs are accurate, complete, and easy to consume for users and maintainers.
Work items:
- [ ] README: re-audit every command, feature, and default; remove outdated sections; add crisp, accurate feature inventory; ensure install/setup steps match current scripts and defaults.
- [ ] README: add a concise “quickstart” and “first index” path; include CLI examples for build/search/bootstrap/setup; document SQLite default behavior and ANN fallback.
- [ ] README: add link-out section for design docs (MCP, SQLite, parser backbone, benchmarks, triage); keep each link annotated with a one-sentence summary.
- [ ] README: update cache layout section (collapsed) with current cache roots, repo cache layout, and artifact paths; ensure doc matches `getRepoCacheRoot` and sqlite split DBs.
- [ ] README: update dictionary/model cache sections (collapsed) to match `download-dicts`, `download-models`, and repo dictionary behavior (default english wordlist).
- [ ] README: update tooling section (collapsed) to document auto-install, cache-local installs, and manual tool links; include clangd/sourcekit-lsp requirements.
- [ ] README: update testing section to be collapsible, grouped by “smoke”, “parity”, “bench”, “script-coverage”, and “full”; include the all-in-one test command.
- [ ] README: update maintenance section (collapsed) with uninstall, clean-artifacts, cache-gc, index-validate; include safety notes.
- [ ] docs/setup.md: align with `tools/setup.js` options (non-interactive/CI, heap configuration, skip flags, sqlite build flow).
- [ ] docs/editor-integration.md: ensure VS Code extension instructions and CLI args match current config keys (searchBackend/searchAnn/extraSearchArgs).
- [ ] docs/sqlite-*.md: ensure schema/version details, split DB layout, incremental/compaction paths, and ANN extension config match code.
- [ ] docs/ast-feature-list.md + docs/language-fidelity.md: refresh coverage tables, mark tool-assisted type inference requirements, and note fallback behaviors.
- [ ] docs/repometrics-dashboard.md: verify inputs/outputs and update examples to match metrics JSONL paths and fields.
- [ ] docs/api-server.md + docs/mcp-server.md: verify endpoints, request/response payloads, streaming behavior, and build/search flags; add samples.
- [ ] docs/config-schema.json: audit every documented config key against actual usage; add/adjust schema descriptions where missing.
- [ ] docs/combined-summary.json / model-compare*.json: verify sample reports are current or regenerate with placeholder notes (no stale fields).
- [ ] ROADMAP.md: ensure “historical” status and link to COMPLETE_PLAN; remove stale roadmap items.
