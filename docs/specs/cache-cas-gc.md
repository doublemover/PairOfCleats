# Cache, CAS, and GC spec (Phase 15.6)

## Status

- **Spec version:** 1
- **Audience:** contributors implementing shared cache, CAS, and GC behavior.
- **Implementation status:** planned (design-gated).

---

## 1. Cache taxonomy

Three cache layers:

1. Global cache (models, tooling assets, dictionaries).
2. Repo cache (index builds, sqlite artifacts, embeddings).
3. Workspace cache (workspace manifest, federated query cache).

Each layer has independent retention policy knobs and diagnostics.

---

## 2. CAS design (design gate required)

CAS is only rolled out after design gate completion.

### 2.1 CAS object identity

- Object key: `sha256(content-bytes)`
- Storage path:

```text
<cacheRoot>/cas/objects/<first2>/<next2>/<sha256>
```

### 2.2 CAS metadata

Each object stores:

- hash
- size
- createdAt
- lastAccessedAt
- refCountHint (diagnostic only)

### 2.3 Reference manifests

Reachability is derived from manifests, not mutable counters:

- workspace manifest
- snapshot manifest
- diff manifest
- repo build manifests

---

## 3. GC design gate checklist

Must be complete before deletion is enabled:

1. Lease model for in-flight writers/readers.
2. Mark-and-sweep reachability proof.
3. Crash recovery for interrupted GC.
4. Deterministic deletion ordering.
5. Dry-run output parity with real run decisions.

---

## 4. GC algorithm

### 4.1 Mark phase

1. Enumerate authoritative manifests.
2. Resolve reachable CAS objects.
3. Record mark set and source manifest references.

### 4.2 Sweep phase

Delete only objects:

- not in mark set
- older than grace period
- without active lease

### 4.3 Deletion order

Deterministic:

1. oldest `lastAccessedAt`
2. oldest `createdAt`
3. lexical object hash

---

## 5. Lease protocol

Lease file location:

```text
<cacheRoot>/cas/leases/<objectHash>.json
```

Fields:

- holder id
- startedAt
- ttlMs

GC must skip objects with active leases.

---

## 6. Commands

Primary command:

```text
pairofcleats cache gc --dry-run
```

Required outputs:

- scanned manifest count
- reachable object count
- candidate delete count
- skipped-by-lease count
- deterministic sample of objects

---

## 7. Scale and resource controls

- cap concurrent manifest scans
- cap concurrent deletions
- memory cap for mark sets
- backpressure for multi-repo scans

---

## 8. Touchpoints

- `src/shared/cache.js`
- `tools/index/cache-gc.js`
- `tools/shared/dict-utils.js`
- `docs/guides/commands.md`

---

## 9. Required tests

- `tests/indexing/cache/workspace-global-cache-reuse.test.js`
- `tests/indexing/cache/cas-reuse-across-repos.test.js`
- `tests/tooling/cache/cache-gc-preserves-manifest-referenced.test.js`
- `tests/tooling/cache/cache-gc-respects-active-leases.test.js`
- `tests/indexing/cache/workspace-concurrency-limits.test.js`
