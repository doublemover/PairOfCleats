# Codebase Static Review — Pass 5 (Artifacts, Postings, Chunking, Language Registry)

This document records a static (non-executing) review of the files explicitly listed in the request. It focuses on correctness bugs, mis-implementations, performance traps, determinism/caching risks, and missing guardrails.

---

## Scope

### Files reviewed

#### Build artifacts / build state / postings pipeline
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

#### Chunking + chunk formats + related utilities
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

#### Language registry + import collectors
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

### Not in scope
Anything not listed above (even if referenced by these modules) was not reviewed in this pass.

---

## Severity legend

- **Critical**: Highly likely to cause incorrect outputs, crashes, or silent index corruption under realistic workloads.
- **High**: Significant correctness/quality risks or severe performance hazards.
- **Medium**: Meaningful but not catastrophic issues; often edge cases or “death by a thousand cuts.”
- **Low**: Paper cuts, maintainability issues, or conservative “tighten it up” opportunities.

---

## Executive summary

The largest risks in this slice of the codebase cluster into five buckets:

1) **Embeddings handling is not type-robust in some code paths.** Several parts of the postings pipeline treat float embeddings as “must be Array,” which can silently discard embeddings when providers return `Float32Array` or other typed arrays. This is a correctness risk for dense retrieval and hybrid scoring.

2) **Chargram extraction has a concrete logic bug and multiple “defaults can be missing” hazards.** In `appendChunk()`, a single overly-long token can abort chargram extraction for the entire chunk (likely unintended), and chargram min/max N relies on config being pre-normalized.

3) **Chunking for JSON/XML includes expensive O(n²) patterns and brittle heuristics.** Both JSON and XML format chunkers use repeated `slice(...).search/match(...)`, which can degrade badly on large inputs. The XML chunker also mis-detects self-closing tags with whitespace.

4) **Several artifacts are vulnerable to nondeterminism and metadata drift.** Most notably, `file_relations` is written in Map insertion order without sorting, and `file_meta.ext` can be derived from per-chunk (segment) extensions instead of the actual file extension.

5) **There are multiple “config knobs exist but are not enforced” patterns.** The most clear-cut example is `src/index/comments.js`, where `includeLicense/maxPerChunk/maxBytesPerChunk/includeInCode/minTokens` exist in normalization but are not applied in extraction.

---

## Findings

### 1) Critical — Embedding vectors can be silently discarded when stored as typed arrays

**Where**
- `src/index/build/indexer/steps/postings.js` (embedding_u8 derivation)
- `src/index/build/postings.js` (legacy float → u8 quantization path)

**Evidence**
- Postings step checks only `Array.isArray(...)` before quantizing float vectors (typed arrays fail this check):
  - `hasCode = Array.isArray(rawCode) && rawCode.length;` (`src/index/build/indexer/steps/postings.js:101–103`)
  - `hasMerged = Array.isArray(merged) && merged.length;` (`src/index/build/indexer/steps/postings.js:114–116`)
- Legacy postings builder similarly checks `Array.isArray(...)` for float embeddings:
  - `if (!Array.isArray(chunk?.embedding) || !chunk.embedding.length) return zeroVec;` (`src/index/build/postings.js:271–274`)
  - same pattern for `embed_doc` and `embed_code` (`src/index/build/postings.js:275–289`)

**Why this is a real bug / mis-implementation**
- The embedding pipeline already uses typed arrays in other places (and even within this file there is an `isVectorLike` concept elsewhere), so treating “float vector = Array only” is not a safe invariant.
- If any provider returns `Float32Array` (a common choice), these checks will fail and the code will either:
  - emit missing u8 vectors, or
  - fall back to zeros,
  - while also deleting float fields in some paths—effectively losing embeddings entirely.

**Impact**
- Dense or hybrid retrieval can degrade to “no vector signal” for some or all chunks.
- Worst case: silent correctness issues (no crash, but the index is materially worse).

**Suggested fix direction**
- Replace `Array.isArray(vec)` gates with a shared “vector-like” predicate:
  - accept `Array.isArray(vec)` OR `ArrayBuffer.isView(vec)` for float vectors,
  - ensure element type is numeric (for typed arrays, `BYTES_PER_ELEMENT === 4` is a good proxy for float32).
- Ensure quantizers accept typed arrays directly; if not, convert with `Array.from(...)` or `Float32Array.from(...)`.

**Tests to add**
- Fixture chunk objects with `embedding`, `embed_code`, `embed_doc` as `Float32Array` and verify:
  - `embedding_u8/embed_code_u8/embed_doc_u8` are emitted,
  - dims are consistent,
  - dense search code paths do not treat those chunks as missing vectors.

---

### 2) High — Chargram extraction aborts the entire chunk on a single long token

**Where**
- `src/index/build/state.js`

**Evidence**
- In `addFromTokens`, a token exceeding `chargramMaxTokenLength` triggers `return;`, which aborts the entire token loop and exits chargram extraction:
  - `if (chargramMaxTokenLength && w.length > chargramMaxTokenLength) return;` (`src/index/build/state.js:255–257`)

**Why this is a real bug / mis-implementation**
- A single long token (e.g., minified blobs, base64, embedded binaries) should generally be *skipped*, not cause chargram extraction to stop for all subsequent tokens.
- The current behavior creates partial, order-dependent chargram sets (whatever was accumulated before the long token).

**Impact**
- Inconsistent and degraded chargram postings.
- Fuzzy/substring prefiltering becomes less reliable exactly on files where it’s most needed (minified/large tokens).

**Suggested fix direction**
- Change the early `return` to `continue` so the long token is skipped but processing continues.
- Consider recording a guard statistic (e.g., `guard.truncatedChunks` or a new `guard.skippedLongTokens`) so users can see that the cap is in effect.

**Tests to add**
- A token list that includes: `["normal", "x".repeat(5000), "after"]` should still generate chargrams for `"after"`.

---

### 3) High — Chargram min/max N relies on pre-normalized config, with no safe fallback

**Where**
- `src/index/build/state.js`

**Evidence**
- Chargram emission iterates directly on `postingsConfig.chargramMinN/chargramMaxN`:
  - `for (let n = postingsConfig.chargramMinN; n <= postingsConfig.chargramMaxN; ++n)` (`src/index/build/state.js:258–259`)
- Unlike phrase n-grams, there is no numeric fallback when these values are missing/undefined.

**Why this matters**
- This works only if every caller guarantees `postingsConfig` has already been normalized.
- If a raw config object (missing these keys) is passed into `appendChunk(...)`, chargram extraction silently becomes a no-op.

**Impact**
- Silent feature loss depending on call path / config plumbing.

**Suggested fix direction**
- Normalize config inside `appendChunk(...)` (or at least normalize the chargram sub-config locally) the same way other callers do.
- If normalization is intentionally “upstream only,” assert required numeric fields and emit a clear warning.

**Tests to add**
- Call `appendChunk(...)` with a minimal postings config lacking `chargramMinN/MaxN` and verify chargrams still emit (or verify it hard-fails with an explicit error).

---

### 4) High — `appendChunk()` drops chunks entirely when `seq/tokens` are empty

**Where**
- `src/index/build/state.js`

**Evidence**
- Early return prevents chunk from entering the index state if token sequence is empty:
  - `if (!seq.length) return;` (`src/index/build/state.js:218`)

**Why this is risky**
- In the current pipeline, it may be true that all chunks always have tokens before this point.
- However, multiple roadmap items (vector-only indexing, aggressive token pruning, indexing “metadata-only” artifacts) imply future situations where a chunk can be meaningful without token sequences.

**Impact**
- Potential silent dropping of chunks (and therefore file coverage gaps) when token production is disabled or fails for a file.

**Suggested fix direction**
- If the invariant truly holds (“no tokens means chunk is useless”), enforce it explicitly by:
  - storing a skip reason on the file/chunk,
  - incrementing a metric,
  - and surfacing it in validation.
- Otherwise, allow a “tokenless chunk” path where:
  - embeddings and metadata still persist,
  - token postings simply skip.

**Tests to add**
- A chunk that has embeddings but no tokens should still appear in chunk meta + vector postings artifacts (for vector-only modes).

---

### 5) Medium — Postings guard disables *all* further additions after max-unique is hit

**Where**
- `src/index/build/state.js`

**Evidence**
- Once `guard.disabled` is set, all future `appendDocIdToPostingsMap(...)` calls return immediately, even for keys already present:
  - `if (guard?.disabled) return;` (`src/index/build/state.js:43`)
  - `guard.disabled = true;` when `map.size >= guard.maxUnique` (`src/index/build/state.js:46–51`)

**Why this matters**
- The intent of `maxUnique` usually is “stop admitting new keys,” not “freeze the entire postings structure.”
- Freezing can cause the remainder of the corpus to contribute nothing to phrase/chargram indices, which is a strong, global side-effect.

**Impact**
- Phrase/chargram support can become heavily skewed toward earlier shards/batches.
- The behavior is order-dependent (whichever shards run first win).

**Suggested fix direction**
- Split the guard concept:
  - `disabledNewKeys`: stop adding unseen terms when cap is reached,
  - but still append docIds to already-seen keys.
- If the current behavior is intentional, it should be documented and surfaced in metrics (e.g., “phrase indexing disabled after cap at chunk X”).

**Tests to add**
- A test where `maxUnique` is intentionally tiny should still allow doc IDs to be appended for existing keys after the cap.

---

### 6) High — `file_meta.ext` can reflect segment/chunk extension, not the file’s extension

**Where**
- `src/index/build/artifacts/file-meta.js`

**Evidence**
- The per-file `ext` is populated from the first seen chunk’s `ext`:
  - `if (!info.ext && entry.ext) info.ext = entry.ext;` (`src/index/build/artifacts/file-meta.js:57`)
- There is no fallback to compute extension from the actual file path.

**Why this is a real problem**
- For container formats (Vue/Svelte/Astro) the chunk extension can represent an embedded language segment (e.g., `.ts`), while the file is `.vue`.
- `file_meta` is a file-level artifact; mixing in segment extensions breaks filters and stats.

**Impact**
- Incorrect file-type filtering, reporting, and UI grouping.
- Potential downstream confusion when the same file appears to be multiple language types depending on first chunk.

**Suggested fix direction**
- Always derive `ext` from `file` (path-based), and store segment extensions separately (already available on chunks).
- If a “dominant embedded language” is desired, store it as a separate field (e.g., `primaryLanguageId`) rather than overloading `ext`.

**Tests to add**
- A `.vue` file with a TypeScript `<script lang="ts">` segment should still have `file_meta.ext === '.vue'`.

---

### 7) Medium — `externalDocs` is captured from only the first chunk; later chunks are ignored

**Where**
- `src/index/build/artifacts/file-meta.js`

**Evidence**
- Only sets `externalDocs` once:
  - `if (!info.externalDocs && c.externalDocs) info.externalDocs = c.externalDocs;` (`src/index/build/artifacts/file-meta.js:62–64`)

**Impact**
- If `externalDocs` can be emitted per-chunk (e.g., multiple doc blocks in a file), data can be lost.

**Suggested fix direction**
- Decide the contract:
  - If `externalDocs` is file-level, emit it in a deterministic way (merge/concat + dedupe).
  - If chunk-level, do not store it in `file_meta` (or store only a summary).

**Tests to add**
- A file that emits multiple `externalDocs` entries should produce merged/deduped file_meta output.

---

### 8) High — `file_relations` output ordering is nondeterministic (Map insertion order)

**Where**
- `src/index/build/artifacts/writers/file-relations.js`

**Evidence**
- Iterator uses `relations.entries()` directly:
  - `for (const [file, rel] of relations.entries()) { ... }` (`src/index/build/artifacts/writers/file-relations.js:9–17`)

**Why this matters**
- Map insertion order depends on processing order, which is often non-deterministic under concurrency, incremental builds, or different shard scheduling.
- This artifact is a key dependency for downstream graph-aware features and caching.

**Impact**
- Non-reproducible artifacts (different byte-level output for same logical content).
- Cache key instability and spurious “changed” diffs.

**Suggested fix direction**
- Emit `file_relations` in sorted key order (lexicographic path order):
  - sort keys once, then yield in order.
- If performance is a concern, store fileRelations in a stable map/array in the first place.

**Tests to add**
- Determinism test: build fileRelations in two different insertion orders; emitted artifact bytes should match.

---

### 9) Medium — Sharded `file_relations` metadata depends on ambiguous `result.counts` semantics

**Where**
- `src/index/build/artifacts/writers/file-relations.js`

**Evidence**
- Sharded writer sets:
  - `shardSize = Math.max(...result.counts)` and stores it as `meta.shardSize` (`src/index/build/artifacts/writers/file-relations.js:71–77`)
  - `addPieceFile(..., { count: result.counts[i] })` (`src/index/build/artifacts/writers/file-relations.js:80–86`)

**Why this is risky**
- Without a clear contract, `counts` could mean “bytes per shard” or “records per shard.”
- Using the same `counts` value as both a per-piece `count` and a global `shardSize` can mislead metrics/validation.

**Suggested fix direction**
- Make the sharded writer return explicit fields, e.g.:
  - `partBytes[]`, `partRecords[]`, `maxPartBytes`, `maxPartRecords`.
- Store both bytes and record counts in piece manifests; they serve different purposes.

**Tests to add**
- Unit test with a known small relations map where you can assert `partRecords` exactly.

---

### 10) Medium — Repo map generation is “load-all-then-sort,” which can be memory-heavy

**Where**
- `src/index/build/artifacts/writers/repo-map.js`

**Evidence**
- The writer collects all entries into an array before sorting:
  - `const entries = []; ... entries.push(...)` (`src/index/build/artifacts/writers/repo-map.js:42–84`)
  - followed by `entries.sort(...)` (`src/index/build/artifacts/writers/repo-map.js:86–90`)

**Impact**
- Large repos with many chunks/symbols can cause memory spikes.

**Suggested fix direction**
- If ordering is required, consider:
  - sorting per-file buckets (reduce peak memory), or
  - streaming to a temp shard per directory and then merging.
- If ordering is not strictly required, avoid sorting and rely on deterministic shard ordering upstream.

**Tests to add**
- Stress fixture with many entries to ensure runtime stays within a target memory ceiling.

---

### 11) Medium — Import scanning reads cached imports twice for “cache miss” files

**Where**
- `src/index/build/imports.js`

**Evidence**
- First pass reads cached imports for each item to compute counts for sorting:
  - `const cachedImports = await readCachedImports(item, { incrementalState })` (`src/index/build/imports.js:134–146`)
- Second pass reads cached imports again when `cachedImportsByFile` has no entry:
  - `imports = await readCachedImports(item, { incrementalState })` (`src/index/build/imports.js:176–186`)

**Why this matters**
- For cache misses, the same “read cached imports” I/O is attempted twice.
- On large repos with limited incremental coverage, this is unnecessary overhead.

**Suggested fix direction**
- Record “misses” in the first pass (e.g., store `null` sentinel) so the second pass doesn’t re-check.
- Alternatively, compute size-based priority without pre-reading caches, or pre-read only for a top-K subset.

**Tests to add**
- A test harness that counts calls to `readCachedImports` for cache-miss files should show at most 1 call per file.

---

### 12) Medium — `filter-index` chargramN fallback can be undefined

**Where**
- `src/index/build/artifacts/filter-index.js`

**Evidence**
- `fileChargramN` falls back to `resolvedConfig.chargramMinN` without an internal default:
  - `: resolvedConfig.chargramMinN;` (`src/index/build/artifacts/filter-index.js:18–21`)

**Impact**
- If `resolvedConfig.chargramMinN` is not set (or renamed), filter index building can become inconsistent or dependent on downstream defaults.

**Suggested fix direction**
- Establish a local default (e.g., `3`) when neither `filePrefilterConfig.chargramN` nor `resolvedConfig.chargramMinN` is valid.
- Add schema validation for this key.

**Tests to add**
- Build filter index with a config missing `chargramMinN` and verify `buildFilterIndex` is invoked with a stable, explicit `chargramN`.

---

### 13) Medium — Cached bundle path hard-codes hash algorithm in fileInfo

**Where**
- `src/index/build/file-processor/cached-bundle.js`

**Evidence**
- File hash algorithm is set to `'sha1'` whenever a hash exists:
  - `hashAlgo: resolvedHash ? 'sha1' : null` (`src/index/build/file-processor/cached-bundle.js:48`)
- Even though the function receives `fileHashAlgo` and can set chunk-level `fileHashAlgo` later (`src/index/build/file-processor/cached-bundle.js:82–87`).

**Impact**
- Metadata can become internally inconsistent: file-level hashAlgo says sha1, chunk-level may say something else.
- If other algorithms are introduced (or already supported), correctness and debugging suffer.

**Suggested fix direction**
- Use `fileHashAlgo` for fileInfo when provided, otherwise use cached entry metadata.
- If only sha1 is supported today, remove the illusion of configurability or assert sha1 explicitly.

**Tests to add**
- A test where `fileHashAlgo !== 'sha1'` should either:
  - preserve that algo consistently, or
  - hard-fail with a clear error.

---

### 14) Medium — Cached bundle reconstructs fileRelations from a single chunk when missing

**Where**
- `src/index/build/file-processor/cached-bundle.js`

**Evidence**
- When bundle-level `fileRelations` is missing, it samples one chunk:
  - `const sample = updatedChunks.find((c) => c?.codeRelations);` (`src/index/build/file-processor/cached-bundle.js:67–71`)
  - `buildFileRelations(sample.codeRelations, relKey);` (`src/index/build/file-processor/cached-bundle.js:72`)

**Why this is risky**
- If relations are distributed across chunks (or chunk-level relations differ), reconstructing from one chunk can be incomplete.

**Suggested fix direction**
- Recompute fileRelations from the union of chunk relations (if that’s the intended model), or
- Require bundle-level fileRelations as an invariant and treat missing as a cache invalidation.

**Tests to add**
- A file with exports/imports spread across multiple chunks should reconstruct identical fileRelations after caching.

---

### 15) Medium — Build state updates are not concurrency-safe and may include an unintended top-level `phase`

**Where**
- `src/index/build/build-state.js`

**Evidence**
- `markBuildPhase` writes a patch containing both `phases[...]` and a top-level `phase` key:
  - `updateBuildState(buildRoot, { phase, phases: { [phase]: next } })` (`src/index/build/build-state.js:88–91`)
- `updateBuildState` is a read-merge-write cycle with no lock; concurrent writers can lose updates (`src/index/build/build-state.js:29–46`).

**Impact**
- If multiple processes update build_state concurrently (watch mode, multi-stage pipelines), updates can clobber.
- The top-level `phase` key may drift from the intended schema (if the schema expects only `phases`).

**Suggested fix direction**
- Decide whether `phase` is intended:
  - If yes, document it and include it in any schema/validation.
  - If no, remove it from the patch.
- Add a simple lock or “retry-on-conflict” strategy if concurrent updates are plausible.

**Tests to add**
- Simulated concurrent updates should preserve both writers’ patches.

---

### 16) High — JSON chunking uses full `JSON.parse` and an O(n²) string scan

**Where**
- `src/index/chunking/formats/json.js`

**Evidence**
- Parses the entire file:
  - `parsed = JSON.parse(text);` (`src/index/chunking/formats/json.js:37–40`)
- Per-string scan uses `text.slice(parsedString.end + 1).search(/\S/)`, creating a new substring for each string token:
  - (`src/index/chunking/formats/json.js:54–55`)

**Impact**
- Large JSON can:
  - blow memory (full parse),
  - run very slowly (O(n²) substring creation),
  - or fail and fall back to “no chunking.”

**Suggested fix direction**
- Avoid full `JSON.parse` for chunking purposes. Instead:
  - implement a streaming top-level key scanner,
  - or rely on tree-sitter config chunking where possible.
- Replace the `slice(...).search(...)` with a forward whitespace scan from `parsedString.end + 1`.

**Tests to add**
- Large JSON fixture (multi-MB) should chunk in bounded time and without full parse.

---

### 17) Medium — XML chunking has O(n²) scanning and mis-detects self-closing tags with whitespace

**Where**
- `src/index/chunking/formats/xml.js`

**Evidence**
- Tag detection uses `text.slice(i + 1).match(...)` on each candidate, creating many substrings (`src/index/chunking/formats/xml.js:26`).
- Self-close detection checks only `text[closeIdx - 1] === '/'` (`src/index/chunking/formats/xml.js:33`), which fails for `<tag />`.

**Impact**
- Performance degradation on large XML.
- Wrong depth tracking → incorrect “top-level section” detection.

**Suggested fix direction**
- Implement tag-name scanning without substring allocation (scan forward from `i+1`).
- For self-close detection, skip whitespace backwards from `closeIdx - 1` before checking `/`.

**Tests to add**
- XML fixture containing `<a />` and `<a/>` should behave identically.

---

### 18) Medium — Dockerfile chunking ignores indented instructions due to an overly strict precheck

**Where**
- `src/index/chunking/dispatch.js`

**Evidence**
- Precheck requires first character be uppercase A–Z:
  - `if (!line || (line[0] < 'A' || line[0] > 'Z')) continue;` (`src/index/chunking/dispatch.js:132`)
- But the actual regex supports leading whitespace:
  - `const rx = /^\s*([A-Z][A-Z0-9_-]+)\b/;` (`src/index/chunking/dispatch.js:128`)

**Impact**
- Indented `FROM`, `RUN`, etc. lines won’t be recognized as headings.

**Suggested fix direction**
- Remove the `line[0]` precheck or replace it with a trimmed-first-char check.

**Tests to add**
- Dockerfile fixture where instructions are indented should still chunk by instruction.

---

### 19) Medium — Chunking guardrails can be expensive due to repeated `Buffer.byteLength(text.slice(...))`

**Where**
- `src/index/chunking/limits.js`

**Evidence**
- Byte boundary finder repeatedly slices text and re-measures UTF-8 bytes in a binary search:
  - `Buffer.byteLength(text.slice(start, mid), 'utf8')` inside loop (`src/index/chunking/limits.js:66–79`)
- Splitting by bytes calls that binary search repeatedly across a long chunk (`src/index/chunking/limits.js:91–99`).

**Impact**
- For large unicode-rich documents, this can become a dominant CPU and allocation cost.

**Suggested fix direction**
- Prefer a linear scan that accumulates byte length (or uses a coarse step + refine) without repeated substring allocation.
- If exact UTF-8 byte boundaries are not required for chunking, consider approximating via codepoint count and only refining near the limit.

**Tests to add**
- Performance regression test (not in unit suite) that chunks a multi-MB UTF-8 document within a bounded time.

---

### 20) High — Comment extraction normalizes multiple config controls but never applies them

**Where**
- `src/index/comments.js`

**Evidence (config keys exist but are not enforced)**
- Defaults include limits/toggles: `includeLicense`, `includeInCode`, `minTokens`, `maxPerChunk`, `maxBytesPerChunk`. (`src/index/comments.js:6–14`)
- `normalizeCommentConfig()` returns those keys. (`src/index/comments.js:210–229`)
- `extractComments(...)` never checks them; it only gates on `extract`, min char heuristics, and generated/linter skips. (`src/index/comments.js:421+`)

**Impact**
- Users cannot tune comment extraction size or behavior.
- Comment-heavy files can bloat chunk metadata and increase I/O.

**Suggested fix direction**
- Enforce:
  - `includeLicense`: skip license-type comments unless enabled.
  - `minTokens`: token-count gate (cheap whitespace split is fine).
  - `maxPerChunk/maxBytesPerChunk`: cap entries and/or truncate stored `raw/text`.
  - `includeInCode`: define an explicit integration point (whether comments are injected into chunk text for embeddings/search).

**Tests to add**
- Unit tests for each config key (especially license gating and max caps).

---

### 21) Medium — Overlapping `COMMENT_STYLES` entries create precedence ambiguity

**Where**
- `src/index/comments.js`

**Evidence**
- First mapping includes `html`, `markdown`, `mdx` with `strings: []`. (`src/index/comments.js:55–60`)
- Later mapping also includes `markdown` and `html` but with `strings: ['"', "'"]`. (`src/index/comments.js:119–124`)
- Resolver returns the *first* match only. (`src/index/comments.js:232–237`)

**Impact**
- The later mapping is unreachable for `html` and `markdown`, which makes the intent unclear and can produce wrong scanning behavior in edge cases.

**Suggested fix direction**
- Remove overlaps (ensure each language id maps to exactly one comment style).
- If the second mapping is the desired one, consolidate and ensure `markdown/html` use the intended scanner settings.

---

### 22) Medium — Dockerfile import collector treats stage aliases as “imports”

**Where**
- `src/index/language-registry/import-collectors/dockerfile.js`

**Evidence**
- Captures `AS <stage>` and adds it to imports:
  - `if (fromMatch[2]) imports.add(fromMatch[2]);` (`src/index/language-registry/import-collectors/dockerfile.js:14`)

**Why this is questionable**
- Stage aliases are local identifiers, not external dependencies.
- Mixing them into import graphs can create misleading edges.

**Suggested fix direction**
- Keep base images as “imports.”
- Treat stage aliases as internal symbols (optional: expose them separately as `stages[]`).

**Tests to add**
- Dockerfile with `FROM node AS build` should only import `node` (unless stage aliases are intentionally modeled).

---

### 23) Medium — JavaScript language registry `prepare()` computes tree-sitter chunks that appear unused

**Where**
- `src/index/language-registry/registry.js`

**Evidence**
- JS `prepare()` builds tree-sitter chunks and stores them as `context.jsChunks` (`src/index/language-registry/registry.js:92–99`).
- JS `buildRelations` uses only `context?.jsAst` (`src/index/language-registry/registry.js:104–111`) and does not consume `jsChunks`.

**Impact**
- Potential wasted work (tree-sitter parse + chunk build) during relations building.
- In a WASM-heavy pipeline, this can be nontrivial overhead.

**Suggested fix direction**
- Verify whether `context.jsChunks` is consumed elsewhere.
  - If not, remove it.
  - If yes, rename the field to match the consumer’s expectations and document the contract.

**Tests to add**
- Not a unit test; this is better verified with a micro-benchmark or instrumentation showing whether tree-sitter is invoked for JS in normal indexing flows.

---

### 24) Low — `field-weighting` heuristics can misclassify paths via substring “test”

**Where**
- `src/index/field-weighting.js`

**Evidence**
- Treats any path that matches `/test/i` as test-like and reduces its weight (`src/index/field-weighting.js:12–15`).

**Impact**
- False positives for paths like `latest`, `contest`, `attest`, etc.

**Suggested fix direction**
- Match on path segments (e.g., `/\b(test|tests|__tests__)\b/` on normalized path segments).

---

### 25) Low — `headline` builds stopword sets per call

**Where**
- `src/index/headline.js`

**Evidence**
- `codeStop` is constructed inside `getChunkHeadline(...)` each call (`src/index/headline.js:21–25`).

**Impact**
- Minor extra CPU/allocations when many results are rendered.

**Suggested fix direction**
- Hoist `codeStop` to module scope.

---

## Suggested cross-cutting tests (targeted, high value)

1) **Deterministic artifacts**
   - Build `file_relations` from the same logical map with different insertion orders; ensure identical output bytes.

2) **Typed-array embeddings compatibility**
   - Feed `Float32Array` vectors through postings builder and ensure u8 vectors are emitted.

3) **Chunking scalability fixtures**
   - Large JSON: ensure chunking does not OOM and does not degrade to quadratic behavior.
   - XML with `<tag />` forms: ensure depth tracking and top-level chunk detection is correct.

4) **Config enforcement**
   - Comment extraction config keys must be enforced or removed; tests should hard-fail on drift.

---

## Notes on “what to tighten next” (implementation quality)

These are not “bugs” in isolation, but they directly reduce the reliability and scalability of planned features:

- **Avoid substring allocation inside tight loops** (JSON/XML chunkers, chunking limits). This is one of the easiest ways to accidentally get O(n²) behavior.
- **Normalize config at module boundaries** (postings config, chargrams) or assert invariants loudly.
- **Prefer stable ordering for artifact emission** whenever artifacts are hashed, cached, diffed, or used as inputs to incremental builds.

