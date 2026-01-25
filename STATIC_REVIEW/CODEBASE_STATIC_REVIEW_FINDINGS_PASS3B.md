# Codebase Static Review Findings — Additional Sweep ("Pass 3B")

This is a follow-on static review focused on files **not covered in the first two sweeps** (per your provided exclusion list). The emphasis here is on **correctness**, **latent bugs**, **mis-implementations**, **config drift**, and a handful of **performance / scalability hazards** that become more relevant as you push toward streaming + WASM-grouped shard execution.

## Scope

Reviewed (non-exhaustive) areas/files in this sweep:

- Index build primitives: postings/index-state accumulation
  - `src/index/build/state.js`
  - `src/index/build/postings.js`
  - `src/index/build/indexer/steps/postings.js`
- Shard planning and balancing
  - `src/index/build/shards.js`
- Import scanning and language registry integration
  - `src/index/build/imports.js`
  - `src/index/language-registry/registry.js`
- Service queue plumbing
  - `tools/service/queue.js`
- Streaming JSON writers
  - `src/shared/json-stream.js`
- Vector quantization helpers (SQLite path)
  - `src/storage/sqlite/vector.js`
- Retrieval support modules not in prior list
  - `src/retrieval/fts.js`
- Observability normalization
  - `src/shared/metrics.js`
- ANN wrapper semantics
  - `src/shared/hnsw.js`

---

## Executive summary

### Highest priority correctness issues

1. **Token postings building can silently truncate tokens for a chunk** when encountering a token over `chargramMaxTokenLength`, due to an unintended `return` (should be `continue`). This can materially degrade recall and skew doc-length norms.
2. **Import scanning options are not passed to per-language import collectors** due to a wrapper-object bug in `collectLanguageImports()`. This can produce incorrect import graphs and undermines planned graph-aware features.
3. **Vector dequantization can divide by zero** if `quantization.levels <= 1` reaches the SQLite vector path, producing `Infinity`/`NaN` values.

### Important design mismatch to flag now (because you asked for WASM grouping to be non-optional)

- The shard balancer can intentionally create **`lang: 'mixed'` shards** when `maxShards` is set, which is directly at odds with “WASM grouping first” execution. If you keep the balancer, it needs a constraint mode that preserves language grouping.

---

## Findings

### 1) Critical — Postings truncation due to early return on long token

**Where**
- `src/index/build/state.js` — `addFromTokens()`

**Evidence**
- The per-token guard uses `return`, which exits the function and skips all remaining tokens.

```js
// src/index/build/state.js
// ...
if (chargramMaxTokenLength && w.length > chargramMaxTokenLength) return;
```

Line reference: `src/index/build/state.js:257` (see `nl -ba` around 245–265).

**Why this is a real bug**
- The intent of `chargramMaxTokenLength` is clearly to **skip individual pathological tokens**, not to discard the entire remainder of the chunk token stream.
- This bug will disproportionately affect minified code, embedded blobs, long identifiers/URLs, etc. If the long token appears early in token order, *most* of the chunk’s postings are dropped.

**Impact**
- Recall loss: chunk becomes “invisible” to terms that appear after the long token.
- Scoring distortion: doc-length normalization and BM25-like signals may skew because the token set is incomplete.
- Hard to detect: no error, no warning.

**Fix**
- Replace `return` with `continue`.

**Tests to add**
- Unit test that sets `chargramMaxTokenLength=8`, passes tokens like `["aaaaaaaaaaaaaaaa", "keepme", "alsokeep"]` and asserts postings include `keepme` and `alsokeep`.
- Add a regression test ensuring `appendChunk()` still computes docLengths / field postings correctly when a long token is present.

---

### 2) High — Import scanning drops configuration/options due to wrapper bug

**Where**
- `src/index/language-registry/registry.js` — `collectLanguageImports()`
- Consumed by `src/index/build/imports.js` (`scanImports()` / `buildAllImports()`)

**Evidence**

```js
// src/index/language-registry/registry.js
// ...
const imports = lang.collectImports(text, { ext, relPath, mode, options });
```

Line reference: `src/index/language-registry/registry.js:648`.

**Why this is a real bug**
- This passes a wrapper object that nests the caller’s options under `options`, instead of merging them into the object passed to the collector.
- Many import collectors (and their downstream parsers) check option keys at the top level (examples include `ast`, `typescriptParser`, parser toggles, etc.). With the current wrapper, they’ll silently behave as if options are unset.

**Concrete failure mode you can test today**
- JavaScript import collection (`src/lang/javascript/imports.js`) honors `options.ast`.
  - With the current wrapper bug, `options.ast` is never seen (it becomes `passed.options.ast`).
  - Result: the collector reparses (or returns empty) instead of using the provided AST.

**Impact**
- Incorrect or inconsistent `allImports` → incorrect `importLinks` resolution.
- Graph-aware features (context expansion, change-impact analysis, architecture slicing) become noisier or wrong.
- Performance regression potential: avoids AST reuse.

**Fix**
- Change the call to merge options:

```js
lang.collectImports(text, { ...options, ext, relPath, mode })
```

(Or if you want to preserve namespace separation, standardize collector signatures across languages and update all call sites accordingly; right now the shape is inconsistent with `buildLanguageContext()` which uses an `{ options }` wrapper intentionally.)

**Tests to add**
- Registry-level unit test:
  - Call `collectLanguageImports('x.js', '', { ast: FAKE_AST })` where `FAKE_AST` is a minimal object that `collectImportsFromAst()` can read (e.g. `Program.body = [ImportDeclaration]`).
  - Expect the returned import list to reflect the AST.

---

### 3) High — Shard balancing can break language grouping (conflicts with WASM grouping requirement)

**Where**
- `src/index/build/shards.js` — `balanceShardsGreedy()`

**Evidence**

```js
// src/index/build/shards.js
return {
  id: `balanced-${idx + 1}`,
  label: batch.id,
  lang: 'mixed',
  mode: batch.mode,
  entries: mergedEntries,
  costMs,
};
```

Line reference: `src/index/build/shards.js:298–333`.

**Why this matters now**
- You explicitly stated “**Shard planning aware of WASM grouping is not optional**”.
- The current balancing step can create shards that include multiple languages, forcing either:
  - repeated WASM loads within a shard, or
  - disabling strict per-language execution ordering.

**Impact**
- Removes the primary lever you want for deterministic WASM load/unload and streaming throughput.

**Recommendation**
- Introduce a balancing mode that preserves grouping:
  - **Constraint**: never mix languages when `runtime.treeSitterEnabled` or when “WASM grouping required” is enabled.
  - Alternative: keep balancing within each language bucket only.

**Tests to add**
- Deterministic shard planner test fixture:
  - Set `maxShards=2` with input containing 2 languages.
  - Assert that output shards remain per-language when grouping-required flag is set.

---

### 4) Medium — `writeJsonLinesSharded()` can mis-serialize TypedArrays and has backpressure hazards

**Where**
- `src/shared/json-stream.js` — `writeJsonLinesSharded()`

**Evidence**

```js
const line = JSON.stringify(item);
// ...
await writeChunk(current.stream, line);
```

Line reference: `src/shared/json-stream.js:379–388`.

**Why this matters**
- `JSON.stringify(new Uint8Array([1,2]))` does **not** serialize the same way as the project’s `writeJsonValue()` helper (which explicitly converts TypedArrays to JSON arrays).
- If you ever emit sharded JSONL for artifacts containing TypedArrays (likely once you start sharding vector artifacts or other binary-ish metadata), you will get hard-to-debug schema drift.

**Performance note**
- `writeChunk()` handles backpressure for the writable side, but if you later route more complex transformations into this path (gzip/zstd), you can still see memory spikes if upstream produces faster than downstream can drain.

**Recommendation**
- Either:
  - explicitly forbid TypedArrays in sharded JSONL and enforce via validation (fast fail), or
  - use `writeJsonValue()` per item (slower), or
  - implement a fast-path serializer that matches `writeJsonValue()` semantics for TypedArrays.

**Tests to add**
- Unit test: write JSONL shard with an item containing `Uint8Array`, read back, assert exact JSON shape.

---

### 5) Medium — Vector dequantization can divide by zero for `levels <= 1`

**Where**
- `src/storage/sqlite/vector.js` — `dequantizeUint8ToFloat32()`

**Evidence**

```js
const scale = (maxVal - minVal) / (levels - 1);
```

Line reference: `src/storage/sqlite/vector.js:32`.

**Why this matters**
- `resolveQuantizationParams()` does not enforce `levels >= 2`.
- Some quantization code paths clamp to at least 2 (see `quantizeEmbeddingVectorUint8()`), but this dequantizer does not.

**Impact**
- `levels=1` yields `scale=Infinity` and produces `NaN`/`Infinity` values, which can poison similarity scoring.

**Fix**
- Clamp levels:
  - `const safeLevels = Math.max(2, levels | 0);`
  - Use `safeLevels` consistently.

**Tests to add**
- Unit test calling `dequantizeUint8ToFloat32(Buffer.from([0, 255]), {levels: 1, ...})` should not produce `NaN/Infinity`.

---

### 6) Medium — Service queue: "auto" queue naming is not consistently resolved

**Where**
- `tools/service/queue.js`

**Evidence / behavior**
- `enqueueJob()` resolves `queueName` via `resolveQueueName(job, queueName)` (supports `'auto'`).
- `claimNextJob(queueName)` and other queue operations use `getQueuePaths(dirPath, queueName)` directly and do **not** resolve `'auto'`.
  - Example: `claimNextJob('auto')` will look for `queue-auto.json`, which is not necessarily where `enqueueJob(..., 'auto')` wrote.

Relevant lines:
- `enqueueJob()` uses `resolveQueueName()` at `tools/service/queue.js:97–103`.
- `claimNextJob()` uses `getQueuePaths(dirPath, queueName)` at `tools/service/queue.js:62–70`.

**Impact**
- If any caller ever uses `'auto'` outside enqueue (or a refactor introduces it), the service queue can become “empty” even when jobs exist.

**Fix options**
- Option A (strict): reject `'auto'` for claim/touch/complete APIs (fail fast with clear error).
- Option B: include enough information in queue files to infer the resolved queue, and implement resolution consistently.

**Tests to add**
- Integration test: enqueue with `'auto'`, then claim with `'auto'` should either:
  - succeed (if you support it), or
  - deterministically error with a clear message.

---

### 7) Low/Medium — FTS weight override parsing is ambiguous for 6-element input

**Where**
- `src/retrieval/fts.js` — `resolveFtsWeights()`

**Evidence**

```js
if (values.length === 6) {
  const [, file, name, kind, headline, tokens] = values;
  // ...
}
```

Line reference: `src/retrieval/fts.js:43–62`.

**Concern**
- A 6-weight override silently discards `values[0]` and uses base weights for signature/doc.
- This may be intended, but it is *non-obvious* and easy to misuse.

**Recommendation**
- Document the accepted override shapes explicitly (6 vs 7 vs 8), or require explicit object-based overrides (named fields) to avoid positional ambiguity.

---

### 8) Low/Medium — Metrics backend normalization is missing several backends

**Where**
- `src/shared/metrics.js`

**Evidence**

```js
const BACKENDS = new Set(['memory', 'sqlite', 'sqlite-fts']);
```

Line reference: `src/shared/metrics.js:3–8`.

**Impact**
- If you run with LMDB, Tantivy, LanceDB, sqlite-vec, etc., metrics will collapse to `backend="unknown"`, reducing operational usefulness.

**Fix**
- Expand the enum to include all supported backends (or treat any non-empty backend string as valid and only normalize known typos).

---

### 9) Low — HNSW similarity conversion should be verified for `space: 'ip'`

**Where**
- `src/shared/hnsw.js` — `rankHnswIndex()`

**Evidence**

```js
const sim = space === 'l2' ? -distance : 1 - distance;
```

Line reference: `src/shared/hnsw.js:156`.

**Why flag this**
- For `ip`, whether `1 - distance` is the correct inversion depends on the hnswlib binding’s exact distance semantics.
- Even if monotonic, you may want a consistent “higher sim is better” mapping with documented meaning.

**Recommendation**
- Add a micro-test that builds a trivial HNSW index with two points and asserts ranking behavior for each space.

---

## Summary of recommended immediate fixes (with suggested ordering)

1. **Fix `addFromTokens()` early-return bug** (`src/index/build/state.js`).
2. **Fix `collectLanguageImports()` option passing** (`src/index/language-registry/registry.js`) + add the AST-forwarding unit test.
3. **Introduce “preserve language grouping” constraints in shard balancing** (`src/index/build/shards.js`) to support your required WASM execution strategy.
4. **Clamp quantization levels in dequantizers** (`src/storage/sqlite/vector.js`).
5. **Decide policy for TypedArrays in JSONL sharding** (`src/shared/json-stream.js`) before you rely on sharded artifact pipelines for embeddings.

---

## Notes: where this intersects planned roadmap items

- **WASM-grouped shard execution**: the current shard planner has all the ingredients (language-aware labeling), but the balancer can undo it. If you want the streaming + grouping pipeline, preserving language grouping needs to be an invariant.
- **Graph-aware features**: the `collectLanguageImports()` bug is a direct correctness blocker; it will introduce missing/incorrect edges and undermine trust in graph traversals.

