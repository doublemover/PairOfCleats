# Codebase Static Review Findings — Artifact Writers / Postings / Shards (“Pass 5A”)

This is a **static** (read-only) review of the specific files you listed. The emphasis is on **correctness bugs**, **mis-implementations**, **config drift**, and **performance/scalability hazards**—especially hazards that can undermine shard planning, incremental indexing correctness, and high-throughput artifact writing. No bugs are fixed in this document; it only describes what appears wrong and how to address it.

## Scope

Reviewed only the files you specified:

- Artifact configuration + schema
  - `src/index/build/artifacts/compression.js`
  - `src/index/build/artifacts/file-meta.js`
  - `src/index/build/artifacts/filter-index.js`
  - `src/index/build/artifacts/metrics.js`
  - `src/index/build/artifacts/schema.js`
  - `src/index/build/artifacts/token-mode.js`
  - `src/index/build/artifacts/writer.js`
- Artifact writers
  - `src/index/build/artifacts/writers/file-relations.js`
  - `src/index/build/artifacts/writers/repo-map.js`
- Build state + processor helpers
  - `src/index/build/build-state.js`
  - `src/index/build/file-processor/cached-bundle.js`
  - `src/index/build/file-processor/embeddings.js`
  - `src/index/build/file-processor/skip.js`
- Imports + postings + sharding + state
  - `src/index/build/imports.js`
  - `src/index/build/indexer/steps/postings.js`
  - `src/index/build/postings.js`
  - `src/index/build/shards.js`
  - `src/index/build/state.js`
  - `src/index/build/tokenization.js`

---

## Executive summary

### Highest priority correctness issues

1. **`compressionEnabled` is not a boolean (it becomes the string `gzip`/`zstd`).**
   - `src/index/build/artifacts/compression.js:16`
   - This can break code that expects a boolean, and it makes config dumps/metrics misleading.

2. **Import index serialization uses plain objects keyed by untrusted module specifiers (prototype pollution risk).**
   - `src/index/build/imports.js:212–218` and `248–255`
   - An import like `import "__proto__"` can mutate object prototypes and corrupt downstream consumers.

3. **Dense vector “doc-only semantics” can be violated when `embed_doc_u8` is missing in the pre-quantized path.**
   - `src/index/build/postings.js:245–250`
   - Missing `embed_doc_u8` currently falls back to the merged code vector, which makes doc-only dense search surface code-only chunks.

4. **Chunks with no token sequence are dropped entirely by `appendChunk`, which is incompatible with embeddings-only / vector-first indexing and can silently lose chunks.**
   - `src/index/build/state.js:216–218`

5. **Chargram generation aborts for the entire chunk when it encounters a single long token.**
   - `src/index/build/state.js:254–265` (specifically the `return` at line 257)
   - This is almost certainly a `continue` bug and can destroy chargram recall unpredictably.

6. **Shard planner emits a “misc/other” shard without a `mode` property.**
   - `src/index/build/shards.js:476–487`
   - Downstream code that assumes `shard.mode` exists will misbehave for exactly the shard that likely contains the “unknown surprises” you care about.

7. **Cached bundle reuse hard-codes `hashAlgo: 'sha1'` whenever a hash exists, regardless of the actual algorithm.**
   - `src/index/build/file-processor/cached-bundle.js:43–49`
   - This can poison incremental manifests and can confuse any future “index diffing” that expects correct hash provenance.

8. **Build checkpointing flushes immediately on the first processed file because `lastAt` starts at `0`.**
   - `src/index/build/build-state.js:120–142`
   - This causes unnecessary build_state churn and may create write amplification (especially in watch/incremental modes).

### Notable scale / drift risks (second tier)

- Multiple “token mode” implementations exist (artifact token-mode vs postings step token mode), with inconsistent normalization behavior.
  - `src/index/build/artifacts/token-mode.js` vs `src/index/build/indexer/steps/postings.js:19–40`
- Several `src/` modules import utilities from `tools/` (packaging boundary risk).
  - `src/index/build/artifacts/metrics.js:4`
  - `src/index/build/artifacts/filter-index.js:2`

---

## Findings

### 1) Critical — `compressionEnabled` is a string instead of a boolean

**Where**
- `src/index/build/artifacts/compression.js:16`

**Evidence**
- `const compressionEnabled = compressionConfig.enabled === true && compressionMode;` yields `'gzip' | 'zstd' | null`, not `true|false`.

**Impact**
- Any `if (compressionEnabled === true)` checks will fail.
- Metrics/config dumps may be inconsistent (some treat it as boolean, some as truthy string).
- Future refactors risk subtle regressions because the variable name strongly implies boolean semantics.

**Suggested fix direction**
- Make `compressionEnabled` explicitly boolean: `const compressionEnabled = compressionConfig.enabled === true && Boolean(compressionMode);`
- Keep the selected mode only in `compressionMode`.
- Add a unit test that asserts `typeof compressionEnabled === 'boolean'` across all `mode` combinations.

---

### 2) Critical — Import module maps are vulnerable to prototype pollution

**Where**
- `src/index/build/imports.js:212–218` (return object for `scanImports`)
- `src/index/build/imports.js:248–255` (return object for `buildImportLinksFromRelations`)

**Evidence**
- `const dedupedImports = {};`
- `dedupedImports[mod] = entries;` where `mod` is an import specifier derived from repository content.

**Impact**
- A module specifier of `"__proto__"` or `"constructor"` can mutate the prototype of `dedupedImports`, corrupting consumers and potentially crashing or misrouting logic.
- Even if you consider the code “local-only,” this is still a correctness and robustness flaw, and it becomes security-relevant the moment the tool is pointed at untrusted repos.

**Suggested fix direction**
- Use `Object.create(null)` instead of `{}` for these maps, or keep the return type as a `Map` and serialize safely.
- Add a regression test that includes a file with `import "__proto__";` and asserts that serialization output is correct and that `({}).polluted` is still `undefined`.

---

### 3) High — Cached bundle reuse mislabels hash algorithm

**Where**
- `src/index/build/file-processor/cached-bundle.js:43–49`

**Evidence**
- `hashAlgo: resolvedHash ? 'sha1' : null` ignores `fileHashAlgo` and ignores the manifest entry’s true algorithm.

**Impact**
- Incremental manifests can accumulate incorrect hash metadata.
- Any downstream consumer that relies on `hashAlgo` for validation/diffing will get false results.
- If you later introduce stronger hashing (e.g., sha256/blake3), cached bundle reuse will silently downgrade provenance.

**Suggested fix direction**
- Prefer the passed-in algo (`fileHashAlgo`) and fall back to manifest algo if present.
- Add a test that simulates a manifest with `hashAlgo: 'sha256'` and asserts reuse preserves it.

---

### 4) High — Build checkpoints flush immediately (write amplification)

**Where**
- `src/index/build/build-state.js:120–142`

**Evidence**
- `let lastAt = 0;` and then `now - lastAt >= intervalMs` is always true on the first tick.

**Impact**
- The first processed file triggers a flush, which defeats the intended batching behavior.
- In watch mode or large repos, repeated early flushes contribute to additional IO and contention.

**Suggested fix direction**
- Initialize `lastAt = Date.now()` at construction time, or set `lastAt` when calling `tick()` for the first time.
- Add a unit test that ensures no flush occurs until either `batchSize` is reached or `intervalMs` elapses.

---

### 5) High — “misc/other” shard is missing `mode`

**Where**
- `src/index/build/shards.js:476–487`

**Evidence**
- The constructed shard object omits `mode`, unlike all other shard entries in the file.

**Impact**
- Any downstream logic that assumes shard objects have a `mode` will behave inconsistently for exactly the “remainder” shard.
- This is especially problematic because “misc/other” is usually where weird file types accumulate and where the most defensive handling is needed.

**Suggested fix direction**
- Ensure shard objects are schema-consistent across all creation sites (include `mode` everywhere).
- Add a test that runs `planShards` with `minFiles > 1` so a remainder shard is created, and validate required fields.

---

### 6) High — `appendChunk` drops chunks with no tokens, which can silently lose index coverage

**Where**
- `src/index/build/state.js:216–218`

**Evidence**
- `const seq = ...; if (!seq.length) return;` before `chunk.id` assignment and before pushing into `state.chunks`.

**Impact**
- Any chunk that produces no tokens (empty file, binary-ish but still chunked, unusual encodings, or intentional “vector-only indexing” configurations) is dropped from:
  - `state.chunks` (so it never becomes retrievable),
  - `fileMeta` aggregation (if it relies on chunks),
  - repo maps (if they rely on chunk lists),
  - and potentially all graph/artifact joins by `chunkId`.
- This is also a latent bug for future phases: as you move toward “vector-only indexing” modes, this will become an immediate functional break.

**Suggested fix direction**
- Separate concerns:
  - Always assign `chunk.id` and push chunk into `state.chunks`.
  - Only update token postings / df / docLengths when there are tokens.
- Add tests:
  - A chunk with `embedding_u8` but no tokens must still be present in `chunk_meta` and dense vector artifacts.
  - A repo that contains empty files should still produce `file_meta` entries (and optionally zero-token chunks, depending on product goals).

---

### 7) High — Chargram generation exits early on the first long token

**Where**
- `src/index/build/state.js:254–265`

**Evidence**
- Inside `addFromTokens`, the line `if (chargramMaxTokenLength && w.length > chargramMaxTokenLength) return;` aborts the entire function.

**Impact**
- A single long token (e.g., minified identifiers, embedded data, long URLs) causes chargram extraction to stop for the entire chunk, not just that token.
- This can drastically reduce chargram recall and makes behavior depend on token order.

**Suggested fix direction**
- Replace the `return` with `continue` (skip that token, keep processing others).
- Add a regression test with a token list that includes one long token and verify other tokens still produce chargrams.

---

### 8) High — Pre-quantized dense vectors can violate doc-only semantics

**Where**
- `src/index/build/postings.js:245–250`

**Evidence**
- In the pre-quantized path:
  - `let docVec = normalizeByteVector(doc, { emptyIsZero: true });`
  - `if (!docVec) docVec = mergedVec;`
- This means “missing doc vector” (absent or non-bytevector) becomes the merged vector.

**Impact**
- Doc-only dense search can surface chunks that have no doc payload.
- This undermines a key retrieval invariant and makes dense search mode-dependent (legacy float vs pre-quantized path behave differently).

**Suggested fix direction**
- Treat missing/invalid `embed_doc_u8` as doc-missing, not as “use merged”:
  - If the doc marker is intentionally “empty,” interpret it as zero-vector (already supported via `emptyIsZero`).
  - If the doc vector is missing entirely, default to zero-vector as well.
- Add tests that build postings from:
  - chunks with `embedding_u8` present but `embed_doc_u8` absent,
  - chunks with `embed_doc_u8 = new Uint8Array(0)`,
  and verify doc vectors behave like zero-vectors.

---

### 9) Medium — Token mode logic is duplicated and inconsistently normalized

**Where**
- `src/index/build/artifacts/token-mode.js` (canonical-looking normalization)
- `src/index/build/indexer/steps/postings.js:19–40` (duplicate logic)

**Evidence**
- In postings step, `tokenModeRaw` is not `.trim().toLowerCase()`; `FULL` will not be recognized.
- `chunkTokenMaxFiles` is not floored in postings step.

**Impact**
- Configuration drift: users can set a config that is respected in metrics/artifacts but ignored in actual postings construction (or vice versa).
- Future changes risk diverging behavior further.

**Suggested fix direction**
- Pick a single normalization function (preferably the one in `artifacts/token-mode.js`) and call it from postings step.
- Add tests around casing and numeric normalization.

---

### 10) Medium — Artifact metrics/config hashing imports from `tools/` and assumes postings shape

**Where**
- `src/index/build/artifacts/metrics.js:4` (imports from `../../../../tools/dict-utils.js`)
- `src/index/build/artifacts/metrics.js:36–86` (assumes `state.scannedFilesTimes`, `postings.tokenVocab`, etc.)

**Impact**
- Packaging boundary risk: if `tools/` is not shipped or is treated as dev-only, production builds can break.
- As you add vector-only modes or partial indexes, `postings.tokenVocab` and similar fields may be absent or renamed, causing metrics generation failures.

**Suggested fix direction**
- Move shared utilities out of `tools/` into `src/shared/` and import from there.
- Treat metrics generation as “best effort” but avoid hard failures by guarding missing `postings` subfields.
- Add a test that runs index build in a minimal mode (e.g., with postings disabled or embeddings disabled) and still writes metrics.

---

### 11) Medium — Filter index artifact hashing relies on `tools/` and weak guards

**Where**
- `src/index/build/artifacts/filter-index.js:1–23`

**Evidence**
- Imports `getEffectiveConfigHash` from `tools/dict-utils.js`.
- Falls back to `resolvedConfig.chargramMinN` without guarding for `resolvedConfig` existence.

**Impact**
- Same packaging boundary risk as metrics.
- If `resolvedConfig` is missing or schema changes, filter index build may crash in unexpected code paths.

**Suggested fix direction**
- Move hash computation helpers into `src/shared/`.
- Validate inputs and fail with a clear error message (or choose safe defaults).

---

### 12) Medium — Repo map writer materializes all entries in memory before yielding

**Where**
- `src/index/build/artifacts/writers/repo-map.js:9–61`

**Evidence**
- Builds `entries = []`, pushes for each chunk, sorts, then yields.

**Impact**
- This is the opposite of a streaming-friendly artifact pipeline.
- Large repos can pay an unnecessary memory peak right before writing artifacts (exactly when you want to keep RSS low).

**Suggested fix direction**
- If you need sorting, prefer sorting at the source (e.g., ensure `state.chunks` are appended in file order).
- Alternatively, write unsorted but shard by file to keep deterministic blocks without a full in-memory sort.

---

### 13) Medium — File relations writer does a full pre-pass JSON stringify for sizing

**Where**
- `src/index/build/artifacts/writers/file-relations.js:24–45`

**Evidence**
- It iterates the entire iterator, `JSON.stringify` each entry, and counts bytes to decide whether to shard.

**Impact**
- Duplicates work: you stringify all entries once for sizing and again for writing.
- If file relations are large, this is a measurable CPU cost right before artifact I/O.

**Suggested fix direction**
- Decide sharding based on counts (entries) or coarse estimates first; only do an exact byte sizing pass when near the boundary.
- Consider a “write-first, rotate shard on maxBytes” streaming writer (which you already have via `writeJsonLinesSharded`) and skip the sizing pass entirely.

---

### 14) Low — Schema definitions are incomplete and include duplicated/legacy fields

**Where**
- `src/index/build/artifacts/schema.js`

**Evidence**
- `chunkMeta.optionalFields` includes both `chunk_authors` and `chunkAuthors` (two names for the same idea).
- Only a small subset of artifacts are defined.

**Impact**
- Schema validation can drift or silently stop covering key artifacts.
- Consumers will have a harder time relying on schema invariants.

**Suggested fix direction**
- Treat `ARTIFACT_SCHEMAS` as a strict contract: normalize field naming and add schemas for all emitted artifacts.
- Add schema conformance tests that validate “what is written” vs “what schema says exists.”

---

### 15) Low — Tokenization context accepts non-integer ranges without flooring

**Where**
- `src/index/build/tokenization.js:17–46`

**Evidence**
- `normalizeRange` returns `Number(value)` and does not `Math.floor`, but downstream loops treat `phraseMinN/MaxN` and `chargramMinN/MaxN` as loop bounds.

**Impact**
- Misconfigured floats can lead to unexpected loops or implicit coercions.
- This is mostly user-error, but it’s easy to harden.

**Suggested fix direction**
- Clamp and floor these values during normalization and add validation errors in config validation.

MD