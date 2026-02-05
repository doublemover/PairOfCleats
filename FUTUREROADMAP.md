# PairOfCleats FutureRoadmap

## Status legend

Checkboxes represent the state of the work, update them to reflect the state of work as its being done:
- [x] Implemented and appears complete/correct based on code inspection and existing test coverage
- [@] In Progress, this work has been started
- [.] Work has been completed but has Not been tested
- [?] There is a correctness gap **or** there is missing/insufficient test proving behavior
- [ ] Not complete

Completed Phases: `COMPLETED_PHASES.md`

## Roadmap List
### Features
- Phase 16 -- Prose Ingestion + Retrieval Routing Correctness (PDF/DOCX + FTS policy)
- Phase 17 -- Vector-Only Profile (Embeddings-First, Build + Search w/o Sparse Postings)
- Phase 18 -- Distribution & Platform Hardening (Release Matrix, Packaging, & Optional Python)
- Phase 19 -- Lexicon-Aware Relations + Retrieval Enrichment (Phase 11.9 consolidation)
- Phase 20 -- Ratatui TUI + Node Supervisor (Protocol v2, Dispatcher, Tool Hygiene)

---

## Decision Register (resolve before execution)

| Decision | Description | Default if Unresolved | Owner | Due Phase | Decision deadline |
| --- | --- | --- | --- | --- | --- |
| D1 Phase 16 extraction deps | Which PDF/DOCX libraries are canonical? | Prefer pdfjs‑dist + mammoth | TBD | 16 | Before Phase 16 start |
| D2 Phase 17 vector‑only | Which sparse artifacts are removed vs retained? | Keep minimal metadata for compatibility | TBD | 17 | Before Phase 17 start |
| D3 Phase 18 packaging | Native packaging targets/priorities | Windows + macOS + Linux | TBD | 18 | Before Phase 18 start |
| D4 Phase 19 lexicon | Promote LEXI into FUTUREROADMAP? | Yes (single source) | TBD | 19 | Before Phase 19 start |
| D5 Phase 20 TUI | JSONL protocol v2 strictness | Strict + fail‑open log wrapping | TBD | 20 | Before Phase 20 start |

### Dependency map (high-level)
- Phase 16 extraction + routing precedes Phase 17 vector‑only profile defaults.
- Phase 19 lexicon work should land before Phase 20 TUI if the TUI consumes lexicon signals/explain fields.
- Phase 18 packaging should include any Phase 20 binaries once they exist.

### Phase status summary (update as you go)
| Phase | Status | Notes |
| --- | --- | --- |
| 16 | [ ] |  |
| 17 | [ ] |  |
| 18 | [ ] |  |
| 19 | [ ] |  |
| 20 | [ ] |  |

### Per‑phase testing checklist (fill per phase)
- [ ] Add/verify new tests for each phase’s core behaviors.
- [ ] Run at least the intended lane(s) and record results.
- [ ] Update docs/config inventory after schema changes.

## Phase 16 — Prose Ingestion + Retrieval Routing Correctness (PDF/DOCX + FTS policy)

### Objective

Deliver first-class document ingestion (PDF + DOCX) and prose retrieval correctness:

- PDF/DOCX can be ingested (when optional deps exist) into deterministic, segment-aware prose chunks.
- When deps are missing or extraction fails, the index build remains green and reports explicit, per-file skip reasons.
- Prose/extracted-prose routes deterministically to SQLite FTS with safe, explainable query compilation; code routes to sparse/postings.
- Retrieval helpers are hardened so constraints (`allowedIds`), weighting, and table availability cannot silently produce wrong or under-filled results.

Note: vector-only indexing profile work is handled in **Phase 17 — Vector-Only Index Profile (Embeddings-First)**.

Additional docs that MUST be updated if Phase 16 adds new behavior or config:
- `docs/contracts/indexing.md` + `docs/contracts/artifact-contract.md` (metaV2 + chunk_meta contract surface)
- `docs/config/schema.json` + `docs/config/contract.md` + `docs/config/inventory.md` + `docs/config/inventory-notes.md`
- `docs/guides/commands.md` (new flags for extraction/routing)
- `docs/testing/truth-table.md` (optional-deps + skip policy)
- `docs/specs/document-extraction.md` (new; extraction contract + failure semantics)
- `docs/specs/prose-routing.md` (new; routing defaults + FTS explain contract)

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
  - [ ] Record extractor version, source checksum (bytes hash), and page/paragraph counts in build-state/extraction report.

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
- `src/shared/optional-deps.js` (tryImport/tryRequire behavior for optional deps)
- Refactor/reuse logic from `tools/bench/micro/extractors.js` into the runtime extractors (bench remains a consumer).
- `docs/specs/document-extraction.md` (new; extractor contract + failure semantics)
 - `src/index/build/build-state.js` (record extractor versions + capability flags)
 - `src/contracts/schemas/build-state.js` + `src/contracts/validators/build-state.js`

#### Tests
- [ ] `tests/indexing/extracted-prose/pdf-missing-dep-skips.test.js`
  - [ ] When PDF capability is false, extraction path is skipped cleanly and build remains green.
- [ ] `tests/indexing/extracted-prose/docx-missing-dep-skips.test.js`
  - [ ] When DOCX capability is false, extraction path is skipped cleanly and build remains green.
- [ ] `tests/indexing/extracted-prose/pdf-smoke.test.js` (conditional; only when deps available)
  - [ ] Extract a fixture PDF and assert known phrase is present.
- [ ] `tests/indexing/extracted-prose/docx-smoke.test.js` (conditional; only when deps available)
  - [ ] Extract a fixture DOCX and assert known phrase is present.
 - [ ] `tests/indexing/extracted-prose/document-extractor-version-recorded.test.js`
   - [ ] Build-state records extractor version/capability info when extraction is enabled.
- [ ] `tests/indexing/extracted-prose/document-extraction-checksums-and-counts.test.js`

---

### 16.2 Deterministic doc chunking (page/paragraph aware) + doc-mode limits that scale to large files

- [ ] Add deterministic chunkers for extracted documents:
  - [ ] `src/index/chunking/formats/pdf.js` (new)
    - [ ] Default: one chunk per page.
    - [ ] If a page is tiny, allow deterministic grouping (e.g., group adjacent pages up to a budget).
    - [ ] Each chunk carries provenance: `{ type:'pdf', pageStart, pageEnd, anchor }`.
  - [ ] `src/index/chunking/formats/docx.js` (new)
    - [ ] Group paragraphs into chunks by max character/token budget.
    - [ ] Merge tiny paragraphs into neighbors up to a minimum size threshold (deterministic).
    - [ ] Preserve heading boundaries when style information is available.
    - [ ] Each chunk carries provenance: `{ type:'docx', paragraphStart, paragraphEnd, headingPath?, anchor }`.
    - [ ] If multiple paragraph boundaries are merged, include explicit boundary labels so chunk provenance is unambiguous.

- [ ] Support adaptive splitting for “hot” or unexpectedly large segments without breaking stability:
  - [ ] If a page/section/window exceeds caps, split into deterministic subsegments with stable sub-anchors (no run-to-run drift).

- [ ] Sweep-driven performance hardening for chunking limits (because PDF/DOCX can create very large blobs):
  - [ ] Update `src/index/chunking/limits.js` so byte-boundary resolution is not quadratic on large inputs.
  - [ ] Avoid building full `lineIndex` unless line-based truncation is requested.

Touchpoints:
- `src/index/chunking/formats/pdf.js` (new)
- `src/index/chunking/formats/docx.js` (new)
- `src/index/chunking/limits.js`
- `docs/specs/document-extraction.md` (chunking contract + anchors)

#### Tests
- [ ] `tests/indexing/chunking/pdf-chunking-deterministic.test.js`
  - [ ] Two-page fixture; assert stable chunk count, anchors, and page ranges across repeated runs.
- [ ] `tests/indexing/chunking/docx-chunking-deterministic.test.js`
  - [ ] Multi-paragraph fixture; assert stable chunk grouping and heading boundary behavior.
- [ ] `tests/perf/chunking/chunking-limits-large-input.test.js`
  - [ ] Regression guard: chunking limits on a large string must complete within a bounded time.

### 16.3 Integrate extraction into indexing build (discovery, skip logic, file processing, state)

- [ ] Discovery gating:
  - [ ] Update `src/index/build/discover.js` so `.pdf`/`.docx` are only considered when `indexing.documentExtraction.enabled === true`.
  - [ ] If enabled but deps missing: record explicit “skipped due to capability” diagnostics (do not silently ignore).

- [ ] Treat extraction as a **pre-index stage** with an explicit error policy:
  - [ ] Produce per-file extraction results before chunking.
  - [ ] Fail/skip decisions must be deterministic and recorded in diagnostics.

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
- [ ] Emit a lightweight `extraction_report.json` per build (counts + per-file status + extractor versions) for audit/regression.
  - [ ] Include `extractionIdentityHash` (bytes hash + extractor version + normalization policy) in the report.

- [ ] Chunking dispatch registration:
  - [ ] Update `src/index/chunking/dispatch.js` to route `.pdf`/`.docx` through the document chunkers under the same gating.

Touchpoints:
- `src/index/build/discover.js`
- `src/index/build/file-processor/skip.js`
- `src/index/build/file-processor.js`
- `src/index/build/file-processor/assemble.js`
- `src/index/chunking/dispatch.js`
- `docs/specs/document-extraction.md` (gating + skip reasons)
- `src/index/build/build-state.js` (record extraction outcomes)
- `src/contracts/schemas/build-state.js`
- `src/contracts/validators/build-state.js`
 - `src/index/build/artifacts.js` (emit extraction_report)
 - `src/contracts/schemas/artifacts.js` + `src/contracts/validators/artifacts.js`

#### Tests
- [ ] `tests/indexing/extracted-prose/documents-included-when-available.test.js` (conditional; when deps available)
  - [ ] Build fixture containing a sample PDF and DOCX; assert chunks exist with `segment.type:'pdf'|'docx'` and searchable text is present.
- [ ] `tests/indexing/extracted-prose/documents-skipped-when-unavailable.test.js`
  - [ ] Force capabilities off; build succeeds; skipped docs are reported deterministically with reasons.
- [ ] `tests/indexing/extracted-prose/document-extraction-outcomes-recorded.test.js`
  - [ ] Fail/skip reasons are recorded in build_state and are stable across runs.
- [ ] `tests/indexing/extracted-prose/extraction-report.test.js`
  - [ ] Report is emitted, schema-valid, and deterministic for the same inputs.
  - [ ] `extractionIdentityHash` changes when extractor version or normalization policy changes.
- [ ] `tests/indexing/extracted-prose/document-bytes-hash-stable.test.js`
  - [ ] Ensure caching identity remains tied to bytes + extractor version/config.
- [ ] `tests/indexing/extracted-prose/document-chunk-id-no-collision.test.js`
  - [ ] Document chunks must not collide with code chunk identities for identical text.

### 16.4 metaV2 and chunk_meta contract extensions for extracted documents

- [ ] Extend metaV2 for extracted docs in `src/index/metadata-v2.js`:
  - [ ] Add a `document` (or `segment`) block with provenance fields:
    - `sourceType: 'pdf'|'docx'`
    - `pageStart/pageEnd` (PDF)
    - `paragraphStart/paragraphEnd` (DOCX)
    - optional `headingPath`, `windowIndex`, and a stable `anchor` for citation.
- [ ] Ensure `chunk_meta.jsonl` includes these fields and that output is backend-independent (artifact vs SQLite).
- [ ] If metaV2 is versioned, bump schema version (or add one) and provide backward-compatible normalization.
- [ ] Guard new fields behind a schema version and require forward-compat behavior (unknown fields ignored by readers).

Touchpoints:
- `src/index/metadata-v2.js`
- `src/index/build/file-processor/assemble.js`
- Retrieval loaders that depend on metaV2 (for parity checks)
- `src/contracts/schemas/artifacts.js` (metaV2 + chunk_meta contract updates)
- `src/contracts/validators/artifacts.js`
- `docs/contracts/artifact-contract.md`

#### Tests
- [ ] `tests/indexing/metav2/metaV2-extracted-doc.test.js`
  - [ ] Verify extracted-doc schema fields are present, typed, and deterministic.
- [ ] `tests/indexing/metav2/metaV2-unknown-fields-ignored.test.js`
  - [ ] Readers ignore unknown fields and still parse required fields deterministically.
- [ ] `tests/services/sqlite-hydration-metaV2-parity.test.js`
  - [ ] Build an index; load hits via artifact-backed and SQLite-backed paths; assert canonical metaV2 fields match for extracted docs.

### 16.5 Prose retrieval routing defaults + FTS query compilation correctness (explainable, deterministic)

- [ ] Enforce routing defaults:
  - [ ] `prose` / `extracted-prose` → SQLite FTS by default.
  - [ ] `code` → sparse/postings by default.
  - [ ] Overrides select requested providers and are reflected in `--explain` output.
  - [ ] Publish a routing decision table (query type × provider availability × override) in `docs/specs/prose-routing.md`.
  - [ ] `--explain` must log the chosen provider and the decision path (default vs override vs fallback).
  - [ ] Separate routing policy (desired provider) from availability (actual provider); define deterministic fallback order.

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
- `docs/specs/prose-routing.md` (routing defaults + FTS explain contract)
 - `src/retrieval/output/explain.js` (routing + MATCH string output)

#### Tests
- [ ] `tests/retrieval/backend/search-routing-policy.test.js`
  - [ ] Prose defaults to FTS; code defaults to postings; overrides behave deterministically and are explained.
- [ ] `tests/retrieval/query/sqlite-fts-query-escape.test.js`
  - [ ] Punctuation cannot inject operators; the compiled `MATCH` string is stable and safe.
- [ ] `tests/retrieval/backend/fts-tokenizer-config.test.js`
  - [ ] Assert baseline tokenizer uses diacritic-insensitive configuration; include a diacritic recall fixture.
 - [ ] `tests/retrieval/backend/fts-missing-table-fallback.test.js`
   - [ ] Missing FTS tables returns a controlled “unavailable” result with a warning (no throw).

### 16.6 Sweep-driven correctness fixes in retrieval helpers touched by prose FTS routing

- [ ] Every fix in this sweep must ship with a regression test (no fix-only changes).

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
 - `src/retrieval/output/explain.js` (surface fallback/overfetch decisions)

#### Tests
- [ ] `tests/retrieval/backend/rankSqliteFts-allowedIds-correctness.test.js`
- [ ] `tests/retrieval/backend/rankSqliteFts-weight-before-limit.test.js`
 - [ ] `tests/retrieval/backend/rankSqliteFts-missing-table-is-controlled-error.test.js`
- [ ] `tests/retrieval/backend/unpackUint32-buffer-alignment.test.js`

### 16.7 Query intent classification + boolean parsing semantics (route-aware, non-regressing)

- [ ] Fix path-intent misclassification so routing is reliable:
  - [ ] Replace the “any slash/backslash implies path” heuristic with more discriminating signals:
    - [ ] require path-like segments (multiple separators, dot-extensions, `./` / `../`, drive roots), and
    - [ ] treat URLs separately so prose queries containing `https://...` do not get path-biased.
  - [ ] Keep intent scoring explainable and stable.
  - [ ] Prefer grammar-first parsing; only fall back to heuristic tokenization on parse failure.
  - [ ] Emit the final intent classification (and any fallback reason) in `--explain`.

- [ ] Harden boolean parsing semantics to support FTS compilation and future strict evaluation:
  - [ ] Treat unary `-` as NOT even with whitespace (e.g., `- foo`, `- "phrase"`), or reject standalone `-` with a parse error.
  - [ ] Ensure phrase parsing behavior is explicit (either implement minimal escaping or formally document “no escaping”).
  - [ ] Prevent flattened token inventories from being mistaken for semantic constraints:
    - [ ] rename inventory lists (or attach an explicit `inventoryOnly` marker) so downstream code cannot accidentally erase boolean semantics.

Touchpoints:
- `src/retrieval/query-intent.js`
- `src/retrieval/query.js`

#### Tests
- [ ] `tests/retrieval/query/query-intent-path-heuristics.test.js`
- [ ] `tests/retrieval/query/boolean-unary-not-whitespace.test.js`
- [ ] `tests/retrieval/query/boolean-inventory-vs-semantics.test.js`

### 16.8 Retrieval output shaping: `scoreBreakdown` consistency + explain fidelity, plus harness drift repair

- [ ] Resolve `scoreBreakdown` contract inconsistencies:
  - [ ] Standardize field names and nesting across providers (SQLite FTS, postings, vector) so consumers do not need provider-specific logic.
  - [ ] Ensure verbosity/output size is governed by a single budget policy (max bytes/fields/explain items).
  - [ ] Add a schema version for `scoreBreakdown` and require all providers to emit it.

- [ ] Ensure `--explain` is complete and deterministic:
  - [ ] Explain must include:
    - routing decision
    - compiled FTS `MATCH` string for prose routes
    - provider variants used and thresholds
    - capability gating decisions when features are unavailable

- [ ] Repair script-coverage harness drift affecting CI signal quality:
  - [ ] Align `tests/tooling/script-coverage/actions.test.js` `covers` entries with actual `package.json` scripts.
  - [ ] Ensure `tests/tooling/script-coverage/report.test.js` does not fail with `unknownCovers` for legitimate cases.

Touchpoints:
- `src/retrieval/output/*`
- `tests/tooling/script-coverage/*`
- `package.json`
- `docs/testing/truth-table.md` (optional-deps + skip policy alignment)

#### Tests
- [ ] `tests/retrieval/contracts/score-breakdown-contract-parity.test.js`
- [ ] `tests/retrieval/contracts/score-breakdown-snapshots.test.js`
  - [ ] Snapshot `scoreBreakdown` for each backend to lock the schema shape.
- [ ] `tests/retrieval/output/explain-output-includes-routing-and-fts-match.test.js`
- [ ] `tests/tooling/script-coverage/harness-parity.test.js`
 - [ ] `tests/retrieval/contracts/score-breakdown-budget-limits.test.js`



---

## Phase 17 — Vector-Only Profile (Build + Search Without Sparse Postings)

> This is the **canonical merged phase** for the previously overlapping “Phase 17” and “Phase 18” drafts.  
> Goal: a *vector-only* index that can be built and queried **without** sparse/token/postings artifacts.

### Objective

Enable an indexing profile that is:

- **Embeddings-first**: dense vectors are the primary (and optionally only) retrieval substrate.
- **Sparse-free**: skips generation and storage of sparse token postings (and any derived sparse artifacts).
- **Strict and explicit**: search refuses to “pretend” sparse exists; mismatched modes are hard errors with actionable messages.
- **Artifact-consistent**: switching profiles cannot leave stale sparse artifacts that accidentally affect search.

This is especially valuable for:
- huge corpora where sparse artifacts dominate disk/time,
- doc-heavy or mixed corpora where ANN is the primary workflow,
- environments where you want fast/cheap rebuilds and can accept ANN-only recall.

Additional docs that MUST be updated if Phase 17 adds new behavior or config:
- `docs/contracts/indexing.md` + `docs/contracts/artifact-contract.md` + `docs/contracts/artifact-schemas.md`
- `docs/config/schema.json` + `docs/config/contract.md` + `docs/config/inventory.md`
- `docs/guides/commands.md` (new flags / routing semantics)
- `docs/specs/vector-only-profile.md` (new; profile contract + search behavior)

---

### Exit criteria (must all be true)

- [ ] Config supports `indexing.profile: "default" | "vector_only"` (default: `"default"`).
- [ ] `vector_only` builds succeed end-to-end and **do not emit** sparse artifacts (tokens/postings/minhash/etc).
- [ ] Search against a `vector_only` index:
  - [ ] requires an ANN-capable provider (or explicit `--ann`), and
  - [ ] rejects token/sparse-dependent features with a clear error (not silent degradation).
- [ ] `index_state.json` records the profile and a machine-readable “artifact presence” manifest with a schema version.
- [ ] SQLite-backed retrieval cannot crash on missing sparse tables; it either:
  - [ ] uses a vector-only schema, or
  - [ ] detects missing tables and returns a controlled “profile mismatch / artifact missing” error.
- [ ] Tests cover: profile switching cleanup, ANN-only search, and “mismatch is an error” behavior.

---

### Phase 17.1 — Profile contract + build-state / index-state schema

- [ ] Add and normalize config:
  - [ ] `indexing.profile` (string enum): `default | vector_only`
  - [ ] Default behavior: absent ⇒ `default`
  - [ ] Reject unknown values (fail-fast in config normalization)

- [ ] Define the canonical on-disk contract in `index_state.json`:

  - [ ] Add a `profile` block (versioned):
    - [ ] `profile.id: "default" | "vector_only"`
    - [ ] `profile.schemaVersion: 1`
  - [ ] Record the same profile block in build-state/build reports for traceability.
- [ ] Add an `artifacts` presence block (versioned) so loaders can reason about what exists:
    - [ ] `artifacts.schemaVersion: 1`
    - [ ] `artifacts.present: { [artifactName]: true }` (only list artifacts that exist)
    - [ ] `artifacts.omitted: string[]` (explicit omissions for the selected profile)
    - [ ] `artifacts.requiredForSearch: string[]` (profile-specific minimum set)

  - [ ] Add a build-time invariant:
    - [ ] If `profile.id === "vector_only"`, then `token_postings*`, `token_vocab`, `token_stats`, `minhash*`, and any sparse-only artifacts MUST NOT be present.
  - [ ] Define a strict vector_only artifact contract and validation rules (explicit allowlist/denylist).

- [ ] Ensure build signatures include profile:
  - [ ] signature/caching keys must incorporate `profile.id` so switching profiles forces a rebuild.
  - [ ] compatibilityKey (and/or cohortKey) must include `profile.id` and `profile.schemaVersion` to prevent mixing vector_only and default indexes.

Touchpoints:
- `docs/config/schema.json`
- `src/index/build/runtime/runtime.js` (read + normalize `indexing.profile`)
- `src/index/build/indexer/signatures.js` (include profile in signature)
- `src/index/build/artifacts.js` (index_state emission + artifacts presence block)
- `src/retrieval/cli/index-state.js` (surface profile + artifacts in `index_status`)
- `src/contracts/schemas/artifacts.js` (index_state contract updates)
- `src/contracts/validators/artifacts.js`
 - `src/index/validate/index-validate.js` (enforce vector_only artifact allowlist/denylist)

#### Tests
- [ ] `tests/indexing/contracts/profile-index-state-contract.test.js`
  - [ ] Build tiny index with each profile and assert `index_state.json.profile` + `index_state.json.artifacts` satisfy schema invariants.
- [ ] `tests/indexing/contracts/profile-artifacts-present-omitted-consistency.test.js`
  - [ ] `artifacts.present` and `artifacts.omitted` are disjoint and consistent with profile.
- [ ] `tests/indexing/contracts/profile-index-state-has-required-artifacts.test.js`
  - [ ] `artifacts.requiredForSearch` is populated and profile-consistent.
 - [ ] `tests/indexing/validate/vector-only-artifact-contract.test.js`
   - [ ] Validation fails if any sparse artifacts are present in vector_only builds.

---

### Phase 17.2 — Build pipeline gating (skip sparse generation cleanly)

- [ ] Thread `profile.id` into the indexer pipeline and feature settings:
  - [ ] In `vector_only`, set `featureSettings.tokenize = false` (and ensure all downstream steps respect it)
  - [ ] Ensure embeddings remain enabled/allowed (vector-only without vectors should be rejected at build time unless explicitly configured to “index without vectors”)

- [ ] Skip sparse stages when `vector_only`:
  - [ ] Do not run `buildIndexPostings()` (or make it a no-op) when tokenize=false.
  - [ ] Do not write sparse artifacts in `writeIndexArtifactsForMode()` / `src/index/build/artifacts.js`.
  - [ ] Hard-fail the build if any forbidden sparse artifacts are detected in the output directory.

- [ ] Cleanup/consistency when switching profiles:
  - [ ] When building `vector_only`, proactively remove any prior sparse artifacts in the target output dir so stale files cannot be accidentally loaded.
  - [ ] When building `default`, ensure sparse artifacts are emitted normally (and any vector-only-only special casing does not regress).

- [ ] Ensure “missing doc embedding” representation stays stable:
  - [ ] Continue using the existing **zero-length typed array** convention for missing vectors.
  - [ ] Add a regression test so future refactors don’t reintroduce `null`/NaN drift.

Touchpoints:
- `src/index/build/indexer/pipeline.js` (profile → feature gating)
- `src/index/build/indexer/steps/postings.js` (skip when tokenize=false)
- `src/index/build/indexer/steps/write.js` + `src/index/build/artifacts.js` (omit sparse artifacts)
- `src/index/build/file-processor/embeddings.js` (missing-doc marker regression)
- `src/contracts/validators/artifacts.js` (validate artifacts.present/omitted consistency)

#### Tests
- [ ] `tests/indexing/postings/vector-only-does-not-emit-sparse.test.js`
  - [ ] Assert absence of `token_postings*`, `token_vocab*`, `token_stats*`, `minhash*`.
- [ ] `tests/indexing/postings/vector-only-switching-cleans-stale-sparse.test.js`
  - [ ] Build default, then vector_only into same outDir; assert sparse artifacts removed.
 - [ ] `tests/indexing/postings/vector-only-missing-embeddings-is-error.test.js`
   - [ ] Building vector_only without embeddings enabled fails with a clear error.

---

### Phase 17.3 — Search routing + strict profile compatibility

- [ ] Load and enforce `index_state.json.profile` at query time:
  - [ ] If the index is `vector_only`:
    - [ ] default router must choose ANN/vector provider(s)
    - [ ] sparse/postings providers must be disabled/unavailable
  - [ ] If a caller explicitly requests sparse-only behavior against vector_only:
    - [ ] return a controlled error with guidance (“rebuild with indexing.profile=default”)

- [ ] Token-dependent query features must be explicit:
  - [ ] If a query requests phrase/boolean constraints that require token inventory:
    - [ ] either (a) reject with error, or (b) degrade with a warning and set `explain.warnings[]` (pick one policy and make it part of the contract)
  - [ ] Choose and document the policy (reject vs warn) and make it consistent across CLI/API/MCP.
  - [ ] Default policy should be **reject**; allow fallback only with an explicit `--allow-sparse-fallback` / `allowSparseFallback` override.

- [ ] SQLite helper hardening for profile-aware operation:
  - [ ] Add a lightweight `requireTables(db, names[])` helper used at provider boundaries.
  - [ ] Providers must check required tables for their mode and return an actionable “tables missing” error (not throw).

Touchpoints:
- `src/retrieval/pipeline.js` (router)
- `src/retrieval/index-load.js` (ensure index_state loaded early)
- `src/retrieval/sqlite-helpers.js` (table guards)
- `src/retrieval/providers/*` (respect profile + missing-table outcomes)
- `src/retrieval/output/explain.js` (surface profile + warnings)
- `docs/specs/vector-only-profile.md` (routing + mismatch policy)
 - `src/retrieval/output/format.js` (error/warning rendering)

#### Tests
- [ ] `tests/retrieval/backend/vector-only-search-requires-ann.test.js`
- [ ] `tests/retrieval/backend/vector-only-rejects-sparse-mode.test.js`
- [ ] `tests/retrieval/backend/sqlite-missing-sparse-tables-is-controlled-error.test.js`
- [ ] `tests/retrieval/output/explain-vector-only-warnings.test.js`
 - [ ] `tests/retrieval/backend/vector-only-compatibility-key-mismatch.test.js`
   - [ ] Mixed profile indexes are rejected unless explicitly allowed (federation/cohort gating).

---

### Phase 17.4 — Optional: “analysis policy shortcuts” for vector-only builds (stretch)

This is explicitly optional, but worth considering because it is where most build time goes for code-heavy repos.

- [ ] Add a documented policy switch: when `indexing.profile=vector_only`, default `analysisPolicy` can disable:
  - [ ] type inference
  - [ ] risk analysis
  - [ ] expensive cross-file passes
  - [ ] (optionally) lint/complexity stages
- [ ] Make these *opt-outable* (users can re-enable per setting).
  - [ ] Record any disabled analysis features in the build report for transparency.

Touchpoints:
- `src/index/build/indexer/pipeline.js` (feature flags)
- `docs/config/` (document defaults and overrides)

## Phase 18 — Distribution & Platform Hardening (Release Matrix, Packaging, and Optional Python)

### Objective
Make PairOfCleats releasable and operable across supported platforms by defining a **release target matrix**, adding a **deterministic release smoke-check**, hardening **cross-platform path handling**, and producing **reproducible editor/plugin packages** (Sublime + VS Code) with CI gates.

This phase also standardizes how Python-dependent tests and tooling behave when Python is missing: they must **skip cleanly** (without producing “false red” CI failures), while still failing when Python is present but the test is genuinely broken.

Additional docs that MUST be updated if Phase 18 adds new behavior or config:
- `docs/guides/release-discipline.md`
- `docs/guides/commands.md` (release-check + packaging commands)
- `docs/guides/editor-integration.md`
- `docs/guides/service-mode.md`
- `docs/config/schema.json` + `docs/config/contract.md` (if new config flags are added)

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

### Phase 18.1 — Release target matrix + deterministic release smoke-check
- [ ] Define and publish the **release target matrix** and optional-dependency policy.
  - Primary output:
    - `docs/guides/release-matrix.md` (new)
  - Include:
    - Supported OSes and runners (Linux/macOS/Windows) and architectures (x64/arm64 where supported).
    - Supported Node versions (minimum + tested versions).
    - Optional dependency behavior policy (required vs optional features), including:
      - Python (for Sublime lint/compile tests)
      - Editor integrations (Sublime + VS Code)
      - Any “bring-your-own” optional deps used elsewhere (e.g., extraction/SDK/tooling)
    - “Fail vs degrade” posture for each optional capability (what is allowed to skip, and what must hard-fail).
- [ ] Expand the existing `tools/release/check.js` from “changelog-only” into a **deterministic release smoke-check runner**.
  - Touchpoints:
    - `tools/release/check.js` (extend; keep it dependency-light)
    - `bin/pairofcleats.js` (invoked by the smoke check; no behavioral changes expected here)
    - `src/shared/subprocess.js` (shared spawn/timeout helpers)
  - Requirements:
    - Must not depend on shell string concatenation; use spawn with args arrays.
    - Must set explicit `cwd` and avoid fragile `process.cwd()` assumptions (derive repo root from `import.meta.url` or accept `--repo-root`).
    - Must support bounded timeouts and produce actionable failures (which step failed, stdout/stderr excerpt).
    - Should support `--json` output with a stable envelope for CI automation (step list + pass/fail + durations).
    - Produce a reproducible `release-manifest.json` with artifact checksums (sha256) and an SBOM reference, and sign it (with CI verification).
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
    - `docs/guides/release-matrix.md` (source of truth for versions and policies)
    - `docs/guides/release-discipline.md` (release checks + required gates)
  - Requirements:
    - Add a release-gate lane that runs `npm run release-check` plus the new smoke steps.
    - Add OS coverage beyond Linux (at minimum: Windows already exists; add macOS for the smoke check).
    - Align CI Node version(s) with the release target matrix, and ensure the matrix is explicitly documented.

#### Tests / Verification
- [ ] `tests/tooling/release/release-check-smoke.test.js`
  - Runs `node tools/release/check.js` in a temp environment and asserts it succeeds on a healthy checkout.
- [ ] `tests/tooling/release/release-check-json.test.js`
  - Runs `release-check --json` and asserts stable JSON envelope fields (schemaVersion, steps[], status).
- [ ] `tests/tooling/release/release-check-exit-codes.test.js`
  - Failing step returns non-zero and includes the failing step name in stderr.
- [ ] CI verification:
  - [ ] Add a job that runs the smoke check on at least Linux/macOS/Windows with pinned Node versions per the matrix.

---

### Phase 18.2 — Cross-platform path safety audit + regression tests (including spaces)
- [ ] Audit filesystem path construction and CLI spawning for correctness on:
  - paths with spaces
  - Windows separators and drive roots
  - consistent repo-relative path normalization for public artifacts (canonical `/` separators)
- [ ] Fix issues discovered during the audit in the “release-critical surface”.
  - Minimum scope for this phase:
    - `tools/release/check.js` (must behave correctly on all supported OSes)
    - packaging scripts added in Phase 18.3/18.5
    - tests added by this phase (must be runnable on CI runners and locally)
  - Broader issues discovered outside this scope should either:
    - be fixed here if the touched files are already being modified, or
    - be explicitly deferred to a named follow-on phase (with a concrete subsection placeholder).
- [ ] Add regression tests for path safety and quoting.
  - Touchpoints:
    - `tests/tooling/platform/paths-with-spaces.test.js` (new)
    - `tests/tooling/platform/windows-paths-smoke.test.js` (new; conditional when not on Windows)
    - `src/shared/files.js` (path normalization helpers)
    - `src/shared/subprocess.js` (argument quoting + spawn safety)
  - Requirements:
    - Create a temp repo directory whose absolute path includes spaces.
    - Run build + validate + search using explicit `cwd` and temp cacheRoot.
    - Ensure the artifacts still store repo-relative paths with `/` separators.
    - Add property-based or table-driven cases for edge paths: drive-letter prefixes (including `C:/` on POSIX), NFC/NFD normalization, and trailing dots/spaces.

#### Tests / Verification
- [ ] `tests/tooling/platform/paths-with-spaces.test.js`
  - Creates `repo with spaces/` under a temp dir; runs build + search; asserts success.
- [ ] `tests/tooling/platform/windows-paths-smoke.test.js`
  - On Windows CI, verifies key commands succeed and produce valid outputs.
- [ ] `tests/tooling/platform/path-edge-cases.test.js`
  - Exercises drive-letter-like paths on POSIX, NFC/NFD normalization, and trailing dots/spaces.
- [ ] Extend `tools/release/check.js` to include a `--paths` step that runs the above regression checks in quick mode.

---

### Phase 18.3 — Sublime plugin packaging pipeline (bundled, reproducible)
- [ ] Implement a reproducible packaging step for the Sublime plugin.
  - Touchpoints:
    - `sublime/PairOfCleats/**` (source)
    - `tools/package-sublime.js` (new; Node-only)
    - `package.json` scripts (optional: `npm run package:sublime`)
  - Requirements:
    - Package `sublime/PairOfCleats/` into a distributable artifact (`.sublime-package` zip or Package Control–compatible format).
    - Determinism requirements:
      - Stable file ordering in the archive.
      - Normalized timestamps/permissions where feasible.
      - Version-stamp the output using root `package.json` version.
    - Packaging must be Node-only (must not assume Python is present).
- [ ] Add installation and distribution documentation.
  - Touchpoints (choose one canonical location):
    - `docs/guides/editor-integration.md` (add Sublime section), and/or
    - `sublime/PairOfCleats/README.md` (distribution instructions)
  - Include:
    - Manual install steps and Package Control posture.
    - Compatibility notes (service-mode requirements, supported CLI flags, cacheRoot expectations).

#### Tests / Verification
- [ ] `tests/tooling/sublime/package-structure.test.js`
  - Runs the packaging script; asserts expected files exist in the output and that version metadata matches root `package.json`.
- [ ] `tests/tooling/sublime/package-determinism.test.js` (if feasible)
  - Packages twice; asserts the archive is byte-identical (or semantically identical with a stable file list + checksums).

---

### Phase 18.4 — Make Python tests and tooling optional (skip cleanly when Python is missing)
- [ ] Update Python-related tests to detect absence of Python and **skip with a clear message** (not fail).
  - Touchpoints:
    - `tests/tooling/sublime/sublime-pycompile.test.js` (must be guarded)
    - `tests/tooling/sublime/test_*.py` (only if these are invoked by CI or tooling; otherwise keep as optional)
    - `tests/helpers/skip.js` (skip exit code + messaging helper)
    - `tests/helpers/test-env.js` (consistent skip env setup)
  - Requirements:
    - Prefer `spawnSync(python, ['--version'])` and treat ENOENT as “Python unavailable”.
    - When Python is unavailable:
      - print a single-line skip reason to stderr
      - exit using the project’s standard “skip” mechanism (see below)
    - When Python is available:
      - the test must still fail for real syntax errors (no silent skips).
    - Centralize Python detection in a shared helper (e.g., `tests/helpers/python.js`) used by all Python-dependent tests/tooling.
- [x] JS test harness recognizes “skipped” tests via exit code 77.
  - Touchpoints:
    - `tests/run.js` (treat a dedicated exit code, e.g. `77`, as `skipped`)
  - Requirements:
    - `SKIP` must appear in console output (like PASS/FAIL).
    - JUnit output must mark skipped tests as skipped.
    - JSON output must include `status: 'skipped'`.
- [ ] Add a small unit test that proves the “Python missing → skipped” path is wired correctly.
  - Touchpoints:
    - `tests/tooling/python/python-availability-skip.test.js` (new)
  - Approach:
    - mock or simulate ENOENT from spawnSync and assert the test exits with the “skip” code and emits the expected message.

#### Tests / Verification
- [ ] `tests/tooling/sublime/sublime-pycompile.test.js`
  - Verified behavior:
    - Without Python: skips (non-failing) with a clear message.
    - With Python: compiles all `.py` files under `sublime/PairOfCleats/**` and fails on syntax errors.
- [ ] `tests/tooling/python/python-availability-skip.test.js`
  - Asserts skip-path correctness and ensures we do not “skip on real failures”.
 - [ ] `tests/tooling/python/python-skip-message.test.js`
   - Ensures skip message is a single line and includes the missing executable name.

---

### Phase 18.5 — VS Code extension packaging + compatibility (extension exists)
- [ ] Add a reproducible VS Code extension packaging pipeline (VSIX).
  - Touchpoints:
    - `extensions/vscode/**` (source)
    - `package.json` scripts (new: `package:vscode`), and/or `tools/package-vscode.js` (new)
    - `.vscodeignore` / `extensions/vscode/.vscodeignore` (packaging include/exclude list)
  - Requirements:
    - Use a pinned packaging toolchain (recommended: `@vscode/vsce` as a devDependency).
    - Output path must be deterministic and placed under a temp/artifacts directory suitable for CI.
    - Packaging must not depend on repo-root `process.cwd()` assumptions; set explicit cwd.
    - Validate `engines.vscode` compatibility against the documented release matrix and fail if mismatched.
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
- [ ] `tests/tooling/vscode/extension-packaging.test.js`
  - Packages a VSIX and asserts the output exists (skips if packaging toolchain is unavailable).
- [ ] Extend `tests/tooling/vscode/vscode-extension.test.js`
  - Validate required activation events/commands and required configuration keys (and add any cacheRoot-related keys if the contract requires them).
  - Validate `engines.vscode` compatibility constraints.

---

### Phase 18.6 — Service-mode bundle + distribution documentation (API server + embedding worker)
- [ ] Ship a service-mode “bundle” (one-command entrypoint) and documentation.
  - Touchpoints:
    - `tools/api/server.js`
    - `tools/service/indexer-service.js`
    - `tools/service/**` (queue + worker)
    - `docs/guides/service-mode.md` (add bundle section) or a section in `docs/guides/commands.md`
  - Requirements:
    - Define canonical startup commands, required environment variables, and queue storage paths.
    - Document security posture and safe defaults:
      - local-only binding by default
      - explicit opt-in for public binding
      - guidance for auth/CORS if exposed
    - Ensure the bundle uses explicit args and deterministic logging conventions (stdout vs stderr).
- [ ] Add an end-to-end smoke test for the service-mode bundle wiring.
  - Use stub embeddings or other deterministic modes where possible; do not require external services.
  - Include a readiness probe and bounded timeout to avoid hangs.
  - Ensure clean shutdown of API server + worker (no leaked processes).

#### Tests / Verification
- [ ] `tests/services/service-mode-smoke.test.js`
  - Starts API server + worker in a temp environment; enqueues a small job; asserts it is processed and the API responds.
- [ ] Extend `tools/release/check.js` to optionally run a bounded-time service-mode smoke step (`--service-mode`).

---

## WHAT IF WE DIDNT NEED SHOES

This is an optional, high-impact exploration track that assumes we can add native or WASM-accelerated components to substantially improve retrieval and indexing performance beyond what is feasible in JS alone. Everything here must have clean fallbacks and must never change functional semantics.

### Objective

Identify and integrate optional native/WASM accelerators for the heaviest hot paths (bitmap filtering, top-K ranking, ANN scoring, and search pipeline orchestration) with strict correctness parity and deterministic behavior.

### Goals

- Reduce query latency by offloading hot loops to native/WASM implementations.
- Reduce GC pressure by using typed buffers and shared memory arenas.
- Preserve identical results vs. JS baseline (deterministic ordering and tie-breaking).
- Provide clean capability detection and full JS fallback paths.

### Non-goals

- Making native/WASM dependencies mandatory.
- Changing ranking, filtering, or ANN semantics.
- Replacing existing on-disk index formats.

### Files to modify (exhaustive for this section)

- `src/retrieval/bitmap.js`
- `src/retrieval/filters.js`
- `src/retrieval/filter-index.js`
- `src/retrieval/pipeline/candidates.js`
- `src/retrieval/pipeline/fusion.js`
- `src/retrieval/pipeline/graph-ranking.js`
- `src/retrieval/rankers.js`
- `src/retrieval/ann/providers/*`
- `src/shared/native-accel.js` (new)
- `src/shared/capabilities.js` (new or extend)
- `tools/build-native.js` (new)
- `package.json` (optional deps + build scripts)
- `docs/perf/native-accel.md` (new)
- `docs/specs/native-accel.md` (new)
- `tests/retrieval/native/bitmap-equivalence.test.js` (new)
- `tests/retrieval/native/topk-equivalence.test.js` (new)
- `tests/retrieval/native/ann-equivalence.test.js` (new)
- `tests/retrieval/native/capability-fallback.test.js` (new)
- `tests/retrieval/native/perf-baseline.test.js` (new, opt-in)

### Docs/specs to add or update

- `docs/perf/native-accel.md` (new; performance goals, measurement harness, rollout policy)
- `docs/specs/native-accel.md` (new; interfaces, ABI, fallback behavior, capability detection)
- `docs/guides/commands.md` (add optional build steps for native accel)

### Subphase A — Native Bitmap Engine (Roaring/Bitset)

#### Goals

- Replace large `Set`-based allowlists with roaring bitmap or bitset operations.
- Keep JS bitmap code path as the default fallback.

#### Non-goals

- Changing filter semantics or storage format.

#### Touchpoints

- `src/retrieval/bitmap.js`
- `src/retrieval/filters.js`
- `src/retrieval/filter-index.js`
- `src/shared/native-accel.js` (new)
- `docs/specs/native-accel.md`

#### Tasks

- [ ] Add optional native bitmap module (Node-API addon or WASM) with `and/or/andNot` operations.
- [ ] Implement capability detection and a stable JS fallback shim.
- [ ] Ensure deterministic iteration order when converting back to arrays.
- [ ] Add large-scale bitmap microbenchmarks and memory usage comparisons.

#### Tests

- [ ] `tests/retrieval/native/bitmap-equivalence.test.js`
- [ ] `tests/retrieval/native/capability-fallback.test.js`

#### Acceptance

- [ ] Bitmap operations match JS results exactly.
- [ ] Large filter queries show measurable speedup without semantic changes.

---

### Subphase B — Native Top‑K Selection + Score Accumulation

#### Goals

- Replace full-array sorts with native top‑K selection.
- Accumulate scores in native buffers to reduce GC pressure.

#### Non-goals

- Changing ranking behavior or ordering rules.

#### Touchpoints

- `src/retrieval/pipeline/candidates.js`
- `src/retrieval/pipeline/fusion.js`
- `src/retrieval/rankers.js`
- `src/shared/native-accel.js` (new)
- `docs/specs/native-accel.md`

#### Tasks

- [ ] Add a native top‑K selection module with stable tie‑breaking.
- [ ] Add native score accumulation for BM25 + ANN fusion.
- [ ] Implement typed array exchange or shared memory blocks for scores and ids.
- [ ] Provide a pure JS fallback with identical semantics.

#### Tests

- [ ] `tests/retrieval/native/topk-equivalence.test.js`
- [ ] `tests/retrieval/native/capability-fallback.test.js`

#### Acceptance

- [ ] Top‑K selection matches JS ordering within deterministic tie rules.
- [ ] Reduced memory overhead vs. full sorting for large candidate sets.

---

### Subphase C — ANN Acceleration + Preflight

#### Goals

- Accelerate ANN scoring and filtering using native/WASM backends.
- Avoid slow failure paths with explicit preflight checks.

#### Non-goals

- Replacing existing ANN index formats or configurations.

#### Touchpoints

- `src/retrieval/ann/providers/*`
- `src/retrieval/pipeline/ann-backends.js`
- `src/shared/native-accel.js`
- `docs/specs/native-accel.md`

#### Tasks

- [ ] Add optional ANN scoring backend with feature flags and compatibility checks.
- [ ] Implement preflight capability checks (dims, space, index metadata).
- [ ] Add JS fallback with identical retrieval semantics.

#### Tests

- [ ] `tests/retrieval/native/ann-equivalence.test.js`
- [ ] `tests/retrieval/native/capability-fallback.test.js`

#### Acceptance

- [ ] ANN output parity with JS baseline.
- [ ] Preflight avoids slow retries and confusing failures.

---

### Subphase D — Worker‑Thread Pipeline Offload

#### Goals

- Move heavy query stages to worker threads with shared buffers.
- Keep main thread responsive for CLI output and cancellation.

#### Non-goals

- Changing CLI UX or query semantics.

#### Touchpoints

- `src/retrieval/pipeline.js`
- `src/retrieval/pipeline/candidates.js`
- `src/retrieval/pipeline/fusion.js`
- `src/retrieval/pipeline/graph-ranking.js`
- `src/retrieval/output/format.js`
- `src/shared/worker-pool.js` (new or extend)
- `docs/specs/native-accel.md`

#### Tasks

- [ ] Introduce a worker-pool for retrieval compute stages.
- [ ] Use shared memory arenas for candidates and scores when safe.
- [ ] Add cancellation and timeout propagation.
- [ ] Keep output formatting on main thread with streaming results.

#### Tests

- [ ] `tests/retrieval/native/worker-offload-equivalence.test.js` (new)
- [ ] `tests/retrieval/native/worker-cancel.test.js` (new)

#### Acceptance

- [ ] Worker-offloaded pipeline matches results and ordering.
- [ ] Main-thread responsiveness improves under heavy queries.

---

### Subphase E — Build + Release Strategy for Native/WASM

#### Goals

- Provide reproducible builds for native/WASM components.
- Ensure opt-in installation with clear diagnostics.

#### Non-goals

- Mandatory native dependencies in all environments.

#### Touchpoints

- `tools/build-native.js` (new)
- `package.json`
- `docs/perf/native-accel.md`
- `docs/specs/native-accel.md`
- CI pipelines (add optional native build step)

#### Tasks

- [ ] Add optional build step that produces platform-specific artifacts.
- [ ] Add capability detection and explicit logging for native availability.
- [ ] Document troubleshooting and fallback rules.

#### Tests

- [ ] `tests/retrieval/native/capability-fallback.test.js`
- [ ] `tests/retrieval/native/perf-baseline.test.js` (opt-in)

#### Acceptance

- [ ] Native/WASM acceleration is optional, deterministic, and easy to diagnose.
- [ ] JS fallbacks always function without feature loss.

