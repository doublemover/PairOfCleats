# PairOfCleats FutureRoadmap

    ## Status legend
    
    Checkboxes represent the state of the work, update them to reflect the state of work as its being done:
    - [x] Implemented and appears complete/correct based on code inspection and existing test coverage
    - [@] In Progress, this work has been started
    - [.] Work has been completed but has Not been tested
    - [?] There is a correctness gap **or** there is missing/insufficient test proving behavior
    - [ ] Not complete
    
    Completed Phases: `COMPLETED_PHASES.md`

## Roadmap List
### Features
- Phase 15 -- Federation & Multi-Repo (Workspaces, Catalog, Federated Search)
- Phase 16 -- Prose Ingestion + Retrieval Routing Correctness (PDF/DOCX + FTS policy)
- Phase 17 -- Vector-Only Profile (Embeddings-First, Build + Search w/o Sparse Postings)
- Phase 18 -- Distribution & Platform Hardening (Release Matrix, Packaging, & Optional Python)

---

## Phase 15 — Federation & Multi-Repo (Workspaces, Catalog, Federated Search)

### Objective

Enable first-class *workspace* workflows: index and query across **multiple repositories** in a single operation (CLI/API/MCP), with correct cache keying, compatibility gating, deterministic result merging, and shared cache reuse. The system must be explicit about repo identity and index compatibility so multi-repo results are reproducible, debuggable, and safe by default.

Additional docs that MUST be updated if Phase 15 adds new behavior or config:
- `docs/specs/workspace-config.md`
- `docs/specs/workspace-manifest.md`
- `docs/specs/federated-search.md`
- `docs/specs/federation-cohorts.md`
- `docs/specs/federated-query-cache.md`
- `docs/specs/cache-cas-gc.md`
- `docs/contracts/compatibility-key.md`
- `docs/config/schema.json` + `docs/config/contract.md`
- `docs/guides/commands.md` (workspace/federation CLI flags)

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
    - [ ] Resolve and persist `workspaceRoot` (the config file directory) and use it explicitly for relative repo roots.
  - [ ] Enforce deterministic ordering for all “identity-bearing” operations:
    - [ ] Sort by `repoId` for hashing and cache keys.
    - [ ] Preserve `alias` (and original list position) only for display ordering when desired.
  - [ ] Hard-fail on duplicate repo entries (same canonical root or repoId) to prevent ambiguous cache keys.

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
- `docs/specs/workspace-config.md` (schema/normalization rules)

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
    - [ ] `manifestHash` over search-relevant state (stable serialization; exclude display-only fields)
    - [ ] `manifestBasis` (hash of per-repo build pointers and index signatures that drive cache invalidation)
    - [ ] `repos[]` with `repoId`, `repoRoot`, `alias?`, `tags?`
    - [ ] For each repo: `buildId`, per-mode `indexDir`, per-mode `indexSignature` (or a compact signature hash), `sqlitePaths`, and `compatibilityKey`
    - [ ] Diagnostics: missing indexes, excluded modes, policy overrides applied
  - [ ] Ensure manifest generation is deterministic (stable ordering, stable serialization).
  - [ ] Write manifests atomically (temp + rename) to avoid partially-written state.

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
- `docs/specs/workspace-manifest.md` (manifest schema + manifestHash rules)

#### Tests

- [ ] `tests/retrieval/federation/catalog-discovery-determinism.test.js`
  - [ ] Returns the same repo list regardless of filesystem directory enumeration order.
- [ ] `tests/retrieval/federation/workspace-manifest-contents.test.js`
  - [ ] Records accurate per-repo buildId and per-mode index paths.
  - [ ] Records compatibilityKey for each indexed mode (when present).
- [ ] `tests/retrieval/federation/workspace-manifest-determinism.test.js`
  - [ ] Stable/deterministic for the same underlying catalog state.
- [ ] `tests/retrieval/federation/workspace-manifest-hash-invalidation.test.js`
  - [ ] `manifestHash` changes when a repo indexSignature changes; remains stable otherwise.
- [ ] `tests/retrieval/federation/build-pointer-invalid-clears.test.js`
  - [ ] Invalid `builds/current.json` does not preserve stale build IDs (treated as “pointer invalid”).

---

### 15.3 Federated search orchestration (CLI, API server, MCP)

- [ ] Add **federated search** capability that can query multiple repos in a single request.
  - [ ] CLI:
    - [ ] Add `pairofcleats search --workspace <path>` to query all repos in a workspace.
    - [ ] Support repeated `--repo <id|alias|path>` to target a subset.
    - [ ] Support `--repo-filter <glob|regex>` and/or `--tag <tag>` to select repos by metadata.
    - [ ] Add `--federation-mode <fail|best-effort>` (default: `fail`) to control partial-failure handling.
  - [ ] API server:
    - [ ] Add a federated endpoint or extend the existing search endpoint to accept:
      - [ ] `workspace` (workspace file path or logical id)
      - [ ] `repos` selection (ids/aliases/roots)
      - [ ] `federationMode` (`fail` | `best_effort`) to control partial-failure handling.
    - [ ] Apply the same repo-root allowlist enforcement as single-repo mode.
  - [ ] MCP:
    - [ ] Add workspace-aware search inputs (workspace + repo selection).
    - [ ] Add a `federationMode` input (`fail` | `best_effort`) to control partial failures.
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
- `docs/specs/federated-search.md` (request/response contract + merge policy)

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
  - [ ] Compute and persist cohort summaries at **manifest generation time** so mismatches are detected early.
    - [ ] If requested modes span multiple cohorts, refuse to federate by default unless an explicit `allowIncompatible` override is provided.

- [ ] Ensure compatibility gating also applies at the single-repo boundary when multiple modes/backends are requested.
  - [ ] Avoid mixing incompatible code/prose/records indexes when the query expects unified ranking.

**Touchpoints:**
- New: `src/contracts/compat/index-compat.js` (key builder + comparator)
- `src/index/build/indexer/signatures.js` (source of some inputs; do not duplicate logic)
- `src/retrieval/cli-index.js` (read compatibilityKey from index_state / manifest)
- `src/retrieval/federation/manifest.js` (persist compatibilityKey per repo/mode)
- `src/retrieval/federation/coordinator.js` (cohort partitioning)
- `docs/contracts/compatibility-key.md` (compatibility key definition)

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
  - [ ] Define the CAS layout (hash algorithm, directory sharding, metadata) and GC policy (LRU + max age).
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

---

## Phase 16 — Prose ingestion + retrieval routing correctness (PDF/DOCX + FTS policy)

### Objective

Deliver first-class document ingestion (PDF + DOCX) and prose retrieval correctness:

- PDF/DOCX can be ingested (when optional deps exist) into deterministic, segment-aware prose chunks.
- When deps are missing or extraction fails, the index build remains green and reports explicit, per-file skip reasons.
- Prose/extracted-prose routes deterministically to SQLite FTS with safe, explainable query compilation; code routes to sparse/postings.
- Retrieval helpers are hardened so constraints (`allowedIds`), weighting, and table availability cannot silently produce wrong or under-filled results.

Note: vector-only indexing profile work is handled in **Phase 17 — Vector-Only Index Profile (Embeddings-First)**.

Additional docs that MUST be updated if Phase 16 adds new behavior or config:
- `docs/contracts/indexing.md` + `docs/contracts/artifact-contract.md` (metaV2 + chunk_meta contract surface)
- `docs/config/schema.json` + `docs/config/contract.md` + `docs/config/inventory.md` + `docs/config/inventory-notes.md`
- `docs/guides/commands.md` (new flags for extraction/routing)
- `docs/testing/truth-table.md` (optional-deps + skip policy)
- `docs/specs/document-extraction.md` (new; extraction contract + failure semantics)
- `docs/specs/prose-routing.md` (new; routing defaults + FTS explain contract)

### 16.1 Optional-dependency document extractors (PDF/DOCX) with deterministic structured output

- [ ] Add extractor modules that return structured units (do not pre-join into one giant string):
  - [ ] `src/index/extractors/pdf.js` (new)
    - [ ] `extractPdf({ filePath, buffer }) -> { ok:true, pages:[{ pageNumber, text }], warnings:[] } | { ok:false, reason, warnings:[] }`
  - [ ] `src/index/extractors/docx.js` (new)
    - [ ] `extractDocx({ filePath, buffer }) -> { ok:true, paragraphs:[{ index, text, style? }], warnings:[] } | { ok:false, reason, warnings:[] }`
  - [ ] Normalize extracted text units:
    - [ ] normalize newlines to `\n`
    - [ ] collapse excessive whitespace but preserve paragraph boundaries
    - [ ] preserve deterministic ordering (page order, paragraph order)
  - [ ] Record extractor version, source checksum (bytes hash), and page/paragraph counts in build-state/extraction report.

- [ ] Implement optional-dep loading via `tryImport` (preferred) with conservative fallbacks:
  - [ ] PDF: try `pdfjs-dist/legacy/build/pdf.js|pdf.mjs`, then `pdfjs-dist/build/pdf.js`, then `pdfjs-dist`.
  - [ ] DOCX: `mammoth` preferred, `docx` as a documented fallback.

- [ ] Capability gating must match real loadability:
  - [ ] Extend `src/shared/capabilities.js` so `capabilities.extractors.pdf/docx` reflects whether the extractor modules can successfully load a working implementation (including ESM/subpath cases).
  - [ ] Ensure capability checks do not treat “package installed but unusable entrypoint” as available.

- [ ] Failure behavior must be per-file and non-fatal:
  - [ ] Extractor failures must be caught and converted into a typed `{ ok:false, reason }` result.
  - [ ] Record per-file extraction failures into build state (see 16.3) with actionable messaging.

Touchpoints:
- `src/index/extractors/pdf.js` (new)
- `src/index/extractors/docx.js` (new)
- `src/shared/capabilities.js`
- `src/shared/optional-deps.js` (tryImport/tryRequire behavior for optional deps)
- Refactor/reuse logic from `tools/bench/micro/extractors.js` into the runtime extractors (bench remains a consumer).
- `docs/specs/document-extraction.md` (new; extractor contract + failure semantics)
 - `src/index/build/build-state.js` (record extractor versions + capability flags)
 - `src/contracts/schemas/build-state.js` + `src/contracts/validators/build-state.js`

#### Tests
- [ ] `tests/indexing/extracted-prose/pdf-missing-dep-skips.test.js`
  - [ ] When PDF capability is false, extraction path is skipped cleanly and build remains green.
- [ ] `tests/indexing/extracted-prose/docx-missing-dep-skips.test.js`
  - [ ] When DOCX capability is false, extraction path is skipped cleanly and build remains green.
- [ ] `tests/indexing/extracted-prose/pdf-smoke.test.js` (conditional; only when deps available)
  - [ ] Extract a fixture PDF and assert known phrase is present.
- [ ] `tests/indexing/extracted-prose/docx-smoke.test.js` (conditional; only when deps available)
  - [ ] Extract a fixture DOCX and assert known phrase is present.
 - [ ] `tests/indexing/extracted-prose/document-extractor-version-recorded.test.js`
   - [ ] Build-state records extractor version/capability info when extraction is enabled.
 - [ ] `tests/indexing/extracted-prose/document-extraction-checksums-and-counts.test.js`
   - [ ] Build-state/extraction report records source checksum and page/paragraph counts.

### 16.2 Deterministic doc chunking (page/paragraph aware) + doc-mode limits that scale to large files

- [ ] Add deterministic chunkers for extracted documents:
  - [ ] `src/index/chunking/formats/pdf.js` (new)
    - [ ] Default: one chunk per page.
    - [ ] If a page is tiny, allow deterministic grouping (e.g., group adjacent pages up to a budget).
    - [ ] Each chunk carries provenance: `{ type:'pdf', pageStart, pageEnd, anchor }`.
  - [ ] `src/index/chunking/formats/docx.js` (new)
    - [ ] Group paragraphs into chunks by max character/token budget.
    - [ ] Merge tiny paragraphs into neighbors up to a minimum size threshold (deterministic).
    - [ ] Preserve heading boundaries when style information is available.
    - [ ] Each chunk carries provenance: `{ type:'docx', paragraphStart, paragraphEnd, headingPath?, anchor }`.
    - [ ] If multiple paragraph boundaries are merged, include explicit boundary labels so chunk provenance is unambiguous.

- [ ] Support adaptive splitting for “hot” or unexpectedly large segments without breaking stability:
  - [ ] If a page/section/window exceeds caps, split into deterministic subsegments with stable sub-anchors (no run-to-run drift).

- [ ] Sweep-driven performance hardening for chunking limits (because PDF/DOCX can create very large blobs):
  - [ ] Update `src/index/chunking/limits.js` so byte-boundary resolution is not quadratic on large inputs.
  - [ ] Avoid building full `lineIndex` unless line-based truncation is requested.

Touchpoints:
- `src/index/chunking/formats/pdf.js` (new)
- `src/index/chunking/formats/docx.js` (new)
- `src/index/chunking/limits.js`
- `docs/specs/document-extraction.md` (chunking contract + anchors)

#### Tests
- [ ] `tests/indexing/chunking/pdf-chunking-deterministic.test.js`
  - [ ] Two-page fixture; assert stable chunk count, anchors, and page ranges across repeated runs.
- [ ] `tests/indexing/chunking/docx-chunking-deterministic.test.js`
  - [ ] Multi-paragraph fixture; assert stable chunk grouping and heading boundary behavior.
- [ ] `tests/perf/chunking/chunking-limits-large-input.test.js`
  - [ ] Regression guard: chunking limits on a large string must complete within a bounded time.

### 16.3 Integrate extraction into indexing build (discovery, skip logic, file processing, state)

- [ ] Discovery gating:
  - [ ] Update `src/index/build/discover.js` so `.pdf`/`.docx` are only considered when `indexing.documentExtraction.enabled === true`.
  - [ ] If enabled but deps missing: record explicit “skipped due to capability” diagnostics (do not silently ignore).

- [ ] Treat extraction as a **pre-index stage** with an explicit error policy:
  - [ ] Produce per-file extraction results before chunking.
  - [ ] Fail/skip decisions must be deterministic and recorded in diagnostics.

- [ ] Binary skip exceptions:
  - [ ] Update `src/index/build/file-processor/skip.js` to treat `.pdf`/`.docx` as extractable binaries when extraction is enabled, routing them to extractors instead of skipping.

- [ ] File processing routing:
  - [ ] Update `src/index/build/file-processor.js` (and `src/index/build/file-processor/assemble.js` as needed) to:
    - [ ] hash on raw bytes (caching correctness even if extraction changes)
    - [ ] extract structured units
    - [ ] build a deterministic joined text representation with a stable offset mapping
    - [ ] chunk via the dedicated pdf/docx chunkers
    - [ ] emit chunks with `segment` provenance and `lang:'prose'` (or a dedicated document language marker)
    - [ ] ensure chunk identity cannot collide with code chunks (segment markers must be part of identity)

- [ ] Record per-file extraction outcomes:
  - [ ] Success: record page/paragraph counts and warnings.
  - [ ] Failure/skip: record reason (`missing_dependency`, `extract_failed`, `oversize`, etc.) and include actionable guidance.
- [ ] Emit a lightweight `extraction_report.json` per build (counts + per-file status + extractor versions) for audit/regression.
  - [ ] Include `extractionIdentityHash` (bytes hash + extractor version + normalization policy) in the report.

- [ ] Chunking dispatch registration:
  - [ ] Update `src/index/chunking/dispatch.js` to route `.pdf`/`.docx` through the document chunkers under the same gating.

Touchpoints:
- `src/index/build/discover.js`
- `src/index/build/file-processor/skip.js`
- `src/index/build/file-processor.js`
- `src/index/build/file-processor/assemble.js`
- `src/index/chunking/dispatch.js`
- `docs/specs/document-extraction.md` (gating + skip reasons)
- `src/index/build/build-state.js` (record extraction outcomes)
- `src/contracts/schemas/build-state.js`
- `src/contracts/validators/build-state.js`
 - `src/index/build/artifacts.js` (emit extraction_report)
 - `src/contracts/schemas/artifacts.js` + `src/contracts/validators/artifacts.js`

#### Tests
- [ ] `tests/indexing/extracted-prose/documents-included-when-available.test.js` (conditional; when deps available)
  - [ ] Build fixture containing a sample PDF and DOCX; assert chunks exist with `segment.type:'pdf'|'docx'` and searchable text is present.
- [ ] `tests/indexing/extracted-prose/documents-skipped-when-unavailable.test.js`
  - [ ] Force capabilities off; build succeeds; skipped docs are reported deterministically with reasons.
- [ ] `tests/indexing/extracted-prose/document-extraction-outcomes-recorded.test.js`
  - [ ] Fail/skip reasons are recorded in build_state and are stable across runs.
- [ ] `tests/indexing/extracted-prose/extraction-report.test.js`
  - [ ] Report is emitted, schema-valid, and deterministic for the same inputs.
  - [ ] `extractionIdentityHash` changes when extractor version or normalization policy changes.
- [ ] `tests/indexing/extracted-prose/document-bytes-hash-stable.test.js`
  - [ ] Ensure caching identity remains tied to bytes + extractor version/config.
- [ ] `tests/indexing/extracted-prose/document-chunk-id-no-collision.test.js`
  - [ ] Document chunks must not collide with code chunk identities for identical text.

### 16.4 metaV2 and chunk_meta contract extensions for extracted documents

- [ ] Extend metaV2 for extracted docs in `src/index/metadata-v2.js`:
  - [ ] Add a `document` (or `segment`) block with provenance fields:
    - `sourceType: 'pdf'|'docx'`
    - `pageStart/pageEnd` (PDF)
    - `paragraphStart/paragraphEnd` (DOCX)
    - optional `headingPath`, `windowIndex`, and a stable `anchor` for citation.
- [ ] Ensure `chunk_meta.jsonl` includes these fields and that output is backend-independent (artifact vs SQLite).
- [ ] If metaV2 is versioned, bump schema version (or add one) and provide backward-compatible normalization.
- [ ] Guard new fields behind a schema version and require forward-compat behavior (unknown fields ignored by readers).

Touchpoints:
- `src/index/metadata-v2.js`
- `src/index/build/file-processor/assemble.js`
- Retrieval loaders that depend on metaV2 (for parity checks)
- `src/contracts/schemas/artifacts.js` (metaV2 + chunk_meta contract updates)
- `src/contracts/validators/artifacts.js`
- `docs/contracts/artifact-contract.md`

#### Tests
- [ ] `tests/indexing/metav2/metaV2-extracted-doc.test.js`
  - [ ] Verify extracted-doc schema fields are present, typed, and deterministic.
- [ ] `tests/indexing/metav2/metaV2-unknown-fields-ignored.test.js`
  - [ ] Readers ignore unknown fields and still parse required fields deterministically.
- [ ] `tests/services/sqlite-hydration-metaV2-parity.test.js`
  - [ ] Build an index; load hits via artifact-backed and SQLite-backed paths; assert canonical metaV2 fields match for extracted docs.

### 16.5 Prose retrieval routing defaults + FTS query compilation correctness (explainable, deterministic)

- [ ] Enforce routing defaults:
  - [ ] `prose` / `extracted-prose` → SQLite FTS by default.
  - [ ] `code` → sparse/postings by default.
  - [ ] Overrides select requested providers and are reflected in `--explain` output.
  - [ ] Publish a routing decision table (query type × provider availability × override) in `docs/specs/prose-routing.md`.
  - [ ] `--explain` must log the chosen provider and the decision path (default vs override vs fallback).
  - [ ] Separate routing policy (desired provider) from availability (actual provider); define deterministic fallback order.

- [ ] Make FTS query compilation AST-driven for prose routes:
  - [ ] Generate the FTS5 `MATCH` string from the raw query (or parsed boolean AST).
  - [ ] Quote/escape terms so punctuation (`-`, `:`, `\"`, `*`) and keywords (`NEAR`, etc.) are not interpreted as operators unintentionally.
  - [ ] Include the final compiled `MATCH` string and provider choice in `--explain`.

- [ ] Provider variants and deterministic selection (conditional and explicit):
  - [ ] Default: `unicode61 remove_diacritics 2` variant.
  - [ ] Conditional: porter variant for Latin-script stemming use-cases.
  - [ ] Conditional: trigram variant for substring/CJK/emoji fallback behind `--fts-trigram` until benchmarks are complete.
  - [ ] Conditional: NFKC-normalized variant when normalization changes the query.
  - [ ] Merge provider result sets deterministically by `chunkUid` with stable tie-breaking.

- [ ] Enforce capability gating at provider boundaries (never throw):
  - [ ] If FTS tables are missing, providers return “unavailable” results and the router selects an alternative or returns a deterministic warning.

Touchpoints:
- `src/retrieval/pipeline.js`
- `src/retrieval/query.js` / `src/retrieval/query-parse.js`
- `src/retrieval/sqlite-helpers.js`
- `src/retrieval/sqlite-cache.js`
- `docs/specs/prose-routing.md` (routing defaults + FTS explain contract)
 - `src/retrieval/output/explain.js` (routing + MATCH string output)

#### Tests
- [ ] `tests/retrieval/backend/search-routing-policy.test.js`
  - [ ] Prose defaults to FTS; code defaults to postings; overrides behave deterministically and are explained.
- [ ] `tests/retrieval/query/sqlite-fts-query-escape.test.js`
  - [ ] Punctuation cannot inject operators; the compiled `MATCH` string is stable and safe.
- [ ] `tests/retrieval/backend/fts-tokenizer-config.test.js`
  - [ ] Assert baseline tokenizer uses diacritic-insensitive configuration; include a diacritic recall fixture.
 - [ ] `tests/retrieval/backend/fts-missing-table-fallback.test.js`
   - [ ] Missing FTS tables returns a controlled “unavailable” result with a warning (no throw).

### 16.6 Sweep-driven correctness fixes in retrieval helpers touched by prose FTS routing

- [ ] Every fix in this sweep must ship with a regression test (no fix-only changes).

- [ ] Fix `rankSqliteFts()` correctness for `allowedIds`:
  - [ ] When `allowedIds` is too large for a single `IN (...)`, implement adaptive overfetch (or chunked pushdown) until:
    - [ ] `topN` hits remain after filtering, or
    - [ ] a hard cap/time budget is hit.
  - [ ] Ensure results are the true “top-N among allowed IDs” (do not allow disallowed IDs to occupy limited slots).

- [ ] Fix weighting and LIMIT-order correctness in FTS ranking:
  - [ ] If `chunks.weight` is part of ranking, incorporate it into ordering before applying `LIMIT` (or fetch enough rows to make post-weighting safe).
  - [ ] Add stable tie-breaking rules and make them part of the contract.

- [ ] Fix `unpackUint32()` alignment safety:
  - [ ] Avoid constructing a `Uint32Array` view on an unaligned Buffer slice.
  - [ ] When needed, copy to an aligned `ArrayBuffer` (or decode via `DataView`) before reading.

- [ ] Ensure helper-level capability guards are enforced:
  - [ ] If `chunks_fts` is missing, `rankSqliteFts` returns `[]` or a controlled “unavailable” result (not throw).

Touchpoints:
- `src/retrieval/sqlite-helpers.js`
 - `src/retrieval/output/explain.js` (surface fallback/overfetch decisions)

#### Tests
- [ ] `tests/retrieval/backend/rankSqliteFts-allowedIds-correctness.test.js`
- [ ] `tests/retrieval/backend/rankSqliteFts-weight-before-limit.test.js`
 - [ ] `tests/retrieval/backend/rankSqliteFts-missing-table-is-controlled-error.test.js`
- [ ] `tests/retrieval/backend/unpackUint32-buffer-alignment.test.js`

### 16.7 Query intent classification + boolean parsing semantics (route-aware, non-regressing)

- [ ] Fix path-intent misclassification so routing is reliable:
  - [ ] Replace the “any slash/backslash implies path” heuristic with more discriminating signals:
    - [ ] require path-like segments (multiple separators, dot-extensions, `./` / `../`, drive roots), and
    - [ ] treat URLs separately so prose queries containing `https://...` do not get path-biased.
  - [ ] Keep intent scoring explainable and stable.
  - [ ] Prefer grammar-first parsing; only fall back to heuristic tokenization on parse failure.
  - [ ] Emit the final intent classification (and any fallback reason) in `--explain`.

- [ ] Harden boolean parsing semantics to support FTS compilation and future strict evaluation:
  - [ ] Treat unary `-` as NOT even with whitespace (e.g., `- foo`, `- "phrase"`), or reject standalone `-` with a parse error.
  - [ ] Ensure phrase parsing behavior is explicit (either implement minimal escaping or formally document “no escaping”).
  - [ ] Prevent flattened token inventories from being mistaken for semantic constraints:
    - [ ] rename inventory lists (or attach an explicit `inventoryOnly` marker) so downstream code cannot accidentally erase boolean semantics.

Touchpoints:
- `src/retrieval/query-intent.js`
- `src/retrieval/query.js`

#### Tests
- [ ] `tests/retrieval/query/query-intent-path-heuristics.test.js`
- [ ] `tests/retrieval/query/boolean-unary-not-whitespace.test.js`
- [ ] `tests/retrieval/query/boolean-inventory-vs-semantics.test.js`

### 16.8 Retrieval output shaping: `scoreBreakdown` consistency + explain fidelity, plus harness drift repair

- [ ] Resolve `scoreBreakdown` contract inconsistencies:
  - [ ] Standardize field names and nesting across providers (SQLite FTS, postings, vector) so consumers do not need provider-specific logic.
  - [ ] Ensure verbosity/output size is governed by a single budget policy (max bytes/fields/explain items).
  - [ ] Add a schema version for `scoreBreakdown` and require all providers to emit it.

- [ ] Ensure `--explain` is complete and deterministic:
  - [ ] Explain must include:
    - routing decision
    - compiled FTS `MATCH` string for prose routes
    - provider variants used and thresholds
    - capability gating decisions when features are unavailable

- [ ] Repair script-coverage harness drift affecting CI signal quality:
  - [ ] Align `tests/tooling/script-coverage/actions.test.js` `covers` entries with actual `package.json` scripts.
  - [ ] Ensure `tests/tooling/script-coverage/report.test.js` does not fail with `unknownCovers` for legitimate cases.

Touchpoints:
- `src/retrieval/output/*`
- `tests/tooling/script-coverage/*`
- `package.json`
- `docs/testing/truth-table.md` (optional-deps + skip policy alignment)

#### Tests
- [ ] `tests/retrieval/contracts/score-breakdown-contract-parity.test.js`
- [ ] `tests/retrieval/contracts/score-breakdown-snapshots.test.js`
  - [ ] Snapshot `scoreBreakdown` for each backend to lock the schema shape.
- [ ] `tests/retrieval/output/explain-output-includes-routing-and-fts-match.test.js`
- [ ] `tests/tooling/script-coverage/harness-parity.test.js`
 - [ ] `tests/retrieval/contracts/score-breakdown-budget-limits.test.js`



---

## Phase 17 — Vector-Only Profile (Build + Search Without Sparse Postings)

> This is the **canonical merged phase** for the previously overlapping “Phase 17” and “Phase 18” drafts.  
> Goal: a *vector-only* index that can be built and queried **without** sparse/token/postings artifacts.

### Objective

Enable an indexing profile that is:

- **Embeddings-first**: dense vectors are the primary (and optionally only) retrieval substrate.
- **Sparse-free**: skips generation and storage of sparse token postings (and any derived sparse artifacts).
- **Strict and explicit**: search refuses to “pretend” sparse exists; mismatched modes are hard errors with actionable messages.
- **Artifact-consistent**: switching profiles cannot leave stale sparse artifacts that accidentally affect search.

This is especially valuable for:
- huge corpora where sparse artifacts dominate disk/time,
- doc-heavy or mixed corpora where ANN is the primary workflow,
- environments where you want fast/cheap rebuilds and can accept ANN-only recall.

Additional docs that MUST be updated if Phase 17 adds new behavior or config:
- `docs/contracts/indexing.md` + `docs/contracts/artifact-contract.md` + `docs/contracts/artifact-schemas.md`
- `docs/config/schema.json` + `docs/config/contract.md` + `docs/config/inventory.md`
- `docs/guides/commands.md` (new flags / routing semantics)
- `docs/specs/vector-only-profile.md` (new; profile contract + search behavior)

---

### Exit criteria (must all be true)

- [ ] Config supports `indexing.profile: "default" | "vector_only"` (default: `"default"`).
- [ ] `vector_only` builds succeed end-to-end and **do not emit** sparse artifacts (tokens/postings/minhash/etc).
- [ ] Search against a `vector_only` index:
  - [ ] requires an ANN-capable provider (or explicit `--ann`), and
  - [ ] rejects token/sparse-dependent features with a clear error (not silent degradation).
- [ ] `index_state.json` records the profile and a machine-readable “artifact presence” manifest with a schema version.
- [ ] SQLite-backed retrieval cannot crash on missing sparse tables; it either:
  - [ ] uses a vector-only schema, or
  - [ ] detects missing tables and returns a controlled “profile mismatch / artifact missing” error.
- [ ] Tests cover: profile switching cleanup, ANN-only search, and “mismatch is an error” behavior.

---

### Phase 17.1 — Profile contract + build-state / index-state schema

- [ ] Add and normalize config:
  - [ ] `indexing.profile` (string enum): `default | vector_only`
  - [ ] Default behavior: absent ⇒ `default`
  - [ ] Reject unknown values (fail-fast in config normalization)

- [ ] Define the canonical on-disk contract in `index_state.json`:

  - [ ] Add a `profile` block (versioned):
    - [ ] `profile.id: "default" | "vector_only"`
    - [ ] `profile.schemaVersion: 1`
  - [ ] Record the same profile block in build-state/build reports for traceability.
- [ ] Add an `artifacts` presence block (versioned) so loaders can reason about what exists:
    - [ ] `artifacts.schemaVersion: 1`
    - [ ] `artifacts.present: { [artifactName]: true }` (only list artifacts that exist)
    - [ ] `artifacts.omitted: string[]` (explicit omissions for the selected profile)
    - [ ] `artifacts.requiredForSearch: string[]` (profile-specific minimum set)

  - [ ] Add a build-time invariant:
    - [ ] If `profile.id === "vector_only"`, then `token_postings*`, `token_vocab`, `token_stats`, `minhash*`, and any sparse-only artifacts MUST NOT be present.
  - [ ] Define a strict vector_only artifact contract and validation rules (explicit allowlist/denylist).

- [ ] Ensure build signatures include profile:
  - [ ] signature/caching keys must incorporate `profile.id` so switching profiles forces a rebuild.
  - [ ] compatibilityKey (and/or cohortKey) must include `profile.id` and `profile.schemaVersion` to prevent mixing vector_only and default indexes.

Touchpoints:
- `docs/config/schema.json`
- `src/index/build/runtime/runtime.js` (read + normalize `indexing.profile`)
- `src/index/build/indexer/signatures.js` (include profile in signature)
- `src/index/build/artifacts.js` (index_state emission + artifacts presence block)
- `src/retrieval/cli/index-state.js` (surface profile + artifacts in `index_status`)
- `src/contracts/schemas/artifacts.js` (index_state contract updates)
- `src/contracts/validators/artifacts.js`
 - `src/index/validate/index-validate.js` (enforce vector_only artifact allowlist/denylist)

#### Tests
- [ ] `tests/indexing/contracts/profile-index-state-contract.test.js`
  - [ ] Build tiny index with each profile and assert `index_state.json.profile` + `index_state.json.artifacts` satisfy schema invariants.
- [ ] `tests/indexing/contracts/profile-artifacts-present-omitted-consistency.test.js`
  - [ ] `artifacts.present` and `artifacts.omitted` are disjoint and consistent with profile.
- [ ] `tests/indexing/contracts/profile-index-state-has-required-artifacts.test.js`
  - [ ] `artifacts.requiredForSearch` is populated and profile-consistent.
 - [ ] `tests/indexing/validate/vector-only-artifact-contract.test.js`
   - [ ] Validation fails if any sparse artifacts are present in vector_only builds.

---

### Phase 17.2 — Build pipeline gating (skip sparse generation cleanly)

- [ ] Thread `profile.id` into the indexer pipeline and feature settings:
  - [ ] In `vector_only`, set `featureSettings.tokenize = false` (and ensure all downstream steps respect it)
  - [ ] Ensure embeddings remain enabled/allowed (vector-only without vectors should be rejected at build time unless explicitly configured to “index without vectors”)

- [ ] Skip sparse stages when `vector_only`:
  - [ ] Do not run `buildIndexPostings()` (or make it a no-op) when tokenize=false.
  - [ ] Do not write sparse artifacts in `writeIndexArtifactsForMode()` / `src/index/build/artifacts.js`.
  - [ ] Hard-fail the build if any forbidden sparse artifacts are detected in the output directory.

- [ ] Cleanup/consistency when switching profiles:
  - [ ] When building `vector_only`, proactively remove any prior sparse artifacts in the target output dir so stale files cannot be accidentally loaded.
  - [ ] When building `default`, ensure sparse artifacts are emitted normally (and any vector-only-only special casing does not regress).

- [ ] Ensure “missing doc embedding” representation stays stable:
  - [ ] Continue using the existing **zero-length typed array** convention for missing vectors.
  - [ ] Add a regression test so future refactors don’t reintroduce `null`/NaN drift.

Touchpoints:
- `src/index/build/indexer/pipeline.js` (profile → feature gating)
- `src/index/build/indexer/steps/postings.js` (skip when tokenize=false)
- `src/index/build/indexer/steps/write.js` + `src/index/build/artifacts.js` (omit sparse artifacts)
- `src/index/build/file-processor/embeddings.js` (missing-doc marker regression)
- `src/contracts/validators/artifacts.js` (validate artifacts.present/omitted consistency)

#### Tests
- [ ] `tests/indexing/postings/vector-only-does-not-emit-sparse.test.js`
  - [ ] Assert absence of `token_postings*`, `token_vocab*`, `token_stats*`, `minhash*`.
- [ ] `tests/indexing/postings/vector-only-switching-cleans-stale-sparse.test.js`
  - [ ] Build default, then vector_only into same outDir; assert sparse artifacts removed.
 - [ ] `tests/indexing/postings/vector-only-missing-embeddings-is-error.test.js`
   - [ ] Building vector_only without embeddings enabled fails with a clear error.

---

### Phase 17.3 — Search routing + strict profile compatibility

- [ ] Load and enforce `index_state.json.profile` at query time:
  - [ ] If the index is `vector_only`:
    - [ ] default router must choose ANN/vector provider(s)
    - [ ] sparse/postings providers must be disabled/unavailable
  - [ ] If a caller explicitly requests sparse-only behavior against vector_only:
    - [ ] return a controlled error with guidance (“rebuild with indexing.profile=default”)

- [ ] Token-dependent query features must be explicit:
  - [ ] If a query requests phrase/boolean constraints that require token inventory:
    - [ ] either (a) reject with error, or (b) degrade with a warning and set `explain.warnings[]` (pick one policy and make it part of the contract)
  - [ ] Choose and document the policy (reject vs warn) and make it consistent across CLI/API/MCP.
  - [ ] Default policy should be **reject**; allow fallback only with an explicit `--allow-sparse-fallback` / `allowSparseFallback` override.

- [ ] SQLite helper hardening for profile-aware operation:
  - [ ] Add a lightweight `requireTables(db, names[])` helper used at provider boundaries.
  - [ ] Providers must check required tables for their mode and return an actionable “tables missing” error (not throw).

Touchpoints:
- `src/retrieval/pipeline.js` (router)
- `src/retrieval/index-load.js` (ensure index_state loaded early)
- `src/retrieval/sqlite-helpers.js` (table guards)
- `src/retrieval/providers/*` (respect profile + missing-table outcomes)
- `src/retrieval/output/explain.js` (surface profile + warnings)
- `docs/specs/vector-only-profile.md` (routing + mismatch policy)
 - `src/retrieval/output/format.js` (error/warning rendering)

#### Tests
- [ ] `tests/retrieval/backend/vector-only-search-requires-ann.test.js`
- [ ] `tests/retrieval/backend/vector-only-rejects-sparse-mode.test.js`
- [ ] `tests/retrieval/backend/sqlite-missing-sparse-tables-is-controlled-error.test.js`
- [ ] `tests/retrieval/output/explain-vector-only-warnings.test.js`
 - [ ] `tests/retrieval/backend/vector-only-compatibility-key-mismatch.test.js`
   - [ ] Mixed profile indexes are rejected unless explicitly allowed (federation/cohort gating).

---

### Phase 17.4 — Optional: “analysis policy shortcuts” for vector-only builds (stretch)

This is explicitly optional, but worth considering because it is where most build time goes for code-heavy repos.

- [ ] Add a documented policy switch: when `indexing.profile=vector_only`, default `analysisPolicy` can disable:
  - [ ] type inference
  - [ ] risk analysis
  - [ ] expensive cross-file passes
  - [ ] (optionally) lint/complexity stages
- [ ] Make these *opt-outable* (users can re-enable per setting).
  - [ ] Record any disabled analysis features in the build report for transparency.

Touchpoints:
- `src/index/build/indexer/pipeline.js` (feature flags)
- `docs/config/` (document defaults and overrides)

## Phase 18 — Distribution & Platform Hardening (Release Matrix, Packaging, and Optional Python)

### Objective
Make PairOfCleats releasable and operable across supported platforms by defining a **release target matrix**, adding a **deterministic release smoke-check**, hardening **cross-platform path handling**, and producing **reproducible editor/plugin packages** (Sublime + VS Code) with CI gates.

This phase also standardizes how Python-dependent tests and tooling behave when Python is missing: they must **skip cleanly** (without producing “false red” CI failures), while still failing when Python is present but the test is genuinely broken.

Additional docs that MUST be updated if Phase 18 adds new behavior or config:
- `docs/guides/release-discipline.md`
- `docs/guides/commands.md` (release-check + packaging commands)
- `docs/guides/editor-integration.md`
- `docs/guides/service-mode.md`
- `docs/config/schema.json` + `docs/config/contract.md` (if new config flags are added)

### Exit Criteria
- A documented release target matrix exists (platform × Node version × optional dependencies policy).
- A deterministic `release-check` smoke run exists and is runnable locally and in CI, and it validates:
  - `pairofcleats --version`
  - `pairofcleats index build` + `index validate`
  - a basic `search` against a fixture repo
  - presence/packaging sanity of editor integrations (when enabled)
- Cross-platform “paths with spaces” (and Windows path semantics) have regression tests, and the audited commands pass.
- Sublime packaging is reproducible and validated by tests (structure + version stamping).
- VS Code extension packaging is reproducible and validated by tests (or explicitly gated as non-blocking if the packaging toolchain is absent).
- Python-dependent tests pass on machines without Python (skipped) and still enforce Python syntax correctness when Python is present.

---

### Phase 18.1 — Release target matrix + deterministic release smoke-check
- [ ] Define and publish the **release target matrix** and optional-dependency policy.
  - Primary output:
    - `docs/guides/release-matrix.md` (new)
  - Include:
    - Supported OSes and runners (Linux/macOS/Windows) and architectures (x64/arm64 where supported).
    - Supported Node versions (minimum + tested versions).
    - Optional dependency behavior policy (required vs optional features), including:
      - Python (for Sublime lint/compile tests)
      - Editor integrations (Sublime + VS Code)
      - Any “bring-your-own” optional deps used elsewhere (e.g., extraction/SDK/tooling)
    - “Fail vs degrade” posture for each optional capability (what is allowed to skip, and what must hard-fail).
- [ ] Expand the existing `tools/release-check.js` from “changelog-only” into a **deterministic release smoke-check runner**.
  - Touchpoints:
    - `tools/release-check.js` (extend; keep it dependency-light)
    - `bin/pairofcleats.js` (invoked by the smoke check; no behavioral changes expected here)
    - `src/shared/subprocess.js` (shared spawn/timeout helpers)
  - Requirements:
    - Must not depend on shell string concatenation; use spawn with args arrays.
    - Must set explicit `cwd` and avoid fragile `process.cwd()` assumptions (derive repo root from `import.meta.url` or accept `--repo-root`).
    - Must support bounded timeouts and produce actionable failures (which step failed, stdout/stderr excerpt).
    - Should support `--json` output with a stable envelope for CI automation (step list + pass/fail + durations).
    - Produce a reproducible `release-manifest.json` with artifact checksums (sha256) and an SBOM reference, and sign it (with CI verification).
  - Smoke steps (minimum):
    - Verify Node version compatibility (per the target matrix).
    - Run `pairofcleats --version`.
    - Run `pairofcleats index build` on a small fixture repo into a temp cacheRoot.
    - Run `pairofcleats index validate --strict` against the produced build.
    - Run a basic `pairofcleats search` against the build and assert non-empty or expected shape.
    - Verify editor integration assets exist when present:
      - Sublime: `sublime/PairOfCleats/**`
      - VS Code: `extensions/vscode/**`
- [ ] Add CI wiring for the smoke check.
  - Touchpoints:
    - `.github/workflows/ci.yml`
    - `package.json` scripts (optional, if CI should call a stable npm script)
    - `docs/guides/release-matrix.md` (source of truth for versions and policies)
    - `docs/guides/release-discipline.md` (release checks + required gates)
  - Requirements:
    - Add a release-gate lane that runs `npm run release-check` plus the new smoke steps.
    - Add OS coverage beyond Linux (at minimum: Windows already exists; add macOS for the smoke check).
    - Align CI Node version(s) with the release target matrix, and ensure the matrix is explicitly documented.

#### Tests / Verification
- [ ] `tests/tooling/release/release-check-smoke.test.js`
  - Runs `node tools/release-check.js` in a temp environment and asserts it succeeds on a healthy checkout.
- [ ] `tests/tooling/release/release-check-json.test.js`
  - Runs `release-check --json` and asserts stable JSON envelope fields (schemaVersion, steps[], status).
- [ ] `tests/tooling/release/release-check-exit-codes.test.js`
  - Failing step returns non-zero and includes the failing step name in stderr.
- [ ] CI verification:
  - [ ] Add a job that runs the smoke check on at least Linux/macOS/Windows with pinned Node versions per the matrix.

---

### Phase 18.2 — Cross-platform path safety audit + regression tests (including spaces)
- [ ] Audit filesystem path construction and CLI spawning for correctness on:
  - paths with spaces
  - Windows separators and drive roots
  - consistent repo-relative path normalization for public artifacts (canonical `/` separators)
- [ ] Fix issues discovered during the audit in the “release-critical surface”.
  - Minimum scope for this phase:
    - `tools/release-check.js` (must behave correctly on all supported OSes)
    - packaging scripts added in Phase 18.3/18.5
    - tests added by this phase (must be runnable on CI runners and locally)
  - Broader issues discovered outside this scope should either:
    - be fixed here if the touched files are already being modified, or
    - be explicitly deferred to a named follow-on phase (with a concrete subsection placeholder).
- [ ] Add regression tests for path safety and quoting.
  - Touchpoints:
    - `tests/tooling/platform/paths-with-spaces.test.js` (new)
    - `tests/tooling/platform/windows-paths-smoke.test.js` (new; conditional when not on Windows)
    - `src/shared/files.js` (path normalization helpers)
    - `src/shared/subprocess.js` (argument quoting + spawn safety)
  - Requirements:
    - Create a temp repo directory whose absolute path includes spaces.
    - Run build + validate + search using explicit `cwd` and temp cacheRoot.
    - Ensure the artifacts still store repo-relative paths with `/` separators.
    - Add property-based or table-driven cases for edge paths: drive-letter prefixes (including `C:/` on POSIX), NFC/NFD normalization, and trailing dots/spaces.

#### Tests / Verification
- [ ] `tests/tooling/platform/paths-with-spaces.test.js`
  - Creates `repo with spaces/` under a temp dir; runs build + search; asserts success.
- [ ] `tests/tooling/platform/windows-paths-smoke.test.js`
  - On Windows CI, verifies key commands succeed and produce valid outputs.
- [ ] `tests/tooling/platform/path-edge-cases.test.js`
  - Exercises drive-letter-like paths on POSIX, NFC/NFD normalization, and trailing dots/spaces.
- [ ] Extend `tools/release-check.js` to include a `--paths` step that runs the above regression checks in quick mode.

---

### Phase 18.3 — Sublime plugin packaging pipeline (bundled, reproducible)
- [ ] Implement a reproducible packaging step for the Sublime plugin.
  - Touchpoints:
    - `sublime/PairOfCleats/**` (source)
    - `tools/package-sublime.js` (new; Node-only)
    - `package.json` scripts (optional: `npm run package:sublime`)
  - Requirements:
    - Package `sublime/PairOfCleats/` into a distributable artifact (`.sublime-package` zip or Package Control–compatible format).
    - Determinism requirements:
      - Stable file ordering in the archive.
      - Normalized timestamps/permissions where feasible.
      - Version-stamp the output using root `package.json` version.
    - Packaging must be Node-only (must not assume Python is present).
- [ ] Add installation and distribution documentation.
  - Touchpoints (choose one canonical location):
    - `docs/guides/editor-integration.md` (add Sublime section), and/or
    - `sublime/PairOfCleats/README.md` (distribution instructions)
  - Include:
    - Manual install steps and Package Control posture.
    - Compatibility notes (service-mode requirements, supported CLI flags, cacheRoot expectations).

#### Tests / Verification
- [ ] `tests/tooling/sublime/package-structure.test.js`
  - Runs the packaging script; asserts expected files exist in the output and that version metadata matches root `package.json`.
- [ ] `tests/tooling/sublime/package-determinism.test.js` (if feasible)
  - Packages twice; asserts the archive is byte-identical (or semantically identical with a stable file list + checksums).

---

### Phase 18.4 — Make Python tests and tooling optional (skip cleanly when Python is missing)
- [ ] Update Python-related tests to detect absence of Python and **skip with a clear message** (not fail).
  - Touchpoints:
    - `tests/tooling/sublime/sublime-pycompile.test.js` (must be guarded)
    - `tests/tooling/sublime/test_*.py` (only if these are invoked by CI or tooling; otherwise keep as optional)
    - `tests/helpers/skip.js` (skip exit code + messaging helper)
    - `tests/helpers/test-env.js` (consistent skip env setup)
  - Requirements:
    - Prefer `spawnSync(python, ['--version'])` and treat ENOENT as “Python unavailable”.
    - When Python is unavailable:
      - print a single-line skip reason to stderr
      - exit using the project’s standard “skip” mechanism (see below)
    - When Python is available:
      - the test must still fail for real syntax errors (no silent skips).
    - Centralize Python detection in a shared helper (e.g., `tests/helpers/python.js`) used by all Python-dependent tests/tooling.
- [x] JS test harness recognizes “skipped” tests via exit code 77.
  - Touchpoints:
    - `tests/run.js` (treat a dedicated exit code, e.g. `77`, as `skipped`)
  - Requirements:
    - `SKIP` must appear in console output (like PASS/FAIL).
    - JUnit output must mark skipped tests as skipped.
    - JSON output must include `status: 'skipped'`.
- [ ] Add a small unit test that proves the “Python missing → skipped” path is wired correctly.
  - Touchpoints:
    - `tests/tooling/python/python-availability-skip.test.js` (new)
  - Approach:
    - mock or simulate ENOENT from spawnSync and assert the test exits with the “skip” code and emits the expected message.

#### Tests / Verification
- [ ] `tests/tooling/sublime/sublime-pycompile.test.js`
  - Verified behavior:
    - Without Python: skips (non-failing) with a clear message.
    - With Python: compiles all `.py` files under `sublime/PairOfCleats/**` and fails on syntax errors.
- [ ] `tests/tooling/python/python-availability-skip.test.js`
  - Asserts skip-path correctness and ensures we do not “skip on real failures”.
 - [ ] `tests/tooling/python/python-skip-message.test.js`
   - Ensures skip message is a single line and includes the missing executable name.

---

### Phase 18.5 — VS Code extension packaging + compatibility (extension exists)
- [ ] Add a reproducible VS Code extension packaging pipeline (VSIX).
  - Touchpoints:
    - `extensions/vscode/**` (source)
    - `package.json` scripts (new: `package:vscode`), and/or `tools/package-vscode.js` (new)
    - `.vscodeignore` / `extensions/vscode/.vscodeignore` (packaging include/exclude list)
  - Requirements:
    - Use a pinned packaging toolchain (recommended: `@vscode/vsce` as a devDependency).
    - Output path must be deterministic and placed under a temp/artifacts directory suitable for CI.
    - Packaging must not depend on repo-root `process.cwd()` assumptions; set explicit cwd.
    - Validate `engines.vscode` compatibility against the documented release matrix and fail if mismatched.
- [ ] Ensure the extension consumes the **public artifact surface** via manifest discovery and respects user-configured `cacheRoot`.
  - Touchpoints:
    - `extensions/vscode/extension.js`
    - `extensions/vscode/package.json`
  - Requirements:
    - No hard-coded internal cache paths; use configuration + CLI contracts.
    - Any default behaviors must be documented and overridable via settings.
- [ ] Add a conditional CI gate for VSIX packaging.
  - If the VSIX toolchain is present, packaging must pass.
  - If the toolchain is intentionally absent in some environments, the test must skip (not fail) with an explicit message.

#### Tests / Verification
- [ ] `tests/tooling/vscode/extension-packaging.test.js`
  - Packages a VSIX and asserts the output exists (skips if packaging toolchain is unavailable).
- [ ] Extend `tests/tooling/vscode/vscode-extension.test.js`
  - Validate required activation events/commands and required configuration keys (and add any cacheRoot-related keys if the contract requires them).
  - Validate `engines.vscode` compatibility constraints.

---

### Phase 18.6 — Service-mode bundle + distribution documentation (API server + embedding worker)
- [ ] Ship a service-mode “bundle” (one-command entrypoint) and documentation.
  - Touchpoints:
    - `tools/api-server.js`
    - `tools/indexer-service.js`
    - `tools/service/**` (queue + worker)
    - `docs/guides/service-mode.md` (add bundle section) or a section in `docs/guides/commands.md`
  - Requirements:
    - Define canonical startup commands, required environment variables, and queue storage paths.
    - Document security posture and safe defaults:
      - local-only binding by default
      - explicit opt-in for public binding
      - guidance for auth/CORS if exposed
    - Ensure the bundle uses explicit args and deterministic logging conventions (stdout vs stderr).
- [ ] Add an end-to-end smoke test for the service-mode bundle wiring.
  - Use stub embeddings or other deterministic modes where possible; do not require external services.
  - Include a readiness probe and bounded timeout to avoid hangs.
  - Ensure clean shutdown of API server + worker (no leaked processes).

#### Tests / Verification
- [ ] `tests/services/service-mode-smoke.test.js`
  - Starts API server + worker in a temp environment; enqueues a small job; asserts it is processed and the API responds.
- [ ] Extend `tools/release-check.js` to optionally run a bounded-time service-mode smoke step (`--service-mode`).

---

## WHAT IF WE DIDNT NEED SHOES

This is an optional, high-impact exploration track that assumes we can add native or WASM-accelerated components to substantially improve retrieval and indexing performance beyond what is feasible in JS alone. Everything here must have clean fallbacks and must never change functional semantics.

### Objective

Identify and integrate optional native/WASM accelerators for the heaviest hot paths (bitmap filtering, top-K ranking, ANN scoring, and search pipeline orchestration) with strict correctness parity and deterministic behavior.

### Goals

- Reduce query latency by offloading hot loops to native/WASM implementations.
- Reduce GC pressure by using typed buffers and shared memory arenas.
- Preserve identical results vs. JS baseline (deterministic ordering and tie-breaking).
- Provide clean capability detection and full JS fallback paths.

### Non-goals

- Making native/WASM dependencies mandatory.
- Changing ranking, filtering, or ANN semantics.
- Replacing existing on-disk index formats.

### Files to modify (exhaustive for this section)

- `src/retrieval/bitmap.js`
- `src/retrieval/filters.js`
- `src/retrieval/filter-index.js`
- `src/retrieval/pipeline/candidates.js`
- `src/retrieval/pipeline/fusion.js`
- `src/retrieval/pipeline/graph-ranking.js`
- `src/retrieval/rankers.js`
- `src/retrieval/ann/providers/*`
- `src/shared/native-accel.js` (new)
- `src/shared/capabilities.js` (new or extend)
- `tools/build-native.js` (new)
- `package.json` (optional deps + build scripts)
- `docs/perf/native-accel.md` (new)
- `docs/specs/native-accel.md` (new)
- `tests/retrieval/native/bitmap-equivalence.test.js` (new)
- `tests/retrieval/native/topk-equivalence.test.js` (new)
- `tests/retrieval/native/ann-equivalence.test.js` (new)
- `tests/retrieval/native/capability-fallback.test.js` (new)
- `tests/retrieval/native/perf-baseline.test.js` (new, opt-in)

### Docs/specs to add or update

- `docs/perf/native-accel.md` (new; performance goals, measurement harness, rollout policy)
- `docs/specs/native-accel.md` (new; interfaces, ABI, fallback behavior, capability detection)
- `docs/guides/commands.md` (add optional build steps for native accel)

### Subphase A — Native Bitmap Engine (Roaring/Bitset)

#### Goals

- Replace large `Set`-based allowlists with roaring bitmap or bitset operations.
- Keep JS bitmap code path as the default fallback.

#### Non-goals

- Changing filter semantics or storage format.

#### Touchpoints

- `src/retrieval/bitmap.js`
- `src/retrieval/filters.js`
- `src/retrieval/filter-index.js`
- `src/shared/native-accel.js` (new)
- `docs/specs/native-accel.md`

#### Tasks

- [ ] Add optional native bitmap module (Node-API addon or WASM) with `and/or/andNot` operations.
- [ ] Implement capability detection and a stable JS fallback shim.
- [ ] Ensure deterministic iteration order when converting back to arrays.
- [ ] Add large-scale bitmap microbenchmarks and memory usage comparisons.

#### Tests

- [ ] `tests/retrieval/native/bitmap-equivalence.test.js`
- [ ] `tests/retrieval/native/capability-fallback.test.js`

#### Acceptance

- [ ] Bitmap operations match JS results exactly.
- [ ] Large filter queries show measurable speedup without semantic changes.

---

### Subphase B — Native Top‑K Selection + Score Accumulation

#### Goals

- Replace full-array sorts with native top‑K selection.
- Accumulate scores in native buffers to reduce GC pressure.

#### Non-goals

- Changing ranking behavior or ordering rules.

#### Touchpoints

- `src/retrieval/pipeline/candidates.js`
- `src/retrieval/pipeline/fusion.js`
- `src/retrieval/rankers.js`
- `src/shared/native-accel.js` (new)
- `docs/specs/native-accel.md`

#### Tasks

- [ ] Add a native top‑K selection module with stable tie‑breaking.
- [ ] Add native score accumulation for BM25 + ANN fusion.
- [ ] Implement typed array exchange or shared memory blocks for scores and ids.
- [ ] Provide a pure JS fallback with identical semantics.

#### Tests

- [ ] `tests/retrieval/native/topk-equivalence.test.js`
- [ ] `tests/retrieval/native/capability-fallback.test.js`

#### Acceptance

- [ ] Top‑K selection matches JS ordering within deterministic tie rules.
- [ ] Reduced memory overhead vs. full sorting for large candidate sets.

---

### Subphase C — ANN Acceleration + Preflight

#### Goals

- Accelerate ANN scoring and filtering using native/WASM backends.
- Avoid slow failure paths with explicit preflight checks.

#### Non-goals

- Replacing existing ANN index formats or configurations.

#### Touchpoints

- `src/retrieval/ann/providers/*`
- `src/retrieval/pipeline/ann-backends.js`
- `src/shared/native-accel.js`
- `docs/specs/native-accel.md`

#### Tasks

- [ ] Add optional ANN scoring backend with feature flags and compatibility checks.
- [ ] Implement preflight capability checks (dims, space, index metadata).
- [ ] Add JS fallback with identical retrieval semantics.

#### Tests

- [ ] `tests/retrieval/native/ann-equivalence.test.js`
- [ ] `tests/retrieval/native/capability-fallback.test.js`

#### Acceptance

- [ ] ANN output parity with JS baseline.
- [ ] Preflight avoids slow retries and confusing failures.

---

### Subphase D — Worker‑Thread Pipeline Offload

#### Goals

- Move heavy query stages to worker threads with shared buffers.
- Keep main thread responsive for CLI output and cancellation.

#### Non-goals

- Changing CLI UX or query semantics.

#### Touchpoints

- `src/retrieval/pipeline.js`
- `src/retrieval/pipeline/candidates.js`
- `src/retrieval/pipeline/fusion.js`
- `src/retrieval/pipeline/graph-ranking.js`
- `src/retrieval/output/format.js`
- `src/shared/worker-pool.js` (new or extend)
- `docs/specs/native-accel.md`

#### Tasks

- [ ] Introduce a worker-pool for retrieval compute stages.
- [ ] Use shared memory arenas for candidates and scores when safe.
- [ ] Add cancellation and timeout propagation.
- [ ] Keep output formatting on main thread with streaming results.

#### Tests

- [ ] `tests/retrieval/native/worker-offload-equivalence.test.js` (new)
- [ ] `tests/retrieval/native/worker-cancel.test.js` (new)

#### Acceptance

- [ ] Worker-offloaded pipeline matches results and ordering.
- [ ] Main-thread responsiveness improves under heavy queries.

---

### Subphase E — Build + Release Strategy for Native/WASM

#### Goals

- Provide reproducible builds for native/WASM components.
- Ensure opt-in installation with clear diagnostics.

#### Non-goals

- Mandatory native dependencies in all environments.

#### Touchpoints

- `tools/build-native.js` (new)
- `package.json`
- `docs/perf/native-accel.md`
- `docs/specs/native-accel.md`
- CI pipelines (add optional native build step)

#### Tasks

- [ ] Add optional build step that produces platform-specific artifacts.
- [ ] Add capability detection and explicit logging for native availability.
- [ ] Document troubleshooting and fallback rules.

#### Tests

- [ ] `tests/retrieval/native/capability-fallback.test.js`
- [ ] `tests/retrieval/native/perf-baseline.test.js` (opt-in)

#### Acceptance

- [ ] Native/WASM acceleration is optional, deterministic, and easy to diagnose.
- [ ] JS fallbacks always function without feature loss.
