# Completed Phases

Completed phases moved out of `NEW_ROADMAP.md` live here. Append new completed phases to the end to keep updates simple.

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


## Phase 84: Tooling ingest + precedence (status: done)
- [x] Added SCIP, LSIF, and ctags ingestion tooling with fixtures/tests.
- [x] Added GNU Global (GTAGS) ingest as a fallback symbol source.
- [x] Documented symbol source precedence and storage locations.


## Phase 85: Structural search (status: done)
- [x] Added structural search CLI for semgrep, ast-grep, and comby.
- [x] Added rule-pack registry and example packs.
- [x] Added fixtures/tests for structural search outputs.


## Phase 86: Service-mode indexer (status: done)
- [x] Added service-mode CLI with repo sync, durable queue, and worker processing.
- [x] Documented service workflow and config examples.


## Phase 87: External backend evaluation (status: done)
- [x] Added external backend evaluation notes and recommendations.


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

## Phase 27: Config Surface Inventory + Audit (status: done)
Goal: Catalog every config knob, env override, and CLI flag to identify redundancies.
Work items:
- [x] Build a config/flag inventory from `docs/config-schema.json`, `.pairofcleats.json`, `src/shared/cli.js`, and `tools/*`.
- [x] Flag overlapping or unused settings and map to owning modules.
- [x] Identify safe defaults and required knobs for core workflows.

## Phase 28: Config De-duplication + Deprecation Map (status: done)
Goal: Remove duplicate config paths while preserving behavior via migration.
Work items:
- [x] Collapse overlapping keys (e.g., per-tool vs global) into a single authority.
- [x] Add deprecation notices and compatibility shims with warnings.
- [x] Update docs to show the reduced surface.

## Phase 29: Profile System Overhaul (status: done)
Goal: Make profiles the main surface for tuning and keep raw config minimal.
Work items:
- [x] Define new profile tiers and map to features (lite/balanced/full/bench).
- [x] Remove ad-hoc benchmark toggles where profiles cover the same behavior.
- [x] Standardize profile application order and precedence.

## Phase 30: Env Override Consolidation (status: done)
Goal: Reduce environment variable sprawl and ensure deterministic behavior.
Work items:
- [x] Consolidate env flags into a single prefix namespace with documented precedence.
- [x] Remove legacy env flags that are redundant with CLI or profiles.
- [x] Add a diagnostic dump of effective config for debugging.

## Phase 31: Public CLI Re-architecture (status: done)
Goal: Redesign the public CLI into a single cohesive command tree.
Work items:
- [x] Define a minimal command surface (core, sqlite, bench, service, tooling).
- [x] Merge one-off scripts into subcommands or internal helpers.
- [x] Provide compatibility aliases for legacy commands with warnings.

## Phase 32: CLI Argument Parsing Unification (status: done)
Goal: Centralize parsing and validation to remove duplicate logic.
Work items:
- [x] Move command definitions into shared modules under `src/shared/cli.js`.
- [x] Remove per-script arg parsing duplication across `tools/*`.
- [x] Add schema-backed validation for critical flags.
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
- Cross-file inference is covered by `tests/type-inference-crossfile.js`, but the test is temporarily gated due to a hang (tracked in Phase 89); large-repo perf runs are still pending.


## Phase 23: Unified Setup Command (status: done)
Goal: Provide a single guided command that bundles optional setup steps.
Work items:
- [x] Add a guided setup script that can install deps, dictionaries, models, extensions, tooling, and build indexes.
- [x] Support prompts when defaults fail or when optional tooling is detected.
- [x] Provide non-interactive flags for CI usage.
- [x] Document and add tests for the unified setup flow.


## Maintenance / Refactor Guardrails (status: done)
- [x] Break `build_index.js` into focused modules (discovery/import scan/file processing/posting builders/artifact writers/metrics) to keep growth in check.


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
- [x] Refresh `ROADMAP.md` or mark it as historical to avoid contradicting `NEW_ROADMAP.md`.
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
- [x] Add normalization modules in `src/integrations/triage/normalize/` with parse warnings and metadata routing.
- [x] Add `src/integrations/triage/render.js` to render canonical markdown views.
- [x] Implement `tools/triage/decision.js` to create decision records linked to findings.


## Phase 40: Triage Records + Context Packs (Phase 3: records indexing) (status: done)
Goal: Build a dedicated records index with prose-style tokenization and optional incremental caching.
Work items:
- [x] Allow `--mode records` in build args and route to a new records indexer.
- [x] Add `src/integrations/triage/index-records.js` to build `index-records` from record markdown + JSON.
- [x] Store promoted fields in `docmeta.record` and keep artifacts small.


## Phase 41: Triage Records + Context Packs (Phase 4: records search + meta filters) (status: done)
Goal: Enable records search with metadata-first filtering and JSON output support.
Work items:
- [x] Extend `search.js` to include `--mode records` and optional `--meta`/`--meta-json`.
- [x] Add record output section and JSON `records` payloads in `src/retrieval/output.js`.
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
- [x] Fix invalid regex in `src/retrieval/filters.js` and add ext filter test.
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
Goal: Break `src/retrieval/cli.js` into focused modules for maintainability without changing behavior.
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
- [x] Confirm `NEW_ROADMAP.md` statuses are updated after each phase.


## Phase 57: Dictionary Tokenization Robustness (status: done)
Goal: Prevent dictionary-based splitting from devolving unknown identifiers into single-character tokens and add a benchmark harness for segmentation options.
Work items:
- [x] Update `splitWordsWithDict` to preserve unknown spans instead of emitting single characters.
- [x] Align query token expansion to the updated dictionary-splitting behavior.
- [x] Add a benchmark/experiment harness to compare greedy vs DP segmentation (coverage + token counts).
- [x] Add regression tests for unknown identifiers in indexing and query parsing.


## Phase 58: Git Blame Range Correctness (status: done)
Goal: Ensure blame ranges are computed on line numbers (not character offsets) so chunk authors are accurate.
Work items:
- [x] Compute start/end line numbers before calling `getGitMeta` and pass line ranges to git blame.
- [x] Reconcile 0-based vs 1-based line expectations and remove inconsistent +1 adjustments.
- [x] Add fixture coverage that validates `chunk_authors` population.


## Phase 59: YAML Chunking Fix + Configurable Top-Level Strategy (status: done)
Goal: Avoid overlapping YAML chunks and allow configurable sectioning defaults.
Work items:
- [x] Default YAML to a single root chunk to avoid overlap and incorrect ranges.
- [x] Add an optional config to enable top-level key chunking via line/indent scanning.
- [x] Ensure key scanning uses line offsets (no `indexOf` on values).
- [x] Add format-fidelity tests for YAML chunk boundaries and configurable strategy.


## Phase 60: External Docs URL Correctness (status: done)
Goal: Ensure scoped npm package links are correct.
Work items:
- [x] Preserve `@` in scoped package URLs and URL-encode path segments.
- [x] Add regression tests for npm scoped module URLs in external docs.


## Phase 61: ANN vs Sparse Scoring Selection (status: done)
Goal: Make ANN selection scale-safe by using sparse-first fallback and enable benchmarking of normalized blends.
Work items:
- [x] Change score selection to prefer sparse scores unless sparse is absent/weak.
- [x] Add optional normalized blend mode with tunable weights (disabled by default).
- [x] Add benchmark harness to compare sparse-only, ANN-fallback, and blend strategies.
- [x] Update score docs/tests to reflect selection logic and config knobs.


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


## Phase 66: Benchmark Runner Resilience (status: done)
Goal: Make benchmark runs robust against stale index locks and long-running builds.
Work items:
- [x] Detect stale index locks during benchmark builds and either wait/retry or clear safely.
- [x] Add an option for per-run cache roots (or per-repo lock namespaces) to avoid lock collisions.
- [x] Emit a clear failure summary when a benchmark build is skipped due to locks.
- [x] Add a regression test that simulates a stale lock during bench runs.
- [x] Document lock handling and recommended bench workflows.


## Phase 67: BUGFIX - Indexing Correctness + Performance (status: done)
Goal: Resolve critical indexing correctness bugs and high-impact performance regressions.
Work items:
- [x] Fix git blame ranges to use line numbers (not character offsets) and eliminate off-by-one adjustments; validate chunk authors are populated.
- [x] Ensure git metadata runs from the repo root (or uses `simpleGit({ baseDir })`) so `--repo` indexing works reliably.
- [x] Replace YAML `indexOf`-based chunking with line/indent boundaries to avoid overlap and negative offsets.
- [x] Stop dictionary splitting from devolving unknown spans into single-character tokens (preserve unknown spans).
- [x] Avoid unbounded memory growth during indexing by streaming results instead of retaining all file chunks in memory.
- [x] Skip `embed_doc` model calls when docstrings are empty to reduce embedding work on code-only chunks.
- [x] Reduce `splitWordsWithDict` worst-case cost (add a bounded fallback/DP path) to avoid O(n²) token splitting.
- [x] Make ANN vs sparse score selection scale-safe (normalize or sparse-first fallback).
- [x] Tighten filter semantics for `--type`/`--author` so missing metadata does not pass and multi-value types are handled.
- [x] Prevent exclude-only queries from triggering ANN embeddings that ignore exclusion semantics.
- [x] Avoid O(N) MinHash scanning without a candidate set; gate or reduce fallback cost.
- [x] Bound search summary caches (`fileTextCache`/`summaryCache`) to prevent unbounded growth in long-running processes.
- [x] Prevent SQLite incremental updates from growing doc ids unbounded (avoid sparse `chunkMeta` + vector arrays).
- [x] Avoid loading all SQLite chunks/vectors for FTS-only searches; stream or lazy-load where possible.
- [x] Clarify ANN fallback behavior when sqlite-vec is unavailable (avoid silent JS ANN mismatch per mode).
- [x] Fix tooling extension verification crash (missing `path` import in `tools/verify-extensions.js`).
- [x] Fix `--url name=url` parsing in download-dicts/download-extensions to split on the first `=` so URLs with query strings work.
- [x] Reduce tooling detection memory overhead by avoiding full `filePaths` accumulation just to detect workflow/config files.
- [x] Skip full repo scans in tooling detect/install when language/tool overrides are provided (avoid unnecessary I/O on large repos).
- [x] Honor `--no-ann` in benchmark runs (currently `tests/bench.js` always forces `--ann`).
- [x] Fix bench runner `runProcess` to resolve/reject on spawn errors (missing binaries currently hang the run).
- [x] Make bench runner process termination reliable on POSIX (spawn detached or kill child PID directly instead of `process.kill(-pid)` without a process group).
- [x] Remove `spawnSync` usage from API server handlers so concurrent HTTP requests don’t block the event loop (`/search` + `/status`).
- [x] Avoid unbounded stdout/stderr buffering in MCP tool runners; cap or stream output to prevent memory spikes during long index builds.
- [x] Replace the MCP server's inline JSON-RPC parser with the shared parser, add a size guard, and avoid Buffer.concat churn to prevent unbounded memory growth.
- [x] Ensure bootstrap/CI build scripts honor runtime Node options (max-old-space) so large repo indexing doesn’t ignore configured heap limits.
- [x] Update git hook installer to respect runtime Node options (or call `pairofcleats build-index`) so incremental hook runs don’t ignore heap config.
- [x] Ensure compare-models/combined-summary spawn child Node processes with runtime Node options from config (avoid OOM on large repos).
- [x] Ensure benchmark runners (`tests/bench.js`, `tools/bench-language-repos.js`) derive NODE_OPTIONS from the target repo config (not the tool repo), so max-old-space settings apply to large repo benches.
- [x] Avoid eager repo-size scans in cache GC when only age-based cleanup is requested; compute sizes lazily to reduce IO cost.
- [x] Fix triage ingest path resolution so `--in` is relative to `--repo` (not CWD) when a repo override is provided.
- [x] Ensure triage ingest/context-pack invoke search/build with runtime Node options (respect configured heap limits).
- [x] Remove or regenerate unused SQLite fixture artifacts (including WAL/SHM) to reduce repo bloat and avoid WAL mode confusion in tests.
- [x] Fix Lua chunker block termination to handle `end` lines with trailing comments (avoid unterminated decl blocks).
- [x] Expand SQL statement splitting to handle dollar-quoted strings / dialect delimiters (e.g., `$$`, `$tag$`, `DELIMITER`) so function/procedure bodies are not split mid-statement.
- [x] Update Python heuristic chunker to recognize `async def` when AST tooling is unavailable.
- [x] Fix BM25 document-frequency tracking to count unique tokens per chunk (current `df` increments per occurrence, inflating IDF).
- [x] Guard `buildPostings` against empty chunk sets (avoid reduce-on-empty crashes and handle missing embeddings gracefully).
- [x] Make context-window estimation resilient to unreadable/invalid-encoding sample files (skip failures instead of aborting indexing).
- [x] Fix triage record JSON sidecar lookup to respect nested directories (use the Markdown file’s directory, not the records root).


## Phase 68: Documentation Parity + Excellence (status: done)
Goal: Ensure all docs are accurate, complete, and easy to consume for users and maintainers.
Work items:
- [x] README: re-audit every command, feature, and default; remove outdated sections; add crisp, accurate feature inventory; ensure install/setup steps match current scripts and defaults.
- [x] README: add a concise “quickstart” and “first index” path; include CLI examples for build/search/bootstrap/setup; document SQLite default behavior and ANN fallback.
- [x] README: add link-out section for design docs (MCP, SQLite, parser backbone, benchmarks, triage); keep each link annotated with a one-sentence summary.
- [x] README: update cache layout section (collapsed) with current cache roots, repo cache layout, and artifact paths; ensure doc matches `getRepoCacheRoot` and sqlite split DBs.
- [x] README: update dictionary/model cache sections (collapsed) to match `download-dicts`, `download-models`, and repo dictionary behavior (default english wordlist).
- [x] README: update tooling section (collapsed) to document auto-install, cache-local installs, and manual tool links; include clangd/sourcekit-lsp requirements.
- [x] README: update testing section to be collapsible, grouped by “smoke”, “parity”, “bench”, “script-coverage”, and “full”; include the all-in-one test command.
- [x] README: update maintenance section (collapsed) with uninstall, clean-artifacts, cache-gc, index-validate; include safety notes.
- [x] docs/setup.md: align with `tools/setup.js` options (non-interactive/CI, heap configuration, skip flags, sqlite build flow).
- [x] docs/editor-integration.md: ensure VS Code extension instructions and CLI args match current config keys (searchBackend/searchAnn/extraSearchArgs).
- [x] docs/sqlite-*.md: ensure schema/version details, split DB layout, incremental/compaction paths, and ANN extension config match code.
- [x] docs/ast-feature-list.md + docs/language-fidelity.md: refresh coverage tables, mark tool-assisted type inference requirements, and note fallback behaviors.
- [x] docs/repometrics-dashboard.md: verify inputs/outputs and update examples to match metrics JSONL paths and fields.
- [x] docs/api-server.md + docs/mcp-server.md: verify endpoints, request/response payloads, streaming behavior, and build/search flags; add samples.
- [x] docs/config-schema.json: audit every documented config key against actual usage; add/adjust schema descriptions where missing.
- [x] docs/combined-summary.json / model-compare*.json: verify sample reports are current or regenerate with placeholder notes (no stale fields).
- [x] ROADMAP.md: ensure "historical" status and link to NEW_ROADMAP; remove stale roadmap items.


## Phase 69: Deps Fixes - JSON-RPC + LSP Protocol Dependencies (status: done)
Goal: Replace custom JSON-RPC framing with vetted libraries and standardize LSP protocol definitions.
Work items:
- [x] Add `vscode-jsonrpc` and update `src/shared/jsonrpc.js` to wrap StreamMessageReader/Writer instead of custom framing logic.
- [x] Replace JSON-RPC usage in `tools/mcp-server.js` with `vscode-jsonrpc` StreamMessageReader/Writer plumbing.
- [x] Update `src/integrations/tooling/lsp/client.js` to use `vscode-jsonrpc` streams and built-in request/notification plumbing.
- [x] Delete or archive any now-unused framing helpers and adjust imports where needed.
- [x] Add regression tests for JSON-RPC framing (split frames, large payloads) in MCP + LSP stub fixtures.
- [x] Add optional `vscode-languageserver-protocol` and wire constants/types into `src/integrations/tooling/lsp/symbols.js` and `src/integrations/tooling/lsp/positions.js`.
- [x] Document JSON-RPC/LSP dependency usage in MCP/LSP docs and troubleshooting notes.


## Phase 70: Deps Fixes - Concurrency, Caching, and IO Foundations (status: done)
Goal: Introduce best-in-class concurrency and cache primitives to reduce memory spikes and improve throughput.
Work items:
- [x] Add `p-queue` and replace `src/shared/concurrency.js` with a queue-backed API (IO queue + CPU queue).
- [x] Route file discovery, chunking, lint/complexity, embedding, and imports to use queue backpressure (update `src/index/build/indexer.js`, `src/index/build/imports.js`, `src/index/build/file-processor.js`).
- [x] Add `lru-cache` and replace ad-hoc Map caches: `complexityCache`, `lintCache`, `fileTextCache`, `summaryCache`, and `gitMetaCache`.
- [x] Add config knobs for cache size/TTL in `.pairofcleats.json` and `docs/config-schema.json`.
- [x] Add cache eviction tests to cover max size and TTL expiry behavior.
- [x] Add observability for cache hits/evictions in verbose logging.


## Phase 71: Deps Fixes - File Discovery + Watcher Modernization (status: done)
Goal: Speed up file enumeration and reduce redundant IO in indexing and watch mode.
Work items:
- [x] Add `fdir` and refactor `src/index/build/discover.js` to use it for non-git repos.
- [x] Add a `git ls-files -z` fast path for git repos; keep a fallback for non-git trees.
- [x] Reuse a single discovery pass for code + prose modes (avoid double traversal in `build_index.js`).
- [x] Avoid double `stat()` calls by returning `{ abs, rel, stat }` from discovery and reusing in `file-processor`.
- [x] Replace polling watch mode in `src/index/build/watch.js` with `chokidar` (respect ignore patterns and debounce config).
- [x] Add tests/fixtures for discovery reuse, git ls-files path, and watcher debounce behavior.


## Phase 72: Deps Fixes - JS/TS/Flow Parsing + Import Scanning (status: done)
Goal: Unify JS/TS/Flow parsing and speed up import graph extraction.
Work items:
- [x] Add `es-module-lexer` and `cjs-module-lexer` to accelerate import scanning in `src/index/build/imports.js`.
- [x] Use lexer output to build `allImports` without full AST parsing for JS/TS files.
- [x] Add `@babel/parser` and consolidate JS/TS/Flow parsing to a single codepath (replace `acorn`/`esprima` fallbacks).
- [x] Update `src/lang/javascript.js` and `src/lang/typescript.js` to share a unified Babel-based parser (Flow syntax handled via JS parser).
- [x] Add fixtures/tests for JSX/TSX/Flow syntax coverage and import extraction.
- [x] Evaluate whether `@typescript-eslint/typescript-estree` is needed for ESTree interop; document the decision.


## Phase 73: Deps Fixes - Streaming Artifacts + Worker Pool (status: done)
Goal: Reduce peak memory during artifact writing and move CPU-heavy tasks off the main thread.
Work items:
- [x] Add shared streaming JSON writers (`src/shared/json-stream.js`) and stream large artifact writes in `src/index/build/artifacts.js`.
- [x] Convert large arrays/maps (vectors, postings, ngrams, minhash) to streaming writers to avoid full `JSON.stringify`.
- [x] Add `piscina` and implement worker pool tasks for tokenization, ngrams, minhash, and quantization.
- [x] Add a worker protocol with fallback to sync paths when workers are unavailable.
- [x] Add tests for streaming artifact output and worker pool correctness (small fixtures).


## Phase 79: Deps Fixes - Performance Quick Wins (status: done)
Goal: Apply low-risk changes that cut indexing time and index size.
Work items:
- [x] Gate `.scannedfiles.json` and `.skippedfiles.json` behind `--debug` or config; store only counts + sample paths.
- [x] Reuse a single ESLint instance per build run; cache lint results for unchanged files.
- [x] Make `git blame` opt-in (or disable in benchmark profile) to avoid per-chunk blame by default.
- [x] Pre-split file lines once per file and reuse for `preContext`/`postContext` generation.
- [x] Deduplicate import lists in `scanImports` to avoid repeated file entries.
- [x] Add an LRU cap for `gitMetaCache` if not handled by Phase 70.
- [x] Reduce chunk metadata duplication by moving file-level data out of each chunk (even before full file_meta refactor).


## Phase 81: Deps Fixes - Benchmark Profiles + Knobs (status: done)
Goal: Make benchmarks measure core indexing without expensive enrichment by default.
Work items:
- [x] Add a "benchmark profile" config (or CLI flag) that disables git blame, lint, risk/type inference, and chargrams.
- [x] Update benchmark scripts to apply the profile automatically and record which knobs were disabled.
- [x] Document benchmark profiles and recommended settings for large repos.


## Phase 74: Deps Fixes - CLI + Process Execution Ergonomics (status: done)
Goal: Standardize CLI parsing and process handling using mature dependencies.
Work items:
- [x] Evaluate `yargs` vs `commander` and choose one for CLI help/arg consistency (document pros/cons).
- [x] Migrate CLI entrypoints to the chosen parser, preserving existing flags and exit codes.
- [x] Add `execa` and replace high-surface CLI wrappers (pairofcleats, triage, search-sqlite, bench-score-strategy, compare-models).
- [x] Evaluate `tree-kill` for cross-platform process tree termination; keep `taskkill`/`SIGTERM` to avoid Windows command-injection risk.
- [x] Replace remaining raw `spawn/spawnSync` in complex flows (bench-language, tooling-utils, MCP server, LSP detection).
- [x] Update CLI and process-related docs after migration.

## Completed Phase Details (migrated)

### Phase 57 details
- Update `src/shared/tokenize.js` `splitWordsWithDict` so no-match spans emit the remaining substring (or a bounded unknown span), not single characters.
- Ensure query parsing uses identical segmentation in `src/retrieval/query.js` (`tokenizeQueryTerms`, `tokenizePhrase`).
- Add a dict segmentation benchmark harness (e.g., `tools/bench-dict-seg.js`) to compare greedy vs DP segmentation on a fixed sample set; report token counts and coverage.
- Tests: extend `tests/tokenize-dictionary.js` to cover unknown spans and query tokenization.


### Phase 58 details
- Compute blame ranges using line numbers derived before `getGitMeta` in `src/index/build/file-processor.js`.
- Treat chunk end offsets as exclusive when deriving `endLine` (use `end - 1` with empty-chunk guard).
- Tests: add a fixture with a multi-line file and assert `chunk_authors` matches expected lines.


### Phase 59 details
- Default YAML to a single root chunk in `src/index/chunking.js` unless config enables top-level splitting.
- Add `indexing.yamlChunkStrategy` (values: `root` | `top-level`) and document in `docs/config-schema.json`.
- Implement top-level splitting with line/indent scanning (no `indexOf`).
- Tests: `tests/chunking-yaml.js` + `tests/format-fidelity.js` for boundary checks.


### Phase 60 details
- Update `buildExternalDocs` (in `src/index/build/file-processor.js`) to preserve `@` and `encodeURIComponent` scoped package paths.
- Add a regression test for scoped npm modules (fixture in `tests/fixtures/external-docs` + new test file).


### Phase 61 details
- Prefer sparse scores by default in `src/retrieval/pipeline.js` when BM25/FTS hits exist; ANN is fallback.
- Keep normalized blend mode behind `search.scoreBlend` config; document weights and normalization.
- Add a scoring comparison harness (e.g., `tools/bench-score-strategy.js`) that runs the same query set with `sparse`, `ann-fallback`, and `blend`.
- Tests: update `tests/search-explain.js` to reflect scoreType changes and blend breakdown.


### Phase 66 details
- In `tools/bench-language-repos.js`, detect existing lock files under `<repoCacheRoot>/locks/index.lock` and honor stale/active states.
- Add lock handling modes (wait/retry, stale-clear, fail-fast) and make the default configurable (default: fail-fast).
- Add a bench flag for per-run cache roots or lock namespaces to avoid collisions (document default behavior).
- Emit clear error summaries when builds are skipped due to locks (with lock age and pid if known).
- Tests: add a fixture that writes a stale lock and validates bench behavior (skip vs retry).


### Phase 68 details
- README: update feature list (indexing/search/dicts/models/sqlite) and remove deprecated sections; add design-doc links.
- README: add concise quickstart + "first index" path, plus consolidated "run all tests" command (exclude benchmarks by default).
- README: make sections collapsible (tests, maintenance, cache layout, design docs).
- Docs: sync `docs/setup.md`, `docs/editor-integration.md`, `docs/sqlite-*.md`, `docs/ast-feature-list.md`, `docs/language-fidelity.md`, `docs/repometrics-dashboard.md`, `docs/api-server.md`, `docs/mcp-server.md`.
- `docs/config-schema.json`: audit keys vs actual config usage and add missing descriptions.
- `ROADMAP.md`: ensure it links to `NEW_ROADMAP.md` and removes stale items.


### Phase 69 details
- Add `vscode-jsonrpc` and replace custom framing in `src/shared/jsonrpc.js` + `tools/mcp-server.js`.
- Update `src/integrations/tooling/lsp/client.js` to use `MessageReader/Writer` and request/notification helpers.
- Add `vscode-languageserver-protocol` for symbol/position constants and type safety.
- Add regression tests for split frames and large payload handling.


### Phase 70 details
- Replace `src/shared/concurrency.js` with `p-queue` (IO queue + CPU queue).
- Route file IO, chunking, lint/complexity, and embedding dispatch through queues.
- Replace ad-hoc caches with `lru-cache` (file text, lint/complexity, summary caches, git meta).
- Add config for cache limits and TTL with sensible defaults (fileText 64MB, summary 32MB, lint 16MB, complexity 16MB, gitMeta 16MB); add eviction tests.


### Phase 71 details
- Use `git ls-files -z` when available for file discovery; fallback to `fdir`.
- Reuse discovery results across code + prose; avoid double traversal.
- Return `{ abs, rel, stat }` from discovery to avoid double `stat()` calls.
- Replace watch polling with `chokidar`, with config-driven debounce and ignore rules.
- Tests for discovery reuse and watcher behavior.


### Phase 72 details
- Add `es-module-lexer` + `cjs-module-lexer` in `src/index/build/imports.js` to avoid full AST parse for imports.
- Consolidate JS/TS/Flow parsing in `src/lang/javascript.js`, `src/lang/typescript.js`, `src/lang/flow.js` using `@babel/parser`, keeping `acorn`/`esprima` fallbacks behind config for comparison.
- Add fixtures for JSX/TSX/Flow syntax and ensure import extraction is correct.


### Phase 73 details
- Use streaming JSON writers for large artifacts in `src/index/build/artifacts.js`.
- Add `piscina` worker pool for tokenization, ngrams, minhash, quantization (pure functions only).
- Provide fallback to sync path when workers unavailable; add tests for stream correctness.


### Phase 79 details
- Gate `.scannedfiles.json` / `.skippedfiles.json` behind a debug flag and store only counts + samples by default.
- Reuse a single ESLint instance per build and cache lint results for unchanged files.
- Make git blame opt-in or auto-disabled for benchmark profiles.
- Pre-split lines once per file for `preContext`/`postContext`.
- Deduplicate import lists in `scanImports`.
- Add an LRU cap for `gitMetaCache` if not handled by Phase 70.
- Reduce chunk metadata duplication before full file_meta refactor.


### Phase 81 details
- Add a benchmark profile config preset plus CLI flag to disable expensive enrichment by default.
- Record which knobs were disabled in benchmark summaries.
- Document recommended benchmark settings for large repos.


### Phase 78 details
- Remove dead `posts` allocation in `src/index/build/postings.js`.
- Remove the trimmed-vocab path to avoid misleading `maxVocab` behavior.
- Keep doc/code dense vector artifacts and make selection configurable via `search.denseVectorMode`.
- Fix dense vector `scale` metadata to match quantization step and use it in ranking.
- Skip `scanImports()` for prose mode and add a regression test.
- Separate file-level relations into `file_relations.json` and strip them from chunk metadata.
- Pre-index call/callDetails per file to avoid O(chunks * calls) scanning.
- Validate blame line ranges and add coverage for start/end line expectations.
- Document `importLinks` semantics and add a dedicated import-links test.
- Update ESLint init to handle newer API options with a fallback warning.


### Phase 77 details
- Remove unused dependencies (`minhash`, `seedrandom`, `strip-comments`, `varint`, `yaml`).
- Keep Babel as primary JS parser with existing fallbacks for comparison.


### Phase 76 details
- Added a native tree-sitter registry with cached parsers and per-language config.
- Enabled tree-sitter chunking for Swift, Kotlin, C#, C/C++/ObjC, Go, Rust, and Java.
- Preserved heuristic chunkers as fallback when tree-sitter is unavailable or fails.
- Added config switches for tree-sitter languages and defaults in runtime/config schema.
- Added fixtures and a tree-sitter chunk test with graceful skip when unavailable.


### Phase 75 details
- Expanded tooling registry with TypeScript language server, Kotlin LSP, Ruby LSP, C# Roslyn LSP, Intelephense, and bash-language-server entries.
- Added tooling allow/deny lists for installs and detection via `tooling.enabledTools` and `tooling.disabledTools`.
- Added node-sql-parser integration for SQL table usage extraction.
- Updated docs with tooling target list and tooling config toggles.


### Phase 80 details
- Batch git blame per file with porcelain output and compute chunk authors by line range.
- Batch embeddings per file or per N chunks; normalize once per batch.
- Add compressed artifact variants for large arrays (gzip) and keep JSON streaming.
- Split file-level metadata into `file_meta.json` and reference by file id in chunks.
- Persist per-file imports in incremental bundles and rebuild `allImports` without rereading all files.
- Avoid redundant discovery + stat passes for code/prose.
- Drop per-chunk `tokens`/`ngrams` storage via compact modes for large repos.
- Default SQLite storage for postings/vectors; keep file-backed artifacts for fallback and gzip-compress large arrays.


### Phase 82 details
- Enabled file filter chargram prefiltering for substring/regex queries even when case-sensitive file matching is requested.
- Added safe regex prefiltering that extracts literals for candidate pruning while always verifying exact matches.
- Ensured punctuation tokens remain first-class for code search by adding FTS fallback to BM25 when needed.
- Added coverage for regex file filters and punctuation queries.
- Documented search prefilter behavior and limits in `docs/search.md`.


### Phase 83 details
- Verified query filters (file/path, lang, branch, case) run via filter index or early branch checks for low overhead.
- Kept symbol-aware ranking boosts for definitions/exports with coverage in `tests/search-symbol-boost.js`.
- Emitted compact `repo_map.json` artifacts with symbols, signatures, and file paths for navigation.
- Added repo map coverage to fixture smoke tests.

## Roadmap and Deps Fixes Cleanup (status: done)
- Confirmed `deps_fixes.md` items are fully implemented via Phases 75-83 details.
- Archived historical `ROADMAP.md` into completed records and removed the file.

## Phase 1: Profiles + Global Defaults (status: done)
- [x] Added `profiles/lite.json`, `profiles/balanced.json`, `profiles/full.json` with indexing/search sections.
- [x] Added top-level `profile` key support and CLI `--profile` override.
- [x] Applied profiles across CLI, API/MCP servers, and bench tooling.
- [x] Documented profile semantics and precedence.
- [x] Added validation for missing/invalid profiles.

## Phase 2: Backend Auto-Policy (status: done)
- [x] Implemented backend policy module for SQLite vs memory selection.
- [x] Supported `auto` backend selection with explain output.
- [x] Added profile/config thresholds for auto-policy decisions.
- [x] Documented defaults and override points.

## Phase 3: Parser Hierarchy + Tooling Resolution (status: done)
- [x] Enforced parser precedence (AST > tree-sitter > heuristics).
- [x] Resolved TypeScript tooling from repo-local `node_modules` when available.
- [x] Documented parser selection and fallback order.
- [x] Added tests for parser selection and fallback paths.

## Phase 4: Tokenization + Postings Guardrails (status: done)
- [x] Applied dictionary segmentation auto (DP with max-length guard, greedy fallback).
- [x] Added adaptive DP max length based on repo file counts (configurable).
- [x] Added chargram guardrails (token length cap + high-signal field sources).
- [x] Added tests for adaptive segmentation and chargram caps.

## Phase 5: Core Library API (status: done)
- [x] Added core API for build/search/status/sqlite index.
- [x] Refactored CLI entrypoints to call the core API.
- [x] Added core API documentation and tests.

## Phase 6: In-Process API + MCP Servers (status: done)
- [x] API server calls core search/status with shared caches.
- [x] MCP server calls core build/search/status with shared caches.
- [x] Added cache invalidation for file-backed indexes and SQLite DBs.
- [x] Added cache tests for in-process index reuse.

## Phase 7: Retrieval Strategy Defaults + RRF (status: done)
- [x] Added RRF scoring for sparse + dense lists with explain output.
- [x] Ensured BM25 defaults are sourced from index-time metrics when available.
- [x] Kept FTS5 labeled as alternate sparse source in explain output.
- [x] Added RRF documentation and tests.

## Phase 8: IR Evaluation Harness + Quality Gates (status: done)
- [x] Added `tools/eval/run.js` with Recall@k, MRR, and nDCG@k JSON output.     
- [x] Added a labeled sample dataset with silver/gold examples.
- [x] Added CI quality thresholds via `tests/eval-quality.js`.
- [x] Documented evaluation workflow in `docs/eval.md`.

## Phase 9: Fielded Indexing (status: done)
- [x] Stored field-specific token streams (`name`, `signature`, `doc`, `body`) and persisted `field_tokens.json`.
- [x] Built fielded postings artifacts (`field_postings.json`) with per-field vocab, postings, and doc length stats.
- [x] Added fielded BM25 scoring with configurable `search.fieldWeights` and query-cache keying.
- [x] Expanded SQLite FTS schema to include `signature` and `doc` columns and updated builds/compaction.
- [x] Added fielded BM25 tests and script coverage entries.
- [x] Updated search/config docs and SQLite schema documentation.

## Phase 10: Large-Artifact Strategy (status: done)
- [x] Added JSONL chunk metadata and sharded token postings formats for large artifacts.
- [x] Wired loaders/validators to accept mixed formats (json/jsonl/shards) with cache signatures and status checks.
- [x] Added artifact format config in schema and documented large artifact handling.
- [x] Added artifact format test coverage and ensured index size checks include shards.

## Phase 11: Query Intent Classification (status: done)
- [x] Added query intent classifier (code/prose/path/mixed) with explain details.
- [x] Applied intent to `denseVectorMode=auto` selection and default field weights.
- [x] Added query intent unit tests and documentation updates.

## Phase 12: Graph-Aware Context Expansion (status: done)
- [x] Added context expansion pipeline using call/import/usage relations plus repo map lookup.
- [x] Appended labeled context hits (`scoreType: "context"`, `context.sourceId`, `context.reason`) to result lists.
- [x] Added config knobs for limits and relation toggles (`search.contextExpansion.*`).
- [x] Added context expansion tests and documentation updates.

## Phase 13: Structural Search Integration (status: done)
- [x] Refactored structural search CLI into reusable modules under `src/experimental/structural/`.
- [x] Loaded structural matches from repo cache and attached them to chunk `docmeta.structural`.
- [x] Added search filters `--struct-pack`, `--struct-rule`, `--struct-tag`.
- [x] Added tests for structural match ingestion and filtering.

## Phase 14: Build-Time Filter Index Artifact (status: done)
- [x] Built and persisted `filter_index.json` during indexing using configured chargram size.
- [x] Hydrated filter index in search to avoid rebuilding maps/sets at query time.
- [x] Added filter index artifact test coverage and updated index validation to report it.

## Phase 15: Command Surface Simplification (status: done)
- [x] Promoted `pairofcleats` CLI as the primary command surface, with npm scripts as wrappers.
- [x] Added missing CLI commands for ingest, structural search, eval harness, benchmarks, and index validation.
- [x] Updated README and docs to reflect the simplified command surface and new command catalog.


## Phase 16: Module Boundaries + Experimental Isolation (status: done)
Goal: Make the system easier to reason about and extend.
Work items:
- [x] Restructure into `src/index/`, `src/retrieval/`, `src/storage/`, `src/integrations/`.
- [x] Move experimental features under `src/experimental/` and gate behind `profile=full`.
- [x] Update imports/tests/docs for new module boundaries.


## Phase 17: Benchmarks and Performance Methodology (status: done)
Goal: Standardize performance evaluation.
Work items:
- [x] Add microbench suite under `tools/bench/micro/` with p50/p95 reporting.
- [x] Add component benchmarks (index build without embeddings, dense-only, sparse-only, hybrid).
- [x] Add warm/cold run definitions and reporting.
- [x] Document benchmark methodology and expected runtime.

## Phase 33: Script Consolidation Pass (status: done)
- [x] Removed redundant wrappers (`tools/mergeSearchHistory.js`, `tools/mergeNoResultQueries.js`, `tools/search-sqlite.js`, `tools/bench-compare-models.js`).
- [x] Standardized merge tooling on `tools/mergeAppendOnly.js` and updated shell merge drivers.
- [x] Trimmed npm scripts to remove redundant wrappers and added `merge-append`.
- [x] Updated script coverage to cover the consolidated entrypoints.

## Phase 34: Bench Harness Consolidation (status: done)
- [x] Removed bench-language npm script variants and kept the core runners (`bench-language`, `bench-language:matrix`).
- [x] Dropped CLI bench-language wrapper commands for build/typical/large presets.
- [x] Kept `tests/bench.js` as the benchmark runner invoked by the language harness.
- [x] Validated bench args in `tools/bench-language-matrix.js`.

## Phase 35: Config/CLI Docs Alignment (status: done)
- [x] Updated `docs/commands.md` and `README.md` to the new CLI tree with migration notes.
- [x] Updated benchmark docs to use `pairofcleats bench` subcommands.
- [x] Updated triage and SQLite incremental docs to use `pairofcleats index build`.

## Phase 36: Remove Dead/Legacy Options (status: done)
- [x] Removed `--benchmark-profile`/`--no-benchmark-profile` and `PAIROFCLEATS_BENCH_PROFILE` (bench profiles removed).
- [x] Dropped `indexing.benchmarkProfile` from the config schema and inventory.
- [x] Updated benchmark tooling to use standard profiles and honor `--no-index-profile`.
- [x] Updated coverage to remove benchmark profile tests.

## Phase 37: Config Access + Control Refinement (status: done)
- [x] Centralized config merge helpers in `src/shared/config.js` and reused them in `tools/dict-utils.js` and `src/index/build/runtime.js`.
- [x] Added bench CLI conflict validation for mutually exclusive overrides.

## Phase 38: Benchmark Output Tagging + Update Model (status: done)
- [x] Added tag-aware log window updates so repeated `[tag]` lines replace in-place.
- [x] Kept log files/history intact while reducing interactive scrollback noise.

## Phase 39: Benchmark Progress Line Format (status: done)
- [x] Switched file progress output to `[shard ...]` prefixes with stable separators.
- [x] Added a shared formatter and tests to validate the new progress format.

## Phase 40: Benchmark Scrollback Noise Reduction (status: done)
- [x] Added debounced log-window updates to reduce high-frequency progress churn.
- [x] Added per-line tag tracking for in-place updates without log spam.
- [x] Documented the updated benchmark output behavior.

## Phase 41: Shard Policy: Min Files + Huge File Exception (status: done)
- [x] Enforced subdir min-files with a huge-file exception for tiny groups.
- [x] Switched shard size calculations to line counts when available.
- [x] Added shard planning coverage for subdir merges and huge file handling.

## Phase 42: Huge File Definition via Shard Census (status: done)
- [x] Defined huge files as >= 0.5 * 10th-largest shard (by lines).
- [x] Wired the rule into shard planning with line-count input.
- [x] Documented the heuristic in benchmark/sharding notes.

## Phase 43: Shard Census-Guided Splitting (status: done)
- [x] Split oversized shards based on the shard census line spread.
- [x] Kept shard IDs stable across splits by labeling with part indices.
- [x] Updated shard-census to use shared line counting and pass line totals.

## Phase 44: Shard Planner Heuristics Rebalance (status: done)
- [x] Reduced over-sharding by merging tiny subdir shards into parents.
- [x] Preserved large shards for parallelism with line-aware splits.
- [x] Added regression coverage for rebalanced shard planning.

## Phase 45: Shard Split-by-Size Algorithm (status: done)
- [x] Implemented deterministic split-by-lines using cumulative thresholds.
- [x] Preserved directory affinity with stable split labels and IDs.
- [x] Added tests for split sizing and repeatability.

## Phase 46: Shard Plan Output + Diagnostics (status: done)
- [x] Added verbose shard plan summaries (top shards + split stats).
- [x] Surfaced shard line counts in manifest summaries for diagnostics.
- [x] Documented diagnostics usage in benchmark notes.

## Phase 47: Index Build Stage 0 (Preprocess) (status: done)
- [x] Centralized discovery with minified/binary scanning and line-count collection.
- [x] Persisted preprocess stats to `preprocess.json` under the repo cache root.
- [x] Added validation for preprocess outputs and coverage for preprocessing behavior.

## Phase 48: Index Build Stage 1 (Sparse Pass) (status: done)
- [x] Skipped import/relations work during `stage1` to keep sparse builds lightweight.
- [x] Preserved searchable sparse artifacts by leaving tokenization/postings in stage1.
- [x] Extended two-stage tests to assert stage1 relation artifacts are deferred.

## Phase 49: Index Build Stage 2 (Relations Pass) (status: done)
- [x] Deferred import/relations work to stage2 and validated artifacts only appear after enrichment.
- [x] Extended import caching to fall back to file-hash validation for unchanged files.
- [x] Preserved incremental bundle updates for relations via existing artifact writes.

## Phase 50: Index Build Stage 3 (Embeddings Pass) (status: done)
- [x] Added `stage3` normalization with an explicit embeddings pass in `build_index` (inline or service queue).
- [x] Reused the embeddings cache keyed by file hash via `tools/build-embeddings.js`.
- [x] Added stage3 coverage to confirm embeddings readiness and dense vector artifacts.

## Phase 51: Index Build Stage 4 (SQLite/ANN Pass) (status: done)
- [x] Added `stage4` normalization with a dedicated SQLite/ANN pass through `build_index`.
- [x] Reused the existing WAL + batch SQLite build pipeline for staged artifacts.
- [x] Updated SQLite build test coverage to exercise the stage4 pass.

## Phase 52: Bundle Format v2 (Piece-Based) (status: done)
- [x] Defined piece categories for chunks, postings, relations, embeddings, and stats.
- [x] Wrote piece manifests at stage completion and refreshed embeddings pieces during stage3.
- [x] Added checksummed `pieces/manifest.json` outputs and validation coverage.

## Phase 53: Piece Assembly + Merge (status: done)
- [x] Added a piece assembly pipeline to merge chunk/postings artifacts with doc_id offsets.
- [x] Shipped `tools/assemble-pieces.js` and coverage for assembling multi-index piece sets.
- [x] Added count integrity checks in index validation (chunks vs docLengths/embeddings/minhash/field tokens).

## Phase 54: SQLite Build from Pieces (status: done)
- [x] Streamed chunk metadata from jsonl parts and sharded pieces during SQLite builds.
- [x] Added sharded token_postings ingestion with docLengths + stats from meta.
- [x] Extended sqlite build test to force piece artifacts and validate piece-only indexes.

## Phase 55: Memory Index from Pieces (status: done)
- [x] Prefer chunk_meta parts and token_postings shards over monolithic JSON loads.
- [x] Added piece-level caching for jsonl parts and shard reads in artifact loading.
- [x] Extended artifact format tests to confirm piece preference over legacy JSON.

## Phase 56: Piece-Level Compaction + Cleanup (status: done)
- [x] Added `tools/compact-pieces.js` to consolidate chunk_meta parts and token_postings shards.
- [x] Update piece manifests with refreshed checksums and a compaction audit log.
- [x] Added compact pieces coverage for shard consolidation behavior.

## Phase 57: Worker Pool Unification (status: done)
Goal: Centralize worker pool config for shards, tokenization, and bundle parsing.
Work items:
- [x] Provide a single worker pool config source and shared thread limits.
- [x] Respect Windows thread limits and override rules in sqlite bundle parsing.
- [x] Add diagnostics for thread allocation.

## Phase 58: I/O Batching + Fsync Policy (status: done)
Goal: Reduce disk overhead in all stages.
Work items:
- [x] Batch artifact writes with bounded concurrency.
- [x] Ensure crash safety via atomic file writes for index artifacts.
- [x] Apply atomic write handling for compaction and embeddings outputs.

## Phase 59: Tokenization + Minhash Optimization (status: done)
Goal: Reduce CPU and GC overhead in hot loops.
Work items:
- [x] Reuse minhash and chargram buffers during tokenization.
- [x] Reduce allocation hot spots in token stats and chargram loops.
- [x] Add buffering regression tests.

## Phase 60: Posting Build Optimization (status: done)
Goal: Reduce memory and time for postings construction.
Work items:
- [x] Quantize embeddings in batches without staging full arrays.
- [x] Keep postings output unchanged while lowering peak memory.
- [x] Add postings quantization test coverage.

## Phase 61: Embedding Batch Tuning by Language (status: done)
Goal: Maximize throughput per language while keeping memory stable.
Work items:
- [x] Add per-language embedding batch multipliers.
- [x] Wire batch multipliers into embedding batching.
- [x] Update schema/docs and add tests.

## Phase 62: TypeScript Fast Path (Imports-Only) (status: done)
Goal: Skip expensive parsing where possible and prioritize imports.
Work items:
- [x] Skip Babel parsing when imports-only is enabled.
- [x] Use heuristic chunking for imports-only TypeScript.
- [x] Add imports-only tests.

## Phase 63: Import Priority Reordering (status: done)
Goal: Process most import-heavy files first.
Work items:
- [x] Sort import scans by cached import counts then size.
- [x] Add deterministic ordering helper and tests.

## Phase 64: Generated Artifact Skip List (status: done)
Goal: Avoid known build outputs at the source.
Work items:
- [x] Expand default ignore list for generated dirs and bundles.
- [x] Document allow/deny overrides via extraIgnore negation.
- [x] Add ignore override test coverage.

## Phase 65: Build Progress Instrumentation (status: done)
Goal: Provide stable, parseable progress for all stages.
Work items:
- [x] Clear progress lines before logging to avoid merged output.
- [x] Include shard tags and line counts in file progress lines.
- [x] Align bench parsing with updated file progress format.

## Phase 66: Benchmark Output Consistency (status: done)
Goal: Align bench output with new stage/queue behaviors.
Work items:
- [x] Keep shard/file progress formatting stable.
- [x] Add bench progress formatting test coverage.

## Phase 67: Cache Signature Accuracy (status: done)
Goal: Ensure cache reuse is safe and deterministic.
Work items:
- [x] Add cache signatures to incremental manifests and validation.
- [x] Invalidate cache on parser/toolchain config changes.
- [x] Add cache signature invalidation tests.

## Phase 68: Index Rebuild Detection (status: done)
Goal: Reduce full rebuilds when partials are valid.
Work items:
- [x] Detect stage completeness and reuse when unchanged.
- [x] Require pieces + index_state before reuse.
- [x] Add reuse validation test coverage.

## Phase 69: Service Mode Queue Refinement (status: done)
Goal: Make stage queues reliable and performant.
Work items:
- [x] Add queue retries/attempt tracking and failure summaries.
- [x] Support stage/mode queue naming with auto resolution.
- [x] Emit worker metrics per batch.

## Phase 70: Windows Worker Stability (status: done)
Goal: Maximize parallelism on Windows without crashes.
Work items:
- [x] Validate CPU*2 concurrency behavior.
- [x] Add thread limit test coverage.

## Phase 71: SQLite Incremental Upgrade Path (status: done)
Goal: Keep incremental updates fast and reliable.
Work items:
- [x] Normalize manifest paths and guard against empty/conflicting manifests.
- [x] Add change-ratio and vocab-growth heuristics to trigger full rebuilds.
- [x] Document new rebuild conditions and extend incremental tests.

## Phase 72: SQLite Build Validation (status: done)
Goal: Ensure SQLite rebuild correctness.
Work items:
- [x] Add post-build integrity checks with smoke/full validation modes.
- [x] Compare chunk/doc/embedding counts between sources and SQLite.
- [x] Wire smoke validation into incremental tests and CLI docs.

## Phase 73: Shard Merge Efficiency (status: done)
Goal: Reduce merge overhead when combining shard outputs.
Work items:
- [x] Stream shard merges by loading and merging one shard at a time.
- [x] Reuse per-shard postings arrays to avoid extra vocab allocations.
- [x] Extend piece assembly tests with docId range validation.

## Phase 74: Artifact Size Guardrails (status: done)
Goal: Prevent oversize artifacts from breaking loads.
Work items:
- [x] Enforce MAX_JSON_BYTES estimates for chunk_meta and token_postings outputs.
- [x] Auto-switch to jsonl/sharded formats when estimates exceed limits.
- [x] Add size guardrails test and env override documentation.

## Phase 19: Performance-First Input Filtering + Caps (status: done)
Goal: Reduce indexing I/O and memory by skipping build outputs, minified files, and binaries while enforcing per-language size/line caps.
Work items:
- [x] Expand default skip lists and config-driven ignore patterns for build/output dirs (add to `src/index/constants.js`, `src/index/build/ignore.js`), with explicit docs/config schema updates.
  - [x] Add minified detection (filename heuristics + line length/ratio checks) and record skip reasons in `src/index/build/discover.js` or `src/index/build/file-processor.js`.
  - [x] Add binary detection (null-byte/high non-text ratio sampling) before read/parse to skip large binaries quickly.
  - [x] Verify per-language `maxBytes`/`maxLines` caps exist; if missing, add to `src/index/build/runtime.js` + `docs/config-schema.json`.
  - [x] Add regression tests for skip reasons and per-language caps (new/updated tests under `tests/`).
Notes:
- Performance is the top priority: optimize for fast reject paths and low per-file overhead.

## Phase 20: Aggressive Embedding Batching + Auto-Tuning (status: done)
Goal: Maximize embedding throughput while keeping memory stable on large repos.
Work items:
- [x] Add an auto-tuned batch size based on model dims + available memory (`indexing.embeddingBatchSize`, `src/index/build/runtime.js`).
- [x] Batch embeddings with adaptive sizing and throughput logging in `src/index/build/file-processor.js`.
- [x] Ensure batching cooperates with worker pool/thread limits (avoid oversubscription on Windows).
- [x] Add config schema + docs for new batching controls.
- [x] Add benchmarks/tests to validate speed gains without OOM.
Notes:
- Favor larger batches for performance; fall back safely when memory pressure is detected.

## Phase 21: Tokenization/Minhash Cache by File Hash (status: done)
Goal: Skip tokenization and minhash for unchanged files using incremental bundles keyed by content hash.
Work items:
- [x] Extend incremental bundle metadata to persist tokenization/minhash outputs (and version tags) in `src/index/build/incremental.js`.
- [x] Use file hash (content) to decide reuse in `src/index/build/file-processor.js`, skipping tokenization/minhash when unchanged.
- [x] Add invalidation rules when tokenization config changes (segmentation, chargrams, phrase n-grams).
- [x] Add tests for cache reuse and invalidation.
Notes:
- Keep hash computation cheap and avoid full-text reads when size/mtime already match.

## Phase 22: SQLite Bulk Build Optimization (status: done)
Goal: Improve SQLite build throughput with larger transactions and reduced fsyncs during build.
Work items:
- [x] Use WAL + `synchronous=OFF` during bulk build in `tools/build-sqlite-index.js`, then normalize to `synchronous=NORMAL` after.
- [x] Batch inserts with larger transactions and delay index creation until after bulk inserts.
- [x] Tune `temp_store`, `cache_size`, and `mmap_size` for build time, then reset to safe defaults.
- [x] Add safety checks/rollback on failure to avoid partial DB corruption.
- [x] Add performance regression tests or benchmarks for build time.
Notes:
- Optimize for speed during build; ensure final DB is consistent and portable.

## Phase 23: Two-Stage Indexing with Immediate Searchability (status: done)
Goal: Produce a fast sparse index first (searchable immediately), then enrich in the background.
Work items:
- [x] Stage 1: build tokens/postings + minimal metadata; skip tree-sitter, risk, lint, embeddings (`build_index.js`, `src/index/build/indexer.js`).
- [x] Stage 2: background enrichment pipeline for tree-sitter/risk/lint/embeddings with partial artifact updates.
- [x] Add artifact readiness flags so search uses the best available data and knows which enrichments are pending.
- [x] Add queueing for background enrichment with resumable state.
- [x] Add tests for immediate search correctness and staged enrichment.
Notes:
- Performance first: stage 1 should be dramatically faster on large repos.

## Phase 24: Streaming Tokenization + GC Reduction (status: done)
Goal: Reduce allocation/GC overhead in tokenization and chunk processing.
Work items:
- [x] Refactor tokenization to stream per file and reuse buffers (`src/index/build/tokenization.js`, `src/index/build/file-processor.js`).
- [x] Avoid repeated string/array allocations in hot loops (chargrams/minhash).
- [x] Add lightweight metrics for allocations/GC pressure in verbose mode.
- [x] Add targeted tests for token correctness and performance.
Notes:
- Tight inner loops and fewer allocations are key to large-repo performance.

## Phase 25: Sharded Indexing + Merge (dir -> language) (status: done)
Goal: Split indexing into shards for parallelism and lower peak memory, then merge deterministically.
Work items:
- [x] Build a shard planner that groups by top-level directory, then by language (configurable).
- [x] Implement per-shard index builds with a global concurrency cap and per-shard limits (Windows-safe defaults; e.g., 1 worker per dir/lang, max total threads).
- [x] Implement deterministic merge for postings/vocab/minhash/embeddings and resolve doc_id offsets (`src/index/build/artifacts.js` + new merge helper).
- [x] Add shard-aware incremental updates and shard cache invalidation.
- [x] Add tests for merge correctness + Windows multi-worker stability.
Notes:
- Concurrency must be bounded globally on Windows to avoid worker instability.

## Phase 26: Embedding Service Extension + Separate Queue (status: done)
Goal: Decouple embeddings from indexing via an indexer-service extension with its own queue + vector cache.
Work items:
- [x] Add an embedding queue under service mode (`tools/indexer-service.js` or new service module) with durable cache state.
- [x] Implement embedding workers that fetch tasks, compute vectors, and write cached outputs keyed by file hash.
- [x] Integrate indexer to enqueue embedding tasks and ingest results asynchronously.
- [x] Add config for worker concurrency, memory caps, and Windows-safe limits.
- [x] Add tests for queue behavior, cache hits, and failure recovery.
Notes:
- Keep indexing unblocked; embeddings should not slow core build throughput.
