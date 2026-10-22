# Embeddings Contract Notes (Phases 7+)

Status: Contract notes for implementation and validation. This document complements:
- `docs/contracts/indexing.md` (stage semantics)
- `docs/contracts/public-artifact-surface.md` (manifest-first, strict discovery)
- `docs/contracts/sqlite.md` (SQLite stage expectations)

## 1) Identity and compatibility

Model downloads publish a verified ONNX graph and its referenced external tensor
files as one immutable installation. The logical target has a bounded selector
file (`.pairofcleats-model.json`) admitting a complete generation under its
`.assets` directory. Runtime selection verifies the receipt, relative paths and
file identities. Interrupted copies cannot replace the active selection. Prior
generations are retained so existing readers keep their complete closure; this
does not establish a whole-cache quota or reader-aware garbage collection policy.

Embedding subprocess progress uses independent bounded stdout/stderr decoders.
Forwarded callbacks receive `(line, metadata)` with stream, truncation and retained
byte information. Truncated lines are diagnostic text and cannot become parsed
progress events. Terminal child evidence keeps both streams separate, and final
partial-line callback failures remain secondary to a failed child outcome.

The `xenova` provider uses `@huggingface/transformers` 4.x. Its public provider
name and model IDs (including `Xenova/all-MiniLM-L12-v2`) remain unchanged.
Existing generic model downloads and inference explicitly select `dtype: 'q8'`, preserving existing
`onnx/model_quantized.onnx` caches rather than silently switching Node inference
to full-precision weights. The `onnx` provider uses the same tokenizer package.
See the upstream [dtype migration guide](https://huggingface.co/docs/transformers.js/guides/dtypes).

Verified artifact identity establishes the selected bytes, not numerical
invariance across batch shapes. The bounded CPU qualification for
`Xenova/all-MiniLM-L6-v2` found a q8 batch/single difference reproduced by direct
native inference; its fp32 export passed the unchanged consistency gate. See the
[qualified scope and measurements](../archived/embedding-audit-repairs-2026-10-12.md).
Model precision defaults are unchanged.

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

Identity version 5 includes `vectorValidityVersion: 1`. Each dense channel carries
a versioned validity bitset, independently of its fixed-width binary padding.
Missing channels keep their document ordinals but never enter dense, HNSW,
LanceDB or SQLite ANN scoring. Actual zero and small nonzero vectors remain
valid; byte values alone do not establish absence. Backend counts describe
inserted valid rows; `rowCount` describes the full ordinal space.

Inline embedding runtimes verify reusable model provenance before selecting
cache identities. An unavailable local artifact set fails with
`ERR_EMBEDDING_ARTIFACT_UNVERIFIED` and must be acquired before retrying.
Embedding-disabled and service-only stages do not initialize or validate inactive
model execution requirements. An explicit ONNX path must select a readable,
nonempty regular graph; a missing explicit path cannot fall back to another model.

Prefetch and inference share the same revision, precision and text-only component
plan. Qualified readiness verifies the acquisition receipt and its required local
components without running inference. Shared text encoders serialize admitted
queries and prepared batches; queued cancellation does not evict a healthy warm
adapter. Runtime and daemon owners release their embedding leases during teardown.

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

## Model identity and execution handoffs

Embedding identity version 4 records verified local weight/tokenizer/config content,
qualified immutable revisions, or an explicit unknown artifact policy. Replacing
weights or tokenizer files at the same model ID/path invalidates persistent reuse.
A fresh lazy model load may produce vectors with unknown artifact provenance;
those outputs belong to one attempt and cannot authorize persistent cache reuse or
cross-run dense compatibility. Once supported model downloads make the artifacts
available, rebuild to select a verified identity. Sparse search and off/stub modes
remain available. Older embedding identities require a rebuild.

ONNX execution plans use version 2. Submission resolves ONNX environment/config
precedence once; adapters consume that canonical configuration without re-reading
the execution process environment. Private prewarm text is excluded from handoffs.
All adapters sharing a native ONNX session use one run queue. Input tensors own
separate storage until inference settles; disposing an adapter drains its work and
releases its session ownership without closing another adapter's active session.

Stage3 records its drained writer snapshot in `build_state.json` before readiness,
and returns the same snapshot in its summary. Bundle refresh reads verified
manifest-bound immutable snapshots and publishes replacement references last.
Failed manifest publication preserves the preceding readable snapshot. Canonical
relative POSIX source keys bind fallback groups, work ledgers and vector scatter.

Semantic content identity uses a versioned projection. Credentials, logging,
cache locations, scheduling/memory knobs and raw stage selection are execution
provenance. Actual resolved stage analysis settings remain semantic inputs.

## Memory admission and isolated CPU tasks

Automatic memory decisions use one source that combines host RAM, container
constraints, available headroom and configured limits. Scheduler pressure,
worker heaps/cache/write budgets and embedding sizing consume that authority.
Text/vector reuse is bounded by estimated retained bytes; writer queue statistics
separately report waiting producer bytes and encoding reservations. Cache payloads
reserve count/bytes before encoding and keep encoding outside the I/O critical
section. Estimates describe owned storage; measured RSS remains a separate fact.

`indexing.workerPool.processFallback` defaults to `false`. When explicitly enabled,
a rejected Worker startup heap contract can select a bounded child-process
backend for the existing tokenizer/quantizer tasks. Normal Worker execution and
safe inline fallback remain available. Each child receives its own startup heap
flags without mutating the parent's environment. Dictionary copies, parent
buffers, IPC input/output reservations and prospective child memory share one
aggregate budget. Cancellation, task identity fencing, bounded restart and joined
process-tree teardown use the existing task/lifecycle owners. Receipts distinguish
process startup old-space requests, measured V8 total heap and sampled RSS.
Default enablement requires the focused lifecycle/resource acceptance and a
representative CPU-work receipt; synthetic task overlap is not a production speedup.

The existing provider throughput benchmark now emits initialization, provider
interval, queue wait, padded-work and execution observations. Linux receipts also
include process thread IDs and per-thread CPU ticks before initialization and
inference and afterward. Thread ownership attribution is explicitly unknown
unless independently established. Its fixed-small-string workload is not a
representative corpus, and it does not exercise the Stage3 writer. Tiny Stage3
runtime receipts supply the writer encoding/I/O intervals and packing facts.
Real-model measurements run only after correctness acceptance; no throughput or
neural quality result is inferred from mocked sessions or fixed stub timing.

The provider benchmark reads the existing model-directory and ONNX configuration
owners, including `PAIROFCLEATS_MODELS_DIR`. An explicitly requested unavailable
provider exits with failure. Warmup and measured sweeps release their adapter
leases through the same cleanup path. Cancellation stops waiting/admitted writer
encoding before allocation; terminal Stage3 cleanup drains owned writers and
records failure state with the current attempt even after ordinary admission
has stopped.
