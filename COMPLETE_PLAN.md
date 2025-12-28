# Complete Plan

This is the end-to-end plan for bringing the project from the current SQLite parity state to a fully centralized, maintainable, and performant indexing/search system.

## Project goals
- Per-repo indexing with a central cache (indexes, models, repometrics) outside the repo.
- On-demand indexing with incremental caching and optional prebuilt CI artifacts.
- MCP server interface for index status/build/search/model download.
- Non-git repos supported with a strong recommendation to use git.

## Cache layout
- <cache>/repos/<repoId>/index-code/
- <cache>/repos/<repoId>/index-prose/
- <cache>/repos/<repoId>/repometrics/
- <cache>/repos/<repoId>/index-sqlite/index-code.db
- <cache>/repos/<repoId>/index-sqlite/index-prose.db
- <cache>/models/

Repo identity:
- Prefer git toplevel + remote URL (hash to repoId)
- If no git, hash absolute path

## Model download and bootstrap
- On startup, detect model files in cache; if missing, prompt to download.
- Provide preflight download command examples:
  - Node: node --input-type=module -e "import { pipeline } from '@xenova/transformers'; await pipeline('feature-extraction','Xenova/all-MiniLM-L12-v2');"
  - Python: python -c "from huggingface_hub import snapshot_download; snapshot_download('Xenova/all-MiniLM-L12-v2')"

## Git handling
- If git is missing or repo is not a git repo, warn once and continue without git metadata.
- If git is present, store commit hash and dirty flag in repo state.

## MCP surface (future)
- index_status(repoPath)
- build_index(repoPath, mode=all, incremental=true)
- search(repoPath, query, filters...)
- download_models()

## Phase 2: SQLite-Driven Candidate Generation

### Goal
Move candidate generation (token postings, phrase n‑grams, char‑grams) into SQLite while keeping scoring and rendering in `search.js`. This reduces reliance on file‑backed JSON artifacts and centralizes candidate selection in the DB without changing ranking behavior.

### Scope
- In scope:
  - Candidate set creation via `token_vocab`/`token_postings`, `phrase_vocab`/`phrase_postings`, and `chargram_vocab`/`chargram_postings`.
  - BM25 stats sourced from SQLite (`doc_lengths` + `token_stats`).
  - Fallback to file‑backed artifacts when required tables are missing.
- Out of scope:
  - Full SQL scoring (pure SQLite ranking).
  - ANN scoring inside SQLite (still JS‑side).

### Work Items
1) Add prepared SQL statements for candidate lookups.
2) Implement `getCandidateSet(tokens, mode)` to use SQLite when enabled.
3) Replace in‑memory candidate generation in SQLite mode, keep file‑backed path unchanged.
4) Ensure missing tables fall back to file‑backed mode unless `--backend sqlite` is forced.
5) Update docs to reflect SQLite candidate generation as the default.

### Acceptance Criteria
- Query results match the file‑backed path (top‑N parity across a test set).
- No significant regressions in latency or memory.
- Clean fallback when SQLite tables are missing.

## Phase 3: Parity + Performance Validation

### Goal
Prove that SQLite‑backed candidate generation and file‑backed candidate generation yield equivalent results and acceptable performance.

### Work Items
1) Add a query harness to run a set of representative queries.
2) Compare top‑N results and score deltas between backends.
3) Measure latency and memory usage; capture baseline numbers.
4) Document known differences (if any) and acceptable tolerances.

### Acceptance Criteria
- Documented parity metrics with minimal or explained divergence.
- Benchmarks show no major regression.

## Phase 4: Incremental Indexing

### Goal
Update indexes per commit (or per file change) rather than full rebuilds.

### Work Items
1) Add file hashing and change detection for code/prose inputs.
2) Track chunk IDs deterministically to enable updates/deletes.
3) Update SQLite tables for changed chunks only (postings, n‑grams, minhash, dense vectors).
4) Preserve repometrics and history in cache outside the repo.
5) Update bootstrap/CI flows to use incremental mode when possible.

### Acceptance Criteria
- Incremental update produces equivalent results to full rebuild.
- Noticeable reduction in update time for small diffs.

## Phase 5: CI Artifact Generation + Detection

### Goal
Allow CI pipelines (GitHub/GitLab) to build and publish SQLite index artifacts for reuse.

### Work Items
1) Add a CI script that builds indexes and writes artifacts to a predictable path.
2) Add logic to detect CI‑generated artifacts locally and reuse them.
3) Document required CI variables and cache paths.
4) Provide a generic script that GitHub/GitLab can both call with minimal changes.

### Acceptance Criteria
- Artifacts can be built in CI and reused locally or by agents.
- Clear docs for setup across providers.

## Phase 6: Expanded Tests + Benchmarks

### Goal
Improve confidence in indexing/search behavior and performance over time.

### Work Items
1) Add fixture repos for deterministic tests.
2) Add parity tests between backends.
3) Add benchmark harness for index size, build time, query latency.
4) Add CI test run for smoke + parity checks.

---

## Execution Plan: SQLite ANN Extension Follow-ups

# Plan

Implement the remaining ANN extension polish (archive download support, extension-focused tests, bench ergonomics, and compaction fix), then validate with the updated harnesses.

## Scope
- In: Extension archive extraction, ANN extension test, compaction dims fix, roadmap update, bench ergonomics + docs, validation runs.
- Out: New ANN providers, large search/index refactors, and performance tuning beyond the listed fixes.

## Action items
[ ] Add `.zip`/`.tar.gz` extraction to `tools/download-extensions.js` and document archive behavior.
[ ] Add a focused ANN extension test (`tests/sqlite-ann-extension.js`) that validates `dense_vectors_ann` and `search.js` stats.
[ ] Fix compaction to only build ANN tables when `dense_meta.dims` is present.
[ ] Update `ROADMAP.md`, `README.md`, and `docs/phase6-tests-benchmarks.md` to reflect ANN extension status and bench ergonomics.
[ ] Add `bench-ann` npm script and document it.
[ ] Run validation: `npm run bench`, `node tests/bench.js --ann`, and `npm run sqlite-ann-extension-test`.

## Open questions
- Should archive extraction support `.zip` only, or include `.tar.gz` and `.tgz`? (default: all three)
- Should the ANN test assert `annBackend=sqlite-extension`? (default: yes)
- Add `bench-ann` as a script or just document `node tests/bench.js --ann`? (default: new script)

### Acceptance Criteria
- Automated tests cover core functionality.
- Benchmarks provide historical baselines.

## Phase 7: Language Expansion

### Goal
Expand indexing support beyond JS/YAML/Markdown to match stated priorities.

### Priority Order
1) Python
2) Swift
3) ObjC/C/C++
4) Rust

### Work Items
- Implement language‑specific chunking/parsing.
- Add test fixtures and examples per language.
- Ensure chunk metadata parity with JS pipeline.

### Acceptance Criteria
- Each language has stable chunking, metadata, and searchability.

## Phase 8: SQLite-Only Scoring (Optional)

### Goal
Optionally move scoring and ranking into SQLite for a pure SQL backend.

### Work Items
1) Prototype SQL scoring for BM25 + n‑grams.
2) Evaluate feasibility of ANN scoring without external extensions.
3) Decide whether to keep JS scoring for ANN or accept FTS5‑only ranking.

### Acceptance Criteria
- Clear decision on whether SQLite-only scoring is worth pursuing.

---

## Phase 9: Scoring Calibration + Deterministic Ranking

### Goal
Align backend ranking behavior and make score tuning explicit.

### Work Items
1) Add deterministic tie-breakers to ranking and result merging.
2) Expose BM25 tuning via config (`search.bm25`).
3) Add a short design note documenting tradeoffs and usage.

### Acceptance Criteria
- Search results are stable across runs for identical inputs.
- BM25 parameters can be tuned without code changes.

If you want this plan to replace an existing plan file, confirm which file to remove (e.g., `PHASE2_PLAN.md`) and I will delete it.

## Python Support Plan (Next)

### Goal
Move from basic regex chunking to robust Python-aware parsing with rich metadata.

### Scope
- In scope:
  - AST-based chunking for functions, classes, methods, and module blocks.
  - Docstring extraction (module, class, function) with params/returns parsing.
  - Import graph (import/from import) and symbol usage hints.
  - Test fixtures that validate chunk names, locations, and metadata.
- Out of scope:
  - Type-checking or semantic analysis across modules.
  - Full execution or runtime tracing.

### Work Items
1) Select parser strategy (tree-sitter-python via npm or a lightweight Python AST bridge) and document tradeoffs.
2) Implement a Python chunker that returns stable `start/end` offsets and `startLine/endLine`.
3) Add metadata extraction for:
   - docstrings (triple-quoted strings following defs/classes),
   - decorators and base classes,
   - function signatures and parameter names.
4) Extend tokenization to better handle snake_case, dunder names, and dotted references.
5) Add import parsing for `import X` and `from X import Y`.
6) Add fixture repos and golden tests for chunk boundaries and metadata.
7) Update docs and README with Python support details and limitations.

### Acceptance Criteria
- Deterministic chunking for representative Python files.
- Metadata for docstrings and signatures populated in chunk meta.
- Fixture tests pass and parity with JS pipeline formatting is maintained.
