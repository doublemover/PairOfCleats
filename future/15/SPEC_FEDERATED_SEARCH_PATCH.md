# SPEC_FEDERATED_SEARCH_PATCH.md — Patch for `docs/specs/federated-search.md`

This patch removes ambiguity and closes a security footgun around `workspacePath`, and clarifies path redaction defaults for API/MCP.

Apply as a **spec update** (recommended: bump spec version to 1.1 in the header).

---

## 1) API request: prefer `workspaceId`, constrain `workspacePath`

### Replace §5.2 “Request body (v1)” with:

#### 5.2 Request body (v1.1)

```json
{
  "workspace": {
    "workspaceId": "dev",                        // preferred, server-mapped
    "workspacePath": "/abs/path/...jsonc"        // optional, only if allowlisted
  },
  "query": "risk:sql injection",
  "search": {
    "mode": "all",
    "top": 10,
    "backend": "auto",
    "filter": null,
    "compact": true,
    "stats": false
  },
  "select": {
    "repos": ["poc", "svc-a"],
    "tags": ["service"],
    "repoFilter": ["svc-*"],
    "includeDisabled": false
  },
  "merge": { "strategy": "rrf", "rrfK": 60 },
  "limits": { "perRepoTop": 20, "concurrency": 4 },
  "debug": {
    "includePaths": false
  }
}
```

Rules:

- The request MUST provide **either** `workspace.workspaceId` **or** `workspace.workspacePath`.
- If `workspace.workspacePath` is used, the API layer MUST validate it against an allowlist policy (see §5.3 below). Do not accept arbitrary filesystem paths.
- `debug.includePaths` defaults to `false`. When false, the server MUST avoid returning absolute filesystem paths in the response (repo roots, workspace paths).

### Add a new section after §5.2:

#### 5.3 Workspace path allowlisting (required)

Because `workspacePath` is an absolute filesystem path, API servers MUST prevent path probing:

- Preferred: configure a server-side mapping `{ workspaceId -> workspacePath }` and accept only `workspaceId`.
- If accepting `workspacePath`, require **both**:
  1. `workspacePath` resides under one of `ALLOWED_WORKSPACE_ROOTS`, and
  2. the file exists and is readable.

If allowlisting fails, return:

- `ok=false`, `code="ERR_WORKSPACE_PATH_NOT_ALLOWED"`.

Note: repo-root allowlisting still applies for **every** repo root selected from the workspace file.

---

## 2) Response: redact absolute paths by default in API/MCP

### Update §10.1 response `meta.workspace` to:

- CLI MAY include `workspacePath`.
- API/MCP SHOULD omit it unless `debug.includePaths=true`.

Recommended shape:

```ts
workspace: {
  name: string,
  workspaceId?: string,          // if provided in request
  workspacePath?: string         // only when includePaths=true
}
```

### Update §8.6 to explicitly forbid per-hit absolute paths

Replace the last paragraph of §8.6 with:

> Every output hit MUST include `repoId`, `repoAlias`, and `globalId`.  
> Absolute filesystem paths (repo roots, workspace paths) MUST NOT be included per-hit.  
> If paths are returned at all, they may appear only in diagnostics / repo metadata and only when `debug.includePaths=true`.

---

## 3) Coordinator meta: record cohorting without leaking paths

In §10.1, ensure `meta.selection.selectedRepos` is **path-free** by default:

- include `{ repoId, alias, priority, enabled }`
- exclude `repoRootCanonical` unless debug.includePaths=true

---

## 4) Tests to add alongside the spec update

- `tests/api/federated-search-workspace-allowlist.test.js`
  - rejects workspacePath not under allowlisted roots
- `tests/api/federated-search-redacts-paths.test.js`
  - when includePaths=false, response omits workspacePath and repoRootCanonical
