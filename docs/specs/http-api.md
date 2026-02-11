# HTTP API spec (Phase 14.6 + Phase 15.3)

## Status

- **Spec version:** 1
- **Audience:** PairOfCleats contributors implementing HTTP surfaces for snapshots, diffs, as-of search, and federated search.
- **Implementation status:** planned.

This document defines API behavior only. CLI/MCP routes may expose the same semantics, but the HTTP contract here is authoritative for request/response shape, path redaction, and error behavior.

---

## 1. Security and safety invariants

1. Absolute paths are redacted by default.
2. Every repo path must pass allowlist checks before any file access.
3. Explicit refs/roots never silently fallback to `latest`/`current`.
4. Structured errors always include `code`, `message`, and `details` when available.

---

## 2. Shared conventions

### 2.1 Content types

- Request: `application/json`
- Response: `application/json`
- Stream endpoint (`events`): `application/x-ndjson`

### 2.2 Error envelope

```json
{
  "ok": false,
  "error": {
    "code": "ERR_CODE",
    "message": "Human readable error",
    "details": {}
  }
}
```

### 2.3 Common error codes

- `ERR_INVALID_REQUEST`
- `ERR_UNAUTHORIZED_REPO_ROOT`
- `ERR_INDEX_REF_INVALID`
- `ERR_INDEX_REF_NOT_FOUND`
- `ERR_INDEX_REF_MISSING_ARTIFACTS`
- `ERR_FEDERATED_REPO_FLAG_NOT_ALLOWED`
- `ERR_FEDERATED_MULTI_COHORT`
- `ERR_SNAPSHOT_CREATE_VALIDATION_REQUIRED`
- `ERR_DIFF_INPUT_MISMATCH`

---

## 3. Search endpoints

### 3.1 `GET /search`

Single-repo search with optional as-of targeting.

#### Query params

- `q` (required): query text
- `repo` (optional): repo root/path token
- `asOf` (optional): canonical IndexRef (`latest|build:<id>|snap:<id>|tag:<tag>|path:<path>`)
- existing search knobs (`mode`, `top`, `backend`, `filter`, `stats`, etc.)

#### Rules

- If `asOf` is present and explicit, missing artifacts must fail with `ERR_INDEX_REF_MISSING_ARTIFACTS`.
- No silent fallback from explicit `asOf`.

#### Success envelope

```json
{
  "ok": true,
  "asOf": {
    "ref": "snap:snap-20260211-120000-abc123",
    "type": "snapshot",
    "identityHash": "a1b2c3d4",
    "summary": {}
  },
  "results": {
    "backend": "sqlite",
    "code": [],
    "prose": [],
    "records": []
  }
}
```

### 3.2 `POST /search/federated`

Federated workspace search.

#### Request body

- `workspaceId` (preferred) or `workspacePath` (allowlisted)
- `query` (required)
- `search` (mode/top/backend/filter/etc)
- `select` (`repos`, `tags`, `repoFilter`, `includeDisabled`)
- `merge` (`strategy`, `rrfK`)
- `limits` (`perRepoTop`, `concurrency`)
- `cohort` policy (`strict`, explicit key, `allowUnsafeMix`)

#### Response requirements

- Always include `repoSetId`, `manifestHash`, cohort selection summary, and per-repo diagnostics.
- Every hit includes `repoId`, `repoAlias`, `globalId`.

---

## 4. Snapshot endpoints

### 4.1 `GET /index/snapshots`

- Returns deterministic list sorted by `(createdAt desc, id asc)`.

### 4.2 `GET /index/snapshots/:id`

- Returns one snapshot record.

### 4.3 `POST /index/snapshots`

Request:

```json
{
  "label": "release-candidate",
  "tags": ["release"],
  "modes": ["code", "prose"]
}
```

Rules:

- Snapshot creation requires successful validation for selected modes.
- Missing/false validation fails (`ERR_SNAPSHOT_CREATE_VALIDATION_REQUIRED`).

---

## 5. Diff endpoints

### 5.1 `GET /index/diffs`

- Deterministic list sorted by `(createdAt desc, id asc)`.

### 5.2 `GET /index/diffs/:id`

- Returns `inputs.json` + `summary.json` view.

### 5.3 `GET /index/diffs/:id/events`

- Streams NDJSON from `events.jsonl`.
- Must preserve deterministic ordering from stored artifact.

---

## 6. Path redaction contract

### 6.1 Default behavior

- API responses never include absolute filesystem paths.
- Persisted artifacts also never include absolute paths.

### 6.2 Debug override

- `debug.includePaths=true` may include paths only for authorized callers.
- Even in debug mode, persisted artifacts remain redacted.

---

## 7. Determinism and caching

1. JSON output keys are stable in API serializers.
2. Federated responses include enough metadata for deterministic cache keying:
   - `repoSetId`, `manifestHash`, `selectedRepoIds`, cohort result, effective backend decisions.

---

## 8. Implementation touchpoints

- `tools/api/router/search.js`
- `tools/api/router/index-snapshots.js` (new)
- `tools/api/router/index-diffs.js` (new)
- `tools/api/validation.js`
- `src/retrieval/federation/coordinator.js` (new)
- `src/index/index-ref.js` (new)

---

## 9. Required tests

- `tests/api/search-asof-explicit-no-fallback.test.js`
- `tests/api/search-redacts-paths-default.test.js`
- `tests/api/federated-search-workspace-allowlist.test.js`
- `tests/api/federated-search-redacts-paths.test.js`
- `tests/api/index-diff-events-stream-contract.test.js`
- `tests/api/index-snapshot-create-validation-required.test.js`
