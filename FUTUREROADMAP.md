# PairOfCleats FutureRoadmap

## Status legend

Checkboxes represent the state of the work, update them to reflect the state of work as its being done:
- [x] Implemented and appears complete/correct based on code inspection and existing test coverage
- [@] In Progress, this work has been started
- [.] Work has been completed but has Not been tested
- [?] There is a correctness gap **or** there is missing/insufficient test proving behavior
- [ ] Not complete

Completed Phases: `COMPLETED_PHASES.md`

---


### Source-of-truth hierarchy (when specs disagree)
When a document/spec conflicts with the running code, follow this order:

1) **`src/contracts/**` and validators** are authoritative for artifact shapes and required keys.
2) **Current implementation** is authoritative for runtime behavior *when it is already validated by contracts/tests*.
3) **Docs** (`docs/contracts/**`, `docs/specs/**`) must be updated to match (never the other way around) unless we have a deliberate migration plan.

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
- Phase 14 -- Incremental Diffing & Snapshots (Time Travel, Regression Debugging)
  + 14.1 Snapshot & diff artifact surface (contracts, retention, safety)
  + 14.2 Pointer snapshots (creation, validation gating, CLI/API)
  + 14.3 Frozen snapshots (immutable copies + integrity verification)
  + 14.4 Deterministic diff computation (bounded, machine-readable)
  + 14.5 Retrieval + tooling integration: “as-of” snapshots and “what changed” surfaces
  + 14.1.1 IndexRef parsing and resolution
  + 14.1.2 Snapshot/diff artifact surface (contracts)
  + 14.1.3 Atomic writes + locking
  + 14.1.4 Path safety and privacy
  + 14.1.5 Retention defaults 
- Phase 15 -- Federation & Multi-Repo (Workspaces, Manifests, Federated Search)
  + 15.1 Workspace configuration, repo identity, and repo-set IDs
  + 15.2 Workspace manifest + build orchestration
  + 15.3 Federated search orchestration (CLI/API/MCP)
  + 15.4 Cohort gating (compatibility safety)
  + 15.5 Federated query cache (keying + invalidation + canonicalization)
  + 15.6 Cache taxonomy, CAS, GC, and scale-out ergonomics

### Dependency map (high-level)
- Phase 14.1 (artifact surface + contracts) must land before any snapshot creation or diff computation.
- Phase 14.2/14.3 depend on 14.1.1–14.1.3 (IndexRef parsing + atomic writes).
- Phase 14.4 diff computation depends on 14.1–14.3 artifacts.
- Phase 14.5 retrieval/tooling integration depends on 14.2–14.4.
- Phase 15.1/15.2 must land before 15.3 (federated search), which must land before 15.5 (federated cache).

---

## Phase 14 — Incremental Diffing & Snapshots (Time Travel, Regression Debugging)

### Objective

Introduce **first-class snapshot & diff artifacts** so we can:

- Query indexes **“as-of” a prior build** (time-travel).
- Generate deterministic **“what changed”** artifacts between two index states.
- Support regression debugging, release auditing, and safe incremental reuse.

This phase establishes:

> **Authoritative spec**: the on-disk layout, ID conventions, and resolution rules for this phase are already refined in:
> - `docs/specs/index-refs-and-snapshots.md` (snapshot registry + IndexRef)
> - `docs/specs/index-diffs.md` (diff schemas + deterministic event stream)
>
> This roadmap section must stay aligned with those specs (notably: snapshot IDs are `snap-*` and diff IDs are `diff_*`).

Additional docs that MUST be updated if Phase 14 adds new behavior or config:
  - `docs/contracts/indexing.md` + `docs/contracts/artifact-contract.md` (public artifact surface)
  - `docs/config/schema.json` + `docs/config/contract.md` + `docs/config/inventory.md` + `docs/config/inventory-notes.md`
  - `docs/guides/commands.md` (new CLI flags/subcommands)
  - `docs/specs/index-refs-and-snapshots.md`
  - `docs/specs/index-diffs.md`
  - `docs/specs/as-of-retrieval-integration.md`
  - `docs/specs/http-api.md` (if HTTP API endpoints are implemented)

- **Pointer snapshots** (cheap metadata references to validated builds).
- **Frozen snapshots** (immutable, self-contained archival copies).
- **Diff artifacts** (bounded, deterministic change sets + summaries).

### Phase 14 Acceptance (explicit)
- [ ] Snapshot artifacts are schema‑valid and deterministic across runs.
- [ ] “As‑of” retrieval can target a snapshot without fallback to live builds.
- [ ] Diff artifacts are bounded, deterministic, and machine‑readable.
- [ ] Snapshot/diff tooling surfaces are present in CLI/API.


### 14.1 Snapshot & diff artifact surface (contracts, retention, safety)

- [ ] Define the on-disk **public artifact surface** under each repo cache root:
  - [ ] `snapshots/manifest.json` — snapshot registry (authoritative index of snapshots)
  - [ ] `snapshots/<snapshotId>/snapshot.json` — immutable per-snapshot metadata record
  - [ ] `snapshots/<snapshotId>/frozen.json` — immutable freeze metadata record (when frozen)
  - [ ] `snapshots/<snapshotId>/frozen/index-<mode>/...` — frozen snapshot index roots (immutable copies)
  - [ ] `diffs/manifest.json` — diff registry (authoritative index of diffs)
  - [ ] `diffs/<diffId>/inputs.json` — canonical diff input identity (always present)
  - [ ] `diffs/<diffId>/summary.json` — bounded diff summary (always present)
  - [ ] `diffs/<diffId>/events.jsonl` — bounded event stream (may be truncated)

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
  - [ ] `hasFrozen` + `frozenAt` (when frozen)
  - [ ] `frozenFromBuildId` (optional, when frozen snapshot derives from pointer)
  - [ ] future-proof fields (schema allows but does not require): `workspaceId`, `namespaceKey`
    - Defer multi-repo/workspace orchestration to **Phase 15 — Federation & Multi-Repo**.

  - [ ] Define diff registry entry schema (minimum fields):
    - [ ] `id`, `createdAt`, `from` + `to` refs (snapshotId/buildId/indexRootRef), `modes`
    - [ ] `summaryPath` and optional `eventsPath`
    - [ ] `truncated` flag + truncation metadata (`maxEvents`, `maxBytes`)
    - [ ] `compat` block capturing `from.configHash` vs `to.configHash` and `toolVersion` mismatches.
- [ ] Define `diffs/<diffId>/inputs.json` schema (minimum fields):
  - [ ] `id`, `createdAt`, `from`, `to`, `modes`, `allowMismatch`
  - [ ] `identityHash` of canonical inputs (deterministic)
  - [ ] `from.configHash`/`to.configHash`, `from.toolVersion`/`to.toolVersion` (for audit)
  - [ ] Specify identity hash inputs explicitly (fields included/excluded; createdAt/tags/labels excluded).

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
  - [ ] Define redaction rules for `path:` refs and output fields (persist hash + redacted placeholder; never persist raw absolute paths).
  - [ ] Define error codes for snapshot/diff failures (validation missing, path escape, mismatch without allow, unknown ref).

- [ ] Integrate **validation gating semantics** into the contract:
  - [ ] Pointer snapshots may only reference builds that passed index validation (see Phase 14.2).
  - [ ] Frozen snapshots must be self-contained and re-validatable.

Touchpoints:
- `src/index/snapshots/**` (new)
- `src/index/diffs/**` (new)
  - `src/shared/artifact-schemas.js` (add AJV validators for `snapshots/manifest.json`, `diffs/manifest.json`, `diffs/*/inputs.json`, `diffs/*/summary.json`)
  - `src/contracts/registry.js` (register new schemas)
  - `src/contracts/schemas/*` (new snapshot/diff schemas)
  - `docs/contracts/indexing.md`
  - `docs/contracts/artifact-contract.md`
  - `docs/specs/index-refs-and-snapshots.md`
  - `docs/specs/index-diffs.md`

#### Tests
- [ ] `tests/unit/snapshots-registry.unit.js`
  - [ ] Registry schema validation (valid/invalid cases)
  - [ ] Atomic update behavior (simulate interrupted write; registry remains readable)
  - [ ] Path safety (reject absolute paths and `..` traversal)
  - [ ] Deterministic ordering (`createdAt`, then `id`)
  - [ ] Tag reverse index is stable + deterministic
  - [ ] Retention honors protected tags (e.g., `release`)
- [ ] `tests/unit/diffs-registry.unit.js`
  - [ ] Schema validation + bounded/truncation metadata correctness
  - [ ] Registry ordering is deterministic


### 14.2 Pointer snapshots (creation, validation gating, CLI/API)

- [ ] Implement pointer snapshot creation:
  - [ ] Resolve repo cache root and current build roots from `builds/current.json`.
  - [ ] Load `build_state.json` from the current build root (for `buildId`, `configHash`, `toolVersion`, and provenance).
  - [ ] Require a successful artifact validation signal before snapshotting:
    - [ ] Preferred: consume a persisted validation report if present.
    - [ ] Otherwise: run validation on-demand against each mode index root.
    - [ ] Define authoritative validation signal + precedence (build_state.validation vs report file vs on-demand run); fail if conflicting.
  - [ ] Refuse snapshot creation when builds are incomplete:
    - [ ] If an index mode is missing required artifacts, fail.
    - [ ] If embeddings/risk passes are still pending for a mode, fail.
    - [ ] No allow-incomplete override in Phase 14 (must align with spec).
  - [ ] Materialize snapshot entry with:
    - [ ] `buildRoot` + `modeBuildRoots` captured as **repo-cache-relative** paths.
    - [ ] `integritySummary` populated from validation output + minimal artifact counts.
  - [ ] Write immutable per-snapshot metadata:
    - [ ] `snapshots/<snapshotId>/snapshot.json` (write atomically).
    - [ ] Keep the registry entry minimal and link to the per-snapshot record if desired.
  - [ ] Append entry to `snapshots/manifest.json` atomically.
  - [ ] Apply retention after creation (delete oldest pointer snapshots unless tagged).

- [ ] Add CLI surface:
  - [ ] `pairofcleats index snapshot create [--label <label>] [--tags <csv>] [--modes <csv>]`
  - [ ] `pairofcleats index snapshot list [--json]`
  - [ ] `pairofcleats index snapshot show <snapshotId> [--json]`
  - [ ] `pairofcleats index snapshot rm <snapshotId> [--force]`

- [ ] Add API surface (recommended for UI/MCP parity):
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
- `src/index/build/build-state.js` (read validation flags + build metadata)
- `src/contracts/schemas/build-state.js` + `src/contracts/validators/build-state.js`
- `src/index/validate.js` + `src/index/validate/*` (on-demand validation)
- `tools/index/validate.js` (if snapshot create invokes CLI validation)
- `docs/guides/commands.md` (CLI surface)
- `tools/api/**` (if API endpoints added)

#### Tests
  - [ ] `tests/services/snapshot-create.test.js`
  - [ ] Build an index; create a pointer snapshot; assert registry entry exists and references current build.
  - [ ] Fail creation when artifacts are missing or validation fails.
  - [ ] Fail creation when `build_state.json` is missing or `validation.ok !== true`.
  - [ ] No allow-incomplete override: ensure creation fails when validation missing even with flags.
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
- `src/shared/artifact-io/manifest.js` (verify checksums + manifest parsing)
- `src/shared/json-stream.js` (atomic JSON writes for frozen.json)
- `src/shared/fs/atomic-replace.js` (if needed for atomic directory swaps)

#### Tests
  - [ ] `tests/services/snapshot-freeze.test.js`
  - [ ] Create pointer snapshot → freeze → validate frozen index roots succeed.
  - [ ] Ensure freeze is atomic (simulate failure mid-copy → no partial frozen dir is considered valid).
  - [ ] Ensure frozen snapshot remains usable after deleting the original build root.
  - [ ] Validate checksum mismatch fails freeze and leaves no finalized frozen dir.
  - [ ] Hardlink vs copy behavior (same filesystem vs cross-device).


### 14.4 Deterministic diff computation (bounded, machine-readable)

- [ ] Implement diff computation between two index states:
  - [ ] CLI: `pairofcleats index diff --from <snapshotId|buildId|path> --to <snapshotId|buildId|path> [--modes <csv>]`
  - [ ] Resolve `from` and `to` to per-mode index roots (snapshot pointer, snapshot frozen, or explicit indexRoot).
  - [ ] Refuse or annotate mismatches:
    - [ ] If `configHash` differs, require `--allow-mismatch` or mark output as “non-comparable”.
    - [ ] If `toolVersion` differs, annotate (diff still possible but less trustworthy).

  - [ ] Define diff output formats:
    - [ ] Always write `diffs/<diffId>/inputs.json` (canonical input identity + mode selection).
    - [ ] Always write `diffs/<diffId>/summary.json` (bounded):
    - [ ] counts of adds/removes/changes by category
    - [ ] `truncated` boolean + reason
    - [ ] `from`/`to` metadata (snapshot IDs, build IDs, createdAt)
  - [ ] Optionally write `diffs/<diffId>/events.jsonl` (bounded stream):
    - [ ] `file_added | file_removed | file_changed` (path + old/new hash)
    - [ ] `chunk_added | chunk_removed | chunk_changed`:
      - [ ] stable `chunkId` from `metaV2.chunkId`
      - [ ] minimal before/after summary (`file`, `segment`, `kind`, `name`, `start/end`), plus optional `semanticSig` (hash of normalized docmeta/metaV2 subset)
    - [ ] `graph_edge_added | graph_edge_removed` (graph name + from/to node IDs)
    - [ ] Allow future event types (symbols/contracts/risk) without breaking old readers.

- [ ] Implement deterministic diffing rules:
    - [ ] Define canonical event taxonomy + ordering key in the roadmap (type order + stable key fields).
    - [ ] Stable identity:
      - [ ] Files keyed by repo-relative path.
    - [ ] Chunks keyed by `metaV2.chunkId` (do **not** rely on numeric `chunk_meta.id`).
    - [ ] Graph edges keyed by `(graph, fromId, toId)`.
  - [ ] Stable ordering:
    - [ ] Sort events by `(type, key)` so repeated runs produce byte-identical outputs.
  - [ ] Boundedness:
    - [ ] Enforce `indexing.diffs.maxEvents` and `indexing.diffs.maxBytes`.
    - [ ] If exceeded, stop emitting events and mark summary as truncated; include category counts.

- [ ] Integrate diff generation into incremental build:
  - [ ] After a successful build+promotion, compute a diff vs the previous “latest” snapshot/build.
  - [ ] Use incremental state (manifest) to compute file-level changes in O(changed) where possible.
  - [ ] Emit diffs only after strict validation passes (so diffs don’t encode broken builds).
  - [ ] Store the diff under `diffs/<diffId>/...` and append to `diffs/manifest.json` (do **not** mix diffs into buildRoot without a strong reason).

- [ ] Sweep-driven hardening for incremental reuse/diff correctness (because this phase touches incremental state):
  - [ ] Before reusing an “unchanged” incremental build, verify required artifacts exist (use `pieces/manifest.json` as the authoritative inventory).
    - [ ] If any required piece is missing/corrupt, disable reuse and force rebuild.
  - [ ] Fast-path diff only when all `pieces/manifest.json` checksums and shard counts match (shard-aware; sum per-piece counts).
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
- `src/index/index-ref.js` (IndexRef parsing + resolution for diff inputs)
- `src/shared/json-stream.js` (events.jsonl writing + truncation bounds)
- `src/shared/stable-json.js` + `src/shared/hash.js` (diffId stability)

#### Tests
  - [ ] `tests/services/index-diff.test.js`
  - [ ] Build snapshot A; modify repo; build snapshot B; compute diff A→B.
  - [ ] Assert file_changed appears for modified file.
  - [ ] Assert chunk changes use `metaV2.chunkId` and are stable across runs.
  - [ ] Assert ordering is deterministic (byte-identical `events.jsonl`).
  - [ ] Assert truncation behavior when `maxEvents` is set low.
  - [ ] Assert diffId deterministic for identical inputs (same IDs + same mode selection).
  - [ ] Assert configHash mismatch requires explicit allow/flag and is annotated.
  - [ ] Assert toolVersion mismatch is annotated (diff still produced).
  - [ ] `tests/indexer/incremental/index-reuse-validation.test.js`
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

- [ ] Add API surface (recommended):
  - [ ] `GET /index/diffs` (list)
  - [ ] `GET /index/diffs/:id` (summary)
  - [ ] `GET /index/diffs/:id/events` (JSONL stream; bounded)
  - [ ] `GET /search?snapshotId=...` (search “as-of” a snapshot)

- [ ] Sweep-driven hardening for retrieval caching (because this phase touches retrieval index selection):
  - [ ] Ensure query cache keys include `asOf.identityHash` (or resolved buildId) so results cannot bleed across snapshots.
  - [ ] Fix retrieval index signature calculation to account for sharded artifacts (see tests below) and include snapshot identity.

Touchpoints:
- `src/retrieval/cli-args.js` (add `--snapshot/--as-of`)
- `src/retrieval/cli.js` (thread snapshot option through)
- `src/retrieval/cli-index.js` (resolve index dir via snapshot; update query cache signature)
- `src/shared/artifact-io.js` (add signature helpers for sharded artifacts)
- `bin/pairofcleats.js` (CLI wiring)
- `tools/build/sqlite/cli.js` + `tools/build/sqlite/run.js` (add `--snapshot/--as-of`)
- `tools/api/**` (if API endpoints added)
- `src/retrieval/query-cache.js` + `src/retrieval/cli/run-search-session.js` (cache key composition + persistence)
- `src/retrieval/index-cache.js` (index signature + snapshot awareness)
- `src/retrieval/output/explain.js` (optional: surface as-of identity in explain)
- `docs/guides/commands.md` (CLI docs)

#### Tests
  - [ ] `tests/services/snapshot-query.test.js`
  - [ ] Build snapshot A; modify repo; build snapshot B.
  - [ ] Run the same query against `--snapshot A` and `--snapshot B`; assert results differ as expected.
  - [ ] Assert “latest” continues to resolve to the current build when no snapshot is provided.
- [ ] `tests/unit/retrieval-index-signature-shards.unit.js`
  - [ ] Create a fake index dir with `chunk_meta.meta.json` + `chunk_meta.parts/*`.
  - [ ] Assert the index signature changes when any shard changes.
  - [ ] `tests/services/sqlite-build-snapshot.test.js`
  - [ ] Build snapshot A.
  - [ ] Run `pairofcleats lmdb build` / `pairofcleats sqlite build` equivalents with `--snapshot A`.
  - [ ] Assert output DB is produced and corresponds to that snapshot’s artifacts.
  - [ ] `tests/unit/retrieval-cache-key-asof.unit.js`
    - [ ] Cache key includes `asOf.identityHash` or resolved buildId.

---

## Phase 14 Augmentations (authoritative alignment + implementation breakdown)

This section augments the copied roadmap above to align it with the authoritative Phase 14 specs under `docs/specs/`. Where items conflict, the guidance here takes precedence.

### Canonical specs and no-drift rule

Phase 14 MUST follow these docs as the source of truth for formats and semantics:

- `docs/specs/index-refs-and-snapshots.md`
- `docs/specs/index-diffs.md`
- `docs/specs/as-of-retrieval-integration.md`
- `docs/specs/implementation-checklist.md`

Roadmap guidance MUST NOT redefine JSON schemas, file layouts, or event formats. It should only add task decomposition, touchpoints, and tests.

### Corrections to the copied roadmap (must align with specs)

- **Diff events filename**: use `diffs/<diffId>/events.jsonl` (not `index_diff.jsonl`).
- **Snapshot files**: include `snapshots/<id>/snapshot.json` and `snapshots/<id>/frozen.json` per spec. Frozen data lives under `snapshots/<id>/frozen/`.
- **Diff inputs**: persist `diffs/<diffId>/inputs.json` in addition to `summary.json` and `events.jsonl`.
- **No allow-incomplete in Phase 14**: snapshot creation MUST fail if validation is missing or false.
- **IndexRef parsing**: canonical refs are `latest | build:<id> | snap:<id> | tag:<tag> | path:<path>` with case normalization.
- **Path privacy**: never persist absolute paths; `path:` refs may not be persisted unless `--persist-unsafe`, and must be redacted.

---

## 14.1 Foundations (IndexRef + artifact contracts + safety)

### 14.1.1 IndexRef parsing and resolution

- [ ] Implement `src/index/index-ref.js`:
  - [ ] `parseIndexRef(ref)` to normalize and validate per spec.
  - [ ] `resolveIndexRef({ repoRoot, userConfig, requestedModes, preferFrozen, allowMissingModes })`:
    - [ ] `latest` -> `builds/current.json` promotion data.
    - [ ] `build:<id>` -> repo cache build root.
    - [ ] `snap:<id>` -> snapshot registry with `preferFrozen`.
    - [ ] `tag:<tag>` -> tag reverse index (deterministic latest-first).
    - [ ] `path:<path>` -> in-memory only (do not persist; identity uses `pathHash`).
  - [ ] `identityHash = sha1(stableStringify(identity))`.
  - [ ] Hard invariant: `identity` must contain no absolute paths.

Touchpoints:
- `src/index/index-ref.js` (new)
- `src/shared/stable-json.js#stableStringify`
- `src/shared/hash.js#sha1`
- `src/shared/error-codes.js#createError`
- `tools/dict-utils/*` (repo cache root + current build info helpers)

Tests:
- [ ] `tests/unit/index-ref.unit.js` (parse + identityHash stability + tag ordering + path redaction)

### 14.1.2 Snapshot/diff artifact surface (contracts)

- [ ] Define artifacts exactly per spec:
  - [ ] `snapshots/manifest.json`
  - [ ] `snapshots/<id>/snapshot.json`
  - [ ] `snapshots/<id>/frozen.json`
  - [ ] `diffs/manifest.json`
  - [ ] `diffs/<diffId>/inputs.json`
  - [ ] `diffs/<diffId>/summary.json`
  - [ ] `diffs/<diffId>/events.jsonl`
- [ ] Define `inputs.json` schema fields explicitly (canonical refs, mode list, allowMismatch, identityHash).
- [ ] Update public docs to match schema:
  - [ ] `docs/contracts/indexing.md`
  - [ ] `docs/contracts/artifact-contract.md`
  - [ ] `docs/specs/index-refs-and-snapshots.md`
  - [ ] `docs/specs/index-diffs.md`

Touchpoints:
- `src/contracts/schemas/*` (new snapshot/diff schemas)
- `src/contracts/validators/*`
- `src/contracts/registry.js`

Tests:
- [ ] `tests/unit/snapshots-contracts.unit.js`
- [ ] `tests/unit/diffs-contracts.unit.js`

### 14.1.3 Atomic writes + locking

- [ ] Use index lock for snapshot/diff writes.
- [ ] Write JSON atomically (temp + rename) with stable JSON output.
- [ ] Clean up stale `frozen.staging-*` directories (default 24h).

Touchpoints:
- `src/index/build/lock.js#acquireIndexLock`
- `src/shared/json-stream.js#writeJsonObjectFile`

Tests:
- [ ] `tests/unit/snapshots-registry.unit.js` (atomic update + readability after simulated failure)

### 14.1.4 Path safety and privacy

- [ ] Persist only repo-cache-relative paths.
- [ ] Reject absolute paths or traversal (`..`).
- [ ] Persisted artifacts must not leak absolute paths.
- [ ] Define redaction behavior for `path:` refs and any persisted output fields (hash + placeholder; no raw absolute paths).

Touchpoints:
- `src/index/validate/paths.js#isManifestPathSafe`
- `src/shared/files.js#toPosix`
- `src/index/index-ref.js` (path: refs redaction)

Tests:
- [ ] `tests/unit/no-path-leak.unit.js`

### 14.1.5 Retention defaults (optional)

- [ ] If implementing config defaults, create and follow `docs/specs/config-defaults.md`:
  - [ ] `indexing.snapshots.keepPointer`, `keepFrozen`, `maxAgeDays`, `protectedTagGlobs`, `stagingMaxAgeHours`
  - [ ] `indexing.diffs.keep`, `maxAgeDays`
  - [ ] `indexing.diffs.compute.*` (modes, bounds, persist)

  Touchpoints:
  - `docs/config/schema.json`
  - `docs/config/contract.md`
  - `docs/config/inventory.md`
  - `tools/dict-utils/config.js#normalizeUserConfig`

---

## 14.2 Pointer snapshots

- [ ] Implement `pairofcleats index snapshot create`:
  - [ ] Acquire index lock.
  - [ ] Resolve `latest` via IndexRef resolver.
  - [ ] Require `build_state.json.validation.ok === true` for all selected modes.
  - [ ] Define authoritative validation signal + precedence (build_state.validation vs report file vs on-demand run); fail if conflicting.
  - [ ] Write `snapshot.json` atomically, then update manifest with tag index.
- [ ] Implement `snapshot list/show/prune`.
- [ ] Ensure tag reverse index is deterministic.

Touchpoints:
- `tools/index-snapshot.js`
- `src/index/snapshots/registry.js`
- `src/index/snapshots/create.js` (or command module)
- `bin/pairofcleats.js` (CLI wiring)

Tests:
- [ ] `tests/services/snapshot-create.test.js`

Optional API:
- [ ] `tools/api/router/*` plus `docs/specs/http-api.md` if API endpoints are implemented.

---

## 14.3 Frozen snapshots

- [ ] Implement `snapshot freeze`:
  - [ ] Create `frozen.staging-*` then hardlink/copy artifacts listed in `pieces/manifest.json`.
  - [ ] Verify checksums; on success rename staging -> `frozen/` and write `frozen.json`.
  - [ ] Update manifest `hasFrozen=true`.
- [ ] Stale staging cleanup and idempotency behavior.

Touchpoints:
- `src/index/snapshots/freeze.js`
- `src/index/snapshots/copy-pieces.js`
- `src/shared/hash.js` (checksum)

Tests:
- [ ] `tests/services/snapshot-freeze.test.js`

---

## 14.4 Deterministic diff computation

- [ ] Implement `pairofcleats index diff compute/show/list/prune`.
- [ ] Deterministic diffId from canonical inputs.
- [ ] Persist `inputs.json`, `summary.json`, and bounded `events.jsonl`.
- [ ] Define canonical event taxonomy + ordering key (type order + stable key fields).
- [ ] Fast-path only if pieces manifests match in a shard-aware way (all checksums + summed counts).
- [ ] Deterministic ordering (mode order + per-mode sort).
- [ ] Truncation behavior deterministic and documented in summary.

Touchpoints:
- `tools/index-diff.js`
- `src/index/diffs/compute.js`
- `src/index/diffs/events.js`
- `src/index/diffs/registry.js`
- `src/index/build/incremental.js` (reuse validation + signature binding)

Tests:
- [ ] `tests/services/index-diff.test.js`
- [ ] `tests/indexer/incremental/index-reuse-validation.test.js`

---

## 14.5 Retrieval integration (as-of)

- [ ] Add `--as-of <IndexRef>` to search CLI args.
- [ ] Default behavior unchanged when omitted; `--as-of latest` is equivalent to no flag.
- [ ] Resolve AsOfContext in `src/retrieval/cli.js` and thread to index resolution.
- [ ] Include `asOf.identityHash` in query cache keys.
- [ ] Unify retrieval index signature computation to be shard-aware and include snapshot identity.
- [ ] Enforce single-root policy for sqlite/lmdb as-of selection.
- [ ] JSON output includes an `asOf` block (ref, identityHash, resolved summary).
- [ ] Human output prints a single `[search] as-of: ...` line when `--as-of` is provided.
- [ ] Telemetry includes `asOf.type` and short `identityHash`; never log raw paths.

Touchpoints:
- `src/retrieval/cli-args.js`
- `src/retrieval/cli.js`
- `src/retrieval/cli-index.js`
- `src/retrieval/index-cache.js#buildIndexSignature`

Tests:
- [ ] `tests/services/snapshot-query.test.js`
- [ ] `tests/unit/retrieval-cache-key-asof.unit.js`
- [ ] `tests/unit/retrieval-index-signature-shards.unit.js`

---

## 14.6 Optional HTTP API integration

- [ ] Extend `/search` to accept `asOf` and thread to `--as-of`.
- [ ] Add snapshot and diff endpoints if UI parity is required.
- [ ] Enforce allowed repo roots and never return absolute paths in responses.
- [ ] Create `docs/specs/http-api.md` if HTTP endpoints are implemented.

Touchpoints:
- `tools/api/router/search.js`
- `tools/api/router/index-snapshots.js` (new)
- `tools/api/router/index-diffs.js` (new)
- `tools/api/validation.js` (schema updates for new params)
- `docs/specs/http-api.md`

Tests:
- [ ] `tests/services/api-search-asof.test.js` (if API is added)

## Phase 15 — Federation & Multi-Repo (Workspaces, Manifests, Federated Search)

### Objective

Enable first-class **workspace** workflows: index and query across **multiple repositories** in a single operation (CLI/API/MCP), with:

- explicit and deterministic repo identity (`repoId`, `repoRootCanonical`, `repoSetId`)
- deterministic selection, cohort gating, and merge semantics; stable JSON output for reproducibility
- correct cache keying and invalidation for both per-repo caches and federation-level query caches
- safe-by-default compatibility gating (cohorts) with explicit overrides and loud diagnostics
- clear cache layering with an eventual content-addressed store (CAS) and manifest-driven garbage collection (GC)

### Phase 15 Acceptance (explicit)
- [ ] Workspace config + manifest schemas are enforced and validated.
- [ ] Federated search works across repo sets with deterministic ordering.
- [ ] Cohort gating prevents unsafe mixed‑version query plans.
- [ ] Federated query cache is keyed and invalidated deterministically.

### Canonical specs and required updates

Phase 15 MUST align with these authoritative docs:
- `docs/specs/workspace-config.md`
- `docs/specs/workspace-manifest.md`
- `docs/specs/federated-search.md`
- `docs/contracts/compatibility-key.md`

Specs that must be drafted before implementation (authoritative once added):
- `docs/specs/federation-cohorts.md` (from the cohort spec notes below)
- `docs/specs/federated-query-cache.md` (federated cache keying + eviction policy)
- `docs/specs/cache-cas-gc.md` (cache taxonomy, CAS layout, GC)

Spec updates required in Phase 15:
- Update `docs/specs/federated-search.md` to:
  - accept `workspaceId` (preferred) and allowlisted `workspacePath`
  - default to redacting absolute paths (only include when debug.includePaths=true)
  - record cohort choices without leaking paths

Additional docs that MUST be updated if Phase 15 adds new behavior or config:
- `docs/config/schema.json` + `docs/config/contract.md` (if new config flags are added)
- `docs/guides/commands.md` (workspace/federation CLI flags)

### 15.1 Workspace configuration, repo identity, and repo-set IDs

> **Authoritative spec:** `docs/specs/workspace-config.md`

- [ ] Implement a strict workspace configuration loader (JSONC-first).
  - [ ] Recommended convention: `.pairofcleats-workspace.jsonc`.
  - [ ] Parsing MUST use `src/shared/jsonc.js` (`readJsoncFile` / `parseJsoncText`).
  - [ ] Root MUST be an object; unknown keys MUST hard-fail at all object levels.

- [ ] Resolve and canonicalize every repo entry deterministically.
  - [ ] Resolve `root`:
    - [ ] absolute paths allowed
    - [ ] relative paths resolved from `workspaceDir`
    - [ ] schemaVersion=1: do not accept registry/catalog ids
  - [ ] Resolve to a repo root (not a subdir): `repoRootResolved = resolveRepoRoot(rootAbs)`.
  - [ ] Canonicalize identity root: `repoRootCanonical = toRealPath(repoRootResolved)`; normalize win32 casing.
  - [ ] Compute `repoId = getRepoId(repoRootCanonical)`.

- [ ] Normalize metadata deterministically.
  - [ ] `alias`: trim; empty -> null; uniqueness is case-insensitive.
  - [ ] `tags`: trim -> lowercase -> drop empties -> dedupe -> sort.
  - [ ] `enabled`: boolean (default from `defaults.enabled`, else true).
  - [ ] `priority`: integer (default from `defaults.priority`, else 0).

- [ ] Enforce uniqueness constraints (fail fast, actionable errors).
  - [ ] No duplicate `repoRootCanonical`.
  - [ ] No duplicate `repoId`.
  - [ ] No duplicate alias (case-insensitive).

- [ ] Introduce stable workspace membership identity: `repoSetId`.
  - [ ] Compute per spec (order-independent, excludes display fields):
    - [ ] sorted list of `{ repoId, repoRootCanonical }`
    - [ ] `repoSetId = "ws1-" + sha1(stableStringify({ v:1, schemaVersion:1, repos:[...] }))`
  - [ ] `repoSetId` is used for:
    - [ ] workspace manifest pathing (15.2)
    - [ ] federated query cache directory naming (15.5)

- [ ] Centralize identity/canonicalization helpers across all callers.
  - [ ] Any cache key that includes a repo path MUST use `repoRootCanonical`.
  - [ ] API server routing (`tools/api/router.js`), MCP repo resolution (`tools/mcp/repo.js`), CLI, and workspace loader MUST share the same canonicalization semantics.

**Touchpoints:**
- `tools/shared/dict-utils.js` (repo root resolution, `getRepoId`, cache root helpers)
- `src/shared/jsonc.js`, `src/shared/stable-json.js`, `src/shared/hash.js`
- New (preferred): `src/workspace/config.js`

**Tests**
- [ ] `tests/workspace/config-parsing.test.js`
- [ ] `tests/workspace/repo-set-id-determinism.test.js`
- [ ] `tests/workspace/repo-canonicalization-dedup.test.js`
- [ ] `tests/workspace/alias-uniqueness-and-tags-normalization.test.js`

---

### 15.2 Workspace manifest (index discovery) + workspace-aware build orchestration

> **Authoritative spec:** `docs/specs/workspace-manifest.md`

- [ ] Implement deterministic workspace manifest generation (schemaVersion = 1).
  - [ ] Resolve `federationCacheRoot` per spec:
    - workspace `cacheRoot` (resolved absolute or relative to `workspaceDir`) else `getCacheRoot()`.
  - [ ] Write atomically to:
    - `<federationCacheRoot>/federation/<repoSetId>/workspace_manifest.json`.
  - [ ] Serialize with `stableStringify` so the file is byte-stable for unchanged state.

- [ ] Populate manifest entries per repo (sorted by `repoId`).
  - [ ] Resolve per-repo config and compute `repoCacheRoot`.
  - [ ] Read build pointer: `<repoCacheRoot>/builds/current.json`.
    - [ ] invalid/unreadable JSON MUST be treated as missing pointer (do not preserve stale values).
  - [ ] For each mode in `{code, prose, extracted-prose, records}`:
    - [ ] derive `indexDir` from the build roots
    - [ ] compute `indexSignatureHash` as `is1-` + sha1(buildIndexSignature(indexDir))
    - [ ] read `cohortKey` (preferred) and `compatibilityKey` (fallback) from `<indexDir>/index_state.json` (warn if both missing)
  - [ ] Resolve sqlite artifacts and compute file signatures (`size:mtimeMs`) per spec.

- [ ] Compute and persist `manifestHash` (`wm1-...`) exactly per spec.
  - [ ] MUST change for search-relevant state changes (build pointer, index signature, sqlite changes, compatibilityKey/cohortKey).
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
    - [ ] workspace config v1 supplies no per-repo build overrides
    - [ ] concurrency-limited repo builds (avoid “N repos × M threads” explosion)
  - [ ] Post-step: regenerate workspace manifest and emit `repoSetId` + `manifestHash`.

- [ ] Optional debug tooling: cache inspection (“catalog”) commands.
  - [ ] If implemented, treat as debug tooling only; do not make federation correctness depend on scanning `<cacheRoot>/repos/*`.

**Touchpoints:**
- `tools/shared/dict-utils.js` (cache roots, build pointer resolution, sqlite path helpers)
- `src/retrieval/index-cache.js` (`buildIndexSignature`)
- New (preferred): `src/workspace/manifest.js`

**Tests**
- [ ] `tests/workspace/manifest-determinism.test.js`
- [ ] `tests/workspace/manifest-hash-invalidation.test.js`
- [ ] `tests/workspace/build-pointer-invalid-treated-missing.test.js`
- [ ] `tests/workspace/index-signature-sharded-variants.test.js`

---

### 15.3 Federated search orchestration (CLI, API server, MCP)

> **Authoritative spec:** `docs/specs/federated-search.md`

- [ ] CLI: implement federated mode for search.
  - [ ] `pairofcleats search --workspace <workspaceFile> "<query>" [searchFlags...] [workspaceFlags...]`
  - [ ] Workspace flags (per spec): `--select`, `--tag`, `--repo-filter`, `--include-disabled`, `--merge`, `--top-per-repo`, `--concurrency`
  - [ ] Forbidden combinations (per spec): if `--workspace` is present, `--repo` MUST error (`ERR_FEDERATED_REPO_FLAG_NOT_ALLOWED`).

- [ ] Implement a single federation coordinator used by CLI/API/MCP.
  - [ ] Load workspace config (15.1) and manifest (15.2).
  - [ ] Apply deterministic selection rules.
  - [ ] Apply cohort gating hook (15.4).
  - [ ] Derive `perRepoTop` and rewrite per-repo args.
  - [ ] Fanout per-repo searches with bounded concurrency; reuse `indexCache` and `sqliteCache`.
  - [ ] Merge per-mode results with RRF and deterministic tie-breakers.
  - [ ] Emit federated response with stable serialization (`stableStringify`) and required meta fields.

- [ ] Output invariants (multi-repo unambiguity).
  - [ ] Every hit MUST include `repoId`, `repoAlias`, and `globalId = "${repoId}:${hit.id}"`.
  - [ ] Results must remain unambiguous even when `relPath` collides across repos.

- [ ] API server: add `POST /search/federated` (recommended by spec).
  - [ ] Enforce repo-root allowlist checks for every repo in the request.
  - [ ] Apply workspacePath allowlisting and prefer workspaceId mapping.
  - [ ] Default to redacting absolute paths unless `debug.includePaths=true`.

- [ ] MCP: add federated tool(s).
  - [ ] Implement `search_workspace` tool with inputs matching the API request.
  - [ ] Ensure output includes repo attribution and is stable JSON.

**Touchpoints:**
- `bin/pairofcleats.js` (CLI)
- `src/retrieval/cli.js`, `src/retrieval/cli-args.js`
- `src/integrations/core/index.js`
- `tools/api/router.js`
- `tools/mcp/server.js` / `tools/mcp/repo.js`
- New (per spec): `src/retrieval/federation/{coordinator,select,merge,args}.js`

**Tests**
- [ ] `tests/retrieval/federation/search-multi-repo-basic.test.js`
- [ ] `tests/retrieval/federation/search-determinism.test.js` (byte-identical JSON)
- [ ] `tests/retrieval/federation/repo-selection.test.js`
- [ ] `tests/api/federated-search-workspace-allowlist.test.js`
- [ ] `tests/api/federated-search-redacts-paths.test.js`

---

### 15.4 Compatibility gating (cohorts) + safe federation defaults

> **Authoritative contract:** `docs/contracts/compatibility-key.md`
> **Spec to draft:** `docs/specs/federation-cohorts.md`

- [ ] Do not duplicate compatibility key computation.
  - [ ] Continue computing `compatibilityKey` at index time via `buildCompatibilityKey`.
  - [ ] Ensure it is persisted to `index_state.json` (and `pieces/manifest.json` where relevant).

- [ ] Add a federation-specific `cohortKey` (mode-scoped) and persist it.
  - [ ] Compute `cohortKey` per mode from the same input family as `compatibilityKey`, but scoped so it does not change merely because other modes were built.
  - [ ] Persist `cohortKey` into `<indexDir>/index_state.json` alongside `compatibilityKey`.
  - [ ] Back-compat: if `cohortKey` is absent, federation uses `compatibilityKey`.
  - [ ] Update workspace manifest generation (15.2) to read `cohortKey` and include it per mode.

- [ ] Implement cohort partitioning in the federation coordinator (per mode).
  - [ ] Partition repos by `effectiveKey = cohortKey ?? compatibilityKey ?? null`.
  - [ ] Default policy: choose highest-ranked cohort, exclude others, emit `WARN_FEDERATED_MULTI_COHORT`.
  - [ ] Strict policy: error on multi-cohort (`ERR_FEDERATED_MULTI_COHORT`).
  - [ ] Explicit selection: `--cohort <key>` or `--cohort <mode>:<key>`.
  - [ ] Unsafe mixing: `--allow-unsafe-mix` with loud warning `WARN_FEDERATED_UNSAFE_MIXING`.

- [ ] Update `docs/specs/workspace-manifest.md` and `docs/specs/federated-search.md` to reflect cohortKey (fallback to compatibilityKey).

**Touchpoints:**
- `src/contracts/compatibility.js`
- `src/integrations/core/build-index/compatibility.js`
- `src/index/build/indexer/steps/write.js` (index_state write)
- `src/retrieval/federation/coordinator.js`
- `src/workspace/manifest.js`

**Tests**
- [ ] `tests/retrieval/federation/compat-cohort-defaults.test.js`
- [ ] `tests/retrieval/federation/compat-cohort-determinism.test.js`
- [ ] `tests/retrieval/federation/compat-cohort-explicit-selection.test.js`

---

### 15.5 Federated query caching + cache-key correctness + multi-repo bug fixes

> **Spec to draft:** `docs/specs/federated-query-cache.md`

- [ ] Introduce federated query cache storage under `federationCacheRoot`.
  - [ ] Location MUST be: `<federationCacheRoot>/federation/<repoSetId>/queryCache.json`.
  - [ ] Writes MUST be atomic; tolerate concurrent readers and avoid file corruption.
  - [ ] Eviction MUST be deterministic.

- [ ] Cache keying MUST be complete and stable.
  - [ ] Cache key MUST include (directly or via `manifestHash`):
    - [ ] `repoSetId`
    - [ ] `manifestHash` (primary invalidator)
    - [ ] normalized selection (selected repo ids, includeDisabled, tags, repoFilter, explicit selects)
    - [ ] cohort decision inputs/outputs
    - [ ] normalized search request knobs that affect output (query, modes, filters, backend choices, ranking knobs)
    - [ ] merge strategy and limits (`top`, `perRepoTop`, `rrfK`, concurrency)
  - [ ] Key payload serialization MUST use `stableStringify`.

- [ ] Stop duplicating or weakening index signature logic.
  - [ ] For federation invalidation, prefer `manifestHash` rather than ad hoc per-repo signatures.
  - [ ] For per-repo cache invalidation, use `buildIndexSignature` (not bespoke partial signatures).

- [ ] Canonicalize repo-path keyed caches everywhere federation touches.
  - [ ] API server repo cache keys MUST use `repoRootCanonical`.
  - [ ] MCP repo cache keys MUST canonicalize subdir inputs to the repo root.
  - [ ] If `builds/current.json` is invalid JSON, clear build id and caches rather than keeping stale state.

**Touchpoints:**
- `src/retrieval/index-cache.js`
- `src/shared/artifact-io.js`
- `src/retrieval/query-cache.js`
- `tools/api/router.js`
- `tools/mcp/repo.js`
- `tools/shared/dict-utils.js`

**Tests**
- [ ] `tests/retrieval/federation/query-cache-key-stability.test.js`
- [ ] `tests/retrieval/federation/query-cache-invalidation-via-manifesthash.test.js`
- [ ] `tests/retrieval/federation/mcp-repo-canonicalization.test.js`
- [ ] `tests/retrieval/federation/build-pointer-invalid-clears-cache.test.js`

---

### 15.6 Shared caches, CAS, GC, and scale-out ergonomics

> **Spec to draft:** `docs/specs/cache-cas-gc.md`

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
  - [ ] Concurrency limits for multi-repo indexing and federated fanout search.
  - [ ] Memory remains bounded under “N repos × large query” workloads.

**Touchpoints:**
- `src/shared/cache.js`
- `tools/cache-gc.js`
- `tools/shared/dict-utils.js`
- `docs/guides/commands.md`

**Tests**
- [ ] `tests/indexing/cache/workspace-global-cache-reuse.test.js`
- [ ] `tests/indexing/cache/cas-reuse-across-repos.test.js`
- [ ] `tests/tooling/cache/cache-gc-preserves-manifest-referenced.test.js`
- [ ] `tests/indexing/cache/workspace-concurrency-limits.test.js`

---

### 15.7 Index stats reporter (single-shot + JSON)

> **Spec to draft:** `docs/specs/index-stats.md`

- [ ] Add a dedicated index stats reporter tool.
  - [ ] CLI entrypoint: `pairofcleats index stats` (or `node tools/index/stats.js`).
  - [ ] Input: `--repo <path>` or `--index-dir <path>`, optional `--mode`.
  - [ ] Output: human summary + `--json` for structured output.
  - [ ] Must use `pieces/manifest.json` as the source of truth (manifest-first).

- [ ] Report per-mode artifact stats with counts + bytes.
  - [ ] `chunk_meta` total rows, parts count, bytes per part.
  - [ ] `token_postings`, `phrase_ngrams`, `chargram_postings` counts + bytes.
  - [ ] `symbols`, `symbol_occurrences`, `symbol_edges` counts + bytes.
  - [ ] `graph_relations` rows + bytes; `call_sites` rows + bytes.
  - [ ] embeddings (dense vectors, hnsw, lancedb): count + bytes where present.

- [ ] Report index-level summary.
  - [ ] Total chunk count (per mode + aggregate).
  - [ ] Total file count (from `file_meta` or manifest counts).
  - [ ] Manifest compatibility key + build id + artifact surface version.
  - [ ] Size totals by artifact family (chunks, postings, symbols, relations, embeddings).

- [ ] Add a lightweight “missing/invalid” validator mode.
  - [ ] `--verify` checks required artifacts exist and sizes match manifest.
  - [ ] Warn on missing or mismatched checksum/bytes.

**Touchpoints:**
- `tools/index/stats.js` (new)
- `tools/shared/dict-utils.js` (index root resolution)
- `src/shared/artifact-io/manifest.js` (manifest parsing helpers)
- `src/integrations/core/status.js` (optional reuse)

**Tests**
- [ ] `tests/tooling/index-stats/index-stats-json.test.js`
- [ ] `tests/tooling/index-stats/index-stats-missing-artifact.test.js`
- [ ] `tests/tooling/index-stats/index-stats-aggregate.test.js`

---




## Decision Register (resolve before execution)

| Decision | Description | Default if Unresolved | Owner | Due Phase | Decision deadline |
| --- | --- | --- | --- | --- | --- |
| D1 Phase 16 extraction deps | Which PDF/DOCX libraries are canonical? | Prefer pdfjs‑dist + mammoth | TBD | 16 | Before Phase 16 start |
| D2 Phase 17 vector‑only | Which sparse artifacts are removed vs retained? | Keep minimal metadata for compatibility | TBD | 17 | Before Phase 17 start |
| D3 Phase 18 packaging | Native packaging targets/priorities | Windows + macOS + Linux | TBD | 18 | Before Phase 18 start |
| D4 Phase 19 lexicon | Promote LEXI into FUTUREROADMAP? | Yes (single source) | TBD | 19 | Before Phase 19 start |
| D5 Phase 20 TUI | JSONL protocol v2 strictness | Strict + fail‑open log wrapping | TBD | 20 | Before Phase 20 start |

### Dependency map (high-level)
- Phase 16 extraction + routing precedes Phase 17 vector‑only profile defaults.
- Phase 19 lexicon work should land before Phase 20 TUI if the TUI consumes lexicon signals/explain fields.
- Phase 18 packaging should include any Phase 20 binaries once they exist.

### Phase status summary (update as you go)
| Phase | Status | Notes |
| --- | --- | --- |
| 16 | [ ] |  |
| 17 | [ ] |  |
| 18 | [ ] |  |
| 19 | [ ] |  |
| 20 | [ ] |  |

### Per‑phase testing checklist (fill per phase)
- [ ] Add/verify new tests for each phase’s core behaviors.
- [ ] Run at least the intended lane(s) and record results.
- [ ] Update docs/config inventory after schema changes.

## Phase 16 — Prose Ingestion + Retrieval Routing Correctness (PDF/DOCX + FTS policy)

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

---

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
- [ ] Expand the existing `tools/release/check.js` from “changelog-only” into a **deterministic release smoke-check runner**.
  - Touchpoints:
    - `tools/release/check.js` (extend; keep it dependency-light)
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
  - Runs `node tools/release/check.js` in a temp environment and asserts it succeeds on a healthy checkout.
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
    - `tools/release/check.js` (must behave correctly on all supported OSes)
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
- [ ] Extend `tools/release/check.js` to include a `--paths` step that runs the above regression checks in quick mode.

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
    - `tools/api/server.js`
    - `tools/service/indexer-service.js`
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
- [ ] Extend `tools/release/check.js` to optionally run a bounded-time service-mode smoke step (`--service-mode`).

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

---

## Phase 19 — Lexicon-Aware Relations + Retrieval Enrichment (Phase 11.9 consolidation)

### Objective
Deliver lexicon-aware build-time relation filtering, retrieval-time relation boosts, and chargram enrichment with ANN candidate safety. The phase provides a strict contract surface (schemas, config, explain output), deterministic behavior, and conservative defaults that can be safely enabled in production.

### Goals
- Canonical per-language lexicon assets and a cached loader with deterministic normalization.
- Build-time relation filtering to remove keyword/literal noise without altering imports/exports.
- Retrieval-time relation boosts (boost-only) with explain output and bounded, deterministic token lists.
- Chargram enrichment and ANN/minhash candidate safety policy with consistent explain reasons.
- Signature and config surfaces updated so incremental caches and CI stay correct.

### Non-goals
- Non-ASCII keyword support (explicitly deferred to a v2 lexicon format).
- Any change to semantic meaning of relations (boost-only, no filtering at retrieval time).
- Any change to ANN ranking semantics beyond safe candidate-set selection.

### Implementation upgrades applied (LEXI review)
- Retrieval scoring must wire through `src/retrieval/pipeline.js` and `src/retrieval/pipeline/candidates.js` (not ad-hoc sites).
- Query token source is `buildQueryPlan(...)` from `src/retrieval/cli/query-plan.js`; do not recompute tokens.
- Any ANN candidate knobs must be explicitly added to config schema + normalize-options.
- Relation filtering must preserve stable ordering and avoid over-filtering JS-like property names; use conservative keyword sets or per-language allowlists.
- Stopword lists must be fail-open; missing or invalid lexicon files must not fail builds.

### Additional docs/specs that MUST be updated
- `docs/config/schema.json` + `docs/config/contract.md` + `docs/config/inventory.*`
- `docs/specs/language-lexicon-wordlists.md`
- `docs/specs/lexicon-relations-filtering.md`
- `docs/specs/lexicon-retrieval-boosts.md`
- `docs/specs/chargram-enrichment-and-ann-fallback.md`
- `docs/contracts/artifact-contract.md` (explain payload surface and schema references)

### Authoritative details (must be preserved)

#### Lexicon wordlist format (v1)
- Required fields: `formatVersion` (const 1), `languageId`, `keywords[]`, `literals[]`.
- Optional fields: `types[]`, `builtins[]`, `modules[]`, `notes[]`.
- File layout: `src/lang/lexicon/wordlists/_generic.json` and `src/lang/lexicon/wordlists/<languageId>.json`.
- Normalization: lowercase, trim, ASCII-only, non-empty, dedupe. Sort on disk; loader must normalize regardless.
- Derived stopword domains:
  - `relations = keywords ∪ literals`
  - `ranking = keywords ∪ literals ∪ types ∪ builtins`
  - `chargrams = keywords ∪ literals` (optionally extended by config)
- Loader is fail-open with `_generic` fallback and a single structured warning on schema failures.

#### Lexicon schema requirements
- `language-lexicon-wordlist.schema.json` v1:
  - `additionalProperties=false`
  - `formatVersion` const 1
  - arrays of strings (minLength 1)
- Register schema in `src/contracts/registry.js` if validation is enforced at load time.

#### Relations filtering (build-time)
- Filter only `usages`, `calls`, `callDetails`, `callDetailsWithRange` (imports/exports unchanged in v1).
- `extractSymbolBaseName` separators: `.`, `::`, `->`, `#`, `/`; trim trailing `()`, `;`, `,`.
- Preserve stable order; optional stable de-dupe (keep first occurrence).

#### Retrieval relation boosts
- Signal tokens derive from `buildQueryPlan(...)` output (pipeline plan, not recompute).
- Per-hit stopword filtering in ranking domain; case-folding respects `caseTokens`.
- Scoring: `boost = min(maxBoost, callMatches*perCall + usageMatches*perUse)`.
- Explain payload includes `relationBoost` with bounded, deterministic token lists.

#### Chargram enrichment + ANN candidate policy
- Allowed `chargramFields`: `name`, `signature`, `doc`, `comment`, `body` (default `name,doc`).
- Optional `chargramStopwords` uses lexicon `chargrams` domain.
- Candidate policy rules (deterministic):
  - `null` candidates -> null (full ANN)
  - empty set -> empty set (no ANN hits)
  - too large -> null
  - too small with no filters -> null
  - filtersActive + allowedIdx -> allowedIdx
  - otherwise -> candidates
- Explain `annCandidatePolicy` includes `inputSize`, `output`, and `reason`:
  `noCandidates`, `tooLarge`, `tooSmallNoFilters`, `filtersActiveAllowedIdx`, `ok`.

### Feature flags + defaults (v1)
- Lexicon loader: enabled by default; fail-open on missing/invalid files.
- Relation filtering: enabled only at `quality=max` unless explicitly enabled in config.
- Relation boosts: disabled by default; must be explicitly enabled.
- Chargram enrichment: disabled by default; must be explicitly enabled.
- ANN/minhash candidate safety policy: always on (safety), explain output opt-in.
- Global off-switch: `indexing.lexicon.enabled=false`.

### Contract surface (versioned)
- Lexicon wordlists are schema-versioned JSON, validated on load.
- Explain output adds `relationBoost` and `annCandidatePolicy` with a versioned explain schema.
- Config schema explicitly includes lexicon + ANN candidate keys, documented in config inventory.

### Performance guardrails
- Relation filtering is O(n) over relations, no per-token regex or substring scans.
- Avoid new allocations in inner loops; reuse buffers where possible.
- Relation boost matching bounded by query token count.

### Compatibility: cache/signature impact
- Build signature inputs must include lexicon config (stopword policies), chargram fields/stopwords, and ANN candidate knobs.
- Bump `SIGNATURE_VERSION` if signature shape changes.

### 19.0 — Cross-cutting setup and contracts

#### Goals
- Establish the lexicon contract, schema, and config surfaces.
- Align config/CLI/doc surfaces with the current codebase.

#### Touchpoints
- `src/lang/` (new lexicon module)
- `src/shared/postings-config.js` (new fields)
- `src/retrieval/cli/normalize-options.js` (ANN candidate config knobs)
- `src/retrieval/cli/query-plan.js` (query token source for boosts)
- `src/retrieval/output/explain.js` + `src/retrieval/output/format.js`
- `src/index/build/indexer/signatures.js` (incremental signature inputs)
- `docs/config/schema.json`, `docs/config/contract.md`, `docs/config/inventory.*`
- `docs/specs/*` (lexicon + retrieval specs)
- `src/contracts/registry.js`
- `src/contracts/schemas/*` + `src/contracts/validators/*`

#### Tasks
- [ ] Decide canonical location for lexicon spec files (recommend `docs/specs/lexicon-*.md`).
- [ ] Add/extend config schema entries for:
  - `indexing.postings.chargramFields`
  - `indexing.postings.chargramStopwords`
  - `retrieval.annCandidateCap`
  - `retrieval.annCandidateMinDocCount`
  - `retrieval.annCandidateMaxDocCount`
  - `retrieval.relationBoost` (if exposed; otherwise document as quality-gated internal)
- [ ] Document defaults and quality gating in `docs/config/contract.md`.
- [ ] Update config inventory docs after schema changes.
- [ ] Update build signature inputs to include lexicon + postings config.
- [ ] Add an explicit global off switch: `indexing.lexicon.enabled=false`.
- [ ] Define and document versioning rules for lexicon wordlists and explain schema changes.
- [ ] Add lexicon validation tooling:
  - `tools/lexicon/validate.js` (schema validation for all wordlists)
  - `tools/lexicon/report.js` (coverage stats: missing languages, token counts)
  - `npm run lexicon:validate` and `npm run lexicon:report`
  - optional CI check for `lexicon:validate`
- [ ] Add v2 note in `docs/specs/language-lexicon-wordlists.md` to explicitly defer non-ASCII keywords.

#### Tests
- [ ] `tests/config/` schema drift tests updated if config schema changes.
- [ ] `tests/indexer/incremental/signature-lexicon-config.test.js`
- [ ] `tests/config/config-inventory-lexicon-keys.test.js`
- [ ] `tests/config/config-defaults-lexicon-flags.test.js`
- [ ] `tests/lexicon/lexicon-tool-validate.test.js`
- [ ] `tests/lexicon/lexicon-report.test.js`

---

### 19.1 — Language lexicon assets and loader

#### Objective
Provide a standardized lexicon for all language registry ids, with a cached loader and derived stopword sets.

#### Touchpoints
- New:
  - `src/lang/lexicon/index.js`
  - `src/lang/lexicon/load.js`
  - `src/lang/lexicon/normalize.js`
  - `src/lang/lexicon/wordlists/_generic.json`
  - `src/lang/lexicon/wordlists/<languageId>.json`
  - `docs/specs/language-lexicon-wordlists.md`
  - `docs/schemas/language-lexicon-wordlist.schema.json`
- Existing registry:
  - `src/index/language-registry/registry-data.js`

#### Tasks
- [ ] Implement lexicon module:
  - [ ] `getLanguageLexicon(languageId, { allowFallback })`
  - [ ] `isLexiconStopword(languageId, token, domain)` for `relations|ranking|chargrams`
  - [ ] `extractSymbolBaseName(name)` shared helper
  - Must split on `.`, `::`, `->`, `#`, `/` and trim trailing `()`, `;`, `,`
  - [ ] Expose per-language overrides in lexicon JSON (allowlists/exclusions for relations stopwords)
- [ ] Loader behavior:
  - [ ] Use `import.meta.url` to resolve wordlist directory
  - [ ] Cache in `Map<languageId, LanguageLexicon>`
  - [ ] Fail-open: missing or invalid => `_generic`
  - [ ] Emit a single structured warning on invalid lexicon files
- [ ] Loader is deterministic: stable ordering, no locale-sensitive transforms
- [ ] Add schema validation for each wordlist file
  - [ ] Register schema in `src/contracts/registry.js` and validate on load
- [ ] Add lexicon files for each language id in the registry; keep v1 conservative (keywords + literals only)
  - For JS/TS, keep keywords conservative to avoid filtering property names

#### Tests
- [ ] `tests/lexicon/lexicon-schema.test.js`
- [ ] `tests/lexicon/lexicon-loads-all-languages.test.js`
- [ ] `tests/lexicon/lexicon-stopwords.test.js`
- [ ] `tests/lexicon/lexicon-fallback.test.js`
- [ ] `tests/lexicon/extract-symbol-base-name.test.js`
- [ ] `tests/lexicon/lexicon-ascii-only.test.js`
- [ ] `tests/lexicon/lexicon-per-language-overrides.test.js`

---

### 19.2 — Build-time lexicon-aware relation filtering

#### Objective
Filter `rawRelations` before building `file_relations` and `callIndex`, using lexicon stopwords for relations.

#### Touchpoints
- `src/index/build/file-processor/cpu.js`
- `src/index/build/file-processor/relations.js`
  - `buildFileRelations(rawRelations, relKey)`
  - `buildCallIndex(rawRelations)`
- `src/index/build/file-processor/process-chunks.js`
- `src/retrieval/output/filters.js`
- New:
  - `src/index/build/file-processor/lexicon-relations-filter.js`

#### Tasks
- [ ] Implement `filterRawRelationsWithLexicon(rawRelations, { languageId, lexicon, config, log })`.
- [ ] Apply filtering immediately before relation building in `cpu.js`.
- [ ] Filtering rules:
  - `usages`: drop tokens in `lexicon.stopwords.relations`
  - `calls`/`callDetails`/`callDetailsWithRange`: drop entries if `extractSymbolBaseName(callee)` is a stopword
  - Preserve stable ordering; de-dupe only if required
- [ ] Fail-open if lexicon missing or disabled.
- [ ] Add per-language override mechanism (drop keywords/literals/builtins/types separately).
- [ ] Ensure cached bundles are compatible:
  - If cached bundles bypass filtering, ensure signature invalidation covers lexicon changes.
- [ ] Make stable ordering a formal contract requirement (document + test).

#### Tests
- [ ] `tests/file-processor/lexicon-relations-filter.test.js`
- [ ] `tests/retrieval/uses-and-calls-filters-respect-lexicon.test.js`
- [ ] `tests/file-processor/lexicon-relations-filter-ordering.test.js`
- [ ] `tests/file-processor/lexicon-relations-filter-keyword-property.test.js`
- [ ] `tests/file-processor/lexicon-relations-filter-no-imports.test.js`
- [ ] `tests/file-processor/lexicon-relations-filter-determinism.test.js`

---

### 19.3 — Retrieval-time lexicon-aware relation boosts

#### Objective
Add boost-only ranking based on calls/usages aligned with query tokens, excluding lexicon stopwords.

#### Touchpoints
- `src/retrieval/pipeline.js`
- `src/retrieval/cli/query-plan.js`
- New:
  - `src/retrieval/scoring/relation-boost.js`

#### Tasks
- [ ] Implement `computeRelationBoost({ chunk, fileRelations, queryTokens, lexicon, config })`.
- [ ] Wire into scoring in `src/retrieval/pipeline.js`:
  - Add `relationBoost` alongside existing boosts
  - Ensure boost-only (no filtering)
  - Provide explain payload when `--explain`
- [ ] Gate by quality or config (default off).
- [ ] Ensure query token source uses `buildQueryPlan(...)` output (no recompute).
- [ ] Define case-folding behavior in relation to `caseTokens` and `caseFile`.
- [ ] Add explain schema snippet documenting `relationBoost` fields and units.

#### Tests
- [ ] `tests/retrieval/relation-boost.test.js`
- [ ] `tests/retrieval/relation-boost-does-not-filter.test.js`
- [ ] `tests/retrieval/explain-includes-relation-boost.test.js`
- [ ] `tests/retrieval/relation-boost-case-folding.test.js`
- [ ] `tests/retrieval/relation-boost-stopword-elision.test.js`

---

### 19.4 — Chargram enrichment and ANN candidate safety

#### Objective
Allow optional chargram enrichment without recall loss, and enforce candidate set safety in ANN/minhash.

#### Touchpoints
- `src/shared/postings-config.js`
- `src/index/build/state.js` (chargram generation from fieldTokens)
- `src/retrieval/pipeline/candidates.js`
- `src/retrieval/pipeline.js`
- New:
  - `src/retrieval/scoring/ann-candidate-policy.js`

#### Tasks
- [ ] Extend `normalizePostingsConfig` to support `chargramFields` + `chargramStopwords` with defaults.
- [ ] Update chargram tokenization in `appendChunk(...)` to use `chargramFields` and optional lexicon stopword filtering.
- [ ] Implement `resolveAnnCandidateSet(...)` and apply to ANN and minhash candidate selection:
  - Use `annCandidateCap`, `annCandidateMinDocCount`, `annCandidateMaxDocCount`
  - Ensure filtersActive + allowedIdx behavior is preserved
- [ ] Emit explain payload for candidate policy decisions with deterministic `reason` codes.
- [ ] Ensure ANN/minhash use the same candidate policy (no divergence).
- [ ] Add a shared policy contract for `resolveAnnCandidateSet` and reuse in both paths.

#### Tests
- [ ] `tests/postings/chargram-fields.test.js`
- [ ] `tests/retrieval/ann-candidate-policy.test.js`
- [ ] `tests/retrieval/ann-candidate-policy-explain.test.js`
- [ ] `tests/postings/chargram-stopwords.test.js`
- [ ] `tests/retrieval/ann-candidate-policy-minhash-parity.test.js`
- [ ] `tests/retrieval/ann-candidate-policy-allowedIdx.test.js`
- [ ] `tests/retrieval/ann-candidate-policy-contract.test.js`

---

### 19.5 — Observability, tuning, and rollout

#### Objective
Make filtering/boosting behavior transparent and safe to tune.

#### Touchpoints
- `src/index/build/file-processor/cpu.js` (logging/counters)
- `src/retrieval/pipeline.js` (explain payload)
- `src/shared/auto-policy.js` (quality-based defaults)
- `docs/testing/truth-table.md` (quality gating + defaults)

#### Tasks
- [ ] Emit structured per-file counts for relations filtering (calls/usages dropped).
- [ ] Add `relationBoost` + `annCandidatePolicy` to explain output.
- [ ] Gate new features behind `quality=max` by default (unless explicit config enables).
- [ ] Add a compact summary line to build logs when lexicon filtering is active (opt-in via verbose).
- [ ] Add a lexicon status section to explain output when enabled (source file + version + domain counts).

#### Tests
- [ ] `tests/retrieval/explain-includes-relation-boost.test.js`
- [ ] `tests/retrieval/explain-includes-ann-policy.test.js`
- [ ] `tests/indexing/logging/lexicon-filter-counts.test.js`

---

### Proposed phase order (19.x)
1) 19.0 – Setup + contracts (config schema + docs + lexicon schema + tooling).
2) 19.1 – Lexicon loader + wordlists.
3) 19.2 – Build-time relations filtering.
4) 19.4 – Chargram enrichment + ANN candidate safety.
5) 19.3 – Retrieval relation boosts.
6) 19.5 – Observability + rollout gating.

---

## Phase 20 — Ratatui TUI + Node Supervisor (Protocol v2, Dispatcher, Tool Hygiene)

### Objective
Deliver a standalone Rust Ratatui TUI that owns the terminal and drives existing Node scripts through a Node supervisor with a strict, versioned JSONL protocol for tasks/logs/results, including correct cancellation and process-tree cleanup across platforms.

### Goals
- A single UI-driven entrypoint that can run core jobs (`setup`, `bootstrap`, `index build`, `search`, bench harness).
- Display streaming tasks and logs from nested subprocess trees.
- Cancellation that is tree-aware and predictable across platforms.
- Strict protocol boundary with JSONL progress and final job results.

### Non-goals
- Replacing all existing CLI commands immediately.
- Making every script pure JSONL in all modes (only in `--progress jsonl` mode).
- Distributed execution, resumable job queues, multi-user concurrency.
- Full interactive editor for every config file in MVP.

### Constraints and invariants
- Rust TUI owns the terminal: spawned jobs never assume they own TTY.
- Supervisor treats non-protocol output as logs only.
- Cancellation is tree-aware:
  - Windows: `taskkill /T` then `/F`
  - POSIX: signal process group when detached
- `--json` outputs are stdout-only; logs/progress go to stderr/protocol.

### Locked decisions
- Cancel exit code: tools exit 130 on user-initiated cancel.
- Progress protocol: v2 events include `proto: "poc.progress@2"` and allowlisted `event`.
- JSONL mode: stderr emits only protocol events (no raw lines).
- JSON output: stdout emits exactly one JSON object.
- Event ordering: every protocol event includes `ts` (ISO) and monotonic `seq` (per job when `jobId` exists).
- POSIX kill: if `detached === true`, kill process group (`-pid`), else kill PID.
- Job artifacts: supervisor emits `job:artifacts` after `job:end`.
- Search dispatch: `bin/pairofcleats.js` must not reject valid search flags or backends.
- Spec file locations:
  - `docs/specs/tui-tool-contract.md`
  - `docs/specs/progress-protocol-v2.md`
  - `docs/specs/node-supervisor-protocol.md`
  - `docs/specs/dispatcher-rewrite-and-search-reconciliation.md`
  - `docs/specs/supervisor-artifacts-indexing-pass.md`
  - `docs/specs/tui-installation.md`

### Sub-phase numbering note
Sub-phase numbers below are local to Phase 20 (20.0–20.5) and map 1:1 with the HAWKTUI roadmap.

### Implementation order (dependency-aware, cross-cutting first)
1) Sub-phase 20.0.2 + 20.1.1–20.1.3: kill-tree, strict protocol v2, shared stream decoder, stdout guard.
2) Sub-phase 20.0.3–20.0.7: tool JSONL/JSON hygiene (can proceed in parallel per tool family).
3) Sub-phase 20.2.1–20.2.2: supervisor protocol + implementation.
4) Sub-phase 20.2.3–20.2.4: dispatch refactor + artifacts pass.
5) Sub-phase 20.3: Rust TUI MVP (can start once protocol/manifest shapes are frozen).
6) Sub-phase 20.4: cancellation hardening.
7) Sub-phase 20.5: install + distribution.

### Parallelization map (non-overlapping work)
- Track A (protocol + helpers): 20.0.2, 20.1.1–20.1.3, 20.0.7.
- Track B (tool hygiene): 20.0.3–20.0.6 split by tool family.
- Track C (dispatch): 20.2.3 in parallel with Track B once protocol shapes are fixed.
- Track D (supervisor core): 20.2.2 in parallel with Track C.
- Track E (Rust TUI): 20.3 once 20.2.1 and manifest fields are frozen.
- Track F (install/dist): 20.5 after 20.3.1 crate skeleton.

### Dependency matrix (phase -> prerequisites)
| Phase / Sub-phase | Requires | Notes |
|---|---|---|
| 20.0.1 TUI tool contract | — | Spec + audit only |
| 20.0.2 Kill-tree unify | — | Hard dependency for supervisor + cancellation |
| 20.0.3 build_index JSONL cleanup | 20.0.2 | For abort correctness |
| 20.0.4 bench harness cleanup | 20.0.2 + 20.1.1/20.1.3 | Uses shared decoder + kill-tree |
| 20.0.5 setup cleanup | 20.1.1/20.1.2 | Needs progress context + protocol strictness |
| 20.0.6 bootstrap cleanup | 20.1.1/20.1.2 | Same as setup |
| 20.0.7 stdout guard | — | Can ship early; used by all |
| 20.1.1 protocol v2 spec | — | Foundation for 20.1.2/20.1.3 |
| 20.1.2 context propagation | 20.1.1 | Adds env + display wiring |
| 20.1.3 progress stream decoder | 20.1.1 | Used by bench + supervisor |
| 20.2.1 supervisor protocol spec | 20.1.1 | Requires v2 protocol definitions |
| 20.2.2 supervisor implementation | 20.0.2 + 20.1.1–20.1.3 | Needs kill-tree + decoder |
| 20.2.3 dispatch refactor | 20.1.1 | Needs stable manifest fields |
| 20.2.4 artifacts pass | 20.2.2 + 20.2.3 | Uses dispatch registry + job lifecycle |
| 20.3.1 Rust crate skeleton | — | Can begin early |
| 20.3.2 supervisor integration | 20.2.2 | Needs working supervisor |
| 20.3.3 UI behaviors | 20.3.1 + 20.2.3 | Needs manifest fields for palette |
| 20.4.1–20.4.3 cancellation hardening | 20.2.2 + 20.3.2 | Requires live supervisor + UI |
| 20.5.1 install + wrapper | 20.3.1 | Needs crate skeleton |
| 20.5.2 CI artifacts | 20.5.1 | Depends on build outputs |

### Cross-cutting constraints (apply to all phases)
- Protocol strictness: non-protocol lines are wrapped as `log` events.
- Line length cap: enforce a max line size in the shared decoder (default 1MB).
- Stdout discipline: tools that write JSON to stdout must not run children with `stdio: 'inherit'`.
- Test determinism: tests must run without network access unless explicitly mocked.

---

## Sub-phase 20.0: Preparation — tooling normalization + kill-tree unification

### Objective
Before introducing the supervisor/TUI, make existing CLI tools behave ideally for a terminal-owned orchestrator:
- deterministic non-interactive execution paths
- clean separation of stdout JSON vs stderr logs/progress
- consistent progress JSONL emission
- unified process-tree termination logic

### 20.0.0 Current-state inventory (audit targets)

**JSONL-clean candidates (verify + keep clean)**
- `tools/build/lmdb-index.js`
- `tools/build/tantivy-index.js`
- `tools/build/sqlite-index.js` (and `tools/build/sqlite/runner.js`)
- `tools/ci/build-artifacts.js`
- `tools/download/extensions.js`

**Mixed emitters (must be cleaned for JSONL mode)**
- `build_index.js` (JSONL + raw stderr writes)
- `tools/bench/language-repos.js` and `tools/bench/language/process.js` (JSONL + raw lines)

**No progress flags yet (must add + normalize)**
- `tools/setup/setup.js`
- `tools/setup/bootstrap.js`
- `tools/tooling/install.js`
- `tools/tooling/detect.js`

### 20.0.0.1 JSON stdout inventory (must audit child stdio)
Scope: tools with `--json` that emit JSON to stdout. Goal: ensure child processes never run with `stdio: 'inherit'` when JSON is expected.

**JSON stdout + child processes (direct or indirect)**
- `build_index.js` (verify nested runners do not inherit)
- `tools/setup/setup.js` (child via `runCommandBase`)
- `tools/setup/bootstrap.js` (child via `runCommand/runCommandOrExit`)
- `tools/tooling/install.js` (child via `spawnSync`)
- `tools/triage/context-pack.js` (child via `spawnSubprocessSync`)
- `tools/ci/run-suite.js` (child via `spawnSubprocess`)
- `tools/reports/combined-summary.js` (child via `spawnSubprocessSync`)
- `tools/reports/compare-models.js` (child via `spawnSubprocessSync`)
- `tools/reports/report-code-map.js` (child via `spawnSync('dot')`)
- `tools/bench/vfs/cold-start-cache.js` (child via `spawnSync`)
- `tools/ingest/ctags.js` (child via `spawn`)
- `tools/ingest/gtags.js` (child via `spawn`)
- `tools/ingest/scip.js` (child via `spawn`)
- `tools/bench/language-repos.js` (child via `tools/bench/language/process.js`)
- `tools/bench/language/process.js` (spawns benchmark jobs; must be JSONL-safe)

**JSON stdout + no direct child spawn detected**
- `tools/analysis/structural-search.js`
- `tools/analysis/explain-risk.js`
- `tools/eval/run.js`
- `tools/index/validate.js`
- `tools/index/cache-gc.js`
- `tools/index/report-artifacts.js`
- `tools/sqlite/verify-extensions.js`
- `tools/tooling/doctor.js`
- `tools/tooling/detect.js`
- `tools/config/validate.js`
- `tools/config/dump.js`
- `tools/config/reset.js`
- `tools/reports/metrics-dashboard.js`
- `tools/bench/language/cli.js`
- `tools/bench/dict-seg.js`
- `tools/bench/query-generator.js`
- `tools/bench/symbol-resolution-bench.js`
- `tools/bench/map/build-map-memory.js`
- `tools/bench/map/build-map-streaming.js`
- `tools/bench/micro/hash.js`
- `tools/bench/micro/watch.js`
- `tools/bench/micro/extractors.js`
- `tools/bench/micro/tinybench.js`
- `tools/bench/micro/compression.js`
- `tools/bench/micro/run.js`
- `tools/bench/micro/regex.js`
- `tools/bench/vfs/bloom-negative-lookup.js`
- `tools/bench/vfs/cdc-segmentation.js`
- `tools/bench/vfs/coalesce-docs.js`
- `tools/bench/vfs/hash-routing-lookup.js`
- `tools/bench/vfs/io-batching.js`
- `tools/bench/vfs/parallel-manifest-build.js`
- `tools/bench/vfs/partial-lsp-open.js`
- `tools/bench/vfs/merge-runs-heap.js`
- `tools/bench/vfs/token-uri-encode.js`
- `tools/bench/vfs/vfsidx-lookup.js`
- `tools/bench/vfs/segment-hash-cache.js`
- `tools/ingest/lsif.js`

**JSON file writers or pass-through (not stdout)**
- `tools/docs/script-inventory.js`
- `tools/docs/repo-inventory.js`
- `tools/ci/capability-gate.js`
- `tools/mcp/tools/search-args.js`
- `tools/mcp/tools/handlers/downloads.js`
- `tools/mcp/tools/handlers/artifacts.js`
- `tools/api/server.js` / `tools/api/router/search.js`

Action: for each child tool above, enforce piped stdio in JSON modes and add regression tests in 20.0.T2/20.0.T4.

### 20.0.1 Define the TUI tool contract and audit tool surfaces
- Add spec: `docs/specs/tui-tool-contract.md` defining flags, stdout/stderr rules, exit codes, and cancellation.
- Inventory the top-level scripts the TUI will drive:
  - `build_index.js`
  - `tools/bench/language-repos.js` (+ `tools/bench/language/process.js`)
  - `tools/setup/setup.js`
  - `tools/setup/bootstrap.js`
  - support tools invoked by the above where JSON is expected
- Add a developer note in `docs/`:
  - stdout is data, stderr is humans/protocol
  - how to register new commands in the dispatch registry

### 20.0.2 Unify process-tree termination into `src/shared/`
Problem today: multiple kill-tree implementations with inconsistent behavior.

**Code**
- Add `src/shared/kill-tree.js` exporting:
  - `killProcessTree(pid, opts) -> Promise<{terminated:boolean, forced:boolean, method?:string}>`
  - `killChildProcessTree(child, opts)`
- Windows semantics:
  1) `taskkill /PID <pid> /T` (no `/F`)
  2) wait `graceMs`
  3) `taskkill /PID <pid> /T /F`
- POSIX semantics:
  1) send `killSignal` to `-pid` when `useProcessGroup===true`, else `pid`
  2) wait `graceMs`
  3) send `forceSignal`
- Refactor call sites:
  - `src/shared/subprocess.js`
  - `tests/helpers/kill-tree.js` (re-export or delete)
  - `tests/runner/run-execution.js`
  - `tools/bench/language/process.js`
  - `tools/bench/language-repos.js`
- Docs to update:
  - `docs/specs/subprocess-helper.md`
  - `docs/testing/test-runner-interface.md`
  - `docs/language/benchmarks.md`

### 20.0.3 Refactor `build_index.js` for clean JSONL and stable final output
- In JSONL mode: no raw stderr writes; everything via protocol events.
- In JSON mode: stdout emits exactly one JSON summary object.
- On cancel: exit 130 and emit `job:end status="cancelled"`.

### 20.0.4 Refactor bench harness for TUI compatibility
- Use shared progress-stream decoder.
- Replace local kill-tree with `src/shared/kill-tree.js`.
- Gate any raw `console.error` in JSONL mode.

### 20.0.5 Refactor `tools/setup/setup.js` for supervisor-friendly behavior
- Add `--progress`, `--verbose`, `--quiet` flags.
- Route logs via `createDisplay`.
- Ensure child commands use piped stdio in JSON modes.
- Propagate `--progress jsonl` to children when in JSONL mode.

### 20.0.6 Refactor `tools/setup/bootstrap.js` similarly
- Same stdout/stderr discipline and progress propagation as setup.

### 20.0.7 Normalize log routing and output safety across toolchain
- Ensure tools invoked by setup/bootstrap use `createDisplay` and JSONL-safe stderr.
- Add `src/shared/cli/stdout-guard.js` (fail fast if stdout is polluted in JSON mode).

#### 20.0 Testing
- 20.0.T1 kill-tree unit tests (POSIX + Windows).
- 20.0.T2 tool contract tests (stdout/stderr discipline).
- 20.0.T3 clean JSONL regression tests (build_index + bench).
- 20.0.T4 decoder line-size cap test.
- 20.0.T5 context propagation test.

---

## Sub-phase 20.1: Protocol v2, context propagation, and shared decoder

### 20.1.1 Progress protocol v2
- Spec: `docs/specs/progress-protocol-v2.md`
- Event types: `log`, `task:start`, `task:progress`, `task:end`, `job:start`, `job:spawn`, `job:end`, `job:artifacts`
- Require `seq` monotonicity per job if `jobId` exists.
- Provide concrete JSONL examples for each event type.
- Touchpoints for `seq` and `ts`:
  - `src/shared/cli/progress-events.js`
  - `src/shared/cli/display.js`
  - `src/shared/cli/progress-stream.js`
  - `tools/tui/supervisor.js`
  - `tools/bench/language/process.js`
  - `tools/bench/language-repos.js`

### 20.1.2 Context propagation
- `src/shared/cli/display.js` reads `PAIROFCLEATS_PROGRESS_CONTEXT`.
- Ensure merged context is included in all JSONL events.
- Add env var to `src/shared/env.js` allowlist.
- Document in `docs/config/contract.md`.

### 20.1.3 Shared stream decoder
- Add `src/shared/cli/progress-stream.js`:
  - chunk -> line normalization
  - strict parse or wrap as `log`
  - enforce `maxLineBytes`

#### 20.1 Tests
- 20.1.T1 strict parser unit tests.
- 20.1.T2 stream decoder chunk boundary tests.
- 20.1.T3 clean JSONL regression tests.
- 20.1.T4 line-size cap test.
- 20.1.T5 context propagation test.

---

## Sub-phase 20.2: Node supervisor MVP

### 20.2.1 Supervisor protocol (spec)
- Add `docs/specs/node-supervisor-protocol.md`:
  - ops: `hello`, `job:run`, `job:cancel`, `shutdown`
  - events: `supervisor:hello`, `job:start`, `job:spawn`, `job:end`, passthrough `task:*` and `log`
  - `supervisor:hello` includes versions, capabilities, and protocol ids

### 20.2.2 Implementation: `tools/tui/supervisor.js`
- Job table with abort controllers, pid, status, seq.
- Spawn with `stdio: ['ignore','pipe','pipe']` and detached groups on POSIX.
- Use shared progress-stream decoder to emit strict JSONL.
- Buffer stdout for JSON result capture (bounded).
- On shutdown: cancel jobs, wait bounded time, force-exit if needed.

### 20.2.3 Dispatch refactor + search reconciliation
- Create `src/shared/dispatch/` (registry, resolve, env, manifest).
- Update `bin/pairofcleats.js` and `tools/tui/supervisor.js` to use shared dispatch.
- Search passthrough: remove backend allowlist and validation; pass args through.
- Add dispatch manifest commands:
  - `pairofcleats dispatch list --json`
  - `pairofcleats dispatch describe <command> --json`
- Add strict mode: `PAIROFCLEATS_DISPATCH_STRICT=1`.

### 20.2.4 Supervisor artifacts indexing pass
- Emit `job:artifacts` after `job:end`.
- Stat only known paths (no repo globbing).
- Job-specific extractors for build, search, setup, bench.

#### 20.2 Tests
- 20.2.T1 supervisor stream discipline.
- 20.2.T2 cancellation integration.
- 20.2.T3 env parity vs CLI dispatch.
- 20.2.T4 artifacts pass smoke.
- 20.2.T5 dispatch manifest tests.
- 20.2.T6 search flag passthrough.

---

## Sub-phase 20.3: Rust Ratatui TUI skeleton

### 20.3.1 Crate and core architecture
- `crates/pairofcleats-tui/` with `ratatui`, `crossterm`, `tokio`, `serde`, `serde_json`, `anyhow`.
- Modules: `protocol/`, `supervisor/`, `model/`, `ui/`, `app.rs`.
- Command palette sourced from dispatch manifest (no hard-coded list).

### 20.3.2 Supervisor integration
- Spawn `node tools/tui/supervisor.js` with piped stdio.
- Handshake and validate protocol version.
- Async reader/writer tasks; restart supervisor safely on crash.

### 20.3.3 UI behaviors (MVP)
- Job list + tasks table + logs + optional artifacts panel.
- Keybindings: `r` run palette, `c` cancel, `q` quit, `?` help overlay.
- Ensure TUI never relies on subprocess TTY.

#### 20.3 Tests
- 20.3.T1 protocol decoding tests (Rust).
- 20.3.T2 headless smoke test.
- 20.3.T3 cancel path integration.

---

## Sub-phase 20.4: Cancellation hardening

### 20.4.1 Supervisor escalation policies
- Use shared kill-tree semantics; emit termination metadata.

### 20.4.2 UI shutdown correctness
- On `q`: cancel all jobs, wait bounded time, shutdown supervisor, restore terminal.
- On `Ctrl+C`: first press cancels, second press force-exits after restore.

### 20.4.3 Never-hang guarantees
- Watchdog timeouts for supervisor and job shutdown.
- Hard cap on shutdown time (e.g., 10s).

#### 20.4 Tests
- 20.4.T1 ignore SIGTERM fixture.
- 20.4.T2 UI dies mid-job fixture.

---

## Sub-phase 20.5: Install/distribution (compile-on-install + prebuilt fallback)

### 20.5.1 Installer + wrapper
- Implement `tools/tui/install.js` with secure prebuilt fallback.
- Implement `bin/pairofcleats-tui.js` wrapper.
- Update `package.json` to expose `pairofcleats-tui`.
- Docs: `docs/guides/commands.md`, `docs/guides/tui.md`.

### 20.5.2 CI pipeline for artifacts
- Build for win32-x64, linux-x64, darwin-x64/arm64 if supported.
- Upload binaries + sha256 + manifest.

#### 20.5 Tests
- 20.5.T1 installer unit tests.
- 20.5.T2 wrapper behavior tests.

---
## Appendix A — LEXI (verbatim)

# LEXI

This document consolidates the Phase 11.9 lexicon specs into a complete, repo-aligned implementation plan with granular tasks, tests, and touchpoints. The draft spec content has been absorbed here; future/lexi drafts can be removed once this plan is the single source of truth.

---

## Evaluation Notes (by document)

These notes assume the Phase 11.9 specs are promoted into `docs/specs/` (see 11.9.0 tasks). Any discrepancies should be resolved in those canonical docs first, then reflected here.

### phase-11.9-lexicon-aware-relations-and-retrieval-enrichment.md
- Well structured and matches repo architecture; touchpoints listed are mostly accurate.
- Adjustments needed:
  - `src/retrieval/pipeline.js` is the actual scoring entrypoint; any new boost/candidate policy work should be wired there and in `src/retrieval/pipeline/candidates.js` (for candidate set building).
  - Retrieval options parsing for ANN candidate controls is not currently exposed in `src/retrieval/cli/normalize-options.js`; the phase should include parsing and config schema updates if these knobs are to be configurable.
  - Relation filtering should explicitly preserve stable ordering and avoid filtering builtins/types by default (already stated); for JS-like languages where keywords can be property names, limit keyword lists to safe identifiers or add per-language allowlists.

### spec-language-lexicon-wordlists.md
- Solid and conservative; aligns with a fail-open loader.
- Ambiguity: "ASCII only" is safe but may exclude keywords for some languages (e.g., localized keywords). This should be explicit as a v1 constraint with a future v2 note.
- Add a clearer contract for `extractSymbolBaseName` and document separators ordering (consistent with relations spec).
- Ensure the canonical wordlist format includes `formatVersion`, `languageId`, and required arrays, with a strict schema (additionalProperties=false).

### spec-lexicon-relations-filtering.md
- Correct placement and safety constraints.
- Ambiguity: Should filtering also apply to `rawRelations.imports/exports`? The spec says no; keep it explicit and add a note that only usages/calls/callDetails/callDetailsWithRange are filtered in v1.
- Recommend adding per-language overrides for stopword sets (e.g., JS keyword subset) to avoid over-filtering.

### spec-lexicon-retrieval-boosts.md
- Good; boost-only with clear explain payload.
- Adjustment: query token source is `src/retrieval/cli/query-plan.js`, but the actual tokens are available in the pipeline context. Wire from existing query plan rather than recomputing.
- Clarify whether `queryTokens` are case-folded using `caseTokens` (current pipeline has `caseTokens` and `caseFile` flags).

### spec-chargram-enrichment-and-ann-fallback.md
- Matches current architecture.
- Adjustment: `annCandidateMinDocCount` and related knobs are not currently parsed or surfaced; add explicit config plumbing and schema updates in this phase.
- Candidate policy should be shared between ANN and minhash fallbacks (currently the pipeline reuses `annCandidateBase` for minhash); the policy should be applied consistently.

---

## Spec Extracts to Carry Forward (Authoritative Details)

These are the non-negotiable details that must be preserved when the Phase 11.9 specs are promoted into `docs/specs/` and implemented.

### Lexicon wordlist format (v1)
- Required fields: `formatVersion` (const 1), `languageId`, `keywords[]`, `literals[]`.
- Optional fields: `types[]`, `builtins[]`, `modules[]`, `notes[]`.
- File layout: `src/lang/lexicon/wordlists/_generic.json` and `src/lang/lexicon/wordlists/<languageId>.json` (languageId must match registry id).
- Normalization rules: lowercase, trim, ASCII-only, non-empty, dedupe. Sort on disk, but loader must normalize regardless.
- Derived stopword domains:
  - `relations = keywords ∪ literals`
  - `ranking = keywords ∪ literals ∪ types ∪ builtins`
  - `chargrams = keywords ∪ literals` (optionally extended to types/builtins when chargramStopwords is enabled)
- Fail-open loader with `_generic` fallback and one-time warnings on schema failures.

### Lexicon schema requirements
- `language-lexicon-wordlist.schema.json` v1:
  - `additionalProperties=false`
  - `formatVersion` const 1
  - arrays of strings (minLength 1) for wordlist fields
- The schema must be registered under `src/contracts/registry.js` if validation is enforced at load time.

### Relations filtering (build-time)
- Filter only `usages`, `calls`, `callDetails`, `callDetailsWithRange` (not imports/exports in v1).
- `extractSymbolBaseName` separators (split, take last non-empty): `.`, `::`, `->`, `#`, `/`.
- Trim trailing `()`, `;`, `,` from base name.
- Preserve stable order; optional stable de-dupe (keep first occurrence).

### Retrieval relation boosts
- Signal tokens derive from `buildQueryPlan(...)` output (use pipeline query plan, not recompute).
- Per-hit stopword filtering in ranking domain; case-folding must respect `caseTokens`.
- Scoring: `boost = min(maxBoost, callMatches*perCall + usageMatches*perUse)` with small defaults.
- Explain output includes `relationBoost` with bounded token lists and deterministic ordering/truncation.

### Chargram enrichment + ANN candidate policy
- Allowed `chargramFields`: `name`, `signature`, `doc`, `comment`, `body` (default `name,doc`).
- Optional `chargramStopwords` uses lexicon `chargrams` domain for token filtering.
- Candidate policy rules (deterministic):
  - `null` candidates -> null (full ANN)
  - empty set -> empty set (no ANN hits)
  - too large -> null
  - too small with no filters -> null
  - filtersActive + allowedIdx -> allowedIdx
  - otherwise -> candidates
- Explain `annCandidatePolicy` includes `inputSize`, `output`, `reason` (`noCandidates`, `tooLarge`, `tooSmallNoFilters`, `filtersActiveAllowedIdx`, `ok`).

---

# Phase 11.9 – Lexicon-Aware Relations and Retrieval Enrichment

## Feature Flags + Defaults (v1)
- Lexicon loader: enabled by default; fail-open on missing/invalid files.
- Relation filtering: enabled only at `quality=max` unless explicitly enabled in config.
- Relation boosts: disabled by default; must be explicitly enabled.
- Chargram enrichment: disabled by default; must be explicitly enabled.
- ANN/minhash candidate safety policy: always on (safety), but explain output is opt-in.
- Global off-switch: `indexing.lexicon.enabled=false` disables lexicon filtering and related boosts.

## Contract Surface (versioned)
- Lexicon wordlists: schema-versioned JSON, validated on load.
- Explain output: `relationBoost` and `annCandidatePolicy` fields added with a versioned explain schema.
- Config schema: new lexicon + ANN candidate keys explicitly versioned in docs/config schema and inventory.

## Performance Guardrails
- All lexicon filtering must be O(n) over relations; no per-token regex or substring scans.
- Avoid new allocations in inner loops; reuse buffers/arrays where possible.
- Relation boost matching must be bounded by query token count (no unbounded scans).

## Compatibility: cache/signature impact
- Build signature inputs must include lexicon configs (stopwords, chargramFields/stopwords) and ANN candidate knobs.
- If signature shape changes, bump `SIGNATURE_VERSION` and update incremental tests accordingly.

## 11.9.0 – Cross-cutting Setup and Contracts

### Goals
- Establish the lexicon contract, schema, and config surfaces.
- Align config/CLI/doc surfaces with current codebase.

### Additional docs/specs that MUST be updated
- `docs/config/schema.json` + `docs/config/contract.md` + `docs/config/inventory.*`
- `docs/specs/language-lexicon-wordlists.md`
- `docs/specs/lexicon-relations-filtering.md`
- `docs/specs/lexicon-retrieval-boosts.md`
- `docs/specs/chargram-enrichment-and-ann-fallback.md`

### Touchpoints
- `src/lang/` (new lexicon module)
- `src/shared/postings-config.js` (new fields)
- `src/retrieval/cli/normalize-options.js` (new ANN candidate config knobs)
- `src/retrieval/cli/query-plan.js` (query token source for boosts)
- `src/retrieval/output/explain.js` + `src/retrieval/output/format.js` (explain payload surfacing)
- `src/index/build/indexer/signatures.js` (incremental signature inputs / cache invalidation)
- `docs/config/schema.json`, `docs/config/contract.md`, `docs/config/inventory.*` (config surface)
- `docs/specs/*` (lexicon + retrieval specs, if promoted to canonical docs)
 - `src/contracts/registry.js` (register lexicon schema if added)
 - `src/contracts/schemas/*` + `src/contracts/validators/*` (lexicon wordlist schema)

### Tasks
- [ ] Decide canonical location for lexicon spec files (recommend `docs/specs/lexicon-*.md`).
- [ ] Add/extend config schema entries for:
  - `indexing.postings.chargramFields`
  - `indexing.postings.chargramStopwords`
  - `retrieval.annCandidateCap`
  - `retrieval.annCandidateMinDocCount`
  - `retrieval.annCandidateMaxDocCount`
  - `retrieval.relationBoost` (if exposed in config; otherwise document as quality-gated internal).
- [ ] Document defaults and quality gating in `docs/config/contract.md` or equivalent.
- [ ] Update config inventory docs after schema changes (keeps script surface tests green).
- [ ] Update build signature inputs to include lexicon + postings config so incremental caches reset:
  - `buildIncrementalSignaturePayload(...)` should include lexicon config (stopword policies) and new postings fields.
  - Consider bumping `SIGNATURE_VERSION` if signature shape changes.
 - [ ] Add an explicit config flag to disable lexicon features globally (`indexing.lexicon.enabled=false`).
 - [ ] Define and document versioning rules for lexicon wordlists and explain schema changes.

### Tests
- [ ] `tests/config/` schema drift tests updated if config schema changes.
- [ ] `tests/indexer/incremental/signature-lexicon-config.test.js` (signature changes when lexicon/postings config changes).
 - [ ] `tests/config/config-inventory-lexicon-keys.test.js` (inventory includes lexicon keys).
 - [ ] `tests/config/config-defaults-lexicon-flags.test.js` (defaults match documented behavior).

---

## 11.9.1 – Language Lexicon Assets and Loader

### Objective
Provide a standardized lexicon for all language registry ids, with a cached loader and derived stopword sets.

### Touchpoints
- New:
  - `src/lang/lexicon/index.js` (public surface)
  - `src/lang/lexicon/load.js` (file loading + caching)
  - `src/lang/lexicon/normalize.js` (lowercase/ASCII normalization)
  - `src/lang/lexicon/wordlists/_generic.json`
  - `src/lang/lexicon/wordlists/<languageId>.json`
  - `docs/specs/language-lexicon-wordlists.md` (if promoted)
  - `docs/schemas/language-lexicon-wordlist.schema.json` (or similar; keep consistent with other schemas)
- Existing registry:
  - `src/index/language-registry/registry-data.js` (language ids)

### Tasks
- [ ] Implement lexicon module:
  - [ ] `getLanguageLexicon(languageId, { allowFallback })` -> returns normalized sets.
  - [ ] `isLexiconStopword(languageId, token, domain)` for `relations|ranking|chargrams`.
  - [ ] `extractSymbolBaseName(name)` shared helper.
  - Must split on `.`, `::`, `->`, `#`, `/` and trim trailing `()`, `;`, `,`.
  - [ ] Expose per-language overrides in the lexicon JSON (e.g., allowlists/exclusions for relations stopwords).
- [ ] Loader behavior:
  - [ ] Use `import.meta.url` to resolve wordlist directory.
  - [ ] Cache in `Map<languageId, LanguageLexicon>`.
  - [ ] Fail-open: missing or invalid => `_generic`.
  - [ ] Emit a single structured warning on invalid lexicon files (no per-token spam).
- [ ] Loader must be deterministic: stable ordering, no locale-sensitive transforms.
- [ ] Add schema validation for each wordlist file.
  - [ ] Register schema in `src/contracts/registry.js` and validate on load.
- [ ] Add lexicon files for each language id in the registry; keep v1 conservative (keywords + literals only).
  - Note: For JS/TS, keep keywords list conservative to avoid filtering property names.

### Tests
- [ ] `tests/lexicon/lexicon-schema.test.js`
- [ ] `tests/lexicon/lexicon-loads-all-languages.test.js`
- [ ] `tests/lexicon/lexicon-stopwords.test.js` (verify derived stopword sets)
- [ ] `tests/lexicon/lexicon-fallback.test.js` (missing/invalid file -> _generic)
- [ ] `tests/lexicon/extract-symbol-base-name.test.js` (separators `.`, `::`, `->`, `#`, `/` and trailing punctuation trimming)
- [ ] `tests/lexicon/lexicon-ascii-only.test.js` (explicit v1 constraint)
 - [ ] `tests/lexicon/lexicon-per-language-overrides.test.js`

---

## 11.9.2 – Build-Time Lexicon-Aware Relation Filtering

### Objective
Filter `rawRelations` before building `file_relations` and `callIndex`, using lexicon stopwords for relations.

### Touchpoints
- `src/index/build/file-processor/cpu.js`
  - Where `rawRelations` is produced and `buildFileRelations(...)` / `buildCallIndex(...)` are called.
- `src/index/build/file-processor/relations.js`
  - `buildFileRelations(rawRelations, relKey)`
  - `buildCallIndex(rawRelations)`
- `src/index/build/file-processor/process-chunks.js`
  - Builds per-chunk `codeRelations` from `callIndex` and writes call details; ensure filtered relations are reflected.
- `src/retrieval/output/filters.js`
  - `--calls` / `--uses` filters consume `codeRelations` and `file_relations`.
- New:
  - `src/index/build/file-processor/lexicon-relations-filter.js`

### Tasks
- [ ] Implement `filterRawRelationsWithLexicon(rawRelations, { languageId, lexicon, config, log })`.
- [ ] Apply filtering immediately before relation building:
  - In `cpu.js` inside the per-file processing flow, right after `lang.buildRelations(...)` and before `buildFileRelations` / `buildCallIndex`.
- [ ] Filtering rules:
  - `usages`: drop tokens whose normalized form is in `lexicon.stopwords.relations`.
  - `calls` / `callDetails` / `callDetailsWithRange`: drop entries if `extractSymbolBaseName(callee)` is a stopword.
  - Preserve stable ordering; dedupe only if required.
- [ ] Fail-open if lexicon missing or disabled.
- [ ] Add a per-language override mechanism (e.g., config to drop keywords/literals/builtins/types separately).
- [ ] Ensure cached bundles are compatible:
  - If cached bundles can bypass filtering, ensure incremental signature invalidation covers lexicon changes.
 - [ ] Make stable ordering a formal contract requirement (document + test).

### Tests
- [ ] `tests/file-processor/lexicon-relations-filter.test.js`
- [ ] `tests/retrieval/uses-and-calls-filters-respect-lexicon.test.js`
- [ ] `tests/file-processor/lexicon-relations-filter-ordering.test.js` (stable ordering)
- [ ] `tests/file-processor/lexicon-relations-filter-keyword-property.test.js` (JS/TS property-name edge case)
- [ ] `tests/file-processor/lexicon-relations-filter-no-imports.test.js` (imports/exports unchanged)
 - [ ] `tests/file-processor/lexicon-relations-filter-determinism.test.js`

---

## 11.9.3 – Retrieval-Time Lexicon-Aware Relation Boosts

### Objective
Add boost-only ranking based on calls/usages aligned with query tokens, excluding lexicon stopwords.

### Touchpoints
- `src/retrieval/pipeline.js` (scoring and explain output)
- `src/retrieval/cli/query-plan.js` (query tokens source)
- New:
  - `src/retrieval/scoring/relation-boost.js`

### Tasks
- [ ] Implement `computeRelationBoost({ chunk, fileRelations, queryTokens, lexicon, config })`.
- [ ] Wire into scoring in `src/retrieval/pipeline.js`:
  - Add `relationBoost` alongside existing boosts (symbol/phrase/etc).
  - Ensure boost-only (no filtering).
  - Provide explain payload when `--explain`.
- [ ] Gate by quality or config (default off).
- [ ] Ensure query token source uses `buildQueryPlan(...)` output (do not recompute).
- [ ] Define case-folding behavior in relation to `caseTokens` and `caseFile`.
 - [ ] Add a small explain schema snippet documenting `relationBoost` fields and units.

### Tests
- [ ] `tests/retrieval/relation-boost.test.js`
- [ ] `tests/retrieval/relation-boost-does-not-filter.test.js`
- [ ] `tests/retrieval/explain-includes-relation-boost.test.js`
- [ ] `tests/retrieval/relation-boost-case-folding.test.js`
- [ ] `tests/retrieval/relation-boost-stopword-elision.test.js`

---

## 11.9.4 – Chargram Enrichment and ANN Candidate Safety

### Objective
Allow optional chargram enrichment without recall loss, and enforce candidate set safety in ANN/minhash.

### Touchpoints
- `src/shared/postings-config.js` (new `chargramFields`, `chargramStopwords`)
- `src/index/build/state.js` (chargram generation from fieldTokens)
- `src/retrieval/pipeline/candidates.js` (candidate set building)
- `src/retrieval/pipeline.js` (ANN/minhash usage)
- New:
  - `src/retrieval/scoring/ann-candidate-policy.js`

### Tasks
- [ ] Extend `normalizePostingsConfig` to support `chargramFields` + `chargramStopwords` with defaults.
- [ ] Update chargram tokenization in `appendChunk(...)` (in `src/index/build/state.js`) to use `chargramFields` and optional lexicon stopword filtering.
- [ ] Implement `resolveAnnCandidateSet(...)` and apply it to ANN and minhash candidate selection:
  - Use `annCandidateCap`, `annCandidateMinDocCount`, `annCandidateMaxDocCount`.
  - Ensure filtersActive + allowedIdx behavior is preserved.
- [ ] Emit explain payload for candidate policy decisions, with deterministic `reason` codes (`noCandidates`, `tooLarge`, `tooSmallNoFilters`, `filtersActiveAllowedIdx`, `ok`).
- [ ] Ensure ANN/minhash use the same candidate policy (no divergence).
 - [ ] Add a shared policy contract for `resolveAnnCandidateSet` and reuse in both paths.

### Tests
- [ ] `tests/postings/chargram-fields.test.js`
- [ ] `tests/retrieval/ann-candidate-policy.test.js`
- [ ] `tests/retrieval/ann-candidate-policy-explain.test.js`
- [ ] `tests/postings/chargram-stopwords.test.js` (lexicon stopword interaction)
- [ ] `tests/retrieval/ann-candidate-policy-minhash-parity.test.js`
- [ ] `tests/retrieval/ann-candidate-policy-allowedIdx.test.js`
 - [ ] `tests/retrieval/ann-candidate-policy-contract.test.js`

---

## 11.9.5 – Observability, Tuning, and Rollout

### Objective
Make filtering/boosting behavior transparent and safe to tune.

### Touchpoints
- `src/index/build/file-processor/cpu.js` (logging/counters)
- `src/retrieval/pipeline.js` (explain payload)
- `src/shared/auto-policy.js` (quality-based defaults)

### Tasks
- [ ] Emit structured per-file counts for relations filtering (calls/usages dropped).
- [ ] Add `relationBoost` + `annCandidatePolicy` to explain output.
- [ ] Gate new features behind `quality=max` by default (unless explicit config enables).
- [ ] Add a compact summary line to build logs when lexicon filtering is active (opt-in via verbose).
 - [ ] Add a “lexicon status” section to explain output when enabled (source file + version).

### Tests
- [ ] `tests/retrieval/explain-includes-relation-boost.test.js`
- [ ] `tests/retrieval/explain-includes-ann-policy.test.js`
- [ ] `tests/indexing/logging/lexicon-filter-counts.test.js` (log line shape, opt-in)

---

## Notes / Implementation Guidelines

- Prefer fail-open behavior for all lexicon-based filtering.
- Keep relation filtering conservative (keywords + literals only) unless explicitly configured per language.
- Preserve ordering; dedupe only with stable, deterministic behavior.
- Avoid new CLI flags unless required; prefer config + quality gating.
- When adding config, update docs/config schema + contract and keep drift tests passing.
- Make sure any new config keys are included in config inventory + env/config precedence docs if referenced.
 - All new lexicon behavior must be disabled by `indexing.lexicon.enabled=false`.

---

## Known Touchpoints (Function Names)

Use these function names to anchor changes:

- `processFiles(...)` in `src/index/build/indexer/steps/process-files.js` (tree-sitter deferral logic already uses ordering helpers).
- `buildFileRelations(...)` and `buildCallIndex(...)` in `src/index/build/file-processor/relations.js`.
- `createSearchPipeline(...)` in `src/retrieval/pipeline.js` (scoring + ANN candidate handling).
- `buildQueryPlan(...)` in `src/retrieval/cli/query-plan.js` (token source).
- `appendChunk(...)` in `src/index/build/state.js` (chargrams from fieldTokens).

---

## Proposed Phase Order

1. 11.9.0 – Setup + contracts (config schema + docs + lexicon schema).
2. 11.9.1 – Lexicon loader + wordlists.
3. 11.9.2 – Build-time relations filtering.
4. 11.9.4 – Chargram enrichment + ANN candidate safety (foundation for retrieval safety).
5. 11.9.3 – Retrieval relation boosts (ranking-only).
6. 11.9.5 – Observability + rollout gating.

---
## Appendix B — HAWKTUI Roadmap (verbatim)

# Roadmap — Rust Ratatui TUI + Node Supervisor

## Phase: Terminal-owned TUI driving repo tooling (Supervisor MVP → shipped binary)

### Objective
Deliver a **standalone Rust Ratatui TUI** that owns the terminal and drives existing Node scripts through a **Node supervisor** with a **strict, versioned JSONL protocol** for tasks/logs/results, including **correct cancellation + process-tree cleanup** across platforms.

### Goals
- A single UI-driven entrypoint that can (at minimum):
  - run core jobs (`setup`, `bootstrap`, `index build`, `search`, and bench harness jobs)
  - display streaming tasks and logs from **nested subprocess trees**
  - cancel jobs safely and predictably
- A formal, versioned JSONL protocol boundary:
  - **Progress** as JSONL events (line-delimited)
  - **Final result** as either a typed terminal event (`job:end` with `result`) or a machine JSON blob on stdout (captured by supervisor)
- Shared, tested line decoding and event parsing logic (no ad‑hoc “split on \n” everywhere)
- Optional compile-on-install with secure prebuilt binary fallback
- No terminal corruption: raw mode restored, child processes terminated on exit

### Non-goals
- Replacing all existing CLI commands immediately
- Making every script “pure JSONL” in all modes (only in explicit `--progress jsonl` / supervisor mode)
- Distributed or remote execution, resumable job queues, or multi-user concurrency
- A full interactive editor for every config file on day one (MVP focuses on robust job-running + visibility)

### Constraints / invariants
- **Rust TUI owns the terminal**: no spawned job may assume it owns the TTY.
- The supervisor must treat all non-protocol output as logs (never “best effort parse random JSON”).
- Cancellation must be **tree-aware**:
  - Windows: `taskkill /T` then escalate to `/F`
  - POSIX: signal the process group (negative PID) when detached
- `--json` outputs must be **stdout-only** (no additional stdout noise); logs and progress go to stderr/protocol.

### Locked decisions (remove ambiguity)
- **Cancel exit code**: tools invoked under the supervisor must exit **130** on user‑initiated cancel (SIGINT/SIGTERM are normalized to 130).
- **Progress protocol**: v2 events must include `proto: "poc.progress@2"` and `event` (allowlist defined in v2 spec).
- **JSONL mode**: when `--progress jsonl`, stderr must emit **only** protocol events (no raw human lines).
- **JSON output**: when `--json`, stdout emits exactly **one** JSON object; stderr carries logs/progress only.
- **Event ordering**: every protocol event includes `ts` (ISO string) and a monotonic `seq` (per-job when `jobId` is present, else per-process).
- **POSIX kill**: if `detached === true`, kill process group (`-pid`); else kill single PID.
- **Job artifacts**: supervisor emits a `job:artifacts` event after `job:end` with a stable artifact list; artifacts include `kind`, `label`, `path`, `exists`, `bytes`, `mtime`, `mime`.
- **Search dispatch**: `bin/pairofcleats.js` must **not** reject valid search flags or backends; it passes all args through to `search.js`.
- **Spec file locations** (new):
  - `docs/specs/tui-tool-contract.md`
  - `docs/specs/progress-protocol-v2.md`
  - `docs/specs/node-supervisor-protocol.md`
  - `docs/specs/dispatcher-rewrite-and-search-reconciliation.md`
  - `docs/specs/supervisor-artifacts-indexing-pass.md`
  - `docs/specs/tui-installation.md`

### Related but out-of-scope specs
- `docs/specs/spimi-spill.md` (indexing perf roadmap; not part of TUI milestone work)

### Implementation order (dependency-aware, cross‑cutting first)
**Foundational work (must land first)**
1) **Sub‑phase 0.2 + 1.1–1.3**: shared kill‑tree, strict protocol v2, shared stream decoder, stdout guard.
2) **Sub‑phase 0.3–0.7**: tool JSONL/JSON hygiene + bench/setup/bootstrap refactors (can proceed in parallel per tool).

**Core runtime**
3) **Sub‑phase 2.1–2.2**: supervisor protocol + implementation.
4) **Sub‑phase 2.3–2.4**: dispatch refactor + artifacts pass (needs protocol + manifest fields defined).

**Product layer**
5) **Sub‑phase 3**: Rust TUI MVP (can start once protocol/manifest shapes are locked; can use mocked supervisor streams).
6) **Sub‑phase 4**: cancellation hardening (depends on supervisor + UI).
7) **Sub‑phase 5**: installation + distribution (can start once crate skeleton exists).

### Parallelization map (non‑overlapping work)
- **Track A (protocol + helpers)**: Sub‑phase 0.2, 1.1–1.3, plus 0.7 stdout guard.
- **Track B (tool hygiene)**: Sub‑phase 0.3–0.6 can be split by tool family:
  - B1: `build_index.js` + `tools/setup/*`
  - B2: bench harness (`tools/bench/language-*`)
  - B3: support tools invoked by setup/bench (`tools/tooling/*`, downloads)
- **Track C (dispatch)**: Sub‑phase 2.3 can proceed in parallel with Track B once protocol shapes are fixed.
- **Track D (supervisor core)**: Sub‑phase 2.2 can proceed in parallel with Track C (needs protocol + kill‑tree only).
- **Track E (Rust TUI)**: Sub‑phase 3 can begin after 2.1 spec + manifest field list are frozen (mock data OK).
- **Track F (install/dist)**: Sub‑phase 5 can begin after 3.1 crate skeleton (no dependency on supervisor runtime).

### Dependency matrix (phase → prerequisites)
| Phase / Sub‑phase | Requires | Notes |
|---|---|---|
| 0.1 TUI tool contract | — | Spec + audit only |
| 0.2 Kill‑tree unify | — | Hard dependency for supervisor + cancellation |
| 0.3 build_index JSONL cleanup | 0.2 (kill‑tree) | For abort correctness |
| 0.4 bench harness cleanup | 0.2 + 1.1/1.3 | Uses shared decoder + kill‑tree |
| 0.5 setup cleanup | 1.1/1.2 | Needs progress context + protocol strictness |
| 0.6 bootstrap cleanup | 1.1/1.2 | Same as setup |
| 0.7 stdout guard | — | Can ship early; used by all |
| 1.1 protocol v2 spec | — | Foundation for 1.2/1.3 |
| 1.2 context propagation | 1.1 | Adds env + display wiring |
| 1.3 progress stream decoder | 1.1 | Used by bench + supervisor |
| 2.1 supervisor protocol spec | 1.1 | Requires v2 protocol definitions |
| 2.2 supervisor implementation | 0.2 + 1.1–1.3 | Needs kill‑tree + decoder |
| 2.3 dispatch refactor | 1.1 | Needs stable manifest fields |
| 2.4 artifacts pass | 2.2 + 2.3 | Uses dispatch registry + job lifecycle |
| 3.1 Rust crate skeleton | — | Can begin early |
| 3.2 supervisor integration | 2.2 | Needs working supervisor |
| 3.3 UI behaviors | 3.1 + 2.3 | Needs manifest fields for palette |
| 4.1–4.3 cancellation hardening | 2.2 + 3.2 | Requires live supervisor + UI |
| 5.1 install + wrapper | 3.1 | Needs crate skeleton |
| 5.2 CI artifacts | 5.1 | Depends on build outputs |

### Cross-cutting constraints (apply to all phases)
- **Protocol strictness**: if a line is not v2 JSONL, it must be wrapped as a `log` event.
- **Line length cap**: enforce a maximum line size (e.g., 1MB) in the shared decoder to prevent memory blowups.
- **Stdout discipline**: any tool that writes JSON to stdout must never run children in `stdio: 'inherit'`.
- **Test determinism**: tests must run without network access unless explicitly mocked.

---

## Sub-phase 0: Preparation — Tooling normalization + kill-tree unification

### Objective
Before introducing the supervisor/TUI, make the existing CLI tools behave **ideally** for a terminal-owned orchestrator:
- deterministic **non-interactive** execution paths
- clean separation of **stdout JSON** vs **stderr logs/progress**
- consistent **progress JSONL** emission (or at least no JSON ambiguity)
- unified, shared **process-tree termination** logic used everywhere (src/tools/tests)

### Why this must come first
The supervisor + TUI cannot be “correct by construction” if:
- tools write JSON summaries to stdout while child installers also write to stdout (breaks parsing)
- cancellation uses multiple incompatible kill-tree implementations
- tools rely on `stdio: 'inherit'` and assume they own the terminal

### 0.0 Current-state inventory (audit targets)
Use this list to remove ambiguity about which tools already emit JSONL progress and which still need cleanup.

**JSONL-clean candidates (verify + keep clean)**
- `tools/build/lmdb-index.js`
- `tools/build/tantivy-index.js`
- `tools/build/sqlite-index.js` (and `tools/build/sqlite/runner.js`)
- `tools/ci/build-artifacts.js`
- `tools/download/extensions.js`

**Mixed emitters (must be cleaned for JSONL mode)**
- `build_index.js` (JSONL + raw stderr writes)
- `tools/bench/language-repos.js` and `tools/bench/language/process.js` (JSONL + raw lines)

**No progress flags yet (must add + normalize)**
- `tools/setup/setup.js`
- `tools/setup/bootstrap.js`
- `tools/tooling/install.js` and `tools/tooling/detect.js` (when invoked by setup/bootstrap)

### 0.0.1 JSON stdout inventory (must audit child stdio)
**Scope**: tools with `--json` (or `--format json`) that **emit JSON to stdout**.  
**Goal**: verify any child process use **never** runs with `stdio: 'inherit'` when JSON is expected.

**JSON stdout + child processes (direct or indirect)**
- `build_index.js` (JSON stdout; **no direct spawn**, but verify any nested runners do not inherit)
- `tools/setup/setup.js` (**child: yes** via `runCommandBase`; defaults to `stdio: 'inherit'` unless JSON)
- `tools/setup/bootstrap.js` (**child: yes** via `runCommand/runCommandOrExit`; uses `stdio: 'inherit'` today)
- `tools/tooling/install.js` (**child: yes** via `spawnSync`, currently uses `stdio: 'inherit'`)
- `tools/triage/context-pack.js` (**child: yes** via `spawnSubprocessSync` → `search.js`)
- `tools/ci/run-suite.js` (**child: yes** via `spawnSubprocess`)
- `tools/reports/combined-summary.js` (**child: yes** via `spawnSubprocessSync`)
- `tools/reports/compare-models.js` (**child: yes** via `spawnSubprocessSync`)
- `tools/reports/report-code-map.js` (**child: yes** via `spawnSync('dot', ...)`)
- `tools/bench/vfs/cold-start-cache.js` (**child: yes** via `spawnSync`)
- `tools/ingest/ctags.js` (**child: yes** via `spawn`)
- `tools/ingest/gtags.js` (**child: yes** via `spawn`)
- `tools/ingest/scip.js` (**child: yes** via `spawn`)
- `tools/bench/language-repos.js` (**child: yes**, indirect via `tools/bench/language/process.js`)
- `tools/bench/language/process.js` (not JSON tool itself, but spawns benchmark jobs and must be JSONL‑safe)

**JSON stdout + no direct child spawn detected**
- `tools/analysis/structural-search.js` (JSON or JSONL via `--format`)
- `tools/analysis/explain-risk.js`
- `tools/eval/run.js`
- `tools/index/validate.js`
- `tools/index/cache-gc.js`
- `tools/index/report-artifacts.js`
- `tools/sqlite/verify-extensions.js`
- `tools/tooling/doctor.js`
- `tools/tooling/detect.js`
- `tools/config/validate.js`
- `tools/config/dump.js`
- `tools/config/reset.js`
- `tools/reports/metrics-dashboard.js`
- `tools/bench/language/cli.js`
- `tools/bench/dict-seg.js`
- `tools/bench/query-generator.js`
- `tools/bench/symbol-resolution-bench.js`
- `tools/bench/map/build-map-memory.js`
- `tools/bench/map/build-map-streaming.js`
- `tools/bench/micro/hash.js`
- `tools/bench/micro/watch.js`
- `tools/bench/micro/extractors.js`
- `tools/bench/micro/tinybench.js`
- `tools/bench/micro/compression.js`
- `tools/bench/micro/run.js`
- `tools/bench/micro/regex.js`
- `tools/bench/vfs/bloom-negative-lookup.js`
- `tools/bench/vfs/cdc-segmentation.js`
- `tools/bench/vfs/coalesce-docs.js`
- `tools/bench/vfs/hash-routing-lookup.js`
- `tools/bench/vfs/io-batching.js`
- `tools/bench/vfs/parallel-manifest-build.js`
- `tools/bench/vfs/partial-lsp-open.js`
- `tools/bench/vfs/merge-runs-heap.js`
- `tools/bench/vfs/token-uri-encode.js`
- `tools/bench/vfs/vfsidx-lookup.js`
- `tools/bench/vfs/segment-hash-cache.js`
- `tools/ingest/lsif.js`

**JSON file writers or pass-through (not stdout)**
- `tools/docs/script-inventory.js` (writes JSON file)
- `tools/docs/repo-inventory.js` (writes JSON file)
- `tools/ci/capability-gate.js` (writes JSON file)
- `tools/mcp/tools/search-args.js` (builds args; no stdout JSON)
- `tools/mcp/tools/handlers/downloads.js` (passes `--json` to verify-extensions)
- `tools/mcp/tools/handlers/artifacts.js` (passes `--json` to cache-gc)
- `tools/api/server.js` / `tools/api/router/search.js` (server/pass-through)

**Action**: for each **child** tool above, enforce piped stdio in JSON modes and add a regression test in Sub‑phase 0.T2/0.T4.

### Tasks

#### 0.1 Define the “TUI-ready tool contract” and audit tool surfaces
- **(Spec)** Add a spec: `docs/specs/tui-tool-contract.md`  
  - Define required behaviors for any tool the TUI will run:
    - Flags: `--progress {off,log,tty,jsonl,auto}`, `--json`, `--non-interactive` (where relevant)
    - Output rules:
      - stdout: **only** final machine output when `--json`
      - stderr: logs/progress (and in JSONL mode, only protocol events)
    - Exit codes:
      - success: 0
      - cancelled: **130** (standardized for all supervisor‑invoked tools)
      - “expected failures” vs “tool bug” (document what is what)
    - Cancellation:
      - tools must respond to SIGINT/SIGTERM by aborting ongoing work, then exiting promptly
      - nested child processes must be terminated as a tree
- **(Code audit)** Inventory the top-level scripts the TUI will drive in Milestone 1 and enumerate required changes:
  - `build_index.js`
  - `tools/bench/language-repos.js` (+ `tools/bench/language/process.js`)
  - `tools/setup/setup.js`
  - `tools/setup/bootstrap.js`
  - “support tools” invoked by the above where `--json` is expected to be consumed:
    - `tools/tooling/install.js`
    - `tools/download/dicts.js`
    - `tools/download/models.js`
    - any script that currently emits JSON on stdout while using `stdio:'inherit'` for child processes
- **(Doc)** Add a short developer note in `docs/` describing:
  - “stdout is for data, stderr is for humans/protocol”
  - where to add new commands to the dispatch registry

#### 0.2 Unify process-tree termination into `src/shared/` and update all call sites
**Problem today**
- `src/shared/subprocess.js` kills Windows trees with immediate `/F`.
- `tests/helpers/kill-tree.js` does a staged graceful→forced kill.
- `tools/bench/language/process.js` has its own reduced kill helper and on POSIX it does **not** kill process groups.

**(Code)** Create a single shared implementation:
  - Add `src/shared/kill-tree.js` exporting:
  - `killProcessTree(pid, opts) -> Promise<{terminated:boolean, forced:boolean, method?:string}>`
  - `killChildProcessTree(child, opts) -> Promise<...>` convenience (accepts `ChildProcess`)
  - Options:
    - `graceMs` (default 2000–5000, consistent with existing defaults)
    - `killSignal` (default `SIGTERM` on POSIX)
    - `forceSignal` (default `SIGKILL` on POSIX)
    - `useProcessGroup` / `detached` behavior (to decide `pid` vs `-pid`)
- Implement semantics:
  - **Windows**
    1) run `taskkill /PID <pid> /T` (no `/F`)
    2) wait `graceMs`
    3) run `taskkill /PID <pid> /T /F`
    4) return `{terminated, forced}`
  - **POSIX**
    1) send `killSignal` to **`-pid` when `useProcessGroup === true`**, else `pid`
    2) wait `graceMs`
    3) if still running, send `forceSignal` to same target
    4) return `{terminated, forced}`
- **(Refactor)** Replace kill logic in `src/shared/subprocess.js`
  - Remove the internal `killProcessTree(child, ...)` function.
  - Import the shared helper and call it on timeout/abort (fire-and-forget is acceptable; correctness is the priority).
  - Preserve current behavior regarding process groups:
    - default `detached=true` on POSIX
    - when `killTree !== false` and `detached===true`, use `useProcessGroup=true`
- **(Refactor)** Update all call sites that currently use either implementation:

  **Call sites to update (with current locations)**
  - `src/shared/subprocess.js`  
    - internal kill-tree function at/near line ~103; invoked on timeout/abort at/near lines ~268 and ~284.
  - `tests/helpers/kill-tree.js`  
    - staged kill-tree implementation; replace with a re-export from `src/shared/kill-tree.js` or delete and update imports.
    - `tests/runner/run-execution.js`  
      - imports `../helpers/kill-tree.js` and calls it during timeout (at/near line ~105).
  - `tools/bench/language/process.js`  
    - local `killProcessTree(pid)` (at/near line ~29); replace with shared helper and ensure POSIX uses process groups.
    - `tools/bench/language-repos.js`  
      - SIGINT/SIGTERM handlers call `processRunner.killProcessTree(active.pid)` (at/near lines ~236 and ~246); ensure this uses the shared helper.

- **(Doc)** Update any docs that describe kill semantics to reference the new shared module:
  - `docs/specs/subprocess-helper.md`
  - `docs/testing/test-runner-interface.md`
  - `docs/language/benchmarks.md`

**Primary touchpoints**
- `src/shared/kill-tree.js` (new)
- `src/shared/subprocess.js` (refactor)
- `tests/helpers/kill-tree.js` → re-export or delete
- `tests/runner/run-execution.js`
- `tools/bench/language/process.js`
- `tools/bench/language-repos.js`

#### 0.3 Refactor `build_index.js` for “clean JSONL” and stable final output
**Current issues**
- `build_index.js` uses `createDisplay(... progressMode: argv.progress ...)` (good), but also writes human summary lines directly to stderr after closing display (`DONE_LABEL`, detail lines).
- In `--progress jsonl`, those direct writes become “stray non-protocol lines” (the supervisor can wrap them, but this is not ideal).

**(Code)** Changes in `build_index.js`
- Add a single “output mode resolver”:
  - if `argv.progress === 'jsonl'`: **no raw stderr writes**; everything goes through `display.*` or protocol events.
  - if `argv.json === true`: stdout emits a single JSON summary object (see contract), stderr emits logs/progress only.
- Replace the post-close `writeLine()` summary behavior:
  - In JSONL mode:
    - emit a **`job:end`** protocol event with `result.summary` (no raw stderr lines).
  - In human/TTY mode:
    - keep the colored DONE banner.
- Ensure cancellation semantics are stable:
  - SIGINT/SIGTERM should set abort signal (already does)
  - on abort, exit **130** and emit a final `job:end` with `status:"cancelled"`

**Primary touchpoints**
- `build_index.js`
- `src/shared/cli/display.js`
- `src/shared/cli/progress-events.js`

#### 0.4 Refactor bench harness for TUI compatibility (`tools/bench/language-repos.js`)
**Current issues**
- Cancellation path uses the bench runner’s local kill helper which is not process-group aware on POSIX.
- The runner parses progress events using the current `parseProgressEventLine(line)` without a strict protocol marker.
- End-of-run `console.error(...)` summaries may still print even when in JSONL mode (should route via display or be gated).

**(Code)** Changes in:
- `tools/bench/language/process.js`
  - Replace chunk→line logic with shared `progress-stream` module once introduced (or implement a minimal shared decoder now).
  - Replace local kill-tree with `src/shared/kill-tree.js`.
  - Ensure parse rule becomes: **progress JSONL or wrap as log**.
- `tools/bench/language-repos.js`
  - Gate any raw `console.error` emissions when `argv.progress === 'jsonl'`:
    - replace with `display.log/error` so they are protocol events only
- Ensure JSON output (`--json`) remains stdout‑only and contains no interleaved junk.

**Primary touchpoints**
- `tools/bench/language-repos.js`
- `tools/bench/language/process.js`
- `src/shared/cli/progress-stream.js`

#### 0.5 Refactor `tools/setup/setup.js` to be “supervisor-friendly”
**Current issues**
- In `--json` mode, it tends to run child commands with `stdio:'pipe'`, which hides streaming progress.
- In non-JSON mode it uses `stdio:'inherit'`, which is incompatible with the “stdout-only JSON” contract if we want both streaming logs and a JSON summary.
- It uses a sync-ish command runner (`tools/cli-utils.js`) rather than a streaming runner.

**(Code)** Changes in `tools/setup/setup.js`
- Add `--progress`, `--verbose`, `--quiet` flags (mirror other tools).
- Create a `display = createDisplay({ progressMode: argv.progress, ... })` (stderr).
- Replace `log()/warn()` to route through `display.log/warn/error`.
- Refactor command execution to preserve stdout-only JSON:
  - Run child commands with `stdio: ['ignore','pipe','pipe']`.
  - Stream child stdout/stderr into `display` (so the user sees progress/logs in TUI).
  - Capture child stdout only when we explicitly need to parse it (e.g., `tooling-detect --json`).
- Ensure all child node tools are invoked with `--progress jsonl` when the parent is in JSONL mode (propagate progress mode).

**(Optional but ideal)** Split setup into:
- `setup --plan --json` (no side effects; returns structured plan)
- `setup --apply --json` (executes selected steps)
This enables the TUI to present/edit the plan before applying.

#### 0.6 Refactor `tools/setup/bootstrap.js` similarly
- Add `--progress`, `--json`, and ensure:
  - stdout JSON (if requested) is clean
  - child command outputs do not leak to stdout
  - progress is emitted as JSONL when requested
- Replace `stdio:'inherit'` child runs with pipe+forwarding (same reasoning as setup).

**Primary touchpoints**
- `tools/setup/setup.js`
- `tools/setup/bootstrap.js`
- `tools/tooling/install.js`
- `tools/tooling/detect.js`

#### 0.7 Normalize log routing and output safety across toolchain
- **(Code)** Ensure all tools invoked by setup/bootstrap (tooling install/detect, downloads) use:
  - `createDisplay()` for logs/progress
  - `--progress jsonl` pass-through
  - stderr-only output in JSONL mode
- **(Code)** Add a small helper to enforce “stdout is data”:
  - e.g., `src/shared/cli/stdout-guard.js` with a `withJsonStdoutGuard(fn)` wrapper
  - fail fast if any non-JSON bytes are written to stdout in `--json` mode

---

### Testing

#### 0.T1 Unit tests: kill-tree behavior (shared helper)
- **New test file(s)** (Node):
  - `tests/shared/kill-tree.posix.test.js` (skipped on win32)
  - `tests/shared/kill-tree.windows.test.js` (skipped on non-win32)
- **What to test**
  - POSIX: spawn a detached process group that ignores SIGTERM for a short interval, assert:
    - first SIGTERM sent, then SIGKILL after grace
    - return `{terminated:true, forced:true}`
  - Windows: spawn a child that spawns a grandchild, assert:
    - `taskkill /T` terminates tree (or `/F` after grace)
    - return values match reality (best-effort; Windows is inherently variable)
- **Pass criteria**
  - Tests do not leak orphan processes after completion.
  - Helper returns consistent termination metadata across platforms.

#### 0.T2 Tool contract tests (stdout/stderr discipline)
- **New integration tests**
  - `tests/tools/setup-json-output.test.js`
  - `tests/tools/bootstrap-json-output.test.js`
- **What to test**
  - Run each tool with `--json --non-interactive --progress jsonl` (or equivalent):
    - Assert stdout parses as a **single JSON document** (no extra lines).
    - Assert stderr is either:
      - valid JSONL protocol lines only (once protocol v2 lands), or
      - at minimum does not contain stdout JSON fragments.
- **Pass criteria**
  - Machine output is stable and parseable.
  - Progress/log output is streamable and does not corrupt stdout.

#### 0.T3 Bench harness cancellation regression
- **Test**: run a fixture bench job that spawns a long-lived child; send SIGTERM to parent; ensure tree terminates.
- **Pass criteria**
  - Bench script exits with the configured “cancelled” exit code.
  - No leftover child processes remain.

#### 0.T4 Tool stdout/stderr separation guards
- Add regression tests for setup/bootstrap/build_index in `--json` mode:
  - ensure stdout is a single JSON object
  - ensure stderr contains logs/progress only

---

## Sub-phase 1: Formalize progress protocol + shared parsing (strict boundary)

### Objective
Turn the existing “parse JSON else treat as log” convention into a **strict, versioned protocol** that:
- never misclassifies random JSON as a progress event
- carries enough context for supervision (jobId/runId)
- is reusable across Node scripts and the Rust TUI

### Tasks

#### 1.1 Progress protocol v2 (spec + enforcement)
- **(Spec)** Add `docs/specs/progress-protocol-v2.md`
  - Require:
    - `proto: "poc.progress@2"`
    - event allowlist (at minimum): `task:start`, `task:progress`, `task:end`, `log`, plus `job:*` events for supervisor (including `job:artifacts`)
    - field requirements per event type
    - rule: *one JSON object per line; no multi-line JSON in protocol stream*
  - Define how job/task identity is represented:
    - `jobId` (required for any event emitted under supervisor)
    - `runId` (optional but recommended for end-to-end correlation)
    - `taskId` uniqueness within a job
  - Define required fields per event type (minimum):
    - `log`: `level`, `message`, `stream`, `ts`, `seq`, `jobId?`, `taskId?`
    - `task:start`: `taskId`, `name`, `stage`, `ts`, `seq`, `jobId`
    - `task:progress`: `taskId`, `current`, `total`, `unit?`, `percent?`, `ts`, `seq`, `jobId`
    - `task:end`: `taskId`, `status`, `durationMs?`, `error?`, `ts`, `seq`, `jobId`
    - `job:start`: `jobId`, `command`, `args`, `cwd`, `ts`, `seq`
    - `job:end`: `jobId`, `status`, `exitCode`, `durationMs`, `result?`, `ts`, `seq`
    - `job:artifacts`: `jobId`, `artifacts[]`, `ts`, `seq`
  - Require `seq` monotonicity **per job** (if `jobId` exists) to allow stable ordering in TUI.
- **(Spec examples)** include concrete JSONL examples for each event type:
  - `log`:
    - `{"proto":"poc.progress@2","event":"log","ts":"2026-02-04T12:00:00.000Z","seq":42,"level":"info","stream":"stderr","message":"indexing started","jobId":"job-1"}`
  - `task:start`:
    - `{"proto":"poc.progress@2","event":"task:start","ts":"2026-02-04T12:00:00.010Z","seq":1,"jobId":"job-1","taskId":"code:scan","name":"Scanning code","stage":"code"}`
  - `task:progress`:
    - `{"proto":"poc.progress@2","event":"task:progress","ts":"2026-02-04T12:00:00.120Z","seq":2,"jobId":"job-1","taskId":"code:scan","current":24,"total":120,"unit":"files","percent":20}`
  - `task:end`:
    - `{"proto":"poc.progress@2","event":"task:end","ts":"2026-02-04T12:00:01.200Z","seq":3,"jobId":"job-1","taskId":"code:scan","status":"ok","durationMs":1190}`
  - `job:start`:
    - `{"proto":"poc.progress@2","event":"job:start","ts":"2026-02-04T12:00:00.000Z","seq":0,"jobId":"job-1","command":"build_index","args":["--progress","jsonl"],"cwd":"C:/repo"}`
  - `job:end`:
    - `{"proto":"poc.progress@2","event":"job:end","ts":"2026-02-04T12:00:10.000Z","seq":500,"jobId":"job-1","status":"ok","exitCode":0,"durationMs":10000,"result":{"summary":{"chunks":120}}}`
  - `job:artifacts`:
    - `{"proto":"poc.progress@2","event":"job:artifacts","ts":"2026-02-04T12:00:10.010Z","seq":501,"jobId":"job-1","artifacts":[{"kind":"index","label":"sqlite","path":"...","exists":true,"bytes":12345,"mtime":"2026-02-04T12:00:09.000Z","mime":"application/x-sqlite3"}]}`
- **(Code)** `src/shared/cli/progress-events.js`
  - `formatProgressEvent(eventName, payload, { context })`:
    - inject `proto`, `ts`, `seq`, and context fields (jobId/runId)
  - `parseProgressEventLine(line, { strict })`:
    - strict mode requires `proto` + allowlisted `event`
    - non-strict mode may be retained for backward compatibility, but must never accept arbitrary JSON
  - **Touchpoints for `seq` + `ts` fields**:
    - `src/shared/cli/progress-events.js` (default `ts`, increment `seq`)
    - `src/shared/cli/display.js` (when emitting `task:*` + `log` events)
    - `src/shared/cli/progress-stream.js` (when wrapping non‑protocol lines into `log`)
    - `tools/tui/supervisor.js` (inject `seq` for job events + wrapped logs)
    - `tools/bench/language/process.js` (decoder wrapper emits `log` events)
    - `tools/bench/language-repos.js` (direct `display` calls should not bypass `seq`)

#### 1.2 Context propagation (jobId/runId injection)
- **(Code)** `src/shared/cli/display.js`
  - Add a `context` option (object) and/or env-based context:
    - read `PAIROFCLEATS_PROGRESS_CONTEXT` (JSON string) once at init
  - Ensure `writeProgressEvent(...)` always includes merged context in JSONL mode
- **(Code)** Document how tools should set context:
  - Supervisor sets env var for children
  - Tools that spawn children should forward env var
- **(Code)** Add `PAIROFCLEATS_PROGRESS_CONTEXT` to `src/shared/env.js` allowlist
- **(Doc)** Document `PAIROFCLEATS_PROGRESS_CONTEXT` in `docs/config/contract.md` (env var surface)

#### 1.3 Shared stream decoder: “chunks → lines → event-or-log”
- **(Code)** Add `src/shared/cli/progress-stream.js`
  - Provide a small library that:
    - accepts chunks from stdout/stderr
    - normalizes CRLF/CR to LF
    - preserves partial-line carry buffers per stream
    - for each completed line:
      - try `parseProgressEventLine(line, { strict:true })`
      - else emit a `log` event wrapper (include original stream and jobId)
    - enforces `maxLineBytes` (default 1MB) and emits a `log` event when truncation occurs
- **(Refactor)** Replace duplicated logic:
  - Update `tools/bench/language/process.js` to use it
  - Supervisor will use it for all spawned jobs
  - (Optional) any other tool that decodes child output should use it

### Testing

#### 1.T1 Strict parser unit tests
- **Test cases**
  - Accept valid v2 event lines
  - Reject:
    - JSON without `proto`
    - JSON with unknown `proto`
    - JSON with unknown `.event`
    - invalid JSON
- **Pass criteria**
  - No false positives: a line like `{"ok":true}` must never become a progress event.

#### 1.T2 Stream decoder tests (chunk boundary correctness)
- **Test cases**
  - JSON split across two chunks → reconstructed correctly
  - CR-only outputs (some Windows tools) → normalized correctly
  - Interleaved stdout/stderr with partial lines → no cross-stream corruption
- **Pass criteria**
  - Every emitted object is a valid v2 protocol event.
  - No dropped characters; no duplicated lines.

#### 1.T3 Tool “clean JSONL” regression tests
- Run `build_index.js --progress jsonl ...` and `node tools/bench/language-repos.js --progress jsonl ...` in a fixture mode:
  - stderr must be all valid v2 JSONL events (once upgraded)
- Pass criteria:
  - no stray human lines in JSONL mode

#### 1.T4 Decoder line-size cap test
- Emit a single line larger than maxLineBytes and assert:
  - decoder truncates safely
  - emits a `log` event indicating truncation

#### 1.T5 Context propagation test
- Set `PAIROFCLEATS_PROGRESS_CONTEXT={"jobId":"j1","runId":"r1"}` and emit a JSONL event.
- Assert every emitted event includes the merged `jobId`/`runId`.

---

## Sub-phase 2: Node supervisor MVP (Rust TUI ↔ Node boundary)

### Objective
Implement a standalone Node supervisor that:
- accepts JSONL **requests** on stdin
- emits strict protocol **events** on stdout
- spawns/supervises repo scripts reliably, including cancellation

### Tasks

#### 2.1 Supervisor protocol (spec)
- **(Spec)** Add `docs/specs/node-supervisor-protocol.md`
  - Request ops (minimum):
    - `hello` / handshake
    - `job:run` (includes command, args, cwd, env, capture strategy)
    - `job:cancel`
    - `shutdown`
  - Event types:
    - `supervisor:hello`
    - `job:start`, `job:spawn`, `job:end`
    - passthrough progress `task:*` and `log`
  - `supervisor:hello` payload must include:
    - `protoVersion` (exact string, e.g., `poc.supervisor@1`)
    - `progressProto` (e.g., `poc.progress@2`)
    - `pid`, `platform`, `cwd`
    - `versions` (node, app version, optional git sha)
    - `capabilities` (supported commands + optional feature flags)
  - Define timeouts + escalation:
    - cancel → graceful wait → forced kill → `job:end status="cancelled"`

#### 2.2 Implementation: `tools/tui/supervisor.js`
- **Job table + lifecycle**
  - Maintain `Map<jobId, JobState>` with:
    - `abortController`
    - `childPid`, `spawnedAt`, `status`
    - bounded stdout capture buffer for “final JSON” parsing
  - Track per-job `seq` counters for ordering (used by progress events).
- **Limits & safety**
  - max stdout capture bytes (default 1MB)
  - max line size for decoder (shared `progress-stream` limit)
  - per-job log ring buffer size (e.g., 5k lines) for UI performance
- **Spawn strategy**
  - Use `spawnSubprocess()` with:
    - `stdio: ['ignore','pipe','pipe']`
    - `detached:true` on POSIX so we can kill process groups
    - `signal` wired to job abort controller
- **Output normalization**
  - For each stdout/stderr chunk:
    - run shared `progress-stream` decoder
    - emit only v2 protocol events to stdout
  - Ensure wrapped `log` events include `seq` and `stream` (`stdout`/`stderr`).
- **Context propagation**
  - Set `PAIROFCLEATS_PROGRESS_CONTEXT={"jobId":..., "runId":...}` in child env
  - Include `capabilities` in `supervisor:hello` by reading shared dispatch manifest.
- **Result capture**
  - Option A (simplest): if `job:run.captureStdoutAs=="json"`, buffer stdout and JSON.parse at end
  - Option B: always buffer up to N bytes and attempt parse if it looks like JSON
  - If JSON parse fails, emit `job:end` with `error` and include truncated stdout in `result.rawStdout` (bounded).
- **Robust shutdown**
  - On supervisor stdin close:
    - cancel all running jobs
    - wait bounded time
    - force-exit if necessary

**Supervisor failure modes (explicit handling)**
- child spawn fails → emit `job:end status="failed"` with `error.code="spawn_failed"`.
- child exits before `job:spawn` → still emit `job:end` with exitCode.
- malformed JSON from child → wrap as `log` event, do not crash supervisor.
- internal supervisor exception → emit `log level=error`, exit non-zero.

**Primary touchpoints**
- `tools/tui/supervisor.js` (new)
- `src/shared/subprocess.js` (spawn + abort wiring)
- `src/shared/kill-tree.js` (tree kill helper)
- `src/shared/cli/progress-stream.js` (line decoding)
- `src/shared/cli/progress-events.js` (strict parsing)
- `src/shared/cli/display.js` (context merge)

#### 2.3 Refactor dispatcher/env logic out of `bin/pairofcleats.js`
- **Why**: the supervisor must run the same jobs as the CLI entrypoint without drift, and search flags must not be blocked by dispatcher allowlists.
- **(Spec)** Follow `docs/specs/dispatcher-rewrite-and-search-reconciliation.md`.

**2.3.1 Immediate reconciliation (search flags)**
- **(Code)** In `bin/pairofcleats.js`:
  - remove `validateArgs(...)` from the `search` command handler
  - remove the manual backend allowlist (currently rejects `sqlite-fts`, `tantivy`, `memory`, `-n`)
  - pass all `rest` args through to `search.js` unchanged
- **(Tests)** Add a new integration test:
  - `node bin/pairofcleats.js search --help --backend tantivy` → exit 0
  - `node bin/pairofcleats.js search --help -n 10` → exit 0

**2.3.2 Shared dispatcher module**
- **(Code)** Create `src/shared/dispatch/`:
  - `registry.js` (command catalog + descriptions + expected outputs + artifact kinds)
  - `resolve.js` (argv → command resolution)
  - `env.js` (spawn env resolution; keep build_index runtime-envelope special case)
  - `manifest.js` (exports JSON manifest for the TUI)
- **(Code)** Update:
  - `bin/pairofcleats.js` to use shared dispatch
  - `tools/tui/supervisor.js` to use shared dispatch
- **(Code)** Update search option source-of-truth:
  - `src/retrieval/cli-args.js` should explicitly define the full search option surface (used by manifest + strict mode)
  - backend enum pulled from `src/storage/backend-policy.js`

**2.3.3 Manifest surface for TUI**
- Add new commands:
  - `pairofcleats dispatch list --json`
  - `pairofcleats dispatch describe <command> --json`
- Ensure `dispatch describe search` includes:
  - backend enum values: `auto`, `sqlite`, `sqlite-fts` (`fts`), `lmdb`, `tantivy`, `memory`
  - full search flag surface grouped for UI (see spec)
- Ensure each command description includes:
  - `supportsProgress` (jsonl/tty/log/off)
  - `supportsJson` and `supportsNonInteractive`
  - `artifacts` list (expected kinds + labels for preview)
  - `defaultArgs` (safe defaults for UI run palette)
- **Touchpoints for capability fields**
  - `src/shared/dispatch/registry.js` (single source of truth for `supports*`, `defaultArgs`, `artifacts`)
  - `src/shared/dispatch/manifest.js` (ensure fields are serialized)
  - `bin/pairofcleats.js` (dispatch describe uses shared manifest)
  - `tools/tui/supervisor.js` (`supervisor:hello` includes manifest summary)
  - `crates/pairofcleats-tui/` (run palette reads `supports*`, `defaultArgs`)
- **(Tests)** Add:
  - `tests/dispatch/manifest-list.test.js`
  - `tests/dispatch/manifest-describe-search.test.js`

**2.3.4 Optional strict mode (CI/hardening)**
- Add `PAIROFCLEATS_DISPATCH_STRICT=1` (or `--strict`) to enforce unknown-flag detection **only** when requested.
- In strict mode:
  - validate against the registry’s option list
  - for search, rely on the explicit option definitions in `src/retrieval/cli-args.js`

#### 2.4 Supervisor artifacts indexing pass (post-job)
- **(Spec)** Follow `docs/specs/supervisor-artifacts-indexing-pass.md`.
- **(Code)** Add a supervisor-side artifacts pass:
  - emit `job:artifacts` **after** `job:end`
  - artifact record shape:
    - `kind`, `label`, `path`, `exists`, `bytes`, `mtime`, `mime`
  - enforce performance budgets (no unbounded directory recursion)
  - only stat known paths; never glob the repo root
- **(Code)** Implement job-specific extractors:
  - `build_index.js` (index dirs, build_state.json, crash logs, sqlite/lmdb/tantivy outputs)
  - `search.js` (metrics dir + files from `recordSearchArtifacts()`)
  - `tools/setup/setup.js` (config file, dict/model/extension dirs)
  - `tools/bench/language-repos.js` (bench results dir + report JSON)
- **(Code)** Centralize extractor mapping in the dispatch registry so the TUI can preview artifacts before running.
- **(Code)** Add a `--artifacts json` option to supervisor for dump-only mode (used by tests).

### Testing

#### 2.T1 Supervisor stream discipline integration test
- Start supervisor, run a fixture job that emits:
  - progress JSONL events
  - plain log lines
  - non-protocol JSON
- Assert supervisor stdout:
  - is **only** JSONL v2 events
  - includes `jobId` on every event

#### 2.T2 Cancellation integration test (tree kill)
- Fixture job spawns a child + grandchild and sleeps.
- Send `job:cancel`.
- Assert:
  - `job:end` emitted exactly once
  - status is `cancelled`
  - processes terminate within bounded time

#### 2.T3 Env parity test vs CLI dispatcher
- For representative commands (index build, setup, bootstrap):
  - ensure supervisor resolves same script + env variables as `bin/pairofcleats.js`
- Pass criteria:
  - no “works in CLI but not in TUI” divergence

#### 2.T4 Artifacts pass smoke tests
- Run a small `build_index.js` and `search.js` via supervisor:
  - assert `job:artifacts` emitted
  - assert artifact list includes expected paths (index dirs, metrics files)
- Pass criteria:
  - artifacts are stable and do not require scanning the entire repo

#### 2.T5 Dispatch manifest tests
- `pairofcleats dispatch list --json` returns a stable command catalog.
- `pairofcleats dispatch describe search --json` includes backend enum + flag groups.

#### 2.T6 Search flag passthrough test
- `node bin/pairofcleats.js search --help --backend tantivy` exits 0
- `node bin/pairofcleats.js search --help -n 10` exits 0

---

## Sub-phase 3: Rust Ratatui TUI skeleton (terminal ownership + job UI)

### Objective
Create the Rust TUI that owns the terminal, talks to the supervisor, and renders:
- job list + job detail
- task table (taskId/name/current/total/status)
- log view (per job)

### Tasks

#### 3.1 Rust crate and core architecture
- Add `crates/pairofcleats-tui/`:
  - `ratatui`, `crossterm`, `tokio`, `serde`, `serde_json`, `anyhow`
- Add a workspace root `Cargo.toml` if one does not exist.
- Module layout (suggested):
  - `protocol/` (JSONL decoding + strongly typed events)
  - `supervisor/` (process spawn, request writer, event reader)
  - `model/` (jobs/tasks/log buffers)
  - `ui/` (widgets, layout)
  - `app.rs` (event loop)
- Command palette should be sourced from the supervisor `capabilities` + dispatch manifest (no hard-coded command lists in Rust).

#### 3.2 Supervisor integration
- Spawn `node tools/tui/supervisor.js` with piped stdin/stdout
- Perform `hello` handshake and validate protocol version
- Create:
  - async reader task: decode lines → events → channel
  - async writer: send requests for run/cancel/shutdown
- Ensure supervisor is restarted safely if it exits unexpectedly:
   - mark all running jobs failed
   - surface a clear UI error

#### 3.3 UI behaviors (MVP)
- Views:
  - Left: job list (status, start time, duration)
  - Right top: tasks (sorted by stage + recent updates)
  - Right bottom: logs (ring buffer, tailing)
  - Optional panel: artifacts list for the selected job (paths + sizes)
- UI model rules:
  - job list ordered by most recent activity
  - tasks grouped by `stage` then `name`
  - logs capped to N lines per job (configurable)
- Keybindings (minimum):
  - `r`: open “run command” palette (choose setup/index/search/bootstrap)
  - `c`: cancel selected job
  - `q`: quit (cancel all jobs, shutdown supervisor)
  - `?`: toggle help overlay (keybindings + status legend)
- Ensure TUI never relies on subprocess TTY:
  - always run jobs with piped stdio via supervisor

### Testing

#### 3.T1 Protocol decoding tests (Rust)
- Feed recorded JSONL streams into decoder:
  - job lifecycle + task updates + logs
- Assert model updates:
  - tasks created/updated/ended correctly
  - logs appended with correct job association

#### 3.T2 Headless smoke test
- Run TUI in a “headless” mode (no raw mode / no alternate screen) that:
  - starts supervisor
  - sends hello
  - sends shutdown
- Pass criteria:
  - exits 0
  - no panics
  - supervisor process does not remain running

#### 3.T3 Cancel path integration (Rust + supervisor)
- Start a long-running fixture job
- Issue cancel
- Assert model receives `job:end status=cancelled`

---

## Sub-phase 4: Cancellation hardening + cleanup correctness (end-to-end)

### Objective
Make cancellation robust under real-world failure modes:
- subprocesses that ignore SIGTERM
- children that spawn grandchildren
- supervisor shutdown while jobs are running
- UI crash/quit paths

### Tasks

#### 4.1 Supervisor escalation policies
- Ensure cancel logic uses shared kill-tree semantics (Sub-phase 0) and:
  - applies a bounded grace period
  - escalates to forced kill
  - emits clear termination metadata on `job:end`

#### 4.2 UI shutdown correctness
- On `q`:
  - cancel all running jobs
  - wait bounded time for `job:end` events
  - send supervisor shutdown
  - restore terminal state even if errors occur
- On `Ctrl+C`:
  - first press → cancel active job (or all jobs if none selected)
  - second press within grace window → force-exit (after restoring terminal)

#### 4.3 “Never hang” guarantees
- Add watchdog timeouts:
  - if supervisor does not respond, TUI exits after restoring terminal
  - if a job does not end after forced kill, mark failed and continue
- Add a hard cap on supervisor shutdown time (e.g., 10s total)

### Testing

#### 4.T1 “ignore SIGTERM” fixture
- Fixture job traps SIGTERM and sleeps
- Cancel job
- Assert:
  - forced kill occurs
  - job ends

#### 4.T2 “UI dies mid-job” fixture
- Simulate abrupt TUI termination (panic in test mode) and ensure:
  - supervisor is terminated by OS process tree rules or explicit cleanup handler
  - no orphan jobs remain (best-effort; document platform caveats)

---

## Sub-phase 5: Install/distribution (compile-on-install + prebuilt fallback)

### Objective
Make `pairofcleats-tui` easy to run after `npm install`, with secure fallback mechanisms:
- optional compile-on-install for developers
- prebuilt binaries for everyone else
- wrapper that provides clear instructions when binary is missing

### Tasks

#### 5.1 Installer + wrapper
- Implement `tools/tui/install.js` (see `docs/specs/tui-installation.md`)
  - opt-in compile: `PAIROFCLEATS_TUI_BUILD=1` or `npm_config_build_from_source=true`
  - allow opt-out: `PAIROFCLEATS_TUI_DISABLE=1`
  - optional profile: `PAIROFCLEATS_TUI_PROFILE=release|debug`
  - else download prebuilt for `{platform, arch}` and verify sha256
  - write `bin/native/manifest.json` describing installed binary and method
  - follow the same extraction safety limits as `tools/download/extensions.js`
- Implement `bin/pairofcleats-tui.js`
  - resolve `bin/native/pairofcleats-tui[.exe]`
  - exec it with args (inherit stdio)
  - if missing, print concise guidance:
    - re-run install with `PAIROFCLEATS_TUI_BUILD=1`
    - download prebuilt
    - fallback to `pairofcleats` Node CLI
- (Optional) add `tools/tui/download.js` to download prebuilt binaries explicitly
- Update `package.json`:
  - `bin.pairofcleats-tui`
  - `scripts.postinstall = "node tools/tui/install.js"`
- **Config surface (if downloads are configurable)**:
  - extend `.pairofcleats.json` with `tui.install.*` keys
  - document in `docs/config/schema.json` + `docs/config/contract.md`
- **Docs**
  - add `pairofcleats-tui` to `docs/guides/commands.md`
  - add a short `docs/guides/tui.md` with install + troubleshooting

**Primary touchpoints**
- `bin/pairofcleats-tui.js`
- `tools/tui/install.js`
- `package.json`
- `docs/specs/tui-installation.md`

#### 5.2 CI pipeline for artifacts
- Build for supported targets (at minimum: win32-x64, linux-x64, darwin-x64/arm64 if supported)
- Upload:
  - binaries
  - sha256 sums
  - manifest
- Ensure version aligns with `package.json` and `bin/native/manifest.json`

### Testing

#### 5.T1 Installer unit tests
- Simulate:
  - cargo present → build succeeds
  - cargo missing → download path taken
  - download sha mismatch → installer aborts with clear message
  - network unavailable → installer does not fail npm install
  - `PAIROFCLEATS_TUI_DISABLE=1` → installer no-ops cleanly
- Pass criteria:
  - correct binary selection and verified install metadata

#### 5.T2 Wrapper behavior tests
- If manifest exists → wrapper execs binary
- If missing → wrapper prints instructions and exits non-zero (or falls back to Node CLI if desired)

---

## Milestone 1 “Done” definition (updated)
Milestone 1 is complete when:

1) **Preparation complete**
- `build_index.js`, `tools/setup/setup.js`, `tools/setup/bootstrap.js`, and `tools/bench/language-repos.js` obey the “TUI tool contract”:
  - `--json` produces clean stdout JSON only
  - `--progress jsonl` produces protocol-safe stderr output (no stray lines)
- A unified `src/shared/kill-tree.js` exists and all call sites use it.

2) **Protocol + supervisor**
- Supervisor emits strict JSONL and can run at least:
  - `node tools/setup/setup.js --non-interactive --json --progress jsonl`
  - `node build_index.js --progress jsonl`
- Cancellation works and is covered by an integration test.
- Supervisor emits `job:artifacts` for completed jobs.
- `pairofcleats search` accepts all supported flags (no dispatcher allowlist).

3) **Rust TUI**
- TUI:
  - starts supervisor
  - runs a job
  - renders tasks + logs
  - cancels a job
  - exits without corrupting terminal state
