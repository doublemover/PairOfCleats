# Vector-Only Profile Spec

## Status
- Spec version: 1
- Scope: index profile contract in `indexing.profile` and `index_state.json`

## Config
- `indexing.profile` supports:
  - `default` (baseline sparse + optional dense)
  - `vector_only` (dense-first profile)
- Unknown values are rejected.
- Default value is `default`.

## `index_state.json` contract additions
- `profile` block:
  - `profile.id`: `default | vector_only`
  - `profile.schemaVersion`: `1`
- `artifacts` block:
  - `schemaVersion`: `1`
  - `present`: map of artifact name -> boolean
  - `omitted`: sorted list of artifact names with `present[name] !== true`
  - `requiredForSearch`: profile-derived required artifact list

## Canonical example: `default`
```json
{
  "generatedAt": "2026-02-13T00:00:00.000Z",
  "artifactSurfaceVersion": "1.0.0",
  "mode": "code",
  "profile": {
    "id": "default",
    "schemaVersion": 1
  },
  "artifacts": {
    "schemaVersion": 1,
    "present": {
      "chunk_meta": true,
      "token_postings": true,
      "index_state": true,
      "filelists": true
    },
    "omitted": [],
    "requiredForSearch": ["chunk_meta", "token_postings", "index_state", "filelists"]
  }
}
```

## Canonical example: `vector_only`
```json
{
  "generatedAt": "2026-02-13T00:00:00.000Z",
  "artifactSurfaceVersion": "1.0.0",
  "mode": "prose",
  "profile": {
    "id": "vector_only",
    "schemaVersion": 1
  },
  "artifacts": {
    "schemaVersion": 1,
    "present": {
      "chunk_meta": true,
      "dense_vectors": true,
      "index_state": true,
      "filelists": true
    },
    "omitted": [],
    "requiredForSearch": ["chunk_meta", "dense_vectors", "index_state", "filelists"]
  }
}
```

## Compatibility and signatures
- Compatibility/cohort payloads include `profile.id` and `profile.schemaVersion`.
- Incremental signature payload includes `profile.id` and `profile.schemaVersion`.

## Build-time gating (`vector_only`)
- Tokenization/postings sparse emission paths are disabled.
- Sparse artifact denylist is strict for vector-only output:
  - `token_postings*`
  - `phrase_ngrams*`
  - `chargram_postings*`
  - `field_postings*`
  - `field_tokens*`
  - `vocab_order*`
  - `minhash_signatures*`
- Cleanup policy is allowlist-only:
  - only known sparse artifact filenames/directories in managed `outDir` may be removed
  - unknown files/directories are never recursively deleted
- Cleanup actions are recorded in build output under `index_state.extensions.artifactCleanup`.

## Embeddings requirement
- `vector_only` rejects builds when embeddings are explicitly disabled (`indexing.embeddings.enabled=false`).
- Missing doc embedding marker convention remains unchanged:
  - doc-missing marker is a shared zero-length typed array (`Uint8Array(0)`).

## Query-time routing policy (`vector_only`)
- Search loads profile policy from each selected mode before retrieval starts.
- For `vector_only` modes:
  - ANN-capable providers are selected by default.
  - Sparse providers are marked unavailable with explicit diagnostics (never silently treated as healthy).
- Sparse-only requests against `vector_only` are rejected by default:
  - controlled error code: `INVALID_REQUEST`
  - reasonCode: `retrieval_profile_mismatch`
  - guidance: re-run with ANN enabled or pass sparse fallback override.

## Sparse fallback override contract
- CLI: `--allow-sparse-fallback`
- API: `allowSparseFallback` query/body boolean
- MCP tool `search`: `allowSparseFallback` boolean
- Behavior:
  - only affects requests that explicitly force sparse-only behavior.
  - when set, sparse-only requests on `vector_only` are converted into ANN fallback instead of hard-failing.
  - override usage is surfaced as warnings in explain/stats output.

## Provider boundary checks and controlled errors
- Sparse providers declare required tables at provider boundary (`requireTables`).
- Missing sparse tables are reported as controlled capability errors, not runtime exceptions:
  - code: `CAPABILITY_MISSING`
  - reasonCode: `retrieval_sparse_unavailable`
- `vector_only` with ANN unavailable returns:
  - code: `CAPABILITY_MISSING`
  - reasonCode: `retrieval_vector_required`

## Explain and stats surface
- Explain stats include profile policy metadata under `stats.profile`:
  - `byMode[mode].profileId`
  - `byMode[mode].vectorOnly`
  - `warnings[]`
- Per-hit score breakdown includes sparse profile context:
  - `scoreBreakdown.sparse.indexProfile`

## Migration guide: legacy `index_state.json` shapes

Legacy indexes built before profile/artifact schema rollout may omit:
- `profile`
- `artifacts`

Read-time behavior:
- missing `profile` normalizes to:
  - `profile.id = "default"`
  - `profile.schemaVersion = 1`
- missing `artifacts` normalizes to schema-derived defaults for the resolved profile.
- a one-time compatibility warning is emitted per process when profile metadata is missing.

Recommended migration path:
1. Rebuild indexes with current tooling so profile/artifact blocks are materialized on disk.
2. Avoid long-term `--allow-unsafe-mix` use; align all active modes/repositories to one profile cohort before removing overrides.

## Optional vector-only analysis shortcuts (build-time)

`indexing.vectorOnly` supports optional shortcut flags:
- `disableImportGraph` (default `true` when `profile=vector_only`)
- `disableCrossFileInference` (default `true` when `profile=vector_only`)

Behavior:
- These only apply to `profile=vector_only`.
- Set either flag to `false` to opt out and keep the corresponding analysis pass enabled.

Build-report transparency:
- Build state records per-mode shortcut choices under `analysisShortcuts[mode]`.
- `index_state.json` records resolved shortcut choices under `features.vectorOnlyShortcuts`.
