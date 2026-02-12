# Federated query cache spec (Phase 15.5)

## Status

- **Spec version:** 1
- **Audience:** contributors implementing federated cache keying/invalidation.
- **Implementation status:** implemented.

---

## 1. Scope

Defines cache storage, key composition, eviction, invalidation, and concurrency semantics for federated search results.

Cache file location:

```text
<federationCacheRoot>/federation/<repoSetId>/queryCache.json
```

---

## 2. Safety invariants

1. Writes are atomic and crash-safe.
2. Key composition is deterministic and complete.
3. Keys do not include absolute paths.
4. Explicit request differences that can change results must change cache keys.
5. Responses with per-repo fanout failures (partial non-strict results) must not be cached.

---

## 3. Key payload contract

Cache key is computed from:

```text
key = sha1(stableStringify(keyPayload))
```

`keyPayload` must include:

- `repoSetId`
- `manifestHash`
- normalized selection:
  - selected repo ids
  - selected repo priorities (`repoId:priority`) for deterministic tie-break invalidation
  - includeDisabled
  - tags
  - repoFilter
  - explicit selects
- workspace metadata hash:
  - `workspace.configHash` (workspace display/selection metadata fingerprint)
- cohort decision:
  - policy
  - explicit selections
  - selected cohort per mode
- normalized search request:
  - query text
  - modes
  - filters
  - ranking knobs
  - top/perRepoTop
  - merge strategy
- runtime-effective choices:
  - rewritten per-repo args (after federated flag stripping/top rewriting)
  - requested backend / ann knobs
  - `strict` mode flag
  - `debugIncludePaths`
- as-of identity:
  - `asOf.identityHash` (when as-of targeting is used)

Fields that must not influence key:

- volatile timestamps
- display-only labels
- absolute paths

---

## 4. On-disk schema

`queryCache.json`:

```json
{
  "schemaVersion": 1,
  "repoSetId": "ws1-...",
  "updatedAt": "2026-02-11T00:00:00.000Z",
  "entries": {
    "keyHash": {
      "createdAt": "2026-02-11T00:00:00.000Z",
      "lastUsedAt": "2026-02-11T00:00:01.000Z",
      "manifestHash": "wm1-...",
      "keyPayloadHash": "sha1...",
      "result": {}
    }
  }
}
```

`result` should contain the full federated response payload for deterministic replay.

---

## 5. Atomic writes and locking

1. Acquire scoped lock for cache file writes.
2. Write to temp file in same directory.
3. Atomic replace.
4. On read corruption: treat cache as empty and rewrite on next successful write.

## 5.1 Cache eligibility

1. Cache writes are allowed for:
   - successful full fanout responses (no per-repo errors), and
   - deterministic empty-selection responses.
2. Cache writes are skipped for:
   - non-strict partial responses with one or more repo failures,
   - aborted/cancelled requests.

---

## 6. Invalidation

### 6.1 Primary invalidator

- `manifestHash` mismatch invalidates entry.

### 6.2 Secondary invalidators

- `repoSetId` mismatch
- cache schema version mismatch
- explicit key payload mismatch
- as-of identity mismatch

### 6.3 Invalid build pointer handling

If a repo build pointer is invalid/unreadable:

- workspace manifest must treat pointer as missing
- resulting `manifestHash` changes
- stale entries are naturally invalidated

---

## 7. Eviction

Deterministic eviction order:

1. oldest `lastUsedAt`
2. oldest `createdAt`
3. lexical key hash

Config knobs:

- `indexing.federation.queryCache.maxEntries`
- `indexing.federation.queryCache.maxBytes`
- `indexing.federation.queryCache.maxAgeDays`

Expired entries must be removed opportunistically on read and always on write.

---

## 8. Touchpoints

- `src/retrieval/federation/query-cache.js`
- `src/retrieval/federation/coordinator.js`
- `tools/api/router.js`
- `src/workspace/manifest.js`

---

## 9. Required tests

- `tests/retrieval/federation/query-cache-key-stability.test.js`
- `tests/retrieval/federation/query-cache-invalidation-via-manifesthash.test.js`
- `tests/retrieval/federation/build-pointer-invalid-clears-cache.test.js`
- `tests/retrieval/federation/strict-cache-key-separation.test.js`
- `tests/retrieval/federation/partial-failures-not-cached.test.js`
