# SPEC -- Phase 14: Implementation Checklist (Codex‑Ready) (Refreshed)

This document is an execution checklist to minimize ambiguity while implementing Phase 14:
- IndexRefs + snapshot registry + freeze
- Index diffs
- As-of retrieval integration

It is intentionally specific about files, functions, and acceptance criteria.

---

## 1. New directories / modules

### 1.1 IndexRef resolution
Create: `src/index/index-ref.js`

Exports (names are suggestions; adjust to existing style):
- `parseIndexRef(ref: string) -> ParsedIndexRef`
- `resolveIndexRef({ repoRoot, userConfig, requestedModes, preferFrozen, allowMissingModes }) -> ResolvedIndexRef`

Dependencies to reuse:
- `tools/dict-utils.js`: `getRepoCacheRoot`, `getCurrentBuildInfo`, `getBuildsRoot`, `getRepoId`, `getEffectiveConfigHash`, `getToolVersion`
- `src/shared/stable-json.js#stableStringify`
- `src/shared/hash.js#sha1`
- `src/shared/error-codes.js#createError`

### 1.2 Snapshot registry
Create directory: `src/index/snapshots/`

Files:
- `registry.js`
  - `loadSnapshotsManifest(repoCacheRoot)`
  - `writeSnapshotsManifest(repoCacheRoot, manifest)`
  - `loadSnapshot(repoCacheRoot, snapshotId)`
  - `writeSnapshot(repoCacheRoot, snapshotId, snapshotJson)`
  - `writeFrozen(repoCacheRoot, snapshotId, frozenJson)`
- `commands.js` (optional; can be placed in tool script instead)
  - `createSnapshot(...)`
  - `freezeSnapshot(...)`
  - `listSnapshots(...)`
  - `showSnapshot(...)`
  - `pruneSnapshots(...)`

Reuse:
- `src/shared/json-stream.js#writeJsonObjectFile({atomic:true})`

### 1.3 Diff registry
Create directory: `src/index/diffs/`

Files:
- `compute.js` (semantic diff engine)
- `registry.js` (manifest persistence)
- `cli-format.js` (optional)

### 1.4 Streaming JSONL helper (recommended)
If needed for performance:
- `src/shared/jsonl-stream.js`
  - `async function* readJsonlEntries(filePath)`
  - Support `.jsonl` and optionally `.jsonl.gz` / `.jsonl.zst` if those exist.
  - Acceptable Phase 14 fallback: load compressed shards into memory one shard at a time.

---

## 2. CLI wiring

### 2.1 New tool scripts
Add:
- `tools/index-snapshot.js`
- `tools/index-diff.js`

Both should use existing `src/shared/cli.js#createCli` patterns.

### 2.2 `bin/pairofcleats.js`
Add routing:
- `pairofcleats index snapshot ...` -> runs `tools/index-snapshot.js`
- `pairofcleats index diff ...` -> runs `tools/index-diff.js`

Note:
- The wrapper is not strictly validating flags for all commands today.
- If you add strict validation for the new subcommands, ensure the allowlists include all flags required by the specs.

---

## 3. Retrieval integration

### 3.1 `src/retrieval/cli-args.js`
Add `asOf` string option.

### 3.2 `src/retrieval/cli.js`
- Resolve asOf context using `resolveIndexRef`.
- Use as-of roots for:
  - file-backed index dirs
  - sqlite/lmdb path resolution (single-root policy)

### 3.3 Query cache key
Update key derivation to include `asOf.identityHash`.

### 3.4 Index signature unification
Make `src/retrieval/cli-index.js` use `src/retrieval/index-cache.js#buildIndexSignature` to avoid drift.

---

## 4. Snapshot freeze correctness

### 4.1 Copy/link strategy
Default method: hardlink with per-file fallback to copy on `EXDEV/EPERM/EACCES`.

### 4.2 Required validation gate
Snapshot create MUST fail unless each referenced build root's `build_state.json.validation.ok === true`.

### 4.3 Atomic staging
Freeze MUST:
- materialize into `frozen.staging-*`
- verify (optional but default true)
- rename staging -> `frozen/` only on success

### 4.4 Manifest-driven file list
Freeze MUST use `pieces/manifest.json` for each mode to determine files to copy/link and checksums to verify.

---

## 5. Diff compute correctness

### 5.1 Fast path
If pieces manifests match exactly, return zero-diff without scanning.

### 5.2 Rename detection
Pair removed/added by file hash deterministically.

### 5.3 Chunk diff is bounded
If modified file count exceeds threshold, skip chunk diff and emit a limit event.

### 5.4 Streaming selection by fileId
Do not load all chunk meta for large repos; filter by fileId sets.

---

## 6. Config schema updates (optional but recommended)

If you add snapshot/diff retention configuration defaults:
- Implement according to `docs/specs/config-defaults.md`
- Update `docs/config/schema.json`
- Update `tools/dict-utils/config.js#normalizeUserConfig` to pass through the new keys

Keep defaults in code so existing repos without new config continue to work.

---

## 7. Test checklist

### 7.1 Unit tests
- IndexRef parsing and validation
- identityHash stability
- contracts validation for new manifests

### 7.2 Integration tests (filesystem)
- Snapshot create + freeze with a small fixture index
- As-of search uses snapshot frozen root
- Diff compute produces deterministic diffId and correct rename detection

### 7.3 "No-path leak" tests
- Persisted `snapshots/manifest.json`, `snapshot.json`, `diffs/inputs.json` contain no absolute filesystem paths.
