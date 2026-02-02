# SPEC -- Phase 14: As‑Of Retrieval Integration (Time‑Travel Search) (Refined)

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
`[search] as-of: snap:snap-... (identity <sha1>)`

---

## 1. Integration strategy

### 1.1 New "as-of context"
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
Phase 14 MUST *not* rewrite the search stack. Instead it should:
- Compute an explicit `indexRootOverride` per mode from `ResolvedIndexRef`
- Pass that override into existing helpers (or add a small optional parameter where necessary)

---

## 2. Exact code touchpoints

### 2.1 CLI entrypoint and argument parsing
The current CLI stack does not strictly reject unknown flags (`createCli` uses `strict(false)`), so no wrapper allowlist is required for `--as-of`.

Requirements:
- Add parsing support for `--as-of` in `src/retrieval/cli-args.js`
- Ensure it is threaded into the retrieval pipeline from `src/retrieval/cli.js`

If the wrapper (`bin/pairofcleats.js`) ever becomes strict for `search`, update it accordingly.
(As of this spec version, it is not strict.)

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

Add a helper in `src/retrieval/cli-index.js`:

```ts
resolveIndexDirAsOf({ repoRoot, userConfig, mode, asOfContext }) -> string
```

Rules:
- Determine `indexBaseRoot = asOfContext.resolved.indexBaseRootByMode[mode]`
- If missing: throw `NO_INDEX` unless the search mode does not require that mode.
- Return `path.join(indexBaseRoot, 'index-' + mode)` (or use `getIndexDir` with an explicit `indexRoot` override)

### 2.5 SQLite/LMDB backend selection with as-of (single-root constraint)

Policy:
1. File-backed ("memory") backend supports per-mode base roots.
2. SQLite and LMDB backends require a single base root:
   - Prefer `code` base root if present, else first requested mode.
   - If requested modes resolve to multiple base roots, treat sqlite/lmdb as unavailable unless explicitly forced.

### 2.6 Query-cache key hardening
Update cache key derivation to include:
- `asOf.identityHash` (required)

### 2.7 Unify index signature computation
Make `src/retrieval/cli-index.js` use `src/retrieval/index-cache.js#buildIndexSignature` to avoid drift and ensure shard-aware correctness.

---

## 3. Edge cases and rules

### 3.1 Snapshot missing a requested mode
If multiple modes are requested but the resolved IndexRef lacks one of them:
- If required: throw `NO_INDEX`
- Else: warn and continue

### 3.2 Dangling pointer snapshots
If pointer snapshot references a missing build root, resolution fails with a clear error.

### 3.3 Frozen snapshot integrity
Frozen snapshots are assumed immutable; retrieval must not repair them.

### 3.4 Telemetry
When telemetry is emitted, include:
- `asOf.type`
- `asOf.identityHash` (first 8 chars)
Do NOT include raw paths.

---

## 4. Test plan

### 4.1 Unit tests
- Parse `--as-of` string and normalization.
- Resolved identityHash changes when changing snapshot id.

### 4.2 Integration tests
- Search latest vs search --as-of snap:... yields different `asOf.identityHash`.
- Forced sqlite with multi-root as-of fails clearly.
- Query cache entries differ across as-of values.
