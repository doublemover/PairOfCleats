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
