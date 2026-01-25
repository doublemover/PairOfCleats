# Codebase Static Review Findings — Retrieval Context Expansion, Filter Indexing, ANN Glue, and Output Helpers

This report is a focused static review of the retrieval-side adjacency and output helpers: **context expansion**, **filter indexing / expression parsing**, **FTS bm25 weighting helpers**, **LanceDB ANN glue**, **LMDB artifact loading**, and a handful of **output formatting** utilities.

All file references are relative to the repo root.

## Scope

Files reviewed:

- `src/retrieval/context-expansion.js`
- `src/retrieval/embedding.js`
- `src/retrieval/filter-index.js`
- `src/retrieval/filters.js`
- `src/retrieval/fts.js`
- `src/retrieval/lancedb.js`
- `src/retrieval/lmdb-helpers.js`
- `src/retrieval/output.js`
- `src/retrieval/output/cache.js`
- `src/retrieval/output/context.js`
- `src/retrieval/output/explain.js`
- `src/retrieval/output/summary.js`

## Severity Key

- **Critical**: likely to cause incorrect results, crashes, or major production breakage.
- **High**: significant correctness/quality risk, major perf hazard, or security foot-gun.
- **Medium**: correctness edge cases, meaningful perf waste, or confusing UX.
- **Low**: minor issues, maintainability concerns, or polish.

---

## Executive Summary

- **Context expansion is useful but has a fragile core assumption**: it indexes into `chunkMeta` by `chunkId` (`chunkMeta[id]`) in multiple places (`src/retrieval/context-expansion.js:106,154`). This requires **IDs to be dense array indices** (0…N-1), and silently fails if that invariant ever changes.

- **Context expansion has a scalability hazard**: it eagerly builds a `candidates` array of `{id, reason}` for every call/import/usage/export relation, then only later applies `maxPerHit`/`maxTotal`. In high fan-out files, this can become a large allocation and time sink.

- **Filter parsing is not Windows-safe**: `parseFilterExpression()` treats the first `:` as a key/value separator (`src/retrieval/filters.js:120`), which breaks drive-letter paths like `C:\repo\file.ts`.

- **Filter index hydrate always builds bitmaps**: `hydrateFilterIndex()` always calls `buildBitmapIndex()` (`src/retrieval/filter-index.js:146`) even if the build-time path was configured to skip bitmaps. This makes “no-bitmaps” effectively unsupported for loaded indexes.

- **LMDB chunk meta enrichment uses falsy checks that can clobber legitimate zero/empty values**: e.g., `if (!chunk.churn) chunk.churn = meta.churn;` (`src/retrieval/lmdb-helpers.js:76`) will overwrite `0` (valid) and can even overwrite to `undefined` if file meta is missing a field.

- **LanceDB integration has correctness and operational sharp edges**:
  - Connection/table caches can race in concurrent calls, potentially leaking duplicate connections (`src/retrieval/lancedb.js:33–54`).
  - Candidate-set filtering can under-return results when pushdown is disabled (`CANDIDATE_PUSH_LIMIT = 500`), producing fewer than `topN` and harming hybrid recall (`src/retrieval/lancedb.js:143–179`).

- **Output “summary” reads entire files synchronously** (`src/retrieval/output/summary.js:15–21`). This interacts badly with “huge files” (large memory + event-loop blocking) and the cache sizing defaults can cause repeated large reads.

---

## 1) Context Expansion

### 1.1 **[High]** `chunkMeta[id]` indexing assumes dense numeric IDs

**Where**
- `src/retrieval/context-expansion.js:106` — `const sourceChunk = sourceId != null ? chunkMeta[sourceId] : null;`
- `src/retrieval/context-expansion.js:154` — `const chunk = chunkMeta[id];`

**Why it’s a problem**
- This assumes `chunkMeta` is an array where `chunkMeta[id]` returns the chunk with `chunk.id === id`.
- If you ever move to:
  - non-dense numeric IDs,
  - string IDs (common for federated/multi-repo indexes),
  - chunk arrays sorted by something other than ID,
  then context expansion silently stops working or pulls the wrong chunks.

**Suggestion**
- Either:
  1) **Enforce** and validate the invariant at index load time (e.g., in validation or index loader): assert `chunkMeta[id]?.id === id` for a sample or for all chunks.
  2) Or make the code robust: build a `byId` map once in `buildContextIndex()` and dereference via `byId.get(id)`.

**Test ideas**
- Add a unit test for `expandContext()` with a deliberately “shuffled chunkMeta array” where `chunk.id` does *not* equal array index. The test should fail under the current implementation, making the assumption explicit.

### 1.2 **[High]** Candidate explosion from eager `{id, reason}` accumulation

**Where**
- `src/retrieval/context-expansion.js:108–146` builds `candidates` eagerly.

**Why it’s a problem**
- For each hit, it walks:
  - `codeRelations.calls` (`:109–124`)
  - `relations.importLinks` (`:130–134`)
  - optionally `relations.usages` / `relations.exports` (`:135–144`)
- For each relation entry, it expands to:
  - all chunks matching a symbol name (`byName.get()`), or
  - all chunks in files mapped by `repoMapByName` then `byFile.get()`

This can produce **very large candidate lists** in real repos:
- A high-churn “entrypoint” file can have many imports.
- `repoMapByName` lookups for popular function names (e.g., `render`, `init`, `main`) can map to many files.

Even though the final selection is limited by `maxPerHit`/`maxTotal`, the *allocation work happens before those caps apply*.

**Suggestion**
- Prefer a streaming/short-circuit approach:
  - As you generate candidates, immediately check `primaryIds`, `addedIds`, `allowedIds`, and `maxPerHit/maxTotal`.
  - Stop generating once caps are reached.
- Add per-source caps (e.g., max call edges per chunk, max import links per file) and document them.
- Consider a priority ordering so you get the “best neighbors” first (e.g., calls first, then imports, then exports/usages).

**Test ideas**
- Add a stress fixture where a single file has 10,000 imports/usages and confirm context expansion finishes under a time budget and does not allocate extreme memory.

### 1.3 **[Medium]** Duplicate scanning and “reason precedence” are accidental

**Where**
- `pushIds()` pushes duplicates (`src/retrieval/context-expansion.js:1–6`), and `candidates` can contain the same `id` multiple times.
- The chosen `candidate.reason` is whichever occurrence is encountered first (`src/retrieval/context-expansion.js:149–166`).

**Why it’s a problem**
- It wastes cycles scanning duplicates.
- The recorded reason may be misleading (e.g., the same chunk is both an import neighbor and a callee, but you might record only `import:...`).

**Suggestion**
- Track candidates in a `Map<id, reason>` with a fixed priority order.
- Or keep a compact `{id, bestReason, reasons:[...]}` when `--explain` is enabled.

---

## 2) Filter Index Build + Serialize/Hydrate

### 2.1 **[Medium]** Filter index assumes numeric chunk IDs forever

**Where**
- `src/retrieval/filter-index.js:71–72` — skips chunks unless `Number.isFinite(id)`.

**Why it’s a problem**
- This hard-depends on numeric IDs.
- Federation/multi-repo often trends toward stable hash IDs or composite IDs.
- If chunk IDs change type, filter index will silently become empty and filtering will appear “broken.”

**Suggestion**
- If numeric IDs are a hard invariant, explicitly document and validate it.
- Otherwise, update filter indexing + bitmap strategy to support string IDs (e.g., dictionary encode IDs, or maintain parallel numeric rowids vs external chunk IDs).

### 2.2 **[Medium]** Forced lowercase normalization is irreversible and may conflict with case-sensitive modes

**Where**
- `normalizeFilePath()` lowercases and normalizes slashes (`src/retrieval/filter-index.js:43`).
- `add()` lowercases every key (`src/retrieval/filter-index.js:32`).

**Why it’s a problem**
- It makes all file and metadata filters case-insensitive by design.
- The rest of the CLI includes “case” knobs (`caseFile`, `caseTokens` in `src/retrieval/filters.js:70–78`) that imply case-sensitive behavior exists somewhere.

If “case-sensitive file matching” is intended, the current design forces a two-stage approach:
- use filter index only as a coarse prefilter,
- re-check real case-sensitive matching against original file names.

**Suggestion**
- Clarify the intended behavior:
  - If file filters are always case-insensitive: document it, and ensure downstream stages don’t claim to be case-sensitive.
  - If case-sensitive is intended: store both `fileByIdOriginal` and `fileByIdLower`, or store original file and compute lowercase on-demand.

### 2.3 **[High]** “No bitmap” mode is not supported on hydrate

**Where**
- `buildFilterIndex()` supports `options.includeBitmaps !== false` (`src/retrieval/filter-index.js:14,85–88`).
- `hydrateFilterIndex()` *always* builds bitmaps (`src/retrieval/filter-index.js:146`).

**Why it’s a problem**
- It prevents low-memory or “minimal load” modes from working when loading a serialized filter index.
- If bitmaps are large, this makes filter-index loading cost unavoidable.

**Suggestion**
- Add an option to `hydrateFilterIndex(raw, { includeBitmaps })`.
- Or encode a flag in the serialized form and respect it.
- Or lazily build bitmap indexes only when a bitmap-backed filter is actually used.

### 2.4 **[Medium]** `fileChargrams` can become very large for big repos

**Where**
- `fileChargrams` is a `Map<gram, Set<fileId>>` (`src/retrieval/filter-index.js:24,44–53`).

**Why it’s a problem**
- Each file contributes O(pathLength) grams.
- At scale, this is a potentially large `Map` of `Set`s, which can dominate memory.

**Suggestion**
- Since you already have a `bitmap` layer, consider bitmap encoding for `fileChargrams` too (Roaring or similar), or store `fileChargrams` only in serialized compact form and build bitmaps on load.
- Consider limiting grams to basename only (configurable) for many CLI use cases.

---

## 3) Filter Expression Parsing and Meta Filters

### 3.1 **[High]** Windows drive-letter paths break `parseFilterExpression()`

**Where**
- `src/retrieval/filters.js:120` — `const separatorIndex = trimmed.search(/[:=]/);`

**Why it’s a problem**
- `C:\repo\file.ts` contains `:` at index 1.
- The parser will treat this as `key=c` and `value=\repo\file.ts`, producing an “unknown filter key c” error rather than treating it as a file token.
- Quoting does not help because the colon remains in the token.

**Suggestion**
- Special-case a Windows path prefix before searching for `:`:
  - If the token matches `/^[A-Za-z]:[\\/]/`, treat it as a `file` token.
- Alternatively, require `file=` for Windows paths, but that is a poor UX.

**Test ideas**
- Add tests covering:
  - `--filter "C:\\repo\\file.ts"`
  - `--filter "file=C:\\repo\\file.ts"`
  - `--filter "path=C:/repo/file.ts"`

### 3.2 **[Medium]** Filter language mappings are limited and silently ignore unknown inputs

**Where**
- `normalizeLangFilter()` uses `LANG_EXT_MAP` and ignores unknown keys (`src/retrieval/filters.js:192–195`).

**Why it’s a problem**
- Users can pass `lang=react` or `lang=vue` and get a silent no-op.
- This becomes more likely as the project adds Vue/React/MDX/etc.

**Suggestion**
- Return warnings for unknown language keys, or attach them into an `errors` array in the normalization output.
- Expand `LANG_EXT_MAP` with common UI/framework aliases (e.g., `react -> JS/TS + jsx/tsx`, `vue -> .vue`).

---

## 4) FTS bm25 Weight Helpers

### 4.1 **[Medium]** Config array shapes are permissive and fail silently

**Where**
- `src/retrieval/fts.js:38–67`

**Why it’s a problem**
- The function only supports array lengths of `5`, `6`, `7`, or `>=8` after filtering non-finite values.
- Any other length produces defaults, silently.
- Because invalid values are filtered out (`config.map(Number).filter(Number.isFinite)`), user-provided arrays can shrink and accidentally hit a different branch.

**Suggestion**
- If `config` is an array and its length is not recognized:
  - either throw (strict) or
  - return defaults *and* surface a warning explaining the accepted shapes.
- Prefer object config `{ file, name, signature, kind, headline, doc, tokens }` because it is self-documenting.

### 4.2 **[Low]** Weight ordering is implicit and not encoded as a single source of truth

**Where**
- `resolveFtsWeights()` returns `[0, file, name, signature, kind, headline, doc, tokens]` (`src/retrieval/fts.js:74,77`).

**Why it matters**
- The “column order contract” is easy to drift between:
  - FTS table creation,
  - ranker SQL,
  - configuration docs.

**Suggestion**
- Define and export a `FTS_COLUMN_ORDER` constant and use it in:
  - table creation,
  - weight parsing,
  - docs.

---

## 5) LanceDB ANN Integration

### 5.1 **[High]** Connection/table caches can race and leak connections

**Where**
- `getConnection()` caches after `await connect(dir)` (`src/retrieval/lancedb.js:33–43`).
- `getTable()` caches after `await openTable(...)` (`src/retrieval/lancedb.js:45–54`).

**Why it’s a problem**
- In concurrent searches (API server, MCP, multi-mode search), two calls can enter `getConnection()` before the first `connect()` resolves.
- Both will call `connect()`, creating two connections; the second overwrites the cache entry.

**Suggestion**
- Cache promises:
  - `connectionCache.set(dir, promise)` immediately, and await it.
- Alternatively, use a simple per-dir mutex.

### 5.2 **[High]** Candidate-set filtering can under-return results when pushdown is disabled

**Where**
- Candidate pushdown only when `candidateCount <= 500` (`src/retrieval/lancedb.js:5,143–151`).
- When pushdown is disabled, the query runs on the entire table, then the results are filtered afterward (`:174–179`).

**Why it’s a problem**
- If the candidate set is a strict subset (typical in hybrid search), filtering “top K from the whole table” can easily yield *few or zero* candidate hits.
- The function then returns fewer than `topN` (because it slices after filtering), which degrades recall and makes results unstable.

**Suggestion**
- Options (in increasing effort):
  1) If `candidateCount > CANDIDATE_PUSH_LIMIT`, **skip filtering** and treat Lance results as global ANN.
  2) Increase `limit` dynamically until `filtered.length >= topN` or until a hard cap.
  3) Implement a better pushdown mechanism (e.g., chunk candidate IDs into multiple IN clauses, or build a temporary lookup table).
- Make `CANDIDATE_PUSH_LIMIT` configurable.

### 5.3 **[Medium]** `where` clause uses unescaped column name and assumes numeric IDs

**Where**
- `query.where(`${idColumn} IN (${ids.join(',')})`)` (`src/retrieval/lancedb.js:149`).

**Why it’s a problem**
- If `idColumn` contains characters requiring quoting (or is a reserved word), the query can fail.
- IDs are assumed numeric; if an index ever uses string IDs, this will not work.

**Suggestion**
- Quote/escape the column name according to LanceDB’s filter syntax.
- If string IDs are possible, add quoting/escaping for values (and ensure injection safety).

### 5.4 **[Low]** Warning suppression can hide repeated failures

**Where**
- `warnOnce()` suppresses all future warnings after first query failure (`src/retrieval/lancedb.js:11–15`).

**Why it matters**
- If LanceDB fails intermittently, you’ll only ever see the first failure. That is convenient for noisy CLI runs, but it is problematic for server/multi-repo modes.

**Suggestion**
- Tie warning suppression to a time window (e.g., once per minute), or store the last error message and only suppress repeats.

---

## 6) LMDB Artifact Loading Helpers

### 6.1 **[High]** Falsy checks in file-meta enrichment can clobber valid values

**Where**
- `src/retrieval/lmdb-helpers.js:71–80`

Examples:
- `if (!chunk.churn) chunk.churn = meta.churn;`
- `if (!chunk.churn_added) chunk.churn_added = meta.churn_added;`

**Why it’s a problem**
- `0` is a valid value for churn counters.
- Empty arrays can be valid values for `externalDocs`.
- Using `!chunk.field` treats these as “missing” and overwrites them.
- Worse, if `meta.field` is `undefined`, you can overwrite a valid `0` into `undefined`.

**Suggestion**
- Use explicit null/undefined checks instead:
  - `if (chunk.churn == null) chunk.churn = meta.churn;`
  - `if (chunk.externalDocs == null) chunk.externalDocs = meta.externalDocs;`

### 6.2 **[Medium]** HNSW load is not guarded; a bad index can crash retrieval

**Where**
- `loadHnswIndex(...)` is called without a try/catch (`src/retrieval/lmdb-helpers.js:123`).

**Why it’s a problem**
- Optional dependency path: HNSW can be absent, incompatible, or the on-disk index can be corrupt.
- A single exception could abort loading the entire index.

**Suggestion**
- Wrap HNSW load in a try/catch and degrade gracefully:
  - set `hnswAvailable = false`
  - log a warning (ideally once)

### 6.3 **[Medium]** `embeddingsReady` defaults to “true” when state is missing

**Where**
- `const embeddingsReady = embeddingsState?.ready !== false && embeddingsState?.pending !== true;` (`src/retrieval/lmdb-helpers.js:97`).

**Why it matters**
- If `indexState` or `indexState.embeddings` is missing, `embeddingsReady` becomes `true`.
- This is not immediately harmful (missing artifacts yield `null`), but it makes the effective state harder to reason about and can mask “embeddings were never built.”

**Suggestion**
- Consider interpreting “missing embeddings state” as “unknown/not-ready,” and derive readiness from artifact presence instead.

### 6.4 **[Low]** Heavy “vocabIndex” construction on load could be deferred

**Where**
- Builds `vocabIndex` Maps for phrase ngrams, chargrams, and each field postings vocab (`src/retrieval/lmdb-helpers.js:160–172`).

**Why it matters**
- This can be expensive in big indexes and is done eagerly at load time.

**Suggestion**
- Consider lazy initialization (build on first use) or compact lookup structures.

---

## 7) Output Helpers (Cache / Context Cleaning / Explain / Summary)

### 7.1 **[Medium]** `cleanContext()` does not remove code fences with language tags

**Where**
- `src/retrieval/output/context.js:5` only removes lines equal to ```

**Why it’s a problem**
- Many renderers output fenced blocks like ```ts or ```json.
- Those fence lines are currently preserved, then whitespace-normalized.

**Suggestion**
- Treat any line starting with ``` as a fence line:
  - `if (trimmed.startsWith('```')) return false;`

### 7.2 **[Low]** `cleanContext()` assumes all items are strings

**Where**
- `line.trim()` will throw if a non-string slips through (`src/retrieval/output/context.js:4`).

**Suggestion**
- Coerce or guard:
  - `if (typeof line !== 'string') return false;`

### 7.3 **[Low]** `formatScoreBreakdown()` assumes `color.gray()` exists

**Where**
- `formatExplainLine()` (`src/retrieval/output/explain.js:1–5`).

**Why it matters**
- If `color` is missing or a partial implementation is passed, formatting will throw.

**Suggestion**
- Provide a fallback no-color implementation if `color?.gray` is not a function.

### 7.4 **[High]** `getBodySummary()` reads entire files synchronously; huge-file behavior is costly

**Where**
- `readTextFileSync(absPath)` (`src/retrieval/output/summary.js:15`)

**Why it’s a problem**
- This loads the entire file into memory just to slice `[start,end)`.
- For “huge files,” this:
  - blocks the event loop,
  - allocates a large string,
  - may not fit in the `fileTextCache` size limit (default 64MB), causing repeated full reads.

This is a plausible root cause for “huge files are a problem” in output rendering paths:
- When a file is larger than the cache’s max size, the cache may refuse to store it.
- The next summary request reads the whole file again.

**Suggestion**
- Prefer partial reads:
  - use `fs.openSync` + `fs.readSync` for the relevant range,
  - or `fs.createReadStream({ start, end })`.
- Add a “huge file” strategy:
  - cap summary extraction to some max bytes,
  - fall back to an index-provided excerpt if available,
  - or return a placeholder summary with a hint.

### 7.5 **[High]** `getBodySummary()` path handling can escape `rootDir`

**Where**
- `path.join(rootDir, chunk.file)` (`src/retrieval/output/summary.js:7`).

**Why it’s a problem**
- If `chunk.file` is absolute (starts with `/`), `path.join()` ignores `rootDir`.
- If `chunk.file` contains `../`, `join()` can escape the repo root.

Even if chunk metadata is normally trusted, this is a classic foot-gun when indexes are shared or federated.

**Suggestion**
- Use `path.resolve(rootDir, chunk.file)` and verify the result is inside `rootDir`:
  - `resolved.startsWith(path.resolve(rootDir) + path.sep)`

---

## 8) Suggested Test Additions

These are concrete tests that would make the above behaviors explicit and prevent regressions.

1) **Context expansion ID invariant**
   - Fixture: `chunkMeta` is an array of 3 chunks with IDs `[10, 11, 12]` and stored out of index order.
   - Assert: context expansion either (a) still works (after refactor to byId), or (b) throws/validates clearly.
   - Target: `src/retrieval/context-expansion.js`.

2) **Context expansion fan-out stress**
   - Fixture: one chunk with 5,000 importLinks and 5,000 usages; `maxPerHit=2`.
   - Assert: runtime stays bounded and no large candidate allocations.

3) **Windows path filter parsing**
   - Input: `C:\\repo\\file.ts`.
   - Assert: parsed as a `file` filter token, not `unknown filter key c`.
   - Target: `src/retrieval/filters.js`.

4) **Filter index “no bitmap” mode**
   - Build with `includeBitmaps:false`.
   - Serialize/hydrate.
   - Assert: hydrate can preserve “no bitmap” behavior (once supported) or is explicitly documented as unsupported.

5) **LMDB file-meta merge preserves zero values**
   - Fixture: a chunk with `churn=0` and fileMeta has `churn=undefined`.
   - Assert: chunk.churn remains `0`.
   - Target: `src/retrieval/lmdb-helpers.js`.

6) **LanceDB candidate filtering returns at least topN**
   - Fixture: candidateSet is a strict subset.
   - Assert: if pushdown disabled, implementation either (a) doesn’t filter or (b) increases limit until it finds enough.
   - Target: `src/retrieval/lancedb.js`.

7) **Summary path traversal hardening**
   - Fixture: a chunk with `file='../../etc/passwd'`.
   - Assert: summary refuses / returns safe placeholder.
   - Target: `src/retrieval/output/summary.js`.

8) **Summary huge-file behavior**
   - Fixture: file > cache max size.
   - Assert: summary does not repeatedly read full file on multiple calls (requires instrumentation/mocking `readTextFileSync`).

