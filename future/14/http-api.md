# SPEC -- Phase 14: HTTP API Surface for Snapshots, Diffs, and As‑Of Search (Draft)

> STATUS (2026-02-03): Draft spec only. Phase 14 is not implemented in the repo.
> Treat `GIGAROADMAP_2.md` (Phase 14) as authoritative. There is no
> `docs/specs/http-api.md` yet; if HTTP endpoints are required, create that
> spec first and update this draft after.

> **Scope**: Optional HTTP endpoints to expose Phase 14 snapshot/diff/time-travel functionality.
> This is intended for parity with UI/MCP use cases.
>
> **Non-goal**: this doc does not change the Phase 14 CLI-first contract. The HTTP API should reuse
> the exact same internal modules (IndexRef resolver, snapshot registry, diff engine).

---

## 0. Design constraints (required)

1. **Allowed repo roots**  
   All endpoints that accept a repo path MUST enforce `allowedRepoRoots` (existing API router behavior).

2. **No absolute paths**  
   Responses MUST NOT include absolute filesystem paths. Any persisted path fields MUST be repo-cache-relative.

3. **Deterministic semantics**  
   Endpoints that accept an `asOf`/IndexRef MUST normalize it to canonical form and return the canonical string.

4. **Thin wrapper**  
   HTTP routes should call the same internal functions the CLI uses. Avoid forking logic.

---

## 1. Extend existing /search endpoint with as-of

### 1.1 Request
`POST /search`

Add optional field:
- `asOf: string` — IndexRef (e.g., `latest`, `build:<id>`, `snap:<id>`, `tag:<tag>`)

Example:
```json
{
  "repoPath": "/abs/path/to/repo",
  "query": "foo bar",
  "mode": "code",
  "backend": "auto",
  "top": 10,
  "asOf": "snap:snap-20260124010101-acde12"
}
```

### 1.2 Behavior
- If `asOf` is omitted: identical to current behavior.
- If provided: pass through to the underlying search runner as `--as-of <IndexRef>`.

### 1.3 Response shape
Keep the existing envelope:
```json
{
  "ok": true,
  "repo": "/abs/path/to/repo",
  "result": { ... }
}
```

Recommendation:
- Include the resolved canonical `asOf` and `identityHash` in `result` if `--json` already emits it.
  (This should naturally happen once CLI output includes `asOf`.)

---

## 2. Snapshots endpoints (optional)

### 2.1 List snapshots
`GET /index/snapshots?repo=<repoPath>[&tag=<tag>]`

Response:
```json
{
  "ok": true,
  "repo": "/abs/path/to/repo",
  "snapshots": [
    {
      "snapshotId": "snap-...",
      "createdAt": "...",
      "kind": "pointer",
      "tags": ["release/v1.2.3"],
      "label": "optional",
      "hasFrozen": true
    }
  ]
}
```

### 2.2 Show snapshot
`GET /index/snapshots/<snapshotId>?repo=<repoPath>`

Response includes `snapshot.json` and `frozen.json` if present (no absolute paths).

### 2.3 Create snapshot
`POST /index/snapshots`

Request:
```json
{
  "repoPath": "/abs/path/to/repo",
  "modes": ["code", "prose"],
  "id": "snap-optional",
  "tags": ["release/v1.2.3"],
  "label": "optional",
  "notes": "optional"
}
```

Behavior:
- Equivalent to `pairofcleats index snapshot create` with matching args
- Must enforce validation gate (`build_state.json.validation.ok === true`)

### 2.4 Freeze snapshot
`POST /index/snapshots/<snapshotId>/freeze`

Request:
```json
{
  "repoPath": "/abs/path/to/repo",
  "method": "hardlink",
  "verify": true,
  "includeSqlite": "auto",
  "includeLmdb": false,
  "modes": ["code"]
}
```

Behavior:
- Equivalent to `pairofcleats index snapshot freeze`

---

## 3. Diffs endpoints (optional)

### 3.1 Compute diff
`POST /index/diffs`

Request:
```json
{
  "repoPath": "/abs/path/to/repo",
  "from": "snap:snap-...",
  "to": "build:20260124T000000Z_abcdef0_1234abcd",
  "modes": ["code"],
  "options": {
    "maxChangedFiles": 200,
    "maxChunksPerFile": 500,
    "maxEvents": 20000,
    "detectRenames": true,
    "includeRelations": true,
    "persist": true,
    "persistUnsafe": false
  }
}
```

Response:
```json
{
  "ok": true,
  "repo": "/abs/path/to/repo",
  "diffId": "diff_...",
  "persisted": true,
  "summary": { ... }   // contents of summary.json
}
```

Rules:
- If `from` or `to` is `path:`:
  - default `persist=false`
  - if `persistUnsafe=true`, persist but redact paths per diff spec

### 3.2 List diffs
`GET /index/diffs?repo=<repoPath>[&mode=<mode>]`

### 3.3 Get diff summary
`GET /index/diffs/<diffId>?repo=<repoPath>`

### 3.4 Stream diff events
`GET /index/diffs/<diffId>/events?repo=<repoPath>`

Response:
- `Content-Type: application/x-ndjson`
- Stream `events.jsonl` lines

---

## 4. Error handling

Use existing API error conventions:
- `ok: false`
- `code` from `ERROR_CODES`
- `message` human-readable
- optional `details`

For “no index” cases, keep existing behavior (`409 NO_INDEX`) as used by `/search`.

---

## 5. Security checklist

- Reject repos outside `allowedRepoRoots`
- Never return repoCacheRoot absolute paths
- Never persist raw `path:` values
- Consider rate limiting for compute-heavy endpoints (diff compute, snapshot freeze)
