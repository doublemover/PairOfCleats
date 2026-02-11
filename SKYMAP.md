# SKYMAP

## Purpose
This document defines the recommended execution order for FUTUREROADMAP work so phases land in a dependency-safe sequence with minimal rework.

## Scope normalization
- Canonical execution phases are:
  - Phase 14
  - Phase 15
  - Phase 16
  - Phase 17
  - Phase 18
  - Phase 19
  - Phase 20
- New cross-cutting engine tracks added by SKYMAP:
  - Track IQ: Retrieval quality and intelligence loop
  - Track OP: Performance, throughput, and reliability/SLO enforcement
- `Phase 14 Augmentations` is treated as the authoritative breakdown for Phase 14.
- `WHAT IF WE DIDNT NEED SHOES` (Subphases A-E) is an optional acceleration track.
- Appendix content (`LEXI`, `HAWKTUI`, old Phase 1-6) is historical/reference material and should not be executed as separate roadmap streams.

## Phase goals (why each exists)
- Phase 14: snapshot + diff primitives (`as-of` querying, deterministic change artifacts).
- Phase 15: multi-repo federation (workspace identity, manifests, gated federated search, cache model).
- Phase 16: document ingestion + prose routing correctness (PDF/DOCX extraction, chunking, FTS-safe routing).
- Phase 17: vector-only profile (build/search contract without sparse artifacts).
- Phase 18: distribution/platform hardening (release matrix, path safety, packaging, optional Python behavior).
- Phase 19: lexicon-aware indexing/retrieval enrichment (relation filtering, boosts, chargram/ANN safety).
- Phase 20: terminal-owned TUI + supervisor architecture (protocol v2, orchestration, cancellation guarantees).
- Track IQ: intent-aware retrieval, multi-hop expansion, trust/confidence, and bundle-style result assembly.
- Track OP: deterministic SLOs, failure injection, adaptive performance policies, and release blocking reliability gates.

## Recommended execution order

### Wave 1: Snapshot and federation foundation
1. Phase 14.1.1-14.1.5
2. Phase 14.2
3. Phase 14.3
4. Phase 14.4
5. Phase 14.5
6. Phase 14.6 (only if API parity is required now)
7. Phase 15.1
8. Phase 15.2
9. Phase 15.4
10. Phase 15.3
11. Phase 15.5
12. Phase 15.6
13. Phase 15.7

Why first:
- Phase 14 + 15 establish identity, manifests, cache invalidation, and deterministic multi-repo retrieval surfaces other phases can rely on.

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
  - `docs/specs/http-api.md` (authoritative once API endpoints are implemented)

- **Pointer snapshots** (cheap metadata references to validated builds).
- **Frozen snapshots** (immutable, self-contained archival copies).
- **Diff artifacts** (bounded, deterministic change sets + summaries).

### Phase 14 Acceptance (explicit)
- [ ] Snapshot artifacts are schema‑valid and deterministic across runs.
- [ ] “As‑of” retrieval can target a snapshot without fallback to live builds.
- [ ] Diff artifacts are bounded, deterministic, and machine‑readable.
- [ ] Snapshot/diff tooling surfaces are present in CLI/API.

### Phase 14 Implementation Order (must follow)
1. 14.1.1 IndexRef parsing and resolution.
2. 14.1.3 Atomic writes + locking.
3. 14.1.4 Path safety and privacy.
4. 14.2 Pointer snapshots.
5. 14.5 Retrieval integration (as-of).
6. 14.4 Deterministic diff computation.
7. 14.3 Frozen snapshots.
8. 14.6 Optional HTTP API integration.

### Phase 14 Non-negotiable invariants
- [ ] Explicit refs/roots never silently fallback:
  - [ ] `--as-of`, `--snapshot`, `--index-root`, explicit `build:<id>`, and explicit `snap:<id>` must fail fast when required artifacts are missing.
- [ ] Contract-first rollout:
  - [ ] Add/update schemas in `src/contracts/schemas/*`, validators, and registry before exposing new CLI/API/MCP surface.
- [ ] Mode-aware root correctness:
  - [ ] Any flow that can resolve per-mode roots must track build-state, maintenance, and telemetry against each selected mode root (no single-root assumptions).
- [ ] Artifact presence checks must recognize compressed outputs:
  - [ ] Presence checks for required artifacts must include uncompressed and compressed variants (`.json`, `.jsonl`, `.jsonl.gz`, `.jsonl.zst`, plus manifest-driven shard forms).


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
- [ ] Enforce schema-first implementation sequence:
  - [ ] Add artifact schemas + validators + contract registry bindings first.
  - [ ] Wire writers/readers second.
  - [ ] Expose CLI/API/MCP entrypoints only after schema validation paths are in place.

Touchpoints:
- `src/index/snapshots/**` (new)
- `src/index/diffs/**` (new)
- `src/shared/artifact-schemas.js` (add AJV validators for `snapshots/manifest.json`, `diffs/manifest.json`, `diffs/*/inputs.json`, `diffs/*/summary.json`)
- `src/contracts/registry.js` (register new schemas)
- `src/contracts/schemas/*` (new snapshot/diff schemas)
- `src/contracts/validators/*` (new snapshot/diff validators)
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
- `src/shared/json-stream/atomic.js` (atomic replace semantics for file writes)
- `src/shared/json-stream/streams.js` (cleanup + tombstone handling for safe replacement)

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
    - [ ] Version ordering semantics explicitly (e.g., `orderingSchema: "diff-events-v1"`) and persist this in `summary.json`.
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
  - [ ] If explicit `--from`/`--to` refs resolve to roots missing required artifacts, fail with actionable errors (no fallback to latest/current).
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

- [ ] Add as-of targeting to retrieval/search:
  - [ ] Canonical flag is `--as-of <IndexRef>`.
  - [ ] Keep `--snapshot <snapshotId>` as compatibility alias only (`--as-of snap:<id>` internally).
  - [ ] Resolve as-of ref to per-mode index roots via `snapshots/manifest.json`.
  - [ ] Ensure as-of references never leak absolute paths (logs + JSON output must stay repo-relative).
  - [ ] Explicit as-of refs fail fast when required artifacts are missing (no fallback to latest/current).

- [ ] Add diff surfacing commands for humans and tools:
  - [ ] `pairofcleats index diff list [--json]`
  - [ ] `pairofcleats index diff show <diffId> [--format summary|jsonl]`
  - [ ] `pairofcleats index diff explain <diffId>` (human-oriented summary + top changed files)

- [ ] Extend “secondary index builders” to support snapshots:
  - [ ] SQLite build: accept `--snapshot <snapshotId>` / `--as-of <IndexRef>` and resolve to `--index-root`.
    - [ ] Ensure the SQLite build can target frozen snapshots as well as pointer snapshots (as long as artifacts still exist).
    - [ ] Explicit refs/roots fail fast when mode artifacts are missing (no silent cross-build fallback).
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
- `src/retrieval/cli-args.js` (add `--as-of`; keep `--snapshot` compatibility alias)
- `src/retrieval/cli.js` (thread snapshot option through)
- `src/retrieval/cli-index.js` (resolve index dir via snapshot; update query cache signature)
- `src/shared/artifact-io.js` (add signature helpers for sharded artifacts)
- `bin/pairofcleats.js` (CLI wiring)
- `tools/build/sqlite/runner.js` + `src/storage/sqlite/build/runner.js` (add `--as-of`/`--snapshot` handling with strict explicit-root behavior)
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
- [ ] `tools/api/router/*` plus `docs/specs/http-api.md` for request/response contracts.

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

- [ ] Canonical CLI/API contract:
  - [ ] `--as-of <IndexRef>` is the canonical flag.
  - [ ] `--snapshot <snapshotId>` remains a compatibility alias that is normalized to `--as-of snap:<id>`.
- [ ] Default behavior unchanged when omitted; `--as-of latest` is equivalent to no flag.
- [ ] Resolve AsOfContext in `src/retrieval/cli.js` and thread to index resolution.
- [ ] Explicit refs/roots do not silently fallback:
  - [ ] If requested `asOf` target cannot satisfy required artifact surface for selected mode(s), fail fast with actionable error.
  - [ ] Only auto-resolved `latest` paths may use best-effort fallback logic.
- [ ] Include `asOf.identityHash` in query cache keys.
- [ ] Unify retrieval index signature computation to be shard-aware and include snapshot identity.
- [ ] Enforce single-root policy for sqlite/lmdb as-of selection.
- [ ] JSON output includes an `asOf` block (ref, identityHash, resolved summary).
- [ ] Human output prints a single `[search] as-of: ...` line when `--as-of` is provided.
- [ ] Telemetry includes `asOf.type` and short `identityHash`; never log raw paths.
- [ ] Secondary builders honor as-of semantics:
  - [ ] sqlite build/as-of flows must use the same resolver behavior and fallback rules as retrieval.
  - [ ] as-of selection for build tooling must reject mixed-root contamination.

Touchpoints:
- `src/retrieval/cli-args.js`
- `src/retrieval/cli.js`
- `src/retrieval/cli-index.js`
- `src/retrieval/index-cache.js#buildIndexSignature`
- `src/retrieval/query-cache.js`
- `src/retrieval/cli/run-search-session.js`
- `tools/build/sqlite/runner.js`
- `src/storage/sqlite/build/runner.js`

Tests:
- [ ] `tests/services/snapshot-query.test.js`
- [ ] `tests/unit/retrieval-cache-key-asof.unit.js`
- [ ] `tests/unit/retrieval-index-signature-shards.unit.js`
- [ ] `tests/services/sqlite-build-snapshot.test.js`
- [ ] `tests/services/asof-explicit-root-no-fallback.test.js`

---

## 14.6 Optional HTTP API integration

- [ ] Extend `/search` to accept `asOf` and thread to `--as-of`.
- [ ] Add snapshot and diff endpoints if UI parity is required.
- [ ] Enforce allowed repo roots and never return absolute paths in responses.
- [ ] Follow `docs/specs/http-api.md` for request/response schemas, error codes, redaction, and allowlisting behavior.

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

### Phase 15 Implementation Order (must follow)
1. 15.1 Workspace configuration, repo identity, and `repoSetId`.
2. 15.2 Workspace manifest generation and workspace-aware build orchestration.
3. 15.4 Compatibility gating and cohort policies.
4. 15.3 Federated search orchestration (CLI/API/MCP).
5. 15.5 Federated query caching and cache-key correctness.
6. 15.7 Index stats reporter surfaces.
7. 15.6 Shared caches, CAS, and GC (design gate first; implement last).

### Phase 15 Non-negotiable invariants
- [ ] Canonicalization must be centralized:
  - [ ] Workspace loader, API router, MCP resolver, and cache keys all use one canonical repo identity pipeline.
- [ ] Invalid build pointers are treated as missing pointers:
  - [ ] Never preserve stale values from malformed `builds/current.json`.
- [ ] Federated execution must be deterministic under partial failures:
  - [ ] Keep successful repos, surface per-repo errors, and apply deterministic ordering to diagnostics and merged outputs.
- [ ] Federated cache keys must reflect actual runtime behavior:
  - [ ] Include requested knobs and effective backend/runtime selections to avoid cache pollution.

### Canonical specs and required updates

Phase 15 MUST align with these authoritative docs:
- `docs/specs/workspace-config.md`
- `docs/specs/workspace-manifest.md`
- `docs/specs/federated-search.md`
- `docs/contracts/compatibility-key.md`
- `docs/specs/federation-cohorts.md`
- `docs/specs/federated-query-cache.md`
- `docs/specs/cache-cas-gc.md`
- `docs/specs/index-stats.md`
- `docs/specs/http-api.md`
- `docs/specs/config-defaults.md`

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
  - [ ] Loader errors must be structured and actionable (`path`, `field`, `reason`, `hint`).

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
  - [ ] Add one integration-level helper entrypoint and ban local reimplementation of repo canonicalization in callers.
  - [ ] Add win32-only canonicalization tests for mixed-case paths pointing to same repo root.

**Touchpoints:**
- `tools/dict-utils/paths/repo.js` (canonicalization, `getRepoId`, build pointer helpers)
- `tools/shared/dict-utils.js` (shared exports for CLI/API/MCP)
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
  - [ ] Persist per-mode availability reason codes:
    - [ ] `present`
    - [ ] `missing-index-dir`
    - [ ] `missing-required-artifacts`
    - [ ] `invalid-pointer`
    - [ ] `compat-key-missing`

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
  - [ ] Build fanout failure policy is deterministic:
    - [ ] Continue other repos when one repo build fails unless strict mode is enabled.
    - [ ] Persist structured build diagnostics in manifest generation output.

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
  - [ ] Define and implement partial-failure policy:
    - [ ] Default: return successful repos + diagnostics for failed repos.
    - [ ] Strict: fail request if any selected repo fails.
    - [ ] Deterministic diagnostics ordering by `repoId`.

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
- New (per spec): `src/retrieval/federation/coordinator.js`
- New (per spec): `src/retrieval/federation/select.js`
- New (per spec): `src/retrieval/federation/merge.js`
- New (per spec): `src/retrieval/federation/args.js`

**Tests**
- [ ] `tests/retrieval/federation/search-multi-repo-basic.test.js`
- [ ] `tests/retrieval/federation/search-determinism.test.js` (byte-identical JSON)
- [ ] `tests/retrieval/federation/repo-selection.test.js`
- [ ] `tests/api/federated-search-workspace-allowlist.test.js`
- [ ] `tests/api/federated-search-redacts-paths.test.js`

---

### 15.4 Compatibility gating (cohorts) + safe federation defaults

> **Authoritative contract:** `docs/contracts/compatibility-key.md`
> **Authoritative spec:** `docs/specs/federation-cohorts.md`

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
  - [ ] Ranking must be deterministic and documented:
    - [ ] prefer cohort with most repos
    - [ ] tie-break by highest total priority
    - [ ] final tie-break by lexical cohort key
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

> **Authoritative spec:** `docs/specs/federated-query-cache.md`

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
    - [ ] effective runtime choices that affect output (resolved ANN backend, fallback backend, compatibility gating outcome, per-mode backend overrides)
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

> **Authoritative spec:** `docs/specs/cache-cas-gc.md`

- [ ] Make cache layers explicit and document them.
  - [ ] Global caches (models, tooling assets, dictionaries/wordlists)
  - [ ] Repo-scoped caches (index builds, sqlite artifacts)
  - [ ] Workspace-scoped caches (workspace manifest, federated query cache)

- [ ] (Design first) Introduce content-addressed storage (CAS) for expensive derived artifacts.
  - [ ] Define object identity (hashing), layout, and reference tracking.
  - [ ] Ensure deterministic, safe reuse across repos and workspaces.
  - [ ] Define and implement a design gate before rollout:
    - [ ] lease model for in-use objects
    - [ ] mark-and-sweep reachability rules
    - [ ] deletion safety conditions under concurrent index/search workloads
    - [ ] recovery plan when GC is interrupted mid-run

- [ ] Implement a manifest-driven GC tool.
  - [ ] `pairofcleats cache gc --dry-run`
  - [ ] Preserve any objects reachable from active manifests/snapshots; delete unreferenced objects deterministically.
  - [ ] Be safe under concurrency (do not delete objects currently in use).

- [ ] Scale-out controls.
  - [ ] Concurrency limits for multi-repo indexing and federated fanout search.
  - [ ] Memory remains bounded under “N repos × large query” workloads.

**Touchpoints:**
- `src/shared/cache.js`
- `tools/index/cache-gc.js`
- `tools/shared/dict-utils.js`
- `docs/guides/commands.md`

**Tests**
- [ ] `tests/indexing/cache/workspace-global-cache-reuse.test.js`
- [ ] `tests/indexing/cache/cas-reuse-across-repos.test.js`
- [ ] `tests/tooling/cache/cache-gc-preserves-manifest-referenced.test.js`
- [ ] `tests/indexing/cache/workspace-concurrency-limits.test.js`

---

### 15.7 Index stats reporter (single-shot + JSON)

> **Authoritative spec:** `docs/specs/index-stats.md`

- [ ] Add a dedicated index stats reporter tool.
  - [ ] CLI entrypoint: `pairofcleats index stats` (or `node tools/index/stats.js`).
  - [ ] Input: `--repo <path>` or `--index-dir <path>`, optional `--mode`.
  - [ ] Output: human summary + `--json` for structured output.
  - [ ] Must use `pieces/manifest.json` as the source of truth (manifest-first).
  - [ ] Prefer extending `tools/index/report-artifacts.js` when feasible; create `tools/index/stats.js` only if dedicated UX/contract separation is required.

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
- `tools/index/report-artifacts.js` (extend existing artifact reporting surface)
- `tools/index/stats.js` (new, optional if split command is chosen)
- `tools/shared/dict-utils.js` (index root resolution)
- `src/shared/artifact-io/manifest.js` (manifest parsing helpers)
- `src/integrations/core/status.js` (optional reuse)

**Tests**
- [ ] `tests/tooling/index-stats/index-stats-json.test.js`
- [ ] `tests/tooling/index-stats/index-stats-missing-artifact.test.js`
- [ ] `tests/tooling/index-stats/index-stats-aggregate.test.js`

### Phase 14 + 15 cross-cutting hardening tests (mandatory)
- [ ] `tests/services/snapshots/concurrent-registry-writers.test.js`
  - [ ] Two writers contend on snapshot/diff manifests; verify lock behavior and readable artifacts after forced interruption.
- [ ] `tests/shared/json-stream/atomic-stale-backup-protection.test.js`
  - [ ] Stale backup/temp-missing scenarios must fail safely (no false success, no stale artifact acceptance).
- [ ] `tests/services/embeddings/mode-root-divergence-maintenance.test.js`
  - [ ] Per-mode root divergence updates build-state and sqlite maintenance against the correct mode roots.
- [ ] `tests/services/indexing/compressed-artifact-presence.test.js`
  - [ ] Presence checks accept valid compressed shard and compressed JSONL artifact forms.
- [ ] `tests/workspace/windows-path-canonicalization-contract.test.js`
  - [ ] Mixed-case path variants resolve to a single canonical repo identity and stable cache keys.
- [ ] `tests/retrieval/federation/explicit-root-no-fallback.test.js`
  - [ ] Explicit refs fail fast when artifacts are missing; no fallback to current/latest.

---

### Wave 2: Retrieval correctness and profile specialization
14. Phase 16.1
15. Phase 16.2
16. Phase 16.3
17. Phase 16.4
18. Phase 16.5
19. Phase 16.6
20. Phase 16.7
21. Phase 16.8
22. Phase 17.1
23. Phase 17.2
24. Phase 17.3
25. Phase 17.4 (optional stretch)

Why this order:
- Phase 16 provides correctness and routing behavior that Phase 17 depends on.
- Phase 17 then codifies strict vector-only behavior on top of stable retrieval/build contracts.

### Wave 3: Lexicon enrichment before UI orchestration
26. Phase 19.0
27. Phase 19.1
28. Phase 19.2
29. Phase 19.4
30. Phase 19.3
31. Phase 19.5

Why before Phase 20:
- If TUI/explain surfaces include lexicon signals, Phase 19 should stabilize output contracts first.

### Wave 4: Supervisor and TUI
32. Phase 20.0.2 + 20.1.1 + 20.1.2 + 20.1.3 + 20.0.7
33. Phase 20.0.3 + 20.0.4 + 20.0.5 + 20.0.6
34. Phase 20.2.1
35. Phase 20.2.2
36. Phase 20.2.3
37. Phase 20.2.4
38. Phase 20.3.1
39. Phase 20.3.2
40. Phase 20.3.3
41. Phase 20.4.1-20.4.3
42. Phase 20.5.1
43. Phase 20.5.2

Why:
- This follows the built-in dependency matrix in Phase 20 and avoids rework from protocol/dispatcher drift.

### Wave 5: Distribution hardening and release closure
44. Phase 18.1
45. Phase 18.2
46. Phase 18.3
47. Phase 18.4
48. Phase 18.5
49. Phase 18.6

Why at the end:
- Phase 18 should package and harden the final integrated system, including any TUI binaries and finalized behavior.

### Wave 6: Intelligence and operational excellence
50. Track IQ.1 query-intent policy engine (routing/ranking policy by intent class)
51. Track IQ.2 multi-hop graph expansion with bounded novelty-aware reranking
52. Track IQ.3 task-pack assembly mode (entrypoint + call chain + tests + config/docs)
53. Track IQ.4 trust/confidence scoring and explain confidence surfaces
54. Track IQ.5 retrieval quality replay suite from real-world query logs
55. Track OP.1 search/index SLO contracts (latency, success rate, determinism, cache hit-rate)
56. Track OP.2 failure-aware degradation policy and backend failover contracts
57. Track OP.3 fault injection and chaos tests for index/search/service/supervisor paths
58. Track OP.4 adaptive provider orchestration and auto-tuning with hard safety bounds
59. Track OP.5 release gates that block on quality/perf/reliability budgets

Why this wave:
- It turns the platform from “feature-complete index/search tooling” into a durable codebase intelligence engine with measurable quality and reliability guarantees.

## Optional performance acceleration track (run after Wave 2 baseline)
- Subphase A
- Subphase B
- Subphase C
- Subphase D
- Subphase E

Placement guidance:
- Start only after Phase 16/17 correctness baselines and parity tests are stable.
- Keep behind capability detection and strict JS fallback parity.
- Fold distribution concerns into Phase 18 and/or Subphase E outputs.
- Require objective perf gates before default enablement:
  - p50/p95 query latency improvement
  - build throughput improvement
  - no quality regression in replay suite

## Cross-phase gates (do not skip)
- Deterministic identity:
  - Repo/path identity, index refs, manifest hashing, and cache keys must be canonical before adding higher-level orchestration.
- Contract-first:
  - Any schema/config/explain surface change must ship with docs/contracts updates in the same phase.
- Compatibility gating:
  - Cohort/profile compatibility checks must be in place before mixed-repo/mixed-profile federation is treated as production-ready.
- Bounded behavior:
  - Concurrency, cancellation, and cache growth must remain bounded as federation/TUI layers are introduced.
- Quality loop:
  - Every major retrieval/indexing change must be validated against a replay suite with tracked quality metrics.
- SLO discipline:
  - Every lane/release must enforce budgets for latency, error rate, and determinism drift.
- Release closeout:
  - Full release packaging should occur after core behavior settles to avoid churn in artifact/release contracts.

## Track IQ: Codebase Intelligence Enhancements

### IQ.1 Intent-aware routing and scoring
- Add query intent classes (`api-discovery`, `bugfix`, `refactor`, `test-impact`, `ownership`, `security`).
- Route backend/weights/candidate strategy by intent.
- Require explain output to include intent and route decision.

### IQ.2 Multi-hop retrieval
- Add bounded second-hop expansion from symbol/call/import graph.
- Add novelty/citation-aware reranking so repeated chunks are down-ranked.
- Keep deterministic tie-breakers and hard hop/candidate caps.

### IQ.3 Task-pack results
- Add a pack mode that groups related outputs:
  - code entrypoints
  - dependent call chain
  - impacted tests
  - relevant configs/docs
- Emit stable pack schema in JSON output.

### IQ.4 Confidence and trust signals
- Add confidence score per result and per response.
- Include signal agreement factors (sparse/dense/graph/metadata consistency).
- Surface low-confidence reasons in explain output.

### IQ.5 Quality feedback loop
- Build replay benchmark from anonymized real queries.
- Track precision/coverage metrics and regression thresholds.
- Make quality gates mandatory for retrieval/ranking changes.

## Track OP: Throughput, Reliability, Robustness

### OP.1 SLO contracts
- Define SLOs for:
  - index build throughput
  - query p50/p95 latency
  - query success/error rates
  - deterministic output drift
- Wire SLO checks into CI and release checks.

### OP.2 Failure-aware degradation
- Define deterministic fallback ladder when providers/backends fail.
- Ensure degrade path preserves correctness and emits explicit warnings.

### OP.3 Fault injection
- Add tests for partial writes, lock contention, cancellation races, backend unavailability, and stale/corrupt artifacts.
- Require recovery behavior contracts and crash-safe resumption.

### OP.4 Adaptive orchestration
- Add bounded auto-tuning for provider order, ANN caps, and candidate limits using live telemetry.
- Keep deterministic policy snapshots to avoid uncontrolled drift.

### OP.5 Release gating
- Block release on:
  - quality replay regressions
  - SLO budget breaches
  - unresolved reliability/fault-injection failures

## Practical execution notes
- Use this SKYMAP ordering when scheduling batches; do not run appendix phases as separate workstreams.
- If parallelizing, split along independent tracks noted in Phase 20 and keep contract-owning changes serialized.
- Re-run docs/config inventory sync checks at each wave boundary to prevent drift.
- Use FAST.md opportunities as implementation backlog for Track OP, prioritized by impact/risk and protected by replay + SLO gates.
