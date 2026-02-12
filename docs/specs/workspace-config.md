# Workspace configuration spec (Phase 15.1)

## Status

- **Spec version:** 1 (schemaVersion = 1)
- **Audience:** PairOfCleats contributors implementing workspace/federation support (CLI/API/MCP).
- **Primary goals:** deterministic repo identity, canonical repo roots, stable `repoSetId`, strict validation.

This spec is written to be *implementation-ready* in the existing PairOfCleats Node/ESM codebase.

---

## 1. Goals and non-goals

### 1.1 Goals

1. Define a **workspace configuration file** that enumerates multiple repositories.
2. Resolve each repo entry to a **canonical repo root**:
   - must resolve subdirectories to the repo root (via existing repo-root detection),
   - should resolve symlinks when possible (realpath),
   - must normalize Windows casing consistently.
3. Compute:
   - a stable `repoId` for each repo,
   - a stable `repoSetId` for the workspace's repo membership (order-independent),
   - an optional `workspaceConfigHash` (for debugging and cache keys).
4. Provide strict, deterministic validation with actionable errors.

### 1.2 Non-goals (explicitly out of scope for schemaVersion=1)

- Discovering repos via a global catalog/registry (workspace file enumerates explicit roots).
- Per-repo **index build** overrides (e.g., modes list, ignore overrides, model overrides).
- SCM provider configuration keys (defined in `docs/config/contract.md` and Phase 13 specs).
- Automatically finding a workspace file by walking up directories (workspace path is supplied explicitly).
- Cross-machine stable repo identity (e.g., Git remote-based identity). Identity is **path-based**.

### 1.3 External config dependencies (not in this file)

Workspace config does **not** carry SCM provider settings; those live in the main config surface:

- `indexing.scm.provider`
- `indexing.scm.timeoutMs`
- `indexing.scm.maxConcurrentProcesses`
- `indexing.scm.churnWindowCommits`
- `indexing.scm.annotate.enabled`
- `indexing.scm.annotate.maxFileSizeBytes`
- `indexing.scm.annotate.timeoutMs`
- `indexing.scm.jj.snapshotWorkingCopy`

See `docs/config/contract.md` for authoritative config descriptions.

---

## 2. Canonical terms

- **Workspace file**: the JSONC document described here.
- **workspacePath**: absolute path to the workspace file on disk.
- **workspaceDir**: directory containing the workspace file.
- **Repo entry (input)**: a member of `repos[]` as written in the workspace file.
- **repoRootResolved**: the resolved repo root returned by PairOfCleats repo-root detection.
- **repoRootCanonical**: `repoRootResolved` after realpath/case normalization; used for identity comparisons and hashing.
- **repoId**: a stable local identifier derived from `repoRootCanonical`.
- **repoSetId**: a stable identifier for the workspace membership set (order-independent, excludes display metadata).

---

## 3. File format and parsing

### 3.1 Recommended filename

The tool **MUST** accept an explicit workspace file path (CLI/API/MCP). For convention, recommend:

- `.pairofcleats-workspace.jsonc`

Rationale:
- Consistent with `.pairofcleats.json` and `.pairofcleatsignore`.
- JSONC enables comments and trailing commas without breaking strictness.

### 3.2 JSONC parsing rules

- Parse with `src/shared/jsonc.js` (`readJsoncFile` / `parseJsoncText`), with:
  - comments allowed,
  - trailing commas allowed,
  - empty file is an error.

**Root value MUST be a JSON object**, not an array.

---

## 4. Schema (schemaVersion = 1)

### 4.1 Top-level structure

| Field | Type | Required | Default | Meaning |
|---|---:|---:|---:|---|
| `schemaVersion` | integer | yes | -- | Must be `1`. |
| `name` | string | no | `""` | Human-friendly name; not identity-bearing. |
| `cacheRoot` | string \| null | no | `null` | Preferred **federation artifacts** root. Does **not** override per-repo cache roots. |
| `defaults` | object | no | `{}` | Defaults applied to repo entries when fields are omitted. |
| `repos` | array | yes | -- | Repo entry list. Must be non-empty. |

### 4.2 `defaults` object

| Field | Type | Required | Default | Notes |
|---|---:|---:|---:|---|
| `enabled` | boolean | no | `true` | Default enabled state for repos. |
| `priority` | integer | no | `0` | Higher priority sorts earlier in display ordering (not identity-bearing). |
| `tags` | array[string] | no | `[]` | Tags for selection. Normalized (see §5.4). |

### 4.3 Repo entry (input) object

| Field | Type | Required | Default | Meaning |
|---|---:|---:|---:|---|
| `root` | string | yes | -- | Path to repo directory. Relative paths are resolved from `workspaceDir`. |
| `alias` | string \| null | no | `null` | Human-friendly stable label; must be unique (case-insensitive). |
| `enabled` | boolean | no | `defaults.enabled` | Excluded by default from "all repos" selection; explicit selection may still include. |
| `priority` | integer | no | `defaults.priority` | Display/merge tie-breaker (after rank). |
| `tags` | array[string] | no | `defaults.tags` | Tags for selection. |

---

## 5. Validation and normalization

### 5.1 Validation phases

Implementation **MUST** validate in three phases:

1. **Parse validation**: valid JSONC, root object.
2. **Shape validation**: required keys, basic types, no unknown keys.
3. **Semantic validation**: uniqueness constraints, path canonicalization, repo-root resolution.

If multiple errors occur, return them all (best-effort), but:
- if parsing fails, return only the parse error.

### 5.2 Strict keys (no unknown keys)

Unknown keys at any object level **MUST** hard-fail.

This aligns with existing config philosophy (unknown keys are an error to prevent silent drift).

### 5.3 Path resolution rules

For each repo entry:

1. Resolve `rootInput`:
   - If `root` is absolute: `rootAbs = root`
   - Else: `rootAbs = path.resolve(workspaceDir, root)`
2. `rootAbs` **MUST exist on disk** (`fs.existsSync(rootAbs)`), else error:
   - `ERR_WORKSPACE_REPO_ROOT_NOT_FOUND`
3. `rootAbs` **MUST be a directory** (`fs.statSync(rootAbs).isDirectory()`), else error:
   - `ERR_WORKSPACE_REPO_ROOT_NOT_DIRECTORY`
4. Resolve repo root (not subdir):
   - `repoRootResolved = resolveRepoRoot(rootAbs)`
   - `repoRootResolved` **MUST** be a non-empty string and **MUST exist**.
5. Canonicalize:
   - `repoRootCanonical = toRealPath(repoRootResolved)` (see §5.5)
   - `repoRootCanonical` **MUST** be non-empty.

Notes:
- `root` must point at a directory (repo root or subdirectory inside the repo).
- If `resolveRepoRoot` returns the input path unchanged but that is not an actual repo root (no `.git` / no `.pairofcleats.json` found), this is still acceptable for schemaVersion=1. The repo is treated as a "directory repo" rooted at that path.

### 5.4 String normalization

To guarantee deterministic matching and avoid cross-platform surprises:

- `alias` is normalized as:
  - trim whitespace,
  - if empty → `null`,
  - comparisons are **case-insensitive** on *all* platforms (store a `aliasKey = alias.toLowerCase()` for uniqueness).
- `tags` entries are normalized as:
  - coerce to string, trim,
  - drop empty strings,
  - normalize to lowercase,
  - deduplicate,
  - sort ascending (stable for hashing and deterministic output).

### 5.5 Realpath and Windows casing

Implement the following helpers, consistent with `tools/api/router.js` behavior:

```js
function normalizePath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function toRealPath(value) {
  try {
    const real = fs.realpathSync.native ? fs.realpathSync.native(value) : fs.realpathSync(value);
    return normalizePath(real);
  } catch {
    return normalizePath(value);
  }
}
```

**repoRootCanonical MUST be computed using `toRealPath(repoRootResolved)`**.

### 5.6 Uniqueness constraints

The loader **MUST** reject:

1. Duplicate canonical roots:
   - if two entries produce the same `repoRootCanonical`.
   - Error: `ERR_WORKSPACE_DUPLICATE_REPO_ROOT`
2. Duplicate `repoId`:
   - extremely unlikely, but treated as fatal.
   - Error: `ERR_WORKSPACE_DUPLICATE_REPO_ID`
3. Duplicate aliases (case-insensitive):
   - Error: `ERR_WORKSPACE_DUPLICATE_ALIAS`

### 5.7 `repoId` derivation

Use existing `getRepoId(repoRootCanonical)` from `tools/shared/dict-utils.js`.

Constraints:
- `repoId` MUST be computed from **canonical** roots (not the raw `root` input).
- `repoId` MUST be treated as an opaque string.

### 5.8 `repoSetId` derivation

`repoSetId` represents the *membership set* and MUST be:

- deterministic,
- order-independent,
- independent of display-only fields (name, alias, tags, priority, enabled).

Algorithm:

1. Build `identityList`:

```js
identityList = reposResolved
  .map(r => ({ repoId: r.repoId, repoRootCanonical: r.repoRootCanonical }))
  .sort((a, b) => a.repoId.localeCompare(b.repoId));
```

2. Compute:

```js
const payload = { v: 1, schemaVersion: 1, repos: identityList };
repoSetId = 'ws1-' + sha1(stableStringify(payload));
```

Where:
- `stableStringify` is `src/shared/stable-json.js`
- `sha1` is `src/shared/hash.js`

The `ws1-` prefix is required to:
- make logs self-describing,
- reduce accidental mixing with other SHA-1 ids.

### 5.9 Optional `workspaceConfigHash`

For diagnostics (and potentially caching), compute:

```js
const normalizedConfig = {
  schemaVersion: 1,
  name: (typeof name === 'string' ? name.trim() : ''),
  cacheRoot: cacheRootResolvedOrNull, // see §6.2
  defaults: normalizedDefaults,
  repos: reposResolved.map(r => ({
    root: r.repoRootCanonical,
    alias: r.alias,
    enabled: r.enabled,
    priority: r.priority,
    tags: r.tags
  })).sort(by repoId)
};

workspaceConfigHash = 'wsc1-' + sha1(stableStringify(normalizedConfig));
```

Notes:
- This hash is *not* used for repo membership identity. It intentionally changes when tags/enabled/priority change.
- It is allowed to omit `workspaceConfigHash` entirely in v1 if not needed.

---

## 6. Runtime output structure

The loader returns this **canonical runtime object**:

```ts
type WorkspaceConfigResolvedV1 = {
  schemaVersion: 1,
  workspacePath: string,          // absolute path
  workspaceDir: string,           // dirname(workspacePath)
  name: string,                   // trimmed, may be ""
  cacheRoot: string | null,        // raw field, resolved in §6.2 (for federation artifacts)
  defaults: {
    enabled: boolean,
    priority: number,
    tags: string[],
  },
  repos: Array<{
    // identity-bearing
    repoId: string,
    repoRootResolved: string,
    repoRootCanonical: string,

    // display/selection
    alias: string | null,
    tags: string[],
    enabled: boolean,
    priority: number,

    // provenance
    rootInput: string,            // original value from file
    index: number,                // original position in file (for diagnostics only)
  }>,

  repoSetId: string,              // ws1-<sha1>
  workspaceConfigHash?: string,   // wsc1-<sha1> (optional)
};
```

### 6.1 Deterministic ordering rules

- `repos[]` in the resolved object SHOULD preserve the original file order for UI friendliness.
- Any identity-bearing operation MUST sort by `repoId` first (e.g., hashing).
- Any display ordering SHOULD use:
  1. higher `priority`,
  2. then `alias` (if present),
  3. then `repoId`.

### 6.2 Resolving `cacheRoot`

`cacheRoot` is the preferred root for **federation artifacts** (workspace manifest, federated query cache, etc.).

Rules:

- If `cacheRoot` is a non-empty string:
  - resolve to absolute path:
    - if absolute → use as-is,
    - else resolve relative to `workspaceDir`.
- If `cacheRoot` is `null` or empty:
  - leave as `null` in this module (resolution may occur in manifest generation):
    - manifest generation can choose a default (`getCacheRoot()`) or a derived value (see manifest spec).

This keeps the config loader side-effect free (no repo-cache discovery).

---

## 7. Errors (codes + required messages)

Errors MUST be thrown with `createError(ERROR_CODES.INVALID_REQUEST, message)` (or a workspace-specific error code set), and MUST include:

- `code`: a stable error identifier string,
- `message`: human-readable, action-oriented.

Required error codes:

| Code | When | Message requirements |
|---|---|---|
| `ERR_WORKSPACE_FILE_NOT_FOUND` | workspacePath missing | include absolute path |
| `ERR_WORKSPACE_PARSE_FAILED` | JSONC parse error | include parse error code and file |
| `ERR_WORKSPACE_ROOT_NOT_OBJECT` | root not object | specify expected object |
| `ERR_WORKSPACE_SCHEMA_VERSION` | schemaVersion missing/unsupported | include supported versions |
| `ERR_WORKSPACE_REPOS_EMPTY` | repos missing/empty | instruct to add at least one repo |
| `ERR_WORKSPACE_REPO_ROOT_NOT_FOUND` | repo `rootAbs` missing | include repo index + root |
| `ERR_WORKSPACE_REPO_ROOT_NOT_DIRECTORY` | repo `rootAbs` is not a directory | include repo index + root |
| `ERR_WORKSPACE_DUPLICATE_REPO_ROOT` | duplicate canonical root | include both entries |
| `ERR_WORKSPACE_DUPLICATE_REPO_ID` | repoId collision | include both entries |
| `ERR_WORKSPACE_DUPLICATE_ALIAS` | alias collision | include both entries + alias |

---

## 8. Implementation guidance (concrete)

### 8.1 Suggested module

Create `src/workspace/config.js` exporting:

- `loadWorkspaceConfig(workspacePath: string): WorkspaceConfigResolvedV1`
- `resolveRepoEntry(workspaceDir, entry, index): ResolvedRepoEntry`
- `computeRepoSetId(reposResolved): string`
- `computeWorkspaceConfigHash?(resolved): string` (optional)

### 8.2 Preferred existing helpers

Use these existing utilities:

- `readJsoncFile` -- `src/shared/jsonc.js`
- `stableStringify` -- `src/shared/stable-json.js`
- `sha1` -- `src/shared/hash.js`
- `resolveRepoRoot`, `getRepoId` -- `tools/shared/dict-utils.js`
- `createError`, `ERROR_CODES` -- `src/shared/errors.js` / `src/shared/error-codes.js` (or workspace-local errors)

---

## 9. Tests (must be automated)

Minimum required tests:

1. **Relative root resolution**: repo paths relative to workspaceDir resolve correctly.
2. **Subdir roots**: pointing at a subdir resolves to repo root via `resolveRepoRoot`.
3. **File roots rejected**: pointing `root` at a regular file fails with `ERR_WORKSPACE_REPO_ROOT_NOT_DIRECTORY`.
4. **Realpath dedupe**: two roots that differ only by symlink normalize to same canonical root → error.
5. **Windows case normalization**: `C:\Repo` and `c:\repo` dedupe (simulated via normalizePath).
6. **repoSetId determinism**:
   - same membership different order produces same repoSetId.
7. **Alias uniqueness**: case-insensitive.
8. **Tag normalization**: trims, lowercase, dedupe, sorted.

---

## 10. Example workspace file (JSONC)

```jsonc
{
  "schemaVersion": 1,
  "name": "PairOfCleats + Services",
  // Optional; relative values resolve from this file's directory.
  "cacheRoot": "../.poc-cache",

  "defaults": {
    "enabled": true,
    "priority": 0,
    "tags": ["active"]
  },

  "repos": [
    { "root": "../PairOfCleats-main", "alias": "poc", "tags": ["core"] },
    { "root": "../service-a", "alias": "svc-a", "priority": 10, "tags": ["service", "payments"] },
    { "root": "../service-b/packages/api", "alias": "svc-b-api", "tags": ["service"] },
    { "root": "../experiments", "alias": "exp", "enabled": false, "tags": ["experimental"] }
  ]
}
```
