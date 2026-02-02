# PairOfCleats GigaRoadmap

    ## Status legend
    
    Checkboxes represent the state of the work, update them to reflect the state of work as its being done:
    - [x] Implemented and appears complete/correct based on code inspection and existing test coverage
    - [@] In Progress, this work has been started
    - [.] Work has been completed but has Not been tested
    - [?] There is a correctness gap **or** there is missing/insufficient test proving behavior
    - [x] Not complete
    
    Completed Phases: `COMPLETED_PHASES.md`

### Source-of-truth hierarchy (when specs disagree)
When a document/spec conflicts with the running code, follow this order:

1) **`src/contracts/**` and validators** are authoritative for artifact shapes and required keys.
2) **Current implementation** is authoritative for runtime behavior *when it is already validated by contracts/tests*.
3) **Docs** (`docs/contracts/**`, `docs/specs/**`, `docs/phases/**`) must be updated to match (never the other way around) unless we have a deliberate migration plan.

If you discover a conflict:
- **Prefer "fix docs to match code"** when the code is already contract-validated and has tests.
- **Prefer "fix code to match docs/contracts"** only when the contract/validator is explicit and the code violates it.

### Touchpoints + line ranges (important: line ranges are approximate)
This document includes file touchpoints with **approximate** line ranges like:

- `src/foo/bar.js` **(~L120-L240)**  -  anchor: `someFunctionName`

Line numbers drift as the repo changes. Treat them as a **starting hint**, not a hard reference.
Always use the **anchor string** (function name / constant / error message) as the primary locator.

### Tests: lanes + name filters (use them aggressively)
The repo has a first-class test runner with lanes + filters:

- Runner: `npm test` (alias for `node tests/run.js`)
- List lanes/tags: `npm test -- --list-lanes` / `npm test -- --list-tags`
- Run a lane: `npm run test:unit`, `npm run test:integration`, `npm run test:services`, etc.
- Filter by name/path (selectors):  
  - `npm test -- --match risk_interprocedural`  
  - `npm run test:unit -- --match chunk-uid`  
  - `npm run test:integration -- --match crossfile`

**Lane rules are defined in:** `tests/run.rules.jsonc` (keep new tests named/placed so they land in the intended lane).

### Deprecating spec documents: archive policy (MANDATORY)
When a spec/doc is replaced (e.g., a reconciled spec supersedes an older one):

- **Move the deprecated doc to:** `docs/archived/` (create this folder if missing).
- Keep a short header in the moved file indicating:
  - what replaced it,
  - why it was deprecated,
  - the date/PR.
- Add/update the repository process in **`AGENTS.md`** so future agents follow the same archival convention.

This roadmap includes explicit tasks to enforce this process (see Phase 10 doc merge).

---

## Roadmap Table of Contents
- Phase 12 -- MCP Migration + API/Tooling Contract Formalization
    - 12.1 - Dependency strategy and Capability Gating for the Official MCP SDK
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

---


## Phase 12 — MCP Migration + API/Tooling Contract Formalization

### Objective
Modernize and stabilize PairOfCleats’ integration surface by (1) migrating MCP serving to the **official MCP SDK** (with a safe compatibility window), (2) formalizing MCP tool schemas, version negotiation, and error codes across legacy and SDK transports, and (3) hardening cancellation/timeouts so MCP requests cannot leak work or hang.

- Current grounding: MCP entrypoint is `tools/mcp-server.js` (custom JSON-RPC framing via `tools/mcp/transport.js`), with tool defs in `src/integrations/mcp/defs.js` and protocol helpers in `src/integrations/mcp/protocol.js`.
- This phase must keep existing tools functioning while adding SDK mode, and it must not silently accept inputs that do nothing.

---

### 12.1 Dependency strategy and capability gating for the official MCP SDK

- [x] Decide how the MCP SDK is provided and make the decision explicit in code + docs.
  - Options:
    - [ ] Dependency (always installed)
    - [x] Optional dependency (install attempted; failures tolerated)
    - [ ] External optional peer (default; capability-probed)
  - [x] Implement the chosen strategy consistently:
    - [x] `package.json` (if dependency/optionalDependency is chosen)
    - [x] `src/shared/capabilities.js` (probe `@modelcontextprotocol/sdk` and report clearly)
    - [x] `src/shared/optional-deps.js` (ensure `tryImport()` handles ESM correctly for the SDK)
  - [x] Define the SDK import path and the capability surface it drives (e.g., `@modelcontextprotocol/sdk` + which subpath).

- [@] Ensure MCP server mode selection is observable and capability-gated.
  - Touchpoints:
    - [ ] `tools/mcp-server.js` — entrypoint dispatch
    - [x] `tools/config-dump.js` (or MCP status tool) — report effective MCP mode + SDK availability
    - [x] `docs/config/schema.json` — add `mcp.mode` (legacy|sdk|auto) and `mcp.sdk` capability note
  - [x] Define precedence for MCP mode per `docs/config/surface-directives.md` (CLI > config; env vars only if explicitly allowed as exceptions).
    - [x] If an env override is retained (e.g., `MCP_MODE`), document the exception in `docs/config/contract.md` and surface it in config inventory.

Touchpoints (anchors; approximate):
- `tools/mcp-server.js` (~L4 `getToolDefs`, ~L8 `handleToolCall`, ~L31 `mcpConfig`)
- `src/shared/capabilities.js` (~L7 `getCapabilities`, ~L38 `mcp.sdk`)
- `src/shared/optional-deps.js` (~L22 `tryRequire`, ~L33 `tryImport`)
- `tools/mcp/repo.js` (~L7 `parseTimeoutMs`)
- `tools/config-dump.js` (if used; otherwise define a new MCP status tool under `tools/mcp/`)
  - Reference docs: `docs/api/mcp-server.md`, `docs/phases/phase-12/tooling-and-api-contract.md`

#### Tests / Verification

- [ ] Unit: capabilities probe reports `mcp.sdk=true/false` deterministically.
- [ ] CI verification: when SDK is absent, SDK-mode tests are skipped cleanly with a structured reason.

---

### 12.2 SDK-backed MCP server (parallel mode with explicit cutover flag)

- [x] Implement an SDK-backed server alongside the legacy transport.
  - Touchpoints:
    - [x] `tools/mcp-server-sdk.js` (new) — SDK-backed server implementation
    - [x] `tools/mcp-server.js` — dispatch `--mcp-mode legacy|sdk` (or env var), defaulting to legacy until parity is proven
      - [x] Add `--mcp-mode` (and `MCP_MODE`) parsing here; bind to `mcp.mode` config.
  - [x] Requirements for SDK server:
    - [x] Register tools from `src/integrations/mcp/defs.js` as the source of truth.
    - [x] Route tool calls to the existing implementations in `tools/mcp/tools.js` (no behavior fork).
    - [x] Support stdio transport as the baseline.
    - [x] Emit a capabilities payload that allows clients to adapt (e.g., doc extraction disabled, SDK missing, etc.).
      - [x] Explicitly define whether this is returned via `initialize` or a separate tool response (see 12.4).

- [x] Add a deprecation window for the legacy transport.
  - [x] Document the cutover plan and timeline in `docs/contracts/mcp-api.md`.
  - [x] Keep legacy transport only until SDK parity tests are green, then remove or hard-deprecate with warnings.

Touchpoints (anchors; approximate):
- `tools/mcp-server.js` (~L4 `getToolDefs`, ~L8 `handleToolCall`; add SDK dispatch flag)
- `tools/mcp-server-sdk.js` (new; SDK wiring)
- `tools/mcp/tools.js` (tool execution entrypoint)
- `src/integrations/mcp/defs.js` (tool definitions + schemaVersion)
  - Reference docs: `docs/api/mcp-server.md`, `docs/phases/phase-12/tooling-and-api-contract.md`

#### Tests / Verification

- [ ] Services: `tests/services/mcp/sdk-mode.test.js` (new)
  - Skip if SDK is not installed.
  - Start `tools/mcp-server-sdk.js` and run at least:
    - `tools/list`
    - one representative `tools/call` (e.g., `index_status`)
  - Assert: response shape is valid, errors have stable codes, and server exits cleanly.

---

### 12.3 Tool schema versioning, conformance, and drift guards

- [x] Make tool schemas explicitly versioned and enforce bump discipline.
  - Touchpoints:
    - [x] `src/integrations/mcp/defs.js` — add `schemaVersion` (semver or monotonic integer) and `toolVersion` (package.json)
    - [x] `docs/contracts/mcp-api.md` — document compatibility rules for schema changes
    - [x] `docs/contracts/mcp-tools.schema.json` (new) — canonical tool schema snapshot
    - [x] `src/integrations/mcp/validate.js` (new) — validate tool schemas against snapshot
  - [x] Define the canonical initialize response shape (schema + example).
    - [x] `docs/contracts/mcp-api.md` — `initialize` response structure
    - [x] `docs/contracts/mcp-initialize.schema.json` (new) — schema for response payload

- [x] Consolidate MCP argument → execution mapping to one audited path.
  - Touchpoints:
    - [x] `tools/mcp/tools.js` (search/build tools)
    - [x] `src/integrations/core/index.js` (shared arg builder, if used)
  - [x] Create a single mapping function per tool (or a shared builder) so schema additions cannot be “accepted but ignored”.

- [x] Conformance requirement for the `search` tool:
  - [x] Every field in the MCP `search` schema must either:
    - [x] affect emitted CLI args / search execution, or
    - [x] be removed from schema, or
    - [x] be explicitly marked “reserved” and rejected if set.
  - [x] Avoid duplicative builders (do not maintain two separate lists of flags).

- [ ] Fix known MCP tool wiring correctness hazards in modified files:
  - [x] In `tools/mcp/tools.js`, remove variable shadowing that breaks cancellation/AbortSignal handling (numeric arg is now `contextLines`; `context` remains the `{ signal }` object).

Touchpoints (anchors; approximate):
- `src/integrations/mcp/defs.js` (~L1 exports; add `schemaVersion`)
- `tools/mcp/tools.js` (~L? `runSearchTool` / arg mapping)
- `src/integrations/mcp/protocol.js` (error + envelope helpers)
- `docs/contracts/mcp-api.md` (schema versioning rules)

#### Tests / Verification

- [ ] Unit: `tests/services/mcp/mcp-schema-version.test.js` (new; keep it in services lane for MCP)
  - Assert `schemaVersion` exists.
  - Assert changes to tool defs require bumping `schemaVersion` (enforced by snapshot contract or explicit check).

- [ ] Unit: `tests/services/mcp/mcp-search-arg-mapping.test.js` (new; keep it in services lane for MCP)
  - For each supported schema field, assert mapping produces the expected CLI flag(s).
  - Include a negative test: unknown fields are rejected (or ignored only if policy says so, with an explicit warning).

- [ ] Update existing: `tests/services/mcp/mcp-schema.test.js`
  - Keep snapshotting tool property sets.
  - Add schemaVersion presence check.
  - Add toolVersion presence check.
  - Update `docs/contracts/coverage-ledger.md` to include new MCP schema tests.

---

### 12.4 Error codes, protocol negotiation, and response-shape consistency

- [x] Standardize tool error payloads and map internal errors to stable MCP error codes.
  - Touchpoints:
    - [x] `src/integrations/mcp/protocol.js` — legacy transport formatting helpers
    - [x] `tools/mcp/transport.js` — legacy transport handler
    - [x] `tools/mcp-server-sdk.js` — SDK error mapping
    - [x] `src/shared/error-codes.js` — canonical internal codes
  - [x] Define stable, client-facing codes (examples):
    - [x] invalid args
    - [x] index missing
    - [x] tool timeout
    - [x] not supported / capability missing
    - [x] cancelled
  - [x] Add `docs/contracts/mcp-error-codes.md` (or a section in `docs/contracts/mcp-api.md`) defining the canonical MCP error registry.
  - [x] Ensure both transports emit the same logical error payload shape (even if wrapper envelopes differ).

- [x] Implement protocol/version negotiation and expose capabilities.
  - [x] On `initialize`, echo supported protocol versions, the tool schema version, toolVersion, and effective capabilities.
  - [x] Define the authoritative initialize response builder in `src/integrations/mcp/protocol.js`.
  - [x] Define a capabilities schema (or a section in `docs/contracts/mcp-api.md`) with required keys and value semantics.

#### Tests / Verification

- [x] Unit: protocol negotiation returns consistent `protocolVersion` + `schemaVersion`.
- [.] Regression: error payload includes stable `code` and `message` across both transports for representative failures.
  - [.] Add `mcp-mode` selection test (legacy vs sdk) based on CLI/config/env.
  - [.] Add capability payload test for both transports (initialize contains capabilities).
  - [x] Align test path references with `docs/phases/phase-12/test-strategy-and-conformance-matrix.md` (services lane vs `tests/mcp/*`).

Touchpoints (anchors; approximate):
- `src/integrations/mcp/protocol.js` (error payload shaping + initialize response)
- `tools/mcp/transport.js` (legacy transport)
- `tools/mcp-server-sdk.js` (SDK error mapping)
- `src/shared/error-codes.js` (canonical internal codes)

---

### 12.5 Cancellation, timeouts, and process hygiene (no leaked work)

- [x] Ensure cancellation/timeout terminates underlying work within a bounded time.
  - Touchpoints:
    - [x] `tools/mcp/transport.js`
    - [x] `tools/mcp/runner.js`
    - [x] `tools/mcp/tools.js`
  - [x] Cancellation correctness:
    - [x] Canonicalize JSON-RPC IDs for in-flight tracking (`String(id)`), so numeric vs string IDs do not break cancellation.
    - [x] Ensure `$/cancelRequest` cancels the correct in-flight request and that cancellation is observable (result marked cancelled, no “success” payload).
  - [x] Timeout correctness:
    - [x] Extend `runNodeAsync()` to accept an `AbortSignal` and kill the child process (and its process tree) on abort/timeout.
    - [x] Thread AbortSignal through `runToolWithProgress()` and any spawned-node tool helpers.
    - [x] Ensure `withTimeout()` triggers abort and does not merely reject while leaving work running.
  - [x] Progress notification hygiene:
    - [x] Throttle/coalesce progress notifications (max ~1 per 250ms per tool call, coalesced) to avoid overwhelming clients.

- [x] Tighten MCP test process cleanup.
  - [x] After sending `shutdown`/`exit`, explicitly await server process termination (bounded deadline, then kill) to prevent leaked subprocesses during tests.

#### Tests / Verification

- [x] Update existing: `tests/services/mcp/mcp-robustness.test.js`
  - Add “wait for exit” after `exit` (bounded).
  - Add cancellation test:
    - Start a long-ish operation, send `$/cancelRequest`, assert the tool response is cancelled and that work stops (no continuing progress after cancellation).
  - [ ] Add progress-throttle assertion (if practical): bursty progress is coalesced.

- [x] Unit: `tests/services/mcp/mcp-runner-abort-kills-child.test.js` (new)
  - Spawn a child that would otherwise run long; abort; assert child exit occurs quickly and no orphan remains.
  - [x] Update `docs/testing/truth-table.md` and `docs/testing/test-decomposition-regrouping.md` to reflect new MCP tests.

---

### 12.6 Documentation and migration notes

- [ ] Add `docs/guides/mcp.md` (new) describing:
  - [ ] how to run legacy vs SDK server modes
  - [ ] how to install/enable the SDK (per the chosen dependency strategy)
  - [ ] tool schemas and `schemaVersion` policy
  - [ ] stable error codes and cancellation/timeout semantics
  - [ ] capability reporting and expected client behaviors
  - [ ] Link from `docs/guides/commands.md` (or another index doc) so discoverability is maintained.
  - [ ] Update `docs/api/mcp-server.md` to describe legacy + SDK modes and capability reporting.
  - [ ] Update `docs/contracts/mcp-api.md` for schemaVersion/toolVersion + error code registry.
  - [ ] Ensure `docs/phases/phase-12/tooling-and-api-contract.md` and `docs/phases/phase-12/test-strategy-and-conformance-matrix.md` remain in sync.

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

Touchpoints (anchors; approximate):
- `src/index/git.js` (~L63 `getGitMetaForFile`, ~L157 `getGitBranch`)
- `src/index/build/discover.js` (~L138 `discoverRepoRoots`, ~L176 `listGitFiles`)
- `src/index/build/build-state.js` (~L1 `buildState`)
- `src/index/build/indexer/signatures.js` (~L46 `gitBlameEnabled`)
- `src/index/build/runtime/runtime.js` (~L172 `buildId`, ~L209 `gitBlameEnabled`)

#### Tests / verification (path-corrected for current test layout)
- [ ] `tests/indexing/scm/scm-provider-selection.test.js` (new)
  - [ ] `auto` selects `git` when `.git/` exists and git is runnable.
  - [ ] `auto` selects `jj` when `.jj/` exists and `jj` is runnable.
  - [ ] `auto` falls back to `none` when neither exists (or binaries missing).
- [ ] `tests/indexing/scm/build-state-repo-provenance.test.js` (new)
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

#### Tests / verification (path-corrected for current test layout)
- [ ] `tests/indexing/scm/index-build-git-provider.test.js` (new)
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

#### Tests / verification (path-corrected for current test layout)
- [ ] Unit: parsing helpers
  - [ ] `tests/indexing/scm/jj-changed-files-parse.test.js`
  - [ ] `tests/indexing/scm/jj-head-parse.test.js`
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
- `docs/contracts/indexing.md` (document provider="none" behavior)
- `docs/guides/commands.md` (CLI flags and behavior notes)

#### Tests / verification
  - [ ] `tests/indexing/scm/index-build-no-scm.test.js` (new)
  - [ ] Build index in a temp folder without `.git/` and assert build succeeds and provenance is explicitly null.

---
