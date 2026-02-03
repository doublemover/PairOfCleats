# Federated search spec (Phase 15.3)

## Status

- **Spec version:** 1
- **Audience:** PairOfCleats contributors implementing federated search coordination for CLI/API/MCP.

This spec defines the orchestration layer (selection → fanout → merge → response) and is designed to reuse existing single-repo search functionality (`src/integrations/core/index.js` → `runSearchCli`).

---

## 1. Goals and constraints

### 1.1 Goals

1. Add **workspace-aware search** that queries multiple repos in one operation.
2. Ensure every result is **unambiguous**:
   - each hit includes `repoId` and `repoAlias` (if configured),
   - collisions in `relPath` across repos remain unambiguous.
3. Ensure federated results are **deterministic**:
   - stable selection semantics,
   - stable merge semantics (documented tie-breakers),
   - stable JSON output (byte-identical across repeated runs on same state).
4. Be resilient:
   - missing indexes or per-repo errors MUST be surfaced in per-repo diagnostics,
   - a subset of repos failing MUST NOT fail the entire request by default.

### 1.2 Constraints (from existing codebase)

- Single-repo search is implemented via `runSearchCli` (`src/retrieval/cli.js`) and returns a payload shaped like:
  - `{ backend, code, prose, extractedProse, records, stats? }`
- `runSearchCli` can be called programmatically with:
  - `emitOutput: false` to avoid console output,
  - `exitOnError: false` to prevent process exit,
  - caches (`indexCache`, `sqliteCache`) to reuse across calls.

---

## 2. Glossary

- **Workspace**: the resolved workspace config (Phase 15.1) and manifest (Phase 15.2).
- **Selected repos**: repos after applying workspace selection rules.
- **Fanout**: running per-repo search sessions concurrently.
- **Cohort**: a group of repos whose index `compatibilityKey` matches for a given mode (Phase 15.4).
- **Merge**: deterministic combination of per-repo ranked result lists into a single list per mode.

---

## 3. Interfaces

Federated search MUST be exposed consistently through:

1. **CLI**: `pairofcleats search --workspace <path> "<query>" ...`
2. **API server**: a dedicated endpoint (recommended) returning JSON payload.
3. **MCP**: a dedicated tool (`search_workspace`) returning JSON payload.

All three MUST use the same coordinator implementation.

---

## 4. CLI contract

### 4.1 Command

```
pairofcleats search --workspace <workspaceFile> "<query>" [searchFlags...] [workspaceFlags...]
```

- `--workspace` switches the search command into **federated mode**.
- The query string is positional (same as current CLI).

### 4.2 Workspace flags

| Flag | Type | Repeatable | Default | Meaning |
|---|---:|---:|---:|---|
| `--workspace` | string | no | -- | Path to workspace JSONC file. Required for federated mode. |
| `--select` | string | yes | `[]` | Include repos matching any value (alias, repoId, or path). |
| `--tag` | string | yes | `[]` | Include repos that have **any** of the tags (OR). |
| `--repo-filter` | string | yes | `[]` | Include repos matching any glob (alias, repoId, or repoRootCanonical). |
| `--include-disabled` | boolean | no | `false` | Include disabled repos in baseline selection (see §6). |
| `--merge` | string | no | `"rrf"` | Merge strategy: `rrf` (v1). |
| `--top-per-repo` | integer | no | `null` | Override per-repo topK before merge. |
| `--concurrency` | integer | no | `4` | Max concurrent per-repo searches. |

### 4.3 Search flags

All existing search flags MUST remain valid and MUST be forwarded to each per-repo search session, except where explicitly overridden by the coordinator (§7.4).

Examples (non-exhaustive):
- `--mode`, `--top`, `--backend`, `--filter`, `--json`, `--compact`, `--stats`, `--explain`, etc.

### 4.4 Forbidden combinations (no ambiguity)

If `--workspace` is present:

- `--repo` (single-repo root flag) MUST be rejected to avoid ambiguity.
  - error: `ERR_FEDERATED_REPO_FLAG_NOT_ALLOWED`
- If both `--workspace` and `--workspace=<...>` are provided with conflicting values (e.g., duplicated flags), error.

### 4.5 Output behavior

- In federated mode, JSON output is the canonical contract.
- If the user does not pass `--json`, the CLI MAY still print a human-readable merged view; however, correctness testing and API/MCP should always use JSON.

---

## 5. API server contract

### 5.1 Endpoint

Recommended: add a dedicated endpoint to avoid breaking single-repo search contract.

- `POST /search/federated`

### 5.2 Request body (v1)

```json
{
  "workspacePath": "/abs/path/.pairofcleats-workspace.jsonc",
  "query": "risk:sql injection",
  "search": {
    "mode": "all",
    "top": 10,
    "backend": "auto",
    "filter": null,
    "compact": true,
    "stats": false
  },
  "select": {
    "repos": ["poc", "svc-a"],
    "tags": ["service"],
    "repoFilter": ["svc-*"],
    "includeDisabled": false
  },
  "merge": { "strategy": "rrf", "rrfK": 60 },
  "limits": { "perRepoTop": 20, "concurrency": 4 }
}
```

Rules:
- The API layer MUST enforce the same repo-root allowlist constraints as single-repo mode (see `tools/api/router.js`) **for every repo root used**.
- The response is always JSON.

---

## 6. Repo selection semantics (fully specified)

Selection must be deterministic and composable. Define three sets:

- `allRepos`: all repos in workspace config.
- `baselineRepos`: repos eligible by default.
- `selectedRepos`: repos to query.

### 6.1 Baseline eligibility

Let `enabledRepos = allRepos where enabled=true`.

- If `includeDisabled=false` (default):
  - `baselineRepos = enabledRepos`
- If `includeDisabled=true`:
  - `baselineRepos = allRepos`

### 6.2 Explicit includes (`--select`)

If `--select` is present (non-empty), it defines an explicit include set:

A repo matches a select token if the token equals (case-insensitive):

- `alias`, OR
- `repoId`, OR
- a token that can be resolved to a path which canonicalizes to the repo's `repoRootCanonical`.

**Important rule:** Explicit selection can include disabled repos even when `includeDisabled=false`.

Compute:

- `explicitRepos = { repos that match any select token }`

Then:

- if selects exist: `candidateRepos = baselineRepos ∪ explicitRepos`
- else: `candidateRepos = baselineRepos`

### 6.3 Tag filters (`--tag`)

If one or more tags are provided:

- normalize tags to lowercase and trim,
- a repo passes tag filter if it has **any** of the provided tags (OR).

Then:

- `candidateRepos = candidateRepos ∩ reposWithAnyTag`

### 6.4 Repo-filter globs (`--repo-filter`)

If one or more glob patterns are provided:

- use `picomatch` with `{ nocase: true, dot: true }`,
- a repo matches if any glob matches any of:
  - `repoId`,
  - `alias` (or empty string),
  - `repoRootCanonical`.

Then:

- `candidateRepos = candidateRepos ∩ reposMatchingAnyGlob`

### 6.5 Final selected list

`selectedRepos = candidateRepos`, sorted deterministically by:

1. higher `priority`,
2. then `alias` (empty string last),
3. then `repoId`.

Coordinator MUST also include:

- `selectedRepoIds = selectedRepos.map(r => r.repoId).sort()` (sorted by repoId) in response meta for caching/debugging.

### 6.6 Empty selection

If `selectedRepos` is empty:
- Return `ok:true` with empty hit arrays.
- Add warning `WARN_FEDERATED_EMPTY_SELECTION`.

---

## 7. Coordinator algorithm

### 7.1 Inputs

Coordinator input MUST include:

- resolved workspace config (Phase 15.1),
- workspace manifest (Phase 15.2),
- normalized search request (query, search flags, selection, merge, limits),
- (optional) AbortSignal.

### 7.2 Outputs

Coordinator returns a single federated payload:

- merged results per mode,
- per-repo diagnostics,
- meta (repoSetId, manifestHash, selection, merge strategy).

### 7.3 Steps (normative)

1. Load and resolve workspace config via `loadWorkspaceConfig(workspacePath)`.
2. Generate or read workspace manifest via `generateWorkspaceManifest(configResolved)`.
3. Apply selection rules (§6) to obtain `selectedRepos`.
4. Apply cohort gating (Phase 15.4):
   - Partition selected repos per mode by `compatibilityKey`.
   - Choose the cohort to query per mode, per gating policy.
   - Record excluded repos/modes in diagnostics.
5. Compute effective limits:
   - `topN = normalizedSearch.top` (default 10).
   - `perRepoTop`:
     - if provided by user (`--top-per-repo`), use it,
     - else default to `min(max(topN * 2, topN), 50)`.
6. Fanout:
   - Run per-repo searches with concurrency limit.
   - Each per-repo search MUST be called with `emitOutput:false` and `exitOnError:false`.
   - Share `indexCache` and `sqliteCache` across all calls.
7. Merge:
   - Merge per-mode result lists with deterministic policy (RRF) (§8).
8. Construct response:
   - Add repo attribution to hits.
   - Include `repos[]` diagnostics.
   - Include meta fields required for debugging/caching.
9. Return.

### 7.4 Per-repo forwarded args and coordinator overrides (critical)

The coordinator MUST build **per-repo raw args** as follows:

1. Start from the original raw CLI args (or API-equivalent).
2. Remove workspace-only flags:
   - `--workspace`
   - `--select`
   - `--tag`
   - `--repo-filter`
   - `--include-disabled`
   - `--merge`
   - `--top-per-repo`
   - `--concurrency`
3. Force `--json` ON for per-repo execution to reduce payload size and strip token arrays:
   - if `--json` is absent, append `--json`.
4. Override `--top` for per-repo execution to `perRepoTop`:
   - if `--top` is present, replace its value,
   - if absent, append `--top <perRepoTop>`.

The final merged response uses the user's global `top` (topN), not `perRepoTop`.

Implementation notes:
- Handle `--top=10` and `--top 10` forms.
- If multiple `--top` occurrences exist, treat as an error (`ERR_FEDERATED_DUPLICATE_TOP_FLAG`) rather than guessing.

---

## 8. Merge semantics (RRF, deterministic)

Federated merge is performed **per mode independently** (`code`, `prose`, `extractedProse`, `records`).

### 8.1 Why RRF

Raw score values from different repos and/or different backends are not reliably comparable. Rank-based merging is safer and more stable.

### 8.2 Inputs per mode

For each repo `r`, the coordinator obtains an ordered list:

- `L_r = hits_r_mode` (already ranked by that repo's search).

Before merge:
- truncate each list to `perRepoTop`.

### 8.3 RRF score

For a hit at rank `i` (0-based) in its repo list:

- `rrfScore = 1 / (rrfK + (i + 1))`

Default:
- `rrfK = 60`

Since each hit appears in only one list, the merged score is that single term.

### 8.4 Deterministic tie-breakers

When two hits have equal `rrfScore` (common at identical ranks across repos), break ties by:

1. higher `repo.priority` (descending)
2. `repo.repoId` (ascending lexicographic)
3. `hit.id` (ascending lexicographic)
4. `hit.file` (ascending)
5. `hit.start` (ascending numeric)
6. stable original insertion index (as last resort)

This MUST be implemented as a pure comparator; do not rely on engine sort stability.

### 8.5 Output selection

After scoring and sorting, output:

- top `topN` hits per mode.

### 8.6 Hit attribution and global ids

Every output hit MUST be augmented with:

- `repoId`
- `repoAlias` (nullable)
- `globalId` = `${repoId}:${hit.id}`

The response MAY also include `repoRootCanonical` at the repo-diagnostics level, but caches SHOULD avoid embedding absolute paths (see federated caching spec).

---

## 9. Per-repo execution details

### 9.1 How to call per-repo search

Preferred call shape (reusing core integration):

```js
import { search as coreSearch } from '../integrations/core/index.js';

const payload = await coreSearch(repoRootCanonical, {
  args: perRepoArgs,
  emitOutput: false,
  exitOnError: false,
  indexCache,
  sqliteCache,
  signal
});
```

Notes:
- `repoRootCanonical` MUST be the canonical root from workspace config resolution.
- `perRepoArgs` MUST already have `--json` and `--top` rewritten per §7.4.

### 9.2 Error handling

If a repo search throws:

- Record an entry in `repos[]` diagnostics with:
  - `status="error"`
  - `error.code` (use `err.code` if it is a known error code)
  - `error.message`
- Do not fail the entire request unless:
  - workspace config/manifest loading fails, OR
  - **all** repos fail.

If error code is `NO_INDEX`, status should be `missing_index` (non-fatal).

---

## 10. Response shape (JSON)

### 10.1 Top-level

Federated response MUST be JSON with this shape:

```ts
type FederatedSearchResponseV1 = {
  ok: true,                         // always true for partial success
  backend: "federated",
  meta: {
    repoSetId: string,
    manifestHash: string,
    workspace: { name: string, workspacePath?: string },
    selection: {
      selectedRepoIds: string[],    // sorted by repoId
      selectedRepos: Array<{ repoId: string, alias: string|null, priority: number, enabled: boolean }>,
      tags: string[],
      repoFilter: string[],
      includeDisabled: boolean
    },
    merge: { strategy: "rrf", rrfK: number },
    limits: { top: number, perRepoTop: number, concurrency: number },
    cohort?: {
      // see Phase 15.4 (compat gating)
      byMode: Record<string, { cohortKey: string|null, excludedRepoIds: string[] }>
    }
  },

  // per-mode merged hits
  code: FederatedHit[],
  prose: FederatedHit[],
  extractedProse: FederatedHit[],
  records: FederatedHit[],

  repos: Array<{
    repoId: string,
    alias: string|null,
    status: "ok"|"partial"|"missing_index"|"incompatible"|"error",
    perMode: Record<string, { status: string, count: number, error?: { code: string, message: string } }>,
    elapsedMs?: number,
    backend?: string
  }>,

  diagnostics: {
    warnings: Array<{ code: string, message: string, repoId?: string, mode?: string }>,
    errors: Array<{ code: string, message: string, repoId?: string, mode?: string }>
  }
}
```

### 10.2 Stable JSON output requirement

When emitting JSON (CLI/API/MCP), the implementation MUST use deterministic serialization:

- `stableStringify` from `src/shared/stable-json.js`

Do **not** use `JSON.stringify` for federated responses if determinism is a requirement/test target.

### 10.3 `ok=false` cases

Return `ok=false` only when federation cannot proceed at all, e.g.:

- workspace config invalid,
- workspace manifest cannot be generated,
- fatal internal error.

When `ok=false`, include:

```json
{ "ok": false, "code": "<ERROR_CODE>", "message": "<human message>", "diagnostics": { "warnings": [], "errors": [] } }
```

---

## 11. Implementation guidance

### 11.1 Suggested modules

Create:

- `src/retrieval/federation/coordinator.js`
  - `federatedSearch({ workspacePath, rawArgs, signal }): FederatedSearchResponseV1`
- `src/retrieval/federation/select.js`
  - deterministic selection implementation (§6)
- `src/retrieval/federation/merge.js`
  - RRF merge (§8), including pure comparator
- `src/retrieval/federation/args.js`
  - workspace flag stripping + `--top` rewriting + ensure `--json` (§7.4)

### 11.2 CLI integration points (concrete)

- `bin/pairofcleats.js`
  - allow `--workspace` and new workspace flags for the `search` command.
  - if `--workspace` present, route to a new script `search_workspace.js` (recommended) OR update `search.js` to branch.
- Add new script:
  - `search_workspace.js` to:
    1. parse args,
    2. invoke coordinator,
    3. print stable JSON (`stableStringify`).

### 11.3 API integration points (concrete)

- `tools/api/router.js`
  - add `POST /search/federated` handler that:
    - validates request body,
    - enforces allowlist for every resolved repo root,
    - calls coordinator and returns JSON.

### 11.4 MCP integration points (concrete)

- `tools/mcp/server.js`
  - add tool `search_workspace` with inputs matching API request.
  - ensure output includes repo attribution.

---

## 12. Tests (must be automated)

Minimum tests required:

1. **Two-repo fixture**:
   - build tiny indexes for two repos,
   - federated search returns hits from both,
   - every hit includes `repoId`.
2. **Selection**:
   - `--select` includes disabled repo without `--include-disabled`.
   - `--tag` OR behavior.
   - `--repo-filter` glob matching.
3. **Per-repo top override**:
   - user sets `--top 10`, coordinator uses `perRepoTop 20` internally but outputs 10.
4. **Deterministic merge**:
   - stable ordering and stable JSON output across repeated runs.
5. **Partial failure**:
   - one repo missing index does not fail overall response; diagnostics include `missing_index`.
6. **Cohort gating hook**:
   - when two repos have different compatibilityKey for a mode, coordinator excludes one by default and records cohort meta.

