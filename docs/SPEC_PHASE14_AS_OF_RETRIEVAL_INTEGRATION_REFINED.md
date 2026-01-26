# SPEC — Phase 14: As‑Of Retrieval Integration (Time‑Travel Search) (Refined)

> **Scope**: Extend `pairofcleats search` to query historical index versions via `--as-of <IndexRef>`, leveraging the Phase 14 IndexRef + snapshot registry.
>
> **Goal**: Make time‑travel retrieval deterministic, cache-safe, and minimally invasive to existing retrieval code.

---

## 0. User-facing behavior

### 0.1 New CLI flag
`pairofcleats search "<query>" --repo <path> --mode <mode> --as-of <IndexRef>`

Examples:
- `--as-of latest` (default)
- `--as-of build:20260124T000000Z_abcdef0_1234abcd`
- `--as-of snap:snap-20260124010101-acde12`
- `--as-of tag:release/v1.2.3`

### 0.2 Defaults
- If `--as-of` is omitted, behavior MUST remain identical to today (use `latest` resolution).
- `--as-of latest` is equivalent to not specifying `--as-of`.

### 0.3 Output
When `--json` output is enabled, include an `asOf` object:

```json
{
  "asOf": {
    "ref": "snap:snap-...",
    "identityHash": "<sha1>",
    "resolved": {
      "type": "snapshot",
      "snapshotId": "snap-...",
      "buildIdByMode": { "code": "20260124T000000Z_abcdef0_1234abcd" }
    }
  }
}
```

Human output SHOULD print a single line:
`[search] as-of: snap:snap-… (identity <sha1>)`

---

## 1. Integration strategy

### 1.1 New “as-of context”
At CLI startup, parse and resolve `--as-of` once and store an immutable context:

```ts
type AsOfContext = {
  ref: string;                 // canonical IndexRef
  resolved: ResolvedIndexRef;  // from IndexRef resolver
  identityHash: string;        // resolved.identityHash
};
```

All later filesystem index resolution MUST be based on this context.

### 1.2 Minimal changes to existing code paths
Today the retrieval CLI resolves index directories using:
- `tools/dict-utils.js#resolveIndexRoot(...)`
- `tools/dict-utils.js#getIndexDir(...)`
- `src/retrieval/cli-index.js#resolveIndexDir(...)`

Phase 14 MUST *not* rewrite the search stack. Instead, it should:
- Compute an explicit `indexRootOverride` per mode from `ResolvedIndexRef`.
- Pass that override into existing helpers (or add a small optional parameter where necessary).

---

## 2. Exact code touchpoints

### 2.1 CLI wrapper must allow the new flag
`bin/pairofcleats.js` currently rejects unknown flags for `search`.

Update:
- Add `as-of` to the allowed flags list for `search`.
- Mark it as a value flag.

This is mandatory; otherwise `pairofcleats search --as-of …` will fail before reaching the JS parser.

### 2.2 Parse args
Update `src/retrieval/cli-args.js` options to include:

- `asOf: { type: 'string' }`

Normalize:
- If missing or empty -> treat as `latest`
- Else parse via `parseIndexRef`

### 2.3 Resolve AsOfContext
In `src/retrieval/cli.js` early in execution (after repoRoot + userConfig are known):

1. `asOfInput = argv['as-of'] || 'latest'`
2. `parsed = parseIndexRef(asOfInput)`
3. `resolved = resolveIndexRef({ repoRoot, userConfig, requestedModes, preferFrozen:true, allowMissingModes:false })`
4. `asOfContext = { ref: resolved.canonical, resolved, identityHash: resolved.identityHash }`

Where `requestedModes` should be derived from the run flags (`runCode`, `runProse`, `runExtractedProse`, `runRecords`).

### 2.4 Use AsOfContext for file-backed index resolution

Add a new helper in `src/retrieval/cli-index.js`:

```ts
resolveIndexDirAsOf({ repoRoot, userConfig, mode, asOfContext }) -> string
```

Rules:
- Determine `indexBaseRoot = asOfContext.resolved.indexBaseRootByMode[mode]`
- If missing: throw `NO_INDEX` unless the search mode does not require that mode.
- Return `path.join(indexBaseRoot, 'index-' + mode)` (or use `getIndexDir` with an explicit `indexRoot` override)

Implementation note:
- You can reuse `tools/dict-utils.js#getIndexDir(repoRoot, userConfig, { mode, indexRoot })`
  by passing `indexRoot = indexBaseRoot`.

### 2.5 SQLite/LMDB backend selection with as-of

**Important constraint**: current SQLite/LMDB path resolvers assume a *single* `indexRoot` that contains:
- `index-sqlite/index-code.db`, `index-prose.db`, etc.
- `index-lmdb/index-code`, etc.

But `latest` can resolve per-mode base roots via `buildRoots`, and snapshots can too.

Phase 14 must implement the following policy:

1. For **file-backed (“memory”)** backend:
   - Fully supports per-mode base roots.

2. For **sqlite** backend:
   - Determine `sqliteBaseRootCandidate`:
     - Prefer `resolved.indexBaseRootByMode.code`, else `prose`, else first requested mode.
   - If `code` and `prose` are both requested and their base roots differ:
     - Treat sqlite as **unavailable** (fallback) unless `--backend sqlite` was explicitly forced.
   - When using sqlite, call:
     - `resolveSqlitePaths(repoRoot, userConfig, { indexRoot: sqliteBaseRootCandidate })`

3. For **lmdb** backend:
   - Same logic as sqlite, but call:
     - `resolveLmdbPaths(repoRoot, userConfig, { indexRoot: lmdbBaseRootCandidate })`

This yields correct behavior without invasive per-mode DB plumbing.

### 2.6 Query-cache key hardening
The query cache must never collide across different `--as-of` values.

Update `src/retrieval/cli-index.js#buildQueryCacheKey(...)` (or its replacement) to include:
- `asOfIdentityHash` (required)
- `asOfRef` (optional, for readability)

Canonical cache payload example:
```json
{
  "v": 2,
  "asOf": { "ref": "snap:snap-...", "identityHash": "<sha1>" },
  "mode": "code",
  "query": "...",
  "filters": {...},
  "backend": "sqlite"
}
```

Hash the stable stringified payload to form the cache key.

### 2.7 Unify index signature computation
Currently there are two signature implementations:
- `src/retrieval/index-cache.js#buildIndexSignature`
- `src/retrieval/cli-index.js#getIndexSignature`

Phase 14 MUST eliminate drift by making the CLI path use the `index-cache` implementation.

Requirement:
- Any modification to a sharded file (e.g., `chunk_meta.parts/*`) MUST change the signature.

---

## 3. Edge cases and rules

### 3.1 Snapshot missing a requested mode
If `--mode all` (or multiple modes) are requested but the resolved IndexRef lacks one of them:

- If that mode is required by the query flags: throw `NO_INDEX`.
- If it is not required: emit a warning and continue.

### 3.2 Dangling pointer snapshots
A pointer snapshot may reference a build root that was pruned.

Resolver behavior:
- If pointer build root is missing, treat snapshot as not resolvable and return `NOT_FOUND` with message:
  - `Snapshot <id> references missing build root <relativeRoot>.`

### 3.3 Frozen snapshot integrity
Frozen snapshots are assumed immutable. Retrieval MUST NOT attempt to “repair” them.
If required artifacts are missing, return `NO_INDEX` with a clear list.

### 3.4 Telemetry
When telemetry is emitted, include:
- `asOf.type` (latest/build/snapshot/tag/path)
- `asOf.identityHash` (first 8 chars)  
Do NOT include raw paths.

---

## 4. Test plan

### 4.1 Unit tests
- Parse `--as-of` string and normalization.
- Resolved identityHash changes when changing snapshot id.

### 4.2 Integration tests
- Build + promote two builds, create a snapshot, then:
  - Search latest vs search --as-of snap:... yields different `asOf.identityHash`.
- When `--backend sqlite` is forced and roots differ, search fails with clear message.
- Query cache entries differ across as-of values (same query, different asOf => different cache key).

