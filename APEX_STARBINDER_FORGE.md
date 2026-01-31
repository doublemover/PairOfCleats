# Plan

We will deliver Phase 9 end-to-end: confirm identity primitives are correct and fail-closed, implement symbol identity and SymbolRef resolution, migrate cross-file links and graph/map joins to chunkUid, emit symbol artifacts with validation, and lock in determinism + performance guardrails. Features default to on once all Phase 9 tests are green, with no compatibility shim.

## Scope
- In: Phase 9 identity/symbol contracts, import-aware resolver, symbol artifacts, graph/map migration to chunkUid, strict validation, test lanes, determinism/perf guardrails.
- Out: Phase 10 work, full module-resolution parity (Node/TS paths), external symbol sources (SCIP/LSIF/ctags ingestion), compatibility shims.

## Action items
[x] 1. Audit Phase 9 contracts and addendum requirements against current code and docs.
  - Read Phase 9 contract blocks in `GIGAROADMAP_2.md` and `docs/specs/identity-contract.md`.
  - Confirm SymbolRef, symbol artifacts, graph_relations v2, and addendum requirements.
  - Record any conflicts or drift in Progress log.

[x] 2. Verify identity primitive implementations (Phase 9.1 verification only).
  - Inspect `src/index/identity/chunk-uid.js`, `src/index/segments.js`, and `src/shared/identity.js`.
  - Confirm `segmentUid`, `virtualPath`, `chunkUid` in metaV2 for all code chunks.
  - Confirm collision escalation + ordinal suffix determinism.

[x] 3. Confirm strict validation rules fail-closed on missing identity fields.
  - Review `src/index/validate.js`, `src/index/validate/schema.js`, and `src/index/validate/artifacts.js`.
  - Verify strict mode rejects missing chunkUid/segmentUid/virtualPath.
  - Identify any file::name fallbacks to remove.

[x] 4. Align schemas/registry before code changes.
  - Update `src/contracts/schemas/artifacts.js` for new symbol artifacts and importBindings.
  - Update `src/shared/artifact-schemas.js` registry and required keys.
  - Update `src/shared/artifact-io/jsonl.js` required keys for JSONL validation.
  - Update manifest expectations in `src/shared/artifact-io/manifest.js` and `src/shared/artifact-io/loaders.js` if new artifacts must be manifest-first.
  - Update `docs/contracts/artifact-schemas.md` to document new artifacts and sharded meta entries.

[x] 5. Inventory current file::name joins and legacy chunkId usage.
  - Graph builder: `src/index/build/graphs.js` (legacyKey/resolveChunkId).
  - Cross-file pipeline: `src/index/type-inference-crossfile/pipeline.js` and `src/index/type-inference-crossfile/tooling.js`.
  - Map build: `src/map/build-map.js`, `src/map/build-map/symbols.js`, `src/map/build-map/edges.js`, `src/map/build-map/filters.js`.
  - Tooling providers: `src/index/tooling/*`.

[x] 6. Solidify shared symbol identity primitives in `src/shared/identity.js`.
  - Confirm or add exports: buildSymbolKey, buildSignatureKey, buildScopedSymbolId, buildSymbolId, resolveSymbolJoinKey.
  - Ensure inputs use virtualPath/qualifiedName/kindGroup/chunkUid (no chunkId for uniqueness).

[x] 7. Add kindGroup normalization helper.
  - Create `src/index/identity/kind-group.js`.
  - Add unit tests for all expected mappings.

[x] 8. Add symbol identity adapter for index build.
  - Create `src/index/identity/symbol.js` using shared identity helpers.
  - Implement definition-chunk policy from Phase 9.
  - Return null for non-definition chunks.

[x] 9. Populate `metaV2.symbol` during metadata build.
  - Update `src/index/metadata-v2.js` after identity fields set.
  - Ensure symbolKey uses virtualPath + qualifiedName.
  - Include scheme, symbolId, scopedId, signatureKey, kindGroup.

[x] 10. Extend relations to include import bindings (Phase 9.3.1).
  - Update `src/lang/javascript/relations.js` to emit importBindings.
  - Propagate importBindings through `src/index/build/file-processor/relations.js`.
  - Extend file_relations schema to include importBindings.

[x] 11. Implement relative import resolver helper.
  - Create `src/index/type-inference-crossfile/resolve-relative-import.js`.
  - Support ./ and ../ with extension probing and index resolution.
  - Normalize to repo-relative POSIX paths.

[x] 12. Centralize SymbolRef caps/constants.
  - Extend `src/index/type-inference-crossfile/constants.js` (already exists).
  - Define MAX_CANDIDATES_PER_REF, MAX_CANDIDATES_GLOBAL_SCAN, MAX_ROW_BYTES.
  - Reuse in resolver + validators.

[x] 13. Implement SymbolRef resolver.
  - Create `src/index/type-inference-crossfile/resolver.js`.
  - Build name-indexed and path-indexed symbol maps.
  - Apply import narrowing, candidate caps, and status resolution.
  - Deterministic candidate ordering (score desc, symbolKey asc).

[x] 14. Add resolver tests (unit + integration).
  - Unit: `tests/crossfile/symbolref-resolution.test.js`.
  - Integration (aligned to lane): `tests/integration/import-resolver-relative.test.js`.
  - Cover ambiguous vs resolved vs unresolved cases.

[x] 15. Update cross-file inference pipeline to emit SymbolRef links.
  - Replace legacy joins with chunkUid + symbol identity.
  - Emit SymbolRef on callLinks and usageLinks.
  - Preserve ambiguous/unresolved states (fail-closed).

[x] 16. Keep callSummaries but add chunkUid resolution.
  - Ensure callSummaries include resolved chunkUid when possible.
  - Preserve legacy fields for diagnostics only.

[x] 17. Audit tooling providers for chunkUid keying assumptions.
  - `src/index/tooling/typescript-provider.js`.
  - `src/index/tooling/clangd-provider.js`.
  - `src/index/tooling/pyright-provider.js`.
  - `src/index/tooling/sourcekit-provider.js`.
  - Ensure outputs map to chunkUid and SymbolRef policy.

[x] 18. Add symbol artifact writers.
  - Create writers: `symbols.js`, `symbol-occurrences.js`, `symbol-edges.js`.
  - Ensure deterministic ordering and sharding.
  - Use SymbolRef envelope in occurrences/edges.

[x] 19. Integrate symbol artifact writers into artifact build.
  - Update `src/index/build/artifacts.js` and step wiring.
  - Ensure manifest inclusion for new JSONL artifacts.

[x] 20. Add symbol artifact validation hooks.
  - Extend `src/index/validate.js` for strict validation.
  - Validate referential integrity: chunkUid exists, resolved refs valid.

[x] 21. Update graph_relations to v2 (chunkUid nodes only).
  - Update `src/index/build/graphs.js` to use chunkUid ids.
  - Emit edges only for resolved SymbolRef targets.
  - Preserve legacyKey for diagnostics.

[x] 22. Update graph schema/versioning.
  - Bump graph_relations version to 2.
  - Ensure serializer preserves deterministic ordering.

[x] 23. Update map build to use new identities.
  - Replace legacy joins with chunkUid.
  - Prefer symbolId for member identity when present.
  - In strict mode: fail if chunkUid missing; non-strict logs + skips.

[x] 24. Add graph and map tests.
  - Update `tests/graph-chunk-id.js` for v2 expectations.
  - Add `tests/integration/graph-relations-v2-chunkuid.test.js`.
  - Add `tests/integration/map-chunkuid-join.test.js`.
  - Add `tests/map/map-build-symbol-identity.test.js`.

[x] 25. Add symbol identity tests.
  - `tests/identity/symbol-identity.test.js`.
  - `tests/unit/identity-symbolkey-scopedid.test.js`.
  - `tests/unit/symbolref-envelope.test.js`.

[x] 26. Add artifact emission tests.
  - `tests/artifacts/symbol-artifacts-smoke.test.js`.
  - `tests/services/symbol-artifacts-emission.test.js`.
  - `tests/validate/symbol-integrity-strict.test.js`.

[x] 27. Add pipeline tests for resolver behavior.
  - `tests/services/symbol-edges-ambiguous.test.js`.
  - `tests/services/symbol-links-by-chunkuid.test.js`.
  - `tests/integration/file-name-collision-no-wrong-join.test.js`.

[x] 28. Add determinism/performance guardrails.
  - `tests/integration/chunkuid-determinism.test.js`.
  - `tests/integration/symbol-artifact-determinism.test.js`.
  - `tests/determinism/symbol-artifact-order.test.js`.
  - `tools/bench/symbol-resolution-bench.js`.

[x] 29. Update test lane rules.
  - Update `tests/run.rules.jsonc` for new tests.
  - Validate lane assignment with `npm test -- --list-lanes`.

[x] 30. Execute tests in order and log results.
  - Unit: identity + resolver + envelopes.
  - Integration: resolver + graph/map + determinism.
  - Services: artifact emission + strict validation.
  - Record pass/skip per test lane in this file.

[x] 31. Default features to on after tests are green.
  - Remove temporary gating (if any) and ensure defaults are enabled.
  - Confirm no compatibility shim is introduced.

[x] 32. Final audit and cleanup.
  - Remove any lingering file::name joins.
  - Ensure SymbolRef caps are enforced (defaults noted; tuning later).
  - Update Phase 9 checkboxes in `GIGAROADMAP_2.md` as work completes.

## Open questions
- None. Candidate caps and thresholds will be tuned later via testing.

## Progress log
- 2026-01-31: Plan updated after main merge on branch APEX_STARBINDER_FORGE.
- 2026-01-31: Aligned artifact schemas for symbol artifacts and importBindings; updated JSONL required keys and contract docs.
- 2026-01-31: Audited Phase 9 contracts vs code, verified identity primitives and strict validation behavior.
- 2026-01-31: Logged legacy join sites in graphs/map/tooling for Phase 9 migration.
- 2026-01-31: Updated shared symbol identity helpers and TypeScript provider usage to new symbol identity shapes.
- 2026-01-31: Added kindGroup helper and unit coverage.
- 2026-01-31: Added symbol identity adapter and wired metaV2.symbol population.
- 2026-01-31: Added JS importBindings extraction and file_relations propagation.
- 2026-01-31: Added resolve-relative-import helper for cross-file resolver.
- 2026-01-31: Centralized SymbolRef caps/constants in cross-file constants.
- 2026-01-31: Implemented SymbolRef resolver and wired cross-file pipeline to emit SymbolRef links with chunkUid resolution.
- 2026-01-31: Added SymbolRef resolver unit/integration coverage for import narrowing and leaf resolution.
- 2026-01-31: Audited tooling providers; chunkUid keying and symbolRef support are aligned.
- 2026-01-31: Added symbol artifact writers (symbols, symbol_occurrences, symbol_edges) and wired them into artifact build.
- 2026-01-31: Added symbol artifact validation, presence checks, and resolution metrics in validateIndexArtifacts.
- 2026-01-31: Migrated graph_relations to v2 with chunkUid nodes and resolved-edge filtering.
- 2026-01-31: Updated map build pipeline to prefer symbolId/chunkUid joins and removed file::name dependency.
- 2026-01-31: Added graph/map regression tests for chunkUid joins and symbolId preference.
- 2026-01-31: Added symbol identity helper tests for symbol keys, scoped ids, and SymbolRef join behavior.
- 2026-01-31: Added symbol artifact smoke + sharded emission tests, plus strict validation coverage for symbol artifacts.
- 2026-01-31: Added cross-file pipeline tests for ambiguous/resolved SymbolRef links.
- 2026-01-31: Added determinism tests for chunkUid stability and symbol artifact ordering/output.
- 2026-01-31: Updated test lane rules to classify identity/crossfile tests as unit.
- 2026-01-31: Tests reported passing across Phase 9 additions.
- 2026-01-31: Defaulted cross-file inference to on in runtime (docs updated).
- 2026-01-31: Final audit: no lingering file::name join logic in graph/map/cross-file paths.
- 2026-01-31: Added tooling provider duplicate chunkUid diagnostics + unit regression tests for byChunkUid outputs.
- 2026-01-31: Updated Phase 9 roadmap checkboxes and exit criteria to reflect completion.
- 2026-01-31: Added symbol-resolution micro-benchmark under tools/bench.

## Problems / conflicts
- (none yet)

---

## Appendix A -- Concrete file-by-file change list

This appendix is purely to reduce search time during implementation. Each file lists the exact intent.

### A.1 New files to add

- `src/index/identity/kind-group.js`
- `src/index/identity/symbol.js`
- `src/index/type-inference-crossfile/resolve-relative-import.js`
- `src/index/type-inference-crossfile/resolver.js`
- `src/index/build/artifacts/writers/symbols.js`
- `src/index/build/artifacts/writers/symbol-occurrences.js`
- `src/index/build/artifacts/writers/symbol-edges.js`
- Tests:
  - `tests/identity/symbol-identity.test.js`
  - `tests/unit/identity-kind-group.test.js`
  - `tests/crossfile/symbolref-resolution.test.js`
  - `tests/integration/import-resolver-relative.test.js`
  - `tests/artifacts/symbol-artifacts-smoke.test.js`
  - `tests/integration/graph-relations-v2-chunkuid.test.js`
  - `tests/integration/map-chunkuid-join.test.js`
  - `tests/map/map-build-symbol-identity.test.js`
  - `tests/integration/symbol-artifact-determinism.test.js`
  - `tests/determinism/symbol-artifact-order.test.js`

### A.2 Existing files to modify

- `src/index/identity/chunk-uid.js` -- verify identity behavior vs spec
- `src/shared/identity.js` -- symbol identity helpers
- `src/index/metadata-v2.js` -- include identity + symbol identity
- `src/lang/javascript/relations.js` -- emit importBindings
- `src/index/build/file-processor/relations.js` -- include importBindings
- `src/contracts/schemas/artifacts.js` -- schemas for new artifacts + file_relations importBindings
- `src/shared/artifact-schemas.js` -- schema registry updates
- `src/shared/artifact-io/jsonl.js` -- JSONL required keys for new artifacts
- `src/shared/artifact-io/manifest.js` -- manifest-first artifact discovery updates
- `src/shared/artifact-io/loaders.js` -- strict loaders for new artifacts
- `src/index/type-inference-crossfile/pipeline.js` -- emit SymbolRef edges and avoid legacy joins
- `src/index/type-inference-crossfile/symbols.js` -- adjust helpers or retire
- `src/index/type-inference-crossfile/tooling.js` -- align callsite extraction with SymbolRef
- `src/index/tooling/{typescript,pyright,clangd,sourcekit}-provider.js` -- key by chunkUid
- `src/index/build/artifacts.js` -- write symbol artifacts
- `src/index/validate.js` -- validate symbol artifacts
- `src/index/validate/artifacts.js` -- presence checks for new artifacts
- `src/index/build/graphs.js` -- graph_relations v2 using chunkUid
- `src/map/build-map.js` -- join graph nodes to chunk meta via chunkUid
- `src/map/build-map/symbols.js` -- remove file::name symbol ids
- `src/map/build-map/edges.js` -- update edge member keys
- `src/map/build-map/filters.js` -- remove file::name parsing
- `tests/graph-chunk-id.js` -- update expectations
- `tests/run.rules.jsonc` -- lane assignment for new tests

---

## Appendix B -- Metrics to report (recommended)

- `symbol_resolution.resolved_rate`
- `symbol_resolution.ambiguous_rate`
- `symbol_resolution.unresolved_rate`
- `symbol_resolution.max_candidates_hit_rate`
- `symbol_resolution.import_narrowed_rate`

In strict CI mode, optionally enforce:

- `wrong_link_rate == 0` on fixtures with gold truth
- `resolved_rate >= threshold` on fixtures (threshold set per fixture)

---

## Phase 9 addendum: dependencies, ordering, artifacts, tests, edge cases

### Cross-phase ordering (Phase 8 ↔ Phase 9)
- Identity primitives (`segmentUid`, `virtualPath`, `chunkUid`) must already be complete from Phase 8 before any Phase 9 symbol/graph work starts.
- Phase 9.1 is verification-only: if identity primitives are missing or drifted, stop Phase 9 and complete Phase 8 identity tasks first.
- Identity tests (segmentUid/chunkUid/strict validation) must already be green from Phase 8; rerun only if identity code changes.

### 9.1 Dependencies and order of operations
- Dependencies:
  - segmentUid algorithm must land before chunkUid (needs segment text).
  - virtualPath and chunkUid helpers must exist before any graph/tooling joins.
- Order of operations:
  1) Compute segmentUid during segmentation (container text available).
  2) Build virtualPath and chunkUid during chunk assembly.
  3) Persist into metaV2 + chunk payload.
  4) Add strict validation for missing chunkUid.

### 9.1 Acceptance criteria + tests (lane)
- Identity tests run in Phase 8 (see Phase 8 addendum). Rerun only if identity code changes.

### 9.1 Edge cases and fallback behavior
- Missing segment text in cache hydrate: treat as cache miss and reprocess file.
- chunkUid collision: escalate context once, then append :ord<N> deterministically.
- Fail-closed: strict mode rejects any chunk missing chunkUid/segmentUid/virtualPath (no file::name fallback).

### 9.2 Dependencies and order of operations
- Dependencies:
  - 9.1 identity helpers must land before symbol identity helpers.
- Order of operations:
  1) Implement kindGroup normalization.
  2) Implement symbolKey/signatureKey/scopedId builders.
  3) Add SymbolRef envelope helpers.

### 9.2 Acceptance criteria + tests (lane)
- tests/unit/identity-symbolkey-scopedid.test.js (test:unit)
- tests/unit/symbolref-envelope.test.js (test:unit)

### 9.2 Edge cases and fallback behavior
- Missing qualifiedName: fall back to chunk.name; mark symbolKey as low confidence.
- Duplicate scopedId: deterministic ordinal suffix or strict-mode error (choose and document).

### 9.3 Dependencies and order of operations
- Dependencies:
  - import bindings must be extracted before resolver runs.
- Order of operations:
  1) Collect import bindings in relations extraction.
  2) Resolve relative imports to candidate files.
  3) Emit SymbolRef candidates with status=ambiguous when >1.

### 9.3 Acceptance criteria + tests (lane)
- tests/integration/import-resolver-relative.test.js (test:integration)
- tests/services/symbol-edges-ambiguous.test.js (test:services)

### 9.3 Edge cases and fallback behavior
- Unresolved import: emit unresolved SymbolRef with candidates empty; keep edge.
- Multiple matches: status=ambiguous; do not pick winner.
- Fail-closed: if resolver cannot map to chunkUid candidates, mark unresolved; do not guess by name.

### 9.4 Dependencies and order of operations
- Dependencies:
  - 9.1 chunkUid and 9.2 symbol helpers must be present.
- Order of operations:
  1) Build chunkUid map.
  2) Replace legacy joins with chunkUid joins.
  3) Attach SymbolRef info to call/usage links.

### 9.4 Acceptance criteria + tests (lane)
- tests/integration/file-name-collision-no-wrong-join.test.js (test:integration)
- tests/services/symbol-links-by-chunkuid.test.js (test:services)

### 9.4 Edge cases and fallback behavior
- Missing chunkUid: strict mode fails; non-strict logs and skips the link.
- Multiple candidates: preserve ambiguity in SymbolRef.
- Fail-closed: never backfill chunkUid joins from file::name; emit ambiguous/unresolved instead.

### 9.5 Artifact row fields (symbols.jsonl, symbol_occurrences.jsonl, symbol_edges.jsonl)
- symbols.jsonl required keys (SymbolRecordV1):
  - v, symbolKey, scopedId, symbolId, qualifiedName, kindGroup, file, virtualPath, chunkUid
  - optional: signatureKey, languageId, chunkId, containerName, source
- symbol_occurrences.jsonl required keys (SymbolOccurrenceV1):
  - v, host.file, host.chunkUid, role, ref (SymbolRefV1)
  - optional: meta.callerScopedId, meta.argMap
- symbol_edges.jsonl required keys (SymbolEdgeV1):
  - v, type, from.file, from.chunkUid, to (SymbolRefV1)
  - optional: confidence, reason, call.argMap
- Caps (set explicit defaults in schema/tests):
  - maxCandidates in SymbolRef (recommended: 25)
  - maxEvidence/snippet size (no raw snippets; use hashes)
  - maxRowBytes (recommended: 32768)

### 9.5 Acceptance criteria + tests (lane)
- tests/services/symbol-artifacts-emission.test.js (test:services)
- tests/validate/symbol-integrity-strict.test.js (test:services)
- tests/services/symbol-edges-ambiguous.test.js (test:services)

### 9.5 Edge cases and fallback behavior
- Duplicate scopedId: strict validation fails; non-strict appends deterministic ordinal.
- SymbolRef resolved but missing chunkUid: treat as unresolved and log.
- Fail-closed: if SymbolRef is resolved but missing chunkUid/scopedId, drop edge in strict mode.

### 9.6 Dependencies and order of operations
- Dependencies:
  - 9.1 chunkUid must land before graph_relations v2.
- Order of operations:
  1) Update graph node ids to chunkUid.
  2) Update edge targets to resolved chunkUid only.
  3) Keep legacyKey for diagnostics only.

### 9.6 Acceptance criteria + tests (lane)
- tests/integration/graph-relations-v2-chunkuid.test.js (test:integration)

### 9.6 Edge cases and fallback behavior
- Missing chunkUid in chunk_meta: strict mode fails; non-strict skips node.

### 9.7 Dependencies and order of operations
- Dependencies:
  - Graph relations v2 must be complete before map build joins.
- Order of operations:
  1) Join map entries by chunkUid.
  2) Fallback to chunkId only for diagnostics.

### 9.7 Acceptance criteria + tests (lane)
- tests/integration/map-chunkuid-join.test.js (test:integration)

### 9.7 Edge cases and fallback behavior
- Multiple map entries for same chunkUid: keep deterministic ordering, dedupe by chunkUid.

### 9.8 Dependencies and order of operations
- Dependencies:
  - Determinism checks after all artifact emission.
- Order of operations:
  1) Run determinism tests (two builds).
  2) Verify collision handling is stable.

### 9.8 Acceptance criteria + tests (lane)
- tests/integration/chunkuid-determinism.test.js (test:integration)
- tests/integration/symbol-artifact-determinism.test.js (test:integration)

### 9.8 Edge cases and fallback behavior
- Large repos: enforce sharded emission; fail if memory cap exceeded.

## Fixtures list (Phase 9)

- tests/fixtures/identity/chunkuid-collision
- tests/fixtures/symbols/ambiguous-defs
- tests/fixtures/imports/relative-ambiguous
- tests/fixtures/graph/chunkuid-join

## Compat/migration checklist (Phase 9)

- Keep chunkId and segmentId in metaV2 for debug/back-compat only.
- Emit graph_relations v2 with chunkUid node ids; keep legacyKey for diagnostics only.
- Symbol artifacts are additive; do not remove legacy repo_map outputs.

## Artifacts contract appendix (Phase 9)

- symbols.jsonl
  - required keys: v, symbolKey, scopedId, symbolId, qualifiedName, kindGroup, file, virtualPath, chunkUid
  - optional keys: signatureKey, languageId, chunkId, containerName, source
  - caps: maxRowBytes 32768
- symbol_occurrences.jsonl
  - required keys: v, host.file, host.chunkUid, role, ref (SymbolRefV1)
  - optional keys: meta.callerScopedId, meta.argMap
- symbol_edges.jsonl
  - required keys: v, type, from.file, from.chunkUid, to (SymbolRefV1)
  - optional keys: confidence, reason, call.argMap
- graph_relations.json (v2)
  - required node ids: chunkUid
  - legacyKey allowed for diagnostics only
