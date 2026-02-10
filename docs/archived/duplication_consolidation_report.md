# PairOfCleats — Duplication & Consolidation Report

**Date:** 2026-02-08  
**Repository:** `PairOfCleats-BULKY_LOADS` (from `PairOfCleats-BULKY_LOADS.zip`)  
**Goal:** identify duplicated functionality (including *semantic* “same job, different implementation” duplicates), recommend a shared core of modules, and surface drift risks.

---

## Executive summary

This codebase is a fairly large indexing + retrieval system with multiple storage backends (**in-memory**, **SQLite**, **SQLite FTS**, **LMDB**) and multiple frontends (**CLI**, **API server**, **MCP server**, **service tooling**, **benchmarks**, **map/viewer**). That breadth is reflected in the duplication patterns.

The highest-impact duplication clusters fall into a few themes:

- **Core data plumbing is duplicated**: JSONL run spill/merge utilities (heap + streaming readers + k-way merge) are implemented in multiple subsystems.
- **Artifact writer scaffolding is repeatedly re-implemented** across `src/index/build/artifacts/writers/*` (compression suffixing, sharding, cleanup, meta emission).
- **Storage build logic is duplicated**: SQLite “build DB from artifacts” vs “build DB from bundles” share large swaths of logic; tools also duplicate runtime build helpers.
- **Correctness-critical math/metadata is duplicated**: embedding quantization normalization appears in multiple codepaths (build + retrieval + rankers).
- **Infra glue is duplicated and drifting**: API vs MCP search argument building and schema validation are not aligned (observed mismatches), and file-locking is implemented in multiple variants.
- **Language/tooling heuristics are duplicated**: signature parsing helpers, signature-line extraction, and JS/TS relation extraction exist as near-parallel implementations.

The consolidation recommendations below are prioritized by:
1) correctness/drift risk  
2) fan-out (number of call sites / number of subsystems touched)  
3) expected refactor effort

---

## Methodology and evidence

### Automated duplicate detection (baseline)
Auto scan summary (see included `duplication_report.md` / `duplication_report.json` for raw output):

- **Scanned:** 1899 code files  
- **Clone window:** 18 normalized lines (min 220 chars)  
- Captures:
  - exact file duplicates (byte-identical)
  - repeated code blocks across files (clone pairs)

### Manual/semantic review (what the automation misses)
Manual inspection focused on:
- “same responsibility, different shape” duplicates (different names/structure, small drift)
- duplicates across **`src/` vs `tools/`** boundaries
- correctness-critical areas: artifact resolution, quantization, locking, ANN gating, risk matching
- places where duplicate code has already **drifted** (behavior mismatches / schema mismatches)

---

## Verification refresh (2026-02-10)

This report was re-verified against the current repository state on `ROPIARY_HEDGE` (branched from `WOOD_SITTER`).

### Outcome summary

- All 27 duplication clusters remain **true** (`confirmed`).
- No false positives were found among the 27 listed clusters.
- Auto-scan exact duplicate groups and sampled top clone pairs still hold.

### Item-by-item verification status

| Item | Status | Verification notes |
|---|---|---|
| 1 | Confirmed | `MinHeap` + `readJsonlRows` + `mergeSortedRuns` still duplicated in `src/shared/merge.js`, `src/index/build/artifacts/helpers.js`, and `src/map/build-map/io.js`; extra local `readJsonlRows` variants remain in `src/index/build/artifacts/writers/vfs-manifest.js` and `src/index/tooling/vfs.js`. |
| 2 | Confirmed | `resolveJsonlExtension` and writer scaffolding remain duplicated across many artifact writers and `src/shared/json-stream.js`. |
| 3 | Confirmed | `src/storage/sqlite/build/from-artifacts.js` and `src/storage/sqlite/build/from-bundles.js` still share large build-pipeline scaffolding with adapter-level differences only. |
| 4 | Confirmed | Exact duplicate `output-paths.js` remains in both `src/storage/sqlite/build/` and `tools/build/sqlite/`; near-duplicate `index-state.js` and no-op task duplication still present. |
| 5 | Confirmed | Quantization normalization still duplicated between `src/storage/sqlite/vector.js`, `src/retrieval/sqlite-helpers.js`, and `src/retrieval/rankers.js`. |
| 6 | Confirmed | SQLite vocab lookup chunking + statement-cache logic still duplicated between `src/storage/sqlite/build/vocab.js` and `src/retrieval/sqlite-helpers.js`. |
| 7 | Confirmed | LMDB codec/presence/meta checks remain duplicated across retrieval, validation, and status modules. |
| 8 | Confirmed | ANN readiness/provider guard logic and backend normalization remain duplicated across providers, CLI, and pipeline code. |
| 9 | Confirmed | API vs MCP argv-mapping duplication and drift remain; API schema still mismatches router (`path` vs `paths`, missing `filter`). |
| 10 | Confirmed | Path normalization + containment logic remains duplicated across `src/shared`, build/scm/integrations, and ingest tooling. |
| 11 | Confirmed | Upward search logic remains duplicated (`git root`, `jj root`, repo/config root, tsconfig lookup). |
| 12 | Confirmed | Map-based LRU patterns remain duplicated in context-pack/graph/tree-sitter areas despite shared cache utilities in `src/shared/cache.js`. |
| 13 | Confirmed | `formatBytes` and path-size traversal utilities remain duplicated across build and tooling modules with format drift. |
| 14 | Confirmed | `warn once` logic remains duplicated (keyed and unkeyed variants) across shared/retrieval/scm/tools paths. |
| 15 | Confirmed | Minified-name regex duplication still exists in `file-scan`, `discover`, and `watch`. |
| 16 | Confirmed | Root normalization duplication remains across discover/watch modules. |
| 17 | Confirmed | File locking remains duplicated across index lock, embeddings cache lock, and service queue lock, with different stale-lock semantics. |
| 18 | Confirmed | Chunking helpers remain duplicated across dispatch and format modules (`ini-toml`, `yaml`, `rst-asciidoc`, `markdown`). |
| 19 | Confirmed | Risk severity ranking and related matching helpers remain duplicated between single-file and interprocedural risk engines. |
| 20 | Confirmed | Relative import resolution candidate generation remains duplicated between build and crossfile inference paths. |
| 21 | Confirmed | Binary discovery helpers remain duplicated across doctor, pyright provider, and tooling utils. |
| 22 | Confirmed | TypeScript loader logic remains duplicated between doctor and typescript provider. |
| 23 | Confirmed | Signature splitter + signature-line extraction logic remains duplicated across tooling parsers and multiple language frontends. |
| 24 | Confirmed | JS/TS relations extraction remains near-parallel with substantial shared logic duplicated. |
| 25 | Confirmed | Map filters still carry duplicate APIs; HTML escaping remains duplicated; config merge logic remains duplicated with array-behavior drift. |
| 26 | Confirmed | AJV scaffolding remains duplicated across config validation, contract validators, and API validation with differing Ajv configs/error handling. |
| 27 | Confirmed | Smaller helper duplications (e.g. `escapeRegex`, `pickMinLimit`, cache manager, redirect/fetch logic) remain present. |

### Auto-scan highlight verification

- Exact duplicate groups remain true:
  - `.pairofcleats.json` group (root + fixture copies)
  - `sublime/**/__init__.py` group
  - `src/storage/sqlite/build/output-paths.js` and `tools/build/sqlite/output-paths.js`
  - graph fixture pairs (`context-pack/*` and `impact/*`)
- Sampled top clone pairs in this report remain materially duplicated and valid.

### Additional duplication clusters found during verification

1. `resolveJsonlExtension` is duplicated twice inside `src/shared/json-stream.js` itself (two local implementations).
2. `normalizeMetaFilters` exists in three places with overlapping behavior:
   - `tools/api/router/search.js`
   - `tools/api/validation.js`
   - `tools/mcp/tools/helpers.js`
3. Map bench scripts duplicate setup/build wiring:
   - `tools/bench/map/build-map-memory.js`
   - `tools/bench/map/build-map-streaming.js`
4. Repo cache defaults are duplicated in API and MCP codepaths:
   - `tools/api/router/cache.js`
   - `tools/mcp/repo.js`

### Drift note captured during verification

- `src/index/build/watch.js` calls `normalizeRoot(...)` in records filtering logic without a local definition/import, while sibling modules define it locally. This is not a duplication claim, but it is a likely correctness issue surfaced during this audit.

---

## Auto-scan highlights (useful for prioritization)

### Exact duplicate file groups (sample)
- 6 files:
  - `./.pairofcleats.json`
  - `./tests/fixtures/encoding/.pairofcleats.json`
  - `./tests/fixtures/formats/.pairofcleats.json`
  - `./tests/fixtures/languages/.pairofcleats.json`
  - `./tests/fixtures/public-surface/.pairofcleats.json`
  - `./tests/fixtures/sample/.pairofcleats.json`

- 3 files:
  - `./sublime/PairOfCleats/__init__.py`
  - `./sublime/PairOfCleats/commands/__init__.py`
  - `./sublime/PairOfCleats/lib/__init__.py`

- 2 files:
  - `./src/storage/sqlite/build/output-paths.js`
  - `./tools/build/sqlite/output-paths.js`

- 2 files:
  - `./tests/fixtures/graph/context-pack/basic.json`
  - `./tests/fixtures/graph/impact/basic.json`

- 2 files:
  - `./tests/fixtures/graph/context-pack/caps.json`
  - `./tests/fixtures/graph/impact/caps.json`

### Top clone pairs (sample)
| Shared blocks | File A | File B |
|---|---|---|
| 87 | `./tools/bench/map/viewer-fps.js` | `./tools/bench/map/viewer-lod-stress.js` |
| 80 | `./src/index/build/artifacts/writers/symbol-edges.js` | `./src/index/build/artifacts/writers/symbol-occurrences.js` |
| 74 | `./src/storage/sqlite/build/from-artifacts.js` | `./src/storage/sqlite/build/from-bundles.js` |
| 69 | `./tests/retrieval/pipeline/ann-optional-skip.test.js` | `./tests/retrieval/pipeline/ann-preflight.test.js` |
| 60 | `./tests/indexing/risk/interprocedural/flows-conservative.test.js` | `./tests/indexing/risk/interprocedural/flows-max-total-flows.test.js` |
| 56 | `./tests/indexing/vfs/vfs-manifest-streaming.test.js` | `./tests/tooling/vfs/vfs-manifest-streaming.test.js` |
| 53 | `./tests/storage/sqlite/sqlite-jsonl-streaming-gzip.test.js` | `./tests/storage/sqlite/sqlite-jsonl-streaming-zstd.test.js` |
| 52 | `./tests/perf/graph-context-pack-latency-bench-contract.test.js` | `./tests/perf/graph-neighborhood-bench-contract.test.js` |
| 51 | `./tests/indexing/artifacts/symbol-artifacts-smoke.test.js` | `./tests/indexing/artifacts/symbols/symbol-by-file-index.test.js` |
| 50 | `./tools/bench/merge/merge-core-throughput.js` | `./tools/bench/merge/spill-merge-compare.js` |
| 48 | `./tests/storage/sqlite/sqlite-chunk-meta-streaming.test.js` | `./tests/storage/sqlite/sqlite-jsonl-streaming-gzip.test.js` |
| 48 | `./tests/storage/sqlite/sqlite-chunk-meta-streaming.test.js` | `./tests/storage/sqlite/sqlite-jsonl-streaming-zstd.test.js` |
| 47 | `./src/index/build/file-processor/cpu.js` | `./src/index/build/file-processor/process-chunks/index.js` |
| 46 | `./src/lang/javascript/relations.js` | `./src/lang/typescript/relations.js` |
| 45 | `./tests/storage/sqlite/sqlite-build-rowcount-contract.test.js` | `./tests/storage/sqlite/sqlite-build-validate-auto-fast-path.test.js` |

*(The full ranked lists are in `duplication_report.md` / `duplication_report.json`.)*

---

# Detailed duplication clusters and recommended consolidations

## 1) JSONL merge/spill utilities duplicated (heap + streaming row reader + k-way merge)

**What this functionality does**
- Maintain sorted “runs” on disk as JSONL
- Stream rows (`readJsonlRows`)
- Merge multiple sorted runs (`mergeSortedRuns`) using a min-heap (`MinHeap`)

**Where it exists (confirmed)**
- `src/shared/merge.js` (**best candidate for canonical home**)
- `src/index/build/artifacts/helpers.js` (re-implements `MinHeap`, `readJsonlRows`, `mergeSortedRuns`)
- `src/map/build-map/io.js` (re-implements `MinHeap`, `readJsonlRows`, `mergeSortedRuns`)
- Additional local `readJsonlRows` variants:
  - `src/index/build/artifacts/writers/vfs-manifest.js`
  - `src/index/tooling/vfs.js`

**Recommendation**
- Make `src/shared/merge.js` the **single source of truth** for:
  - `MinHeap`
  - `readJsonlRows` (+ optional parse override)
  - `mergeSortedRuns` (+ compare/readRun overrides)
- Replace local copies with imports.
- If a local copy exists only to tweak error messages or parsing, add options to the shared functions rather than forking.

**Why this is high priority**
- This is core plumbing. Any performance/correctness fix (IO errors, partial lines, parse policy) should land once.

---

## 2) JSONL writer scaffolding duplicated across artifact writers (compression suffix, sharding, cleanup, meta)

**What this functionality does**
- Choose extension based on compression (`.jsonl`, `.jsonl.gz`, `.jsonl.zst`)
- Measure JSONL bytes to decide single-file vs sharded
- Remove old sibling artifacts (`.jsonl`, `.jsonl.gz`, `.jsonl.zst`, `.meta.json`, `.parts/`)
- Emit meta JSON + register “piece files”

**Where it exists (confirmed hotspots)**
- `src/index/build/artifacts/writers/*` duplicates `resolveJsonlExtension` in many files:
  - `call-sites.js`, `chunk-meta.js`, `chunk-uid-map.js`, `file-relations.js`,
    `risk-interprocedural.js`, `symbol-edges.js`, `symbol-occurrences.js`,
    `symbols.js`, `vfs-manifest.js`
- `src/shared/json-stream.js` also contains a local `resolveJsonlExtension` (inside sharding functions)

**Recommendation**
- Introduce `src/index/build/artifacts/writers/_common.js` (or similar) providing:
  - `resolveJsonlExtension(compression)`
  - `removeArtifactFamily(outDir, baseName)` (cleans siblings + `.parts/`)
  - `measureJsonlRows(rows, serializer?)`
  - `writeShardedJsonlWithMeta(options)` (wrapper around `src/shared/json-stream.js`)
- Refactor writers to call `_common.js`.

**Why this is high priority**
- Writers are a frequent change surface (new artifacts, new compression modes). Duplicated scaffolding is guaranteed drift over time.

---

## 3) SQLite build pipeline is duplicated (from artifacts vs from bundles)

**What this functionality does**
- Create DB, apply pragmas, apply schema
- Stream rows from source, insert in batches
- Emit progress/stats and validate

**Where it exists**
- `src/storage/sqlite/build/from-artifacts.js`
- `src/storage/sqlite/build/from-bundles.js`
- (Related shared pieces exist in) `src/storage/sqlite/build/pragmas.js`, `statements.js`, `multi-row.js`, etc.

**Recommendation**
- Extract shared pipeline core (open DB, apply pragmas, shared insert loops, shared progress/stats) into:
  - `src/storage/sqlite/build/core.js`
- Keep `from-artifacts` / `from-bundles` as adapters that differ primarily on how they enumerate and read rows.

---

## 4) SQLite build helpers duplicated across `src/` and `tools/` (exact + near duplicates)

**Confirmed duplicates**
- Exact duplicate file:
  - `src/storage/sqlite/build/output-paths.js`
  - `tools/build/sqlite/output-paths.js`
- Near-duplicate modules:
  - `src/storage/sqlite/build/index-state.js`
  - `tools/build/sqlite/index-state.js`
- Runner/task/no-op duplication:
  - `src/storage/sqlite/build/runner.js` defines a local `createNoopTask`
  - `tools/shared/cli-display.js` exports `createNoopTask` / `createTaskFactory`

**Recommendation**
- Choose **one canonical location** (prefer `src/storage/sqlite/build/*`) and re-export from tools.
- Remove local no-op task creation in favor of `tools/shared/cli-display.js` (or move the shared task utilities into `src/shared/` if tools should depend on src).

---

## 5) Embedding quantization normalization is re-implemented (correctness drift risk)

**What this functionality does**
- Normalizes dense embedding quantization metadata:
  - `minVal`, `maxVal`, `levels`, derived `scale/step`
- Ensures retrieval-side dequantization matches build-side quantization

**Where it exists (confirmed)**
- Canonical-ish:
  - `src/storage/sqlite/vector.js` (`resolveQuantizationParams`, dequantization helpers)
- Re-implemented:
  - `src/retrieval/sqlite-helpers.js` (manual normalization reading `dense_meta`)
  - `src/retrieval/rankers.js` (manual `levels` + `scale` derivation in ranking path)
- Related:
  - `src/index/build/runtime/embeddings.js` contains related assumptions/constants

**Recommendation**
- Define one canonical “quantization metadata resolver” and reuse everywhere:
  - either re-export `resolveQuantizationParams` from a shared module
  - or move quantization logic into `src/shared/embedding-utils.js` and import from build + retrieval

**Why this is high priority**
- This is silent failure territory: drift doesn’t crash; it degrades retrieval relevance.

---

## 6) SQLite vocab lookups duplicated (chunked `IN (...)` + statement caching)

**What this functionality does**
- Fetch vocab rows by value with chunking to avoid SQLite variable limits
- Cache prepared statements per-DB (WeakMap)

**Where it exists**
- Build path:
  - `src/storage/sqlite/build/vocab.js` (`fetchVocabRows` + statement cache)
- Retrieval path:
  - `src/retrieval/sqlite-helpers.js` (`fetchVocabRows` + statement cache)

**Recommendation**
- Extract a shared helper:
  - `src/storage/sqlite/query-cache.js` or `src/storage/sqlite/vocab-shared.js`
  - Provide placeholder list builder + chunking + cache, used by both build and retrieval.

---

## 7) LMDB codec + presence checks + meta/schema validation duplicated

**What this functionality does**
- Determine LMDB store presence (often `data.mdb` existence)
- Decode values (msgpack `Unpackr`)
- Read meta/schema and validate required keys by mode

**Where it exists**
- decode helper (Unpackr):
  - `src/retrieval/cli-lmdb.js`
  - `src/retrieval/lmdb-helpers.js`
  - `src/index/validate/lmdb.js`
- store-present checks:
  - `src/index/validate/lmdb.js`
  - `src/retrieval/cli/index-loader.js`
  - `src/retrieval/cli-lmdb.js`
  - `src/integrations/core/status.js`

**Recommendation**
- Create a single LMDB utilities module, e.g. `src/storage/lmdb/utils.js` exporting:
  - `hasLmdbStore(dir)`
  - `createLmdbCodec()` / `decode(value)`
  - `readLmdbMeta(db)` + `assertLmdbSchema(...)`

---

## 8) ANN “embedding readiness” + provider boilerplate duplicated

**What this functionality does**
- Gate ANN usage based on:
  - abort signal
  - config enabled
  - embedding availability
  - candidate set size/emptiness
- Normalize backend selection (aliases)

**Where it exists**
- Provider duplicated guard logic:
  - `src/retrieval/ann/providers/dense.js`
  - `src/retrieval/ann/providers/hnsw.js`
  - `src/retrieval/ann/providers/lancedb.js`
  - `src/retrieval/ann/providers/sqlite-vec.js`
- Backend normalization duplicated:
  - `src/retrieval/pipeline/ann-backends.js`
  - `src/retrieval/cli/normalize-options.js`

**Recommendation**
- Create `src/retrieval/ann/utils.js`:
  - `isEmbeddingReady(index, mode)` (or reuse shared vector validators)
  - `shouldRunAnn({ signal, config, index, mode, candidateSet })` (wrapper for consistent provider gating)
- Create one canonical `normalizeAnnBackend` and import it in both CLI and pipeline.

---

## 9) API vs MCP request → CLI argument mapping duplicated (and drifting)

**What this functionality does**
- Converts structured request payloads into the `search` CLI flags
- Normalizes meta filters

**Where it exists**
- API:
  - `tools/api/router/search.js` (`buildSearchParams`)
  - `tools/api/validation.js` (schema + `normalizeMetaFilters`)
- MCP:
  - `tools/mcp/tools/search-args.js` (`buildMcpSearchArgs`)
  - `tools/mcp/tools/helpers.js` (`normalizeMetaFilters`)

**Observed drift / bug**
- API router expects `payload.paths` (plural array), but API validator schema only allows `path` (string or array). With `additionalProperties: false`, valid client requests can be rejected.
- API router supports `payload.filter`, but API schema does not include `filter` → requests using `filter` will fail validation.

**Recommendation**
- Create a single shared “search request normalization + argv builder” module used by:
  - API router
  - MCP tools
  - API validation schema generation (ideally derived from the same source)

**Why this is high priority**
- This is not just maintenance cost; it’s an active correctness defect surface.

---

## 10) Path normalization + containment checks duplicated across subsystems

**What this functionality does**
- Convert absolute paths into repo-relative POSIX paths
- Enforce “path is inside root/repo” constraints (`isInside`, `isPathUnderDir`)
- Normalize casing / separators across platforms

**Where it exists (non-exhaustive confirmed set)**
- Canonical-ish:
  - `src/shared/path-normalize.js`
- Re-implementations / variants:
  - `src/index/scm/paths.js`
  - `src/index/build/import-resolution.js`
  - `src/context-pack/assemble.js`
  - `src/integrations/core/status.js`
  - `src/integrations/triage/index-records.js`
  - `tools/shared/path-utils.js`
  - Ingest tooling variants:
    - `tools/ingest/ctags.js`, `gtags.js`, `lsif.js`, `scip.js`

**Recommendation**
- Expand/standardize `src/shared/path-normalize.js` to include:
  - `isInside(root, target)` (shared containment check)
  - a single “repo-relative posix path” helper used everywhere
- Replace local implementations.

---

## 11) “Find upwards until root/config” logic duplicated (git root, jj root, tsconfig, config root)

**Where it exists**
- `src/index/scm/providers/git.js` (`findGitRoot`)
- `src/index/scm/providers/jj.js` (`findJjRoot`)
- `tools/dict-utils/paths/repo.js` (config root + repo root)
- `src/index/tooling/typescript-provider.js` (nearest tsconfig search)
- Similar “walk up” patterns appear elsewhere

**Recommendation**
- Introduce a shared `findUpwards(startDir, predicate)` helper in `src/shared/fs/find-upwards.js`.

---

## 12) Multiple small “Map-based LRU” caches duplicated

**Where it exists**
- `src/context-pack/assemble.js` (multiple caches + get/set helpers)
- `src/graph/neighborhood.js`
- `src/graph/suggest-tests.js`
- `src/lang/tree-sitter/chunking.js`

**Existing shared alternative**
- `src/shared/cache.js` (LRU abstractions)

**Recommendation**
- Replace custom Map-LRU patterns with a shared LRU utility (either use existing `src/shared/cache.js` or add a tiny `touchLruMapGet/Set` helper).

---

## 13) Disk sizing + byte formatting duplicated

**Where it exists**
- Canonical:
  - `src/shared/disk-space.js` (`formatBytes`, `estimateDirBytes`)
- Duplicates / variants:
  - `src/index/build/artifacts/helpers.js` (`formatBytes`)
  - `src/index/build/artifacts/writers/chunk-meta.js` (`formatBytes`)
  - `src/integrations/core/status.js` (`sizeOfPath`)
  - `tools/index/cache-gc.js` (`sizeOfPath`, `formatBytes`)
  - `tools/index/report-artifacts.js` (`formatBytes`)
  - Bench scripts contain additional `formatBytes` variants

**Recommendation**
- Standardize on `src/shared/disk-space.js` as the single source of truth for formatting and (if needed) traversal.

---

## 14) “warn once” utilities duplicated (keyed + unkeyed variants)

**Where it exists**
- `src/shared/json-stream/runtime.js` (keyed)
- `src/index/scm/providers/jj.js` (keyed)
- `src/retrieval/embedding.js` (unkeyed)
- `src/retrieval/lancedb.js` (unkeyed)
- `tools/sqlite/vector-extension.js` (keyed)

**Recommendation**
- Create `src/shared/logging/warn-once.js` (supports keyed and unkeyed) and import everywhere.

---

## 15) Minified-file detection duplicated

**Where it exists**
- `src/index/build/file-scan.js` (`MINIFIED_NAME_REGEX`)
- `src/index/build/discover.js` (`minifiedNameRegex`)
- `src/index/build/watch.js` (`MINIFIED_NAME_REGEX`)

**Recommendation**
- Extract `isMinifiedName(baseName)` into a shared build helper module.

---

## 16) Root normalization duplicated across build/watch modules

**Where it exists**
- `src/index/build/discover.js`
- `src/index/build/watch/guardrails.js`
- `src/index/build/watch/records.js`
- `src/index/build/watch.js`

**Recommendation**
- One `normalizeRootPath()` helper.

---

## 17) File locking duplicated (index lock, embeddings cache lock, service queue lock)

**Where it exists**
- `src/index/build/lock.js`
- `tools/build/embeddings/cache.js`
- `tools/service/queue.js`

**Recommendation**
- Create a shared `withFileLock(lockPath, options, fn)` primitive with consistent stale-lock logic and process-alive checks.

---

## 18) Chunking helpers duplicated across formats

**Where it exists**
- `src/index/chunking/dispatch.js` defines `buildChunksFromLineHeadings`
- Duplicated copies in:
  - `src/index/chunking/formats/ini-toml.js`
  - `src/index/chunking/formats/yaml.js`
  - `src/index/chunking/formats/rst-asciidoc.js`
- `buildChunksFromMatches` duplicated in:
  - `src/index/chunking/formats/markdown.js`
  - `src/index/chunking/formats/rst-asciidoc.js`

**Recommendation**
- Extract shared chunk builders into `src/index/chunking/helpers.js` and import from format modules.

---

## 19) Risk utilities duplicated between single-file and interprocedural engines

**Where it exists**
- `src/index/risk.js` (`SEVERITY_RANK`, identifier char logic, rule matching)
- `src/index/risk-interprocedural/engine.js` (similar boundary/rule matching)
- `src/index/risk-interprocedural/summaries.js` duplicates severity ranking

**Recommendation**
- Extract shared risk utilities (severity ranking + identifier boundary scan + rule pattern matching) into a single module used by both engines.

---

## 20) Relative import resolution duplicated (build vs crossfile inference)

**Where it exists**
- `src/index/type-inference-crossfile/resolve-relative-import.js`
- `src/index/build/import-resolution.js` (relative candidate generation plus extra mapping)

**Recommendation**
- Extract “specifier → candidate paths” logic into a shared helper that can be wired to different existence checks (fileSet vs filesystem).

---

## 21) Tooling: binary discovery helpers duplicated (doctor / pyright / tools tooling)

**Where it exists**
- `src/index/tooling/doctor.js` (`candidateNames`, `findBinaryInDirs`, etc.)
- `src/index/tooling/pyright-provider.js` (same)
- `tools/tooling/utils.js` (same)

**Recommendation**
- Extract into a shared `binary-utils.js` module and import from all three.

---

## 22) Tooling: TypeScript loader duplicated

**Where it exists**
- `src/index/tooling/doctor.js` (`resolveTypeScript`)
- `src/index/tooling/typescript-provider.js` (`loadTypeScript`)

**Recommendation**
- Extract a shared loader (`src/index/tooling/typescript/load.js`) used by both.

---

## 23) Language signature parsing utilities duplicated

### A) Signature parameter splitting logic duplicated (C-like / Python / Swift)
- `src/index/tooling/signature-parse/clike.js`
- `src/index/tooling/signature-parse/python.js`
- `src/index/tooling/signature-parse/swift.js`

**Recommendation**
- Shared top-level param splitting helper that handles quotes/brackets depth and separators.

### B) `readSignatureLines` duplicated in many language frontends
- `src/lang/clike.js`, `csharp.js`, `go.js`, `java.js`, `kotlin.js`,
  `perl.js`, `php.js`, `rust.js`, `shell.js`, `lang/typescript/signature.js`

**Recommendation**
- Move `readSignatureLines` into `src/lang/shared.js` and import from all languages.

---

## 24) JS vs TS relations extraction duplicated

**Where it exists**
- `src/lang/javascript/relations.js`
- `src/lang/typescript/relations.js`

**Recommendation**
- Extract shared AST-walk/name-resolution helpers into a common module, keep language-specific AST shape handling minimal.

---

## 25) Map: filters have duplicate APIs (unused duplicates), escape helpers, config merge

**Where it exists**
- `src/map/build-map/filters.js` contains both:
  - `createScopeFilters(...)` (used)
  - `applyScopeFilter(...)` (unused duplicate)
  - `createCollapseTransform(...)` (used)
  - `applyCollapse(...)` (unused duplicate)
- HTML escaping duplicated:
  - `src/map/dot-writer.js`
  - `src/map/html-writer.js`
- Config merge duplicated:
  - `src/map/isometric/client/dom.js` (`mergeConfig`)
  - `src/shared/config.js` (`mergeConfig`) — similar intent with different array behavior

**Recommendation**
- Delete unused duplicates in filters.js
- Extract `escapeHtml` to a shared helper
- Either standardize on `src/shared/config.mergeConfig` or add an option for array handling and reuse it in the map client

---

## 26) AJV validation scaffolding duplicated (contracts + config + tools API)

**Where it exists**
- `src/config/validate.js`
- `src/contracts/validators/{analysis,artifacts,build-state}.js`
- `tools/api/validation.js`

**Recommendation**
- Introduce a shared schema-validator factory (Ajv config + compile + error formatting) and use it in all validators.

---

## 27) Misc. smaller but real duplicates worth cleaning up

- `escapeRegex` duplicated:
  - `src/index/build/import-resolution.js`
  - `tools/release/check.js`
- `pickMinLimit` duplicated:
  - `src/index/build/file-processor/read.js`
  - `src/index/build/preprocess.js`
  - `src/index/build/runtime/caps.js`
- Repo cache manager duplicated:
  - `tools/api/router/cache.js`
  - `tools/mcp/repo.js`
- Download redirect/fetch logic duplicated:
  - `tools/download/dicts.js`
  - `tools/download/extensions.js`

---

# Prioritized consolidation plan

## Phase 1 — stop drift in correctness-critical logic
1) **Unify API/MCP search request → argv mapping + schema** (fix `paths` vs `path`, add missing `filter`)  
2) **Unify embedding quantization normalization** (one source of truth)  
3) **Unify file-locking primitive** (index/build + embeddings cache + service queue)  
4) **Unify artifact compression suffix resolution** (`resolveJsonlExtension` + artifact presence checks)

## Phase 2 — high ROI refactors
5) **Unify JSONL merge/spill utilities** (`MinHeap`, `readJsonlRows`, `mergeSortedRuns`)  
6) **Unify artifact writer scaffolding** (`writers/_common.js`)  
7) **Refactor SQLite build pipeline** into shared core (`core.js`)  
8) **Unify backend normalization** (`normalizeAnnBackend`) + provider guardrails

## Phase 3 — cleanup / consistency passes
9) **Path normalization + find-upwards helpers**  
10) **Shared LRU/cache helpers**  
11) **Language frontends shared parsing helpers** (`readSignatureLines`, signature splitting)  
12) **AJV validation scaffolding**  
13) Remaining small helpers (`formatBytes`, `warnOnce`, `escapeRegex`, etc.)

---

# Coordination: coverage and remaining review surface

## Areas inspected in this effort (manual spot-check + semantic review)
- `src/shared/*` (merge, json-stream, path-normalize, cache, disk-space, config, embedding utils)
- `src/index/build/*` (discover/watch, lock, preprocess, file-processor, artifacts/helpers, many writers)
- `src/storage/sqlite/*` + `src/storage/sqlite/build/*`
- `src/storage/lmdb/*` (schema) + LMDB loader/validator call sites
- `src/retrieval/*` (pipeline components, rankers, sqlite/lmdb helpers, ANN providers, CLI normalize)
- `src/index/chunking/*` + several format modules
- `src/index/risk*` + `src/index/risk-interprocedural/*`
- `src/index/tooling/*` (doctor, providers, signature-parse)
- `src/lang/*` (signature-line extraction and JS/TS relations focus)
- `src/map/*` (build-map filters/io, writers, isometric client config)
- `tools/api/*`, `tools/mcp/*`, `tools/service/*`, `tools/download/*`, `tools/tooling/*`

## Remaining to check (recommended split across owners)
These areas likely contain additional “semantic duplicates” but were not exhaustively audited:

1) **`src/lang/*` deeper pass** (imports parsing, chunking heuristics, doc parsing)  
2) **`src/graph/*` deeper pass** (impact/neighborhood/architecture for repeated graph traversal + caching utilities)  
3) **`src/index/build/*` full pass** (beyond the highlighted helpers; more filesystem/progress/reporting patterns likely exist)  
4) **`tools/index/*`, `tools/build/*` beyond the highlighted parts** (often re-implements src utilities)  
5) **Benchmarks + tests duplication triage** (`tools/bench/*`, `tests/*`) — decide whether to consolidate harness/helpers or treat as acceptable duplication.

---

# Opinion on the project and its goals

From the structure and breadth of modules, this project is aiming to be a **general-purpose local code intelligence/indexing system**: build indexes, store them in multiple backends, support high-performance retrieval (including ANN), provide tooling and integrations, and ship a map/viewer + services.

That’s an ambitious (and reasonable) goal, but it creates a predictable pressure toward duplication:

- each subsystem (build, retrieval, tools, service) tends to “grow its own utilities”
- duplicated correctness logic (quantization, artifact resolution, lock semantics) becomes the highest-risk form of duplication

The push to consolidate into a small, well-owned shared core is directionally correct. The biggest architectural decision that will pay off is tightening the **`src/` vs `tools/`** boundary: either make tools thin wrappers around runtime core modules, or formally introduce “tools shared” modules and prohibit `src`↔`tools` copy/paste.

If the goal is “reduce maintenance load without slowing feature work,” the most valuable approach is:
1) consolidate correctness-critical shared logic first (quantization, artifact resolution, locks, request normalization)  
2) then consolidate big scaffolding blocks (writers, sqlite builders)  
3) then sweep up smaller utilities

---

## Appendix: supporting artifacts

- `duplication_report.md` / `duplication_report.json` — auto-generated clone + exact duplicate results
- `duplication_report_items1-3_manual.md` — manual review notes for storage/retrieval/map (items 1–3)
