# Phase 5 -- Metadata v2 + Effective Language Fidelity (Segments & VFS prerequisites)

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

## Status legend

- [x] Implemented and appears complete/correct based on code inspection and existing test coverage
- [@] In Progress, this work has been started
- [.] Work has been completed but has Not been tested
- [?] There is a correctness gap **or** there is missing/insufficient test proving behavior
- [ ] Not complete

## Why Phase 5 exists

These are the concrete issues that Phase 5 resolves:

1. **`metaV2.types.inferred.params` can be silently dropped**
   - `src/index/metadata-v2.js` uses `normalizeEntries(...)` which only normalizes array-valued type lists.
   - Cross-file inference produces `docmeta.inferredTypes.params` as an **object map `{ paramName: TypeEntry[] }`** (`src/index/type-inference-crossfile/apply.js`), so `metaV2` currently loses those entries during normalization.

2. **`metaV2` is serialized too early (stale after enrichment)**
   - `metaV2` is built in `src/index/build/file-processor/assemble.js` (and sometimes in cached-bundle repair code) but **cross-file inference runs later** in `src/index/build/indexer/steps/relations.js`.
   - Cross-file inference mutates `chunk.docmeta` (adds inferred types) and `chunk.codeRelations` (callLinks/usageLinks/callSummaries), so an assemble-time `metaV2` snapshot can be stale.

3. **Segment "effective language" is not persisted or respected in downstream analysis**
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

- `docs/specs/metadata-schema-v2.md` (Metadata v2 contract)
- `docs/contracts/analysis-schemas.md` (schema notes / compatibility rules)
- `docs/contracts/artifact-schemas.md` (artifact registry + required fields)
- `docs/contracts/chunking.md` (chunk identity + offset semantics)
- `docs/contracts/sqlite.md` (SQLite tables / versioning expectations)
- `docs/phases/phase-8/tooling-vfs-and-segment-routing.md` (forward compatibility)

If Phase 5 introduces new contract fields (container/effective identity), it MUST update the above specs (and any referenced registry schema in `src/contracts/schemas/*`) in the same change set.

---

# 5.1 MetaV2 type normalization: preserve inferred parameter maps and split tooling types correctly

## Goal

Ensure `metaV2.types.inferred.params` (and `tooling.params`) is **never silently dropped** and is **canonicalized** as an object map `{ paramName: TypeEntry[] }`.

## Planned changes

- [x] Fix inferred type normalization so param maps are preserved.
  - [x] Update `normalizeEntries(...)` in `src/index/metadata-v2.js` to support:
    - `TypeEntry[]` (array list)
    - `Record<string, TypeEntry[]>` (object map keyed by param/property name)
  - [x] Update `normalizeTypeMap(...)` to preserve nested maps rather than dropping them.
    - [x] Ensure empty maps/lists normalize to `null` (not `{}` / `[]`) to preserve existing output compactness.
    - [x] Add inline code comments describing the map/array shapes (prevents accidental reversion).
    - [x] Checklist: update any code paths that assume `types.*.params` is an array (search for `.params?.map` or `Array.isArray(params)`).

- [x] Fix tooling split for nested param maps.
    - [x] Update `splitToolingTypes(...)` to handle both shapes:
      - if `entries` is an array: current behavior (filter by `source === 'tooling'`)
      - if `entries` is an object map: split **per param key**, preserving `{ paramName: TypeEntry[] }`
    - [x] Ensure the `types` object remains schema-valid under `METADATA_V2_SCHEMA`.
    - [x] Preserve param key ordering (if we sort, document the rule explicitly).
    - [x] Checklist: verify split logic preserves param names for tooling + inferred buckets in both JSONL and SQLite retrieval.

- [x] Establish canonical producer shapes.
  - [x] For **params**, canonical shape is an object map `{ paramName: TypeEntry[] }` for **declared**, **inferred**, and **tooling** buckets.
    - [x] For **returns**, canonical shape remains `TypeEntry[]`.
    - [x] Update `docs/contracts/analysis-schemas.md` to match canonical shapes (params are maps; returns are arrays).
    - [x] Add a short rationale to `docs/specs/metadata-schema-v2.md` (params need names; returns do not) to prevent future drift.
    - [x] Add a short example snippet in docs showing the canonical params/returns shapes.
    - [x] Checklist: update any schema validators or JSON schema fragments that currently define params as arrays.

- [x] Add strict validation guardrails for drift (beyond what JSON schema can express).
  - [x] In build-time validation (or `src/index/validate/checks.js`), add checks:
    - `metaV2.types.*.params` must be `null` or an object whose values are arrays of entries with `type`.
    - no type entry may omit `type`.
  - [x] Validation should report which chunkIds violate the shape.

## Files

- `src/index/metadata-v2.js`
- `src/index/type-inference-crossfile/extract.js` (only if downstream assumptions need updates)
- `src/index/validate/checks.js` (or `src/contracts/schemas/analysis.js` if schema refined)
- `docs/specs/metadata-schema-v2.md`
- `docs/contracts/analysis-schemas.md`

## Tests

- [x] Extend `tests/metadata-v2.js` (or add targeted tests under `tests/contracts/`) to cover param maps:
  - Fixture docmeta includes `inferredTypes.params = { opts: [{type:'WidgetOpts', source:'tooling'}] }`.
  - Assert `metaV2.types.inferred.params.opts` exists and is a non-empty array.
- [x] Add `tests/metadata-v2-param-map-tooling-split.test.js`
  - `docmeta.inferredTypes.params` contains mixed `source: tooling` and non-tooling entries.
  - Assert `metaV2.types.tooling.params.<name>` contains only tooling entries and `metaV2.types.inferred.params.<name>` contains the rest.
- [x] Add `tests/validate/metav2-rejects-invalid-type-shapes.test.js`
  - Tamper `metaV2.types.inferred.params` into an array; strict validate must fail.

---

# 5.2 MetaV2 finalization: enforce enrichment-before-serialization ordering

## Goal

Guarantee that any enrichment that mutates `chunk.docmeta` or `chunk.codeRelations` happens **before** `metaV2` is serialized to:

- `chunk_meta` JSONL artifacts, and
- SQLite storage (when enabled).

## Planned changes

- [x] Make `metaV2` generation explicitly **post-enrichment**.
  - [x] Identify build steps that mutate chunks after assembly:
    - cross-file inference in `src/index/build/indexer/steps/relations.js`
    - any late structural/risk augmentation that modifies `chunk.docmeta` or `chunk.codeRelations`
  - [x] Introduce a `finalizeMetaV2(chunks, context)` step that:
    - recomputes `chunk.metaV2 = buildMetaV2({ chunk, docmeta: chunk.docmeta, toolInfo, analysisPolicy })`
    - reuses the chunk's effective/container identity fields (Phase 5.4)
    - is applied **once** after enrichment and before writing
  - [x] Place `finalizeMetaV2` either:
    - at the end of `steps/relations.js`, or
    - at the beginning of `steps/write.js` (preferred if other steps may mutate chunks later).
  - [x] Ensure `finalizeMetaV2` runs exactly once per chunk (avoid double-build drift).
  - [x] Ensure the `analysisPolicy` used for finalization matches the enrichment policy.
  - [x] Checklist: ensure both JSONL and SQLite write paths use finalized `metaV2`.

- [x] Remove stale-`metaV2` failure modes for cached bundles.
  - [x] Ensure cached-bundle reuse (`src/index/build/file-processor/cached-bundle.js`) cannot bypass finalization.
  - [x] If cached bundles rebuild `metaV2` during repair, finalization must still overwrite with the post-enrichment version.
  - [x] Add a debug-only warning when assemble-time metaV2 differs from final metaV2 (helps identify stale paths).
  - [x] Checklist: ensure cached-bundle repair paths never re-emit assemble-time `metaV2` to disk.

  - [x] Add optional equivalence checks (debug/strict mode).
    - [x] Add a helper that recomputes `metaV2` from the final chunk object and compares to the stored `chunk.metaV2`.
    - [x] In strict mode, mismatches should fail validation (or at least emit a high-severity issue).
    - [x] Ignore intentionally-ephemeral fields during equivalence (if any exist).
    - [x] Checklist: ensure equivalence checks run after any chunk mutations in later steps.

## Files

- `src/index/build/indexer/steps/relations.js`
- `src/index/build/indexer/steps/write.js`
- `src/index/build/file-processor/assemble.js` (ensure assemble-time `metaV2` is not treated as final)
- `src/index/build/file-processor/cached-bundle.js`
- `src/index/build/artifacts/writers/chunk-meta.js`
- `src/index/metadata-v2.js`

## Tests

- [x] `tests/indexer/metav2-finalization-after-inference.test.js`
  - Build a fixture with `typeInferenceCrossFile: true`.
  - Assert `metaV2.types.inferred.params` and/or `metaV2.relations.callLinks` reflect cross-file inference results.
- [x] `tests/file-processor/cached-bundle-does-not-emit-stale-metav2.test.js`
  - Force a cached-bundle reuse path.
  - Assert serialized `chunk_meta.metaV2` still includes post-inference enrichment.
- [x] (Optional) `tests/indexer/metav2-recompute-equivalence.test.js`
  - Sample a subset of chunks; recompute metaV2 from chunk state; assert deep equality.

---

# 5.3 SQLite parity: store full metaV2 and enforce chunk identity invariants

## Goal

Remove SQLite's lossy `metaV2` reconstruction by **storing the canonical `metaV2` JSON** per chunk, and enforce invariants:

- `chunk_id` is never `NULL`
- `metaV2.chunkId` and SQLite `chunk_id` match
- SQLite retrieval returns `metaV2` equivalent to JSONL (for required fields)

## Planned changes

- [x] Add canonical `metaV2_json` storage to SQLite.
  - [x] Update `src/storage/sqlite/schema.js`:
    - bump `SCHEMA_VERSION`
    - add `metaV2_json TEXT` to the `chunks` table
  - [x] Update `docs/sqlite/index-schema.md` with the new column and schema version bump.
  - [x] Update `docs/contracts/sqlite.md` to document `metaV2_json` storage/retrieval expectations and parity guarantees.
  - [x] Update SQLite build path (`src/storage/sqlite/build-helpers.js` and writers):
    - persist `metaV2_json = JSON.stringify(chunk.metaV2)` (when available)
    - keep `docmeta` and `codeRelations` columns unchanged for compatibility
  - [x] Update SQLite retrieval (`src/retrieval/sqlite-helpers.js`) to:
    - parse `metaV2_json` when present
    - fail closed when `metaV2_json` is absent (greenfield; no legacy fallback)
  - [x] Update `docs/contracts/artifact-schemas.md` to note SQLite stores canonical `metaV2_json` for parity with JSONL.
  - [x] Add/confirm any indexes for `chunks.metaV2_json` are not required (avoid unnecessary perf cost).
  - [x] Checklist: bump `SCHEMA_VERSION` and update `PRAGMA user_version` expectations in docs/tests.

  - [x] Enforce non-null stable chunk identity in SQLite.
  - [x] Update `buildChunkRow(...)` to compute `chunk_id` via `resolveChunkId(chunk)` (`src/index/chunk-id.js`) rather than only `chunk.metaV2.chunkId`.
  - [x] Ensure `resolveChunkId` always returns a stable id even when `metaV2` is gated off by analysis policy.
    - [x] Bump `compatibilityKey` inputs and document the hard break (chunkId derivation + SQLite schema change).
    - [x] Ensure `chunk_id` and `metaV2.chunkId` are aligned after finalization (no stale ids).
  - [x] Checklist: verify `chunk_id` is computed from `resolveChunkId` in every SQLite write path (including incremental updates).

- [x] Add parity guardrails.
  - [x] Define a required field set for `metaV2` parity checks (minimum):
    - `chunkId`, `file`, `range`, `lang`, `ext`
    - `types` (if present)
    - `relations` (if present)
    - `segment` (if present)
  - [x] Add a validator check (strict mode) that compares JSONL vs SQLite for a sample of chunk ids.
  - [x] Make the parity sample deterministic (fixed seed or first N chunk ids).
  - [x] Checklist: confirm parity comparison ignores expected optional differences (e.g., `extensions` blocks) if any exist.

## Files

- `src/storage/sqlite/schema.js`
- `src/storage/sqlite/build-helpers.js`
- `src/storage/sqlite/build.js` (and wherever inserts are executed, find them)
- `src/retrieval/sqlite-helpers.js`
- `src/index/chunk-id.js`
- `src/index/validate/checks.js`

## Tests

- [x] `tests/storage/sqlite/metav2-json-roundtrip.test.js`
  - Insert a row containing `metaV2_json`.
  - Retrieve and assert `metaV2` deep-equals the original.
- [x] `tests/storage/sqlite/chunk-id-non-null.test.js`
  - Ensure `buildChunkRow` emits `chunk_id` even if `chunk.metaV2` is null.
- [x] `tests/storage/sqlite/metav2-parity-with-jsonl.test.js`
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

- [x] Preserve TSX/JSX (and similar) language hints end-to-end.
  - [x] Ensure Markdown fence normalization does **not** collapse `tsx → typescript` or `jsx → javascript` at discovery time.
    - (`src/index/segments/config.js` already preserves unknown hints; keep it that way.)
  - [x] Ensure segment records preserve the raw hint as `segment.languageId`.
  - [x] Ensure fenced code blocks capture the full code value range (not just the final line).

- [x] Persist segment-derived effective extension.
  - [x] In `src/index/segments.js` `chunkSegments(...)`, persist:
    - `segment.ext` (or `segment.effectiveExt`) = `resolveSegmentExt(containerExt, segment)`
  - [x] Ensure the persisted value is included in chunk records handed to the file processor.
  - [x] Add `segmentUid` generation per Phase 8 identity spec (stable, deterministic).
    - [x] Persist `segmentUid` on segments and propagate to chunks.
    - [x] Document the `segmentUid` derivation in the identity contract spec and reference it from Phase 8 docs.
    - [x] Lock the derivation inputs in the spec (segment type + languageId + normalized segment text) to guarantee determinism.
  - [x] Checklist: ensure `segmentUid` is propagated to chunk objects before any metaV2 build/finalization.

### 5.4.2 File processor: run analysis/tokenization using effective ext + language handler per chunk

- [x] Resolve effective language per chunk.
  - [x] Add a helper in `src/index/build/file-processor/process-chunks.js` to compute:
    - `containerExt` (from file path)
    - `containerLanguageId` (from `getLanguageForFile(...)` result)
    - `segmentLanguageId` (raw hint)
    - `effectiveExt` (segment.ext if present; else containerExt)
    - `effectiveLanguage` (via `getLanguageForFile({ ext: effectiveExt, relPath })`)
  - [x] Use `effectiveExt` for:
    - `tokenizeChunkText({ ext: effectiveExt, ... })`
    - `buildTokenSequence({ ext: effectiveExt, ... })`
  - [x] Use the effective language handler for:
    - `extractDocMeta`
    - `buildChunkRelations`
    - `flow` parsing
  - [x] Pass `effectiveLanguageId` into:
    - `inferTypeMetadata`
    - `detectRiskSignals`
  - [x] Include both container + effective identifiers in diagnostics/log lines for easier triage.
  - [x] Checklist: ensure tree-sitter selection and language registry paths consume `effectiveExt` consistently.

- [x] Ensure tree-sitter selection uses effective ext, not container ext.
  - [x] `language-registry` already selects TSX grammar when `ext === '.tsx'`; ensure effective ext is propagated to where tree-sitter language id selection happens.

### 5.4.3 MetaV2: encode container vs effective identity (contract change)

- [x] Update `src/index/metadata-v2.js` to emit:
  - `metaV2.container = { ext: <containerExt>, languageId: <containerLanguageId> }`
  - `metaV2.effective = { ext: <effectiveExt>, languageId: <effectiveLanguageId> }`
  - `metaV2.lang = effectiveLanguageId` (top-level legacy field semantics updated)
  - `metaV2.ext = containerExt` (top-level legacy field remains container ext)
- [x] Expand `metaV2.segment` to include fields needed for Phase 6/8:
  - `start`, `end`, `startLine`, `endLine` (container coordinates)
  - `embeddingContext` (required when the segment is embedded; null when not embedded)
  - keep `segmentId`, `segmentUid`, `type`, `languageId`, `parentSegmentId`
  - [x] Align `segment.embeddingContext` semantics with Phase 8 expectations in `docs/specs/metadata-schema-v2.md` (explicit required/optional rules).
  - [x] Document which fields are required vs optional for non-segmented files (so consumers can rely on nullability).
  - [x] Checklist: update any JSON schema definitions that enumerate `segment` fields.

### 5.4.4 Chunk ID stability (identity hardening)

This is a prerequisite for correct caching, SQLite identity, and future graph joins.

- [x] Make `chunkId` stable-by-location (do not depend on `kind`/`name`).
  - [x] Update `src/index/chunk-id.js` `buildChunkId(...)` to hash only:
    - `file` (normalized rel path)
    - `segmentId` (or `''` if none)
    - `start`, `end` (container offsets)
  - [x] Keep `kind`/`name` as debug attributes, not identity inputs.
    - [x] Add deterministic `spanIndex` when multiple chunks share identical `{segmentId,start,end}` (stable sort by `kind`/`name`/original order).
  - [x] Update `compatibilityKey` inputs for chunk identity changes (greenfield hard break).
    - [x] Checklist: ensure any caches keyed by `chunkId` are invalidated (or versioned) after the change.
- [x] Update docs to match reality:
  - `docs/contracts/chunking.md`
  - `docs/specs/metadata-schema-v2.md`
  - [x] Make the stability guarantee explicit and consistent (chunkId stable-by-location; no `kind`/`name` inputs).

> Note: collision-safe *symbol* identity and cross-file linking keys remain a Phase 9 deliverable. Phase 5 only ensures chunk span identity is stable and segment-aware.

## Files

- `src/index/segments.js`
- `src/index/segments/config.js`
- `src/index/build/file-processor/process-chunks.js`
- `src/index/language-registry/registry.js` (only if new resolver helper needed)
  - `src/index/metadata-v2.js`
  - `src/index/chunk-id.js`
  - `src/index/build/file-processor/assemble.js`
  - `docs/specs/metadata-schema-v2.md`
- `docs/contracts/chunking.md`

## Tests

- [x] `tests/segments/tsx-jsx-hint-preserved.test.js`
  - Markdown fixture containing ` ```tsx ` and ` ```jsx ` fences.
  - Assert `chunk.segment.languageId` preserves `tsx` / `jsx` (raw hints).
- [x] `tests/segments/effective-identity-md-fence.test.js`
  - `.md` file with a `tsx` fence.
  - Assert:
    - `metaV2.container.ext === '.md'`
    - `metaV2.effective.ext === '.tsx'`
    - `metaV2.lang === 'typescript'`
- [x] `tests/segments/segment-uid-derived.test.js`
  - `.md` file with a `ts` fence.
  - Assert `segmentUid` is derived and deterministic.
- [x] `tests/file-processor/effective-language-drives-docmeta.test.js`
  - Fixture with embedded TS fence defining a function.
  - Assert the chunk extracted from the fence has a non-null `signature` as produced by the TS handler (not markdown).
- [x] `tests/chunk-id/stable-id-does-not-depend-on-name-or-kind.test.js`
  - Build two chunk-like objects identical in `{file, segmentId, start, end}` but differing `name/kind`.
  - Assert `buildChunkId(...)` returns the same value for both.

---

# 5.5 Retrieval filtering and filter-index upgrades: filter by effective language (not container ext)

## Goal

Make `--lang` filters (and any future language predicates) operate on **effective language id** so embedded TS/TSX can be found inside `.md`, `.vue`, etc.

## Planned changes

  - [x] Extend filter-index with `byLang` (effective language id).
    - [x] Update `src/retrieval/filter-index.js`:
      - compute `effectiveLang = chunk.metaV2?.lang || chunk.metaV2?.effective?.languageId || null`
      - add `byLang: Map<languageId, Set<chunkNumericId>>`
    - [x] Keep existing `byExt` semantics as **container ext**.
    - [x] Fail build/validation when `effectiveLang` is missing (greenfield requirement).
    - [x] Checklist: update any downstream code paths that assume `byExt` is the only language predicate.

  - [x] Update language filter parsing to target `byLang`.
    - [x] In `src/retrieval/filters.js`:
      - replace extension-list semantics for `--lang` with a list of language ids
      - allow common aliases (`ts` → `typescript`, `js` → `javascript`, etc.)
    - [x] If `byLang` is missing, fail validation (greenfield; no extension fallback).
    - [x] Update `docs/contracts/search-cli.md`:
      - document `--lang` as effective language id (not extension)
      - list supported aliases and failure behavior when `byLang` is missing
      - add examples for embedded TS in Markdown/Vue.
    - [x] Update CLI help text for `--lang` to mention effective language ids and aliases.
    - [x] Checklist: update any tests that assert `--lang` by extension (rename to language id).

  - [x] Output improvements (debuggable provenance).
    - [x] Ensure retrieval outputs can surface:
      - container path + ext
      - effective language id + effective ext
      - segmentId and range when present
    - [x] Include `segmentUid` in debug output when present (supports Phase 8 joins).
    - [x] Checklist: ensure JSON output shape remains stable (additive fields only).

## Files

- `src/retrieval/filter-index.js`
- `src/retrieval/filters.js`
- `src/retrieval/search.js` (if filter plumbing requires)
- `docs/contracts/search-cli.md` (if `--lang` semantics are documented)

## Tests

- [x] `tests/retrieval/lang-filter-matches-embedded-segments.test.js`
    - Fixture with `.md` TS fence.
    - Query with `--lang typescript` and assert embedded chunks are returned.
- [x] `tests/retrieval/filter-index-bylang.test.js`
    - Build filter index and assert `byLang.typescript` includes embedded chunk ids.
- [x] `tests/validate/filter-index-requires-bylang-when-segment-aware.test.js`
    - Strict validate fails if segment-aware metadata is present but `byLang` missing (opt-in rule).

---

# 5.6 VFS + segment manifest prerequisites (Phase 8 alignment)

## Goal

Phase 5 does **not** implement full VFS provider routing, but it must ensure that the metadata and contracts needed by Phase 8 exist and are stable.

## Planned changes

  - [x] Ensure `metaV2` contains all fields required to build a VFS manifest without re-parsing container files:
  - container path + container ext/lang
  - segmentId, segmentUid, segment type, segment range (start/end, startLine/endLine)
  - effective ext/lang
  - chunkId (stable)
    - [x] Ensure `segmentUid` stability is explicitly documented for unchanged container text.
    - [x] Checklist: include `segmentUid` and effective identity in any future `vfs_manifest.jsonl` sample entries.
  - [x] Add/Update a VFS manifest spec in `docs/` (if not already present):
  - `docs/specs/vfs-manifest-artifact.md` (v1)
  - It should define `vfs_manifest.jsonl` entries mapping `virtualPath → source` and include hashes for cacheability.
  - [x] Defer actual emission of `vfs_manifest.jsonl` and VFS materialization to Phase 8 unless Phase 6/7 needs it earlier.
    - [x] Add a short note about which Phase 8 fields depend on Phase 5 outputs (segmentUid + effective identity).
    - [x] Checklist: ensure Phase 8 references the finalized field names (`container`, `effective`, `segmentUid`).

## Files

  - `docs/phases/phase-8/tooling-vfs-and-segment-routing.md`
  - `docs/specs/vfs-manifest-artifact.md` (new/updated if missing)
  - `docs/specs/metadata-schema-v2.md`

## Tests (optional / Phase 8 if deferred)

- [ ] `tests/vfs/virtual-path-stability.test.js` (Phase 8)
- [ ] `tests/vfs/vfs-manifest-roundtrip.test.js` (Phase 8)

---

## Phase 5 exit criteria (definition of done)

Phase 5 is complete when:

- [x] `metaV2.types.inferred.params` is preserved (no silent drops) and tooling splitting works for nested maps.
- [x] `metaV2` is recomputed/finalized after cross-file enrichment and before artifact/SQLite writes.
- [x] SQLite stores full `metaV2` per chunk and retrieval returns it (no minimal stub for new DBs).
- [x] Every chunk has explicit container vs effective identity, and analysis/tokenization uses effective identity.
- [x] `chunkId` is stable-by-location (independent of `kind`/`name`) and `chunk_id` is never null in SQLite.
- [x] Retrieval supports `--lang` filtering on effective language id via `byLang`.
- [x] `compatibilityKey` bumped and documented for chunkId derivation + SQLite schema changes.

---

## Notes on Phase 6 / Phase 8 expectations

- Phase 6 callsite artifacts may compute offsets on segment slices; Phase 5 MUST ensure segment start/end and effective language identity are present so Phase 6 can translate offsets back to container coordinates without re-parsing containers.
- Phase 8 tooling providers require a deterministic mapping from segments to virtual paths; Phase 5 MUST preserve enough metadata (segment ranges + effective ext/lang + stable ids) to generate `vfs_manifest.jsonl` deterministically.

---

## Plan quality: what I would do differently (and why)

- Prefer **hard contract truth** over "best-effort" legacy behavior:
  - If `docs/contracts/chunking.md` states `chunkId` is stable, Phase 5 should make it *actually stable* (remove `kind/name` inputs) rather than tolerating churn.
- Keep **container vs effective identity** explicit and redundant:
  - Store container identity in `metaV2.container` and keep `metaV2.ext` as the container ext for compatibility.
  - Store effective identity in `metaV2.effective` and make `metaV2.lang` match effective language id.
  - This redundancy reduces migration risk and keeps existing readers functioning.
- Treat ambiguous symbol linking as unsafe:
  - If Phase 5 makes segments "more analyzable", it will increase same-file name collisions. Even if Phase 9 owns the full identity solution, Phase 5 should add validation warnings (at minimum) when cross-file inference sees ambiguous keys, to avoid silently linking wrong targets.

---

#

