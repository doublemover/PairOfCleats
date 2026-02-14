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

## Feature definition standards
- Every feature task must explicitly state:
  - behavior change
  - deterministic constraints (ordering/identity/output shape)
  - fallback and failure behavior (including reason/error codes when applicable)
  - config/docs/contracts that must change with code
- Avoid ambiguous language like `optimize`, `fast`, or `improve` without naming the exact mechanism.
- Tasks that introduce knobs must define defaults and safe bounds in the same subphase.

## Test definition standards
- Every test listed in this roadmap must validate:
  - setup/fixture (including capability gating when relevant)
  - expected behavior/result shape
  - determinism or parity (same input -> same output)
- For error/fallback features, tests must assert the explicit reason/error code.
- Conditional tests must assert deterministic skip behavior and skip reason.
- Throughput-focused tests should use fixed fixtures and simple before/after stage checks; avoid heavyweight benchmarking as a gate.
- If a test item has no sub-bullets, it still inherits these requirements.

## Ordered execution map
1. Phase 16 - Release and platform baseline.
2. Phase 17 - Document ingestion and prose retrieval correctness.
3. Phase 18 - Vector-only index profile and strict compatibility.
4. Phase 19 - Lexicon-aware retrieval enrichment and ANN safety.
5. Phase 20 - Index build and embedding throughput fast path.
6. Phase 21 - Terminal-owned TUI and supervisor architecture.
7. Track IQ - Intent-aware retrieval and confidence.
8. Track OP - Operational reliability basics.

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
- [x] Add `src/index/extractors/pdf.js`:
  - [x] `extractPdf({ filePath, buffer }) -> { ok:true, pages:[{ pageNumber, text }], warnings:[] } | { ok:false, reason, warnings:[] }`
- [x] Add `src/index/extractors/docx.js`:
  - [x] `extractDocx({ filePath, buffer }) -> { ok:true, paragraphs:[{ index, text, style? }], warnings:[] } | { ok:false, reason, warnings:[] }`
- [x] Optional dependency loading policy:
  - [x] PDF load order: `pdfjs-dist/legacy/build/pdf.js|pdf.mjs`, then `pdfjs-dist/build/pdf.js`, then `pdfjs-dist`.
  - [x] DOCX load order: `mammoth` primary, `docx` fallback.
- [x] Capability checks must confirm real loadability, not only package presence.
- [x] Normalize extracted units:
  - [x] newline normalization to `\n`
  - [x] deterministic whitespace policy
  - [x] deterministic ordering
- [x] Add extraction security guards:
  - [x] `maxBytesPerFile` default `64MB`
  - [x] `maxPages` default `5000`
  - [x] `extractTimeoutMs` default `15000`
  - [x] explicit reason codes (`unsupported_encrypted`, `unsupported_scanned`, `oversize`, `extract_timeout`, `missing_dependency`, `extract_failed`)
- [x] Record extractor identity details in build state:
  - [x] extractor name and version
  - [x] source bytes hash
  - [x] unit counts

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
- [x] `tests/indexing/extracted-prose/pdf-missing-dep-skips.test.js`
- [x] `tests/indexing/extracted-prose/docx-missing-dep-skips.test.js`
- [x] `tests/indexing/extracted-prose/pdf-smoke.test.js` (conditional)
- [x] `tests/indexing/extracted-prose/docx-smoke.test.js` (conditional)
- [x] `tests/indexing/extracted-prose/document-extractor-version-recorded.test.js`
- [x] `tests/indexing/extracted-prose/document-extraction-checksums-and-counts.test.js`
- [x] `tests/indexing/extracted-prose/document-security-guardrails.test.js`

### 17.2 Deterministic chunking and anchor contract

#### Objective
Provide deterministic page/paragraph-aware chunking with explicit budgets and stable anchors.

#### Tasks
- [x] Add `src/index/chunking/formats/pdf.js`:
  - [x] default one chunk per page
  - [x] deterministic adjacent page grouping for tiny pages
  - [x] segment provenance `{ type:'pdf', pageStart, pageEnd, anchor }`
- [x] Add `src/index/chunking/formats/docx.js`:
  - [x] group paragraphs by budget
  - [x] deterministic tiny paragraph merges
  - [x] preserve heading boundaries when style is present
  - [x] segment provenance `{ type:'docx', paragraphStart, paragraphEnd, headingPath?, anchor }`
  - [x] explicit boundary labels when merged
- [x] Add deterministic adaptive splitting for oversized segments.
- [x] Publish hard defaults:
  - [x] `maxCharsPerChunk = 2400`
  - [x] `minCharsPerChunk = 400`
  - [x] `maxTokensPerChunk = 700` (if token budget path is active)
- [x] Define anchor algorithm exactly:
  - [x] `anchor = "<type>:<start>-<end>:<sha256(normalizedTextSlice).slice(0,12)>"`
  - [x] same input always produces same anchor cross-platform.
- [x] Optimize limit logic in `src/index/chunking/limits.js` to avoid quadratic behavior.

#### Touchpoints
- `src/index/chunking/formats/pdf.js` (new)
- `src/index/chunking/formats/docx.js` (new)
- `src/index/chunking/limits.js`
- `docs/specs/document-extraction.md`

#### Tests
- [x] `tests/indexing/chunking/pdf-chunking-deterministic.test.js`
- [x] `tests/indexing/chunking/docx-chunking-deterministic.test.js`
- [x] `tests/indexing/chunking/document-anchor-stability.test.js`
- [x] `tests/perf/chunking/chunking-limits-large-input.test.js`

### 17.3 Build pipeline integration and extraction report contract

#### Objective
Integrate extraction as a deterministic pre-index stage with explicit diagnostics and artifact reporting.

#### Tasks
- [x] Discovery gating:
  - [x] only include `.pdf`/`.docx` when `indexing.documentExtraction.enabled=true`
  - [x] if enabled but unavailable, record typed skip diagnostics
- [x] Treat extraction as explicit pre-index stage before chunking.
- [x] Route extractable binaries away from generic binary skip logic.
- [x] File processing flow must:
  - [x] hash raw bytes
  - [x] extract units
  - [x] create stable joined text with offset mapping
  - [x] chunk through document format chunkers
  - [x] emit `segment` provenance
  - [x] ensure chunk IDs cannot collide with code chunk IDs
- [x] Emit `extraction_report.json` with schema version:
  - [x] counts by status
  - [x] per-file status and reason
  - [x] extractor versions
  - [x] `extractionIdentityHash`
- [x] Define identity formula and publish it:
  - [x] `extractionIdentityHash = sha256(bytesHash + extractorVersion + normalizationPolicy + chunkerVersion + extractionConfigDigest)`

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
- [x] `tests/indexing/extracted-prose/documents-included-when-available.test.js`
- [x] `tests/indexing/extracted-prose/documents-skipped-when-unavailable.test.js`
- [x] `tests/indexing/extracted-prose/document-extraction-outcomes-recorded.test.js`
- [x] `tests/indexing/extracted-prose/extraction-report.test.js`
- [x] `tests/indexing/extracted-prose/document-bytes-hash-stable.test.js`
- [x] `tests/indexing/extracted-prose/document-chunk-id-no-collision.test.js`

### 17.4 `metaV2` and `chunk_meta` contract updates

#### Objective
Version metadata for extracted documents with stable forward/backward behavior.

#### Tasks
- [x] Extend metadata with `segment` block:
  - [x] `sourceType: 'pdf'|'docx'`
  - [x] `pageStart/pageEnd` (PDF)
  - [x] `paragraphStart/paragraphEnd` (DOCX)
  - [x] optional `headingPath`
  - [x] optional `windowIndex`
  - [x] required stable `anchor`
- [x] Set `metaV2.schemaVersion = 3`.
- [x] Ensure `chunk_meta.jsonl` parity between artifact and SQLite-backed paths.
- [x] Reader behavior contract:
  - [x] readers ignore unknown fields
  - [x] versioned normalization for old shapes
  - [x] publish compatibility examples in docs

#### Touchpoints
- `src/index/metadata-v2.js`
- `src/index/build/file-processor/assemble.js`
- retrieval loaders using metaV2
- `src/contracts/schemas/artifacts.js`
- `src/contracts/validators/artifacts.js`
- `docs/contracts/artifact-contract.md`

#### Tests
- [x] `tests/indexing/metav2/metaV2-extracted-doc.test.js`
- [x] `tests/indexing/metav2/metaV2-unknown-fields-ignored.test.js`
- [x] `tests/services/sqlite-hydration-metaV2-parity.test.js`
- [x] `tests/indexing/metav2/metaV2-backcompat-v2-reader.test.js`

### 17.5 Prose routing defaults and FTS AST compilation

#### Objective
Make routing and FTS query compilation deterministic, explainable, and safe.

#### Tasks
- [x] Routing defaults:
  - [x] prose and extracted-prose -> SQLite FTS
  - [x] code -> sparse/postings
  - [x] overrides are explicit and visible in `--explain`
- [x] Enforce routing model:
  - [x] desired policy and actual availability are separate
  - [x] deterministic fallback order is fixed and documented
- [x] FTS query compilation:
  - [x] compile from query AST (or validated parsed representation)
  - [x] escape punctuation and keywords safely
  - [x] emit final `MATCH` string in explain
- [x] Provider variant precedence (fixed):
  1. [x] if explicit `--fts-trigram`, use trigram
  2. [x] else if query contains CJK/emoji or substring mode, use trigram
  3. [x] else if Latin script and stemming override enabled, use porter
  4. [x] else use `unicode61 remove_diacritics 2`
  5. [x] apply NFKC normalized query path when normalization changes input and include reason in explain
- [x] Merge multi-variant results deterministically:
  - [x] primary by fused score descending
  - [x] tie-break by `chunkUid` ascending
- [x] Missing FTS tables must return controlled availability outcomes, not throw.

#### Touchpoints
- `src/retrieval/pipeline.js`
- `src/retrieval/query.js`
- `src/retrieval/query-parse.js`
- `src/retrieval/sqlite-helpers.js`
- `src/retrieval/sqlite-cache.js`
- `src/retrieval/output/explain.js`
- `docs/specs/prose-routing.md`

#### Tests
- [x] `tests/retrieval/backend/search-routing-policy.test.js`
  - [x] Prose defaults to FTS and code defaults to sparse/postings with clear explain trace.
- [x] `tests/retrieval/query/sqlite-fts-query-escape.test.js`
  - [x] Escaping prevents operator injection and preserves literal punctuation intent.
- [x] `tests/retrieval/backend/fts-tokenizer-config.test.js`
  - [x] Tokenizer variant config and diacritic behavior match documented defaults.
- [x] `tests/retrieval/backend/fts-missing-table-fallback.test.js`
  - [x] Missing table path returns controlled availability outcome (no throw).
- [x] `tests/retrieval/backend/fts-variant-selection-precedence.test.js`
  - [x] Variant selection order follows the documented precedence table exactly.

### 17.6 Retrieval helper correctness hardening

#### Objective
Fix helper-level correctness risks with explicit bounds and deterministic behavior.

#### Tasks
- [x] Every fix must include a regression test.
- [x] `rankSqliteFts()` allowed ID correctness:
  - [x] support adaptive overfetch and/or chunked pushdown
  - [x] ensure true top-N among allowed IDs
  - [x] enforce hard caps:
    - [x] `overfetchRowCap = max(5000, 10 * topN)`
    - [x] `overfetchTimeBudgetMs = 150`
- [x] Ranking correctness:
  - [x] apply weighting before final limit
  - [x] publish stable tie-break rules
- [x] `unpackUint32()` alignment safety:
  - [x] use aligned copy or `DataView` path on unaligned buffers
- [x] Missing table handling:
  - [x] controlled error/warning code `retrieval_fts_unavailable`
  - [x] no throws past provider boundary

#### Touchpoints
- `src/retrieval/sqlite-helpers.js`
- `src/retrieval/output/explain.js`

#### Tests
- [x] `tests/retrieval/backend/rankSqliteFts-allowedIds-correctness.test.js`
- [x] `tests/retrieval/backend/rankSqliteFts-weight-before-limit.test.js`
- [x] `tests/retrieval/backend/rankSqliteFts-missing-table-is-controlled-error.test.js`
- [x] `tests/retrieval/backend/unpackUint32-buffer-alignment.test.js`
- [x] `tests/retrieval/backend/rankSqliteFts-overfetch-cap-budget.test.js`

### 17.7 Query intent and boolean semantics

#### Objective
Fix intent and boolean semantics without regressions and make behavior explainable.

#### Tasks
- [x] Replace slash-only path heuristic with explicit path-like features.
- [x] Treat URLs as URL intent, not path intent.
- [x] Prefer grammar-first parse; fallback heuristics only on parser failure.
- [x] Emit final intent and fallback reason in explain.
- [x] Boolean parsing semantics:
  - [x] unary `-` acts as NOT with whitespace
  - [x] standalone `-` returns parse error
  - [x] phrase escaping behavior is explicitly documented
  - [x] inventory token lists cannot be mistaken as semantic constraints
- [x] Add a golden query corpus and lock behavior snapshots.

#### Touchpoints
- `src/retrieval/query-intent.js`
- `src/retrieval/query.js`
- `src/retrieval/output/explain.js`
- `tests/retrieval/query/golden/` (new)

#### Tests
- [x] `tests/retrieval/query/query-intent-path-heuristics.test.js`
- [x] `tests/retrieval/query/boolean-unary-not-whitespace.test.js`
- [x] `tests/retrieval/query/boolean-inventory-vs-semantics.test.js`
- [x] `tests/retrieval/query/golden-query-corpus.test.js`

### 17.8 Output contract parity and tooling harness alignment

#### Objective
Stabilize output schemas and keep CI harnesses aligned with declared command surfaces.

#### Tasks
- [x] Standardize `scoreBreakdown` shape across providers.
- [x] Add `scoreBreakdown.schemaVersion`.
- [x] Enforce one shared output budget policy (`maxBytes`, `maxFields`, `maxExplainItems`).
- [x] Ensure explain includes:
  - [x] routing decision and reason path
  - [x] compiled FTS `MATCH` string
  - [x] provider variants used
  - [x] capability gating outcomes
- [x] Move script-coverage drift work into a dedicated tooling lane and align `covers` entries with `package.json`.

#### Touchpoints
- `src/retrieval/output/*`
- `tests/tooling/script-coverage/*`
- `package.json`
- `docs/testing/truth-table.md`

#### Tests
- [x] `tests/retrieval/contracts/score-breakdown-contract-parity.test.js`
- [x] `tests/retrieval/contracts/score-breakdown-snapshots.test.js`
- [x] `tests/retrieval/contracts/score-breakdown-budget-limits.test.js`
- [x] `tests/retrieval/output/explain-output-includes-routing-and-fts-match.test.js`
- [x] `tests/tooling/script-coverage/harness-parity.test.js`

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
- [x] Add config enum `indexing.profile: default | vector_only` (default `default`).
- [x] Reject unknown profile values during config normalization.
- [x] Add `profile` block in `index_state.json`:
  - [x] `profile.id`
  - [x] `profile.schemaVersion = 1`
- [x] Add `artifacts` block in `index_state.json`:
  - [x] `schemaVersion = 1`
  - [x] `present` map
  - [x] `omitted` array
  - [x] `requiredForSearch` array
- [x] Add canonical JSON examples for both profiles in docs.
- [x] Include profile block in build-state/build reports for traceability.
- [x] Include `profile.id` and `profile.schemaVersion` in compatibility and signature keys.

#### Touchpoints
- `docs/config/schema.json`
- `src/index/build/runtime/runtime.js`
- `src/index/build/indexer/signatures.js`
- `src/index/build/artifacts.js`
- `src/retrieval/cli/index-state.js`
- `src/contracts/schemas/artifacts.js`
- `src/contracts/validators/artifacts.js`

#### Tests
- [x] `tests/indexing/contracts/profile-index-state-contract.test.js`
- [x] `tests/indexing/contracts/profile-artifacts-present-omitted-consistency.test.js`
- [x] `tests/indexing/contracts/profile-index-state-has-required-artifacts.test.js`

### 18.2 Build gating, sparse omission, and safe cleanup

#### Objective
Skip sparse generation cleanly for vector-only builds and remove stale sparse outputs safely.

#### Tasks
- [x] Thread `profile.id` through pipeline feature settings.
- [x] In `vector_only`, disable tokenize/postings stages.
- [x] Reject vector-only build when embeddings are unavailable.
- [x] Enforce strict denylist for sparse artifacts in vector-only output.
- [x] Safe cleanup policy:
  - [x] only delete allowlisted sparse artifact filenames in managed outDir
  - [x] never recursively delete unknown files
  - [x] log cleanup actions in build report
- [x] Preserve missing embedding marker convention (zero-length typed array).

#### Touchpoints
- `src/index/build/indexer/pipeline.js`
- `src/index/build/indexer/steps/postings.js`
- `src/index/build/indexer/steps/write.js`
- `src/index/build/artifacts.js`
- `src/index/build/file-processor/embeddings.js`
- `src/index/validate.js`
- `src/index/validate/artifacts.js`

#### Tests
- [x] `tests/indexing/postings/vector-only-does-not-emit-sparse.test.js`
- [x] `tests/indexing/postings/vector-only-switching-cleans-stale-sparse.test.js`
- [x] `tests/indexing/postings/vector-only-missing-embeddings-is-error.test.js`
- [x] `tests/indexing/postings/vector-only-cleanup-allowlist-safety.test.js`

### 18.3 Search routing and strict mismatch policy

#### Objective
Make query-time behavior profile-aware with one clear policy and explicit override.

#### Policy decision
- Default is `reject` for sparse-dependent query features against vector-only indexes.
- Explicit override is `--allow-sparse-fallback` / `allowSparseFallback`.

#### Tasks
- [x] Load profile early in retrieval path.
- [x] If index profile is `vector_only`:
  - [x] choose ANN/vector providers by default
  - [x] mark sparse providers unavailable
- [x] If user requests sparse-only behavior against vector-only:
  - [x] return controlled error with rebuild guidance
- [x] Add provider boundary table checks (`requireTables`) and controlled errors.
- [x] Ensure CLI/API/MCP policy parity for reject/override behavior.
- [x] Surface profile and mismatch details in explain output.

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
- [x] `tests/retrieval/backend/vector-only-search-requires-ann.test.js`
  - [x] Vector-only index selects ANN path by default and errors if ANN provider unavailable.
- [x] `tests/retrieval/backend/vector-only-rejects-sparse-mode.test.js`
  - [x] Sparse-dependent mode is rejected by default with actionable guidance.
- [x] `tests/retrieval/backend/sqlite-missing-sparse-tables-is-controlled-error.test.js`
  - [x] Missing sparse tables return controlled mismatch error, not an exception crash.
- [x] `tests/retrieval/output/explain-vector-only-warnings.test.js`
  - [x] Explain output includes profile, mismatch reason, and override guidance.

### 18.4 Legacy migration and federation compatibility

#### Objective
Handle old indexes and mixed-profile cohorts deterministically.

#### Tasks
- [x] Legacy index without profile block:
  - [x] normalize to `default` at read time
  - [x] emit compatibility warning once per process
- [x] Mixed profile cohorts:
  - [x] reject by default
- [x] allow only with explicit opt-in and explain warning
- [x] Publish migration guide from old index_state shapes.

#### Touchpoints
- `src/retrieval/cli/index-loader.js`
- `src/retrieval/cli/index-state.js`
- `src/retrieval/cli/load-indexes.js`
- `src/index/build/indexer/signatures.js`
- `docs/specs/federation-cohorts.md`

#### Tests
- [x] `tests/retrieval/backend/vector-only-compatibility-key-mismatch.test.js`
- [x] `tests/retrieval/backend/legacy-index-without-profile-normalizes-default.test.js`
- [x] `tests/retrieval/backend/mixed-profile-cohort-opt-in.test.js`

### 18.5 Optional analysis shortcuts for vector-only builds (stretch)

#### Objective
Optionally reduce build time for vector-only workflows while preserving transparency.

#### Tasks
- [x] Add policy flags to disable expensive analysis passes when `profile=vector_only`.
- [x] Keep each disabled feature opt-outable and report choices in build report.
- [x] Keep this subphase non-blocking to core phase exit.

#### Touchpoints
- `src/index/build/indexer/pipeline.js`
- `docs/config/*`

#### Tests
- [x] `tests/indexing/postings/vector-only-analysis-shortcuts-policy.test.js`

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
- [x] Add config keys and defaults for:
  - [x] `indexing.lexicon.enabled`
  - [x] `indexing.postings.chargramFields`
  - [x] `indexing.postings.chargramStopwords`
  - [x] `retrieval.annCandidateCap`
  - [x] `retrieval.annCandidateMinDocCount`
  - [x] `retrieval.annCandidateMaxDocCount`
  - [x] `retrieval.relationBoost` (if exposed)
- [x] Publish versioning rules for lexicon wordlists and explain payload.
- [x] Add tooling:
  - [x] `tools/lexicon/validate.js`
  - [x] `tools/lexicon/report.js`
  - [x] `npm run lexicon:validate`
  - [x] `npm run lexicon:report`
- [x] Add explicit v2 deferral note for non-ASCII lexicon support.
- [x] Include new config knobs in incremental signature payload.
- [x] Move old lexicon draft/spec docs to `docs/archived/` with replacement pointers to canonical 19.x specs.

#### Touchpoints
- `src/shared/postings-config.js`
- `src/retrieval/cli/normalize-options.js`
- `src/index/build/indexer/signatures.js`
- `src/contracts/registry.js`
- `src/contracts/schemas/*`
- `src/contracts/validators/*`

#### Tests
- [x] `tests/indexer/incremental/signature-lexicon-config.test.js`
- [x] `tests/config/config-inventory-lexicon-keys.test.js`
- [x] `tests/config/config-defaults-lexicon-flags.test.js`
- [x] `tests/lexicon/lexicon-tool-validate.test.js`
- [x] `tests/lexicon/lexicon-report.test.js`

### 19.1 Lexicon assets and loader

#### Objective
Provide canonical wordlists, strict validation, deterministic normalization, and cached loading.

#### Tasks
- [x] Implement:
  - [x] `getLanguageLexicon(languageId, { allowFallback })`
  - [x] `isLexiconStopword(languageId, token, domain)`
  - [x] `extractSymbolBaseName(name)` with fixed separator behavior
- [x] Wordlist schema requirements:
  - [x] required: `formatVersion=1`, `languageId`, `keywords[]`, `literals[]`
  - [x] optional: `types[]`, `builtins[]`, `modules[]`, `notes[]`
  - [x] `additionalProperties=false`
- [x] Loader behavior:
  - [x] resolve via `import.meta.url`
  - [x] cache via `Map<languageId, LanguageLexicon>`
  - [x] fail-open to `_generic`
  - [x] one structured warning per invalid file
- [x] Keep a practical language coverage pass:
  - [x] add language-specific wordlists where obvious value exists
  - [x] rely on `_generic` fallback for the rest until needed
- [x] Keep JS/TS keyword sets conservative to avoid property-name over-filtering.

#### Touchpoints
- `src/lang/lexicon/index.js` (new)
- `src/lang/lexicon/load.js` (new)
- `src/lang/lexicon/normalize.js` (new)
- `src/lang/lexicon/wordlists/_generic.json`
- `src/lang/lexicon/wordlists/<languageId>.json`
- `src/index/language-registry/registry-data.js`

#### Tests
- [x] `tests/lexicon/lexicon-schema.test.js`
- [x] `tests/lexicon/lexicon-loads-all-languages.test.js`
- [x] `tests/lexicon/lexicon-stopwords.test.js`
- [x] `tests/lexicon/lexicon-fallback.test.js`
- [x] `tests/lexicon/extract-symbol-base-name.test.js`
- [x] `tests/lexicon/lexicon-ascii-only.test.js`
- [x] `tests/lexicon/lexicon-per-language-overrides.test.js`

### 19.2 Build-time lexicon relation filtering

#### Objective
Filter noisy relation tokens at build time only, preserving stable ordering and conservative behavior.

#### Tasks
- [x] Add `filterRawRelationsWithLexicon(rawRelations, { languageId, lexicon, config, log })`.
- [x] Apply filter right before relation index construction.
- [x] Filter scope in v1:
  - [x] `usages`
  - [x] `calls`
  - [x] `callDetails`
  - [x] `callDetailsWithRange`
  - [x] do not filter `imports/exports`
- [x] Preserve stable ordering; stable de-dupe only when explicitly enabled.
- [x] Override precedence (fixed):
  1. [x] global config
  2. [x] language override file
  3. [x] built-in defaults
- [x] Ensure incremental signatures include lexicon/filter controls.

#### Touchpoints
- `src/index/build/file-processor/cpu.js`
- `src/index/build/file-processor/relations.js`
- `src/index/build/file-processor/process-chunks.js`
- `src/index/build/file-processor/lexicon-relations-filter.js` (new)
- `src/retrieval/output/filters.js`

#### Tests
- [x] `tests/file-processor/lexicon-relations-filter.test.js`
- [x] `tests/file-processor/lexicon-relations-filter-ordering.test.js`
- [x] `tests/file-processor/lexicon-relations-filter-keyword-property.test.js`
- [x] `tests/file-processor/lexicon-relations-filter-no-imports.test.js`
- [x] `tests/file-processor/lexicon-relations-filter-determinism.test.js`
- [x] `tests/retrieval/uses-and-calls-filters-respect-lexicon.test.js`

### 19.3 Retrieval relation boosts (boost-only)

#### Objective
Improve ranking via relation alignment signals without changing filter semantics.

#### Tasks
- [x] Implement `computeRelationBoost({ chunk, fileRelations, queryTokens, lexicon, config })`.
- [x] Use `buildQueryPlan(...)` token output as the sole token source.
- [x] Respect `caseTokens` and `caseFile` semantics.
- [x] Keep boost bounded:
  - [x] `boost = min(maxBoost, callMatches*perCall + usageMatches*perUse)`
  - [x] keep `maxBoost` conservative by default.
- [x] Explain output:
  - [x] include bounded deterministic token lists
  - [x] include units and caps used

#### Touchpoints
- `src/retrieval/pipeline.js`
- `src/retrieval/cli/query-plan.js`
- `src/retrieval/scoring/relation-boost.js` (new)
- `src/retrieval/output/explain.js`

#### Tests
- [x] `tests/retrieval/relation-boost.test.js`
- [x] `tests/retrieval/relation-boost-does-not-filter.test.js`
- [x] `tests/retrieval/relation-boost-case-folding.test.js`
- [x] `tests/retrieval/relation-boost-stopword-elision.test.js`
- [x] `tests/retrieval/relation-boost-cap-relative-to-base.test.js`
- [x] `tests/retrieval/explain-includes-relation-boost.test.js`

### 19.4 Chargram enrichment and ANN candidate safety

#### Objective
Enable optional chargram enrichment and enforce one shared candidate safety policy for ANN and minhash.

#### Tasks
- [x] Extend postings config for `chargramFields` and `chargramStopwords`.
- [x] Support allowed fields: `name`, `signature`, `doc`, `comment`, `body`.
- [x] Apply optional lexicon chargram stopword filtering.
- [x] Implement shared `resolveAnnCandidateSet(...)` policy used by ANN and minhash.
- [x] Candidate policy reason codes:
  - [x] `noCandidates`
  - [x] `tooLarge`
  - [x] `tooSmallNoFilters`
  - [x] `filtersActiveAllowedIdx`
  - [x] `ok`
- [x] Use simple fixed defaults first (`minDocCount=100`, `maxDocCount=20000`) and tune only if needed.
- [x] Emit explain payload with input/output sizes and policy reason.

#### Touchpoints
- `src/shared/postings-config.js`
- `src/index/build/state.js`
- `src/retrieval/pipeline/candidates.js`
- `src/retrieval/pipeline.js`
- `src/retrieval/scoring/ann-candidate-policy.js` (new)

#### Tests
- [x] `tests/postings/chargram-fields.test.js`
- [x] `tests/postings/chargram-stopwords.test.js`
- [x] `tests/retrieval/ann-candidate-policy.test.js`
- [x] `tests/retrieval/ann-candidate-policy-contract.test.js`
- [x] `tests/retrieval/ann-candidate-policy-minhash-parity.test.js`
- [x] `tests/retrieval/ann-candidate-policy-allowedIdx.test.js`
- [x] `tests/retrieval/ann-candidate-policy-explain.test.js`

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
  - [ ] Explain includes relation boost fields, units, and bounded token lists.
- [ ] `tests/retrieval/explain-includes-ann-policy.test.js`
  - [ ] Explain includes ANN candidate policy input/output and reason code.
- [ ] `tests/indexing/logging/lexicon-filter-counts.test.js`
  - [ ] Build logs include deterministic per-file relation filtering counters when enabled.

---

## Phase 20 - Index Build and Embedding Throughput Fast Path

### Objective
Make index builds and embedding generation significantly faster through straightforward, low-risk hot-path optimizations.

### Non-goals
- Changing retrieval semantics or ranking contracts.
- Introducing non-deterministic output ordering.
- Adding heavy benchmark infrastructure as a prerequisite for shipping.

### Execution style for this phase
- Prioritize obvious wins with direct code-path reductions (less repeated work, less sync I/O, less serialization churn).
- Validate with lightweight regression and stage-duration smoke checks on fixed fixtures.

### Exit criteria
- Tree-sitter and file-processing hot paths avoid repeated segmentation and serial planning I/O.
- Discovery and incremental paths stop unnecessary crawl/read work early.
- Embedding pipeline improves throughput by removing avoidable serialization/queue bottlenecks.
- Artifact write path reduces repeated serialization and under-utilized write concurrency.
- Build-state/checkpoint persistence no longer rewrites large payloads unnecessarily.
- Import-resolution and postings-merge paths reuse warm-build state where safe.

### Docs that must be updated
- `docs/perf/indexing-stage-audit.md`
- `docs/perf/index-artifact-pipelines.md`
- `docs/perf/shared-io-serialization.md`
- `docs/specs/build-scheduler.md`
- `docs/specs/artifact-io-pipeline.md`
- `docs/specs/embeddings-cache.md`
- `docs/specs/spimi-spill.md`
- `docs/specs/large-file-caps-strategy.md`
- `docs/specs/build-state-integrity.md`
- `docs/guides/perfplan-execution.md`
- `docs/guides/commands.md`
- `docs/config/schema.json` and `docs/config/contract.md` (if new tuning knobs are added)

### 20.1 Scheduler and segmentation reuse

#### Objective
Remove duplicate tree-sitter segmentation work and reduce serial planning I/O in the scheduler path.

#### Tasks
- [ ] In `processFileCpu`, prefer scheduler-planned segments when available; only fall back to `discoverSegments` when missing or hash-stale.
- [ ] Keep segment UID assignment deterministic after planned-segment reuse.
- [ ] Parallelize `buildTreeSitterSchedulerPlan` per-file `lstat/readTextFileWithHash` work with bounded concurrency.
- [ ] Keep planner output ordering deterministic (`plan.jobs` and index ordering unchanged).

#### Touchpoints
- `src/index/build/file-processor/cpu.js`
- `src/index/build/tree-sitter-scheduler/plan.js`
- `src/index/build/tree-sitter-scheduler/runner.js`
- `src/index/build/runtime/hash.js`

#### Tests
- [ ] `tests/indexing/scheduler/planned-segments-reuse-without-rediscovery.test.js`
  - [ ] Fixture with scheduler-provided segments verifies `discoverSegments` path is not used.
  - [ ] Chunk boundaries/IDs and metadata remain identical to baseline output.
- [ ] `tests/indexing/scheduler/plan-parallel-io-deterministic-order.test.js`
  - [ ] Planner output (`plan.jobs`, file order, signatures) matches sequential mode exactly.
  - [ ] Parallel mode preserves deterministic job ordering across repeated runs.

### 20.2 Discovery and incremental read dedupe

#### Objective
Stop wasted file-system and read/hash work in discovery and incremental cache lookup flows.

#### Tasks
- [ ] Abort discovery crawl as soon as `maxFiles` is satisfied (do not continue full repository traversal).
- [ ] Emit a stable limit reason code (`max_files_reached`) when early-abort is triggered.
- [ ] Share single-file `buffer/hash` between cached bundle and cached imports lookup to avoid duplicate reads.
- [ ] Add streaming truncation path in file reads so oversized files can be capped without full in-memory materialization.
- [ ] Keep skip/limit diagnostics deterministic when early abort paths are active.

#### Touchpoints
- `src/index/build/discover.js`
- `src/index/build/incremental.js`
- `src/index/build/file-processor/read.js`
- `src/index/build/file-scan.js`

#### Tests
- [ ] `tests/indexing/discovery/max-files-abort-crawl.test.js`
  - [ ] With low `maxFiles`, crawler exits early and does not traverse remaining tree.
  - [ ] Skip diagnostics record deterministic limit reason code `max_files_reached`.
- [ ] `tests/indexing/incremental/shared-buffer-hash-for-imports-and-bundle.test.js`
  - [ ] Same file is read once when both bundle/import cache checks require hash.
  - [ ] Import outputs and cache hits remain identical to legacy behavior.
- [ ] `tests/indexing/read/streaming-truncation-byte-cap.test.js`
  - [ ] Streaming-cap path returns the same truncated text as non-streaming baseline.
  - [ ] Memory usage path avoids full-file materialization for oversized fixture.

### 20.3 Embedding pipeline fast path

#### Objective
Increase embedding throughput by parallelizing independent batches and removing cache/write-path bottlenecks.

#### Tasks
- [ ] Dispatch code and doc embedding batches concurrently where backends advertise safe parallelism; otherwise keep deterministic serial path.
- [ ] Add compact cache-entry fingerprint to avoid decompressing full payloads just to compare chunk hashes.
- [ ] Reuse shard append handles during cache flushes to avoid repeated open/stat/close cycles.
- [ ] Move heavy encoding off the writer queue critical section (queue should gate disk I/O, not compression CPU time).
- [ ] Keep embedding cache identity and determinism unchanged.

#### Touchpoints
- `tools/build/embeddings/batch.js`
- `tools/build/embeddings/runner.js`
- `tools/build/embeddings/cache.js`
- `src/index/build/embedding-batch.js`
- `src/index/build/indexer/embedding-queue.js`
- `src/shared/embeddings-cache/*`

#### Tests
- [ ] `tests/embeddings/pipeline/code-doc-batches-parallel-dispatch.test.js`
  - [ ] Code/doc batch dispatches overlap in time when backend supports concurrency.
  - [ ] Result ordering and embedding identity remain deterministic.
- [ ] `tests/embeddings/cache/fingerprint-short-circuit-avoids-decompress.test.js`
  - [ ] Fingerprint mismatch bypasses full payload decompress/read path.
  - [ ] Cache miss/hit decisions remain correct for unchanged hashes.
- [ ] `tests/embeddings/cache/shard-append-handle-reuse.test.js`
  - [ ] Shard appends reuse handles within a flush window (no per-entry reopen loop).
  - [ ] Final shard contents and index pointers remain valid and deterministic.
- [ ] `tests/embeddings/pipeline/writer-queue-encode-off-critical-path.test.js`
  - [ ] Encoding occurs outside queue-gated disk write section.
  - [ ] Queue drains correctly with no lost writes or ordering drift.

### 20.4 Postings and chunking compute reuse

#### Objective
Cut repeated serialization/splitting/allocation work in postings and chunking paths.

#### Tasks
- [ ] Replace per-file payload size estimation by full `JSON.stringify` with precomputed postings payload metadata.
- [ ] Hoist line/byte index computation so chunk format handlers reuse shared indexes instead of rebuilding repeatedly.
- [ ] Reduce per-chunk quantization allocation churn by pooling/reuse where safe and deterministic.
- [ ] Keep retention semantics unchanged while moving quantization/retention work earlier when possible.

#### Touchpoints
- `src/index/build/indexer/steps/process-files/postings-queue.js`
- `src/index/build/file-processor/process-chunks/index.js`
- `src/index/chunking/dispatch.js`
- `src/index/chunking/limits.js`
- `src/index/build/indexer/steps/postings.js`

#### Tests
- [ ] `tests/indexing/postings/payload-estimation-uses-precomputed-metadata.test.js`
  - [ ] Metadata path avoids fallback stringify estimation when metadata is present.
  - [ ] Reserved rows/bytes accounting matches legacy semantics.
- [ ] `tests/indexing/chunking/shared-line-index-reuse-deterministic.test.js`
  - [ ] Shared line/byte index path preserves chunk boundaries/anchors exactly.
  - [ ] Repeated runs produce identical chunk IDs and ordering.
- [ ] `tests/indexing/postings/quantization-buffer-reuse-no-drift.test.js`
  - [ ] Reused/pool buffers produce byte-identical quantized vectors to baseline.
  - [ ] No drift in downstream ranking inputs from quantization reuse.

### 20.5 Artifact write throughput and serialization fanout

#### Objective
Increase artifact write throughput by reducing repeated serialization and better utilizing available I/O concurrency.

#### Tasks
- [ ] Replace hard-capped artifact write concurrency with dynamic default based on available parallelism (`min(availableParallelism, 16)`), with optional config override.
- [ ] Validate override bounds (`1..32`) and reject invalid values with a controlled config error.
- [ ] Serialize `chunk_meta` rows once and fan out to hot/cold/compat/binary outputs from a shared stream.
- [ ] Expand cached JSONL row reuse to avoid repeated stringify for the same row across outputs.
- [ ] Preserve deterministic artifact ordering and checksums.

#### Touchpoints
- `src/index/build/artifacts.js`
- `src/index/build/artifacts/writer.js`
- `src/index/build/artifacts/writers/chunk-meta.js`
- `src/shared/artifact-io/jsonl.js`
- `src/shared/json-stream/*`

#### Tests
- [ ] `tests/indexing/artifacts/dynamic-write-concurrency-preserves-order.test.js`
  - [ ] Different write concurrency settings produce identical artifact manifest ordering.
  - [ ] Checksums remain identical for same inputs.
- [ ] `tests/indexing/artifacts/artifact-write-concurrency-config-validation.test.js`
  - [ ] Invalid override values outside `1..32` fail with controlled config error.
- [ ] `tests/indexing/artifacts/chunk-meta-single-pass-fanout-parity.test.js`
  - [ ] Single-pass fanout outputs match legacy multi-pass outputs byte-for-byte.
  - [ ] Hot/cold/compat/binary sinks stay mutually consistent.
- [ ] `tests/indexing/artifacts/chunk-meta-cached-jsonl-reuse.test.js`
  - [ ] Cached JSONL row reuse path avoids repeat stringify for same row.
  - [ ] Emitted JSONL remains valid and deterministic.

### 20.6 Build-state and checkpoint I/O slimming

#### Objective
Reduce large repeated atomic rewrites in long-running builds.

#### Tasks
- [ ] Move heavy `stageCheckpoints` payloads into dedicated sidecar/checkpoint files so `build_state.json` stays lightweight.
- [ ] Update checkpoint recorder to write changed slices instead of full combined snapshots.
- [ ] Keep the same crash-recovery semantics and deterministic state reconstruction.
- [ ] Use a stable sidecar naming/version convention (`stage_checkpoints.v1.*`) for forward compatibility.

#### Touchpoints
- `src/index/build/build-state.js`
- `src/index/build/stage-checkpoints.js`
- `src/index/build/stage-checkpoints/` (new folder)
- `src/index/build/state.js`

#### Tests
- [ ] `tests/indexing/state/build-state-lightweight-main-file.test.js`
  - [ ] Main `build_state.json` excludes heavy checkpoint payload sections.
  - [ ] Sidecar checkpoint files contain required checkpoint content.
- [ ] `tests/indexing/state/checkpoint-slice-write-and-recover.test.js`
  - [ ] Slice updates reconstruct full checkpoint state deterministically after reload.
  - [ ] Crash-recovery behavior matches previous correctness guarantees.
- [ ] `tests/indexing/state/checkpoint-sidecar-naming-versioned.test.js`
  - [ ] Sidecar files follow stable `stage_checkpoints.v1.*` naming convention.

### 20.7 Import-resolution and postings-merge warm-build reuse

#### Objective
Reuse warm-build metadata for import lookup and spill-merge planning to avoid repeated expensive setup work.

#### Tasks
- [ ] Persist and reuse import lookup structures (`fileSet`/trie/index) between compatible builds using an explicit compatibility fingerprint.
- [ ] Replace repeated synchronous existence/stat checks with batched async metadata lookups where safe.
- [ ] Persist spill-merge planner metadata/checkpoint hints and reuse when inputs are unchanged.
- [ ] Keep merge output deterministic and equivalent to cold planner behavior.

#### Touchpoints
- `src/index/build/import-resolution.js`
- `src/index/build/import-resolution-cache.js`
- `src/index/build/postings.js`
- `src/index/build/indexer/steps/relations.js`
- `tools/bench/index/import-resolution-graph.js`
- `tools/bench/index/postings-real.js`

#### Tests
- [ ] `tests/indexing/imports/warm-lookup-structure-reuse.test.js`
  - [ ] Warm run reuses persisted import lookup structures when compatible.
  - [ ] Import resolution output remains identical to cold rebuild output.
- [ ] `tests/indexing/imports/async-fs-memo-parity.test.js`
  - [ ] Async metadata lookup path matches sync memoized decision parity.
  - [ ] Path existence and resolution outcomes remain deterministic.
- [ ] `tests/indexing/imports/lookup-fingerprint-compatibility-gate.test.js`
  - [ ] Lookup structure reuse occurs only when compatibility fingerprint matches.
- [ ] `tests/indexing/postings/spill-merge-planner-metadata-reuse.test.js`
  - [ ] Reused planner metadata path is taken when inputs are unchanged.
  - [ ] Postings output and merge ordering match cold planner baseline.

---

## Phase 21 - Terminal-Owned TUI and Supervisor Architecture

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

### 21.1 Protocol v2 contract

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
  - [ ] Valid protocol envelopes parse against schema; invalid envelopes fail with stable reason codes.
- [ ] `tests/tui/protocol-v2-ordering.test.js`
  - [ ] Request/response event ordering contract is preserved across repeated runs.

### 21.2 Supervisor lifecycle model

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
  - [ ] State transitions follow allowed graph (`idle -> running -> ...`) with no illegal edges.
- [ ] `tests/tui/supervisor-retry-policy.test.js`
  - [ ] Recoverable failures retry with configured policy; terminal failures stop deterministically.

### 21.3 Cancellation and deadlines

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
  - [ ] Cancellation reaches all active stages and marks outputs as partial consistently.

### 21.4 TUI rendering and responsiveness

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
  - [ ] Rendering loop continues updating while background work is active.
- [ ] `tests/tui/rendering/partial-stream-order.test.js`
  - [ ] Streamed partial output order is deterministic for identical event sequences.

### 21.5 Observability and replay

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
  - [ ] Session/request IDs are present and consistent across emitted events.
- [ ] `tests/tui/observability/replay-determinism.test.js`
  - [ ] Replay of recorded events reproduces the same rendered sequence.

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
- [ ] `tests/retrieval/intent/intent-confidence-calibration.test.js`
  - [ ] Confidence buckets are calibrated against fixture truth labels.
  - [ ] Low-confidence queries trigger abstain path deterministically.

### IQ.2 Multi-hop expansion policy
- [ ] Define bounded expansion depth/width defaults.
- [ ] Add deterministic stop conditions.
- [ ] `tests/retrieval/expansion/multihop-bounded-policy.test.js`
  - [ ] Expansion never exceeds configured depth/width bounds.
  - [ ] Same seed query produces identical expansion graph/order.

### IQ.3 Trust and confidence surfacing
- [ ] Add trust signals to explain payload with versioned schema.
- [ ] Add confidence bucket definitions (`low`, `medium`, `high`).
- [ ] `tests/retrieval/explain/confidence-surface-contract.test.js`
  - [ ] Explain payload includes required trust/confidence fields with schema version.
  - [ ] Unknown forward fields are ignored by readers without parse failure.

### IQ.4 Bundle-style result assembly
- [ ] Define bundle grouping and ordering contract.
- [ ] Add deterministic tie-breakers across bundles.
- [ ] `tests/retrieval/output/bundle-assembly-deterministic.test.js`
  - [ ] Bundle membership and ordering are stable across repeated runs.
  - [ ] Tie-break rules are applied consistently for equal-score cases.

### IQ.5 Evaluation harness
- [ ] Add small fixed fixtures that catch obvious IQ regressions.
- [ ] Keep a lightweight regression test lane for IQ behavior.
- [ ] `tests/retrieval/eval/iq-regression-smoke.test.js`
  - [ ] Fixture suite catches confidence/expansion/bundle regressions in one lane.
  - [ ] Lane output is deterministic and stable enough for CI gating.

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
- [ ] `tests/ops/health-check-contract.test.js`
  - [ ] Health checks surface pass/fail state with stable machine-readable codes.
  - [ ] Log output contains actionable reason and component context.

### OP.2 Failure injection harness
- [ ] Add deterministic failure injection for indexing and retrieval hot paths.
- [ ] Classify failures as retriable/non-retriable.
- [ ] `tests/ops/failure-injection/retrieval-hotpath.test.js`
  - [ ] Injected failures map to expected retriable/non-retriable classes.
  - [ ] Recovery path behavior matches documented policy.

### OP.3 Stable defaults and guardrails
- [ ] Keep operational defaults conservative and explicit.
- [ ] Add guardrails for risky config combinations.
- [ ] `tests/ops/config/guardrails.test.js`
  - [ ] Invalid or risky combinations are rejected with clear error codes.
  - [ ] Safe defaults remain unchanged when optional knobs are absent.

### OP.4 Release blocking essentials
- [ ] Keep only essential reliability checks as release blockers.
- [ ] Document owner and override path for each blocker.
- [ ] `tests/ops/release-gates/essential-blockers.test.js`
  - [ ] Required blockers fail release-check when missing/failing.
  - [ ] Override path requires explicit marker and is audit-visible.

### OP.5 Basic resource visibility
- [ ] Add lightweight visibility for memory and index size growth.
- [ ] Emit warnings for obviously abnormal growth.
- [ ] `tests/ops/resources/basic-growth-warning.test.js`
  - [ ] Resource growth warnings trigger on controlled abnormal fixtures.
  - [ ] Normal fixture runs stay below warning thresholds.

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
  - [ ] Harness verifies native and JS paths return equivalent ranked outputs on seed fixtures.
  - [ ] Capability detection falls back to JS path without behavior drift.

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
  - [ ] Native bitmap set operations (`and/or/andNot`) match JS results exactly.
- [ ] `tests/retrieval/native/capability-fallback.test.js`
  - [ ] Missing native module triggers JS fallback with identical observable behavior.

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
  - [ ] Native top-k output ordering matches JS baseline including tie-breaks.
- [ ] `tests/retrieval/native/topk-adversarial-tie-parity.test.js`
  - [ ] Adversarial equal-score fixtures preserve deterministic tie ordering.
- [ ] `tests/retrieval/native/capability-fallback.test.js`
  - [ ] Fallback path parity holds for top-k and score accumulation.

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
  - [ ] ANN candidate/output parity matches JS backend for same index/query fixtures.
- [ ] `tests/retrieval/native/ann-preflight-error-taxonomy.test.js`
  - [ ] Preflight rejects invalid configs with exact taxonomy codes.
- [ ] `tests/retrieval/native/capability-fallback.test.js`
  - [ ] ANN path falls back cleanly when native backend is unavailable.

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
  - [ ] Worker-offloaded pipeline returns same outputs/order as single-thread baseline.
- [ ] `tests/retrieval/native/worker-cancel.test.js`
  - [ ] Cancellation propagates across worker boundaries and halts work deterministically.

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
  - [ ] Build/install-time missing native toolchains keep default JS path functional.

---

## Completion policy
- Checkboxes are completed only when code, docs, and tests for that item are landed together.
- Test checkboxes are completed only after the test has run and passed.
- If a test fix fails 3 times, log attempts and move to the next unresolved test.
- When a phase is complete, move it to `COMPLETED_PHASES.md` per repo process.
- Keep roadmap touchpoints current as files move; update touched paths in `SKYMAP.md` in the same change.
- When spec names/locations change, add replacement pointers and archive superseded spec docs under `docs/archived/`.
