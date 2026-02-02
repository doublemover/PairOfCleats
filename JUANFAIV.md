## Phase 15 — Federation & Multi-Repo (Workspaces, Catalog, Federated Search)

### Objective

Enable first-class *workspace* workflows: index and query across **multiple repositories** in a single operation (CLI/API/MCP), with correct cache keying, compatibility gating, deterministic result merging, and shared cache reuse. The system must be explicit about repo identity and index compatibility so multi-repo results are reproducible, debuggable, and safe by default.

### 15.1 Workspace configuration, repo identity, and repo-set IDs

> **Authoritative spec**: Workspace config format is already defined in `docs/specs/workspace-config.md` (file name: `.pairofcleats-workspace.jsonc`, `schemaVersion: 1`, strict keys, and normalization rules).  
> This roadmap section is aligned to that spec; if the spec changes, update this phase doc (not the other way around).

- [ ] Define a **workspace configuration file** (JSONC-first) that enumerates repos (selection + labels) and is strict/portable. Per-repo build overrides are **explicitly out of scope** for `schemaVersion: 1` (defer to a future schemaVersion).
  - [ ] Recommended default name/location: `.pairofcleats-workspace.jsonc` at a chosen “workspace root” (not necessarily a repo root).
  - [ ] Include minimally:
    - [ ] `schemaVersion`
    - [ ] `name` (human-friendly)
    - [ ] `repos: [{ root, alias?, tags?, enabled?, priority? }]`
    - [ ] Optional: `cacheRoot` (shared cache root override)
    - [ ] Optional: `defaults` (applied to all repos unless overridden)
  - [ ] Document that **repo roots** may be specified as:
    - [ ] absolute paths
    - [ ] paths relative to the workspace file directory
    - [ ] (optional) known repo IDs / aliases (resolved via registry/catalog)

- [ ] Implement a workspace loader/validator that resolves workspace config into a canonical runtime structure.
  - [ ] Canonicalize each repo entry:
    - [ ] Resolve `root` to a **repo root** (not a subdirectory), using existing repo-root detection (`resolveRepoRoot` behavior) even when the user points at a subdir.
    - [ ] Canonicalize to **realpath** (symlink-resolved) where possible; normalize Windows casing consistently.
    - [ ] Compute `repoId` using the canonicalized root (and keep `repoRoot` as canonical path).
  - [ ] Enforce deterministic ordering for all “identity-bearing” operations:
    - [ ] Sort by `repoId` for hashing and cache keys.
    - [ ] Preserve `alias` (and original list position) only for display ordering when desired.

- [ ] Introduce a stable **repo-set identity** (`repoSetId`) for federation.
  - [ ] Compute as a stable hash over:
    - [ ] normalized workspace config (minus non-semantic fields like `name`)
    - [ ] sorted list of `{ repoId, repoRoot }`
  - [ ] Use stable JSON serialization (no non-deterministic key ordering).
  - [ ] Store `repoSetId` in:
    - [ ] the workspace manifest (see 15.2)
    - [ ] federated query cache keys (see 15.4)
    - [ ] any “workspace-level” directory naming under cacheRoot.

- [ ] Harden repo identity helpers so multi-repo identity is stable across callers.
  - [ ] Ensure `repoId` generation uses **canonical root semantics** consistently across:
    - API server routing (`tools/api/router.js`)
    - MCP repo resolution (`tools/mcp/repo.js`)
    - CLI build/search entrypoints
  - [ ] Ensure the repo cache root naming stays stable even when users provide different-but-equivalent paths.

**Touchpoints:**
- `tools/dict-utils.js` (repo root resolution, `getRepoId`, cacheRoot overrides)
- `src/shared/stable-json.js` (stable serialization for hashing)
- New: `src/retrieval/federation/workspace.js` — loader + validator + `repoSetId`

#### Tests

- [ ] `tests/retrieval/federation/workspace-config-parsing.test.js`
  - [ ] Accepts absolute + relative repo roots and produces canonical `repoRoot`.
- [ ] `tests/retrieval/federation/repo-set-id-determinism.test.js`
  - [ ] Independent of repo list order in the workspace file.
  - [ ] Stable across runs/platforms for the same canonical set (Windows casing normalized).
- [ ] `tests/retrieval/federation/repo-canonicalization-dedup.test.js`
  - [ ] Prevents duplicate repo entries that differ only by symlink/subdir pathing.

---

### 15.2 Workspace index catalog, discovery, and manifest

- [ ] Implement an **index catalog** that can discover “what is indexed” across a cacheRoot.
  - [ ] Scan `<cacheRoot>/repos/*/builds/current.json` (and/or current build pointers) to enumerate:
    - [ ] repoId
    - [ ] current buildId
    - [ ] available modes (code/prose/extracted-prose/records)
    - [ ] index directories and SQLite artifact paths
    - [ ] (when available) index compatibility metadata (compatibilityKey; see 15.3)
  - [ ] Treat invalid or unreadable `current.json` as **missing pointer**, not “keep stale state”.

- [ ] Define and generate a **workspace manifest** (`workspace_manifest.json`).
  - [ ] Write under `<cacheRoot>/federation/<repoSetId>/workspace_manifest.json` (or equivalent) so all federation artifacts are colocated.
  - [ ] Include:
    - [ ] `schemaVersion`, `generatedAt`, `repoSetId`
    - [ ] `repos[]` with `repoId`, `repoRoot`, `alias?`, `tags?`
    - [ ] For each repo: `buildId`, per-mode `indexDir`, per-mode `indexSignature` (or a compact signature hash), `sqlitePaths`, and `compatibilityKey`
    - [ ] Diagnostics: missing indexes, excluded modes, policy overrides applied
  - [ ] Ensure manifest generation is deterministic (stable ordering, stable serialization).

- [ ] Add workspace-aware build orchestration (multi-repo indexing) that can produce/refresh the workspace manifest.
  - [ ] Add `--workspace <path>` support to the build entrypoint (or add a dedicated `workspace build` command):
    - [ ] Build indexes per repo independently.
    - [ ] Ensure per-repo configs apply (each repo’s own `.pairofcleats.jsonc`), but workspace config v1 does **not** supply per-repo build overrides; mode selection remains a CLI concern.
    - [ ] Concurrency-limited execution (avoid N repos × M threads exploding resource usage).
  - [ ] Ensure workspace build uses a shared cacheRoot when configured, to maximize reuse of:
    - dictionaries/wordlists
    - model downloads
    - tooling assets
    - (future) content-addressed bundles (see 15.5)

**Touchpoints:**
- `tools/dict-utils.js` (cache root resolution, build pointer paths)
- `build_index.js` (add `--workspace` or create `workspace_build.js`)
- New: `src/retrieval/federation/catalog.js` (cacheRoot scanning)
- New: `src/retrieval/federation/manifest.js` (manifest writer/reader)

#### Tests

- [ ] `tests/retrieval/federation/catalog-discovery-determinism.test.js`
  - [ ] Returns the same repo list regardless of filesystem directory enumeration order.
- [ ] `tests/retrieval/federation/workspace-manifest-contents.test.js`
  - [ ] Records accurate per-repo buildId and per-mode index paths.
  - [ ] Records compatibilityKey for each indexed mode (when present).
- [ ] `tests/retrieval/federation/workspace-manifest-determinism.test.js`
  - [ ] Stable/deterministic for the same underlying catalog state.
- [ ] `tests/retrieval/federation/build-pointer-invalid-clears.test.js`
  - [ ] Invalid `builds/current.json` does not preserve stale build IDs (treated as “pointer invalid”).

---

### 15.3 Federated search orchestration (CLI, API server, MCP)

- [ ] Add **federated search** capability that can query multiple repos in a single request.
  - [ ] CLI:
    - [ ] Add `pairofcleats search --workspace <path>` to query all repos in a workspace.
    - [ ] Support repeated `--repo <id|alias|path>` to target a subset.
    - [ ] Support `--repo-filter <glob|regex>` and/or `--tag <tag>` to select repos by metadata.
  - [ ] API server:
    - [ ] Add a federated endpoint or extend the existing search endpoint to accept:
      - [ ] `workspace` (workspace file path or logical id)
      - [ ] `repos` selection (ids/aliases/roots)
    - [ ] Apply the same repo-root allowlist enforcement as single-repo mode.
  - [ ] MCP:
    - [ ] Add workspace-aware search inputs (workspace + repo selection).
    - [ ] Ensure MCP search results include repo attribution (see below).

- [ ] Implement a federation coordinator (single orchestration layer) used by CLI/API/MCP.
  - [ ] Input: resolved workspace manifest + normalized search request (query, modes, filters, backend selection, scoring config).
  - [ ] Execution:
    - [ ] Fan out to per-repo search sessions with concurrency limits.
    - [ ] Enforce consistent “per-repo topK” before merging to keep cost bounded.
    - [ ] Collect structured warnings/errors per repo without losing overall response.
  - [ ] Output:
    - [ ] A single merged result list plus per-repo diagnostics.

- [ ] Enforce **multi-repo invariants** in federated output:
  - [ ] Every hit must include:
    - [ ] `repoId`
    - [ ] `repoRoot` (or a stable, display-safe alias)
    - [ ] `repoAlias` (if configured)
  - [ ] When paths collide across repos (same `relPath`), results must remain unambiguous.

- [ ] Define and implement deterministic merge semantics for federated results.
  - [ ] Prefer rank-based merging (RRF) at federation layer to reduce cross-index score comparability risk.
  - [ ] Deterministic tie-breakers (in order):
    - [ ] higher merged score / better rank
    - [ ] stable repo ordering (e.g., workspace display order or repoId order; choose one and document)
    - [ ] stable document identity (e.g., `chunkId` / stable doc key)
  - [ ] Explicitly document the merge policy in the output `meta` (so debugging is possible).

**Touchpoints:**
- `bin/pairofcleats.js` (CLI command surfaces)
- `src/integrations/core/index.js` (add `searchFederated()`; reuse `runSearchCli` per repo)
- `src/retrieval/cli.js`, `src/retrieval/cli-args.js` (workspace/repo selection flags and normalization)
- `tools/api/router.js` (federated endpoint plumbing)
- `tools/mcp/repo.js` / `tools/mcp-server.js` (workspace-aware tool inputs)
- New: `src/retrieval/federation/coordinator.js`
- New: `src/retrieval/federation/merge.js` (RRF + deterministic tie-breakers)

#### Tests

- [ ] `tests/retrieval/federation/search-multi-repo-basic.test.js`
  - [ ] Federated search returns results from both repos.
  - [ ] Results include repo attribution fields.
  - [ ] Collisions in `relPath` do not cause ambiguity.
- [ ] `tests/retrieval/federation/search-determinism.test.js`
  - [ ] Same workspace + query yields byte-identical JSON output across repeated runs.
- [ ] `tests/retrieval/federation/repo-selection.test.js`
  - [ ] repeated `--repo` works.
  - [ ] `--repo-filter` / `--tag` selection works and is deterministic.

---

### 15.4 Compatibility gating, cohorts, and safe federation defaults

- [ ] Implement an **index compatibility key** (`compatibilityKey`) and surface it end-to-end.
  - [ ] Compute from materially relevant index invariants (examples):
    - [ ] embedding model id + embedding dimensionality
    - [ ] tokenizer/tokenization key + dictionary version/key
    - [ ] retrieval contract version / feature contract version
    - [ ] ANN backend choice when it changes index semantics (where relevant)
  - [ ] Persist the key into index artifacts:
    - [ ] `index_state.json`
    - [ ] index manifest metadata (where applicable)

- [ ] Teach federation to **partition indexes into cohorts** by `compatibilityKey`.
  - [ ] Default behavior:
    - [ ] Search only within a single cohort (or return per-cohort result sets explicitly).
    - [ ] If multiple cohorts exist, return a warning explaining the mismatch and how to resolve (rebuild or select a cohort).
  - [ ] Provide an explicit override (CLI/API) to allow “unsafe mixing” if ever required, but keep it opt-in and loud.

- [ ] Ensure compatibility gating also applies at the single-repo boundary when multiple modes/backends are requested.
  - [ ] Avoid mixing incompatible code/prose/records indexes when the query expects unified ranking.

**Touchpoints:**
- New: `src/contracts/compat/index-compat.js` (key builder + comparator)
- `src/index/build/indexer/signatures.js` (source of some inputs; do not duplicate logic)
- `src/retrieval/cli-index.js` (read compatibilityKey from index_state / manifest)
- `src/retrieval/federation/manifest.js` (persist compatibilityKey per repo/mode)
- `src/retrieval/federation/coordinator.js` (cohort partitioning)

#### Tests

- [ ] `tests/retrieval/federation/compatibility-key-stability.test.js`
  - [ ] Stable for the same index inputs and changes when any compatibility input changes.
- [ ] `tests/retrieval/federation/compat-cohort-defaults.test.js`
  - [ ] Warns + does not silently mix results by default.
  - [ ] Succeeds when restricted to a cohort explicitly.
- [ ] `tests/retrieval/federation/compat-cohort-determinism.test.js`
  - [ ] Cohort partition ordering is deterministic (no “random cohort chosen”).

---

### 15.5 Federation caching, cache-key correctness, and multi-repo bug fixes

- [ ] Introduce a federated query cache location and policy.
  - [ ] Store at `<cacheRoot>/federation/<repoSetId>/queryCache.json`.
  - [ ] Add TTL and size controls (evict old entries deterministically).
  - [ ] Ensure the cache is safe to share across tools (CLI/API/MCP) by using the same keying rules.

- [ ] Make federated query cache keys **complete** and **stable**.
  - [ ] Must include at least:
    - [ ] `repoSetId`
    - [ ] per-repo (or per-cohort) `indexSignature` (or a combined signature hash)
    - [ ] query string + search type (tokens/regex/import/author/etc)
    - [ ] all relevant filters (path/file/ext/lang/meta filters)
    - [ ] retrieval knobs that change ranking/results (e.g., fileChargramN, ANN backend, RRF/blend config, BM25 params, sqlite thresholds, context window settings)
  - [ ] Use stable JSON serialization to avoid key drift from object insertion order.

- [ ] Fix query-cache invalidation correctness for sharded/variant artifact formats.
  - [ ] Ensure index signatures reflect changes to:
    - [ ] `chunk_meta.json` *and* sharded variants (`chunk_meta.jsonl` + `chunk_meta.meta.json` + shard parts)
    - [ ] token postings / file relations / embeddings artifacts when present
  - [ ] Avoid “partial signature” logic that misses sharded formats.

- [ ] Normalize repo-path based caches to canonical repo roots everywhere federation will touch.
  - [ ] API server repo cache keys must use canonical repo root (realpath + repo root), not caller-provided path strings.
  - [ ] MCP repo cache keys must use canonical repo root even when the caller provides a subdirectory.
  - [ ] Fix MCP build pointer parse behavior: if `builds/current.json` is invalid JSON, clear build id and caches rather than keeping stale state.

**Touchpoints:**
- `src/retrieval/cli-index.js` (index signature computation; sharded meta awareness)
- `src/retrieval/cli/run-search-session.js` (query cache key builder must include all ranking knobs like `fileChargramN`)
- `src/retrieval/index-cache.js` and `src/shared/artifact-io.js` (canonical signature logic; avoid duplicating parsers)
- `src/retrieval/query-cache.js` (federation namespace support and eviction policy if implemented here)
- `tools/api/router.js` (repo cache key normalization; federation cache integration)
- `tools/mcp/repo.js` (repo root canonicalization; build pointer parse error handling)
- `tools/dict-utils.js` (repoId generation stability across realpath/subdir)

#### Tests

- [ ] `tests/retrieval/federation/query-cache-key-stability.test.js`
  - [ ] Changes when any repo’s indexSignature changes.
  - [ ] Changes when `fileChargramN` (or other ranking knobs) changes.
  - [ ] Changes when repo selection changes (subset vs full workspace).
- [ ] `tests/retrieval/federation/query-cache-sharded-meta-invalidation.test.js`
  - [ ] Updating a shard or `chunk_meta.meta.json` invalidates cached queries.
- [ ] `tests/retrieval/federation/mcp-repo-canonicalization.test.js`
  - [ ] Passing a subdirectory resolves to repo root and shares caches with repo root.
- [ ] `tests/retrieval/federation/build-pointer-invalid-clears-cache.test.js`
  - [ ] Invalid `builds/current.json` clears buildId and closes/clears caches (no stale serving).

---

### 15.6 Shared caches, centralized caching, and scale-out ergonomics

- [ ] Make cache layers explicit and shareable across repos/workspaces.
  - [ ] Identify and document which caches are:
    - [ ] global (models, tooling assets, dictionaries/wordlists)
    - [ ] repo-scoped (index builds, sqlite artifacts)
    - [ ] workspace-scoped (federation query caches, workspace manifests)
  - [ ] Ensure cache keys include all required invariants (repoId/buildId/indexSignature/compatibilityKey) to prevent stale reuse.

- [ ] Introduce (or extend) a content-addressed store for expensive derived artifacts to maximize reuse across repos.
  - [ ] Candidates:
    - [ ] cached bundles from file processing
    - [ ] extracted prose artifacts (where applicable)
    - [ ] tool outputs that are content-addressable
  - [ ] Add a cache GC command (`pairofcleats cache gc`) driven by manifests/snapshots.

- [ ] Scale-out and throughput controls for workspace operations.
  - [ ] Concurrency limits for:
    - [ ] multi-repo indexing
    - [ ] federated search fan-out
  - [ ] Memory caps remain bounded under “N repos × large query” workloads.
  - [ ] Optional future: a centralized cache service mode (daemon) for eviction/orchestration.
    - Defer the daemon itself to a follow-on phase if it would delay shipping first federated search.

- [ ] Wordlists + dictionary strategy improvements to support multi-repo consistency.
  - [ ] Auto-download wordlists when missing.
  - [ ] Allow better lists and document how to pin versions for reproducibility.
  - [ ] Evaluate repo-specific dictionaries without breaking workspace determinism (pin by dictionary key/version).

**Touchpoints:**
- `tools/dict-utils.js` (global cache dirs: models/tooling/dictionaries; cacheRoot override)
- `src/shared/cache.js` (cache stats, eviction, size tracking; potential reuse)
- `src/index/build/file-processor/cached-bundle.js` (bundle caching)
- `src/index/build/file-processor/embeddings.js` (embedding caching/service integration)
- New: `src/shared/cas.js` (content-addressed storage helpers) and `tools/cache-gc.js`

#### Tests

- [ ] `tests/indexing/cache/workspace-global-cache-reuse.test.js`
  - [ ] Two-repo workspace build proves global caches are reused (no duplicate downloads; stable cache paths).
- [ ] `tests/indexing/cache/cas-reuse-across-repos.test.js`
  - [ ] Identical input across repos yields identical object keys and avoids recomputation.
- [ ] `tests/tooling/cache/cache-gc-preserves-manifest-referenced.test.js`
  - [ ] Removes unreferenced objects while preserving those referenced by workspace/snapshot manifests.
- [ ] `tests/indexing/cache/workspace-concurrency-limits.test.js`
  - [ ] Workspace indexing/search honors configured limits (does not exceed).

---

## Phase 15 Augmentations (authoritative alignment + implementation breakdown)

This section augments the copied roadmap above using the Phase 15 rewrite pack in `future/15/`. Where conflicts exist, this section takes precedence.

### Canonical specs and required patches

Phase 15 MUST align with these authoritative docs:

- `docs/specs/workspace-config.md` (workspace config schema, v1 rules)
- `docs/specs/workspace-manifest.md` (workspace manifest schema + manifestHash)
- `docs/specs/federated-search.md` (federated request/response contract)
- `docs/contracts/compatibility-key.md` + `src/contracts/compatibility.js` (compatibility key)

Required spec patches/drafts (from `future/15/`):

- Apply `future/15/SPEC_FEDERATED_SEARCH_PATCH.md` to `docs/specs/federated-search.md`
  - workspacePath allowlist and path redaction defaults
- Add `docs/specs/federation-cohorts.md` (from `future/15/SPEC_FEDERATION_COHORTS.md`)
- Draft missing specs referenced by the rewrite:
  - `docs/specs/federated-query-cache.md` (keying, atomicity, eviction, concurrency)
  - `docs/specs/cache-cas-gc.md` (cache taxonomy, CAS layout, GC policy)

### Corrections to the copied roadmap

- **Workspace manifest source**: must be driven by the workspace repo list; cache-root scans are debug-only (do not rely on `<cacheRoot>/repos/*` for federation correctness).
- **workspacePath security**: API/MCP must require allowlisted workspacePath or workspaceId mapping; default to path redaction in responses.
- **Cohort gating**: use `cohortKey` (fallback `compatibilityKey`) per mode; do not silently mix cohorts by default.
- **No legacy path resolution**: schemaVersion 1 forbids registry/catalog ids and per-repo build overrides.
- **Canonical identity**: every cache key must use `repoRootCanonical` and `repoId` derived from realpath + casing normalization.

---

## 15.1 Workspace configuration + repo identity (canonicalization + repoSetId)

- [ ] Implement strict workspace loader (JSONC-first, schemaVersion=1):
  - [ ] `root` accepts absolute or workspaceDir-relative paths only.
  - [ ] Unknown keys hard-fail at all object levels.
  - [ ] Resolve repo root via `resolveRepoRoot` even if user points to subdir/file.
  - [ ] Canonicalize to `repoRootCanonical` (realpath + win32 casing normalization).
  - [ ] Compute `repoId = getRepoId(repoRootCanonical)`.
  - [ ] Normalize metadata deterministically (alias/tags/enabled/priority).
  - [ ] Enforce uniqueness (repoRootCanonical, repoId, alias case-insensitive).
- [ ] Compute `repoSetId` (order-independent) from sorted `{ repoId, repoRootCanonical }`:
  - [ ] `repoSetId = "ws1-" + sha1(stableStringify({ v:1, schemaVersion:1, repos:[...] }))`
- [ ] Centralize identity helpers across CLI/API/MCP to ensure path-equivalent inputs share cache keys.

Touchpoints:
- `tools/dict-utils.js` (resolveRepoRoot, getRepoId, cache roots)
- `src/shared/jsonc.js`, `src/shared/stable-json.js`, `src/shared/hash.js`
- New: `src/workspace/config.js`

Tests:
- [ ] `tests/workspace/config-parsing.test.js`
- [ ] `tests/workspace/repo-set-id-determinism.test.js`
- [ ] `tests/workspace/repo-canonicalization-dedup.test.js`
- [ ] `tests/workspace/alias-uniqueness-and-tags-normalization.test.js`

---

## 15.2 Workspace manifest + workspace build orchestration

- [ ] Generate `workspace_manifest.json` from the workspace repo list (not cache scanning):
  - [ ] Location: `<federationCacheRoot>/federation/<repoSetId>/workspace_manifest.json`
  - [ ] `federationCacheRoot` from workspace `cacheRoot` (workspaceDir-relative allowed) or `getCacheRoot()`
  - [ ] Stable serialization (`stableStringify`) and deterministic ordering (sorted by repoId)
  - [ ] For each repo/mode:
    - [ ] `buildId`, `indexDir`, `indexSignatureHash = "is1-" + sha1(buildIndexSignature(indexDir))`
    - [ ] `cohortKey` (preferred) and `compatibilityKey` (fallback) from `index_state.json`
    - [ ] sqlite signature (`size:mtimeMs`) if present
  - [ ] `manifestHash = "wm1-" + sha1(stableStringify(search-relevant state))`
  - [ ] Invalid/unreadable `builds/current.json` is treated as missing pointer
- [ ] CLI ergonomics:
  - [ ] `pairofcleats workspace manifest --workspace <path>` (generate/refresh; print path + hashes)
  - [ ] `pairofcleats workspace status --workspace <path>` (human readable)
- [ ] Add workspace-aware build orchestration:
  - [ ] `pairofcleats index build --workspace <path>` or `pairofcleats workspace build`
  - [ ] Each repo uses its own `.pairofcleats.json` (no per-repo overrides in v1)
  - [ ] Concurrency-limited repo builds
  - [ ] Regenerate manifest after builds

Touchpoints:
- `tools/dict-utils.js` (cache roots, build pointer resolution)
- `src/retrieval/index-cache.js#buildIndexSignature`
- New: `src/workspace/manifest.js`
- `build_index.js` or new `tools/workspace-build.js`

Tests:
- [ ] `tests/workspace/manifest-determinism.test.js`
- [ ] `tests/workspace/manifest-hash-invalidation.test.js`
- [ ] `tests/workspace/build-pointer-invalid-treated-missing.test.js`
- [ ] `tests/workspace/index-signature-sharded-variants.test.js`

---

## 15.3 Federated search orchestration (CLI/API/MCP)

- [ ] Implement federated search entrypoint:
  - [ ] CLI: `pairofcleats search --workspace <path> "<query>" [workspace flags]`
  - [ ] Disallow `--repo` when `--workspace` is present
  - [ ] Workspace flags: `--select`, `--tag`, `--repo-filter`, `--include-disabled`, `--merge`, `--top-per-repo`, `--concurrency`
- [ ] Single federation coordinator shared by CLI/API/MCP:
  - [ ] Load workspace config + manifest
  - [ ] Apply deterministic selection
  - [ ] Apply cohort gating (15.4)
  - [ ] Fanout per-repo searches with bounded concurrency
  - [ ] Merge results with RRF and deterministic tie breakers
  - [ ] Emit stable JSON with required meta fields
- [ ] Output invariants:
  - [ ] Each hit includes `repoId`, `repoAlias`, `globalId = "${repoId}:${hit.id}"`
  - [ ] No per-hit absolute paths unless debug.includePaths=true
- [ ] API: add `POST /search/federated` or extend `/search` with a `workspace` object
  - [ ] Enforce allowed workspace paths and repo-root allowlist
  - [ ] Default to path redaction (see spec patch)
- [ ] MCP: add `search_workspace` tool with stable output

Touchpoints:
- `bin/pairofcleats.js`
- `src/retrieval/cli.js`, `src/retrieval/cli-args.js`
- `src/integrations/core/index.js`
- `tools/api/router.js`
- `tools/mcp/repo.js`, `tools/mcp-server.js`
- New: `src/retrieval/federation/{coordinator,select,merge,args}.js`

Tests:
- [ ] `tests/retrieval/federation/search-multi-repo-basic.test.js`
- [ ] `tests/retrieval/federation/search-determinism.test.js`
- [ ] `tests/retrieval/federation/repo-selection.test.js`
- [ ] `tests/api/federated-search-workspace-allowlist.test.js` (from spec patch)
- [ ] `tests/api/federated-search-redacts-paths.test.js` (from spec patch)

---

## 15.4 Cohort gating (compatibility safety)

- [ ] Compute `cohortKey` per mode at index time (persist to `index_state.json`):
  - [ ] Use mode-scoped inputs (tokenizationKey, embeddingsKey, languagePolicyKey, schema hash, etc.)
  - [ ] Back-compat: if missing, fall back to `compatibilityKey`
- [ ] Update workspace manifest to include `cohortKey` and include it in `manifestHash`
- [ ] Partition repos by cohort per mode in federation coordinator:
  - [ ] Default policy chooses the highest-ranked cohort and excludes others with warnings
  - [ ] Strict policy errors on multi-cohort
  - [ ] Explicit cohort selection supported
  - [ ] Optional unsafeMix flag (loud warning)

Touchpoints:
- `src/contracts/compatibility.js` (add `buildCohortKey`)
- `src/index/build/indexer/signatures.js` or index writer step
- `src/workspace/manifest.js`
- `src/retrieval/federation/cohort.js` (new)

Tests:
- [ ] `tests/retrieval/federation/compat-cohort-defaults.test.js`
- [ ] `tests/retrieval/federation/compat-cohort-determinism.test.js`
- [ ] `tests/retrieval/federation/compat-cohort-explicit-selection.test.js`

---

## 15.5 Federated query cache (keying + invalidation + canonicalization)

- [ ] Introduce federated query cache store:
  - [ ] `<federationCacheRoot>/federation/<repoSetId>/queryCache.json`
  - [ ] Atomic writes; deterministic eviction (stable sort)
- [ ] Cache key must include:
  - [ ] `repoSetId`, `manifestHash` (primary invalidator)
  - [ ] normalized selection inputs
  - [ ] cohort policy + chosen keys
  - [ ] query and ranking knobs (`top`, `perRepoTop`, `rrfK`, backend, filters, etc.)
  - [ ] stable serialization (`stableStringify`)
- [ ] Canonicalize repo-path caches everywhere federation touches:
  - [ ] API and MCP cache keys use `repoRootCanonical`
  - [ ] Invalid `builds/current.json` clears build id and caches

Touchpoints:
- `src/retrieval/query-cache.js`
- `src/retrieval/index-cache.js`
- `src/shared/stable-json.js`
- `tools/api/router.js`, `tools/mcp/repo.js`

Tests:
- [ ] `tests/retrieval/federation/query-cache-key-stability.test.js`
- [ ] `tests/retrieval/federation/query-cache-invalidation-via-manifesthash.test.js`
- [ ] `tests/retrieval/federation/mcp-repo-canonicalization.test.js`
- [ ] `tests/retrieval/federation/build-pointer-invalid-clears-cache.test.js`

---

## 15.6 Cache taxonomy, CAS, GC, and scale-out ergonomics

- [ ] Document cache layers (global, repo-scoped, workspace-scoped)
- [ ] Add CAS spec + helpers and a GC command:
  - [ ] `pairofcleats cache gc --dry-run`
  - [ ] Preserve objects referenced by manifests/snapshots; delete unreferenced objects deterministically
  - [ ] Safe under concurrency
- [ ] Concurrency limits for workspace indexing and federated fanout

Touchpoints:
- `tools/dict-utils.js` (global cache dirs)
- `src/shared/cache.js`
- `src/index/build/file-processor/cached-bundle.js`
- New: `src/shared/cas.js`, `tools/cache-gc.js`

Tests:
- [ ] `tests/indexing/cache/workspace-global-cache-reuse.test.js`
- [ ] `tests/indexing/cache/cas-reuse-across-repos.test.js`
- [ ] `tests/tooling/cache/cache-gc-preserves-manifest-referenced.test.js`
- [ ] `tests/indexing/cache/workspace-concurrency-limits.test.js`
