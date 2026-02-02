# Federation cohort gating spec (Phase 15.4)

## Status

- **Spec version:** 1
- **Audience:** PairOfCleats contributors implementing federated search cohorting (CLI/API/MCP).
- **Depends on:** `docs/contracts/compatibility-key.md`, `docs/specs/federated-search.md`, `docs/specs/workspace-manifest.md`.

This spec defines how federated search partitions repos into **cohorts** to avoid mixing search results from materially incompatible index contracts by default, while keeping behavior deterministic and debuggable.

---

## 1. Goals and non-goals

### 1.1 Goals

1. Partition selected repos **per mode** into cohorts keyed by a compatibility fingerprint.
2. Default behavior is **safe-by-default**:
   - never silently mix cohorts in a single merged result list,
   - always emit warnings and diagnostics when repos are excluded.
3. Provide deterministic overrides:
   - explicitly select a cohort,
   - require a single cohort (strict),
   - allow unsafe mixing (opt-in and loud).
4. Keep behavior deterministic across runs for identical inputs.

### 1.2 Non-goals

- Making incompatible indexes readable. If a repo’s index cannot be loaded by the current runtime, cohorting does not “fix” that.
- Guaranteeing cross-repo score comparability. Federated merge is rank-based (RRF).

---

## 2. Key concept: `cohortKey` (mode-scoped)

The existing `compatibilityKey` is a **build-level** fingerprint and may vary when the set of built modes changes, even if the mode-specific invariants are identical.

For federation, we define a separate **mode-scoped** key:

- `cohortKey`: a fingerprint used only for federation cohorting.
- Stored in `<indexDir>/index_state.json` as `cohortKey`.

Back-compat:

- If `cohortKey` is absent, federation falls back to `compatibilityKey`.
- If both are absent, the repo is treated as `cohortKey = null` and will generally be excluded unless selected by policy.

### 2.1 `cohortKey` derivation (normative)

`cohortKey` MUST be computed at index time, per mode, from the same input family as `compatibilityKey`, but scoped so it does not change merely because *other modes* were built.

Recommended payload (v1):

```js
payload = {
  artifactSurfaceMajor,           // from ARTIFACT_SURFACE_VERSION (major only)
  schemaHash,                     // ARTIFACT_SCHEMA_HASH
  tokenizationKey,                // buildTokenizationKey(runtimeSnapshot, mode)
  embeddingsKey,                  // buildEmbeddingsKey(runtime)
  languagePolicyKey,              // buildLanguagePolicyKey(runtime)
  chunkIdAlgoVersion,             // CHUNK_ID_ALGO_VERSION
  sqliteSchemaVersion,            // SQLITE schema version
  mode                            // "code" | "prose" | "extracted-prose" | "records"
}
cohortKey = sha1(stableStringify(payload))
```

Notes:

- `tokenizationKey` is mode-specific (already computed during build).
- This design avoids cohort fragmentation when one repo builds `code` only and another builds `code+prose`.

### 2.2 Storage

Write into `<indexDir>/index_state.json`:

```json
{
  "compatibilityKey": "<sha1>",
  "cohortKey": "<sha1>",           // new field
  "...": "..."
}
```

---

## 3. Inputs to cohort gating

Cohort gating operates on:

- `selectedRepos` (after selection filters)
- `workspaceManifest` entries for those repos
- the set of modes requested by the query (code/prose/extractedProse/records)

For each repo and mode, the manifest provides:

- `present` (index exists)
- `cohortKey` (preferred; may be null)
- `compatibilityKey` (fallback; may be null)

Define the **effective cohort key**:

```
effectiveKey = cohortKey ?? compatibilityKey ?? null
```

---

## 4. Partitioning algorithm (per mode)

For each requested mode `m`:

1. Consider only repos with `manifest.repos[i].indexes[m].present === true`.
2. For each such repo, compute `effectiveKey` (above).
3. Group repos into `cohorts[m][effectiveKey] = [repoIds...]`.

Ordering rules:

- Repos within a cohort MUST be ordered deterministically by the selection sort order (priority desc, alias asc, repoId asc).
- Cohorts MUST be ordered deterministically by:
  1. larger cohort size first,
  2. higher sum(priority) first,
  3. `effectiveKey` lexicographic (null last),
  4. smallest member `repoId`.

---

## 5. Cohort gating policies

Federated search MUST implement these policies.

### 5.1 Default policy (`policy="default"`)

For each mode:

- If there are **0** cohorts (no repos have that mode present): proceed; return empty results for that mode.
- If there is **1** cohort: query it.
- If there are **2+** cohorts:
  - Choose the **highest-ranked cohort** per ordering rules in §4.
  - Exclude all repos in other cohorts for that mode.
  - Emit warning:

`WARN_FEDERATED_MULTI_COHORT` with fields:
- `mode`
- `chosenKey`
- `excludedRepoIds` (sorted by repoId)
- `excludedByKey` (map key → repoId[]; keys sorted)

Additionally:
- If any excluded repos had `effectiveKey=null`, emit `WARN_FEDERATED_MISSING_COHORT_KEY`.

### 5.2 Strict policy (`policy="strict"` / `--require-single-cohort`)

For each mode:

- If there are **2+** cohorts, federation MUST fail the request with:

`ok=false`, `code="ERR_FEDERATED_MULTI_COHORT"`

The error MUST include:
- the mode(s) that were multi-cohort
- the distinct cohort keys observed and which repos are in each

### 5.3 Explicit cohort selection (`policy="selected"`)

The caller may select a cohort key explicitly.

CLI forms (recommended):

- `--cohort <key>` (applies to all requested modes)
- `--cohort <mode>:<key>` (mode-specific)

API form:

```json
"cohort": {
  "policy": "selected",
  "byMode": { "code": "<key>", "prose": "<key>" }
}
```

Rules:

- If the selected key does not exist for that mode, return `ok=false`, `code="ERR_FEDERATED_COHORT_NOT_FOUND"`.
- If selection is provided for some modes but not others, unspecified modes follow the **default** policy.

### 5.4 Unsafe mixing (`policy="unsafeMix"` / `--allow-unsafe-mix`)

When enabled:

- Do not exclude repos due to cohort mismatches.
- Still record cohort structure in response meta and emit a loud warning:

`WARN_FEDERATED_UNSAFE_MIXING`

This policy does **not** override hard failures from unreadable indexes; repos that error still report errors via per-repo diagnostics.

---

## 6. Response meta requirements

Federated responses MUST record cohort decisions without leaking absolute paths:

Add to `meta.cohort` (matching the shape already suggested in `docs/specs/federated-search.md`):

```ts
meta.cohort = {
  policy: "default"|"strict"|"selected"|"unsafeMix",
  byMode: Record<string, {
    chosenKey: string|null,
    excludedRepoIds: string[],
    excludedByKey?: Record<string, string[]>
  }>
}
```

Notes:
- `excludedByKey` is optional but recommended for debugging.
- Do not include repoRootCanonical unless debug.includePaths=true at the API layer.

---

## 7. Implementation guidance

### 7.1 Minimal code changes required

1. Add `cohortKey` computation at build time (alongside `compatibilityKey`):
   - recommended: extend `src/contracts/compatibility.js` with `buildCohortKey({ runtime, mode, tokenizationKey })`
   - compute in `src/integrations/core/build-index/compatibility.js` after tokenization keys are derived
2. Persist `cohortKey` into `index_state.json` in the index writer step.
3. Update workspace manifest generation to read `cohortKey` from `index_state.json` and include it per mode.
4. Update the federation coordinator to use `effectiveKey = cohortKey ?? compatibilityKey ?? null`.

---

## 8. Required spec updates (to stay consistent)

### 8.1 Update `docs/specs/workspace-manifest.md`

In §4.5 `indexes` mode entry, add:

- `cohortKey: string | null` (in addition to compatibilityKey)

And in manifestHash computation (§6), include `cohortKey` (so cohort changes invalidate federation caches).

### 8.2 Update `docs/specs/federated-search.md`

Where it says “Partition selected repos per mode by compatibilityKey”, update to:

- “Partition by cohortKey (fallback: compatibilityKey).”

---

## 9. Tests (must be automated)

1. Cohort partitioning determinism:
   - fixed inputs yield fixed `chosenKey` and fixed exclusions.
2. Default policy excludes non-chosen cohorts and emits `WARN_FEDERATED_MULTI_COHORT`.
3. Selected policy:
   - selects a valid cohort key
   - errors when key not present
4. Unsafe mixing policy:
   - includes repos from multiple cohorts and emits `WARN_FEDERATED_UNSAFE_MIXING`.
5. Back-compat:
   - when cohortKey missing, coordinator falls back to compatibilityKey.
