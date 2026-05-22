# Spec: VFS segment hash cache (active contract)

Status: Active implemented optional performance cache.
Last audited: 2026-05-21
Implementation anchors: `src/index/build/vfs-segment-hash-cache.js`,
`src/index/tooling/vfs/doc-hash.js`.
Contract coverage: `tests/tooling/vfs/segment-hash-cache.test.js`.

Implementation note: the contract helper and the production doc-hash cache are
split by ownership. Both preserve the same `docHash` definition and bypass
behavior when required identity inputs are unavailable.

Goal: reuse segment `docHash` computations across repeated VFS runs, without changing the hash definition.

Non-goals:
- Change `docHash` format or algorithm.
- Persist segment text or other sensitive content.

---

## 1) Cache key (normative)

Cache entries use the unified cache-key schema:

```
key = buildCacheKey({
  repoHash: `${fileHashAlgo || 'sha1'}:${fileHash}`,
  mode: 'vfs',
  schemaVersion: '1.0.0',
  featureFlags: [`lang:${languageId || 'unknown'}`, `ext:${effectiveExt || ''}`],
  pathPolicy: 'posix',
  extra: { containerPath, range: `${segmentStart}-${segmentEnd}` }
})
```

Requirements:
- `fileHash` MUST be computed over the full container text.
- `languageId` MUST be normalized lowercase.
- `effectiveExt` MUST be the resolved extension for the segment.
- The key MUST change if any of these inputs change.
- If `fileHash` is missing, the cache MUST be bypassed.

---

## 2) Behavior

- Current implementation uses a bounded in-memory map only.
- The cache is an LRU-style map: entries are moved to the end on access.
- Max entries: 50,000 (hard cap). Oldest entries are evicted when the cap is exceeded.
- If `fileHash` is missing, the cache is bypassed.
- On lookup:
  - If `key` is present, reuse `docHash`.
  - If not present, compute `docHash` from the segment text and store it.

Notes:
- The cap is the primary guardrail against unbounded growth under repeated tooling/indexing runs.
- Consumers SHOULD treat cache size/evictions as a perf knob, not as correctness-critical state.

---

## 3) Invariants

- The cache MUST NOT change the `docHash` definition: it is always xxh64 of the exact segment text.
- Any cache hit MUST correspond to identical container text and segment range.

---

## 4) Observability

No dedicated counters are emitted today; use existing VFS logs and metrics.

---

## 5) Related specs

- `docs/specs/vfs-manifest-artifact.md`
- `docs/specs/vfs-cdc-segmentation.md`
