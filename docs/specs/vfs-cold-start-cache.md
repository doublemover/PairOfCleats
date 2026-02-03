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

The JSONL file MAY be sharded for large caches.

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

`manifestHash` is computed over the deterministic `vfs_manifest` content (or its meta+parts list) using xxh64.

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
- Each entry MUST be validated by comparing `docHash` with the manifest row.
- If a mismatch is detected, the entry MUST be discarded.

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

---

## 6) Related specs

- `docs/specs/vfs-index.md`
- `docs/specs/vfs-hash-routing.md`
- `docs/specs/vfs-token-uris.md`
- `docs/specs/vfs-io-batching.md`
