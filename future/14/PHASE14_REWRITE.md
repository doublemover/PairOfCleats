## Phase 14 — Incremental Diffing & Snapshots (Time Travel, Regression Debugging)

### Objective

Introduce **first-class snapshot and diff artifacts** to enable:

- Query indexes **as-of** a prior build (time travel).
- Generate deterministic, bounded **“what changed”** artifacts between two index states.
- Support regression debugging, release auditing, and safer incremental reuse.

### Canonical specs (source of truth)

Phase 14 must be implemented according to these specs (they are authoritative for formats and semantics):

- `docs/specs/index-refs-and-snapshots.md` — IndexRef grammar + snapshot registry + freeze semantics
- `docs/specs/index-diffs.md` — diff identity + formats + deterministic event stream
- `docs/specs/as-of-retrieval-integration.md` — `--as-of` retrieval integration + cache safety
- `docs/specs/implementation-checklist.md` — file-level implementation checklist and acceptance criteria

**Roadmap rule**: this Phase 14 roadmap MUST NOT restate or fork JSON schemas, file layouts, or event formats.
Instead, it should reference the specs and focus on:
- task decomposition
- touchpoints
- acceptance criteria/tests
- risk controls and “no drift” guardrails

### Deliverables (Phase 14 exit criteria)

- IndexRef parser + resolver (`latest | build: | snap: | tag: | path:`) with stable `identityHash`
- Snapshot registry:
  - pointer snapshots (`snapshot.json`, manifest entry, tag reverse index)
  - frozen snapshots (atomic staging, `frozen.json`, `hasFrozen=true`)
- Diff registry + diff engine:
  - deterministic diff IDs derived from canonical inputs
  - bounded `summary.json` and deterministic `events.jsonl`
  - non-persistent default behavior for `path:` refs
- Retrieval integration:
  - `pairofcleats search ... --as-of <IndexRef>`
  - cache keys include `asOf.identityHash`
  - shard-aware index signature unified across retrieval code paths
- “No path leak” invariants enforced by tests (no absolute paths in persisted artifacts)

### Non-goals (Phase 14)

- Multi-repo federation / workspace orchestration (Phase 15)
- Distributed snapshot replication
- Background/async snapshotting
- Relaxing validation gates for snapshot creation (no `--allow-incomplete` in Phase 14)

---

## 14.1 Foundations: IndexRef + artifact surface (contracts, atomicity, path safety)

> This section establishes the core primitives that every later Phase 14 subsection depends on.
> Implement these first to avoid parallel “resolution logic” and avoid drift.

### 14.1.1 Implement IndexRef parsing + deterministic resolution (first deliverable)

- [ ] Create `src/index/index-ref.js` implementing:
  - [ ] `parseIndexRef(ref: string) -> ParsedIndexRef` **per spec**:
    - [ ] Normalize prefix case (`LATEST` → `latest`, `Build:` → `build:`)
    - [ ] Validate characters and lengths (buildId/snapshotId/tag)
    - [ ] Reject invalid refs with `createError(ERROR_CODES.INVALID_REQUEST, ...)`
  - [ ] `resolveIndexRef({ repoRoot, userConfig, requestedModes, preferFrozen=true, allowMissingModes=false }) -> ResolvedIndexRef` **per spec**:
    - [ ] Resolve `latest` using `repoCacheRoot/builds/current.json` promotion logic
    - [ ] Resolve `build:<id>` to `repoCacheRoot/builds/<id>`
    - [ ] Resolve `snap:<id>` via snapshot registry:
      - [ ] Prefer frozen root by default when `hasFrozen=true`
      - [ ] Detect and reject dangling pointer snapshots (missing referenced build roots)
    - [ ] Resolve `tag:<tag>` via manifest tag reverse index (most-recent-first)
    - [ ] Resolve `path:<pathValue>` (in-memory only; never persisted)
      - [ ] Enforce spec constraints: no persistence by default (diff spec governs)
      - [ ] `identity` must not include raw path; include only `pathHash` + warning
  - [ ] `identityHash = sha1(stableStringify(identity))` (spec canonical rule)
  - [ ] **Hard invariant**: `ResolvedIndexRef.identity` MUST contain no absolute paths.

Acceptance criteria:
- [ ] Re-resolving the same canonical IndexRef produces identical `identityHash`
- [ ] `tag:<tag>` resolution is deterministic given a stable manifest
- [ ] `preferFrozen=true` uses frozen roots when available
- [ ] Dangling snapshots fail with a clear error message

### 14.1.2 Define the on-disk public artifact surface (snapshots + diffs)

- [ ] Implement snapshot and diff on-disk layouts exactly as defined in specs:
  - [ ] Snapshots: `snapshots/manifest.json`, `snapshots/<id>/snapshot.json`, `snapshots/<id>/frozen.json`, `snapshots/<id>/frozen/...`
  - [ ] Diffs: `diffs/manifest.json`, `diffs/<diffId>/inputs.json`, `diffs/<diffId>/summary.json`, `diffs/<diffId>/events.jsonl`

Roadmap guardrail:
- [ ] Do not introduce alternate filenames (e.g., no `index_diff.jsonl`—use the spec-defined `events.jsonl`).

### 14.1.3 Contracts, schemas, and validation for new artifacts

- [ ] Extend the contracts layer to validate new artifacts:
  - [ ] Add schemas in `src/contracts/schemas/` (new module(s) if needed):
    - [ ] `snapshots/manifest.json`
    - [ ] `snapshots/<id>/snapshot.json`
    - [ ] `snapshots/<id>/frozen.json`
    - [ ] `diffs/manifest.json`
    - [ ] `diffs/<id>/inputs.json`
    - [ ] `diffs/<id>/summary.json`
  - [ ] Add validators in `src/contracts/validators/` and surface through `src/contracts/registry.js`
  - [ ] Ensure validators are testable in isolation (unit tests)

Notes:
- `src/shared/artifact-schemas.js` is a re-export; place schema definitions in `src/contracts/**`.

### 14.1.4 Atomic writes + crash safety + locking

- [ ] Use repo-scoped index lock for all registry mutations:
  - [ ] `src/index/build/lock.js#acquireIndexLock(repoCacheRoot, waitMs)`
  - [ ] Lock required for:
    - [ ] snapshot create/freeze/prune
    - [ ] diff persist/prune
- [ ] Implement all registry writes as atomic:
  - [ ] stable stringify + write temp + rename
  - [ ] registries must remain readable across crashes
- [ ] Implement staging cleanup rules (spec §7):
  - [ ] On startup of any snapshot command:
    - [ ] delete `frozen.staging-*` dirs older than configured threshold (default 24h)
  - [ ] `snapshot prune` also cleans stale staging directories

### 14.1.5 Path safety + privacy invariants (non-negotiable)

- [ ] Enforce “repo-cache-relative only” for any persisted path:
  - [ ] snapshot pointer `buildRootsByMode`
  - [ ] frozen root path
  - [ ] diff registry paths
- [ ] Reject `..` traversal and absolute paths in persisted values
- [ ] Add automated “no path leak” tests:
  - [ ] persisted snapshot artifacts contain no absolute filesystem paths
  - [ ] persisted diff artifacts contain no absolute filesystem paths
  - [ ] persisted diffs created from `path:` refs redact raw paths per diff spec

### 14.1.6 Retention policy plumbing (CLI first; optional config defaults)

- [ ] Implement prune commands per specs:
  - [ ] `pairofcleats index snapshot prune [policy flags]`
  - [ ] `pairofcleats index diff prune [policy flags]`
- [ ] Ensure protected tags are respected (never delete protected snapshots/diffs)
- [ ] Optional-but-recommended: add config defaults for retention and bounds:
  - [ ] Draft/implement `docs/specs/config-defaults.md` (see “Spec refresh/drafts” below)
  - [ ] Update `docs/config/schema.json` and config normalization to support new keys

Touchpoints:
- `src/index/index-ref.js` (new)
- `src/index/snapshots/**` (new)
- `src/index/diffs/**` (new)
- `src/index/build/lock.js` (existing; reuse)
- `src/contracts/**` (extend schemas/validators)
- `src/shared/stable-json.js` (reuse)
- `src/shared/hash.js` (reuse)
- `src/shared/json-stream.js` (reuse atomic write helper)
- `tools/dict-utils/*` (reuse repo cache root + current build info)

#### Tests (14.1)
- [ ] `tests/unit/index-ref.unit.js`
  - [ ] parsing/normalization validation
  - [ ] identityHash stability
  - [ ] tag resolution determinism (with fixture manifest)
  - [ ] path ref produces warnings and uses pathHash only
- [ ] `tests/unit/snapshots-contracts.unit.js`
  - [ ] schema validation for manifest/snapshot/frozen JSON
- [ ] `tests/unit/diffs-contracts.unit.js`
  - [ ] schema validation for diff manifest/inputs/summary JSON
- [ ] `tests/unit/no-path-leak.unit.js`
  - [ ] assert no absolute paths in persisted JSON artifacts

---

## 14.2 Pointer snapshots (creation, registry, CLI, validation gating)

### 14.2.1 Snapshot create (pointer)

- [ ] Implement `pairofcleats index snapshot create` per spec:
  - [ ] Inputs (per spec): `--repo`, `--modes`, `--id`, `--tag` (repeatable), `--label`, `--notes`, `--wait-ms`, `--json`
  - [ ] Acquire index lock (fail fast by default; allow `--wait-ms`)
  - [ ] Resolve `latest` for requested modes via IndexRef resolver
  - [ ] **Validation gate**:
    - [ ] For each referenced base root: require `<baseRoot>/build_state.json.validation.ok === true`
    - [ ] Missing build_state / missing validation / validation false ⇒ fail
  - [ ] Generate snapshotId if not provided (`snap-<YYYYMMDDHHMMSS>-<randomHex6>`)
  - [ ] Write `snapshots/<id>/snapshot.json` atomically (immutable after create)
  - [ ] Update `snapshots/manifest.json` atomically:
    - [ ] add snapshot summary entry (`kind:pointer`, `tags`, `label`, `hasFrozen:false`)
    - [ ] update tag reverse index (`tags[tag]` most-recent-first)
    - [ ] update `updatedAt`

Acceptance criteria:
- [ ] Snapshot create fails if any selected mode is not validated
- [ ] Snapshot create produces repo-cache-relative `buildRootsByMode` values
- [ ] Tag reverse index ordering is deterministic

### 14.2.2 Snapshot list/show

- [ ] Implement `pairofcleats index snapshot list` per spec:
  - [ ] Ordered by `createdAt desc`
  - [ ] Filter by tag (`--tag <tag>`) if requested
  - [ ] Machine output `--json` stable schema
- [ ] Implement `pairofcleats index snapshot show --snapshot <id>` per spec:
  - [ ] Prints `snapshot.json` and `frozen.json` if present
  - [ ] Clear error if snapshot missing/dangling

### 14.2.3 Snapshot prune (retention)

- [ ] Implement `pairofcleats index snapshot prune` per spec:
  - [ ] `--keep-frozen`, `--keep-pointer`, `--keep-tags`, `--max-age-days`, `--dry-run`, `--json`
  - [ ] Deterministic deletion ordering (oldest-first)
  - [ ] Never delete protected tags
  - [ ] Remove stale `frozen.staging-*` dirs as part of prune

### 14.2.4 API surface (optional; only if needed for UI parity)

- [ ] If API endpoints are required in Phase 14, implement them against the same registry and resolver:
  - [ ] `GET /index/snapshots`
  - [ ] `GET /index/snapshots/:id`
  - [ ] `POST /index/snapshots` (create)
  - [ ] Never return absolute paths
  - [ ] Enforce allowed repo roots (`allowedRepoRoots`) like existing API does
  - [ ] Spec required: `docs/specs/http-api.md` (draft in this rewrite pack)

Touchpoints:
- `bin/pairofcleats.js` (route `index snapshot` to tool script)
- `tools/index-snapshot.js` (new)
- `src/index/snapshots/registry.js` (new)
- `src/index/snapshots/create.js` (new; or in commands module)
- `src/index/index-ref.js` (reuse)
- `tools/api/router.js` + new router module(s) (optional)

#### Tests (14.2)
- [ ] `tests/services/snapshot-create.services.js`
  - [ ] build + promote; create pointer snapshot; assert manifest + snapshot.json created
  - [ ] fail when validation.ok is false or missing
  - [ ] tag reverse index updated correctly

---

## 14.3 Frozen snapshots (immutable copies + verification)

### 14.3.1 Freeze command: atomic staging + verified copy/link

- [ ] Implement `pairofcleats index snapshot freeze` per spec:
  - [ ] Acquire index lock
  - [ ] Load `snapshot.json`; verify exists
  - [ ] Determine source roots per mode from pointer mapping
  - [ ] Create staging dir: `snapshots/<id>/frozen.staging-<ts>/`
  - [ ] For each selected mode:
    - [ ] Read `<srcDir>/pieces/manifest.json` (required)
    - [ ] Copy/link each piece listed:
      - [ ] default method: `hardlink` with per-file fallback to copy on `EXDEV/EPERM/EACCES`
    - [ ] Always copy required metadata (`pieces/manifest.json`, `index_state.json`, etc.)
  - [ ] Optional: include sqlite/lmdb directories per spec flags
  - [ ] Verification (default true):
    - [ ] verify checksums vs pieces manifest
    - [ ] record verification stats in `frozen.json`
  - [ ] On verification failure:
    - [ ] delete staging dir
    - [ ] do not update manifest
  - [ ] Commit:
    - [ ] rename staging → `snapshots/<id>/frozen/` (atomic)
    - [ ] write `frozen.json` atomically
    - [ ] update manifest entry `hasFrozen=true` atomically

Acceptance criteria:
- [ ] Freeze is atomic (no partial frozen dir is “valid”)
- [ ] Frozen snapshot remains usable if original build roots are removed
- [ ] Frozen snapshot is preferred by resolver by default (`preferFrozen=true`)

### 14.3.2 Maintenance: staging cleanup and idempotency

- [ ] Cleanup stale `frozen.staging-*` dirs on command start (spec §7)
- [ ] Define idempotent behavior:
  - [ ] If frozen already exists and `hasFrozen=true`, freeze returns success (or requires a force flag; choose and document)
  - [ ] Must not re-copy unless explicitly forced

Touchpoints:
- `tools/index-snapshot.js` (freeze)
- `src/index/snapshots/freeze.js` (new)
- `src/index/snapshots/copy-pieces.js` (new; hardlink/copy + verify)
- `src/shared/hash.js` (checksums)
- `src/shared/json-stream.js` (atomic writes)

#### Tests (14.3)
- [ ] `tests/services/snapshot-freeze.services.js`
  - [ ] create pointer snapshot → freeze → validate frozen roots exist and can be used by resolver
  - [ ] simulate mid-copy failure → ensure no committed frozen dir
  - [ ] remove original build root → frozen still resolves

---

## 14.4 Deterministic diff computation (bounded, machine-readable, reproducible)

### 14.4.1 CLI + registry surface

- [ ] Implement `pairofcleats index diff` command group per diff spec:
  - [ ] `compute --from <IndexRef> --to <IndexRef> [options]`
  - [ ] `show --diff <diffId> [--json]`
  - [ ] `list [--mode <mode>|--modes <csv>] [--json]`
  - [ ] `prune [policy flags] [--dry-run] [--json]`
- [ ] Route `pairofcleats index diff ...` in `bin/pairofcleats.js` to `tools/index-diff.js`

### 14.4.2 Diff identity + persistence policy

- [ ] Implement canonical inputs construction (`inputsCanonical`) per diff spec
- [ ] Compute diffId deterministically:
  - [ ] `diffId = "diff_" + sha1(stableStringify(inputsCanonical)).slice(0, 16)`
  - [ ] Collision behavior: reuse if inputs identical; else fail (spec)
- [ ] Persistence rules per spec:
  - [ ] If any side is `path:`: default `persist=false`
  - [ ] `--persist-unsafe` allows persistence but must redact raw path and normalize ref to `path:<redacted>`
- [ ] Persisted output files (when persist=true):
  - [ ] `diffs/<id>/inputs.json`
  - [ ] `diffs/<id>/summary.json`
  - [ ] `diffs/<id>/events.jsonl` (stream)
  - [ ] update `diffs/manifest.json` (index only; canonical truth lives in inputs+summary)

### 14.4.3 Diff algorithm (semantic-v1): fast-path + bounded scanning

- [ ] Resolve both sides via IndexRef resolver (preferFrozen=true)
- [ ] Per mode:
  - [ ] Validate required artifacts exist (min: file_meta, chunk_meta, pieces manifest if available)
  - [ ] Fast-path:
    - [ ] If pieces manifests match exactly, emit zero diff for that mode and skip scanning
  - [ ] File diff (required):
    - [ ] Compute added/removed/modified
    - [ ] Rename detection (`--detect-renames`): pair added/removed by file hash deterministically
    - [ ] Emit file events as `events.jsonl` (`file.added`, `file.removed`, `file.modified`, `file.renamed`)
  - [ ] Chunk diff (best-effort, bounded):
    - [ ] Skip chunk diff if modified file count exceeds `maxChangedFiles` and emit limit event
    - [ ] Filter chunk_meta scanning to only the relevant `fileId` set (do not load all chunks)
    - [ ] Match chunks using spec logicalKey strategy (chunkId first, then logicalKey for unambiguous pairs)
    - [ ] Respect `maxChunksPerFile` policy (choose skip-with-limit behavior per spec recommendation)
    - [ ] Emit `chunk.added/removed/modified/moved` events
  - [ ] Relations diff (optional, default true):
    - [ ] Emit `relation.added/removed` events
- [ ] Deterministic ordering (must be byte-identical across runs):
  - [ ] Mode order: `code`, `prose`, `extracted-prose`, `records`
  - [ ] Within mode: sort by file path asc; chunk ordering and relation ordering per spec

### 14.4.4 Boundedness and deterministic truncation

- [ ] Enforce `--max-events`:
  - [ ] Emit events in deterministic order until limit reached
  - [ ] Emit limit event and mark summary appropriately
  - [ ] Ensure truncation behavior is deterministic (no nondeterministic “early exit”)

### 14.4.5 Optional integration hook: post-build diff emission (defer unless needed)

- [ ] If required, add an optional hook after successful build promotion:
  - [ ] compute diff vs previous `latest` build/snapshot
  - [ ] persist diff only after validation passes
  - [ ] ensure this hook is controlled by config/flags and included in incremental signatures (see below)

### 14.4.6 Incremental reuse hardening (must not regress Phase 13+ behavior)

- [ ] Before reusing “unchanged” incremental artifacts:
  - [ ] verify required artifacts exist via `pieces/manifest.json`
  - [ ] if missing/corrupt ⇒ disable reuse and rebuild
- [ ] Ensure incremental signature includes:
  - [ ] artifact schema hash
  - [ ] tool version
  - [ ] key feature flags affecting output
  - [ ] (if implemented) diff/snapshot emission toggles so changing settings invalidates reuse

Touchpoints:
- `tools/index-diff.js` (new)
- `src/index/diffs/compute.js` (new)
- `src/index/diffs/registry.js` (new)
- `src/index/diffs/events.js` (new; ordering helpers)
- `src/index/index-ref.js` (reuse)
- `src/index/build/incremental.js` (hardening)
- `src/shared/artifact-io.js` / new `jsonl-stream` helper (stream chunk_meta shards)

#### Tests (14.4)
- [ ] `tests/services/index-diff.services.js`
  - [ ] diffId determinism for same inputs
  - [ ] rename detection determinism
  - [ ] fast-path: identical pieces manifests produce zero diff
  - [ ] `path:` refs default to non-persistent and redact on `--persist-unsafe`
  - [ ] ordering is deterministic (byte-identical events.jsonl)
  - [ ] chunk diff scanning only touches targeted fileIds (fixture-based)
- [ ] `tests/storage/incremental/index-reuse-validation.services.js`
  - [ ] corrupt/remove required artifact and verify reuse is refused

---

## 14.5 Retrieval + tooling integration: `--as-of <IndexRef>` and “what changed” surfaces

### 14.5.1 Search CLI: add `--as-of <IndexRef>` end-to-end

- [ ] Implement as-of resolution at CLI startup per spec:
  - [ ] `pairofcleats search "<query>" --repo <path> --as-of <IndexRef>`
  - [ ] Default behavior unchanged when omitted (`latest`)
  - [ ] Resolve once into an immutable `AsOfContext` (`ref`, `resolved`, `identityHash`)
- [ ] Ensure JSON output includes `asOf` object as specified
- [ ] Ensure human output prints a single as-of line when `--as-of` provided

### 14.5.2 Cache correctness: include as-of identity

- [ ] Ensure query cache keys include `asOf.identityHash` (required)
- [ ] Ensure cache is stable and portable (no absolute paths in cache payload)

### 14.5.3 Index signature unification (shard-aware)

- [ ] Remove duplicated signature logic by making retrieval CLI use:
  - [ ] `src/retrieval/index-cache.js#buildIndexSignature`
- [ ] Confirm that modifying any shard changes signature:
  - [ ] `chunk_meta.parts/*`
  - [ ] other sharded artifacts that contribute to retrieval behavior

### 14.5.4 SQLite/LMDB backend policy for as-of (single-root constraint)

- [ ] Implement the spec’s single-root selection policy:
  - [ ] sqlite/lmdb base root = `code` root if present else fallback to first requested mode
  - [ ] if requested modes resolve to multiple base roots, treat sqlite/lmdb as unavailable unless explicitly forced
- [ ] Ensure behavior is clear and fails with actionable messages when forced

### 14.5.5 Diff surfacing commands (human + tool use)

- [ ] Implement diff surfacing commands per diff spec:
  - [ ] `index diff list/show`
  - [ ] (Optional) `index diff explain <diffId>`: human-readable top changes derived from summary + events tail/head
    - Keep this output format intentionally “unstable” unless you publish a spec for it

### 14.5.6 API integration (optional)

- [ ] Extend existing `/search` API payload to accept `asOf` (string IndexRef):
  - [ ] Add `payload.asOf` / `payload.as_of` (choose one; document)
  - [ ] Thread through to CLI args as `--as-of <IndexRef>`
- [ ] If implementing snapshot/diff endpoints, follow `docs/specs/http-api.md`

Touchpoints:
- `src/retrieval/cli-args.js` (add as-of)
- `src/retrieval/cli.js` (resolve AsOfContext)
- `src/retrieval/cli-index.js` (resolve index dirs from AsOfContext + cache key)
- `src/retrieval/index-cache.js` (reuse signature builder)
- `tools/api/router/search.js` (accept asOf in payload)
- `bin/pairofcleats.js` (route index snapshot/diff tools)

#### Tests (14.5)
- [ ] `tests/services/snapshot-query.services.js`
  - [ ] build snapshot A; modify repo; build snapshot B
  - [ ] search with `--as-of snap:A` vs `--as-of snap:B` differs as expected
  - [ ] `--as-of latest` matches default behavior
- [ ] `tests/unit/retrieval-cache-key-asof.unit.js`
  - [ ] same query + different asOf => different cache key
- [ ] `tests/unit/retrieval-index-signature-shards.unit.js`
  - [ ] signature changes when any shard changes
- [ ] `tests/services/api-search-asof.services.js` (if API updated)
  - [ ] POST /search with `asOf` routes to correct search result set

---

## Phase 14 — Source mapping (no-drift)

The authoritative sources for this phase are the Phase 14 specs:

- `docs/specs/index-refs-and-snapshots.md`
- `docs/specs/index-diffs.md`
- `docs/specs/as-of-retrieval-integration.md`
- `docs/specs/implementation-checklist.md`

If additional “idea” or “master roadmap” docs exist outside the repo, they MUST NOT be referenced here unless they are added to the repository and kept current.
