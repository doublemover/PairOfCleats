# PairOfCleats GigaRoadmap

## Status legend

Checkboxes represent the state of the work, update them to reflect the state of work as its being done:

- [x] Implemented and appears complete/correct based on code inspection and existing test coverage
- [@] In Progress, this work has been started
- [.] Work has been completed but has Not been tested
- [?] There is a correctness gap **or** there is missing/insufficient test proving behavior
- [ ] Not complete

Completed Phases: `COMPLETED_PHASES.md`

## Roadmap order (foundational-first, maximize leverage)

- Phase 5 — Metadata v2 + Effective Language Fidelity (Segments & VFS prerequisites)
- Phase 6 — Universal Relations v2 (Callsites, Args, and Evidence)
- Phase 7 — Embeddings + ANN: Determinism, Policy, and Backend Parity
- Phase 8 — Tooling Provider Framework & Type Inference Parity (Segment‑Aware)
- Phase 9 — Symbol identity (collision-safe IDs) + cross-file linking
- Phase 10 — Interprocedural Risk Flows (taint summaries + propagation)
- Phase 11 — Graph-powered product features (context packs, impact, explainability, ranking)
- Phase 12 — MCP Migration + API/Tooling Contract Formalization
- Phase 13 — JJ support (via provider API)
- Phase 14 — Incremental Diffing & Snapshots (Time Travel, Regression Debugging)
- Phase 15 — Federation & Multi-Repo (Workspaces, Catalog, Federated Search)
- Phase 16 — Prose ingestion + retrieval routing correctness (PDF/DOCX + FTS policy)
- Phase 17 — Vector-Only Index Profile (Embeddings-First)
- Phase 18 — Vector-Only Profile (Build + Search Without Sparse Postings)
- Phase 20 — Distribution & Platform Hardening (Release Matrix, Packaging, and Optional Python)
- Phase 19 — LibUV threadpool utilization (explicit control + docs + tests)
- Phase 20 — Threadpool-aware I/O scheduling guardrails
- Phase 14 — Documentation and Configuration Hardening
- Phase 24 — MCP server: migrate from custom JSON-RPC plumbing to official MCP SDK (reduce maintenance)

---

# Phase 5 — Metadata v2 + Effective Language Fidelity (Segments & VFS prerequisites)

## Objective

Deliver **contract-correct, backend-parity Metadata v2** and make **segments first-class language units** end-to-end.

This phase ensures:

- `metaV2` is **complete, stable, and finalized after enrichment** (no stale derived metadata).
- **SQLite and JSONL backends expose equivalent `metaV2`**, rather than SQLite returning a lossy reconstruction.
- Embedded/segmented code (Markdown fences, Vue `<script>`, etc.) carries an explicit **container vs effective language descriptor** used consistently by chunking, parsing, tooling selection, and retrieval filters.
- **TSX/JSX fidelity is preserved** during segment discovery and downstream parser/tool selection (effective ext drives tree-sitter grammar selection).
- A **VFS/segment-manifest foundation** exists (contract + required metadata fields) so Phase 8 tooling providers can operate on embedded code as if it were real files, with stable identities and source mapping.

---

## Scope boundaries

### In scope

- Fix `metaV2` type normalization so inferred parameter maps are preserved.
- Enforce **post-enrichment `metaV2` finalization** prior to serialization (JSONL + SQLite).
- Add **SQLite storage for the full `metaV2` object** and update retrieval to load it.
- Define and persist **container vs effective language identity** for each chunk (including segment-aware effective ext).
- Upgrade retrieval filtering and filter-index writing to support **effective language** filtering.

### Explicitly deferred (tracked, not ignored)

- **Evidence-rich callsite artifact** (`call_sites`) and full relations v2 surface: **Phase 6**.
- **Embeddings determinism + ANN parity** across backends: **Phase 7**.
- **Tooling provider framework + VFS materialization + segment-aware tooling passes**: **Phase 8**.
- **Collision-safe symbol identity and cross-file linking keys** (beyond minimal guardrails): **Phase 9**.

---

## Wwhy Phase 5 exists

These are the concrete issues that Phase 5 resolves:

1. **`metaV2.types.inferred.params` can be silently dropped**
   - `src/index/metadata-v2.js` uses `normalizeEntries(...)` which only normalizes array-valued type lists.
   - Cross-file inference produces `docmeta.inferredTypes.params` as an **object map `{ paramName: TypeEntry[] }`** (`src/index/type-inference-crossfile/apply.js`), so `metaV2` currently loses those entries during normalization.

2. **`metaV2` is serialized too early (stale after enrichment)**
   - `metaV2` is built in `src/index/build/file-processor/assemble.js` (and sometimes in cached-bundle repair code) but **cross-file inference runs later** in `src/index/build/indexer/steps/relations.js`.
   - Cross-file inference mutates `chunk.docmeta` (adds inferred types) and `chunk.codeRelations` (callLinks/usageLinks/callSummaries), so an assemble-time `metaV2` snapshot can be stale.

3. **Segment “effective language” is not persisted or respected in downstream analysis**
   - Segment discovery computes an effective extension (`resolveSegmentExt(...)`) and passes it into `smartChunk(...)`, but the file processor still:
     - tokenizes using the **container file extension**, and
     - runs docmeta/relations/flow using the **container language handler** (`src/index/build/file-processor/process-chunks.js`).
   - Result: embedded TS/TSX in `.md` or `.vue` is not analyzed with the correct language handler, and `metaV2.lang` reflects segment hints instead of registry language ids.

4. **SQLite backend does not store canonical `metaV2`**
   - SQLite schema lacks a `metaV2_json` (or equivalent) field; retrieval reconstructs a minimal stub `metaV2` (`src/retrieval/sqlite-helpers.js`).
   - SQLite chunk identity can become `NULL` when `metaV2` is gated off, because chunk ids are currently sourced from `chunk.metaV2.chunkId` in `buildChunkRow(...)` (`src/storage/sqlite/build-helpers.js`).

5. **Retrieval language filtering is extension-based**
   - `--lang` filters are currently implemented by mapping language → extension sets (`src/retrieval/filters.js`).
   - This cannot select embedded TS/TSX inside `.md` or `.vue` containers, even if analysis becomes segment-aware.

---

## Normative references (specs / contracts)

Phase 5 implementation MUST align with the following documents in `docs/`:

- `docs/metadata-schema-v2.md` (Metadata v2 contract)
- `docs/contracts/analysis-schemas.md` (schema notes / compatibility rules)
- `docs/contracts/artifact-schemas.md` (artifact registry + required fields)
- `docs/contracts/chunking.md` (chunk identity + offset semantics)
- `docs/contracts/sqlite.md` (SQLite tables / versioning expectations)
- `docs/spec_phase8_tooling_vfs_and_segment_routing_refined.md` (forward compatibility)

If Phase 5 introduces new contract fields (container/effective identity), it MUST update the above specs (and any referenced registry schema in `src/contracts/schemas/*`) in the same change set.

---

# 5.1 MetaV2 type normalization: preserve inferred parameter maps and split tooling types correctly

## Goal

Ensure `metaV2.types.inferred.params` (and `tooling.params`) is **never silently dropped** and is **canonicalized** as an object map `{ paramName: TypeEntry[] }`.

## Planned changes

- [ ] Fix inferred type normalization so param maps are preserved.
  - [ ] Update `normalizeEntries(...)` in `src/index/metadata-v2.js` to support:
    - `TypeEntry[]` (array list)
    - `Record<string, TypeEntry[]>` (object map keyed by param/property name)
  - [ ] Update `normalizeTypeMap(...)` to preserve nested maps rather than dropping them.
  - [ ] Ensure empty maps/lists normalize to `null` (not `{}` / `[]`) to preserve existing output compactness.

- [ ] Fix tooling split for nested param maps.
  - [ ] Update `splitToolingTypes(...)` to handle both shapes:
    - if `entries` is an array: current behavior (filter by `source === 'tooling'`)
    - if `entries` is an object map: split **per param key**, preserving `{ paramName: TypeEntry[] }`
  - [ ] Ensure the `types` object remains schema-valid under `METADATA_V2_SCHEMA`.

- [ ] Establish canonical producer shapes.
  - [ ] For **params**, canonical shape is an object map `{ paramName: TypeEntry[] }` for **declared**, **inferred**, and **tooling** buckets.
  - [ ] For **returns**, canonical shape remains `TypeEntry[]`.

- [ ] Add strict validation guardrails for drift (beyond what JSON schema can express).
  - [ ] In build-time validation (or `src/index/validate/checks.js`), add checks:
    - `metaV2.types.*.params` must be `null` or an object whose values are arrays of entries with `type`.
    - no type entry may omit `type`.
  - [ ] Validation should report which chunkIds violate the shape.

## Files

- `src/index/metadata-v2.js`
- `src/index/type-inference-crossfile/extract.js` (only if downstream assumptions need updates)
- `src/index/validate/checks.js` (or `src/contracts/schemas/analysis.js` if schema refined)
- `docs/metadata-schema-v2.md`
- `docs/contracts/analysis-schemas.md`

## Tests

- [ ] Extend `tests/metadata-v2.js` (or add targeted tests under `tests/contracts/`) to cover param maps:
  - Fixture docmeta includes `inferredTypes.params = { opts: [{type:'WidgetOpts', source:'tooling'}] }`.
  - Assert `metaV2.types.inferred.params.opts` exists and is a non-empty array.
- [ ] Add `tests/metadata-v2-param-map-tooling-split.test.js`
  - `docmeta.inferredTypes.params` contains mixed `source: tooling` and non-tooling entries.
  - Assert `metaV2.types.tooling.params.<name>` contains only tooling entries and `metaV2.types.inferred.params.<name>` contains the rest.
- [ ] Add `tests/validate/metav2-rejects-invalid-type-shapes.test.js`
  - Tamper `metaV2.types.inferred.params` into an array; strict validate must fail.

---

# 5.2 MetaV2 finalization: enforce enrichment-before-serialization ordering

## Goal

Guarantee that any enrichment that mutates `chunk.docmeta` or `chunk.codeRelations` happens **before** `metaV2` is serialized to:

- `chunk_meta` JSONL artifacts, and
- SQLite storage (when enabled).

## Planned changes

- [ ] Make `metaV2` generation explicitly **post-enrichment**.
  - [ ] Identify build steps that mutate chunks after assembly:
    - cross-file inference in `src/index/build/indexer/steps/relations.js`
    - any late structural/risk augmentation that modifies `chunk.docmeta` or `chunk.codeRelations`
  - [ ] Introduce a `finalizeMetaV2(chunks, context)` step that:
    - recomputes `chunk.metaV2 = buildMetaV2({ chunk, docmeta: chunk.docmeta, toolInfo, analysisPolicy })`
    - reuses the chunk’s effective/container identity fields (Phase 5.4)
    - is applied **once** after enrichment and before writing
  - [ ] Place `finalizeMetaV2` either:
    - at the end of `steps/relations.js`, or
    - at the beginning of `steps/write.js` (preferred if other steps may mutate chunks later).

- [ ] Remove stale-`metaV2` failure modes for cached bundles.
  - [ ] Ensure cached-bundle reuse (`src/index/build/file-processor/cached-bundle.js`) cannot bypass finalization.
  - [ ] If cached bundles rebuild `metaV2` during repair, finalization must still overwrite with the post-enrichment version.

- [ ] Add optional equivalence checks (debug/strict mode).
  - [ ] Add a helper that recomputes `metaV2` from the final chunk object and compares to the stored `chunk.metaV2`.
  - [ ] In strict mode, mismatches should fail validation (or at least emit a high-severity issue).

## Files

- `src/index/build/indexer/steps/relations.js`
- `src/index/build/indexer/steps/write.js`
- `src/index/build/file-processor/assemble.js` (ensure assemble-time `metaV2` is not treated as final)
- `src/index/build/file-processor/cached-bundle.js`
- `src/index/build/artifacts/writers/chunk-meta.js`
- `src/index/metadata-v2.js`

## Tests

- [ ] `tests/indexer/metav2-finalization-after-inference.test.js`
  - Build a fixture with `typeInferenceCrossFile: true`.
  - Assert `metaV2.types.inferred.params` and/or `metaV2.relations.callLinks` reflect cross-file inference results.
- [ ] `tests/file-processor/cached-bundle-does-not-emit-stale-metav2.test.js`
  - Force a cached-bundle reuse path.
  - Assert serialized `chunk_meta.metaV2` still includes post-inference enrichment.
- [ ] (Optional) `tests/indexer/metav2-recompute-equivalence.test.js`
  - Sample a subset of chunks; recompute metaV2 from chunk state; assert deep equality.

---

# 5.3 SQLite parity: store full metaV2 and enforce chunk identity invariants

## Goal

Remove SQLite’s lossy `metaV2` reconstruction by **storing the canonical `metaV2` JSON** per chunk, and enforce invariants:

- `chunk_id` is never `NULL`
- `metaV2.chunkId` and SQLite `chunk_id` match
- SQLite retrieval returns `metaV2` equivalent to JSONL (for required fields)

## Planned changes

- [ ] Add canonical `metaV2_json` storage to SQLite.
  - [ ] Update `src/storage/sqlite/schema.js`:
    - bump `SCHEMA_VERSION`
    - add `metaV2_json TEXT` to the `chunks` table
  - [ ] Update SQLite build path (`src/storage/sqlite/build-helpers.js` and writers):
    - persist `metaV2_json = JSON.stringify(chunk.metaV2)` (when available)
    - keep `docmeta` and `codeRelations` columns unchanged for compatibility
  - [ ] Update SQLite retrieval (`src/retrieval/sqlite-helpers.js`) to:
    - parse `metaV2_json` when present
    - fall back to the minimal stub only when `metaV2_json` is absent (legacy DB)

- [ ] Enforce non-null stable chunk identity in SQLite.
  - [ ] Update `buildChunkRow(...)` to compute `chunk_id` via `resolveChunkId(chunk)` (`src/index/chunk-id.js`) rather than only `chunk.metaV2.chunkId`.
  - [ ] Ensure `resolveChunkId` always returns a stable id even when `metaV2` is gated off by analysis policy.

- [ ] Add parity guardrails.
  - [ ] Define a required field set for `metaV2` parity checks (minimum):
    - `chunkId`, `file`, `range`, `lang`, `ext`
    - `types` (if present)
    - `relations` (if present)
    - `segment` (if present)
  - [ ] Add a validator check (strict mode) that compares JSONL vs SQLite for a sample of chunk ids.

## Files

- `src/storage/sqlite/schema.js`
- `src/storage/sqlite/build-helpers.js`
- `src/storage/sqlite/build.js` (and wherever inserts are executed, find them)
- `src/retrieval/sqlite-helpers.js`
- `src/index/chunk-id.js`
- `src/index/validate/checks.js`

## Tests

- [ ] `tests/sqlite/metav2-json-roundtrip.test.js`
  - Insert a row containing `metaV2_json`.
  - Retrieve and assert `metaV2` deep-equals the original.
- [ ] `tests/sqlite/chunk-id-non-null.test.js`
  - Ensure `buildChunkRow` emits `chunk_id` even if `chunk.metaV2` is null.
- [ ] `tests/sqlite/metav2-parity-with-jsonl.test.js`
  - Build the same fixture in JSONL and SQLite modes.
  - Retrieve the same chunk(s) via both.
  - Assert required `metaV2` fields deep-equality.

---

# 5.4 Effective language descriptor: persist container vs effective identity and run analysis on effective language

## Goal

Make embedded code analysis correct by ensuring:

- **container identity** (what file it lives in) is preserved, and
- **effective identity** (what language/ext it should be parsed as) is computed, persisted, and used consistently across:
  - tokenization
  - docmeta extraction
  - relations extraction
  - flow/risk analysis
  - type inference
  - tree-sitter grammar selection

## Planned changes

### 5.4.1 Segment discovery: preserve raw hints and persist effective ext

- [ ] Preserve TSX/JSX (and similar) language hints end-to-end.
  - [ ] Ensure Markdown fence normalization does **not** collapse `tsx → typescript` or `jsx → javascript` at discovery time.
    - (`src/index/segments/config.js` already preserves unknown hints; keep it that way.)
  - [ ] Ensure segment records preserve the raw hint as `segment.languageId`.

- [ ] Persist segment-derived effective extension.
  - [ ] In `src/index/segments.js` `chunkSegments(...)`, persist:
    - `segment.ext` (or `segment.effectiveExt`) = `resolveSegmentExt(containerExt, segment)`
  - [ ] Ensure the persisted value is included in chunk records handed to the file processor.

### 5.4.2 File processor: run analysis/tokenization using effective ext + language handler per chunk

- [ ] Resolve effective language per chunk.
  - [ ] Add a helper in `src/index/build/file-processor/process-chunks.js` to compute:
    - `containerExt` (from file path)
    - `containerLanguageId` (from `getLanguageForFile(...)` result)
    - `segmentLanguageId` (raw hint)
    - `effectiveExt` (segment.ext if present; else containerExt)
    - `effectiveLanguage` (via `getLanguageForFile({ ext: effectiveExt, relPath })`)
  - [ ] Use `effectiveExt` for:
    - `tokenizeChunkText({ ext: effectiveExt, ... })`
    - `buildTokenSequence({ ext: effectiveExt, ... })`
  - [ ] Use the effective language handler for:
    - `extractDocMeta`
    - `buildChunkRelations`
    - `flow` parsing
  - [ ] Pass `effectiveLanguageId` into:
    - `inferTypeMetadata`
    - `detectRiskSignals`

- [ ] Ensure tree-sitter selection uses effective ext, not container ext.
  - [ ] `language-registry` already selects TSX grammar when `ext === '.tsx'`; ensure effective ext is propagated to where tree-sitter language id selection happens.

### 5.4.3 MetaV2: encode container vs effective identity (contract change)

- [ ] Update `src/index/metadata-v2.js` to emit:
  - `metaV2.container = { ext: <containerExt>, languageId: <containerLanguageId> }`
  - `metaV2.effective = { ext: <effectiveExt>, languageId: <effectiveLanguageId> }`
  - `metaV2.lang = effectiveLanguageId` (top-level legacy field semantics updated)
  - `metaV2.ext = containerExt` (top-level legacy field remains container ext)
- [ ] Expand `metaV2.segment` to include fields needed for Phase 6/8:
  - `start`, `end`, `startLine`, `endLine` (container coordinates)
  - `embeddingContext` (if available)
  - keep `segmentId`, `type`, `languageId`, `parentSegmentId`

### 5.4.4 Chunk ID stability (identity hardening)

This is a prerequisite for correct caching, SQLite identity, and future graph joins.

- [ ] Make `chunkId` stable-by-location (do not depend on `kind`/`name`).
  - [ ] Update `src/index/chunk-id.js` `buildChunkId(...)` to hash only:
    - `file` (normalized rel path)
    - `segmentId` (or `''` if none)
    - `start`, `end` (container offsets)
  - [ ] Keep `kind`/`name` as debug attributes, not identity inputs.
  - [ ] If collisions are observed (rare), introduce a deterministic `chunkIndexWithinSpan` fallback rather than re-introducing semantic fields.
- [ ] Update docs to match reality:
  - `docs/contracts/chunking.md`
  - `docs/metadata-schema-v2.md`

> Note: collision-safe *symbol* identity and cross-file linking keys remain a Phase 9 deliverable. Phase 5 only ensures chunk span identity is stable and segment-aware.

## Files

- `src/index/segments.js`
- `src/index/segments/config.js`
- `src/index/build/file-processor/process-chunks.js`
- `src/index/language-registry/registry.js` (only if new resolver helper needed)
- `src/index/metadata-v2.js`
- `src/index/chunk-id.js`
- `docs/metadata-schema-v2.md`
- `docs/contracts/chunking.md`

## Tests

- [ ] `tests/segments/tsx-jsx-hint-preserved.test.js`
  - Markdown fixture containing ` ```tsx ` and ` ```jsx ` fences.
  - Assert `chunk.segment.languageId` preserves `tsx` / `jsx` (raw hints).
- [ ] `tests/segments/effective-identity-md-fence.test.js`
  - `.md` file with a `tsx` fence.
  - Assert:
    - `metaV2.container.ext === '.md'`
    - `metaV2.effective.ext === '.tsx'`
    - `metaV2.lang === 'typescript'`
- [ ] `tests/file-processor/effective-language-drives-docmeta.test.js`
  - Fixture with embedded TS fence defining a function.
  - Assert the chunk extracted from the fence has a non-null `name` / `signature` as produced by the TS handler (not markdown).
- [ ] `tests/chunk-id/stable-id-does-not-depend-on-name-or-kind.test.js`
  - Build two chunk-like objects identical in `{file, segmentId, start, end}` but differing `name/kind`.
  - Assert `buildChunkId(...)` returns the same value for both.

---

# 5.5 Retrieval filtering and filter-index upgrades: filter by effective language (not container ext)

## Goal

Make `--lang` filters (and any future language predicates) operate on **effective language id** so embedded TS/TSX can be found inside `.md`, `.vue`, etc.

## Planned changes

- [ ] Extend filter-index with `byLang` (effective language id).
  - [ ] Update `src/retrieval/filter-index.js`:
    - compute `effectiveLang = chunk.metaV2?.lang || chunk.metaV2?.effective?.languageId || null`
    - add `byLang: Map<languageId, Set<chunkNumericId>>`
  - [ ] Keep existing `byExt` semantics as **container ext**.

- [ ] Update language filter parsing to target `byLang`.
  - [ ] In `src/retrieval/filters.js`:
    - replace extension-list semantics for `--lang` with a list of language ids
    - allow common aliases (`ts` → `typescript`, `js` → `javascript`, etc.)
  - [ ] If `byLang` is missing (legacy index), fall back to extension mapping with an explicit warning.

- [ ] Output improvements (debuggable provenance).
  - [ ] Ensure retrieval outputs can surface:
    - container path + ext
    - effective language id + effective ext
    - segmentId and range when present

## Files

- `src/retrieval/filter-index.js`
- `src/retrieval/filters.js`
- `src/retrieval/search.js` (if filter plumbing requires)
- `docs/contracts/search-cli.md` (if `--lang` semantics are documented)

## Tests

- [ ] `tests/retrieval/lang-filter-matches-embedded-segments.test.js`
  - Fixture with `.md` TS fence.
  - Query with `--lang typescript` and assert embedded chunks are returned.
- [ ] `tests/retrieval/filter-index-bylang.test.js`
  - Build filter index and assert `byLang.typescript` includes embedded chunk ids.
- [ ] `tests/validate/filter-index-requires-bylang-when-segment-aware.test.js`
  - Strict validate fails if segment-aware metadata is present but `byLang` missing (opt-in rule).

---

# 5.6 VFS + segment manifest prerequisites (Phase 8 alignment)

## Goal

Phase 5 does **not** implement full VFS provider routing, but it must ensure that the metadata and contracts needed by Phase 8 exist and are stable.

## Planned changes

- [ ] Ensure `metaV2` contains all fields required to build a VFS manifest without re-parsing container files:
  - container path + container ext/lang
  - segmentId, segment type, segment range (start/end, startLine/endLine)
  - effective ext/lang
  - chunkId (stable)
- [ ] Add/Update a VFS manifest spec in `docs/` (if not already present):
  - `docs/spec-vfs-manifest-artifact.md` (v1)
  - It should define `vfs_manifest.jsonl` entries mapping `virtualPath → source` and include hashes for cacheability.
- [ ] Defer actual emission of `vfs_manifest.jsonl` and VFS materialization to Phase 8 unless Phase 6/7 needs it earlier.

## Files

- `docs/spec_phase8_tooling_vfs_and_segment_routing_refined.md`
- `docs/spec-vfs-manifest-artifact.md` (new/updated if missing)

## Tests (optional / Phase 8 if deferred)

- [ ] `tests/vfs/virtual-path-stability.test.js` (Phase 8)
- [ ] `tests/vfs/vfs-manifest-roundtrip.test.js` (Phase 8)

---

## Phase 5 exit criteria (definition of done)

Phase 5 is complete when:

- [ ] `metaV2.types.inferred.params` is preserved (no silent drops) and tooling splitting works for nested maps.
- [ ] `metaV2` is recomputed/finalized after cross-file enrichment and before artifact/SQLite writes.
- [ ] SQLite stores full `metaV2` per chunk and retrieval returns it (no minimal stub for new DBs).
- [ ] Every chunk has explicit container vs effective identity, and analysis/tokenization uses effective identity.
- [ ] `chunkId` is stable-by-location (independent of `kind`/`name`) and `chunk_id` is never null in SQLite.
- [ ] Retrieval supports `--lang` filtering on effective language id via `byLang`.

---

## Notes on Phase 6 / Phase 8 expectations

- Phase 6 callsite artifacts may compute offsets on segment slices; Phase 5 MUST ensure segment start/end and effective language identity are present so Phase 6 can translate offsets back to container coordinates without re-parsing containers.
- Phase 8 tooling providers require a deterministic mapping from segments to virtual paths; Phase 5 MUST preserve enough metadata (segment ranges + effective ext/lang + stable ids) to generate `vfs_manifest.jsonl` deterministically.

---

## Plan quality: what I would do differently (and why)

- Prefer **hard contract truth** over “best-effort” legacy behavior:
  - If `docs/contracts/chunking.md` states `chunkId` is stable, Phase 5 should make it *actually stable* (remove `kind/name` inputs) rather than tolerating churn.
- Keep **container vs effective identity** explicit and redundant:
  - Store container identity in `metaV2.container` and keep `metaV2.ext` as the container ext for compatibility.
  - Store effective identity in `metaV2.effective` and make `metaV2.lang` match effective language id.
  - This redundancy reduces migration risk and keeps existing readers functioning.
- Treat ambiguous symbol linking as unsafe:
  - If Phase 5 makes segments “more analyzable”, it will increase same-file name collisions. Even if Phase 9 owns the full identity solution, Phase 5 should add validation warnings (at minimum) when cross-file inference sees ambiguous keys, to avoid silently linking wrong targets.

---

## Phase 6 — Universal Relations v2 (Callsites, Args, and Evidence)

### Objective

Upgrade relations extraction and graph integration so we can produce **evidence‑rich, language‑aware callsite data** (callee + receiver + argument shape + precise location) in a **first‑class, contract‑validated artifact** (`call_sites`), and so downstream systems can use **stable identities** (chunk UID / symbol identity where available) rather than ambiguous `file::name` joins.

This phase explicitly targets:

- **CallDetails v2** (structured callsite data, not just `{caller, callee}` strings)
- A **sharded, JSONL** `call_sites` artifact (with meta + manifest inventory)
- **Deterministic ordering** + **segment‑safe absolute offsets**
- **Graph correctness improvements** (prefer `call_sites`; eliminate reliance on `file::name` uniqueness)
- **JS/TS first** (others staged behind a follow‑on phase if not completed here)

### Exit Criteria

- `call_sites` is emitted (when relations are enabled) as sharded JSONL + meta, referenced by the pieces manifest, and validated by the validator.
- JS + TS callsites include: absolute offsets, callee raw + normalized, receiver (when applicable), and a bounded arg summary.
- A segment fixture (e.g., `.vue` or fenced block) demonstrates **absolute offset translation** back to the container file.
- Graph building can consume `call_sites` (preferred) and remains compatible with the legacy `callLinks` fallback.
- No path in the relations→graph pipeline requires `file::name` as a unique key (it may remain as debug/display-only).

---

### Phase 6.1 — CallDetails v2 and `call_sites` contract (schema + invariants)

- [ ] Define a **CallSite (CallDetails v2)** record shape with bounded fields and deterministic truncation rules.
  - Contract fields (minimum viable, JS/TS-focused):
    - `callerChunkUid` (stable string id; current code uses `metaV2.chunkId`)
    - `callerDocId` (optional integer doc id, for quick joins; not stable across builds)
    - `relPath` (container repo-relative path)
    - `languageId` (effective language for this callsite; segments must use segment language)
    - `segmentId` (optional; debug-only)
    - `start`, `end` (absolute offsets in the _container_ file)
    - `startLine`, `endLine` (optional; must agree with offsets when present)
    - `calleeRaw` (as written / best-effort string form)
    - `calleeNormalized` (best-effort normalized target name, e.g., leaf name)
    - `receiver` (best-effort; e.g., `foo` for `foo.bar()`; null when not applicable)
    - `args` (bounded list of arg summaries; see Phase 6.3)
    - `kwargs` (reserved; populate for languages that support named args, e.g., Python)
    - `confidence` (bounded numeric or enum; must be deterministic)
    - `evidence` (bounded list of short tags/strings; deterministic ordering)
  - Enforce hard caps (examples; choose concrete values and test them):
    - max args per callsite
    - max arg text length / max nested shape depth
    - max evidence items + max evidence item length
  - Deterministic truncation must use a consistent marker (e.g., `…`) and must not depend on runtime/platform.
- [ ] Add schema validation for `call_sites` entries.
  - Touchpoints:
    - `src/shared/artifact-schemas.js` (AJV validators)
    - `src/index/validate.js` (wire validation when artifact is present)
  - Notes:
    - Keep schema permissive enough for forward evolution, but strict on required invariants and field types.
    - Ensure identity fields are unambiguous: distinguish **doc id** vs **stable chunk uid** (avoid reusing “chunkId” for both).
- [ ] Update documentation for the new contract.
  - Touchpoints:
    - `docs/artifact-contract.md` (artifact inventory + semantics)
    - If needed: `docs/metadata-schema-v2.md` (to clarify identity fields used for joins)
  - Include at least one example callsite record for JS and TS.

#### Tests / Verification

- [ ] Add a schema test that validates a representative `call_sites` entry (including truncation edge cases).
- [ ] Add a “reject bad contract” test case (missing required fields, wrong types, oversized fields).
- [ ] Verify that validation runs in CI lanes that already validate artifact schemas.

---

### Phase 6.2 — Emit `call_sites` as a first‑class, sharded JSONL artifact (meta + manifest)

- [ ] Implement a dedicated writer for `call_sites` that is sharded by default.
  - Touchpoints:
    - `src/index/build/artifacts.js` (enqueue the writer in the build)
    - `src/index/build/artifacts/writers/` (new `call-sites.js`)
    - `src/shared/json-stream.js` and/or `src/shared/artifact-io.js` (shared helpers; reuse existing patterns)
  - Output shape (recommended):
    - `pieces/call_sites/meta.json` (counts, shard size, formatVersion, etc.)
    - `pieces/call_sites/part-000.jsonl`, `part-001.jsonl`, … (entries)
  - Writer requirements:
    - Deterministic shard ordering and deterministic within-shard ordering.
    - Streaming write path (avoid holding all callsites in memory when possible).
    - Compression behavior should follow existing artifact conventions (if used elsewhere).
- [ ] Inventory `call_sites` in the manifest and ensure manifest-driven discovery.
  - `call_sites` must be discoverable via `pieces/manifest.json` (no directory scanning / filename guessing in readers).
- [ ] Wire validator support for `call_sites`.
  - Touchpoints:
    - `src/index/validate.js`
  - Validation behavior:
    - If present, validate (fail closed).
    - If absent, do not fail; the graph builder must fall back cleanly (Phase 6.5).
- [ ] Decide and document the compatibility posture for existing relations artifacts.
  - Recommended:
    - Keep existing lightweight relations (e.g., `callLinks`) intact for backward compatibility.
    - Do **not** bloat `file_relations` with full callsite evidence; `call_sites` is the dedicated “large” artifact.

#### Tests / Verification

- [ ] Add an artifact-format test that builds an index and asserts:
  - [ ] `call_sites` parts + meta exist when relations are enabled.
  - [ ] `pieces/manifest.json` includes the `call_sites` piece(s).
  - [ ] Validation passes for `call_sites`.
- [ ] Add a determinism test that rebuilds twice and asserts the `call_sites` content is byte-identical (or at least line-identical) for a fixed fixture repo.

---

### Phase 6.3 — JS + TS callsite extraction with structured args (CallDetails v2)

- [ ] Upgrade JavaScript relations extraction to emit CallDetails v2 fields needed by `call_sites`.
  - Touchpoints:
    - `src/lang/javascript/relations.js`
  - Requirements:
    - Capture callsite `start/end` offsets (range) and `startLine/endLine` (from `loc`) for each call expression.
    - Provide `calleeRaw`, `calleeNormalized`, and `receiver` where applicable:
      - e.g., `foo.bar()` → `calleeRaw="foo.bar"`, `calleeNormalized="bar"`, `receiver="foo"`
    - Emit a bounded, deterministic arg summary (`args`):
      - minimum: arity + “simple literal flags” (string/number/bool/null/object/array/function/spread/identifier)
      - must never include unbounded text (cap string literal previews, object literal previews, etc.)
    - Maintain compatibility for existing consumers that read `callDetails.args` today:
      - either provide a backwards-compatible view, or update consumers in Phase 6.5.
- [ ] Upgrade TypeScript relations extraction to produce call details (not just regex call edges).
  - Touchpoints:
    - `src/lang/typescript/relations.js`
    - Babel parsing helpers (e.g., `src/lang/babel-parser.js`)
  - Requirements:
    - Use an AST-based extraction path (Babel) to capture args + locations.
    - Respect TSX/JSX where appropriate (see Phase 6.4 for segment language fidelity hooks).
- [ ] Ensure language handlers expose call details consistently through the language registry.
  - Touchpoints:
    - `src/index/language-registry/registry.js` (relations plumbing expectations)
  - Notes:
    - Keep output consistent across JS and TS so downstream systems can be language-agnostic.

#### Tests / Verification

- [ ] Add a JS fixture with:
  - [ ] free function call
  - [ ] method call (`obj.method()`)
  - [ ] nested call (`fn(a(b()))`)
  - [ ] spread args and literal args
  - Assert extracted callsites include expected `calleeNormalized`, receiver (when applicable), and bounded arg summaries.
- [ ] Add a TS fixture (and a TSX/JSX fixture if feasible) with:
  - [ ] typed function call
  - [ ] optional chaining call (if supported by parser)
  - [ ] generic call (if supported)
  - Assert callsite locations + args are extracted.

---

### Phase 6.4 — Segment-safe absolute positions, chunk attribution, and deterministic ordering

- [ ] Ensure callsite positions are **absolute offsets in the container file** (segment-safe).
  - Touchpoints (depending on where translation is implemented):
    - `src/index/build/file-processor.js` (segment discovery + per-segment dispatch)
    - `src/index/segments.js` (language normalization/fidelity)
    - Language relation extractors (if they run on segment text)
  - Requirements:
    - If callsite extraction is performed on a segment slice, translate:
      - `absStart = segment.start + segStart`
      - `absEnd = segment.start + segEnd`
    - `segmentId` may be recorded for debugging, but offsets must not depend on it.
- [ ] Attribute each callsite to the correct caller chunk **without relying on name-only joins**.
  - Touchpoints:
    - `src/index/build/file-processor/relations.js` (call index construction)
    - `src/index/language-registry/registry.js` (chunk relation attachment)
  - Requirements:
    - Prefer range containment (callsite offset within chunk start/end), selecting the smallest/innermost containing chunk deterministically.
    - If containment is ambiguous or no chunk contains the callsite, record the callsite with `callerChunkUid = null` only if the contract permits it; otherwise attach to a deterministic “file/module” pseudo-caller (choose one approach and document it).
- [ ] Fix segment language fidelity issues that would break JS/TS/TSX call extraction for embedded segments.
  - Touchpoints:
    - `src/index/segments.js` (do not collapse `tsx→typescript` or `jsx→javascript` if it prevents correct tooling selection)
    - `src/index/build/file-processor/tree-sitter.js` (ensure embedded TSX/JSX segments can select the correct parser when container ext differs)
  - If full segment-as-virtual-file semantics are not yet implemented, explicitly defer the broader contract work to **Phase 7 — Segment-Aware Analysis Backbone & VFS**, but Phase 6 must still support segment callsite offset translation for the JS/TS fixtures included in this phase.
- [ ] Define and enforce deterministic ordering for callsites prior to writing.
  - Canonical sort key (recommended):
    - `relPath`, `callerChunkUid`, `start`, `end`, `calleeNormalized`, `calleeRaw`
  - Ensure ties are broken deterministically (no stable-sort assumptions across runtimes).

#### Tests / Verification

- [ ] Add a container/segment fixture (e.g., `.vue` with `<script>` block or `.md` with a fenced TSX block) and assert:
  - [ ] extracted callsite `start/end` positions map correctly to the container file
  - [ ] `languageId` reflects the embedded language, not the container file type
- [ ] Add a determinism test ensuring callsite ordering is stable across rebuilds.

---

### Phase 6.5 — Graph integration and cross-file linking (prefer `call_sites`, eliminate `file::name` reliance)

- [ ] Produce `call_sites` entries that carry resolved callee identity when it is uniquely resolvable.
  - Touchpoints:
    - `src/index/type-inference-crossfile/pipeline.js` (symbol resolution / linking)
    - `src/index/build/indexer/steps/relations.js` (where cross-file inference is orchestrated)
  - Requirements:
    - Add `targetChunkUid` (and optional `targetDocId`) when the callee can be resolved uniquely.
    - If resolution is ambiguous:
      - record bounded `targetCandidates` (or similar) and keep `targetChunkUid=null`
      - never silently drop the callsite edge
    - If resolution requires a full SymbolId contract, defer that strengthening to **Phase 8 — Symbol Identity v1**, but Phase 6 must still remove _required_ reliance on `file::name` uniqueness.
- [ ] Replace `file::name`-keyed joins in cross-file inference and graph assembly with stable chunk UIDs.
  - Touchpoints:
    - `src/index/type-inference-crossfile/pipeline.js` (today uses `chunkByKey` keyed by `${file}::${name}`)
    - `src/index/build/graphs.js` (today uses `legacyKey = "${file}::${name}"`)
  - Requirements:
    - Maintain a non-unique secondary index by `(file,name)` only as a best-effort hint.
    - Where multiple candidates exist, propagate ambiguity rather than picking arbitrarily.
- [ ] Update graph construction to prefer `call_sites` when available.
  - Touchpoints:
    - `src/index/build/graphs.js`
    - artifact loading helpers (reader side), if graph build is performed after artifact load
  - Requirements:
    - If `call_sites` is present, use it as the edge source of truth (it includes evidence + stable ids).
    - If absent, fall back to `callLinks` as currently emitted, but keep improved identity handling.
- [ ] Ensure `metaV2` consistency after post-processing that mutates docmeta/relations.
  - Sweep integration: cross-file inference mutates `docmeta`/`codeRelations` after `metaV2` is built.
  - Touchpoints (choose one approach and enforce it):
    - rebuild `metaV2` in a finalization pass before writing artifacts, or
    - compute `metaV2` lazily at write time from canonical fields, or
    - strictly forbid post-assembly mutation (move mutation earlier).
  - If this is already solved by an earlier contract phase, add a verification test here to prevent regressions.

#### Tests / Verification

- [ ] Add a graph integration test that:
  - [ ] builds a small fixture repo
  - [ ] asserts the call graph edges exist using `call_sites` (preferred path)
  - [ ] validates fallback behavior when `call_sites` is absent/disabled
- [ ] Add a regression test that demonstrates `file::name` collisions do not corrupt graph joins (ambiguity is handled deterministically and visibly).

---

## Phase 7 — Embeddings + ANN: Determinism, Policy, and Backend Parity

### Objective

Make embeddings generation and ANN retrieval **deterministic, build-scoped, and policy-driven** across all supported backends (HNSW, LanceDB, and SQLite dense). This phase hardens the end-to-end lifecycle:

- Embeddings are **optional**, but when enabled they are **contracted**, discoverable, and validated.
- Embeddings jobs are **bound to a specific build output** (no implicit “current build” writes).
- Quantization/normalization rules are **consistent** across tools, caches, and query-time ANN.
- ANN backends behave predictably under real-world constraints (candidate filtering, partial failure, missing deps).

### Exit Criteria

- Embeddings can be **disabled** without breaking builds, validation, or CI.
- When embeddings are enabled, artifacts are **consistent, validated, and build-scoped** (no cross-build contamination).
- HNSW and LanceDB ANN results are **stable and correctly ranked**, with clear selection/availability signaling.
- CI can run without optional native deps (e.g., LanceDB) using an explicit **skip protocol**, while still providing meaningful ANN coverage where possible.

---

### Phase 7.1 — Build-scoped embeddings jobs and best-effort enqueue semantics

- [ ] **Bind embeddings jobs to an explicit build output target (no “current build” inference).**
  - [ ] Extend the embedding job payload to include an immutable provenance tuple and target paths:
    - [ ] `buildId` and `buildRoot` (or an explicit `indexRoot`) for the build being augmented.
    - [ ] `mode` (`code` / `prose`) and the exact `indexDir` (the per-mode output directory) the job must write into.
    - [ ] `configHash` (or equivalent) used to build the base index.
    - [ ] `repoProvenance` snapshot (at minimum: repo path + commit/branch if available).
    - [ ] `embeddingIdentity` + `embeddingIdentityKey` (already present in queue schema; ensure always populated).
    - [ ] A monotonically increasing `embeddingPayloadFormatVersion` that gates behavior.
  - [ ] Update `src/index/build/indexer/pipeline.js` to pass build-scoped paths into `enqueueEmbeddingJob(...)`.
  - [ ] Update `src/index/build/indexer/embedding-queue.js` to accept and forward these fields.
  - Touchpoints:
    - `src/index/build/indexer/pipeline.js`
    - `src/index/build/indexer/embedding-queue.js`
    - `tools/service/queue.js`

- [ ] **Make embedding job enqueue best-effort when embeddings are configured as a service.**
  - [ ] Wrap queue-dir creation and `enqueueJob(...)` in a non-fatal path when `runtime.embeddingService === true`.
    - If enqueue fails, log a clear warning and continue indexing.
    - Ensure indexing does **not** fail due solely to queue I/O failures.
  - [ ] Record “embeddings pending/unavailable” state in `index_state.json` when enqueue fails.
  - Touchpoints:
    - `src/index/build/indexer/embedding-queue.js`
    - `src/index/build/indexer/steps/write.js` (state recording)

- [ ] **Ensure the embeddings worker/runner honors build scoping.**
  - [ ] Update the embeddings job runner (currently `tools/indexer-service.js`) so `build-embeddings` is executed with an explicit `--index-root` (or equivalent) derived from the job payload.
  - [ ] Add defensive checks: if job payload references a missing buildRoot/indexDir, the job must fail without writing output.
  - [ ] Add backwards compatibility behavior for old jobs:
    - If `embeddingPayloadFormatVersion` is missing/old, either refuse the job with a clear error **or** run in legacy mode but emit a warning.
  - Touchpoints:
    - `tools/indexer-service.js`
    - `tools/build-embeddings/cli.js` (ensuring `--index-root` is usable everywhere)

#### Tests / Verification

- [ ] Add `tests/embeddings/job-payload-includes-buildroot.test.js`
  - Verify queue job JSON includes `buildId`, `buildRoot`/`indexRoot`, `indexDir`, `configHash`, and embedding identity fields.
- [ ] Add `tests/embeddings/optional-no-service.test.js`
  - Simulate missing/unwritable queue dir and assert indexing still succeeds with embeddings marked pending/unavailable.
- [ ] Add `tests/embeddings/worker-refuses-mismatched-buildroot.test.js`
  - Provide a job with an invalid/nonexistent target path and assert the runner fails without producing/altering embeddings artifacts.

---

### Phase 7.2 — Embeddings artifact contract and explicit capability signaling

- [ ] **Define the canonical “embeddings artifacts” contract and make it discoverable.**
  - [ ] Treat the existing dense-vector outputs as the formal embeddings artifact surface:
    - `dense_vectors_uint8.json` (+ any per-mode variants)
    - `dense_vectors_hnsw.bin` + `dense_vectors_hnsw.meta.json`
    - `dense_vectors_lancedb/` + `dense_vectors_lancedb.meta.json`
    - Optional SQLite dense tables when enabled (`dense_vectors`, `dense_meta`, and ANN table)
  - [ ] Ensure embeddings artifacts are present in `pieces/manifest.json` when available and absent when not.
  - Touchpoints:
    - `tools/build-embeddings/manifest.js`
    - `src/index/build/artifacts.js` (piece emission rules)

- [ ] **Emit embedding identity and quantization policy into state and metadata, regardless of build path.**
  - [ ] Ensure `index_state.json.embeddings` always includes:
    - `enabled`, `ready/present`, `mode` (inline/service), and a clear `reason` when not ready.
    - `embeddingIdentity` and `embeddingIdentityKey`.
    - Backend availability summary for this build (HNSW/LanceDB/SQLite dense), including dims + metric/space where applicable.
  - [ ] Align `src/index/build/indexer/steps/write.js` with `tools/build-embeddings/run.js` so inline embeddings builds also include identity/key.
  - Touchpoints:
    - `src/index/build/indexer/steps/write.js`
    - `tools/build-embeddings/run.js`

- [ ] **Harden validation for embeddings presence and consistency.**
  - [ ] Extend strict validation to enforce, when embeddings are present:
    - Dense vector count matches chunk count for the mode.
    - Dimensions match across dense vectors and any ANN index metadata.
    - Model/identity metadata is internally consistent (identity key stable for that build).
  - [ ] When embeddings are absent, validation should still pass but surface a clear “embeddings not present” indicator.
  - Touchpoints:
    - `src/index/validate.js`

- [ ] **Add missing-embeddings reporting (and optional gating).**
  - [ ] Track missing vectors during embedding build (code/doc/merged) instead of silently treating them as equivalent to an all-zero vector.
    - Preserve existing “fill missing with zeros” behavior only as an internal representation, but record missing counts explicitly.
  - [ ] Add configurable thresholds (e.g., maximum allowed missing rate) that can mark embeddings as failed/unusable for ANN.
    - If threshold exceeded: do not publish ANN index availability and record reason in state.
  - Touchpoints:
    - `tools/build-embeddings/embed.js`
    - `tools/build-embeddings/run.js`
    - `src/index/build/indexer/file-processor/embeddings.js` (if inline embeddings path participates)

#### Tests / Verification

- [ ] Add `tests/validate/embeddings-referential-integrity.test.js`
  - Corrupt dense vector count or dims and assert strict validation fails with a clear error.
- [ ] Add `tests/validate/embeddings-optional-absence.test.js`
  - Validate an index without embeddings artifacts and assert validation passes with a “not present” signal.
- [ ] Add `tests/embeddings/missing-rate-gating.test.js`
  - Force a controlled missing-vector rate and assert state/reporting reflects the gating outcome.

---

### Phase 7.3 — Quantization invariants (levels clamp, safe dequantization, no uint8 wrap)

- [ ] **Enforce `levels ∈ [2, 256]` everywhere for uint8 embeddings.**
  - [ ] Clamp in quantization parameter resolution:
    - Update `src/storage/sqlite/vector.js: resolveQuantizationParams()` to clamp levels into `[2, 256]`.
    - Emit a warning when user config requests `levels > 256` (explicitly noting coercion).
  - [ ] Clamp at the quantizer:
    - Update `src/shared/embedding-utils.js: quantizeEmbeddingVector()` to mirror clamping (or route callers to `quantizeEmbeddingVectorUint8`).
    - Ensure no code path can produce values outside `[0, 255]` for “uint8” vectors.
  - [ ] Fix call sites that currently risk wrap:
    - `src/index/embedding.js` (`quantizeVec`) and its downstream usage in incremental updates.
    - `src/storage/sqlite/build/incremental-update.js` packing paths.
  - Touchpoints:
    - `src/shared/embedding-utils.js`
    - `src/storage/sqlite/vector.js`
    - `src/index/embedding.js`
    - `src/storage/sqlite/build/incremental-update.js`

- [ ] **Fix dequantization safety and parameter propagation.**
  - [ ] Update `dequantizeUint8ToFloat32(...)` to avoid division-by-zero when `levels <= 1` and to use clamped params.
  - [ ] Thread quantization params into LanceDB writer:
    - Update `tools/build-embeddings/lancedb.js: writeLanceDbIndex({ ..., quantization })`.
    - Call `dequantizeUint8ToFloat32(vec, minVal, maxVal, levels)` (no defaults).
  - Touchpoints:
    - `src/storage/sqlite/vector.js`
    - `tools/build-embeddings/lancedb.js`

- [ ] **Regression protection for embedding vector merges.**
  - [ ] Ensure `mergeEmbeddingVectors(code, doc)` does not incorrectly dampen single-source vectors.
    - If this is already fixed earlier, add/keep a regression test here (this phase modifies embedding utilities heavily).
  - Touchpoints:
    - `src/shared/embedding-utils.js`

- [ ] **Decide and document endianness portability for packed integer buffers.**
  - Current pack/unpack helpers rely on platform endianness.
  - [ ] Either:
    - Implement fixed-endian encoding/decoding with backward compatibility, **or**
    - Explicitly record endianness in metadata and defer full portability to a named follow-on phase.
  - Deferred (if not fully addressed here): **Phase 11 — Index Portability & Migration Tooling**.

#### Tests / Verification

- [ ] Add `tests/unit/quantization-levels-clamp.test.js`
  - Pass `levels: 512` and assert it clamps to `256` (and logs a warning).
- [ ] Add `tests/unit/dequantize-levels-safe.test.js`
  - Call dequantization with `levels: 1` and assert no crash and sane output.
- [ ] Add `tests/regression/incremental-update-quantize-no-wrap.test.js`
  - Ensure packed uint8 values never wrap for large `levels` inputs.
- [ ] Extend `tests/lancedb-ann.js` to run with non-default quantization params and verify ANN still functions.

---

### Phase 7.4 — Normalization policy consistency across build paths and query-time ANN

- [ ] **Centralize normalization policy and apply it everywhere vectors enter ANN.**
  - [ ] Create a shared helper that defines normalization expectations for embeddings (index-time and query-time).
    - Prefer deriving this from `embeddingIdentity.normalize` to ensure build outputs and query behavior remain compatible.
  - [ ] Apply consistently:
    - Fresh build path (`tools/build-embeddings/embed.js`).
    - Cached build path (`tools/build-embeddings/run.js`).
    - Query-time ANN (HNSW provider via `src/shared/hnsw.js` and/or the embedder).
  - Touchpoints:
    - `src/shared/embedding-utils.js` (or a new shared policy module)
    - `tools/build-embeddings/embed.js`
    - `tools/build-embeddings/run.js`
    - `src/shared/hnsw.js`

- [ ] **Normalize persisted per-component vectors when they are intended for retrieval.**
  - [ ] Ensure `embed_code_u8` and `embed_doc_u8` are quantized from normalized vectors (or explicitly mark them as non-retrieval/debug-only and keep them out of ANN pathways).
  - Touchpoints:
    - `tools/build-embeddings/embed.js`

#### Tests / Verification

- [ ] Add `tests/unit/normalization-policy-consistency.test.js`
  - Assert fresh vs cached paths produce equivalent normalized vectors for the same input.
- [ ] Add `tests/integration/hnsw-rebuild-idempotent.test.js`
  - Build embeddings twice (cache hit vs miss) and assert stable ANN outputs for a fixed query set.

---

### Phase 7.5 — LanceDB ANN correctness and resilience

- [ ] **Promise-cache LanceDB connections and tables to prevent redundant concurrent opens.**
  - [ ] Change `src/retrieval/lancedb.js` connection/table caching to store promises, not only resolved objects.
  - Touchpoints:
    - `src/retrieval/lancedb.js`

- [ ] **Fix candidate-set filtering under-return so `topN` is honored.**
  - [ ] When candidate filtering cannot be pushed down (or is chunked), ensure the query strategy returns at least `topN` results after filtering (unless the candidate set is smaller).
    - Options include iterative limit growth, chunked `IN (...)` pushdown + merge, or multi-pass querying.
  - Touchpoints:
    - `src/retrieval/lancedb.js`

- [ ] **Harden `idColumn` handling and query safety.**
  - [ ] Quote/escape `idColumn` (and any identifiers) rather than interpolating raw strings into filters.
  - [ ] Ensure candidate IDs are handled safely for numeric and string identifiers.
  - Touchpoints:
    - `src/retrieval/lancedb.js`

- [ ] **Replace global `warnOnce` suppression with structured/rate-limited warnings.**
  - Avoid hiding repeated failures after the first warning.
  - Touchpoints:
    - `src/retrieval/lancedb.js`

- [ ] **Keep quantization parameters consistent (writer + retrieval expectations).**
  - This is primarily implemented via Phase 7.3, but ensure LanceDB metadata emitted from the writer is sufficient for later verification.
  - Touchpoints:
    - `tools/build-embeddings/lancedb.js`
    - `src/retrieval/cli/load-indexes.js` (metadata loading expectations)

#### Tests / Verification

- [ ] Update `tests/lancedb-ann.js`:
  - [ ] Pass `--ann-backend lancedb` explicitly.
  - [ ] Use skip exit code 77 when LanceDB dependency is missing.
  - [ ] Add a candidate-set test that exercises the “pushdown disabled” path and asserts `topN` is still achieved.
- [ ] Add a focused unit test (or harness test) that ensures concurrent queries do not open multiple LanceDB connections.

---

### Phase 7.6 — HNSW ANN correctness, compatibility, and failure observability

- [ ] **Make HNSW index loading compatible with pinned `hnswlib-node` signatures.**
  - [ ] Update `src/shared/hnsw.js: loadHnswIndex()` to call `readIndexSync` with the correct signature.
    - If the signature differs across versions, detect via function arity and/or guarded calls.
  - Touchpoints:
    - `src/shared/hnsw.js`

- [ ] **Verify and correct similarity mapping for `ip` and `cosine` spaces.**
  - [ ] Add a small correctness harness that confirms returned distances map to expected similarity ordering.
  - Touchpoints:
    - `src/shared/hnsw.js`

- [ ] **Improve insertion failure observability while preserving safe build semantics.**
  - [ ] Keep all-or-nothing index generation as the default policy.
  - [ ] In `tools/build-embeddings/hnsw.js`:
    - Capture insertion failures with `{ chunkIndex, errorMessage }`.
    - Throw an error that includes a concise failure summary (capped list + counts).
    - Optionally emit `dense_vectors_hnsw.failures.json` next to the index for debugging.
  - Touchpoints:
    - `tools/build-embeddings/hnsw.js`

- [ ] **Preserve atomicity for index + metadata publication.**
  - Ensure meta updates remain consistent with `.bin` publication; avoid partially updated states.

#### Tests / Verification

- [ ] Add `tests/hnsw-insertion-failures-report.test.js`
  - Force deterministic insertion failures and assert:
    - Failures are reported.
    - The index is not marked available.
    - Atomic write behavior is preserved.
- [ ] Add `tests/hnsw-ip-similarity.test.js`
  - Verify similarity ranking is correct for known vectors under `ip`.
- [ ] Ensure existing `tests/hnsw-atomic.js` and `tests/hnsw-ann.js` remain stable after signature/policy updates.

---

### Phase 7.7 — ANN backend policy and parity (selection, availability, explicit tests)

- [ ] **Provide an explicit policy contract for ANN backend selection.**
  - [ ] Confirm or introduce a single canonical config/CLI surface (e.g., `--ann-backend` and `retrieval.annBackend` or `retrieval.vectorBackend`).
  - [ ] Ensure `auto` selection is deterministic and based on:
    - Backend availability for the mode (artifacts present + loadable).
    - Compatibility with the embedding identity (dims, normalize policy, metric/space).
  - Touchpoints:
    - Retrieval CLI option normalization (`src/retrieval/cli/normalize-options.js`)
    - ANN provider selection (`src/retrieval/ann/index.js` and providers)

- [ ] **Record backend availability and the selected backend in observable state.**
  - [ ] Ensure `index_state.json` captures availability for HNSW/LanceDB/SQLite dense per mode.
  - [ ] Ensure query stats include the selected backend (already present as `annBackend` in several paths; make it consistent).

- [ ] **Make tests explicit about backend choice.**
  - [ ] Update `tests/lancedb-ann.js` (see Phase 7.5).
  - [ ] Ensure any other ANN tests pass an explicit backend flag to prevent policy drift from breaking intent.

#### Tests / Verification

- [ ] Add `tests/ann-backend-selection-fallback.test.js`
  - Validate `auto` chooses the expected backend when one is missing/unavailable.
- [ ] Add `tests/ann-backend-selection-explicit.test.js`
  - Validate explicit selection fails clearly (or falls back if policy allows) when requested backend is unavailable.

---

### Phase 7.8 — Backend storage resilience required by embeddings/ANN workflows

- [ ] **LMDB map size planning for predictable index builds.**
  - [ ] Add config support and defaults:
    - `indexing.lmdb.mapSizeBytes` with a sane default and override.
  - [ ] Estimate required map size from corpus characteristics (with headroom), and log the chosen size + inputs.
  - [ ] Pass `mapSize` to LMDB `open()` in `tools/build-lmdb-index.js`.
  - Touchpoints:
    - `tools/build-lmdb-index.js`

- [ ] **SQLite dense writer safety: avoid cross-mode ANN table deletion when DBs are shared.**
  - [ ] Confirm whether SQLite dense DBs are per-mode (separate DB files) in all supported configurations.
  - [ ] If shared DBs are possible, ensure ANN table deletes are mode-scoped:
    - Either add a mode discriminator column and filter deletes, or use mode-specific ANN table names.
  - Touchpoints:
    - `tools/build-embeddings/sqlite-dense.js`

- [ ] **Avoid O(N) cache scans during embeddings preflight.**
  - [ ] Replace full-directory scans in `tools/build-embeddings/run.js` with a lightweight cache metadata file (e.g., `cache/index.json`) that records:
    - dims, identity keys, and a small index of available cached chunks.
  - [ ] Keep backward compatibility by falling back to scan only when metadata is missing.
  - Touchpoints:
    - `tools/build-embeddings/run.js`
    - `tools/build-embeddings/cache.js`

#### Tests / Verification

- [ ] Add `tests/lmdb-map-size-planning.test.js`
  - Build an LMDB index of moderate size and verify it does not fail due to map size.
- [ ] Add `tests/sqlite-dense-cross-mode-safety.test.js`
  - Build both modes and rebuild one mode; verify the other mode’s ANN data remains intact.
- [ ] Add `tests/embeddings/cache-preflight-metadata.test.js`
  - Ensure preflight uses metadata without scanning when the meta file exists, and remains correct.

---
# Phase 8 - Tooling Provider Framework & Type Inference Parity (Segment‑Aware)

## 0. Guiding principles (non-negotiable)

1. **Stable identity first.** Tooling outputs must attach to chunks using stable keys (`chunkUid` preferred; `chunkId` as range-specific fallback). Never rely on `file::name`.
2. **Segment-aware by construction.** Embedded code (Markdown fences, Vue/Svelte/Astro blocks, etc.) must be projected into **virtual documents** and routed by effective language, not container extension.
3. **Capability-gated tooling.** Missing tools must not make indexing brittle. Providers must detect availability and no-op safely when absent.
4. **Deterministic and bounded.** Provider selection order, merging, and output growth must be deterministic and bounded by caps.
5. **Encoding-correct offsets.** Any provider mapping offsets must read text via the shared decode path (`src/shared/encoding.js`) so positions match chunking offsets.
6. **High-throughput defaults.** Avoid O(N²) scans. Prefer grouping, caching, and single-pass mapping where possible.

---

## 1. Canonical contracts (copy/paste into implementation)

### 1.1 Chunk identifiers

**`chunkId` (range-specific, already exists)**  
Produced by `src/index/chunk-id.js#resolveChunkId({file, segment, start, end, kind, name})`.

**`chunkUid` (stable-ish, new)**  
Computed from:
- container file path (POSIX relpath)
- segmentId (or empty)
- `chunkId`
- content hashes:
  - `spanHash` = xxh64(chunkText)
  - `preHash` = xxh64(containerText.slice(max(0,start-64), start))
  - `postHash` = xxh64(containerText.slice(end, min(len,end+64)))

Canonical wire format:

- `spanHash = "xxh64:" + <hex>`
- `preHash  = "xxh64:" + <hex>`
- `postHash = "xxh64:" + <hex>`
- `chunkUidAlgoVersion = 1`
- `chunkUid = "cuid:v1:xxh64:" + xxh64( file + "|" + segmentId + "|" + chunkId + "|" + spanHash + "|" + preHash + "|" + postHash )`

Collision handling (mandatory):
- If multiple chunks in the same build compute the same `chunkUid`, deterministically disambiguate:
  - Sort colliding chunks by `(file, segmentId, start, end, kind, name, docId)` ascending.
  - First entry keeps original `chunkUid`.
  - Others become `chunkUid = original + ":dup" + <1-based-index>`
  - Record `collisionOf = original` on dup entries.

### 1.2 Reference envelopes (required for any cross-subsystem join)

Create `src/shared/identity.js` exporting JSDoc typedefs.

```js
/**
 * @typedef {{start:number,end:number}} Range
 *
 * @typedef {object} ChunkRef
 * @property {number} docId              // build-local chunk integer id (chunk_meta.id)
 * @property {string} chunkUid           // stable-ish id (new)
 * @property {string} chunkId            // range id (existing)
 * @property {string} file               // container relpath (POSIX)
 * @property {string | null | undefined} segmentId
 * @property {Range | undefined} range   // container offsets (recommended)
 */

/**
 * @typedef {object} SymbolRef
 * @property {string} symbolKey                  // grouping key (required)
 * @property {string|null|undefined} symbolId    // semantic id (scip/lsif/lsp/heur) (optional)
 * @property {string|null|undefined} scopedId    // unique derived id (optional)
 * @property {string|null|undefined} signatureKey
 * @property {string|null|undefined} kind
 * @property {string|null|undefined} qualifiedName
 * @property {string|null|undefined} languageId
 * @property {ChunkRef|null|undefined} definingChunk
 * @property {{scheme:'scip'|'lsif'|'lsp'|'heuristic-v1'|'chunkUid',confidence:'high'|'medium'|'low',notes?:string}|null|undefined} evidence
 */
```

### 1.3 Join precedence rules (mandatory)

Implement helper functions in `src/shared/identity.js` and use them everywhere:

**Symbol joins**
1. join on `symbolId` when prefix is semantic (`scip:`/`lsif:`/`lsp:`)
2. else join on `scopedId`
3. else join on `symbolKey` only if consumer explicitly accepts ambiguity (overload-set grouping)

**Chunk joins**
1. join on `chunkUid` whenever available
2. else join on `{file, segmentId, chunkId}`
3. never join solely on `docId` across independent runs

---

## 2. Tooling VFS & routing contracts

### 2.1 Virtual document

Create `src/index/tooling/vfs.js` exporting these JSDoc typedefs:

```js
/**
 * @typedef {object} ToolingVirtualDocument
 * @property {string} virtualPath         // stable path for tooling (POSIX)
 * @property {string} containerPath       // container relpath (POSIX)
 * @property {string|null} segmentId
 * @property {{start:number,end:number}|null} segmentRange // container offsets
 * @property {string} languageId          // effective language for tooling routing
 * @property {string} ext                // effective extension (e.g. .tsx)
 * @property {string} text               // full text content for tooling
 * @property {string} docHash            // "xxh64:<hex>" of text
 */

/**
 * @typedef {object} ToolingTarget
 * @property {import('../../shared/identity.js').ChunkRef} chunkRef
 * @property {string} virtualPath
 * @property {{start:number,end:number}} virtualRange
 * @property {string} languageId
 * @property {string} ext
 * @property {{name?:string, kind?:string, hint?:string}|null} symbolHint
 */
```

### 2.2 Virtual path scheme (deterministic)

Virtual paths must be deterministic, collision-resistant, and stable across runs:

- `vfsRoot = ".poc-vfs"`
- `containerKey = sha1(containerPath)` (hex)
- `basename = path.basename(containerPath, path.extname(containerPath))`

Rules:
- If segmentId is null (no segment): virtualPath MAY be the real on-disk path (`<rootDir>/<containerPath>`) for maximum LSP compatibility.
- If segmentId is non-null (segment): virtualPath MUST be:
  - `<rootDir>/.poc-vfs/<containerKey>/<segmentId>/<basename><effectiveExt>`

Never use container extension for `effectiveExt`.

### 2.3 Effective extension mapping (authoritative table)

Implement in `src/index/tooling/vfs.js` as a `Map(languageId -> ext)`:

- `typescript -> .ts`
- `tsx -> .tsx`
- `javascript -> .js`
- `jsx -> .jsx`
- `json -> .json`
- `python -> .py`
- `ruby -> .rb`
- `go -> .go`
- `rust -> .rs`
- `java -> .java`
- `c -> .c`
- `cpp -> .cpp`
- `csharp -> .cs`
- `kotlin -> .kt`
- `php -> .php`
- `shell -> .sh`
- `sql -> .sql`
- else fallback: container ext

### 2.4 Offset mapping (container → virtual)

For each chunk:

- `virtualStart = chunk.start - segment.start` (if segment)
- `virtualEnd   = chunk.end - segment.start` (if segment)
- else `virtualStart = chunk.start`, `virtualEnd = chunk.end`

Assert:
- `0 <= virtualStart <= virtualEnd <= virtualDoc.text.length`

---

## 3. Phase breakdown (Codex format)

> NOTE: These phases intentionally include additional detail beyond the high-level roadmap to eliminate all ambiguity during implementation.

---

## Phase 8.1 — Provider contract + registry (capability gating, deterministic selection)

### Objective
Create a single authoritative provider system that:
- detects tools safely,
- selects providers deterministically,
- routes work based on effective language/kind,
- standardizes outputs keyed by `chunkUid`.

### Files to add
- `src/index/tooling/provider-contract.js` (JSDoc types + shared helpers)
- `src/index/tooling/provider-registry.js`
- `src/index/tooling/orchestrator.js`

### Files to modify (call sites)
- `src/index/type-inference-crossfile/tooling.js` (replace ad-hoc provider wiring)
- `tools/dict-utils.js#getToolingConfig` (extend config surface)
- (optional but recommended) `docs/config-schema.json` (tooling keys)

### Tasks

- [ ] **8.1.1 Define the provider contract (runtime-safe, JSDoc typed)**
  - Touch: `src/index/tooling/provider-contract.js`
  - Define `ToolingProvider` shape:

    ```js
    /**
     * @typedef {object} ToolingProvider
     * @property {string} id
     * @property {string} label
     * @property {number} priority                 // lower runs first, deterministic
     * @property {string[]} languages              // effective languageIds supported
     * @property {('types'|'diagnostics'|'symbols')[]} kinds
     * @property {{cmd?:string,module?:string}|null} requires
     * @property {boolean} experimental
     * @property {(ctx:{rootDir:string,config:any,log:(s:string)=>void})=>Promise<{available:boolean,details:any}>} detect
     * @property {(ctx:{rootDir:string,documents:ToolingVirtualDocument[],targets:ToolingTarget[],config:any,log:(s:string)=>void,guard:any})=>Promise<ToolingRunResult>} run
     */
    ```

  - Define `ToolingRunResult`:

    ```js
    /**
     * @typedef {object} ToolingRunResult
     * @property {Map<string, any>} typesByChunkUid
     * @property {Map<string, any>} diagnosticsByChunkUid
     * @property {{providerId:string,cmd?:string,args?:string[],version?:string,workspaceRoot?:string,notes?:string}[]} provenance
     * @property {{openedDocs:number,processedTargets:number,elapsedMs:number,errors:number}} metrics
     * @property {{level:'info'|'warn'|'error',code:string,message:string,context?:any}[]} observations
     */
    ```

- [ ] **8.1.2 Implement provider registry (deterministic + config-gated)**
  - Touch: `src/index/tooling/provider-registry.js`
  - Registry responsibilities:
    - Construct default provider list (typescript, clangd, sourcekit-lsp, pyright, generic-lsp).
    - Deterministic order by `(priority, id)`.
    - Apply gating rules:
      - `tooling.disabledTools` hard-deny
      - if `tooling.enabledTools` non-empty, hard-allow only those
      - provider-local `enabled:false` hard-deny
    - Provide `selectProviders({config,documents,targets}) -> ProviderPlan[]` where each plan includes filtered docs/targets relevant to provider.

  - **Choice resolved:** Implement a single registry that can host existing providers as adapters (best), rather than keeping parallel wiring in `runToolingPass`.
    - Why better: eliminates drift and forces stable merge policy in one place.

- [ ] **8.1.3 Wrap/migrate existing providers into contract**
  - Touch:
    - `src/index/tooling/typescript-provider.js` (migrate to new run signature)
    - `src/index/tooling/clangd-provider.js`
    - `src/index/tooling/sourcekit-provider.js`
    - `src/index/tooling/pyright-provider.js`
    - `src/integrations/tooling/providers/lsp.js` (generic lsp provider)
  - Each provider MUST:
    - accept `documents` + `targets` (even if it ignores segments initially)
    - output keys by `chunkUid` (never `file::name`)
    - return `metrics` and `observations` without throwing (unless strict mode)

- [ ] **8.1.4 Centralize merge semantics in orchestrator**
  - Touch: `src/index/tooling/orchestrator.js`, `src/integrations/tooling/providers/shared.js`
  - Orchestrator responsibilities:
    - Build VFS (`buildToolingVirtualDocuments`) from chunks.
    - Select providers via registry.
    - Run providers in deterministic order, with bounded concurrency:
      - providers run sequentially (deterministic), but each provider may internally parallelize across documents (bounded).
    - Merge results into a single `ToolingAggregateResult`:
      - `typesByChunkUid` merged via `mergeToolingEntry` (dedupe types, preserve first signature/paramNames)
      - provenance appended in provider order
      - observations concatenated

- [ ] **8.1.5 Extend tooling config surface (min required for Phase 8)**
  - Touch: `tools/dict-utils.js#getToolingConfig`
  - Add fields (read-only parsing, no schema required yet):
    - `tooling.providerOrder?: string[]` (optional override)
    - `tooling.vfs?: { strict?: boolean, maxVirtualFileBytes?: number }`
    - `tooling.lsp?: { enabled?: boolean, servers?: Array<{id:string,cmd:string,args?:string[],languages?:string[],uriScheme?:'file'|'poc-vfs',timeoutMs?:number,retries?:number}> }`
    - Extend `tooling.typescript` with:
      - `includeJs?: boolean` (default true)
      - `checkJs?: boolean` (default true)
      - `maxFiles?: number` / `maxProgramFiles?: number`
      - `maxFileBytes?: number`
      - `tsconfigPath?: string|null` (existing)
    - (keep existing) `tooling.retries`, `tooling.timeoutMs`, `tooling.breaker`

### Tests / Verification

- [ ] Add `tests/tooling/provider-registry-gating.js`
  - Construct fake providers + config allow/deny cases and assert selected provider ids are deterministic.
- [ ] Add `tests/tooling/provider-registry-ordering.js`
  - Assert `(priority,id)` ordering is stable even if registration order changes.

---

## Phase 8.2 — Segment/VFS-aware tooling orchestration + stable chunk keys + join policy

### Objective
Enable tooling to operate on:
- real files, and
- embedded segments projected into virtual docs,
while attaching results using stable chunk identity.

### Files to add
- `src/index/chunk-uid.js`
- `src/shared/identity.js` (from §1)
- `src/index/tooling/vfs.js`

### Files to modify
- `src/index/build/file-processor.js` (compute hashes + chunkUid)
- `src/index/metadata-v2.js` (persist fields)
- `src/index/validate.js` (strict validation)
- `src/index/type-inference-crossfile/pipeline.js` (build chunkUid map for tooling)
- `src/index/type-inference-crossfile/tooling.js` (switch to orchestrator + chunkUid joins)
- `src/integrations/tooling/providers/shared.js` (guard semantics + merge bounds)
- `src/index/segments.js` (preserve JSX/TSX fence fidelity)

### Tasks

- [ ] **8.2.1 Preserve JSX/TSX fidelity in segmentation**
  - Touch: `src/index/segments.js`
  - Change `MARKDOWN_FENCE_LANG_ALIASES`:
    - `jsx -> jsx` (not `javascript`)
    - `tsx -> tsx` (not `typescript`)
  - Rationale:
    - TS/JS providers need the correct effective extension (`.tsx`/`.jsx`) for script kind and tooling languageId mapping.
  - Add/update unit test:
    - `tests/segments/markdown-fence-tsx-jsx-preserved.js`

- [ ] **8.2.2 Implement chunkUid computation (v1)**
  - Touch: `src/index/chunk-uid.js`, `src/shared/hash.js`
  - Implement:
    - `computeChunkUidV1({file,segmentId,chunkId,start,end,chunkText,containerText,backend})`
    - `resolveChunkUidCollisions(chunks)` (post-docId assignment)
  - Performance requirement:
    - Fetch xxhash backend once per file processor invocation.
    - Avoid re-hashing identical strings via small LRU cache keyed by string length+slice identity (optional; only if profiling shows benefit).

- [ ] **8.2.3 Persist chunkUid fields into metaV2**
  - Touch: `src/index/metadata-v2.js`
  - Add fields to metaV2:
    - `chunkUid`
    - `chunkUidAlgoVersion`
    - `spanHash`, `preHash`, `postHash`
    - `collisionOf` (null or string)
  - Ensure metaV2 remains JSON-serializable and stable field ordering is not required (but recommended for diffs).

- [ ] **8.2.4 Compute chunkUid in file processor (best location)**
  - Touch: `src/index/build/file-processor.js`
  - Exact placement:
    - Inside the main chunk loop, after `ctext` and `tokenText` are produced and before `chunkPayload` is assembled.
  - Use:
    - `chunkTextForHash = tokenText` (the exact text used for tokenization/indexing).
    - `containerTextForContext = text` (decoded file text from `readTextFileWithHash` path).
  - Store computed values on `chunkPayload.metaV2` (or on chunkPayload then copied into metaV2 in `buildMetaV2`).

- [ ] **8.2.5 Collision resolution must run after docId assignment**
  - Touch: `src/index/build/state.js` and/or `src/index/build/indexer/steps/relations.js`
  - Constraint:
    - disambiguation uses `docId` as a stable tie-breaker.
  - Recommended implementation:
    - After `state.chunks` are appended (docIds assigned) and before tooling runs:
      - Build map `chunkUid -> list of chunks`.
      - Apply deterministic disambiguation and mutate `chunk.metaV2` fields.
      - Record `collisionOf`.

- [ ] **8.2.6 Implement VFS builder**
  - Touch: `src/index/tooling/vfs.js`
  - Export:
    - `buildToolingVirtualDocuments({rootDir, chunks, strict}) -> {documents, targets, fileTextByPath}`
  - Implementation details:
    1. Group chunks by `{containerPath, segmentId}`.
    2. Read each container file once using `readTextFile()` from `src/shared/encoding.js`.
    3. Slice `segmentText = containerText.slice(segment.start, segment.end)` when segmentId present; else full file.
    4. Determine effective languageId:
       - `chunk.metaV2?.lang ?? chunk.segment?.languageId ?? fallbackFromExt(containerExt)`
    5. Derive `effectiveExt` from mapping table.
    6. Create deterministic `virtualPath` (see §2.2).
    7. Create `ToolingTarget` per chunk with container+virtual ranges.
  - Strictness:
    - When `strict:true`, throw if any mapping assertion fails; else record observation and skip that target.

- [ ] **8.2.7 Replace `file::name` joins in tooling pass with chunkUid joins**
  - Touch: `src/index/type-inference-crossfile/pipeline.js`, `src/index/type-inference-crossfile/tooling.js`
  - In `pipeline.js`:
    - Keep existing `chunkByKey` for non-tooling inference paths if needed.
    - Add `chunkByUid = new Map(chunks.map(c => [c.metaV2.chunkUid, c]))`.
  - In tooling apply:
    - Accept `typesByChunkUid` and directly enrich `chunkByUid.get(chunkUid)`.

- [ ] **8.2.8 Update shared tooling guard semantics (per invocation, not per retry)**
  - Touch: `src/integrations/tooling/providers/shared.js#createToolingGuard`
  - Change semantics:
    - retries are internal; only count **one** failure when the invocation fails after retries.
    - keep log lines for each attempt (but don’t trip breaker early).
  - Why better:
    - removes false breaker trips on transient flakiness while preserving protective behavior.

- [ ] **8.2.9 Enforce bounded merge growth + deterministic ordering**
  - Touch: `src/integrations/tooling/providers/shared.js#mergeToolingEntry`
  - Add caps (configurable; safe defaults):
    - `maxReturnCandidates = 5`
    - `maxParamCandidates = 5`
  - Deterministic:
    - sort candidate types lexicographically after dedupe (or preserve provider order but cap deterministically).
  - Record if truncation occurred via orchestrator observation.

### Tests / Verification

- [ ] Add `tests/identity/chunkuid-stability-lineshift.js`
  - Create a file text with a function chunk.
  - Compute chunkUid.
  - Create a new container text with inserted text above the chunk (but keep chunk span content unchanged).
  - Recompute and assert chunkUid unchanged.
- [ ] Add `tests/identity/chunkuid-collision-disambiguation.js`
  - Construct two chunk records with identical `chunkId`, `spanHash`, `preHash`, `postHash` (same file+segment).
  - Apply collision resolver and assert:
    - first keeps `chunkUid`
    - second becomes `chunkUid:dup2`
    - second has `collisionOf` pointing to original
- [ ] Add `tests/tooling/vfs-offset-mapping-segment.js`
  - Use a container with a segment range, build VFS, assert container→virtual offsets map exactly and obey assertions.
- [ ] Extend/confirm `tests/type-inference-lsp-enrichment.js` still passes after tooling join changes.

---

## Phase 8.3 — TypeScript provider parity for JS/JSX + segment VFS support (stable keys, node matching)

### Objective
Use TypeScript tooling to enrich:
- `.ts/.tsx` and `.js/.jsx` files,
- and embedded JS/TS segments,
with stable chunk-keyed results and high-confidence signatures.

### Files to modify/add
- Modify (refactor): `src/index/tooling/typescript-provider.js`
- Add helper modules (recommended to keep file manageable):
  - `src/index/tooling/typescript/host.js` (language service host for VFS)
  - `src/index/tooling/typescript/match.js` (range-based node matching)
  - `src/index/tooling/typescript/format.js` (signature/type normalization)

### Tasks

- [ ] **8.3.1 Change TS provider interface to VFS-based inputs**
  - Touch: `src/index/tooling/typescript-provider.js`
  - Replace old signature `collectTypeScriptTypes({chunksByFile})` with:
    - `collectTypeScriptTypes({rootDir, documents, targets, log, toolingConfig, guard})`
  - Provider must:
    - filter to targets where `languageId in {typescript, tsx, javascript, jsx}`
    - output `typesByChunkUid: Map<chunkUid, ToolingTypeEntry>`

- [ ] **8.3.2 Config resolution (tsconfig/jsconfig) + partitions**
  - Touch: `src/index/tooling/typescript-provider.js`
  - Algorithm:
    1. For each **containerPath** represented in the targets, resolve config:
       - if `tooling.typescript.tsconfigPath` provided, use it
       - else search upward from `<rootDir>/<containerPath>` for `tsconfig.json`, else `jsconfig.json`
    2. Partition targets by resolved config path (string key); use `"__NO_CONFIG__"` for fallback.
  - Fallback compiler options for `"__NO_CONFIG__"`:
    - `{ allowJs:true, checkJs:true, strict:false, target:ES2020, module:ESNext, jsx:Preserve, skipLibCheck:true }`

- [ ] **8.3.3 Build a LanguageService program that includes VFS docs**
  - Touch: add `src/index/tooling/typescript/host.js`
  - Requirements:
    - Host must provide `getScriptSnapshot` for both:
      - physical files from config fileNames, and
      - virtual docs (by `virtualPath`)
    - For physical files, read via `ts.sys.readFile` (ok) OR reuse shared encoding decode path if offsets matter (TypeScript uses UTF-16 internally; Node readFile utf8 is ok for TS, but for consistency you may reuse `readTextFile`).
    - Ensure `allowJs` true if any target is JS/JSX.
    - Ensure correct `ScriptKind` based on virtual doc extension:
      - `.ts -> TS`, `.tsx -> TSX`, `.js -> JS`, `.jsx -> JSX`, `.mjs/.cjs -> JS`
  - Output:
    - `const program = languageService.getProgram()`
    - `const checker = program.getTypeChecker()`

- [ ] **8.3.4 Implement range-based node matching (primary)**
  - Touch: add `src/index/tooling/typescript/match.js`
  - Inputs:
    - `sourceFile`, `target.virtualRange`, optional `symbolHint {name,kind}`
  - Node candidate set:
    - function-like declarations (FunctionDeclaration, MethodDeclaration, ArrowFunction, FunctionExpression)
    - class declarations (ClassDeclaration)
    - interface/type aliases if future
  - Deterministic scoring:
    - Compute `nodeSpan = [node.getStart(sourceFile), node.end]`
    - Compute `overlap = intersectionLen(nodeSpan, targetRange)`
    - Reject if overlap <= 0
    - Score tuple (descending):
      1. overlapRatio = overlap / (targetRangeLen)
      2. nameMatch = 1 if nodeName === hint.name else 0
      3. kindMatch = 1 if nodeKind matches hint.kind bucket else 0
      4. spanTightness = -abs((nodeLen - targetLen))
      5. nodeStartAsc (tie-breaker)
    - Pick max score; tie-break lexicographically by `(nodeStart,nodeEnd,nodeKind,nodeName)`
  - Fallback:
    - If no candidates overlap, allow a second pass using name-only match within file (legacy compatibility), but record observation `TS_NO_RANGE_MATCH_USED_NAME_FALLBACK`.

- [ ] **8.3.5 Extract types and format output deterministically**
  - Touch: add `src/index/tooling/typescript/format.js`
  - For each matched node:
    - Use `checker.getSignatureFromDeclaration(node)` when possible.
    - Return type: `checker.typeToString(checker.getReturnTypeOfSignature(sig))`
    - Params:
      - For each `sig.getParameters()`:
        - paramName = declaration parameter name:
          - if Identifier: `param.name.text`
          - else (destructuring): `normalizePatternText(sourceFile.text.slice(param.name.pos,param.name.end))`:
            - remove whitespace
            - collapse runs of spaces/newlines
        - paramType = `checker.typeToString(checker.getTypeOfSymbolAtLocation(sym, decl))`
    - Signature string:
      - canonical single-line:
        - `function <name>(<paramName>: <paramType>, ...) : <returnType>`
      - strip repeated whitespace
  - Output entry:
    - `{ returns:[returnType], params:{...}, paramNames:[...], signature }`
  - Always key output by `chunkUid` from `target.chunkRef.chunkUid`.

- [ ] **8.3.6 JS/JSX parity and safety caps**
  - Touch: `src/index/tooling/typescript-provider.js`
  - Enforce caps:
    - `maxFiles`, `maxFileBytes`, `maxProgramFiles`
  - When cap exceeded:
    - skip TS provider for that partition and record observation with reason code (doctor/reportable).

- [ ] **8.3.7 Emit SymbolRef (minimal heuristic)**
  - Touch: `src/shared/identity.js` (helpers), TS provider
  - For each successful match, optionally attach:
    - `symbolKey = "ts:heur:v1:" + containerPath + ":" + (segmentId||"") + ":" + (nodeName||target.chunkRef.chunkId)`
    - `signatureKey = "sig:v1:" + sha1(signatureCanonical)`
    - `scopedId = "sid:v1:" + sha1(symbolKey + "|" + signatureKey)`
    - `symbolId = null` (unless future SCIP/LSIF available)
  - Store symbolRef on the tooling entry as `entry.symbolRef` OR attach to chunk docmeta (choose one and document; recommended: `entry.symbolRef` for now, ignored by consumers until Phase 9).

### Tests / Verification

- [ ] Add `tests/tooling/typescript-vfs-js-parity.js`
  - Build a virtual doc `.jsx` with a simple component and assert return/param types are non-empty and stable.
- [ ] Add `tests/tooling/typescript-range-matching.js`
  - Create a file with two functions of same name in different scopes; ensure the correct chunk range maps to correct function.
- [ ] Add `tests/tooling/typescript-destructured-param-names.js`
  - Function `f({a,b}, [c])` should produce stable paramNames like `{a,b}` and `[c]` (whitespace-insensitive).
- [ ] Extend `tests/type-inference-typescript-provider-no-ts.js`
  - Ensure provider cleanly no-ops when TypeScript module missing (existing behavior preserved).

---

## Phase 8.4 — LSP provider hardening + VFS integration (restart safety, per-target failures, stable keys)

### Objective
Make LSP tooling reliable and segment-capable:
- safe restarts without race corruption,
- bounded retries without false breaker trips,
- supports `.poc-vfs` virtual docs via didOpen,
- outputs keyed by `chunkUid`.

### Files to modify
- `src/integrations/tooling/lsp/client.js`
- `src/integrations/tooling/providers/lsp.js`
- `src/integrations/tooling/lsp/positions.js` (add offset→position)
- (optional) `src/integrations/tooling/lsp/symbols.js` (if documentSymbol used)

### Tasks

- [ ] **8.4.1 Fix LSP client restart race via generation token**
  - Touch: `src/integrations/tooling/lsp/client.js`
  - Add `let generation = 0;` and increment on each `start()`.
  - Capture `const myGen = generation` inside process event handlers; ignore events if `myGen !== generation`.
  - Ensure old process exit cannot null-out writer/parser for a newer generation.

- [ ] **8.4.2 Add deterministic timeout + transport-close rejection**
  - Touch: `src/integrations/tooling/lsp/client.js`
  - Requirements:
    - every request must have a timeout, default to e.g. 15000ms if caller omits
    - if transport closes:
      - reject all pending requests immediately with `ERR_LSP_TRANSPORT_CLOSED`

- [ ] **8.4.3 Add exponential backoff restart policy**
  - Touch: `src/integrations/tooling/lsp/client.js`
  - Policy:
    - consecutive restart delays: 250ms, 1s, 3s, 10s (cap)
    - reset backoff on stable uptime threshold or successful request.

- [ ] **8.4.4 Support VFS docs in provider**
  - Touch: `src/integrations/tooling/providers/lsp.js`
  - Change signature:
    - `collectLspTypes({rootDir, documents, targets, log, cmd, args, timeoutMs, retries, breakerThreshold, uriScheme, tempDir})`
  - Required behavior:
    1. Group targets by `virtualPath`.
    2. For each doc:
       - open `didOpen` with `text` (required for virtual docs)
       - compute `lineIndex` for doc text
       - for each target:
         - compute anchor position:
           - preferred: find first identifier-like char inside `virtualRange`
           - else use `virtualRange.start`
           - convert offset→position using new helper
         - request `hover` and/or `signatureHelp`
         - parse into `ToolingTypeEntry`
         - write into `typesByChunkUid.set(target.chunkRef.chunkUid, entry)`
       - `didClose`
    3. Shutdown/exit client deterministically.

- [ ] **8.4.5 Per-target failure accounting**
  - Touch: `src/integrations/tooling/providers/shared.js#createToolingGuard` AND LSP provider call sites
  - Semantics:
    - Each target counts as at most 1 failure after all retries/timeouts for that target.
    - Do not increment breaker on intermediate retry attempts.

- [ ] **8.4.6 Encoding correctness**
  - Touch: `src/index/tooling/*-provider.js` AND LSP provider text reads
  - Any provider reading file text must use `readTextFile` from `src/shared/encoding.js` so chunk offsets remain consistent.

### Tests / Verification

- [ ] Add `tests/tooling/lsp-restart-generation-safety.js`
  - Simulate old process exit after new start and assert new client stays valid.
- [ ] Add `tests/tooling/lsp-vfs-didopen-before-hover.js`
  - Use stub LSP server to assert didOpen observed before hover for `.poc-vfs/...` URI.
- [ ] Add `tests/tooling/lsp-bychunkuid-keying.js`
  - Assert provider returns map keyed by the provided target chunkUid, not `file::name`.
- [ ] Add `tests/tooling/lsp-failure-accounting-per-target.js`
  - Stub LSP server fails N attempts then succeeds; breaker should not trip prematurely.

---

## Phase 8.5 — Tooling doctor + reporting + CLI integration

### Objective
Provide an operator-facing workflow to explain tooling state:
- what is installed,
- what is eligible,
- what is enabled/disabled,
- why a provider is skipped,
- and what to do next.

### Files to add/modify
- Add: `tools/tooling-doctor.js`
- Modify: `tools/tooling-utils.js` (reuse detection where possible)
- Modify: `bin/pairofcleats.js` (add `tooling` command group)
- Modify: `docs/commands.md` (or create `docs/tooling.md`)

### Tasks

- [ ] **8.5.1 Implement doctor report schema**
  - Touch: `tools/tooling-doctor.js`
  - Output JSON schema (when `--json`):
    ```json
    {
      "repoRoot": "...",
      "config": { "enabledTools":[], "disabledTools":[] },
      "xxhash": { "backend":"native|wasm|none", "module":"xxhash-wasm", "ok":true },
      "providers": [
        {
          "id":"typescript",
          "available":true,
          "enabled":true,
          "reasonsDisabled":[],
          "requires": {"module":"typescript"},
          "version":"5.x",
          "languages":["typescript","tsx","javascript","jsx"]
        }
      ]
    }
    ```
  - Human mode:
    - print summary table + actionable next steps.

- [ ] **8.5.2 Align doctor with provider registry**
  - Doctor must use the same provider registry selection logic as the orchestrator:
    - avoids “doctor says ok but index says no”.

- [ ] **8.5.3 Add CLI surface**
  - Touch: `bin/pairofcleats.js`
  - Add:
    - `pairofcleats tooling doctor --repo <path> [--json]`
  - Implementation:
    - route to `tools/tooling-doctor.js`

- [ ] **8.5.4 Integrate into build logs (optional, gated)**
  - Touch: `tools/build_index.js` (or relevant runner)
  - Behavior:
    - if `tooling.doctorOnBuild === true`, run doctor once at start and log summary.

### Tests / Verification

- [ ] Add `tests/tooling/doctor-json-stable.js`
  - Run doctor against a fixture repo and assert JSON keys and key fields are present.
- [ ] Add `tests/tooling/doctor-gating-reasons.js`
  - Provide config with denylist and assert provider shows `enabled:false` with correct reason.

---

## 4. Migration checklist (explicitly remove ambiguity)

- [ ] `file::name` MUST NOT be used as a tooling join key anywhere.
  - Search patterns:
    - `"::${chunk.name}"`, `"${file}::"`, `"file::name"`
  - Known current touchpoints:
    - `src/index/tooling/typescript-provider.js` (key = `${chunk.file}::${chunk.name}`)
    - `src/integrations/tooling/providers/lsp.js` (key = `${target.file}::${target.name}`)
    - `src/index/type-inference-crossfile/pipeline.js` (chunkByKey / entryByKey)
- [ ] All tooling provider outputs must be keyed by `chunkUid` (and include chunkRef for provenance/debug).
- [ ] Segment routing must not rely on container ext. Always use effective language id + ext mapping.
- [ ] Any time offsets are used for mapping, file text must come from `src/shared/encoding.js`.

---

## 5. Acceptance criteria (Phase 8 complete when true)

- [ ] Tooling orchestration is provider-registry-driven and deterministic.
- [ ] Embedded JS/TS segments (Markdown fences, Vue script blocks) receive TS-powered enrichment via VFS.
- [ ] TypeScript provider enriches JS/JSX when enabled, respecting jsconfig/tsconfig discovery.
- [ ] LSP client restart is generation-safe and does not corrupt new sessions.
- [ ] Every tooling attachment is keyed by chunkUid, never `file::name`.
- [ ] Tooling doctor can explain gating, availability, and configuration in JSON + human output.

---

## 6. Implementation ordering (recommended)

1. Phase 8.2.1–8.2.5 (chunkUid + persistence + collisions)  
2. Phase 8.2.6 (VFS builder)  
3. Phase 8.1 (registry + orchestrator skeleton; wire into tooling pass)  
4. Phase 8.3 (TypeScript provider refactor)  
5. Phase 8.4 (LSP hardening)  
6. Phase 8.5 (doctor + CLI)  
7. Remaining tests + fixtures hardening

---

# Phase 9 — Symbol identity (collision-safe IDs) + cross-file linking (detailed execution plan)

## Phase 9 objective (what “done” means)

Eliminate all correctness hazards caused by non-unique, name-based joins (notably `file::name` and legacy `chunkId` usage) and replace them with a collision-safe, stability-oriented identity layer. Use that identity to produce:

1) **Stable, segment-aware node identity** (`chunkUid`, `segmentUid`, `virtualPath`) that survives minor line shifts and prevents collisions across:
   - same-name declarations in different files,
   - same-name declarations inside different segments of the same container file,
   - repeated definitions (overloads, nested scopes, generated code patterns).

2) **A canonical symbol identity and reference contract** (`symbolKey`, `signatureKey`, `scopedId`, `symbolId`, `SymbolRef`) that:
   - is deterministic,
   - is language-agnostic at the storage boundary,
   - preserves ambiguity instead of forcing wrong links.

3) **Cross-file resolution that is import-aware and ambiguity-preserving**, using bounded heuristics and explicit confidence/status fields.

4) **First-class symbol graph artifacts** (`symbols.jsonl`, `symbol_occurrences.jsonl`, `symbol_edges.jsonl`) that enable downstream graph analytics and product features without re-parsing code.

This phase directly targets the Phase 9 intent in the roadmap (“Symbol identity (collision-safe IDs) + cross-file linking”) and explicitly implements the canonical `chunkUid` contract described in the consolidated planning docs. In particular, the `chunkUid` construction approach and “fail closed” requirement are consistent with the canonical identity contract described in the planning materials.

---

## Phase 9 non-goals (explicitly out of scope for Phase 9 acceptance)

These may be separate follow-on phases or optional extensions:

- Full **SCIP/LSIF/ctags hybrid symbol source registry** (runtime selection/merging) beyond ensuring the contracts can represent those IDs.
- Full module-resolution parity with Node/TS (tsconfig paths, package exports/imports, Yarn PnP, etc). Phase 9 supports **relative import resolution** only.
- Whole-program correctness for dynamic languages; Phase 9 focuses on **correctness under ambiguity** (never wrong-link) rather than “resolve everything”.
- Cross-repo symbol federation.

---

## Phase 9 key decisions (locked)

These choices remove ambiguity and prevent future “forks” in implementation.

### D1) Graph node identity uses `chunkUid`, not `file::name`, not legacy `chunkId`

- **Chosen:** `chunkUid` is the canonical node identifier for graphs and cross-file joins.
- **Why:** `file::name` is not unique; `chunkId` is range-based and churns with line shifts. The roadmap’s canonical identity guidance explicitly calls for a `chunkUid` that is stable under line shifts and includes segment disambiguation.

### D2) Symbol identity is a two-layer model: `symbolKey` (human/debug) + `symbolId` (portable token)

- **Chosen:** Persist both.
- **Why:** `symbolKey` is explainable and supports deterministic “rebuild equivalence” reasoning. `symbolId` is compact and future-proofs external sources (SCIP/LSIF) without schema churn.

### D3) Cross-file resolution is ambiguity-preserving

- **Chosen:** When multiple plausible targets exist, record candidates and mark the ref **ambiguous**; do not pick arbitrarily.
- **Why:** Wrong links destroy trust and cascade into graph features, risk flows, and context packs. Ambiguity can be resolved later by better signals.

### D4) Artifact emission is streaming-first and deterministically ordered

- **Chosen:** JSONL for symbol artifacts; deterministic sharding and sorting.
- **Why:** Large repos must not require in-memory materialization of symbol graphs; deterministic ordering is required for reproducible builds and regression testing.

---

## Phase 9 contracts (normative, implementation-ready)

> These contracts must be implemented exactly as specified to avoid drift.

### 9.C1 Identity contract (v1)

#### 9.C1.1 `segmentUid` (string | null)

- **Definition:** A stable identifier for a segment inside a container file (Vue SFC blocks, fenced Markdown blocks, etc).
- **Scope:** Unique within the repo (i.e., global uniqueness is acceptable and preferred).
- **Stability:** Must remain stable under *minor line shifts* outside the segment content.

**Algorithm (v1):**

```
segmentUid = "seg1:" + xxhash64(
  containerRelPath + "\0"
  + segmentType + "\0"
  + effectiveLanguageId + "\0"
  + normalizeText(segmentText)
  + "\0"
  + (parentSegmentUid ?? "")
)
```

- `normalizeText`:
  - normalize line endings to `\n`
  - preserve all non-whitespace characters
  - do not strip trailing whitespace by default (correctness-first)

#### 9.C1.2 `virtualPath` (string)

A deterministic “as-if file path” that disambiguates segments:

- If no segment: `virtualPath = fileRelPath`
- If segment: `virtualPath = fileRelPath + "#seg:" + segmentUid`

#### 9.C1.3 `chunkUid` (string)

- **Definition:** Stable-ish identifier for a chunk, used for graphs and join keys.
- **Stability:** Must remain stable when only lines outside the chunk’s span shift (i.e., chunk text unchanged).
- **Collision handling:** If a collision is detected within `{virtualPath, segmentUid}`, deterministically disambiguate and record `collisionOf`.

**Algorithm (v1) — consistent with the canonical contract described in the planning docs:**

```
spanHash = xxhash64(normalizeText(chunkText))
preHash  = xxhash64(normalizeText(text.slice(max(0, start-64), start)))
postHash = xxhash64(normalizeText(text.slice(end, min(len, end+64))))

chunkUid = "chk1:" + xxhash64(
  fileRelPath + "\0"
  + (segmentUid ?? "") + "\0"
  + spanHash + "\0"
  + preHash + "\0"
  + postHash
)
```

This follows the same conceptual structure as the canonical identity contract: span hash + local pre/post hash to avoid line-number churn, and segment incorporation to disambiguate container-derived code.

**Collision disambiguation (required):**

If `chunkUid` already exists for a different chunk under the same `{virtualPath, segmentUid}` scope:

- set `collisionOf = originalChunkUid`
- set `chunkUid = originalChunkUid + "~" + ordinal` where `ordinal` is a deterministic, stable counter based on sorted `(start,end,kind,name)` for the colliding set.

> Note: the ordinal must be deterministic across runs given identical inputs.

#### 9.C1.4 metaV2 additions

`metaV2` MUST include:

- `chunkUid: string`
- `segmentUid: string | null`
- `virtualPath: string`

And SHOULD include (for diagnostics and future hardening):

- `identity: { v: 1, spanHash: string, preHash: string, postHash: string, collisionOf?: string }`

### 9.C2 Symbol identity contract (v1)

#### 9.C2.1 `kindGroup`

Normalize “kind” strings into a stable group set:

- `function`, `arrow_function`, `generator` → `function`
- `class` → `class`
- `method`, `constructor` → `method`
- `interface`, `type`, `enum` → `type`
- `variable`, `const`, `let` → `value`
- `module`, `namespace`, `file` → `module`
- unknown/other → `other`

#### 9.C2.2 `symbolKey`

```
symbolKey = virtualPath + "::" + qualifiedName + "::" + kindGroup
```

- `qualifiedName` defaults to `chunk.name`.
- When available, prefer container-aware names like `Class.method`.

#### 9.C2.3 `signatureKey` (optional)

```
signatureKey = qualifiedName + "::" + normalizeSignature(signature)
```

`normalizeSignature` must:
- collapse runs of whitespace to a single space
- preserve punctuation, generics, and parameter ordering

#### 9.C2.4 `scopedId`

```
scopedId = kindGroup + "|" + symbolKey + "|" + (signatureKey ?? "") + "|" + chunkUid
```

#### 9.C2.5 `symbolId`

- Deterministic, compact token:
- `symbolId = schemePrefix + sha1(scopedId)`

Where `schemePrefix` depends on source:

- Native/chunk-based: `sym1:heur:` (heuristic/native)
- SCIP: `sym1:scip:`
- LSIF: `sym1:lsif:`
- CTAGS: `sym1:ctags:`

> Phase 9 implements only `heur` generation but must preserve the scheme field in schemas.

#### 9.C2.6 `SymbolRef` (reference envelope)

A reference to a symbol, which may be resolved, ambiguous, or unresolved.

```
SymbolRefV1 = {
  v: 1,
  targetName: string,          // observed identifier, e.g. "foo" or "Foo.bar"
  kindHint: string | null,      // optional hint, e.g. "function"
  importHint: {
    moduleSpecifier: string | null,
    resolvedFile: string | null
  } | null,
  candidates: Array<{
    symbolId: string,
    chunkUid: string,
    symbolKey: string,
    signatureKey: string | null,
    kindGroup: string
  }>,
  status: "resolved" | "ambiguous" | "unresolved",
  resolved: {
    symbolId: string,
    chunkUid: string
  } | null
}
```

- `candidates` MUST be capped (see resolver caps in Phase 9.4).
- `resolved` is non-null only when `status === "resolved"`.

### 9.C3 Symbol graph artifacts (v1)

All symbol artifacts are emitted in `index-code/`:

- `symbols.jsonl`
- `symbol_occurrences.jsonl`
- `symbol_edges.jsonl`

Each line is one JSON object. Deterministic order and deterministic sharding are required.

#### 9.C3.1 `symbols.jsonl`

One record per symbol definition (i.e., per chunk with `metaV2.symbol`):

```
{
  "v": 1,
  "symbolId": "...",
  "scopedId": "...",
  "scheme": "heur",
  "symbolKey": "...",
  "signatureKey": null | "...",
  "chunkUid": "...",
  "virtualPath": "...",
  "segmentUid": null | "...",
  "file": "...",
  "lang": "...",
  "kind": "...",
  "kindGroup": "...",
  "name": "...",
  "qualifiedName": "...",
  "signature": null | "..."
}
```

#### 9.C3.2 `symbol_occurrences.jsonl`

One record per observed reference occurrence (calls, usages). At minimum:

```
{
  "v": 1,
  "fromChunkUid": "...",
  "fromFile": "...",
  "fromVirtualPath": "...",
  "occurrenceKind": "call" | "usage",
  "targetName": "...",
  "range": { "start": number, "end": number } | null,
  "ref": SymbolRefV1
}
```

#### 9.C3.3 `symbol_edges.jsonl`

One record per reference edge (call, usage) emitted from chunk relations:

```
{
  "v": 1,
  "edgeKind": "call" | "usage",
  "fromChunkUid": "...",
  "fromSymbolId": null | "...",
  "to": SymbolRefV1,
  "confidence": number,         // 0..1
  "evidence": {
    "importNarrowed": boolean,
    "matchedExport": boolean,
    "matchedSignature": boolean
  }
}
```

### 9.C4 Graph relations artifact migration (v2)

`graph_relations.json` MUST be updated such that:

- Node `id` is `chunkUid` (not legacy chunkId and not `file::name`)
- Node `attrs` include:
  - `chunkUid`, `chunkId` (legacy), `legacyKey` (for diagnostics only)
  - `symbolId` (when available)
- Edges are emitted **only** for resolved symbol edges (status=resolved)

---

## Phase 9 implementation plan (phases/subphases/tasks/tests)

### 9.1 Implement identity primitives (`segmentUid`, `chunkUid`, `virtualPath`)

**Primary code touchpoints**
- `src/index/segments.js`
- `src/index/build/file-processor.js`
- `src/index/build/file-processor/assemble.js`
- `src/index/metadata-v2.js`
- New: `src/index/identity/*` (or `src/index/*-uid.js` modules)

#### 9.1.1 Create identity modules (new files)

- [ ] **Add `src/index/identity/normalize.js`**
  - [ ] Implement `normalizeText(text: string): string` (line endings → `\n`, no trimming by default).
  - [ ] Implement `normalizeSignature(sig: string): string` (collapse whitespace, preserve punctuation).
  - [ ] Tests: see 9.1.5.

- [ ] **Add `src/index/identity/virtual-path.js`**
  - [ ] `buildVirtualPath(fileRelPath: string, segmentUid: string | null): string`

- [ ] **Add `src/index/identity/segment-uid.js`**
  - [ ] `computeSegmentUid({ containerRelPath, segmentType, effectiveLanguageId, segmentText, parentSegmentUid }): Promise<string>`
  - [ ] Uses xxhash backend (same selection as build pipeline).
  - [ ] Output prefix: `seg1:`

- [ ] **Add `src/index/identity/chunk-uid.js`**
  - [ ] `computeChunkUid({ fileRelPath, segmentUid, fullText, start, end }): Promise<{ chunkUid, identity: { v, spanHash, preHash, postHash } }>`
  - [ ] Implements collision detection/disambiguation helper:
    - [ ] `assignDeterministicCollisionOrdinals(chunksInScope)` (sort by `(start,end,kind,name)`; assign ordinals)
  - [ ] Output prefix: `chk1:`

> Implementation note: `computeChunkUid` must be structured to avoid a per-chunk “backend discovery” cost. Resolve the backend once per file or per worker and reuse.

#### 9.1.2 Extend segment extraction to compute `segmentUid`

- [ ] **Modify `src/index/segments.js`**
  - [ ] When building each segment, compute `segmentUid` from segment content (not offsets).
  - [ ] Store `segmentUid` alongside existing `segmentId` (keep `segmentId` for backward compatibility/debug).
  - [ ] Ensure segmentUid is included in the segment object attached to each chunk (`chunk.segment.segmentUid`).
  - [ ] Ensure the segmentUid is stable when:
    - container file changes outside the segment
    - segment is moved within file without changing its content

#### 9.1.3 Compute `chunkUid` in file processing

- [ ] **Modify `src/index/build/file-processor.js`**
  - [ ] In the per-chunk loop (where `chunkRecord` is assembled), compute `chunkUid` using:
    - file rel path
    - segmentUid (if present)
    - full file text
    - chunk span offsets (`start`, `end`)
  - [ ] Attach `chunkUid` and `metaIdentity` (`spanHash/preHash/postHash`) to `chunkRecord`.
  - [ ] Collision detection: track per `{virtualPath, segmentUid}` scope; on collision, deterministically disambiguate.

#### 9.1.4 Populate metaV2 with identity fields

- [ ] **Modify `src/index/metadata-v2.js`**
  - [ ] Add `chunkUid`, `segmentUid`, `virtualPath`, and `identity` to `metaV2`.
  - [ ] `metaV2.chunkUid` MUST be non-null for every chunk in code mode (“fail closed”).

- [ ] **Modify `src/index/build/file-processor/assemble.js`**
  - [ ] Ensure chunk payload and subsequent meta building has access to chunkUid/segmentUid/virtualPath.
  - [ ] Add defensive assertions (throw) if chunkUid is missing.

#### 9.1.5 Tests for identity primitives

- [ ] **Add `tests/identity/chunk-uid-stability.test.js`**
  - Construct a fixed file text containing:
    - two identical function bodies with different surrounding text
    - a segment-derived chunk scenario (fake segmentUid)
  - Assert:
    - `chunkUid` is stable if lines are inserted above the chunk (offset shift only).
    - `chunkUid` changes if chunk span text changes.
    - collisions are deterministically disambiguated with `~ordinal`.

- [ ] **Add `tests/identity/segment-uid-stability.test.js`**
  - Assert:
    - same segment text ⇒ same segmentUid even if moved.
    - segment text changed ⇒ segmentUid changes.

- [ ] **Update existing `tests/graph-chunk-id.js`**
  - Migrate assertions from `chunkId`/`file::name` identity to `chunkUid` as node IDs.
  - Add explicit collision regression: two chunks with same `file::name` must produce distinct nodes.

---

### 9.2 Implement symbol identity (`metaV2.symbol`, `SymbolRef`) and helpers

**Primary touchpoints**
- `src/index/metadata-v2.js`
- New: `src/index/identity/symbol.js`
- Update callsites: graph builder, cross-file resolver, map builder

#### 9.2.1 Implement symbol identity builder

- [ ] **Add `src/index/identity/kind-group.js`**
  - [ ] Implement `toKindGroup(kind: string | null): string`

- [ ] **Add `src/index/identity/symbol.js`**
  - [ ] `buildSymbolIdentity({ metaV2 }): { scheme, kindGroup, qualifiedName, symbolKey, signatureKey, scopedId, symbolId } | null`
  - [ ] Return null when chunk is not a “definition chunk” (policy below).

**Definition chunk policy (v1):**

- A chunk is a definition chunk if:
  - `chunk.name` is truthy AND not equal to `"(module)"` unless kindGroup is `module`, AND
  - `chunk.kind` is truthy OR `chunk.name === "(module)"`, AND
  - `metaV2.lang` is truthy (code mode).

> This policy is intentionally permissive; it can be tightened later, but Phase 9 prioritizes completeness with ambiguity-safe linking.

#### 9.2.2 Populate `metaV2.symbol`

- [ ] **Modify `src/index/metadata-v2.js`**
  - [ ] After identity fields are set, compute `metaV2.symbol` via `buildSymbolIdentity`.
  - [ ] Ensure `symbolKey` is based on `virtualPath`, not `file`.
  - [ ] Ensure `symbolId` is deterministic.

#### 9.2.3 Tests for symbol identity

- [ ] **Add `tests/identity/symbol-identity.test.js`**
  - Given a fake `metaV2` with chunkUid/virtualPath/kind/name/signature:
    - assert `symbolKey`, `signatureKey`, `scopedId` are correct.
    - assert `symbolId` is stable across runs.
    - assert `kindGroup` normalization.

---

### 9.3 Implement import-aware cross-file resolution (ambiguity-preserving)

**Primary touchpoints**
- `src/index/type-inference-crossfile/pipeline.js`
- New: `src/index/type-inference-crossfile/resolver.js`
- Update language relations to supply import bindings:
  - `src/lang/javascript/relations.js` (and optionally TS)

#### 9.3.1 Extend language relations to capture import bindings (JS/TS)

- [ ] **Modify `src/lang/javascript/relations.js`**
  - [ ] During AST walk, build `importBindings`:
    - `import { foo as bar } from "./x"` ⇒ `bar -> { imported: "foo", module: "./x" }`
    - `import foo from "./x"` ⇒ `foo -> { imported: "default", module: "./x" }`
    - `import * as ns from "./x"` ⇒ `ns -> { imported: "*", module: "./x" }`
  - [ ] Store in the returned relations object as `importBindings`.

- [ ] **Modify `src/index/build/file-processor/relations.js`**
  - [ ] Include `importBindings` in fileRelations entries.

- [ ] **Update file_relations schema** (`src/shared/artifact-schemas.js`)
  - [ ] Allow optional `importBindings` field.

#### 9.3.2 Add relative import resolver helper

- [ ] **Add `src/index/type-inference-crossfile/resolve-relative-import.js`**
  - [ ] Implement `resolveRelativeImport(importerFile: string, spec: string, fileSet: Set<string>): string | null`
  - [ ] Constraints:
    - only handle `./` and `../` specifiers
    - resolve with extension probing:
      - `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`
      - directory index: `spec + "/index" + ext`
    - normalize to repo-relative POSIX paths (match existing `chunk.file` conventions)

#### 9.3.3 Implement resolver (SymbolRef builder)

- [ ] **Add `src/index/type-inference-crossfile/resolver.js`**
  - [ ] Build a `NativeSymbolIndex` from `chunks`:
    - `byVirtualPath: Map<string, { byExportName: Map<string, SymbolDef[]> }>`
    - `byNameGlobal: Map<string, SymbolDef[]>`
    - index both full qualifiedName and leaf name (`foo.bar` ⇒ also index `bar`) but record `matchKind`.
  - [ ] Implement `resolveRef({ fromChunk, targetName, kindHint, fileRelations, fileSet }): SymbolRefV1`
    - Bounded candidate collection + scoring (see caps below)
    - Import narrowing:
      - If `importBindings` provides a binding for the target’s root identifier, resolve that module to a file.
      - Restrict candidate search to those files; then apply export filtering:
        - if imported name is known, prefer matching exports.
    - If exactly one best candidate above threshold ⇒ `status=resolved`
    - Else if >=2 candidates above threshold ⇒ `status=ambiguous` with top-K candidates
    - Else ⇒ `status=unresolved` with empty candidates

**Caps / guardrails (must be implemented):**

- `MAX_CANDIDATES_PER_REF = 25`
- `MAX_CANDIDATES_GLOBAL_SCAN = 200` (if exceeded, downgrade to ambiguous with “too many” signal)
- Deterministic sorting of candidates:
  - primary: score desc
  - secondary: `symbolKey` asc

#### 9.3.4 Resolver tests

- [ ] **Add `tests/crossfile/resolve-relative-import.test.js`**
  - table-driven tests for extension probing and index resolution.

- [ ] **Add `tests/crossfile/symbolref-resolution.test.js`**
  - Build synthetic chunks with metaV2.symbol identities across:
    - two files exporting same name `foo` ⇒ ambiguous
    - importer with `import { foo } from "./a"` ⇒ resolved to `a`
    - alias import `import { foo as bar }` and call `bar()` ⇒ resolved
    - unresolved case: no exports match

---

### 9.4 Update cross-file inference pipeline to emit SymbolRef-based links

**Primary touchpoints**
- `src/index/type-inference-crossfile/pipeline.js`
- `src/index/type-inference-crossfile/symbols.js` (deprecate or repurpose)
- Tooling providers that key by `file::name`

#### 9.4.1 Replace `file::name` joins with chunkUid/symbol identity joins

- [ ] **Modify `src/index/type-inference-crossfile/pipeline.js`**
  - [ ] Replace `chunkByKey` (`file::name`) map with:
    - `chunkByUid: Map<chunkUid, chunk>`
    - `defsBySymbolId: Map<symbolId, chunkUid>` (for quick reverse lookup)
  - [ ] Replace legacy `calleeKey = file::target` logic with resolved SymbolRef:
    - call summary includes `resolvedCalleeChunkUid` when available.

#### 9.4.2 Emit new-format `callLinks` and `usageLinks`

- [ ] In pipeline, for each call relation:
  - [ ] Build `SymbolRefV1` via resolver.
  - [ ] Append `codeRelations.callLinks` entry in **new format**:
    ```
    {
      v: 1,
      edgeKind: "call",
      fromChunkUid: <caller chunkUid>,
      to: <SymbolRefV1>,
      confidence: <0..1>,
      evidence: {...}
    }
    ```
  - [ ] Preserve legacy fields only if necessary for backward compatibility:
    - if retained, ensure they are explicitly marked `legacy: true` and never used for joins.

- [ ] Same for `usageLinks` with `edgeKind: "usage"`.

#### 9.4.3 Keep `callSummaries` but add chunkUid resolution

- [ ] Extend each `callSummaries[]` record to include:
  - `calleeRef: SymbolRefV1`
  - `resolvedCalleeChunkUid: string | null`
  - Keep `target/file/kind` for display backward compatibility.

#### 9.4.4 Update tooling providers to key by chunkUid (no silent overwrites)

These providers currently map results by `file::name`:

- `src/index/tooling/clangd-provider.js`
- `src/index/tooling/pyright-provider.js`
- `src/index/tooling/sourcekit-provider.js`
- `src/index/tooling/typescript-provider.js`

- [ ] For each provider:
  - [ ] Replace Maps keyed by `file::name` with Maps keyed by `chunkUid`.
  - [ ] Where tool outputs are only name-addressable (TS map), apply the resolved entry to all matching chunks but do not overwrite unrelated chunks.
  - [ ] Add defensive warnings if multiple chunks match same name within a file (for diagnostics only; do not pick arbitrarily).

#### 9.4.5 Pipeline tests

- [ ] Update / add tests under `tests/type-inference-crossfile/*`:
  - Assert pipeline outputs `callLinks[].to.status` values are correct for fixtures.
  - Assert callSummaries contains `calleeRef` and `resolvedCalleeChunkUid` when resolvable.
  - Assert no `Map` join uses `file::name` in the pipeline (lint-like test via grep in CI is acceptable).

---

### 9.5 Emit symbol artifacts (`symbols`, `symbol_occurrences`, `symbol_edges`)

**Primary touchpoints**
- `src/index/build/artifacts.js`
- New writer modules in `src/index/build/artifacts/writers/`
- `src/shared/artifact-io.js`
- `src/shared/artifact-schemas.js`
- `src/index/validate.js`

#### 9.5.1 Add writer modules

- [ ] **Add `src/index/build/artifacts/writers/symbols.js`**
  - [ ] Iterator over `state.chunks` yielding `symbols.jsonl` records.
  - [ ] Deterministic order: sort by `symbolId` (or by `(virtualPath, qualifiedName, kindGroup, chunkUid)` if streaming constraints require per-shard sort).
  - [ ] Use JSONL sharding logic similar to `file-relations.js`.

- [ ] **Add `src/index/build/artifacts/writers/symbol-occurrences.js`**
  - [ ] Iterate chunks; for each call/usage relation occurrence emit occurrence record with `ref` included.

- [ ] **Add `src/index/build/artifacts/writers/symbol-edges.js`**
  - [ ] Iterate chunks; for each callLinks/usageLinks edge emit edge record.
  - [ ] Emit unresolved/ambiguous edges as well (they’re valuable for metrics and later resolution).

#### 9.5.2 Integrate into artifact build

- [ ] **Modify `src/index/build/artifacts.js`**
  - [ ] Write the three symbol artifacts into `index-code/`.
  - [ ] Ensure pieces manifest includes them.

- [ ] **Modify `src/shared/artifact-io.js`**
  - [ ] Add JSONL required keys entries for:
    - `symbols` (e.g., require `v`, `symbolId`, `chunkUid`)
    - `symbol_edges` (require `v`, `edgeKind`, `fromChunkUid`, `to`)
    - `symbol_occurrences` (require `v`, `fromChunkUid`, `occurrenceKind`)

- [ ] **Modify `src/shared/artifact-schemas.js`**
  - [ ] Add schemas for the new artifacts.

#### 9.5.3 Add validation and metrics hooks

- [ ] **Modify `src/index/validate.js`**
  - [ ] When symbol artifacts are present:
    - [ ] validate schema
    - [ ] cross-check referential integrity:
      - every `symbols.chunkUid` exists in chunk_meta
      - every resolved edge `to.resolved.chunkUid` exists
  - [ ] Compute and print metrics (non-fatal unless strict flag is enabled):
    - `resolvedRate`, `ambiguousRate`, `unresolvedRate`

#### 9.5.4 Tests for artifacts

- [ ] Add `tests/artifacts/symbol-artifacts-smoke.test.js`
  - Build a small in-memory “fake state” with 2 chunks and resolved/ambiguous links.
  - Run iterators and ensure JSONL output lines validate and include required keys.

---

### 9.6 Migrate relation graphs to use `chunkUid` and resolved edges only

**Primary touchpoints**
- `src/index/build/graphs.js`
- `tests/graph-chunk-id.js`
- `src/map/build-map.js` (consumes graph_relations)

#### 9.6.1 Update graph builder

- [ ] **Modify `src/index/build/graphs.js`**
  - [ ] Node identity:
    - `nodeId = chunk.metaV2.chunkUid`
    - Store legacy fields as attributes only.
  - [ ] Edges:
    - For each `callLinks`/`usageLinks` edge record:
      - if `to.status !== "resolved"` ⇒ skip for graph_relations edges
      - else edge target is `to.resolved.chunkUid`
  - [ ] Remove `chunkIdByKey` (`file::name`) join logic entirely.
  - [ ] Keep guardrails and sampling; update samples to include `chunkUid`.

#### 9.6.2 Graph schema/version bump

- [ ] Bump `graph_relations.version` to `2`
- [ ] Ensure consumers handle version 1 and 2:
  - v1: id may be chunkId or legacyKey
  - v2: id is chunkUid
  - Map builder should accept both (backward compatibility).

#### 9.6.3 Tests

- [ ] Update `tests/graph-chunk-id.js`
  - Ensure:
    - nodes keyed by chunkUid
    - collision scenario produces distinct node ids
    - legacyKey remains in attrs for diagnostics
  - Add regression: ambiguous edges are not included in graph edges.

---

### 9.7 Update map build to use new identities (and avoid collisions)

**Primary touchpoints**
- `src/map/build-map.js`
- `src/map/isometric/client/map-data.js` (only if assumptions change)

#### 9.7.1 Update symbol keying inside map build

- [ ] **Modify `src/map/build-map.js`**
  - Replace `buildSymbolId(file::name)` with:
    - prefer `chunk.metaV2.symbol.symbolId`
    - else use `chunk.metaV2.chunkUid`
  - Maintain a mapping:
    - `memberId -> chunkUid`
  - Use graph_relations v2 node ids (`chunkUid`) to join to chunk_meta.

#### 9.7.2 Backward compatibility

- [ ] If graph_relations.version === 1:
  - maintain existing behavior (best-effort)
- [ ] If version === 2:
  - require chunkUid mapping; fail with explicit error if missing (do not silently mis-join).

#### 9.7.3 Map tests

- [ ] Add `tests/map/map-build-symbol-identity.test.js`
  - Build minimal graph_relations v2 + chunk_meta fixture.
  - Assert map members are distinct for same-name collisions.

---

### 9.8 Performance, determinism, and regression guardrails

#### 9.8.1 Determinism requirements

- [ ] `chunkUid` deterministic for identical inputs.
- [ ] Symbol artifacts emitted in deterministic line order.
- [ ] Graph builder output deterministic ordering (`serializeGraph` already sorts).

Add tests:

- [ ] `tests/determinism/symbol-artifact-order.test.js`
  - Run iterator twice and assert identical output.

#### 9.8.2 Throughput requirements

- [ ] Avoid O(N^2) scans over all symbols per reference:
  - use name-indexed maps and import-narrowing.
- [ ] Avoid per-reference filesystem operations:
  - precompute `fileSet` in resolver.

Add tests/benchmarks (optional but recommended):

- [ ] `tools/bench/symbol-resolution-bench.js`
  - synthetic repo with 100k symbols and 200k refs; ensure runtime is bounded.

---

## Phase 9 exit criteria (must all be true)

- [ ] No graph or cross-file linking code performs `Map.set()` keyed solely by `file::name` in a way that can silently overwrite distinct entities.
- [ ] `metaV2.chunkUid` is present and non-empty for every code chunk (“fail closed”).
- [ ] `graph_relations.version === 2` and node ids are `chunkUid`.
- [ ] Pipeline emits SymbolRef-based call/usage links; ambiguous/unresolved are preserved explicitly.
- [ ] Symbol artifacts are written and validate successfully on the small fixture suite.
- [ ] New tests for chunkUid stability and resolver correctness are green.

---

## Appendix A — Concrete file-by-file change list (for Codex)

This appendix is purely to reduce “search time” during implementation. Each file lists the exact intent.

### A.1 New files to add

- `src/index/identity/normalize.js`
- `src/index/identity/virtual-path.js`
- `src/index/identity/segment-uid.js`
- `src/index/identity/chunk-uid.js`
- `src/index/identity/kind-group.js`
- `src/index/identity/symbol.js`
- `src/index/type-inference-crossfile/resolve-relative-import.js`
- `src/index/type-inference-crossfile/resolver.js`
- `src/index/build/artifacts/writers/symbols.js`
- `src/index/build/artifacts/writers/symbol-occurrences.js`
- `src/index/build/artifacts/writers/symbol-edges.js`
- Tests:
  - `tests/identity/chunk-uid-stability.test.js`
  - `tests/identity/segment-uid-stability.test.js`
  - `tests/identity/symbol-identity.test.js`
  - `tests/crossfile/resolve-relative-import.test.js`
  - `tests/crossfile/symbolref-resolution.test.js`
  - `tests/artifacts/symbol-artifacts-smoke.test.js`
  - `tests/map/map-build-symbol-identity.test.js`
  - `tests/determinism/symbol-artifact-order.test.js`

### A.2 Existing files to modify

- `src/index/segments.js` — compute and propagate `segmentUid`
- `src/index/build/file-processor.js` — compute `chunkUid`
- `src/index/build/file-processor/assemble.js` — pass through chunkUid fields
- `src/index/metadata-v2.js` — include identity + symbol identity
- `src/lang/javascript/relations.js` — emit `importBindings`
- `src/index/build/file-processor/relations.js` — include importBindings
- `src/shared/artifact-schemas.js` — add schemas, extend file_relations
- `src/shared/artifact-io.js` — required keys for new JSONL artifacts
- `src/index/type-inference-crossfile/pipeline.js` — emit SymbolRef edges and avoid file::name joins
- `src/index/tooling/{typescript,pyright,clangd,sourcekit}-provider.js` — key by chunkUid
- `src/index/build/artifacts.js` — write symbol artifacts
- `src/index/validate.js` — validate symbol artifacts (optional strict)
- `src/index/build/graphs.js` — graph_relations v2 using chunkUid
- `src/map/build-map.js` — join graph nodes to chunk meta via chunkUid
- `tests/graph-chunk-id.js` — update

---

## Appendix B — Metrics to report (recommended)

- `symbol_resolution.resolved_rate`
- `symbol_resolution.ambiguous_rate`
- `symbol_resolution.unresolved_rate`
- `symbol_resolution.max_candidates_hit_rate`
- `symbol_resolution.import_narrowed_rate`

In strict CI mode, optionally enforce:

- `wrong_link_rate == 0` on fixtures with gold truth
- `resolved_rate >= threshold` on fixtures (threshold set per fixture)

---
## Phase 10 — Interprocedural Risk Flows (taint summaries + propagation)

### Objective

Ship a deterministic, capped, and explainable **interprocedural taint-to-sink** capability by:

1. Generating per-chunk **risk summaries** from existing local risk signals (sources/sinks/sanitizers/local flows).
2. Propagating taint across the existing cross-file call graph to emit **path-level interprocedural risk flows** with bounded call-site evidence.
3. Surfacing a compact **risk.summary** inside `chunk_meta`/`metaV2` (without bloating chunk metadata) and writing dedicated artifacts:
   - `risk_summaries.jsonl`
   - `call_sites.jsonl`
   - `risk_flows.jsonl`
   - `risk_interprocedural_stats.json`

### Non-goals (explicit)

- Building a full intra-procedural taint engine (this phase uses lightweight local hints and conservative/arg-aware propagation).
- Adding a new database/index for risk flows (JSON/JSONL artifacts are sufficient for v1).
- Changing the existing local risk detector behavior by default (backwards compatibility is mandatory).

### Primary deliverables

- New config: `indexing.riskInterprocedural` (normalized + runtime-gated).
- New artifact writers and validators for the four artifacts.
- Deterministic propagation engine with strict caps + time guard.
- Call-site sampling with stable `callSiteId` derived from location.
- Compact in-chunk summary at `chunk.docmeta.risk.summary` and `chunk.metaV2.risk.summary`.
- Comprehensive test suite (functional + determinism + caps + size guardrails).

---

## 10.1 Configuration + runtime wiring (feature gating, defaults, index_state)

### Objective

Introduce a **strictly normalized** `indexing.riskInterprocedural` config that can be enabled without implicitly enabling unrelated features, while ensuring:
- It only operates when `riskAnalysisEnabled` is true.
- It only runs in `mode === "code"`.
- It forces cross-file linking to run (so call graph edges exist) even when type inference and legacy cross-file risk correlation are off.

### Files touched

- [ ] `src/index/build/runtime/runtime.js`
- [ ] `src/index/build/indexer/steps/relations.js`
- [ ] `src/index/build/indexer/steps/write.js`
- [ ] `src/index/build/state.js` (optional: add `state.riskInterprocedural` slot for clarity)
- [ ] **NEW** `src/index/risk-interprocedural/config.js`

### Tasks

- [ ] **10.1.1 Add config normalizer**
  - [ ] Create `src/index/risk-interprocedural/config.js` exporting:
    - [ ] `normalizeRiskInterproceduralConfig(input, { rootDir }) -> NormalizedRiskInterproceduralConfig`
    - [ ] `isRiskInterproceduralEnabled(config, runtime) -> boolean` (helper; optional)
  - [ ] Implement normalization rules exactly per Appendix A (defaults, caps, strictness, emit mode, deterministic ordering requirements).
  - [ ] Ensure normalization returns **frozen** (or treated as immutable) config object to avoid accidental mutation downstream.

- [ ] **10.1.2 Wire runtime flags + config**
  - [ ] In `createBuildRuntime()` (`src/index/build/runtime/runtime.js`):
    - [ ] Parse `indexing.riskInterprocedural` (boolean or object), normalize via `normalizeRiskInterproceduralConfig`.
    - [ ] Add runtime fields:
      - [ ] `runtime.riskInterproceduralEnabled`
      - [ ] `runtime.riskInterproceduralConfig` (normalized object)
      - [ ] `runtime.riskInterproceduralEffectiveEmit` (`"none" | "jsonl"`, resolved)
      - [ ] `runtime.riskInterproceduralSummaryOnlyEffective` (`summaryOnly || emitArtifacts === "none"`)
    - [ ] Gate: if `riskAnalysisEnabled` is false, force `riskInterproceduralEnabled=false` regardless of config.
    - [ ] Gate: if `mode !== "code"`, treat as disabled at execution time (do not write artifacts).

- [ ] **10.1.3 Ensure cross-file linking runs when interprocedural enabled**
  - [ ] In `src/index/build/indexer/steps/relations.js`, update:
    - [ ] `crossFileEnabled = runtime.typeInferenceCrossFileEnabled || runtime.riskAnalysisCrossFileEnabled || runtime.riskInterproceduralEnabled`
  - [ ] Ensure `applyCrossFileInference({ enabled: true, ... })` still receives:
    - [ ] `enableTypeInference: runtime.typeInferenceEnabled`
    - [ ] `enableRiskCorrelation: runtime.riskAnalysisEnabled && runtime.riskAnalysisCrossFileEnabled`
    - [ ] **No new implicit enabling** of either feature.

- [ ] **10.1.4 Record feature state in `index_state.json`**
  - [ ] In `src/index/build/indexer/steps/write.js`, extend `indexState.features`:
    - [ ] `riskInterprocedural: runtime.riskInterproceduralEnabled`
    - [ ] Optionally include a compact config summary in `indexState.featuresDetail.riskInterprocedural`:
      - [ ] `enabled`, `summaryOnly`, `emitArtifacts`, `strictness`, and `caps` (omit secrets; keep small)

### Tests

- [ ] **Unit:** `normalizeRiskInterproceduralConfig` defaulting rules + invalid values clamp behavior.
- [ ] **Unit:** gating rules:
  - [ ] if `indexing.riskAnalysis === false`, then `riskInterproceduralEnabled` must be false.
  - [ ] if `mode !== "code"`, no risk interprocedural artifacts are produced even if enabled.
- [ ] **Integration:** building an index with riskInterprocedural enabled produces `index_state.json` containing the new feature flags.

---

## 10.2 Contract hardening prerequisites (returns, params, and call-site locations)

### Objective

Remove known metadata hazards that would corrupt propagation inputs and ensure call-site evidence can be stably identified.

### Files touched

- [ ] `src/index/type-inference-crossfile/extract.js`
- [ ] `src/index/metadata-v2.js`
- [ ] `src/lang/javascript/relations.js`
- [ ] `src/lang/javascript/docmeta.js`
- [ ] `src/lang/javascript/ast-utils.js` (optional helper additions)
- [ ] `src/lang/python/ast-script.js`

### Tasks

- [ ] **10.2.1 Fix boolean `docmeta.returns` contamination**
  - [ ] In `src/index/type-inference-crossfile/extract.js`:
    - [ ] Update `extractReturnTypes(chunk)` so it **never** emits booleans or non-strings.
      - [ ] Accept `docmeta.returnType` if it is a non-empty string.
      - [ ] Accept `docmeta.returns` **only** if it is:
        - [ ] a string, or
        - [ ] an array of strings
      - [ ] Ignore booleans (JS uses `returns: true/false` as a doc-presence flag).
  - [ ] In `src/index/metadata-v2.js`:
    - [ ] Update `returns:` and `buildDeclaredTypes()` to ignore boolean `docmeta.returns`.
    - [ ] Ensure `metaV2.returns` is either a normalized string or `null`, never `"true"`/`"false"`.

- [ ] **10.2.2 Stabilize parameter contract for destructuring**
  - [ ] In `src/lang/javascript/relations.js`:
    - [ ] Replace `collectPatternNames(param, names)` usage for **signature param list** with a new stable algorithm:
      - [ ] For each positional param `i`:
        - [ ] If `Identifier`: name is identifier.
        - [ ] Else if `AssignmentPattern` with `Identifier` on left: name is identifier.
        - [ ] Else if `RestElement` with `Identifier`: name is identifier.
        - [ ] Else: name is `arg{i}` (positional placeholder).
      - [ ] Optionally compute and store `destructuredBindings`:
        - [ ] `{ "arg0": ["x","y"], "arg2": ["opts","opts.userId"] }` (bounded + deterministic)
    - [ ] Store new signature metadata under `functionMeta.sigParams` (and optionally `functionMeta.paramBindings`).
  - [ ] In `src/lang/javascript/docmeta.js`:
    - [ ] When resolving AST meta for a chunk (`functionMeta` / `classMeta`):
      - [ ] Prefer `sigParams` for `docmeta.params` when available.
      - [ ] Preserve existing doc-comment param extraction, but never let destructuring explode the positional contract.
    - [ ] Ensure `docmeta.params` becomes a positional list suitable for arg-aware mapping.

- [ ] **10.2.3 Add call-site location to `callDetails` (JS + Python)**
  - [ ] In `src/lang/javascript/relations.js`:
    - [ ] When pushing a `callDetails` entry, include:
      - [ ] `startLine`, `startCol`, `endLine`, `endCol` (1-based)
      - [ ] Optional: `startOffset`, `endOffset` (character offsets), derived from `node.range` or `node.start/end`
    - [ ] Ensure values are always present; if end is missing, set end=start.
  - [ ] In `src/lang/python/ast-script.js`:
    - [ ] Include `startLine`, `startCol`, `endLine`, `endCol` using `lineno`, `col_offset`, and (if available) `end_lineno`, `end_col_offset` (convert col to 1-based).
    - [ ] Keep the existing shape (`caller`, `callee`, `args`) unchanged and strictly additive.

### Tests

- [ ] **Unit:** return types never include boolean values:
  - [ ] Fixture JS function with `/** @returns */` must not produce `metaV2.returns === "true"`.
  - [ ] `extractReturnTypes` must never return `[true]`.
- [ ] **Unit:** destructured params:
  - [ ] Fixture `function f({a,b}, [c])` must produce `docmeta.params === ["arg0","arg1"]` (or based on actual signature).
  - [ ] `paramBindings` (if implemented) deterministic and bounded.
- [ ] **Unit:** callDetails include location:
  - [ ] JS fixture must include `startLine/startCol/endLine/endCol` for each call detail.
  - [ ] Python fixture likewise (when python parsing is enabled).

---

## 10.3 Risk summaries (artifact + compact `risk.summary` in chunk_meta)

### Objective

Generate a per-riskful-chunk summary artifact (`risk_summaries.jsonl`) and attach a **compact** `chunk.docmeta.risk.summary` used for retrieval and downstream joins, while enforcing deterministic ordering and explicit truncation markers.

### Files touched

- [ ] **NEW** `src/index/risk-interprocedural/summaries.js`
- [ ] `src/index/risk.js` (optional: emit `taintHints` inputs to enable `argAware`)
- [ ] `src/index/build/indexer/steps/relations.js`
- [ ] `src/index/metadata-v2.js` (meta rebuild call site; see 10.6)

### Tasks

- [ ] **10.3.1 Implement summary builder**
  - [ ] Create `buildRiskSummaries({ chunks, runtime })` that returns:
    - [ ] `summariesByChunkId: Map<chunkId, RiskSummaryRow>`
    - [ ] `compactByChunkId: Map<chunkId, CompactRiskSummary>`
    - [ ] `statsDelta` (counts and truncation flags to merge into stats artifact)
  - [ ] Build each row **only for chunks that have local risk** (`chunk.docmeta.risk.sources|sinks|sanitizers|flows` non-empty).
  - [ ] Implement deterministic ordering:
    - [ ] Sort signals by `(severity desc, confidence desc, ruleId asc, firstEvidenceLine asc)`
    - [ ] Sort evidence by `(line asc, column asc, snippetHash asc)`
  - [ ] Apply caps and explicitly mark truncation per spec:
    - [ ] `limits.evidencePerSignal` default 3
    - [ ] `limits.maxSignalsPerKind` default 50

- [ ] **10.3.2 Implement evidence hashing (no excerpts)**
  - [ ] For each evidence entry:
    - [ ] Compute `snippetHash = sha1(normalizeSnippet(excerpt))` when excerpt is available.
    - [ ] Store `line`, `column`, `snippetHash`.
    - [ ] Do **not** store excerpt in `risk_summaries.jsonl`.

- [ ] **10.3.3 Add compact `chunk.docmeta.risk.summary`**
  - [ ] For every chunk (including non-riskful):
    - [ ] Ensure `chunk.docmeta.risk.summary` exists with schemaVersion and local counts.
    - [ ] Populate `interprocedural` field only when interprocedural is enabled:
      - [ ] `enabled`, `summaryOnly`, and pointers to artifacts (or `null` when emitArtifacts is `"none"`).
  - [ ] Do **not** attach full interprocedural flows into `chunk.docmeta.risk.flows` (keep chunk_meta compact).

### Tests

- [ ] **Integration:** enable riskInterprocedural + run on `tests/fixtures/languages/src/javascript_risk_source.js` / `javascript_risk_sink.js`:
  - [ ] Verify `risk_summaries.jsonl` contains rows for both chunks (source-only chunk and sink-only chunk).
  - [ ] Verify `chunk_meta` contains `docmeta.risk.summary.schemaVersion === 1`.
- [ ] **Size guardrails:** craft a fixture with many matched lines and verify:
  - [ ] evidence is capped to `evidencePerSignal`.
  - [ ] signals capped to `maxSignalsPerKind`.
  - [ ] truncation flags set correctly.

---

## 10.4 Call-site sampling + `call_sites.jsonl`

### Objective

Emit stable, bounded call-site evidence for the subset of call edges that participate in emitted flows, and support arg-aware propagation using sampled `argsSummary` and a stable `callSiteId`.

### Files touched

- [ ] **NEW** `src/index/risk-interprocedural/call-sites.js`
- [ ] `src/index/type-inference-crossfile/pipeline.js` (optional: retain callDetails multiplicity; no dedupe here)
- [ ] `src/index/build/indexer/steps/relations.js`

### Tasks

- [ ] **10.4.1 Define `callSiteId` + call-site normalization**
  - [ ] Implement `computeCallSiteId({ file,startLine,startCol,endLine,endCol,calleeName })`:
    - [ ] `sha1("${file}:${startLine}:${startCol}:${endLine}:${endCol}:${calleeName}")`
  - [ ] Implement `normalizeArgsSummary(args: string[])`:
    - [ ] keep first 5 args
    - [ ] collapse whitespace
    - [ ] cap each arg to 80 chars with `…`

- [ ] **10.4.2 Resolve callDetails → callee chunkId**
  - [ ] For each chunk, build a local map `rawCalleeName -> resolved (file,target)` from `chunk.codeRelations.callLinks`.
  - [ ] Resolve `callDetail.callee` through that map to get callee chunk key `file::target`.
  - [ ] Resolve that key to `calleeChunkId` (via a prebuilt `chunkIdByKey` map).
  - [ ] If unresolved, skip (not a valid interprocedural edge).

- [ ] **10.4.3 Sample call sites per edge deterministically**
  - [ ] For each edge `(callerChunkId, calleeChunkId)` keep up to `maxCallSitesPerEdge` call sites (default 3).
  - [ ] Stable selection order: `(file, startLine, startCol, endLine, endCol, calleeName)`.
  - [ ] Ensure call_sites only includes edges actually referenced by emitted flows (filter on `edgesUsed` from propagation).

- [ ] **10.4.4 Call-site row size enforcement**
  - [ ] Enforce 32KB per JSONL line:
    - [ ] If too large, drop `argsSummary`.
    - [ ] If still too large, drop `snippetHash`.
    - [ ] If still too large, drop the record and increment stats `recordsDropped.callSites`.

### Tests

- [ ] **Integration:** in the javascript risk fixture, verify:
  - [ ] `call_sites.jsonl` exists and contains the edge `handleRequest -> runUnsafe`.
  - [ ] `callSiteId` is stable across two identical builds (byte-identical id).
- [ ] **Unit:** record size truncation logic is deterministic and increments the right stats.

---

## 10.5 Propagation engine + `risk_flows.jsonl`

### Objective

Compute bounded interprocedural flows from source-bearing chunks to sink-bearing chunks via the call graph, respecting:
- deterministic enumeration order
- strict caps (`maxDepth`, `maxTotalFlows`, `maxPathsPerPair`, `maxMs`, etc.)
- sanitizer policy barriers
- optional arg-aware strictness (taint set tracking, arg→param propagation, source-regex tainting)

### Files touched

- [ ] **NEW** `src/index/risk-interprocedural/propagate.js`
- [ ] **NEW** `src/index/risk-interprocedural/engine.js` (or `index.js`) (or integrate into relations step)
- [ ] `src/index/build/indexer/steps/relations.js`

### Tasks

- [ ] **10.5.1 Build the call graph adjacency list**
  - [ ] Build `chunkIdByKey: Map<"file::name", chunkId>` for all chunks.
  - [ ] For each chunk, for each `callLink`:
    - [ ] Resolve callee chunk key `callLink.file::callLink.target`.
    - [ ] Add edge `callerChunkId -> calleeChunkId` to adjacency list (deduped).
  - [ ] Sort adjacency list for each caller lexicographically by calleeChunkId for determinism.

- [ ] **10.5.2 Enumerate source roots and sink targets**
  - [ ] Source roots: chunks where summary has `sources.length > 0`.
  - [ ] Sink nodes: chunks where summary has `sinks.length > 0`.
  - [ ] Sort source roots by chunkId (deterministic).

- [ ] **10.5.3 Implement conservative propagation (baseline)**
  - [ ] BFS from each source root:
    - [ ] queue elements: `(chunkId, depth, pathChunkIds[], sanitizerBarriersHit)`
    - [ ] depth starts at 0 (root), expand until `depth === maxDepth`
    - [ ] When visiting a chunk with sinks and path length >= 2, attempt to emit flows.
  - [ ] Enforce caps:
    - [ ] stop globally at `maxTotalFlows`
    - [ ] for each `(sourceRuleId,sinkRuleId,sourceChunkId,sinkChunkId)` pair cap at `maxPathsPerPair`
    - [ ] stop expanding if queue grows too large (optional internal safety guard; record in stats)

- [ ] **10.5.4 Implement arg-aware strictness (optional but recommended for v1)**
  - [ ] Initial taint set at the source root:
    - [ ] `taint = union(docmeta.params, taintHints.taintedIdentifiers)` (bounded)
  - [ ] For each traversed edge:
    - [ ] Determine traversability:
      - [ ] Edge is traversable if at least one sampled callsite on that edge has a tainted arg:
        - [ ] arg string contains any identifier from taint set (identifier-boundary match), OR
        - [ ] arg string matches any *source* rule regex (same requires/pattern semantics as local detector)
    - [ ] Next taint set:
      - [ ] Map tainted arg positions → callee params (positional, from `callee.docmeta.params`)
      - [ ] Union with `callee.taintHints.taintedIdentifiers` (if present)
      - [ ] Cap taint set size to `maxTaintIdsPerState`
    - [ ] Track visited states by `(chunkId, taintSetKey, depth)` to prevent blowups.
  - [ ] If `taintHints` are not implemented, allow a fallback mode:
    - [ ] treat `docmeta.params` as initial taint only (lower recall, still deterministic)

- [ ] **10.5.5 Apply sanitizer policy**
  - [ ] If a visited chunk has sanitizers:
    - [ ] If policy `"terminate"`: do not expand outgoing edges beyond this chunk (but still allow sinks in it to emit flows).
    - [ ] Track `sanitizerBarriersHit` and include count in flow stats.

- [ ] **10.5.6 Emit `risk_flows.jsonl` rows**
  - [ ] For each emitted path, create `RiskFlowRow`:
    - [ ] `flowId = sha1("${sourceChunkId}->${sinkChunkId}|${sourceRuleId}|${sinkRuleId}|${pathJoined}")`
    - [ ] `path`: `chunkIds`, `edges` count, `callSiteIdsByStep` (filled after call-site sampling)
    - [ ] `confidence`: computed per spec (source/sink mean, depth decay, sanitizer penalty, strictness bonus)
    - [ ] `caps` populated with effective config caps
    - [ ] `notes` includes `strictness`, `timedOut=false`, `capsHit=[]` (leave empty; rely on stats for global caps)
  - [ ] After flow enumeration:
    - [ ] Build `edgesUsed` from emitted paths.
    - [ ] Generate call sites for edgesUsed (Phase 10.4).
    - [ ] Fill each flow’s `callSiteIdsByStep` from call-site sampling results.

- [ ] **10.5.7 Enforce flow record size limit**
  - [ ] Before writing a flow row:
    - [ ] If >32KB, truncate:
      - [ ] reduce `callSiteIdsByStep` to first id per step
      - [ ] then empty arrays
      - [ ] if still >32KB, drop the flow and increment stats `recordsDropped.flows`

### Tests

- [ ] **Integration (basic):** source→sink across one call edge produces exactly one flow.
- [ ] **Integration (depth):** A→B→C fixture emits flow with `edges=2` when `maxDepth >= 2`.
- [ ] **Cap behavior:** with `maxTotalFlows=1`, only one flow emitted and stats record cap hit.
- [ ] **Timeout:** with `maxMs=1` on a repo that would generate flows, status becomes `timed_out` and flows/callsites are omitted.
- [ ] **Sanitizer barrier:** fixture where B has sanitizer; with `terminate`, A→B→C should not be emitted if C is beyond B.
- [ ] **Arg-aware correctness:** fixture where A calls B with a constant arg; no flow in argAware, but flow exists in conservative.

---

## 10.6 Artifact writing, sharding, validation, and determinism (end-to-end)

### Objective

Write the new artifacts as first-class pieces (with optional sharding + compression), validate them, and ensure final `metaV2` includes the compact summary.

### Files touched

- [ ] `src/index/build/artifacts.js`
- [ ] `src/index/build/artifacts/writer.js`
- [ ] **NEW** `src/index/build/artifacts/writers/risk-interprocedural.js`
- [ ] `src/index/validate.js`
- [ ] `src/shared/artifact-io.js` (optional: required keys map updates)
- [ ] `src/index/build/indexer/steps/relations.js` (metaV2 rebuild)
- [ ] `src/index/metadata-v2.js` (ensure summary serialized as-is)

### Tasks

- [ ] **10.6.1 Ensure `metaV2` is rebuilt after cross-file + risk interprocedural mutations**
  - [ ] In `src/index/build/indexer/steps/relations.js`, after:
    - [ ] `applyCrossFileInference` (mutates `chunk.docmeta`, `chunk.codeRelations`)
    - [ ] risk summaries + propagation attach `chunk.docmeta.risk.summary`
  - [ ] Rebuild `chunk.metaV2 = buildMetaV2(chunk, chunk.docmeta, toolInfo)` for all chunks (or at least those in code mode).
  - [ ] Confirm `metaV2.risk.summary` matches `docmeta.risk.summary`.

- [ ] **10.6.2 Add artifact writer implementation**
  - [ ] Create `src/index/build/artifacts/writers/risk-interprocedural.js` exporting:
    - [ ] `enqueueRiskInterproceduralArtifacts({ writer, state, outDir, compression })`
    - [ ] `createRiskSummariesIterator(state)` (sorted by chunkId)
    - [ ] `createCallSitesIterator(state)` (sorted by callSiteId)
    - [ ] `createRiskFlowsIterator(state)` (already deterministic; optionally sort by flowId)
  - [ ] Integrate into `src/index/build/artifacts.js`:
    - [ ] After chunk_meta planning, call enqueue when:
      - [ ] `state.riskInterprocedural?.enabled === true`
      - [ ] `runtime.riskInterproceduralEffectiveEmit === "jsonl"`
      - [ ] respect `summaryOnlyEffective` for which artifacts are emitted
    - [ ] Always write `risk_interprocedural_stats.json` when enabled (even if emitArtifacts="none").
  - [ ] Ensure artifacts are registered as “pieces” so they appear in `pieces/manifest.json`.

- [ ] **10.6.3 Update index validator**
  - [ ] Extend `src/index/validate.js`:
    - [ ] Add optional artifact presence checks for:
      - [ ] `risk_summaries` (jsonl)
      - [ ] `call_sites` (jsonl)
      - [ ] `risk_flows` (jsonl)
      - [ ] `risk_interprocedural_stats.json` (json)
    - [ ] If `index_state.json` indicates `features.riskInterprocedural === true`:
      - [ ] Treat missing stats as an **issue**
      - [ ] Treat missing jsonl artifacts as:
        - [ ] issue when `emitArtifacts` was `"jsonl"`
        - [ ] warning when `"none"` or `summaryOnly` (requires reading featuresDetail or stats)
  - [ ] Add referential integrity validations:
    - [ ] Every `risk_flows.*.path.callSiteIdsByStep[][]` ID must exist in `call_sites`.
    - [ ] `risk_flows.*.source.chunkId`/`sink.chunkId` must exist in chunk_meta.
    - [ ] Record-size check (<=32KB) for a sample of lines (optional; full scan may be expensive).

- [ ] **10.6.4 Determinism and ordering guarantees**
  - [ ] Ensure all iterators output stable ordering:
    - [ ] summaries by chunkId
    - [ ] call sites by callSiteId
    - [ ] flows by emission order (or flowId, but pick one and lock it)
  - [ ] Ensure safe-regex compilation is deterministic (it already is, but add a test).

### Tests

- [ ] **Integration:** build index and verify artifacts exist and are referenced in pieces manifest.
- [ ] **Determinism:** two builds over identical repo/config yield byte-identical `risk_flows.jsonl` and `call_sites.jsonl`.
- [ ] **Validator:** `tools/index-validate.js` flags missing risk artifacts appropriately when feature enabled.

---

## 10.7 Explainability tooling (CLI) + docs

### Objective

Provide a developer-facing explanation path to inspect interprocedural flows without needing bespoke scripts.

### Files touched

- [ ] `bin/pairofcleats.js`
- [ ] **NEW** `tools/explain-risk.js` (or `src/index/explain-risk.js` + tool wrapper)
- [ ] `src/shared/artifact-io.js` (add lightweight stream readers for new jsonl artifacts; optional)

### Tasks

- [ ] **10.7.1 Add CLI command**
  - [ ] Add `pairofcleats explain-risk` command accepting:
    - [ ] `--repo <path>` / `--index-root <path>`
    - [ ] `--mode code` (default)
    - [ ] Exactly one of:
      - [ ] `--chunk-id <chunkId>`
      - [ ] `--flow-id <flowId>`
  - [ ] Output format (plain text, deterministic):
    - [ ] Print chunk header (file, symbol name, kind)
    - [ ] Print compact risk summary
    - [ ] Print top N flows (default 5), including:
      - [ ] path chunkIds with file/name display
      - [ ] callSite evidence (line/col + argsSummary)

- [ ] **10.7.2 Implement streaming readers**
  - [ ] Implement stream reader(s) that can:
    - [ ] iterate risk_flows.jsonl shards and filter by chunkId/flowId
    - [ ] build an in-memory map of callSiteId → record for referenced call sites only

- [ ] **10.7.3 Docs**
  - [ ] Add short docs section describing:
    - [ ] how to enable `riskInterprocedural`
    - [ ] which artifacts are created and how to interpret them
    - [ ] the CLI usage and expected output

### Tests

- [ ] **CLI smoke:** in a small fixture repo, `pairofcleats explain-risk --chunk-id <id>` prints at least one flow and exits 0.

---

## 10.8 End-to-end test matrix + performance guardrails

### Objective

Guarantee correctness, safety, and throughput characteristics via a complete test matrix.

### Tests (must-haves)

- [ ] **Functional**
  - [ ] Basic one-edge flow (existing JS risk fixtures).
  - [ ] Multi-hop flow (custom fixture repo created in test).
  - [ ] Sanitizer barrier case (custom fixture).
  - [ ] Unresolved call edge ignored (no callLink → no interprocedural edge).
- [ ] **Caps / guardrails**
  - [ ] maxDepth truncation.
  - [ ] maxPathsPerPair enforcement.
  - [ ] maxTotalFlows enforcement.
  - [ ] maxCallSitesPerEdge enforcement.
  - [ ] maxMs timeout behavior.
  - [ ] 32KB record size enforcement for call_sites and risk_flows.
- [ ] **Determinism**
  - [ ] Byte-identical outputs across two runs (same machine, same config).
  - [ ] Stable callSiteId and flowId across two runs.
- [ ] **Validator coverage**
  - [ ] index-validate reports required/optional correctly based on index_state/stats.
  - [ ] referential integrity check catches intentionally corrupted ids.

---

# Appendix A — Risk Interprocedural Config Spec (v1 refined)

# Spec: `indexing.riskInterprocedural` configuration (v1.1 refined)

## Status
* **Normative** for Phase 10 implementation.
* Uses RFC 2119 keywords (**MUST**, **SHOULD**, **MAY**) for requirements.

## 1) Purpose
This configuration surface controls the Phase 10 **interprocedural risk pipeline**:

1. Build **per-symbol risk summaries** (`risk_summaries` artifact + compact in-chunk summary).
2. Optionally build **interprocedural risk flows** (`risk_flows` artifact) and **call-site evidence** (`call_sites` artifact).
3. Emit a small **stats** artifact that explains what happened, including cap hits and timeouts.

Primary goals:
* Deterministic output under caps.
* Bounded artifacts suitable for large repos.
* No implicit enablement of unrelated features (e.g., type inference).

## 2) Configuration location
This configuration lives in the repo config object under:

```jsonc
{
  "indexing": {
    "riskInterprocedural": { /* … */ }
  }
}
```

> Note: PairOfCleats currently validates `.pairofcleats.json` against `docs/config-schema.json`, which does not yet include `indexing.*`. If/when user-configurable exposure is desired, the schema MUST be expanded accordingly. The implementation MUST still accept the config when it is provided programmatically (tests, internal wiring, or future schema expansion).

## 3) Object shape and defaults

### 3.1 Canonical shape
```jsonc
{
  "indexing": {
    "riskInterprocedural": {
      "enabled": false,
      "summaryOnly": false,
      "strictness": "conservative",
      "emitArtifacts": "jsonl",
      "sanitizerPolicy": "terminate",
      "caps": {
        "maxDepth": 4,
        "maxPathsPerPair": 200,
        "maxTotalFlows": 500,
        "maxCallSitesPerEdge": 3,
        "maxMs": null
      }
    }
  }
}
```

### 3.2 Field contract

| Key | Type | Default | Meaning |
|---|---:|---:|---|
| `enabled` | boolean | `false` | Enables the interprocedural risk pipeline. |
| `summaryOnly` | boolean | `false` | If `true`, compute summaries + compact in-chunk summary, but **do not** compute `risk_flows` or `call_sites`. |
| `strictness` | enum | `"conservative"` | Propagation policy. See §6. |
| `emitArtifacts` | enum | `"jsonl"` | Artifact emission policy. See §5. |
| `sanitizerPolicy` | enum | `"terminate"` | How sanitizer-bearing chunks affect propagation. See §7. |
| `caps.maxDepth` | integer ≥ 0 | `4` | Maximum call depth (edges traversed) for propagation. |
| `caps.maxPathsPerPair` | integer ≥ 1 | `200` | Maximum number of distinct paths per `(sourceChunkId, sinkChunkId, sourceRuleId, sinkRuleId)` pair. |
| `caps.maxTotalFlows` | integer ≥ 1 | `500` | Hard cap on total `risk_flows` rows emitted for the build. |
| `caps.maxCallSitesPerEdge` | integer ≥ 1 | `3` | Maximum number of call-site samples preserved per call edge. |
| `caps.maxMs` | integer ≥ 1 or `null` | `null` | Optional time guard for **flow propagation only**. See §8. |

## 4) Interactions with existing features (non-negotiable)

### 4.1 Local risk analysis dependency
Interprocedural risk **requires** local risk signals (`src/index/risk.js`).

Normative rules:
1. If local risk analysis is disabled for the build (effective `riskAnalysisEnabled === false`), then `riskInterprocedural.enabled` MUST be treated as `false` regardless of config.
2. Interprocedural risk MUST NOT change the local risk detector’s regex ruleset or caps, other than enabling cross-file linking (§4.2) and emitting additional artifacts.

### 4.2 Cross-file call linking requirement
Interprocedural risk requires resolved call edges (`chunk.codeRelations.callLinks`).

Normative rule:
* If `riskInterprocedural.enabled === true`, the build MUST run the cross-file linking stage at least to populate `chunk.codeRelations.callLinks` (even if type inference is disabled).

Implementation hook (current code):
* `src/index/type-inference-crossfile/pipeline.js` is invoked when:
  * `typeInferenceCrossFileEnabled || riskAnalysisCrossFileEnabled`
* This condition MUST be extended to include:
  * `|| riskInterproceduralEnabled`

### 4.3 Type inference must not be enabled implicitly
Normative rule:
* Enabling interprocedural risk MUST NOT force `typeInferenceEnabled` or `typeInferenceCrossFileEnabled` to `true`.

## 5) Artifact emission policy (`emitArtifacts`)
`emitArtifacts` controls whether on-disk artifacts are written:

* `"none"`:
  * No new `risk_*` artifacts are written.
  * The implementation MUST still attach the compact summary to `chunk.docmeta.risk.summary` (and therefore `metaV2` after rebuild).
  * The implementation SHOULD still write the stats artifact (it is tiny and aids observability), unless explicitly disabled by higher-level “no artifacts” settings.
* `"jsonl"`:
  * Artifacts are written in JSONL form and MAY be automatically sharded (see the artifact specs).
  * Global artifact compression settings (if any) MUST apply consistently.

## 6) Strictness modes (`strictness`)

### 6.1 `conservative` (required)
Propagation rule:
* If a source-bearing chunk is on a path, taint is assumed to potentially flow along **all** resolved outgoing call edges.

This mode prioritizes recall (may over-approximate).

### 6.2 `argAware` (optional but fully specified)
`argAware` adds an additional constraint to edge traversal using call-site argument summaries and source rules:

A call edge `(caller → callee)` is traversable for taint **only if** there exists at least one sampled call-site on that edge where **at least one argument** is considered tainted by either:

1. Identifier-boundary matching against the caller’s current taint identifier set (tainted params + locally-tainted variables), **OR**
2. Matching any configured **source rule regex** from the same local risk ruleset used by the local detector (covers direct source expressions like `req.body.userId`).

The implementation MUST:
1. Track a bounded taint identifier set per traversal state.
2. Use identifier-boundary matching (no naive substring matches).
3. When traversing to the callee, derive the callee’s initial taint identifier set by mapping tainted argument positions to callee parameter names.

Full details, bounds, and deterministic behavior are defined in the flows spec.

## 7) Sanitizer policy (`sanitizerPolicy`)

Allowed values:
* `"terminate"` (default): sanitizer-bearing chunks terminate propagation (no outgoing traversal from that chunk).
* `"weaken"`: sanitizer-bearing chunks allow traversal but apply a confidence penalty (see flows spec).

Normative rule:
* The pipeline MUST treat sanitizers as a property of a chunk summary (not of a call-site). Policy is applied during traversal.

## 8) Determinism and the time guard (`caps.maxMs`)

### 8.1 Determinism requirements (always)
All outputs MUST be stable across runs given the same repository contents and config.

Minimum required ordering rules:
* Source roots processed in lexicographic order of `sourceChunkId`, then `sourceRuleId`.
* Outgoing edges processed in lexicographic order of `calleeChunkId`.
* Sinks within a chunk processed in lexicographic order of `sinkRuleId`.

### 8.2 Time guard semantics (no partial nondeterministic output)
`caps.maxMs` is a **fail-safe** for flow propagation only. It MUST NOT produce “first N flows” based on runtime speed.

Normative behavior:
1. If the time budget is exceeded during propagation, the implementation MUST:
   * abort propagation entirely,
   * emit **zero** `risk_flows` rows and **zero** `call_sites` rows,
   * record `status="timed_out"` in the stats artifact.
2. Summaries MUST still be produced (they are computed before propagation).

Disallowed behavior:
* emitting a partial prefix of flows that depends on machine speed or scheduling.

## 9) Observability (required)
When `enabled === true`, the build MUST record:
* counts: summaries, edges, flows, call-sites
* cap hits (including which cap)
* whether a timeout occurred (`status="timed_out"`)

The recommended mechanism is the dedicated stats artifact defined in:
* `SPEC_risk_interprocedural_stats_json_v1_refined.md`

# Appendix B — risk_summaries.jsonl Spec (v1 refined)

# Spec: `risk_summaries` artifact (JSONL) (v1.1 refined)

## Status
* **Normative** for Phase 10 implementation.
* Uses RFC 2119 keywords (**MUST**, **SHOULD**, **MAY**) for requirements.

## 1) Goal
Provide a **per-symbol** risk/taint summary that is:

* derived from **local** risk signals (`chunk.docmeta.risk`)
* stable, bounded, and deterministic
* suitable as input to interprocedural propagation
* small enough to avoid bloating `chunk_meta`

This artifact is intentionally “summary-level”: it does **not** attempt to encode full dataflow graphs.

## 2) Artifact naming and sharding
The logical artifact name is `risk_summaries`.

An implementation MUST emit either:

### 2.1 Single-file form
* `risk_summaries.jsonl` (or `risk_summaries.jsonl.gz` / `risk_summaries.jsonl.zst` if compression is enabled)

### 2.2 Sharded form (recommended for large repos)
* `risk_summaries.meta.json`
* `risk_summaries.parts/`
  * `risk_summaries.part00000.jsonl` (or `.jsonl.gz` / `.jsonl.zst`)
  * `risk_summaries.part00001.jsonl`
  * …

The meta sidecar MUST follow the same shape used by existing sharded JSONL artifacts (e.g., `chunk_meta.meta.json`, `graph_relations.meta.json`):
* `format: "jsonl"`
* `shardSize` (bytes)
* `partsDir`, `partPrefix`, `parts[]`, `counts[]`
* `totalEntries`, `totalBytes`
* `schemaVersion` (for the rows, i.e., this spec’s versioning)

## 3) Identity model
Each row is keyed by `chunkId`:

* `chunkId` MUST match `src/index/chunk-id.js` output and `chunk.metaV2.chunkId`.

Normative constraints:
* There MUST be at most one row per `chunkId`.
* `file` MUST be a repo-relative POSIX path (forward slashes), matching the chunk’s `file`.

## 4) File format requirements
* Encoding: UTF-8
* Format: JSON Lines (**one JSON object per line**)
* No header row
* Each JSON line MUST be ≤ **32KB** UTF-8 (hard limit for v1.1)

If a record cannot be truncated to fit 32KB using §9, it MUST be dropped and recorded in the stats artifact as `droppedRecords`.

## 5) Which chunks produce rows
A row MUST be emitted for each chunk that satisfies all of:
1. `chunk.metaV2.chunkId` exists
2. `chunk.docmeta.risk` exists (local risk signals present)
3. `chunk.name` is a non-empty string **OR** `chunk.kind` is `"module"` (to allow module-level analysis when present)

Rationale: The interprocedural pipeline operates over callable-like symbols. Anonymous fragments are not resolvable call targets and are usually low value for cross-chunk propagation.

## 6) Row schema (normative)

### 6.1 TypeScript-like definition
```ts
type RiskSummariesRowV1_1 = {
  schemaVersion: 1,

  chunkId: string,
  file: string,

  symbol: {
    name: string,
    kind: string,            // e.g., function|method|class|module|...
    language?: string | null // language id if available
  },

  // Local risk signals, derived from chunk.docmeta.risk.{sources,sinks,sanitizers}
  sources: RiskSignalV1_1[],
  sinks: RiskSignalV1_1[],
  sanitizers: RiskSignalV1_1[],

  // Local source→sink flows detected within the chunk (summary only).
  localFlows: {
    count: number,
    // True if at least one local flow exists
    hasAny: boolean,
    // Distinct ruleId pairs, capped and sorted deterministically
    rulePairs: { sourceRuleId: string, sinkRuleId: string }[]
  },

  // Optional: used only when strictness=argAware (see config spec).
  // If present, it MUST be bounded and deterministic.
  taintHints?: {
    taintedIdentifiers: string[] // identifiers tainted via local source assignments; no excerpts
  },

  // Bounds + truncation signals
  limits: {
    evidencePerSignal: number,    // default 3
    maxSignalsPerKind: number,    // default 50
    truncated: boolean,
    droppedFields: string[]
  }
};

type RiskSignalV1_1 = {
  ruleId: string,
  ruleName: string,
  ruleType: "source" | "sink" | "sanitizer",
  category: string | null,        // risk rule category (e.g., input, sql, command, ...)
  severity: "low" | "medium" | "high" | "critical" | null,
  confidence: number | null,
  tags: string[],
  evidence: EvidenceV1_1[]
};

type EvidenceV1_1 = {
  file: string,
  line: number,                  // 1-based
  column: number,                // 1-based
  snippetHash: string | null      // "sha1:<hex>" or null
};
```

### 6.2 Required fields
A row MUST include:
* `schemaVersion`
* `chunkId`
* `file`
* `symbol.name`
* `symbol.kind`
* `sources`, `sinks`, `sanitizers` (MAY be empty arrays)
* `localFlows`
* `limits`

## 7) Evidence hashing (`snippetHash`)
The risk detector stores `excerpt` strings in local evidence. This artifact MUST NOT store excerpts.

Instead, evidence items MUST include `snippetHash` computed as:

1. Let `raw` be the excerpt string if available, else `""`.
2. Normalize: `normalized = raw.replace(/\s+/g, " ").trim()`.
3. If `normalized === ""`, `snippetHash = null`.
4. Else `snippetHash = "sha1:" + sha1(normalized)`.

The implementation MUST use the same SHA-1 routine used elsewhere in the toolchain (`src/shared/hash.js`) to avoid inconsistencies.

## 8) Derivation rules (from existing PairOfCleats data)

### 8.1 Sources / sinks / sanitizers
For a given `chunk`:
* `sources` MUST be derived from `chunk.docmeta.risk.sources`
* `sinks` MUST be derived from `chunk.docmeta.risk.sinks`
* `sanitizers` MUST be derived from `chunk.docmeta.risk.sanitizers`

For each entry:
* `ruleId` := `entry.ruleId || entry.id`
* `ruleName` := `entry.name`
* `ruleType` := `entry.ruleType`
* `category` := `entry.category || null`
* `severity` := `entry.severity || null`
* `confidence` := `entry.confidence || null`
* `tags` := `entry.tags || []`
* Evidence items MUST be converted to `EvidenceV1_1` and include `file` (the chunk file).

### 8.2 Local flow summary
`chunk.docmeta.risk.flows` is a list of local source→sink flow hints.

`localFlows` MUST be computed as:
* `count` := number of local flow entries
* `hasAny` := `count > 0`
* `rulePairs` := distinct `{sourceRuleId, sinkRuleId}` pairs inferred from `flow.ruleIds` when present, capped at 50 pairs.

Deterministic ordering:
* Sort `rulePairs` by `(sourceRuleId, sinkRuleId)`.

### 8.3 Optional taint hints (for `strictness="argAware"`)
If the implementation supports `strictness="argAware"` (see config + flows specs), it SHOULD populate:

* `taintHints.taintedIdentifiers`

These hints improve recall for cases where tainted values are first assigned to variables (e.g., `const id = req.body.id; runQuery(id)`), because call-site args often reference the variable name rather than the original source expression.

Definition:
* Identifiers that became tainted by local assignment from a local source (i.e., variables tracked as tainted by the same mechanism used to produce local flows).

Constraints:
* MUST be de-duplicated.
* MUST be sorted lexicographically.
* MUST be capped at 50 identifiers.

Important: `argAware` MUST still function without these hints by recognizing **direct** source expressions via the configured source-rule regexes (see flows spec). If `taintHints` are omitted, the stats artifact SHOULD record a note that variable-assignment taint hints were unavailable (degraded precision/recall).
## 9) Determinism and bounding rules

### 9.1 Sorting and caps (required)
For each signal list (`sources`, `sinks`, `sanitizers`):
1. Sort by `(ruleId, minEvidenceLocation)` where `minEvidenceLocation` is the earliest `(file,line,column)`.
2. Take at most `maxSignalsPerKind` (default 50).

For each signal’s evidence list:
1. Sort by `(file,line,column)`.
2. Take at most `evidencePerSignal` (default 3).

### 9.2 Per-record 32KB truncation (required and deterministic)
If `Buffer.byteLength(JSON.stringify(row), "utf8") > 32768`, apply the following deterministic truncation steps in order until within limit:

1. **Drop per-signal `tags` arrays** (set to `[]` for all signals).
2. Reduce `evidence` arrays to **1 item** per signal.
3. Truncate `sources`, `sinks`, `sanitizers` to **at most 10** each.
4. Drop `taintHints` entirely (if present).
5. Truncate `localFlows.rulePairs` to **at most 10**.

If the row still exceeds 32KB after step 5:
* The row MUST be dropped.
* `limits.truncated` MUST be `true` and `limits.droppedFields` MUST reflect the steps attempted.
* The drop MUST be recorded in the stats artifact (`droppedRecords` with reason `"recordTooLarge"`).

## 10) Inline compact summary (in chunk meta)
In addition to the JSONL artifact, each chunk with local risk MUST receive a compact summary:

* `chunk.docmeta.risk.summary` (and therefore `chunk.metaV2.risk.summary` after metaV2 rebuild)

### 10.1 Compact summary schema (normative, small)
```ts
type RiskCompactSummaryV1_1 = {
  schemaVersion: 1,
  sources: { count: number, topCategories: string[] },
  sinks: { count: number, maxSeverity: string | null, topCategories: string[] },
  sanitizers: { count: number },
  localFlows: { count: number },
  // Optional: summary of interprocedural status (not flows)
  interprocedural?: { enabled: boolean, summaryOnly: boolean }
};
```

Constraints:
* MUST NOT include excerpts or evidence arrays.
* `topCategories` MUST be the most frequent categories, ties broken lexicographically, capped at 3.

Rationale: this is intended for retrieval/UI and must remain compact.

## 11) Validation invariants (required)
The build validator SHOULD check:
* `schemaVersion === 1`
* `chunkId` uniqueness
* `file` is non-empty
* evidence `line` and `column` are positive integers
* `snippetHash` matches `^sha1:[0-9a-f]{40}$` when not null

# Appendix C — risk_flows.jsonl + call_sites.jsonl Spec (v1 refined)

# Spec: `call_sites` and `risk_flows` artifacts (JSONL) (v1.1 refined)

## Status
* **Normative** for Phase 10 implementation.
* Uses RFC 2119 keywords (**MUST**, **SHOULD**, **MAY**) for requirements.

## 1) Goal
These artifacts provide explainable, bounded evidence for **interprocedural** (cross-chunk) risk:

* `call_sites`: sampled call-site records keyed by `callSiteId`
* `risk_flows`: interprocedural source→sink paths through the resolved call graph, with per-edge call-site references

They are designed to be:
* deterministic under caps
* small enough to load for `--explain-risk`
* joinable (strict referential integrity)

## 2) Artifact naming and sharding
Logical artifact names:
* `call_sites`
* `risk_flows`

Each MUST be emitted in either single-file or sharded form as described in the summaries spec (§2):
* `<name>.jsonl` (or compressed)
* or `<name>.meta.json` + `<name>.parts/…`

## 3) Common format requirements
* UTF-8
* JSON Lines
* no header row
* each line MUST be ≤ **32KB** UTF-8

If a record cannot be truncated to fit 32KB deterministically, it MUST be dropped and recorded in the stats artifact.

## 4) `call_sites` schema (normative)

### 4.1 TypeScript-like definition
```ts
type CallSitesRowV1_1 = {
  schemaVersion: 1,

  callSiteId: string,         // "sha1:<hex>"
  callerChunkId: string,
  calleeChunkId: string,

  file: string,               // repo-relative POSIX path (call site location)
  startLine: number,          // 1-based
  startCol: number,           // 1-based
  endLine: number,            // 1-based (best-effort; may equal startLine)
  endCol: number,             // 1-based (best-effort)

  calleeName: string,         // raw callee string from relations (pre-resolution)

  // Bounded argument summaries at the call site.
  argsSummary: string[],

  // Hash of the call expression snippet (when available), else null.
  snippetHash: string | null
};
```

### 4.2 `callSiteId` computation (required)
`callSiteId` MUST be computed as:

```
callSiteId = "sha1:" + sha1(
  file + ":" +
  startLine + ":" + startCol + ":" +
  endLine + ":" + endCol + ":" +
  calleeName
)
```

Constraints:
* `file` MUST be the repo-relative POSIX path.
* Line/col MUST be 1-based.
* `calleeName` MUST be the raw string recorded by the language relations collector (e.g., `"runQuery"` or `"db.query"`).

### 4.3 `argsSummary` normalization (required)
Rules:
* Keep at most **5** arguments.
* Each argument string MUST be:
  * trimmed
  * whitespace-collapsed (`\s+ -> " "`)
  * capped at **80** characters (truncate with `…`)

If arguments are unavailable, `argsSummary` MUST be an empty array.

### 4.4 `snippetHash` computation
Preferred computation:
1. Extract the call expression substring from the source file using language-provided offsets/locations.
2. Normalize whitespace (`\s+ -> " "`, trim).
3. `snippetHash = "sha1:" + sha1(normalized)` if non-empty, else `null`.

Fallback if extraction is not possible:
* `snippetHash = "sha1:" + sha1((calleeName + "(" + argsSummary.join(",") + ")").trim())`

This fallback ensures deterministic values without requiring full-fidelity snippet extraction on every language.

## 5) Call-site collection and sampling

### 5.1 Required source of call sites
Call sites MUST be derived from `chunk.codeRelations.callDetails` for each chunk, after cross-file linking has executed.

Implementation note (current code shape):
* JS relations: `src/lang/javascript/relations.js` populates `callDetails[]`.
* Python relations: `src/lang/python/ast-script.js` populates `call_details`.

Phase 10 MUST extend these collectors to include call-site location fields (line/col and/or offsets) so `callSiteId` is stable.

### 5.2 Location fields to add (required)
Each `callDetails` entry MUST include, when available:
* `startLine`, `startCol`, `endLine`, `endCol` (1-based)
* optionally `startOffset`, `endOffset` (0-based character offsets into the file)

If `endLine/endCol` are not available, collectors MUST set them equal to `startLine/startCol`.

### 5.3 Sampling per resolved edge (required)
`call_sites` MUST be bounded by sampling:

For each resolved call edge `(callerChunkId, calleeChunkId)`, keep at most:
* `caps.maxCallSitesPerEdge` call sites

Deterministic sampling order:
* Sort candidate call sites by `(file, startLine, startCol, endLine, endCol, calleeName)`.
* Take the first `maxCallSitesPerEdge`.

Only call sites for edges that appear in at least one emitted `risk_flows` row MUST be written.
(Edges never used in any emitted flow should not inflate artifacts.)

## 6) `risk_flows` schema (normative)

### 6.1 TypeScript-like definition
```ts
type RiskFlowsRowV1_1 = {
  schemaVersion: 1,

  flowId: string,               // "sha1:<hex>"

  source: FlowEndpointV1_1,
  sink: FlowEndpointV1_1,

  // Path as a sequence of chunkIds from source chunk to sink chunk.
  // Length MUST be >= 2 (interprocedural only).
  path: {
    chunkIds: string[],
    // One array per edge (chunkIds[i] -> chunkIds[i+1]).
    // Each entry is a list of callSiteIds for that edge (possibly empty).
    callSiteIdsByStep: string[][]
  },

  confidence: number,            // 0..1

  notes: {
    strictness: "conservative" | "argAware",
    sanitizerPolicy: "terminate" | "weaken",
    hopCount: number,
    sanitizerBarriersHit: number,
    capsHit: string[]            // e.g., ["maxTotalFlows","maxPathsPerPair"]
  }
};

type FlowEndpointV1_1 = {
  chunkId: string,
  ruleId: string,
  ruleName: string,
  ruleType: "source" | "sink",
  category: string | null,
  severity: "low" | "medium" | "high" | "critical" | null,
  confidence: number | null
};
```

### 6.2 `flowId` computation (required)
`flowId` MUST be computed as:

```
flowId = "sha1:" + sha1(
  source.chunkId + "|" + source.ruleId + "|" +
  sink.chunkId + "|" + sink.ruleId + "|" +
  path.chunkIds.join(">")
)
```

### 6.3 Path invariants (required)
For every row:
* `path.chunkIds.length >= 2`
* `path.callSiteIdsByStep.length == path.chunkIds.length - 1`
* Every `callSiteId` referenced MUST exist in the emitted `call_sites` artifact.

## 7) Flow generation algorithm (normative)

### 7.1 Inputs
The propagation engine operates on:
* `risk_summaries` in-memory representation (built from chunks)
* resolved call graph edges derived from `chunk.codeRelations.callLinks`
* local risk signals (sources/sinks/sanitizers) from summaries
* config (`caps`, `strictness`, `sanitizerPolicy`)

### 7.2 What is a “source root”
A source root is a pair:
* `(sourceChunkId, sourceRuleId)` for each source signal in a chunk.

Roots MUST be processed in deterministic order:
1. sort by `sourceChunkId`
2. then by `sourceRuleId`

### 7.3 Which sinks are emitted
When traversal reaches a chunk that has one or more sink signals:
* Emit a flow for each `(sourceRuleId, sinkRuleId)` pair encountered, subject to caps.
* The sink chunk may be at depth 1..maxDepth.
* Flows MUST be interprocedural: do not emit flows where `sourceChunkId === sinkChunkId`.

Sinks in chunks that are not reachable under the strictness mode MUST NOT be emitted.

### 7.4 Sanitizer barriers
Define a chunk as “sanitizer-bearing” if its summary contains at least one sanitizer signal.

If `sanitizerPolicy="terminate"`:
* Traversal MUST stop expanding outgoing edges from sanitizer-bearing chunks.
* Flows MAY still be emitted for sinks in the sanitizer-bearing chunk itself (conservative assumption).

If `sanitizerPolicy="weaken"`:
* Traversal continues, but confidence is penalized (§8.2).
* `notes.sanitizerBarriersHit` MUST count how many sanitizer-bearing chunks were encountered on the path (excluding the source chunk).

### 7.5 Caps (required)
During flow enumeration the implementation MUST enforce:
* `maxDepth`
* `maxPathsPerPair`
* `maxTotalFlows`

Definitions:
* A “pair” for `maxPathsPerPair` is:
  `(sourceChunkId, sourceRuleId, sinkChunkId, sinkRuleId)`

A “distinct path” is:
* `path.chunkIds.join(">")` (exact match)

Enforcement MUST be deterministic:
* If a cap would be exceeded, additional items MUST be skipped in the same deterministic enumeration order (no randomness).

### 7.6 Deterministic enumeration order (required)
Within a BFS from a source root:
* Explore outgoing edges from a chunk in lexicographic order of `calleeChunkId`.
* When multiple call sites exist for an edge, use the deterministic sample order in §5.3.
* When a sink-bearing chunk is reached, emit sink rules sorted by `sinkRuleId`.

This guarantees a stable ordering and cap behavior.

## 8) Strictness semantics (normative)

### 8.1 `conservative`
Edge traversal condition:
* Always traversable (subject to sanitizer policy).

### 8.2 `argAware` (stateful taint; bounded and deterministic)
`argAware` traversal MUST be stateful.

#### 8.2.1 State definition
Each BFS queue entry is:
* `(chunkId, depth, taintSetKey)`

Where `taintSetKey` is a canonical, deterministic string encoding of a bounded identifier set.

The identifier set represents names that are considered tainted within the current chunk context:
* parameter names tainted by upstream calls
* optionally, locally-tainted variable names (`taintHints.taintedIdentifiers`)
* (optional) reserved marker `"__SOURCE__"` is allowed but not required

The set MUST be:
* de-duplicated
* sorted lexicographically
* capped at **16** identifiers (drop extras deterministically after sorting)

Canonical key:
* `taintSetKey = identifiers.join(",")`

#### 8.2.2 When an argument is “tainted”
Given a call-site `argsSummary[]`, an argument is considered tainted if either:
1. It identifier-matches any identifier in the caller’s taint set (identifier-boundary match), OR
2. It matches any configured **source rule regex** from the local risk ruleset (the same rules used by the local detector).

(2) ensures direct source expressions like `req.body.userId` can be recognized even without local assignment hints.

#### 8.2.3 Traversing an edge and deriving callee taint
For a resolved edge `(caller → callee)`, consider its sampled call sites.

The edge is traversable if **any** sampled call site yields at least one tainted argument under §8.2.2.

When traversing, the callee’s next taint set MUST be derived as:
1. Obtain the callee parameter names (from `callLink.paramNames` if available; else from `calleeChunk.docmeta.params`; else empty).
2. For each sampled call site:
   * For each argument position `i`, if `argsSummary[i]` is tainted, then taint the callee param name at `i` (if present).
3. Union all tainted callee params across sampled call sites.
4. If `callee` has `taintHints.taintedIdentifiers`, union them as well.
5. Canonicalize using §8.2.1.

If the resulting callee taint set is empty, the edge MUST NOT be traversed.

#### 8.2.4 Visited-state and cycles
Visited MUST be tracked on `(chunkId, taintSetKey, depth)` to avoid infinite loops.

## 9) Confidence scoring (normative)

### 9.1 Base confidence
Let:
* `Cs` = source signal confidence (default 0.5 if null)
* `Ck` = sink signal confidence (default 0.5 if null)

Base:
* `Cbase = clamp01(0.1 + 0.9 * Cs * Ck)`

### 9.2 Hop decay
For hop count `h = path.chunkIds.length - 1`:
* `decay = 0.85^max(0, h-1)`

(First hop is not penalized; deeper chains decay.)

### 9.3 Sanitizer penalty (`weaken` policy only)
If `sanitizerPolicy="weaken"`:
* `penalty = 0.5^(notes.sanitizerBarriersHit)`

Else:
* `penalty = 1`

### 9.4 Final
`confidence = clamp01(Cbase * decay * penalty)`

## 10) Per-record truncation (required)
If a `risk_flows` row exceeds 32KB, apply deterministic truncation:

1. Replace each `callSiteIdsByStep[i]` with at most **1** id.
2. If still too large, drop `callSiteIdsByStep` entirely and replace with empty arrays for each step.
3. If still too large, drop the row and record in stats.

If a `call_sites` row exceeds 32KB:
1. Drop `argsSummary`.
2. If still too large, drop `snippetHash`.
3. If still too large, drop the row and record in stats.

## 11) Validation invariants (required)
The validator SHOULD check:
* `schemaVersion === 1`
* `flowId` and `callSiteId` match `^sha1:[0-9a-f]{40}$`
* `path.callSiteIdsByStep.length === path.chunkIds.length - 1`
* Every referenced `callSiteId` exists (referential integrity)
* line/col are positive integers

# Appendix D — risk_interprocedural_stats.json Spec (v1 refined)

# Spec: `risk_interprocedural_stats` artifact (JSON) (v1.1 refined)

## Status
* **Normative** for Phase 10 implementation.
* Uses RFC 2119 keywords (**MUST**, **SHOULD**, **MAY**) for requirements.

## 1) Goal
Provide a single, small, human-readable summary of the interprocedural risk pipeline execution:

* whether it ran
* whether it timed out
* which caps were hit
* counts of emitted rows
* pointers to emitted artifacts (single or sharded)

This avoids “hidden failure” where flows are missing but users cannot tell why.

## 2) Artifact naming
Logical artifact name: `risk_interprocedural_stats`

Recommended filename:
* `risk_interprocedural_stats.json`

This file is not sharded.

## 3) Schema (normative)

### 3.1 TypeScript-like definition
```ts
type RiskInterproceduralStatsV1_1 = {
  schemaVersion: 1,
  generatedAt: string, // ISO timestamp

  status: "ok" | "disabled" | "timed_out" | "error",
  reason: string | null,

  effectiveConfig: {
    enabled: boolean,
    summaryOnly: boolean,
    strictness: "conservative" | "argAware",
    emitArtifacts: "none" | "jsonl",
    sanitizerPolicy: "terminate" | "weaken",
    caps: {
      maxDepth: number,
      maxPathsPerPair: number,
      maxTotalFlows: number,
      maxCallSitesPerEdge: number,
      maxMs: number | null
    }
  },

  counts: {
    chunksConsidered: number,
    summariesEmitted: number,
    sourceRoots: number,
    resolvedEdges: number,

    flowsEmitted: number,
    callSitesEmitted: number
  },

  capsHit: string[], // e.g., ["maxTotalFlows","maxPathsPerPair"]

  timingsMs: {
    summaries: number,
    propagation: number,
    total: number
  },

  artifacts: {
    riskSummaries?: ArtifactRefV1_1,
    callSites?: ArtifactRefV1_1,
    riskFlows?: ArtifactRefV1_1
  },

  droppedRecords: {
    artifact: "risk_summaries" | "call_sites" | "risk_flows",
    count: number,
    reasons: { reason: string, count: number }[]
  }[]
};

type ArtifactRefV1_1 = {
  name: string,              // logical name
  format: "jsonl",
  sharded: boolean,
  // If sharded: the meta filename; else: the artifact filename
  entrypoint: string,
  totalEntries: number
};
```

### 3.2 Status rules (required)
* If `riskInterprocedural.enabled` is false (or forced off due to local risk disabled): `status="disabled"`.
* If propagation exceeds `caps.maxMs`: `status="timed_out"`.
* If an unhandled exception occurs: `status="error"` and `reason` MUST be set.
* Otherwise: `status="ok"`.

Normative: `timed_out` MUST imply `flowsEmitted === 0` and `callSitesEmitted === 0`.

## 4) Artifact references
When `emitArtifacts="jsonl"`:
* `artifacts.riskSummaries` MUST be present if summaries were emitted.
* If `summaryOnly=false` and `status="ok"`:
  * `artifacts.callSites` and `artifacts.riskFlows` MUST be present.

When `emitArtifacts="none"`:
* `artifacts` MAY be empty, but counts and status MUST still be recorded.

For `ArtifactRefV1_1.entrypoint`:
* If non-sharded: the filename (e.g., `risk_summaries.jsonl`)
* If sharded: the meta filename (e.g., `risk_summaries.meta.json`)

## 5) Determinism
The stats artifact MUST be deterministic except for:
* `generatedAt`
* `timingsMs` (performance-dependent)

Everything else (counts, capsHit, filenames) MUST be stable given the same repo + config.

## 6) Validation invariants
The validator SHOULD check:
* `schemaVersion === 1`
* `generatedAt` is ISO-like
* required fields exist for each `status`
* if `status="timed_out"`, then `flowsEmitted===0` and `callSitesEmitted===0`

# Appendix E — Phase 10 Refined Implementation Notes (source)

# Phase 10 (Interprocedural Risk Flows) — Refined Implementation Plan (PairOfCleats)

## 1) Purpose
Phase 10 extends PairOfCleats’ current **intra-chunk** risk detection to **interprocedural** (cross-function) risk paths by:

1. Producing a **per-symbol taint summary**.
2. Propagating taint through the **resolved call graph** to emit **explainable risk paths**.
3. Surfacing those results in existing artifacts and retrieval UX.

This plan refines and de-ambiguates the Phase 10 roadmap items while aligning them to the current PairOfCleats codebase.

## 2) Current-state facts in the codebase (why Phase 10 is needed)

### 2.1 Risk detection is local (intra-chunk)
* `src/index/risk.js` scans chunk text for rule matches and tracks simple variable assignment taint.
* It can emit `docmeta.risk.sources`, `docmeta.risk.sinks`, `docmeta.risk.sanitizers`, and local `docmeta.risk.flows`.
* It **does not** currently produce multi-hop call paths.

### 2.2 Cross-file inference already resolves call links (but loses call-site multiplicity)
* `src/index/type-inference-crossfile/pipeline.js` builds `chunk.codeRelations.callLinks` using `addLink(...)`, which **dedupes** by `(calleeName, targetName, targetFile)` and drops distinct call-sites.

### 2.3 metaV2 can drift
* `src/index/build/file-processor/assemble.js` builds `metaV2` early.
* `src/index/build/indexer/steps/relations.js` runs `applyCrossFileInference(...)` later, which mutates `chunk.docmeta` and `chunk.codeRelations`.
* Without a post-enrichment rebuild, `metaV2` can become stale.

## 3) Design principles (non-negotiable)

1. **Determinism**: same repo+config must produce identical risk artifacts (ordering, truncation, sampling).
2. **Bounded output**: every new artifact must have strict caps and per-record byte-size limits.
3. **Minimal coupling**: interprocedural risk flows must not “accidentally” enable type inference or tooling.
4. **Joinability**: all artifacts must share stable IDs to enable joins without heuristics.

## 4) Key decisions (resolve ambiguity)

### D1 — Canonical identity for symbols and edges
**Decision:** Use `chunk.metaV2.chunkId` as the canonical symbol identifier.

*Why this is best:* `chunkId` already encodes `(file, segmentId, range, kind, name)` via `src/index/chunk-id.js`, avoiding ambiguity when `(file,name)` collides.

**Edge identity:** `edgeId = sha1("${callerChunkId}->${calleeChunkId}")`.

### D2 — Storage strategy
**Decision:** Store *compact* summary fields inline on each chunk **and** emit full JSONL artifacts.

* Inline: `chunk.docmeta.risk.summary` and `chunk.metaV2.risk.summary` (compact + capped).
* Artifacts: `risk_summaries.jsonl`, `risk_flows.jsonl`, and `call_sites.jsonl`.

*Why this is best:* inline summary supports fast retrieval and ranking without reading large JSONL; JSONL supports validation, bulk analysis, and explainability.

### D3 — Call-site evidence strategy
**Decision:** Preserve multiple call-sites per edge in a **separate** `call_sites.jsonl` artifact and reference them by `callSiteId` from flows.

*Why this is best:* avoids `chunk_meta` bloat; keeps call-site samples bounded and reusable across multiple flows.

### D4 — Capping and time budgets
**Decision:** Do **not** allow time budgets to create partially-different outputs.

* Use structural caps (`maxDepth`, `maxPathsPerSourceSink`, `maxTotalFlows`, `maxCallSitesPerEdge`).
* If an optional `maxMs` guard is enabled and is exceeded:
  * abort propagation entirely and emit a single deterministic `analysisStatus: "timed_out"` record (no partial flows), or
  * record `analysisStatus: "timed_out"` and write **zero** `risk_flows` rows.

*Why this is best:* preserves strict determinism.

### D5 — Strictness modes
**Decision:** Implement strictness as:

* `conservative` (default): summary-level propagation; no arg->param taint mapping.
* `argAware` (opt-in): only enabled if parameter contracts exist; supports arg->param mapping.

*Why this is best:* incremental correctness; avoids claiming precision we can’t support.

## 5) Implementation plan (step-by-step)

### Step 1 — Add config surface + runtime flags
**Files:**
* `src/index/build/runtime/runtime.js`
* `src/index/build/indexer/pipeline.js` (feature metrics registration)

**Add:** `indexing.riskInterprocedural` object:

```js
indexing: {
  riskInterprocedural: {
    enabled: false,
    summaryOnly: false,
    strictness: 'conservative',
    emitArtifacts: 'jsonl',
    caps: {
      maxDepth: 4,
      maxPathsPerPair: 200,
      maxTotalFlows: 500,
      maxCallSitesPerEdge: 3,
      // maxMs optional; if set, must not affect partial output
      maxMs: null
    }
  }
}
```

**Gating:** enabling `riskInterprocedural.enabled` must force cross-file call linking to run even when `riskAnalysisCrossFile` is off.

Practical change: in `runCrossFileInference(...)`, define:

```js
const interprocEnabled = runtime.riskInterproceduralEnabled;
const crossFileEnabled = runtime.typeInferenceCrossFileEnabled ||
  runtime.riskAnalysisCrossFileEnabled ||
  interprocEnabled;
```

…but keep `enableTypeInference` and `enableRiskCorrelation` false unless explicitly enabled.

### Step 2 — Fix parameter/return contracts (prerequisite for summaries)
**Files:**
* `src/index/metadata-v2.js`
* `src/index/type-inference-crossfile/extract.js`
* `src/lang/javascript/docmeta.js`
* (recommended) `src/lang/javascript/chunks.js` or a new shared helper

**Goals:**
1. `docmeta.params` must be a stable positional contract.
2. return types must never surface as boolean `true/false`.
3. inferred type extraction must never emit `"[object Object]"`.

**Recommended approach (JS):**
* Derive signature params from AST in `buildJsChunks(...)` and attach to chunk meta (e.g., `meta.sigParams`).
* Merge that into `docmeta.params` when doc comments are missing.
* For destructured params: use `arg0`, `arg1`, … and store `bindings` separately.

**Return types:**
* Treat `docmeta.returnType` (string) as canonical.
* Treat `docmeta.returns` boolean as **documentation presence only** and ignore it for type/risk propagation.

### Step 3 — Implement RiskSummary builder
**New file:** `src/index/risk-flows/summaries.js`

**Input:** `chunks` (post file-processing, pre/post cross-file inference is fine)

**Output:**
* Inline: `chunk.docmeta.risk.summary` (compact)
* Full rows: `risk_summaries.jsonl`

**Algorithm (v1):**
* derive `sources[]`, `sinks[]`, `sanitizers[]` from `chunk.docmeta.risk.*`.
* derive `taintedParams[]` heuristically:
  * if `argAware`: treat params as potential taint carriers when they appear in sink evidence excerpts.
  * if `conservative`: do not assert param taint; only propagate from local sources.
* derive `returnsTainted`:
  * `true` if any local flow indicates source reaches a return pattern (if implemented), else `null`.

### Step 4 — Add call-site payload fields (JS + Python)
**Files:**
* `src/lang/javascript/relations.js`
* `src/lang/python/relations.js`

**Add fields to each `callDetails` entry:**
* `file`, `startLine`, `endLine`, `startCol`, `endCol`
* `calleeName`
* `argsSummary` (truncated)
* `snippetHash` (sha1 of normalized snippet)

**Important:** call-site extraction must be stable and deterministic.

### Step 5 — Preserve call-site samples per call edge
**File:** `src/index/type-inference-crossfile/pipeline.js`

**Change:** keep `callLinks` deduped (for graph size), but also build `callSitesByEdge`:

* Key: `callerChunkId + calleeChunkId`
* Value: bounded list of call-site records (dedupe by location)

Expose `callSitesByEdge` on each caller chunk:

```js
chunk.codeRelations.callSiteRefs = {
  "<calleeChunkId>": ["<callSiteId>", ...]
};
```

…and store `call_sites.jsonl` rows globally.

### Step 6 — Implement propagation engine
**New file:** `src/index/risk-flows/propagate.js`

**Inputs:**
* `summariesByChunkId`
* `callGraph` (from `chunk.codeRelations.callLinks` → resolved target chunkId)
* `callSiteRefs` (optional)
* config caps + strictness

**Output:** `risk_flows.jsonl`

**Propagation algorithm:** deterministic bounded BFS that:
1. starts from each source-bearing chunkId
2. traverses call graph up to `maxDepth`
3. stops path if sanitizer encountered (or reduces confidence, per spec)
4. records a flow when reaching a sink-bearing chunk

Store:
* `pathChunkIds[]`
* `edgeCallSiteIdsByStep[]` (optional)
* `confidence` with deterministic decay.

### Step 7 — Integrate into build pipeline
**File:** `src/index/build/indexer/steps/relations.js`

Insert after `applyCrossFileInference(...)` and before final write:

1. `buildRiskSummaries(...)`
2. if `!summaryOnly`: `propagateRiskFlows(...)`
3. rebuild `metaV2` for all chunks (finalization)

### Step 8 — Artifact writing + validation
**Files:**
* `src/index/build/artifacts.js`
* `src/index/build/artifacts/writers/*` (new)
* `src/shared/artifact-io.js`
* `src/index/validate.js`

Add writers:
* `risk-summaries.jsonl`
* `risk-flows.jsonl`
* `call-sites.jsonl`

Add validation:
* schema checks
* referential integrity: every `callSiteId` referenced by `risk_flows` must exist

### Step 9 — Retrieval/UX surfacing
**Files:**
* `src/retrieval/output/format.js`
* (as needed) retrieval index loaders

Add CLI/display options:
* show `risk.summary` at chunk level
* `--explain-risk <chunkId>` prints top N flows ending/starting at chunk

## 6) Acceptance criteria

1. Deterministic: repeated runs produce identical JSONL (byte-for-byte) for same repo/config.
2. Validated: `index validate` passes with new artifacts present.
3. Explainable: at least one fixture demonstrates a multi-hop source→sink path with call-site evidence.
4. Safe: no uncontrolled artifact growth; per-record truncation works.

---

## Phase 11 — Graph-powered product features (context packs, impact, explainability, ranking)

### Objective

Turn graph and identity primitives into **safe, bounded, deterministic** product surfaces: graph context packs, impact analysis, explainable graph-aware ranking (opt-in), and structured outputs suitable for both CLI use and future API/MCP consumers.

- Assumes canonical identities exist (e.g., chunkUid/SymbolId and a canonical reference envelope for unresolved/ambiguous links).
- Any graph expansion MUST be bounded and MUST return truncation metadata when caps trigger (depth/fanout/paths/nodes/edges/time).
- The default search contract must remain stable: graph features can change ordering when enabled, but must not change membership/correctness.

---
# Phase 11 — Graph-Powered Product Features (Context Packs, Impact, Explainability, Ranking)
*Refined implementation plan in “GigaRoadmap / Codex plan-to-disk” format*

**Scope:** Implement Phase 11 product surfaces that consume the SymbolId-keyed graph layer to power deterministic, explainable features:
1) Context Packs (graph-expanded retrieval bundles)  
2) Impact Analysis (blast radius with evidence-rich paths)  
3) Graph-Aware Ranking (bounded additive boosts)  
4) Unified Graph Explainability contract (shared “why” envelopes)

**Inputs (authoritative specs):**
- `spec-context-packs.md`
- `spec-impact-analysis.md`
- `spec-graph-ranking.md`
- `spec-graph-explainability.md`

This plan is written to minimize downstream searching: it enumerates concrete contracts, algorithms, file touchpoints, and required tests.

---

## 11.0 Preconditions / dependency gates (hard requirements)

### 11.0.1 Required upstream milestones (must be true before starting Phase 11)
- **Symbol identity is available** (preferred `symbolId`, fallback `chunkUid`; never `file::name`).
- A **normalized graph layer** exists and is loadable in retrieval runtime:
  - nodes keyed by `symbolId` when present
  - edges typed: `call`, `usage`, `import`, `export`, `dataflow`
  - edges carry `evidenceId?`, `confidence?`, and `resolution` for ambiguous/unresolved cases
- Chunk records can be loaded as canonical “ChunkRecord” with:
  - `chunkUid` (required)
  - `fileRelPath`, ranges/lines, language id, stable excerpt source
- Index root detection and signature are available via current loader patterns (`src/retrieval/cli-index.js`, `src/retrieval/index-cache.js`).

### 11.0.2 Capability gates (must be explicit; no silent fallback)
- If graph artifacts are missing:
  - In **strict** mode: fail closed with `POC_E_NOT_SUPPORTED` + actionable message
  - In **warn** mode: proceed with seeds-only pack and record `graphMissing=true`
- If callsite evidence artifacts are missing:
  - In **strict** mode with `requireEvidence=true`: drop edges without evidence (and record drop reasons)
  - In warn/loose: include edges but mark `evidenceMissing` in explain

### 11.0.3 Hard budgets (enforced regardless of config)
- Context packs:
  - `maxHops <= 4`
  - `maxItems <= 250`
  - `maxItemsPerSection <= 80`
  - `maxBytesPerItem <= 64_000`
  - `maxTotalChars <= 2_000_000`
- Impact reports:
  - `maxDepth <= 8`
  - `maxPaths <= 5000`
  - `maxPathsPerImpacted <= 20`
  - `maxImpacted <= 2000`
  - `snippetMaxBytes <= 16384`
- Graph ranking:
  - graph contribution ≤ **20%** of total score (hard rule)

---

## 11.1 Shared contracts module (Explainability + stable IDs + canonical sorting)

### 11.1.1 Create shared contracts for explainability
**New module:** `src/shared/explain/`
- `src/shared/explain/schema.js`
  - exports JSON schemas (or Zod/Ajv-ready schema objects) for:
    - `ExplainEnvelope`
    - `ExplainRef` (evidence pointers)
    - `ExplainReason` (rule-based inclusion reasons)
- `src/shared/explain/normalize.js`
  - canonicalization helpers:
    - stable key ordering (for snapshot tests)
    - drop undefined fields (consistent)
- `src/shared/explain/errors.js`
  - shared error codes used by Phase 11 surfaces:
    - `POC_E_NOT_SUPPORTED`
    - `POC_E_CONTRACT_VERSION`
    - `POC_E_BUDGET_EXCEEDED`
    - `POC_E_INDEX_MISSING`
    - `POC_E_INVALID_ARGS`

**Determinism requirements**
- Provide `canonicalStringify(obj)` wrapper (reuse existing stable stringify utilities if present; otherwise implement locally and re-export).
- Provide `stableSort(items, keys...)` helper used across context packs and impact.

### 11.1.2 Shared identity helpers
**New module:** `src/shared/identity/`
- `src/shared/identity/ids.js`
  - `getPrimaryId({ symbolId?, chunkUid }) -> string` (symbolId preferred)
  - `requireChunkUid(chunk)` (throws `POC_E_CONTRACT_VERSION` if missing after normalization)
- `src/shared/identity/ranges.js`
  - Offset contract: **UTF-16 code unit offsets**, half-open `[start,end)`
  - Helpers to normalize `{range, lines}` and enforce invariants

### 11.1.3 Shared evidence registry
**New module:** `src/shared/evidence/`
- `src/shared/evidence/load.js`
  - `loadEvidenceById(indexRoot, evidenceIds[]) -> Map`
  - must support at least:
    - callsite evidence (from call_sites artifact, if present)
    - import statement evidence (if graph stores it)
    - identifier usage evidence (if stored)
- `src/shared/evidence/schema.js`
  - defines evidence record shapes and a common `EvidenceRef` shape
- `src/shared/evidence/confidence.js`
  - default confidence fallbacks:
    - resolved edge w/o evidence: 0.55
    - ambiguous edge: 0.30
    - unresolved edge: 0.0 (excluded unless loose)

### 11.1.4 Tests
- `tests/unit/explain/canonical-stringify.unit.js`
  - stable output for object key ordering; identical inputs => identical string
- `tests/unit/identity/range-normalization.unit.js`
  - enforces UTF-16 offsets and half-open ranges
- `tests/unit/evidence/confidence-defaults.unit.js`
  - verifies fallback confidence values and strictness behaviors

---

## 11.2 Graph layer loader + normalization facade (retrieval-side)

### 11.2.1 Implement a single graph facade for Phase 11 consumers
**New module:** `src/retrieval/graph/`
- `src/retrieval/graph/load.js`
  - `loadGraphLayer({ indexRoot, strictness }) -> { nodes, edges, meta }`
  - reads existing graph artifacts through `src/shared/artifact-io.js` (no direct filenames)
  - normalizes into in-memory tables:
    - `adjOut[type][fromId] -> Edge[]`
    - `adjIn[type][toId]  -> Edge[]`
- `src/retrieval/graph/normalize.js`
  - applies:
    - stable sorting of adjacency lists by `(confidence desc, toId asc, evidenceId asc)`
    - drops/marks edges based on strictness + `resolution.status`
- `src/retrieval/graph/schema.js`
  - defines the normalized edge contract used by both context packs and impact analysis:
    - `{ type, fromId, toId, evidenceId?, confidence?, resolution? }`

### 11.2.2 Resolution policy integration (ambiguous/unresolved edges)
- Implement helper `isEdgeTraversable(edge, requestPolicy, strictness)`:
  - if `edge.resolution.status !== 'resolved'` and `allowAmbiguousEdges=false` => do not traverse
  - record dropped-edge stats in caller

### 11.2.3 Tests
- `tests/unit/graph/graph-loader-determinism.unit.js`
  - loads fixture graph twice; adjacency tables must be identical
- `tests/unit/graph/edge-traversal-policy.unit.js`
  - strict/warn/loose + allowAmbiguousEdges matrix

---

## 11.3 Context Packs (artifact-backed, deterministic)

### 11.3.1 Implement core Context Pack builder
**New module:** `src/retrieval/context-packs/`
- `src/retrieval/context-packs/request.js`
  - parse/validate `PackRequest`
  - apply defaults and enforce hard caps
- `src/retrieval/context-packs/build.js`
  - `buildContextPack({ request, seeds, graph, chunkLoader, evidenceLoader }) -> ContextPack`
  - algorithm MUST implement:
    - hop-bounded expansion up to `maxHops`
    - evidence rules (`requireEvidence`, evidenceKinds)
    - scoring:
      - `hybridScore = clamp01(0.70*seedScore + 0.20*distanceScore + 0.10*evidenceScore)`
      - `distanceScore = 1/(1+graphDistance)`
    - stable ordering + tie-breakers:
      1) request.ordering.primary
      2) `hybridScore desc`
      3) `graphDistance asc`
      4) `fileRelPath asc`
      5) `range.start asc`
      6) `chunkUid asc`
      7) `symbolId asc` (if present)
    - section allocation with per-section budgets
- `src/retrieval/context-packs/sections.js`
  - canonical section list:
    - `seeds, callers, callees, imports, exports, usages, dataflow, tests, docs, related`
  - per-section inclusion rules and caps
- `src/retrieval/context-packs/excerpts.js`
  - excerpt extraction must prefer canonical chunk text:
    - from chunk record store (artifact/SQLite/LMDB)
    - avoid re-reading raw file unless chunk text not available
  - apply `maxBytesPerItem` with deterministic truncation and `truncation` metadata
- `src/retrieval/context-packs/cache.js`
  - pack cache key:
    - `sha256(indexSignature + canonical(PackRequest))`
  - storage location (recommended):
    - `<repoCacheRoot>/derived/context_packs/<indexSignature>/`
    - store:
      - `context_packs.jsonl` (or sharded)
      - `context_packs.meta.json`
      - `manifest.json` (derived-store manifest; do NOT mutate build `pieces/manifest.json`)

### 11.3.2 CLI integration
**Modify:**
- `src/retrieval/cli-args.js` (or appropriate CLI arg plumbing) to add:
  - `context-pack` command and flags:
    - `--repo`, `--query`, `--intent`, `--focus`, `--max-hops`, `--edge-types`, `--direction`, budgets, `--strictness`, `--explain`
    - `--write` (persist) / `--read --pack-id` (load)
- `src/retrieval/cli.js` (command routing)
- `src/retrieval/output/*`:
  - renderers for human output and JSON output
  - JSON output must embed `formatVersion`, `schema`, `schemaVersion`

### 11.3.3 MCP integration
**Modify:**
- `src/integrations/mcp/defs.js`
  - add tools:
    - `context_pack.create`
    - `context_pack.get`
  - define input schema matching `PackRequest` and output schema `ContextPack`
- `tools/mcp/tools.js`
  - implement handlers that call the same internal builder as CLI

### 11.3.4 Tests (mandatory)
**Fixtures**
- Add fixture repo: `tests/fixtures/phase11/graph-small/`
  - files:
    - `a.ts` exports `foo()`
    - `b.ts` imports and calls `foo()`
    - `c.ts` calls `b()`
    - `a.test.ts` calls `foo()` (test relation)
    - `README.md` mentions `foo` (docs section coverage)

**Unit tests**
- `tests/unit/context-packs/budget-enforcement.unit.js`
- `tests/unit/context-packs/ordering-determinism.unit.js`
- `tests/unit/context-packs/evidence-gap-policy.unit.js`

**Integration tests**
- `tests/services/context-pack-deterministic.services.js`
  - build index for fixture
  - produce pack twice (same request) and assert canonical JSON equality
- `tests/services/context-pack-cache-invalidation.services.js`
  - rebuild index after modifying fixture; assert indexSignature differs; cache miss; new pack differs

**Golden tests**
- `tests/golden/context_pack_v1.json`
- `tests/services/context-pack-golden.services.js`
  - canonicalize and compare; require explicit update to change

---

## 11.4 Impact Analysis (path-first blast radius)

### 11.4.1 Implement core impact analyzer
**New module:** `src/retrieval/impact/`
- `src/retrieval/impact/request.js`
  - validate/apply defaults for `ImpactRequest`, enforce hard caps
  - resolve `ChangeSeed` to `{ primaryId, symbolId?, chunkUid?, fileRelPath? }`
- `src/retrieval/impact/analyze.js`
  - `analyzeImpact({ request, graph, chunkLoader, evidenceLoader }) -> ImpactReport`
  - traversal:
    - bounded BFS with priority queue:
      1) higher evidence confidence
      2) shorter distance
      3) stable tie-break
  - direction semantics (lock explicitly):
    - downstream for call edges means **reverse traversal** (callers of seed)
  - scoring:
    - `distanceScore = 1/(1+hops)`
    - `evidenceScore = geometricMean(confidence per hop)`
      - fallbacks as defined in `src/shared/evidence/confidence.js`
    - `edgeWeightScore` weights:
      - call 1.0, usage 0.8, import 0.6, export 0.6, dataflow 1.0
    - `score = clamp01(0.45*evidenceScore + 0.35*distanceScore + 0.20*edgeWeightScore)`
  - selection:
    - keep top `maxPathsPerImpacted` paths per impacted target
    - stable ordering:
      - bestPath.score desc
      - bestPath.hops asc
      - impacted.fileRelPath asc
      - impacted.symbolId/chunkUid asc

### 11.4.2 CLI + MCP
**Modify:**
- `src/retrieval/cli.js` + args to add:
  - `pairofcleats impact --seed <...> --direction downstream --edge-types call,usage --json --explain`
- `src/integrations/mcp/defs.js`:
  - add tool `impact.analyze`
- `tools/mcp/tools.js`:
  - handler calls shared analyzer

### 11.4.3 Optional artifact caching (recommended)
- Store reports under derived store:
  - `<repoCacheRoot>/derived/impact/<indexSignature>/impact_reports.jsonl`
- Cache key:
  - `sha256(indexSignature + canonical(ImpactRequest))`

### 11.4.4 Tests
- Unit:
  - `tests/unit/impact/direction-semantics.unit.js` (call edge downstream == callers)
  - `tests/unit/impact/scoring.unit.js`
- Integration:
  - `tests/services/impact-analysis.services.js`
    - build fixture index; run impact from `foo`; assert impacted includes `b.ts`, `c.ts`, test file
- Golden:
  - `tests/golden/impact_report_v1.json`

---

## 11.5 Graph-Aware Ranking (bounded additive boost + explain)

### 11.5.1 Implement ranking augmentation
**Modify:**
- `src/retrieval/rankers.js` (or the central ranking module used by pipeline)
- `src/retrieval/pipeline.js` (plumb graph ranking options)
- `src/retrieval/query-intent.js` (optional: intent->ranking preset mapping)

**New module:** `src/retrieval/graph-ranking/`
- `src/retrieval/graph-ranking/compute.js`
  - `computeGraphBoost({ hit, graph, stats, policy }) -> { boost, breakdown }`
  - supported signals (v1):
    - exportedness boost (if export edges exist)
    - local fan-in/out (bounded)
    - “path-to-seed” proximity (when seed set available)
  - hard clamp:
    - `boost <= 0.20 * baseScore` (or equivalent normalization)
- `src/retrieval/graph-ranking/policy.js`
  - defaults:
    - disabled unless explicitly enabled OR query intent indicates graph-heavy (impact/contract)
  - capability gating:
    - if graph missing and graphRanking requested => fail closed or warn based on strictness
- `src/retrieval/graph-ranking/explain.js`
  - embed into existing explain output:
    - `scoreBreakdown.graph = { boost, signals: {...} }`

### 11.5.2 Explain output requirements
- When `--explain` is enabled, each hit must include:
  - base score components (existing)
  - graph boost components:
    - which signals were applied
    - clamping applied
    - evidence refs if signal derived from graph paths

### 11.5.3 Tests
- `tests/unit/graph-ranking/boost-clamp.unit.js`
- `tests/unit/graph-ranking/exportedness-signal.unit.js`
- `tests/services/graph-ranking-explain.services.js`
  - confirm explain includes graph breakdown only when enabled

---

## 11.6 Unified output shaping and “explain” plumbing

### 11.6.1 Standardize explain envelopes across CLI + MCP
**Modify:**
- `src/retrieval/output/format.js`
- `src/retrieval/output/format-json.js` (or equivalent JSON renderer)
- `src/integrations/mcp/protocol.js` (error mapping, if needed)

**Rules**
- All Phase 11 JSON outputs include:
  - `formatVersion`, `schema`, `schemaVersion`, `indexSignature`, `createdAt`
- Explain is:
  - included when requested (`--explain` / MCP flag)
  - stable key order (canonical stringify)
  - bounded (cap explain refs per item)

### 11.6.2 Tests
- `tests/services/phase11-json-contracts.services.js`
  - validate presence of required top-level fields for ContextPack and ImpactReport
- `tests/services/phase11-explain-bounds.services.js`
  - ensures explain does not exceed configured bounds

---

## 11.7 Documentation (operator-facing + developer contracts)

### 11.7.1 Add docs
**New docs:**
- These docs have been thrown into the docs folder, move them to their correct locations
- `docs/graph/context-packs.md`
- `docs/graph/impact-analysis.md`
- `docs/graph/graph-ranking.md`
- `docs/contracts/explainability.md`

**Update docs:**
- `docs/search.md` (or equivalent) to mention:
  - `pairofcleats context-pack`
  - `pairofcleats impact`
  - graph ranking flag(s) and `--explain` output

**Docs must include**
- deterministic ordering rules
- budget defaults + hard caps
- strict/warn/loose semantics
- example CLI invocations and example JSON snippets

---

## 11.8 Acceptance criteria (phase exit gate)

Phase 11 is “done” only when all below are true:

### 11.8.1 Determinism
- Context pack generation is bit-for-bit stable (canonicalized) on repeated runs against same index.
- Impact analysis output is stable and deterministic for same request.

### 11.8.2 Correctness
- No joins rely on `file::name`.
- Downstream call semantics are correct (reverse call traversal).
- Strictness behavior is correct and test-covered.

### 11.8.3 Budget enforcement
- Every budget hard cap is enforced, with explicit truncation metadata where applicable.

### 11.8.4 Explainability
- Every included context item has a `why` path and evidence refs (or explicit evidence-missing markers).
- Graph ranking explain shows applied signals and clamps.

### 11.8.5 Tests
- All Phase 11 unit, integration, and golden snapshot tests pass in CI lanes.
- Golden updates require explicit developer action (no silent snapshot regeneration).

---

## 11.9 File touchpoint inventory (explicit list)

### New files (to be created)
- `src/shared/explain/schema.js`
- `src/shared/explain/normalize.js`
- `src/shared/explain/errors.js`
- `src/shared/identity/ids.js`
- `src/shared/identity/ranges.js`
- `src/shared/evidence/load.js`
- `src/shared/evidence/schema.js`
- `src/shared/evidence/confidence.js`
- `src/retrieval/graph/load.js`
- `src/retrieval/graph/normalize.js`
- `src/retrieval/graph/schema.js`
- `src/retrieval/context-packs/request.js`
- `src/retrieval/context-packs/build.js`
- `src/retrieval/context-packs/sections.js`
- `src/retrieval/context-packs/excerpts.js`
- `src/retrieval/context-packs/cache.js`
- `src/retrieval/impact/request.js`
- `src/retrieval/impact/analyze.js`
- `src/retrieval/graph-ranking/compute.js`
- `src/retrieval/graph-ranking/policy.js`
- `src/retrieval/graph-ranking/explain.js`
- Docs:
  - `docs/graph/context-packs.md`
  - `docs/graph/impact-analysis.md`
  - `docs/graph/graph-ranking.md`
  - `docs/contracts/explainability.md`

### Existing files to modify (expected)
- Retrieval core:
  - `src/retrieval/pipeline.js`
  - `src/retrieval/rankers.js`
  - `src/retrieval/context-expansion.js` (optional: integrate/replace for pack building)
  - `src/retrieval/cli.js`
  - `src/retrieval/cli-args.js`
  - `src/retrieval/output/format.js`
  - `src/retrieval/output/*` (JSON renderers and/or explain renderers)
- MCP:
  - `src/integrations/mcp/defs.js`
  - `tools/mcp/tools.js`
  - `src/integrations/mcp/protocol.js` (if error mapping updates needed)
- Shared I/O:
  - `src/shared/artifact-io.js` (only if evidence artifacts require new loaders)

### Tests (new)
- `tests/unit/explain/*`
- `tests/unit/identity/*`
- `tests/unit/evidence/*`
- `tests/unit/graph/*`
- `tests/unit/context-packs/*`
- `tests/unit/impact/*`
- `tests/unit/graph-ranking/*`
- `tests/services/context-pack-*.services.js`
- `tests/services/impact-analysis.services.js`
- `tests/services/graph-ranking-explain.services.js`
- `tests/services/phase11-json-contracts.services.js`
- `tests/fixtures/phase11/graph-small/**`
- `tests/golden/context_pack_v1.json`
- `tests/golden/impact_report_v1.json`

---

## Appendix A — Implementation notes to prevent common failures

1. **Never re-read repo files to build excerpts** unless chunk text is missing; use canonical stored chunk text to keep determinism and avoid path issues.
2. **Always stable-sort adjacency lists**; do not rely on Map iteration order.
3. **Cache keys must include indexSignature**; never allow cross-index reuse.
4. **Do not introduce silent fallbacks**; warn/strict behavior must be explicit and test-covered.
5. **Respect UTF-16 offsets** for ranges; treat line fields as convenience only.

---

# Phase 12 — MCP SDK Migration + API/Tooling Contract Formalization 

**Normative references (inputs):**
- `PHASE12_TOOLING_AND_API_CONTRACT_SPEC_REFINED.md`
- `PHASE12_TEST_STRATEGY_AND_CONFORMANCE_MATRIX_REFINED_DETERMINISTIC_FIXTURES.md` (this phase’s normative test plan)

### Objective

Modernize PairOfCleats’ integration surface by:
1. Migrating MCP serving to the official MCP SDK using stdio transport (newline-delimited JSON-RPC frames).
2. Formalizing and enforcing **one** contract across MCP and HTTP API via the PocEnvelope.
3. Hardening schema validation, cancellation, timeouts, and overload backpressure.
4. Adding deterministic, hermetic conformance + parity tests (no dependence on developer filesystem layout).

### Non-negotiables

- MCP SDK mode is the default path for Phase 12 conformance tests.
- Tool schemas are a single source of truth and are snapshotted.
- No “accept and ignore” schema fields.
- Parity tests MUST use the deterministic repo + normalization strategy.

---

### 12.0 Preflight: Confirm baseline + pick explicit options

**Files to inspect (no edits yet)**
- `tools/mcp-server.js`
- `tools/mcp/transport.js` (legacy transport)
- `tools/mcp/tools.js` (tool implementations)
- `src/integrations/mcp/defs.js` (tool schemas)
- `tools/api-server.js`
- `tools/api/router.js`
- `tools/api/response.js`
- `tools/api/sse.js`
- `tools/api/validation.js`

**Tasks**
- [ ] Confirm current MCP legacy transport framing is Content-Length based and does not match MCP stdio newline framing.
- [ ] Confirm current API responses are not envelope-consistent across endpoints.
- [ ] Confirm `tools/mcp/tools.js` has a syntax error due to parameter shadowing in `runSearch`:
  - `export async function runSearch(args = {}, context = {}) { ... const context = Number.isFinite(...) ... }`
  - This MUST be fixed early to unblock any MCP server work.

**Choice made (explicit)**
- [ ] Dependency strategy: **install MCP SDK as a normal dependency** (not optional).
  - Rationale: Phase 12 conformance requires SDK mode; making it optional increases ambiguity and test flakiness.

**Tests**
- [ ] `tests/unit/smoke-imports.phase12.unit.js` (new)
  - Imports the modules touched by Phase 12 to catch syntax errors immediately (including `tools/mcp/tools.js`).

---

### 12.1 Fix blockers + establish shared contract primitives

**Files to modify / add**
- Modify: `tools/mcp/tools.js`
- Add: `src/shared/poc-envelope.js` (new shared helper)
- Add: `src/shared/tooling-schema-version.js` (new; avoid name collision with SQLite’s SCHEMA_VERSION)
- (Optional) Modify: `src/shared/error-codes.js` (only if missing a required code; verify first)

**Tasks**
- [ ] Fix `runSearch` shadowing bug:
  - Rename numeric `context` to `contextLines`.
  - Ensure the **context object** remains accessible as `context.signal`, `context.progress`.
- [ ] Add shared PocEnvelope builder utilities:
  - `okEnvelope(result, meta)`
  - `errorEnvelope(code, message, details, meta)`
  - `withMeta(envelope, metaPatch)` (non-destructive)
  - A strict guard that prevents top-level reserved keys in `result`.
- [ ] Add tooling schema version constant:
  - `export const TOOLING_SCHEMA_VERSION = "1.0.0";` (or monotonic integer, but string is recommended)
  - Ensure this value is surfaced in:
    - MCP tools/list `_meta.schemaVersion`
    - MCP tool results `_meta.schemaVersion`
    - API responses `_meta.schemaVersion`

**Tests**
- [ ] `tests/unit/poc-envelope.unit.js` (new)
  - Asserts envelope shape and reserved-key guard.
- [ ] `tests/unit/search-shadowing-regression.unit.js` (new)
  - Imports `runSearch` and ensures it runs to argument mapping stage without throwing syntax errors.

---

### 12.2 Tool registry: schema correctness + drift guards

**Files to modify / add**
- Modify: `src/integrations/mcp/defs.js`
- Add: `tools/generate-mcp-tools-schema.js` (new)
- Add/update: `docs/contracts/mcp-tools.schema.json` (generated snapshot)

**Tasks**
- [ ] Make tool schemas strict:
  - Ensure each tool’s `inputSchema` uses:
    - `type: "object"`
    - `additionalProperties: false`
  - For nested objects (e.g., `meta`), explicitly define allowance or rejection.
- [ ] Align MCP `search` schema with API search request schema:
  - Ensure `path`, `file`, `ext` accept string OR array-of-string (match API).
  - Ensure `output` enum supports `json` in addition to `compact` and `full` (match API behavior).
- [ ] Introduce a drift-guard snapshot:
  - Implement `tools/generate-mcp-tools-schema.js` that:
    - imports tool defs from `src/integrations/mcp/defs.js`
    - writes stable JSON ordering (use `src/shared/stable-json.js`)
    - outputs:
      ```json
      { "schemaVersion": "<TOOLING_SCHEMA_VERSION>", "toolingVersion": "<getToolVersion()>", "tools": [...] }
      ```
  - Commit `docs/contracts/mcp-tools.schema.json`.

**Tests**
- [ ] `tests/contracts/mcp-tools-schema.snapshot.js` (new)
  - Regenerates schema snapshot in-memory and compares to committed file.
- [ ] `tests/unit/mcp-search-schema-alignment.unit.js` (new)
  - Asserts the MCP search schema allows the same set of fields and types as API.

---

### 12.3 Implement MCP SDK server (stdio, newline framing) with strict validation + envelope results

**Files to modify / add**
- Add: `tools/mcp/sdk-server.js` (new)
- Modify: `tools/mcp-server.js` (dispatch)
- (Optional) Modify: `src/shared/capabilities.js` (only if we still probe for SDK presence)
- Modify: `tools/mcp/tools.js` (tool execution remains here; no behavior fork)
- Add: `tools/mcp/validate.js` (new; Ajv validators compiled from defs)

**Core implementation decision (explicit)**
- [ ] Use the MCP SDK’s **low-level `Server`** and register handlers for `tools/list` and `tools/call`.
  - Rationale:
    - avoids duplicating schemas in Zod
    - allows us to reuse the project’s canonical JSON schemas in `src/integrations/mcp/defs.js`
    - enables strict `additionalProperties: false` validation via Ajv before executing tools

**Tasks**
- [ ] Add MCP SDK dependency in `package.json`:
  - Pin to a version that supports protocol 2025-11-25 (see contract spec).
- [ ] Implement stdio server:
  - Create `tools/mcp/sdk-server.js`:
    - constructs SDK `Server` with `{ name: "pairofcleats", version: getToolVersion() }` and `{ capabilities: { tools: {} } }`
    - connects to `StdioServerTransport()`
  - Ensure logs go to **stderr**, not stdout.
- [ ] Implement `tools/list` handler:
  - Return exact tool definitions from `src/integrations/mcp/defs.js`.
  - Attach `_meta.schemaVersion` + `_meta.toolingVersion` to the result (or a follow-up surface if SDK initialize result is not customizable).
- [ ] Implement `tools/call` handler:
  - Validate tool name exists.
  - Validate arguments with Ajv compiled from each tool’s `inputSchema`.
  - Execute tool via existing `handleToolCall(name, args, context)`:
    - context includes `signal` (AbortSignal)
    - context includes `progress` callback that emits `notifications/progress` iff `_meta.progressToken` exists
  - Wrap tool output into PocEnvelope:
    - success: `{ ok: true, result: <tool-result>, _meta: ... }`
    - failure: `{ ok: false, error: {...}, _meta: ... }`
  - Return as MCP CallToolResult:
    - `content: [{ type: "text", text: JSON.stringify(envelope) }]`
    - `structuredContent: envelope`
- [ ] Implement backpressure:
  - Enforce max concurrent tool calls (configurable constant; default 4 or 8)
  - If overloaded, reject with stable overload error (JSON-RPC error response or error envelope per spec; follow contract spec)
- [ ] Implement timeout and cancellation:
  - Use AbortController:
    - merges SDK-provided signal + timeout
  - Ensure tool execution respects abort:
    - pass `signal` into `coreSearch` and any spawned subprocess calls used by other tools

**Tests**
- [ ] `tests/mcp/sdk-initialize.contract.js`
- [ ] `tests/mcp/sdk-tools-list.contract.js`
- [ ] `tests/mcp/sdk-tool-envelope.contract.js`
- [ ] `tests/mcp/sdk-arg-validation.contract.js`
- [ ] `tests/mcp/sdk-cancellation.contract.js`
- [ ] `tests/mcp/sdk-timeout.contract.js`
- [ ] `tests/mcp/sdk-overload.contract.js`

---

### 12.4 Migrate HTTP API to PocEnvelope (JSON endpoints + SSE)

**Files to modify**
- Modify: `tools/api/response.js`
- Modify: `tools/api/router.js`
- Modify: `tools/api/sse.js`
- (Maybe) Modify: `tools/api/validation.js` (only to align search schema semantics if needed)

**Tasks**
- [ ] Replace ad-hoc API response shapes with PocEnvelope:
  - Add `sendOk(res, result, meta?)`
  - Update `sendError(res, httpStatus, code, message, details?, meta?)` to emit:
    ```json
    { "ok": false, "error": { "code": "...", "message": "...", "details": {...} }, "_meta": {...} }
    ```
- [ ] Update endpoints to use envelope:
  - `/health` → `result: { uptimeMs }`
  - `/status` → `result: <existing status payload>`
  - `/search` → `result: { repo: <repoPath>, search: <existing search payload> }`
- [ ] Update SSE endpoints:
  - Ensure every SSE `data:` payload is a PocEnvelope.
  - Ensure event ordering and completion (`done`) is deterministic.

**Tests**
- [ ] `tests/api/envelope.contract.js`
- [ ] `tests/api/errors.contract.js`
- [ ] `tests/api/sse.contract.js`

---

### 12.5 Deterministic fixtures + API ↔ MCP parity test suite

**Files to add / modify**
- Add: `tests/fixtures/phase12-min-repo/**` (new fixture)
- Add: `tests/helpers/deterministic-repo.js`
- Add: `tests/helpers/envelope-normalize.js`
- Add: `tests/helpers/mcp-sdk-client.js` (or reuse existing client pattern, but newline framing)
- Add: `tests/parity/search.parity.js`
- Add: `tests/parity/status.parity.js`
- Add: `tests/parity/errors.parity.js`
- Add: `tests/parity/_harness.contract.js` (enforces deterministic strategy)

**Tasks**
- [ ] Implement minimal fixture repo exactly as specified in the test strategy doc.
- [ ] Implement deterministic repo helper:
  - copies fixture → `<ROOT>/tests/.cache/phase12/.../repo`
  - provides isolated cacheRoot
  - exports cleanup function
- [ ] Implement normalization helper:
  - strips timestamp/duration meta
  - normalizes repo path to `<REPO>`
  - ensures ordering stable where needed
- [ ] Implement parity tests:
  - start API server + MCP SDK server pointing at same deterministic repo
  - run equivalent operations
  - compare normalized envelopes

**Tests**
- [ ] `tests/parity/search.parity.js` (must build index once, then compare)
- [ ] `tests/parity/status.parity.js`
- [ ] `tests/parity/errors.parity.js`
- [ ] `tests/parity/_harness.contract.js`

---

### 12.6 Documentation, migration notes, and legacy deprecation window

**Files to modify / add**
- Modify: `docs/mcp-server.md` (or add `docs/mcp.md` if preferred)
- Modify: `docs/api-server.md`
- Modify: `docs/contracts/api-mcp.md` (if present; update parity story)

**Tasks**
- [ ] Document:
  - how to run MCP SDK server
  - how to select legacy vs SDK mode (explicit flag/env)
  - what the envelope is
  - schemaVersion/toolingVersion policy
  - cancellation/timeout semantics
- [ ] Explicitly define legacy transport deprecation:
  - keep behind `PAIROFCLEATS_MCP_TRANSPORT=legacy`
  - Phase 12 tests run only on SDK mode

**Tests**
- [ ] Documentation sanity is not unit-tested, but must be reviewed for correctness and examples must be runnable.

---

## Acceptance criteria (Phase 12 complete when…)

- [ ] All conformance requirements in the Phase 12 matrix pass on CI.
- [ ] `docs/contracts/mcp-tools.schema.json` matches generated tool schema snapshot.
- [ ] API and MCP return PocEnvelope consistently.
- [ ] Parity tests pass using deterministic fixture repo strategy on clean machines.
- [ ] MCP SDK server supports cancellation, timeouts, and overload behavior deterministically.
- [ ] Legacy transport remains available behind explicit flag (until removed in a later phase).

---
# Phase 13 Work Breakdown — SCM Provider Abstraction + JJ Support (PairOfCleats)

Scope includes:
- A generic **SCM provider interface** (Git + JJ + None), selected deterministically at runtime.
- JJ-backed repo provenance and per-file metadata (last modified, author, churn), with safe defaults.
- Optional line-annotation support (blame/annotate) behind explicit enablement.
- Artifact schema updates to record provider identity and provenance.
- Repo-root detection improvements for JJ workspaces.
- Comprehensive unit tests (with runner stubs) to avoid requiring `jj` in CI.

Non-goals (explicitly out of scope for Phase 13):
- Changing the public CLI surface (new flags) or expanding `.pairofcleats.json` public schema beyond existing contract.
- Implementing a full incremental re-index using SCM diffs (we provide hooks/capabilities but do not wire them into watch mode).
- Replacing the existing Git implementation (we wrap/reuse it).

---

## Key decisions 

### Decision A — Provider selection & override surface
**Pick:** deterministic auto-selection with safe fallbacks, no new public config/flags.

Provider selection rules:
1. If a `.jj/` directory is present **and** the `jj` executable is available, select provider = `jj`.
2. Else if a `.git/` directory is present **and** the `git` executable is available, select provider = `git`.
3. Else provider = `none`.

Rationale:
- Avoids expanding public configuration surface (aligned with the project’s “tight config” directives).
- Avoids ambiguous precedence when both `.jj` and `.git` exist (JJ wins if supported; otherwise Git).
- Ensures reliability on hosts where `.jj` is present but `jj` is not installed (falls back to Git or None).
- Still supports test-time forcing via `PAIROFCLEATS_TEST_CONFIG` (already-supported test override mechanism), without making it public API.

### Decision B — JJ commands must be read-only by default (no snapshot)
**Pick:** run JJ commands with `--ignore-working-copy` and `--at-op=@` by default.  
`--ignore-working-copy` avoids snapshotting/updating the working copy. `--at-operation/--at-op` pins evaluation to a specific operation and implies `--ignore-working-copy`. citeturn2view0

Rationale:
- Prevents *any* automatic working-copy snapshot or repo mutation during indexing.
- Avoids unexpectedly auto-tracking new files (JJ can auto-track new files during snapshot by default). citeturn14view1
- Makes indexing reproducible within a run (stable view of the repo operation).

### Decision C — JJ JSON output format
**Pick:** build JSON/JSONL output using template string concatenation + `.escape_json()` (not object literals).

Rationale:
- `.escape_json()` is explicitly documented for safely building JSON output from template values. citeturn9view0
- Avoids relying on undocumented object-literal support (e.g., `json({...})`) which may vary across JJ versions.

### Decision D — Churn computation for JJ
**Pick:** use JJ’s templated diff stats, not parsing raw diffs.

Approach:
- Use `commit.diff("<fileset>").stat()` and `DiffStats` methods (e.g., `total_added()`, `total_removed()`) to compute churn. citeturn18view0

Rationale:
- Faster and more robust than parsing patch output.
- Eliminates ambiguity around binary diffs/renames.
- Works across platforms without depending on output formatting quirks.

### Decision E — Default annotation (blame/annotate) behavior
**Pick:** default `annotate` **OFF** for all providers; enable explicitly via internal config (test override first), with clear performance docs.

Rationale:
- Annotation is inherently expensive; default-on harms throughput.
- JJ annotation without snapshot is not guaranteed to match un-snapshotted filesystem edits; better to be explicit.

---

## Phase 13.0 — Introduce SCM Provider Interface (foundation)

**Objective:** Add a provider abstraction layer without changing external behavior beyond *logging* and *better no-repo handling*.

**Exit criteria:**
- [ ] A `ScmProvider` interface exists with Git + None implementations.
- [ ] Existing Git metadata flows through the new provider (no direct `getGitMetaForFile` usage from indexer code paths).
- [ ] All existing tests pass.

### 13.0.1 — Add provider types + shared utilities

**New files:**
- `src/index/scm/types.js`
- `src/index/scm/utils.js`

**Tasks:**
- [ ] Define **JSDoc types** (no TypeScript required):
  - `ScmProviderId = 'git' | 'jj' | 'none'`
  - `ScmRepoProvenance`
  - `ScmFileMeta`
  - `ScmAnnotateResult`
  - `ScmProviderCapabilities`
- [ ] Implement `src/index/scm/utils.js`:
  - [ ] `getChunkAuthorsFromLines(lineAuthors: (string|null)[], startLine: number, endLine: number): string[]`
    - Move the logic currently in `src/index/git.js:getChunkAuthorsFromLines` into this shared module.
    - Keep `src/index/git.js` exporting `getChunkAuthorsFromLines` as a re-export to avoid breaking any external imports (even though current call sites are internal).
  - [ ] `toRepoRelPosix(rootAbs: string, fileAbsOrRel: string): string`
    - Produces repo-relative, forward-slash paths used for JJ filesets/templates.
  - [ ] `escapeFilesetRootFile(pathPosix: string): string`
    - Emits `root-file:"..."` with correct escaping per JJ fileset rules (double quotes, backslash escaping). citeturn6view1

**Tests:**
- [ ] `tests/scm-utils.unit.js`
  - [ ] Verify `getChunkAuthorsFromLines`:
    - Dedupes authors
    - Preserves stable order of first occurrence
    - Handles null/undefined authors
    - Correct line-indexing behavior (1-based vs 0-based defined explicitly below)
  - [ ] Verify `toRepoRelPosix` normalizes Windows separators (`\` → `/`) and rejects path traversal.
  - [ ] Verify `escapeFilesetRootFile` correctly escapes quotes and backslashes.

**Line indexing definition (must be enforced in code + tests):**
- `lineAuthors` is a 1:1 array with file lines, **0-based index**.
- Chunk line numbers in PairOfCleats are **1-based** (existing behavior in chunk metadata).
- Therefore, mapping uses `lineAuthors[startLine-1 ... endLine-1]`.

### 13.0.2 — Add provider selection + registry

**New files:**
- `src/index/scm/index.js`
- `src/index/scm/providers/none.js`
- `src/index/scm/providers/git.js`

**Modified files:**
- `src/index/git.js` (minimal: expose a `createGitProvider` wrapper or export low-level helpers)

**Tasks:**
- [ ] Implement `createNoneProvider({ root })`:
  - Capabilities: `{ repoProvenance: false, fileMeta: false, annotate: false, trackedFiles: false }`
  - `getRepoProvenance()` returns `{ provider:'none', isRepo:false, root:null, commit:null, dirty:null, branch:null }`
  - `getFileMetaForFile()` returns `{}` quickly and never throws.
- [ ] Implement `createGitProvider({ root, logger, cacheConfig, concurrency })`:
  - Wrap existing functions in `src/index/git.js`:
    - `getRepoProvenance(root)` → `provider.getRepoProvenance()`
    - `getGitMetaForFile(baseDir, filePath, opts)` → `provider.getFileMetaForFile(filePath, opts)`
  - Capabilities: `{ repoProvenance:true, fileMeta:true, annotate:true }`
  - Ensure internal caches are configured via existing `configureGitMetaCache`.
- [ ] Implement `selectScmProvider({ root, envConfig, testOverrides })`:
  - Uses Decision A precedence rules.
  - Implements **executable availability checks**:
    - `git`: attempt `git --version` (fast)
    - `jj`: attempt `jj --version` (fast)
  - Provide optional internal override:
    - `envConfig?.indexing?.scm?.provider` (only reachable in tests via `PAIROFCLEATS_TEST_CONFIG`)
    - If override is invalid, log warning and fall back to auto.

**Tests:**
- [ ] `tests/scm-provider-selection.unit.js`
  - Use dependency injection: implement `selectScmProvider({ root, probe })` where `probe(cmd)` is injectable.
  - Validate precedence:
    - `.jj` present + jj available ⇒ `jj`
    - `.jj` present + jj missing + `.git` present + git available ⇒ `git`
    - `.git` only ⇒ `git`
    - neither ⇒ `none`
  - Validate override behavior for test config.

---

## Phase 13.1 — Wire SCM Provider into build runtime + artifacts

**Objective:** runtime owns the selected provider and emits a unified provenance object.

**Exit criteria:**
- [ ] `createBuildRuntime()` selects an SCM provider and stores it on `runtime`.
- [ ] `build_state.json` and `current.json` include provider-tagged repo provenance (backward compatible).
- [ ] Build IDs remain stable and meaningful in Git and JJ repos.

### 13.1.1 — Runtime selection + buildId changes

**Modified files:**
- `src/index/build/runtime/runtime.js`

**Tasks:**
- [ ] Add `runtime.scm` fields:
  - `runtime.scmProvider` (instance)
  - `runtime.scmProviderId` (`'git'|'jj'|'none'`)
  - `runtime.scmAnnotateEnabled` (boolean)
- [ ] Implement annotate enablement:
  - Default `false`.
  - Enable only if `policyConfig?.indexing?.scm?.annotate?.enabled === true` (test override path).
  - Add log line: `SCM provider: <id> (annotate: on/off)`.
- [ ] Replace `getRepoProvenance(root)` call with `runtime.scmProvider.getRepoProvenance()`.
- [ ] Build ID:
  - Current format: `poc-${yyyymmdd}-${gitShortSha}-${configHash8}` (with fallbacks).
  - Update to:
    - `poc-${yyyymmdd}-${scmShortId}-${configHash8}`
    - Where `scmShortId`:
      - If provenance.commit exists: `commit.slice(0, 7)`
      - Else: `noscm`
  - Keep the same string shape and length constraints.

**Tests:**
- [ ] `tests/build-runtime/scm-provenance.test.js`
  - Stub provider selection to return a fake provider:
    - Verify runtime records provider ID and repo provenance.
    - Verify buildId uses `noscm` when commit missing.
    - Verify buildId uses commit prefix when present.

### 13.1.2 — Persist provenance to build artifacts

**Modified files:**
- `src/index/build/build-state.js`
- `src/index/build/promotion.js`

**Tasks:**
- [ ] Ensure `build_state.json` contains `repo` provenance from runtime:
  - Keep existing keys: `isRepo`, `root`, `branch`, `commit`, `dirty`
  - Add:
    - `provider` (string: `'git'|'jj'|'none'`)
    - `changeId` (JJ only; null otherwise)
    - `operation` (JJ optional; null otherwise; reserved)
    - `tool` object:
      - `{ name: 'jj', version: 'x.y.z' }` for JJ
      - `{ name: 'git', version: '...' }` for Git (optional; can be omitted for now)
  - Backward compatibility: adding keys is safe.
- [ ] Ensure `current.json` uses the same `repo` object shape.

**Tests:**
- [ ] `tests/artifacts/current-repo-provenance.test.js`
  - Use a fake runtime object to call promotion/build-state logic.
  - Assert `repo.provider` exists and equals expected provider ID.

---

## Phase 13.2 — Replace Git metadata plumbing with SCM metadata plumbing

**Objective:** Remove Git-specific assumptions from the file processor and replace with provider calls; preserve output schema as much as practical.

**Exit criteria:**
- [ ] File processing uses `runtime.scmProvider` for file metadata and annotate (if enabled).
- [ ] The chunk payload contains SCM metadata under a stable key (`scm`), while preserving `git` for backward compatibility in Git provider mode.
- [ ] Performance logging shows SCM timings (not hard-coded “git”).

### 13.2.1 — File processor: provider meta + annotate

**Modified files:**
- `src/index/build/file-processor.js`
- `src/index/build/file-processor/timings.js`
- `src/index/build/file-processor/assemble.js`

**Tasks:**
- [ ] Update `createFileProcessor()` signature:
  - Replace `gitBlameEnabled` with `scmAnnotateEnabled`.
  - Add `scmProvider` parameter (instance).
- [ ] Replace `getGitMetaForFile(...)` usage:
  - Old: `getGitMetaForFile(runtime.root, filePath, { blame })`
  - New: `scmProvider.getFileMetaForFile(filePath, { annotate: scmAnnotateEnabled })`
- [ ] Replace `getChunkAuthorsFromLines` import:
  - Import from `src/index/scm/utils.js`.
- [ ] Define normalized per-file SCM metadata structure in processor:
  - `fileScmMeta = { lastModified, lastModifiedBy, churnAdded, churnDeleted, churnCommits, churn, lineAuthors }`
- [ ] Chunk-level metadata:
  - If annotate enabled and `lineAuthors` present:
    - Compute `chunkAuthors` via shared util.
  - Else omit `chunkAuthors`.
- [ ] Assemble chunk payload:
  - Add new top-level key: `scm: { provider, ...fileScmMetaWithoutLineAuthors, chunkAuthors }`
  - Maintain existing `git` key for backward compatibility **when provider === 'git'**:
    - `git: { ...same fields }`
  - For provider `jj` and `none`, omit `git` to avoid semantic confusion.
- [ ] Update timings:
  - Rename `gitDurationMs` → `scmDurationMs`
  - In `timings.js`, rename totals.git → totals.scm; keep emitting totals.git when provider==git? (optional).
  - Ensure logs remain stable and not overly verbose.

**Tests:**
- [ ] `tests/file-processor/scm-meta-payload.test.js`
  - Create a fake provider that returns fixed meta and lineAuthors.
  - Run the relevant portion of file processing and assert:
    - chunk payload includes `scm.provider`
    - chunk payload includes `scm.lastModified`
    - `chunkAuthors` computed correctly
  - Verify `git` key is only present when provider is `git`.

### 13.2.2 — Feature settings + index_state

**Modified files:**
- `src/index/build/indexer/pipeline.js`
- `src/index/build/indexer/steps/process-files.js`
- `src/index/build/indexer/steps/write.js`
- `src/shared/artifact-schemas.js` (optional; schema allows additionalProperties)

**Tasks:**
- [ ] Replace `featureSettings.gitBlame` with `featureSettings.scmAnnotate`.
- [ ] Update `process-files.js` to pass:
  - `scmProvider: runtime.scmProvider`
  - `scmAnnotateEnabled: runtime.scmAnnotateEnabled`
- [ ] Update `index_state.json` features:
  - Replace `features.gitBlame` with `features.scmAnnotate`
  - Add `features.scmProvider` string for observability.

**Tests:**
- [ ] `tests/index-state/features-scm.test.js`
  - Assert `index_state.json` written by write step includes new feature flags.

---

## Phase 13.3 — Implement JJ provider (CLI wrapper, parsing, caching)

**Objective:** Provide JJ-backed repo provenance and file metadata that behaves similarly to Git meta, without mutating repo state.

**Exit criteria:**
- [ ] JJ provider can:
  - Detect workspace root
  - Read `@` commitId and changeId
  - Determine “dirty” (working-copy commit differs from parents)
  - For a file: determine last-modified timestamp and author, and churn (bounded history)
  - Optionally annotate lines (when enabled)
- [ ] Provider never snapshots working copy by default (always uses `--ignore-working-copy` + `--at-op=@`).
- [ ] Provider failure modes are safe: returns `{}` meta and logs warnings, never crashes indexing.

### 13.3.1 — JJ command runner + diagnostics

**New files:**
- `src/index/scm/providers/jj.js`

**Tasks:**
- [ ] Implement a `runJj(args, { cwd, timeoutMs })` helper using `execa`:
  - Must set:
    - `cwd = repoRoot`
    - `all: false`
    - `reject: false`
    - `timeout: timeoutMs`
  - Must always pass global flags first:
    - `--ignore-working-copy`
    - `--at-op=@` (unless explicitly overridden)
- [ ] Capture and expose:
  - `stdout`, `stderr`, `exitCode`, `timedOut`
- [ ] Centralize error mapping:
  - Treat non-zero exit as **soft failure** unless it indicates “jj missing” (handled earlier).
  - Never throw from provider methods; return empty results and optionally attach `warnings`.

**Tests:**
- [ ] `tests/jj-provider/runner.unit.js`
  - Stub the runner function (do not invoke `jj`).
  - Assert that global flags are always prepended.

### 13.3.2 — JJ repo provenance (`getRepoProvenance()`)

**Commands & parsing (exact spec):**
- **Get workspace root** (used in provider init; also in repo-root detection Phase 13.4):
  - `jj --ignore-working-copy root`
  - Output: absolute path
- **Get HEAD-ish identity** (`@`):
  - `jj --ignore-working-copy --at-op=@ log --no-graph -r @ -T <template>`
  - Template (JSON line using `.escape_json()`):
    ```
    '{"commitId": ' ++ stringify(commit_id).escape_json()
    ++ ', "changeId": ' ++ change_id.normal_hex().escape_json()
    ++ ', "authorName": ' ++ author.name().escape_json()
    ++ ', "authorEmail": ' ++ stringify(author.email()).escape_json()
    ++ ', "authorTimestamp": ' ++ author.timestamp().utc().format("%+").escape_json()
    ++ '}' ++ "\n"
    ```
    Notes:
    - `change_id.normal_hex()` is documented. citeturn10view0
    - Signature methods are documented (`name()`, `email()`, `timestamp()`). citeturn7view0
- **Dirty flag**:
  - `jj --ignore-working-copy --at-op=@ diff --from @- --to @ --name-only`
  - `dirty = stdout.trim().length > 0`
  - `@-` means parent of working copy commit (JJ semantics).

**Provider mapping (output object):**
- Return:
  ```
  {
    provider: "jj",
    isRepo: true,
    root: <workspace root>,
    commit: <commitId>,
    changeId: <changeId>,
    branch: null,
    dirty: <boolean>,
    tool: { name: "jj", version: "<parsed from jj --version>" }
  }
  ```

**Tests:**
- [ ] `tests/jj-provider/provenance-parsing.unit.js`
  - Feed sample log JSON line; validate fields.
  - Feed sample diff output; validate dirty detection.

### 13.3.3 — JJ file metadata (`getFileMetaForFile()`)

**File selection semantics:**
- Input to provider is an absolute path or repo-relative path.
- Normalize to **repo-relative POSIX** `relPosix`.
- Build a fileset expression:
  - `fileset = root-file:"<escaped relPosix>"`
  - `root-file` fileset is documented. citeturn6view1

**Last-modified commit for file:**
- Use revsets `files(<fileset>)` to match commits that modify that file (documented). citeturn16view0
- Command:
  - `jj --ignore-working-copy --at-op=@ log --no-graph -r 'latest(files(<fileset>), 1)' -T <template>`
  - Template should include:
    - commitId
    - changeId
    - authorName
    - authorEmail
    - authorTimestamp (UTC RFC3339)
  - If stdout is empty: treat file as not tracked (return `{}`).

**Churn (bounded history):**
- Command (bounded):
  - `jj --ignore-working-copy --at-op=@ log --no-graph -r 'files(<fileset>)' --limit <MAX_HISTORY_COMMITS> -T <template>`
- Template (TSV per commit; faster to parse than JSON):
  ```
  stringify(commit_id) ++ "\t"
  ++ diff(<fileset-string-literal>).stat().total_added() ++ "\t"
  ++ diff(<fileset-string-literal>).stat().total_removed() ++ "\n"
  ```
  Notes:
  - `commit.diff(...).stat()` and `DiffStats.total_added/total_removed` are documented. citeturn18view0
- Parse:
  - For each line: accumulate `added`, `removed`, count commits.
- Output mapping:
  - `churnAdded = sumAdded`
  - `churnDeleted = sumRemoved`
  - `churnCommits = count`
  - `churn = churnAdded + churnDeleted`

**Performance & limits:**
- Hard defaults (internal constants; no public knobs):
  - `MAX_HISTORY_COMMITS = 200` (tunable later)
  - `TIMEOUT_MS_LOG = 5_000`
  - `TIMEOUT_MS_CHURN = 8_000`
  - `MAX_CONCURRENT_JJ_PROCS = 2`

**Caching:**
- LRU cache keyed by:
  - `${providerId}:${repoRoot}:${atOp}:${relPosix}`
- Values:
  - fileMeta result + timestamp
- Cache invalidation:
  - If provider uses `--at-op=@` and `--ignore-working-copy`, operation view is stable per run; cache is safe.
  - TTL optional (can omit; LRU size bounding sufficient).

**Tests:**
- [ ] `tests/jj-provider/filemeta.unit.js`
  - Stub log output for:
    - “tracked file” (returns JSON line)
    - “untracked file” (empty stdout)
  - Stub churn output (TSV lines), assert sums and commit counts.
  - Assert cache key normalization (posix paths).

### 13.3.4 — JJ annotate (optional; gated)

**Command:**
- `jj --ignore-working-copy --at-op=@ file annotate --template <template> <relPosixPath>`
- Template: output authorName per line (one line per file line):
  ```
  commit.author().name() ++ "\n"
  ```
  (AnnotationLine exposes `.commit()` which yields Commit; Commit exposes `.author()`; Signature `.name()` documented.) citeturn12view0turn7view0

**Parsing:**
- Split by `\n`, drop trailing empty line.
- Output `lineAuthors: string[]` (0-based line index).

**Enablement rules:**
- Only run if:
  - runtime `scmAnnotateEnabled === true`
  - provider capability `annotate === true`
  - file size ≤ `MAX_ANNOTATE_FILE_BYTES` (default 1 MiB)
- Otherwise, return no `lineAuthors` and log at debug level.

**Safety note (documented behavior):**
- Because provider always runs with `--ignore-working-copy`, annotation reflects the **last snapshotted** working-copy state, not necessarily un-snapshotted filesystem edits. This is the safe default to avoid repo mutation.

**Tests:**
- [ ] `tests/jj-provider/annotate.unit.js`
  - Stub annotate output:
    - Ensure correct line count and ordering.
    - Ensure trailing newline handling.
  - Ensure annotate is skipped when disabled or file too large.

---

## Phase 13.4 — Repo root resolution + skip `.jj` internals

**Objective:** Make indexing correctly identify JJ workspace roots and avoid indexing JJ internal metadata.

**Exit criteria:**
- [ ] Running PairOfCleats from a subdirectory of a JJ workspace resolves repo root to the JJ root.
- [ ] `.jj/` directory contents are never indexed.
- [ ] Auto-policy sizing/scan avoids `.jj/`.

### 13.4.1 — Resolve repo root using JJ

**Modified files:**
- `tools/dict-utils.js`

**Tasks:**
- [ ] Update `resolveRepoRoot(base)`:
  - Before `git rev-parse`, attempt:
    - `jj --ignore-working-copy root` (spawnSync)
  - If succeeds, return JJ root.
  - If fails (non-zero or ENOENT), continue to existing Git logic.
- [ ] Do not treat failure as error; JJ may not be installed.

**Tests:**
- [ ] `tests/tools/resolve-repo-root-jj.unit.js`
  - Implement a stub-exec mechanism:
    - Refactor `resolveRepoRoot` to call an internal helper `runSync(cmd, args, opts)` that can be injected in tests.
    - In tests, inject a fake runner that returns a JJ root.
  - Assert precedence: JJ root beats git root when both available.

### 13.4.2 — Skip `.jj/` directories everywhere

**Modified files:**
- `src/index/constants.js`
- `src/shared/auto-policy.js`
- (optional) `tools/generate-repo-dict.js`, `tools/repo-metrics-scan.js` if they have skip lists

**Tasks:**
- [ ] Add `.jj` to `SKIP_DIRS` in `src/index/constants.js`.
- [ ] Add `.jj` to ignore list used by auto-policy repo sizing logic.
- [ ] Ensure ignore matcher still respects `.gitignore` where enabled.

**Tests:**
- [ ] `tests/discover/skip-jj-dir.test.js`
  - Create a temp repo tree with `.jj/` and a file inside it.
  - Assert discovery does not include that file.

---

## Phase 13.5 — Metrics + retrieval compatibility

**Objective:** Record SCM provider provenance in metrics and ensure retrieval paths continue to work for both old and new metrics formats.

**Exit criteria:**
- [ ] `metrics.json` includes SCM provider ID and provenance.
- [ ] Retrieval’s `--branch` behavior continues to work for Git and does not crash for JJ/None.

### 13.5.1 — Metrics schema update

**Modified files:**
- `src/index/build/artifacts.js`
- `src/index/build/artifacts/metrics.js`
- `src/retrieval/cli/options.js`

**Tasks:**
- [ ] Change `writeIndexMetrics()` signature to accept `repoProvenance` (from runtime) so it does not call SCM again.
- [ ] Update `metrics.json` content:
  - Add top-level:
    - `scm: { provider, commit, changeId, branch, dirty }`
  - Keep existing `git` object for backward compatibility when provider is git:
    - `git: { commit, branch, dirty }`
- [ ] Update retrieval `loadBranchFromMetrics()`:
  - First try `raw?.scm?.branch`
  - Fallback to `raw?.git?.branch`
  - Return null if missing.

**Tests:**
- [ ] `tests/retrieval/load-branch-from-metrics.test.js`
  - Provide sample metrics fixtures:
    - Legacy (git only)
    - New (scm + git)
    - JJ (scm provider jj; branch null)
  - Ensure no crashes and correct preference order.

---

## Phase 13.6 — Full test plan (unit + smoke)

**Objective:** Ensure correctness and durability without requiring JJ in CI.

**Exit criteria:**
- [ ] Unit tests cover command construction, parsing, caching keys, and selection logic.
- [ ] Optional integration test runs when JJ is available (skipped otherwise).

### 13.6.1 — Unit test coverage (mandatory)

**Tasks:**
- [ ] Add the unit tests specified in earlier phases.
- [ ] Ensure all tests are runnable with `node tests/run.js` and do not require network.

### 13.6.2 — Optional integration test (only if jj available)

**New test (optional):**
- `tests/integration/jj-provider.smoke.test.js`

**Behavior:**
- If `process.env.PAIROFCLEATS_TEST_WITH_JJ !== '1'`, exit 0 (skip).
- Else:
  - Create temp directory
  - `jj init` (if available)
  - Create a file, make a commit
  - Run provider methods against that workspace and assert:
    - repoProvenance.commit is non-empty
    - fileMeta.lastModified is non-empty for tracked file

**Why optional:** CI may not include `jj`.

---

## Phase 13.7 — Documentation (developer + user)

**Objective:** Remove ambiguity for operators and future maintainers.

**Exit criteria:**
- [ ] Docs explain provider selection, safety defaults, and limitations (especially annotate correctness).
- [ ] Docs provide troubleshooting steps.

**Modified files (docs):**
- `docs/commands.md` (index build usage note: JJ support)
- `docs/artifact-contract.md` (repo/scm fields)
- `docs/setup.md` (JJ requirements: `jj` on PATH)

**Tasks:**
- [ ] Add a “SCM Provider” section:
  - Provider auto selection rules
  - Required tooling (`git` and/or `jj`)
  - Safety flags used for JJ (`--ignore-working-copy`, `--at-op=@`) citeturn2view0
  - Note about JJ auto-tracking during snapshots and why we avoid snapshotting by default citeturn14view1
- [ ] Add troubleshooting:
  - “.jj found but jj missing” fallback behavior
  - Timeouts and how they present in logs

---

## Appendix A — SCM Provider interface (spec draft)

### A.1 Provider interface (JSDoc)

```js
/**
 * @typedef {'git'|'jj'|'none'} ScmProviderId
 *
 * @typedef {Object} ScmRepoProvenance
 * @property {ScmProviderId} provider
 * @property {boolean} isRepo
 * @property {string|null} root
 * @property {string|null} commit
 * @property {string|null} branch
 * @property {boolean|null} dirty
 * @property {string|null} changeId   // jj only
 * @property {{name:string, version:string}|null} tool
 *
 * @typedef {Object} ScmFileMeta
 * @property {string|null} lastModified        // ISO8601 UTC or null
 * @property {string|null} lastModifiedBy      // author name or null
 * @property {number|null} churnAdded
 * @property {number|null} churnDeleted
 * @property {number|null} churnCommits
 * @property {number|null} churn               // added + deleted
 * @property {string[]|null} lineAuthors       // 0-based by line index
 *
 * @typedef {Object} ScmProviderCapabilities
 * @property {boolean} repoProvenance
 * @property {boolean} fileMeta
 * @property {boolean} annotate
 * @property {boolean} trackedFiles            // reserved for future
 *
 * @typedef {Object} ScmProvider
 * @property {ScmProviderId} id
 * @property {ScmProviderCapabilities} capabilities
 * @property {(opts?:{signal?:AbortSignal}) => Promise<ScmRepoProvenance>} getRepoProvenance
 * @property {(filePath:string, opts?:{annotate?:boolean}) => Promise<ScmFileMeta>} getFileMetaForFile
 */
```

### A.2 Behavior contract

- Providers **must not throw** for routine SCM failures (file not tracked, repo missing, command unavailable).
- Providers **must**:
  - return `{}` / `null` fields
  - log warnings (once per category) to avoid log spam
- Providers must support being called concurrently and must self-throttle external process concurrency.

---

## Appendix B — JJ revset/fileset references (why specific syntax)

- `files(<fileset>)` is the documented revset for selecting commits that modify paths matching a fileset. citeturn16view0
- `root-file:"path"` is the documented fileset for selecting a workspace-relative path. citeturn6view1
- `commit.diff("<fileset>").stat()` and `DiffStats` totals are documented, and preferred over parsing raw diff output. citeturn18view0

---

# Phase 14 — Incremental Diffing & Snapshots (Time Travel, Regression Debugging)

### Objective

Implement durable, high-throughput **time-travel primitives** over the index cache:

1. **IndexRef**: a stable, user-facing reference grammar for resolving “which index” to read (latest/build/snapshot/tag/path).
2. **Snapshots**: a durable registry of pointer snapshots plus optional immutable **frozen snapshots** (for regression debugging and reproducibility).
3. **Diffs**: deterministic, bounded semantic diffs between two IndexRefs (useful for regression analysis and incremental workflows).
4. **As-of retrieval**: `pairofcleats search --as-of <IndexRef>` that routes retrieval to historical index roots (and does so safely for sqlite/lmdb).
5. **Performance + durability**: lock coordination, atomic writes, fast-paths, bounded memory, and strict no-path-leak guarantees for persisted registries.

### Key requirements (non-negotiable)

- Deterministic IDs and ordering (snapshots, diffs, events).
- Crash-safe registry mutation (atomic writes, staging dirs).
- **No absolute-path leakage** in persisted registries (`snapshots/*`, `diffs/*`).
- Bounded runtime/memory for large repos (limits, streaming selection by fileId).
- Works with the existing cache/build layout: `repoCacheRoot/builds/current.json`, `build_state.json`, `pieces/manifest.json`.

### Explicit choices

- Snapshot type: **pointer snapshots by default**, optional **frozen snapshots** created explicitly via `snapshot freeze`.
- Freeze file movement: **hardlink-by-default with per-file fallback to copy** (best throughput; safe under atomic-writer model).
- Diff identity: `diff_<sha1(stableStringify(inputsCanonical)).slice(0,16)>` (64-bit readability, extremely low collision risk).
- Diff algorithm: **semantic-v1**, bounded by `maxChangedFiles`, `maxChunksPerFile`, `maxEvents`.
- As-of retrieval: resolve IndexRef once → build an `asOfContext` → override **all** index-dir resolution call sites to use as-of roots.
- SQLite/LMDB policy: only allowed when **all requested modes share a single base root**; otherwise fail (if forced) or fall back to memory (if auto).

---

## 14.1 IndexRef primitive (parse + resolve + identityHash)

### Files touched

- **New**
  - `src/index/index-ref.js`
- **Reuse only**
  - `tools/dict-utils.js` (for cache root + current build info)
  - `src/shared/stable-json.js` (`stableStringify`)
  - `src/shared/hash.js` (`sha1`)
  - `src/shared/error-codes.js` (`ERROR_CODES`, `createError`)

### 14.1.1 Implement IndexRef grammar + canonicalization

- [ ] Create `src/index/index-ref.js` with exported functions:

  **Exports (required):**
  - `parseIndexRef(ref: string) -> ParsedIndexRef`
  - `resolveIndexRef(args: ResolveIndexRefArgs) -> ResolvedIndexRef`

  **Recommended internal helpers:**
  - `normalizeIndexModes(requestedModes: string[]|null) -> string[]`
  - `readBuildState(baseRootAbs: string) -> { buildId, configHash, toolVersion, validationOk } | null`
  - `redactPathRef(ref: string) -> string` (returns `path:<redacted>`)

- [ ] `parseIndexRef(ref)` MUST accept and canonicalize:

  **Canonical forms:**
  - `latest`
  - `build:<buildId>`
  - `snap:<snapshotId>`
  - `tag:<tag>`
  - `path:<absOrRelPath>`

  **Normalization rules:**
  - Trim whitespace.
  - Prefix is case-insensitive, but canonical output is lowercase (`BUILD:` → `build:`).
  - `latest` is canonical for empty/undefined (callers may map `null`/`""` to `latest`).

  **Validation rules:**
  - `buildId` regex: `^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$`
  - `snapshotId` regex: `^snap-[A-Za-z0-9][A-Za-z0-9._-]{3,127}$`
  - `tag` regex: `^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$` AND MUST NOT contain `..` segments
  - `path:` accepted for **resolution only**, but marked `persistUnsafe = true`

  **Errors:**
  - Invalid ref MUST throw `createError(ERROR_CODES.INVALID_REQUEST, ...)` with a message that includes the invalid token and the allowed forms.

### 14.1.2 Implement IndexRef resolution semantics

- [ ] Implement `resolveIndexRef({ repoRoot, userConfig, ref, requestedModes, preferFrozen, allowMissingModes })`.

  **Inputs:**
  - `repoRoot` absolute path to repo
  - `userConfig` normalized config object (may be null)
  - `ref` string (any accepted IndexRef form; treat falsy as `latest`)
  - `requestedModes` array of requested modes (subset of `['code','prose','extracted-prose','records']`)
  - `preferFrozen` boolean default `true`
  - `allowMissingModes` boolean default `false` (fail-closed by default)

  **Outputs:**
  - `ResolvedIndexRef` containing:
    - `parsed` (`ParsedIndexRef`)
    - `resolved`:
      - `indexBaseRootByMode` (absolute base root per mode)
      - `indexDirByMode` (absolute `<base>/index-<mode>`)
      - `buildIdByMode` (best effort)
      - `configHashByMode` (best effort)
      - `toolVersionByMode` (best effort)
      - `snapshotId` if applicable
      - `frozenUsed` boolean if snapshot resolution used frozen
    - `identity` (portable identity object; no absolute paths)
    - `identityHash` (sha1 of stableStringify(identity))
    - `warnings[]` (strings safe to print)

- [ ] Resolution rules by type:

  **(A) `latest`**
  - Read `repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig)`.
  - Read `<repoCacheRoot>/builds/current.json`.
  - Determine base root per mode using `current.json.buildRoots[mode]` if present; else fallback to `current.json.buildRoot`.
  - Base roots in current.json are relative; resolve absolute via `path.join(repoCacheRoot, rel)`.

  **(B) `build:<buildId>`**
  - Base root for all modes = `<repoCacheRoot>/builds/<buildId>`.
  - If requested mode dir missing, behave per `allowMissingModes`.

  **(C) `snap:<snapshotId>`**
  - Load snapshot registry entry at `<repoCacheRoot>/snapshots/<snapshotId>/snapshot.json`.
  - If `preferFrozen===true` AND `<repoCacheRoot>/snapshots/<id>/frozen.json` exists AND frozen dir exists:
    - Base root for all requested modes = `<repoCacheRoot>/snapshots/<id>/frozen`
    - Set `frozenUsed=true`
  - Else:
    - Base roots per mode from `snapshot.pointer.buildRootsByMode` (repoCacheRoot-relative strings).

  **(D) `tag:<tag>`**
  - Load snapshot manifest and resolve tag → snapshotId (most recent first).
  - Resolve as `snap:<snapshotId>`.

  **(E) `path:<pathValue>`**
  - Resolve absolute base root = `path.resolve(repoRoot, pathValue)` if relative; else `path.resolve(pathValue)`.
  - **DO NOT** persist raw path anywhere; identity must contain only `pathHash = sha1(resolvedAbsPath)`.
  - Add warning: “Path ref used; identity is not portable across machines.”

- [ ] Per-mode validation for resolver:

  For each requested mode:
  - Compute `indexDir = path.join(baseRoot, 'index-'+mode)`.
  - If `allowMissingModes=false` and `indexDir` does not exist or lacks `chunk_meta.*`, throw `createError(ERROR_CODES.NO_INDEX, ...)`.
  - If `allowMissingModes=true`, omit that mode from `indexDirByMode` and record warning.

- [ ] Identity rules (portable; no absolute paths):

  - Identity object MUST include (at minimum):
    - `version: 1`
    - `type: 'latest'|'build'|'snapshot'|'tag'|'path'`
    - `requestedModes: [...]`
    - `buildIdByMode` (best effort; OK if missing)
    - `snapshotId` or `tag` when applicable
    - `repoId` or `repoRootHash` may be included (hash only; do not include absolute path)
    - If type == 'path': `pathHash` and `refRedacted: 'path:<redacted>'`

  - Compute `identityHash = sha1(stableStringify(identity))` using `src/shared/hash.js#sha1`.

### 14.1.3 Tests / Verification

- [ ] Add `tests/unit/index-ref.unit.js` (unit lane via `.unit.js` suffix).
  - [ ] Parse normalization and invalid forms.
  - [ ] Tag resolution chooses newest deterministically.
  - [ ] IdentityHash stability and changes.
  - [ ] Path ref redaction + no raw path in identity.

---

## 14.2 Snapshot registry + snapshot CLI

### Files touched

- **New**
  - `src/index/snapshots/registry.js`
  - `src/index/snapshots/freeze.js`
  - `src/index/snapshots/commands.js` (or inline in tool script; recommended to keep logic in src/)
  - `tools/index-snapshot.js`
- **Modify**
  - `bin/pairofcleats.js` (route + allowlists + help text)
- **Optional (recommended)**
  - `docs/config-schema.json`
  - `tools/dict-utils.js` (`normalizeUserConfig` pass-through if new config keys are added)

### 14.2.1 Snapshot on-disk layout + schemas (exact)

- [ ] Implement layout under `repoCacheRoot/snapshots/`:

  ```text
  repoCacheRoot/
    snapshots/
      manifest.json
      <snapshotId>/
        snapshot.json
        frozen.json            (optional; only after freeze)
        frozen/                (optional; only after freeze)
          build_state.json     (optional)
          index-code/
          index-prose/
          index-extracted-prose/
          index-records/
          index-sqlite/        (optional)
          index-lmdb/          (optional)
  ```

- [ ] Implement manifest schema v1 exactly (map form; atomic):

  `snapshots/manifest.json`
  ```json
  {
    "version": 1,
    "updatedAt": "2026-01-24T00:00:00.000Z",
    "snapshots": {
      "snap-...": {
        "snapshotId": "snap-...",
        "createdAt": "2026-01-24T00:00:00.000Z",
        "kind": "pointer",
        "tags": ["release/v1.2.3"],
        "label": "optional short label",
        "hasFrozen": false
      }
    },
    "tags": {
      "release/v1.2.3": ["snap-...", "snap-..."]
    }
  }
  ```

- [ ] Implement `snapshot.json` schema v1 exactly (immutable after create):

  ```json
  {
    "version": 1,
    "snapshotId": "snap-...",
    "createdAt": "2026-01-24T00:00:00.000Z",
    "kind": "pointer",
    "label": "optional",
    "notes": "optional multi-line string",
    "tags": ["release/v1.2.3"],
    "pointer": {
      "buildRootsByMode": {
        "code": "builds/<buildId>",
        "prose": "builds/<buildId>"
      },
      "buildIdByMode": {
        "code": "<buildId>",
        "prose": "<buildId>"
      }
    },
    "provenance": {
      "repoRootHash": "<sha1(absRepoRoot)>",
      "toolVersionByMode": { "code": "0.12.0" },
      "configHashByMode": { "code": "<sha1>" }
    }
  }
  ```

  **Critical rule:** `buildRootsByMode` values MUST be repoCacheRoot-relative (no absolute paths).

- [ ] Implement `frozen.json` schema v1 exactly (immutable after freeze):

  ```json
  {
    "version": 1,
    "snapshotId": "snap-...",
    "frozenAt": "2026-01-24T00:05:00.000Z",
    "method": "hardlink",
    "frozenRoot": "snapshots/snap-.../frozen",
    "included": {
      "modes": ["code", "prose"],
      "sqlite": true,
      "lmdb": false
    },
    "verification": {
      "checkedAt": "2026-01-24T00:05:00.000Z",
      "ok": true,
      "filesChecked": 1234,
      "bytesChecked": 987654321,
      "failures": []
    }
  }
  ```

  **Critical rule:** `frozenRoot` MUST be repoCacheRoot-relative (no absolute paths).

### 14.2.2 Snapshot registry implementation (atomic, crash-safe)

- [ ] Create `src/index/snapshots/registry.js` implementing:

  **Required functions:**
  - `getSnapshotsRoot(repoCacheRoot) -> string`
  - `loadSnapshotsManifest(repoCacheRoot) -> Manifest`
  - `writeSnapshotsManifest(repoCacheRoot, manifest) -> void`
  - `loadSnapshot(repoCacheRoot, snapshotId) -> SnapshotJson`
  - `writeSnapshot(repoCacheRoot, snapshotId, snapshotJson) -> void`
  - `loadFrozen(repoCacheRoot, snapshotId) -> FrozenJson | null`
  - `writeFrozen(repoCacheRoot, snapshotId, frozenJson) -> void`
  - `cleanupSnapshotStaging(repoCacheRoot, { olderThanHours = 24 }) -> { removedCount }`

  **Implementation details:**
  - Use `src/shared/json-stream.js#writeJsonObjectFile({ atomic:true })` for all JSON writes.
  - Reject invalid snapshotId/tag early (path traversal defense).
  - `cleanupSnapshotStaging` removes directories matching:
    - `snapshots/<id>/frozen.staging-*` older than threshold.

### 14.2.3 Snapshot commands (create/freeze/list/show/prune)

- [ ] Create `src/index/snapshots/commands.js` (or equivalent) with exported high-level ops:
  - `createSnapshot(opts)`
  - `freezeSnapshot(opts)`
  - `listSnapshots(opts)`
  - `showSnapshot(opts)`
  - `pruneSnapshots(opts)`

#### 14.2.3.A `snapshot create`

- [ ] Requirements:
  - MUST acquire index lock: `src/index/build/lock.js#acquireIndexLock(repoCacheRoot, waitMs)`.
  - MUST reject `path:` refs entirely (snapshot registry must remain portable).
  - MUST validate `build_state.json.validation.ok === true` for each referenced base root.

- [ ] Algorithm:
  1. Acquire lock.
  2. Cleanup stale staging dirs (best-effort; do not fail if cleanup fails).
  3. Resolve `latest` via `resolveIndexRef` (request modes from `--modes` or defaults).
  4. For each unique base root, read `<baseRoot>/build_state.json` and verify `validation.ok === true`.
  5. Choose snapshotId:
     - If `--id`: validate; ensure snapshot dir doesn’t exist.
     - Else generate `snap-<YYYYMMDDHHMMSS>-<randomHex6>`.
  6. Write `snapshot.json` atomically.
  7. Update `manifest.json` atomically:
     - Add `snapshots[snapshotId]`
     - Update tags reverse index (newest first)
     - Set `updatedAt`
  8. Release lock.

#### 14.2.3.B `snapshot freeze`

- [ ] Requirements:
  - MUST acquire index lock.
  - MUST stage to `frozen.staging-*` and rename to `frozen/` only on success.
  - MUST use `pieces/manifest.json` to enumerate files and expected checksums.
  - Default method = `hardlink` with per-file fallback to copy on `EXDEV/EPERM/EACCES`.
  - Default verify = true (checksumFile compare to manifest checksum).

- [ ] Algorithm (exact):
  1. Acquire lock.
  2. Load `snapshot.json`.
  3. Resolve `sourceBaseRootByMode`:
     - Convert each `pointer.buildRootsByMode[mode]` from repoCacheRoot-relative to absolute.
  4. Create staging dir: `snapshots/<id>/frozen.staging-<ts>/`.
  5. For each selected mode:
     - `srcDir = <sourceBaseRoot>/index-<mode>`
     - `dstDir = <staging>/index-<mode>`
     - Load `<srcDir>/pieces/manifest.json` (required; fail if missing)
     - For each `piece` in manifest:
       - `relPath = piece.path` (posix-ish)
       - `srcFile = path.join(srcDir, relPath)`
       - `dstFile = path.join(dstDir, relPath)`
       - Ensure `dirname(dstFile)` exists.
       - Attempt hardlink/copy.
       - If verify:
         - compute `checksumFile(dstFile)` and compare to `piece.checksum`.
  6. Optionally include sqlite/lmdb directories via recursive copy/link:
     - `<baseRoot>/index-sqlite` → `<staging>/index-sqlite`
     - `<baseRoot>/index-lmdb` → `<staging>/index-lmdb`
  7. Optionally copy `<baseRoot>/build_state.json` into staging root.
  8. On verify failure: delete staging, do not update registry, error.
  9. Rename staging → `snapshots/<id>/frozen` (atomic rename).
  10. Write `frozen.json` atomically.
  11. Update manifest entry `hasFrozen=true` atomically.
  12. Release lock.

#### 14.2.3.C `snapshot list/show/prune`

- [ ] `list`:
  - Order: `createdAt desc`.
  - `--tag` filters by tag.
  - `--json` prints a machine output with manifest summaries.

- [ ] `show`:
  - Prints snapshot.json; includes frozen.json if present.

- [ ] `prune` policy flags (CLI overrides config if present):
  - `--keep-frozen <n>` default 20
  - `--keep-pointer <n>` default 50
  - `--keep-tags <csv/glob>` default `release/*`
  - `--max-age-days <n>` optional
  - `--dry-run`, `--json`

  Rules:
  - Never delete snapshots with protected tag match.
  - Prefer deleting pointer-only snapshots first.
  - Deterministic deletion order: oldest first.
  - MUST remove stale staging dirs as part of prune.

### 14.2.4 Snapshot CLI tool + bin wrapper wiring

- [ ] Add `tools/index-snapshot.js`:
  - Use `src/shared/cli.js#createCli` with subcommands: create/freeze/list/show/prune.
  - Must accept `--repo <path>` (required for wrapper usage).
  - All output must be safe (no absolute paths in persisted outputs; CLI may display absolute paths only if explicitly requested — not required for Phase 14).

- [ ] Update `bin/pairofcleats.js`:

  **Routing:**
  - `pairofcleats index snapshot ...` → `tools/index-snapshot.js`

  **Allowlist (strict validation):**
  - MUST add required flags for snapshot commands (see Appendix B “Bin allowlists”).

  **Help text:**
  - Add section under Index:
    - `index snapshot create`
    - `index snapshot freeze`
    - `index snapshot list`
    - `index snapshot show`
    - `index snapshot prune`

### 14.2.5 Tests / Verification

- [ ] Add `tests/indexing/index-snapshot.test.js` (integration):
  - [ ] Build index in a temp repo copy.
  - [ ] `index snapshot create` succeeds only if validation.ok true.
  - [ ] `index snapshot freeze` creates frozen dir and verifies checksum.
  - [ ] Freeze failure on missing piece does not create frozen dir nor set hasFrozen.
  - [ ] `snapshot prune` respects protected tags.
  - [ ] “No absolute path leak” assertions: scan `snapshots/manifest.json`, `snapshot.json`, `frozen.json` for the temp repo absolute path; must not appear.

---

## 14.3 Diff engine + diff registry + diff CLI

### Files touched

- **New**
  - `src/index/diffs/compute.js`
  - `src/index/diffs/registry.js`
  - `src/index/diffs/normalize.js` (optional; recommended for stable event ordering and edge normalization)
  - `tools/index-diff.js`
- **Modify**
  - `bin/pairofcleats.js` (route + allowlists + help text)

### 14.3.1 Diff registry layout + schemas (exact)

- [ ] Layout under `repoCacheRoot/diffs/`:

  ```text
  repoCacheRoot/
    diffs/
      manifest.json
      <diffId>/
        inputs.json
        summary.json
        events.jsonl
  ```

- [ ] Implement `diffs/manifest.json` schema v1:

  ```json
  {
    "version": 1,
    "updatedAt": "2026-01-24T00:00:00.000Z",
    "diffs": {
      "diff_...": {
        "diffId": "diff_...",
        "createdAt": "2026-01-24T00:00:00.000Z",
        "modes": ["code"],
        "from": "snap:snap-...",
        "to": "build:<buildId>",
        "summary": { "filesChanged": 12, "chunksChanged": 44 }
      }
    }
  }
  ```

- [ ] Implement `inputs.json` canonical schema (semantic-v1):

  ```json
  {
    "version": 1,
    "kind": "semantic-v1",
    "from": { "ref": "snap:snap-...", "identityHash": "<sha1>", "type": "snapshot", "snapshotId": "snap-..." },
    "to":   { "ref": "build:<buildId>", "identityHash": "<sha1>", "type": "build", "buildIdByMode": { "code": "<buildId>" } },
    "modes": ["code"],
    "options": {
      "detectRenames": true,
      "includeRelations": true,
      "maxChangedFiles": 200,
      "maxChunksPerFile": 500,
      "maxEvents": 20000
    }
  }
  ```

  **Critical rule:** no absolute paths may appear in inputs.json. If a path ref was used, it must be redacted (`path:<redacted>`) and persistence is disallowed unless `--persist-unsafe`.

- [ ] Implement `summary.json` schema (minimal but stable; MUST include counts + limit flags):

  ```json
  {
    "version": 1,
    "diffId": "diff_...",
    "createdAt": "2026-01-24T00:00:00.000Z",
    "kind": "semantic-v1",
    "modes": ["code"],
    "limits": { "maxChangedFiles": 200, "maxChunksPerFile": 500, "maxEvents": 20000, "eventsTruncated": false },
    "counts": {
      "files": { "added": 0, "removed": 0, "modified": 0, "renamed": 0, "unchanged": 0 },
      "chunks": { "added": 0, "removed": 0, "modified": 0, "moved": 0, "unchanged": 0 },
      "relations": { "added": 0, "removed": 0, "modified": 0 }
    }
  }
  ```

- [ ] Implement `events.jsonl` event envelope schema (one JSON object per line; deterministic ordering):

  ```json
  { "seq": 1, "mode": "code", "type": "file.added", "file": "src/x.js", "meta": { ... } }
  ```

  **Deterministic ordering requirements:**
  - Events must be emitted in a stable order across runs given the same inputs.
  - Ordering spec is in 14.3.3 below.

### 14.3.2 Diff registry implementation (atomic)

- [ ] Create `src/index/diffs/registry.js` with functions:
  - `loadDiffsManifest(repoCacheRoot)`
  - `writeDiffsManifest(repoCacheRoot, manifest)`
  - `writeDiffRun(repoCacheRoot, diffId, { inputs, summary, eventsStreamOrPath })`
  - `loadDiffInputs(repoCacheRoot, diffId)`
  - `loadDiffSummary(repoCacheRoot, diffId)`
  - `openDiffEventsReadStream(repoCacheRoot, diffId)`
  - `pruneDiffs(repoCacheRoot, policy)`

  **Rules:**
  - All JSON uses `writeJsonObjectFile(..., {atomic:true})`.
  - `events.jsonl` can be written via stream to temp + rename, or written directly if also staged under `<diffId>.staging-*` then renamed.
  - “No absolute paths” must be enforced on persisted `inputs.json`.

### 14.3.3 Diff compute engine: semantic-v1 (bounded + deterministic)

- [ ] Create `src/index/diffs/compute.js` with primary entry:
  - `computeIndexDiff({ repoRoot, userConfig, fromRef, toRef, modes, options, persist, persistUnsafe }) -> { diffId, inputs, summary, eventsPathOrArray }`

- [ ] Resolution and persistence policy:
  - Resolve `fromRef` and `toRef` via `resolveIndexRef(...preferFrozen=true...)`.
  - If either ref type is `path`:
    - Default `persist=false` unless `persistUnsafe=true`.
    - Even if persisted unsafely, MUST redact raw paths in inputs.json.

- [ ] DiffId computation (exact):
  - Build `inputsCanonical` as per schema in 14.3.1.
  - `diffId = 'diff_' + sha1(stableStringify(inputsCanonical)).slice(0,16)`.
  - If diffId exists:
    - If inputs match exactly, return existing.
    - Else throw INTERNAL collision error.

- [ ] Fast-path “no changes” (high throughput):
  - For each mode, attempt to compare **pieces manifests**:
    - Load `<modeDir>/pieces/manifest.json` on both sides.
    - Compute `manifestSig = sha1(stableStringify({ mode, stage, pieces: pieces.map(p=>({ path:p.path, checksum:p.checksum, bytes:p.bytes })) }))`
    - If manifestSig equal for a mode, treat that mode as unchanged and emit no events for that mode.
    - If all requested modes unchanged, overall diff is empty and chunk scanning MUST be skipped.

- [ ] File-level diff (required, deterministic):
  - Load file_meta arrays for both sides:
    - Prefer `src/shared/artifact-io.js#loadJsonArrayArtifact(dir, 'file_meta')` if available, else read `file_meta.json` directly.
  - Build maps keyed by **file path** (string) with values `{ id, hash, hashAlgo, size, ext }`.
  - Compute:
    - removedPaths = pathsInFrom - pathsInTo
    - addedPaths = pathsInTo - pathsInFrom
    - modifiedPaths = intersection where hash differs (or if hash missing, size differs)
  - Rename detection (if enabled):
    - Pair removed/added by identical `(hashAlgo,hash)` deterministically:
      - Group removed by hashKey, group added by hashKey.
      - Pair in sorted-path order within each hash group.
    - Emit `file.renamed` events and remove from added/removed sets.
  - Emit events in this order:
    1. `file.renamed` (sorted by oldPath, then newPath)
    2. `file.removed` (sorted by path)
    3. `file.added` (sorted by path)
    4. `file.modified` (sorted by path)

  **File event meta must include:**
  - from/to file hash when known
  - size when known
  - for rename: old/new paths + hash

- [ ] Chunk-level diff (required but bounded):
  - Determine candidate file set for chunk diff:
    - `changedPaths = renamed + modified` (NOT purely added/removed unless desired; base plan: only renamed+modified)
    - If `changedPaths.length > maxChangedFiles`:
      - Emit `limit.maxChangedFiles` event and skip chunk diff entirely for this mode.
  - Determine fileId sets for selection:
    - For each changed path, map to `fileIdFrom` and/or `fileIdTo` (using file_meta maps).
  - Stream chunk_meta entries and select only those with matching fileIds:
    - Must support chunk_meta formats:
      - `chunk_meta.json`
      - `chunk_meta.jsonl`
      - `chunk_meta.meta.json` + parts directory
      - compressed `.jsonl.gz` and `.jsonl.zst` variants (OK to load per-shard into memory; do not load entire corpus)
    - Collect per fileId, bounded by `maxChunksPerFile`.
    - If a file exceeds maxChunksPerFile:
      - Emit `limit.maxChunksPerFile` for that file and skip chunk diff for that file.

  - Matching algorithm (deterministic):
    - For each changed file path, build chunk arrays `chunksFrom` and `chunksTo`.
    - Define `chunkLogicalKey`:
      - `segmentId = chunk.segment?.segmentId || ''`
      - `kind = chunk.kind || ''`
      - `name = chunk.name || ''`
      - `signature = chunk.metaV2?.signature || chunk.docmeta?.signature || ''`
      - `logicalKey = segmentId + '|' + kind + '|' + name + '|' + signature`
    - Define `chunkRangeKey`:
      - Prefer `startLine/endLine` if present else `start/end`.
    - Match in two passes:
      1. Pass A: if `chunk.metaV2?.chunkId` exists on both sides, match by chunkId.
      2. Pass B: match remaining by `logicalKey` (stable string). If multiple, match by closest rangeKey order (sorted ranges).
    - Classification:
      - present in to only: `chunk.added`
      - present in from only: `chunk.removed`
      - matched:
        - if logicalKey same but range differs: `chunk.moved`
        - if signature differs or relations differ: `chunk.modified`
        - else: unchanged (emit nothing)

  - Event ordering (deterministic):
    - Within each file, emit chunk events sorted by:
      1. event type order: moved, modified, removed, added (or any fixed order; must be documented and consistent)
      2. `logicalKey`
      3. range start numeric

- [ ] Relations diff (optional but default enabled):
  - For matched chunks, if `includeRelations=true`:
    - Normalize relations to stable sets:
      - imports: array of strings
      - exports: array of strings
      - importLinks: array of strings
      - calls: array of `a->b` strings for pairs
      - usages: array of stableStringify(usageObj)
    - Diff each set to get added/removed.
    - Emit events:
      - `relations.added` / `relations.removed` with `{ file, chunkLogicalKey, relationType, value }`
    - Guard event count via `maxEvents`.

- [ ] Global `maxEvents` enforcement:
  - As events are appended, if `count >= maxEvents`:
    - Emit final `limit.maxEvents` event (if room) and stop further event generation.
    - Set `summary.limits.eventsTruncated=true`.

### 14.3.4 Diff CLI tool + bin wrapper wiring

- [ ] Add `tools/index-diff.js` with subcommands:
  - `compute --from --to [--modes] [--max-changed-files] [--max-chunks-per-file] [--max-events] [--include-relations] [--detect-renames] [--persist] [--persist-unsafe] [--json] [--compact]`
  - `show --diff <diffId> [--json]`
  - `list [--modes|--mode] [--json]`
  - `prune [policy flags] [--dry-run] [--json]`

- [ ] Update `bin/pairofcleats.js`:
  - Route `pairofcleats index diff ...` → `tools/index-diff.js`
  - Add allowlists (Appendix B).
  - Update help text.

### 14.3.5 Tests / Verification

- [ ] Add `tests/indexing/index-diff.test.js` (integration):
  - [ ] Build two versions (capture buildId1/buildId2).
  - [ ] Rename a file (content unchanged) → expect `file.renamed` event.
  - [ ] Modify a file → expect `file.modified` and at least one chunk-level event (unless thresholds skip).
  - [ ] Re-run diff compute → identical diffId and identical summary.
  - [ ] Verify persistence policy:
    - If using `path:` refs without `--persist-unsafe`, diff directory must not be created.

---

## 14.4 As-of retrieval integration (`pairofcleats search --as-of`)

### Files touched

- **Modify**
  - `bin/pairofcleats.js` (search allowlist + help text)
  - `src/retrieval/cli-args.js` (parse `--as-of`)
  - `src/retrieval/cli.js` (resolve asOfContext; pass through)
  - `src/retrieval/cli-index.js` (as-of index dir resolution + signature + cache key helpers)
  - `src/retrieval/cli/run-search-session.js` (query cache key includes as-of identity)
  - `src/retrieval/cli/backend-context.js` (LMDB indexDirs resolved as-of)
  - `src/retrieval/cli/index-loader.js` (file_relations/repo_map load from as-of dirs)
  - `src/retrieval/cli/load-indexes.js` (load indexes from as-of dirs)
- **Reuse**
  - `src/retrieval/index-cache.js#buildIndexSignature` (for signature correctness)

### 14.4.1 CLI plumbing (yargs + bin allowlist)

- [ ] `bin/pairofcleats.js`
  - [ ] Add `as-of` to `search` allowlist + valueFlags.
  - [ ] Update `printHelp()` to mention `search --as-of`.

- [ ] `src/retrieval/cli-args.js`
  - [ ] Add option:
    - `'as-of': { type: 'string', describe: 'Resolve search against a historical index ref (latest|build:...|snap:...|tag:...)', default: 'latest' }`

### 14.4.2 Resolve asOfContext in `runSearchCli`

- [ ] In `src/retrieval/cli.js`:
  - [ ] Read `argv['as-of']`.
  - [ ] Determine requested modes:
    - If user forces `--mode`: that implies a single mode.
    - Else infer from `runCode/runProse/runRecords/runExtractedProse` logic already used.
  - [ ] Call `resolveIndexRef({ repoRoot: rootDir, userConfig, ref: asOf, requestedModes, preferFrozen:true })`.
  - [ ] Construct `asOfContext = { ref: canonicalRefString, resolved, identityHash }`.
  - [ ] Pass `asOfContext` to:
    - `loadSearchIndexes(...)`
    - `createBackendContext(...)`
    - `runSearchSession(...)`
  - [ ] Add to stats output under `stats.asOf` when `--json`.

### 14.4.3 Override index directory resolution at all call sites

**This is the critical correctness step: all index reads must use as-of dirs, not “latest”.**

- [ ] In `src/retrieval/cli-index.js`, add:

  - `resolveIndexDirAsOf(repoRoot, mode, userConfig, asOfContext)`
    - If `!asOfContext` or canonical ref is `latest`: `return resolveIndexDir(repoRoot, mode, userConfig)`.
    - Else:
      - `baseRoot = asOfContext.resolved.indexBaseRootByMode[mode]`
      - If missing: throw `NO_INDEX` with mode and ref.
      - Return `path.join(baseRoot, 'index-'+mode)` (no local fallback).

  - `requireIndexDirAsOf(...)` that calls `assertIndexAvailable(dir, mode)`.

- [ ] Update *every* current call site that uses `resolveIndexDir` directly:

  **Call sites to update (enumerated from grep):**
  - `src/retrieval/cli.js`
    - `loadIndexState(mode)` (currently calls `resolveIndexDir(rootDir, mode, userConfig)`)
    - `index status` stats paths (code/prose/extracted-prose)
  - `src/retrieval/cli/backend-context.js`
    - `indexDirs: { code: resolveIndexDir(...), prose: resolveIndexDir(...) }`
  - `src/retrieval/cli/index-loader.js`
    - `loadFileRelations` uses resolveIndexDir
    - `loadRepoMap` uses resolveIndexDir
  - `src/retrieval/cli/load-indexes.js`
    - `proseIndexDir`, `codeIndexDir`, `extractedProseDir`, `recordsDir`

  **Required behavior after change:**
  - When `--as-of` is set, these paths must resolve under:
    - a build root (`.../builds/<id>/index-code`), OR
    - a snapshot frozen root (`.../snapshots/<id>/frozen/index-code`), OR
    - snapshot pointer roots
  - They MUST NOT silently resolve to local `repoRoot/index-code` unless asOf is `latest` and cached is missing (legacy fallback stays only for latest).

### 14.4.4 SQLite/LMDB base-root selection policy

- [ ] In `src/retrieval/cli.js`, when backend selection yields sqlite or lmdb:
  - Determine a **single** base root for sqlite/lmdb:
    - Prefer `code` root if requested; else prose; else first requested.
  - If multiple modes are requested and they map to different base roots:
    - If backend was explicitly forced via CLI: throw error with guidance (use `--backend memory` or use single-mode).
    - If backend is `auto`: fall back to memory backend.

- [ ] Resolve sqlite/lmdb paths using dict-utils with indexRoot override:
  - `resolveSqlitePaths(repoRoot, userConfig, { indexRoot: chosenBaseRoot })`
  - `resolveLmdbPaths(repoRoot, userConfig, { indexRoot: chosenBaseRoot })`

### 14.4.5 Query cache key + signature hardening

- [ ] Query cache key MUST include as-of identity:
  - Update `src/retrieval/cli-index.js#buildQueryCacheKey(payload)`:
    - Use `stableStringify(payload)` (not plain JSON.stringify) for determinism.
    - Ensure payload includes `asOf: { ref, identityHash }`.
  - Update `src/retrieval/cli/run-search-session.js`:
    - Include `asOf` in the payload object passed to buildQueryCacheKey.

- [ ] Index signature MUST reflect sharded chunk_meta:
  - Update `src/retrieval/cli-index.js#getIndexSignature(...)` implementation to call:
    - `src/retrieval/index-cache.js#buildIndexSignature(indexDir)` per involved mode.
  - Combine into one signature string with mode prefixes:
    - `code:<sig>|prose:<sig>|...`
  - (Optional but recommended) For sqlite backend, incorporate sqlite DB file signature to avoid stale cache when DB changes.

### 14.4.6 Tests / Verification

- [ ] Add `tests/retrieval/search-as-of.test.js` (integration):
  - [ ] Build index → create snapshot → freeze snapshot.
  - [ ] Modify repo → build again.
  - [ ] Search latest and search with `--as-of snap:<id>` and confirm:
    - No errors.
    - `stats.asOf.identityHash` differs.
  - [ ] Query cache partitioning:
    - Two identical searches with same as-of: second is cache hit.
    - Same query with different as-of: cache miss.
  - [ ] “No absolute path leak” for query cache metadata is optional; primary requirement is snapshot/diff registries.

---

## 14.5 Bin wrapper routing + strict allowlists (must be updated)

### Files touched
- `bin/pairofcleats.js`

### Tasks

- [ ] Add routing:
  - `pairofcleats index snapshot ...` → `tools/index-snapshot.js`
  - `pairofcleats index diff ...` → `tools/index-diff.js`

- [ ] Add allowlists for each command group.

- [ ] Update help text to include new commands and show `--as-of` under Search.

(Exact allowlist lists are in Appendix B.)

---

## 14.6 Optional: Config schema extensions for retention defaults

If implementing config-based retention defaults (recommended for long-term durability):

### Files touched
- `docs/config-schema.json`
- `tools/dict-utils.js` (`normalizeUserConfig`)
- snapshot/diff prune command code

### Tasks

- [ ] Extend `docs/config-schema.json` to include:

  ```json
  {
    "snapshots": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "keepFrozen": { "type": "number" },
        "keepPointer": { "type": "number" },
        "keepTags": { "type": "string" },
        "maxAgeDays": { "type": "number" },
        "freezeMethod": { "type": "string", "enum": ["hardlink","copy"] },
        "verifyOnFreeze": { "type": "boolean" }
      }
    },
    "diffs": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "keepLast": { "type": "number" },
        "maxAgeDays": { "type": "number" }
      }
    }
  }
  ```

- [ ] Update `normalizeUserConfig` to preserve these keys under `normalized.snapshots` and `normalized.diffs`.
- [ ] Ensure all CLI commands keep defaults in code so old configs remain valid.

---

## 14.7 Final acceptance gates

- [ ] All new tests pass:
  - `node tests/run.js --lane unit`
  - `node tests/run.js --tag indexing`
  - `node tests/run.js --tag retrieval`
- [ ] Manual smoke checks (fast):
  - Build sample repo indexes.
  - Create + freeze snapshot.
  - Search `--as-of snap:<id>`.
  - Diff `build:<id1>` → `build:<id2>`.
- [ ] Verify persisted registries contain no absolute paths (grep temp repo path):
  - `snapshots/manifest.json`
  - `snapshots/*/snapshot.json`
  - `snapshots/*/frozen.json`
  - `diffs/*/inputs.json`

---

# Appendix A — Command surfaces (canonical)

## A.1 Snapshot CLI

```bash
pairofcleats index snapshot create --repo <path> [--modes code,prose,...] [--id <snapshotId>] [--tag <tag> ...] [--label <text>] [--notes <text>] [--wait-ms <n>] [--json]
pairofcleats index snapshot freeze --repo <path> --snapshot <snapshotId> [--modes ...] [--method hardlink|copy] [--verify true|false] [--include-sqlite] [--include-lmdb] [--wait-ms <n>] [--json]
pairofcleats index snapshot list --repo <path> [--tag <tag>] [--json]
pairofcleats index snapshot show --repo <path> --snapshot <snapshotId> [--json]
pairofcleats index snapshot prune --repo <path> [--keep-frozen <n>] [--keep-pointer <n>] [--keep-tags <csv/glob>] [--max-age-days <n>] [--dry-run] [--json]
```

## A.2 Diff CLI

```bash
pairofcleats index diff compute --repo <path> --from <IndexRef> --to <IndexRef> [--modes code,...] [--max-changed-files <n>] [--max-chunks-per-file <n>] [--max-events <n>] [--include-relations true|false] [--detect-renames true|false] [--persist true|false] [--persist-unsafe] [--json] [--compact]
pairofcleats index diff show --repo <path> --diff <diffId> [--json]
pairofcleats index diff list --repo <path> [--mode <mode>|--modes <csv>] [--json]
pairofcleats index diff prune --repo <path> [policy] [--dry-run] [--json]
```

## A.3 Search as-of

```bash
pairofcleats search "<query>" --repo <path> [--mode code|prose|...] [--backend auto|sqlite|lmdb] [--as-of latest|build:<id>|snap:<id>|tag:<tag>|path:<path>] [--json]
```

---

# Appendix B — `bin/pairofcleats.js` strict flag allowlists (required)

> NOTE: The bin wrapper rejects unknown flags before yargs sees them. These allowlists MUST include all flags the tool scripts need.

## B.1 `search` allowlist (minimum for Phase 14)

- Allowed flags:
  - `repo`, `mode`, `top`, `json`, `explain`, `filter`, `backend`, `as-of`
- Value flags:
  - `repo`, `mode`, `top`, `filter`, `backend`, `as-of`

## B.2 `index snapshot` allowlist (Phase 14)

Suggested allowlist union across subcommands:
- Allowed flags:
  - `repo`, `snapshot`, `id`, `modes`, `tag`, `label`, `notes`, `method`, `verify`, `include-sqlite`, `include-lmdb`, `wait-ms`, `dry-run`, `keep-frozen`, `keep-pointer`, `keep-tags`, `max-age-days`, `json`
- Value flags:
  - `repo`, `snapshot`, `id`, `modes`, `tag`, `label`, `notes`, `method`, `verify`, `wait-ms`, `keep-frozen`, `keep-pointer`, `keep-tags`, `max-age-days`

## B.3 `index diff` allowlist (Phase 14)

Suggested allowlist union across subcommands:
- Allowed flags:
  - `repo`, `from`, `to`, `modes`, `mode`, `max-changed-files`, `max-chunks-per-file`, `max-events`, `include-relations`, `detect-renames`, `persist`, `persist-unsafe`, `diff`, `dry-run`, `json`, `compact`
- Value flags:
  - `repo`, `from`, `to`, `modes`, `mode`, `max-changed-files`, `max-chunks-per-file`, `max-events`, `include-relations`, `detect-renames`, `persist`, `diff`

---
# Phase 15 Codex Workplan — Workspaces, Federated Search, Compatibility, Federated Cache, Shared Cache GC/CAS

## Goals (Phase 15 deliverables)

1. **Workspace configuration** (`.pairofcleats-workspace.jsonc`) with deterministic `repoSetId` and strong validation.
2. **Workspace manifest** (`workspace_manifest.json`) that records per-repo state (build pointer, index signature hash, sqlite signatures, compatibility key) and produces a deterministic `manifestHash`.
3. **Federated search** (CLI + API + MCP) across a workspace (N repos) with:
   - deterministic selection, execution, merge, and output ordering
   - bounded concurrency
   - repo attribution on every hit
4. **Compatibility key** derived from each repo’s `index_state.json` to allow cohort selection and safe cross-repo federation.
5. **Federated query cache + correctness/perf bugfixes** (stable keys, proper invalidation, atomic writes, canonical repo cache keys).
6. **Shared cache taxonomy + GC + CAS** support (shared artifacts + federation directories covered by GC).

## Guiding principles (non-negotiable)

- **Determinism**: same inputs → same outputs (ordering + hashes), independent of FS traversal order.
- **Durability**: all on-disk cache writes are **atomic** and crash-safe.
- **Safety**: API server enforces the **repo-root allowlist** for *every* repo used in federated searches.
- **Performance**: bounded concurrency; avoid redundant work; signatures computed from **small meta files** when available.
- **Backward compatibility**: no breaking CLI defaults for single-repo mode; federation mode is explicitly enabled with `--workspace`.

## Canonical terms used in this plan

- **repoRoot**: the configured repo root (may be symlinked).
- **repoRootCanonical**: canonical filesystem identity used for dedupe + hashing:
  - `fs.realpathSync()` when possible
  - lowercased on Windows (`win32`) for case-insensitive semantics
- **repoRootForSearch**: the root path string used when invoking existing single-repo search code so it finds the correct cache roots. Normally equals `repoRootCanonical`; if caches were created under a non-canonical path, federation may select an existing cache root and use that root for search only (details below).
- **repoId**: existing `getRepoId()` identifier (remains unchanged).
- **repoSetId**: deterministic SHA-256 hash of the workspace’s resolved repo set.
- **manifestHash**: deterministic SHA-256 hash of the workspace manifest core fields and per-repo signatures.
- **compatibilityKey**: deterministic SHA-256 hash of the compatibility payload written to `index_state.json`.

---

## Phase 15.0 — Cross-cutting primitives (required before federation)

### 15.0.1 Add SHA-256 helper in shared hash utilities
**Files to modify**
- `src/shared/hash.js`

**Tasks**
- [ ] Add `sha256(input: string | Buffer): string` that returns hex digest.
  - Use Node `crypto.createHash('sha256')`.
  - Keep existing `sha1()` unchanged (don’t break callers).
- [ ] Add unit test to verify `sha256('abc')` matches known digest.

**Tests**
- `tests/shared-hash.js`
  - Assert `sha1('abc')` is unchanged.
  - Assert `sha256('abc') === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"`.

### 15.0.2 Add canonical path helper (shared between CLI/API/MCP/workspace)
**Files to create**
- `src/shared/path-canonical.js`

**Files to modify**
- `tools/api/router.js` (refactor to use shared helper)
- `tools/mcp/repo.js` (use shared helper)
- `tools/mcp/tools.js` (cache keying)
- federation + workspace modules (use shared helper)

**Normative behavior**
```js
export function canonicalizePath(p: string): string {
  // 1) path.resolve(p)
  // 2) try fs.realpathSync; if fails use resolved
  // 3) if win32: toLowerCase() on entire path
  // 4) return result
}
```

**Tasks**
- [ ] Implement `canonicalizePath()` and `canonicalizePathIfExists()` (no throw; returns resolved if missing).
- [ ] Implement `isWin32CaseInsensitive()` helper if needed.
- [ ] Refactor API router’s `normalizePath(toRealPath(...))` to call `canonicalizePath()` to avoid duplicated logic.
- [ ] Refactor MCP repo resolution and cache keying to use canonical path helper.

**Tests**
- `tests/path-canonical.js`
  - Should return absolute path.
  - If path doesn’t exist: returns resolved, does not throw.
  - On non-win32, does not lowercase.
  - On win32, lowercases (test should be conditional on `process.platform`).

### 15.0.3 Make all cache JSON writes atomic (single-repo + federated)
**Files to modify**
- `src/retrieval/cli/run-search-session.js` (single-repo query cache write)
- new federated cache writer (Phase 15.5)

**Normative behavior**
- Use `writeJsonObjectFile()` from `src/shared/json-stream.js` (already supports atomic temp write + rename).
- Never write JSON with raw `fs.writeFile()` for cache files.

**Tests**
- Covered in Phase 15.5 (query cache correctness).

---

## Phase 15.1 — Workspace configuration (repo sets, identity, selection metadata)

### 15.1.1 Spec (normative)

**File name**
- Default: `.pairofcleats-workspace.jsonc` (JSONC permitted)

**Schema**
- `version: 1`
- `name?: string`
- `cacheRoot?: string` (optional override; if missing, derive from first repo’s user config)
- `repos: RepoEntry[]` (min 1, max 256)

RepoEntry fields:
- `root: string` (required; absolute or relative to workspace file dir)
- `alias?: string` (optional; defaults to basename(root))
- `tags?: string[]` (optional; normalized to lowercase)
- `enabled?: boolean` (default true)
- `modes?: ("code"|"prose"|"extracted-prose"|"records")[]` (optional; default all)

**Normalization rules**
- Alias uniqueness is case-insensitive on all platforms.
- Tags are lowercased and deduped.
- Repo roots are resolved to:
  1. absolute path (workspace-dir relative resolution)
  2. canonical path (`repoRootCanonical = canonicalizePathIfExists(absRoot)`)
  3. **dedupe check**: `repoRootCanonical` must be unique

**repoSetId**
- `repoSetId = "rs1-" + sha256(stableStringify(sortedReposForHash))`
- `sortedReposForHash` is repos sorted by `repoRootCanonical` ascending.
- Each repo hashed as:
  - `{ root: repoRootCanonical, alias: aliasNorm, enabled: boolean, tags: tagsNorm, modes: modesNorm }`
- `aliasNorm = alias.trim()` (no case-folding in stored value; only for uniqueness checks)

### 15.1.2 Implementation: workspace loader + validator

**Files to create**
- `src/workspace/config.js`
- `docs/workspace-config-schema.json` (optional but recommended for humans; not used at runtime)

**Exports (exact signatures)**
```js
// src/workspace/config.js
export const WORKSPACE_CONFIG_VERSION = 1;

export function loadWorkspaceConfig(workspacePath, { fs = nodeFs } = {}): WorkspaceResolved;

export function computeRepoSetId(reposResolved): string;

export function validateWorkspaceConfig(rawConfig, workspacePath): { ok: true } | { ok: false, errors: WorkspaceConfigError[] };
```

**Resolved shape**
```ts
type WorkspaceResolved = {
  workspacePath: string;          // absolute
  workspaceDir: string;           // dirname(workspacePath)
  version: 1;
  name?: string;
  cacheRoot?: string;             // resolved absolute if provided
  repos: Array<{
    rootOriginal: string;
    rootAbsolute: string;
    repoRootCanonical: string;
    alias: string;
    tags: string[];
    enabled: boolean;
    modes: string[];              // normalized order: ["code","prose","extracted-prose","records"]
  }>;
  repoSetId: string;              // "rs1-..."
};
```

**Tasks**
- [ ] Implement JSONC parsing via `readJsoncFile()` (`src/shared/jsonc.js`).
- [ ] Enforce schema constraints and produce actionable error messages (include JSON pointer-like path, e.g., `repos[2].root`).
- [ ] Implement deterministic normalization (sort `modes` to canonical order; sort `tags` ascending).
- [ ] Implement alias defaulting to `path.basename(rootAbsolute)`.
- [ ] Implement repoSetId hashing.
- [ ] Create CLI commands:
  - `pairofcleats workspace validate --workspace <path>` (exit 0/1; prints errors)
  - `pairofcleats workspace print --workspace <path> [--json]` (prints resolved workspace; `repoSetId` included)

**Files to modify**
- `bin/pairofcleats.js`
  - add `workspace` command with subcommands `validate`, `print` (and later `manifest`, `build`)
- `tools/validate-config.js` (optional reuse patterns; no functional change required)

### 15.1.3 Tests

**Files to create**
- `tests/workspace-config.js`

**Test cases (must all be implemented)**
1. **Valid minimal workspace**: 1 repo, relative root, alias default, tags empty, enabled true, modes default all.
2. **Alias uniqueness**: `alias: "Repo"` and `alias: "repo"` must fail (case-insensitive).
3. **Duplicate roots**: two repos pointing to same directory (after canonicalization) must fail.
4. **Tags normalization**: input `["API","api","  Tools  "]` → stored `["api","tools"]`.
5. **Modes normalization**: unordered input must be normalized to canonical order.
6. **repoSetId determinism**: same config with repos listed in different order must produce identical `repoSetId`.
7. **Bad schema**: missing `repos`, non-array `repos`, invalid mode values → helpful errors.

---

## Phase 15.2 — Workspace manifest + cache catalog (durable per-repo state snapshot)

### 15.2.1 Spec (normative)

**Location**
- Default: `<cacheRoot>/federation/<repoSetId>/workspace_manifest.json`
- Override: `pairofcleats workspace manifest --out <path>`

**Manifest version**
- `manifestVersion: 1`

**Per-repo record includes**
- repo identity:
  - `repoId` (existing `getRepoId(repoRootCanonical)`)
  - `repoRootCanonical`
  - `alias`, `tags`, `enabled`, `modes`
- build pointer status:
  - `build.pointerPath` (absolute)
  - `build.buildId?`
  - `build.buildRoots?` (object of logical roots like `{ code: "builds/<id>/index-code", ... }`)
  - `build.pointerParseError?` (string; when JSON invalid)
- signatures:
  - `indexSignatureHash: "is1-" + sha1(buildIndexSignature(indexDir))` (per mode)
    - NOTE: uses existing `buildIndexSignature()` from `src/retrieval/index-cache.js` and hashes the *signature string* to a short stable hash.
  - `sqlite.dbs[mode].signature` (mtimeMs:size of db file; uses `fileSignature()` logic)
  - `compatibilityKey` (from `index_state.json` written at build time; Phase 15.4)

**manifestHash**
- `manifestHash = "wm1-" + sha256(stableStringify(coreForHash))`

Where `coreForHash` includes:
- `manifestVersion`
- `repoSetId`
- For each repo (sorted by `repoRootCanonical`):
  - `repoId`
  - `repoRootCanonical`
  - `build.buildId || null`
  - `build.buildRoots || null`
  - `modes`
  - `indexSignatureHash per mode` (missing → null)
  - `sqlite db signature per mode` (missing → null)
  - `compatibilityKey || null`

**Important choice (clarified)**
- `build.pointerPath` **and** `current.json mtime` are diagnostic only and **MUST NOT** be included in `manifestHash`. Including mtime would cause unnecessary cache invalidation when the pointer file is rewritten with identical content.

### 15.2.2 Implementation: manifest generator

**Files to create**
- `src/workspace/manifest.js`
- `tools/workspace-manifest.js` (CLI wrapper)
- `tools/workspace-catalog.js` (optional catalog CLI)

**Files to modify**
- `bin/pairofcleats.js` (add `workspace manifest` and `workspace catalog`)
- `tools/dict-utils.js` (add small helper(s) as needed; avoid breaking existing semantics)

**Exports (exact signatures)**
```js
// src/workspace/manifest.js
export const WORKSPACE_MANIFEST_VERSION = 1;

export async function buildWorkspaceManifest(workspaceResolved, { nowMs = Date.now() } = {}): Promise<WorkspaceManifest>;

export async function writeWorkspaceManifest(workspaceResolved, manifest, { outPath } = {}): Promise<{ outPath: string }>;

export async function loadWorkspaceManifest(manifestPath): Promise<WorkspaceManifest>;
```

**Implementation details**
- Determine `cacheRoot`:
  1. If `workspaceResolved.cacheRoot` present → use it (absolute).
  2. Else: load user config from first repo root and use `getCacheRoot(userConfig)` (existing helper).

- Determine federation root:
  - `federationRoot = path.join(cacheRoot, 'federation', workspaceResolved.repoSetId)`
  - Ensure directory exists (`mkdirp`).

- Build pointer resolution per repo:
  - repoCacheRoot must be derived consistently for that repo:
    - `userConfig = loadUserConfig(repoRootCanonical)`
    - `repoCacheRoot = getRepoCacheRoot(repoRootCanonical, userConfig)`
  - pointerPath = `${repoCacheRoot}/builds/current.json`
  - If file missing: `buildId=null`, `buildRoots=null`, and include `pointerMissing=true`.
  - If JSON invalid: `buildId=null`, `buildRoots=null`, `pointerParseError=err.message`.

- Index signature hash per mode:
  - For each `mode` in repo’s `modes`:
    - Determine indexDir from buildRoots if present:
      - Use existing `resolveIndexDir(mode, repoCacheRoot, userConfig)` but ensure it points at buildRoot when buildRoots exist.
      - If buildRoots absent, `resolveIndexDir` already falls back to repoCacheRoot indices.
    - If indexDir missing → signature null.
    - Else:
      - `sig = buildIndexSignature(indexDir)` (string)
      - `indexSignatureHash = "is1-" + sha1(sig)`

- SQLite signatures:
  - Use `resolveSqlitePaths(repoRootCanonical, userConfig)` from `tools/dict-utils.js`.
  - For each mode present:
    - `signature = fileSignature(dbPath)` semantics (mtimeMs:size; handle missing as null)
  - Important correction: existing DB naming in code is `index-code.db`, `index-prose.db`, `index-extracted-prose.db`, `index-records.db`. The manifest must report actual paths returned by `resolveSqlitePaths()` rather than inventing new filenames.

- Compatibility key:
  - Read `<indexDir>/index_state.json` for each mode if present.
  - Extract `compatibility.compatibilityKey` (Phase 15.4). If missing, store null.

### 15.2.3 Implementation: cache catalog scanner

**Purpose**
- Provide a view of all repo caches under a given cacheRoot (helps debug + operations).
- This is used by GC and can be used by federation for “known repos” debugging, but federation itself uses workspace config + per-repo resolution.

**Files to create**
- `src/workspace/catalog.js`

**Export**
```js
export async function scanCacheCatalog(cacheRoot): Promise<CacheCatalog>;
```

Catalog output includes:
- list of repos under `<cacheRoot>/repos/<repoId>/`
- for each: existence of builds/current.json, buildId, and known index dirs

### 15.2.4 Tests

**Files to create**
- `tests/workspace-manifest.js`

**Test cases**
1. **Happy path**: two repos, each with dummy current.json + dummy index dirs:
   - manifest includes both, correct `repoSetId`, correct deterministic ordering.
2. **Invalid current.json**: set current.json contents to `{` → manifest records `pointerParseError`, sets buildId/buildRoots null.
3. **Missing index dirs**: manifest signatures are null for those modes.
4. **Deterministic manifestHash**: same state with different repo order → identical manifestHash.
5. **SQLite file naming correctness**: create dummy `index-code.db` etc; ensure manifest points to those exact paths.
6. **Compatibility key extraction**: write index_state.json with `compatibilityKey`; ensure manifest captures it.

---

## Phase 15.3 — Federated search (CLI + API + MCP) with deterministic merge

### 15.3.1 Spec (normative)

**Federated CLI activation**
- `pairofcleats search --workspace <workspaceFile> [selection flags...] -- <query terms...>`
- `--repo` MUST be rejected if `--workspace` is provided.

**Selection**
- Default: all enabled repos.
- `--select alias1,alias2` selects by alias (case-insensitive match).
- `--tag foo` includes repos that have tag `foo`.
- `--include-disabled` allows selection of disabled repos.
- Selection is applied **before** compatibility cohorting.

**Execution**
- Bounded concurrency:
  - default `min(8, cpuCount)` (CLI), configurable via `--concurrency`
  - API: default 4 (safe)
- Per-repo search calls:
  - force `--json` and `--compact` to reduce payload and normalize parsing
  - `emitOutput: false`, `exitOnError: false`
- Per-repo failure semantics:
  - By default: **soft-fail** (collect error, continue) unless `--strict` set.
  - Return summary includes per-repo failures.

**Merge**
- Use rank-based fusion (**RRF**) across repos to avoid incompatible score scales.
- For each repo result list, compute ranks starting at 1.
- For each hit, RRF score contribution:
  - `rrfScore += 1 / (rrfK + rank)`
  - default `rrfK = 60`
- Combined score = sum contributions from all repos (only one repo contributes per hit because hits do not dedupe across repos by default).
- Sort final hits by:
  1. combinedRrfScore DESC
  2. repoAlias ASC
  3. file ASC
  4. startLine ASC
  5. chunkId ASC (if available)
- Return top `--top` results globally (default 10) after merge.

**Repo attribution**
- Every hit includes:
  - `repoId`
  - `repoAlias`
  - `repoRootCanonical` (optional in CLI; omitted in API unless `debugPaths` enabled)

### 15.3.2 Implementation: federation coordinator

**Files to create**
- `src/retrieval/federation/args.js`
- `src/retrieval/federation/select.js`
- `src/retrieval/federation/merge.js`
- `src/retrieval/federation/coordinator.js`
- `src/retrieval/federation/render.js` (human output mode)

**Coordinator API**
```js
export async function federatedSearch({
  workspacePath,
  rawArgs,              // argv slice for search after "search"
  queryTerms,           // array of strings after "--"
  transport,            // 'cli' | 'api' | 'mcp'
  signal,
}): Promise<FederatedSearchResult>;
```

**Implementation steps**
1. Load + resolve workspace (`loadWorkspaceConfig(workspacePath)`).
2. Build workspace manifest (`buildWorkspaceManifest(workspaceResolved)`).
   - (Phase 15.5 will add caching; for Phase 15.3 use direct build and write manifest for debugging.)
3. Apply selection flags (`--select`, `--tag`, `--include-disabled`).
4. Apply compatibility cohorting (Phase 15.4).
5. For each selected repo:
   - call `coreSearch(repoRootCanonical, { args: perRepoArgs, emitOutput:false, exitOnError:false, indexCache: sharedIndexCache, sqliteCache: sharedSqliteCache, signal })`
   - where `perRepoArgs` is original search args minus workspace/select flags, plus forced `--json --compact`
6. Extract per-repo hit lists from returned JSON payload:
   - include modes that the repo supports
   - flatten hits into one list tagged with mode
7. Merge across repos with RRF.
8. Return federated result object:
   - merged hits
   - per-repo summaries (counts, failures, durations)
   - manifestHash, repoSetId

### 15.3.3 CLI wiring

**Files to modify**
- `bin/pairofcleats.js`
- `search.js` (or replace with `search-workspace.js` dispatcher)

**Tasks**
- [ ] Add new flags to `pairofcleats search` allowlist to avoid “unknown flag” failures:
  - `workspace`, `select`, `tag`, `include-disabled`, `concurrency`, `strict`, `compat`
- [ ] Implement mutual exclusivity checks:
  - if `--workspace` AND `--repo` → error and exit 2.
- [ ] Route execution:
  - if `--workspace` present → call federated coordinator
  - else → existing single-repo search path remains unchanged
- [ ] Output:
  - If user passed `--json`: print federated JSON schema.
  - Else: print human-readable list, prefixing each hit with `[repoAlias]` and preserving per-hit formatting as close to existing as possible.

### 15.3.4 API wiring

**Files to modify**
- `tools/api/router.js`
- `tools/api-server.js` (only if needed for routing or docs)

**Tasks**
- [ ] Add endpoint `POST /search/federated`.
- [ ] Request schema:
  - `{ workspacePath, query, modes?, top?, select?, tag?, includeDisabled?, strict?, compat? }`
- [ ] Enforce allowlist:
  - After loading workspace config, for *each* repo root, call existing allowlist logic (`isAllowedRepoPath`) against the canonical root.
  - If any repo is outside allowlist: reject request with 403, and include which repo alias failed.
- [ ] Execution: call federated coordinator with `transport:'api'`.
- [ ] Response: federated JSON output (never returns raw absolute paths by default).

### 15.3.5 MCP wiring

**Files to modify**
- `src/integrations/mcp/defs.js` (add tool definition)
- `tools/mcp/tools.js` (add handler)
- `tools/mcp/repo.js` (fix resolveRepoPath; Phase 15.5 also touches)
- `tools/mcp-server.js` (no change unless tool registration differs)

**Tasks**
- [ ] Add tool `search_federated` with inputs:
  - `workspacePath` (string)
  - `query` (string)
  - optional: `select`, `tag`, `top`, `modes`, `compat`, `strict`
- [ ] Implement handler using federated coordinator.
- [ ] Ensure output is JSON and includes repo attribution.

### 15.3.6 Tests

**Files to create**
- `tests/federated-search-cli.js`
- `tests/federated-search-api.js`
- `tests/federated-search-mcp.js` (optional; minimal)

**CLI test cases**
1. Build two temporary repos with unique text:
   - repoA/fileA.txt contains `federation-unique-A`
   - repoB/fileB.txt contains `federation-unique-B`
2. Run `pairofcleats index` (or `node build_index.js`) for each repo with `--stub-embeddings`.
3. Create workspace config with aliases `A` and `B`.
4. Run `pairofcleats search --workspace <ws> --top 5 --json -- federation-unique-A`:
   - Assert result hits include `repoAlias === "A"` only.
5. Run query for `federation-unique` that appears in both:
   - Assert merged results include both aliases.
6. Determinism: run the same query twice and assert identical JSON output.

**API test cases**
- Start API server in-process on ephemeral port, send POST `/search/federated` for workspacePath.
- Assert allowlist enforcement by configuring allowed roots and including a disallowed repo in workspace.

---

## Phase 15.4 — Compatibility key + cohort selection (safe federation)

### 15.4.1 Spec (normative)

**Compatibility payload (written at index build time)**
- Written into each mode’s `index_state.json` under `compatibility`:

```jsonc
{
  "compatibility": {
    "compatibilityKeyVersion": 1,
    "compatibilityKey": "ck1-<sha256>",
    "nodeMajor": 20,
    "platform": "darwin",
    "arch": "arm64",
    "retrievalContractVersion": 1,
    "artifactSchemaHash": "<hash>",
    "embeddingIdentityKey": "<string>",
    "tokenizationKey": "<string>",
    "postingsConfigKey": "<string>"
  }
}
```

**compatibilityKey derivation**
- `compatibilityKey = "ck1-" + sha256(stableStringify(payloadForHash))`
- `payloadForHash` includes:
  - nodeMajor
  - platform
  - arch
  - retrievalContractVersion
  - artifactSchemaHash
  - embeddingIdentityKey
  - tokenizationKey
  - postingsConfigKey

**Cohort selection**
- In federated search, group repos by `compatibilityKey`.
- Choose the cohort to run:
  1. the cohort with the largest number of repos
  2. tie-breaker: choose lexicographically smallest compatibilityKey
- Default policy (`compat=warn`):
  - run only the chosen cohort
  - return warning listing excluded repos and their keys
- `compat=strict`: if multiple cohorts exist, fail the whole search.
- `compat=ignore`: run all repos regardless (unsafe; for debugging).

### 15.4.2 Implementation tasks

**Files to modify**
- `src/index/build/indexer/signatures.js` (tokenizationKey stability + regex flags)
- `src/index/build/indexer/steps/write.js` (write compatibility object into index_state.json)
- `src/retrieval/federation/coordinator.js` (apply cohort selection before execution)
- `src/workspace/manifest.js` (read compatibility key per repo/mode)

**Files to create**
- `src/compat/compatibility.js`

**Tasks**
- [ ] Implement `buildCompatibilityPayload(runtime, mode)` and `buildCompatibilityKey(payload)`.
- [ ] Update `buildTokenizationKey()`:
  - replace `JSON.stringify` with `stableStringify`
  - include comment regex flags (`{source, flags}`) not only `.source`
- [ ] Ensure `index_state.json` includes `compatibility` for every mode.
- [ ] Federated coordinator:
  - extract per-repo `compatibilityKey` from manifest (or from each mode’s index_state)
  - apply cohort selection per policy
  - include `compatibility` summary in output

### 15.4.3 Tests

**Files to create**
- `tests/compatibility-key.js`
- Extend `tests/federated-search-cli.js`

**Test cases**
1. Tokenization key stability: two regexes with same source but different flags must produce different tokenizationKey.
2. Compatibility key present in index_state.json after build.
3. Cohort selection:
   - Modify one repo’s index_state compatibilityKey to a different value.
   - With `compat=warn`: search runs only majority cohort; output warns and excludes minority repo.
   - With `compat=strict`: search fails with clear error listing cohorts.
   - With `compat=ignore`: search runs both repos.

---

## Phase 15.5 — Federated cache + correctness/perf bugfixes

This phase implements the **federated query cache** and fixes correctness bugs identified in Phase 15 planning and static sweep.

### 15.5.1 Federated query cache (workspace-level)

**Location**
- `<cacheRoot>/federation/<repoSetId>/queryCache.json`

**Keying**
- Use stableStringify + sha256 for cache key material.
- Include:
  - `manifestHash`
  - normalized query terms
  - effective selection set (aliases selected + tags + includeDisabled)
  - search knobs that change results (BM25 params, boosts, filters, modes, model/embedding identity, etc.)

**Durability**
- Writes are atomic via `writeJsonObjectFile()`.

**Files to create**
- `src/retrieval/federation/query-cache.js`

**Tasks**
- [ ] Implement `loadFederatedQueryCache()`, `saveFederatedQueryCache()`, `getFederatedCacheKey()`.
- [ ] Integrate into federated coordinator:
  - check cache before per-repo searches
  - store merged results after successful merge
  - prune to max entries (default 200) with LRU eviction stored in file

### 15.5.2 Fix single-repo query cache correctness + stability

**Bugs (confirmed in current code)**
- Query cache key uses raw `JSON.stringify(payload)` (object-order dependent) and misses several knobs.
- Query cache file is written non-atomically via `fs.writeFile`.

**Files to modify**
- `src/retrieval/cli/run-search-session.js`

**Tasks**
- [ ] Replace `JSON.stringify(payload)` with `stableStringify(payload)` for cache key computation.
- [ ] Add missing knobs into cache key payload:
  - `bm25K1`, `bm25B`
  - `symbolBoost` (if supported)
  - any config toggles already used in scoring paths (ensure parity with runtime)
- [ ] Replace `fs.writeFile(queryCachePath, ...)` with atomic `writeJsonObjectFile()`.

### 15.5.3 Fix index signature invalidation for sharded artifacts

**Bug (confirmed in current code)**
- `src/retrieval/cli-index.js` `getIndexSignature()` uses `chunk_meta.json` only and ignores `chunk_meta.meta.json` + `chunk_meta.parts/`, causing stale caches on sharded builds.

**Files to modify**
- `src/retrieval/cli-index.js`

**Tasks**
- [ ] Replace `fileSignature(.../chunk_meta.json)` with `jsonlArtifactSignature(indexDir, 'chunk_meta')` for all modes.
- [ ] Ensure `jsonlArtifactSignature` returns meta signature when meta exists, avoiding expensive per-shard stats.
- [ ] (Recommended) Include token postings meta signature to strengthen invalidation:
  - Add `tokenPostings: jsonlArtifactSignature(indexDir,'token_postings')` to signatures.

### 15.5.4 Fix API server repo cache keying + build pointer parse semantics

**Bugs (confirmed in current code)**
- `tools/api/router.js` caches are keyed by raw `repoPath` string (can vary by casing, symlinks).
- If `builds/current.json` is invalid JSON, server keeps stale buildId/caches.

**Files to modify**
- `tools/api/router.js`

**Tasks**
- [ ] Canonicalize repo cache keys:
  - change `getRepoCaches(repoPath)` key to `canonicalizePath(repoPath)`.
- [ ] In `refreshBuildPointer()`:
  - on JSON parse error: set `entry.buildId = null`, clear caches, set `entry.buildPointerMtimeMs = mtimeMs`, set `entry.buildPointerParseError = message`.
  - ensure subsequent successful parse repopulates.

### 15.5.5 Fix MCP repo path resolution + cache keying

**Bugs (confirmed in current code)**
- `tools/mcp/repo.js` returns base path when inputPath provided (doesn’t resolve repo root).
- MCP repoCaches keyed by raw string, can duplicate.

**Files to modify**
- `tools/mcp/repo.js`
- `tools/mcp/tools.js`

**Tasks**
- [ ] Always resolve to repo root: `resolveRepoPath` must return `resolveRepoRoot(base)` in all cases.
- [ ] Key caches by canonical path (shared helper).
- [ ] Ensure build pointer parse errors clear stale build IDs similarly to API behavior.

### 15.5.6 Tests

**Files to modify/create**
- Extend `tests/cache-gc.js` (see Phase 15.6)
- Create `tests/query-cache-stability.js`
- Create `tests/api-build-pointer-parse.js`
- Create `tests/mcp-repo-resolution.js`

**Test cases**
1. **Query cache stable key**:
   - run same query twice with same config → same cache key.
   - reorder object fields in config → still same cache key.
2. **Atomic write**:
   - after running search, read `queryCache.json`; must parse as valid JSON.
3. **Sharded chunk_meta invalidation**:
   - create indexDir with `chunk_meta.meta.json` and change its mtime; signature must change.
4. **API build pointer parse bug**:
   - write invalid current.json; call /search; ensure server reports no buildId and doesn’t reuse stale caches.
5. **MCP resolveRepoPath**:
   - pass a subdirectory path inside repo; ensure returned root equals repo root and caches match.

---

## Phase 15.6 — Shared cache taxonomy + cache-gc + CAS

This phase makes cache layout explicit and ensures GC covers new federation/shared directories.

### 15.6.1 Shared cache taxonomy

**Directories**
- `<cacheRoot>/repos/<repoId>/...` (existing per-repo cache roots)
- `<cacheRoot>/federation/<repoSetId>/...` (workspace-level caches: manifest, query cache, logs)
- `<cacheRoot>/shared/...` (shared artifacts, including CAS)

**Files to modify**
- `tools/cache-gc.js` (add federation/shared support)
- `tests/cache-gc.js` (extend coverage)

### 15.6.2 cache-gc enhancements

**Required behaviors**
- GC must handle:
  - `repos/` (existing)
  - `federation/` (new)
  - `shared/` (new)
- Implement safety:
  - do not delete unknown directories unless `--aggressive` is set
- Provide reporting:
  - JSON output summarizing freed bytes and deleted paths

**Tasks**
- [ ] Update `tools/cache-gc.js` to scan:
  - `cacheRoot/federation/*`
    - delete old federation query caches/manifests based on `--max-age-days` and `--keep`
  - `cacheRoot/shared/*`
    - delete tmp/orphan CAS files (Phase 15.6.3)
- [ ] Add CLI surface (optional but recommended):
  - `pairofcleats cache gc [--root <cacheRoot>] [--keep 10] [--max-age-days 30] [--json]`

### 15.6.3 CAS (content-addressed storage) — optional but planned in Phase 15

If implementing CAS now, follow the refined CAS spec (shared store keyed by SHA-256 of content, with ref tracking). If deferring CAS, still create placeholders so taxonomy + GC are correct.

**Minimal CAS v1**
- Store content at `<cacheRoot>/shared/cas/sha256/<first2>/<hash>`
- Provide helper:
  - `putCasBlob(buffer) -> { hash, path }`
  - `getCasBlob(hash) -> buffer`
- GC:
  - delete unreferenced blobs when older than `--max-age-days` (reference tracking is Phase 16+ if needed)

### 15.6.4 Tests

**Files to modify**
- `tests/cache-gc.js`

**Test cases**
1. GC deletes old federation directories when max-age exceeded.
2. GC preserves most-recent `--keep` federation directories.
3. GC does not touch `shared/` unknown directories without `--aggressive`.
4. (If CAS implemented) GC deletes old cas blobs not referenced.

---

## Implementation order (hard dependencies)

1. Phase 15.0 helpers (sha256 + canonical path helper + atomic write policy).
2. Phase 15.1 workspace config loader + CLI validate/print.
3. Phase 15.2 workspace manifest generator + catalog + tests.
4. Phase 15.4 compatibility key writing (index build) + cohort selection (federation).
5. Phase 15.3 federated search coordinator + CLI/API/MCP wiring + tests.
6. Phase 15.5 caching + bugfixes + tests.
7. Phase 15.6 cache taxonomy + cache-gc enhancements + tests.

---

## Acceptance criteria checklist (must be green)

- Workspace config validation catches all schema and normalization errors with actionable messages.
- repoSetId is deterministic across file order and FS enumeration.
- workspace_manifest.json generation is deterministic and produces stable manifestHash.
- Federated search:
  - stable ordering across runs
  - includes repo attribution per hit
  - bounded concurrency
  - works via CLI, API, MCP
- Compatibility cohorting:
  - warn/strict/ignore policies behave as specified
- Query cache:
  - stable keys (stableStringify)
  - correct invalidation on sharded chunk_meta
  - atomic writes (no corrupted JSON)
- cache-gc:
  - includes federation/shared taxonomy
  - passes updated tests

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

## Phase 17 — Vector-Only Index Profile (Embeddings-First)

### Objective

Introduce a first-class `vector_only` indexing profile for large documentation sets where sparse/token postings are not required, while preserving strict validation, deterministic retrieval behavior, and explicit operator-facing diagnostics.

This phase exits when:

- Vector-only builds are self-describing (profile recorded in `index_state.json` and discoverable via `pieces/manifest.json`).
- Strict validation passes for vector-only builds and does not require sparse artifacts that are explicitly omitted by profile.
- Retrieval can serve queries against vector-only builds without attempting to load sparse/token-postings artifacts, and emits explicit warnings for unsupported features.

---

### 17.1 Profile contract: required vs omitted artifacts (recorded, validated, discoverable)

- [ ] Define a single canonical profile key:
  - [ ] `indexing.profile` values: `full` (default) and `vector_only`.
  - [ ] Record the resolved profile in `index_state.json` as `profile: "full" | "vector_only"`.

- [ ] Specify the required artifact subset for `vector_only`:
  - [ ] Required (minimum):
    - [ ] `chunk_meta` (or `chunk_meta.jsonl` + meta) with stable `chunkUid`/`metaV2`.
    - [ ] `file_meta`.
    - [ ] Dense vector artifacts (exact names per current build outputs), including embedding identity (model id + dims).
    - [ ] `pieces/manifest.json` and `index_state.json`.
  - [ ] Optional (only when enabled by flags):
    - [ ] `repo_map` and graph artifacts (if analysis phases enabled in a non-default configuration).
    - [ ] risk artifacts (if explicitly enabled).
  - [ ] Explicitly omitted by default:
    - [ ] token postings (vocab + postings lists/shards)
    - [ ] phrase ngrams / chargram postings
    - [ ] any sparse-only dictionaries that are only consumed by token-postings retrieval

- [ ] Make omissions machine-readable:
  - [ ] Add a profile section in `index_state.json` describing omissions, e.g.:
    - [ ] `profile: "vector_only"`
    - [ ] `omits: ["token_postings", "phrase_ngrams", "chargram_postings", "field_postings"]`
  - [ ] Ensure consumers do not need directory scanning to infer omissions (manifest + state is authoritative).

Touchpoints:
- `src/index/build/indexer/steps/write.js` (index_state emission)
- `src/index/build/artifacts.js` (pieces manifest entries and artifact writer behavior)
- `src/index/validate.js` (strict validation profile rules)
- `docs/index-profiles.md` (new/updated)

#### Tests
- [ ] `tests/profile/vector-only-contract.test.js`
  - [ ] Build in `indexing.profile=vector_only`; assert `index_state.json.profile === "vector_only"` and `omits[]` is present and complete.
- [ ] `tests/validate/strict-honors-profile.test.js`
  - [ ] Strict validation passes for vector-only fixture and does not require omitted sparse artifacts.
- [ ] `tests/validate/strict-requires-dense-in-vector-only.test.js`
  - [ ] Strict validation fails (actionably) if a vector-only build is missing required dense artifacts.

---

### 17.2 Vector-only build path: skip sparse postings, enforce embeddings, preserve determinism

- [ ] Implement profile-to-runtime flag mapping:
  - [ ] Add a derived runtime flag such as `runtime.profile` and `runtime.postingsEnabled` (or `runtime.sparseEnabled`).
  - [ ] For `vector_only`:
    - [ ] disable postings generation and any sparse-specific artifact writes
    - [ ] disable expensive code-only analysis passes unless explicitly re-enabled (type inference, lint, risk) to keep vector-only fast and predictable

- [ ] Pipeline changes (mode-aware):
  - [ ] In `src/index/build/indexer/pipeline.js`:
    - [ ] Skip the postings stage entirely when `postingsEnabled === false`, or replace it with a minimal “dense-only” materialization stage.
  - [ ] In `src/index/build/indexer/steps/postings.js` / postings builder:
    - [ ] Ensure dense vectors can still be written without requiring token-postings structures.
    - [ ] Ensure token retention defaults cannot re-enable sparse behavior accidentally under `vector_only`.

- [ ] Enforce embeddings as required for vector-only:
  - [ ] If embeddings are disabled and `indexing.profile=vector_only`, fail closed with an actionable error.
  - [ ] If embeddings are produced asynchronously (embedding service):
    - [ ] Either block until vectors are materialized for vector-only builds, or
    - [ ] Mark the build as incomplete and prevent promotion (vector-only cannot be promoted without vectors).

- [ ] Artifact writer behavior:
  - [ ] Update `src/index/build/artifacts.js` to tolerate missing sparse postings objects under `vector_only`.
  - [ ] Ensure `pieces/manifest.json` does not list omitted artifacts and that any conditional artifacts have clear gating recorded in state.

Touchpoints:
- `src/index/build/indexer/pipeline.js`
- `src/index/build/indexer/steps/postings.js`
- `src/index/build/artifacts.js`
- `src/index/build/indexer/steps/write.js`
- Promotion barrier code paths (to ensure vector-only cannot promote without dense readiness)

#### Tests
- [ ] `tests/services/vector-only-profile.services.js`
  - [ ] Run a build with `indexing.profile=vector_only`; assert dense artifacts are present and sparse artifacts are absent by design.
- [ ] `tests/build/vector-only-requires-embeddings.test.js`
  - [ ] With embeddings disabled, vector-only build fails closed with a clear message and does not promote.
- [ ] `tests/build/vector-only-promotion-gated-by-dense-readiness.test.js`
  - [ ] When embeddings are pending, promotion does not occur for vector-only builds.

---

### 17.3 Vector-only retrieval path: no sparse loading, explicit unsupported-feature behavior

- [ ] Loader behavior:
  - [ ] Update retrieval loaders to check `index_state.json.profile` before loading artifacts.
  - [ ] In `vector_only`, never attempt to load:
    - [ ] token vocab/postings tables
    - [ ] phrase/chargram postings
    - [ ] sparse-only dictionaries
  - [ ] Ensure loaders do not crash when sparse artifacts are missing; absence is expected and validated.

- [ ] Query planning and ranking:
  - [ ] Use dense ranking as the primary signal for vector-only builds.
  - [ ] Allow metadata filters (file/path/lang) when they do not require sparse postings.
  - [ ] If a user requests a sparse-only feature (exact term scoring, postings-only explain fields, etc.), return a deterministic warning and degrade gracefully.

- [ ] Sweep-driven capability guards in helper boundaries (because vector-only omits tables):
  - [ ] Standardize missing-table behavior in SQLite helpers and caches:
    - [ ] missing FTS table returns provider-unavailable (not throw)
    - [ ] missing token vocab/postings returns null/unavailable (not throw)
  - [ ] Reduce per-request DB signature checks under high QPS:
    - [ ] If retrieval touches `src/retrieval/sqlite-cache.js`, cache stat/signature results with a short TTL or move checks to index-reload boundaries.

Touchpoints:
- `src/retrieval/index-cache.js`
- `src/retrieval/cli/index-loader.js`
- `src/retrieval/pipeline.js`
- `src/retrieval/sqlite-helpers.js` (capability guards)
- `src/retrieval/sqlite-cache.js` (if signature checks are optimized)

#### Tests
- [ ] `tests/retrieval/vector-only-search.test.js`
  - [ ] Run a query against a vector-only build; assert it returns results and does not attempt to load sparse artifacts (mock loaders where practical).
- [ ] `tests/retrieval/vector-only-unsupported-feature-warning.test.js`
  - [ ] Request a sparse-only option; assert a deterministic warning is emitted and the process does not crash.
- [ ] `tests/retrieval/helpers-missing-tables-do-not-throw.test.js`
  - [ ] Load a vector-only fixture missing FTS/postings tables; assert helper paths return “unavailable” rather than throwing.

---

### 17.4 Documentation and operator visibility

- [ ] Document the profile contract:
  - [ ] `docs/index-profiles.md` (new): profile values, required/omitted artifacts, intended use-cases, and limitations.
  - [ ] Update CLI help text to describe `indexing.profile` and its implications.
- [ ] Make profile and dense readiness visible:
  - [ ] Ensure `index_state.json` includes dense availability and model identity fields that retrieval can surface in `--explain`.

Touchpoints:
- `docs/index-profiles.md`
- CLI help sources (where configuration is surfaced)
- `src/index/build/indexer/steps/write.js` (index_state fields)

#### Tests
- [ ] `tests/docs/profile-contract-docs.test.js`
  - [ ] Lint-level test: ensure docs mention required keys and match the schema versioned in code.

---

# Phase 18 — Vector-Only Profile (Build + Search Without Sparse Postings)

### Objective
Deliver a **first-class `vector_only` index profile** that can build and serve search results **without sparse/token postings artifacts**, while remaining contract-valid (manifest + state) and operationally safe (fail closed when required vector artifacts are missing).

### 18.1 Define the `vector_only` profile contract (build/runtime + contract signaling)

- [ ] Introduce an explicit index profile setting and normalize it to a single internal identifier.
  - [ ] Add `indexing.profile` (or `indexing.indexProfile`) with allowed values: `default`, `vector_only`.
  - [ ] Normalize string inputs (`trim().toLowerCase()`); treat unknown values as `default` with a deterministic warning.
  - Files:
    - `src/index/build/runtime/runtime.js`
    - `docs/index-profiles.md` (or `docs/contracts/index-profiles.md` if a contracts folder exists)
- [ ] Make runtime assembly compute profile-driven capability decisions in exactly one place.
  - [ ] Add `runtime.profile = { id, schemaVersion }` and plumb it into the indexer pipeline.
  - [ ] For `vector_only`, force sparse-related knobs to “off by default” at the runtime layer:
    - `runtime.postingsConfig.enablePhraseNgrams = false`
    - `runtime.postingsConfig.enableChargrams = false`
    - `runtime.postingsConfig.fielded = false`
    - default token retention policy resolves to `none` (unless explicitly overridden for debugging)
  - [ ] Fix runtime shape drift: include `runtime.recordsDir` and `runtime.recordsConfig` in the returned runtime object (callers already assume these exist).
  - Files:
    - `src/index/build/runtime/runtime.js`
    - `src/index/build/indexer/steps/discover.js` (confirm the runtime fields it consumes)
    - `src/index/build/watch.js` (confirm watch logic uses the same runtime fields)
- [ ] Record the active profile and artifact availability into `index_state.json` using a stable, forward-compatible envelope.
  - [ ] Extend the emitted `index_state.json` to include:
    - `profile: { id: 'default'|'vector_only', schemaVersion: 1 }`
    - `artifacts: { sparse: { present, reason? }, vectors: { present, ready, mode, modelId, dims, quantization, reason? } }`
  - [ ] Ensure the above fields are emitted for every mode so retrieval can make deterministic decisions per mode.
  - Files:
    - `src/index/build/indexer/steps/write.js` (construct and pass `indexState`)
    - `src/index/build/artifacts.js` (ensure it persists the fields and does not overwrite them)
- [ ] Update strict validation so `vector_only` is “sparse-optional, vectors-required”.
  - [ ] In strict mode, if `index_state.profile.id === 'vector_only'`:
    - do **not** require sparse artifacts (`token_postings*`, `phrase_ngrams*`, `chargram_postings*`, `field_postings`, `field_tokens`, etc.)
    - do require vector artifacts appropriate to the configured dense-vector mode (merged/doc/code) and `chunk_meta`
    - if vectors are missing: fail with actionable remediation (rebuild with embeddings enabled / ensure embeddings finished)
  - Files:
    - `src/index/validate.js`
    - `src/index/validate/strict.js` (if split), or wherever strict validation is implemented

#### Tests / Verification

- [ ] `tests/validate/strict-honors-vector-only-profile.test.js`
  - Create a vector-only fixture (manifest + vectors + chunk_meta; no sparse artifacts) and assert strict validate passes.
- [ ] `tests/validate/strict-requires-vectors-for-vector-only.test.js`
  - Remove vectors from the fixture and assert strict validate fails with a clear “vectors required for vector_only” message.
- [ ] `tests/runtime/runtime-includes-records-config.test.js`
  - Instantiate build runtime and assert `recordsDir`/`recordsConfig` exist and are plumbed into discovery.

### 18.2 Build a vector-only index (skip sparse generation + harden embeddings)

- [ ] Make the indexing pipeline respect the profile and avoid sparse postings generation/retention.
  - [ ] When `runtime.profile.id === 'vector_only'`:
    - do not retain per-chunk token arrays (token retention resolves to `none`)
    - do not populate sparse state structures (token/phrase/chargram/field postings)
    - still produce dense vectors artifacts required for retrieval (`dense_vectors_*_uint8`)
  - Files:
    - `src/index/build/indexer/pipeline.js` (profile-driven stage behavior)
    - `src/index/build/indexer/steps/postings.js` (profile-driven postings/vectors build)
    - `src/index/build/state.js` (ensure `appendChunk()` respects token-retention none)
- [ ] Make token retention policy parsing consistent across build stages (single source of truth).
  - [ ] Use `src/index/build/artifacts/token-mode.js` normalization rules as the single source of truth.
  - [ ] Update `createTokenRetentionState()` to apply the same normalization (`trim().toLowerCase()` + thresholds + derived mode) and keep it in lockstep with artifact emission.
  - Files:
    - `src/index/build/indexer/steps/postings.js`
    - `src/index/build/artifacts/token-mode.js`
- [ ] Make artifact writing explicitly omit sparse artifacts for `vector_only` (no “empty but present” sparse outputs).
  - [ ] Gate emission (and manifest pieces) for:
    - `token_postings*`, `phrase_ngrams*`, `chargram_postings*`, `field_postings`, `field_tokens`
  - [ ] On incremental rebuild/reuse, remove stale sparse artifacts if the profile changed from `default` → `vector_only`.
  - Files:
    - `src/index/build/artifacts.js`
    - `src/index/build/artifacts/checksums.js` (manifest must reflect omissions deterministically)
- [ ] Harden embeddings generation paths that `vector_only` depends on.
  - [ ] Fix the embedding batcher so enqueues during an in-flight flush cannot strand queued work.
    - Replace boolean `flushing` with a single shared “flush promise” chain (or equivalent), guaranteeing follow-on flush scheduling.
  - [ ] Standardize the representation for “missing doc embedding” across writers/readers.
    - Pick a single on-disk marker (recommended: `[]` / zero-length array) and keep the in-memory representation consistent.
    - Ensure retrieval can distinguish “embeddings disabled” vs “doc embedding missing for this chunk” via global state flags.
  - [ ] Enforce `vector_only` prerequisites:
    - If embeddings are disabled (or cannot be produced), fail the build early with remediation.
    - If embeddings are produced asynchronously (service/queue), the emitted state must mark vectors as not-ready so retrieval can fail closed until completion.
  - Files:
    - `src/index/build/file-processor/embeddings.js`
    - `src/index/build/runtime/embeddings.js`
    - `src/index/build/indexer/steps/write.js` (state fields: enabled/ready/mode)
- [ ] Fix dense vector merge semantics to be numerically safe and behaviorally intuitive.
  - [ ] Ensure merged vectors never contain NaNs when component dims mismatch.
  - [ ] If only one component vector exists (code-only or doc-only), merged should be that vector (no magnitude-halving).
  - [ ] Define deterministic dims mismatch behavior (pad/truncate with an explicit warning, or hard-error in strict modes).
  - Files:
    - `src/shared/embedding-utils.js`

#### Tests / Verification

- [ ] `tests/services/vector-only-profile.test.js`
  - Build a vector-only fixture and assert:
    - `pieces/manifest.json` exists and is valid
    - dense vectors artifacts exist and are discoverable
    - no sparse postings artifacts are emitted (and not listed in the manifest)
- [ ] `tests/embeddings/embeddings-batcher-no-stranding.test.js`
  - Stub `embed()` to delay the first batch; enqueue additional texts during the flush; assert all promises resolve.
- [ ] `tests/embeddings/no-doc-representation-roundtrip.test.js`
  - Ensure writer → reader preserves the canonical “missing doc vector” representation.
- [ ] `tests/embeddings/merge-embedding-vectors-semantics.test.js`
  - Cover: mismatched dims, code-only, doc-only, and both-present cases (assert finite outputs and expected values).
- [ ] `tests/index/vector-only-profile-embeddings-disabled-is-error.test.js`
  - Build with `vector_only` + embeddings disabled; assert build fails with a clear remediation message.

### 18.3 Vector-only retrieval path (profile enforcement + provider selection)

- [ ] Enforce profile satisfiability at retrieval startup (fail fast, deterministic).
  - [ ] When `index_state.profile.id === 'vector_only'`:
    - require vectors to be present and `index_state.embeddings.ready !== false` / `pending !== true`
    - abort before query execution with actionable remediation if the above is not satisfied
  - Files:
    - `src/retrieval/cli-index.js` (file-backed loader)
    - `src/retrieval/cli/index-loader.js` (state warnings / readiness gates)
    - `src/retrieval/cli.js` (CLI error surface)
- [ ] Ensure SQLite helpers are capability-guarded for profiles that omit tables.
  - [ ] Add table-existence probes (cached per DB handle) and return controlled empty results (or “provider unavailable” errors) instead of throwing.
  - [ ] Guard reads for (at minimum): `chunks_fts`, `minhash_signatures`, `dense_meta`, `dense_vectors`.
  - Files:
    - `src/retrieval/sqlite-helpers.js`
- [ ] Make the search pipeline profile-aware: vector-only disables sparse scoring and token-based post-filtering.
  - [ ] Force sparse backends off (BM25/FTS/Tantivy) when profile is vector-only; ANN becomes the primary (and typically only) scorer.
  - [ ] Prevent token-dependent boolean enforcement from silently filtering out all results when tokens/postings are absent:
    - either disable enforcement with an explicit warning (in `--explain` / JSON output), or
    - hard-error when a token-dependent query feature is requested under `vector_only`
  - [ ] Fix export/definition heuristics to use the actual metadata shape (`metaV2`) when present (not `meta`).
  - Files:
    - `src/retrieval/pipeline.js`
    - `src/retrieval/cli/run-search-session.js` (backend selection)
    - `src/retrieval/output/explain.js` (surface profile/provider decisions)
    - `src/retrieval/output/format.js` (if warning fields are surfaced in output)

#### Tests / Verification

- [ ] `tests/search/vector-only-profile-uses-ann.test.js`
  - Load a vector-only fixture; assert the session selects an ANN provider and does not attempt sparse scoring.
- [ ] `tests/retrieval/vector-only-missing-vectors-fails-fast.test.js`
  - Delete vectors from a vector-only fixture; retrieval startup must fail with a clear remediation message.
- [ ] `tests/sqlite/sqlite-helpers-missing-tables-do-not-throw.test.js`
  - Open a DB missing FTS/token tables (or simulate); helpers must return controlled empty results / provider-unavailable errors.
- [ ] `tests/retrieval/is-exported-uses-metaV2.test.js`
  - Ensure export boosting / detection works when metadata is stored in `metaV2`.

---

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
      - Normalized timestamps/permissions where feasible (avoid “zip drift” across runs).
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
- [ ] Ensure the JS test harness recognizes “skipped” tests (if not already implemented earlier).
  - Touchpoints (only if Phase 0 did not already land this):
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

## Phase 14 — Documentation and Configuration Hardening

1. **Document security posture and safe defaults**
   - [ ] Document:
     - API server host binding risks (`--host 0.0.0.0`)
     - CORS policy and how to configure allowed origins
     - Auth token configuration (if implemented)
     - RepoPath allowlist behavior
   - [ ] Add a prominent note: indexing untrusted repos and symlinks policy.

2. **Add configuration schema coverage for new settings**
   - [ ] If adding config keys (CORS/auth/cache TTL), ensure they are:
     - Reflected in whatever config docs you maintain
     - Validated consistently (even if validation is lightweight)

---

## Phase 19 — LibUV threadpool utilization (explicit control + docs + tests)

**Objective:** Make libuv threadpool sizing an explicit, validated, and observable runtime control so PairOfCleats I/O concurrency scales predictably across platforms and workloads.

### 19.1 Audit: identify libuv-threadpool-bound hot paths and mismatch points

- [ ] Audit all high-volume async filesystem call sites (these ultimately depend on libuv threadpool behavior):
  - [ ] `src/index/build/file-processor.js` (notably `runIo(() => fs.stat(...))`, `runIo(() => fs.readFile(...))`)
  - [ ] `src/index/build/file-scan.js` (`fs.open`, `handle.read`)
  - [ ] `src/index/build/preprocess.js` (file sampling + `countLinesForEntries`)
  - [ ] `src/shared/file-stats.js` (stream-based reads for line counting)
- [ ] Audit concurrency derivation points where PairOfCleats may exceed practical libuv parallelism:
  - [ ] `src/shared/threads.js` (`ioConcurrency = ioBase * 4`, cap 32/64)
  - [ ] `src/index/build/runtime/workers.js` (`createRuntimeQueues` pending limits)
- [ ] Decide and record the intended precedence rules for threadpool sizing:
  - [ ] Whether PairOfCleats should **respect an already-set `UV_THREADPOOL_SIZE`** (recommended, matching existing `NODE_OPTIONS` behavior where flags aren’t overridden if already present).

### 19.2 Add a first-class runtime setting + env override

- [ ] Add config key (new):
  - [ ] `runtime.uvThreadpoolSize` (number; if unset/invalid => no override)
- [ ] Add env override (new):
  - [ ] `PAIROFCLEATS_UV_THREADPOOL_SIZE` (number; same parsing rules as other numeric env overrides)
- [ ] Implement parsing + precedence:
  - [ ] Update `src/shared/env.js`
    - [ ] Add `uvThreadpoolSize: parseNumber(env.PAIROFCLEATS_UV_THREADPOOL_SIZE)`
  - [ ] Update `tools/dict-utils.js`
    - [ ] Extend `getRuntimeConfig(repoRoot, userConfig)` to resolve `uvThreadpoolSize` with precedence:
      - `userConfig.runtime.uvThreadpoolSize` → else `envConfig.uvThreadpoolSize` → else `null`
    - [ ] Clamp/normalize: floor to integer; require `> 0`; else `null`
    - [ ] Update the function’s return shape and JSDoc:
      - from `{ maxOldSpaceMb, nodeOptions }`
      - to `{ maxOldSpaceMb, nodeOptions, uvThreadpoolSize }`

### 19.3 Propagate `UV_THREADPOOL_SIZE` early enough (launcher + spawned scripts)

- [ ] Update `bin/pairofcleats.js` (critical path)
  - [ ] In `runScript()`:
    - [ ] Resolve `runtimeConfig` as today.
    - [ ] Build child env as an object (don’t pass `process.env` by reference when you need to conditionally add keys).
    - [ ] If `runtimeConfig.uvThreadpoolSize` is set and `process.env.UV_THREADPOOL_SIZE` is not set, add:
      - [ ] `UV_THREADPOOL_SIZE = String(runtimeConfig.uvThreadpoolSize)`
    - [ ] (Optional) If `--verbose` or `PAIROFCLEATS_VERBOSE`, log a one-liner showing the chosen `UV_THREADPOOL_SIZE` for the child process.
- [ ] Update other scripts that spawn Node subcommands and already apply runtime Node options, so they also carry the threadpool sizing consistently:
  - [ ] `tools/setup.js` (`buildRuntimeEnv()`)
  - [ ] `tools/bootstrap.js` (`baseEnv`)
  - [ ] `tools/ci-build-artifacts.js` (`baseEnv`)
  - [ ] `tools/bench-language-repos.js` (repo child env)
  - [ ] `tests/bench.js` (bench child env when spawning search/build steps)
  - [ ] `tools/triage/context-pack.js`, `tools/triage/ingest.js` (where `resolveNodeOptions` is used)
  - Implementation pattern: wherever you currently do `{ ...process.env, NODE_OPTIONS: resolvedNodeOptions }`, also conditionally set `UV_THREADPOOL_SIZE` from `runtimeConfig.uvThreadpoolSize` if not already present.

> (Optional refactor, if you want to reduce repetition): add a helper in `tools/dict-utils.js` like `resolveRuntimeEnv(runtimeConfig, baseEnv)` and migrate the call sites above to use it.

### 19.4 Observability: surface “configured vs effective” values

- [ ] Update `tools/config-dump.js`
  - [ ] Include in `payload.derived.runtime`:
    - [ ] `uvThreadpoolSize` (configured value from `getRuntimeConfig`)
    - [ ] `effectiveUvThreadpoolSize` (from `process.env.UV_THREADPOOL_SIZE` or null/undefined if absent)
- [ ] Add runtime warnings in indexing startup when mismatch is likely:
  - [ ] Update `src/index/build/runtime/workers.js` (in `resolveThreadLimitsConfig`, verbose mode is already supported)
    - [ ] Compute `effectiveUv = Number(process.env.UV_THREADPOOL_SIZE) || null`
    - [ ] If `effectiveUv` is set and `ioConcurrency` is materially larger, emit a single warning suggesting alignment.
    - [ ] If `effectiveUv` is not set, consider a _non-fatal_ hint when `ioConcurrency` is high (e.g., `>= 16`) and `--verbose` is enabled.
- [ ] (Services) Emit one-time startup info in long-running modes:
  - [ ] `tools/api-server.js`
  - [ ] `tools/indexer-service.js`
  - [ ] `tools/mcp-server.js`
  - Log: effective `UV_THREADPOOL_SIZE`, and whether it was set by PairOfCleats runtime config or inherited from the environment.

### 19.5 Documentation updates

- [ ] Update env overrides doc:
  - [ ] `docs/env-overrides.md`
    - [ ] Add `PAIROFCLEATS_UV_THREADPOOL_SIZE`
    - [ ] Explicitly note: libuv threadpool size must be set **before the Node process starts**; PairOfCleats applies it by setting `UV_THREADPOOL_SIZE` in spawned child processes (via `bin/pairofcleats.js` and other tool launchers).
- [ ] Update config docs:
  - [ ] `docs/config-schema.json` add `runtime.uvThreadpoolSize`
  - [ ] `docs/config-inventory.md` add `runtime.uvThreadpoolSize (number)`
  - [ ] `docs/config-inventory.json` add entry for `runtime.uvThreadpoolSize`
- [ ] Update setup documentation:
  - [ ] `docs/setup.md` add a short “Performance tuning” note:
    - [ ] When indexing large repos or using higher `--threads`, consider setting `runtime.uvThreadpoolSize` (or `PAIROFCLEATS_UV_THREADPOOL_SIZE`) to avoid libuv threadpool becoming the limiting factor.
- [ ] (Optional) Add a benchmark note:
  - [ ] `docs/benchmarks.md` mention that benchmarking runs should control `UV_THREADPOOL_SIZE` for reproducibility.

### 19.6 Tests: schema validation + env propagation

- [ ] Update config validation tests:
  - [ ] `tests/config-validate.js` ensure `runtime.uvThreadpoolSize` is accepted by schema validation.
- [ ] Add a focused propagation test:
  - [ ] New: `tests/uv-threadpool-env.js`
    - [ ] Create a temp repo dir with a `.pairofcleats.json` that sets `runtime.uvThreadpoolSize`.
    - [ ] Run: `node bin/pairofcleats.js config dump --json --repo <temp>`
    - [ ] Assert:
      - `payload.derived.runtime.uvThreadpoolSize` matches the config
      - `payload.derived.runtime.effectiveUvThreadpoolSize` matches the propagated env (or check `process.env.UV_THREADPOOL_SIZE` if you expose it directly in the dump)
- [ ] Add a non-override semantics test (if that’s the decided rule):
  - [ ] New: `tests/uv-threadpool-no-override.js`
    - [ ] Set parent env `UV_THREADPOOL_SIZE=…`
    - [ ] Also set config `runtime.uvThreadpoolSize` to a different value
    - [ ] Assert child sees the parent value (i.e., wrapper respects existing env)

**Exit criteria**

- [ ] `runtime.uvThreadpoolSize` is in schema + inventory and validated by `tools/validate-config.js`.
- [ ] `pairofcleats …` launches propagate `UV_THREADPOOL_SIZE` to child processes when configured.
- [ ] Users can confirm configured/effective behavior via `pairofcleats config dump --json`.
- [ ] Docs clearly explain when and how the setting applies.

---

## Phase 20 — Threadpool-aware I/O scheduling guardrails

**Objective:** Reduce misconfiguration risk by aligning PairOfCleats internal I/O scheduling with the effective libuv threadpool size and preventing runaway pending I/O buildup.

### 20.1 Add a “threadpool-aware” cap option for I/O queue sizing

- [ ] Add config (optional, but recommended if you want safer defaults):
  - [ ] `indexing.ioConcurrencyCap` (number) **or** `runtime.ioConcurrencyCap` (number)
  - Choose the namespace based on your ownership map (`docs/config-inventory-notes.md` suggests runtime is `tools/dict-utils.js`, indexing is build runtime).
- [ ] Implement in:
  - [ ] `src/shared/threads.js` (preferred, because it’s the canonical concurrency resolver)
    - [ ] After computing `ioConcurrency`, apply:
      - `ioConcurrency = min(ioConcurrency, ioConcurrencyCap)` when configured
      - (Optional) `ioConcurrency = min(ioConcurrency, effectiveUvThreadpoolSize)` when a new boolean is enabled, e.g. `runtime.threadpoolAwareIo === true`
  - [ ] `src/index/build/runtime/workers.js`
    - [ ] Adjust `maxIoPending` to scale from the _final_ `ioConcurrency`, not the pre-cap value.

### 20.2 Split “filesystem I/O” from “process I/O” (optional, higher impact)

If profiling shows git/tool subprocess work is being unnecessarily throttled by a threadpool-aware cap:

- [ ] Update `src/shared/concurrency.js` to support two queues:
  - [ ] `fs` queue (bounded by threadpool sizing)
  - [ ] `proc` queue (bounded separately)
- [ ] Update call sites:
  - [ ] `src/index/build/file-processor.js`
    - [ ] Use `fsQueue` for `fs.stat`, `fs.readFile`, `fs.open`
    - [ ] Use `procQueue` for `getGitMetaForFile` (and any other spawn-heavy steps)
  - [ ] `src/index/build/runtime/workers.js` and `src/index/build/indexer/steps/process-files.js`
    - [ ] Wire new queues into runtime and shard runtime creation.

### 20.3 Tests + benchmarks

- [ ] Add tests that validate:
  - [ ] Caps are applied deterministically
  - [ ] Pending limits remain bounded
  - [ ] No deadlocks when both queues exist
- [ ] Update or add a micro-benchmark to show:
  - [ ] Throughput difference when `UV_THREADPOOL_SIZE` and internal `ioConcurrency` are aligned vs misaligned.

**Exit criteria**

- [ ] Internal I/O concurrency cannot silently exceed intended caps.
- [ ] No regression in incremental/watch mode stability.
- [ ] Benchmarks show either improved throughput or reduced memory/queue pressure (ideally both).

---

## Phase 23 — Index analysis features (metadata/risk/git/type-inference) — Review findings & remediation checklist

#### P0 — Must fix (correctness / crash / schema integrity)

- [ ] **Risk rules regex compilation is currently mis-wired.** `src/index/risk-rules.js` calls `createSafeRegex()` with an incorrect argument signature, so rule regex configuration (flags, limits) is not applied, and invalid patterns can throw and abort normalization.
  - Fix in: `src/index/risk-rules.js`
- [ ] **Risk analysis can crash indexing on long lines.** `src/index/risk.js` calls SafeRegex `test()` / `exec()` without guarding against SafeRegex input-length exceptions. One long line can throw and fail the whole analysis pass.
  - Fix in: `src/index/risk.js`
- [ ] **Metadata v2 drops inferred/tooling parameter types (schema data loss).** `src/index/metadata-v2.js` normalizes type maps assuming values are arrays; nested maps (e.g., `inferredTypes.params.<name>[]`) are silently discarded.
  - Fix in: `src/index/metadata-v2.js` + tests + schema/docs

#### P1 — Should fix (determinism, performance, docs, validation gaps)

- [ ] **`metaV2` validation is far too shallow and does not reflect the actual schema shape.** `src/index/validate.js` only validates a tiny subset of fields and does not traverse nested type maps.
- [ ] **Docs drift:** `docs/metadata-schema-v2.md` and `docs/risk-rules.md` do not fully match current code (field names, structures, and configuration).
- [ ] **Performance risks:** risk scanning does redundant passes and does not short-circuit meaningfully when capped; markdown parsing is duplicated (inline + fenced); tooling providers re-read files rather than reusing already-loaded text.

#### P2 — Nice to have (quality, maintainability, test depth)

- [ ] Improve signature parsing robustness for complex types (C-like, Python, Swift).
- [ ] Clarify and standardize naming conventions (chunk naming vs provider symbol naming, “generatedBy”, “embedded” semantics).
- [ ] Expand tests to cover surrogate pairs (emoji), CRLF offsets, and risk rules/config edge cases.

---

### A) Metadata v2: correctness, determinism, and validation

#### Dependency guidance (best choices)

- `ajv` — encode **metadata-schema-v2** as JSON Schema and validate `metaV2` as a hard gate in `tools/index-validate` (or equivalent).
- `semver` — version `metaV2.schemaVersion` independently and gate readers/writers.

#### A.1 `metaV2.types` loses nested inferred/tooling param types (P0)

##### Findings

- [ ] **Data loss bug:** `normalizeTypeMap()` assumes `raw[key]` is an array of entries. If `raw[key]` is an object map (e.g., `raw.params` where `raw.params.<paramName>` is an array), it is treated as non-array and dropped.
  - Evidence: `normalizeTypeMap()` (lines ~78–91) only normalizes `Array.isArray(entries)` shapes.
- [ ] **Downstream effect:** `splitToolingTypes()` is applied to `docmeta.inferredTypes`; because nested shapes are not handled, **tooling-derived param types will not appear in `metaV2.types.tooling.params`**, and inferred param types will be absent from `metaV2.types.inferred.params`.

##### Required remediation

- [ ] Update `normalizeTypeMap()` to support nested “param maps” (and any similar nested structures) rather than dropping them. A pragmatic approach:
  - [ ] If `entries` is an array → normalize as today.
  - [ ] If `entries` is an object → treat it as a nested map and normalize each subkey:
    - preserve the nested object shape in output (preferred), or
    - flatten with a predictable prefix strategy (only if schema explicitly adopts that).
- [ ] Update `splitToolingTypes()` so it correctly separates tooling vs non-tooling entries **inside nested maps** (e.g., `params.<name>[]`, `locals.<name>[]`).
- [ ] Update `tests/metadata-v2.js` to assert:
  - [ ] inferred param types survive into `metaV2.types.inferred.params.<paramName>[]`
  - [ ] tooling param types survive into `metaV2.types.tooling.params.<paramName>[]`
  - [ ] non-tooling inferred types do not leak into tooling bucket (and vice versa)

#### A.2 Declared types coverage is incomplete (P1)

##### Findings

- [ ] `buildDeclaredTypes()` currently only materializes:
  - param annotations via `docmeta.paramTypes`
  - return annotation via `docmeta.returnType`  
    It does **not** cover:
  - [ ] parameter defaults (`docmeta.paramDefaults`)
  - [ ] local types (`docmeta.localTypes`)
  - [ ] any other declared type sources the codebase may already emit

##### Required remediation

- [ ] Decide which “declared” facets are part of Metadata v2 contract and implement them consistently (and document them):
  - [ ] `declared.defaults` (if desired)
  - [ ] `declared.locals` (if desired)
- [ ] Update `docs/metadata-schema-v2.md` accordingly.
- [ ] Add tests in `tests/metadata-v2.js` for any newly included declared facets.

#### A.3 Determinism and stable ordering in `metaV2` (P1)

##### Findings

- [ ] Several arrays are produced via Set insertion order (e.g., `annotations`, `params`, `risk.tags`, `risk.categories`). While _often_ stable, they can drift if upstream traversal order changes.
- [ ] `metaV2` mixes optional `null` vs empty collections inconsistently across fields (some fields null, others empty arrays). This matters for artifact diffs and schema validation.

##### Required remediation

- [ ] Standardize ordering rules for arrays that are semantically sets:
  - [ ] Sort `annotations` (lexicographic) before emitting.
  - [ ] Sort `params` (lexicographic) before emitting.
  - [ ] Sort risk `tags`/`categories` (lexicographic) before emitting.
- [ ] Establish a consistent “empty means null” vs “empty means []” policy for v2 and enforce it in `buildMetaV2()` and schema/docs.

#### A.4 `generatedBy` and `embedded` semantics are unclear (P2)

##### Findings

- [ ] `generatedBy` currently uses `toolInfo?.version` only; if `tooling` already contains `tool` and `version`, this can be redundant and underspecified.
- [ ] `embedded` is emitted whenever `chunk.segment` exists, even when the segment is not embedded (parentSegmentId may be null). This makes the field name misleading.

##### Required remediation

- [ ] Decide and document the intended meaning:
  - [ ] Option A: `generatedBy = "<tool>@<version>"` and keep `tooling` for structured detail.
  - [ ] Option B: remove `generatedBy` and rely solely on `tooling`.
- [ ] Restrict `embedded` field to truly-embedded segments only **or** rename the field to something like `segmentContext` / `embedding`.

#### A.5 Validation gaps for Metadata v2 (P1)

##### Findings (in `src/index/validate.js`)

- [ ] `validateMetaV2()` (lines ~162–206) validates only:
  - `chunkId` presence
  - `file` presence
  - `risk.flows` has `source` and `sink`
  - type entries have `.type` for a shallow, array-only traversal  
    It does **not** validate:
  - [ ] `segment` object shape
  - [ ] range/start/end types and ordering invariants
  - [ ] `lang`, `ext`, `kind`, `name` constraints
  - [ ] nested types map shapes (params/locals)
  - [ ] `generatedBy`/`tooling` shape and required fields
  - [ ] cross-field invariants (e.g., range within segment, embedded context consistency)

##### Required remediation

- [ ] Establish **one canonical validator** for `metaV2` (preferably schema-based):
  - [ ] Add an explicit JSON Schema for v2 (in docs or tooling directory).
  - [ ] Validate `metaV2` against the schema in `validateIndexArtifacts()`.
- [ ] If schema-based validation is not yet possible, expand `validateMetaV2()` to:
  - [ ] traverse nested `params`/`locals` maps for type entries
  - [ ] validate `range` numbers, monotonicity, and non-negativity
  - [ ] validate the presence/type of stable core fields as defined in `docs/metadata-schema-v2.md`
- [ ] Add tests (or fixtures) that exercise validation failures for each major failure class.

#### A.6 Docs drift: `docs/metadata-schema-v2.md` vs implementation (P1)

##### Findings

- [ ] The schema doc should be reviewed line-by-line against current `buildMetaV2()` output:
  - field names
  - optionality
  - nesting of `types.*`
  - risk shapes and analysisStatus shape
  - relations link formats

##### Required remediation

- [ ] Update `docs/metadata-schema-v2.md` to reflect the actual emitted shape **or** update `buildMetaV2()` to match the doc (pick one, do not leave them divergent).
- [ ] Add a “schema change log” section so future modifications don’t silently drift.

---

### B) Risk rules and risk analysis

#### Dependency guidance (best choices)

- `re2`/RE2-based engine (already present via `re2js`) — keep for ReDoS safety, but ensure wrapper behavior cannot crash indexing.
- `ajv` — validate rule bundle format (ids, patterns, severities, categories, etc.) before compiling.

#### B.1 Risk regex compilation is broken (P0)

##### Affected file

- `src/index/risk-rules.js`

##### Findings

- [ ] **Incorrect call signature:** `compilePattern()` calls `createSafeRegex(pattern, flags, regexConfig)` but `createSafeRegex()` accepts `(pattern, config)` (per `src/shared/safe-regex.js`).  
      Consequences:
  - `regexConfig` is ignored entirely
  - the intended default flags (`i`) are not applied
  - any user-configured safe-regex limits are not applied
- [ ] **No error shielding:** `compilePattern()` does not catch regex compilation errors. An invalid pattern can throw and abort normalization.

##### Required remediation

- [ ] Fix `compilePattern()` to call `createSafeRegex(pattern, safeRegexConfig)` (or a merged config object).
- [ ] Wrap compilation in `try/catch` and return `null` on failure (or record a validation error) so rule bundles cannot crash indexing.
- [ ] Add tests that verify:
  - [ ] configured flags (e.g., `i`) actually take effect
  - [ ] invalid patterns do not crash normalization and are surfaced as actionable diagnostics
  - [ ] configured `maxInputLength` and other safety controls are honored

#### B.2 Risk analysis can crash on long inputs (P0)

##### Affected file

- `src/index/risk.js`

##### Findings

- [ ] `matchRuleOnLine()` calls SafeRegex `test()` and `exec()` without guarding against exceptions thrown by SafeRegex input validation (e.g., when line length exceeds `maxInputLength`).
  - This is a hard failure mode: one long line can abort analysis for the entire file (or build, depending on call site error handling).

##### Required remediation

- [ ] Ensure **risk analysis never throws** due to regex evaluation. Options:
  - [ ] Add `try/catch` around `rule.requires.test(...)`, `rule.excludes.test(...)`, and `pattern.exec(...)` to treat failures as “no match”.
  - [ ] Alternatively (or additionally), change the SafeRegex wrapper to return `false/null` instead of throwing for overlong input.
  - [ ] Add a deterministic “line too long” cap behavior:
    - skip risk evaluation for that line
    - optionally record `analysisStatus.exceeded` includes `maxLineLength` (or similar)

#### B.3 `scope` and cap semantics need tightening (P1)

##### Findings

- [ ] `scope === 'file'` currently evaluates only `lineIdx === 0` (first line). This is likely not the intended meaning of “file scope”.
- [ ] `maxMatchesPerFile` currently caps **number of matching lines**, not number of matches (variable name implies match-count cap).

##### Required remediation

- [ ] Define (in docs + code) what `scope: "file"` means:
  - [ ] “pattern evaluated against entire file text” (recommended), or
  - [ ] “pattern evaluated once per file via a representative subset”
- [ ] Implement `maxMatchesPerFile` as an actual match-count cap (or rename it to `maxMatchingLines`).
- [ ] Add tests for both behaviors.

#### B.4 Performance: redundant scanning and weak short-circuiting (P1)

##### Findings

- [ ] Risk analysis scans the same text repeatedly (sources, sinks, sanitizers are scanned in separate loops).
- [ ] When caps are exceeded (bytes/lines), flows are skipped, but line scanning for matches still proceeds across the entire file, which defeats the purpose of caps for large/minified files.

##### Required remediation

- [ ] Add an early-exit path when `maxBytes`/`maxLines` caps are exceeded:
  - either skip all analysis and return `analysisStatus: capped`
  - or scan only a bounded prefix/suffix and clearly mark that results are partial
- [ ] Consider a single-pass scanner per line that evaluates all rule categories in one traversal.
- [ ] Add a prefilter stage for candidate files/lines (cheap substring checks) before SafeRegex evaluation.

#### B.5 Actionability and determinism of outputs (P1)

##### Findings

- [ ] `dedupeMatches()` collapses evidence to one match per rule id (may not be sufficient for remediation).
- [ ] Time-based caps (`maxMs`) can introduce nondeterminism across machines/runs (what gets included depends on wall clock).

##### Required remediation

- [ ] Preserve up to N distinct match locations per rule (configurable) rather than only first hit.
- [ ] Prefer deterministic caps (maxBytes/maxLines/maxNodes/maxEdges) over time caps; if `maxMs` remains, ensure it cannot cause nondeterministic partial outputs without clearly indicating partiality.
- [ ] Sort emitted matches/flows deterministically (by line/col, rule id) before output.

#### B.6 Docs drift: `docs/risk-rules.md` vs implementation (P1)

##### Findings

- [ ] `docs/risk-rules.md` should be updated to reflect:
  - actual rule bundle fields supported (`requires`, `excludes`, `scope`, `maxMatchesPerLine`, `maxMatchesPerFile`, etc.)
  - actual emitted `risk.analysisStatus` shape (object vs string)
  - actual matching semantics (line-based vs file-based)

##### Required remediation

- [ ] Update the doc to match current behavior (or update code to match doc), then add tests that lock it in.

---

### C) Git signals (metadata + blame-derived authorship)

#### Dependency guidance (best choices)

- `simple-git` (already used) — ensure it’s called in a way that scales: batching where feasible, caching aggressively, and defaulting expensive paths off unless explicitly enabled.

#### C.1 Default blame behavior and cost control (P1)

##### Affected file

- `src/index/git.js`

##### Findings

- [ ] `blameEnabled` defaults to **true** (`options.blame !== false`). If a caller forgets to pass `blame:false`, indexing will run `git blame` per file (very expensive).
- [ ] `git log` + `git log --numstat` are executed per file; caching helps within a run but does not avoid the O(files) subprocess cost.

##### Required remediation

- [ ] Make blame opt-in by default:
  - [ ] change default to `options.blame === true`, **or**
  - [ ] ensure all call sites pass `blame:false` unless explicitly requested via config
- [ ] Consider adding a global “gitSignalsPolicy” (or reuse existing policy object) that centrally controls:
  - blame on/off
  - churn computation on/off
  - commit log depth
- [ ] Performance optimization options (choose based on ROI):
  - [ ] batch `git log` queries when indexing many files (e.g., per repo, not per file)
  - [ ] compute churn only when needed for ranking/filtering
  - [ ] support “recent churn only” explicitly in docs (currently it’s “last 10 commits”)

#### C.2 Minor correctness and maintainability issues (P2)

##### Findings

- [ ] Misleading JSDoc: `parseLineAuthors()` is documented as “Compute churn from git numstat output” (it parses blame authors, not churn). This can mislead future maintenance.

##### Required remediation

- [ ] Fix the JSDoc to match the function purpose and parameter type.

#### C.3 Tests improvements (P1)

##### Affected tests

- `tests/git-blame-range.js`
- `tests/git-meta.js`
- `tests/churn-filter.js`
- `tests/git-hooks.js`

##### Findings

- [ ] No tests assert “blame is off by default” (or the intended default policy).
- [ ] No tests cover rename-following semantics (`--follow`) or untracked files.
- [ ] Caching behavior is not validated (e.g., “git blame called once per file even if many chunks”).

##### Required remediation

- [ ] Add tests that explicitly validate the intended default blame policy.
- [ ] Add a caching-focused test that ensures repeated `getGitMeta()` calls for the same file do not spawn repeated git commands (can be validated via mocking or by instrumenting wrapper counts).
- [ ] Decide whether rename-following is required and add tests if so.

---

### D) Type inference (local + cross-file + tooling providers)

#### Dependency guidance (best choices)

- LSP-based providers (clangd/sourcekit/pyright) — keep optional and guarded; correctness should degrade gracefully.
- TypeScript compiler API — keep optional and isolated; add caching/incremental compilation for large repos.

#### D.1 Provider lifecycle and resilience (P1)

##### Findings

- [ ] `createLspClient().request()` can leave pending requests forever if a caller forgets to supply `timeoutMs` (pending map leak). Current provider code _usually_ supplies a timeout, but this is not enforced.
- [ ] Diagnostics timing: providers request symbols immediately after `didOpen` and then `didClose` quickly; some servers publish diagnostics asynchronously and may not emit before close, leading to inconsistent diagnostic capture.

##### Required remediation

- [ ] Enforce a default request timeout in `createLspClient.request()` if none is provided.
- [ ] For diagnostics collection, consider:
  - [ ] waiting a bounded time for initial diagnostics after `didOpen`, or
  - [ ] explicitly requesting diagnostics if server supports it (varies), or
  - [ ] documenting that diagnostics are “best effort” and may be incomplete

#### D.2 Unicode/offset correctness: add stronger guarantees (P1)

##### Findings

- [ ] `positions.js` JSDoc claims “1-based line/column”; column is actually treated as 0-based (correct for LSP), but the doc comment is misleading.
- [ ] Test coverage does not explicitly include surrogate pairs (emoji), which are the common failure mode when mixing code-point vs UTF-16 offsets.

##### Required remediation

- [ ] Fix the JSDoc to reflect actual behavior (LSP: 0-based character offsets; line converted to 1-based for internal helpers).
- [ ] Add tests with:
  - [ ] emoji in identifiers and/or strings before symbol definitions
  - [ ] CRLF line endings fixtures (if Windows compatibility is required)

#### D.3 Generic LSP provider chunk matching is weaker than clangd provider (P2)

##### Findings

- [ ] `findChunkForOffsets()` requires strict containment (symbol range must be within chunk range). clangd-provider uses overlap scoring, which is more robust.

##### Required remediation

- [ ] Update generic provider to use overlap scoring like clangd-provider to reduce missed matches.

#### D.4 TypeScript provider issues (P2/P1 depending on usage)

##### Findings

- [ ] `loadTypeScript()` resolve order includes keys that are not implemented (`global`) and duplicates (`cache` vs `tooling`).
- [ ] Parameter name extraction uses `getText()` which can produce non-identifiers for destructuring params (bad keys for `params` map).
- [ ] Naming convention risk: provider writes keys like `Class.method` which may not match chunk naming conventions; if mismatched, types will not attach.

##### Required remediation

- [ ] Fix the resolution order logic and document each lookup path purpose.
- [ ] Only record parameter names for identifiers; skip or normalize destructuring params.
- [ ] Validate chunk naming alignment (structural chunk naming vs provider symbol naming) and add a test for a class method mapping end-to-end.

#### D.5 Cross-file inference merge determinism and evidence (P2)

##### Findings

- [ ] `mergeTypeList()` dedupes by `type|source` but drops evidence differences; confidence merging strategy is simplistic.
- [ ] Output ordering is not explicitly sorted after merges.

##### Required remediation

- [ ] Decide how to treat evidence in merges (keep first, merge arrays, keep highest confidence).
- [ ] Sort merged type lists deterministically (confidence desc, type asc, source asc).

#### D.6 Signature parsing robustness (P2)

##### Findings

- [ ] Parsers are intentionally lightweight, but they will fail on common real-world signatures:
  - C++ templates, function pointers, references
  - Python `*args/**kwargs`, keyword-only params, nested generics
  - Swift closures and attributes

##### Required remediation

- [ ] Add test fixtures covering at least one “hard” signature per language.
- [ ] Consider using tooling hover text more consistently (already used as fallback in clangd-provider) or integrate a minimal parser that handles nested generics and defaults.

---

### E) Performance improvements to prioritize (cross-cutting)

#### E.1 Risk analysis hot path (P1)

- [ ] Single-pass line scan for sources/sinks/sanitizers.
- [ ] Early return on caps (maxBytes/maxLines) rather than scanning the whole file anyway.
- [ ] Cheap prefilter before SafeRegex evaluation.
- [ ] Avoid per-line SafeRegex exceptions.

#### E.2 Markdown segmentation duplication (P2)

- [ ] `segments.js` parses markdown twice (inline code spans + fenced blocks). Consider extracting both from one micromark event stream.

#### E.3 Tooling providers I/O duplication (P2)

- [ ] Providers re-read file text from disk; if indexing already has the content in memory, pass it through (where feasible) to reduce I/O.

---

### F) Refactoring goals (maintainability / policy centralization)

- [ ] Consolidate analysis feature toggles into a single `analysisPolicy` object that is passed to:
  - metadata v2 builder
  - risk analysis
  - git analysis
  - type inference (local + cross-file + tooling)
- [ ] Centralize schema versioning and validation:
  - one metadata v2 schema
  - one risk rule bundle schema
  - one place that validates both as part of artifact validation

---

### G) Tests: required additions and upgrades

#### Required test upgrades (P1/P0 where noted)

- [ ] **P0:** Add tests for metadata v2 nested inferred/tooling param types.
- [ ] **P0:** Add tests for risk rule compilation config correctness (flags honored, invalid patterns handled).
- [ ] **P0:** Add risk analysis “long line” test to ensure no crashes.
- [ ] **P1:** Add unicode offset tests that include surrogate pairs (emoji) for:
  - LSP position mapping
  - chunk start offsets around unicode
- [ ] **P1:** Add git caching/policy tests (default blame policy + no repeated subprocess calls where caching is intended).

---

## Phase 24 — MCP server: migrate from custom JSON-RPC plumbing to official MCP SDK (reduce maintenance)

### 24.1 Add MCP SDK and plan transport layering

- [ ] Add `@modelcontextprotocol/sdk` dependency
- [ ] Decide migration strategy:
  - [ ] **Option A (recommended):** keep `tools/mcp-server.js` as the entrypoint, but implement server via SDK and keep legacy behind a flag
  - [ ] Option B: replace legacy entirely (higher risk)

### 24.2 Implement SDK-based server

- [ ] Add `src/integrations/mcp/sdk-server.js` (or similar):
  - [ ] Register tools from `src/integrations/mcp/defs.js`
  - [ ] Dispatch calls to existing handlers in `tools/mcp/tools.js` (or migrate handlers into `src/` cleanly)
  - [ ] Preserve progress notifications semantics expected by `tests/mcp-server.js`:
    - [ ] `notifications/progress`
    - [ ] Include `{ tool: 'build_index', phase, message }` fields (match current tests)
- [ ] Update `tools/mcp-server.js`:
  - [ ] If `mcp.transport=legacy` or env forces legacy → use current transport
  - [ ] Else → use SDK transport

### 24.3 Remove or isolate legacy transport surface area

- [ ] Keep `tools/mcp/transport.js` for now, but:
  - [ ] Move to `tools/mcp/legacy/transport.js`
  - [ ] Update imports accordingly
  - [ ] Reduce churn risk while you validate parity

### 24.4 Tests

- [ ] Ensure these existing tests continue to pass without rewriting expectations unless protocol mandates it:
  - [ ] `tests/mcp-server.js`
  - [ ] `tests/mcp-robustness.js`
  - [ ] `tests/mcp-schema.js`
- [ ] Add `tests/mcp-transport-selector.js`:
  - [ ] Force `PAIROFCLEATS_MCP_TRANSPORT=legacy` and assert legacy path still works
  - [ ] Force `...=sdk` and assert SDK path works
- [ ] Add script-coverage action(s)

---

### 24.5 API/MCP contract formalization (from Unified Roadmap)

- [ ] Add minimal OpenAPI coverage for API server routes (focus on search/status/map)
- [ ] Add JSON Schemas for MCP tool responses (align with `src/integrations/mcp/defs.js`)
- [ ] Add conformance tests that assert CLI/API/MCP return semantically consistent results:
  - [ ] same query yields compatible results across CLI, API server, and MCP tools
  - [ ] canonical flows: search, status, map export

## Phase 32 — Embeddings native load failures (ERR_DLOPEN_FAILED)

- [ ] Investigate `ERR_DLOPEN_FAILED` from `build-embeddings` during build-index (Node v24); inspect crash log at `C:\Users\sneak\AppData\Local\PairOfCleats\repos\pairofcleats-codex-8c76cec86f7d\logs\index-crash.log`.
- [ ] Determine which native module fails to load (onnxruntime/onnxruntime-node/etc.) and verify binary compatibility with current Node/OS; capture a minimal repro and fix path.
- [x] Add a clear error message with module name + remediation hint (reinstall provider, switch provider alias, or disable embeddings) before exiting.
- [x] If load failure persists, implement a safe fallback behavior (skip embeddings with explicit warning) so build-index completes.

---

