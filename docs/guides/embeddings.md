# Embeddings Contract Notes (Phases 7+)

Status: Contract notes for implementation and validation. This document complements:
- `docs/contracts/indexing.md` (stage semantics)
- `docs/contracts/public-artifact-surface.md` (manifest-first, strict discovery)
- `docs/contracts/sqlite.md` (SQLite stage expectations)

## 1) Identity and compatibility

The `xenova` provider uses `@huggingface/transformers` 4.x. Its public provider
name and model IDs (including `Xenova/all-MiniLM-L12-v2`) remain unchanged.
Existing generic model downloads and inference explicitly select `dtype: 'q8'`, preserving existing
`onnx/model_quantized.onnx` caches rather than silently switching Node inference
to full-precision weights. The `onnx` provider uses the same tokenizer package.
See the upstream [dtype migration guide](https://huggingface.co/docs/transformers.js/guides/dtypes).

Embeddings MUST be treated as build-scoped artifacts. A build may only consume embeddings produced with the same:

- embedding model/provider identity
- dims
- quantization policy (min/max/levels, scale)
- normalization/pooling/truncation policy

### 1.1 Embedding identity fields

Producers MUST compute and persist:
- `embeddingIdentity`: a structured descriptor (model/provider/mode/dims/quantization/etc.)
- `embeddingIdentityKey`: a stable hash/key derived from `embeddingIdentity`

These fields MUST be recorded in:
- `index_state.json.embeddings`
- service embedding queue payloads (when used)
- optionally ANN meta files (HNSW, LanceDB, sqlite dense_meta) for redundancy

### 1.2 Optional EmbeddingGemma 2 text/code embeddings

Select `onnx-community/embeddinggemma-2-ONNX` with `indexing.embeddings.model`
or `--model` when building embeddings. The CLI option takes precedence. This
is opt-in; the default model does not change. Use provider
`xenova`, which is the existing name for the Transformers.js adapter. The direct
single-file `onnx` provider is not supported for this multi-component export.

Optional `.pairofcleats.json` settings:

```json
{
  "indexing": {
    "embeddings": {
      "provider": "xenova",
      "model": "onnx-community/embeddinggemma-2-ONNX",
      "embeddinggemma2": { "dtype": "q4", "dimensions": 128 }
    }
  }
}
```

- Defaults: `fp32`, 768 dimensions, immutable ONNX revision
  `daa72c51243991dfcaf9f9137d2c573d8f7790c0`, and qualified Transformers.js 4.3.1.
- Supported precisions: `fp32`, `q8`, and `q4`. Half-precision variants are not
  enabled by this adapter. Supported dimensions: 128, 256, 512, and 768.
- An explicit `revision` must be a 40-character commit SHA. Updating revision,
  precision, or dimensions changes the embedding identity and requires rebuilding
  the affected embeddings. `--dims`, if also supplied to the standalone builder,
  must agree with the configured output dimensions.
- Only the text encoder and tokenizer load; vision/audio encoders are disabled.
  Tokenized input is truncated at 8192 tokens. The adapter consumes the projected
  `sentence_embedding` output, validates its shape and finite values, truncates
  dimensions, then L2-normalizes. `normalize: false` is rejected.
- Queries use `task: code retrieval | query: `; untitled code passages use
  `title: none | text: `. Separator whitespace is retained in persisted identity.
  Retrieval uses the index's saved profile, not an unrelated current precision.
- New E5/BGE identities also retain their exact prefix separator whitespace.
  Their rebuilt embedding caches receive different identity keys where the old
  identity trimmed those separators; existing caches are not relabeled in place.
- A tiny CPU smoke with the pinned q4 export covers two code passages and a query
  at 128 dimensions. It verifies loading, finite values, and unit norms, not
  ranking quality, broad hardware support, or a performance improvement.

The text-only q4 graph and weights total 174,519,542 bytes, plus tokenizer/config
files. Full-precision text weights are substantially larger. See the
[ONNX export](https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/tree/daa72c51243991dfcaf9f9137d2c573d8f7790c0)
and [Google model guidance](https://huggingface.co/google/embeddinggemma-2).

## 2) Terminology (Phase 7)

- **repoRoot**: repository being indexed or searched.
- **buildRoot**: build output root containing `index-code/`, `index-prose/`, etc.
- **indexDir**: per-mode index directory under `buildRoot` (for example, `<buildRoot>/index-code`).
- **mode**: `code | prose | extracted-prose | records`.
- **denseVectorMode**: `merged | code | doc | auto` (controls vector target selection).
- **denseVectorMode precedence**: `--dense-vector-mode` (CLI) > `search.denseVectorMode` (config) > defaults; CLI overrides log a warning.
- **sqlite-vec ANN**: the SQLite ANN extension indexes merged vectors only. When `denseVectorMode` resolves to `code`, `doc`, or `auto`, sqlite-vec ANN is disabled and search falls back to other ANN backends.
- **ANN variants**: dense vectors, HNSW, and LanceDB artifacts are emitted for merged/doc/code variants so `denseVectorMode` can target them.

## 3) `index_state.json` requirements

When embeddings are enabled (either inline or via service), `index_state.json` MUST include:

```ts
embeddings: {
  enabled: boolean;
  ready: boolean;
  pending?: boolean;
  mode?: string | null;                 // inline | service | off
  service?: boolean;
  lastError?: string | null;

  embeddingIdentity?: object | null;
  embeddingIdentityKey?: string | null;

  dims?: number | null;
  metric?: string | null;
  scale?: number | null;

  backends?: {
    hnsw?: { enabled: boolean; available: boolean; target?: string|null; dims?: number|null; count?: number|null };
    lancedb?: { enabled: boolean; available: boolean; target?: string|null; dims?: number|null; count?: number|null };
    sqliteVec?: { enabled: boolean; available: boolean; dims?: number|null; count?: number|null };
  };

  missing?: {
    codeMissing: number; docMissing: number; mergedMissing: number;
    total: number;
    rate: number;                        // 0..1
  };

  reason?: string | null;
}
```

## 4) Quantization invariants

Stage 3 synchronizes produced vectors into every manifest bundle, including late
and sharded files. It does not repeat stage 1's extraction-yield admission test.
Coverage metadata counts examined, unexamined and invalid bundles separately;
missing or unknown coverage remains incomplete, preserving the existing SQLite
artifact fallback. Eligible/covered counts describe observed nonempty bundles,
so a zero denominator alone cannot certify the entire manifest.

For uint8 embeddings:
- `levels` MUST be clamped to `[2, 256]`
- emitted vectors MUST only contain values in `[0, 255]` (no wrap)
- dequantization MUST use the same `(minVal, maxVal, levels)` used for quantization
- clamping indicates the embedding cache may be stale; clear the embeddings cache before rebuilding

## 5) ANN backend behavior

### 4.1 Similarity contract

Backends MUST return a list of `{ idx, sim }` where:
- higher `sim` is better
- `sim` is comparable across candidates within a backend

Recommended mappings:
- cosine: `sim = 1 - distance`
- l2: `sim = -distance`
- inner product: backend-specific; must be documented and tested

### 4.2 Candidate filtering

When a candidate set is provided:
- the backend MUST return up to `topN` results from within the candidate set
- if pushdown filtering is not available, the backend MUST over-fetch deterministically until it can fill `topN` or reaches a documented cap

## 6) Service job scoping

Embedding jobs run via `indexer-service` MUST include `buildRoot` and `indexDir`:
- `buildRoot` is the base build directory passed to `build-embeddings` via `--index-root`.
- `indexDir` is the per-mode directory (used for validation/logging).

Jobs must include `embeddingPayloadFormatVersion` and must not reuse ambiguous legacy fields without explicit upgrade logic + warning.

The worker MUST refuse to run if `buildRoot` does not exist and should treat `indexDir` as invalid if it is outside `buildRoot` (path escape).

## 7) Strict manifest compliance

Strict tooling must only discover artifacts via `pieces/manifest.json`. Non-strict fallback is allowed only when explicitly enabled and must emit a warning. See `docs/contracts/public-artifact-surface.md` and `docs/specs/artifact-schemas.md` for the current manifest-first artifact contract.

## 8) Embeddings throughput KPI gate

- `tests/indexing/embeddings/embedding-batch-throughput.test.js` enforces a hard minimum throughput KPI from the benchmark output emitted by `tools/bench/embeddings/embedding-batch-throughput.js`.
- The test runs the benchmark with `--providers stub` and deterministic timing via `--stub-batch-ms`, then parses the existing `[bench] ... throughput=<n>/s` line.
- Minimum allowed throughput is configurable with `PAIROFCLEATS_TEST_EMBEDDING_MIN_THROUGHPUT` (default: `4500` for the deterministic test scenario).
- If observed throughput drops below the configured threshold, the test fails and blocks CI lanes that include `indexing/embeddings/embedding-batch-throughput`.

## 9) Throughput tuning defaults (batching/reuse)

- Stage3 embedding dispatch now uses token-aware batching in addition to item-count batching.
- `indexing.embeddings.maxBatchTokens` can hard-cap token volume per batch; when unset, it is derived from `batchSize * batchTokenMultiplier` (default multiplier `256`).
- `indexing.embeddings.charsPerToken` controls token estimation for batching (default `4` chars/token).
- Text reuse cache can persist across runs with `indexing.embeddings.persistentTextCache` (default `true`) and `indexing.embeddings.persistentTextCacheMaxEntries` (default `500000`).
- Per-model profile-guided defaults are written under `<repoCacheRoot>/metrics/embeddings-autotune.json` and can influence batch size, token budget, and file parallelism when no explicit value is configured.
