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
- Phase 13 -- JJ Support (via Provider API)
    - 13.0 - Authoritative Docs + Provider Contract + Build State Schema
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
- `docs/specs/scm-provider-contract.md` (to be added in 13.0, or extend the config/state spec)

---

### Exit criteria (must all be true)

- [ ] There is a single SCM provider interface used everywhere (no direct `git`/`jj` shelling from random modules).
- [ ] `indexing.scm.provider` is supported: `auto | git | jj | none` (default: `auto`).
- [ ] Git provider is fully migrated onto the interface and remains the default when `.git/` exists.
- [ ] JJ provider supports (at minimum): repo detection, tracked-file enumeration, and repo “head” provenance recorded in `build_state.json`.
- [ ] When no SCM is present (or `provider=none`), indexing still works using filesystem discovery, but provenance fields are explicitly `null` / unavailable (no silent lies).
- [ ] Build signatures and cache keys include SCM provenance in a **stable** and **portable** way (no locale-dependent sorting).
- [ ] Tests cover provider selection + the most failure-prone parsing paths; CI can run without `jj` installed.
- [ ] `build_state.json` contract/validator updated to include SCM provider fields and referenced from docs.

---

### Phase 13.0 — Authoritative docs + provider contract + build state schema alignment

- [x] Update authoritative docs that must change with the SCM provider migration:
  - [x] `docs/contracts/indexing.md` (build_state shape + repo provenance + provider semantics)
  - [x] `docs/specs/identity-contract.md` (build signature inputs and stability; provider head must be included)
  - [x] `docs/specs/workspace-config.md` (if it enumerates indexing config keys, update to include `indexing.scm.*`)
  - [x] `docs/config/schema.json` and `docs/config/contract.md` (official config surface + precedence)
  - [x] `docs/guides/commands.md` (new CLI flags introduced in 13.4)

- [x] Add/extend a **provider contract spec**:
  - [x] New: `docs/specs/scm-provider-contract.md` (or extend `docs/specs/scm-provider-config-and-state-schema.md`)
  - Must define:
    - [x] return shapes for all provider APIs
    - [x] required vs optional fields (esp. `head` shape and `dirty` semantics)
    - [x] path normalization rules (repo-relative POSIX paths)
    - [x] detection precedence and fallback behavior
    - [x] capability/skip semantics when binaries are missing
    - [x] decision table for provider selection (`auto|git|jj|none`), including:
      - [x] explicit provider set
      - [x] `.git/` + `.jj/` both present (hard fail)
      - [x] missing binaries / unreadable repo roots
    - [x] buildId/signature provenance rules (how head fields affect buildId)

- [x] Build-state schema contract must be referenced and updated:
  - [x] Add a formal build_state contract + validator (none exists today):
    - [x] `src/contracts/schemas/build-state.js` (new) — JSON schema for build_state.json
    - [x] `src/contracts/validators/build-state.js` (new) — validator + error formatting
    - [x] `src/contracts/registry.js` — register the build_state contract
  - [x] Schema must be **exhaustive**:
    - [x] `repo.provider`, `repo.head`, `repo.dirty`, `repo.root`
    - [x] buildId + signatureVersion + schemaVersion
    - [x] explicit nullability rules for provider=none
  - [x] Ensure `docs/contracts/indexing.md` references the new contract location and examples.
  - [x] Add a migration checklist section (legacy repo.* fields to deprecate/remove and timeline).

Touchpoints:
- `docs/contracts/indexing.md`
- `docs/specs/identity-contract.md`
- `docs/specs/workspace-config.md`
- `docs/specs/scm-provider-config-and-state-schema.md` (or new `docs/specs/scm-provider-contract.md`)
- `docs/config/schema.json`
- `docs/config/contract.md`
- `docs/guides/commands.md`
- `src/contracts/**` (build_state schema + validators)

Touchpoints (anchors; approximate):
- `src/index/build/build-state.js` (~L5 `STATE_FILE`, ~L104 `repoRoot`, ~L133 `repo`)
- `src/index/build/runtime/runtime.js` (~L170 `repoProvenance`, ~L174 `buildId`)
- `src/contracts/registry.js` (~L1 `registry`)

---

### Phase 13.1 — Introduce `ScmProvider` interface + registry + config/state schema wiring

- [x] Create a new module boundary for SCM operations:
  - [x] `src/index/scm/types.js` (new) — shared types and normalized shapes
  - [x] `src/index/scm/provider.js` (new) — interface contract + docs-in-code
  - [x] `src/index/scm/registry.js` (new) — provider selection (`auto|git|jj|none`)
  - [x] `src/index/scm/providers/none.js` (new) — filesystem-only provider (no provenance; uses existing fdir fallback)
  - [x] `src/index/scm/providers/git.js` (new) — migrated in 13.2
  - [x] `src/index/scm/providers/jj.js` (new) — implemented in 13.3

- [x] Add a shared path normalization helper (single source of truth):
  - [x] `src/index/scm/paths.js` (new) — `toRepoPosixPath(filePath, repoRoot)`
  - [x] All providers + tests must use this helper.

- [x] Define the **canonical provider contract** (minimal required surface):
  - [x] `detect({ startPath }) -> { ok:true, repoRoot, provider } | { ok:false }`
  - [x] `listTrackedFiles({ repoRoot, subdir? }) -> { filesPosix: string[] }`
  - [x] `getRepoProvenance({ repoRoot }) -> { provider, root, head, dirty, branch/bookmarks?, detectedBy? }`
  - [x] `getChangedFiles({ repoRoot, fromRef, toRef, subdir? }) -> { filesPosix: string[] }` (may be “not supported” for `none`)
  - [x] `getFileMeta({ repoRoot, filePosix }) -> { churn?, lastCommitId?, lastAuthor?, lastModifiedAt? }` (best-effort; may be disabled)
  - [x] Optional (capability-gated): `annotate({ repoRoot, filePosix, timeoutMs }) -> { lines:[{ line, author, commitId, ... }] }`
  - [x] Define conflict policy:
    - [x] If both `.git/` and `.jj/` exist and no explicit provider is set, **hard fail** with a clear message to choose `--scm-provider`.

- [x] Config keys (align to `docs/specs/scm-provider-config-and-state-schema.md`):
  - [x] `indexing.scm.provider: auto|git|jj|none`
  - [x] `indexing.scm.timeoutMs`, `indexing.scm.maxConcurrentProcesses`
  - [x] `indexing.scm.annotate.enabled`, `maxFileSizeBytes`, `timeoutMs`
  - [x] `indexing.scm.jj.snapshotWorkingCopy` safety default (read-only by default)
  - [x] Define compatibility mapping for legacy git flags:
    - [x] `indexing.gitBlame` / `analysisPolicy.git.blame` -> `indexing.scm.annotate.enabled`
    - [x] document deprecation/precedence and avoid divergent settings
    - [x] No legacy mode: treat the SCM provider contract as authoritative

- [x] Add a mockable SCM command runner:
  - [x] `src/index/scm/runner.js` (new) — wraps spawn/exec with injectable fakes for tests
  - [x] Use it in Git/JJ providers to avoid shelling in unit tests.

- [x] Build-state schema updates:
  - [x] Extend `build_state.json` `repo` field to include:
    - [x] `repo.provider`
    - [x] normalized `repo.head` object (provider-specific fields nested, but stable keys)
    - [x] `repo.dirty` boolean (best-effort)
- [x] Keep Git back-compat fields where feasible (`repo.commit`, `repo.branch`) but treat `repo.provider` + `repo.head.*` as authoritative.
  - [x] Define deterministic buildId/signature rules:
    - [x] buildId uses `<timestamp>_<scmHeadShort>_<configHash8>`
    - [x] `scmHeadShort` comes from provider head primary id:
      - [x] git: commit SHA (short)
      - [x] jj: **changeId** when available, else commitId
    - [x] provider=none uses `noscm` marker (no git/jj fields leaked)

Touchpoints:
- `docs/specs/scm-provider-config-and-state-schema.md` (align / correct examples if needed)
- `src/index/build/build-state.js` (repo provenance shape)
- `src/index/build/indexer/signatures.js` (include SCM provenance in build signatures)
- `src/index/build/runtime/runtime.js` (thread config into runtime)
- `docs/config/schema.json` (document `indexing.scm.*` keys)
- `docs/config/contract.md` (document precedence + deprecations)

Touchpoints (anchors; approximate):
- `src/index/git.js` (~L63 `getGitMetaForFile`, ~L157 `getGitBranch`)
- `src/index/build/preprocess.js` (~L10 `discoverEntries`)
- `src/index/build/indexer/steps/discover.js` (~L34 `discoverFiles`)
- `src/index/build/discover.js` (~L138 `discoverRepoRoots`, ~L176 `listGitFiles`)
- `src/index/build/build-state.js` (~L1 `buildState`)
- `src/index/build/indexer/signatures.js` (~L46 `gitBlameEnabled`)
- `src/index/build/runtime/runtime.js` (~L172 `buildId`, ~L209 `gitBlameEnabled`)

#### Tests / verification (path-corrected for current test layout)
- [x] `tests/indexing/scm/scm-provider-selection.test.js` (new)
  - [x] `auto` selects `git` when `.git/` exists and git is runnable.
  - [x] `auto` selects `jj` when `.jj/` exists and `jj` is runnable.
  - [x] `auto` falls back to `none` when neither exists (or binaries missing).
  - [x] `auto` hard-fails when both `.git/` + `.jj/` exist and no provider is set.
  - [x] use fixture repo roots (`tests/fixtures/scm/git`, `tests/fixtures/scm/jj`, `tests/fixtures/scm/both`) rather than real repos.
- [x] `tests/indexing/scm/build-state-repo-provenance.test.js` (new)
  - [x] `build_state.json` includes `repo.provider` and normalized `repo.head`.
- [x] `tests/indexing/scm/signature-provenance-stability.test.js` (new)
  - [x] build signatures remain stable across locales and include provider head fields.

---

### Phase 13.2 — Migrate Git onto the provider interface

- [x] Implement `GitProvider` by **wrapping and consolidating** existing Git logic:
  - [x] Move/merge logic from:
    - [x] `src/index/git.js` (provenance + meta helpers)
    - [x] `src/index/build/discover.js` (`git ls-files` discovery)
  - [x] Ensure there is exactly one “source of truth” for:
    - [x] repo root resolution
    - [x] tracked file enumeration (`git ls-files -z`)
    - [x] dirty check
    - [x] head SHA + branch name

- [x] Remove direct Git shelling from non-provider modules:
  - [x] `src/index/build/discover.js` should call `ScmProvider.listTrackedFiles()` when an SCM provider is active, else use filesystem crawl (current behavior).
  - [x] Any provenance used for metrics/signatures must route through `ScmProvider.getRepoProvenance()`.
  - [x] Git metadata in file processing must use provider APIs (no direct `getGitMetaForFile` in CPU path).
  - [x] Chunk author attribution must use provider annotate (or explicit disable path when annotate is off).

Touchpoints:
- `src/index/build/discover.js`
- `src/index/git.js` (migrate or reduce to GitProvider internals)
- `src/index/scm/providers/git.js` (new)
- `src/index/scm/registry.js`
- `src/index/build/file-processor/cpu.js` (git meta)
- `src/index/build/file-processor/process-chunks/index.js` (chunk authors)
- `src/index/build/artifacts/metrics.js` (repo provenance)
- `src/index/build/runtime/runtime.js` (buildId uses provider head)
- `src/index/build/indexer/steps/incremental.js` (git meta cache -> provider cache config)

Touchpoints (anchors; approximate):
- `src/index/git.js` (~L69 `getGitMetaForFile`, ~L177 `getRepoProvenance`, ~L216 `computeNumstatChurn`)
- `src/index/build/discover.js` (~L136 `listGitFiles`, ~L176 `gitResult`)
- `src/index/build/preprocess.js` (~L90 `discoverEntries`)
- `src/index/build/indexer/steps/discover.js` (~L34 `discoverFiles`)
- `src/index/build/file-processor/cpu.js` (~L280 `getGitMetaForFile`)
- `src/index/build/file-processor/process-chunks/index.js` (~L411 `getChunkAuthorsFromLines`)
- `src/index/build/artifacts/metrics.js` (~L47 `repoProvenance`)
- `src/index/build/runtime/runtime.js` (~L170 `repoProvenance`, ~L174 `buildId`)
- `src/index/build/indexer/steps/incremental.js` (~L25 `configureGitMetaCache`)
- `src/index/build/runtime/policy.js` (~L18 `git` policy)
- `src/index/build/file-processor.js` (~L440 `gitBlameEnabled` plumbing)

#### Tests / verification (path-corrected for current test layout)
- [ ] `tests/indexing/scm/index-build-git-provider.test.js` (new)
  - [ ] Build index inside a git repo and assert:
    - [x] `build_state.json.repo.provider === "git"`
    - [x] tracked file discovery returns only git-tracked files (plus explicit records-dir behavior if enabled)
  - [ ] annotate metadata is present only when enabled; otherwise explicitly absent with a reason
  - [ ] uses mockable SCM runner for unit coverage of git parsing without requiring git

---

### Phase 13.3 — Implement JJ provider (read-only default, robust parsing)

- [x] Implement `JjProvider` using `jj` CLI (no library dependency):
  - [x] Detection:
    - [x] find `.jj/` root
    - [x] validate `jj --version` runnable (capability gating)
  - [x] Tracked files:
    - [x] `jj file list --tracked -0` (prefer NUL delim where available)
  - [x] Repo provenance:
    - [x] resolve a stable head reference (commitId + changeId where available)
    - [ ] record bookmarks (best-effort)
    - [x] `dirty` best-effort (explicitly document semantics)

- [x] Safety default: read-only by default
  - [x] When `indexing.scm.jj.snapshotWorkingCopy=false`:
    - [x] run JJ commands with `--ignore-working-copy` and `--at-op=@` (per spec)
  - [x] If enabled:
    - [x] allow exactly one controlled snapshot at start (and pin subsequent commands to that op)
    - [x] record the pinned op id in build state (so provenance is reproducible)

- [x] Implement changed-files support (for incremental reuse):
  - [x] Provide `getChangedFiles()` based on the spec in `docs/specs/jj-provider-commands-and-parsing.md`.
  - [x] Normalize to **repo-root-relative POSIX paths**.
  - [x] Define deterministic ordering and truncation caps for changed-file outputs.

Touchpoints:
- `docs/specs/jj-provider-commands-and-parsing.md` (align with implementation)
- `src/index/scm/providers/jj.js` (new)
- `src/index/scm/providers/jj-parse.js` (new: isolated parsing helpers)
- `src/index/build/indexer/signatures.js` (include JJ head/changeId + op pin when used)

Touchpoints (anchors; approximate):
- `docs/specs/jj-provider-commands-and-parsing.md` (definitions for `jj file list`, `jj log`, `jj status`)
- `src/index/build/indexer/signatures.js` (~L46 `gitBlameEnabled` placeholder to replace with provider head)

#### Tests / verification (path-corrected for current test layout)
- [ ] Unit: parsing helpers
  - [ ] `tests/indexing/scm/jj-changed-files-parse.test.js`
  - [ ] `tests/indexing/scm/jj-head-parse.test.js`
- [ ] `tests/indexing/scm/jj-changed-files-normalization.test.js` (new)
  - [ ] ensure paths are POSIX, repo-root-relative, and sorted deterministically.
- [x] CI behavior:
  - [x] if `jj` missing, JJ tests skip (exit code 77) with a clear message.
  - [x] add explicit lane/tag so JJ tests can be isolated if needed.

---

### Phase 13.4 — CLI + tooling visibility (make SCM selection obvious)

- [x] CLI flags (override config, optional but recommended):
  - [x] `pairofcleats index build --scm-provider <auto|git|jj|none>`
  - [x] `pairofcleats index build --scm-annotate / --no-scm-annotate`

- [x] Surface effective provider + provenance in diagnostics:
  - [x] `pairofcleats tooling doctor --json` should include:
    - provider selected
    - repo root
    - head id(s)
    - whether annotate is enabled

Touchpoints:
- `bin/pairofcleats.js` (flag plumbing)
- `src/shared/cli-options.js` (new flags)
- `tools/tooling-doctor.js` (report SCM provider)

Touchpoints (anchors; approximate):
- `bin/pairofcleats.js` (~L509 `tooling doctor` dispatch, ~L692 `index build` help)
- `src/shared/cli-options.js` (~L4 `INDEX_BUILD_OPTIONS`)
- `tools/tooling-doctor.js` (~L33 `runToolingDoctor`)
- `src/index/tooling/doctor.js` (~L139 `runToolingDoctor`)

---

### Phase 13.5 — Non-repo environments (explicitly supported)

- [x] Make filesystem-only behavior first-class:
  - [x] If `provider=none` (or auto selects none):
    - [x] file discovery uses filesystem crawl (current fallback)
    - [x] build state records `repo.provider="none"` and `repo.head=null`
    - [x] incremental reuse features that require SCM provenance must be disabled with an explicit reason (no silent partial behavior)
    - [x] buildId/signatures use a deterministic "no-scm" marker (do not leak git-specific fields)
- [x] Document this mode as “try it anywhere” for non-code/non-repo folders.

Touchpoints:
- `src/index/scm/providers/none.js` (new)
- `docs/contracts/indexing.md` (document provider="none" behavior)
- `docs/guides/commands.md` (CLI flags and behavior notes)

Touchpoints (anchors; approximate):
- `src/index/build/build-state.js` (~L104 `repoRoot`, ~L133 `repo`)
- `src/index/build/runtime/runtime.js` (~L170 `repoProvenance`, ~L174 `buildId`)
- `src/index/build/discover.js` (~L26 `discoverFiles`, ~L92 `discoverEntries`)

#### Tests / verification
  - [x] `tests/indexing/scm/index-build-no-scm.test.js` (new)
  - [x] Build index in a temp folder without `.git/` and assert build succeeds and provenance is explicitly null.
  - [x] `tests/indexing/scm/no-scm-build-id.test.js` (new)
    - [x] buildId/signatures do not include git/jj fields and remain stable across runs.

---
