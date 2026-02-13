# SKYMAP

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
1. Phase 14.1.1
2. Phase 14.1.2
3. Phase 14.1.3
4. Phase 14.1.4
5. Phase 14.1.5 (optional defaults/config only)
6. Phase 14.2
7. Phase 14.3
8. Phase 14.4
9. Phase 14.5
10. Phase 14.6 (only if API parity is required now)
11. Phase 15.1
12. Phase 15.2
13. Phase 15.4
14. Phase 15.3
15. Phase 15.5
16. Phase 15.6
17. Phase 15.7

Why first:
- Phase 14 + 15 establish identity, manifests, cache invalidation, and deterministic multi-repo retrieval surfaces other phases can rely on.

---

## Phase 14 — Reference specification (non-tracking)

> This section is retained as the detailed Phase 14 specification reference.
> It is intentionally **non-tracking**: checkbox state here is not authoritative for project status.
> Authoritative status and remaining work are tracked below in "Current implementation status (authoritative)" and in sections `14.1`–`14.6`.


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
- Snapshot artifacts are schema‑valid and deterministic across runs.
- “As‑of” retrieval can target a snapshot without fallback to live builds.
- Diff artifacts are bounded, deterministic, and machine‑readable.
- Snapshot/diff tooling surfaces are present in CLI/API.

### Phase 14 Implementation Order (must follow)
1. 14.1.1 IndexRef parsing and resolution.
2. 14.1.2 Snapshot/diff artifact contracts + schemas/validators.
3. 14.1.3 Atomic writes + locking.
4. 14.1.4 Path safety and privacy.
5. 14.1.5 Retention defaults/config wiring (optional; only if implemented).
6. 14.2 Pointer snapshots.
7. 14.3 Frozen snapshots.
8. 14.4 Deterministic diff computation.
9. 14.5 Retrieval integration (as-of).
10. 14.6 Optional HTTP API integration.

### Phase 14 Non-negotiable invariants
- Explicit refs/roots never silently fallback:
  - `--as-of`, `--snapshot`, `--index-root`, explicit `build:<id>`, and explicit `snap:<id>` must fail fast when required artifacts are missing.
- Contract-first rollout:
  - Add/update schemas in `src/contracts/schemas/*`, validators, and registry before exposing new CLI/API/MCP surface.
- Mode-aware root correctness:
  - Any flow that can resolve per-mode roots must track build-state, maintenance, and telemetry against each selected mode root (no single-root assumptions).
- Artifact presence checks must recognize compressed outputs:
  - Presence checks for required artifacts must include uncompressed and compressed variants (`.json`, `.jsonl`, `.jsonl.gz`, `.jsonl.zst`, plus manifest-driven shard forms).


### 14.1 Snapshot & diff artifact surface (contracts, retention, safety)

- Define the on-disk **public artifact surface** under each repo cache root:
  - `snapshots/manifest.json` — snapshot registry (authoritative index of snapshots)
  - `snapshots/<snapshotId>/snapshot.json` — immutable per-snapshot metadata record
  - `snapshots/<snapshotId>/frozen.json` — immutable freeze metadata record (when frozen)
  - `snapshots/<snapshotId>/frozen/index-<mode>/...` — frozen snapshot index roots (immutable copies)
  - `diffs/manifest.json` — diff registry (authoritative index of diffs)
  - `diffs/<diffId>/inputs.json` — canonical diff input identity (always present)
  - `diffs/<diffId>/summary.json` — bounded diff summary (always present)
  - `diffs/<diffId>/events.jsonl` — bounded event stream (may be truncated)

- Standardize **ID + naming rules**:
  - Snapshot IDs: `snap-YYYYMMDD-HHMMSS-<shortid>` (default) plus optional user `label`
  - Diff IDs: `diff_<sha256><shortid>` (default)
  - Ensure IDs are filesystem-safe.
  - Ensure deterministic ordering for registry output (sort by `createdAt`, then `id`).

- Define snapshot registry entry schema (minimum fields):
  - `id`, `type` (`pointer` | `frozen`), `createdAt`
  - `label` (nullable), `tags` (string[])
  - `buildId` (from `build_state.json`), `configHash`, `toolVersion`
  - `buildRoot` (repo-cache-relative path), plus `modeBuildRoots` map (`mode -> repo-cache-relative index root`)
  - `repoProvenance` (best-effort: SCM provider + revision/branch if available)
  - `integritySummary` (best-effort counts + size estimates + `validatedAt` timestamp)
  - `hasFrozen` + `frozenAt` (when frozen)
  - `frozenFromBuildId` (optional, when frozen snapshot derives from pointer)
  - future-proof fields (schema allows but does not require): `workspaceId`, `namespaceKey`
    - Defer multi-repo/workspace orchestration to **Phase 15 — Federation & Multi-Repo**.

  - Define diff registry entry schema (minimum fields):
    - `id`, `createdAt`, `from` + `to` refs (snapshotId/buildId/indexRootRef), `modes`
    - `summaryPath` and optional `eventsPath`
    - `truncated` flag + truncation metadata (`maxEvents`, `maxBytes`)
    - `compat` block capturing `from.configHash` vs `to.configHash` and `toolVersion` mismatches.
- Define `diffs/<diffId>/inputs.json` schema (minimum fields):
  - `id`, `createdAt`, `from`, `to`, `modes`, `allowMismatch`
  - `identityHash` of canonical inputs (deterministic)
  - `from.configHash`/`to.configHash`, `from.toolVersion`/`to.toolVersion` (for audit)
  - Specify identity hash inputs explicitly (fields included/excluded; createdAt/tags/labels excluded).

- Make registries **atomic and crash-safe**:
  - Use atomic write (temp + rename) and stable JSON output.
  - Avoid partial registry writes leaving corrupt JSON (registry must always be readable or rolled back).
  - If using per-snapshot `snapshots/<id>/snapshot.json`, write it first, then append to `snapshots/manifest.json`.

- Add **retention policy knobs** (defaults tuned for safety):
  - `indexing.snapshots.maxPointerSnapshots` (default: 25)
  - `indexing.snapshots.maxFrozenSnapshots` (default: 10)
  - `indexing.snapshots.retainDays` (default: 30)
  - `indexing.diffs.maxDiffs` (default: 50)
  - `indexing.diffs.retainDays` (default: 30)
  - `indexing.diffs.maxEvents` / `indexing.diffs.maxBytes` (bounded output)
  - Retention must respect tags (e.g., `release` is never deleted automatically).

- Enforce **path safety** for all snapshot/diff paths:
  - Treat all registry paths as repo-cache-relative.
  - Refuse any `buildRoot` / `modeBuildRoots` values that escape the repo cache root (no `..`, no absolute paths).
  - Refuse snapshot/diff output dirs if they escape the repo cache root.
  - Define redaction rules for `path:` refs and output fields (persist hash + redacted placeholder; never persist raw absolute paths).
  - Define error codes for snapshot/diff failures (validation missing, path escape, mismatch without allow, unknown ref).

- Integrate **validation gating semantics** into the contract:
  - Pointer snapshots may only reference builds that passed index validation (see Phase 14.2).
  - Frozen snapshots must be self-contained and re-validatable.
- Enforce schema-first implementation sequence:
  - Add artifact schemas + validators + contract registry bindings first.
  - Wire writers/readers second.
  - Expose CLI/API/MCP entrypoints only after schema validation paths are in place.

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
- `tests/unit/snapshots-registry.unit.js`
  - Registry schema validation (valid/invalid cases)
  - Atomic update behavior (simulate interrupted write; registry remains readable)
  - Path safety (reject absolute paths and `..` traversal)
  - Deterministic ordering (`createdAt`, then `id`)
  - Tag reverse index is stable + deterministic
  - Retention honors protected tags (e.g., `release`)
- `tests/unit/diffs-registry.unit.js`
  - Schema validation + bounded/truncation metadata correctness
  - Registry ordering is deterministic


### 14.2 Pointer snapshots (creation, validation gating, CLI/API)

- Implement pointer snapshot creation:
  - Resolve repo cache root and current build roots from `builds/current.json`.
  - Load `build_state.json` from the current build root (for `buildId`, `configHash`, `toolVersion`, and provenance).
  - Require a successful artifact validation signal before snapshotting:
    - Preferred: consume a persisted validation report if present.
    - Otherwise: run validation on-demand against each mode index root.
    - Define authoritative validation signal + precedence (build_state.validation vs report file vs on-demand run); fail if conflicting.
  - Refuse snapshot creation when builds are incomplete:
    - If an index mode is missing required artifacts, fail.
    - If embeddings/risk passes are still pending for a mode, fail.
    - No allow-incomplete override in Phase 14 (must align with spec).
  - Materialize snapshot entry with:
    - `buildRoot` + `modeBuildRoots` captured as **repo-cache-relative** paths.
    - `integritySummary` populated from validation output + minimal artifact counts.
  - Write immutable per-snapshot metadata:
    - `snapshots/<snapshotId>/snapshot.json` (write atomically).
    - Keep the registry entry minimal and link to the per-snapshot record if desired.
  - Append entry to `snapshots/manifest.json` atomically.
  - Apply retention after creation (delete oldest pointer snapshots unless tagged).

- Add CLI surface:
  - `pairofcleats index snapshot create [--label <label>] [--tags <csv>] [--modes <csv>]`
  - `pairofcleats index snapshot list [--json]`
  - `pairofcleats index snapshot show <snapshotId> [--json]`
  - `pairofcleats index snapshot rm <snapshotId> [--force]`

- Add API surface (recommended for UI/MCP parity):
  - `GET /index/snapshots` (list)
  - `GET /index/snapshots/:id` (show)
  - `POST /index/snapshots` (create)
  - Ensure endpoints never expose absolute filesystem paths.

- Sweep-driven hardening for snapshot creation:
  - When reading `builds/current.json`, treat any buildRoot that escapes repo cache root as **invalid** and refuse snapshotting.
  - Ensure snapshot manifest writes are atomic and do not corrupt on crash.

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
  - `tests/services/snapshot-create.test.js`
  - Build an index; create a pointer snapshot; assert registry entry exists and references current build.
  - Fail creation when artifacts are missing or validation fails.
  - Fail creation when `build_state.json` is missing or `validation.ok !== true`.
  - No allow-incomplete override: ensure creation fails when validation missing even with flags.
  - `--modes` subset only snapshots those modes.
  - Retention deletes oldest untagged pointer snapshots.


### 14.3 Frozen snapshots (immutable copies + integrity verification)

- Implement snapshot freeze operation:
  - `pairofcleats index snapshot freeze <snapshotId>`
  - Preconditions:
    - Snapshot exists and is `pointer` (or already `frozen` → no-op / error depending on flags).
    - Referenced build roots exist and are readable.
  - Copy the snapshot’s index artifacts into:
    - `snapshots/<snapshotId>/frozen/index-<mode>/...`
  - Copy strategy:
    - Use `pieces/manifest.json` from each mode’s index root as the authoritative list of files to copy.
    - Prefer hardlinking (same filesystem) when safe; otherwise copy bytes.
    - Always copy metadata (`index_state.json`, `pieces/manifest.json`, and any required build metadata files).
  - Integrity verification:
    - Verify copied pieces against `pieces/manifest.json` checksums.
    - Re-run index validation against the frozen index roots.
  - Atomicity:
    - Freeze into a temp directory and rename into place only after verification.
  - Update `snapshots/manifest.json`:
    - Flip `type` to `frozen`.
    - Update `buildRoot` / `modeBuildRoots` to point at the frozen roots.
    - Preserve the original `buildId` / provenance; record `frozenFromBuildId` if useful.

- Add supporting maintenance commands:
  - `pairofcleats index snapshot gc [--dry-run]` (enforce retention; never delete `release`-tagged snapshots)

Touchpoints:
- `tools/index-snapshot.js` (freeze + gc)
- `src/index/snapshots/freeze.js` (new)
- `src/index/snapshots/copy-pieces.js` (new; copy/hardlink logic)
- `src/shared/artifact-io/manifest.js` (verify checksums + manifest parsing)
- `src/shared/json-stream.js` (atomic JSON writes for frozen.json)
- `src/shared/json-stream/atomic.js` (atomic replace semantics for file writes)
- `src/shared/json-stream/streams.js` (cleanup + tombstone handling for safe replacement)

#### Tests
  - `tests/services/snapshot-freeze.test.js`
  - Create pointer snapshot → freeze → validate frozen index roots succeed.
  - Ensure freeze is atomic (simulate failure mid-copy → no partial frozen dir is considered valid).
  - Ensure frozen snapshot remains usable after deleting the original build root.
  - Validate checksum mismatch fails freeze and leaves no finalized frozen dir.
  - Hardlink vs copy behavior (same filesystem vs cross-device).


### 14.4 Deterministic diff computation (bounded, machine-readable)

- Implement diff computation between two index states:
  - CLI: `pairofcleats index diff --from <snapshotId|buildId|path> --to <snapshotId|buildId|path> [--modes <csv>]`
  - Resolve `from` and `to` to per-mode index roots (snapshot pointer, snapshot frozen, or explicit indexRoot).
  - Refuse or annotate mismatches:
    - If `configHash` differs, require `--allow-mismatch` or mark output as “non-comparable”.
    - If `toolVersion` differs, annotate (diff still possible but less trustworthy).

  - Define diff output formats:
    - Always write `diffs/<diffId>/inputs.json` (canonical input identity + mode selection).
    - Always write `diffs/<diffId>/summary.json` (bounded):
    - counts of adds/removes/changes by category
    - `truncated` boolean + reason
    - `from`/`to` metadata (snapshot IDs, build IDs, createdAt)
  - Optionally write `diffs/<diffId>/events.jsonl` (bounded stream):
    - `file_added | file_removed | file_changed` (path + old/new hash)
    - `chunk_added | chunk_removed | chunk_changed`:
      - stable `chunkId` from `metaV2.chunkId`
      - minimal before/after summary (`file`, `segment`, `kind`, `name`, `start/end`), plus optional `semanticSig` (hash of normalized docmeta/metaV2 subset)
    - `graph_edge_added | graph_edge_removed` (graph name + from/to node IDs)
    - Allow future event types (symbols/contracts/risk) without breaking old readers.

- Implement deterministic diffing rules:
    - Define canonical event taxonomy + ordering key in the roadmap (type order + stable key fields).
    - Version ordering semantics explicitly (e.g., `orderingSchema: "diff-events-v1"`) and persist this in `summary.json`.
    - Stable identity:
      - Files keyed by repo-relative path.
    - Chunks keyed by `metaV2.chunkId` (do **not** rely on numeric `chunk_meta.id`).
    - Graph edges keyed by `(graph, fromId, toId)`.
  - Stable ordering:
    - Sort events by `(type, key)` so repeated runs produce byte-identical outputs.
  - Boundedness:
    - Enforce `indexing.diffs.maxEvents` and `indexing.diffs.maxBytes`.
    - If exceeded, stop emitting events and mark summary as truncated; include category counts.

- Integrate diff generation into incremental build:
  - After a successful build+promotion, compute a diff vs the previous “latest” snapshot/build.
  - Use incremental state (manifest) to compute file-level changes in O(changed) where possible.
  - Emit diffs only after strict validation passes (so diffs don’t encode broken builds).
  - Store the diff under `diffs/<diffId>/...` and append to `diffs/manifest.json` (do **not** mix diffs into buildRoot without a strong reason).

- Sweep-driven hardening for incremental reuse/diff correctness (because this phase touches incremental state):
  - Before reusing an “unchanged” incremental build, verify required artifacts exist (use `pieces/manifest.json` as the authoritative inventory).
    - If any required piece is missing/corrupt, disable reuse and force rebuild.
  - If explicit `--from`/`--to` refs resolve to roots missing required artifacts, fail with actionable errors (no fallback to latest/current).
  - Fast-path diff only when all `pieces/manifest.json` checksums and shard counts match (shard-aware; sum per-piece counts).
  - Ensure incremental cache invalidation is tied to a complete signature:
    - Include artifact schema hash + tool version + key feature flags in the incremental signature.
    - Include diff/snapshot emission toggles so changing these settings invalidates reuse.

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
  - `tests/services/index-diff.test.js`
  - Build snapshot A; modify repo; build snapshot B; compute diff A→B.
  - Assert file_changed appears for modified file.
  - Assert chunk changes use `metaV2.chunkId` and are stable across runs.
  - Assert ordering is deterministic (byte-identical `events.jsonl`).
  - Assert truncation behavior when `maxEvents` is set low.
  - Assert diffId deterministic for identical inputs (same IDs + same mode selection).
  - Assert configHash mismatch requires explicit allow/flag and is annotated.
  - Assert toolVersion mismatch is annotated (diff still produced).
  - `tests/indexer/incremental/index-reuse-validation.test.js`
  - Corrupt/remove a required artifact and verify incremental reuse is refused.


### 14.5 Retrieval + tooling integration: “as-of” snapshots and “what changed” surfaces

- Add as-of targeting to retrieval/search:
  - Canonical flag is `--as-of <IndexRef>`.
  - Keep `--snapshot <snapshotId>` as compatibility alias only (`--as-of snap:<id>` internally).
  - Resolve as-of ref to per-mode index roots via `snapshots/manifest.json`.
  - Ensure as-of references never leak absolute paths (logs + JSON output must stay repo-relative).
  - Explicit as-of refs fail fast when required artifacts are missing (no fallback to latest/current).

- Add diff surfacing commands for humans and tools:
  - `pairofcleats index diff list [--json]`
  - `pairofcleats index diff show <diffId> [--format summary|jsonl]`
  - `pairofcleats index diff explain <diffId>` (human-oriented summary + top changed files)

- Extend “secondary index builders” to support snapshots:
  - SQLite build: accept `--snapshot <snapshotId>` / `--as-of <IndexRef>` and resolve to `--index-root`.
    - Ensure the SQLite build can target frozen snapshots as well as pointer snapshots (as long as artifacts still exist).
    - Explicit refs/roots fail fast when mode artifacts are missing (no silent cross-build fallback).
  - Validate tool: document `pairofcleats index validate --index-root <frozenSnapshotIndexRoot>` workflow (no new code required if `--index-root` already supported).

- Add API surface (recommended):
  - `GET /index/diffs` (list)
  - `GET /index/diffs/:id` (summary)
  - `GET /index/diffs/:id/events` (JSONL stream; bounded)
  - `GET /search?snapshotId=...` (search “as-of” a snapshot)

- Sweep-driven hardening for retrieval caching (because this phase touches retrieval index selection):
  - Ensure query cache keys include `asOf.identityHash` (or resolved buildId) so results cannot bleed across snapshots.
  - Fix retrieval index signature calculation to account for sharded artifacts (see tests below) and include snapshot identity.

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
  - `tests/services/snapshot-query.test.js`
  - Build snapshot A; modify repo; build snapshot B.
  - Run the same query against `--snapshot A` and `--snapshot B`; assert results differ as expected.
  - Assert “latest” continues to resolve to the current build when no snapshot is provided.
- `tests/unit/retrieval-index-signature-shards.unit.js`
  - Create a fake index dir with `chunk_meta.meta.json` + `chunk_meta.parts/*`.
  - Assert the index signature changes when any shard changes.
  - `tests/services/sqlite-build-snapshot.test.js`
  - Build snapshot A.
  - Run `pairofcleats lmdb build` / `pairofcleats sqlite build` equivalents with `--snapshot A`.
  - Assert output DB is produced and corresponds to that snapshot’s artifacts.
  - `tests/unit/retrieval-cache-key-asof.unit.js`
    - Cache key includes `asOf.identityHash` or resolved buildId.

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

## Current implementation status (authoritative)

- Last updated: 2026-02-13T00:00:00Z
- Completed: Phase 14 implementation tracks `14.1.1` through `14.6`.
- Remaining work: `14.1.5 Retention defaults (optional)` only.
- Remaining optional items:
  - [ ] Create/follow `docs/specs/config-defaults.md` for retention defaults.
  - [ ] Define `indexing.snapshots.keepPointer`, `keepFrozen`, `maxAgeDays`, `protectedTagGlobs`, `stagingMaxAgeHours` defaults.
  - [ ] Define `indexing.diffs.keep`, `maxAgeDays`, and `indexing.diffs.compute.*` defaults.

## 14.1 Foundations (IndexRef + artifact contracts + safety)

### 14.1.1 IndexRef parsing and resolution

- [x] Implement `src/index/index-ref.js`:
  - [x] `parseIndexRef(ref)` to normalize and validate per spec.
  - [x] `resolveIndexRef({ repoRoot, userConfig, requestedModes, preferFrozen, allowMissingModes })`:
    - [x] `latest` -> `builds/current.json` promotion data.
    - [x] `build:<id>` -> repo cache build root.
    - [x] `snap:<id>` -> snapshot registry with `preferFrozen`.
    - [x] `tag:<tag>` -> tag reverse index (deterministic latest-first).
    - [x] `path:<path>` -> in-memory only (do not persist; identity uses `pathHash`).
  - [x] `identityHash = sha1(stableStringify(identity))`.
  - [x] Hard invariant: `identity` must contain no absolute paths.

Touchpoints:
- `src/index/index-ref.js` (new)
- `src/shared/stable-json.js#stableStringify`
- `src/shared/hash.js#sha1`
- `src/shared/error-codes.js#createError`
- `tools/dict-utils/*` (repo cache root + current build info helpers)

Tests:
- [x] `tests/shared/index-ref.test.js` (parse + identityHash stability + tag ordering + path redaction)

### 14.1.2 Snapshot/diff artifact surface (contracts)

- [x] Define artifacts exactly per spec:
  - [x] `snapshots/manifest.json`
  - [x] `snapshots/<id>/snapshot.json`
  - [x] `snapshots/<id>/frozen.json`
  - [x] `diffs/manifest.json`
  - [x] `diffs/<diffId>/inputs.json`
  - [x] `diffs/<diffId>/summary.json`
  - [x] `diffs/<diffId>/events.jsonl`
- [x] Define `inputs.json` schema fields explicitly (canonical refs, mode list, allowMismatch, identityHash).
- [x] Update public docs to match schema:
  - [x] `docs/contracts/indexing.md`
  - [x] `docs/contracts/artifact-contract.md`
  - [x] `docs/specs/index-refs-and-snapshots.md`
  - [x] `docs/specs/index-diffs.md`

Touchpoints:
- `src/contracts/schemas/*` (new snapshot/diff schemas)
- `src/contracts/validators/*`
- `src/contracts/registry.js`

Tests:
- [x] `tests/indexing/contracts/snapshots-contracts.test.js`
- [x] `tests/indexing/contracts/diffs-contracts.test.js`

### 14.1.3 Atomic writes + locking

- [x] Use index lock for snapshot/diff writes.
- [x] Write JSON atomically (temp + rename) with stable JSON output.
- [x] Clean up stale `frozen.staging-*` directories (default 24h).

Touchpoints:
- `src/index/build/lock.js#acquireIndexLock`
- `src/shared/json-stream.js#writeJsonObjectFile`

Tests:
- [x] `tests/shared/snapshots-registry.test.js` (atomic update + readability after simulated failure)
- [x] `tests/shared/diffs-registry.test.js` (lock-gated diff registry atomic writes)

### 14.1.4 Path safety and privacy

- [x] Persist only repo-cache-relative paths.
- [x] Reject absolute paths or traversal (`..`).
- [x] Persisted artifacts must not leak absolute paths.
- [x] Define redaction behavior for `path:` refs and any persisted output fields (hash + placeholder; no raw absolute paths).

Touchpoints:
- `src/index/validate/paths.js#isManifestPathSafe`
- `src/shared/files.js#toPosix`
- `src/index/index-ref.js` (path: refs redaction)

Tests:
- [x] `tests/shared/no-path-leak.test.js`

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

- [x] Implement `pairofcleats index snapshot create`:
  - [x] Acquire index lock.
  - [x] Resolve `latest` via IndexRef resolver.
  - [x] Require `build_state.json.validation.ok === true` for all selected modes.
  - [x] Define authoritative validation signal + precedence (build_state.validation vs report file vs on-demand run); fail if conflicting.
  - [x] Write `snapshot.json` atomically, then update manifest with tag index.
- [x] Implement `snapshot list/show/prune`.
- [x] Ensure tag reverse index is deterministic.

Touchpoints:
- `tools/index-snapshot.js`
- `src/index/snapshots/registry.js`
- `src/index/snapshots/create.js` (or command module)
- `bin/pairofcleats.js` (CLI wiring)

Tests:
- [x] `tests/services/snapshot-create.test.js`

Optional API:
- [x] `tools/api/router/*` plus `docs/specs/http-api.md` for request/response contracts.

---

## 14.3 Frozen snapshots

- [x] Implement `snapshot freeze`:
  - [x] Create `frozen.staging-*` then hardlink/copy artifacts listed in `pieces/manifest.json`.
  - [x] Verify checksums; on success rename staging -> `frozen/` and write `frozen.json`.
  - [x] Update manifest `hasFrozen=true`.
- [x] Stale staging cleanup and idempotency behavior.

Touchpoints:
- `src/index/snapshots/freeze.js`
- `src/index/snapshots/copy-pieces.js`
- `src/shared/hash.js` (checksum)

Tests:
- [x] `tests/services/snapshot-freeze.test.js`

---

## 14.4 Deterministic diff computation

- [x] Implement `pairofcleats index diff compute/show/list/prune`.
- [x] Deterministic diffId from canonical inputs.
- [x] Persist `inputs.json`, `summary.json`, and bounded `events.jsonl`.
- [x] Define canonical event taxonomy + ordering key (type order + stable key fields).
- [x] Fast-path only if pieces manifests match in a shard-aware way (all checksums + summed counts).
- [x] Deterministic ordering (mode order + per-mode sort).
- [x] Truncation behavior deterministic and documented in summary.

Touchpoints:
- `tools/index-diff.js`
- `src/index/diffs/compute.js`
- `src/index/diffs/events.js`
- `src/index/diffs/registry.js`
- `src/index/build/incremental.js` (reuse validation + signature binding)

Tests:
- [x] `tests/services/index-diff.test.js`
- [x] `tests/indexer/incremental/index-reuse-validation.test.js`

---

## 14.5 Retrieval integration (as-of)

- [x] Canonical CLI/API contract:
  - [x] `--as-of <IndexRef>` is the canonical flag.
  - [x] `--snapshot <snapshotId>` remains a compatibility alias that is normalized to `--as-of snap:<id>`.
- [x] Default behavior unchanged when omitted; `--as-of latest` is equivalent to no flag.
- [x] Resolve AsOfContext in `src/retrieval/cli.js` and thread to index resolution.
- [x] Explicit refs/roots do not silently fallback:
  - [x] If requested `asOf` target cannot satisfy required artifact surface for selected mode(s), fail fast with actionable error.
  - [x] Only auto-resolved `latest` paths may use best-effort fallback logic.
- [x] Include `asOf.identityHash` in query cache keys.
- [x] Unify retrieval index signature computation to be shard-aware and include snapshot identity.
- [x] Enforce single-root policy for sqlite/lmdb as-of selection.
- [x] JSON output includes an `asOf` block (ref, identityHash, resolved summary).
- [x] Human output prints a single `[search] as-of: ...` line when `--as-of` is provided.
- [x] Telemetry includes `asOf.type` and short `identityHash`; never log raw paths.
- [x] Secondary builders honor as-of semantics:
  - [x] sqlite build/as-of flows must use the same resolver behavior and fallback rules as retrieval.
  - [x] as-of selection for build tooling must reject mixed-root contamination.

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
- [x] `tests/services/snapshot-query.test.js`
- [x] `tests/unit/retrieval-cache-key-asof.unit.js`
- [x] `tests/unit/retrieval-index-signature-shards.unit.js`
- [x] `tests/services/sqlite-build-snapshot.test.js`
- [x] `tests/services/asof-explicit-root-no-fallback.test.js`

---

## 14.6 Optional HTTP API integration

- [x] Extend `/search` to accept `asOf` and thread to `--as-of`.
- [x] Add snapshot and diff endpoints if UI parity is required.
- [x] Enforce allowed repo roots and never return absolute paths in responses.
- [x] Follow `docs/specs/http-api.md` for request/response schemas, error codes, redaction, and allowlisting behavior.

Touchpoints:
- `tools/api/router/search.js`
- `tools/api/router/index-snapshots.js` (new)
- `tools/api/router/index-diffs.js` (new)
- `tools/api/validation.js` (schema updates for new params)
- `docs/specs/http-api.md`

Tests:
- [x] `tests/services/api-search-asof.test.js` (if API is added)

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

