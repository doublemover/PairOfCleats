# SPEC -- Phase 14: IndexRefs, Snapshots, and Time‑Travel Foundations (Refined)

> **Scope**: This spec defines a stable *IndexRef* reference format, a snapshot registry (pointer + frozen snapshots), and the deterministic resolution rules needed for time-travel search/debugging.
>
> **Primary consumers**:
> - CLI commands: `pairofcleats index snapshot ...`
> - Retrieval: `pairofcleats search ... --as-of <IndexRef>`
> - Diffing: `pairofcleats index diff ...` (see the diff spec for output format)
>
> **Non-goals (Phase 14)**:
> - Git-integrated snapshot naming (commit/tag auto-derivation) beyond recording provenance.
> - Distributed snapshot replication.
> - Background/async snapshotting (all ops are foreground, with explicit lock + atomic writes).

---

## 0. Design principles

1. **Determinism**  
   The same `IndexRef` must resolve to the same on-disk roots given identical registries and filesystem state.

2. **Path privacy by default**  
   IndexRefs and snapshot manifests must not *require* storing absolute filesystem paths. All on-disk references in registries MUST be repo-cache-relative paths.

3. **Atomic + crash-safe**  
   All registry writes MUST be atomic. Partial snapshot creation/freezes MUST be detectable and auto-cleanable.

4. **Compatible with existing build promotion**  
   Resolution MUST respect the existing `repoCacheRoot/builds/current.json` promotion mechanics, including per-mode build roots.

5. **Prefer immutability when available**  
   If a snapshot has a frozen representation, it SHOULD be used by default for time-travel retrieval.

---

## 1. Definitions

### 1.1 Repo cache root
`repoCacheRoot` is the repo-specific cache directory returned by existing tooling (see `tools/shared/dict-utils.js#getRepoCacheRoot(repoRoot, userConfig)`).

### 1.2 Index base root
An **index base root** is a directory that contains one or more *mode index directories*, typically:

- `index-code/`
- `index-prose/`
- `index-extracted-prose/`
- `index-records/`

This matches the output of promoted builds (e.g., `repoCacheRoot/builds/<buildId>/...`).

### 1.3 Mode index directory
A **mode index directory** is the per-mode directory containing artifacts like `chunk_meta.*`, `token_postings.*`, `file_meta.json`, `pieces/manifest.json`, `index_state.json`, etc.

Example: `<indexBaseRoot>/index-code`

### 1.4 Modes
Valid modes are:

- `code`
- `prose`
- `extracted-prose`
- `records`

---

## 2. IndexRef format

### 2.1 Grammar
IndexRefs are normalized, human-friendly identifiers that describe which index version to use.

```
IndexRef :=
  "latest"
| "build:" BuildId
| "snap:" SnapshotId
| "tag:" Tag
| "path:" PathValue
```

### 2.2 Allowed characters

- `BuildId` MUST match: `^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$`
- `SnapshotId` MUST match: `^snap-[A-Za-z0-9._-]+$`
- `Tag` MUST match: `^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$` (1-64 chars)
- `PathValue` is an OS path string. It is **not** stored in registries.

### 2.3 Normalization rules
The CLI and internal APIs MUST normalize `IndexRef` strings as follows:

1. Trim leading/trailing whitespace.
2. Keywords are case-insensitive **only** for the prefix portion:
   - Accept `LATEST`, `Build:...`, `SNAP:...`, etc.
   - Normalize to lower-case prefix: `latest`, `build:`, `snap:`, `tag:`, `path:`.
3. The value portion is case-sensitive (snapshot IDs, build IDs, tags preserve case).

### 2.4 Canonical string form
After parsing and normalization, the canonical string form MUST be:

- `latest`
- `build:<BuildId>`
- `snap:<SnapshotId>`
- `tag:<Tag>`
- `path:<PathValue>` (only used in-memory; never written to registry)

---

## 3. Core APIs

### 3.1 `parseIndexRef(ref: string) -> ParsedIndexRef`
Returns a structured object:

```ts
type ParsedIndexRef =
  | { kind: 'latest', raw: string, canonical: 'latest' }
  | { kind: 'build', raw: string, canonical: string, buildId: string }
  | { kind: 'snapshot', raw: string, canonical: string, snapshotId: string }
  | { kind: 'tag', raw: string, canonical: string, tag: string }
  | { kind: 'path', raw: string, canonical: string, path: string };
```

Validation failures MUST throw a `createError(ERROR_CODES.INVALID_REQUEST, ...)` style error with a clear message.

### 3.2 `resolveIndexRef(...) -> ResolvedIndexRef`

```ts
type Mode = 'code'|'prose'|'extracted-prose'|'records';

type ResolvedIndexRef = {
  // Echo
  requested: string;              // raw input
  parsed: ParsedIndexRef;         // parsed form
  canonical: string;              // canonical string form

  // Resolved roots (absolute paths)
  indexBaseRootByMode: Partial<Record<Mode, string>>;
  indexDirByMode: Partial<Record<Mode, string>>; // indexBaseRootByMode[mode] + '/index-' + mode

  // Identity (no absolute paths)
  identity: {
    type: 'latest'|'build'|'snapshot'|'tag'|'path';
    // Stable identifiers used for caching and display:
    buildIdByMode?: Partial<Record<Mode, string>>;   // derived by reading build_state.json
    snapshotId?: string;
    tag?: string;
    // Optional: semantic metadata for debugging
    configHashByMode?: Partial<Record<Mode, string|null>>;
    toolVersionByMode?: Partial<Record<Mode, string|null>>;
  };

  // A stable hash of the identity object for cache keys (sha1(stableStringify(identity))).
  identityHash: string;

  // Optional snapshot metadata if kind resolves to a snapshot.
  snapshot?: SnapshotEntry | null;

  // Diagnostics
  warnings: string[];
};
```

**Critical constraint**: `ResolvedIndexRef.identity` MUST NOT contain absolute paths.

### 3.3 Canonical identity hash
`identityHash = sha1(stableStringify(identity))`

- Uses `src/shared/stable-json.js#stableStringify`.
- Uses `src/shared/hash.js#sha1`.

This is the canonical, consistent cache discriminator for all time-travel operations.

---

## 4. Resolution rules

Resolution MUST accept:

- `repoRoot` (absolute)
- `userConfig` (validated config object)
- `requestedModes` (array; if empty, resolver MAY resolve only modes requested by caller later)
- `preferFrozen` (boolean; default `true`)
- `allowMissingModes` (boolean; default `false`)

### 4.1 Resolve `latest`
Source of truth: `repoCacheRoot/builds/current.json` written by build promotion.

**Rule**:
- If `current.json` contains `buildRoots`, then for each requested `mode`:
  - `relativeRoot = current.buildRoots[mode] ?? current.buildRoot`
- Else:
  - `relativeRoot = current.buildRoot`

Then:
- `indexBaseRoot = path.join(repoCacheRoot, relativeRoot)`
- `indexDir = path.join(indexBaseRoot, 'index-' + mode)`

**Build IDs per mode**:
- For each unique `indexBaseRoot`, attempt to read `<indexBaseRoot>/build_state.json`.
- If present, populate `identity.buildIdByMode[mode] = build_state.buildId`.
- If missing and `allowMissingModes=false`, this is an error if that mode is requested.
- If missing and `allowMissingModes=true`, add warning `Missing build_state.json for <mode>` and omit `buildIdByMode[mode]`.

**Why**: `current.json.buildId` is not authoritative for per-mode roots because `buildRoots` may mix modes across different builds.

### 4.2 Resolve `build:<id>`
`indexBaseRootByMode[mode] = path.join(repoCacheRoot, 'builds', buildId)`

The resolver MUST read `<indexBaseRoot>/build_state.json` if present:
- If present and `build_state.buildId !== buildId`, emit warning (do not fail).
- Populate `identity.buildIdByMode` for all requested modes with `build_state.buildId` if present, else with `buildId` as a fallback.

### 4.3 Resolve `snap:<id>`
Resolve via the snapshot registry (see §5).

If snapshot has `frozen` materialization AND `preferFrozen=true`, then base roots are:
- `indexBaseRoot = repoCacheRoot/snapshots/<snapshotId>/frozen`

Otherwise base roots are derived from the snapshot's pointer mapping:
- `indexBaseRoot = repoCacheRoot/<relativeBuildRootFromSnapshot>`

The resolver MUST populate `identity.snapshotId = snapshotId` and `identity.buildIdByMode` by reading the relevant build_state.json files:
- For frozen: if `<frozenRoot>/build_state.json` exists, use it.
- For pointer: read from referenced build roots.

### 4.4 Resolve `tag:<tag>`
Resolve through the snapshot registry tag index:

- `snapshotId = manifest.tags[tag][0]` (the most-recent snapshot id for that tag)
- Resolve as `snap:<snapshotId>`

**Deterministic ordering**:
- `manifest.tags[tag]` MUST be stored most-recent-first at write time.
- If two snapshots have equal createdAt timestamps (should not happen), order by snapshotId ascending.

### 4.5 Resolve `path:<pathValue>`
`indexBaseRootByMode[mode] = path.resolve(pathValue)`

Constraints:
- Path refs MUST be allowed only for:
  - Retrieval (`--as-of`) and **non-persistent** diff runs.
- Path refs MUST be rejected for:
  - Snapshot creation (`index snapshot create`) and snapshot registry mutation
  - Persistent diff registry operations (unless explicitly `--persist-unsafe`, defined in diff spec)

Identity rules:
- `identity.type='path'`
- `identity` MUST NOT contain the raw path.
- Instead store `identity.pathHash = sha1(path.resolve(pathValue))` (string).
- The resolver MUST add warning: `Path ref used; identity is not portable across machines`.

---

## 5. Snapshot registry

### 5.1 On-disk layout

All snapshot data lives under:

```
repoCacheRoot/
  snapshots/
    manifest.json
    <snapshotId>/
      snapshot.json
      frozen.json            (optional; only if frozen)
      frozen/                (optional; only if frozen)
        build_state.json     (optional but recommended)
        index-code/
        index-prose/
        index-extracted-prose/
        index-records/
        index-sqlite/        (optional)
        index-lmdb/          (optional)
```

### 5.2 `snapshots/manifest.json` schema (versioned)
```json
{
  "version": 1,
  "updatedAt": "2026-01-24T00:00:00.000Z",
  "snapshots": {
    "snap-...": {
      "snapshotId": "snap-...",
      "createdAt": "2026-01-24T00:00:00.000Z",
      "kind": "pointer",
      "tags": ["release/v1.2.3"],
      "label": "optional short label",
      "hasFrozen": false
    }
  },
  "tags": {
    "release/v1.2.3": ["snap-...", "snap-..."]
  }
}
```

Rules:
- `snapshots` is a map `snapshotId -> SnapshotEntrySummary`.
- `tags` is a reverse index `tag -> [snapshotId...]` (most recent first).
- `hasFrozen` MUST be updated to `true` when frozen.json exists and freeze completes.

### 5.3 `snapshot.json` schema (immutable after create)
```json
{
  "version": 1,
  "snapshotId": "snap-...",
  "createdAt": "2026-01-24T00:00:00.000Z",
  "kind": "pointer",
  "label": "optional",
  "notes": "optional multi-line string",
  "tags": ["release/v1.2.3"],
  "pointer": {
    "buildRootsByMode": {
      "code": "builds/20260124T000000Z_abcdef0_1234abcd",
      "prose": "builds/20260122T000000Z_1234567_deadbeef"
    },
    "buildIdByMode": {
      "code": "20260124T000000Z_abcdef0_1234abcd",
      "prose": "20260122T000000Z_1234567_deadbeef"
    }
  },
  "provenance": {
    "repoId": "myrepo-<hash>",
    "repoRootHash": "<sha1(absRepoRoot)>",
    "git": {
      "branch": "main",
      "commit": "abcdef...",
      "dirty": false
    },
    "toolVersionByMode": {
      "code": "0.12.0",
      "prose": "0.12.0"
    },
    "configHashByMode": {
      "code": "<sha1>",
      "prose": "<sha1>"
    }
  }
}
```

Notes:
- `buildRootsByMode` MUST be repoCacheRoot-relative paths (posix-ish separators).
- `repoRootHash` is optional but recommended: store `sha1(path.resolve(repoRoot))` to correlate snapshots without leaking absolute paths.

### 5.4 `frozen.json` schema (immutable after freeze)
```json
{
  "version": 1,
  "snapshotId": "snap-...",
  "frozenAt": "2026-01-24T00:05:00.000Z",
  "method": "hardlink",
  "frozenRoot": "snapshots/snap-.../frozen",
  "included": {
    "modes": ["code", "prose"],
    "sqlite": true,
    "lmdb": false
  },
  "verification": {
    "checkedAt": "2026-01-24T00:05:00.000Z",
    "ok": true,
    "filesChecked": 1234,
    "bytesChecked": 987654321,
    "failures": []
  }
}
```

Rules:
- `frozenRoot` MUST be repoCacheRoot-relative.
- `verification.ok` MUST be `true` only when the checks pass.

---

## 6. Snapshot operations

### 6.1 Locking requirements
All snapshot operations that read or mutate the registries MUST acquire the existing index lock:

- Use `src/index/build/lock.js#acquireIndexLock(repoCacheRoot, waitMs)`
- Default `waitMs`:
  - `create`: 0 (fail fast)
  - `freeze`: 0 (fail fast)
  - `prune`: 0 (fail fast)
- CLI MAY provide `--wait-ms` to override.

### 6.2 `pairofcleats index snapshot create`

Purpose: create a pointer snapshot capturing the current promoted build roots.

Inputs:
- `--repo <path>` (required in wrapper)
- `--modes <csv>` optional (default: `code,prose,extracted-prose,records`)
- `--id <snapshotId>` optional; if absent, auto-generate
- `--tag <tag>` repeatable
- `--label <text>` optional
- `--notes <text>` optional (can be multi-line; CLI may accept `--notes-file` in future)

Validation gate:
- For each selected mode, the resolved base root MUST have a `build_state.json` with `validation.ok === true`.
  - If `build_state.json` missing: fail.
  - If validation missing: fail.
  - If validation.ok false: fail.

Atomic steps (must be crash-safe):
1. Acquire index lock.
2. Resolve `latest` per selected modes (per §4.1).
3. For each unique base root referenced, read `build_state.json` and validate.
4. Determine `snapshotId`:
   - If `--id` present: validate regex and ensure directory doesn't already exist.
   - Else: generate `snap-<YYYYMMDDHHMMSS>-<randomHex6>`.
5. Create snapshot dir:
   - `snapshots/<snapshotId>/`
6. Write `snapshot.json` atomically.
7. Update `snapshots/manifest.json` atomically:
   - Add snapshot entry
   - Update tags reverse index
   - Update updatedAt
8. Release lock.

Output:
- Human: one-line summary with snapshotId and modes
- JSON (`--json`): `{ ok:true, snapshotId, createdAt, kind:'pointer', tags:[...] }`

### 6.3 `pairofcleats index snapshot freeze`

Purpose: materialize an immutable copy of all selected artifacts under `snapshots/<id>/frozen/`.

Inputs:
- `--snapshot <snapshotId | IndexRef>` (accept `snap:` or bare snapshotId; reject others)
- `--method hardlink|copy` (default: `hardlink`)
- `--include-sqlite true|false` (default: `auto`)
- `--include-lmdb true|false` (default: `false`)
- `--verify true|false` (default: `true`)
- `--modes <csv>` optional (default: modes recorded in snapshot.json)

**Default include behavior**:
- `include-sqlite=auto` means: include if source base root contains `index-sqlite/` *and* at least one db exists.
- Otherwise false.

Atomic, crash-safe algorithm:
1. Acquire index lock.
2. Load `snapshot.json` and verify it exists.
3. Determine `sourceRootByMode` from snapshot pointer mapping.
4. Create a staging directory:
   - `snapshots/<snapshotId>/frozen.staging-<ts>/`
5. For each selected mode:
   - `srcDir = <sourceBaseRoot>/index-<mode>`
   - `dstDir = <staging>/index-<mode>`
   - Read `<srcDir>/pieces/manifest.json` (required).
   - For each entry in `pieces`:
     - `relPath = entry.path` (posix)
     - `srcFile = path.join(srcDir, relPath)`
     - `dstFile = path.join(dstDir, relPath)`
     - Ensure parent directories exist.
     - Copy strategy:
       - If method==hardlink: try `fs.link(srcFile, dstFile)`
         - On `EXDEV`, `EPERM`, `EACCES`, fall back to copy for that file.
       - Else copy: `fs.copyFile(srcFile, dstFile)`
     - If `verify==true`:
       - Compute checksum using `src/shared/hash.js#checksumFile(dstFile)`
       - Compare to `entry.checksum` (`algo:value`)
       - Record failures.
6. Optionally include sqlite/lmdb:
   - If include-sqlite: recursively copy/link `sourceBaseRoot/index-sqlite` to `<staging>/index-sqlite`
   - If include-lmdb: recursively copy/link `sourceBaseRoot/index-lmdb` to `<staging>/index-lmdb`
   - These directories are not in pieces manifests and MUST be copied by direct directory walk.
7. Optionally write `build_state.json` into staging:
   - Prefer copying from the dominant source base root (the one used for `code` if present else first mode).
8. If verification failures exist:
   - Delete staging directory
   - Do **not** modify snapshot registry
   - Return error with failure summary
9. Atomically rename:
   - `rename(<staging>, snapshots/<id>/frozen)`
10. Write `frozen.json` atomically.
11. Update `manifest.json` entry (`hasFrozen=true`) atomically.
12. Release lock.

### 6.4 `pairofcleats index snapshot list`
Outputs snapshots ordered by `createdAt desc`.

Options:
- `--tag <tag>` filter snapshots containing tag
- `--json` machine output

### 6.5 `pairofcleats index snapshot show --snapshot <id>`
Shows `snapshot.json` plus `frozen.json` if present.

### 6.6 `pairofcleats index snapshot prune`
Deletes snapshots per policy.

Policy inputs (CLI overrides config):
- `--keep-frozen <n>` default 20
- `--keep-pointer <n>` default 50
- `--keep-tags <csv>` default `release/*` (glob)
- `--max-age-days <n>` optional; delete older than N days (unless protected)
- `--dry-run` show what would be deleted without deleting
- `--json` output

Rules:
- Never delete snapshots with a protected tag match.
- Prefer deleting pointer-only snapshots first.
- Deterministic ordering: oldest first.

---

## 7. Failure recovery and garbage collection

Snapshot operations MUST create only two kinds of intermediate artifacts:
- `.staging-*` directories
- `.tmp` files created by atomic JSON writers

Cleanup rules:
- On startup of any snapshot command, perform a lightweight cleanup:
  - Remove any `frozen.staging-*` directories older than 24h.
  - Ignore unknown files.
- `snapshot prune` MUST also remove stale staging directories.

---

## 8. Implementation touchpoints (codex checklist)

### 8.1 New source modules (recommended)
- `src/index/index-ref.js`
  - parse/normalize IndexRef
  - resolveIndexRef
- `src/index/snapshots/registry.js`
  - read/write manifest
  - tag index maintenance
- `src/index/snapshots/freeze.js`
  - freeze implementation
- `tools/index-snapshot.js`
  - CLI wrapper using `src/shared/cli.js#createCli`

### 8.2 CLI routing changes
Update `bin/pairofcleats.js`:
- Add `index snapshot <subcommand>` routing.
- Extend `validateArgs(...)` allowed flags for each snapshot subcommand.

---

## 9. Acceptance tests (must exist)

### 9.1 Unit tests
- `parseIndexRef` accepts/normalizes canonical forms and rejects invalids.
- Resolving `latest` respects `current.json.buildRoots` per mode.
- Tag resolution returns most-recent snapshot deterministically.

### 9.2 Integration tests (filesystem)
- Create snapshot when current build is validated ok.
- Freeze snapshot with hardlink method:
  - Assert `frozen/index-code/...` exists and checksums match pieces manifest.
- Freeze fails when a referenced piece is missing.
- Prune respects protected tags and deletes oldest pointer snapshots first.

---

## 10. Security and safety

- Snapshot IDs and tags MUST be validated before constructing paths.
- Never join user-provided values without validation (prevents path traversal).
- Path IndexRefs MUST NOT be stored in registries.

