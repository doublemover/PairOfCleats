# Spec: file_meta artifact (draft)

Status: Draft (Milestone A). Core indexing artifact.

Goal: store per-file metadata used by downstream tooling (language, sizes, paths, and derived stats) in a reusable, cacheable artifact.

Non-goals:
- Replace `file_manifest`.
- Change `file_meta` row schema (see `docs/specs/artifact-schemas.md`).
- Persist file contents.

---

## 1) Artifact names and formats

Logical name: `file_meta`

Emission forms:
- `file_meta.json` (unsharded)
- `file_meta.jsonl` or `file_meta.parts/*.jsonl` (sharded)
- `file_meta.columnar.json` (columnar, optional)

Manifest inventory:
- `file_meta` rows MUST be listed in `pieces/manifest.json`.
- `file_meta.meta.json` MUST accompany the artifact.

---

## 2) Cache reuse metadata (normative)

`file_meta.meta.json` MUST include a fingerprint and cache key:

```json
{
  "fingerprint": "<sha1>" ,
  "cacheKey": "pairofcleats:ck1:<hash>",
  "extensions": {
    "fingerprint": "<sha1>",
    "cacheKey": "pairofcleats:ck1:<hash>"
  }
}
```

Rules:
- The cache key MUST be generated with the unified cache-key schema.
- Schema tag: `file-meta-cache-v1`.
- Feature flags MUST include `format:<auto|jsonl|columnar>` and `columnarThreshold:<bytes>`.
- If the cache key matches, the `file_meta` artifact MAY be reused without recomputation.
- If the cache key is missing, fallback to `fingerprint` comparison.

---

## 3) Related specs

- `docs/specs/artifact-schemas.md`
- `docs/specs/cache-key-invalidation.md`
- `docs/specs/byte-budget-policy.md`
