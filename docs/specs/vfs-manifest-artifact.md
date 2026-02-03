# Spec: VFS manifest artifact (v1)

Status: **Normative** for Phase 8+ tooling. This is the canonical contract for `vfs_manifest`.

Goal: provide a compact, deterministic mapping from container files to per-segment virtual documents, so tooling and analysis can operate on embedded languages without re-parsing container files repeatedly.

This spec aligns with:
- `docs/specs/tooling-vfs-and-segment-routing.md`
- `docs/specs/identity-contract.md` (segmentUid source)

Related extension specs:
- `docs/specs/vfs-index.md`
- `docs/specs/vfs-segment-hash-cache.md`
- `docs/specs/vfs-hash-routing.md`
- `docs/specs/vfs-token-uris.md`
- `docs/specs/vfs-cold-start-cache.md`

---

## 1) Artifact name and format (normative)

Logical name: `vfs_manifest`

Emission forms (MUST support one of):
- `vfs_manifest.jsonl` (or compressed)
- `vfs_manifest.meta.json` + `vfs_manifest.parts/vfs_manifest.part-00000.jsonl` (preferred for large repos)

Manifest inventory:
- The artifact and its meta/parts MUST be listed in `pieces/manifest.json` (manifest-first).

---

### 1.1 Optional derived artifacts

When `tooling.vfs.hashRouting` is enabled, producers SHOULD emit:
- `vfs_path_map.jsonl` (or sharded `vfs_path_map.parts/*`) mapping legacy `virtualPath` → hash-routed path.
- `vfs_path_map.meta.json` when sharded.

When emitting uncompressed JSONL (`.jsonl`), producers MAY emit:
- `vfs_manifest.vfsidx` (or `vfs_manifest.part-00000.vfsidx` for sharded parts), a sparse index for fast lookups.
- `vfs_manifest.vfsbloom.json` (or `vfs_manifest.part-00000.vfsbloom.json` for sharded parts), a Bloom filter keyed by `virtualPath` to skip negative lookups.

All derived artifacts MUST be listed in `pieces/manifest.json` with the appropriate logical names
(`vfs_path_map`, `vfs_path_map_meta`, `vfs_manifest_index`, `vfs_manifest_bloom`).

---

## 2) Row schema (v1.0.0)

Each JSONL row MUST conform to:

```ts
type VfsManifestRowV1 = {
  schemaVersion: "1.0.0";

  // Virtual doc identity (tooling path, not the identity-contract virtualPath)
  virtualPath: string;        // canonical VFS path (see §3)
  docHash: string;            // "xxh64:<hex16>" (see §4)

  // Container identity
  containerPath: string;      // repo-relative POSIX path
  containerExt: string|null;  // e.g., ".md", ".vue" (null if unknown)
  containerLanguageId: string|null;

  // Effective identity
  languageId: string;         // effective language registry id (e.g., "typescript")
  effectiveExt: string;       // ".ts", ".tsx", ".js", ".jsx", ...
  segmentUid: string|null;    // stable segment identity (null for unsegmented files)
  segmentId?: string|null;    // optional debug id (range-derived; not stable)

  // Segment mapping (container offsets)
  segmentStart: number;       // 0-based UTF-16 offset in container (inclusive)
  segmentEnd: number;         // 0-based UTF-16 offset in container (exclusive)

  // Optional convenience for offset mapping
  lineStart: number|null;     // 1-based line where segment starts in container
  lineEnd: number|null;       // 1-based line where segment ends in container

  extensions?: object;        // preferred extension point (schema allows additionalProperties)
};
```

### 2.1 Required invariants

- `containerPath` MUST be POSIX, repo-relative, and normalized (no `..`, no absolute paths, no backslashes).
- Producers MUST emit `containerPath` via `toPosix()` and resolve it with `fromPosix()` at IO boundaries.
- `containerPath` MUST be derived from the repo-relative `relKey` (not absolute paths).
- `containerExt` MUST match the extension in `containerPath` when present; otherwise `null`.
- `languageId` MUST be normalized to lowercase and `effectiveExt` MUST be consistent with the language registry mapping (see tooling VFS spec §4).
- `segmentStart`/`segmentEnd` MUST satisfy `0 <= segmentStart <= segmentEnd` and must refer to the container text.
- For unsegmented files: `segmentUid = null`, `segmentStart = 0`, `segmentEnd = containerText.length`.
- `extensions` is the only permitted location for producer-specific extra fields when strict schema validation is enabled.

---

## 3) Canonical `virtualPath` format (normative)

### 3.1 General requirements

`virtualPath` MUST be deterministic, POSIX-style, and MUST NOT collide with real repo files.

Canonical prefix (reserved): `.poc-vfs/`

### 3.2 Segmented documents

For a segmented document (`segmentUid != null`), `virtualPath` MUST be:

```
.poc-vfs/<containerPath>#seg:<segmentUid><effectiveExt>
```

Examples:
- `.poc-vfs/docs/guide.md#seg:segu:v1:abc123.ts`
- `.poc-vfs/src/App.vue#seg:segu:v1:def456.tsx`

### 3.3 Unsegmented documents

For an unsegmented document (`segmentUid == null`), `virtualPath` MUST be:

```
.poc-vfs/<containerPath>
```

### 3.4 Path encoding

- `containerPath` MUST be POSIX-normalized before embedding.
- If `containerPath` contains `#` or `%`, it MUST be percent-encoded (`# -> %23`, `% -> %25`) before embedding.
- No other characters are encoded in `containerPath`; the VFS path remains human-readable.

### 3.5 Relationship to identity-contract `virtualPath`

The identity-contract `virtualPath` (used for `chunkUid`) is not the same string as `vfs_manifest.virtualPath`.
Identity-contract `virtualPath` is:

- `fileRelPath` for unsegmented chunks
- `fileRelPath + "#seg:" + segmentUid` for segmented chunks

The VFS manifest always uses the `.poc-vfs/` prefix to avoid collisions with real files.

---

## 4) `docHash` format and computation (normative)

`docHash` MUST be computed over the exact virtual document text:

- For segmented docs: `segmentText = containerText.slice(segmentStart, segmentEnd)`
- For unsegmented docs: `segmentText = containerText`

Hash algorithm:

```
docHash = "xxh64:" + xxh64(segmentText)
```

Where `xxh64` is the project hash backend (see `src/shared/hash.js`).

Notes:
- The hash MUST use lowercase hex.
- Empty text is valid; hash the empty string and still emit `docHash`.

---

## 5) Deterministic ordering and sharding (normative)

Rows MUST be emitted in a deterministic, total order. Use the following sort key (ascending):

1. `containerPath` (lexicographic)
2. `segmentStart` (numeric)
3. `segmentEnd` (numeric)
4. `languageId` (lexicographic)
5. `effectiveExt` (lexicographic)
6. `segmentUid` (lexicographic, or empty string if null)
7. `virtualPath` (lexicographic)

For sharded output:

- Parts MUST preserve the global row order.
- Part filenames MUST be zero-padded and monotonic:
  - `vfs_manifest.parts/vfs_manifest.part-00000.jsonl`, `vfs_manifest.part-00001.jsonl`, ...
- `vfs_manifest.meta.json` MUST follow the sharded JSONL meta schema in `docs/contracts/artifact-schemas.md`.

---

## 6) Size limits

- No row may exceed 32KB UTF-8 (`VFS_MANIFEST_MAX_ROW_BYTES`).
- Row size is measured as the UTF-8 byte length of the JSON string for the row.
- If a row would exceed the limit, the producer trims optional fields in this order:
  1. drop `extensions`
  2. null out `segmentId`
- If the row still exceeds the limit after trimming, the producer drops the row and logs a warning.
- Producers SHOULD track `trimmedRows` and `droppedRows` counters when emitting stats.

---

## 7) Producers / Consumers (informative)

Producers:
- Primary producer is the index builder once Phase 5 provides:
  - segment boundaries (`segmentStart/segmentEnd`)
  - effective language identity (`languageId/effectiveExt`)
  - stable `segmentUid`

Consumers:
- Tooling VFS (Phase 8) and any segment-aware analyzers that need stable virtual paths.


