# Spec: VFS manifest index (.vfsidx) (draft)

Status: Draft (Milestone A). Optional derived artifact.

Goal: provide a lookup-friendly index keyed by `virtualPath` to avoid scanning `vfs_manifest` when resolving tooling virtual documents.

Non-goals:
- Replace `vfs_manifest`.
- Change `docHash` or `virtualPath` semantics.
- Emit indexes for compressed JSONL (gzip/zstd).

---

## 1) Artifact name and format

Logical name: `vfs_manifest_index`

Emission forms (uncompressed only):
- `vfs_manifest.vfsidx` (paired with `vfs_manifest.jsonl`)
- `vfs_manifest.parts/vfs_manifest.part-00000.vfsidx` (paired with each sharded `.jsonl` part)

Manifest inventory:
- The index file MUST be listed in `pieces/manifest.json` with name `vfs_manifest_index`.

---

## 2) Row schema (v1.0.0)

```ts
type VfsManifestIndexRowV1 = {
  schemaVersion: "1.0.0";
  virtualPath: string;
  offset: number; // byte offset in the JSONL file
  bytes: number;  // bytes in the JSONL line, including newline
};
```

Each index row corresponds to exactly one JSONL row in the paired `vfs_manifest` file.

---

## 3) Ordering and invariants

- Rows MUST appear in the same order as the source JSONL file.
- `offset` and `bytes` MUST identify a single JSONL line that parses to a row with the matching `virtualPath`.
- Index emission is skipped for compressed manifests (gzip/zstd), because offsets are not stable.

---

## 4) Producers / Consumers

Producers:
- The VFS manifest writer after emitting a JSONL file.

Consumers:
- `loadVfsManifestIndex` + `loadVfsManifestRowByPath` helpers.
- Tooling and LSP providers that need fast `virtualPath` lookups.

---

## 5) Related specs

- `docs/specs/vfs-manifest-artifact.md`
- `docs/specs/vfs-hash-routing.md`
