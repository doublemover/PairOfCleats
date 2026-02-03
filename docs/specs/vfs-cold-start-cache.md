# Spec: VFS cold start cache (draft)

Status: Draft (Milestone A). Optional performance cache.

Goal: reuse VFS disk documents and lookup metadata between runs to reduce cold-start latency and avoid rewriting unchanged virtual docs.

Non-goals:
- Change `vfs_manifest` or `vfs_index` schemas.
- Persist or reuse any data without validating hashes.

---

## 1) Cache layout

Cache root (example):

```
<cacheRoot>/vfs-cold-start/
  vfs_cold_start.meta.json
  vfs_cold_start.jsonl
```

Current implementation keeps a single JSONL file (no sharding).

---

## 2) Meta schema (v1.0.0)

```ts
type VfsColdStartMetaV1 = {
  schemaVersion: "1.0.0";
  indexSignature: string;
  manifestHash: string;
  createdAt: string; // ISO 8601
  entries: number;
  bytes: number;
};
```

`manifestHash` is computed via `computeVfsManifestHash`:
- Single manifest: xxh64 over the manifest file contents.
- Sharded manifest: xxh64 over the ordered `partName:hash` list.
- If the manifest is larger than the hash cap (64 MB), `manifestHash` is null and the cache is disabled.

---

## 3) Entry schema (v1.0.0)

```ts
type VfsColdStartEntryV1 = {
  schemaVersion: "1.0.0";
  virtualPath: string;
  docHash: string;
  diskPath: string;
  sizeBytes: number;
  updatedAt: string; // ISO 8601
};
```

---

## 4) Validation rules

- Cache is usable only when `indexSignature` and `manifestHash` match the current build.
- If `manifestHash` is missing (too large or unavailable), the cache is disabled.
- Each entry is validated on lookup by matching the requested `docHash` and verifying `diskPath` exists.
- Entries with mismatched `docHash` or missing files are ignored.

---

## 5) Eviction

Evict by:
- `maxBytes` (oldest `updatedAt` first), and
- `maxAgeDays`.

## 5.1 Configuration

The cache MAY be controlled via `tooling.vfs.coldStartCache`:

- `enabled` (boolean)
- `maxBytes` (number)
- `maxAgeDays` (number)
- `cacheRoot` (string, optional override)

Defaults:
- `enabled: true` (disabled by default in tests unless explicitly set to `true`).
- `maxBytes: 64MB`
- `maxAgeDays: 7`

---

## 6) Related specs

- `docs/specs/vfs-index.md`
- `docs/specs/vfs-hash-routing.md`
- `docs/specs/vfs-token-uris.md`
- `docs/specs/vfs-io-batching.md`
