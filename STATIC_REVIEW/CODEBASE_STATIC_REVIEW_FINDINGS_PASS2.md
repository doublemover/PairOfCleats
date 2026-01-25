# Codebase Static Review Findings — Retrieval + Index Invariants + Tooling Install + Federation/Caching

This report focuses on four follow-on areas:

1) Retrieval ranking + result shaping (verbosity controls, JSON output pruning)
2) Index state + piece manifest invariants (with emphasis on incremental indexing)
3) Optional dependencies / install scripts (clangd, sourcekit, pyright acquisition + configuration)
4) Multi-repo / federation readiness and cache key correctness

All file references are relative to the repo root.

---

## Executive Summary

- **Search output is currently harder to “shape” than it needs to be**: the CLI and API return a lot of metadata by default in the “full” rendering path, while the JSON output mode is *documented* as compact but is not compact unless `--compact` is also provided. This creates unnecessary verbosity and makes downstream consumers harder to build.
  - Key files: `src/retrieval/cli-args.js`, `src/retrieval/cli/render-output.js`, `src/retrieval/output/format.js`.

- **Hybrid ranking exists, but the default wiring strongly favors sparse-only**: `pipeline.js` has RRF and blending, but `src/retrieval/cli/normalize-options.js` hard-defaults `rrfEnabled = false` and `scoreBlendEnabled = false`. When both BM and ANN hits exist, ANN is typically computed but then discarded (unless sparse returns 0 hits), which is wasted work and can surprise users.
  - Key files: `src/retrieval/pipeline.js`, `src/retrieval/cli/normalize-options.js`, `src/retrieval/cli.js`.

- **Query-cache invalidation is currently at risk for sharded/jsonl chunk_meta artifacts**: `getIndexSignature()` (used by the query cache) fingerprints `chunk_meta.json`, but indexing can emit `chunk_meta.jsonl` or `chunk_meta.meta.json` + `chunk_meta.parts/`. In that common case, `chunk_meta.json` does not exist and the signature does **not** reflect chunk_meta changes, potentially reusing stale cached payloads across rebuilds.
  - Key files: `src/retrieval/cli-index.js` (bug), `src/retrieval/index-cache.js` (correct approach), `src/shared/artifact-io.js` (canonical sharded loader/signature).

- **Tooling installation is reasonably structured but manual tools don’t have a “first-class” experience**: `tools/setup.js` can detect missing tools and call `tools/tooling-install.js`, but manual tools (notably `clangd`, `sourcekit-lsp`) are reported as “manual” without actionable guided setup (and `setup` does not surface doc links when not in `--json`). Also, pyright detection checks `pyright`, while the provider runs `pyright-langserver`.
  - Key files: `tools/setup.js`, `tools/tooling-utils.js`, `tools/tooling-install.js`, `src/index/type-inference-crossfile/tooling.js`, `src/index/tooling/*-provider.js`.

- **Federation is not implemented yet, but several foundations are good**: repo-level cache roots are already namespaced by `repoId` (derived from the repo path hash), and global caches exist for models/tooling/dictionaries. The main correctness gap today is signature/key completeness (especially query-cache) and the lack of an explicit “federated search orchestration” layer.
  - Key files: `tools/dict-utils.js`, `src/retrieval/query-cache.js`, `src/retrieval/cli-index.js`, `tools/api/router.js`.

---

## 1) Retrieval Ranking + Result Shaping

### 1.1 Current ranking pipeline (what it does today)

The search flow is primarily orchestrated by:

- `src/retrieval/cli.js` — CLI entrypoint; builds query plan, loads indexes, selects backends, and calls the session runner.
- `src/retrieval/cli/run-search-session.js` — runs per-mode searches, builds embeddings when needed, manages query cache.
- `src/retrieval/pipeline.js` — per-mode retrieval + ranking pipeline:
  - candidate set derivation and filtering
  - sparse ranking (BM25-ish over token postings or SQLite FTS)
  - dense ranking (vector ANN, HNSW/Lance/SQLite extension)
  - merge strategy (RRF or blend)
  - post-boosts (phrase boost, symbol boost)

Ranking primitives:

- **Sparse**:
  - Token-postings ranking in `src/retrieval/rankers.js` (e.g., `rankSparsePostings`).
  - Optional SQLite FTS path (see `rankSqliteFts` call sites).
- **Dense**:
  - Dense vector scoring in `src/retrieval/rankers.js` via `rankDenseVectors` or backend-specific ANN (HNSW/Lance/SQLite extension).

Merge logic is in `src/retrieval/pipeline.js` (approx. lines 518+ in current snapshot):

- If both BM hits and ANN hits exist:
  - Use **RRF** only when `rrfEnabled` is true and blending is disabled.
  - Use **weighted blend** only when `scoreBlend.enabled === true`.
  - Otherwise: **prefer BM hits** and ignore ANN hits.

### 1.2 High-impact behavior mismatches and inefficiencies

#### A) “Hybrid” work is often computed but dropped

- `src/retrieval/cli/normalize-options.js` hard-sets:
  - `const rrfEnabled = false;`
  - `const scoreBlendEnabled = false;`

This means that with default CLI settings, when ANN is enabled and sparse returns hits, **ANN hits are ignored** by `pipeline.js` merge logic (it falls through to `merged = bmHits`).

Consequences:

- **Recall loss** (no hybrid benefit unless sparse is empty).
- **Compute waste**: `run-search-session.js` may compute query embeddings and ANN candidates even though they won’t be used.

Recommendation:

- Expose an explicit `--score-mode` (or `--hybrid`) flag that maps cleanly to the existing internal `scoreModeOverride` mechanism in `src/retrieval/cli.js`.
  - Suggest modes: `sparse`, `dense`, `hybrid-rrf`, `hybrid-blend`.
- If a hybrid mode is not enabled, **skip ANN retrieval entirely** unless sparse hits are below a threshold (e.g., `< topN/4`).
  - This is a large performance win without changing default quality.

Tests:

- Add `tests/search-score-mode-hybrid.js`:
  - Build a tiny fixture index with both sparse + dense vectors.
  - Assert that `--score-mode hybrid-rrf` includes at least one ANN-only hit in top N.
- Add `tests/search-skip-ann-when-sparse-sufficient.js`:
  - Instrument `rankDenseVectors` call count (or mock provider) and assert it is not invoked when sparse returns enough hits and `--score-mode sparse`.

#### B) CLI help claims `--json` is compact, but behavior is not compact

- In `src/retrieval/cli-args.js`, the help text says:
  - `--json                          emit JSON output (compact JSON; stats only with --stats or --explain)`

But the actual behavior in `src/retrieval/cli.js` is:

- `jsonOutput = argv.json === true`
- `jsonCompact = argv.compact === true`

So `--json` without `--compact` outputs **full hit objects**, only stripping `tokens` via `stripTokens()` in `src/retrieval/cli/render-output.js`.

Recommendation (pick one):

1) **Make behavior match docs** (preferred):
   - If `--json` is set and `--compact` is not explicitly set, default to compact hits:
     - `const jsonCompact = argv.compact === true || jsonOutput === true;`
   - Add `--json-full` to explicitly request full hit objects.

2) Alternatively: **change the help text** to remove “compact”.

Tests:

- Add `tests/search-json-default-compact.js`:
  - Run `pairofcleats search --json ...` and assert each hit object lacks large fields (`text`, `imports`, `exports`, `usages`, etc.) and matches the `compactHit()` schema.

#### C) Human output contains “unbounded” lists in the full chunk formatter

- The CLI “full chunk” formatter in `src/retrieval/output/format.js` prints:
  - `imports` and `exports` lists without a strict cap.
  - call summaries and risk arrays can also be long.

The `usages` list is capped (`slice(0, 10)`), but imports/exports are not.

Recommendation:

- Add a consistent truncation policy for **every list field** in the human formatter:
  - Default caps (example): `imports <= 20`, `exports <= 20`, `calls <= 20`, `risk <= 20`.
  - Print an explicit “(+N more)” line when truncated.
- Add a `--verbosity` flag controlling both:
  - number of full results
  - metadata sections printed
  - truncation thresholds

Tests:

- Add `tests/search-cli-truncation.js`:
  - Use a synthetic chunk with 100 imports.
  - Assert output includes only first N plus a “more” indicator.

### 1.3 JSON output pruning / result shaping spec

Right now you essentially have:

- **human output**: `src/retrieval/cli/render.js` + `src/retrieval/output/format.js`
- **JSON output**:
  - compact hits: `compactHit()` in `src/retrieval/cli/render-output.js`
  - “full hits”: raw chunk meta objects (tokens stripped)

To make JSON output a stable, composable integration surface:

Recommended additions:

- `--json-schema` (emit a versioned schema identifier in payloads):
  - Example top-level field: `schemaVersion: "search.v1"`

- `--json-mode` with explicit variants:
  - `compact` (default)
  - `standard` (compact + enough metadata for navigation)
  - `full` (raw objects)

- `--json-fields` (allow list selection / projection):
  - Example: `--json-fields file,lineStart,lineEnd,score,kind,name,language,context`

- Introduce a shared “hit projection” helper:
  - File: `src/retrieval/output/projection.js` (new)
  - Used by both CLI JSON mode and API responses.

- Separate “explain” payload from “hits” payload:
  - In `render-output.js`, `explain` currently contains a lot of useful details.
  - Keep that behind `--explain` but provide a `--explain=json` option to emit a separate JSON object.

---

## 2) Index State + Piece Manifest Invariants (Incremental-Focused)

### 2.1 Current artifacts and manifests (what exists)

**Index state**

- Written in `src/index/build/indexer/steps/write.js` to `index_state.json`.
- Used by retrieval to:
  - detect “pending” embeddings/enrichment (`src/retrieval/cli/index-loader.js` via `warnPendingState()`).

**Pieces manifest**

- Written by `src/index/build/artifacts/checksums.js` to `pieces/manifest.json`.
- Includes `{ version, generatedAt, mode, stage, pieces:[{name,type,format,path,checksum,bytes}] }`.
- Validated by `src/index/validate.js` (checks presence and optionally checksum correctness).

**Incremental manifest**

- Stored under the repo cache root:
  - `.../<repoCacheRoot>/incremental/<mode>/manifest.json`
- Managed by `src/index/build/incremental.js` and invoked by `src/index/build/indexer/steps/incremental.js`.
- Used to determine whether file bundles can be reused.

### 2.2 Cache correctness issue: query-cache index signature does not cover sharded chunk_meta

This is the single most important correctness finding in this pass.

- Query cache signature is computed in `src/retrieval/cli-index.js` via `getIndexSignature()`.
- For non-sqlite mode, it currently fingerprints:
  - `chunk_meta.json` (via `fileSignature()`)
  - `token_postings.json` / `phrase_ngrams.json` / `chargram_postings.json`
  - plus jsonl signatures for `repo_map`, `file_relations`, `graph_relations`

Problem:

- The index build can emit chunk meta in **jsonl** or **parts** form:
  - `chunk_meta.jsonl`
  - or `chunk_meta.meta.json` + `chunk_meta.parts/`
  - See `src/index/build/artifacts/writers/chunk-meta.js`.

When chunk meta is not emitted as `chunk_meta.json`, `fileSignature(codeMeta)` returns `null`, meaning the query-cache signature can remain unchanged across rebuilds even when chunk meta changes.

Impact:

- Query cache may return stale hit objects after rebuilds.
- The risk is higher on larger repos because they are more likely to trigger jsonl/parts output.

Recommendation:

- Replace `fileSignature(<modeDir>/chunk_meta.json)` with the same logic already used by the index cache:
  - `chunkMetaSignature(<modeDir>/chunk_meta)` from `src/retrieval/index-cache.js`.
  - Or directly call `jsonlArtifactSignature()` / a new shared helper in `src/shared/artifact-io.js`.

Concrete fix:

- Introduce a shared helper in `src/shared/artifact-io.js`:
  - `signatureForChunkMeta(dir)` that checks `.json`, `.jsonl`, `.meta.json` + `.parts`.
- Use it in both:
  - `src/retrieval/index-cache.js` (optional refactor)
  - `src/retrieval/cli-index.js` (required)

Tests:

- Add `tests/query-cache-signature-chunkmeta-sharded.js`:
  - Create a fake index directory with `chunk_meta.meta.json` + `chunk_meta.parts/part_000.jsonl`.
  - Assert `getIndexSignature()` changes when the parts file changes.

### 2.3 Strengthen reuse checks to avoid reusing corrupted indexes

`shouldReuseIncrementalIndex()` in `src/index/build/incremental.js` currently checks:

- `index_state.json` exists
- `pieces/manifest.json` exists and has a non-empty `pieces` array
- scanned file entries match the incremental manifest entries
- stage is satisfied

It does **not** verify that:

- required artifacts exist (`chunk_meta`, `token_postings`, etc.)
- the piece manifest actually points to existing files
- `pieces/manifest.json` stage/mode matches `index_state.json`

Recommendation:

- Add a “light validation” path when deciding reuse:
  - Read `pieces/manifest.json` and stat each piece path.
  - Optionally verify `bytes` matches.
  - Optionally verify checksum for a small subset (or behind config).

This makes reuse decisions resilient to partial or corrupted outputs (e.g., interrupted builds).

Tests:

- Add `tests/incremental-reuse-fails-on-missing-piece.js`:
  - Create outDir with `index_state.json`, `pieces/manifest.json` referencing a missing file.
  - Assert reuse returns `false`.

### 2.4 Improve index_state for auditability and future federation

`index_state.json` is already useful for pending flags, but it is missing fields that become critical as soon as you add:

- multi-repo federation
- branch indexing
- index diffing / “what changed” reports

Recommendations:

- Add to `index_state.json`:
  - `buildId` (unique per build; could be timestamp + random)
  - `repo` metadata snapshot:
    - `repoRoot` (resolved real path)
    - `scm` (git/jj/none)
    - `headCommit` / `headChangeId` (if available)
    - `branch` (if available)
  - `artifactProfile` (e.g., json vs jsonl vs sharded, compression)

- Ensure retrieval surfaces these fields via `--stats` or `--explain`.

### 2.5 Piece manifest: make it the canonical artifact inventory

Today, `pieces/manifest.json` is validated by `src/index/validate.js`, but it is not heavily used by runtime loading/caching.

Recommended direction:

- Treat `pieces/manifest.json` as the “inventory contract”:
  - It should list every file needed to fully load the index.
  - It should include the *artifact semantics* (e.g., `artifactKey: "chunk_meta"`, `mode: "code"`).
  - It should include sharding info for jsonl/parts artifacts (`parts`, `totalBytes`, `recordCount`).

Immediate use cases:

- Robust cache invalidation (index cache + query cache)
- Packaging/distribution of built indexes
- Future WASM grouping + streaming pipeline planning (piece manifests can include `languageGroup` / `wasmModule` tags)

---

## 3) Optional-Deps / Install Scripts (clangd, sourcekit, pyright)

### 3.1 What exists today

- `tools/setup.js` orchestrates setup steps, including:
  - `tools/tooling-detect.js` (via `buildToolingReport()`)
  - `tools/tooling-install.js` to install auto-installable tools

- Tool registry:
  - `tools/tooling-utils.js` defines tools, detect commands, and install plans.
  - `clangd` and `sourcekit-lsp` are marked `install: { manual: true }`.
  - `pyright` is auto-installable via npm and is also present in `package.json` dependencies.

- Tooling-backed type inference uses:
  - `src/index/type-inference-crossfile/tooling.js`
  - Providers in `src/index/tooling/`:
    - `clangd-provider.js`
    - `sourcekit-provider.js`
    - `pyright-provider.js`
    - `typescript-provider.js`

### 3.2 Gaps in acquisition/configuration flows

#### A) Manual tools aren’t guided by setup

- `tools/setup.js` will detect missing tools and run tooling install.
- For manual tools, `tooling-install.js` returns `{ status: 'manual', docs }`, but:
  - in non-JSON output, it does not print doc links
  - setup does not surface a clear “next steps” block

Recommendation:

- Add a `tools/tooling-doctor.js` (or extend `tooling-detect.js`) that emits:
  - tool availability
  - exact command resolution path
  - required config hints

- Enhance `tools/setup.js` to print a “manual tooling instructions” section when any tools have status `manual`.

#### B) Pyright detection and Pyright provider do not verify the same binary

- `tools/tooling-utils.js` detects `pyright` (`pyright --version`).
- `src/index/tooling/pyright-provider.js` runs `pyright-langserver`.

Recommendation:

- Update tooling detection to check `pyright-langserver` availability as well (or instead).

#### C) clangd compile_commands and sourcekit toolchain prerequisites need explicit handling

- `src/index/type-inference-crossfile/tooling.js` supports `compileCommandsDir` and passes it to clangd:
  - `--compile-commands-dir <dir>`

But there is no first-class helper to:

- generate/locate `compile_commands.json`
- detect missing toolchains
- validate that clangd/sourcekit actually returns useful hover/signature info

Recommendation:

- Add a `pairofcleats tooling init` step that:
  - resolves and writes config defaults for:
    - `tooling.clangd.compileCommandsDir`
    - `tooling.sourcekit.sourcekitToolchainPath` or similar
  - runs a minimal “smoke query” against a known file:
    - request hover for a symbol and verify response is non-empty

Tests:

- Add `tests/tooling-doctor-report.js` (unit-ish):
  - ensure doctor reports manual tools as “missing/manual” with actionable hints.

---

## 4) Multi-Repo / Federation and Cache Key Correctness

### 4.1 What exists today

- Repo cache namespacing:
  - `tools/dict-utils.js:getRepoId()` and `getRepoCacheRoot()` namespace per-repo caches under:
    - `<cacheRoot>/repos/<repoId>`

- Global caches exist by default:
  - models: `<cacheRoot>/models` (`getModelsDir()`)
  - tooling: `<cacheRoot>/tooling` (`getToolingConfig()`)
  - dictionaries: `<cacheRoot>/dictionaries` (`getDictConfig()`)

- API server caches per repo:
  - `tools/api/router.js` stores per-repo `indexCache` and `sqliteCache` keyed by repo path.

### 4.2 Cache key correctness issues and risks

#### A) Query-cache signature correctness (critical)

Covered in Section 2.2.

This is the first fix required before federation, because federated search will lean heavily on caching to be performant.

#### B) API router caches keyed by raw repoPath string

- `tools/api/router.js:getRepoCaches()` uses `repoCaches.get(repoPath)`.

If callers use different spellings of the same path (symlinks, relative vs absolute, case-insensitive variations), the API server can:

- duplicate caches in memory
- fail to clear caches consistently

Recommendation:

- Normalize `repoPath` early:
  - `path.resolve()` + `fs.realpath()` (already used in some repo resolution paths) and use that as the cache key.

#### C) Federation will require score comparability and per-index normalization

When you merge results across multiple repos (and/or multiple indexes per repo):

- sparse scores and dense scores are not necessarily comparable across:
  - different index sizes
  - different embeddings models
  - different tokenization/dictionary configs

Recommendation:

- Define a federation merge policy:
  - per-repo top-k retrieval
  - normalize scores within each repo/index (e.g., z-score or min-max within candidate set)
  - then merge with RRF at the federation layer

### 4.3 Federation readiness checklist

To add multi-repo/federated search cleanly, you will need:

- A “repo set” abstraction:
  - a stable identifier for a federated group (sorted list of repoIds + config hash)

- A cache key extension:
  - query cache keys should include:
    - `repoSetId`
    - per-repo `indexSignature`

- A federated query cache location:
  - not under a single repo’s metrics dir
  - recommended: `<cacheRoot>/federation/<repoSetId>/queryCache.json`

- Clear result attribution:
  - each hit should include `repoId` or `repoRoot` so results can be opened unambiguously

- Tests:
  - federated merge determinism
  - cache key stability (order of repos must not change key)
  - invalidation when any repo index changes

---

## Recommended Immediate Fix List (ordered)

1) **Fix query-cache index signature for sharded/jsonl chunk_meta**
   - `src/retrieval/cli-index.js:getIndexSignature()`

2) **Make `--json` behavior match docs (compact by default) or fix docs**
   - `src/retrieval/cli-args.js` + `src/retrieval/cli.js` + `src/retrieval/cli/render-output.js`

3) **Expose `--score-mode` and avoid computing ANN when it cannot affect results**
   - `src/retrieval/cli.js` (already has scoreModeOverride support)
   - `src/retrieval/cli-args.js` (new flag)
   - `src/retrieval/pipeline.js` (conditional ANN execution)

4) **Add a tooling doctor / better manual-tool guidance in setup**
   - `tools/setup.js`, `tools/tooling-install.js`, new `tools/tooling-doctor.js`

5) **Add minimal federation correctness scaffolding (even before the full feature)**
   - path normalization for API cache keys
   - define repoSetId hashing utility

