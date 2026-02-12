# SPEC -- Phase 14: Index Diffs (Incremental Diffing) (Refined)

> **Scope**: Deterministic, bounded, semantic diffs between two index versions for one or more modes. Outputs support regression debugging and time-travel analysis.
>
> **Primary consumer**: `pairofcleats index diff ...` CLI + future build automation hooks.
>
> **Key design goals**:
> - Deterministic diff IDs + stable output ordering
> - Bounded runtime/memory (large repos)
> - No absolute-path leakage in persisted registries
> - Useful semantic signal (file changes + chunk/symbol changes)

---

## 0. Terms

- **IndexRef**: see `docs/specs/index-refs-and-snapshots.md`
- **Mode index dir**: `<indexBaseRoot>/index-<mode>`
- **Artifacts**: files listed in `<modeDir>/pieces/manifest.json`

---

## 1. CLI surface

### 1.1 Command group
```
pairofcleats index diff compute   --from <IndexRef> --to <IndexRef> [options]
pairofcleats index diff show      --diff <diffId> [--json]
pairofcleats index diff list      [--mode <mode>|--modes <csv>] [--json]
pairofcleats index diff prune     [policy flags] [--dry-run] [--json]
```

Alias:
- `pairofcleats index diff ...` MAY map to `compute` when subcommand omitted.

### 1.2 compute options
Required:
- `--from <IndexRef>`
- `--to <IndexRef>`

Optional:
- `--modes <csv>` default: `code`
- `--max-changed-files <n>` default 200
- `--max-chunks-per-file <n>` default 500
- `--max-events <n>` default 20000
- `--include-relations true|false` default true
- `--detect-renames true|false` default true
- `--persist true|false` default true **except** when path refs are used (see §3.4)
- `--persist-unsafe` default false (allows persistence when path refs are used)
- `--json` output summary as JSON
- `--compact` for JSONL event output (no pretty printing)

---

## 2. Diff registry

### 2.1 On-disk layout
```
repoCacheRoot/
  diffs/
    manifest.json
    <diffId>/
      inputs.json
      summary.json
      events.jsonl
```

### 2.2 `diffs/manifest.json`
```json
{
  "version": 1,
  "updatedAt": "2026-01-24T00:00:00.000Z",
  "diffs": {
    "diff_...": {
      "diffId": "diff_...",
      "createdAt": "2026-01-24T00:00:00.000Z",
      "modes": ["code"],
      "from": "snap:snap-...",
      "to": "build:20260124T000000Z_abcdef0_1234abcd",
      "summary": {
        "filesChanged": 12,
        "chunksChanged": 44
      }
    }
  }
}
```

Rules:
- The manifest is an index for listing and quick summaries only.
- The full canonical truth for a diff run is `inputs.json` + `summary.json`.
- Contract schema key: `diffs_manifest` (see `src/contracts/schemas/artifacts.js`).

---

## 3. Diff identity

### 3.1 Canonical inputs object
For a diff run, construct `inputsCanonical`:

```json
{
  "version": 1,
  "kind": "semantic-v1",
  "from": { "ref": "snap:snap-...", "identityHash": "<sha1>", "type": "snapshot", "snapshotId": "snap-..." },
  "to":   { "ref": "build:20260124T000000Z_abcdef0_1234abcd", "identityHash": "<sha1>", "type": "build", "buildIdByMode": { "code": "20260124T000000Z_abcdef0_1234abcd" } },
  "modes": ["code"],
  "options": {
    "detectRenames": true,
    "includeRelations": true,
    "maxChangedFiles": 200,
    "maxChunksPerFile": 500
  }
}
```

Constraints:
- `ref` is the canonical string form (see IndexRef spec).
- `identityHash` is from the resolver and MUST NOT encode absolute paths.
- `buildIdByMode` is optional (best effort).
- No absolute paths may appear in this structure.

### 3.2 Diff ID algorithm
```
diffId = "diff_" + sha1(stableStringify(inputsCanonical)).slice(0, 16)
```

Rationale:
- 16 hex chars (64 bits) gives a very low collision probability while keeping IDs readable.

### 3.3 Collision handling
If `diffId` already exists in registry:

- Load existing `<diffId>/inputs.json`.
- If `stableStringify(existingInputs) === stableStringify(inputsCanonical)`: reuse existing diff and return it.
- Else: throw error `INTERNAL` "diffId collision" and advise deleting cache.

### 3.4 Path refs and persistence policy
If either `from` or `to` is `path:...`:

- Default behavior: **do not persist** the diff (no registry writes). Print summary and/or emit events to stdout only.
- If the user passes `--persist-unsafe`:
  - Persistence is allowed, but the persisted `inputs.json` MUST replace the path value with:
    - `pathHash` only (no raw path)
  - The `ref` string MUST be normalized to `path:<redacted>` to prevent leaking the original.

---

## 4. Output formats

### 4.1 `summary.json`
Top-level:
```json
{
  "version": 1,
  "diffId": "diff_...",
  "createdAt": "2026-01-24T00:00:00.000Z",
  "from": { "ref": "snap:snap-...", "identityHash": "<sha1>" },
  "to":   { "ref": "build:20260124T000000Z_abcdef0_1234abcd", "identityHash": "<sha1>" },
  "modes": ["code"],
  "modesSummary": {
    "code": {
      "files": {
        "added": 3,
        "removed": 1,
        "modified": 8,
        "renamed": 1
      },
      "chunks": {
        "added": 10,
        "removed": 5,
        "modified": 20,
        "moved": 12
      },
      "relations": {
        "edgesAdded": 4,
        "edgesRemoved": 2
      },
      "limits": {
        "chunkDiffSkipped": false,
        "reason": null
      }
    }
  }
}
```

Contract schema key: `diff_summary` (see `src/contracts/schemas/artifacts.js`).

### 4.2 `events.jsonl`
Each line is a JSON object event.

`inputs.json` contract schema key: `diff_inputs` (see `src/contracts/schemas/artifacts.js`).

Event kinds:
- File:
  - `file.added`
  - `file.removed`
  - `file.modified`
  - `file.renamed`
- Chunk:
  - `chunk.added`
  - `chunk.removed`
  - `chunk.modified`
  - `chunk.moved` (same logical chunk, new range)
- Relations:
  - `relation.added`
  - `relation.removed`
- Limits:
  - `limits.chunkDiffSkipped`

Common fields:
```json
{
  "kind": "file.modified",
  "mode": "code",
  "file": "src/app.js",
  "before": { ... },
  "after": { ... }
}
```

Deterministic ordering rules (critical):
1. All events MUST be emitted grouped by `mode` in ascending mode order:
   - `code`, `prose`, `extracted-prose`, `records`
2. Within a mode:
   - Sort by `file` path ascending.
3. Within a file:
   - Chunk events sorted by `(logicalKey, startLine, start)` ascending.
4. Relation events sorted by `(fromKey, toKey, type)` ascending.

---

## 5. Diff algorithm (semantic-v1)

### 5.1 Resolve sources
1. Resolve `from` and `to` IndexRefs to `ResolvedIndexRef` (see IndexRef spec).
2. For each selected mode:
   - Determine `fromDir = resolvedFrom.indexDirByMode[mode]`
   - Determine `toDir = resolvedTo.indexDirByMode[mode]`
3. Validate required files exist:
   - At minimum `file_meta.json` (or compressed variant if used) and `chunk_meta` artifacts MUST exist.
   - `pieces/manifest.json` SHOULD exist and is used for fast-path equality.

### 5.2 Fast-path: identical artifact manifests
If both sides have `pieces/manifest.json`:

- Load both manifests.
- If `stableStringify(manifestA.fields) === stableStringify(manifestB.fields)` AND
  `stableStringify(manifestA.pieces) === stableStringify(manifestB.pieces)`:
  - Emit a zero-diff summary for that mode
  - Skip scanning file/chunk artifacts

This is safe because pieces entries include checksums (xxh64) of all outputs.

### 5.3 File-level diff (required)
Artifacts:
- `file_meta.json` (JSON array)

Steps:
1. Load `file_meta` from both sides.
2. Build maps:
   - `beforeByPath[file] = {hash, size, ext, ...}`
   - `afterByPath[file] = {hash, size, ext, ...}`
3. Compute:
   - `added = afterPaths - beforePaths`
   - `removed = beforePaths - afterPaths`
   - `intersect = beforePaths ∩ afterPaths`
4. Modified rule:
   - A file is `modified` if `before.hash !== after.hash` OR (hash missing) `before.size !== after.size`.
5. Optional rename detection (`--detect-renames`):
   - Build multimap `removedByHash[hash] -> [file...]` for removed with non-null hash
   - Build multimap `addedByHash[hash] -> [file...]` for added with non-null hash
   - For each hash with both sides:
     - Pair files deterministically (sorted path order) up to min(countRemoved, countAdded)
     - Emit `file.renamed` for each pair and remove them from `added/removed`
   - Renames do not count as added/removed; they count as `renamed`.

Events:
- Emit file events for each added/removed/modified/renamed.

### 5.4 Chunk-level diff (best-effort, bounded)
Artifacts:
- `chunk_meta` (JSON or JSONL or sharded JSONL)

Prerequisite:
- Only run if `modifiedFilesCount <= maxChangedFiles`.
- Otherwise:
  - Emit `limits.chunkDiffSkipped` and set `limits.chunkDiffSkipped=true`.

#### 5.4.1 Efficient chunk selection
Do **not** load all chunks for large repos.

Instead:
1. From file_meta, compute target file IDs for each side:
   - For each modified/renamed file path that exists in that side:
     - `fileId = fileMetaEntry.id`
     - Add to `targetFileIdsBefore` or `targetFileIdsAfter`
2. Stream chunk_meta entries and only collect entries whose `fileId` is in the relevant set.

Implementation detail:
- When chunk_meta is sharded JSONL (`chunk_meta.meta.json` exists), iterate `chunk_meta.parts/*` line-by-line.
- When chunk_meta is `chunk_meta.jsonl`, iterate line-by-line.
- When chunk_meta is `chunk_meta.json` (array), loading the full array is allowed because it is only chosen for smaller repos.

Practical note on compression:
- JSONL shards may be compressed (`.jsonl.gz` / `.jsonl.zst`). The implementation MAY either:
  1) stream uncompressed `.jsonl` line-by-line, and for compressed shards use `src/shared/artifact-io.js#readJsonLinesArray` (which decompresses the shard in-memory), **or**
  2) implement true streaming decompression.
- Either approach is acceptable as long as it processes **one shard at a time** and respects shard size limits.

#### 5.4.2 Chunk logical identity and matching
Because `chunkId` is range-sensitive, matching by `metaV2.chunkId` alone is too noisy.

Define:
```
logicalKey = segmentId + '|' + kind + '|' + name + '|' + (metaV2.signature || '')
```
Where:
- `segmentId = chunk.segment?.segmentId || ''`
- `kind = chunk.kind || ''`
- `name = chunk.name || ''`
- `metaV2.signature` is preferred; fallback to `chunk.docmeta?.signature` or ''.

Matching algorithm (deterministic):
1. Build maps for each file:
   - `beforeByChunkId[chunkId] -> chunk`
   - `afterByChunkId[chunkId] -> chunk`
   - `beforeByLogicalKey[logicalKey] -> [chunk...]` (sorted by start/startLine)
   - `afterByLogicalKey[logicalKey] -> [chunk...]` (sorted)
2. First pass: match by `chunkId` when present on both sides.
3. Second pass: for remaining unmatched:
   - If a logicalKey maps to exactly one remaining chunk on each side, match them.
   - If ambiguous (multiple candidates), do not match; treat as add/remove.

#### 5.4.3 Semantic signature
For a matched chunk pair, compute:
```json
{
  "kind": "...",
  "name": "...",
  "signature": "...",
  "range": { "start": 0, "end": 10, "startLine": 1, "endLine": 5 },
  "docHash": "<optional>", 
  "relationsHash": "<optional>"
}
```

Recommended signature fields:
- Use `metaV2.signature` when present.
- Include `metaV2.modifiers` and `metaV2.params` if present (stable).
- Include `chunk.codeRelations` summaries only if `--include-relations=true`.

Classification:
- `chunk.moved` if logical match but range changed.
- `chunk.modified` if semantic signature differs.
- `chunk.added` / `chunk.removed` for unmatched.

Boundedness:
- If a file has more than `maxChunksPerFile` chunks on either side:
  - Skip chunk diff for that file (emit a per-file limit event) OR
  - Truncate to first N chunks (choose one behavior and document it; recommended: skip with warning to avoid misleading results).

### 5.5 Relation diff (optional)
If `--include-relations=true`:
- For each matched chunk pair, extract `codeRelations` (imports/calls/usageLinks) and compute a stable edge set.
- Diff edge sets to produce `relation.added` / `relation.removed`.

Edge identity:
```
edgeKey = type + '|' + fromLogicalKey + '|' + to + '|' + (extra || '')
```
Sort keys lexicographically for deterministic output.

---

## 6. Persistence rules

If persisting (default):
- Create `<diffId>/` directory.
- Write `inputs.json`, `summary.json` atomically.
- Stream-write `events.jsonl`.
- Update `diffs/manifest.json` atomically.

If not persisting:
- Print summary and (optionally) emit events to stdout.

All registry writes MUST be guarded by the same index lock used by build/snapshots (`src/index/build/lock.js`) to avoid races with build promotion and snapshot pruning.

---

## 7. Implementation touchpoints (codex checklist)

Recommended modules:
- `src/index/diffs/compute.js`
- `src/index/diffs/registry.js`
- `tools/index-diff.js` (CLI wrapper)
- Update `bin/pairofcleats.js` to route `index diff ...`

Reuse existing utilities:
- `src/shared/stable-json.js` for canonicalization
- `src/shared/hash.js#sha1`
- `src/shared/artifact-io.js` or add streaming helpers for JSONL reading
- `src/index/build/lock.js` for lock
- `src/shared/json-stream.js#writeJsonObjectFile` for atomic writes

---

## 8. Acceptance tests

Must cover:
1. Diff ID stability for identical inputs.
2. No persistence by default when `path:` refs are used.
3. Rename detection pairs added/removed by hash deterministically.
4. Chunk diff filtering only scans relevant fileIds (verify by instrumentation or small fixtures).
5. Fast-path returns zero diff when pieces manifests match.


