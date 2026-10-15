# Cache, CAS, and GC spec (Phase 15.6)

## Status

- **Spec version:** 1
- **Audience:** contributors implementing shared cache, CAS, and GC behavior.
- **Implementation status:** implemented baseline (design-gated CAS + manifest-driven GC planner).

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
Before rollout, GC must operate only on existing non-CAS cache surfaces.

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
- inside `<cacheRoot>/cas` (never outside cache root)

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

`--dry-run` must perform full mark/sweep planning and emit the same candidate list as a real run.

---

## 7. Scale and resource controls

- cap concurrent manifest scans
- cap concurrent deletions
- memory cap for mark sets
- backpressure for multi-repo scans

---

## 8. Touchpoints

- `src/shared/cache-cas/paths.js`
- `src/shared/cache-cas/metadata.js`
- `src/shared/cache-cas/objects.js`
- `src/shared/cache-cas/gc.js`
- `src/shared/cache-cas/leases.js`
- `src/shared/cache/layers.js`
- `tools/index/cache-gc.js`
- `tools/shared/dict-utils.js`
- `docs/guides/commands.md`

---

## 9. Required tests

- `tests/shared/cache/contract-matrix.test.js`
- `tests/tooling/cache/gc-contract-matrix.test.js`

## Preview accounting

Both CAS and legacy quota/age GC default to preview; deletion requires `--apply` and is suppressed by `--dry-run`. CAS reports actual object bytes scanned, reachable, protected by active leases, eligible, planned, and deleted. Preview `deleted` bytes are zero. Legacy `plannedBytes` is separate from actual `freedBytes`. CAS lease protection applies to its object planner; whole-repository deletion uses the local process admission protocol described below. Status reports snapshot bytes separately within repository cache usage; artifact breakdowns overlap the repository total and must not be added to it.

The MCP `cache_gc` tool also previews when `dryRun` is omitted; explicit `dryRun: false` maps to `--apply`.

### Cache path authority

Cleanup checks ownership and containment after normalizing only verified macOS
system aliases: root-owned `/var` and `/tmp` symlinks whose canonical destinations
are exactly `/private/var` and `/private/tmp`. Tooling cache storage shares this
same policy. All remaining path components stay lexical and must pass the
no-symlink checks, including the cache root, its other ancestors, the ownership
marker, and the target. Resolving an entire authorized root with `realpath` is not
an equivalent authorization check. Preview or explicit unmarked-cache permission
waives the marker requirement only; it does not waive containment or link checks.


### Whole-repository admission protocol (2026-10-15)

Repository cache access retains a process-lifetime lease outside the removable
`repos/<id>` tree, under `repo-access/<canonical-path-hash>/leases`. Standard
cache path resolution and explicit artifact/SQLite/LMDB readers participate.
A collector takes an external `cleanup.lock` before checking leases; a reader
creates its lease before checking that lock. New readers receive
`ERR_REPO_CACHE_CLEANUP_BUSY` before opening cache data during cleanup. Existing
readers, indexers and watchers keep their cache protected until process exit,
including idle sessions retaining handles. Live leases never expire on a timer.
Dead local lease owners are reaped; malformed, unreadable and foreign owners
remain protected. Legacy writer locks are also checked inside the barrier.

This is a cooperating, single-host protocol with writable coordination storage.
Stop clients running older versions before first using online cleanup. It cannot
coordinate arbitrary external readers or multi-host shared filesystems. A crashed
collector can leave its exclusion lock: rerun GC to reclaim a verified dead local
owner; do not manually remove a lock belonging to a live process. Unknown owners
require investigation. No cache deletion or process termination is implied by
status queries.

Repo GC reports `coordination: process-leases-v1`, includes protected repositories
and their measured bytes in quota planning, and reports `remainingBytes`,
`projectedRemainingBytes`, and `quotaSatisfied`. Protected caches can prevent a
quota from being satisfied; they are never evicted to force it. Without a size
scan, total/remaining byte values are unknown (`null`). Preview remains the
default and reports zero actually freed bytes. CAS object GC keeps its existing
separate reachability/lease protocol.
