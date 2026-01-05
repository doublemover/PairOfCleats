# Codebase Review (Temporary)

This document captures mistakes, enhancement ideas, and refactoring opportunities by phase. It will be used to update `COMPLETE_PLAN.md` and then removed.

## Phase 1: Indexing Core (build_index + indexer/shared)

Mistakes:
- `src/index/build/file-processor.js` sets `meta.weightt` but later uses `meta.weight`; `chunkPayload.weight` becomes `undefined`, so `bm * c.weight` yields `NaN` and weights never apply.
- `src/index/build/postings.js` logs "Using real model embeddings" even when stub embeddings are active, which is misleading for users.

Enhancements:
- Avoid O(n^2) token frequency recomputation in `src/index/build/postings.js` by storing per-chunk token counts when chunking.
- Add a config option to skip per-chunk `git blame` (or downgrade to file-level blame) to reduce indexing latency on large repos.
- Remove or repurpose unused `state.wordFreq` and `postings.sparse` to reduce memory footprint if they are not used downstream.

Refactoring opportunities:
- Centralize chunk weight assignment to a single helper and enforce a consistent `weight` key across chunk meta/output.
- Provide a shared `buildBm25Rows` helper that accepts precomputed frequencies to make postings generation deterministic and testable.

Tests/edge cases:
- Add a regression test that asserts `chunkPayload.weight` is numeric and affects BM25 scoring output.
- Add a zero-chunk/empty-repo test to ensure postings/metrics do not emit NaN or throw.

Risks/notes:
- Per-chunk `git blame` can dominate runtime on large files and may make incremental builds slower than expected.

## Phase 2: Language Parsing + Inference

Mistakes:
- No obvious correctness bugs surfaced in the skim, but several parsers are heuristic and can silently degrade metadata when they fail.

Enhancements:
- Improve TypeScript import detection to handle multi-line `import`/`export` statements and `import()` expressions reliably.
- Add AST-capable parsing for JSX/Stage-3 syntax (e.g., espree or tree-sitter) so `.jsx/.tsx` files do not fall back to blob chunking.
- Extend cross-file inference beyond TypeScript (Go/Rust/Java via LSP/tooling) with a unified interface.
- Allow opt-in caching/reuse of Python AST parsing to avoid per-file `spawnSync` overhead on large repos.

Refactoring opportunities:
- Extract shared chunk helpers (modifier parsing, doc comment parsing, signature slicing) into `src/lang/shared.js` for all regex-driven languages.
- Consolidate control-flow/dataflow summarization into a shared utility to reduce duplicate per-language logic.

Tests/edge cases:
- Add fixtures for `.tsx/.mts/.cts` and multi-line import/export syntax to validate chunking + import collection.
- Add tests that force Python AST failure (missing python/large file) to ensure heuristic fallback is used and logged.

Risks/notes:
- Regex-based chunkers can mis-handle nested constructs or multiline signatures; metadata fidelity can drift without tests.

## Phase 3: Search + Scoring

Mistakes:
- MinHash mismatch: indexing uses `src/index/minhash.js` (SimpleMinHash) while search uses the `minhash` package (`src/retrieval/rankers.js`), so signatures are likely incompatible and similarity scores unreliable.
- `sparse_postings_varint.bin` is produced but never read by search, which suggests dead artifacts or missing integration.

Enhancements:
- Unify MinHash implementation between indexing and search (either both use SimpleMinHash or both use the library) and expose a test to enforce compatibility.
- Add caching for `getBodySummary` to avoid repeated disk reads when rendering multiple results from the same file.
- Offer a config flag to fully disable MinHash ranking when the signature pipeline is not in use.

Refactoring opportunities:
- Extract common search argument parsing and output formatting between `search.js` and `tools/search-sqlite.js` to avoid drift.
- Centralize candidate selection/merging logic so both backends share identical score normalization paths.

Tests/edge cases:
- Add a MinHash regression test that compares query signatures against stored signatures for a known fixture.
- Add tests that cover `--return-type`/`--returns`/`--inferred-type` filters across multiple languages.

Risks/notes:
- File-backed search loads full artifacts into memory; large repos should default to SQLite for stability.

## Phase 4: SQLite + ANN Backends

Mistakes:
- Incremental updates only validate required tables, not schema version (`PRAGMA user_version`), so a schema bump could silently corrupt or partially update older DBs.

Enhancements:
- Validate schema version before incremental updates and force a full rebuild when mismatched.
- Detect embedding model changes (model id or dims) and force a rebuild or a dense_vectors re-ingest.
- Add optional pruning/compaction for `token_vocab`/`phrase_vocab`/`chargram_vocab` to avoid unbounded growth during incremental updates.

Refactoring opportunities:
- Extract shared insert/update helpers between full build and incremental update paths to reduce duplication in `tools/build-sqlite-index.js`.
- Centralize vector-ann table handling and error reporting across build/search tools.

Tests/edge cases:
- Add an incremental update test that simulates a schema version bump and asserts a rebuild.
- Add a test to validate vector ANN tables stay in sync after file deletions.

Risks/notes:
- Incremental vocab growth can bloat the DB even when tokens are no longer present; compaction should be part of maintenance.

## Phase 5: Tooling + Bootstrap + Cache + CI

Mistakes:
- `tools/clean-artifacts.js --all` deletes the entire cache root, which can wipe models/dictionaries even though uninstall is the intended full wipe path.

Enhancements:
- Add a `--keep-models/--keep-dicts` safeguard for `clean-artifacts` (or make `--all` only remove repo caches).
- Provide a `--json` summary output for `tools/setup.js` to make CI automation easier.
- Replace external `tar/unzip` dependency in `tools/download-extensions.js` with a Node-based extractor fallback when possible.

Refactoring opportunities:
- Deduplicate `runCommand`, `isRootPath`, and confirmation prompts across `setup`, `bootstrap`, `clean-artifacts`, and `uninstall`.
- Centralize cache path resolution and safety checks into a shared helper module.

Tests/edge cases:
- Add a test that ensures `clean-artifacts --all` preserves models/dicts unless uninstall is invoked.
- Add a test for `setup --non-interactive --with-sqlite` to ensure it respects defaults and builds both index types.

Risks/notes:
- Several scripts depend on external executables (`npm`, `tar`, `unzip`) that may not exist in minimal CI images.

## Phase 6: MCP + Tests + Docs

Mistakes:
- `ROADMAP.md` is stale (still lists CFG/dataflow + type inference as pending despite completion in `COMPLETE_PLAN.md`).

Enhancements:
- MCP server now streams build/index tasks via async subprocesses; add troubleshooting guidance for progress output if needed.
- Document MCP error payloads and include a small troubleshooting section in docs.

Refactoring opportunities:
- Consolidate MCP tool schema/implementation metadata to avoid duplication between `src/mcp/defs.js` and `tools/mcp-server.js`.
- Normalize test harness output (fixtures, parity, bench) into a shared helper to reduce duplication.

Tests/edge cases:
- Add MCP tests for invalid repo paths and missing indexes to validate error responses.
- Add a docs regression test to ensure `ROADMAP.md` matches completed phases or is explicitly marked as historical.

Risks/notes:
- MCP server now uses async subprocesses for long-running tasks; keep stdout/stderr buffers bounded to avoid memory spikes.

