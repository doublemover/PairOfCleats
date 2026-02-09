# DEPRECATED
- Canonical replacement: `docs/specs/tree-sitter-native-scheduler.md`
- Reason: superseded by native-only tree-sitter scheduler/runtime; WASM lifecycle behavior was removed from indexing paths.
- Archived on: `2026-02-09T18:53:21.1939237Z`
- PR/commit: `WOOD_SITTER N6 native-only tree-sitter cutover (local commit)`

# Spec: Tree-sitter Runtime and Caching (Phase 16.11)

Status: Draft (Milestone A). Performance + determinism contract for the tree-sitter runtime.

Goal: maximize Stage1 parse/chunk throughput while keeping WASM-backed memory bounded (especially on Windows) and preserving deterministic chunk outputs.

Non-goals:
- Define language-specific chunking rules (that lives in grammar config under `src/lang/tree-sitter/config.js`).
- Require tree-sitter for all languages (heuristic chunking remains the fallback).

---

## 1) Components (code map)

Runtime + caches:
- `src/lang/tree-sitter/runtime.js`
- `src/lang/tree-sitter/state.js`

Chunking:
- `src/lang/tree-sitter/chunking.js`

Worker pool (optional):
- `src/lang/tree-sitter/worker.js`
- `src/lang/workers/tree-sitter-worker.js`

Batching/scheduling glue:
- `src/index/build/indexer/steps/process-files/tree-sitter.js`
- `src/index/build/indexer/steps/process-files.js`

---

## 2) WASM grammar caching (normative)

### 2.1 Alias dedupe

Languages that share a single wasm file (e.g., `javascript` and `jsx`) MUST share a single loaded grammar instance.

Implementation detail:
- The cache is keyed by wasm filename (see `LANGUAGE_WASM_FILES` in `src/lang/tree-sitter/config.js`).

### 2.2 In-flight load dedupe

Concurrent calls to load the same wasm file MUST be deduplicated so only one load occurs at a time per wasm key.

### 2.3 LRU eviction + caps

The runtime MUST bound retained grammars with `maxLoadedLanguages` and evict LRU entries when the cache exceeds the cap.

Default policy (current):
- Main thread: default to retaining all supported grammars (compat with synchronous parsing paths).
- Worker threads: conservative defaults (caches multiply per worker thread).

The active grammar on the shared parser MUST NOT be evicted.

---

## 3) Parser strategy (normative)

### 3.1 Single shared `Parser`

The runtime MUST use a single shared `Parser` instance and switch languages by calling `parser.setLanguage(language)`.

Rationale:
- Parser instances can retain non-trivial native/WASM memory.
- One-parser-per-language can balloon memory on polyglot repos and trigger V8 "Zone" OOMs on Windows.

### 3.2 Memory cleanup requirements

Tree-sitter `Tree` objects MUST be explicitly released via `tree.delete()` after chunk extraction.

Parsers SHOULD be reset between parses (`parser.reset()`) to limit retained internal parse allocations across long indexing runs.

---

## 4) Load modes (path vs bytes) (normative)

When loading a grammar, the runtime SHOULD prefer path-based loading to avoid retaining large wasm buffers in JS:

1. Try `Language.load(<path>)`.
2. If path-based loading fails, fall back to reading bytes and calling `Language.load(<bytes>)`.

Telemetry MUST record which mode was used (path vs bytes) and when a fallback occurred.

---

## 5) Scheduling + determinism (normative)

### 5.1 Batch-by-language scheduling

When `batchByLanguage` is enabled, Stage1 may reorder file processing to improve throughput by reducing repeated WASM language switches.

Determinism requirements:
- Chunk outputs for a given file MUST be independent of scheduling strategy (file-order vs batch-by-language).
- Final artifact ordering MUST remain stable. Any internal reordering MUST be reconciled by an ordered-append/flush invariant.

### 5.2 Preload planning

Preload planning MUST be deterministic and bounded:
- Stable ordering (frequency desc, then language id).
- Stable caps (`maxLoadedLanguages`).
- Avoid redundant preloads when possible (cached grammars are OK; avoid repeated cold loads).

---

## 6) Telemetry + stage audit (normative)

The runtime MUST expose counters for:
- WASM loads/missing/failures/evictions.
- WASM load modes (`wasmLoadPath`, `wasmLoadBytes`, `wasmLoadPathFallbackBytes`).
- Parser activations (language switches).
- Query cache hits/misses/builds/failures.
- Chunk cache hits/misses/sets/evictions.
- Worker fallbacks and parse timeouts.

Stage audit MUST capture the tree-sitter stats object in `stage1` checkpoints:
- `extra.treeSitter = getTreeSitterStats()`

---

## 7) Tests (informative)

Key coverage:
- Preload ordering + maxLoadedLanguages bounds.
- Eviction determinism.
- Query cache reuse.
- Worker prune bounds.
- Batch-by-language determinism and fallback behavior.
