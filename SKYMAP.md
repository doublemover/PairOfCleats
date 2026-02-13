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

---

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


## Phase 19 — Lexicon-Aware Relations + Retrieval Enrichment (Phase 11.9 consolidation)

### Objective
Deliver lexicon-aware build-time relation filtering, retrieval-time relation boosts, and chargram enrichment with ANN candidate safety. The phase provides a strict contract surface (schemas, config, explain output), deterministic behavior, and conservative defaults that can be safely enabled in production.

### Goals
- Canonical per-language lexicon assets and a cached loader with deterministic normalization.
- Build-time relation filtering to remove keyword/literal noise without altering imports/exports.
- Retrieval-time relation boosts (boost-only) with explain output and bounded, deterministic token lists.
- Chargram enrichment and ANN/minhash candidate safety policy with consistent explain reasons.
- Signature and config surfaces updated so incremental caches and CI stay correct.

### Non-goals
- Non-ASCII keyword support (explicitly deferred to a v2 lexicon format).
- Any change to semantic meaning of relations (boost-only, no filtering at retrieval time).
- Any change to ANN ranking semantics beyond safe candidate-set selection.

### Implementation upgrades applied (LEXI review)
- Retrieval scoring must wire through `src/retrieval/pipeline.js` and `src/retrieval/pipeline/candidates.js` (not ad-hoc sites).
- Query token source is `buildQueryPlan(...)` from `src/retrieval/cli/query-plan.js`; do not recompute tokens.
- Any ANN candidate knobs must be explicitly added to config schema + normalize-options.
- Relation filtering must preserve stable ordering and avoid over-filtering JS-like property names; use conservative keyword sets or per-language allowlists.
- Stopword lists must be fail-open; missing or invalid lexicon files must not fail builds.

### Additional docs/specs that MUST be updated
- `docs/config/schema.json` + `docs/config/contract.md` + `docs/config/inventory.*`
- `docs/specs/language-lexicon-wordlists.md`
- `docs/specs/lexicon-relations-filtering.md`
- `docs/specs/lexicon-retrieval-boosts.md`
- `docs/specs/chargram-enrichment-and-ann-fallback.md`
- `docs/contracts/artifact-contract.md` (explain payload surface and schema references)

### Authoritative details (must be preserved)

#### Lexicon wordlist format (v1)
- Required fields: `formatVersion` (const 1), `languageId`, `keywords[]`, `literals[]`.
- Optional fields: `types[]`, `builtins[]`, `modules[]`, `notes[]`.
- File layout: `src/lang/lexicon/wordlists/_generic.json` and `src/lang/lexicon/wordlists/<languageId>.json`.
- Normalization: lowercase, trim, ASCII-only, non-empty, dedupe. Sort on disk; loader must normalize regardless.
- Derived stopword domains:
  - `relations = keywords ∪ literals`
  - `ranking = keywords ∪ literals ∪ types ∪ builtins`
  - `chargrams = keywords ∪ literals` (optionally extended by config)
- Loader is fail-open with `_generic` fallback and a single structured warning on schema failures.

#### Lexicon schema requirements
- `language-lexicon-wordlist.schema.json` v1:
  - `additionalProperties=false`
  - `formatVersion` const 1
  - arrays of strings (minLength 1)
- Register schema in `src/contracts/registry.js` if validation is enforced at load time.

#### Relations filtering (build-time)
- Filter only `usages`, `calls`, `callDetails`, `callDetailsWithRange` (imports/exports unchanged in v1).
- `extractSymbolBaseName` separators: `.`, `::`, `->`, `#`, `/`; trim trailing `()`, `;`, `,`.
- Preserve stable order; optional stable de-dupe (keep first occurrence).

#### Retrieval relation boosts
- Signal tokens derive from `buildQueryPlan(...)` output (pipeline plan, not recompute).
- Per-hit stopword filtering in ranking domain; case-folding respects `caseTokens`.
- Scoring: `boost = min(maxBoost, callMatches*perCall + usageMatches*perUse)`.
- Explain payload includes `relationBoost` with bounded, deterministic token lists.

#### Chargram enrichment + ANN candidate policy
- Allowed `chargramFields`: `name`, `signature`, `doc`, `comment`, `body` (default `name,doc`).
- Optional `chargramStopwords` uses lexicon `chargrams` domain.
- Candidate policy rules (deterministic):
  - `null` candidates -> null (full ANN)
  - empty set -> empty set (no ANN hits)
  - too large -> null
  - too small with no filters -> null
  - filtersActive + allowedIdx -> allowedIdx
  - otherwise -> candidates
- Explain `annCandidatePolicy` includes `inputSize`, `output`, and `reason`:
  `noCandidates`, `tooLarge`, `tooSmallNoFilters`, `filtersActiveAllowedIdx`, `ok`.

### Feature flags + defaults (v1)
- Lexicon loader: enabled by default; fail-open on missing/invalid files.
- Relation filtering: enabled only at `quality=max` unless explicitly enabled in config.
- Relation boosts: disabled by default; must be explicitly enabled.
- Chargram enrichment: disabled by default; must be explicitly enabled.
- ANN/minhash candidate safety policy: always on (safety), explain output opt-in.
- Global off-switch: `indexing.lexicon.enabled=false`.

### Contract surface (versioned)
- Lexicon wordlists are schema-versioned JSON, validated on load.
- Explain output adds `relationBoost` and `annCandidatePolicy` with a versioned explain schema.
- Config schema explicitly includes lexicon + ANN candidate keys, documented in config inventory.

### Performance guardrails
- Relation filtering is O(n) over relations, no per-token regex or substring scans.
- Avoid new allocations in inner loops; reuse buffers where possible.
- Relation boost matching bounded by query token count.

### Compatibility: cache/signature impact
- Build signature inputs must include lexicon config (stopword policies), chargram fields/stopwords, and ANN candidate knobs.
- Bump `SIGNATURE_VERSION` if signature shape changes.

### 19.0 — Cross-cutting setup and contracts

#### Goals
- Establish the lexicon contract, schema, and config surfaces.
- Align config/CLI/doc surfaces with the current codebase.

#### Touchpoints
- `src/lang/` (new lexicon module)
- `src/shared/postings-config.js` (new fields)
- `src/retrieval/cli/normalize-options.js` (ANN candidate config knobs)
- `src/retrieval/cli/query-plan.js` (query token source for boosts)
- `src/retrieval/output/explain.js` + `src/retrieval/output/format.js`
- `src/index/build/indexer/signatures.js` (incremental signature inputs)
- `docs/config/schema.json`, `docs/config/contract.md`, `docs/config/inventory.*`
- `docs/specs/*` (lexicon + retrieval specs)
- `src/contracts/registry.js`
- `src/contracts/schemas/*` + `src/contracts/validators/*`

#### Tasks
- [ ] Decide canonical location for lexicon spec files (recommend `docs/specs/lexicon-*.md`).
- [ ] Add/extend config schema entries for:
  - `indexing.postings.chargramFields`
  - `indexing.postings.chargramStopwords`
  - `retrieval.annCandidateCap`
  - `retrieval.annCandidateMinDocCount`
  - `retrieval.annCandidateMaxDocCount`
  - `retrieval.relationBoost` (if exposed; otherwise document as quality-gated internal)
- [ ] Document defaults and quality gating in `docs/config/contract.md`.
- [ ] Update config inventory docs after schema changes.
- [ ] Update build signature inputs to include lexicon + postings config.
- [ ] Add an explicit global off switch: `indexing.lexicon.enabled=false`.
- [ ] Define and document versioning rules for lexicon wordlists and explain schema changes.
- [ ] Add lexicon validation tooling:
  - `tools/lexicon/validate.js` (schema validation for all wordlists)
  - `tools/lexicon/report.js` (coverage stats: missing languages, token counts)
  - `npm run lexicon:validate` and `npm run lexicon:report`
  - optional CI check for `lexicon:validate`
- [ ] Add v2 note in `docs/specs/language-lexicon-wordlists.md` to explicitly defer non-ASCII keywords.

#### Tests
- [ ] `tests/config/` schema drift tests updated if config schema changes.
- [ ] `tests/indexer/incremental/signature-lexicon-config.test.js`
- [ ] `tests/config/config-inventory-lexicon-keys.test.js`
- [ ] `tests/config/config-defaults-lexicon-flags.test.js`
- [ ] `tests/lexicon/lexicon-tool-validate.test.js`
- [ ] `tests/lexicon/lexicon-report.test.js`

---

### 19.1 — Language lexicon assets and loader

#### Objective
Provide a standardized lexicon for all language registry ids, with a cached loader and derived stopword sets.

#### Touchpoints
- New:
  - `src/lang/lexicon/index.js`
  - `src/lang/lexicon/load.js`
  - `src/lang/lexicon/normalize.js`
  - `src/lang/lexicon/wordlists/_generic.json`
  - `src/lang/lexicon/wordlists/<languageId>.json`
  - `docs/specs/language-lexicon-wordlists.md`
  - `docs/schemas/language-lexicon-wordlist.schema.json`
- Existing registry:
  - `src/index/language-registry/registry-data.js`

#### Tasks
- [ ] Implement lexicon module:
  - [ ] `getLanguageLexicon(languageId, { allowFallback })`
  - [ ] `isLexiconStopword(languageId, token, domain)` for `relations|ranking|chargrams`
  - [ ] `extractSymbolBaseName(name)` shared helper
  - Must split on `.`, `::`, `->`, `#`, `/` and trim trailing `()`, `;`, `,`
  - [ ] Expose per-language overrides in lexicon JSON (allowlists/exclusions for relations stopwords)
- [ ] Loader behavior:
  - [ ] Use `import.meta.url` to resolve wordlist directory
  - [ ] Cache in `Map<languageId, LanguageLexicon>`
  - [ ] Fail-open: missing or invalid => `_generic`
  - [ ] Emit a single structured warning on invalid lexicon files
- [ ] Loader is deterministic: stable ordering, no locale-sensitive transforms
- [ ] Add schema validation for each wordlist file
  - [ ] Register schema in `src/contracts/registry.js` and validate on load
- [ ] Add lexicon files for each language id in the registry; keep v1 conservative (keywords + literals only)
  - For JS/TS, keep keywords conservative to avoid filtering property names

#### Tests
- [ ] `tests/lexicon/lexicon-schema.test.js`
- [ ] `tests/lexicon/lexicon-loads-all-languages.test.js`
- [ ] `tests/lexicon/lexicon-stopwords.test.js`
- [ ] `tests/lexicon/lexicon-fallback.test.js`
- [ ] `tests/lexicon/extract-symbol-base-name.test.js`
- [ ] `tests/lexicon/lexicon-ascii-only.test.js`
- [ ] `tests/lexicon/lexicon-per-language-overrides.test.js`

---

### 19.2 — Build-time lexicon-aware relation filtering

#### Objective
Filter `rawRelations` before building `file_relations` and `callIndex`, using lexicon stopwords for relations.

#### Touchpoints
- `src/index/build/file-processor/cpu.js`
- `src/index/build/file-processor/relations.js`
  - `buildFileRelations(rawRelations, relKey)`
  - `buildCallIndex(rawRelations)`
- `src/index/build/file-processor/process-chunks.js`
- `src/retrieval/output/filters.js`
- New:
  - `src/index/build/file-processor/lexicon-relations-filter.js`

#### Tasks
- [ ] Implement `filterRawRelationsWithLexicon(rawRelations, { languageId, lexicon, config, log })`.
- [ ] Apply filtering immediately before relation building in `cpu.js`.
- [ ] Filtering rules:
  - `usages`: drop tokens in `lexicon.stopwords.relations`
  - `calls`/`callDetails`/`callDetailsWithRange`: drop entries if `extractSymbolBaseName(callee)` is a stopword
  - Preserve stable ordering; de-dupe only if required
- [ ] Fail-open if lexicon missing or disabled.
- [ ] Add per-language override mechanism (drop keywords/literals/builtins/types separately).
- [ ] Ensure cached bundles are compatible:
  - If cached bundles bypass filtering, ensure signature invalidation covers lexicon changes.
- [ ] Make stable ordering a formal contract requirement (document + test).

#### Tests
- [ ] `tests/file-processor/lexicon-relations-filter.test.js`
- [ ] `tests/retrieval/uses-and-calls-filters-respect-lexicon.test.js`
- [ ] `tests/file-processor/lexicon-relations-filter-ordering.test.js`
- [ ] `tests/file-processor/lexicon-relations-filter-keyword-property.test.js`
- [ ] `tests/file-processor/lexicon-relations-filter-no-imports.test.js`
- [ ] `tests/file-processor/lexicon-relations-filter-determinism.test.js`

---

### 19.3 — Retrieval-time lexicon-aware relation boosts

#### Objective
Add boost-only ranking based on calls/usages aligned with query tokens, excluding lexicon stopwords.

#### Touchpoints
- `src/retrieval/pipeline.js`
- `src/retrieval/cli/query-plan.js`
- New:
  - `src/retrieval/scoring/relation-boost.js`

#### Tasks
- [ ] Implement `computeRelationBoost({ chunk, fileRelations, queryTokens, lexicon, config })`.
- [ ] Wire into scoring in `src/retrieval/pipeline.js`:
  - Add `relationBoost` alongside existing boosts
  - Ensure boost-only (no filtering)
  - Provide explain payload when `--explain`
- [ ] Gate by quality or config (default off).
- [ ] Ensure query token source uses `buildQueryPlan(...)` output (no recompute).
- [ ] Define case-folding behavior in relation to `caseTokens` and `caseFile`.
- [ ] Add explain schema snippet documenting `relationBoost` fields and units.

#### Tests
- [ ] `tests/retrieval/relation-boost.test.js`
- [ ] `tests/retrieval/relation-boost-does-not-filter.test.js`
- [ ] `tests/retrieval/explain-includes-relation-boost.test.js`
- [ ] `tests/retrieval/relation-boost-case-folding.test.js`
- [ ] `tests/retrieval/relation-boost-stopword-elision.test.js`

---

### 19.4 — Chargram enrichment and ANN candidate safety

#### Objective
Allow optional chargram enrichment without recall loss, and enforce candidate set safety in ANN/minhash.

#### Touchpoints
- `src/shared/postings-config.js`
- `src/index/build/state.js` (chargram generation from fieldTokens)
- `src/retrieval/pipeline/candidates.js`
- `src/retrieval/pipeline.js`
- New:
  - `src/retrieval/scoring/ann-candidate-policy.js`

#### Tasks
- [ ] Extend `normalizePostingsConfig` to support `chargramFields` + `chargramStopwords` with defaults.
- [ ] Update chargram tokenization in `appendChunk(...)` to use `chargramFields` and optional lexicon stopword filtering.
- [ ] Implement `resolveAnnCandidateSet(...)` and apply to ANN and minhash candidate selection:
  - Use `annCandidateCap`, `annCandidateMinDocCount`, `annCandidateMaxDocCount`
  - Ensure filtersActive + allowedIdx behavior is preserved
- [ ] Emit explain payload for candidate policy decisions with deterministic `reason` codes.
- [ ] Ensure ANN/minhash use the same candidate policy (no divergence).
- [ ] Add a shared policy contract for `resolveAnnCandidateSet` and reuse in both paths.

#### Tests
- [ ] `tests/postings/chargram-fields.test.js`
- [ ] `tests/retrieval/ann-candidate-policy.test.js`
- [ ] `tests/retrieval/ann-candidate-policy-explain.test.js`
- [ ] `tests/postings/chargram-stopwords.test.js`
- [ ] `tests/retrieval/ann-candidate-policy-minhash-parity.test.js`
- [ ] `tests/retrieval/ann-candidate-policy-allowedIdx.test.js`
- [ ] `tests/retrieval/ann-candidate-policy-contract.test.js`

---

### 19.5 — Observability, tuning, and rollout

#### Objective
Make filtering/boosting behavior transparent and safe to tune.

#### Touchpoints
- `src/index/build/file-processor/cpu.js` (logging/counters)
- `src/retrieval/pipeline.js` (explain payload)
- `src/shared/auto-policy.js` (quality-based defaults)
- `docs/testing/truth-table.md` (quality gating + defaults)

#### Tasks
- [ ] Emit structured per-file counts for relations filtering (calls/usages dropped).
- [ ] Add `relationBoost` + `annCandidatePolicy` to explain output.
- [ ] Gate new features behind `quality=max` by default (unless explicit config enables).
- [ ] Add a compact summary line to build logs when lexicon filtering is active (opt-in via verbose).
- [ ] Add a lexicon status section to explain output when enabled (source file + version + domain counts).

#### Tests
- [ ] `tests/retrieval/explain-includes-relation-boost.test.js`
- [ ] `tests/retrieval/explain-includes-ann-policy.test.js`
- [ ] `tests/indexing/logging/lexicon-filter-counts.test.js`

---

### Proposed phase order (19.x)
1) 19.0 – Setup + contracts (config schema + docs + lexicon schema + tooling).
2) 19.1 – Lexicon loader + wordlists.
3) 19.2 – Build-time relations filtering.
4) 19.4 – Chargram enrichment + ANN candidate safety.
5) 19.3 – Retrieval relation boosts.
6) 19.5 – Observability + rollout gating.

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

---


## Appendix A — LEXI (verbatim)

# LEXI

This document consolidates the Phase 11.9 lexicon specs into a complete, repo-aligned implementation plan with granular tasks, tests, and touchpoints. The draft spec content has been absorbed here; future/lexi drafts can be removed once this plan is the single source of truth.

---

## Evaluation Notes (by document)

These notes assume the Phase 11.9 specs are promoted into `docs/specs/` (see 11.9.0 tasks). Any discrepancies should be resolved in those canonical docs first, then reflected here.

### phase-11.9-lexicon-aware-relations-and-retrieval-enrichment.md
- Well structured and matches repo architecture; touchpoints listed are mostly accurate.
- Adjustments needed:
  - `src/retrieval/pipeline.js` is the actual scoring entrypoint; any new boost/candidate policy work should be wired there and in `src/retrieval/pipeline/candidates.js` (for candidate set building).
  - Retrieval options parsing for ANN candidate controls is not currently exposed in `src/retrieval/cli/normalize-options.js`; the phase should include parsing and config schema updates if these knobs are to be configurable.
  - Relation filtering should explicitly preserve stable ordering and avoid filtering builtins/types by default (already stated); for JS-like languages where keywords can be property names, limit keyword lists to safe identifiers or add per-language allowlists.

### spec-language-lexicon-wordlists.md
- Solid and conservative; aligns with a fail-open loader.
- Ambiguity: "ASCII only" is safe but may exclude keywords for some languages (e.g., localized keywords). This should be explicit as a v1 constraint with a future v2 note.
- Add a clearer contract for `extractSymbolBaseName` and document separators ordering (consistent with relations spec).
- Ensure the canonical wordlist format includes `formatVersion`, `languageId`, and required arrays, with a strict schema (additionalProperties=false).

### spec-lexicon-relations-filtering.md
- Correct placement and safety constraints.
- Ambiguity: Should filtering also apply to `rawRelations.imports/exports`? The spec says no; keep it explicit and add a note that only usages/calls/callDetails/callDetailsWithRange are filtered in v1.
- Recommend adding per-language overrides for stopword sets (e.g., JS keyword subset) to avoid over-filtering.

### spec-lexicon-retrieval-boosts.md
- Good; boost-only with clear explain payload.
- Adjustment: query token source is `src/retrieval/cli/query-plan.js`, but the actual tokens are available in the pipeline context. Wire from existing query plan rather than recomputing.
- Clarify whether `queryTokens` are case-folded using `caseTokens` (current pipeline has `caseTokens` and `caseFile` flags).

### spec-chargram-enrichment-and-ann-fallback.md
- Matches current architecture.
- Adjustment: `annCandidateMinDocCount` and related knobs are not currently parsed or surfaced; add explicit config plumbing and schema updates in this phase.
- Candidate policy should be shared between ANN and minhash fallbacks (currently the pipeline reuses `annCandidateBase` for minhash); the policy should be applied consistently.

---

## Spec Extracts to Carry Forward (Authoritative Details)

These are the non-negotiable details that must be preserved when the Phase 11.9 specs are promoted into `docs/specs/` and implemented.

### Lexicon wordlist format (v1)
- Required fields: `formatVersion` (const 1), `languageId`, `keywords[]`, `literals[]`.
- Optional fields: `types[]`, `builtins[]`, `modules[]`, `notes[]`.
- File layout: `src/lang/lexicon/wordlists/_generic.json` and `src/lang/lexicon/wordlists/<languageId>.json` (languageId must match registry id).
- Normalization rules: lowercase, trim, ASCII-only, non-empty, dedupe. Sort on disk, but loader must normalize regardless.
- Derived stopword domains:
  - `relations = keywords ∪ literals`
  - `ranking = keywords ∪ literals ∪ types ∪ builtins`
  - `chargrams = keywords ∪ literals` (optionally extended to types/builtins when chargramStopwords is enabled)
- Fail-open loader with `_generic` fallback and one-time warnings on schema failures.

### Lexicon schema requirements
- `language-lexicon-wordlist.schema.json` v1:
  - `additionalProperties=false`
  - `formatVersion` const 1
  - arrays of strings (minLength 1) for wordlist fields
- The schema must be registered under `src/contracts/registry.js` if validation is enforced at load time.

### Relations filtering (build-time)
- Filter only `usages`, `calls`, `callDetails`, `callDetailsWithRange` (not imports/exports in v1).
- `extractSymbolBaseName` separators (split, take last non-empty): `.`, `::`, `->`, `#`, `/`.
- Trim trailing `()`, `;`, `,` from base name.
- Preserve stable order; optional stable de-dupe (keep first occurrence).

### Retrieval relation boosts
- Signal tokens derive from `buildQueryPlan(...)` output (use pipeline query plan, not recompute).
- Per-hit stopword filtering in ranking domain; case-folding must respect `caseTokens`.
- Scoring: `boost = min(maxBoost, callMatches*perCall + usageMatches*perUse)` with small defaults.
- Explain output includes `relationBoost` with bounded token lists and deterministic ordering/truncation.

### Chargram enrichment + ANN candidate policy
- Allowed `chargramFields`: `name`, `signature`, `doc`, `comment`, `body` (default `name,doc`).
- Optional `chargramStopwords` uses lexicon `chargrams` domain for token filtering.
- Candidate policy rules (deterministic):
  - `null` candidates -> null (full ANN)
  - empty set -> empty set (no ANN hits)
  - too large -> null
  - too small with no filters -> null
  - filtersActive + allowedIdx -> allowedIdx
  - otherwise -> candidates
- Explain `annCandidatePolicy` includes `inputSize`, `output`, `reason` (`noCandidates`, `tooLarge`, `tooSmallNoFilters`, `filtersActiveAllowedIdx`, `ok`).

---

# Phase 11.9 – Lexicon-Aware Relations and Retrieval Enrichment

## Feature Flags + Defaults (v1)
- Lexicon loader: enabled by default; fail-open on missing/invalid files.
- Relation filtering: enabled only at `quality=max` unless explicitly enabled in config.
- Relation boosts: disabled by default; must be explicitly enabled.
- Chargram enrichment: disabled by default; must be explicitly enabled.
- ANN/minhash candidate safety policy: always on (safety), but explain output is opt-in.
- Global off-switch: `indexing.lexicon.enabled=false` disables lexicon filtering and related boosts.

## Contract Surface (versioned)
- Lexicon wordlists: schema-versioned JSON, validated on load.
- Explain output: `relationBoost` and `annCandidatePolicy` fields added with a versioned explain schema.
- Config schema: new lexicon + ANN candidate keys explicitly versioned in docs/config schema and inventory.

## Performance Guardrails
- All lexicon filtering must be O(n) over relations; no per-token regex or substring scans.
- Avoid new allocations in inner loops; reuse buffers/arrays where possible.
- Relation boost matching must be bounded by query token count (no unbounded scans).

## Compatibility: cache/signature impact
- Build signature inputs must include lexicon configs (stopwords, chargramFields/stopwords) and ANN candidate knobs.
- If signature shape changes, bump `SIGNATURE_VERSION` and update incremental tests accordingly.

## 11.9.0 – Cross-cutting Setup and Contracts

### Goals
- Establish the lexicon contract, schema, and config surfaces.
- Align config/CLI/doc surfaces with current codebase.

### Additional docs/specs that MUST be updated
- `docs/config/schema.json` + `docs/config/contract.md` + `docs/config/inventory.*`
- `docs/specs/language-lexicon-wordlists.md`
- `docs/specs/lexicon-relations-filtering.md`
- `docs/specs/lexicon-retrieval-boosts.md`
- `docs/specs/chargram-enrichment-and-ann-fallback.md`

### Touchpoints
- `src/lang/` (new lexicon module)
- `src/shared/postings-config.js` (new fields)
- `src/retrieval/cli/normalize-options.js` (new ANN candidate config knobs)
- `src/retrieval/cli/query-plan.js` (query token source for boosts)
- `src/retrieval/output/explain.js` + `src/retrieval/output/format.js` (explain payload surfacing)
- `src/index/build/indexer/signatures.js` (incremental signature inputs / cache invalidation)
- `docs/config/schema.json`, `docs/config/contract.md`, `docs/config/inventory.*` (config surface)
- `docs/specs/*` (lexicon + retrieval specs, if promoted to canonical docs)
 - `src/contracts/registry.js` (register lexicon schema if added)
 - `src/contracts/schemas/*` + `src/contracts/validators/*` (lexicon wordlist schema)

### Tasks
- [ ] Decide canonical location for lexicon spec files (recommend `docs/specs/lexicon-*.md`).
- [ ] Add/extend config schema entries for:
  - `indexing.postings.chargramFields`
  - `indexing.postings.chargramStopwords`
  - `retrieval.annCandidateCap`
  - `retrieval.annCandidateMinDocCount`
  - `retrieval.annCandidateMaxDocCount`
  - `retrieval.relationBoost` (if exposed in config; otherwise document as quality-gated internal).
- [ ] Document defaults and quality gating in `docs/config/contract.md` or equivalent.
- [ ] Update config inventory docs after schema changes (keeps script surface tests green).
- [ ] Update build signature inputs to include lexicon + postings config so incremental caches reset:
  - `buildIncrementalSignaturePayload(...)` should include lexicon config (stopword policies) and new postings fields.
  - Consider bumping `SIGNATURE_VERSION` if signature shape changes.
 - [ ] Add an explicit config flag to disable lexicon features globally (`indexing.lexicon.enabled=false`).
 - [ ] Define and document versioning rules for lexicon wordlists and explain schema changes.

### Tests
- [ ] `tests/config/` schema drift tests updated if config schema changes.
- [ ] `tests/indexer/incremental/signature-lexicon-config.test.js` (signature changes when lexicon/postings config changes).
 - [ ] `tests/config/config-inventory-lexicon-keys.test.js` (inventory includes lexicon keys).
 - [ ] `tests/config/config-defaults-lexicon-flags.test.js` (defaults match documented behavior).

---

## 11.9.1 – Language Lexicon Assets and Loader

### Objective
Provide a standardized lexicon for all language registry ids, with a cached loader and derived stopword sets.

### Touchpoints
- New:
  - `src/lang/lexicon/index.js` (public surface)
  - `src/lang/lexicon/load.js` (file loading + caching)
  - `src/lang/lexicon/normalize.js` (lowercase/ASCII normalization)
  - `src/lang/lexicon/wordlists/_generic.json`
  - `src/lang/lexicon/wordlists/<languageId>.json`
  - `docs/specs/language-lexicon-wordlists.md` (if promoted)
  - `docs/schemas/language-lexicon-wordlist.schema.json` (or similar; keep consistent with other schemas)
- Existing registry:
  - `src/index/language-registry/registry-data.js` (language ids)

### Tasks
- [ ] Implement lexicon module:
  - [ ] `getLanguageLexicon(languageId, { allowFallback })` -> returns normalized sets.
  - [ ] `isLexiconStopword(languageId, token, domain)` for `relations|ranking|chargrams`.
  - [ ] `extractSymbolBaseName(name)` shared helper.
  - Must split on `.`, `::`, `->`, `#`, `/` and trim trailing `()`, `;`, `,`.
  - [ ] Expose per-language overrides in the lexicon JSON (e.g., allowlists/exclusions for relations stopwords).
- [ ] Loader behavior:
  - [ ] Use `import.meta.url` to resolve wordlist directory.
  - [ ] Cache in `Map<languageId, LanguageLexicon>`.
  - [ ] Fail-open: missing or invalid => `_generic`.
  - [ ] Emit a single structured warning on invalid lexicon files (no per-token spam).
- [ ] Loader must be deterministic: stable ordering, no locale-sensitive transforms.
- [ ] Add schema validation for each wordlist file.
  - [ ] Register schema in `src/contracts/registry.js` and validate on load.
- [ ] Add lexicon files for each language id in the registry; keep v1 conservative (keywords + literals only).
  - Note: For JS/TS, keep keywords list conservative to avoid filtering property names.

### Tests
- [ ] `tests/lexicon/lexicon-schema.test.js`
- [ ] `tests/lexicon/lexicon-loads-all-languages.test.js`
- [ ] `tests/lexicon/lexicon-stopwords.test.js` (verify derived stopword sets)
- [ ] `tests/lexicon/lexicon-fallback.test.js` (missing/invalid file -> _generic)
- [ ] `tests/lexicon/extract-symbol-base-name.test.js` (separators `.`, `::`, `->`, `#`, `/` and trailing punctuation trimming)
- [ ] `tests/lexicon/lexicon-ascii-only.test.js` (explicit v1 constraint)
 - [ ] `tests/lexicon/lexicon-per-language-overrides.test.js`

---

## 11.9.2 – Build-Time Lexicon-Aware Relation Filtering

### Objective
Filter `rawRelations` before building `file_relations` and `callIndex`, using lexicon stopwords for relations.

### Touchpoints
- `src/index/build/file-processor/cpu.js`
  - Where `rawRelations` is produced and `buildFileRelations(...)` / `buildCallIndex(...)` are called.
- `src/index/build/file-processor/relations.js`
  - `buildFileRelations(rawRelations, relKey)`
  - `buildCallIndex(rawRelations)`
- `src/index/build/file-processor/process-chunks.js`
  - Builds per-chunk `codeRelations` from `callIndex` and writes call details; ensure filtered relations are reflected.
- `src/retrieval/output/filters.js`
  - `--calls` / `--uses` filters consume `codeRelations` and `file_relations`.
- New:
  - `src/index/build/file-processor/lexicon-relations-filter.js`

### Tasks
- [ ] Implement `filterRawRelationsWithLexicon(rawRelations, { languageId, lexicon, config, log })`.
- [ ] Apply filtering immediately before relation building:
  - In `cpu.js` inside the per-file processing flow, right after `lang.buildRelations(...)` and before `buildFileRelations` / `buildCallIndex`.
- [ ] Filtering rules:
  - `usages`: drop tokens whose normalized form is in `lexicon.stopwords.relations`.
  - `calls` / `callDetails` / `callDetailsWithRange`: drop entries if `extractSymbolBaseName(callee)` is a stopword.
  - Preserve stable ordering; dedupe only if required.
- [ ] Fail-open if lexicon missing or disabled.
- [ ] Add a per-language override mechanism (e.g., config to drop keywords/literals/builtins/types separately).
- [ ] Ensure cached bundles are compatible:
  - If cached bundles can bypass filtering, ensure incremental signature invalidation covers lexicon changes.
 - [ ] Make stable ordering a formal contract requirement (document + test).

### Tests
- [ ] `tests/file-processor/lexicon-relations-filter.test.js`
- [ ] `tests/retrieval/uses-and-calls-filters-respect-lexicon.test.js`
- [ ] `tests/file-processor/lexicon-relations-filter-ordering.test.js` (stable ordering)
- [ ] `tests/file-processor/lexicon-relations-filter-keyword-property.test.js` (JS/TS property-name edge case)
- [ ] `tests/file-processor/lexicon-relations-filter-no-imports.test.js` (imports/exports unchanged)
 - [ ] `tests/file-processor/lexicon-relations-filter-determinism.test.js`

---

## 11.9.3 – Retrieval-Time Lexicon-Aware Relation Boosts

### Objective
Add boost-only ranking based on calls/usages aligned with query tokens, excluding lexicon stopwords.

### Touchpoints
- `src/retrieval/pipeline.js` (scoring and explain output)
- `src/retrieval/cli/query-plan.js` (query tokens source)
- New:
  - `src/retrieval/scoring/relation-boost.js`

### Tasks
- [ ] Implement `computeRelationBoost({ chunk, fileRelations, queryTokens, lexicon, config })`.
- [ ] Wire into scoring in `src/retrieval/pipeline.js`:
  - Add `relationBoost` alongside existing boosts (symbol/phrase/etc).
  - Ensure boost-only (no filtering).
  - Provide explain payload when `--explain`.
- [ ] Gate by quality or config (default off).
- [ ] Ensure query token source uses `buildQueryPlan(...)` output (do not recompute).
- [ ] Define case-folding behavior in relation to `caseTokens` and `caseFile`.
 - [ ] Add a small explain schema snippet documenting `relationBoost` fields and units.

### Tests
- [ ] `tests/retrieval/relation-boost.test.js`
- [ ] `tests/retrieval/relation-boost-does-not-filter.test.js`
- [ ] `tests/retrieval/explain-includes-relation-boost.test.js`
- [ ] `tests/retrieval/relation-boost-case-folding.test.js`
- [ ] `tests/retrieval/relation-boost-stopword-elision.test.js`

---

## 11.9.4 – Chargram Enrichment and ANN Candidate Safety

### Objective
Allow optional chargram enrichment without recall loss, and enforce candidate set safety in ANN/minhash.

### Touchpoints
- `src/shared/postings-config.js` (new `chargramFields`, `chargramStopwords`)
- `src/index/build/state.js` (chargram generation from fieldTokens)
- `src/retrieval/pipeline/candidates.js` (candidate set building)
- `src/retrieval/pipeline.js` (ANN/minhash usage)
- New:
  - `src/retrieval/scoring/ann-candidate-policy.js`

### Tasks
- [ ] Extend `normalizePostingsConfig` to support `chargramFields` + `chargramStopwords` with defaults.
- [ ] Update chargram tokenization in `appendChunk(...)` (in `src/index/build/state.js`) to use `chargramFields` and optional lexicon stopword filtering.
- [ ] Implement `resolveAnnCandidateSet(...)` and apply it to ANN and minhash candidate selection:
  - Use `annCandidateCap`, `annCandidateMinDocCount`, `annCandidateMaxDocCount`.
  - Ensure filtersActive + allowedIdx behavior is preserved.
- [ ] Emit explain payload for candidate policy decisions, with deterministic `reason` codes (`noCandidates`, `tooLarge`, `tooSmallNoFilters`, `filtersActiveAllowedIdx`, `ok`).
- [ ] Ensure ANN/minhash use the same candidate policy (no divergence).
 - [ ] Add a shared policy contract for `resolveAnnCandidateSet` and reuse in both paths.

### Tests
- [ ] `tests/postings/chargram-fields.test.js`
- [ ] `tests/retrieval/ann-candidate-policy.test.js`
- [ ] `tests/retrieval/ann-candidate-policy-explain.test.js`
- [ ] `tests/postings/chargram-stopwords.test.js` (lexicon stopword interaction)
- [ ] `tests/retrieval/ann-candidate-policy-minhash-parity.test.js`
- [ ] `tests/retrieval/ann-candidate-policy-allowedIdx.test.js`
 - [ ] `tests/retrieval/ann-candidate-policy-contract.test.js`

---

## 11.9.5 – Observability, Tuning, and Rollout

### Objective
Make filtering/boosting behavior transparent and safe to tune.

### Touchpoints
- `src/index/build/file-processor/cpu.js` (logging/counters)
- `src/retrieval/pipeline.js` (explain payload)
- `src/shared/auto-policy.js` (quality-based defaults)

### Tasks
- [ ] Emit structured per-file counts for relations filtering (calls/usages dropped).
- [ ] Add `relationBoost` + `annCandidatePolicy` to explain output.
- [ ] Gate new features behind `quality=max` by default (unless explicit config enables).
- [ ] Add a compact summary line to build logs when lexicon filtering is active (opt-in via verbose).
 - [ ] Add a “lexicon status” section to explain output when enabled (source file + version).

### Tests
- [ ] `tests/retrieval/explain-includes-relation-boost.test.js`
- [ ] `tests/retrieval/explain-includes-ann-policy.test.js`
- [ ] `tests/indexing/logging/lexicon-filter-counts.test.js` (log line shape, opt-in)

---

## Notes / Implementation Guidelines

- Prefer fail-open behavior for all lexicon-based filtering.
- Keep relation filtering conservative (keywords + literals only) unless explicitly configured per language.
- Preserve ordering; dedupe only with stable, deterministic behavior.
- Avoid new CLI flags unless required; prefer config + quality gating.
- When adding config, update docs/config schema + contract and keep drift tests passing.
- Make sure any new config keys are included in config inventory + env/config precedence docs if referenced.
 - All new lexicon behavior must be disabled by `indexing.lexicon.enabled=false`.

---

## Known Touchpoints (Function Names)

Use these function names to anchor changes:

- `processFiles(...)` in `src/index/build/indexer/steps/process-files.js` (tree-sitter deferral logic already uses ordering helpers).
- `buildFileRelations(...)` and `buildCallIndex(...)` in `src/index/build/file-processor/relations.js`.
- `createSearchPipeline(...)` in `src/retrieval/pipeline.js` (scoring + ANN candidate handling).
- `buildQueryPlan(...)` in `src/retrieval/cli/query-plan.js` (token source).
- `appendChunk(...)` in `src/index/build/state.js` (chargrams from fieldTokens).

---

## Proposed Phase Order

1. 11.9.0 – Setup + contracts (config schema + docs + lexicon schema).
2. 11.9.1 – Lexicon loader + wordlists.
3. 11.9.2 – Build-time relations filtering.
4. 11.9.4 – Chargram enrichment + ANN candidate safety (foundation for retrieval safety).
5. 11.9.3 – Retrieval relation boosts (ranking-only).
6. 11.9.5 – Observability + rollout gating.

---

