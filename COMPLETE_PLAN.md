# Complete Plan

This document consolidates all phase docs and tracks implementation status. Phase markdown files are removed after merge; this is the single source of truth.
Completed phases live in `COMPLETED_PHASES.md` at the repo root. When a phase is marked done, move it there; that file is long, so scan in small chunks or append new completed phases to the end.

## Status key
- done: implemented and validated
- partial: implemented with known gaps or follow-ups
- todo: not implemented
- in-progress: actively being implemented


## Deferred / Do Not Surface (status: deferred)
- [ ] Evaluate FTS5 vs BM25 parity on larger benchmarks and retune weights.     
  - Do not prioritize or bring this up unless explicitly requested.


## Phase 74: Deps Fixes - CLI + Process Execution Ergonomics (status: partial)
Goal: Standardize CLI parsing and process handling using mature dependencies.
Work items:
- [x] Evaluate `yargs` vs `commander` and choose one for CLI help/arg consistency (document pros/cons).
- [x] Migrate CLI entrypoints to the chosen parser, preserving existing flags and exit codes.
- [x] Add `execa` and replace high-surface CLI wrappers (pairofcleats, triage, search-sqlite, bench-score-strategy, compare-models).
- [ ] Evaluate `tree-kill` for cross-platform process tree termination; adopt only if safe on Windows.
- [ ] Replace remaining raw `spawn/spawnSync` in complex flows (bench-language, tooling-utils, MCP server, LSP detection) where error handling/streaming is critical.
- [ ] Update CLI and process-related docs after migration.


## Phase 75: Deps Fixes - Language Tooling Alignment (status: todo)
Goal: Align LSP and parsing tools with current best-of-breed per language.
Work items:
- [ ] JavaScript/TypeScript: keep compiler API; add lexer pre-pass for imports; document `typescript-language-server` as optional.
- [ ] Flow: fold into Babel-based JS/TS parsing path; remove standalone Flow parser if redundant.
- [ ] C/C++/ObjC: keep clangd; add detection docs and optional tree-sitter fallback for macro-heavy files.
- [ ] Swift: keep sourcekit-lsp; document tree-sitter-swift fallback for chunking.
- [ ] Go: keep gopls; add optional tree-sitter-go chunking path.
- [ ] Rust: keep rust-analyzer; add optional tree-sitter-rust chunking path.
- [ ] Java: keep jdtls; add optional tree-sitter-java chunking path.
- [ ] Kotlin: keep kotlin-language-server; add optional Kotlin official LSP when detected.
- [ ] C#: keep OmniSharp; add optional Roslyn LSP provider with config switch.
- [ ] Ruby: add Ruby LSP as preferred tool, Solargraph fallback; update tooling registry and docs.
- [ ] PHP: add php-parser for AST chunking; add optional Intelephense LSP alongside Phpactor.
- [ ] Lua: keep LuaLS; ensure detection/install docs are current.
- [ ] SQL: keep sqls best-effort; add `node-sql-parser` for schema/table extraction.
- [ ] Shell: add bash-language-server detection and docs; optional tree-sitter-bash fallback.
- [ ] Perl: evaluate tree-sitter-perl; decide on heuristic-only vs optional LSP.
- [ ] Add detection, install instructions, and config toggles for all new tools in `tools/tooling-utils.js` and docs.


## Phase 76: Deps Fixes - Tree-sitter Backbone (status: todo)
Goal: Introduce a unified tree-sitter parsing backbone with safe fallbacks.
Work items:
- [ ] Choose `tree-sitter` (native) vs `web-tree-sitter` (WASM) and document tradeoffs.
- [ ] Add a centralized parser registry that loads grammars per language.
- [ ] Implement tree-sitter chunking for Swift, Kotlin, C#, C/C++, ObjC as first targets.
- [ ] Add tree-sitter chunking for Go/Rust/Java if grammars are stable.
- [ ] Keep existing heuristic chunkers as fallback when tree-sitter fails or is unavailable.
- [ ] Add fixtures and tests for tree-sitter chunk boundaries and symbol extraction.
- [ ] Add config switches to enable/disable tree-sitter per language.


## Phase 77: Deps Fixes - Dependency Hygiene (status: todo)
Goal: Remove unused packages and consolidate redundant parsing stacks.
Work items:
- [ ] Audit usage of `minhash` (npm), `varint`, `seedrandom`, `yaml`, `strip-comments`; remove if unused.
- [ ] Consolidate JS parsing dependencies (prefer Babel) and remove redundant `acorn`/`esprima` paths if safe.
- [ ] Update `package.json`, lockfile, and docs to reflect dependency removals.
- [ ] Add a small dependency audit test to ensure removed packages are not referenced.


## Phase 78: Deps Fixes - Correctness and Spec Mismatches (status: todo)
Goal: Resolve correctness bugs and spec mismatches highlighted in deps_fixes.md.
Work items:
- [ ] Remove dead `posts` computation in `src/indexer/build/postings.js`; add a test asserting no unused allocations.
- [ ] Either implement a real `maxVocab` cap or remove the trimmed-vocab path to avoid misleading behavior.
- [ ] Decide whether to use `dense_vectors_doc_uint8.json`/`dense_vectors_code_uint8.json`; wire into ranking or stop writing/loading them.
- [ ] Fix dense vector `scale` metadata to match quantization step size (or remove field).
- [ ] Skip `scanImports()` for prose mode and add a regression test ensuring no import scan runs.
- [ ] Fix per-chunk relation duplication by separating file-level vs chunk-level relations (avoid copying full file relations into every chunk).
- [ ] Rework `buildChunkRelations` to avoid O(chunks * calls) scanning (pre-index call maps per file).
- [ ] Validate `git blame` line range off-by-one when chunk end offsets are exclusive; adjust `endLine` calculation as needed and add tests.
- [ ] Clarify and document `importLinks` semantics; add tests that verify intended behavior.
- [ ] Review ESLint API usage (`useEslintrc` options) and update for current ESLint version with a fallback warning.


## Phase 80: Deps Fixes - Performance Refactors (status: todo)
Goal: Tackle structural bottlenecks that dominate large-repo indexing.
Work items:
- [ ] Replace per-chunk git blame calls with one blame per file (line-porcelain), then derive chunk authors by line range.
- [ ] Batch embeddings per file or per N chunks and normalize merged vectors once per batch.
- [ ] Stream or switch artifact formats away from huge JSON arrays (JSONL/binary/compressed variants).
- [ ] Split file-level metadata into `file_meta.json` and reference by file id in `chunk_meta.json`.
- [ ] Add an incremental import graph cache and rebuild `allImports` from cached per-file imports.
- [ ] Use one discovery pass for code+prose and avoid redundant directory walks.
- [ ] Eliminate double stat calls by reusing discovery stats in `processFile`.
- [ ] Optimize import scanning to avoid full `text.normalize('NFKD')` on every file.
- [ ] Remove per-chunk `tokens` storage or replace with a compact representation when postings are available.
- [ ] Move large numeric arrays (postings/vectors) to binary or SQLite-backed storage for large repos.
- [ ] Compress postings (varint/delta) and build sorted posting lists to reduce memory footprint.


## Todo Phase Detail + Questions (status: active)
Goal: Add implementation detail for remaining todo phases and capture any open decisions.

### Phase 57 details
- Update `src/shared/tokenize.js` `splitWordsWithDict` so no-match spans emit the remaining substring (or a bounded unknown span), not single characters.
- Ensure query parsing uses identical segmentation in `src/search/query.js` (`tokenizeQueryTerms`, `tokenizePhrase`).
- Add a dict segmentation benchmark harness (e.g., `tools/bench-dict-seg.js`) to compare greedy vs DP segmentation on a fixed sample set; report token counts and coverage.
- Tests: extend `tests/tokenize-dictionary.js` to cover unknown spans and query tokenization.

### Phase 58 details
- Compute blame ranges using line numbers derived before `getGitMeta` in `src/indexer/build/file-processor.js`.
- Treat chunk end offsets as exclusive when deriving `endLine` (use `end - 1` with empty-chunk guard).
- Tests: add a fixture with a multi-line file and assert `chunk_authors` matches expected lines.

### Phase 59 details
- Default YAML to a single root chunk in `src/indexer/chunking.js` unless config enables top-level splitting.
- Add `indexing.yamlChunkStrategy` (values: `root` | `top-level`) and document in `docs/config-schema.json`.
- Implement top-level splitting with line/indent scanning (no `indexOf`).
- Tests: `tests/chunking-yaml.js` + `tests/format-fidelity.js` for boundary checks.

### Phase 60 details
- Update `buildExternalDocs` (in `src/indexer/build/file-processor.js`) to preserve `@` and `encodeURIComponent` scoped package paths.
- Add a regression test for scoped npm modules (fixture in `tests/fixtures/external-docs` + new test file).

### Phase 61 details
- Prefer sparse scores by default in `src/search/pipeline.js` when BM25/FTS hits exist; ANN is fallback.
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
- `ROADMAP.md`: ensure it links to `COMPLETE_PLAN.md` and removes stale items.

### Phase 69 details
- Add `vscode-jsonrpc` and replace custom framing in `src/shared/jsonrpc.js` + `tools/mcp-server.js`.
- Update `src/tooling/lsp/client.js` to use `MessageReader/Writer` and request/notification helpers.
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
- Add `es-module-lexer` + `cjs-module-lexer` in `src/indexer/build/imports.js` to avoid full AST parse for imports.
- Consolidate JS/TS/Flow parsing in `src/lang/javascript.js`, `src/lang/typescript.js`, `src/lang/flow.js` using `@babel/parser`, keeping `acorn`/`esprima` fallbacks behind config for comparison.
- Add fixtures for JSX/TSX/Flow syntax and ensure import extraction is correct.

### Phase 73 details
- Use streaming JSON writers for large artifacts in `src/indexer/build/artifacts.js`.
- Add `piscina` worker pool for tokenization, ngrams, minhash, quantization (pure functions only).
- Provide fallback to sync path when workers unavailable; add tests for stream correctness.

### Phase 74 details
- Adopt `yargs` for CLI parsing and migrate existing CLI tools without breaking flags.
- Add `execa` where process spawning needs better error reporting and streaming.
- Update CLI docs and `--help` outputs after migration.

### Phase 75 details
- Expand tooling registry in `tools/tooling-utils.js` for new LSPs and parsers (Ruby LSP, Roslyn, Intelephense, sql parser).
- Add detection + install instructions and config toggles per tool.
- Update docs to reflect per-language tool preferences and fallbacks.

### Phase 76 details
- Use native `tree-sitter` bindings by default; keep WASM as an optional fallback and document tradeoffs.
- Implement a central grammar registry and per-language fallback logic.
- Add tree-sitter chunkers for Swift/Kotlin/C#/C/C++/ObjC first, then Go/Rust/Java.
- Add fixtures for chunk boundary validation and failure fallback paths.

### Phase 77 details
- Audit and remove unused dependencies (`minhash`, `varint`, `seedrandom`, `yaml`, `strip-comments`) if unreferenced.
- Consolidate JS parsing stack after Babel adoption; update docs/tests.
- Add a dependency usage test to prevent reintroducing removed packages.

### Phase 78 details
- Remove dead `posts` allocation in `src/indexer/build/postings.js`.
- Either implement `maxVocab` pruning or remove the trimmed-vocab path to avoid misleading behavior.
- Decide on `dense_vectors_doc_uint8.json`/`dense_vectors_code_uint8.json` usage (wire into ranking or stop writing/loading).
- Fix dense vector `scale` metadata to match quantization step (or drop field).
- Skip `scanImports()` for prose mode and add a regression test.
- Separate file-level vs chunk-level relations to avoid per-chunk duplication.
- Pre-index call/callDetails per file to avoid O(chunks * calls) scans.
- Fix potential blame end-line off-by-one for chunkers without explicit line metadata.
- Document `importLinks` semantics and add tests.
- Review ESLint API usage for current version compatibility and warn on failures.

### Phase 79 details
- Gate `.scannedfiles.json` / `.skippedfiles.json` behind a debug flag and store only counts + samples by default.
- Reuse a single ESLint instance per build and cache lint results for unchanged files.
- Make git blame opt-in or auto-disabled for benchmark profiles.
- Pre-split lines once per file for `preContext`/`postContext`.
- Deduplicate import lists in `scanImports`.
- Add an LRU cap for `gitMetaCache` if not handled by Phase 70.
- Reduce chunk metadata duplication before full file_meta refactor.

### Phase 80 details
- Batch git blame per file with porcelain output and compute chunk authors by line range.
- Batch embeddings per file or per N chunks; normalize once per batch.
- Move artifacts to streaming/JSONL/binary formats for vectors and postings.
- Split file-level metadata into `file_meta.json` and reference by file id in chunks.
- Persist per-file imports in incremental bundles and rebuild `allImports` without rereading all files.
- Avoid redundant discovery + stat passes for code/prose.
- Consider dropping per-chunk `tokens` storage or replacing with a compact representation.
- Move large numeric arrays to SQLite/binary for large repos.

### Phase 81 details
- Add a benchmark profile config preset plus CLI flag to disable expensive enrichment by default.
- Record which knobs were disabled in benchmark summaries.
- Document recommended benchmark settings for large repos.

### Phase 82 details
- Add a trigram/chargram candidate generator for substring and regex queries (regex to ngram prefilter).
- Keep punctuation as first-class tokens for code search (no stemming or stop-word removal).
- Add a safe regex prefilter stage that always verifies exact matches.
- Document the prefilter strategy and limits in `docs/search.md` or equivalent.

### Phase 83 details
- Expand query language filters (repo, file/path, lang, branch, case) and ensure they are cheap.
- Add symbol-aware ranking boosts for definitions/exports (ctags/tree-sitter/LSP).
- Create a compact repo map artifact (symbols + signatures + file paths) for retrieval and navigation.
- Add tests for filter correctness and ranking boost behavior.

### Phase 84 details
- Ingest SCIP and LSIF artifacts as optional inputs to populate definition/reference data.
- Add ctags JSONL streaming ingestion and optional interactive mode support.
- Add GNU Global tag DB as a fallback for languages without AST or LSP.
- Document precedence and fallbacks between LSP, SCIP/LSIF, ctags, and tags.

### Phase 85 details
- Integrate structural search engines (ast-grep, Semgrep rules, Comby templates).
- Add a rule-pack registry for security/risk signals and metadata extraction.
- Provide a structural-search CLI path with tests and fixtures.

### Phase 86 details
- Add a service-mode indexer that separates repo sync, indexing, and query serving.
- Implement durable job queues for multi-repo indexing with backpressure.
- Add repo connectors and syncing policies aligned with Sourcebot-style workflows.

### Phase 87 details
- Prototype external sparse backends (Tantivy) and vector backends (LanceDB).
- Evaluate server-backed search options (Meilisearch, Typesense) for UI suggestions.
- Document tradeoffs and an adoption recommendation.

### Phase 88 details
- Expand retrieval evaluation harness with datasets and offline metrics (MRR/recall).
- Add evaluation profiles inspired by Continue/Haystack guidance.
- Keep evaluation results in `docs/` with reproducible scripts.

### Phase 89 details (Problematic / gated)
- `tests/type-inference-crossfile.js` hangs during `script-coverage`; gate it and capture a minimal repro note.
- Re-enable the test after isolating the hang (likely in build/index shutdown or worker pool teardown).
- `tests/type-inference-lsp-enrichment.js` fails with `ERR_STREAM_DESTROYED` from `vscode-jsonrpc`; gate it and capture logs in `docs/failing-tests.md`.
- `tests/fixture-parity.js` intermittently crashes during the languages fixture on Windows (exit code 3221226505); gate it and track details in `docs/failing-tests.md`.

### Open questions
- None.
