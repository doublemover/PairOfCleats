# Embeddings Contract Notes (Phases 7+)

Status: Contract notes for implementation and validation. This document complements:
- `docs/contracts/indexing.md` (stage semantics)
- `docs/contracts/public-artifact-surface.md` (manifest-first, strict discovery)
- `docs/contracts/sqlite.md` (SQLite stage expectations)

## 1) Identity and compatibility

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

## 2) `index_state.json` requirements

When embeddings are enabled (either inline or via service), `index_state.json` MUST include:

```ts
embeddings: {
  enabled: boolean;
  ready: boolean;
  pending?: boolean;
  mode?: string | null;                 // inline | service | off
  service?: boolean;

  embeddingIdentity?: object | null;
  embeddingIdentityKey?: string | null;

  dims?: number | null;
  metric?: string | null;
  scale?: number | null;

  backends?: {
    hnsw?: { present: boolean; dims?: number|null; space?: string|null };
    lancedb?: { present: boolean; dims?: number|null; metric?: string|null };
    sqlite?: { present: boolean; dims?: number|null };
  };

  missing?: {
    codeMissing: number; docMissing: number; mergedMissing: number;
    total: number;
    rate: number;                        // 0..1
  };

  reason?: string | null;
}
```

## 3) Quantization invariants

For uint8 embeddings:
- `levels` MUST be clamped to `[2, 256]`
- emitted vectors MUST only contain values in `[0, 255]` (no wrap)
- dequantization MUST use the same `(minVal, maxVal, levels)` used for quantization

## 4) ANN backend behavior

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

## 5) Service job scoping

Embedding jobs run via `indexer-service` MUST include `indexRoot` and the worker MUST pass `--index-root` to `build-embeddings`. The worker MUST refuse to run if the target build root does not exist.

