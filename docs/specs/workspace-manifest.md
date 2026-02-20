# Workspace manifest spec (Phase 15.2)

## Status

- **Spec version:** 1 (schemaVersion = 1)
- **Audience:** PairOfCleats contributors implementing workspace catalog/manifest generation used by federated search and federated caching.
- **Implementation status:** active (`src/workspace/manifest.js`).

This spec is intended to be *implementation-ready* and consistent with existing build pointer and cache conventions in `tools/shared/dict-utils.js`.

---

## 1. Purpose

The **workspace manifest** is a deterministic, cacheable snapshot of:

- which repos are in a workspace (`repoSetId`),
- where each repo's **current build** points (`buildId`, build roots),
- which per-mode indexes are present,
- per-mode **index signature hashes** (for cache invalidation),
- per-mode **cohort/compatibility keys** (for cohort gating; see Phase 15.4).

The manifest is the single authoritative input for:

- federated search orchestration (Phase 15.3),
- federated query caching (Phase 15.5),
- later shared cache GC and CAS (Phase 15.6+).

---

## 2. Key principles

1. **Deterministic ordering**:
   - `repos[]` in the manifest is sorted by `repoId`.
2. **Deterministic serialization**:
   - Write with stable key ordering (`stableStringify`) so byte comparisons are meaningful.
3. **No stale pointer preservation**:
   - Invalid/unreadable `builds/current.json` is treated as "missing pointer".
4. **Minimal coupling**:
   - The manifest may reference repos whose cache roots differ (repo-local `cache.root`), while the manifest itself is stored under a **federation cache root**.
5. **Separation of concerns**:
   - `repoSetId` = membership identity (path-based).
   - `manifestHash` = index-state identity (signatures + build pointers).
   - Display metadata (alias/tags/priority) is included for diagnostics but excluded from `manifestHash`.

### 2.1 manifestHash computation (deterministic)

- Build a copy of the manifest with `generatedAt` removed.
- Remove display-only metadata from each `repos[]` entry (`alias`, `tags`, `enabled`, `priority`).
- Serialize with `stableStringify` and hash (sha1) to form `manifestHash`.

---

## 3. Location on disk

### 3.1 Federation cache root

A workspace has a **federation cache root** where federation artifacts live.

Resolve `federationCacheRoot` as:

1. If workspace config sets `cacheRoot`: resolve it (absolute or relative to `workspaceDir`) and use it.
2. Else: use `getCacheRoot()` (global default), consistent with existing tooling.

> Note: per-repo cache roots may still be different (via per-repo `.pairofcleats.json`), and are resolved per repo.

### 3.2 Manifest path

Write the manifest at:

- `<federationCacheRoot>/federation/<repoSetId>/workspace_manifest.json`

Where:
- `repoSetId` is from the resolved workspace config (Phase 15.1).

The directory MUST be created if it does not exist.

### 3.3 Atomic writes

Writes MUST be atomic to prevent partial reads:

- write to `workspace_manifest.json.tmp.<pid>`
- `fs.renameSync` to final name

---

## 4. Schema (schemaVersion = 1)

### 4.1 Top-level fields

| Field | Type | Required | Meaning |
|---|---:|---:|---|
| `schemaVersion` | integer | yes | Must be `1`. |
| `generatedAt` | string | yes | ISO timestamp. Volatile; excluded from `manifestHash`. |
| `repoSetId` | string | yes | Workspace membership id (`ws1-...`). |
| `manifestHash` | string | yes | Manifest state id (`wm1-...`). |
| `federationCacheRoot` | string | yes | Absolute path used to store the manifest and federation caches. |
| `workspace` | object | yes | Provenance: workspacePath, name, configHash. |
| `repos` | array | yes | Sorted by repoId; see below. |
| `diagnostics` | object | no | Warnings/errors encountered during generation. |

### 4.2 `workspace` object

| Field | Type | Required | Notes |
|---|---:|---:|---|
| `workspacePath` | string | yes | Absolute path to workspace file. |
| `name` | string | yes | From config (trimmed). |
| `workspaceConfigHash` | string \| null | no | Optional, if computed by loader. |

### 4.3 `repos[]` entries

Each entry describes one repo and its index availability.

Required fields:

| Field | Type | Required | Meaning |
|---|---:|---:|---|
| `repoId` | string | yes | Local id derived from canonical root. |
| `repoRootCanonical` | string | yes | Canonical root (realpath + win32 lowercase). |
| `repoCacheRoot` | string | yes | `getRepoCacheRoot(repoRootCanonical, userConfig)` resolved for this repo. |
| `alias` | string \| null | no | Display label (from workspace config). |
| `tags` | array[string] | no | Display/selection metadata. |
| `enabled` | boolean | no | Display/selection metadata. |
| `priority` | integer | no | Display ordering metadata. |
| `build` | object | yes | Current build pointer state. |
| `indexes` | object | yes | Per-mode index state. |
| `sqlite` | object | yes | SQLite artifacts (paths + signatures). |

### 4.4 `build` object

Represents the repo's "current build" pointer state.

| Field | Type | Required | Meaning |
|---|---:|---:|---|
| `currentJsonPath` | string | yes | Absolute path to `<repoCacheRoot>/builds/current.json`. |
| `currentJsonExists` | boolean | yes | Whether file exists. |
| `currentJsonMtimeMs` | number \| null | yes | `stat.mtimeMs` if exists else null. |
| `parseOk` | boolean | yes | Whether JSON parsed successfully. |
| `buildId` | string \| null | yes | `buildId` if parse ok and present, else null. |
| `buildRoot` | string \| null | yes | Resolved active root directory if available. |
| `buildRoots` | object | yes | Map `mode -> buildRoot` (resolved), may be empty. |
| `modes` | array[string] | yes | Modes declared in current.json (if present), else empty. |

Rules:
- If `currentJsonExists=false`, then `parseOk=false`, and all other fields are null/empty.
- If parsing fails, treat as missing pointer: `parseOk=false`, `buildId=null`, `buildRoot=null`.

### 4.5 `indexes` object

Map of mode → index entry. Keys MUST be one of:

- `code`
- `prose`
- `extracted-prose`
- `records`

Each mode entry:

| Field | Type | Required | Meaning |
|---|---:|---:|---|
| `mode` | string | yes | One of the mode keys above (duplicated for convenience). |
| `indexRoot` | string \| null | yes | Build root for this mode (from `buildRoots[mode]`), else null. |
| `indexDir` | string \| null | yes | `<indexRoot>/index-<mode>` if indexRoot present, else null. |
| `present` | boolean | yes | Whether `indexDir` exists and is a directory. |
| `indexSignatureHash` | string \| null | yes | `is1-...` signature hash if present else null. |
| `cohortKey` | string \| null | yes | Preferred key for federation cohorting (mode-scoped). |
| `compatibilityKey` | string \| null | yes | Fallback key when `cohortKey` is missing. |
| `availabilityReason` | string | yes | `present|missing-index-dir|missing-required-artifacts|invalid-pointer|compat-key-missing`. |
| `details` | object | no | Optional structured diagnostic details. |

Rules:

- `cohortKey` is preferred; if absent, coordinator falls back to `compatibilityKey`.
- When both keys are missing, set `availabilityReason=compat-key-missing`.
- `availabilityReason=present` only when required artifacts exist for that mode.

### 4.6 `sqlite` object

Represents sqlite artifacts (even if file index is missing).

| Field | Type | Required | Meaning |
|---|---:|---:|---|
| `dir` | string | yes | `<repoCacheRoot>/index-sqlite` (resolved). |
| `dbs` | object | yes | Mode → db entry. |

Each db entry:

| Field | Type | Required |
|---|---:|---:|
| `path` | string \| null | yes |
| `present` | boolean | yes |
| `fileSignature` | string \| null | yes |

Where `fileSignature` is `"<size>:<mtimeMs>"` for the db file, or null if missing.

Mode mapping for dbs:

- `code` → `code.index.db`
- `prose` → `prose.index.db`
- `extracted-prose` → `extracted-prose.index.db` (if supported)
- `records` → `records.index.db`

---

## 5. Index signature computation

### 5.1 File-index signature

For each present `indexDir`, compute a signature using the existing helper:

- `buildIndexSignature(indexDir)` from `src/retrieval/index-cache.js`

This signature already accounts for:
- `chunk_meta` variants (`chunk_meta.json`, `chunk_meta.jsonl`, `chunk_meta.meta.json + parts/`),
- `token_postings` sharded variants,
- `.json.gz` / `.json.zst` fallbacks,
- `file_relations` and `repo_map` variants,
- major index files (`dense_vectors*`, `filter_index.json`, `index_state.json`, etc.).

Then compute:

```js
indexSignatureHash = 'is1-' + sha1(buildIndexSignature(indexDir))
```

If `indexDir` is missing, set `indexSignatureHash=null`.

### 5.2 SQLite db signatures

Compute `fileSignature` for each sqlite db path as:

```js
fileSignature = `${stat.size}:${stat.mtimeMs}`
```

If missing, `fileSignature=null`.

SQLite signatures are included in `manifestHash` (see §6).

---

## 6. `manifestHash` computation

### 6.1 Purpose

`manifestHash` MUST change when search-relevant index state changes, including:

- build pointer changes (new buildId or buildRoots),
- index signatures change (file index artifacts),
- sqlite db file changes,
- cohortKey / compatibilityKey changes.

It MUST NOT change for display-only changes (name/alias/tags/priority/enabled).

### 6.2 Algorithm

Build a "core manifest" object:

```js
core = {
  v: 1,
  schemaVersion: 1,
  repoSetId,
  repos: reposSortedByRepoId.map(r => ({
    repoId: r.repoId,
    repoRootCanonical: r.repoRootCanonical,
    repoCacheRoot: r.repoCacheRoot,

    build: {
      buildId: r.build.buildId,
      currentJsonMtimeMs: r.build.currentJsonMtimeMs,
      buildRoots: r.build.buildRoots
    },

    indexes: {
      // for each mode: { present, indexSignatureHash, cohortKey, compatibilityKey, availabilityReason }
    },

    sqlite: {
      // for each mode: { present, fileSignature }
    }
  }))
};
manifestHash = 'wm1-' + sha1(stableStringify(core));
```

Notes:
- `stableStringify` MUST be used.
- Ensure `buildRoots` keys are stable (sorted) before stringify (or rely on stableStringify's key sorting).

---

## 7. Manifest generation algorithm (step-by-step)

Input:
- `workspaceConfigResolved` (Phase 15.1) containing canonical repos and `repoSetId`.

Output:
- `WorkspaceManifestV1` (schema above), written to disk.

Steps:

1. Resolve `federationCacheRoot` (see §3.1).
2. For each repo in the workspace:
   1. Load repo user config (optional):
      - use existing repo config loader used by search/build, or call `loadUserConfig(repoRootCanonical)`.
   2. Compute `repoCacheRoot = getRepoCacheRoot(repoRootCanonical, userConfig)`.
   3. Read build pointer:
      - `currentJsonPath = <repoCacheRoot>/builds/current.json`
      - if missing → build state = missing pointer (see §4.4).
      - if present → parse with JSON.parse; on error → parseOk=false.
      - resolve `buildRoot` and `buildRoots` exactly as `getCurrentBuildInfo` does (see `tools/shared/dict-utils.js`).
   4. For each mode in `{code, prose, extracted-prose, records}`:
      1. Determine `indexRoot = buildRoots[mode] || null`.
      2. Determine `indexDir = indexRoot ? path.join(indexRoot, `index-${mode}`) : null`.
      3. Determine `present = Boolean(indexDir && exists && isDirectory)`.
      4. If present, compute `indexSignatureHash` (see §5.1).
      5. Compute `cohortKey` and `compatibilityKey`:
         - read `<indexDir>/index_state.json` if present and parse keys,
         - if `cohortKey` missing, fallback remains `compatibilityKey`,
         - if both missing, set `availabilityReason=compat-key-missing` and emit warning.
      6. Set `availabilityReason` using the contract enum in §4.5.
   5. Resolve sqlite db paths using `resolveSqlitePaths(repoRootCanonical, userConfig)` from `tools/shared/dict-utils.js`.
      - Compute db signatures.

3. Assemble `repos[]` sorted by `repoId`.
4. Compute `manifestHash` from the core (see §6).
5. Write manifest JSON with stableStringify and atomic rename.

---

## 8. Diagnostics model

Manifest generation MUST be non-fatal if individual repos are missing indexes.

Include:

```ts
diagnostics: {
  warnings: Array<{ code: string, message: string, repoId?: string, mode?: string }>,
  errors: Array<{ code: string, message: string, repoId?: string, mode?: string }>
}
```

Examples:
- missing build pointer → warning
- missing indexDir for mode → warning
- index_state parse failure → warning
- duplicate repoId (should not happen if config loader is correct) → error, abort manifest

---

## 9. Implementation guidance

### 9.1 Suggested modules

- `src/workspace/manifest.js`
  - `generateWorkspaceManifest(workspaceConfigResolved, options?): WorkspaceManifestV1`
  - `readWorkspaceManifest(path): WorkspaceManifestV1`
  - `computeManifestHash(manifestLike): string`
- `src/contracts/schemas/workspace.js`
- `src/contracts/validators/workspace.js`

### 9.2 Preferred existing helpers

- `getRepoCacheRoot`, `resolveSqlitePaths` -- `tools/shared/dict-utils.js`
- `buildIndexSignature` -- `src/retrieval/index-cache.js`
- `stableStringify` -- `src/shared/stable-json.js`
- `sha1` -- `src/shared/hash.js`
- `readJsoncFile` -- `src/shared/jsonc.js` (for workspace config only; manifest is pure JSON)

### 9.3 Contract validator

Manifest payloads are validated against:

- `src/contracts/schemas/workspace.js` (`workspaceManifest`)
- `src/contracts/validators/workspace.js` (`validateWorkspaceManifest`)

Validation failures are hard errors.

---

## 10. Tests (must be automated)

1. Deterministic ordering: repos are sorted by repoId in manifest.
2. Deterministic serialization: stableStringify output is byte-identical for same catalog state.
3. Pointer invalidation:
   - invalid current.json → build treated as missing, not stale.
4. Index signature correctness:
   - chunk_meta present as `.jsonl` or `meta+parts` changes `indexSignatureHash`.
5. SQLite signature changes invalidate `manifestHash`.
6. Cohort/compat propagation:
   - if index_state.json includes `cohortKey` and/or `compatibilityKey`, manifest contains them correctly.
