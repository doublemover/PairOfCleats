# Codebase Static Review Findings — Pass 5 (Artifacts, Chunking, Language Registry, Cross‑file Inference, ANN, Retrieval CLI)

## Scope

This sweep reviewed **only** the files listed below.

### Build artifacts, postings, shards, and build state
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

### Chunking, chunk IDs, and comment extraction
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

### Language registry and import collectors
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

### Risk, minhash, structural metadata, and cross‑file type inference helpers
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

### Retrieval ANN providers and bitmap utilities
- `src/retrieval/ann/providers/dense.js`
- `src/retrieval/ann/providers/hnsw.js`
- `src/retrieval/ann/providers/lancedb.js`
- `src/retrieval/ann/providers/sqlite-vec.js`
- `src/retrieval/ann/types.js`
- `src/retrieval/bitmap.js`

### Retrieval CLI utilities
- `src/retrieval/cli-dictionary.js`
- `src/retrieval/cli-lmdb.js`
- `src/retrieval/cli-sqlite.js`
- `src/retrieval/cli/ansi.js`
- `src/retrieval/cli/auto-sqlite.js`
- `src/retrieval/cli/backend-context.js`
- `src/retrieval/cli/branch-filter.js`
- `src/retrieval/cli/highlight.js`
- `src/retrieval/cli/load-indexes.js`
- `src/retrieval/cli/model-ids.js`
- `src/retrieval/cli/options.js`
- `src/retrieval/cli/persist.js`
- `src/retrieval/cli/policy.js`
- `src/retrieval/cli/query-plan.js`
- `src/retrieval/cli/search-runner.js`
- `src/retrieval/cli/telemetry.js`

## Method

- Static read‑through only (no runtime execution).
- Prioritized correctness, drift between config/docs and runtime behavior, edge‑case safety, and high‑leverage performance footguns.
- Severity scale:
  - **P0** — likely crash, data corruption, or major correctness failure in common paths or explicitly supported modes.
  - **P1** — correctness gaps, drift, or resource hazards that will show up at scale or in realistic repos.
  - **P2** — performance pitfalls, brittle heuristics, or maintainability risks.
  - **P3** — minor issues, nits, or optional improvements.

## Executive summary

### Highest‑priority corrections
1. **P0 — Chargram indexing aborts early on long tokens**: a `return` inside token iteration stops chargram generation for the rest of the token list. This will silently reduce chargram postings coverage (and anything downstream that depends on them). (`src/index/build/state.js`)
2. **P1 — Import collection option shape is almost certainly wrong**: `collectLanguageImports()` passes `{ ext, relPath, mode, options }` instead of a flattened options object, making it hard/impossible for language collectors to read configuration consistently. (`src/index/language-registry/registry.js`)
3. **P1 — Several comment config knobs are defined but never enforced**: `maxPerChunk`, `maxBytesPerChunk`, `minTokens`, `includeLicense`, `includeInCode` exist in config but do not participate in extraction, increasing the risk of huge metadata payloads and doc drift. (`src/index/comments.js`)
4. **P1 — Cached bundle metadata hardcodes `sha1`**: `reuseCachedBundle()` sets `fileInfo.hashAlgo: 'sha1'` whenever a hash exists, ignoring the `fileHashAlgo` argument. If you ever change algorithms (or already do in some modes), metadata can become inconsistent. (`src/index/build/file-processor/cached-bundle.js`)
5. **P1 — SQLite backend caching can retain closed DB handles**: when a SQLite DB is opened and cached, then later closed due to an overall “disable sqlite” decision, the cached entry is not guaranteed to be evicted. If `dbCache` is a plain `Map`, future lookups could return a closed handle. (`src/retrieval/cli-sqlite.js`)

### “Drift and scalability” themes that keep recurring
- **Mode‑sensitivity isn’t consistently guarded**: metrics and artifacts assume certain postings exist, and shard balancing can intentionally mix languages. If the roadmap’s “vector‑only / sparse‑optional / WASM grouping” features become first‑class, some of these assumptions become hard failures unless addressed.
- **Config schema vs behavior drift**: comment extraction and token retention normalization have notable drift (duplicate logic, mismatched parsing/normalization).
- **Sizing heuristics do extra work**: file relations JSON sizing re‑stringifies every entry up front, then re‑serializes again when writing.

---

## Findings and recommendations

### 1) Index build state, artifacts, postings, shards

#### P0 — Chargram token cutoff aborts processing (`return` vs `continue`)
- **Where**: `src/index/build/state.js` — `addFromTokens()` inside `appendChunk()`.
  - Evidence: line ~257: `if (chargramMaxTokenLength && w.length > chargramMaxTokenLength) return;`
- **What’s wrong**: A single “too long” token causes `addFromTokens()` to return immediately, skipping chargram extraction for all subsequent tokens.
- **Why it matters**:
  - This is silent correctness degradation: any file containing one long identifier/path/string in the token stream will under‑index chargrams.
  - Chargram postings are typically used to improve substring / fuzzy matching; reduced coverage will make those features feel “randomly unreliable.”
- **Suggested fix**:
  - Replace `return` with `continue` (skip only the offending token) and consider defensive `typeof w === 'string'` checks.
- **Suggested tests**:
  - Unit: feed `appendChunk()` a token list with a long token in the middle and verify chargrams are still emitted for tokens after it.
  - Regression: ensure total chargram postings increases monotonically with more tokens (except for excluded tokens).

#### P1 — `markBuildPhase()` writes a stray top‑level `phase` key
- **Where**: `src/index/build/build-state.js`.
  - Evidence: lines ~86–93 build `patch = { phase, phases: { ... } }` and pass it into `updateBuildState()`.
- **What’s wrong**: The intended state model appears to be `build_state.phases[phase] = { startedAt, ... }`, but this function also persists a top‑level `phase` field.
- **Why it matters**:
  - This creates schema drift and makes it harder to reason about the canonical “current phase” (is it `phase`, `currentPhase`, inferred from the latest `phases` entry, etc.).
  - Downstream tooling/UX can accidentally depend on the wrong field.
- **Suggested fix**:
  - Remove the top‑level `phase` from patches; if a “current phase” field is desired, define it explicitly and update consistently.
- **Suggested tests**:
  - Snapshot test for the written `build_state.json` shape after calling `markBuildPhase()`.

#### P2 — Build checkpoint heartbeat flushes on the first processed file
- **Where**: `src/index/build/build-state.js` — `createBuildCheckpoint()`.
  - Evidence: `lastAt = 0;` then `now - lastAt >= intervalMs` triggers on first tick.
- **What’s wrong**: `lastAt` starts at 0, so `tick()` will immediately persist state on the first file, regardless of interval/batch settings.
- **Why it matters**:
  - Minor I/O overhead and noisy state churn.
  - In watch/incremental loops, this contributes to “death by a thousand writes.”
- **Suggested fix**:
  - Initialize `lastAt = Date.now()`.
- **Suggested tests**:
  - Use a fake clock; confirm that the first `tick()` does not persist unless `batchSize` condition is met.

#### P1 — Cached bundle metadata hardcodes hash algorithm
- **Where**: `src/index/build/file-processor/cached-bundle.js`.
  - Evidence: lines ~48–49 set `hashAlgo: resolvedHash ? 'sha1' : null`.
- **What’s wrong**: The function accepts `fileHashAlgo` but ignores it for `fileInfo.hashAlgo` and for `manifestEntry.hashAlgo`.
- **Why it matters**:
  - If the repo ever changes hashing algorithms, or uses different algorithms in different modes, metadata becomes inconsistent.
  - This undermines cache key correctness and “index diffing / incremental invariants.”
- **Suggested fix**:
  - Use `fileHashAlgo` when provided; otherwise preserve `cachedEntry.hashAlgo`.
- **Suggested tests**:
  - Create a cached bundle entry with `hashAlgo: 'sha256'`; call `reuseCachedBundle()` with `fileHashAlgo: 'sha256'`; ensure output reflects it.

#### P2 — Compression flag naming/typing is misleading
- **Where**: `src/index/build/artifacts/compression.js`.
  - Evidence: `compressionEnabled = compressionConfig.enabled === true && compressionMode;`
- **What’s wrong**: `compressionEnabled` is not strictly boolean; it can become `'gzip'` or `'zstd'`.
- **Why it matters**:
  - This is a classic “truthy string” footgun. It works in boolean contexts, but becomes fragile if ever compared strictly or serialized.
  - It increases the chance of subtle bugs in config dumps and metrics.
- **Suggested fix**:
  - Split into `{ compressionEnabled: boolean, compressionMode: 'gzip'|'zstd'|null }`.
- **Suggested tests**:
  - Verify type of `compressionEnabled` is boolean in all code paths.

#### P1 — Metrics writer assumes postings exist
- **Where**: `src/index/build/artifacts/metrics.js`.
  - Evidence: line ~85 uses `postings.tokenVocab.length` without guarding `postings` or `tokenVocab`.
- **What’s wrong**: This writer will throw if postings are absent or partially absent.
- **Why it matters**:
  - The roadmap includes “vector‑only indexing” and other sparse‑optional modes; this will become a hard crash in those modes.
- **Suggested fix**:
  - Make metrics robust: treat missing posting artifacts as `{ vocabSize: 0, tokenPostingBytes: 0, ... }`.
- **Suggested tests**:
  - Run metrics writer with a mock `postings = { denseVec: { ... }, denseDims: 384 }` (no token postings) and confirm it writes successfully.

#### P2 — Token retention normalization duplicates and drifts
- **Where**:
  - `src/index/build/artifacts/token-mode.js`
  - `src/index/build/indexer/steps/postings.js`
- **What’s wrong**:
  - Two independent normalizers exist. The postings step normalizer does not trim/lowercase (`tokenModeRaw`), and doesn’t consistently floor numeric settings.
- **Why it matters**:
  - Config drift will produce confusing behavior (e.g., `AUTO` works in one path but not another).
  - It’s easy for docs to become wrong.
- **Suggested fix**:
  - Centralize token retention normalization in one module and reuse it.
- **Suggested tests**:
  - Parameterized config normalization tests across the full matrix of inputs.

#### P2 — File relations writer double‑serializes for sizing
- **Where**: `src/index/build/artifacts/writers/file-relations.js`.
  - Evidence: lines ~36–45 compute `JSON.stringify(entry)` for every entry to estimate bytes, then later the writer serializes again.
- **What’s wrong**: Up‑front sizing doubles serialization work (and allocates large transient strings).
- **Why it matters**:
  - In large repos, file relations can be huge; this is a non‑trivial overhead.
- **Suggested fix**:
  - Prefer a streaming sharded writer that splits based on running byte count, rather than a separate sizing pass.
- **Suggested tests**:
  - Benchmark fixture (excluded from CI) that exercises large `fileRelations` maps.

#### P2 — Shard “balancing” intentionally mixes languages
- **Where**: `src/index/build/shards.js` — `balanceShardsGreedy()`.
  - Evidence: output shards have `lang: 'mixed'` (lines ~320–326).
- **What’s wrong (relative to roadmap direction)**:
  - Current behavior is fine for balancing concurrency, but conflicts with **WASM grouping / language‑segmented execution** requirements: a “mixed” shard can force frequent WASM reloads or require multi‑runtime capability per worker.
- **Why it matters**:
  - You explicitly want shard planning to be WASM grouping aware (not optional). “Mixing” is the opposite of grouping.
- **Suggested fix**:
  - Introduce a “preserveLanguageGrouping” option or a planner stage that balances *within* language buckets first, then balances across buckets without mixing.
- **Suggested tests**:
  - Given entries across 3 languages, ensure shard planner can hit `maxShards` without producing mixed‑language shards (unless explicitly allowed).

#### P1 — Postings builder is not sparse‑optional
- **Where**: `src/index/build/postings.js`.
  - Evidence: line ~377: `const tokenEntries = Array.from(tokenPostings.entries());` (no guard).
- **What’s wrong**:
  - `buildPostings()` assumes token postings exist. If you add vector‑only or “disable sparse postings” modes, this path will throw.
- **Why it matters**:
  - Directly blocks “vector‑only indexing” as a first‑class capability.
- **Suggested fix**:
  - Make sparse components optional:
    - Accept `tokenPostings = null` and return `tokenVocab: []`, `tokenPostings: []`, `docLengths: []`.
    - Gate BM25 tuning on presence of docLengths.
- **Suggested tests**:
  - Unit: vector‑only postings build.
  - Integration: retrieval path behaves sensibly when sparse artifacts are missing.

#### File‑by‑file notes (build artifacts & postings)

- `src/index/build/artifacts/file-meta.js`
  - **P3**: uses falsy checks like `if (!info.size && Number.isFinite(...))` which treats `0` as “missing.” For a zero‑byte file, this can cause unintended overwrites.
  - Suggest using `info.size == null` semantics.

- `src/index/build/artifacts/filter-index.js`
  - No obvious correctness issues; config hashing and schema entries look reasonable.

- `src/index/build/artifacts/schema.js`
  - **P2**: schema includes both `chunkAuthors` and `chunk_authors` optional field names; consider consolidating to one canonical casing to reduce consumer drift.

- `src/index/build/artifacts/token-mode.js`
  - Looks like the more robust normalizer; use it as the single source of truth.

- `src/index/build/artifacts/writer.js`
  - Clean abstraction; primary risk is the “truthy string” compression flag noted above.

- `src/index/build/artifacts/writers/repo-map.js`
  - **P2**: eager accumulation + full sort can be memory heavy for huge repos; consider streaming writer or partial ordering if this becomes a scaling bottleneck.

- `src/index/build/file-processor/embeddings.js`
  - No clear correctness bugs. Primary risk is lack of a “hard failure” mode when embeddings return all empty vectors (dims=0); consider adding explicit validation if embeddings are “required” for a given run mode.

- `src/index/build/file-processor/skip.js`
  - Behavior looks coherent; it depends heavily on upstream scan state correctness.

- `src/index/build/imports.js`
  - Solid structure. Primary scaling issue is repeated full‑file reads for import scanning; in a streaming pipeline, share the same read buffer with other steps.

- `src/index/build/indexer/steps/postings.js`
  - See drift note with token-mode.

- `src/index/build/tokenization.js`
  - Generally sound. Be aware: stemming + synonym expansion can significantly inflate token sequences; if memory becomes tight, consider making expansion configurable by mode.

---

### 2) Chunking, chunk IDs, embedding helper, field weighting, headline, comments

#### P1 — Comment extraction config knobs are defined but not enforced
- **Where**: `src/index/comments.js`.
  - Evidence: config includes `maxPerChunk`, `maxBytesPerChunk`, `minTokens`, `includeLicense`, `includeInCode` (lines ~33–52) but there are no references to those keys elsewhere in the file.
- **What’s wrong**:
  - The file defines important controls but the extractor does not apply them.
- **Why it matters**:
  - Large comment blocks (especially license headers and generated file banners) can bloat metadata and embeddings.
  - Doc drift: users believe knobs work when they don’t.
- **Suggested fix**:
  - Enforce limits inside `extractComments()` (or at least at the point comments are attached to chunks):
    - Cap count per chunk.
    - Cap bytes per chunk.
    - Implement `minTokens` (rough tokenization or char‑based approximation is acceptable as a first pass).
    - Respect `includeLicense` and `includeInCode`.
- **Suggested tests**:
  - Fixture with a file containing 1,000 line comments; confirm extraction obeys caps.
  - Verify that turning off `includeLicense` removes license comments but keeps doc comments.

#### P2 — JS comment scanner does not model regex literals / template interpolations
- **Where**: `src/index/comments.js` — `scanComments()`.
- **What’s wrong**:
  - The scanner handles string delimiters and escapes but does not distinguish regex literals from division, and treats template strings as fully “string” (ignoring `${...}` nested code).
- **Why it matters**:
  - False positives/negatives for comment extraction in real JS/TS codebases.
- **Suggested fix**:
  - Consider reusing tree-sitter/babel comment extraction where available, at least for JS/TS.
- **Suggested tests**:
  - JS fixtures covering `/.../` regex with `//` inside, template strings with `${ // comment }` patterns.

#### P2 — Chunking dispatch has duplicated chunker registrations
- **Where**: `src/index/chunking/dispatch.js`.
- **What’s wrong**:
  - `graphql` and `proto` appear in both `CODE_CHUNKERS` and `CODE_FORMAT_CHUNKERS`. The second registration is redundant and can drift.
- **Why it matters**:
  - Not a runtime bug today, but duplication increases maintenance cost and future inconsistency.
- **Suggested fix**:
  - Keep each language/format in a single list, or add an explicit fallback chain that explains why duplicates exist.

#### P2 — JSON chunker uses potentially quadratic scanning
- **Where**: `src/index/chunking/formats/json.js`.
- **What’s wrong**:
  - `parseJsonString()` + `text.slice(...).search(/\S/)` inside a while loop can produce O(n^2) behavior on large JSON files.
- **Why it matters**:
  - Large lockfiles / generated JSON can become a chunking hotspot.
- **Suggested fix**:
  - Avoid repeated `slice().search()`; maintain an index pointer and scan forward.
- **Suggested tests**:
  - Benchmark fixture (excluded from CI) with a large JSON file.

#### P2 — Byte limit splitter is correct but potentially expensive
- **Where**: `src/index/chunking/limits.js`.
- **What’s wrong**:
  - Uses repeated substring byteLength computations inside a binary search per chunk.
- **Why it matters**:
  - Acceptable as a guardrail; but in a “high‑throughput streaming pipeline,” this can become a bottleneck.
- **Suggested fix**:
  - Consider amortized scanning or precomputed UTF‑8 byte offsets if this becomes hot.

#### File‑by‑file notes (chunking and helpers)

- `src/index/chunk-id.js`
  - Looks correct; chunk IDs are stable and deterministic given the input tuple.

- `src/index/chunking.js`
  - Simple re-export.

- `src/index/chunking/tree-sitter.js`
  - Simple re-export.

- `src/index/embedding.js`
  - Clean helper. Consider validating returned embeddings length/dims if downstream assumes fixed size.

- `src/index/field-weighting.js`
  - **P3**: path heuristics like `/test/i` can false-positive (e.g., `latest/`). Consider boundary-aware matches.

- `src/index/headline.js`
  - Straightforward and safe.

---

### 3) Language registry and import collectors

#### P1 — `collectLanguageImports()` likely passes the wrong options shape
- **Where**: `src/index/language-registry/registry.js`.
  - Evidence: line ~648 calls `lang.collectImports(text, { ext, relPath, mode, options })`.
- **What’s wrong**:
  - The passed object nests the real options under `options`, rather than merging them at the top level.
  - Most of the codebase passes a **flat** options object (e.g., `{ ...options, relPath }`). This import path is inconsistent.
- **Why it matters**:
  - Language collectors can’t reliably read config (e.g., `options.typescript.*`), leading to silent drift.
  - This is exactly the kind of subtle inconsistency that breaks “parity” efforts across languages.
- **Suggested fix**:
  - Change to something like:
    - `const prepared = prepareLanguageOptions({ relPath, mode, ext, options });`
    - `lang.collectImports(text, prepared)`
  - Or minimally: `lang.collectImports(text, { ...options, ext, relPath, mode })`.
- **Suggested tests**:
  - Mock a language collector that reads `options.foo === true` and confirm `collectLanguageImports()` passes it through.

#### P2 — Import collectors are generally regex-only and inconsistent about comment stripping
- **Where**: `src/index/language-registry/import-collectors/*.js`.
- **What’s wrong**:
  - Some collectors ignore comments (`cmake`, `starlark`, partially `makefile`), others do not (`dart`, `groovy`, `nix`, etc.).
- **Why it matters**:
  - Commented-out imports become false “neighbors,” bloating import neighborhood graphs.
- **Suggested fix**:
  - Standardize: either strip obvious line comments first, or implement a “comment aware” scan in `utils.js`.
- **Suggested tests**:
  - For each collector: a fixture where the import statement appears in a comment and should not be returned.

#### P2 — `dockerfile` collector treats stage aliases as imports
- **Where**: `src/index/language-registry/import-collectors/dockerfile.js`.
- **What’s wrong**:
  - It collects `AS stage` names as “imports.” That stage name is local; it can distort cross-file relations.
- **Why it matters**:
  - Can add noisy “import links” between Dockerfiles that share stage names.
- **Suggested fix**:
  - Keep collecting base images (`FROM ubuntu:...`) but consider omitting stage aliases from “imports” unless explicitly needed.

#### File‑by‑file notes (language registry)

- `src/index/language-registry.js`
  - Re-export.

- `src/index/language-registry/control-flow.js`
  - Looks coherent as a conservative keyword heuristic.

- `src/index/language-registry/registry.js`
  - Generally well-structured; primary issue is options shape for import collection.

- `src/index/language-registry/simple-relations.js`
  - Useful fallback. Be careful about over‑matching: many regexes are broad and can produce false positives in strings/comments.

---

### 4) Risk rules, minhash, structural metadata, and cross‑file inference helpers

#### P1 — Minhash uses `Infinity` sentinel values (serialization hazard)
- **Where**: `src/index/minhash.js`.
  - Evidence: constructor initializes `hashValues = Array(...).fill(Infinity)`.
- **What’s wrong**:
  - `Infinity` is not valid JSON number; `JSON.stringify(Infinity)` becomes `null`.
- **Why it matters**:
  - If minhash signatures are persisted in JSON (chunk meta), “uninitialized” slots can turn into `null` and break comparisons.
- **Suggested fix**:
  - Use a 32‑bit sentinel like `0xFFFFFFFF` for an “unset” minhash value.
- **Suggested tests**:
  - Serialize and re-read minhash sig; confirm values remain numbers.

#### P2 — Cross-file inference extraction assumes `docmeta.params` is a string array
- **Where**: `src/index/type-inference-crossfile/extract.js`.
  - Evidence: `const paramNames = Array.isArray(docmeta?.params) ? docmeta.params : ...;`.
- **What’s wrong**:
  - If any docmeta emitter sets `params` as objects (`{ name, type }`), `paramNames` becomes an object array and downstream mapping becomes wrong.
- **Why it matters**:
  - Weakens (or silently breaks) the already-delicate “infer from call sites” logic.
- **Suggested fix**:
  - Normalize `docmeta.params` into a string array (extract `.name` when objects).
- **Suggested tests**:
  - Feed `extractParamTypes()` a docmeta object with object-form params; ensure result keys are param names.

#### P2 — Risk rules: generally good; ensure rule merge semantics are explicit
- **Where**: `src/index/risk-rules.js`.
- **Note**:
  - Merge strategy is “last writer wins” by `id`. That is sensible, but consider documenting this in the rules schema docs so it’s not surprising.

#### File‑by‑file notes

- `src/index/structural.js`
  - Looks reasonable; path normalization behavior should be documented (outside-root paths keep their posix form).

- `src/index/tooling/signature-parse/clike.js`
  - **P3**: function pointer params and complex declarators will parse poorly; this is expected for a heuristic parser. Consider surfacing a “confidence” flag.

- `src/index/tooling/signature-parse/python.js`
  - Reasonable for common signatures. Multi-line signatures are not handled; likely acceptable for an initial pass.

- `src/index/tooling/signature-parse/swift.js`
  - Reasonable heuristic.

- `src/index/type-inference-crossfile/apply.js`
  - Appears correct; be cautious about overwriting explicit types. Consider storing provenance (`source: 'crossfile'`).

- `src/index/type-inference-crossfile/constants.js` / `symbols.js`
  - Straightforward.

---

### 5) Retrieval ANN providers and bitmap utilities

#### P2 — Bitmap nullability requires disciplined callers
- **Where**: `src/retrieval/bitmap.js`.
- **What’s wrong**:
  - Many helpers return `null` when roaring-wasm is unavailable or when ID lists are small.
- **Why it matters**:
  - Callers must treat bitmap usage as opportunistic and always have a set-based fallback.
- **Suggested fix**:
  - Ensure all call sites treat bitmap functions as best-effort; consider a tiny wrapper that normalizes `null` to “no-op bitmap.”

#### File‑by‑file notes

- `src/retrieval/ann/providers/dense.js`
  - Looks correct as a dense-vector baseline provider.

- `src/retrieval/ann/providers/hnsw.js`
  - Clean integration; just ensure the availability state is always populated when HNSW artifacts exist.

- `src/retrieval/ann/providers/lancedb.js`
  - Good optional provider model.

- `src/retrieval/ann/providers/sqlite-vec.js`
  - Straightforward wrapper.

- `src/retrieval/ann/types.js`
  - Good type definition.

---

### 6) Retrieval CLI utilities, backends, and index loading

#### P1 — SQLite DB cache can retain closed handles
- **Where**: `src/retrieval/cli-sqlite.js`.
  - Evidence:
    - `openSqlite()` caches `db` with `dbCache.set(dbPath, db)` (line ~177).
    - Later, if sqlite is disabled because one of the required DBs is missing, it closes DBs but does not guarantee eviction when `dbCache` is a plain `Map`.
- **What’s wrong**:
  - If `dbCache` does not implement a `close()` method that also removes the cached entry, future calls may receive a closed DB object.
- **Why it matters**:
  - Hard-to-debug runtime failures that appear nondeterministic (“first query works, later queries fail”).
- **Suggested fix**:
  - Define a small `SqliteHandleCache` contract:
    - `get(path)`, `set(path, db)`, and `close(path)` that **also deletes**.
  - Or, when falling back to `db.close()`, also `dbCache.delete(path)` if available.
- **Suggested tests**:
  - Provide `dbCache = new Map()` in a unit test; simulate open->cache->close; confirm a second call reopens rather than returning the closed handle.

#### P2 — `estimateIndexBytes()` is not “pieces/manifest” aware
- **Where**: `src/retrieval/cli/options.js`.
  - Evidence: function only sums legacy top-level JSON artifacts and `.parts` directories.
- **What’s wrong**:
  - The project is moving toward a piece/manifest architecture; this estimator will undercount and mislead auto-sqlite decisions.
- **Why it matters**:
  - Backend auto-selection can pick suboptimal storage paths at scale.
- **Suggested fix**:
  - Prefer using the piece manifest (when present) to compute bytes; fall back to legacy.
- **Suggested tests**:
  - Create a fake index dir with `pieces/manifest.json` listing compressed pieces; verify estimated bytes matches sum.

#### P2 — Highlight regex can blow up on large term sets
- **Where**: `src/retrieval/cli/highlight.js`.
- **What’s wrong**:
  - The regex joins all terms into one alternation; large term sets can exceed regex engine limits or become slow.
- **Why it matters**:
  - Users can request large expansions (synonyms / tokenization) and then the CLI becomes slow.
- **Suggested fix**:
  - Cap highlight terms; optionally use a streaming highlighter rather than a monolithic regex.

#### P2 — Branch filter behavior defaults to “allow” when branch is unknown
- **Where**: `src/retrieval/cli/branch-filter.js`.
- **What’s wrong**:
  - If branch can’t be determined, it warns but returns `true` (allows results).
- **Why it matters**:
  - When users specify `--branch`, they likely want strict enforcement.
- **Suggested fix**:
  - Consider a “strict” mode: if branch filter requested but cannot be determined, treat as mismatch unless `--branch=any` or an explicit override flag.

#### File‑by‑file notes (retrieval CLI)

- `src/retrieval/cli/backend-context.js`
  - Reasonable backend selection assembly.

- `src/retrieval/cli/auto-sqlite.js`
  - Good “auto” heuristic structure; just ensure size estimation and manifest reading are consistent.

- `src/retrieval/cli/load-indexes.js`
  - Generally solid. Be careful with lazy chunk loading: ensure all filters/context expansion paths always have access to required metadata.

- `src/retrieval/cli/query-plan.js`
  - Nice “plan” output. Consider including “effective limits” (post-filter counts, bm25 defaults) if available.

- `src/retrieval/cli/search-runner.js`
  - Clean orchestration; potential duplication of “explain” vs “dryRun” modes, but no clear correctness bugs.

- `src/retrieval/cli/telemetry.js`
  - Safe, well-guarded.

- `src/retrieval/cli-dictionary.js`, `src/retrieval/cli-lmdb.js`
  - Straightforward.

---

## Cross-cutting improvement suggestions (non-fix, but high leverage)

These are not “bugs,” but they directly support the roadmap direction (streaming, sharding/WASM grouping, federation, and correctness invariants).

1. **Make “sparse optional” a first-class contract**
   - Decide: can the system run with no token postings? If yes, encode that decision in:
     - artifact schemas,
     - metrics writers,
     - retrieval backend selection,
     - and CLI plan output.

2. **Unify normalization logic**
   - Token retention config parsing, compression config parsing, and comment config application should each have a single canonical normalizer + tests.

3. **Manifest-first IO**
   - Retrieval’s “auto backend selection” should trust `pieces/manifest.json` when present.

4. **Language-aware shard planning**
   - If WASM grouping is mandatory, ensure shard planning never mixes languages by default, and that balancing algorithms operate within language buckets.

---

## Suggested test additions (targeted)

- `state.appendChunk` chargram regression test (long token midstream).
- `collectLanguageImports` option pass-through test (ensures flat options reach collectors).
- `comments.extractComments` cap enforcement test (`maxPerChunk`, `maxBytesPerChunk`).
- `reuseCachedBundle` hash algorithm correctness test.
- `cli-sqlite` dbCache eviction test with `dbCache = new Map()`.
- `buildPostings` sparse-optional test harness (tokenPostings null/empty).

