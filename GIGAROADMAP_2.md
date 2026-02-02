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


