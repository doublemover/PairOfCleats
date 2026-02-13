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
