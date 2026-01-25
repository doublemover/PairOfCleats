# Codebase Static Review Findings — Pass 5 (Artifacts, Chunking, Language Registry, Risk, ANN)

This document is a targeted static review of the files you listed (and **only** those files). The goal is to identify **bugs**, **mis-implementations**, **correctness gaps**, **configuration pitfalls**, and a handful of **performance / scalability hazards** that could bite as you push toward a streaming, WASM-grouped indexing pipeline and richer graph-aware features.

## Scope

### Files reviewed

**Index build artifacts + state + postings + shards + tokenization**
- `src/index/build/artifacts/compression.js`
- `src/index/build/artifacts/file-meta.js`
- `src/index/build/artifacts/filter-index.js`
- `src/index/build/artifacts/metrics.js`
- `src/index/build/artifacts/schema.js`
- `src/index/build/artifacts/token-mode.js`
- `src/index/build/artifacts/writer.js`
- `src/index/build/artifacts/writers/file-relations.js`
- `src/index/build/artifacts/writers/repo-map.js`
- `src/index/build/build-state.js`
- `src/index/build/file-processor/cached-bundle.js`
- `src/index/build/file-processor/embeddings.js`
- `src/index/build/file-processor/skip.js`
- `src/index/build/imports.js`
- `src/index/build/indexer/steps/postings.js`
- `src/index/build/postings.js`
- `src/index/build/shards.js`
- `src/index/build/state.js`
- `src/index/build/tokenization.js`

**Chunking + chunk IDs + auxiliary indexing helpers**
- `src/index/chunk-id.js`
- `src/index/chunking.js`
- `src/index/chunking/dispatch.js`
- `src/index/chunking/formats/ini-toml.js`
- `src/index/chunking/formats/json.js`
- `src/index/chunking/formats/markdown.js`
- `src/index/chunking/formats/rst-asciidoc.js`
- `src/index/chunking/formats/xml.js`
- `src/index/chunking/formats/yaml.js`
- `src/index/chunking/limits.js`
- `src/index/chunking/tree-sitter.js`
- `src/index/comments.js`
- `src/index/embedding.js`
- `src/index/field-weighting.js`
- `src/index/headline.js`

**Language registry + import collectors + simple relations + control-flow summarization**
- `src/index/language-registry.js`
- `src/index/language-registry/control-flow.js`
- `src/index/language-registry/import-collectors/cmake.js`
- `src/index/language-registry/import-collectors/dart.js`
- `src/index/language-registry/import-collectors/dockerfile.js`
- `src/index/language-registry/import-collectors/graphql.js`
- `src/index/language-registry/import-collectors/groovy.js`
- `src/index/language-registry/import-collectors/handlebars.js`
- `src/index/language-registry/import-collectors/jinja.js`
- `src/index/language-registry/import-collectors/julia.js`
- `src/index/language-registry/import-collectors/makefile.js`
- `src/index/language-registry/import-collectors/mustache.js`
- `src/index/language-registry/import-collectors/nix.js`
- `src/index/language-registry/import-collectors/proto.js`
- `src/index/language-registry/import-collectors/r.js`
- `src/index/language-registry/import-collectors/razor.js`
- `src/index/language-registry/import-collectors/scala.js`
- `src/index/language-registry/import-collectors/starlark.js`
- `src/index/language-registry/import-collectors/utils.js`
- `src/index/language-registry/registry.js`
- `src/index/language-registry/simple-relations.js`

**Risk + structural + signature parsing + cross-file type inference primitives**
- `src/index/minhash.js`
- `src/index/risk-rules.js`
- `src/index/structural.js`
- `src/index/tooling/signature-parse/clike.js`
- `src/index/tooling/signature-parse/python.js`
- `src/index/tooling/signature-parse/swift.js`
- `src/index/type-inference-crossfile.js`
- `src/index/type-inference-crossfile/apply.js`
- `src/index/type-inference-crossfile/constants.js`
- `src/index/type-inference-crossfile/extract.js`
- `src/index/type-inference-crossfile/symbols.js`

**Retrieval ANN providers + bitmap utilities**
- `src/retrieval/ann/providers/dense.js`
- `src/retrieval/ann/providers/hnsw.js`
- `src/retrieval/ann/providers/lancedb.js`
- `src/retrieval/ann/providers/sqlite-vec.js`
- `src/retrieval/ann/types.js`
- `src/retrieval/bitmap.js`

---

## Executive summary

### Highest priority correctness issues

1. **Chargram postings can be silently truncated for a chunk** due to an unintended `return` inside a loop, which stops processing the remainder of the token stream when any single token exceeds `chargramMaxTokenLength`. This is a real recall-impacting bug.
   - `src/index/build/state.js` (`addFromTokens()`)

2. **Shard balancing can create `lang: mixed` shards**, which is directly at odds with “WASM grouping is not optional.” Today this is triggered when `maxShards` is set and `balanceShardsGreedy()` merges shards across language boundaries.
   - `src/index/build/shards.js` (`balanceShardsGreedy()`)

3. **Import scanning can drop configuration/options for per-language collectors** due to an options-wrapper bug in `collectLanguageImports()`. This undermines both correctness (missing imports) and performance (missed AST reuse).
   - `src/index/language-registry/registry.js` (`collectLanguageImports()`)

4. **Cached bundle reuse hardcodes `hashAlgo: 'sha1'`** even when the caller provides a different `fileHashAlgo`. This can corrupt invariants and introduce subtle incremental-index drift.
   - `src/index/build/file-processor/cached-bundle.js`

5. **ANN providers can report “available” based on external provider state but still pass a missing `idx.*` object into the ranker**, risking crashes or silent no-ops.
   - `src/retrieval/ann/providers/hnsw.js`, `src/retrieval/ann/providers/lancedb.js`

### Key performance / scalability hazards (worth addressing if you want a true streaming pipeline)

- JSON chunking’s non-tree-sitter path uses `JSON.parse()` and repeated slicing/scanning that can go quadratic on large files.
  - `src/index/chunking/formats/json.js`

- Import scanning can re-read full file content (and re-parse) in addition to the main file processing path. This is a throughput killer at scale.
  - `src/index/build/imports.js`

- Some artifact writers pre-scan iterators to estimate output size (double iteration). For very large artifacts (e.g., file relations), this is a material extra pass.
  - `src/index/build/artifacts/writers/file-relations.js`

---

## Findings

### 1) Critical — Chargram extraction stops after the first long token

**Where**
- `src/index/build/state.js` — `addFromTokens()`

**Evidence**
- Inside the per-token loop, the max-token-length guard exits the whole function:
  - `src/index/build/state.js:257`

**Why this is a real bug**
- The intent of `chargramMaxTokenLength` is to skip pathological tokens, not to abandon processing of all subsequent tokens.
- This is particularly damaging for minified code or files with long identifiers/URLs: if a long token appears early in token order, most postings/chargrams are never recorded.

**Impact**
- Recall loss in chargram-backed matching.
- Skewed doc-length / scoring signals (chunk looks much “smaller” than it is).
- Silent (no warning), so it’s hard to attribute ranking regressions.

**Suggested fix direction**
- Replace the `return` with `continue` so only the single token is skipped.

**Tests to add**
- Unit test for `appendChunk()` that:
  - sets `chargramEnabled=true`, `chargramMaxTokenLength` small,
  - provides tokens like `["aaaaaaaaaaaaaaaa", "keepme", "alsokeep"]`,
  - asserts postings/chargrams still include `keepme` and `alsokeep`.

---

### 2) High — Shard balancer can intentionally create mixed-language shards (conflicts with WASM grouping)

**Where**
- `src/index/build/shards.js` — `balanceShardsGreedy()`
  - `src/index/build/shards.js:301–343`

**What’s wrong**
- When `maxShards` is used, the balancer merges arbitrary shards together and emits a new shard with:
  - `lang: 'mixed'`
  - `languageId: 'mixed'`
  - `dir: 'balanced'`

**Why this is a problem**
- Your roadmap direction is explicit that **WASM grouping and sharding are central** (minimize repeated WASM loads; process language batches coherently).
- Mixed-language shards ensure that language-specific runtime needs (tree-sitter WASM, tooling providers, per-language segmentation rules) cannot be batch-optimized.

**Impact**
- Defeats “load WASM once per language group” execution.
- Raises peak memory (multiple language runtimes active within the same shard batch).
- Makes streaming optimizations harder (mixed pipelines; harder to set stable backpressure targets).

**Suggested fix direction**
- Add a balancer constraint mode that preserves grouping by:
  - language ID (minimum), and ideally
  - *WASM module identity* (if multiple language IDs share a module, or if one language uses multiple modules).
- If you still need a global `maxShards`, apply balancing *within each language group first*, then optionally merge only same-group shards.

**Tests to add**
- A deterministic shard-plan fixture with two languages and `maxShards=1` should:
  - either refuse (explicit error) or
  - only merge within language constraints (i.e., produce >= 2 shards).

---

### 3) High — Per-language import collector options are nested incorrectly (options-wrapper bug)

**Where**
- `src/index/language-registry/registry.js` — `collectLanguageImports()`
  - `src/index/language-registry/registry.js:645–649`

**Evidence**
- Options are passed as `{ ext, relPath, mode, options }`, which nests caller options under `options`.

**Why this is a real bug**
- Many import collectors and downstream parsers expect options at the top level (e.g., `options.typescript`, `options.ast`, parser toggles).
- This wrapper object makes them behave as if options are unset.

**Impact**
- Incorrect import sets → incorrect `allImports` → incorrect `importLinks`.
- Lost AST reuse can cause unnecessary parsing.
- Graph-aware features that depend on import graphs become noisier or incorrect.

**Suggested fix direction**
- Merge caller options into the object passed to `lang.collectImports()` rather than nesting.

**Tests to add**
- Unit test that passes a sentinel option expected by a collector (e.g., an AST reuse flag) and asserts the collector path that depends on it is taken.

---

### 4) High — Cached bundle reuse hardcodes `hashAlgo: 'sha1'`

**Where**
- `src/index/build/file-processor/cached-bundle.js`
  - `fileInfo.hashAlgo: resolvedHash ? 'sha1' : null` (`src/index/build/file-processor/cached-bundle.js:55–60`)

**What’s wrong**
- The function receives `fileHashAlgo` as an argument, but does not use it for `fileInfo.hashAlgo`.
- If `fileHashAlgo` ever changes (or if cached bundles were created with a different algorithm), the cached bundle path can emit inconsistent metadata.

**Impact**
- Incremental indexing / manifest invariants can drift (downstream assumes hashAlgo matches hash).
- Makes it hard to safely evolve hashing strategy without a full cache invalidation.

**Suggested fix direction**
- Persist and respect `hashAlgo` alongside `hash` in cached manifests/bundles.
- Prefer `fileHashAlgo` when provided; otherwise fall back to the cached bundle’s recorded algo.

**Tests to add**
- A cached-bundle reuse fixture where `fileHashAlgo !== 'sha1'` should:
  - emit the correct algo,
  - and ensure `bundle cache hit` metadata remains consistent.

---

### 5) High — ANN provider “availability” can be inconsistent with the object passed to rankers

**Where**
- `src/retrieval/ann/providers/hnsw.js`
  - `isAvailable()` considers `hnswAnnState[mode]?.available`, but `query()` passes `idx.hnsw || {}` (`src/retrieval/ann/providers/hnsw.js:10–31`).
- `src/retrieval/ann/providers/lancedb.js`
  - Same pattern: availability can come from `lanceAnnState`, but `query()` passes `lancedbInfo: idx.lancedb` (`src/retrieval/ann/providers/lancedb.js:10–35`).

**What’s wrong**
- The provider can report itself as available even when `idx.hnsw` / `idx.lancedb` is missing or incomplete.

**Impact**
- Depending on how `rankHnswIndex()` / `rankLanceDb()` handle missing info:
  - crash at query time, or
  - silent fallback to empty results.
- Hard-to-debug “ANN sometimes works” behavior in multi-mode setups.

**Suggested fix direction**
- Align the availability check with the exact shape passed to rankers:
  - either require `idx.*` to be present, or
  - pass the required object from the external state when `idx.*` is missing.

**Tests to add**
- Provider contract test:
  - when `isAvailable()` is true, `query()` must not throw when invoked with a minimal index object.

---

### 6) Medium — Token retention mode parsing is inconsistent across the codebase

**Where**
- `src/index/build/indexer/steps/postings.js`
  - `tokenModeRaw` is not normalized (case/whitespace) before validating (`src/index/build/indexer/steps/postings.js:20–25`).
- `src/index/build/artifacts/token-mode.js`
  - The same concept *is* normalized via `.toLowerCase().trim()`.

**What’s wrong**
- If a user config passes `"Auto"`, `"FULL"`, or includes trailing whitespace, behavior differs between these two code paths.

**Impact**
- Surprising runtime behavior and configuration drift.

**Suggested fix direction**
- Centralize token-mode normalization (single helper) and use it everywhere.

**Tests to add**
- Config normalization test: `chunkTokenMode: "FULL"` should resolve identically regardless of which path executes.

---

### 7) Medium — Token retention auto-switch to `sample` may not propagate to all states

**Where**
- `src/index/build/indexer/steps/postings.js`
  - When `tokenTotal > tokenMaxTotal`, it sets `tokenRetention.mode = 'sample'` and applies retention to `mainState` and `stateRef`.

**Why it’s risky**
- If there are multiple worker/local states merged later, only the states touched at the moment of switching are guaranteed to have retention applied.

**Impact**
- Some chunks may retain full tokens while others are sampled, without a clear rule.

**Suggested fix direction**
- Treat the mode switch as a global build decision:
  - either enforce it at merge time, or
  - apply retention at a single centralized stage after all shards are assembled.

---

### 8) Medium — `file_meta` aggregation uses truthiness checks that can mask real values

**Where**
- `src/index/build/artifacts/file-meta.js`

**What’s wrong**
- Several fields are “filled in” only when the current value is falsy. This is dangerous for valid falsy values (especially `0`) and for arrays like `[]`.
- Example failure mode:
  - if `externalDocs` is first seen as `[]` (truthy), later chunks with non-empty `externalDocs` will not update it.

**Impact**
- Incomplete or misleading file metadata, which can cascade into UI filters and provenance views.

**Suggested fix direction**
- Replace truthiness checks with explicit “is missing” checks:
  - for numbers: `Number.isFinite()`
  - for arrays: `Array.isArray(x) && x.length > 0` / merge union.

**Tests to add**
- Fixture where chunk A has `externalDocs: []` and chunk B has `externalDocs: ['x']`; aggregated file-meta must include `['x']`.

---

### 9) Medium — Index metrics writer does meaningful work outside its `try/catch`

**Where**
- `src/index/build/artifacts/metrics.js`
  - `getEffectiveConfigHash()` and `getRepoProvenance()` run before the `try` block.

**What’s wrong**
- If config hashing or repo discovery throws, the whole index build can fail in a place you likely intended to be “best effort.”

**Impact**
- Avoidable hard failures during build metrics emission.

**Suggested fix direction**
- Move those calls inside the `try` and degrade gracefully.

**Tests to add**
- Simulate `getRepoProvenance()` throwing (mock) and assert that index build proceeds with a warning.

---

### 10) Medium — Import scanning can re-read and re-parse files independently of the main pipeline

**Where**
- `src/index/build/imports.js` — `scanImports()`

**What’s wrong**
- `scanImports()` reads full file text for each file (`readTextFile(absPath)`), then separately the main file processor will read the file again for chunking/enrichment.

**Impact**
- Higher I/O and CPU than necessary, directly reducing throughput.

**Suggested fix direction**
- Integrate import scanning into the main file processing stage (single read, shared AST / parse artifacts).
- If you keep it separate, at least support using cached file text or cached AST from the file processor.

---

### 11) Medium — JSON chunker can be quadratic and memory-heavy on large JSON

**Where**
- `src/index/chunking/formats/json.js`

**What’s wrong**
- The non-tree-sitter path uses `JSON.parse(text)` just to validate the structure.
- The key scanner uses repeated `slice()` calls when skipping whitespace, which can become quadratic.

**Impact**
- Large JSON can produce memory blowups or long stalls.

**Suggested fix direction**
- Prefer the tree-sitter path by default for JSON.
- Replace slicing-based whitespace search with index-based scanning.

---

### 12) Medium — XML chunker is fragile (self-close with whitespace; attribute edge cases)

**Where**
- `src/index/chunking/formats/xml.js`

**What’s wrong**
- `selfClose = header.endsWith('/>')` will not detect `<tag />` (space before `/>`).
- `closeIdx = text.indexOf('>', i)` can break when `>` appears inside quoted attribute values.

**Impact**
- Incorrect chunk boundaries for real-world XML/HTML-ish files.

**Suggested fix direction**
- If tree-sitter chunking is available for XML-like grammars, strongly prefer it.
- If keeping a heuristic parser, improve self-close detection (trim trailing whitespace) and make tag-end scanning quote-aware.

---

### 13) Medium — Chunk splitting by bytes can be expensive

**Where**
- `src/index/chunking/limits.js`

**What’s wrong**
- `resolveByteBoundary()` repeatedly slices strings and calls `Buffer.byteLength()`, resulting in repeated scans of large substrings.

**Impact**
- Large chunks / large files see disproportionate CPU cost in chunk splitting.

**Suggested fix direction**
- Consider approximating UTF-8 byte count from code points for rough cuts, then “snap” locally.
- Or precompute a small byte-offset index at a coarse granularity.

---

### 14) Medium — `file-relations` writer double-iterates to estimate size

**Where**
- `src/index/build/artifacts/writers/file-relations.js`

**What’s wrong**
- It pre-iterates all entries to compute `totalBytes` and `totalJsonlBytes`, then iterates again to actually write.

**Impact**
- For huge relation sets this is a full extra serialization pass.

**Suggested fix direction**
- Make the JSONL path the default once entry count exceeds a modest threshold.
- If size-based switching is needed, compute while writing and rotate shards dynamically.

---

### 15) Medium — Doc-vector fallback behavior can cause doc-only queries to surface code-only chunks

**Where**
- `src/index/build/postings.js`

**What’s wrong**
- In the pre-quantized path, if `embed_doc_u8` is missing, it falls back to the merged embedding.
- This is correct only if you guarantee `embed_doc_u8` is always present (even if empty marker). If that invariant breaks, doc-only search semantics change.

**Impact**
- Doc-search results can unexpectedly include chunks with no doc signal.

**Suggested fix direction**
- Enforce an invariant: always emit `embed_doc_u8` (empty marker) for every chunk whenever embeddings are enabled.
- Add a build-time assertion in postings build if invariants are violated.

---

### 16) Medium — Embeddings-disabled path populates arrays rather than omitting fields

**Where**
- `src/index/build/file-processor/embeddings.js`

**What’s wrong**
- When `embeddingEnabled` is false it sets `embed_code`, `embed_doc`, and `embedding` to empty arrays.

**Why it’s risky**
- Downstream code often uses “property present” as a signal; empty arrays are truthy and can change behavior vs `undefined`.

**Suggested fix direction**
- Prefer leaving fields undefined (or explicitly null) when embeddings are disabled.

---

### 17) Medium — `field-weighting` heuristics can misclassify unrelated files due to `/test/i`

**Where**
- `src/index/field-weighting.js`

**What’s wrong**
- `if (/test/i.test(file)) return 0.5;` matches substrings like `contest`, `latest`, etc.

**Impact**
- Unintended down-weighting of chunks.

**Suggested fix direction**
- Use path-segment or filename-based patterns (e.g., `/\btest\b/` over segments, or `.test.` conventions).

---

### 18) Low — `headline()` assumes tokens are always provided

**Where**
- `src/index/headline.js`

**What’s wrong**
- If called with `tokens` missing/undefined, it will throw.

**Suggested fix direction**
- Guard `tokens` as an optional array; degrade to a punctuation-stripped snippet.

---

### 19) Low — Comment-style resolution has overlaps that can disable string-awareness for some IDs

**Where**
- `src/index/comments.js`

**What’s wrong**
- `COMMENT_STYLES` includes overlapping entries for `html/markdown`, and `resolveCommentStyle()` returns the first match.
- For HTML, the earlier style has `strings: []`, so the scanner is not quote-aware even though a later style lists string delimiters.

**Impact**
- Higher risk of false-positive comment markers inside attributes/strings.

**Suggested fix direction**
- Remove overlaps or ensure the most specific style (with string handling) wins.

---

### 20) Medium — Dockerfile import collector conflates “stage alias” with “dependency”

**Where**
- `src/index/language-registry/import-collectors/dockerfile.js`

**What’s wrong**
- The collector pushes both base image references *and* stage aliases into the same `imports` array.

**Impact**
- Import graphs / relations can become polluted with internal stage labels that are not true external dependencies.

**Suggested fix direction**
- Emit structured imports (e.g., `{ kind: 'image' | 'stage', value }`) or keep stage aliases separate.

---

### 21) Medium — Risk rules compilation can silently produce rules with zero patterns

**Where**
- `src/index/risk-rules.js`

**What’s wrong**
- Invalid patterns are filtered out during compilation, but the rule is still kept even if all patterns fail.

**Impact**
- A “configured” risk rule set can silently become ineffective.

**Suggested fix direction**
- If a rule ends up with 0 compiled patterns, emit a warning and drop the rule (or mark it disabled).

**Tests to add**
- Rule file with one invalid regex must produce a warning and an empty rule list (or disabled rule).

---

### 22) Medium — Cross-file type inference extraction can accept non-string type values

**Where**
- `src/index/type-inference-crossfile/extract.js`

**What’s wrong**
- `extractReturnTypes()` pushes any elements of `docmeta.returns` without normalizing shape.
- If `docmeta.returns` contains objects (common in doc parsers), downstream “type sets” may end up containing `[object Object]` or otherwise unusable values.

**Impact**
- Polluted inferred-type inventories.
- Noisy or incorrect type-inference application.

**Suggested fix direction**
- Normalize `returns`/`params` to strings at extraction time:
  - accept `{ type: string }`, `{ returnType: string }`, etc.
  - otherwise ignore non-strings.

---

### 23) Low — Bitmap indexing assumptions may skip sources that aren’t Sets

**Where**
- `src/retrieval/bitmap.js`

**What’s wrong**
- `buildBitmapIndex()` expects `index.byExt`, `index.byLang`, `index.byKind`, etc. values to have `.size` (i.e., Sets).
- If any producer supplies arrays instead, those categories won’t be indexed.

**Suggested fix direction**
- Normalize inputs (accept arrays and convert to Sets), or assert that producers use Sets.

---

## Additional observations (not necessarily bugs, but likely worth tightening)

### Artifact compression configuration can leak non-boolean values
- `resolveCompressionConfig()` computes `compressionEnabled` using `&&`, which can return `null` rather than a strict boolean.
  - `src/index/build/artifacts/compression.js:47–62`
- Suggestion: force booleans for config surfaces, especially if later code does strict comparisons.

### Metrics/reporting and build-state updates swallow errors
- Multiple modules catch-and-ignore I/O errors (`build-state.js`, `filter-index.js`, `imports.js`, `comments.js`, `risk-rules.js`, `bitmap.js`).
- Suggestion: keep swallow behavior where appropriate, but emit structured warnings with enough context to debug (path, operation, mode).

---

## Suggested test plan additions (cross-cutting)

1. **Posting correctness regression suite**
   - Long-token chargram guard test (Finding #1).
   - Mixed token modes (case/whitespace) normalization test (Finding #6).

2. **Shard planning invariants**
   - If WASM grouping is a first-class invariant, add a test that forbids `lang: mixed` shards (Finding #2).

3. **Import collection correctness**
   - Ensure collector options are passed through correctly (Finding #3).

4. **ANN provider contract tests**
   - When a provider claims `isAvailable()`, it must accept a minimal `idx` without throwing (Finding #5).

5. **Schema/metadata invariants**
   - `file_meta` merge correctness with empty arrays and zeros (Finding #8).

