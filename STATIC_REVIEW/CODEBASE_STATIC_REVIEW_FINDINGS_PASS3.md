# Codebase Static Review — Pass 3 (Bugs / Mis-implementations)

This pass focuses on files **not** included in the prior review list, with an emphasis on (a) correctness issues that can silently degrade index quality or retrieval behavior, (b) mis-implementations where the intent is clear but the implementation is subtly wrong, and (c) latent defects that will break once planned features (typed-array-heavy artifacts, doc-mode indexing at scale, etc.) are exercised.

## Executive Summary

High-confidence, high-impact issues found:

1. **Chargram postings can be silently truncated** if any token exceeds the configured max token length, due to a `return` that exits chargram emission early. This will degrade typo-tolerance / fuzzy matching behavior for any chunk containing a single long token.
   - **File:** `src/index/build/state.js` (see `addFromTokens`, around L257)

2. **Sharded JSONL writing mis-serializes TypedArrays** because it uses `JSON.stringify(item)` rather than the project’s TypedArray-safe writer. If any sharded JSONL artifact ever contains `Uint8Array`/`Float32Array` (e.g., future risk-flow artifacts, vectors, or any meta that includes byte vectors), output will be structurally wrong.
   - **File:** `src/shared/json-stream.js` (see `writeJsonLinesSharded`, around L382)

3. **Doc-mode indexing can be incorrectly skipped/blocked** because both pre-read skip logic and cached-bundle reuse compute caps with `resolveFileCaps(fileCaps, ext)` which defaults to **code-mode** and also omits language-specific caps. In doc mode, this can cause legitimate doc files (e.g., 8–10MB Markdown) to be incorrectly skipped as oversize.
   - **Files:**
     - `src/index/build/file-processor/skip.js` (caps computed without `mode` / `languageId`, around L14)
     - `src/index/build/file-processor/cached-bundle.js` (caps computed without `mode` / `languageId`, around L33)

4. **Cached-bundle metadata loses fidelity** (`hashAlgo` is hard-coded to `'sha1'`, and caps omit `mode` / `languageId`). This isn’t breaking today if SHA1 is the only hash, but it’s a correctness trap for future changes and for making “effective caps” auditable.
   - **File:** `src/index/build/file-processor/cached-bundle.js` (around L48)

The rest of this report drills into each issue with impact, recommended fix, and suggested tests.

---

## Findings

### 1) Chargram emission exits early on long tokens

**Where**
- `src/index/build/state.js` — `addFromTokens()` inside `appendChunkToIndexState`.
- The guard reads:
  - `if (chargramMaxTokenLength && w.length > chargramMaxTokenLength) return;`

**Why this is a bug**
- This `return` exits `addFromTokens()` entirely, so **all subsequent tokens** in the same field stop contributing chargrams.
- The intended behavior (consistent with other parts of the codebase, e.g. `src/index/build/tokenization.js`) is to **skip only the overlong token** and continue processing the rest.

**Impact**
- Any chunk containing a single huge token (minified identifiers, embedded blobs, long URLs, base64, etc.) will have **systematically missing chargram postings**, harming:
  - fuzzy/typo tolerance,
  - “contains-ish” style matching,
  - any ranking features that depend on chargram postings.

**Recommended fix**
- Replace the `return` with `continue` (or restructure to only skip the token).
- Optional: track a counter for “chargramsSkippedOverlongTokens” to make this observable.

**Recommended test**
- Unit test that constructs a chunk with tokens `['short', 'x'.repeat(5000), 'alsoShort']` and a `chargramMaxTokenLength` smaller than 5000, then asserts:
  - postings exist for chargrams derived from `short` **and** `alsoShort`.

---

### 2) Sharded JSONL output breaks TypedArrays

**Where**
- `src/shared/json-stream.js` — `writeJsonLinesSharded()`.
- It writes each line via `JSON.stringify(item)`.

**Why this is a bug**
- In JS, `JSON.stringify(new Uint8Array([1,2,3]))` produces an object-like shape (`{"0":1,"1":2,...}`) rather than a JSON array (`[1,2,3]`).
- The project already has a TypedArray-aware writer (`writeJsonValue()` / `normalizeJsonValue()`), but it is bypassed in the sharded JSONL path.

**Impact**
- Any **sharded JSONL artifact** that includes byte vectors (now or later) will be malformed.
- This is especially relevant because:
  - sharding is used for large artifacts, and
  - large artifacts are where TypedArrays/vectors are most likely to appear (embeddings, quantized embeddings, compact graph encodings, risk artifacts).

**Contributing call sites**
- `writeJsonLinesSharded()` is used by at least:
  - `src/index/build/artifacts/writers/chunk-meta.js`
  - `src/index/build/artifacts/writers/file-relations.js`

Even if chunk-meta/file-relations do not currently emit TypedArrays, the sharded writer itself should be correct; otherwise future work will “mysteriously” fail or emit schema-breaking artifacts.

**Recommended fix options**

Option A (preferred): **Use the project’s TypedArray-safe JSON writer**
- Replace `JSON.stringify(item)` with a line-construction that uses `writeJsonValue`.
- You still need a way to track shard byte size. Two workable approaches:
  - **Approximate sizing**: rotate shards by `maxItems` primarily, and treat `maxBytes` as a soft cap (log if exceeded).
  - **String-based sizing but correct conversion**: call `normalizeJsonValue(item)` first, then `JSON.stringify(normalized)`.

Option B: Provide a `JSON.stringify` replacer
- Implement a replacer that converts `ArrayBuffer.isView(val)` (except DataView) to `Array.from(val)`.
- This is simple but may allocate large arrays; still acceptable if sharding is already used for “big artifacts” where correctness matters more than micro-allocations.

**Recommended test**
- Add a test for `writeJsonLinesSharded()` that writes an item containing a TypedArray:
  - `{ id: 1, vec: new Uint8Array([1,2,3]) }`
- Assert the output line contains `"vec":[1,2,3]`, not `"vec":{"0":1...}`.

---

### 3) Pre-read skip caps are mode-incorrect and language-incomplete

**Where**
- `src/index/build/file-processor/skip.js` — `resolvePreReadSkip()`.
- Caps are resolved as `resolveFileCaps(fileCaps, ext)`.

**Why this is a bug**
- `resolveFileCaps(rawCaps, ext, lang, mode = 'code')` defaults `mode` to `'code'`.
- `resolvePreReadSkip()` is invoked before reading, and it can **short-circuit the file entirely**.
- In doc mode, default caps should be larger (per `src/index/build/runtime/caps.js`), but pre-read skip currently enforces code-mode caps.
- It also omits language-specific caps even though the caller already has a language hint (`getLanguageForFile()` in `src/index/build/file-processor.js`).

**Impact**
- In doc mode you can incorrectly skip:
  - large Markdown/README/Docs files in the 6–12MB range,
  - any file type where doc-mode caps differ from code-mode caps.

**Recommended fix**
- Thread `mode` and `fileLanguageId` into `resolvePreReadSkip()`.
- Resolve caps as:
  - `resolveFileCaps(fileCaps, ext, fileLanguageId, mode)`

**Recommended tests**
- Fixture-based test where:
  - mode=`doc`, ext=`.md`, fileStat.size is 8MB,
  - doc maxBytes default is 12MB,
  - code maxBytes default is 6MB,
- Expected behavior: **not skipped**.

---

### 4) Cached-bundle reuse uses caps that default to code-mode and ignore language-specific overrides

**Where**
- `src/index/build/file-processor/cached-bundle.js` — `reuseCachedBundle()`.
- Caps are resolved as `resolveFileCaps(fileCaps, ext)`.

**Why this is a bug**
- Same root cause as pre-read skip: default `mode='code'`, and missing `languageId`.
- Additionally, cached-bundle reuse makes a **hard skip decision**:
  - if fileStat.size > caps.maxBytes it returns `{ skip: { reason: 'oversize', ... } }`.

**Impact**
- In doc mode, cached-bundle reuse can incorrectly skip valid doc files.
- Language-specific cap overrides are silently ignored for cached bundles.
- This can create “why did the doc index shrink?” incidents that are extremely hard to debug.

**Recommended fix**
- Thread `mode` and `fileLanguageId` into `reuseCachedBundle()` (the caller in `src/index/build/file-processor.js` already has both).
- Resolve caps via:
  - `resolveFileCaps(fileCaps, ext, fileLanguageId, mode)`

**Recommended tests**
- Similar to the pre-read test, but exercising the cached bundle path:
  - Provide a cached bundle for a doc file of 8MB.
  - Ensure `reuseCachedBundle()` returns a result (or at least does not skip) under doc-mode caps.

---

### 5) Cached-bundle metadata hard-codes `hashAlgo: 'sha1'`

**Where**
- `src/index/build/file-processor/cached-bundle.js` sets:
  - `fileInfo.hashAlgo: resolvedHash ? 'sha1' : null`

**Why this matters**
- Today, file hashes appear to be SHA1 (from git or prior caching), so this is not immediately breaking.
- However, the code *accepts* `fileHashAlgo` as an argument and then discards it, which means:
  - future changes (e.g., migrating to xxh64 for speed, or storing algorithm per provenance) will silently lie in emitted metadata.

**Recommended fix**
- Prefer:
  - `hashAlgo: resolvedHash ? (fileHashAlgo || cachedEntry.hashAlgo || 'sha1') : null`

**Recommended test**
- Provide a cached bundle with `{ hash: '...', hashAlgo: 'xxh64' }` and ensure `fileInfo.hashAlgo` preserves the algorithm.

---

### 6) `embed_code_u8` / `embed_doc_u8` are quantized without normalization

**Where**
- `src/index/build/file-processor/embeddings.js`:
  - `const codeU8 = embedCode.length ? quantizeVecUint8(embedCode) : mergedU8;`
  - `const docU8 = hasDoc ? quantizeVecUint8(rawDoc) : EMPTY_U8;`

**Why this is risky**
- `embedding_u8` uses `normalizeVec()` before quantization; `embed_code_u8` / `embed_doc_u8` do not.
- Today, retrieval appears to use `embedding_u8` (merged), so this is not a user-facing bug *yet*.
- But the code is already emitting these fields, and any future “code-only” / “doc-only” ANN/ranking that uses them will have inconsistent vector geometry.

**Recommended fix**
- Normalize before quantization, matching `embedding_u8`:
  - `quantizeVecUint8(normalizeVec(embedCode))` and `quantizeVecUint8(normalizeVec(rawDoc))`.
- If you intentionally want non-normalized vectors, document it and ensure the scorer expects that.

**Recommended test**
- Add a test that verifies normalized vectors have stable magnitude and that dot products behave as expected in ranking.

---

### 7) Build state writes a top-level `phase` field (verify intended contract)

**Where**
- `src/index/build/build-state.js` — `markBuildPhase()` calls `updateBuildState(buildRoot, { phase, phases: ... })`.

**Why to flag**
- `initBuildState()`’s payload schema does not include a top-level `phase` field; it includes `stage`, `modes`, and `phases`.
- Having a top-level `phase` might be intentional (“current phase”), but if not, it will cause:
  - schema drift,
  - misleading UI/state dumps.

**Recommendation**
- Decide whether `phase` is part of the persistent build state schema:
  - If **yes**, explicitly include it in the initial payload and document it.
  - If **no**, remove it from the patch and rely on the `phases` object.

---

## Suggested Patch Set (Minimal, High ROI)

1. **Fix chargram early-return** (`src/index/build/state.js`): replace `return` with `continue` in `addFromTokens()`.
2. **Fix TypedArray-safe sharded JSONL** (`src/shared/json-stream.js`): stop using raw `JSON.stringify(item)` without normalization.
3. **Thread `mode` + `languageId` through caps resolution**:
   - `src/index/build/file-processor/skip.js`
   - `src/index/build/file-processor/cached-bundle.js`
   - (and update call sites in `src/index/build/file-processor.js` accordingly)
4. **Preserve hash algorithm metadata** in cached bundle path.
5. **Normalize `embed_code_u8` / `embed_doc_u8`** before quantization (or explicitly document the choice).

## Test Additions (Targeted, Prevents Regression)

- `tests/chargrams-long-token-does-not-truncate.js`
- `tests/jsonl-sharding-typedarrays.js`
- `tests/doc-mode-caps-pre-read-skip.js`
- `tests/cached-bundle-caps-respect-mode-and-language.js`

