# CODEBASE STATIC SWEEP FINDINGS — PASS 5 (Artifacts, Postings/Embeddings, Chunking, Language Registry, Cross-file Inference)

> Scope: **Only** the files enumerated in this pass (see “Scope” section).  
> Method: Static review (no runtime execution), focusing on correctness, determinism, invariants, and performance footguns.  
> Output: Findings and concrete remediation suggestions (no code changes applied).

---

## Scope

### Index build artifacts / build state / postings / sharding
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

### Chunk IDs, chunking dispatch & format chunkers, chunk guards, embeddings/weights/headlines, comment extraction
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

### Language registry + import collectors
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

### Risk/structural/minhash + tooling signature parsing + cross-file inference (local modules)
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

---

## Severity legend

- **P0 — Correctness / crash / major data loss**: likely to break indexing, corrupt artifacts, or materially reduce recall/precision.
- **P1 — Incorrect output / invariant drift / determinism / caching**: wrong artifacts or unstable outputs; important but may not crash.
- **P2 — Performance / scalability / maintainability**: significant inefficiency or drift risk; generally safe but costly.
- **P3 — Cleanups / consistency / polish**: minor issues or refactors that reduce future breakage.

---

## Executive summary (what matters most)

1. **ESM import detection is effectively disabled** because `es-module-lexer` is never initialized (P0). This can silently degrade `importGraph` quality across JS/TS repos, impacting downstream graph features and any “graph-aware retrieval” plans.
2. **Chargram extraction can abort early** for an entire chunk when it encounters a single overlong token, due to a `return` inside a token loop (P0). This can materially reduce chargram postings and skew matching.
3. **Postings/embeddings pipelines have type-shape sensitivity** (arrays vs typed arrays) in at least one stage; if any upstream provides typed float vectors, quantization can be skipped or embeddings can be treated as missing (P1).
4. **File relations writing is nondeterministic** (Map insertion order), which undermines reproducible builds and cache key correctness (P1), especially relevant for federation and shared caches.
5. **Incremental build metadata has potential hash-algorithm drift** (hard-coded `sha1` even when a different algo is implied/passed) in cached bundle plumbing (P1).

---

## Findings (prioritized)

### P0-IMPORTS-001 — `es-module-lexer` init is never called, so ESM imports are likely missed
**Where**
- `src/index/build/imports.js` — `ensureEsModuleLexer()` (lines ~17–20)

**What’s wrong**
- `ensureEsModuleLexer` stores the **function** `initEsModuleLexer` instead of the **promise returned by calling it**:
  - `esModuleInitPromise = initEsModuleLexer;`
  - `await esModuleInitPromise;` awaits a function value (no-op), so initialization never happens.

**Impact**
- `parseEsModuleLexer(text)` may fail or behave inconsistently; even when it fails, the code falls back to CJS parsing and a `require(...)` regex, which does **not** capture `import ... from`/`export ... from` specifiers.
- Downstream: weaker `allImports`, weaker `importLinks`, weaker `importGraph`, weaker graph-aware features and ranking.

**Suggested fix**
- Call the initializer and cache its promise:
  - set `esModuleInitPromise = initEsModuleLexer();` (mirrors the CJS init pattern at line ~23)

**Suggested tests**
- Fixture JS file containing:
  - `import x from "dep-a"; export * from "dep-b";`
  - Ensure `scanImports()` emits both `dep-a` and `dep-b`.
- Regression fixture with both ESM and CJS in same file; ensure union is stable.

---

### P0-POSTINGS-001 — Chargram extraction aborts early on long tokens due to `return` inside loop
**Where**
- `src/index/build/state.js` — `appendChunk(...)`, helper `addFromTokens` (line ~257)

**What’s wrong**
- In `addFromTokens`, the check:
  - `if (chargramMaxTokenLength && w.length > chargramMaxTokenLength) return;`
  uses `return`, which exits the entire function, skipping all remaining tokens and all remaining fields (`fields.doc`, etc.).

**Impact**
- A single long identifier or minified token can cause the entire chunk to emit **no chargrams**, skewing:
  - chargram postings (`triPost`)
  - any retrieval features relying on chargrams
  - guardrail metrics (truncation vs missing)

**Suggested fix**
- Replace `return` with `continue` so only the offending token is skipped.
- Also consider applying the same “skip long token” logic consistently for phrase generation if needed.

**Suggested tests**
- Construct a chunk with `fieldTokens.name = ["OK", "X".repeat(500)]` and `fieldTokens.doc = ["DocToken"]`.
  - With `chargramMaxTokenLength=30`, ensure chargrams are still generated from `"OK"` and `"DocToken"`.
- Add a test where the long token appears first to catch the early-return failure.

---

## P1 findings (incorrectness / determinism / caching)

### P1-CACHE-001 — Cached bundle file hash algorithm is hard-coded to `sha1` (hash algorithm drift)
**Where**
- `src/index/build/file-processor/cached-bundle.js` — `fileInfo.hashAlgo` (line ~48)

**What’s wrong**
- `fileHashAlgo` is accepted as an argument, but the constructed `fileInfo` always sets:
  - `hashAlgo: resolvedHash ? 'sha1' : null`

**Impact**
- If/when the system supports alternate file-hash algorithms (or if `fileHash` was computed differently), caches and manifests can become inconsistent:
  - an index might claim `sha1` while storing a different hash
  - incremental invalidation may break or over-invalidate

**Suggested fix**
- Use the passed `fileHashAlgo` when present (or derive from incremental manifest), falling back to `'sha1'` only when appropriate.

**Suggested tests**
- Simulate incremental state with `hashAlgo: 'sha256'` and ensure reuse path preserves algo.
- Ensure index manifests remain stable when `fileHashAlgo` changes (expected: full invalidation or explicit mismatch error).

---

### P1-ARTIFACTS-001 — `file_relations` output order depends on Map insertion order (nondeterministic builds)
**Where**
- `src/index/build/artifacts/writers/file-relations.js` — `createFileRelationsIterator` (lines ~9–18)

**What’s wrong**
- Iteration uses `for (const [file, data] of relations.entries())` without sorting.
- If file processing order differs (due to concurrency, OS traversal order, shard planning changes), artifact ordering changes even when content is identical.

**Impact**
- Non-reproducible artifacts harm:
  - cache key correctness (especially in multi-repo/shared cache plans)
  - index diffing (noisy diffs)
  - test determinism

**Suggested fix**
- Emit `file_relations` in a stable order:
  - collect keys, sort by `file`, then yield in sorted order
  - for extremely large Maps, consider streaming with an external sorted list (based on scanned file list) rather than materializing all entries twice

**Suggested tests**
- Construct a Map with same entries inserted in different orders; ensure serialized output is byte-for-byte identical.
- Ensure JSONL sharding yields stable part boundaries when maxBytes is constant.

---

### P1-POSTINGS-002 — Token retention logic duplicated with inconsistent normalization rules
**Where**
- `src/index/build/artifacts/token-mode.js` (`resolveTokenMode`, `resolveTokenRetention`)  
- `src/index/build/indexer/steps/postings.js` (`createTokenRetentionState`)

**What’s wrong**
- Two independent token-retention implementations:
  - `token-mode.js` trims/lowercases input, supports `'auto'`, etc.
  - `steps/postings.js` uses raw `chunkTokenMode` without lowercasing/normalization and has slightly different numeric handling.

**Impact**
- Configuration can behave differently depending on which path is used:
  - mode strings like `"Auto"` may be treated as unknown in one path
  - numeric limits can be interpreted differently
- Drift risk increases over time (bugs fixed in one copy but not the other).

**Suggested fix**
- Make `steps/postings.js` use the same normalizer (`resolveTokenRetention`) or re-export a single shared implementation.

**Suggested tests**
- Parameterized tests for token retention across:
  - `chunkTokenMode = "Auto" | "auto" | "FULL" | "sample" | "none"`
  - ensure identical outcomes across both code paths.

---

### P1-EMBED-001 — Embedding quantization paths are sensitive to vector shape (Array vs TypedArray)
**Where**
- `src/index/build/indexer/steps/postings.js` — quantization checks use `Array.isArray(rawDoc/rawCode/merged)` (lines ~101–135)
- `src/index/build/postings.js` — legacy quantization path uses `Array.isArray(chunk.embedding)` / `Array.isArray(chunk.embed_doc)` (various)

**What’s wrong**
- Several checks gate work on `Array.isArray(...)`, not “vector-like” checks.
- If any upstream embedding adapter returns `Float32Array` (or other typed array) rather than a JS array, these paths can treat embeddings as missing, leading to zero vectors.

**Impact**
- Potential silent quality regression:
  - embeddings become zeros → vector retrieval degrades
  - dense-vector artifacts become inconsistent with expectations
- This is especially risky if different providers return different vector shapes.

**Suggested fix**
- Standardize on “vector-like” semantics:
  - treat arrays and typed arrays as acceptable for quantization
  - apply conversion (`Float32Array.from`) in a single place (ideally in `attachEmbeddings`), then downstream always consumes `*_u8` fields.

**Suggested tests**
- Run postings build on a chunk set where floats are `Float32Array`, verify `embedding_u8` is non-empty and stable.
- Mixed shape tests: some vectors arrays, some typed arrays.

---

### P1-META-001 — `file-meta` aggregation can under-merge certain per-file fields across chunks
**Where**
- `src/index/build/artifacts/file-meta.js` — `buildFileMeta(...)`

**What’s wrong**
- Some fields (e.g., `churn_*`) are only set when the file record is created, not updated later if missing initially.
- `externalDocs` only fills when missing and never unions across chunks.

**Impact**
- For files where chunk ordering varies (or where some chunks omit git metadata), file-level metadata can be incomplete.

**Suggested fix**
- Update-once semantics should be “set if missing” for churn fields too, or define a canonical source (e.g., fileInfoByPath) and overwrite consistently.
- For arrays like `externalDocs`, union + stable sort + dedupe.

**Suggested tests**
- Construct two chunks for same file:
  - first missing churn fields, second includes them
  - ensure final file meta includes churn fields.
- `externalDocs`: two chunks with different docs; ensure union.

---

## P2 findings (performance / scalability / maintainability)

### P2-CHUNKID-001 — Chunk IDs include `kind` and `name`, which can destabilize IDs across parser improvements
**Where**
- `src/index/chunk-id.js` — `buildChunkId(...)`

**What’s wrong**
- The ID hash includes: `chunk.kind` and `chunk.name`.
- Parser improvements, naming heuristics, or relation attachers can change these values without any actual text-range change.

**Impact**
- Incremental indexing and diffing can be noisier than necessary:
  - stable ranges produce new IDs
  - cached bundles may be invalidated needlessly

**Suggested fix**
- Prefer a chunk ID based primarily on stable identity:
  - file + segmentId + start/end (and optionally a stable “chunker flavor”)
- If a “human name” is valuable, keep it as metadata, not identity.

**Suggested tests**
- Two builds with identical text ranges but changed `kind/name`; ensure `chunkId` remains stable if stability is intended.

---

### P2-CHUNKING-001 — Config format chunkers contain O(n²) patterns for large files (avoidable)
**Where**
- `src/index/chunking/formats/json.js` — repeated `text.slice(...).search(...)` inside a scan loop
- `src/index/chunking/formats/xml.js` — repeated `text.slice(i+1).match(...)` per tag

**What’s wrong**
- Both chunkers repeatedly allocate substrings during scanning, which can become quadratic on large files.

**Impact**
- Unbounded performance cliffs when chunking large JSON/XML configs (common in lockfiles or generated configs).

**Suggested fix**
- Replace substring-based scans with index-based scans:
  - move whitespace search to a forward pointer
  - replace `slice().match()` with a small in-place parser or a regex with `lastIndex` on the full string.
- Prefer tree-sitter chunking for large configs when enabled (`context.treeSitter.configChunking`), but still make the fallback safe.

**Suggested tests**
- Micro-benchmark test (excluded from CI) for a large JSON/XML file to detect accidental O(n²) regressions.
- Functional test: ensure chunk boundaries remain consistent after optimization.

---

### P2-XML-001 — XML self-closing detection misses `<tag />` (whitespace before `/>`)
**Where**
- `src/index/chunking/formats/xml.js` — `selfClose` check (line ~33)

**What’s wrong**
- `const selfClose = closeIdx >= 0 && text[closeIdx - 1] === '/';`
  fails for `<tag />` or `<tag attr="x" />` where the `/` is not immediately before `>`.

**Impact**
- Depth accounting drifts, which can:
  - mis-identify “top-level” tags
  - generate incorrect chunk splits

**Suggested fix**
- Detect self-closing by scanning backward from `>` to skip whitespace, then check `/`.

**Suggested tests**
- XML fixture with `<a />`, `<b attr="1" />`, nested tags; ensure top-level keying is correct.

---

### P2-SHARDS-001 — Shard planning does not explicitly encode WASM/parser-runtime grouping constraints
**Where**
- `src/index/build/shards.js` — `planShards(...)`

**What’s wrong**
- `planShards` groups by directory and inferred language id, but there is no explicit primitive to capture:
  - “this shard requires TSX wasm” vs “this shard requires Python AST subprocess” vs “this shard is prose”
- This is relevant given the roadmap direction: grouping by runtime/wasm to avoid repeated loads and maximize throughput.

**Impact**
- As you move toward “WASM grouping and sharding” + streaming pipelines, you may have to retrofit planning outputs (IDs/labels) with runtime requirements.
- Without a first-class constraint, scheduling can regress into re-loading runtimes frequently or mixing incompatible workloads.

**Suggested fix**
- Extend shard planning entries with an explicit `runtimeKey` (or similar) derived from:
  - language id
  - analysis strategy (tree-sitter wasm, python tool, clangd, etc.)
- Keep it additive (non-breaking): `runtimeKey` can be optional for now.

**Suggested tests**
- Deterministic shard plan for a mixed-language fixture repo:
  - ensure all `.tsx` land in the same runtime group
  - ensure prose shards never trigger code runtimes.

---

### P2-BUILDSTATE-001 — Build state updates are vulnerable to last-writer-wins races
**Where**
- `src/index/build/build-state.js` — `updateBuildState(...)`

**What’s wrong**
- The update flow is read → merge → write with no lock or compare-and-swap.
- If multiple phases/workers update concurrently, fields can be lost (especially `progress` and `phases`).

**Impact**
- Build status output becomes unreliable in concurrent modes (watch mode, multi-worker, multi-phase).

**Suggested fix**
- Add minimal coordination:
  - either a lock file around state updates (there is already build locking elsewhere)
  - or write phase/progress updates to separate files and aggregate for display (append-only log style).

**Suggested tests**
- Concurrency test that issues overlapping updates and asserts the merged state retains both updates.

---

### P2-COMMENTS-001 — Comment styles contain overlapping language IDs; resolution is “first match wins”
**Where**
- `src/index/comments.js` — `COMMENT_STYLES` and `resolveCommentStyle(...)`

**What’s wrong**
- `COMMENT_STYLES` includes multiple entries that cover `markdown` and `html`. Because `resolveCommentStyle` uses `.find(...)`, only the first matching entry is used; later entries become dead configuration and future edits risk confusion.

**Impact**
- Not a correctness bug today, but a drift magnet: changes to the second set won’t take effect and will be misinterpreted during maintenance.

**Suggested fix**
- De-duplicate IDs so each language resolves to exactly one style entry.
- Add a validation step in `normalizeCommentConfig` or module init to detect duplicate language coverage.

**Suggested tests**
- Unit test asserting every `languageId` appears at most once across `COMMENT_STYLES`.

---

### P2-DOCKER-IMPORTS-001 — Dockerfile collector treats stage aliases as “imports”
**Where**
- `src/index/language-registry/import-collectors/dockerfile.js` (lines ~10–21)

**What’s wrong**
- The collector adds both:
  - base image name (`FROM ubuntu:...`)
  - stage alias (`AS build`)
  into the same “imports” set.

**Impact**
- Stage names like `build`, `base`, `deps` are extremely common and can collide across many Dockerfiles.
- This pollutes the module map and can create spurious “importLinks” if any downstream logic matches tokens across files.

**Suggested fix**
- Either:
  - exclude stage aliases from imports, or
  - represent them as a different namespace (e.g., `docker-stage:build`) and ensure linkers don’t treat them as cross-file modules.

**Suggested tests**
- Two Dockerfiles both using `AS build`; ensure they do not get linked via imports.

---

## P3 findings (smaller consistency / polish)

### P3-ARTIFACTS-001 — Optional compression dependency check is repeated and uncached
**Where**
- `src/index/build/artifacts/compression.js` — `resolveCompressionMode(...)`

**What’s wrong**
- `tryRequire('@mongodb-js/zstd').ok` is called during each config resolve; in long-lived processes this could be repeated.

**Impact**
- Minor overhead; mostly a cleanliness issue.

**Suggested fix**
- Cache `zstdAvailable` at module scope the first time it is evaluated.

---

### P3-RISK-001 — Risk rules normalize confidence only if numeric (string confidences ignored)
**Where**
- `src/index/risk-rules.js` — `normalizeRule(...)`

**What’s wrong**
- `confidence: Number.isFinite(rule.confidence) ? rule.confidence : null`
  ignores `"0.7"` (string), even though it is easy to coerce.

**Impact**
- Minor ergonomics; config authors can accidentally lose confidence metadata.

**Suggested fix**
- Parse via `Number(rule.confidence)` similar to other normalization helpers.

---

### P3-STRUCT-001 — Structural match normalization can emit absolute paths when outside repo root
**Where**
- `src/index/structural.js` — `normalizePath(...)`

**What’s wrong**
- If a match path is outside the repo root, it returns `toPosix(raw)` which can be absolute.

**Impact**
- Potentially leaks local filesystem layout into artifacts/logging.
- Also creates keys that will not match any repo-relative file keys.

**Suggested fix**
- Prefer dropping out-of-repo entries or normalizing to a stable identifier (e.g., `external:<hash>`).

---

### P3-TYPEINF-001 — Cross-file inference helpers assume well-formed docmeta shapes
**Where**
- `src/index/type-inference-crossfile/apply.js`

**What’s wrong**
- `ensureInferred(docmeta)` assumes `docmeta` is an object; callers must guarantee this.
- `addInferredParam` assumes `inferred.params[name]` is an array if present.

**Impact**
- Low: currently likely called with correct structures, but it is a sharp edge when future tooling adds partial docmeta.

**Suggested fix**
- Defensive normalization: if `docmeta` missing, return false; if `params[name]` not array, reset to [].

---

## Cross-cutting recommendations (tests & invariants)

1. **Determinism suite (artifact bytes)**
   - Add a small, fixed fixture repo and assert:
     - `file_relations` serialization is stable
     - `repo_map` ordering is stable
     - shard planning output is stable

2. **Import graph correctness suite**
   - Dedicated fixture covering:
     - ESM, CJS, re-exports, dynamic imports
     - ensures `scanImports` outputs stable normalized import lists

3. **Embedding shape compatibility**
   - A unit test that passes `Float32Array` embeddings through all relevant stages and ensures:
     - `_u8` vectors are generated, dims are consistent, and values are non-zero for non-zero input.

4. **Incremental cache invariants**
   - If `hashAlgo` appears anywhere in manifests, enforce:
     - “declared algo matches computed algo”
     - mismatch forces rehash or invalidation

---

## Appendix: File-by-file notes (quick scan)

### `src/index/build/imports.js`
- P0 init bug for ESM lexer (see P0-IMPORTS-001).
- Consider always running the `require(...)` regex (currently gated on `success`) if you want maximum recall; if you keep the gate, ensure “ESM parse failure” doesn’t suppress require scanning.

### `src/index/build/state.js`
- P0 chargram early-return bug (see P0-POSTINGS-001).
- Consider using normalized postingsConfig (min/max N defaults) defensively.

### `src/index/build/artifacts/writers/file-relations.js`
- P1 nondeterministic order (see P1-ARTIFACTS-001).
- Counts bytes by `JSON.stringify` twice (once for sizing, once for writing). For extremely large maps this doubles CPU; consider a streaming “measure-then-shard” heuristic.

### `src/index/chunk-id.js`
- Chunk ID stability risk: including `kind/name` (see P2-CHUNKID-001).

### `src/index/chunking/formats/xml.js`
- Self-closing tag detection issue (see P2-XML-001).
- Substring allocations in scan loop (see P2-CHUNKING-001).

### `src/index/language-registry/import-collectors/dockerfile.js`
- Stage aliases treated as imports (see P2-DOCKER-IMPORTS-001).

### `src/index/build/file-processor/cached-bundle.js`
- Hash algo hard-coded (see P1-CACHE-001).
- If `fileRelations.imports` can be raw module specifiers, `normalizeImportLinks()` is reasonable; if it can be non-string objects, consider normalizing before indexing.

### `src/index/build/indexer/steps/postings.js` and `src/index/build/postings.js`
- Typed-array sensitivity (see P1-EMBED-001).
- Consider using a shared “vector-like” predicate to avoid future regressions.

---


---

## Per-file review checklist (coverage assurance)

The table below ensures every file in scope is explicitly accounted for. “Notes” are brief; see the Findings sections above for details.

### Index build artifacts / build state / postings / sharding

| File | Notes |
|---|---|
| `src/index/build/artifacts/compression.js` | Optional-dep check could be cached; clarify behavior when `enabled=true` but `mode` unrecognized (currently becomes “off”). |
| `src/index/build/artifacts/file-meta.js` | Aggregation is “first writer wins” for some fields; consider union/“set if missing” for churn + external docs. |
| `src/index/build/artifacts/filter-index.js` | Uses `tools/dict-utils.js` for hashing (layering); ensure stable config hash inputs + versioning. |
| `src/index/build/artifacts/metrics.js` | Assumes token postings/vocab exist; guard for vector-only / reduced modes; also pulls hashing utilities from `tools/`. |
| `src/index/build/artifacts/schema.js` | Schema drift risk: optional duplicate field names (`chunkAuthors` vs `chunk_authors`); verify emitted fields match schema expectations. |
| `src/index/build/artifacts/token-mode.js` | Works, but overlaps with token-retention logic in postings step (drift risk). |
| `src/index/build/artifacts/writer.js` | Generally sound; ensure manifest metadata correctly represents compressed variants (format vs compression fields). |
| `src/index/build/artifacts/writers/file-relations.js` | Output order is insertion-order dependent (nondeterministic); double-stringify cost for sizing. |
| `src/index/build/artifacts/writers/repo-map.js` | Materializes full entries array (memory); consider streaming or partial fields for huge repos. |
| `src/index/build/build-state.js` | Last-writer-wins race possible; `markBuildPhase` also writes a top-level `phase` field (confirm intended). |
| `src/index/build/file-processor/cached-bundle.js` | `hashAlgo` hard-coded to `sha1` (ignores `fileHashAlgo`); verify import link normalization semantics. |
| `src/index/build/file-processor/embeddings.js` | Quantizes code/doc without explicit normalization (assumes embedder normalized); shape handling is “vector-like” (good). |
| `src/index/build/file-processor/skip.js` | Seems correct; ensure `fileScanner` is always passed (binary detection path assumes it). |
| `src/index/build/imports.js` | **P0:** `es-module-lexer` init is not called; ESM imports likely missed. |
| `src/index/build/indexer/steps/postings.js` | Typed-array sensitivity (`Array.isArray` gates); token retention duplicated vs token-mode. |
| `src/index/build/postings.js` | `log(...)` is assumed to exist (guard or enforce); legacy float quantization paths are shape-sensitive. |
| `src/index/build/shards.js` | Good baseline; missing explicit “runtimeKey/WASM group” primitive for future streaming/WASM-group scheduling. |
| `src/index/build/state.js` | **P0:** Chargram extraction can abort early due to `return` in token loop; ensure default chargram N values are always present. |
| `src/index/build/tokenization.js` | Looks consistent; ensure minhash and stemming behavior is intended for all languages/modes. |

### Chunk IDs, chunking dispatch & format chunkers, chunk guards, embeddings/weights/headlines, comment extraction

| File | Notes |
|---|---|
| `src/index/chunk-id.js` | Chunk identity includes `kind/name` (can destabilize IDs across parser improvements). |
| `src/index/chunking.js` | Re-export shim; no issues. |
| `src/index/chunking/dispatch.js` | Broad heuristic chunkers; watch for large-file memory (`text.split('\n')` in many helpers). |
| `src/index/chunking/formats/ini-toml.js` | Tree-sitter optional path; regex fallback acceptable. |
| `src/index/chunking/formats/json.js` | Potential O(n²) scanning (`slice().search()` inside loop); tree-sitter path mitigates when enabled. |
| `src/index/chunking/formats/markdown.js` | Simple header chunking; ok. |
| `src/index/chunking/formats/rst-asciidoc.js` | Acceptable heuristics; ok. |
| `src/index/chunking/formats/xml.js` | Self-close detection misses `<tag />`; potential O(n²) substring usage. |
| `src/index/chunking/formats/yaml.js` | Good workflow special-case; top-level split heuristics reasonable. |
| `src/index/chunking/limits.js` | Splitting stores `startLine/endLine` in `meta` (confirm downstream expects this shape); byte-boundary splitting uses repeated `byteLength(slice)`. |
| `src/index/chunking/tree-sitter.js` | Option passthrough; ok. |
| `src/index/comments.js` | Duplicate style coverage for some language IDs (first match wins); consider validation to prevent drift. |
| `src/index/embedding.js` | Thin wrapper over embedding adapter; ok. |
| `src/index/field-weighting.js` | `/test/i` matches substrings (e.g., “latest”); consider tighter path-segment matching. |
| `src/index/headline.js` | Reasonable heuristics; ok. |

### Language registry + import collectors

| File | Notes |
|---|---|
| `src/index/language-registry.js` | Re-export shim; ok. |
| `src/index/language-registry/control-flow.js` | Simple keyword-only flow summaries; ok. |
| `src/index/language-registry/import-collectors/*.js` | Generally ok; **Dockerfile collector** treats `AS <stage>` as import (likely pollution). |
| `src/index/language-registry/import-collectors/utils.js` | Shared line caps; ok. |
| `src/index/language-registry/registry.js` | `buildChunkRelations` indexes by `chunk.name` (collision risk); consider chunkId-based indexing for call/callDetails in future. |
| `src/index/language-registry/simple-relations.js` | `importLinks` not deduped; consider stable dedupe to reduce artifact noise. |

### Risk/structural/minhash + tooling signature parsing + cross-file inference (local modules)

| File | Notes |
|---|---|
| `src/index/minhash.js` | Correct but O(tokens * numHashes); consider performance guardrails for huge chunks. |
| `src/index/risk-rules.js` | Normalization ignores string confidences; otherwise solid safe-regex compilation flow. |
| `src/index/structural.js` | Can emit absolute paths for out-of-repo matches; consider dropping or normalizing to non-leaking identifiers. |
| `src/index/tooling/signature-parse/clike.js` | Heuristic parsing; fine but won’t cover all complex types (acceptable). |
| `src/index/tooling/signature-parse/python.js` | Handles defaults and annotations reasonably; ok. |
| `src/index/tooling/signature-parse/swift.js` | Heuristic; ok. |
| `src/index/type-inference-crossfile.js` | Re-export shim; ok. |
| `src/index/type-inference-crossfile/apply.js` | Assumes docmeta structure; minor defensive hardening recommended. |
| `src/index/type-inference-crossfile/constants.js` | Regexes are global; safe in sync usage; ok. |
| `src/index/type-inference-crossfile/extract.js` | Extractors are coherent; relies on shared regex objects (ok in sync use). |
| `src/index/type-inference-crossfile/symbols.js` | Symbol selection is name-based (collision ambiguity is expected). |


## Closing
This pass surfaced two high-severity correctness issues (ESM import initialization and chargram early abort) that can silently degrade analysis quality without obvious failures. Fixing those first will improve the reliability of import graphs, chargram postings, and downstream graph-aware retrieval and risk-flow work.
