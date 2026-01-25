# Codebase Static Review Findings — Pass 4B (Config + File Processor + Discovery)

Scope: This pass statically reviews **only** the following files:

- `src/config/validate.js`
- `src/experimental/compare/config.js`
- `src/experimental/structural/binaries.js`
- `src/experimental/structural/io.js`
- `src/experimental/structural/parsers.js`
- `src/experimental/structural/registry.js`
- `src/experimental/structural/runner.js`
- `src/index/build/args.js`
- `src/index/build/context-window.js`
- `src/index/build/crash-log.js`
- `src/index/build/discover.js`
- `src/index/build/embedding-batch.js`
- `src/index/build/failure-taxonomy.js`
- `src/index/build/feature-metrics.js`
- `src/index/build/file-processor.js`
- `src/index/build/file-processor/chunk.js`
- `src/index/build/file-processor/incremental.js`
- `src/index/build/file-processor/meta.js`
- `src/index/build/file-processor/read.js`
- `src/index/build/file-processor/relations.js`
- `src/index/build/file-processor/timings.js`
- `src/index/build/file-scan.js`

This is a static analysis only (no code execution). The goal is to identify bugs, correctness gaps, mis-implementations, and missing/under-specified behavior.

---

## Executive summary

Most of this area is solid: the file processor has thoughtful staging (pre-read scan → parse/chunk → tokenize → enrich → embeddings), and the experimental “structural” tooling is cleanly isolated.

The highest-impact issues found in this pass are:

1. **Chunk language attribution for multi-segment files is likely wrong**: chunk payloads are stamped with *file-level* `languageId` rather than *chunk/segment-level* language (e.g., `.vue` script/style/template segments). This can degrade indexing quality, WASM/language grouping, and downstream graph/analysis correctness.
2. **Comment range assignment does not account for multi-chunk spanning comments**: `assignCommentsToChunks` assigns by `comment.start` only, meaning a block comment spanning chunk boundaries can leak into later chunks and be tokenized even when comments are configured to be excluded.
3. **Sampling for context-window estimation sorts the entire file list**: O(n log n) overhead just to sample 20 files; can become non-trivial on very large repos.
4. **Feature metrics merge may silently mix runs across different config hashes**: `feature-metrics.json` can become misleading because `configHash` is “sticky” to the first-run value.
5. **Git discovery via `spawnSync` has an implicit output size ceiling**: `git ls-files -z` may exceed `spawnSync`’s default `maxBuffer` on large repos, causing silent fallback to filesystem traversal (with different semantics).

---

## Findings

### P4B-01 — Chunk payload `languageId` ignores segment language

**Severity:** High (correctness + planned features)

**Where:** `src/index/build/file-processor.js`

**What’s wrong**

Within the chunk loop, the processor computes a chunk-specific language identifier:

- `chunkLanguageId = c.segment?.languageId || fileLanguageId || lang?.id || 'unknown'`

…but when building the final chunk payload, it uses **file-level** `languageId`:

- `languageId: fileLanguageId || lang?.id || null`

This means multi-language container formats (at minimum `.vue`, likely `.svelte`, `.astro`, HTML with `<script>`/`<style>` segments, etc.) will stamp all emitted chunks as the container language, not the segment language.

**Evidence**

In `src/index/build/file-processor.js`:

- Chunk-level language is computed earlier in the loop.
- Payload uses file-level language:

```js
// src/index/build/file-processor.js (approx L1240-L1266)
languageId: fileLanguageId || lang?.id || null,
```

See `src/index/build/file-processor.js` around **L1240-L1266**.

**Why it matters**

- Language-aware chunking/tokenization/type-inference pipelines will underperform (wrong parser choices, wrong heuristics).
- Any roadmap item that depends on *WASM grouping by language* or *tooling provider selection by language* becomes unreliable.
- Graph artifacts that are language-specific (callsite extraction, import graph) can become noisy or incomplete.

**Suggestions**

- Make chunk payload `languageId` default to the resolved chunk/segment language (`chunkLanguageId`), not the file language.
- Consider carrying *both* values explicitly:
  - `languageId`: per-chunk effective language
  - `fileLanguageId`: container language
  - `segment.languageId`: already present; ensure consumers prefer `languageId`.

**Tests to add**

- Fixture: minimal `.vue` with `<script>`, `<template>`, `<style>`.
- Assert emitted chunks have `languageId` of `javascript`/`vue-template`/`css` (or whatever your segment taxonomy is), not `vue` for all.

---

### P4B-02 — Comment range assignment leaks multi-chunk block comments

**Severity:** High (comment-exclusion correctness)

**Where:** `src/index/build/file-processor/chunk.js`

**What’s wrong**

`assignCommentsToChunks` assigns each comment to a single chunk based solely on `comment.start`:

```js
// src/index/build/file-processor/chunk.js (L16-L32)
while (chunkIdx < chunks.length && chunks[chunkIdx].end <= comment.start) {
  chunkIdx += 1;
}
const target = chunkIdx < chunks.length ? chunkIdx : chunks.length - 1;
assignments.get(target).push(comment);
```

If a comment spans multiple chunks (common with large block comments or license headers), only the first chunk receives the range. Later chunks will not be told to strip the overlapping portion.

**Why it matters**

- When `comments.includeInCode !== true`, later chunks may tokenize part of a comment that should have been excluded.
- Risk analysis and lint/complexity context can be polluted by comment text.
- Any “comment field” strategy becomes less deterministic.

**Suggestions**

- For range-based operations (especially stripping), assign comments to **all** chunks whose `[start,end)` overlaps `[comment.start, comment.end)`.
- A cheap approach is a two-pointer sweep:
  - For each comment, walk chunkIdx until chunk.end > comment.start
  - Then keep a second cursor while chunk.start < comment.end and assign to each.
- If memory is a concern, store per-chunk *sliced ranges* instead of whole comment objects.

**Tests to add**

- Fixture: one block comment starting near end of chunk N and ending in chunk N+1.
- Assert that both chunks’ tokenText has the overlapping comment region stripped (when configured).

---

### P4B-03 — Context-window sampling sorts full file list

**Severity:** Medium (performance on large repos)

**Where:** `src/index/build/context-window.js`

**What’s wrong**

The estimator sorts the entire `files` array, then samples 20:

```js
const ordered = Array.isArray(files) ? [...files].sort() : [];
for (let i = 0; i < Math.min(20, ordered.length); ++i) {
  ...
}
```

On large repos, sorting tens/hundreds of thousands of paths adds avoidable overhead to a heuristic intended to be cheap.

**Suggestions**

- Replace full sort with a bounded sampling approach:
  - sample first N files from discovery order
  - or reservoir sample
  - or partial selection (e.g., choose by stable hash of path)
- If deterministic sampling is needed, sort only the first K candidates (e.g., 1–2k) instead of full list.

---

### P4B-04 — Feature metrics merge may conflate different configs

**Severity:** Medium (observability correctness)

**Where:** `src/index/build/feature-metrics.js`

**What’s wrong**

`mergeFeatureMetrics` “sticks” to the existing `configHash` and only uses `next.configHash` if the existing is falsy:

```js
// src/index/build/feature-metrics.js (approx L257-L260)
merged.configHash = merged.configHash || next.configHash || null;
```

If you run the tool with different configs over time, `feature-metrics.json` can represent a blend of runs but appear to belong to the first config.

**Suggestions**

- Either:
  1) Partition overall aggregates by `configHash`, OR
  2) Set `configHash` to a sentinel like `"mixed"` when a mismatch is detected.

**Tests to add**

- Merge two metrics docs with different `configHash`; ensure the merged output is explicitly marked as mixed or split.

---

### P4B-05 — Git discovery can silently fall back due to `spawnSync` buffer limits

**Severity:** Medium (correctness + performance)

**Where:** `src/index/build/discover.js`

**What’s wrong**

`git ls-files -z` is executed via `spawnSync` with no `maxBuffer` override:

```js
// src/index/build/discover.js (approx L108-L119)
const result = spawnSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' });
```

On large repos, the stdout can exceed Node’s default sync buffer limit, causing `spawnSync` to error; the function then returns `null`, and discovery falls back to filesystem traversal.

**Why it matters**

- Git semantics (“tracked files only”) can switch to FS semantics (“all files”) silently.
- Performance may regress dramatically on large repos.

**Suggestions**

- Provide an explicit `maxBuffer` (large but bounded), OR
- Prefer streaming `spawn` for `git ls-files` output.
- At minimum, detect `result.error` and emit a warning with the fallback reason.

---

### P4B-06 — Config validator is intentionally minimal but may be misused

**Severity:** Low (future-proofing)

**Where:** `src/config/validate.js`

**Notes**

The schema validator supports only a subset of JSON Schema (types/enums/required/items/properties/additionalProperties). That’s fine if all internal schemas are constrained accordingly, but it becomes a latent defect if you add richer schema constructs and assume they’re enforced.

**Suggestions**

- Add a guard: if schema contains unsupported keywords (e.g., `oneOf`, `anyOf`, `pattern`), emit a warning or throw in dev/test mode.

---

## Additional notes (non-blocking)

- The experimental structural tooling is clean and readable. The “runner” pipeline is conservative (lots of try/catch fallbacks), which is appropriate for optional tooling.
- `file-scan.js` is generally solid; it samples a small prefix for type/binary/minified heuristics, which is the correct approach.

