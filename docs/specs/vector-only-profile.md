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
