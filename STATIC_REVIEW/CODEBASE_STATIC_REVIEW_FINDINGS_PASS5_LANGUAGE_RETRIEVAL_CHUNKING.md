# Codebase Static Review Findings (Pass 5)

**Scope (files reviewed):**
- Build artifacts + postings/shards/state/tokenization
- Chunking core + format chunkers + comments/headline/field weighting
- Language registry + import collectors
- Risk rules + minhash + structural loader + signature parsers + cross-file inference helpers
- Retrieval ANN backends + bitmap utilities
- Retrieval CLI helpers
- Retrieval core helpers (context expansion, filter index, filters, FTS, LanceDB, LMDB/SQLite helpers)
- Retrieval query stack + sparse providers + sqlite caches/helpers

**Method:** Static inspection only (no runtime execution).

## Severity legend
- **P0** — likely to cause incorrect results, data corruption, or crashes in common paths.
- **P1** — correctness gaps or edge-case failures that materially degrade output quality or reliability.
- **P2** — performance/maintainability/UX sharp edges.

## Executive summary (highest-leverage issues)

1. **P0 — Chargram generation aborts early** when a single token exceeds `chargramMaxTokenLength` (`src/index/build/state.js`, `addFromTokens`). One long token prevents chargrams for *all subsequent tokens* in the chunk.
2. **P0/P1 — Embedding handling is inconsistent across code paths** (typed arrays vs arrays; normalization before quantization). This can silently treat embeddings as “missing” or quantize unnormalized vectors (`src/index/build/indexer/steps/postings.js`, `src/index/build/postings.js`).
3. **P1 — Import collection API shape mismatch risk** (`src/index/language-registry/registry.js`, `collectLanguageImports`). Options are passed as `{ ext, relPath, mode, options }`, but many collectors expect a flat options bag.
4. **P1 — Context expansion assumes `chunkMeta[id]` addressing** (`src/retrieval/context-expansion.js`). If chunk IDs ever diverge from array indexes, expansion will mis-resolve neighbors.
5. **P1 — Multiple metadata merge points use falsy checks, dropping valid `0` values** (`src/index/build/artifacts/file-meta.js`, `src/retrieval/lmdb-helpers.js`).
6. **P1 — Dockerfile import collector treats build-stage aliases as imports** (`src/index/language-registry/import-collectors/dockerfile.js`). This pollutes import graphs.
7. **P1 — Windows absolute paths break filter-expression parsing** (`src/retrieval/filters.js`, `parseFilterExpression`) because drive-letter paths contain `:`.

---

## 1) Index build: artifacts + postings/shards/state/tokenization

### `src/index/build/state.js`
**Findings**
- **P0 — Chargram generation returns early and skips subsequent tokens.**
  - **Where:** `addFromTokens()` inside `appendChunk()`
  - **What’s wrong:**
    - When `chargramMaxTokenLength` is set and a token exceeds it, the function uses `return;` instead of `continue;`.
    - Result: the first long token prevents chargram postings for every later token.
  - **Why it matters:**
    - Chargram candidate sets are used for pruning (and can influence ranking). One long token (minified identifiers, base64, hashes) can silently disable chargram acceleration for the entire chunk.
  - **Suggested fix:** replace the `return` with `continue` so only the oversized token is skipped.
  - **Tests:** fixture with one oversized token followed by normal tokens; assert chargram postings still present for normals.
- **P1 — Chargram loop relies on `postingsConfig.chargramMinN/MaxN` being defined.**
  - If either is `undefined`, the `for` loop may do nothing silently.
  - **Suggestion:** normalize defaults in a single config-normalization step and assert numeric invariants.

### `src/index/build/indexer/steps/postings.js`
**Findings**
- **P1 — Quantization path ignores typed arrays.**
  - **Where:** `appendChunkWithRetention()` checks `Array.isArray(rawDoc/rawCode/rawMerged)`.
  - **What’s wrong:** if embeddings are `Float32Array`, they are treated as “missing,” resulting in empty vectors or fallback behavior.
  - **Suggested fix:** treat “vector-like” values as `Array.isArray(vec) || (ArrayBuffer.isView(vec) && !(vec instanceof DataView))`.
- **P1 — Quantization may occur without explicit normalization.**
  - `quantizeVecUint8` is `quantizeEmbeddingVectorUint8` (no normalization).
  - If upstream embedding adapters do not guarantee normalized vectors, similarity becomes unstable.
  - **Suggestion:** normalize defensively (or enforce/validate normalized vectors at adapter boundary and assert via tests).

### `src/index/build/postings.js`
**Findings**
- **P1 — Legacy float vector selection ignores typed arrays.**
  - `selectEmbedding()` accepts only `Array.isArray(chunk.embedding)` and returns zero vectors otherwise.
  - If vectors arrive as `Float32Array`, ANN becomes effectively disabled (silently).
- **P1 — Doc-vector defaulting can contaminate doc-only retrieval.**
  - In the pre-quantized path: if `embed_doc_u8` is missing, it may fall back to merged vectors.
  - If “missing doc” semantics are intended to suppress code-only chunks in doc search, the default should be “empty marker → zero,” not “missing → merged.”
  - **Suggestion:** explicitly distinguish:
    - *absent doc embedding not computed* vs
    - *doc embedding computed and intentionally empty marker*.

### `src/index/build/artifacts/file-meta.js`
**Findings**
- **P1 — Merge is lossy for `externalDocs` and churn fields.**
  - Only `last_modified/last_author` are updated after the first chunk; other fields remain first-seen.
  - **Suggestion:** use nullish checks and union lists.
- **P1 — Falsy checks drop valid zeros.**
  - Example: `if (!info.size && Number.isFinite(c.fileSize))` skips `0`.
  - **Suggestion:** use `== null` checks.

### `src/index/build/file-processor/cached-bundle.js`
**Findings**
- **P1 — `hashAlgo` is hard-coded to `'sha1'` for cached entries.**
  - **Where:** `fileInfo.hashAlgo = resolvedHash ? 'sha1' : ...`
  - **Risk:** if the repo uses a different algorithm (or future change), cache correctness breaks.
  - **Suggestion:** carry through the actual algorithm from cache metadata.
- **P1 — Empty importLinks can fail to overwrite stale ones.**
  - `normalizeImportLinks()` returns `[]` for “no links,” but application checks `if (importLinks)` which is falsy for empty arrays.
  - **Suggestion:** check against `null` rather than truthiness.

### `src/index/build/imports.js`
**Findings**
- **P1 — CommonJS import extraction likely underuses `cjs-module-lexer`.**
  - Only `reexports` are considered; `imports` from the lexer are not used.
  - **Suggestion:** incorporate `result.imports` to capture `require()` usage more accurately (reducing regex false positives/negatives).
- **P2 — Regex `require()` fallback can be noisy.**
  - Can match in comments/strings; consider comment stripping or a lightweight tokenizer.

### `src/index/build/shards.js`
**Findings**
- **P1 — `balanceShardsGreedy()` can destroy language/WASM grouping invariants.**
  - When `maxShards` is set, shards get merged into `lang: 'mixed'` batches.
  - This directly conflicts with “WASM grouping + sharding-aware streaming” requirements.
  - **Suggestion:** maintain a hard invariant: shards are grouped by WASM/lang family unless an explicit override is set.
- **P2 — Weight-based planning uses float keys in maps.**
  - Current tie-break strategy is probably fine, but consider using stable integer weights or tuple keys to avoid rare float-equality pitfalls.

### `src/index/build/tokenization.js`
**Findings**
- **P2 — Defensive copying increases CPU/memory.**
  - `buildTokenSequence()` copies arrays to avoid mutation by downstream retention; good for safety, but expensive at scale.
  - **Suggestion:** consider “immutable token sequence” structures or shallow freeze in debug mode.

### Remaining files (brief)
- `src/index/build/artifacts/compression.js`: **P2** config/policy clarity; ensure consistent compression coverage.
- `src/index/build/artifacts/filter-index.js`: **P2** imports `tools/dict-utils.js` (packaging boundary); `configHash` silently `null` on failure.
- `src/index/build/artifacts/metrics.js`: **P1** should be best-effort; wrap provenance/config hashing in try/catch.
- `src/index/build/artifacts/schema.js`: **P2** potential schema drift vs emitted optional fields.
- `src/index/build/artifacts/token-mode.js`: **P2** duplicated retention logic (also in postings step).
- `src/index/build/artifacts/writer.js`: **P2** minor naming clarity.
- `src/index/build/artifacts/writers/file-relations.js`: **P2** byte-size estimation uses `JSON.stringify` (may undercount if writer adds newlines/spacing).
- `src/index/build/artifacts/writers/repo-map.js`: **P2** builds full `entries` array (memory); prefer streaming/sharding for huge repos.
- `src/index/build/build-state.js`: **P2** concurrent updates can race; heartbeat/checkpoint can clobber fields.
- `src/index/build/file-processor/embeddings.js`: **P2** good batching; ensure consistent “empty doc” semantics across all writers.
- `src/index/build/file-processor/skip.js`: **P2** binary/minified heuristics can false-positive; ensure overrides exist.
- `src/index/build/artifacts/file-meta.js`: (see above)

---

## 2) Chunking + chunk IDs + comments/headlines

### `src/index/chunking.js`
- **P2** re-export surface for chunkers; no functional logic here.
  - **Suggestion:** add a small “API contract” test ensuring this module stays aligned with `dispatch.js` and the per-format chunkers.

### `src/index/chunking/tree-sitter.js`
- **P2** option wrapper only; ensure callers consistently pass `context.treeSitter` and `context.log`.

### `src/index/chunk-id.js`
- **P1 — Segment identity assumptions.**
  - Uses `chunk.segment?.segmentId`; verify segment objects actually expose `segmentId` (vs `id`). A mismatch causes cross-segment ID collisions.
  - **Suggested test:** build chunk IDs for two segments with same offsets; assert distinct IDs.

### `src/index/chunking/dispatch.js`
- **P2 — Dead import:** `getTreeSitterOptions` appears imported but unused.
- **P2 — Several chunkers use strict line-start prechecks** (e.g., Dockerfile-like chunking earlier in this file): leading whitespace may hide directives.

### Format chunkers
- `src/index/chunking/formats/json.js`: **P2** `parseJsonString()` / key scanning uses `slice().search(/\S/)` in a loop; can be O(n^2) on large JSON.
- `src/index/chunking/formats/yaml.js`: **P2** heuristic top-level chunking is good; ensure `maxBytes` is configurable and documented.
- `src/index/chunking/formats/xml.js`: **P2** simplistic tag parsing can be confused by `>` in attribute strings/CDATA.
- `src/index/chunking/formats/markdown.js`: **P2** heading chunking is reasonable; ensure tree-sitter mode respects chunk-size limits.
- `src/index/chunking/formats/rst-asciidoc.js`: **P2** heading detection is heuristic; OK.
- `src/index/chunking/formats/ini-toml.js`: **P2** TOML uses tree-sitter when enabled; INI falls back to section regex.

### `src/index/chunking/limits.js`
- **P2** byte-boundary splitting repeatedly calls `Buffer.byteLength(text.slice(...))`; expensive for very large strings.

### `src/index/comments.js`
- **P1 — User-supplied regex compilation can throw.**
  - If config accepts raw regex strings, invalid patterns can crash normalization.
  - **Suggestion:** compile in try/catch, return structured error, and downgrade to safe defaults.

### `src/index/headline.js`
- **P2** headline heuristics are sound; consider caching the stopword set and making the “stop word” list configurable.

### `src/index/field-weighting.js`
- **P2 — `test` detection uses `/test/i` on the full path.**
  - Can misclassify files like `contest.js`.
  - **Suggestion:** detect common path segments (`/test/`, `/__tests__/`) rather than substring match.

### `src/index/embedding.js`
- **P1/P2** quantization helpers do not normalize. This is acceptable if adapter guarantees normalization, but it should be explicit and tested.

---

## 3) Language registry + import collectors

### `src/index/language-registry/registry.js`
**Findings**
- **P1 — `collectLanguageImports()` likely passes options in an inconsistent shape.**
  - Calls: `lang.collectImports(text, { ext, relPath, mode, options })`.
  - Many collectors are written as `(text, options) => ...` and likely expect `options` to be the config object itself (flat), not nested.
  - **Risk:** silent “no imports” for collectors expecting flags at top-level.
  - **Suggestion:** standardize the collector interface:
    - Either `collectImports(text, ctx)` where `ctx.options` is nested intentionally, or
    - `collectImports(text, options)` and pass the user options directly, with `ext/relPath/mode` attached on the same object.
  - **Tests:** golden fixtures per language collector validating import extraction.

### `src/index/language-registry/import-collectors/dockerfile.js`
- **P1 — Stage aliases are treated as imports.**
  - `FROM image AS stage` adds both `image` and `stage` to imports.
  - **Why it matters:** stage names are local identifiers; they should not become graph nodes.
  - **Suggestion:** emit structured output: `{ images: [...], stages: {stage: image}, fromRefs: [...] }` (or keep stages separate and resolve `--from=stage` to `image`).

### Other import collectors (quick notes)
- `cmake.js`, `makefile.js`: **P2** regex import parsing can false-positive within comments; acceptable if treated as heuristic.
- `graphql.js`: **P2** `#import`/`import` variants should be confirmed against common GraphQL tooling conventions.
- `handlebars.js` / `mustache.js` / `jinja.js`: **P2** template include syntax variants (relative vs absolute) may need normalization.
- `razor.js`: **P2** can benefit from handling `@using` and tag helpers consistently.
- `nix.js`: **P2** `import` paths with interpolation may not normalize well.
- `proto.js`, `scala.js`, `groovy.js`, `julia.js`, `r.js`, `starlark.js`, `dart.js`: **P2** generally fine as heuristic collectors.
- `import-collectors/utils.js`: **P2** good line-length precheck; keep `MAX_REGEX_LINE` consistent with chunking prechecks.

### `src/index/language-registry/simple-relations.js`
- **P2** `normalizeImportToken()` strips quotes and some suffix punctuation; may under-normalize complex expressions.

### `src/index/language-registry/control-flow.js`
- **P2** control-flow summarization is clean; ensure `options.controlFlowEnabled` is actually wired in config.

### `src/index/language-registry.js`
- **P2** thin re-export; no issues.

---

## 4) Risk + structural + signature parsing + cross-file inference helpers

### `src/index/risk-rules.js`
- **P2** robust rule normalization/compilation via `safe-regex`.
- **P2** consider adding a first-class `enabled` field per rule and a warning surface when a rules file fails to parse (currently silent `null`).

### `src/index/structural.js`
- **P1 — Potential absolute-path leakage.**
  - If matches point outside `repoRoot`, `normalizePath()` returns `toPosix(raw)` which can preserve absolute paths.
  - **Suggestion:** enforce “repo-relative only” in strict mode, or clearly label external paths.

### `src/index/minhash.js`
- **P2** straightforward; consider adding a `digest()` method to return the final signature and ensuring deterministic seed handling.

### Signature parsers
- `src/index/tooling/signature-parse/clike.js`: **P2** does not handle all C/C++ constructs (function pointers, complex declarators); acceptable as heuristic.
- `src/index/tooling/signature-parse/python.js`: **P2** no handling of quoted types/PEP604 unions; acceptable.
- `src/index/tooling/signature-parse/swift.js`: **P2** defaults return type to `Void`; confirm this matches upstream tooling detail formatting.

### Cross-file inference helpers
- `src/index/type-inference-crossfile/apply.js`: **P1** assumes `docmeta` is non-null in `ensureInferred()`; callers should guard or make it defensive.
- `src/index/type-inference-crossfile/extract.js`: **P2** return-type extraction treats `docmeta.returns` as raw strings and may miss structured forms.
- `src/index/type-inference-crossfile/constants.js` / `symbols.js` / `type-inference-crossfile.js`: **P2** OK.

---

## 5) Retrieval: ANN providers + bitmap utilities

### ANN providers (`src/retrieval/ann/providers/*.js`)
- `dense.js`: **P2** vector-like embedding check is good.
- `hnsw.js` / `lancedb.js`: **P1** `isAvailable()` can return true based on state while the loaded index handle is absent in `idx`.
  - **Suggestion:** either (a) ensure `idx.hnsw/idx.lancedb` is always present when `available`, or (b) make availability require the handle.
- `sqlite-vec.js`: **P2** clean gate on `rankVectorAnnSqlite` and `vectorAnnState`.

### `src/retrieval/bitmap.js`
- **P2** good optional-dep behavior.
- **P2** minor: `buildBitmapIndex()` resolves `Bitmap` but does not use the local variable; harmless.

### `src/retrieval/ann/types.js`
- **P2** OK.

---

## 6) Retrieval: CLI helpers

### `src/retrieval/cli-dictionary.js`
- **P2 — Packaging boundary:** imports `../../tools/dict-utils.js`.
- **P2 — Silent failures:** dictionary file read errors are swallowed.
  - **Suggestion:** emit a warning in verbose mode listing missing/unreadable dictionary paths.

### `src/retrieval/cli/branch-filter.js`
- **P2** OK; clear behavior.

### `src/retrieval/cli/highlight.js`
- **P2 — Potential catastrophic regex growth.**
  - Joining many tokens into a single alternation can produce a huge regex and slow rendering.
  - **Suggestion:** cap highlight tokens or switch to a multi-pattern search strategy.

### `src/retrieval/cli/load-indexes.js`
- **P2 — Uses `tools/` helpers (`resolveToolRoot`).** Packaging boundary risk.
- **P2 — Tantivy autobuild uses `spawnSync` without passing effective config.**
  - **Suggestion:** pass a config path/hash, and ensure produced index matches the active settings.

### `src/retrieval/cli-lmdb.js` and `src/retrieval/cli-sqlite.js`
- **P2** Good fallback behavior (forced backend errors vs warnings).
- **P2** Consider emitting an “effective backend” summary (what was requested vs what was used).

### Other CLI modules (brief)
- `src/retrieval/cli/ansi.js`: **P2** OK.
- `src/retrieval/cli/auto-sqlite.js`: **P2** ensure OS-specific paths/permissions are handled.
- `src/retrieval/cli/backend-context.js`: **P2** watch for config drift and keep “effective config” auditable.
- `src/retrieval/cli/model-ids.js`: **P2** OK.
- `src/retrieval/cli/options.js`: **P2** ensure defaults are consistent across CLI/API/MCP.
- `src/retrieval/cli/persist.js`: **P2** ensure persistence format/versioning is explicit.
- `src/retrieval/cli/policy.js`: **P2** ensure policy errors include remediation steps.
- `src/retrieval/cli/query-plan.js`: **P2** ensure plan includes pruning stages and candidate-set sizes.
- `src/retrieval/cli/search-runner.js`: **P2** consider explicit timeouts for optional backends.
- `src/retrieval/cli/telemetry.js`: **P2** OK.

---

## 7) Retrieval: core helpers + output

### `src/retrieval/context-expansion.js`
**Findings**
- **P1 — Assumes `chunkMeta[id]` addressing is valid.**
  - It pushes `chunk.id` values into `byName/byFile`, then later resolves via `chunkMeta[id]`.
  - If IDs become sparse/remapped, context expansion breaks.
  - **Suggestion:** build an explicit `id -> chunk` map during `buildContextIndex()` and resolve through it.
- **P1 — Call expansion uses `sourceChunk.codeRelations.calls` only.**
  - Languages that store calls only at file-level (`fileRelations.calls`) may be under-expanded.
  - **Suggestion:** optionally consult file-level calls for the source file.

### `src/retrieval/filters.js`
- **P1 — Windows absolute paths conflict with `key:value` parsing.**
  - `C:\foo\bar` is interpreted as `key='c' value='\foo\bar'`.
  - **Suggested fix:** detect drive-letter paths (`/^[A-Za-z]:[\\/]/`) and treat them as file tokens.

### `src/retrieval/lmdb-helpers.js`
- **P1 — Falsy checks drop valid zeros when merging file meta into chunks.**
  - Examples: `if (!chunk.churn) chunk.churn = meta.churn` should be `chunk.churn == null`.
- **P2 — HNSW is loaded from filesystem even when using LMDB.**
  - Portability issue for “single-file” LMDB distributions.

### `src/retrieval/sqlite-helpers.js`
- **P2 — Score normalization uses `Math.min(...rawScores)` spread.**
  - Large `topN` could exceed call-argument limits.
  - **Suggestion:** use loop-based min/max.

### `src/retrieval/filter-index.js`
- **P2** file paths are lowercased; acceptable but note case-sensitive FS ambiguity.

### `src/retrieval/embedding.js`
- **P2** creates embedding adapter per call; ensure adapter is internally cached to avoid per-query overhead.

### Output modules
- `src/retrieval/output/cache.js`: **P2** good cache wrapper with env overrides.
- `src/retrieval/output/context.js`: **P2** OK.
- `src/retrieval/output/explain.js`: **P2** OK.
- `src/retrieval/output/summary.js`: **P2** OK; uses caches correctly.
- `src/retrieval/output.js`: **P2** re-export only.

---

## 8) Retrieval: query parsing + sparse providers + sqlite caches

### `src/retrieval/query.js`
**Findings**
- **P1 — OR semantics are flattened away for token lists.**
  - `flattenQueryAst()` merges AND/OR branches into the same include list.
  - If later stages rely on `includeTerms` for candidate generation/ranking, OR may not behave as users expect.
  - **Suggestion:** either (a) make OR a first-class execution plan concept or (b) document that OR is treated as “bag of terms” except for AST-based filters.
- **P1 — Phrase n-gram generation drops phrases outside `[minN,maxN]` entirely.**
  - `buildPhraseNgrams()` skips phrases when `tokens.length > maxAllowed`.
  - **Suggestion:** for long phrases, generate n-grams for n in `[minAllowed,maxAllowed]` (sliding) rather than skipping.
- **P2 — Quoted phrase parsing does not support escaping.**

### `src/retrieval/query-intent.js`
- **P2** sensible heuristics; consider making thresholds configurable and surfacing a breakdown in `--explain`.

### `src/retrieval/query-parse.js`
- **P2** re-export only.

### Sparse providers
- `src/retrieval/sparse/providers/js-bm25.js`: **P2** OK.
- `src/retrieval/sparse/providers/sqlite-fts.js`: **P2** OK.
- `src/retrieval/sparse/providers/tantivy.js`: **P2** caches index handles without explicit close.
- `src/retrieval/sparse/types.js`: **P2** OK.

### SQLite cache
- `src/retrieval/sqlite-cache.js`: **P2** good signature-based invalidation; consider including inode/dev where available.

---

## Recommended tests (high leverage)

1. **Chargram emission regression** (`src/index/build/state.js`)
   - Token list includes one oversized token then normal tokens.
   - Assert chargram postings exist for normal tokens.

2. **Vector-like embeddings accepted everywhere** (`src/index/build/indexer/steps/postings.js`, `src/index/build/postings.js`)
   - Provide embeddings as `Float32Array` and `Uint8Array`; assert quantization and ANN structures are non-zero.

3. **Import collector option-shape contract** (`src/index/language-registry/registry.js`)
   - Golden fixtures per collector; assert imports are extracted consistently.

4. **Windows path parsing** (`src/retrieval/filters.js`)
   - `C:\repo\src\file.js` should be interpreted as a file/path filter token.

5. **Context expansion ID resolution** (`src/retrieval/context-expansion.js`)
   - Build chunkMeta with sparse IDs; ensure expansion still finds neighbors via a map.

