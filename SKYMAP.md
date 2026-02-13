# SKYMAP

## Roadmap rules
- This roadmap is the canonical execution plan for upcoming phases.
- Every subphase follows the same shape: Objective, Tasks, Touchpoints, Tests, Exit checks.
- Every subphase must keep touchpoints current as files move or are renamed.
- Every phase must list canonical docs/specs that are required to stay in sync.
- Any behavior change must update contracts/docs/tests in the same subphase before it is checked off.
- Determinism is required: stable ordering, stable IDs, stable explain output, and stable failure codes.
- Prefer the simplest implementation that satisfies the contract.
- For performance work, require obvious wins and lightweight regression checks first; only add deep measurement work if regressions or unclear tradeoffs appear.
- Security and scope limits are explicit for document extraction:
  - No OCR support.
  - No scanned-image PDF support.
  - No encrypted or password-protected document support.
  - No macro-enabled document execution or evaluation.
- Backward compatibility policy:
  - Readers must ignore unknown forward fields.
  - Writers must bump versioned schema fields when shape meaning changes.

## Ordered execution map
1. Phase 16 - Release and platform baseline.
2. Phase 17 - Document ingestion and prose retrieval correctness.
3. Phase 18 - Vector-only index profile and strict compatibility.
4. Phase 19 - Lexicon-aware retrieval enrichment and ANN safety.
5. Phase 20 - Terminal-owned TUI and supervisor architecture.
6. Track IQ - Intent-aware retrieval and confidence.
7. Track OP - Operational reliability basics.

---

## Phase 16 - Release and Platform Baseline

### Objective
Make releases deterministic and supportable across target platforms before deeper retrieval/indexing changes land.

### Non-goals
- Adding new retrieval semantics.
- Adding new indexing formats.

### Exit criteria
- A documented release matrix exists (platform x Node version x optional dependency policy).
- `release-check` exists, is deterministic, and runs both locally and in CI.
- Paths with spaces and Windows semantics are covered with regression tests.
- Sublime and VS Code package outputs are reproducible.
- Python-dependent tests skip cleanly when Python is unavailable and still fail correctly when Python is present.
- CI blocking policy is explicit per job.

### Docs that must be updated
- `docs/guides/release-discipline.md`
- `docs/guides/commands.md`
- `docs/guides/editor-integration.md`
- `docs/guides/service-mode.md`
- `docs/guides/path-handling.md`
- `docs/config/schema.json` and `docs/config/contract.md` (if flags are added)
- `docs/testing/truth-table.md`
- `docs/testing/ci-capability-policy.md`

### 16.1 Release matrix and support policy

#### Objective
Define exactly what is supported and what blocks release.

#### Tasks
- [ ] Add `docs/guides/release-matrix.md` with:
  - [ ] Supported OS list (Windows/macOS/Linux) and minimum versions.
  - [ ] Supported Node majors/minors.
  - [ ] Optional dependency expectations by target.
  - [ ] Blocking vs advisory jobs per target.
- [ ] Define support tiers (`tier1`, `tier2`, `best_effort`) and publish ownership expectations.
- [ ] Define a deterministic failure taxonomy for release jobs (`infra_flake`, `product_regression`, `toolchain_missing`).

#### Touchpoints
- `docs/guides/release-matrix.md` (new)
- `docs/guides/release-discipline.md`
- `.github/workflows/ci.yml`
- `.github/workflows/ci-long.yml`
- `.github/workflows/nightly.yml`

#### Tests
- [ ] `tests/tooling/release-matrix-schema.test.js`
- [ ] `tests/tooling/release-matrix-blocking-policy.test.js`

### 16.2 Deterministic `release-check` command

#### Objective
Create one command that validates basic release viability without hidden environment assumptions.

#### Tasks
- [ ] Add `node tools/release-check.js` and wire `npm run release-check`.
- [ ] Required checks (fixed order):
  - [ ] `pairofcleats --version`
  - [ ] fixture `index build`
  - [ ] fixture `index validate`
  - [ ] fixture `search`
  - [ ] editor package smoke checks (when toolchains are present)
- [ ] Emit machine-readable JSON summary (`release_check_report.json`) with `schemaVersion`.
- [ ] Add `--strict` and `--allow-missing-toolchains` modes.
- [ ] Ensure timestamps in report are ISO 8601.

#### Touchpoints
- `tools/release-check.js` (new)
- `package.json`
- `src/retrieval/cli/*` (if command wiring changes)

#### Tests
- [ ] `tests/tooling/release-check/smoke.test.js`
- [ ] `tests/tooling/release-check/report-schema.test.js`
- [ ] `tests/tooling/release-check/deterministic-order.test.js`

### 16.3 Cross-platform path safety and spaces

#### Objective
Guarantee path handling works on Windows and POSIX, including spaces and separator edge cases.

#### Tasks
- [ ] Audit CLI/build/search path joins and normalization sites.
- [ ] Replace brittle string concatenation with path-safe helpers.
- [ ] Add explicit tests for:
  - [ ] spaces in repo root
  - [ ] spaces in outDir
  - [ ] Windows drive-letter paths
  - [ ] mixed slash inputs from user args
  - [ ] UNC path handling policy
- [ ] Document canonical internal path normalization rules.

#### Touchpoints
- `src/shared/path-utils.js` (new or extend)
- `src/index/build/*`
- `src/retrieval/cli/*`

#### Tests
- [ ] `tests/paths/windows-spaces-index-build.test.js`
- [ ] `tests/paths/windows-drive-letter-normalization.test.js`
- [ ] `tests/paths/mixed-separators-cli.test.js`

### 16.4 Reproducible editor package outputs

#### Objective
Ensure editor integrations package deterministically and can be validated in CI.

#### Tasks
- [ ] Add packaging scripts for Sublime and VS Code with deterministic file ordering.
- [ ] Stamp package metadata from one canonical version source.
- [ ] Validate archive structure and required files.
- [ ] Define non-blocking behavior when VS Code packaging toolchain is absent.

#### Touchpoints
- `tools/package-sublime.js` (new or extend)
- `tools/package-vscode.js` (new or extend)
- `extensions/`
- `sublime/`

#### Tests
- [ ] `tests/tooling/package-sublime-structure.test.js`
- [ ] `tests/tooling/package-sublime-reproducible.test.js`
- [ ] `tests/tooling/package-vscode-structure.test.js`
- [ ] `tests/tooling/package-vscode-toolchain-missing-policy.test.js`

### 16.5 Optional Python capability model

#### Objective
Stop false-red CI failures when Python is absent while preserving strong checks when it is present.

#### Tasks
- [ ] Add a single Python capability probe helper and use it across tests/tools.
- [ ] Standardize skip reason codes and messages.
- [ ] Ensure all Python-dependent tests are capability-gated and skip deterministically.
- [ ] Ensure syntax/behavior tests run and fail normally when Python is present.

#### Touchpoints
- `src/shared/capabilities.js`
- `tests/*` Python-dependent lanes

#### Tests
- [ ] `tests/tooling/python/skip-when-missing.test.js`
- [ ] `tests/tooling/python/run-when-present.test.js`
- [ ] `tests/tooling/python/skip-reason-contract.test.js`

### 16.6 CI gate policy and release enforcement

#### Objective
Make release gating rules explicit and machine-checkable.

#### Tasks
- [ ] Add `docs/guides/ci-gate-policy.md` defining:
  - [ ] required blocking jobs
  - [ ] advisory jobs
  - [ ] retry policy by failure taxonomy
- [ ] Add a CI summary checker that fails if required jobs are missing.
- [ ] Add release checklist artifact upload policy.

#### Touchpoints
- `docs/guides/ci-gate-policy.md` (new)
- `.github/workflows/ci.yml`
- `.github/workflows/ci-long.yml`
- `.github/workflows/nightly.yml`
- `tools/release-check.js`

#### Tests
- [ ] `tests/tooling/ci-gates-required-jobs.test.js`
- [ ] `tests/tooling/ci-gates-failure-taxonomy.test.js`

---

## Phase 17 - Document Ingestion and Prose Retrieval Correctness

### Objective
Deliver deterministic PDF/DOCX ingestion and safe prose routing with strict contracts and controlled failure behavior.

### Non-goals
- OCR extraction.
- Scanned-image extraction.
- Encrypted/password-protected documents.
- Macro-enabled document execution.

### Hard decisions for this phase
- Provenance field name is `segment` (not `document`).
- New metadata shape is versioned via `metaV2.schemaVersion = 3`.
- Query features that need sparse inventory in vector-only mode default to `reject`.
- FTS provider selection precedence is fixed and documented (see 17.5).

### Exit criteria
- PDF/DOCX ingest deterministically when optional deps are available.
- Missing deps never fail builds; they produce typed per-file skip reasons.
- `extraction_report.json` is emitted and schema-valid.
- Prose routes to FTS by default with explainable AST-driven MATCH output.
- Retrieval helpers are hardened (`allowedIds`, weighting-before-limit, missing tables, alignment safety).
- `scoreBreakdown` contract is consistent across providers with a schema version.

### Docs that must be updated
- `docs/contracts/indexing.md`
- `docs/contracts/artifact-contract.md`
- `docs/contracts/chunking.md`
- `docs/contracts/retrieval-ranking.md`
- `docs/config/schema.json`
- `docs/config/contract.md`
- `docs/config/inventory.md`
- `docs/config/inventory-notes.md`
- `docs/guides/commands.md`
- `docs/testing/truth-table.md`
- `docs/specs/document-extraction.md` (new canonical)
- `docs/specs/prose-routing.md` (new canonical)
- `docs/specs/metadata-schema-v2.md`
- `docs/specs/deterministic-ordering.md`
- `docs/sqlite/index-schema.md`

### 17.1 Extractors, capability gating, and extraction security policy

#### Objective
Implement PDF/DOCX extractors as optional capabilities with deterministic typed outputs.

#### Tasks
- [ ] Add `src/index/extractors/pdf.js`:
  - [ ] `extractPdf({ filePath, buffer }) -> { ok:true, pages:[{ pageNumber, text }], warnings:[] } | { ok:false, reason, warnings:[] }`
- [ ] Add `src/index/extractors/docx.js`:
  - [ ] `extractDocx({ filePath, buffer }) -> { ok:true, paragraphs:[{ index, text, style? }], warnings:[] } | { ok:false, reason, warnings:[] }`
- [ ] Optional dependency loading policy:
  - [ ] PDF load order: `pdfjs-dist/legacy/build/pdf.js|pdf.mjs`, then `pdfjs-dist/build/pdf.js`, then `pdfjs-dist`.
  - [ ] DOCX load order: `mammoth` primary, `docx` fallback.
- [ ] Capability checks must confirm real loadability, not only package presence.
- [ ] Normalize extracted units:
  - [ ] newline normalization to `\n`
  - [ ] deterministic whitespace policy
  - [ ] deterministic ordering
- [ ] Add extraction security guards:
  - [ ] `maxBytesPerFile` default `64MB`
  - [ ] `maxPages` default `5000`
  - [ ] `extractTimeoutMs` default `15000`
  - [ ] explicit reason codes (`unsupported_encrypted`, `unsupported_scanned`, `oversize`, `extract_timeout`, `missing_dependency`, `extract_failed`)
- [ ] Record extractor identity details in build state:
  - [ ] extractor name and version
  - [ ] source bytes hash
  - [ ] unit counts

#### Touchpoints
- `src/index/extractors/pdf.js` (new)
- `src/index/extractors/docx.js` (new)
- `src/shared/capabilities.js`
- `src/shared/optional-deps.js`
- `tools/bench/micro/extractors.js`
- `src/index/build/build-state.js`
- `src/contracts/schemas/build-state.js`
- `src/contracts/validators/build-state.js`

#### Tests
- [ ] `tests/indexing/extracted-prose/pdf-missing-dep-skips.test.js`
- [ ] `tests/indexing/extracted-prose/docx-missing-dep-skips.test.js`
- [ ] `tests/indexing/extracted-prose/pdf-smoke.test.js` (conditional)
- [ ] `tests/indexing/extracted-prose/docx-smoke.test.js` (conditional)
- [ ] `tests/indexing/extracted-prose/document-extractor-version-recorded.test.js`
- [ ] `tests/indexing/extracted-prose/document-extraction-checksums-and-counts.test.js`
- [ ] `tests/indexing/extracted-prose/document-security-guardrails.test.js`

### 17.2 Deterministic chunking and anchor contract

#### Objective
Provide deterministic page/paragraph-aware chunking with explicit budgets and stable anchors.

#### Tasks
- [ ] Add `src/index/chunking/formats/pdf.js`:
  - [ ] default one chunk per page
  - [ ] deterministic adjacent page grouping for tiny pages
  - [ ] segment provenance `{ type:'pdf', pageStart, pageEnd, anchor }`
- [ ] Add `src/index/chunking/formats/docx.js`:
  - [ ] group paragraphs by budget
  - [ ] deterministic tiny paragraph merges
  - [ ] preserve heading boundaries when style is present
  - [ ] segment provenance `{ type:'docx', paragraphStart, paragraphEnd, headingPath?, anchor }`
  - [ ] explicit boundary labels when merged
- [ ] Add deterministic adaptive splitting for oversized segments.
- [ ] Publish hard defaults:
  - [ ] `maxCharsPerChunk = 2400`
  - [ ] `minCharsPerChunk = 400`
  - [ ] `maxTokensPerChunk = 700` (if token budget path is active)
- [ ] Define anchor algorithm exactly:
  - [ ] `anchor = "<type>:<start>-<end>:<sha256(normalizedTextSlice).slice(0,12)>"`
  - [ ] same input always produces same anchor cross-platform.
- [ ] Optimize limit logic in `src/index/chunking/limits.js` to avoid quadratic behavior.

#### Touchpoints
- `src/index/chunking/formats/pdf.js` (new)
- `src/index/chunking/formats/docx.js` (new)
- `src/index/chunking/limits.js`
- `docs/specs/document-extraction.md`

#### Tests
- [ ] `tests/indexing/chunking/pdf-chunking-deterministic.test.js`
- [ ] `tests/indexing/chunking/docx-chunking-deterministic.test.js`
- [ ] `tests/indexing/chunking/document-anchor-stability.test.js`
- [ ] `tests/perf/chunking/chunking-limits-large-input.test.js`

### 17.3 Build pipeline integration and extraction report contract

#### Objective
Integrate extraction as a deterministic pre-index stage with explicit diagnostics and artifact reporting.

#### Tasks
- [ ] Discovery gating:
  - [ ] only include `.pdf`/`.docx` when `indexing.documentExtraction.enabled=true`
  - [ ] if enabled but unavailable, record typed skip diagnostics
- [ ] Treat extraction as explicit pre-index stage before chunking.
- [ ] Route extractable binaries away from generic binary skip logic.
- [ ] File processing flow must:
  - [ ] hash raw bytes
  - [ ] extract units
  - [ ] create stable joined text with offset mapping
  - [ ] chunk through document format chunkers
  - [ ] emit `segment` provenance
  - [ ] ensure chunk IDs cannot collide with code chunk IDs
- [ ] Emit `extraction_report.json` with schema version:
  - [ ] counts by status
  - [ ] per-file status and reason
  - [ ] extractor versions
  - [ ] `extractionIdentityHash`
- [ ] Define identity formula and publish it:
  - [ ] `extractionIdentityHash = sha256(bytesHash + extractorVersion + normalizationPolicy + chunkerVersion + extractionConfigDigest)`

#### Touchpoints
- `src/index/build/discover.js`
- `src/index/build/file-processor/skip.js`
- `src/index/build/file-processor.js`
- `src/index/build/file-processor/assemble.js`
- `src/index/chunking/dispatch.js`
- `src/index/build/artifacts.js`
- `src/contracts/schemas/artifacts.js`
- `src/contracts/validators/artifacts.js`
- `docs/specs/document-extraction.md`

#### Tests
- [ ] `tests/indexing/extracted-prose/documents-included-when-available.test.js`
- [ ] `tests/indexing/extracted-prose/documents-skipped-when-unavailable.test.js`
- [ ] `tests/indexing/extracted-prose/document-extraction-outcomes-recorded.test.js`
- [ ] `tests/indexing/extracted-prose/extraction-report.test.js`
- [ ] `tests/indexing/extracted-prose/document-bytes-hash-stable.test.js`
- [ ] `tests/indexing/extracted-prose/document-chunk-id-no-collision.test.js`

### 17.4 `metaV2` and `chunk_meta` contract updates

#### Objective
Version metadata for extracted documents with stable forward/backward behavior.

#### Tasks
- [ ] Extend metadata with `segment` block:
  - [ ] `sourceType: 'pdf'|'docx'`
  - [ ] `pageStart/pageEnd` (PDF)
  - [ ] `paragraphStart/paragraphEnd` (DOCX)
  - [ ] optional `headingPath`
  - [ ] optional `windowIndex`
  - [ ] required stable `anchor`
- [ ] Set `metaV2.schemaVersion = 3`.
- [ ] Ensure `chunk_meta.jsonl` parity between artifact and SQLite-backed paths.
- [ ] Reader behavior contract:
  - [ ] readers ignore unknown fields
  - [ ] versioned normalization for old shapes
  - [ ] publish compatibility examples in docs

#### Touchpoints
- `src/index/metadata-v2.js`
- `src/index/build/file-processor/assemble.js`
- retrieval loaders using metaV2
- `src/contracts/schemas/artifacts.js`
- `src/contracts/validators/artifacts.js`
- `docs/contracts/artifact-contract.md`

#### Tests
- [ ] `tests/indexing/metav2/metaV2-extracted-doc.test.js`
- [ ] `tests/indexing/metav2/metaV2-unknown-fields-ignored.test.js`
- [ ] `tests/services/sqlite-hydration-metaV2-parity.test.js`
- [ ] `tests/indexing/metav2/metaV2-backcompat-v2-reader.test.js`

### 17.5 Prose routing defaults and FTS AST compilation

#### Objective
Make routing and FTS query compilation deterministic, explainable, and safe.

#### Tasks
- [ ] Routing defaults:
  - [ ] prose and extracted-prose -> SQLite FTS
  - [ ] code -> sparse/postings
  - [ ] overrides are explicit and visible in `--explain`
- [ ] Enforce routing model:
  - [ ] desired policy and actual availability are separate
  - [ ] deterministic fallback order is fixed and documented
- [ ] FTS query compilation:
  - [ ] compile from query AST (or validated parsed representation)
  - [ ] escape punctuation and keywords safely
  - [ ] emit final `MATCH` string in explain
- [ ] Provider variant precedence (fixed):
  1. [ ] if explicit `--fts-trigram`, use trigram
  2. [ ] else if query contains CJK/emoji or substring mode, use trigram
  3. [ ] else if Latin script and stemming override enabled, use porter
  4. [ ] else use `unicode61 remove_diacritics 2`
  5. [ ] apply NFKC normalized query path when normalization changes input and include reason in explain
- [ ] Merge multi-variant results deterministically:
  - [ ] primary by fused score descending
  - [ ] tie-break by `chunkUid` ascending
- [ ] Missing FTS tables must return controlled availability outcomes, not throw.

#### Touchpoints
- `src/retrieval/pipeline.js`
- `src/retrieval/query.js`
- `src/retrieval/query-parse.js`
- `src/retrieval/sqlite-helpers.js`
- `src/retrieval/sqlite-cache.js`
- `src/retrieval/output/explain.js`
- `docs/specs/prose-routing.md`

#### Tests
- [ ] `tests/retrieval/backend/search-routing-policy.test.js`
- [ ] `tests/retrieval/query/sqlite-fts-query-escape.test.js`
- [ ] `tests/retrieval/backend/fts-tokenizer-config.test.js`
- [ ] `tests/retrieval/backend/fts-missing-table-fallback.test.js`
- [ ] `tests/retrieval/backend/fts-variant-selection-precedence.test.js`

### 17.6 Retrieval helper correctness hardening

#### Objective
Fix helper-level correctness risks with explicit bounds and deterministic behavior.

#### Tasks
- [ ] Every fix must include a regression test.
- [ ] `rankSqliteFts()` allowed ID correctness:
  - [ ] support adaptive overfetch and/or chunked pushdown
  - [ ] ensure true top-N among allowed IDs
  - [ ] enforce hard caps:
    - [ ] `overfetchRowCap = max(5000, 10 * topN)`
    - [ ] `overfetchTimeBudgetMs = 150`
- [ ] Ranking correctness:
  - [ ] apply weighting before final limit
  - [ ] publish stable tie-break rules
- [ ] `unpackUint32()` alignment safety:
  - [ ] use aligned copy or `DataView` path on unaligned buffers
- [ ] Missing table handling:
  - [ ] controlled error/warning code `retrieval_fts_unavailable`
  - [ ] no throws past provider boundary

#### Touchpoints
- `src/retrieval/sqlite-helpers.js`
- `src/retrieval/output/explain.js`

#### Tests
- [ ] `tests/retrieval/backend/rankSqliteFts-allowedIds-correctness.test.js`
- [ ] `tests/retrieval/backend/rankSqliteFts-weight-before-limit.test.js`
- [ ] `tests/retrieval/backend/rankSqliteFts-missing-table-is-controlled-error.test.js`
- [ ] `tests/retrieval/backend/unpackUint32-buffer-alignment.test.js`
- [ ] `tests/retrieval/backend/rankSqliteFts-overfetch-cap-budget.test.js`

### 17.7 Query intent and boolean semantics

#### Objective
Fix intent and boolean semantics without regressions and make behavior explainable.

#### Tasks
- [ ] Replace slash-only path heuristic with explicit path-like features.
- [ ] Treat URLs as URL intent, not path intent.
- [ ] Prefer grammar-first parse; fallback heuristics only on parser failure.
- [ ] Emit final intent and fallback reason in explain.
- [ ] Boolean parsing semantics:
  - [ ] unary `-` acts as NOT with whitespace
  - [ ] standalone `-` returns parse error
  - [ ] phrase escaping behavior is explicitly documented
  - [ ] inventory token lists cannot be mistaken as semantic constraints
- [ ] Add a golden query corpus and lock behavior snapshots.

#### Touchpoints
- `src/retrieval/query-intent.js`
- `src/retrieval/query.js`
- `src/retrieval/output/explain.js`
- `tests/retrieval/query/golden/` (new)

#### Tests
- [ ] `tests/retrieval/query/query-intent-path-heuristics.test.js`
- [ ] `tests/retrieval/query/boolean-unary-not-whitespace.test.js`
- [ ] `tests/retrieval/query/boolean-inventory-vs-semantics.test.js`
- [ ] `tests/retrieval/query/golden-query-corpus.test.js`

### 17.8 Output contract parity and tooling harness alignment

#### Objective
Stabilize output schemas and keep CI harnesses aligned with declared command surfaces.

#### Tasks
- [ ] Standardize `scoreBreakdown` shape across providers.
- [ ] Add `scoreBreakdown.schemaVersion`.
- [ ] Enforce one shared output budget policy (`maxBytes`, `maxFields`, `maxExplainItems`).
- [ ] Ensure explain includes:
  - [ ] routing decision and reason path
  - [ ] compiled FTS `MATCH` string
  - [ ] provider variants used
  - [ ] capability gating outcomes
- [ ] Move script-coverage drift work into a dedicated tooling lane and align `covers` entries with `package.json`.

#### Touchpoints
- `src/retrieval/output/*`
- `tests/tooling/script-coverage/*`
- `package.json`
- `docs/testing/truth-table.md`

#### Tests
- [ ] `tests/retrieval/contracts/score-breakdown-contract-parity.test.js`
- [ ] `tests/retrieval/contracts/score-breakdown-snapshots.test.js`
- [ ] `tests/retrieval/contracts/score-breakdown-budget-limits.test.js`
- [ ] `tests/retrieval/output/explain-output-includes-routing-and-fts-match.test.js`
- [ ] `tests/tooling/script-coverage/harness-parity.test.js`

---

## Phase 18 - Vector-Only Profile and Strict Compatibility

### Objective
Support a true vector-only profile that builds and searches without sparse artifacts, with strict mismatch errors and deterministic migration behavior.

### Non-goals
- Silent fallback to sparse behavior when sparse artifacts are missing.
- Mixing incompatible profile cohorts without explicit override.

### Exit criteria
- `indexing.profile` supports `default | vector_only` with strict validation.
- `vector_only` emits no sparse artifacts and cleans stale sparse files safely.
- Search against `vector_only` defaults to ANN-capable providers.
- Sparse-dependent features reject by default with actionable errors.
- `index_state.json` records profile and artifact presence/omissions/required set.
- Legacy index behavior is documented and tested.

### Docs that must be updated
- `docs/contracts/indexing.md`
- `docs/contracts/artifact-contract.md`
- `docs/contracts/artifact-schemas.md`
- `docs/contracts/compatibility-key.md`
- `docs/contracts/sqlite.md`
- `docs/config/schema.json`
- `docs/config/contract.md`
- `docs/config/inventory.md`
- `docs/guides/commands.md`
- `docs/specs/vector-only-profile.md` (new canonical)
- `docs/specs/signature.md`
- `docs/specs/federation-cohorts.md`
- `docs/sqlite/index-schema.md`

### 18.1 Profile contract and index state schema

#### Objective
Define strict on-disk contract for profile and artifact presence.

#### Tasks
- [ ] Add config enum `indexing.profile: default | vector_only` (default `default`).
- [ ] Reject unknown profile values during config normalization.
- [ ] Add `profile` block in `index_state.json`:
  - [ ] `profile.id`
  - [ ] `profile.schemaVersion = 1`
- [ ] Add `artifacts` block in `index_state.json`:
  - [ ] `schemaVersion = 1`
  - [ ] `present` map
  - [ ] `omitted` array
  - [ ] `requiredForSearch` array
- [ ] Add canonical JSON examples for both profiles in docs.
- [ ] Include profile block in build-state/build reports for traceability.
- [ ] Include `profile.id` and `profile.schemaVersion` in compatibility and signature keys.

#### Touchpoints
- `docs/config/schema.json`
- `src/index/build/runtime/runtime.js`
- `src/index/build/indexer/signatures.js`
- `src/index/build/artifacts.js`
- `src/retrieval/cli/index-state.js`
- `src/contracts/schemas/artifacts.js`
- `src/contracts/validators/artifacts.js`

#### Tests
- [ ] `tests/indexing/contracts/profile-index-state-contract.test.js`
- [ ] `tests/indexing/contracts/profile-artifacts-present-omitted-consistency.test.js`
- [ ] `tests/indexing/contracts/profile-index-state-has-required-artifacts.test.js`

### 18.2 Build gating, sparse omission, and safe cleanup

#### Objective
Skip sparse generation cleanly for vector-only builds and remove stale sparse outputs safely.

#### Tasks
- [ ] Thread `profile.id` through pipeline feature settings.
- [ ] In `vector_only`, disable tokenize/postings stages.
- [ ] Reject vector-only build when embeddings are unavailable.
- [ ] Enforce strict denylist for sparse artifacts in vector-only output.
- [ ] Safe cleanup policy:
  - [ ] only delete allowlisted sparse artifact filenames in managed outDir
  - [ ] never recursively delete unknown files
  - [ ] log cleanup actions in build report
- [ ] Preserve missing embedding marker convention (zero-length typed array).

#### Touchpoints
- `src/index/build/indexer/pipeline.js`
- `src/index/build/indexer/steps/postings.js`
- `src/index/build/indexer/steps/write.js`
- `src/index/build/artifacts.js`
- `src/index/build/file-processor/embeddings.js`
- `src/index/validate.js`
- `src/index/validate/artifacts.js`

#### Tests
- [ ] `tests/indexing/postings/vector-only-does-not-emit-sparse.test.js`
- [ ] `tests/indexing/postings/vector-only-switching-cleans-stale-sparse.test.js`
- [ ] `tests/indexing/postings/vector-only-missing-embeddings-is-error.test.js`
- [ ] `tests/indexing/postings/vector-only-cleanup-allowlist-safety.test.js`

### 18.3 Search routing and strict mismatch policy

#### Objective
Make query-time behavior profile-aware with one clear policy and explicit override.

#### Policy decision
- Default is `reject` for sparse-dependent query features against vector-only indexes.
- Explicit override is `--allow-sparse-fallback` / `allowSparseFallback`.

#### Tasks
- [ ] Load profile early in retrieval path.
- [ ] If index profile is `vector_only`:
  - [ ] choose ANN/vector providers by default
  - [ ] mark sparse providers unavailable
- [ ] If user requests sparse-only behavior against vector-only:
  - [ ] return controlled error with rebuild guidance
- [ ] Add provider boundary table checks (`requireTables`) and controlled errors.
- [ ] Ensure CLI/API/MCP policy parity for reject/override behavior.
- [ ] Surface profile and mismatch details in explain output.

#### Touchpoints
- `src/retrieval/pipeline.js`
- `src/retrieval/cli/load-indexes.js`
- `src/retrieval/cli/index-loader.js`
- `src/retrieval/sqlite-helpers.js`
- `src/retrieval/ann/*`
- `src/retrieval/sparse/*`
- `src/retrieval/output/explain.js`
- `src/retrieval/output/format.js`
- `docs/specs/vector-only-profile.md`

#### Tests
- [ ] `tests/retrieval/backend/vector-only-search-requires-ann.test.js`
- [ ] `tests/retrieval/backend/vector-only-rejects-sparse-mode.test.js`
- [ ] `tests/retrieval/backend/sqlite-missing-sparse-tables-is-controlled-error.test.js`
- [ ] `tests/retrieval/output/explain-vector-only-warnings.test.js`

### 18.4 Legacy migration and federation compatibility

#### Objective
Handle old indexes and mixed-profile cohorts deterministically.

#### Tasks
- [ ] Legacy index without profile block:
  - [ ] normalize to `default` at read time
  - [ ] emit compatibility warning once per process
- [ ] Mixed profile cohorts:
  - [ ] reject by default
- [ ] allow only with explicit opt-in and explain warning
- [ ] Publish migration guide from old index_state shapes.

#### Touchpoints
- `src/retrieval/cli/index-loader.js`
- `src/retrieval/cli/index-state.js`
- `src/retrieval/cli/load-indexes.js`
- `src/index/build/indexer/signatures.js`
- `docs/specs/federation-cohorts.md`

#### Tests
- [ ] `tests/retrieval/backend/vector-only-compatibility-key-mismatch.test.js`
- [ ] `tests/retrieval/backend/legacy-index-without-profile-normalizes-default.test.js`
- [ ] `tests/retrieval/backend/mixed-profile-cohort-opt-in.test.js`

### 18.5 Optional analysis shortcuts for vector-only builds (stretch)

#### Objective
Optionally reduce build time for vector-only workflows while preserving transparency.

#### Tasks
- [ ] Add policy flags to disable expensive analysis passes when `profile=vector_only`.
- [ ] Keep each disabled feature opt-outable and report choices in build report.
- [ ] Keep this subphase non-blocking to core phase exit.

#### Touchpoints
- `src/index/build/indexer/pipeline.js`
- `docs/config/*`

---

## Phase 19 - Lexicon-Aware Retrieval Enrichment and ANN Safety

### Objective
Deliver lexicon-aware relation filtering and boosts, chargram enrichment, and ANN candidate safety with deterministic contracts and safe defaults.

### Non-goals
- Non-ASCII keyword support in v1 lexicon format.
- Retrieval-time relation filtering (boost-only at retrieval time).
- ANN ranking semantic changes beyond candidate safety.

### Authoritative defaults and policy table

| Feature | Default | Quality gate | Fail mode |
|---|---|---|---|
| Lexicon loader | on | none | fail-open with `_generic` |
| Build-time relation filtering | off | auto-on at `quality=max` | fail-open |
| Retrieval relation boost | off | explicit enable | disabled path |
| Chargram enrichment | off | explicit enable | disabled path |
| ANN candidate safety policy | on | none | deterministic policy |
| Global lexicon switch | on | none | `indexing.lexicon.enabled=false` disables all lexicon features |

### Exit criteria
- Lexicon schema and loader are stable and fail-open.
- Build-time relation filtering is deterministic and conservative.
- Retrieval relation boosts are boost-only and bounded.
- ANN/minhash candidate safety policy is unified and explainable.
- Signature/cache behavior reflects new config knobs.
- Feature-flag behavior and basic explain/log visibility are documented.

### Docs that must be updated
- `docs/config/schema.json`
- `docs/config/contract.md`
- `docs/config/inventory.md`
- `docs/config/inventory-notes.md`
- `docs/specs/language-lexicon-wordlists.md`
- `docs/specs/lexicon-relations-filtering.md`
- `docs/specs/lexicon-retrieval-boosts.md`
- `docs/specs/chargram-enrichment-and-ann-fallback.md`
- `docs/contracts/artifact-contract.md`
- `docs/contracts/retrieval-ranking.md`
- `docs/contracts/search-contract.md`

### 19.0 Cross-cutting contracts, config, and tooling

#### Objective
Lock contract surfaces before implementation.

#### Tasks
- [ ] Add config keys and defaults for:
  - [ ] `indexing.lexicon.enabled`
  - [ ] `indexing.postings.chargramFields`
  - [ ] `indexing.postings.chargramStopwords`
  - [ ] `retrieval.annCandidateCap`
  - [ ] `retrieval.annCandidateMinDocCount`
  - [ ] `retrieval.annCandidateMaxDocCount`
  - [ ] `retrieval.relationBoost` (if exposed)
- [ ] Publish versioning rules for lexicon wordlists and explain payload.
- [ ] Add tooling:
  - [ ] `tools/lexicon/validate.js`
  - [ ] `tools/lexicon/report.js`
  - [ ] `npm run lexicon:validate`
  - [ ] `npm run lexicon:report`
- [ ] Add explicit v2 deferral note for non-ASCII lexicon support.
- [ ] Include new config knobs in incremental signature payload.
- [ ] Move old lexicon draft/spec docs to `docs/archived/` with replacement pointers to canonical 19.x specs.

#### Touchpoints
- `src/shared/postings-config.js`
- `src/retrieval/cli/normalize-options.js`
- `src/index/build/indexer/signatures.js`
- `src/contracts/registry.js`
- `src/contracts/schemas/*`
- `src/contracts/validators/*`

#### Tests
- [ ] `tests/indexer/incremental/signature-lexicon-config.test.js`
- [ ] `tests/config/config-inventory-lexicon-keys.test.js`
- [ ] `tests/config/config-defaults-lexicon-flags.test.js`
- [ ] `tests/lexicon/lexicon-tool-validate.test.js`
- [ ] `tests/lexicon/lexicon-report.test.js`

### 19.1 Lexicon assets and loader

#### Objective
Provide canonical wordlists, strict validation, deterministic normalization, and cached loading.

#### Tasks
- [ ] Implement:
  - [ ] `getLanguageLexicon(languageId, { allowFallback })`
  - [ ] `isLexiconStopword(languageId, token, domain)`
  - [ ] `extractSymbolBaseName(name)` with fixed separator behavior
- [ ] Wordlist schema requirements:
  - [ ] required: `formatVersion=1`, `languageId`, `keywords[]`, `literals[]`
  - [ ] optional: `types[]`, `builtins[]`, `modules[]`, `notes[]`
  - [ ] `additionalProperties=false`
- [ ] Loader behavior:
  - [ ] resolve via `import.meta.url`
  - [ ] cache via `Map<languageId, LanguageLexicon>`
  - [ ] fail-open to `_generic`
  - [ ] one structured warning per invalid file
- [ ] Keep a practical language coverage pass:
  - [ ] add language-specific wordlists where obvious value exists
  - [ ] rely on `_generic` fallback for the rest until needed
- [ ] Keep JS/TS keyword sets conservative to avoid property-name over-filtering.

#### Touchpoints
- `src/lang/lexicon/index.js` (new)
- `src/lang/lexicon/load.js` (new)
- `src/lang/lexicon/normalize.js` (new)
- `src/lang/lexicon/wordlists/_generic.json`
- `src/lang/lexicon/wordlists/<languageId>.json`
- `src/index/language-registry/registry-data.js`

#### Tests
- [ ] `tests/lexicon/lexicon-schema.test.js`
- [ ] `tests/lexicon/lexicon-loads-all-languages.test.js`
- [ ] `tests/lexicon/lexicon-stopwords.test.js`
- [ ] `tests/lexicon/lexicon-fallback.test.js`
- [ ] `tests/lexicon/extract-symbol-base-name.test.js`
- [ ] `tests/lexicon/lexicon-ascii-only.test.js`
- [ ] `tests/lexicon/lexicon-per-language-overrides.test.js`

### 19.2 Build-time lexicon relation filtering

#### Objective
Filter noisy relation tokens at build time only, preserving stable ordering and conservative behavior.

#### Tasks
- [ ] Add `filterRawRelationsWithLexicon(rawRelations, { languageId, lexicon, config, log })`.
- [ ] Apply filter right before relation index construction.
- [ ] Filter scope in v1:
  - [ ] `usages`
  - [ ] `calls`
  - [ ] `callDetails`
  - [ ] `callDetailsWithRange`
  - [ ] do not filter `imports/exports`
- [ ] Preserve stable ordering; stable de-dupe only when explicitly enabled.
- [ ] Override precedence (fixed):
  1. [ ] global config
  2. [ ] language override file
  3. [ ] built-in defaults
- [ ] Ensure incremental signatures include lexicon/filter controls.

#### Touchpoints
- `src/index/build/file-processor/cpu.js`
- `src/index/build/file-processor/relations.js`
- `src/index/build/file-processor/process-chunks.js`
- `src/index/build/file-processor/lexicon-relations-filter.js` (new)
- `src/retrieval/output/filters.js`

#### Tests
- [ ] `tests/file-processor/lexicon-relations-filter.test.js`
- [ ] `tests/file-processor/lexicon-relations-filter-ordering.test.js`
- [ ] `tests/file-processor/lexicon-relations-filter-keyword-property.test.js`
- [ ] `tests/file-processor/lexicon-relations-filter-no-imports.test.js`
- [ ] `tests/file-processor/lexicon-relations-filter-determinism.test.js`
- [ ] `tests/retrieval/uses-and-calls-filters-respect-lexicon.test.js`

### 19.3 Retrieval relation boosts (boost-only)

#### Objective
Improve ranking via relation alignment signals without changing filter semantics.

#### Tasks
- [ ] Implement `computeRelationBoost({ chunk, fileRelations, queryTokens, lexicon, config })`.
- [ ] Use `buildQueryPlan(...)` token output as the sole token source.
- [ ] Respect `caseTokens` and `caseFile` semantics.
- [ ] Keep boost bounded:
  - [ ] `boost = min(maxBoost, callMatches*perCall + usageMatches*perUse)`
  - [ ] keep `maxBoost` conservative by default.
- [ ] Explain output:
  - [ ] include bounded deterministic token lists
  - [ ] include units and caps used

#### Touchpoints
- `src/retrieval/pipeline.js`
- `src/retrieval/cli/query-plan.js`
- `src/retrieval/scoring/relation-boost.js` (new)
- `src/retrieval/output/explain.js`

#### Tests
- [ ] `tests/retrieval/relation-boost.test.js`
- [ ] `tests/retrieval/relation-boost-does-not-filter.test.js`
- [ ] `tests/retrieval/relation-boost-case-folding.test.js`
- [ ] `tests/retrieval/relation-boost-stopword-elision.test.js`
- [ ] `tests/retrieval/relation-boost-cap-relative-to-base.test.js`
- [ ] `tests/retrieval/explain-includes-relation-boost.test.js`

### 19.4 Chargram enrichment and ANN candidate safety

#### Objective
Enable optional chargram enrichment and enforce one shared candidate safety policy for ANN and minhash.

#### Tasks
- [ ] Extend postings config for `chargramFields` and `chargramStopwords`.
- [ ] Support allowed fields: `name`, `signature`, `doc`, `comment`, `body`.
- [ ] Apply optional lexicon chargram stopword filtering.
- [ ] Implement shared `resolveAnnCandidateSet(...)` policy used by ANN and minhash.
- [ ] Candidate policy reason codes:
  - [ ] `noCandidates`
  - [ ] `tooLarge`
  - [ ] `tooSmallNoFilters`
  - [ ] `filtersActiveAllowedIdx`
  - [ ] `ok`
- [ ] Use simple fixed defaults first (`minDocCount=100`, `maxDocCount=20000`) and tune only if needed.
- [ ] Emit explain payload with input/output sizes and policy reason.

#### Touchpoints
- `src/shared/postings-config.js`
- `src/index/build/state.js`
- `src/retrieval/pipeline/candidates.js`
- `src/retrieval/pipeline.js`
- `src/retrieval/scoring/ann-candidate-policy.js` (new)

#### Tests
- [ ] `tests/postings/chargram-fields.test.js`
- [ ] `tests/postings/chargram-stopwords.test.js`
- [ ] `tests/retrieval/ann-candidate-policy.test.js`
- [ ] `tests/retrieval/ann-candidate-policy-contract.test.js`
- [ ] `tests/retrieval/ann-candidate-policy-minhash-parity.test.js`
- [ ] `tests/retrieval/ann-candidate-policy-allowedIdx.test.js`
- [ ] `tests/retrieval/ann-candidate-policy-explain.test.js`

### 19.5 Observability and simple rollout

#### Objective
Make lexicon and candidate-policy behavior transparent and easy to enable safely.

#### Tasks
- [ ] Emit per-file relation filtering counters in build logs and structured report.
- [ ] Add explain sections for `relationBoost` and `annCandidatePolicy`.
- [ ] Add lexicon status in explain:
  - [ ] source file
  - [ ] format version
  - [ ] domain token counts
- [ ] Keep new behavior behind straightforward feature flags.
- [ ] Enable per repo/team in small steps and revert by toggling flags if issues appear.

#### Touchpoints
- `src/index/build/file-processor/cpu.js`
- `src/retrieval/pipeline.js`
- `src/retrieval/output/explain.js`
- `src/retrieval/output/format.js`
- `src/shared/auto-policy.js`
- `docs/testing/truth-table.md`

#### Tests
- [ ] `tests/retrieval/explain-includes-relation-boost.test.js`
- [ ] `tests/retrieval/explain-includes-ann-policy.test.js`
- [ ] `tests/indexing/logging/lexicon-filter-counts.test.js`

---

## Phase 20 - Terminal-Owned TUI and Supervisor Architecture

### Objective
Deliver a terminal-owned TUI and supervisor model with protocol v2, deterministic orchestration, and cancellation guarantees.

### Non-goals
- Replacing core retrieval/index contracts defined in prior phases.
- Introducing non-deterministic orchestration behavior.

### Exit criteria
- Protocol v2 is versioned and documented.
- Supervisor handles lifecycle, retries, and cancellation deterministically.
- TUI remains responsive under heavy operations.
- Logs/traces are replayable and correlated by request/session IDs.

### Docs that must be updated
- `docs/specs/progress-protocol-v2.md`
- `docs/specs/node-supervisor-protocol.md`
- `docs/specs/tui-tool-contract.md`
- `docs/specs/tui-installation.md`
- `docs/guides/service-mode.md`
- `docs/guides/commands.md`
- `docs/contracts/search-contract.md`
- `docs/contracts/mcp-api.md`

### 20.1 Protocol v2 contract

#### Tasks
- [ ] Define message schema with `schemaVersion`.
- [ ] Define request/response event order guarantees.
- [ ] Define capability negotiation for optional features.
- [ ] Define error taxonomy and stable codes.

#### Touchpoints
- `src/shared/cli/progress-events.js`
- `src/shared/progress.js`
- `src/integrations/mcp/protocol.js`
- `src/integrations/mcp/defs.js`

#### Tests
- [ ] `tests/tui/protocol-v2-schema.test.js`
- [ ] `tests/tui/protocol-v2-ordering.test.js`

### 20.2 Supervisor lifecycle model

#### Tasks
- [ ] Implement supervisor states (`idle`, `running`, `cancelling`, `failed`, `completed`).
- [ ] Define retry policy and backoff for recoverable failures.
- [ ] Ensure child process cleanup is deterministic.
- [ ] Add structured lifecycle events.

#### Touchpoints
- `src/retrieval/cli/runner.js`
- `src/retrieval/cli/search-runner.js`
- `src/retrieval/cli/run-search-session.js`
- `src/shared/cli/noop-task.js`

#### Tests
- [ ] `tests/tui/supervisor-lifecycle-state-machine.test.js`
- [ ] `tests/tui/supervisor-retry-policy.test.js`

### 20.3 Cancellation and deadlines

#### Tasks
- [ ] Propagate cancellation tokens and deadlines through all stages.
- [ ] Ensure partial outputs are flagged as partial and deterministic.

#### Touchpoints
- `src/retrieval/cli/run-search-session.js`
- `src/retrieval/cli/runner.js`
- `src/shared/cli/display/progress.js`
- `src/integrations/core/build-index/progress.js`

#### Tests
- [ ] `tests/tui/cancel-propagation.test.js`

### 20.4 TUI rendering and responsiveness

#### Tasks
- [ ] Keep rendering on main terminal loop; move heavy compute off UI path.
- [ ] Add bounded update cadence and batching.
- [ ] Ensure accessibility fallback mode for low-capability terminals.

#### Touchpoints
- `src/shared/cli/display/render.js`
- `src/shared/cli/display/terminal.js`
- `src/shared/cli/display/text.js`
- `src/shared/cli/display/colors.js`

#### Tests
- [ ] `tests/tui/rendering/responsiveness-under-load.test.js`
- [ ] `tests/tui/rendering/partial-stream-order.test.js`

### 20.5 Observability and replay

#### Tasks
- [ ] Add request/session IDs across supervisor and worker stages.
- [ ] Emit replayable event log format.
- [ ] Add tooling to replay and diff runs.

#### Touchpoints
- `src/retrieval/cli/telemetry.js`
- `src/retrieval/cli/persist.js`
- `src/shared/bench-progress.js`
- `docs/guides/metrics-dashboard.md`

#### Tests
- [ ] `tests/tui/observability/session-correlation.test.js`
- [ ] `tests/tui/observability/replay-determinism.test.js`

---

## Track IQ - Intent-Aware Retrieval and Confidence

### Objective
Incrementally improve intent understanding, multi-hop expansion, confidence estimation, and bundle-style result assembly.

### Docs that must be updated
- `docs/contracts/retrieval-ranking.md`
- `docs/contracts/search-contract.md`
- `docs/specs/graph-ranking.md`
- `docs/specs/graph-explainability.md`
- `docs/specs/context-packs.md`

### Primary touchpoints
- `src/retrieval/pipeline.js`
- `src/retrieval/pipeline/graph-ranking.js`
- `src/retrieval/query-intent.js`
- `src/retrieval/cli/query-plan.js`
- `src/retrieval/output/explain.js`
- `src/retrieval/output/format.js`

### IQ.1 Intent confidence calibration
- [ ] Add calibrated confidence outputs per intent class.
- [ ] Add abstain/uncertain state for low-confidence cases.
- [ ] Tests: `tests/retrieval/intent/intent-confidence-calibration.test.js`

### IQ.2 Multi-hop expansion policy
- [ ] Define bounded expansion depth/width defaults.
- [ ] Add deterministic stop conditions.
- [ ] Tests: `tests/retrieval/expansion/multihop-bounded-policy.test.js`

### IQ.3 Trust and confidence surfacing
- [ ] Add trust signals to explain payload with versioned schema.
- [ ] Add confidence bucket definitions (`low`, `medium`, `high`).
- [ ] Tests: `tests/retrieval/explain/confidence-surface-contract.test.js`

### IQ.4 Bundle-style result assembly
- [ ] Define bundle grouping and ordering contract.
- [ ] Add deterministic tie-breakers across bundles.
- [ ] Tests: `tests/retrieval/output/bundle-assembly-deterministic.test.js`

### IQ.5 Evaluation harness
- [ ] Add small fixed fixtures that catch obvious IQ regressions.
- [ ] Keep a lightweight regression test lane for IQ behavior.
- [ ] Tests: `tests/retrieval/eval/iq-regression-smoke.test.js`

---

## Track OP - Operational Reliability Basics

### Objective
Keep runtime behavior stable and failure handling clear without adding heavy operational machinery.

### Docs that must be updated
- `docs/guides/release-discipline.md`
- `docs/guides/metrics-dashboard.md`
- `docs/guides/service-mode.md`
- `docs/testing/truth-table.md`
- `docs/specs/runtime-envelope.md`

### Primary touchpoints
- `src/index/build/indexer/pipeline.js`
- `src/retrieval/cli/runner.js`
- `src/retrieval/cli/telemetry.js`
- `src/shared/capabilities.js`
- `tools/release-check.js`
- `.github/workflows/ci.yml`

### OP.1 Health checks and clear logs
- [ ] Add practical health checks for core indexing and retrieval paths.
- [ ] Ensure logs clearly identify failure type and likely next action.
- [ ] Tests: `tests/ops/health-check-contract.test.js`

### OP.2 Failure injection harness
- [ ] Add deterministic failure injection for indexing and retrieval hot paths.
- [ ] Classify failures as retriable/non-retriable.
- [ ] Tests: `tests/ops/failure-injection/retrieval-hotpath.test.js`

### OP.3 Stable defaults and guardrails
- [ ] Keep operational defaults conservative and explicit.
- [ ] Add guardrails for risky config combinations.
- [ ] Tests: `tests/ops/config/guardrails.test.js`

### OP.4 Release blocking essentials
- [ ] Keep only essential reliability checks as release blockers.
- [ ] Document owner and override path for each blocker.
- [ ] Tests: `tests/ops/release-gates/essential-blockers.test.js`

### OP.5 Basic resource visibility
- [ ] Add lightweight visibility for memory and index size growth.
- [ ] Emit warnings for obviously abnormal growth.
- [ ] Tests: `tests/ops/resources/basic-growth-warning.test.js`

---

## Optional Exploration - Native/WASM Acceleration (What If We Didnt Need Shoes)

### Objective
Evaluate optional native/WASM acceleration for hot paths with strict correctness parity and clean JS fallback behavior.

### Non-goals
- Mandatory native dependencies.
- Functional semantic changes vs JS baseline.

### Docs that must be updated
- `docs/specs/native-accel.md` (new canonical)
- `docs/perf/native-accel.md` (new)
- `docs/guides/commands.md`
- `docs/contracts/retrieval-ranking.md`

### Stage order (required)
1. Subphase 0 - Feasibility gate.
2. Subphase A - Bitmap engine.
3. Subphase B - Top-K and score accumulation.
4. Subphase C - ANN acceleration and preflight.
5. Subphase D - Worker-thread offload.
6. Subphase E - Build and release strategy.

### Subphase 0 - Feasibility gate

#### Tasks
- [ ] Select ABI strategy (Node-API, WASM, or hybrid).
- [ ] Define a small parity harness for critical paths.
- [ ] Publish a short design note with fallback behavior.

#### Touchpoints
- `src/shared/native-accel.js` (new)
- `src/shared/capabilities.js`
- `docs/specs/native-accel.md`
- `tools/build-native.js` (new)

#### Tests
- [ ] `tests/retrieval/native/feasibility-parity-harness.test.js`

### Subphase A - Native bitmap engine

#### Tasks
- [ ] Add optional bitmap module with `and/or/andNot`.
- [ ] Keep stable JS fallback shim.
- [ ] Preserve deterministic iteration ordering.

#### Touchpoints
- `src/retrieval/bitmap.js`
- `src/retrieval/filters.js`
- `src/retrieval/filter-index.js`
- `src/shared/native-accel.js` (new)

#### Tests
- [ ] `tests/retrieval/native/bitmap-equivalence.test.js`
- [ ] `tests/retrieval/native/capability-fallback.test.js`

### Subphase B - Native top-K and score accumulation

#### Tasks
- [ ] Add native top-K with stable tie-break behavior.
- [ ] Add native score accumulation buffers.
- [ ] Add adversarial tie-case parity fixtures.

#### Touchpoints
- `src/retrieval/pipeline/candidates.js`
- `src/retrieval/pipeline/fusion.js`
- `src/retrieval/rankers.js`
- `src/shared/native-accel.js` (new)

#### Tests
- [ ] `tests/retrieval/native/topk-equivalence.test.js`
- [ ] `tests/retrieval/native/topk-adversarial-tie-parity.test.js`
- [ ] `tests/retrieval/native/capability-fallback.test.js`

### Subphase C - ANN acceleration and preflight

#### Tasks
- [ ] Add optional ANN acceleration backend.
- [ ] Add preflight error taxonomy and stable codes:
  - [ ] `dims_mismatch`
  - [ ] `metric_mismatch`
  - [ ] `index_corrupt`
- [ ] Keep JS ANN fallback with identical semantics.

#### Touchpoints
- `src/retrieval/ann/providers/`
- `src/retrieval/pipeline/candidates.js`
- `src/shared/native-accel.js` (new)
- `docs/specs/native-accel.md`

#### Tests
- [ ] `tests/retrieval/native/ann-equivalence.test.js`
- [ ] `tests/retrieval/native/ann-preflight-error-taxonomy.test.js`
- [ ] `tests/retrieval/native/capability-fallback.test.js`

### Subphase D - Worker-thread pipeline offload

#### Tasks
- [ ] Move heavy retrieval stages to worker pool.
- [ ] Add shared memory arenas where safe.
- [ ] Propagate cancellation/deadlines across worker boundaries.

#### Touchpoints
- `src/retrieval/pipeline.js`
- `src/retrieval/pipeline/candidates.js`
- `src/retrieval/pipeline/fusion.js`
- `src/shared/worker-pool.js` (new or extend)

#### Tests
- [ ] `tests/retrieval/native/worker-offload-equivalence.test.js`
- [ ] `tests/retrieval/native/worker-cancel.test.js`

### Subphase E - Build and release strategy

#### Tasks
- [ ] Add optional deterministic native build steps.
- [ ] Add capability diagnostics and troubleshooting docs.
- [ ] Define CI behavior when native toolchains are absent.
- [ ] Keep native path non-blocking by default.

#### Touchpoints
- `tools/build-native.js` (new)
- `package.json`
- `.github/workflows/ci.yml`
- `docs/perf/native-accel.md`

#### Tests
- [ ] `tests/retrieval/native/capability-fallback.test.js`

---

## Completion policy
- Checkboxes are completed only when code, docs, and tests for that item are landed together.
- Test checkboxes are completed only after the test has run and passed.
- If a test fix fails 3 times, log attempts and move to the next unresolved test.
- When a phase is complete, move it to `COMPLETED_PHASES.md` per repo process.
- Keep roadmap touchpoints current as files move; update touched paths in `SKYMAP.md` in the same change.
- When spec names/locations change, add replacement pointers and archive superseded spec docs under `docs/archived/`.
