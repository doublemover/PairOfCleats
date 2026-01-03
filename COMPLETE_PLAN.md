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


## Phase 77: Deps Fixes - Dependency Hygiene (status: done)
Goal: Remove unused packages and consolidate redundant parsing stacks.
Work items:
- [ ] Audit usage of `minhash` (npm), `varint`, `seedrandom`, `yaml`, `strip-comments`; remove if unused.
- [ ] Consolidate JS parsing dependencies (prefer Babel) and remove redundant `acorn`/`esprima` paths if safe.
- [ ] Update `package.json`, lockfile, and docs to reflect dependency removals.
- [ ] Add a small dependency audit test to ensure removed packages are not referenced.


## Phase 78: Deps Fixes - Correctness and Spec Mismatches (status: done)
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

### Phase 75 details
- Expand tooling registry in `tools/tooling-utils.js` for new LSPs and parsers (Ruby LSP, Roslyn, Intelephense, sql parser).
- Add detection + install instructions and config toggles per tool.
- Update docs to reflect per-language tool preferences and fallbacks.

### Phase 76 details
- Use native `tree-sitter` bindings by default; keep WASM as an optional fallback and document tradeoffs.
- Implement a central grammar registry and per-language fallback logic.
- Add tree-sitter chunkers for Swift/Kotlin/C#/C/C++/ObjC first, then Go/Rust/Java.
- Add fixtures for chunk boundary validation and failure fallback paths.

### Phase 80 details
- Batch git blame per file with porcelain output and compute chunk authors by line range.
- Batch embeddings per file or per N chunks; normalize once per batch.
- Move artifacts to streaming/JSONL/binary formats for vectors and postings.
- Split file-level metadata into `file_meta.json` and reference by file id in chunks.
- Persist per-file imports in incremental bundles and rebuild `allImports` without rereading all files.
- Avoid redundant discovery + stat passes for code/prose.
- Consider dropping per-chunk `tokens` storage or replacing with a compact representation.
- Move large numeric arrays to SQLite/binary for large repos.

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
