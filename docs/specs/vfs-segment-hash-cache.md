# Spec: VFS segment hash cache (draft)

Status: Draft (Milestone A). Optional performance cache.

Goal: reuse segment `docHash` computations across repeated VFS runs, without changing the hash definition.

Non-goals:
- Change `docHash` format or algorithm.
- Persist segment text or other sensitive content.

---

## 1) Cache key (normative)

Cache entries are keyed by immutable container identity + segment range:

```
key = `${fileHashAlgo || 'sha1'}:${fileHash}::${languageId || 'unknown'}::${effectiveExt || ''}::${segmentStart}-${segmentEnd}`
```

Requirements:
- `fileHash` MUST be computed over the full container text.
- `languageId` MUST be normalized lowercase.
- `effectiveExt` MUST be the resolved extension for the segment.
- The key MUST change if any of these inputs change.
- If `fileHash` is missing, the cache MUST be bypassed.

---

## 2) Entry schema (v1.0.0)

```ts
type VfsSegmentHashCacheEntryV1 = {
  schemaVersion: "1.0.0";
  key: string;
  fileHash: string;
  fileHashAlgo: string;
  languageId: string;
  effectiveExt: string;
  segmentStart: number;
  segmentEnd: number;
  docHash: string; // "xxh64:<hex16>"
  updatedAt: string; // ISO 8601
};
```

---

## 3) Behavior

- In-memory LRU cache is the default (bounded by `maxEntries`).
- Current implementation uses a bounded in-memory map only.
- Optional disk persistence MAY store JSONL entries under the cache root:
  - `cacheRoot/vfs-segment-hash-cache.jsonl`
- On lookup:
  - If `key` is present, reuse `docHash`.
  - If not present, compute `docHash` from the segment text and store it.

---

## 4) Invariants

- The cache MUST NOT change the `docHash` definition: it is always xxh64 of the exact segment text.
- Any cache hit MUST correspond to identical container text and segment range.

---

## 5) Observability

Emit counters:
- `vfs_segment_hash_cache_hits`
- `vfs_segment_hash_cache_misses`
- `vfs_segment_hash_cache_evictions`

---

## 6) Related specs

- `docs/specs/vfs-manifest-artifact.md`
- `docs/specs/vfs-cdc-segmentation.md`
