# DUPEMAP — Duplication Consolidation Execution Plan

Last updated: 2026-02-10T00:00:00Z

Purpose: remove all confirmed duplication clusters comprehensively, efficiently, and permanently.

Primary inputs:
- `duplication_consolidation_report.md`
- `duplication_report.md`
- `duplication_report.json`

Completed phases are appended to: `COMPLETED_PHASES.md`

---

## Status legend

- [x] Implemented and validated
- [@] In progress
- [.] Implemented but not yet tested
- [?] Correctness gap or insufficient tests
- [ ] Not started

---

## Operating rules

1. Hard cutovers only.
- No compatibility aliases/shims for duplicated helpers.
- Old helper implementations are deleted in the same phase as migration.

2. Canonical ownership.
- Cross-cutting shared runtime: `src/shared/**`
- Index/build orchestration: `src/index/**`
- Storage shared internals: `src/storage/**`
- Tools must consume canonical helpers, not fork them.

3. Exhaustive migration proof.
- Every phase must add/extend duplicate-ban entries in `docs/tooling/dupemap-migration-manifest.json`.
- Every phase must run the legacy usage audit and fail on any hit.

4. Test integrity.
- Merged/refactored tests must preserve distinct scenario assertions.
- Test helpers can be shared; scenario-specific expectations cannot be collapsed away.

5. Docs/contracts alignment.
- Any changed API surface or behavior must update docs/contracts in the same phase.

---

## Phase summary

| Phase | Status | Scope |
| --- | --- | --- |
| D0 | [ ] | Baseline guardrails + manifest + usage scanner |
| D1 | [ ] | Shared primitive consolidation |
| D2 | [ ] | JSONL merge + artifact writer scaffolding |
| D4 | [ ] | ANN + API/MCP + search request normalization |
| D5 | [ ] | Tooling + language parser/extractor consolidation |
| D3 | [ ] | SQLite/LMDB/quantization/vocab consolidation |
| D6 | [ ] | Chunking + risk + import resolution + map consolidation |
| D7 | [ ] | Test/bench dedupe and harness consolidation |
| D8 | [ ] | AJV/fetch consolidation + CI hardening + closeout |

---

## Frontloaded execution order (mandatory)

This roadmap is intentionally ordered to frontload highest-leverage, cross-cutting foundations first.

### Wave A — Foundation extraction and enforcement (must complete first)
1. `D0` Migration manifest + duplicate-ban scanner + CI enforcement
2. `D1` Shared primitives (path/find-up/cache/bytes/warn/minified/root/locks)
3. `D2` Shared JSONL merge/writer scaffolding
4. `D4` Shared request/ANN normalization across API/MCP/retrieval
5. `D5` Shared tooling/language helper extraction

### Wave B — Domain-heavy migrations (run after Wave A)
6. `D3` Storage internals (SQLite/LMDB/quantization/vocab)
7. `D6` Domain helper migrations (chunking/risk/import/map)

### Wave C — Consolidation and lock-in (last)
8. `D7` Test/bench dedupe using foundations from Waves A/B
9. `D8` Validation/fetch finalization + CI hardening + closeout

Rationale:
- Waves A phases create canonical helper layers and migration enforcement.
- Waves B phases become mostly callsite migrations onto stable foundations.
- Wave C can safely collapse duplicate tests/harnesses only after codepaths stabilize.
- Section order in this document remains numeric (`D0`..`D8`), but execution must follow the wave order above.

---

## Phase dependencies and gates

| Phase | Hard dependencies | Why |
| --- | --- | --- |
| D0 | None | Defines migration/banning control plane used by all phases |
| D1 | D0 | Primitive helper migration must be enforced by manifest/ban checks |
| D2 | D0, D1 | JSONL/writer scaffolding depends on shared primitives and scanner gates |
| D4 | D0, D1 | API/MCP/retrieval normalization requires canonical shared baseline |
| D5 | D0, D1 | Tooling/language helper extraction depends on shared primitives and ban checks |
| D3 | D0, D1, D2 | Storage migrations depend on shared primitive + JSONL foundation work |
| D6 | D0, D1, D5 | Domain helper consolidation depends on language/tooling shared helper extraction |
| D7 | D0, D1, D2, D3, D4, D5, D6 | Test dedupe should happen after production codepaths stabilize |
| D8 | All prior phases | Final hardening and CI lock-in only after full migration |

Gate rule:
- Do not start a phase until hard dependencies are completed and committed.
- Exceptions require explicit note in this file with reason and rollback plan.

---

## Cluster mapping

| Cluster | Phase |
| --- | --- |
| 1 JSONL merge/spill helpers | D2 |
| 2 JSONL writer scaffolding + extension resolution | D2 |
| 3 SQLite build pipeline duplication | D3 |
| 4 SQLite src/tools duplicate helpers | D3 |
| 5 Embedding quantization normalization | D3 |
| 6 SQLite vocab lookup + stmt cache | D3 |
| 7 LMDB codec/presence/meta validation | D3 |
| 8 ANN readiness + backend normalization | D4 |
| 9 API/MCP request mapping drift | D4 |
| 10 Path normalization + containment | D1 |
| 11 Find-upwards logic | D1 |
| 12 Map-based LRU duplicates | D1 |
| 13 Bytes/size formatting + traversal | D1 |
| 14 warn-once variants | D1 |
| 15 Minified-file detection | D1 |
| 16 Root normalization duplicates | D1 |
| 17 File locking variants | D1 |
| 18 Chunking helper duplication | D6 |
| 19 Risk utility duplication | D6 |
| 20 Relative import resolution duplication | D6 |
| 21 Binary discovery helper duplication | D5 |
| 22 TypeScript loader duplication | D5 |
| 23 Signature parsing/readSignatureLines duplication | D5 |
| 24 JS/TS relations duplication | D5 |
| 25 Map filter/escape/config merge duplication | D6 |
| 26 AJV validation scaffolding duplication | D8 |
| 27 Misc helper duplicates | D1/D4/D8 |
| Additional: duplicate `resolveJsonlExtension` within `src/shared/json-stream.js` | D2 |
| Additional: duplicate `normalizeMetaFilters` in API/MCP | D4 |
| Additional: map bench wiring duplication | D7 |
| Additional: repo cache default duplication | D4 |

---

## Global checklist for every migration task

- [ ] Define canonical target module and public API.
- [ ] Add manifest entry with old symbol/path -> replacement.
- [ ] Migrate all callsites.
- [ ] Delete duplicate implementation(s).
- [ ] Add/adjust tests validating canonical path behavior.
- [ ] Add duplicate-ban patterns for removed symbols.
- [ ] Run duplicate audit + targeted tests.
- [ ] Update docs/contracts if behavior or options changed.

Subphase ordering rule (applies to D1-D8):
1. Foundation extraction: create/lock canonical helper API.
2. Migration pass: move all consumers to canonical API.
3. Deletion pass: remove duplicate bodies and dead exports.
4. Enforcement pass: add ban patterns and run audit.
5. Validation pass: run targeted tests, then lane subset.

---

## Phase D0 — Baseline and migration guardrails

### Objective
Create enforcement infrastructure so each subsequent phase can prove exhaustive duplicate removal.

### Files
- `docs/tooling/dupemap-migration-manifest.json` (new)
- `tools/dupemap/audit-legacy-usage.js` (new)
- `tests/tooling/dupemap/dupemap-legacy-usage-ban.test.js` (new)
- `tests/tooling/dupemap/dupemap-manifest-completeness.test.js` (new)
- `docs/guides/commands.md` (update)

### Subphase D0.1 — Manifest and schema
Tasks:
- [ ] Task D0.1.a: Create manifest schema sections: `clusters`, `migrations`, `banPatterns`, `exceptions`.
Details: Each migration entry must include `phase`, `oldPathOrSymbol`, `newPathOrSymbol`, `status`.
- [ ] Task D0.1.b: Populate initial entries for all 27 clusters plus 4 additional verified clusters.
Details: No placeholder entries; every cluster must have concrete symbols/files.
- [ ] Task D0.1.c: Add explicit exception semantics.
Details: Exception entry requires reason + expiry phase; no permanent exceptions.

### Subphase D0.2 — Scanner + fail-fast behavior
Tasks:
- [ ] Task D0.2.a: Implement scanner to parse manifest and run pattern checks over `src/**`, `tools/**`, `tests/**`.
Details: Support regex and exact match modes.
- [ ] Task D0.2.b: Emit actionable output.
Details: Print file, line, matched legacy token, and replacement token.
- [ ] Task D0.2.c: Add strict exit mode.
Details: `--fail-on-hit` returns exit 1 when non-exempt matches are found.

### Subphase D0.3 — CI and script-coverage integration
Tasks:
- [ ] Task D0.3.a: Wire scanner command into CI-lite and ci-long guardrails.
Details: Run before broad test lanes.
- [ ] Task D0.3.b: Add script-coverage action for dupemap tests.
Details: Ensure dupemap tests appear in script inventory checks.

### Tests
- [ ] `tests/tooling/dupemap/dupemap-legacy-usage-ban.test.js`
- [ ] `tests/tooling/dupemap/dupemap-manifest-completeness.test.js`

### Exit criteria
- [ ] Manifest exists and covers all known clusters.
- [ ] Scanner is CI-enforced and fail-fast.

---

## Phase D1 — Shared primitive consolidation

### Objective
Consolidate high fan-out primitives and remove drift-prone helper forks.

### Scope
Clusters: 10, 11, 12, 13, 14, 15, 16, 17 and `escapeRegex`/`pickMinLimit` from 27.

### Canonical targets
- `src/shared/path-normalize.js`
- `src/shared/fs/find-upwards.js` (new)
- `src/shared/cache.js`
- `src/shared/disk-space.js`
- `src/shared/logging/warn-once.js` (new)
- `src/index/build/watch/shared.js` (new)
- `src/shared/locks/file-lock.js` (new)
- `src/shared/text/escape-regex.js` (new)
- `src/index/build/runtime/limits.js` (new)

### Subphase D1.1 — Path and find-upwards utilities
Tasks:
- [ ] Task D1.1.a: Add `findUpwards(startDir, predicate, stopDir)`.
Details: Must support deterministic stop condition and symlink-safe behavior.
- [ ] Task D1.1.b: Migrate `findGitRoot`, `findJjRoot`, tsconfig search, and repo-root walkups.
Details: Preserve existing stop behavior via predicate wrappers.
- [ ] Task D1.1.c: Consolidate path containment checks.
Details: Replace `isInside`/`isPathUnderDir` variants with shared helper.

### Subphase D1.2 — Cache/LRU and logging primitives
Tasks:
- [ ] Task D1.2.a: Add shared warn-once API supporting keyed and unkeyed usage.
Details: Support logger injection and deterministic key formatting.
- [ ] Task D1.2.b: Replace custom Map-LRU implementations with shared cache APIs.
Details: Preserve eviction semantics where externally observable.

### Subphase D1.3 — Bytes/size/minified/root normalization
Tasks:
- [ ] Task D1.3.a: Standardize `formatBytes` usage on `src/shared/disk-space.js`.
Details: Pick one output format and update docs/tests accordingly.
- [ ] Task D1.3.b: Standardize directory size traversal helper.
Details: Ensure same skip/exclude policy across tool and runtime.
- [ ] Task D1.3.c: Move minified-name/root-normalization to watch shared helper.
Details: Delete local regex/function copies in discover/watch modules.
- [ ] Task D1.3.d: Resolve `watch.js` `normalizeRoot` inconsistency during migration.
Details: Ensure watch uses imported helper only.

### Subphase D1.4 — Locking and misc primitive helpers
Tasks:
- [ ] Task D1.4.a: Implement shared file-lock primitive with stale detection + process-alive checks.
Details: Support configurable lock wait/poll/stale thresholds.
- [ ] Task D1.4.b: Migrate index lock, embeddings cache lock, and service queue lock.
Details: Preserve lock scope names and signal handling semantics.
- [ ] Task D1.4.c: Add shared `escapeRegex` and `pickMinLimit` helpers; migrate all variants.
Details: Remove duplicate helper bodies after migration.

### Exhaustive sweeps
- [ ] `rg "const normalizeRoot =|MINIFIED_NAME_REGEX" src/index/build`
- [ ] `rg "findGitRoot|findJjRoot|resolveNearestTsconfig|find-up" src tools`
- [ ] `rg "warned = new Set|warnOnce" src tools`
- [ ] `rg "formatBytes\(|sizeOfPath\(" src tools`
- [ ] `rg "escapeRegex\(|pickMinLimit\(" src tools`
- [ ] `rg "index\.lock|queue\.lock|staleMs|tasklist" src tools`

### Tests
- [ ] `tests/shared/fs/find-upwards-contract.test.js` (new)
- [ ] `tests/shared/path-normalize/path-containment-contract.test.js` (new)
- [ ] `tests/shared/logging/warn-once.test.js` (new)
- [ ] `tests/shared/cache/lru-parity.test.js` (new)
- [ ] `tests/shared/disk-space/format-bytes-contract.test.js` (new)
- [ ] `tests/shared/locks/file-lock-contract.test.js` (new)
- [ ] `tests/indexing/watch/watch-root-normalization.test.js` (new)
- [ ] `tests/tooling/dupemap/dupemap-legacy-usage-ban.test.js` (update D1 bans)

### Exit criteria
- [ ] No D1 duplicate helper bodies remain.
- [ ] Ban patterns catch reintroduction of old primitives.

---

## Phase D2 — JSONL merge and artifact writer scaffolding

### Objective
Unify run-merge and artifact writer plumbing to one canonical path.

### Scope
Clusters: 1, 2, plus duplicate `resolveJsonlExtension` inside `src/shared/json-stream.js`.

### Canonical targets
- `src/shared/merge.js`
- `src/shared/json-stream.js`
- `src/index/build/artifacts/writers/_common.js` (new)

### Subphase D2.1 — Merge helper unification
Tasks:
- [ ] Task D2.1.a: Expand shared merge API to cover local variant requirements.
Details: Include compare/readRun overrides and parse/error hooks.
- [ ] Task D2.1.b: Migrate `src/index/build/artifacts/helpers.js` to shared merge APIs.
Details: Delete local `MinHeap`, `readJsonlRows`, `mergeSortedRuns`.
- [ ] Task D2.1.c: Migrate `src/map/build-map/io.js` merge helpers.
Details: Preserve map-specific call semantics with adapter wrapper only.
- [ ] Task D2.1.d: Evaluate and migrate local `readJsonlRows` variants in VFS-related modules.
Details: Keep only shared version unless strict functional difference is required.

### Subphase D2.2 — Writer scaffolding commonization
Tasks:
- [ ] Task D2.2.a: Create `_common.js` helpers for extension resolution, cleanup, sizing, and shard/meta output.
Details: API must support all artifact writer combinations.
- [ ] Task D2.2.b: Migrate all artifact writers to `_common.js`.
Details: Cover call-sites, chunk-meta, chunk-uid-map, file-relations, risk-interprocedural, symbol-edges, symbol-occurrences, symbols, vfs-manifest.
- [ ] Task D2.2.c: Remove writer-local extension resolver and duplicate cleanup logic.
Details: Ensure all writers call canonical helpers.
- [ ] Task D2.2.d: Remove duplicate `resolveJsonlExtension` body in `src/shared/json-stream.js`.
Details: Keep one implementation and one export path.

### Exhaustive sweeps
- [ ] `rg "class MinHeap|function\* readJsonlRows|mergeSortedRuns\(" src`
- [ ] `rg "resolveJsonlExtension\(" src/index/build/artifacts/writers src/shared/json-stream.js`
- [ ] `rg "\.parts|\.meta\.json|jsonl\.zst|jsonl\.gz" src/index/build/artifacts/writers`

### Tests
- [ ] `tests/shared/merge/merge-contract.test.js` (new)
- [ ] `tests/shared/merge/merge-determinism.test.js` (new)
- [ ] `tests/indexing/artifacts/writers/writer-common-contract.test.js` (new)
- [ ] `tests/indexing/vfs/vfs-manifest-streaming.test.js` (update)
- [ ] `tests/tooling/vfs/vfs-manifest-streaming.test.js` (update; merge plan in D7)
- [ ] `tests/tooling/dupemap/dupemap-legacy-usage-ban.test.js` (update D2 bans)

### Exit criteria
- [ ] Exactly one merge/read stack and one writer scaffolding stack remain.

---

## Phase D4 — Retrieval/API/MCP/ANN consolidation

### Objective
Unify request/filters/cache config/ANN behavior across API, MCP, and retrieval.

### Scope
Clusters: 8, 9, additional `normalizeMetaFilters` and repo cache defaults duplication, and repo cache manager split from 27.

### Canonical targets
- `src/retrieval/ann/utils.js` (new)
- `src/retrieval/ann/normalize-backend.js` (new)
- `tools/shared/search-request.js` (new)
- `tools/shared/repo-cache-config.js` (new)

### Subphase D4.1 — ANN provider and backend normalization
Tasks:
- [ ] Task D4.1.a: Define canonical ANN readiness/gating helper API.
Details: Must encapsulate signal/config/index/candidate-set checks.
- [ ] Task D4.1.b: Migrate ANN providers to canonical gating helper.
Details: Remove local gating branches in provider modules.
- [ ] Task D4.1.c: Define canonical backend normalization and migrate CLI/pipeline callsites.
Details: Remove divergent backend alias behavior.

### Subphase D4.2 — Search request and filter normalization
Tasks:
- [ ] Task D4.2.a: Implement shared request normalizer + argv builder.
Details: API and MCP must call same core function.
- [ ] Task D4.2.b: Consolidate `normalizeMetaFilters` into one shared helper.
Details: Remove local duplicates in API/MCP/validation.
- [ ] Task D4.2.c: Fix API schema drift.
Details: Resolve `path` vs `paths`, add `filter` support, keep validation strict.

### Subphase D4.3 — Repo cache config parity
Tasks:
- [ ] Task D4.3.a: Consolidate default cache config values.
Details: API and MCP read from same source.
- [ ] Task D4.3.b: Consolidate cache manager behavior and normalization.
Details: Keep explicit override behavior consistent.

### Exhaustive sweeps
- [ ] `rg "normalizeAnnBackend|ann-backends|annBackend" src/retrieval`
- [ ] `rg "normalizeMetaFilters\(" tools/api tools/mcp`
- [ ] `rg "payload\.paths|payload\.path|payload\.filter" tools/api`
- [ ] `rg "DEFAULT_CACHE|cacheConfig|normalizeCacheConfig" tools/api tools/mcp`

### Tests
- [ ] `tests/retrieval/ann/ann-provider-gating-parity.test.js` (new)
- [ ] `tests/retrieval/ann/ann-backend-normalization-parity.test.js` (new)
- [ ] `tests/tooling/api-mcp/search-request-parity.test.js` (new)
- [ ] `tests/tooling/api-mcp/meta-filter-normalization.test.js` (new)
- [ ] `tests/tooling/api-mcp/repo-cache-config-parity.test.js` (new)
- [ ] existing API/MCP/ANN suites updated for canonical path

### Exit criteria
- [ ] API and MCP normalize requests identically.
- [ ] ANN providers share one gating + backend interpretation path.

---

## Phase D5 — Tooling and language front-end consolidation

### Objective
Consolidate duplicated tooling utilities and shared language parsing/extraction logic.

### Scope
Clusters: 21, 22, 23, 24.

### Canonical targets
- `src/index/tooling/binary-utils.js` (new)
- `src/index/tooling/typescript/load.js` (new)
- `src/index/tooling/signature-parse/shared.js` (new)
- `src/lang/shared/signature-lines.js` (new)
- `src/lang/js-ts/relations-shared.js` (new)

### Subphase D5.1 — Tooling utility consolidation
Tasks:
- [ ] Task D5.1.a: Extract shared binary discovery helper from doctor/pyright/tools.
Details: Preserve Windows suffix/path search behavior.
- [ ] Task D5.1.b: Extract shared TypeScript loader helper.
Details: Preserve lookup order and fallback semantics.
- [ ] Task D5.1.c: Migrate all callsites and delete local implementations.
Details: No duplicate copies remain.

### Subphase D5.2 — Signature parsing primitives
Tasks:
- [ ] Task D5.2.a: Add shared signature splitting primitives for clike/python/swift.
Details: Handle nesting/quotes consistently.
- [ ] Task D5.2.b: Add shared `readSignatureLines` helper and migrate language modules.
Details: Keep language-specific post-processing local.
- [ ] Task D5.2.c: Remove duplicate helper bodies.
Details: Ban legacy helper names.

### Subphase D5.3 — JS/TS relations shared core
Tasks:
- [ ] Task D5.3.a: Extract shared AST walk/callee/call-location logic.
Details: Keep parser setup and syntax-specific exceptions in per-language files.
- [ ] Task D5.3.b: Migrate JS and TS relation builders to shared core.
Details: Preserve existing relation output contract.

### Exhaustive sweeps
- [ ] `rg "findBinaryInDirs|candidateNames|resolveTypeScript|loadTypeScript" src tools`
- [ ] `rg "split.*Params|readSignatureLines" src/lang src/index/tooling/signature-parse`
- [ ] `rg "resolveCalleeParts|resolveCallLocation" src/lang/javascript src/lang/typescript`

### Tests
- [ ] `tests/tooling/binary-utils-parity.test.js` (new)
- [ ] `tests/tooling/typescript-loader-parity.test.js` (new)
- [ ] `tests/tooling/signature-parse/shared-splitter.test.js` (new)
- [ ] language signature/metadata tests updated
- [ ] `tests/lang/contracts/javascript-relations-contract.test.js` (new)
- [ ] `tests/lang/contracts/typescript-relations-contract.test.js` (new)

### Exit criteria
- [ ] All tooling and language helper duplicates in scope are centralized.

---

## Phase D3 — Storage consolidation (SQLite/LMDB/quantization/vocab)

### Objective
Eliminate storage correctness drift by consolidating duplicated storage logic.

### Scope
Clusters: 3, 4, 5, 6, 7.

### Canonical targets
- `src/storage/sqlite/build/core.js` (new)
- `src/storage/sqlite/build/output-paths.js`
- `src/storage/sqlite/build/index-state.js`
- `src/storage/sqlite/quantization.js` (new)
- `src/storage/sqlite/vocab.js` (new)
- `src/storage/lmdb/utils.js` (new)

### Subphase D3.1 — SQLite build core
Tasks:
- [ ] Task D3.1.a: Extract shared DB open/pragmas/schema/setup/insert pipeline core.
Details: Keep source enumeration in adapter modules.
- [ ] Task D3.1.b: Refactor `from-artifacts` to adapter usage.
Details: Remove shared logic duplicates after migration.
- [ ] Task D3.1.c: Refactor `from-bundles` to adapter usage.
Details: Preserve bundle-specific buffering/vector insertion.

### Subphase D3.2 — src/tools SQLite helper unification
Tasks:
- [ ] Task D3.2.a: Remove duplicate `tools/build/sqlite/output-paths.js`.
Details: Update tool imports to canonical source module.
- [ ] Task D3.2.b: Consolidate index-state helper implementation.
Details: Keep one module and remove duplicate.
- [ ] Task D3.2.c: Remove duplicate no-op task factories where shared utility exists.
Details: Ensure runner and tools use one task-factory source.

### Subphase D3.3 — Quantization and vocab parity
Tasks:
- [ ] Task D3.3.a: Extract canonical quantization metadata resolver.
Details: Retrieval and ranking must consume this resolver directly.
- [ ] Task D3.3.b: Replace retrieval-side levels/scale derivation duplicates.
Details: Remove manual derivation branches.
- [ ] Task D3.3.c: Extract canonical vocab fetch + statement cache helper.
Details: Build/retrieval call the same API.

### Subphase D3.4 — LMDB utils consolidation
Tasks:
- [ ] Task D3.4.a: Add shared LMDB presence checker and codec factory.
Details: Include `data.mdb` checks and decode behavior.
- [ ] Task D3.4.b: Add shared LMDB meta/schema validation helpers.
Details: Centralize required-key checks.
- [ ] Task D3.4.c: Migrate retrieval/validate/status callsites and delete local variants.
Details: No duplicate `new Unpackr` helpers remain outside shared module.

### Exhaustive sweeps
- [ ] `rg "resolveQuantizationParams|levels\s*\?|scale\s*=\s*\(" src/retrieval src/storage`
- [ ] `rg "fetchVocabRows\(" src/storage src/retrieval`
- [ ] `rg "new Unpackr|data\.mdb|hasLmdb|isLmdb" src`
- [ ] `rg "output-paths\.js|index-state\.js|createNoopTask" src tools/build/sqlite tools/shared`

### Tests
- [ ] `tests/storage/sqlite/build/sqlite-build-core-contract.test.js` (new)
- [ ] `tests/storage/sqlite/quantization/quantization-parity.test.js` (new)
- [ ] `tests/storage/sqlite/vocab/vocab-fetch-parity.test.js` (new)
- [ ] `tests/storage/lmdb/lmdb-utils-contract.test.js` (new)
- [ ] existing SQLite/LMDB suites updated for canonical paths
- [ ] `tests/tooling/dupemap/dupemap-legacy-usage-ban.test.js` (update D3 bans)

### Exit criteria
- [ ] Build/retrieval storage paths share single quantization/vocab semantics.
- [ ] LMDB presence/decode/validation logic is centralized.

---

## Phase D6 — Chunking, risk, import resolution, and map consolidation

### Objective
Consolidate remaining duplicated domain helpers and map subsystem duplicates.

### Scope
Clusters: 18, 19, 20, 25.

### Canonical targets
- `src/index/chunking/helpers.js` (new)
- `src/index/risk/shared.js` (new)
- `src/index/shared/import-candidates.js` (new)
- `src/map/shared/escape-html.js` (new)
- `src/map/build-map/filters.js` (single API)

### Subphase D6.1 — Chunking helper extraction
Tasks:
- [ ] Task D6.1.a: Extract `buildChunksFromLineHeadings` into shared chunking helper module.
Details: Include identical heading/title transform behavior.
- [ ] Task D6.1.b: Extract `buildChunksFromMatches` helper.
Details: Keep match regex definitions in format modules.
- [ ] Task D6.1.c: Migrate ini-toml/yaml/rst-asciidoc/markdown modules and delete local copies.
Details: No duplicate helper bodies remain.

### Subphase D6.2 — Risk utility extraction
Tasks:
- [ ] Task D6.2.a: Extract shared severity rank and identifier boundary logic.
Details: Single-file and interprocedural engines import from one module.
- [ ] Task D6.2.b: Extract shared rule pattern match helper.
Details: Preserve existing match semantics.
- [ ] Task D6.2.c: Remove duplicate constants/functions in risk modules.
Details: ban duplicate symbols via manifest.

### Subphase D6.3 — Import candidate and map cleanup
Tasks:
- [ ] Task D6.3.a: Extract shared import candidate generation function for build/crossfile paths.
Details: Parameterize extensions and existence checks.
- [ ] Task D6.3.b: Remove duplicate map filter APIs (`applyScopeFilter`, `applyCollapse`) after consumer migration.
Details: retain only canonical create-transform APIs.
- [ ] Task D6.3.c: Add shared HTML escape helper and migrate dot/html writers.
Details: one escape implementation.
- [ ] Task D6.3.d: Standardize config merge usage in map client and shared config.
Details: Decide array merge semantics and document explicitly.

### Exhaustive sweeps
- [ ] `rg "buildChunksFromLineHeadings|buildChunksFromMatches" src/index/chunking`
- [ ] `rg "SEVERITY_RANK|identifier.*boundary|rule.*match" src/index/risk*`
- [ ] `rg "resolve-relative-import|import-resolution" src/index`
- [ ] `rg "applyScopeFilter|applyCollapse|escapeHtml|mergeConfig" src/map src/shared`

### Tests
- [ ] `tests/indexing/chunking/chunking-helper-parity.test.js` (new)
- [ ] `tests/indexing/risk/risk-shared-utils-parity.test.js` (new)
- [ ] `tests/indexing/type-inference/import-candidates-parity.test.js` (new)
- [ ] `tests/map/map-filter-api-contract.test.js` (new)
- [ ] `tests/map/html-escape-contract.test.js` (new)
- [ ] map config merge behavior test (new)

### Exit criteria
- [ ] No duplicated chunking/risk/import/map helper stacks remain in scope.

---

## Phase D7 — Test and benchmark dedupe with scenario-preserving merges

### Objective
Reduce duplicated tests and bench wiring while preserving scenario coverage and readability.

### Subphase D7.1 — Retrieval ANN pipeline tests
Tasks:
- [ ] Task D7.1.a: Extract shared ANN pipeline fixture/setup helper.
Details: Create `tests/retrieval/pipeline/helpers/ann-scenarios.js`.
- [ ] Task D7.1.b: Keep separate scenario assertions.
Details: Missing-provider and provider-failure remain distinct tests.
- [ ] Task D7.1.c: Update test names to reflect scenario matrix clearly.

### Subphase D7.2 — Interprocedural flow cap tests
Tasks:
- [ ] Task D7.2.a: Build parameterized flow-cap matrix helper.
Details: Inputs: conservative/max/overflow edge cases.
- [ ] Task D7.2.b: Convert duplicated flow tests to matrix-driven assertions.
Details: Maintain current expected counts and failure messages.

### Subphase D7.3 — VFS and SQLite streaming tests
Tasks:
- [ ] Task D7.3.a: Create shared VFS streaming fixture/assert helper.
Details: Keep indexing and tooling entrypoint assertions separate.
- [ ] Task D7.3.b: Build compression matrix harness for chunk-meta/gzip/zstd streaming tests.
Details: Codec-specific assertions remain explicit.

### Subphase D7.4 — Graph/symbol/sqlite build test harness cleanup
Tasks:
- [ ] Task D7.4.a: Extract shared graph perf contract bench helper.
Details: Keep context-pack vs neighborhood assertions distinct.
- [ ] Task D7.4.b: Extract shared symbol artifact setup helper.
Details: Keep smoke vs by-file-index assertions distinct.
- [ ] Task D7.4.c: Extract shared sqlite build fixture setup helper.
Details: Keep rowcount and fast-path validator assertions distinct.

### Subphase D7.5 — Bench script dedupe
Tasks:
- [ ] Task D7.5.a: Extract shared static server/wiring helper for map viewer benches.
Details: Migrate `viewer-fps` and `viewer-lod-stress`.
- [ ] Task D7.5.b: Extract shared map bench build options helper.
Details: Migrate `build-map-memory` and `build-map-streaming`.

### Subphase D7.6 — Clone threshold guardrail for tests and benches
Tasks:
- [ ] Task D7.6.a: Add clone-threshold test for `tests/**` and `tools/bench/**`.
Details: Set threshold to catch large copy/paste blocks.
- [ ] Task D7.6.b: Wire threshold result into script-coverage/reporting.
Details: Fail CI on regression beyond allowlist.

### Tests
- [ ] merged suites run individually and preserve scenario assertions
- [ ] `tests/tooling/dupemap/dupemap-test-clone-threshold.test.js` (new)
- [ ] script-coverage suites updated for new helper locations

### Exit criteria
- [ ] Duplicate test/bench setup blocks moved into shared helpers.
- [ ] Scenario coverage matrix is unchanged or improved.

---

## Phase D8 — Final hardening and closeout

### Objective
Consolidate remaining validation/fetch duplicates, lock CI rules, and close the roadmap.

### Scope
Cluster 26 and remaining cluster 27 items.

### Canonical targets
- `src/shared/validation/ajv-factory.js` (new)
- `tools/download/shared-fetch.js` (new)

### Subphase D8.1 — Validation scaffolding consolidation
Tasks:
- [ ] Task D8.1.a: Implement shared Ajv factory for config/contracts/API validators.
Details: Support schema flavor/options required by each caller.
- [ ] Task D8.1.b: Migrate validators to factory.
Details: Keep existing error message contract unless intentionally revised.
- [ ] Task D8.1.c: Remove duplicated Ajv bootstrap logic.

### Subphase D8.2 — Download fetch helper consolidation
Tasks:
- [ ] Task D8.2.a: Implement shared redirect-aware fetch helper.
Details: Include redirect limit, timeout, and deterministic error formatting.
- [ ] Task D8.2.b: Migrate dict and extension download tooling.
Details: Preserve existing auth/env behavior.
- [ ] Task D8.2.c: Remove local duplicated fetch/redirect loops.

### Subphase D8.3 — Final migration lock and docs sync
Tasks:
- [ ] Task D8.3.a: Expand ban manifest to include all migrated symbols/modules.
Details: No unresolved temporary exceptions.
- [ ] Task D8.3.b: Run full docs/contracts/config command docs sync.
Details: `docs/guides/commands.md`, config schema/inventory, relevant contracts.
- [ ] Task D8.3.c: Ensure CI includes dupemap audit + representative lanes.
Details: include ci-lite and ci-long execution points.

### Tests
- [ ] `tests/shared/validation/ajv-factory-contract.test.js` (new)
- [ ] `tests/tooling/download/shared-fetch-contract.test.js` (new)
- [ ] tooling docs tests updated and passing
- [ ] final `dupemap-legacy-usage-ban` suite passing

### Exit criteria
- [ ] All roadmap clusters resolved or explicitly accepted with written rationale.
- [ ] CI blocks reintroduction of legacy duplicates.
- [ ] Phase is ready to move to `COMPLETED_PHASES.md` on completion commit.

---

## Per-phase validation cadence

For each phase D1–D8:
- [ ] Run phase-targeted tests individually first.
- [ ] Run affected lane subset (`ci-lite` minimum).
- [ ] Run `node tools/dupemap/audit-legacy-usage.js --fail-on-hit`.
- [ ] Update migration manifest and ban patterns.
- [ ] Update phase checkboxes only when code+tests are committed.

---

## Final acceptance

- [ ] All duplication clusters from `duplication_consolidation_report.md` are resolved or formally accepted with rationale.
- [ ] No banned legacy duplicate usages remain.
- [ ] API/MCP/search normalization is parity-tested.
- [ ] Build/retrieval/storage parity tests pass for consolidated helpers.
- [ ] Test harness duplication is reduced without loss of coverage.
- [ ] Docs/contracts/config references reflect canonical implementations.

---

## Post-close follow-ups

- [ ] Add clone-diff trend report artifact in CI.
- [ ] Add ownership metadata for shared helpers.
- [ ] Add PR checklist item for duplicate-helper prevention.
