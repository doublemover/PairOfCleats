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
- Phase 12 -- MCP Migration + API/Tooling Contract Formalization
    - 12.1 - Dependency strategy and Capability Pating for the Official MCP SDK
    - 12.2 - SDK-backed MCP server (Parallel Mode with Explicit Cutover Flag)
    - 12.3 - Tool Schema Versioning, Conformance, and Drift Guards
    - 12.4 - Error codes, Protocol Negotiation, and Response-Shape Consistency
    - 12.5 - Cancellation, Timeouts, and Process Hygiene
    - 12.6 - Documentation and Migration Notes
- Phase 13 -- JJ Support (via Provider API)
    - 13.1 - Introduce `ScmProvider` Interface + Registry + Config/State Schema Wiring
    - 13.2 - Migrate Git onto the Provider Interface
    - 13.3 - Implement JJ Provider (read-only default, robust parsing)
    - 13.4 - CLI + Tooling Visibility (make SCM selection obvious)
    - 13.5 - Non-Repo Environments (explicitly supported)
- Phase 14 -- Incremental Diffing & Snapshots (Time Travel, Regression Debugging)
    - 14.1 - Snapshot & Diff Artifact Surface (contracts, retention, safety)
    - 14.2 - Pointer Snapshots (creation, validation gating, CLI/API)
    - 14.3 - Frozen Snapshots (immutable copies + integrity verification)
    - 14.4 - Deterministic Diff Computation (bounded, machine-readable)
    - 14.5 - Retrieval + Tooling Integration: “as-of” snapshots and “what changed” surfaces
- Phase 15 -- Federation & Multi-Repo (Workspaces, Catalog, Federated Search)
- Phase 16 -- Prose Ingestion + Retrieval Routing Correctness (PDF/DOCX + FTS policy)
- Phase 17 -- Vector-Only Profile (Embeddings-First, Build + Search w/o Sparse Postings)
- Phase 20 -- Distribution & Platform Hardening (Release Matrix, Packaging, & Optional Python)

---

## Phase 12 — MCP Migration + API/Tooling Contract Formalization

### Objective
Modernize and stabilize PairOfCleats’ integration surface by (1) migrating MCP serving to the **official MCP SDK** (with a safe compatibility window), (2) formalizing MCP tool schemas, version negotiation, and error codes across legacy and SDK transports, and (3) hardening cancellation/timeouts so MCP requests cannot leak work or hang.

- Current grounding: MCP entrypoint is `tools/mcp-server.js` (custom JSON-RPC framing via `tools/mcp/transport.js`), with tool defs in `src/integrations/mcp/defs.js` and protocol helpers in `src/integrations/mcp/protocol.js`.
- This phase must keep existing tools functioning while adding SDK mode, and it must not silently accept inputs that do nothing.

---

### 12.1 Dependency strategy and capability gating for the official MCP SDK

- [ ] Decide how the MCP SDK is provided and make the decision explicit in code + docs.
  - Options:
    - [ ] Dependency (always installed)
    - [ ] Optional dependency (install attempted; failures tolerated)
    - [ ] External optional peer (default; capability-probed)
  - [ ] Implement the chosen strategy consistently:
    - [ ] `package.json` (if dependency/optionalDependency is chosen)
    - [ ] `src/shared/capabilities.js` (probe `@modelcontextprotocol/sdk` and report clearly)
    - [ ] `src/shared/optional-deps.js` (ensure `tryImport()` handles ESM correctly for the SDK)

- [ ] Ensure MCP server mode selection is observable and capability-gated.
  - Touchpoints:
    - [ ] `tools/mcp-server.js` — entrypoint dispatch
    - [ ] `tools/config-dump.js` (or MCP status tool) — report effective MCP mode + SDK availability

#### Tests / Verification

- [ ] Unit: capabilities probe reports `mcp.sdk=true/false` deterministically.
- [ ] CI verification: when SDK is absent, SDK-mode tests are skipped cleanly with a structured reason.

---

### 12.2 SDK-backed MCP server (parallel mode with explicit cutover flag)

- [ ] Implement an SDK-backed server alongside the legacy transport.
  - Touchpoints:
    - [ ] `tools/mcp-server-sdk.js` (new) — SDK-backed server implementation
    - [ ] `tools/mcp-server.js` — dispatch `--mcp-mode legacy|sdk` (or env var), defaulting to legacy until parity is proven
  - [ ] Requirements for SDK server:
    - [ ] Register tools from `src/integrations/mcp/defs.js` as the source of truth.
    - [ ] Route tool calls to the existing implementations in `tools/mcp/tools.js` (no behavior fork).
    - [ ] Support stdio transport as the baseline.
    - [ ] Emit a capabilities payload that allows clients to adapt (e.g., doc extraction disabled, SDK missing, etc.).

- [ ] Add a deprecation window for the legacy transport.
  - [ ] Document the cutover plan and timeline in `docs/mcp.md`.
  - [ ] Keep legacy transport only until SDK parity tests are green, then remove or hard-deprecate with warnings.

#### Tests / Verification

- [ ] Services: `tests/services/mcp/sdk-mode.services.js` (new)
  - Skip if SDK is not installed.
  - Start `tools/mcp-server-sdk.js` and run at least:
    - `tools/list`
    - one representative `tools/call` (e.g., `index_status`)
  - Assert: response shape is valid, errors have stable codes, and server exits cleanly.

---

### 12.3 Tool schema versioning, conformance, and drift guards

- [ ] Make tool schemas explicitly versioned and enforce bump discipline.
  - Touchpoints:
    - [ ] `src/integrations/mcp/defs.js` — add `schemaVersion` (semver or monotonic integer) and `toolingVersion`
    - [ ] `docs/mcp.md` — document compatibility rules for schema changes

- [ ] Consolidate MCP argument → execution mapping to one audited path.
  - Touchpoints:
    - [ ] `tools/mcp/tools.js` (search/build tools)
    - [ ] `src/integrations/core/index.js` (shared arg builder, if used)
  - [ ] Create a single mapping function per tool (or a shared builder) so schema additions cannot be “accepted but ignored”.

- [ ] Conformance requirement for the `search` tool:
  - [ ] Every field in the MCP `search` schema must either:
    - [ ] affect emitted CLI args / search execution, or
    - [ ] be removed from schema, or
    - [ ] be explicitly marked “reserved” and rejected if set.
  - [ ] Avoid duplicative builders (do not maintain two separate lists of flags).

- [ ] Fix known MCP tool wiring correctness hazards in modified files:
  - [x] In `tools/mcp/tools.js`, remove variable shadowing that breaks cancellation/AbortSignal handling (numeric arg is now `contextLines`; `context` remains the `{ signal }` object).

#### Tests / Verification

- [ ] Unit: `tests/unit/mcp-schema-version.unit.js` (new)
  - Assert `schemaVersion` exists.
  - Assert changes to tool defs require bumping `schemaVersion` (enforced by snapshot contract or explicit check).

- [ ] Unit: `tests/unit/mcp-search-arg-mapping.unit.js` (new)
  - For each supported schema field, assert mapping produces the expected CLI flag(s).
  - Include a negative test: unknown fields are rejected (or ignored only if policy says so, with an explicit warning).

- [ ] Update existing: `tests/mcp-schema.js`
  - Keep snapshotting tool property sets.
  - Add schemaVersion presence check.

---

### 12.4 Error codes, protocol negotiation, and response-shape consistency

- [ ] Standardize tool error payloads and map internal errors to stable MCP error codes.
  - Touchpoints:
    - [ ] `src/integrations/mcp/protocol.js` — legacy transport formatting helpers
    - [ ] `tools/mcp/transport.js` — legacy transport handler
    - [ ] `tools/mcp-server-sdk.js` — SDK error mapping
    - [ ] `src/shared/error-codes.js` — canonical internal codes
  - [ ] Define stable, client-facing codes (examples):
    - [ ] invalid args
    - [ ] index missing
    - [ ] tool timeout
    - [ ] not supported / capability missing
    - [ ] cancelled
  - [ ] Ensure both transports emit the same logical error payload shape (even if wrapper envelopes differ).

- [ ] Implement protocol/version negotiation and expose capabilities.
  - [ ] On `initialize`, echo supported protocol versions, the tool schema version, and effective capabilities.

#### Tests / Verification

- [ ] Unit: protocol negotiation returns consistent `protocolVersion` + `schemaVersion`.
- [ ] Regression: error payload includes stable `code` and `message` across both transports for representative failures.

---

### 12.5 Cancellation, timeouts, and process hygiene (no leaked work)

- [ ] Ensure cancellation/timeout terminates underlying work within a bounded time.
  - Touchpoints:
    - [ ] `tools/mcp/transport.js`
    - [ ] `tools/mcp/runner.js`
    - [ ] `tools/mcp/tools.js`
  - [ ] Cancellation correctness:
    - [ ] Canonicalize JSON-RPC IDs for in-flight tracking (`String(id)`), so numeric vs string IDs do not break cancellation.
    - [ ] Ensure `$/cancelRequest` cancels the correct in-flight request and that cancellation is observable (result marked cancelled, no “success” payload).
  - [ ] Timeout correctness:
    - [ ] Extend `runNodeAsync()` to accept an `AbortSignal` and kill the child process (and its process tree) on abort/timeout.
    - [ ] Thread AbortSignal through `runToolWithProgress()` and any spawned-node tool helpers.
    - [ ] Ensure `withTimeout()` triggers abort and does not merely reject while leaving work running.
  - [ ] Progress notification hygiene:
    - [x] Throttle/coalesce progress notifications (max ~1 per 250ms per tool call, coalesced) to avoid overwhelming clients.

- [ ] Tighten MCP test process cleanup.
  - [ ] After sending `shutdown`/`exit`, explicitly await server process termination (bounded deadline, then kill) to prevent leaked subprocesses during tests.

#### Tests / Verification

- [ ] Update existing: `tests/mcp-robustness.js`
  - Add “wait for exit” after `exit` (bounded).
  - Add cancellation test:
    - Start a long-ish operation, send `$/cancelRequest`, assert the tool response is cancelled and that work stops (no continuing progress after cancellation).
  - Add progress-throttle assertion (if practical): bursty progress is coalesced.

- [ ] Unit: `tests/unit/mcp-runner-abort-kills-child.unit.js` (new)
  - Spawn a child that would otherwise run long; abort; assert child exit occurs quickly and no orphan remains.

---

### 12.6 Documentation and migration notes

- [ ] Add `docs/mcp.md` (new) describing:
  - [ ] how to run legacy vs SDK server modes
  - [ ] how to install/enable the SDK (per the chosen dependency strategy)
  - [ ] tool schemas and `schemaVersion` policy
  - [ ] stable error codes and cancellation/timeout semantics
  - [ ] capability reporting and expected client behaviors

**Mapping (source docs, minimal):** `GIGAMAP_FINAL_UPDATED.md` (M12), `GIGAMAP_ULTRA_2026-01-22_FULL_COVERAGE_v3.md` (M12 overlap notes), `CODEBASE_STATIC_REVIEW.md` (MCP schema mapping), `GIGASWEEP.md` (MCP timeout/cancellation/progress/test cleanup)


---

## Phase 13 — SCM Provider Abstraction (Git Migration) + JJ Provider

### Objective

Make SCM integration **pluggable and explicit** so indexing and incremental workflows can run against:

- Git repos (current default)
- Jujutsu (`jj`) repos (Phase 13 deliverable)
- Non-SCM directories (filesystem-only; reduced provenance but still indexable)

This phase introduces an **SCM provider interface**, migrates all Git behavior onto that interface, then implements a JJ provider using the same contract. The result is a single, coherent place to reason about: tracked file discovery, repo provenance, per-file metadata (churn / blame), and “changed files” queries used by incremental reuse.

Authoritative specs to align with (existing in repo):
- `docs/specs/scm-provider-config-and-state-schema.md`
- `docs/specs/jj-provider-commands-and-parsing.md`

---

### Exit criteria (must all be true)

- [ ] There is a single SCM provider interface used everywhere (no direct `git`/`jj` shelling from random modules).
- [ ] `indexing.scm.provider` is supported: `auto | git | jj | none` (default: `auto`).
- [ ] Git provider is fully migrated onto the interface and remains the default when `.git/` exists.
- [ ] JJ provider supports (at minimum): repo detection, tracked-file enumeration, and repo “head” provenance recorded in `build_state.json`.
- [ ] When no SCM is present (or `provider=none`), indexing still works using filesystem discovery, but provenance fields are explicitly `null` / unavailable (no silent lies).
- [ ] Build signatures and cache keys include SCM provenance in a **stable** and **portable** way (no locale-dependent sorting).
- [ ] Tests cover provider selection + the most failure-prone parsing paths; CI can run without `jj` installed.

---

### Phase 13.1 — Introduce `ScmProvider` interface + registry + config/state schema wiring

- [ ] Create a new module boundary for SCM operations:
  - [ ] `src/index/scm/types.js` (new) — shared types and normalized shapes
  - [ ] `src/index/scm/provider.js` (new) — interface contract + docs-in-code
  - [ ] `src/index/scm/registry.js` (new) — provider selection (`auto|git|jj|none`)
  - [ ] `src/index/scm/providers/none.js` (new) — filesystem-only provider (no provenance; uses existing fdir fallback)
  - [ ] `src/index/scm/providers/git.js` (new) — migrated in 13.2
  - [ ] `src/index/scm/providers/jj.js` (new) — implemented in 13.3

- [ ] Define the **canonical provider contract** (minimal required surface):
  - [ ] `detect({ startPath }) -> { ok:true, repoRoot, provider } | { ok:false }`
  - [ ] `listTrackedFiles({ repoRoot, subdir? }) -> { filesPosix: string[] }`
  - [ ] `getRepoProvenance({ repoRoot }) -> { provider, root, head, dirty, branch/bookmarks?, detectedBy? }`
  - [ ] `getChangedFiles({ repoRoot, fromRef, toRef, subdir? }) -> { filesPosix: string[] }` (may be “not supported” for `none`)
  - [ ] `getFileMeta({ repoRoot, filePosix }) -> { churn?, lastCommitId?, lastAuthor?, lastModifiedAt? }` (best-effort; may be disabled)
  - [ ] Optional (capability-gated): `annotate({ repoRoot, filePosix, timeoutMs }) -> { lines:[{ line, author, commitId, ... }] }`

- [ ] Config keys (align to `docs/specs/scm-provider-config-and-state-schema.md`):
  - [ ] `indexing.scm.provider: auto|git|jj|none`
  - [ ] `indexing.scm.timeoutMs`, `indexing.scm.maxConcurrentProcesses`
  - [ ] `indexing.scm.annotate.enabled`, `maxFileSizeBytes`, `timeoutMs`
  - [ ] `indexing.scm.jj.snapshotWorkingCopy` safety default (read-only by default)

- [ ] Build-state schema updates:
  - [ ] Extend `build_state.json` `repo` field to include:
    - [ ] `repo.provider`
    - [ ] normalized `repo.head` object (provider-specific fields nested, but stable keys)
    - [ ] `repo.dirty` boolean (best-effort)
  - [ ] Keep Git back-compat fields where feasible (`repo.commit`, `repo.branch`) but treat `repo.provider` + `repo.head.*` as authoritative.

Touchpoints:
- `docs/specs/scm-provider-config-and-state-schema.md` (align / correct examples if needed)
- `src/index/build/build-state.js` (repo provenance shape)
- `src/index/build/indexer/signatures.js` (include SCM provenance in build signatures)
- `src/index/build/runtime/runtime.js` (thread config into runtime)
- `docs/config/schema.json` (document `indexing.scm.*` keys)

#### Tests / verification
- [ ] `tests/unit/scm-provider-selection.unit.js` (new)
  - [ ] `auto` selects `git` when `.git/` exists and git is runnable.
  - [ ] `auto` selects `jj` when `.jj/` exists and `jj` is runnable.
  - [ ] `auto` falls back to `none` when neither exists (or binaries missing).
- [ ] `tests/unit/build-state-repo-provenance.unit.js` (new)
  - [ ] `build_state.json` includes `repo.provider` and normalized `repo.head`.

---

### Phase 13.2 — Migrate Git onto the provider interface

- [ ] Implement `GitProvider` by **wrapping and consolidating** existing Git logic:
  - [ ] Move/merge logic from:
    - [ ] `src/index/git.js` (provenance + meta helpers)
    - [ ] `src/index/build/discover.js` (`git ls-files` discovery)
  - [ ] Ensure there is exactly one “source of truth” for:
    - [ ] repo root resolution
    - [ ] tracked file enumeration (`git ls-files -z`)
    - [ ] dirty check
    - [ ] head SHA + branch name

- [ ] Remove direct Git shelling from non-provider modules:
  - [ ] `src/index/build/discover.js` should call `ScmProvider.listTrackedFiles()` when an SCM provider is active, else use filesystem crawl (current behavior).
  - [ ] Any provenance used for metrics/signatures must route through `ScmProvider.getRepoProvenance()`.

Touchpoints:
- `src/index/build/discover.js`
- `src/index/git.js` (migrate or reduce to GitProvider internals)
- `src/index/scm/providers/git.js` (new)
- `src/index/scm/registry.js`

#### Tests / verification
- [ ] `tests/services/index-build-git-provider.services.js` (new)
  - [ ] Build index inside a git repo and assert:
    - [ ] `build_state.json.repo.provider === "git"`
    - [ ] tracked file discovery returns only git-tracked files (plus explicit records-dir behavior if enabled)

---

### Phase 13.3 — Implement JJ provider (read-only default, robust parsing)

- [ ] Implement `JjProvider` using `jj` CLI (no library dependency):
  - [ ] Detection:
    - [ ] find `.jj/` root
    - [ ] validate `jj --version` runnable (capability gating)
  - [ ] Tracked files:
    - [ ] `jj file list --tracked -0` (prefer NUL delim where available)
  - [ ] Repo provenance:
    - [ ] resolve a stable head reference (commitId + changeId where available)
    - [ ] record bookmarks (best-effort)
    - [ ] `dirty` best-effort (explicitly document semantics)

- [ ] Safety default: read-only by default
  - [ ] When `indexing.scm.jj.snapshotWorkingCopy=false`:
    - [ ] run JJ commands with `--ignore-working-copy` and `--at-op=@` (per spec)
  - [ ] If enabled:
    - [ ] allow exactly one controlled snapshot at start (and pin subsequent commands to that op)
    - [ ] record the pinned op id in build state (so provenance is reproducible)

- [ ] Implement changed-files support (for incremental reuse):
  - [ ] Provide `getChangedFiles()` based on the spec in `docs/specs/jj-provider-commands-and-parsing.md`.
  - [ ] Normalize to **repo-root-relative POSIX paths**.

Touchpoints:
- `docs/specs/jj-provider-commands-and-parsing.md` (align with implementation)
- `src/index/scm/providers/jj.js` (new)
- `src/index/scm/providers/jj-parse.js` (new: isolated parsing helpers)
- `src/index/build/indexer/signatures.js` (include JJ head/changeId + op pin when used)

#### Tests / verification
- [ ] Unit: parsing helpers
  - [ ] `tests/unit/jj-changed-files-parse.unit.js`
  - [ ] `tests/unit/jj-head-parse.unit.js`
- [ ] CI behavior:
  - [ ] if `jj` missing, JJ tests skip (exit code 77) with a clear message.

---

### Phase 13.4 — CLI + tooling visibility (make SCM selection obvious)

- [ ] CLI flags (override config, optional but recommended):
  - [ ] `pairofcleats index build --scm-provider <auto|git|jj|none>`
  - [ ] `pairofcleats index build --scm-annotate / --no-scm-annotate`

- [ ] Surface effective provider + provenance in diagnostics:
  - [ ] `pairofcleats tooling doctor --json` should include:
    - provider selected
    - repo root
    - head id(s)
    - whether annotate is enabled

Touchpoints:
- `bin/pairofcleats.js` (flag plumbing)
- `src/shared/cli-options.js` (new flags)
- `tools/tooling-doctor.js` (report SCM provider)

---

### Phase 13.5 — Non-repo environments (explicitly supported)

- [ ] Make filesystem-only behavior first-class:
  - [ ] If `provider=none` (or auto selects none):
    - [ ] file discovery uses filesystem crawl (current fallback)
    - [ ] build state records `repo.provider="none"` and `repo.head=null`
    - [ ] incremental reuse features that require SCM provenance must be disabled with an explicit reason (no silent partial behavior)
  - [ ] Document this mode as “try it anywhere” for non-code/non-repo folders.

Touchpoints:
- `src/index/scm/providers/none.js` (new)
- `docs/` (add a short section in `docs/indexing.md` or `docs/scm.md`)

#### Tests / verification
- [ ] `tests/services/index-build-no-scm.services.js` (new)
  - [ ] Build index in a temp folder without `.git/` and assert build succeeds and provenance is explicitly null.

## Phase 14 — Incremental Diffing & Snapshots (Time Travel, Regression Debugging)

### Objective

Introduce **first-class snapshot and diff artifacts** so we can:

- Query indexes **“as-of” a prior build** (time-travel).
- Generate deterministic **“what changed”** artifacts between two index states.
- Support regression debugging, release auditing, and safe incremental reuse.

This phase establishes:

> **Authoritative spec**: the on-disk layout, ID conventions, and resolution rules for this phase are already refined in:
> - `docs/phases/phase-14/index-refs-and-snapshots.md` (snapshot registry + IndexRef)
> - `docs/phases/phase-14/index-diffs.md` (diff schemas + deterministic event stream)
>
> This roadmap section must stay aligned with those specs (notably: snapshot IDs are `snap-*` and diff IDs are `diff_*`).

- **Pointer snapshots** (cheap metadata references to validated builds).
- **Frozen snapshots** (immutable, self-contained archival copies).
- **Diff artifacts** (bounded, deterministic change sets + summaries).


### 14.1 Snapshot & diff artifact surface (contracts, retention, safety)

- [ ] Define the on-disk **public artifact surface** under each repo cache root:
  - [ ] `snapshots/manifest.json` — snapshot registry (authoritative index of snapshots)
  - [ ] `snapshots/<snapshotId>/snapshot.json` — immutable per-snapshot metadata record (optional but recommended)
  - [ ] `snapshots/<snapshotId>/frozen/index-<mode>/...` — frozen snapshot index roots (immutable copies)
  - [ ] `diffs/manifest.json` — diff registry (authoritative index of diffs)
  - [ ] `diffs/<diffId>/summary.json` — bounded diff summary (always present)
  - [ ] `diffs/<diffId>/index_diff.jsonl` — optional, bounded event stream (may be truncated)

- [ ] Standardize **ID + naming rules**:
  - [ ] Snapshot IDs: `snap-YYYYMMDD-HHMMSS-<shortid>` (default) plus optional user `label`
  - [ ] Diff IDs: `diff_<sha256><shortid>` (default)
  - [ ] Ensure IDs are filesystem-safe.
  - [ ] Ensure deterministic ordering for registry output (sort by `createdAt`, then `id`).

- [ ] Define snapshot registry entry schema (minimum fields):
  - [ ] `id`, `type` (`pointer` | `frozen`), `createdAt`
  - [ ] `label` (nullable), `tags` (string[])
  - [ ] `buildId` (from `build_state.json`), `configHash`, `toolVersion`
  - [ ] `buildRoot` (repo-cache-relative path), plus `modeBuildRoots` map (`mode -> repo-cache-relative index root`)
  - [ ] `repoProvenance` (best-effort: SCM provider + revision/branch if available)
  - [ ] `integritySummary` (best-effort counts + size estimates + `validatedAt` timestamp)
  - [ ] Optional future-proof fields (schema allows but does not require): `workspaceId`, `namespaceKey`
    - Defer multi-repo/workspace orchestration to **Phase 15 — Federation & Multi-Repo**.

- [ ] Define diff registry entry schema (minimum fields):
  - [ ] `id`, `createdAt`, `from` + `to` refs (snapshotId/buildId/indexRootRef), `modes`
  - [ ] `summaryPath` and optional `eventsPath`
  - [ ] `truncated` flag + truncation metadata (`maxEvents`, `maxBytes`)
  - [ ] `compat` block capturing `from.configHash` vs `to.configHash` and `toolVersion` mismatches.

- [ ] Make registries **atomic and crash-safe**:
  - [ ] Use atomic write (temp + rename) and stable JSON output.
  - [ ] Avoid partial registry writes leaving corrupt JSON (registry must always be readable or rolled back).
  - [ ] If using per-snapshot `snapshots/<id>/snapshot.json`, write it first, then append to `snapshots/manifest.json`.

- [ ] Add **retention policy knobs** (defaults tuned for safety):
  - [ ] `indexing.snapshots.maxPointerSnapshots` (default: 25)
  - [ ] `indexing.snapshots.maxFrozenSnapshots` (default: 10)
  - [ ] `indexing.snapshots.retainDays` (default: 30)
  - [ ] `indexing.diffs.maxDiffs` (default: 50)
  - [ ] `indexing.diffs.retainDays` (default: 30)
  - [ ] `indexing.diffs.maxEvents` / `indexing.diffs.maxBytes` (bounded output)
  - [ ] Retention must respect tags (e.g., `release` is never deleted automatically).

- [ ] Enforce **path safety** for all snapshot/diff paths:
  - [ ] Treat all registry paths as repo-cache-relative.
  - [ ] Refuse any `buildRoot` / `modeBuildRoots` values that escape the repo cache root (no `..`, no absolute paths).
  - [ ] Refuse snapshot/diff output dirs if they escape the repo cache root.

- [ ] Integrate **validation gating semantics** into the contract:
  - [ ] Pointer snapshots may only reference builds that passed index validation (see Phase 14.2).
  - [ ] Frozen snapshots must be self-contained and re-validatable.

Touchpoints:
- `src/index/snapshots/**` (new)
- `src/index/diffs/**` (new)
- `src/shared/artifact-schemas.js` (add AJV validators for `snapshots/manifest.json`, `diffs/manifest.json`, `diffs/*/summary.json`)
- `docs/` (new: `docs/snapshots-and-diffs.md`; update public artifact surface docs if present)

#### Tests
- [ ] `tests/unit/snapshots-registry.unit.js`
  - [ ] Registry schema validation (valid/invalid cases)
  - [ ] Atomic update behavior (simulate interrupted write; registry remains readable)
  - [ ] Path safety (reject absolute paths and `..` traversal)
- [ ] `tests/unit/diffs-registry.unit.js`
  - [ ] Schema validation + bounded/truncation metadata correctness


### 14.2 Pointer snapshots (creation, validation gating, CLI/API)

- [ ] Implement pointer snapshot creation:
  - [ ] Resolve repo cache root and current build roots from `builds/current.json`.
  - [ ] Load `build_state.json` from the current build root (for `buildId`, `configHash`, `toolVersion`, and provenance).
  - [ ] Require a successful artifact validation signal before snapshotting:
    - [ ] Preferred: consume a persisted validation report if present.
    - [ ] Otherwise: run validation on-demand against each mode index root.
  - [ ] Refuse snapshot creation when builds are incomplete:
    - [ ] If an index mode is missing required artifacts, fail.
    - [ ] If embeddings/risk passes are still pending for a mode, fail unless explicitly overridden (`--allow-incomplete`, default false).
  - [ ] Materialize snapshot entry with:
    - [ ] `buildRoot` + `modeBuildRoots` captured as **repo-cache-relative** paths.
    - [ ] `integritySummary` populated from validation output + minimal artifact counts.
  - [ ] Write immutable per-snapshot metadata (optional but recommended):
    - [ ] `snapshots/<snapshotId>/snapshot.json` (write atomically).
    - [ ] Keep the registry entry minimal and link to the per-snapshot record if desired.
  - [ ] Append entry to `snapshots/manifest.json` atomically.
  - [ ] Apply retention after creation (delete oldest pointer snapshots unless tagged).

- [ ] Add CLI surface:
  - [ ] `pairofcleats index snapshot create [--label <label>] [--tags <csv>] [--modes <csv>] [--allow-incomplete]`
  - [ ] `pairofcleats index snapshot list [--json]`
  - [ ] `pairofcleats index snapshot show <snapshotId> [--json]`
  - [ ] `pairofcleats index snapshot rm <snapshotId> [--force]`

- [ ] Add API surface (optional but recommended for UI/MCP parity):
  - [ ] `GET /index/snapshots` (list)
  - [ ] `GET /index/snapshots/:id` (show)
  - [ ] `POST /index/snapshots` (create)
  - [ ] Ensure endpoints never expose absolute filesystem paths.

- [ ] Sweep-driven hardening for snapshot creation:
  - [ ] When reading `builds/current.json`, treat any buildRoot that escapes repo cache root as **invalid** and refuse snapshotting.
  - [ ] Ensure snapshot manifest writes are atomic and do not corrupt on crash.

Touchpoints:
- `bin/pairofcleats.js` (new subcommands)
- `tools/index-snapshot.js` (new CLI implementation)
- `src/index/snapshots/registry.js` (new)
- `src/index/snapshots/validate-source.js` (new: shared logic to validate a build root before snapshotting)
- `tools/api/**` (if API endpoints added)

#### Tests
- [ ] `tests/services/snapshot-create.services.js`
  - [ ] Build an index; create a pointer snapshot; assert registry entry exists and references current build.
  - [ ] Fail creation when artifacts are missing or validation fails.
  - [ ] `--modes` subset only snapshots those modes.
  - [ ] Retention deletes oldest untagged pointer snapshots.


### 14.3 Frozen snapshots (immutable copies + integrity verification)

- [ ] Implement snapshot freeze operation:
  - [ ] `pairofcleats index snapshot freeze <snapshotId>`
  - [ ] Preconditions:
    - [ ] Snapshot exists and is `pointer` (or already `frozen` → no-op / error depending on flags).
    - [ ] Referenced build roots exist and are readable.
  - [ ] Copy the snapshot’s index artifacts into:
    - [ ] `snapshots/<snapshotId>/frozen/index-<mode>/...`
  - [ ] Copy strategy:
    - [ ] Use `pieces/manifest.json` from each mode’s index root as the authoritative list of files to copy.
    - [ ] Prefer hardlinking (same filesystem) when safe; otherwise copy bytes.
    - [ ] Always copy metadata (`index_state.json`, `pieces/manifest.json`, and any required build metadata files).
  - [ ] Integrity verification:
    - [ ] Verify copied pieces against `pieces/manifest.json` checksums.
    - [ ] Re-run index validation against the frozen index roots.
  - [ ] Atomicity:
    - [ ] Freeze into a temp directory and rename into place only after verification.
  - [ ] Update `snapshots/manifest.json`:
    - [ ] Flip `type` to `frozen`.
    - [ ] Update `buildRoot` / `modeBuildRoots` to point at the frozen roots.
    - [ ] Preserve the original `buildId` / provenance; record `frozenFromBuildId` if useful.

- [ ] Add supporting maintenance commands:
  - [ ] `pairofcleats index snapshot gc [--dry-run]` (enforce retention; never delete `release`-tagged snapshots)

Touchpoints:
- `tools/index-snapshot.js` (freeze + gc)
- `src/index/snapshots/freeze.js` (new)
- `src/index/snapshots/copy-pieces.js` (new; copy/hardlink logic)

#### Tests
- [ ] `tests/services/snapshot-freeze.services.js`
  - [ ] Create pointer snapshot → freeze → validate frozen index roots succeed.
  - [ ] Ensure freeze is atomic (simulate failure mid-copy → no partial frozen dir is considered valid).
  - [ ] Ensure frozen snapshot remains usable after deleting the original build root.


### 14.4 Deterministic diff computation (bounded, machine-readable)

- [ ] Implement diff computation between two index states:
  - [ ] CLI: `pairofcleats index diff --from <snapshotId|buildId|path> --to <snapshotId|buildId|path> [--modes <csv>]`
  - [ ] Resolve `from` and `to` to per-mode index roots (snapshot pointer, snapshot frozen, or explicit indexRoot).
  - [ ] Refuse or annotate mismatches:
    - [ ] If `configHash` differs, require `--allow-mismatch` or mark output as “non-comparable”.
    - [ ] If `toolVersion` differs, annotate (diff still possible but less trustworthy).

- [ ] Define diff output formats:
  - [ ] Always write `diffs/<diffId>/summary.json` (bounded):
    - [ ] counts of adds/removes/changes by category
    - [ ] `truncated` boolean + reason
    - [ ] `from`/`to` metadata (snapshot IDs, build IDs, createdAt)
  - [ ] Optionally write `diffs/<diffId>/index_diff.jsonl` (bounded stream):
    - [ ] `file_added | file_removed | file_changed` (path + old/new hash)
    - [ ] `chunk_added | chunk_removed | chunk_changed`:
      - [ ] stable `chunkId` from `metaV2.chunkId`
      - [ ] minimal before/after summary (`file`, `segment`, `kind`, `name`, `start/end`), plus optional `semanticSig` (hash of normalized docmeta/metaV2 subset)
    - [ ] `graph_edge_added | graph_edge_removed` (graph name + from/to node IDs)
    - [ ] Allow future event types (symbols/contracts/risk) without breaking old readers.

- [ ] Implement deterministic diffing rules:
  - [ ] Stable identity:
    - [ ] Files keyed by repo-relative path.
    - [ ] Chunks keyed by `metaV2.chunkId` (do **not** rely on numeric `chunk_meta.id`).
    - [ ] Graph edges keyed by `(graph, fromId, toId)`.
  - [ ] Stable ordering:
    - [ ] Sort events by `(type, key)` so repeated runs produce byte-identical outputs.
  - [ ] Boundedness:
    - [ ] Enforce `indexing.diffs.maxEvents` and `indexing.diffs.maxBytes`.
    - [ ] If exceeded, stop emitting events and mark summary as truncated; include category counts.

- [ ] Integrate diff generation into incremental build (optional but recommended):
  - [ ] After a successful build+promotion, compute a diff vs the previous “latest” snapshot/build.
  - [ ] Use incremental state (manifest) to compute file-level changes in O(changed) where possible.
  - [ ] Emit diffs only after strict validation passes (so diffs don’t encode broken builds).
  - [ ] Store the diff under `diffs/<diffId>/...` and append to `diffs/manifest.json` (do **not** mix diffs into buildRoot without a strong reason).

- [ ] Sweep-driven hardening for incremental reuse/diff correctness (because this phase touches incremental state):
  - [ ] Before reusing an “unchanged” incremental build, verify required artifacts exist (use `pieces/manifest.json` as the authoritative inventory).
    - [ ] If any required piece is missing/corrupt, disable reuse and force rebuild.
  - [ ] Ensure incremental cache invalidation is tied to a complete signature:
    - [ ] Include artifact schema hash + tool version + key feature flags in the incremental signature.
    - [ ] Include diff/snapshot emission toggles so changing these settings invalidates reuse.

Touchpoints:
- `tools/index-diff.js` (new CLI implementation)
- `src/index/diffs/compute.js` (new)
- `src/index/diffs/events.js` (new; event schema helpers + deterministic ordering)
- `src/index/diffs/registry.js` (new)
- `src/index/build/incremental.js` (reuse validation + signature binding improvements)
- `src/index/build/indexer/steps/incremental.js` (optional: emit diffs post-build)

#### Tests
- [ ] `tests/services/index-diff.services.js`
  - [ ] Build snapshot A; modify repo; build snapshot B; compute diff A→B.
  - [ ] Assert file_changed appears for modified file.
  - [ ] Assert chunk changes use `metaV2.chunkId` and are stable across runs.
  - [ ] Assert ordering is deterministic (byte-identical `index_diff.jsonl`).
  - [ ] Assert truncation behavior when `maxEvents` is set low.
- [ ] `tests/storage/sqlite/incremental/index-reuse-validation.services.js`
  - [ ] Corrupt/remove a required artifact and verify incremental reuse is refused.


### 14.5 Retrieval + tooling integration: “as-of” snapshots and “what changed” surfaces

- [ ] Add snapshot targeting to retrieval/search:
  - [ ] Extend search CLI args with `--snapshot <snapshotId>` / `--as-of <snapshotId>`.
  - [ ] Resolve snapshot → per-mode index roots via `snapshots/manifest.json`.
  - [ ] Ensure `--snapshot` never leaks absolute paths (logs + JSON output must stay repo-relative).

- [ ] Add diff surfacing commands for humans and tools:
  - [ ] `pairofcleats index diff list [--json]`
  - [ ] `pairofcleats index diff show <diffId> [--format summary|jsonl]`
  - [ ] `pairofcleats index diff explain <diffId>` (human-oriented summary + top changed files)

- [ ] Extend “secondary index builders” to support snapshots:
  - [ ] SQLite build: accept `--snapshot <snapshotId>` / `--as-of <snapshotId>` and resolve it to `--index-root`.
    - [ ] Ensure the SQLite build can target frozen snapshots as well as pointer snapshots (as long as artifacts still exist).
  - [ ] Validate tool: document `pairofcleats index validate --index-root <frozenSnapshotIndexRoot>` workflow (no new code required if `--index-root` already supported).

- [ ] Add API surface (optional but recommended):
  - [ ] `GET /index/diffs` (list)
  - [ ] `GET /index/diffs/:id` (summary)
  - [ ] `GET /index/diffs/:id/events` (JSONL stream; bounded)
  - [ ] `GET /search?snapshotId=...` (search “as-of” a snapshot)

- [ ] Sweep-driven hardening for retrieval caching (because this phase touches retrieval index selection):
  - [ ] Ensure query cache keys include the snapshotId (or resolved buildId) so results cannot bleed across snapshots.
  - [ ] Fix retrieval index signature calculation to account for sharded artifacts (see tests below).

Touchpoints:
- `src/retrieval/cli-args.js` (add `--snapshot/--as-of`)
- `src/retrieval/cli.js` (thread snapshot option through)
- `src/retrieval/cli-index.js` (resolve index dir via snapshot; update query cache signature)
- `src/shared/artifact-io.js` (add signature helpers for sharded artifacts)
- `bin/pairofcleats.js` (CLI wiring)
- `tools/build-sqlite-index/cli.js` + `tools/build-sqlite-index/run.js` (add `--snapshot/--as-of`)
- `tools/api/**` (if API endpoints added)

#### Tests
- [ ] `tests/services/snapshot-query.services.js`
  - [ ] Build snapshot A; modify repo; build snapshot B.
  - [ ] Run the same query against `--snapshot A` and `--snapshot B`; assert results differ as expected.
  - [ ] Assert “latest” continues to resolve to the current build when no snapshot is provided.
- [ ] `tests/unit/retrieval-index-signature-shards.unit.js`
  - [ ] Create a fake index dir with `chunk_meta.meta.json` + `chunk_meta.parts/*`.
  - [ ] Assert the index signature changes when any shard changes.
- [ ] `tests/services/sqlite-build-snapshot.services.js`
  - [ ] Build snapshot A.
  - [ ] Run `pairofcleats lmdb build` / `pairofcleats sqlite build` equivalents with `--snapshot A`.
  - [ ] Assert output DB is produced and corresponds to that snapshot’s artifacts.


### Phase 14 — Source mapping (minimal)

- `PAIR_OF_CLEATS_ROADMAP_PH01_TO_PH19_MASTER_UPDATED.md` — PH-11 tasks T01–T05 (snapshot registry, pointer snapshots, freeze, deterministic diffs, retrieval integration).
- `PAIR_OF_CLEATS_FUN_EXTRA_IDEAS_MASTER_UPDATED.md` — concrete `index_diff.jsonl` and `diff_summary.json` format + CLI/API examples.
- `MULTIREPO_FED.md` — snapshot/diff/time-travel as a core primitive; workspace-aware future-proof fields (deferred orchestration).
- `GIGAMAP_FINAL_UPDATED.md` — milestone M10 snapshotting/diffing file touchpoints (incremental integration, loader `--snapshot`, snapshot selection for secondary builders like SQLite).
- `GIGASWEEP.md` — required hardening when touching incremental reuse + retrieval query-cache signatures (sharded `chunk_meta` coverage, reuse validation).


---

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
- New: `src/workspace/config.js` (or `src/retrieval/federation/workspace.js`) — loader + validator + `repoSetId`

#### Tests

- [ ] Workspace config parsing accepts absolute and relative repo roots and produces canonical `repoRoot`.
- [ ] `repoSetId` is deterministic:
  - [ ] independent of repo list order in the workspace file
  - [ ] stable across runs/platforms for the same canonical set (Windows casing normalized)
- [ ] Canonicalization prevents duplicate repo entries that differ only by symlink/subdir pathing.

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
- New: `src/workspace/catalog.js` (cacheRoot scanning)
- New: `src/workspace/manifest.js` (manifest writer/reader)

#### Tests

- [ ] Catalog discovery returns the same repo list regardless of filesystem directory enumeration order.
- [ ] Workspace manifest generation:
  - [ ] records accurate per-repo buildId and per-mode index paths
  - [ ] records compatibilityKey for each indexed mode (when present)
  - [ ] is stable/deterministic for the same underlying catalog state
- [ ] Invalid `builds/current.json` does not preserve stale build IDs in memory caches (treated as “pointer invalid”).

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

- [ ] Multi-repo fixture (two tiny repos) proves:
  - [ ] federated search returns results from both repos
  - [ ] results include repo attribution fields
  - [ ] collisions in `relPath` do not cause ambiguity
- [ ] Determinism test: same workspace + query yields byte-identical JSON output across repeated runs.
- [ ] Repo selection tests:
  - [ ] repeated `--repo` works
  - [ ] `--repo-filter` / `--tag` selection works and is deterministic

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
- `src/workspace/manifest.js` (persist compatibilityKey per repo/mode)
- `src/retrieval/federation/coordinator.js` (cohort partitioning)

#### Tests

- [ ] CompatibilityKey is stable for the same index inputs and changes when any compatibility input changes.
- [ ] Federated search with two repos in different cohorts:
  - [ ] returns warning + does not silently mix results by default
  - [ ] succeeds when restricted to a cohort explicitly
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

- [ ] Federated query cache key changes when:
  - [ ] any repo’s indexSignature changes
  - [ ] `fileChargramN` (or other ranking knobs) changes
  - [ ] repo selection changes (subset vs full workspace)
- [ ] Sharded chunk_meta invalidation test:
  - [ ] updating a shard or `chunk_meta.meta.json` invalidates cached queries
- [ ] MCP repo path canonicalization test:
  - [ ] passing a subdirectory path resolves to repo root and shares the same caches as passing the repo root
- [ ] Build-pointer parse failure test:
  - [ ] invalid `builds/current.json` clears buildId and closes/clears caches (no stale serving)

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

- [ ] Two-repo workspace build proves global caches are reused (no duplicate downloads; stable cache paths).
- [ ] CAS reuse test: identical input across repos yields identical object keys and avoids recomputation.
- [ ] GC test: removes unreferenced objects while preserving those referenced by workspace/snapshot manifests.
- [ ] Concurrency test: workspace indexing/search honors configured limits (does not exceed).

---

## Phase 16 — Prose ingestion + retrieval routing correctness (PDF/DOCX + FTS policy)

### Objective

Deliver first-class document ingestion (PDF + DOCX) and prose retrieval correctness:

- PDF/DOCX can be ingested (when optional deps exist) into deterministic, segment-aware prose chunks.
- When deps are missing or extraction fails, the index build remains green and reports explicit, per-file skip reasons.
- Prose/extracted-prose routes deterministically to SQLite FTS with safe, explainable query compilation; code routes to sparse/postings.
- Retrieval helpers are hardened so constraints (`allowedIds`), weighting, and table availability cannot silently produce wrong or under-filled results.

Note: vector-only indexing profile work is handled in **Phase 17 — Vector-Only Index Profile (Embeddings-First)**.

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
- Refactor/reuse logic from `tools/bench/micro/extractors.js` into the runtime extractors (bench remains a consumer).

#### Tests
- [ ] `tests/extractors/pdf-missing-dep-skips.test.js`
  - [ ] When PDF capability is false, extraction path is skipped cleanly and build remains green.
- [ ] `tests/extractors/docx-missing-dep-skips.test.js`
  - [ ] When DOCX capability is false, extraction path is skipped cleanly and build remains green.
- [ ] `tests/extractors/pdf-smoke.test.js` (conditional; only when deps available)
  - [ ] Extract a fixture PDF and assert known phrase is present.
- [ ] `tests/extractors/docx-smoke.test.js` (conditional; only when deps available)
  - [ ] Extract a fixture DOCX and assert known phrase is present.

### 16.2 Deterministic doc chunking (page/paragraph aware) + doc-mode limits that scale to large files

- [ ] Add deterministic chunkers for extracted documents:
  - [ ] `src/index/chunking/formats/pdf.js` (new)
    - [ ] Default: one chunk per page.
    - [ ] If a page is tiny, allow deterministic grouping (e.g., group adjacent pages up to a budget).
    - [ ] Each chunk carries provenance: `{ type:'pdf', pageStart, pageEnd, anchor }`.
  - [ ] `src/index/chunking/formats/docx.js` (new)
    - [ ] Group paragraphs into chunks by max character/token budget.
    - [ ] Preserve heading boundaries when style information is available.
    - [ ] Each chunk carries provenance: `{ type:'docx', paragraphStart, paragraphEnd, headingPath?, anchor }`.

- [ ] Support adaptive splitting for “hot” or unexpectedly large segments without breaking stability:
  - [ ] If a page/section/window exceeds caps, split into deterministic subsegments with stable sub-anchors (no run-to-run drift).

- [ ] Sweep-driven performance hardening for chunking limits (because PDF/DOCX can create very large blobs):
  - [ ] Update `src/index/chunking/limits.js` so byte-boundary resolution is not quadratic on large inputs.
  - [ ] Avoid building full `lineIndex` unless line-based truncation is requested.

Touchpoints:
- `src/index/chunking/formats/pdf.js` (new)
- `src/index/chunking/formats/docx.js` (new)
- `src/index/chunking/limits.js`

#### Tests
- [ ] `tests/prose/pdf-chunking-deterministic.test.js`
  - [ ] Two-page fixture; assert stable chunk count, anchors, and page ranges across repeated runs.
- [ ] `tests/prose/docx-chunking-deterministic.test.js`
  - [ ] Multi-paragraph fixture; assert stable chunk grouping and heading boundary behavior.
- [ ] `tests/perf/chunking-limits-large-input.test.js`
  - [ ] Regression guard: chunking limits on a large string must complete within a bounded time.

### 16.3 Integrate extraction into indexing build (discovery, skip logic, file processing, state)

- [ ] Discovery gating:
  - [ ] Update `src/index/build/discover.js` so `.pdf`/`.docx` are only considered when `indexing.documentExtraction.enabled === true`.
  - [ ] If enabled but deps missing: record explicit “skipped due to capability” diagnostics (do not silently ignore).

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

- [ ] Chunking dispatch registration:
  - [ ] Update `src/index/chunking/dispatch.js` to route `.pdf`/`.docx` through the document chunkers under the same gating.

Touchpoints:
- `src/index/build/discover.js`
- `src/index/build/file-processor/skip.js`
- `src/index/build/file-processor.js`
- `src/index/build/file-processor/assemble.js`
- `src/index/chunking/dispatch.js`

#### Tests
- [ ] `tests/indexing/documents-included-when-available.test.js` (conditional; when deps available)
  - [ ] Build fixture containing a sample PDF and DOCX; assert chunks exist with `segment.type:'pdf'|'docx'` and searchable text is present.
- [ ] `tests/indexing/documents-skipped-when-unavailable.test.js`
  - [ ] Force capabilities off; build succeeds; skipped docs are reported deterministically with reasons.
- [ ] `tests/indexing/document-bytes-hash-stable.test.js`
  - [ ] Ensure caching identity remains tied to bytes + extractor version/config.

### 16.4 metaV2 and chunk_meta contract extensions for extracted documents

- [ ] Extend metaV2 for extracted docs in `src/index/metadata-v2.js`:
  - [ ] Add a `document` (or `segment`) block with provenance fields:
    - `sourceType: 'pdf'|'docx'`
    - `pageStart/pageEnd` (PDF)
    - `paragraphStart/paragraphEnd` (DOCX)
    - optional `headingPath`, `windowIndex`, and a stable `anchor` for citation.
- [ ] Ensure `chunk_meta.jsonl` includes these fields and that output is backend-independent (artifact vs SQLite).
- [ ] If metaV2 is versioned, bump schema version (or add one) and provide backward-compatible normalization.

Touchpoints:
- `src/index/metadata-v2.js`
- `src/index/build/file-processor/assemble.js`
- Retrieval loaders that depend on metaV2 (for parity checks)

#### Tests
- [ ] `tests/unit/metaV2-extracted-doc.unit.js`
  - [ ] Verify extracted-doc schema fields are present, typed, and deterministic.
- [ ] `tests/services/sqlite-hydration-metaV2-parity.services.js`
  - [ ] Build an index; load hits via artifact-backed and SQLite-backed paths; assert canonical metaV2 fields match for extracted docs.

### 16.5 Prose retrieval routing defaults + FTS query compilation correctness (explainable, deterministic)

- [ ] Enforce routing defaults:
  - [ ] `prose` / `extracted-prose` → SQLite FTS by default.
  - [ ] `code` → sparse/postings by default.
  - [ ] Overrides select requested providers and are reflected in `--explain` output.

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

#### Tests
- [ ] `tests/retrieval/search-routing-policy.test.js`
  - [ ] Prose defaults to FTS; code defaults to postings; overrides behave deterministically and are explained.
- [ ] `tests/retrieval/sqlite-fts-query-escape.test.js`
  - [ ] Punctuation cannot inject operators; the compiled `MATCH` string is stable and safe.
- [ ] `tests/retrieval/fts-tokenizer-config.test.js`
  - [ ] Assert baseline tokenizer uses diacritic-insensitive configuration; include a diacritic recall fixture.

### 16.6 Sweep-driven correctness fixes in retrieval helpers touched by prose FTS routing

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

#### Tests
- [ ] `tests/retrieval/rankSqliteFts-allowedIds-correctness.test.js`
- [ ] `tests/retrieval/rankSqliteFts-weight-before-limit.test.js`
- [ ] `tests/retrieval/unpackUint32-buffer-alignment.test.js`

### 16.7 Query intent classification + boolean parsing semantics (route-aware, non-regressing)

- [ ] Fix path-intent misclassification so routing is reliable:
  - [ ] Replace the “any slash/backslash implies path” heuristic with more discriminating signals:
    - [ ] require path-like segments (multiple separators, dot-extensions, `./` / `../`, drive roots), and
    - [ ] treat URLs separately so prose queries containing `https://...` do not get path-biased.
  - [ ] Keep intent scoring explainable and stable.

- [ ] Harden boolean parsing semantics to support FTS compilation and future strict evaluation:
  - [ ] Treat unary `-` as NOT even with whitespace (e.g., `- foo`, `- "phrase"`), or reject standalone `-` with a parse error.
  - [ ] Ensure phrase parsing behavior is explicit (either implement minimal escaping or formally document “no escaping”).
  - [ ] Prevent flattened token inventories from being mistaken for semantic constraints:
    - [ ] rename inventory lists (or attach an explicit `inventoryOnly` marker) so downstream code cannot accidentally erase boolean semantics.

Touchpoints:
- `src/retrieval/query-intent.js`
- `src/retrieval/query.js`

#### Tests
- [ ] `tests/retrieval/query-intent-path-heuristics.test.js`
- [ ] `tests/retrieval/boolean-unary-not-whitespace.test.js`
- [ ] `tests/retrieval/boolean-inventory-vs-semantics.test.js`

### 16.8 Retrieval output shaping: `scoreBreakdown` consistency + explain fidelity, plus harness drift repair

- [ ] Resolve `scoreBreakdown` contract inconsistencies:
  - [ ] Standardize field names and nesting across providers (SQLite FTS, postings, vector) so consumers do not need provider-specific logic.
  - [ ] Ensure verbosity/output size is governed by a single budget policy (max bytes/fields/explain items).

- [ ] Ensure `--explain` is complete and deterministic:
  - [ ] Explain must include:
    - routing decision
    - compiled FTS `MATCH` string for prose routes
    - provider variants used and thresholds
    - capability gating decisions when features are unavailable

- [ ] Repair script-coverage harness drift affecting CI signal quality:
  - [ ] Align `tests/script-coverage/actions.js` `covers` entries with actual `package.json` scripts.
  - [ ] Ensure `tests/script-coverage/report.js` does not fail with `unknownCovers` for legitimate cases.

Touchpoints:
- `src/retrieval/output/*`
- `tests/script-coverage/*`
- `package.json`

#### Tests
- [ ] `tests/retrieval/scoreBreakdown-contract-parity.test.js`
- [ ] `tests/retrieval/explain-output-includes-routing-and-fts-match.test.js`
- [ ] `tests/script-coverage/harness-parity.test.js`



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
  - [ ] Add an `artifacts` presence block (versioned) so loaders can reason about what exists:
    - [ ] `artifacts.schemaVersion: 1`
    - [ ] `artifacts.present: { [artifactName]: true }` (only list artifacts that exist)
    - [ ] `artifacts.omitted: string[]` (explicit omissions for the selected profile)
    - [ ] `artifacts.requiredForSearch: string[]` (profile-specific minimum set)

  - [ ] Add a build-time invariant:
    - [ ] If `profile.id === "vector_only"`, then `token_postings*`, `token_vocab`, `token_stats`, `minhash*`, and any sparse-only artifacts MUST NOT be present.

- [ ] Ensure build signatures include profile:
  - [ ] signature/caching keys must incorporate `profile.id` so switching profiles forces a rebuild.

Touchpoints:
- `docs/config/schema.json`
- `src/index/build/runtime/runtime.js` (read + normalize `indexing.profile`)
- `src/index/build/indexer/signatures.js` (include profile in signature)
- `src/index/build/state.js` / `src/index/build/artifacts.js` (index_state emission)
- `src/retrieval/cli/index-state.js` (surface profile + artifacts in `index_status`)

#### Tests
- [ ] `tests/index/profile-index-state-contract.test.js`
  - [ ] Build tiny index with each profile and assert `index_state.json.profile` + `index_state.json.artifacts` satisfy schema invariants.

---

### Phase 17.2 — Build pipeline gating (skip sparse generation cleanly)

- [ ] Thread `profile.id` into the indexer pipeline and feature settings:
  - [ ] In `vector_only`, set `featureSettings.tokenize = false` (and ensure all downstream steps respect it)
  - [ ] Ensure embeddings remain enabled/allowed (vector-only without vectors should be rejected at build time unless explicitly configured to “index without vectors”)

- [ ] Skip sparse stages when `vector_only`:
  - [ ] Do not run `buildIndexPostings()` (or make it a no-op) when tokenize=false.
  - [ ] Do not write sparse artifacts in `writeIndexArtifactsForMode()` / `src/index/build/artifacts.js`.

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

#### Tests
- [ ] `tests/index/vector-only-does-not-emit-sparse.test.js`
  - [ ] Assert absence of `token_postings*`, `token_vocab*`, `token_stats*`, `minhash*`.
- [ ] `tests/index/vector-only-switching-cleans-stale-sparse.test.js`
  - [ ] Build default, then vector_only into same outDir; assert sparse artifacts removed.

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

- [ ] SQLite helper hardening for profile-aware operation:
  - [ ] Add a lightweight `requireTables(db, names[])` helper used at provider boundaries.
  - [ ] Providers must check required tables for their mode and return an actionable “tables missing” error (not throw).

Touchpoints:
- `src/retrieval/pipeline.js` (router)
- `src/retrieval/index-load.js` (ensure index_state loaded early)
- `src/retrieval/sqlite-helpers.js` (table guards)
- `src/retrieval/providers/*` (respect profile + missing-table outcomes)
- `src/retrieval/output/explain.js` (surface profile + warnings)

#### Tests
- [ ] `tests/retrieval/vector-only-search-requires-ann.test.js`
- [ ] `tests/retrieval/vector-only-rejects-sparse-mode.test.js`
- [ ] `tests/retrieval/sqlite-missing-sparse-tables-is-controlled-error.test.js`

---

### Phase 17.4 — Optional: “analysis policy shortcuts” for vector-only builds (stretch)

This is explicitly optional, but worth considering because it is where most build time goes for code-heavy repos.

- [ ] Add a documented policy switch: when `indexing.profile=vector_only`, default `analysisPolicy` can disable:
  - [ ] type inference
  - [ ] risk analysis
  - [ ] expensive cross-file passes
  - [ ] (optionally) lint/complexity stages
- [ ] Make these *opt-outable* (users can re-enable per setting).

Touchpoints:
- `src/index/build/indexer/pipeline.js` (feature flags)
- `docs/config/` (document defaults and overrides)

## Phase 20 — Distribution & Platform Hardening (Release Matrix, Packaging, and Optional Python)

### Objective
Make PairOfCleats releasable and operable across supported platforms by defining a **release target matrix**, adding a **deterministic release smoke-check**, hardening **cross-platform path handling**, and producing **reproducible editor/plugin packages** (Sublime + VS Code) with CI gates.

This phase also standardizes how Python-dependent tests and tooling behave when Python is missing: they must **skip cleanly** (without producing “false red” CI failures), while still failing when Python is present but the test is genuinely broken.

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

### Phase 20.1 — Release target matrix + deterministic release smoke-check
- [ ] Define and publish the **release target matrix** and optional-dependency policy.
  - Primary output:
    - `docs/release-matrix.md` (or `docs/release/targets.md`)
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
  - Requirements:
    - Must not depend on shell string concatenation; use spawn with args arrays.
    - Must set explicit `cwd` and avoid fragile `process.cwd()` assumptions (derive repo root from `import.meta.url` or accept `--repo-root`).
    - Must support bounded timeouts and produce actionable failures (which step failed, stdout/stderr excerpt).
    - Should support `--json` output with a stable envelope for CI automation (step list + pass/fail + durations).
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
  - Requirements:
    - Add a release-gate lane that runs `npm run release-check` plus the new smoke steps.
    - Add OS coverage beyond Linux (at minimum: Windows already exists; add macOS for the smoke check).
    - Align CI Node version(s) with the release target matrix, and ensure the matrix is explicitly documented.

#### Tests / Verification
- [ ] `tests/release/release-check-smoke.test.js`
  - Runs `node tools/release-check.js` in a temp environment and asserts it succeeds on a healthy checkout.
- [ ] `tests/release/release-check-json.test.js`
  - Runs `release-check --json` and asserts stable JSON envelope fields (schemaVersion, steps[], status).
- [ ] CI verification:
  - [ ] Add a job that runs the smoke check on at least Linux/macOS/Windows with pinned Node versions per the matrix.

---

### Phase 20.2 — Cross-platform path safety audit + regression tests (including spaces)
- [ ] Audit filesystem path construction and CLI spawning for correctness on:
  - paths with spaces
  - Windows separators and drive roots
  - consistent repo-relative path normalization for public artifacts (canonical `/` separators)
- [ ] Fix issues discovered during the audit in the “release-critical surface”.
  - Minimum scope for this phase:
    - `tools/release-check.js` (must behave correctly on all supported OSes)
    - packaging scripts added in Phase 20.3/20.5
    - tests added by this phase (must be runnable on CI runners and locally)
  - Broader issues discovered outside this scope should either:
    - be fixed here if the touched files are already being modified, or
    - be explicitly deferred to a named follow-on phase (with a concrete subsection placeholder).
- [ ] Add regression tests for path safety and quoting.
  - Touchpoints:
    - `tests/platform/paths-with-spaces.test.js` (new)
    - `tests/platform/windows-paths-smoke.test.js` (new; conditional when not on Windows)
  - Requirements:
    - Create a temp repo directory whose absolute path includes spaces.
    - Run build + validate + search using explicit `cwd` and temp cacheRoot.
    - Ensure the artifacts still store repo-relative paths with `/` separators.

#### Tests / Verification
- [ ] `tests/platform/paths-with-spaces.test.js`
  - Creates `repo with spaces/` under a temp dir; runs build + search; asserts success.
- [ ] `tests/platform/windows-paths-smoke.test.js`
  - On Windows CI, verifies key commands succeed and produce valid outputs.
- [ ] Extend `tools/release-check.js` to include a `--paths` step that runs the above regression checks in quick mode.

---

### Phase 20.3 — Sublime plugin packaging pipeline (bundled, reproducible)
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
    - `docs/editor-integration.md` (add Sublime section), and/or
    - `sublime/PairOfCleats/README.md` (distribution instructions)
  - Include:
    - Manual install steps and Package Control posture.
    - Compatibility notes (service-mode requirements, supported CLI flags, cacheRoot expectations).

#### Tests / Verification
- [ ] `tests/sublime/package-structure.test.js`
  - Runs the packaging script; asserts expected files exist in the output and that version metadata matches root `package.json`.
- [ ] `tests/sublime/package-determinism.test.js` (if feasible)
  - Packages twice; asserts the archive is byte-identical (or semantically identical with a stable file list + checksums).

---

### Phase 20.4 — Make Python tests and tooling optional (skip cleanly when Python is missing)
- [ ] Update Python-related tests to detect absence of Python and **skip with a clear message** (not fail).
  - Touchpoints:
    - `tests/sublime-pycompile.js` (must be guarded)
    - `tests/sublime/test_*.py` (only if these are invoked by CI or tooling; otherwise keep as optional)
  - Requirements:
    - Prefer `spawnSync(python, ['--version'])` and treat ENOENT as “Python unavailable”.
    - When Python is unavailable:
      - print a single-line skip reason to stderr
      - exit using the project’s standard “skip” mechanism (see below)
    - When Python is available:
      - the test must still fail for real syntax errors (no silent skips).
- [x] JS test harness recognizes “skipped” tests via exit code 77.
  - Touchpoints:
    - `tests/run.js` (treat a dedicated exit code, e.g. `77`, as `skipped`)
  - Requirements:
    - `SKIP` must appear in console output (like PASS/FAIL).
    - JUnit output must mark skipped tests as skipped.
    - JSON output must include `status: 'skipped'`.
- [ ] Add a small unit test that proves the “Python missing → skipped” path is wired correctly.
  - Touchpoints:
    - `tests/python/python-availability-skip.test.js` (new)
  - Approach:
    - mock or simulate ENOENT from spawnSync and assert the test exits with the “skip” code and emits the expected message.

#### Tests / Verification
- [ ] `tests/sublime-pycompile.js`
  - Verified behavior:
    - Without Python: skips (non-failing) with a clear message.
    - With Python: compiles all `.py` files under `sublime/PairOfCleats/**` and fails on syntax errors.
- [ ] `tests/python/python-availability-skip.test.js`
  - Asserts skip-path correctness and ensures we do not “skip on real failures”.

---

### Phase 20.5 — VS Code extension packaging + compatibility (extension exists)
- [ ] Add a reproducible VS Code extension packaging pipeline (VSIX).
  - Touchpoints:
    - `extensions/vscode/**` (source)
    - `package.json` scripts (new: `package:vscode`), and/or `tools/package-vscode.js` (new)
  - Requirements:
    - Use a pinned packaging toolchain (recommended: `@vscode/vsce` as a devDependency).
    - Output path must be deterministic and placed under a temp/artifacts directory suitable for CI.
    - Packaging must not depend on repo-root `process.cwd()` assumptions; set explicit cwd.
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
- [ ] `tests/vscode/extension-packaging.test.js`
  - Packages a VSIX and asserts the output exists (skips if packaging toolchain is unavailable).
- [ ] Extend `tests/vscode-extension.js`
  - Validate required activation events/commands and required configuration keys (and add any cacheRoot-related keys if the contract requires them).

---

### Phase 20.6 — Service-mode bundle + distribution documentation (API server + embedding worker)
- [ ] Ship a service-mode “bundle” (one-command entrypoint) and documentation.
  - Touchpoints:
    - `tools/api-server.js`
    - `tools/indexer-service.js`
    - `tools/service/**` (queue + worker)
    - `docs/service-mode.md` (new) or a section in `docs/commands.md`
  - Requirements:
    - Define canonical startup commands, required environment variables, and queue storage paths.
    - Document security posture and safe defaults:
      - local-only binding by default
      - explicit opt-in for public binding
      - guidance for auth/CORS if exposed
    - Ensure the bundle uses explicit args and deterministic logging conventions (stdout vs stderr).
- [ ] Add an end-to-end smoke test for the service-mode bundle wiring.
  - Use stub embeddings or other deterministic modes where possible; do not require external services.

#### Tests / Verification
- [ ] `tests/service/service-mode-smoke.test.js`
  - Starts API server + worker in a temp environment; enqueues a small job; asserts it is processed and the API responds.
- [ ] Extend `tools/release-check.js` to optionally run a bounded-time service-mode smoke step (`--service-mode`).

---
