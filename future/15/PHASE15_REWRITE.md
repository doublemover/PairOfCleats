# Phase 15 — Federation & Multi-Repo (Workspaces, Manifests, Federated Search)

> **Rewrite goal:** remove roadmap/spec drift, make Phase 15 implementation-ready, and explicitly name the authoritative specs/contracts for each subsection.

## Objective

Enable first-class **workspace** workflows: index and query across **multiple repositories** in a single operation (CLI/API/MCP), with:

- explicit and deterministic repo identity (`repoId`, `repoRootCanonical`, `repoSetId`)
- deterministic selection, cohort gating, and merge semantics; stable JSON output for reproducibility
- correct cache keying and invalidation for both per-repo caches and federation-level query caches
- safe-by-default compatibility gating (cohorts) with explicit overrides and loud diagnostics
- clear cache layering with an eventual content-addressed store (CAS) and manifest-driven garbage collection (GC)

## Canonical terms (used throughout this phase)

- **workspacePath**: absolute path to the workspace JSONC file.
- **workspaceDir**: directory containing `workspacePath`.
- **repoRootResolved**: root returned by repo-root detection (`resolveRepoRoot`).
- **repoRootCanonical**: `repoRootResolved` after realpath + win32 casing normalization; identity-bearing.
- **repoId**: opaque id derived from `repoRootCanonical` (`getRepoId`).
- **repoSetId**: order-independent membership id for the workspace; excludes display metadata.
- **repoCacheRoot**: per-repo cache root (resolved from each repo’s `.pairofcleats.json`).
- **federationCacheRoot**: workspace-level root for federation artifacts (manifest, federated query cache); comes from workspace `cacheRoot` or `getCacheRoot()`.
- **manifestHash**: hash of search-relevant workspace state (build pointers + index signatures + sqlite signatures + compatibility keys).
- **indexSignatureHash**: per-mode file-index signature hash (`is1-...`) computed from `buildIndexSignature(indexDir)`.
- **compatibilityKey**: fingerprint computed during indexing and stored in `index_state.json` and `pieces/manifest.json`.
- **cohortKey**: mode-scoped compatibility fingerprint used for federation cohorting (Phase 15.4). Stored in `index_state.json` as `cohortKey` when available; falls back to `compatibilityKey` for back-compat.
- **cohort**: for a given mode, the set of repos sharing the same cohort key.

---

## 15.1 Workspace configuration, repo identity, and repo-set IDs

> **Authoritative spec:** `docs/specs/workspace-config.md`  
> This phase MUST match that spec. In particular, schemaVersion=1 explicitly forbids registry/catalog discovery and per-repo build overrides.

- [ ] Implement a strict workspace configuration file loader (JSONC-first).
  - [ ] Recommended convention: `.pairofcleats-workspace.jsonc`
  - [ ] Parsing MUST use `src/shared/jsonc.js` (`readJsoncFile` / `parseJsoncText`).
  - [ ] Root MUST be an object; unknown keys MUST hard-fail at all object levels.

- [ ] Resolve and canonicalize every repo entry deterministically.
  - [ ] Resolve `root`:
    - [ ] absolute paths allowed
    - [ ] relative paths resolved from `workspaceDir`
    - [ ] schemaVersion=1: **do not** accept “registry/catalog ids” or remote-based resolution
  - [ ] Resolve to a repo root (not a subdir):
    - [ ] `repoRootResolved = resolveRepoRoot(rootAbs)` even if the user points at a subdir or file
  - [ ] Canonicalize identity root:
    - [ ] `repoRootCanonical = toRealPath(repoRootResolved)`; normalize win32 casing consistently
  - [ ] Compute `repoId = getRepoId(repoRootCanonical)`.

- [ ] Normalize metadata deterministically.
  - [ ] `alias`: trim; empty → null; uniqueness is case-insensitive.
  - [ ] `tags`: trim → lowercase → drop empties → dedupe → sort.
  - [ ] `enabled`: boolean (default from `defaults.enabled`, else true).
  - [ ] `priority`: integer (default from `defaults.priority`, else 0).

- [ ] Enforce uniqueness constraints (fail fast, actionable errors).
  - [ ] No duplicate `repoRootCanonical`.
  - [ ] No duplicate `repoId`.
  - [ ] No duplicate alias (case-insensitive).

- [ ] Introduce stable workspace membership identity: `repoSetId`.
  - [ ] Compute exactly per spec (order-independent, excludes display fields):
    - [ ] sorted list of `{ repoId, repoRootCanonical }`
    - [ ] `repoSetId = "ws1-" + sha1(stableStringify({ v:1, schemaVersion:1, repos:[...] }))`
  - [ ] `repoSetId` is used for:
    - [ ] workspace manifest pathing (15.2)
    - [ ] federated query caching directory naming (15.5)

- [ ] (Optional but recommended) compute `workspaceConfigHash` for diagnostics.
  - [ ] This hash *may* include tags/enabled/priority/etc and is useful to explain “why selection changed”.

- [ ] Centralize identity/canonicalization helpers across all callers.
  - [ ] Any cache key that includes a repo path MUST use `repoRootCanonical`, not caller-provided strings.
  - [ ] API server routing (`tools/api/router.js`), MCP repo resolution (`tools/mcp/repo.js`), CLI, and workspace loader MUST share the same canonicalization semantics.

**Touchpoints:**
- `tools/dict-utils.js` (repo root resolution, `getRepoId`, cache root helpers)
- `src/shared/jsonc.js`, `src/shared/stable-json.js`, `src/shared/hash.js`
- New (preferred, consistent with spec): `src/workspace/config.js`

### Tests

- [ ] `tests/workspace/config-parsing.test.js`
- [ ] `tests/workspace/repo-set-id-determinism.test.js`
- [ ] `tests/workspace/repo-canonicalization-dedup.test.js`
- [ ] `tests/workspace/alias-uniqueness-and-tags-normalization.test.js`

---

## 15.2 Workspace manifest (index discovery) + workspace-aware build orchestration

> **Authoritative spec:** `docs/specs/workspace-manifest.md`  
> Manifest generation is driven by the workspace’s repo list (not by scanning `<cacheRoot>/repos/*`). Cache-wide scans are optional debug tooling only.

- [ ] Implement deterministic workspace manifest generation (schemaVersion = 1).
  - [ ] Resolve `federationCacheRoot` exactly per spec:
    - workspace `cacheRoot` (resolved absolute or relative to `workspaceDir`) else `getCacheRoot()`
  - [ ] Write atomically to:
    - `<federationCacheRoot>/federation/<repoSetId>/workspace_manifest.json`
  - [ ] Serialize with `stableStringify` so the file is byte-stable for unchanged state.

- [ ] Populate manifest entries per repo (sorted by `repoId`).
  - [ ] Resolve per-repo config (optional) and compute:
    - [ ] `repoCacheRoot = getRepoCacheRoot(repoRootCanonical, userConfig)`
  - [ ] Read build pointer:
    - [ ] `<repoCacheRoot>/builds/current.json`
    - [ ] invalid/unreadable JSON MUST be treated as **missing pointer** (do not preserve stale values)
  - [ ] For each mode in `{code, prose, extracted-prose, records}`:
    - [ ] derive `indexDir` from the build roots
    - [ ] compute `indexSignatureHash` as `is1-` + sha1(buildIndexSignature(indexDir))
    - [ ] read `cohortKey` (preferred) and `compatibilityKey` (fallback) from `<indexDir>/index_state.json` (warn if both missing)
  - [ ] Resolve sqlite artifacts and compute file signatures (`size:mtimeMs`) per spec.

- [ ] Compute and persist `manifestHash` (`wm1-...`) exactly per spec.
  - [ ] MUST change for search-relevant state changes (build pointer, index signature, sqlite changes, compatibilityKey).
  - [ ] MUST NOT change for display-only edits (alias/tags/enabled/priority/name).

- [ ] CLI ergonomics: add explicit manifest commands.
  - [ ] `pairofcleats workspace manifest --workspace <path>` (generate/refresh and print path + hashes)
  - [ ] `pairofcleats workspace status --workspace <path>` (human-readable per-repo/mode availability)

- [ ] Workspace-aware build orchestration (multi-repo indexing).
  - [ ] Add a workspace build entrypoint:
    - [ ] either `pairofcleats index build --workspace <path> ...`
    - [ ] or `pairofcleats workspace build ...`
  - [ ] Requirements:
    - [ ] each repo’s `.pairofcleats.json` is applied (repo-local cache roots, ignore rules, etc.)
    - [ ] workspace config v1 supplies no per-repo build overrides (defer to future schemaVersion)
    - [ ] concurrency-limited repo builds (avoid “N repos × M threads” explosion)
  - [ ] Post-step: regenerate workspace manifest and emit `repoSetId` + `manifestHash`.

- [ ] Optional debug tooling: cache inspection (“catalog”) commands.
  - [ ] If implemented, treat as debug tooling only; do not make federation correctness depend on scanning `<cacheRoot>/repos/*`.

**Touchpoints:**
- `tools/dict-utils.js` (cache roots, build pointer resolution, sqlite path helpers)
- `src/retrieval/index-cache.js` (`buildIndexSignature`)
- New (preferred): `src/workspace/manifest.js`

### Tests

- [ ] `tests/workspace/manifest-determinism.test.js`
- [ ] `tests/workspace/manifest-hash-invalidation.test.js`
- [ ] `tests/workspace/build-pointer-invalid-treated-missing.test.js`
- [ ] `tests/workspace/index-signature-sharded-variants.test.js`

---

## 15.3 Federated search orchestration (CLI, API server, MCP)

> **Authoritative spec:** `docs/specs/federated-search.md`  
> This phase MUST match that spec exactly (flags, selection semantics, response shape, determinism rules).

- [ ] CLI: implement federated mode for search.
  - [ ] `pairofcleats search --workspace <workspaceFile> "<query>" [searchFlags...] [workspaceFlags...]`
  - [ ] Workspace flags (per spec): `--select`, `--tag`, `--repo-filter`, `--include-disabled`, `--merge`, `--top-per-repo`, `--concurrency`
  - [ ] Forbidden combinations (per spec):
    - [ ] if `--workspace` is present, `--repo` MUST error (`ERR_FEDERATED_REPO_FLAG_NOT_ALLOWED`)

- [ ] Implement a single federation coordinator used by CLI/API/MCP.
  - [ ] Load workspace config (15.1) and manifest (15.2).
  - [ ] Apply deterministic selection rules (spec §6).
  - [ ] Apply cohort gating hook (15.4).
  - [ ] Derive `perRepoTop` and rewrite per-repo args (spec §7.4).
  - [ ] Fanout per-repo searches with bounded concurrency; reuse `indexCache` and `sqliteCache`.
  - [ ] Merge per-mode results with RRF and deterministic tie-breakers (spec §8).
  - [ ] Emit federated response with stable serialization (`stableStringify`) and required meta fields.

- [ ] Output invariants (multi-repo unambiguity).
  - [ ] Every hit MUST include `repoId`, `repoAlias`, and `globalId = "${repoId}:${hit.id}"`.
  - [ ] Results must remain unambiguous even when `relPath` collides across repos.

- [ ] API server: add `POST /search/federated` (recommended by spec).
  - [ ] Enforce repo-root allowlist checks for every repo in the request.
  - [ ] Add workspace-path safety (spec update required; see `SPEC_FEDERATED_SEARCH_PATCH.md` produced alongside this rewrite).
  - [ ] Default to not returning absolute filesystem paths unless debug is explicitly enabled.

- [ ] MCP: add federated tool(s).
  - [ ] Implement `search_workspace` tool with inputs matching the API request.
  - [ ] Ensure output includes repo attribution and is stable JSON.

**Touchpoints:**
- `bin/pairofcleats.js` (CLI)
- `src/retrieval/cli.js`, `src/retrieval/cli-args.js`
- `src/integrations/core/index.js` (reuse per-repo search)
- `tools/api/router.js` (endpoint + allowlist enforcement)
- `tools/mcp/server.js` / `tools/mcp/repo.js`
- New (per spec): `src/retrieval/federation/{coordinator,select,merge,args}.js`

### Tests

- [ ] `tests/retrieval/federation/search-multi-repo-basic.test.js`
- [ ] `tests/retrieval/federation/search-determinism.test.js` (byte-identical JSON)
- [ ] `tests/retrieval/federation/repo-selection.test.js`

---

## 15.4 Compatibility gating (cohorts) + safe federation defaults

> **Authoritative contract:** `docs/contracts/compatibility-key.md` + `src/contracts/compatibility.js`  
> **Missing spec (must draft):** federation cohort gating policy and overrides. Draft is provided as `SPEC_FEDERATION_COHORTS.md`.

- [ ] **Do not duplicate** compatibility key computation.
  - [ ] Continue computing `compatibilityKey` at index time via `buildCompatibilityKey`.
  - [ ] Ensure it is persisted to `index_state.json` (and `pieces/manifest.json` where relevant).

- [ ] Add a federation-specific **cohortKey** (mode-scoped) and persist it.
  - [ ] Compute `cohortKey` per mode from the same inputs used for `compatibilityKey`, but scoped so that:
    - it does **not** change merely because other modes were also built, and
    - it captures only invariants relevant to reading/searching that mode.
  - [ ] Persist `cohortKey` into `<indexDir>/index_state.json` alongside `compatibilityKey`.
  - [ ] Back-compat: if `cohortKey` is absent, federation uses `compatibilityKey`.
  - [ ] Update manifest generation (15.2) to read `cohortKey` and record warnings when missing.

- [ ] Implement cohort partitioning in federation coordinator (per mode).
  - [ ] Partition selected repos into cohorts keyed by `cohortKey` (fallback: `compatibilityKey`).
  - [ ] Default policy MUST be safe-by-default:
    - [ ] never silently mix cohorts in a single merged result set
    - [ ] emit an explicit warning describing excluded repos and how to resolve (rebuild or select cohort)
  - [ ] Provide deterministic override mechanisms (as defined in `SPEC_FEDERATION_COHORTS.md`):
    - [ ] explicit cohort selection (`--cohort ...` / API equivalent)
    - [ ] strict mode to error if more than one cohort exists
    - [ ] explicit “unsafe mix” flag (opt-in and loud) if supported

- [ ] Ensure compatibility gating is respected at the single-repo boundary.
  - [ ] The existing single-repo loader should continue to hard-fail when incompatible indexes are loaded together.

### Tests

- [ ] `tests/retrieval/federation/compat-cohort-defaults.test.js`
- [ ] `tests/retrieval/federation/compat-cohort-determinism.test.js`
- [ ] `tests/retrieval/federation/compat-cohort-explicit-selection.test.js`

---

## 15.5 Federated query caching + cache-key correctness + multi-repo bug fixes

> **Missing spec (must draft):** federated query cache keying, storage, atomicity, eviction, and concurrency behavior. Draft is provided as `SPEC_FEDERATED_QUERY_CACHE.md`.

- [ ] Introduce federated query cache storage under `federationCacheRoot`.
  - [ ] Location MUST be:
    - `<federationCacheRoot>/federation/<repoSetId>/queryCache.json`
  - [ ] Writes MUST be atomic; tolerate concurrent readers and avoid file corruption.
  - [ ] Eviction MUST be deterministic (e.g., stable ts sort; fixed max entries).

- [ ] Cache keying MUST be complete and stable.
  - [ ] Cache key MUST include (directly or indirectly via `manifestHash`):
    - [ ] `repoSetId`
    - [ ] `manifestHash` (primary invalidator)
    - [ ] normalized selection (selected repo ids, includeDisabled, tags, repoFilter, explicit selects)
    - [ ] cohort decision inputs/outputs (policy + chosen cohort key per mode + exclusions)
    - [ ] normalized search request knobs that affect output (query, modes, filters, backend choices, ranking knobs, etc.)
    - [ ] merge strategy and limits (`top`, `perRepoTop`, `rrfK`, concurrency)
  - [ ] Key payload serialization MUST use `stableStringify` (never `JSON.stringify`).

- [ ] Stop duplicating or weakening index signature logic.
  - [ ] For federation-level invalidation, prefer `manifestHash` (from the workspace manifest) rather than ad hoc per-repo signatures.
  - [ ] For any remaining per-repo cache invalidation that depends on file-index changes, use `buildIndexSignature` (not bespoke partial signatures).

- [ ] Canonicalize repo-path keyed caches everywhere federation touches.
  - [ ] API server repo cache keys MUST use `repoRootCanonical` (realpath + repo root), not caller-provided strings.
  - [ ] MCP repo cache keys MUST canonicalize subdir inputs to the repo root.
  - [ ] Fix MCP build pointer parse behavior: invalid JSON in `builds/current.json` MUST clear build id and caches rather than keeping stale state.

### Tests

- [ ] `tests/retrieval/federation/query-cache-key-stability.test.js`
- [ ] `tests/retrieval/federation/query-cache-invalidation-via-manifesthash.test.js`
- [ ] `tests/retrieval/federation/mcp-repo-canonicalization.test.js`
- [ ] `tests/retrieval/federation/build-pointer-invalid-clears-cache.test.js`

---

## 15.6 Shared caches, CAS, GC, and scale-out ergonomics

> **Missing spec (must draft):** cache taxonomy, CAS layout/keying, and GC policy. Draft is provided as `SPEC_CACHE_CAS_GC.md`.

- [ ] Make cache layers explicit and document them.
  - [ ] Global caches (models, tooling assets, dictionaries/wordlists)
  - [ ] Repo-scoped caches (index builds, sqlite artifacts)
  - [ ] Workspace-scoped caches (workspace manifest, federated query cache)

- [ ] (Design first) Introduce content-addressed storage (CAS) for expensive derived artifacts.
  - [ ] Define object identity (hashing), layout, and reference tracking.
  - [ ] Ensure deterministic, safe reuse across repos and workspaces.

- [ ] Implement a manifest-driven GC tool.
  - [ ] `pairofcleats cache gc --dry-run`
  - [ ] Preserve any objects reachable from active manifests/snapshots; delete unreferenced objects deterministically.
  - [ ] Be safe under concurrency (do not delete objects currently in use).

- [ ] Scale-out controls.
  - [ ] Concurrency limits for:
    - [ ] multi-repo indexing
    - [ ] federated fanout search
  - [ ] Memory remains bounded under “N repos × large query” workloads.

### Tests

- [ ] `tests/indexing/cache/workspace-global-cache-reuse.test.js`
- [ ] `tests/indexing/cache/cas-reuse-across-repos.test.js`
- [ ] `tests/tooling/cache/cache-gc-preserves-manifest-referenced.test.js`
- [ ] `tests/indexing/cache/workspace-concurrency-limits.test.js`

---

## Specs that must be updated or drafted (produced alongside this rewrite)

- `SPEC_FEDERATED_SEARCH_PATCH.md` — patch instructions to update `docs/specs/federated-search.md` (workspacePath security + path redaction defaults).
- `SPEC_FEDERATION_COHORTS.md` — new spec for Phase 15.4 cohort gating policy and overrides.
- `SPEC_FEDERATED_QUERY_CACHE.md` — new spec for Phase 15.5 federated query caching (keying, atomicity, eviction, concurrency).
- `SPEC_CACHE_CAS_GC.md` — new spec for Phase 15.6 cache taxonomy, CAS, and GC behavior.
