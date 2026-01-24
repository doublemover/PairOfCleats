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

Phase 1 — P0 Correctness Hotfixes (Shared Primitives + Indexer Core)
Phase 2 — Contracts and Policy Kernel (Artifact Surface, Schemas, Compatibility)
Phase 3 — Correctness Endgame (imports • signatures • watch • build state)
Phase 4 — Runtime Envelope, Concurrency, and Safety Guardrails
Phase 5 — Metadata v2 + Effective Language Fidelity (Segments & VFS prerequisites)
Phase 6 — Universal Relations v2 (Callsites, Args, and Evidence)
Phase 19 — LibUV threadpool utilization (explicit control + docs + tests)
Phase 20 — Threadpool-aware I/O scheduling guardrails
Phase 14 — Documentation and Configuration Hardening
Phase 12 — Generic SCM/Metadata Provider API (Git, JJ, and Beyond)
Phase 13 — Full JJ Support
Phase 10 — Index snapshotting + diffing + time-travel
Phase 11 — Federation + Centralized Caching + Scalability
Phase 28 — Distribution Readiness + Capability Matrix + Doctor/Strict Mode
Phase 24 — MCP server: migrate from custom JSON-RPC plumbing to official MCP SDK (reduce maintenance)
Phase 25 — Massive functionality boost: PDF + DOCX ingestion (prose mode)
Phase 32 — Embeddings native load failures (ERR_DLOPEN_FAILED)
Phase 16 — Vector-Only Indexing Profile + Embeddings Robustness
Phase 17 — Operator UX: TUI/Web UI + Visualization Fidelity
Phase 31 — Isometric Visual Fidelity (Yoink-derived polish)
Phase 34 — Segment-aware analysis backbone
Phase 35 — CallDetails everywhere (arguments + callsite evidence across all languages)
Phase 36 — Type inference parity upgrades (tooling + docs + tests)
Phase 37 — Symbol identity + cross-file linking upgrades
Phase 38 — Interprocedural risk summaries + risk flows v2
Phase 39 — Graph-aware product features
Phase 40 — Analysis contracts + capability matrix + perf guardrails + incremental/index-diff integration
Phase 41 — Framework/embedded-language analysis (Vue/Svelte/Astro/React)
Phase 42 — Performance, determinism, and regression harness
Phase 43 — Type inference parity (JS/JSX via TS tooling, broader tooling providers, and cross-file argMap)
Phase 44 — Symbol identity and cross-file linking upgrades
Phase 45 — Graph-aware developer features (context packs, impact, contracts, architecture, tests)
Phase 46 — Interprocedural risk flows (taint summaries + risk paths)
Phase 47 — Tooling UX: installation, configuration, and diagnostics
Phase 29 — Optional: Service-Mode Integration for Sublime (API-backed Workflows)

---

## Phase 1 — P0 Correctness Hotfixes (Shared Primitives + Indexer Core) [@]

### Objective

Eliminate known “silent correctness” failures and fragile invariants in the core index build pipeline, focusing on concurrency/error propagation, postings construction, embedding handling, import scanning, and progress/logging. The intent is to make incorrect outputs fail fast (or degrade in a clearly documented, test-covered way) rather than silently producing partial or misleading indexes.

---

### 1.1 Concurrency primitives: deterministic error propagation + stable backpressure

- **Files touched:**
  - `src/shared/concurrency.js`

- [x] **Fix `runWithQueue()` to never “succeed” when worker tasks reject**
  - [x] Separate _in-flight backpressure tracking_ from _final completion tracking_ (avoid “removing from `pending` then awaiting `pending`” patterns that can drop rejections).
  - [x] Ensure every enqueued task has an attached rejection handler immediately (avoid unhandled-rejection windows while waiting to `await` later).
  - [x] Await completion in a way that guarantees: if any worker rejects, `runWithQueue()` rejects (no silent pass).
- [x] **Make backpressure logic robust to worker rejections**
  - [x] Replace `Promise.race(pending)` usage with a variant that unblocks on completion **regardless of fulfill/reject**, without throwing mid-scheduling.
  - [x] Decide and document semantics explicitly:
    - Default behavior: **fail-fast scheduling** (stop enqueueing new items after first observed failure),
    - But still **drain already-enqueued tasks to a settled state** before returning error (avoid “background work continues after caller thinks it failed”).
  - [x] Ensure `runWithConcurrency()` inherits the same semantics via `runWithQueue()`.
- [x] **Accept iterables, not just arrays**
  - [x] Allow `items` to be any iterable (`Array`, `Set`, generator), by normalizing once at the start (`Array.from(...)`) and using that stable snapshot for `results` allocation and deterministic ordering.
- [x] **Stop swallowing queue-level errors**
  - [x] Replace the current no-op `queue.on('error', () => {})` behavior with a handler that **records/logs** queue errors and ensures they surface as failures of the enclosing `runWithQueue()` call.
  - [x] Ensure no listener leaks (attach per-call with cleanup, or attach once in a way that does not grow unbounded).

#### Tests / Verification

- [x] Add `tests/concurrency-run-with-queue-error-propagation.js`
  - [x] A rejecting worker causes `runWithQueue()` to reject reliably (no “resolved success”).
  - [x] Ensure no unhandled-rejection warnings are emitted under a rejecting worker (attach handlers early).
- [x] Add `tests/concurrency-run-with-queue-backpressure-on-reject.js`
  - [x] When an early task rejects and later tasks are still in-flight, the function’s failure behavior is deterministic and documented (fail-fast enqueueing + drain in-flight).
- [x] Add `tests/concurrency-run-with-queue-iterables.js`
  - [x] Passing a `Set` or generator as `items` produces correct ordering and correct results length.

---

### 1.2 Embeddings pipeline: merge semantics, TypedArray parity, and no-hang batching

- **Files touched:**
  - `src/shared/embedding-utils.js`
  - `src/index/build/file-processor/embeddings.js`
  - `src/index/build/indexer/steps/postings.js`

- [x] **Make `mergeEmbeddingVectors()` correct and explicit**
  - [x] When only one vector is present, return that vector unchanged (avoid “code-only is halved”).
  - [x] When both vectors are present:
    - [x] Define dimension mismatch behavior explicitly (avoid NaNs and silent truncation).
          Recommended Phase 1 behavior: **fail closed** with a clear error (dimension mismatch is a correctness failure), unless/until a contract says otherwise.
    - [x] Ensure merge never produces NaN due to `undefined`/holes (`(vec[i] ?? 0)` defensively).
  - [x] Keep output type stable (e.g., `Float32Array`) and documented.
- [x] **Ensure TypedArray parity across embedding ingestion**
  - [x] In `src/index/build/indexer/steps/postings.js`, replace `Array.isArray(...)` checks for embedding floats with a vector-like predicate (accept `Float32Array` and similar).
  - [x] Ensure quantization in the postings step uses the same “vector-like” acceptance rules for merged/doc/code vectors.
- [x] **Fix embedding batcher reentrancy: no unflushed queued work**
  - [x] In `createBatcher()` (`src/index/build/file-processor/embeddings.js`), handle “flush requested while flushing” deterministically:
    - [x] If `flush()` is called while `flushing === true`, record intent (e.g., `needsFlush = true`) rather than returning and risking a stranded queue.
    - [x] After a flush finishes, if the queue is non-empty (or `needsFlush`), perform/schedule another flush immediately.
  - [x] Ensure the batcher cannot enter a state where items remain queued with no timer and no subsequent trigger.
- [x] **Enforce a single build-time representation for “missing doc embedding”**
  - [x] Standardize on **one marker** at build time (current marker is `EMPTY_U8`) to represent “no doc embedding present”.
  - [x] Ensure downstream steps never interpret “missing doc embedding” as “fallback to merged embedding” (the doc-only semantics fix is completed in **1.4**, but Phase 1.2 should ensure the marker is consistently produced).

#### Tests / Verification

- [x] Add `tests/embedding-merge-vectors-semantics.js`
  - [x] Code-only merge returns identical vector (no halving).
  - [x] Doc-only merge returns identical vector (no scaling).
  - [x] Mismatched dimensions is deterministic (throws or controlled fallback per Phase 1 decision), and never yields NaNs.
- [x] Add `tests/embedding-typedarray-quantization-postings-step.js`
  - [x] A `Float32Array` embedding input is quantized and preserved equivalently to a plain array.
- [x] Add `tests/embedding-batcher-flush-reentrancy.js`
  - [x] Reentrant flush (flush called while flushing) does not strand queued items; all queued work is eventually flushed and promises resolve.
- [x] Run existing embedding build tests to confirm no regressions:
  - [x] `npm test -- embedding-batch-*`
  - [x] `npm test -- build-embeddings-cache`

---

### 1.3 Postings state correctness: chargrams, tokenless chunks, and guardrails without truncation

- **Files touched:**
  - `src/index/build/state.js`

- [x] **Fix chargram extraction “early abort” on long tokens**
  - [x] Replace the per-token `return` with `continue` inside chargram token processing so a single long token does not suppress all subsequent tokens for the chunk.
  - [x] Ensure chargram truncation behavior remains bounded by `maxChargramsPerChunk`.
- [x] **Make chargram min/max-N configuration robust**
  - [x] Stop relying on callers always passing pre-normalized postings config.
  - [x] Ensure `chargramMinN`, `chargramMaxN`, and `chargramMaxTokenLength` have safe defaults consistent with `normalizePostingsConfig()` when absent.
  - [x] Ensure invalid ranges (min > max) degrade deterministically (swap or clamp) and are covered by tests.
- [x] **Preserve tokenless chunks**
  - [x] Remove the early return that drops chunks when `seq` is empty.
  - [x] Continue to:
    - [x] Assign chunk IDs and append chunk metadata,
    - [x] Record `docLengths[chunkId] = 0`,
    - [x] Allow phrase/field indexing paths to run where applicable (field-sourced tokens can still produce phrases even when `seq` is empty),
    - [x] Skip token postings updates cleanly (no crashes).
- [x] **Fix max-unique guard behavior to avoid disabling all future updates**
  - [x] Redefine guard behavior so that “max unique reached” stops _introducing new keys_ but does **not** prevent:
    - [x] Adding doc IDs for **existing** keys,
    - [x] Continuing to process remaining keys in the same chunk.
  - [x] Remove/adjust any “break if guard.disabled” loops that prevent existing-key updates (the key-level function should decide whether to skip).

#### Tests / Verification

- [x] Add `tests/postings-chargram-long-token-does-not-abort.js`
  - [x] A chunk containing one overlong token plus normal tokens still produces chargrams from the normal tokens.
- [x] Add `tests/postings-tokenless-chunk-preserved.js`
  - [x] Tokenless chunk still appears in state (`chunks.length` increments, `docLengths` has an entry, metadata preserved).
- [x] Add `tests/postings-chargram-config-defaults.js`
  - [x] Passing an unnormalized postings config does not break chargram generation and uses default min/max values.
- [x] Add `tests/postings-guard-max-unique-keeps-existing.js`
  - [x] After hitting `maxUnique`, existing keys continue to accumulate doc IDs; only new keys are skipped.

---

### 1.4 Dense postings build: doc-only semantics and vector selectors (byte + float paths)

- **Files touched:**
  - `src/index/build/postings.js`
- [x] **Fix doc-only semantics: missing doc vectors must behave as zero vectors**
  - [x] In the quantized-u8 path (`extractDenseVectorsFromChunks`):
    - [x] Stop falling back to merged embeddings when `embed_doc_u8` is absent/unparseable.
    - [x] Normalize doc vectors so that:
      - `EMPTY_U8` ⇒ zero-vector semantics (already intended),
      - _missing/invalid_ `embed_doc_u8` ⇒ **also** zero-vector semantics (not merged fallback).
  - [x] In the legacy float path (`selectDocEmbedding`):
    - [x] Stop falling back to `chunk.embedding` when `chunk.embed_doc` is missing.
    - [x] Treat missing doc embedding as “no doc embedding” (zero-vector semantics for doc-only retrieval), consistent with the empty-marker rule.
- [x] **Accept TypedArrays in legacy float extraction**
  - [x] Replace `Array.isArray(vec)` checks with a vector-like predicate to avoid dropping `Float32Array` embeddings when building dense artifacts from float fields.
- [x] **Document the invariant**
  - [x] Clearly document: _doc-only retrieval uses doc embeddings; when doc embedding is missing, the chunk behaves as if its doc embedding is the zero vector (i.e., it should not match doc-only queries due to code-only embeddings)._
        (This is a correctness guarantee; performance tuning can follow later.)

#### Tests / Verification

- [x] Add `tests/postings-doc-only-missing-doc-is-zero.js`
  - [x] A chunk with code-only embeddings does **not** get a doc vector equal to the merged/code vector when doc embedding is missing.
  - [x] Both quantized and legacy float paths enforce the same semantics (construct fixtures to exercise both).
- [x] Add `tests/postings-typedarray-legacy-float-extraction.js`
  - [x] `Float32Array` embeddings are recognized and included when building dense postings from legacy float fields.

---

### 1.5 Import scanning: options forwarding, lexer init correctness, fallback coverage, and proto safety

- **Files touched:**
  - `src/index/build/imports.js`
  - `src/index/language-registry/registry.js`

- [x] **Fix ES-module-lexer initialization**
  - [x] Ensure `ensureEsModuleLexer()` actually calls `initEsModuleLexer()` and awaits its promise (not the function reference).
  - [x] Ensure initialization is idempotent and safe under concurrency.
- [x] **Fix options forwarding to per-language import collectors**
  - [x] In `collectLanguageImports()`, stop nesting user options under `options: { ... }`.
  - [x] Pass `{ ext, relPath, mode, ...options }` (or equivalent) so language collectors can actually read `flowMode`, parser choices, etc.
- [x] **Make require() regex fallback run even when lexers fail**
  - [x] Do not gate regex extraction on lexer success; if lexers throw or fail, still attempt regex extraction.
  - [x] If regex extraction finds imports, treat that as a successful extraction path for the file (do not return `null`).
- [x] **Prevent prototype pollution from module-name keys**
  - [x] Replace `{}` accumulators keyed by module specifiers with `Object.create(null)` (or a `Map`) anywhere module-spec strings become dynamic keys.
  - [x] Ensure serialized results remain compatible (JSON output should not change in shape, aside from the object prototype).

#### Tests / Verification

- [x] Add `tests/imports-options-forwarding-flowmode.js`
  - [x] Call `collectLanguageImports({ ext: '.js', ... , options: { flowMode: 'on' } })` on a Flow-syntax file without an `@flow` directive.
  - [x] Assert imports are detected only when options are forwarded correctly (regression for the wrapper-object bug).
- [x] Add `tests/imports-esmodule-lexer-init.js`
  - [x] Ensure module imports are detected via the fast path on a basic ESM file (init actually occurs).
  - Fix attempt: updated `ensureEsModuleLexer()` to handle `init` being a Promise in current `es-module-lexer`.
- [x] Add `tests/imports-require-regex-fallback-on-lexer-failure.js`
  - [x] Use a syntactically invalid file that still contains `require('dep')`; confirm scanning still returns `'dep'`.
- [x] Add `tests/imports-proto-safe-module-keys.js`
  - [x] Import a module named `__proto__` and confirm:
    - [x] It appears as a normal key,
    - [x] Returned `allImports` has a null prototype (or otherwise cannot pollute `Object.prototype`),
    - [x] No prototype pollution occurs.

---

### 1.6 Progress + logging: pino@10 transport wiring, safe ring buffer, and zero-total guard

- **Files touched:**
  - `src/shared/progress.js`

- [x] **Fix pino transport/destination wiring for pino@10**
  - [x] Ensure pretty-transport is constructed correctly for pino@10 (use supported `transport` configuration; avoid configurations that silently no-op).
  - [x] Ensure destination selection (stdout/stderr/file) is applied correctly in both pretty and JSON modes.
- [x] **Make redaction configuration compatible with pino@10**
  - [x] Validate redact configuration format and ensure it actually redacts intended fields (and doesn’t crash/ignore due to schema mismatch).
- [x] **Fix ring buffer event retention to avoid huge/circular meta retention**
  - [x] Do not store raw meta objects by reference in the ring buffer.
  - [x] Store a bounded, safe representation (e.g., truncated JSON with circular handling, or a curated subset of primitive fields).
  - [x] Ensure event recording never throws when meta contains circular references.
- [x] **Fix `showProgress()` divide-by-zero**
  - [x] When `total === 0`, render a stable, sensible output (e.g., 0% with no NaN/Infinity).

#### Tests / Verification

- [x] Add `tests/progress-show-total-zero.js`
  - [x] `showProgress({ total: 0 })` does not emit NaN/Infinity and produces stable output.
- [x] Add `tests/progress-ring-buffer-circular-meta.js`
  - [x] Recording an event with circular meta does not throw and does not retain the original object reference.
- [x] Add `tests/progress-configure-logger-pino10-transport.js`
  - [x] `configureLogger()` can be constructed with pretty transport and can log without throwing under pino@10.
  - [x] Redaction config is accepted and functions as expected for at least one known redaction path.
  - Fix attempt: route pretty output via `pino-pretty` `destination` option for file/stdout/stderr support.

---

### Phase 1 closeout

- [ ] Run `npm run test:pr` (requires longer than the 30s cap; pending approval).

---

## Phase 2 — Contracts and Policy Kernel (Artifact Surface, Schemas, Compatibility)

### Objective

Establish a single, versioned, fail-closed contract layer for the **public artifact surface** (what builds emit and what tools/retrieval consume). This phase standardizes artifact schemas + sharded sidecars, enforces **manifest-driven discovery**, introduces **SemVer-based surface versioning** with N-1 adapters, adds **strict index validation** as a build/promotion gate, and introduces an **index compatibilityKey** to prevent unsafe mixing/federation and cache invalidation bugs.

---

### Phase 2.1 Public artifact surface spec and SemVer policy become canonical

- [ ] Publish a single canonical “Public Artifact Surface” spec and treat it as the source of truth for what is stable/public
  - Files:
    - `docs/contracts/public-artifact-surface.md` (new; canonical)
    - Update/merge/supersede `docs/artifact-contract.md` as needed (avoid duplicated, drifting contracts)
    - Link from `README.md` and `docs/commands.md` and ensure `--help` points at the canonical doc
  - Include (at minimum) explicit contracts for:
    - `builds/current.json` (bundle pointer + mode map)
    - `index_state.json` (capabilities + config identity)
    - `pieces/manifest.json` (canonical inventory)
    - sharded JSONL sidecars (`*.meta.json`) for `*.jsonl.parts/`
    - required/optional artifacts and their **stability** status
- [ ] Adopt the SemVer policy for artifact surfaces and schemas (bundle-level + artifact-level)
  - Bundle-level:
    - Add/require `artifactSurfaceVersion` (SemVer string) in:
      - `builds/current.json`
      - `index_state.json`
      - `pieces/manifest.json`
  - Artifact-level:
    - Use `schemaVersion` (SemVer string) for sharded JSONL `*.meta.json`
    - For non-sharded public artifacts, define where `schemaVersion` lives (preferred: in `pieces/manifest.json` per piece entry; alternative: per-artifact sidecar)
  - N-1 requirement:
    - Readers must support N-1 major for `artifactSurfaceVersion` and key artifact `schemaVersion`s
    - Writers emit only the current major
  - Fail-closed requirement:
    - Unknown major => hard error in strict mode (no “best effort” guesses)
- [ ] Define and document “reserved / invariant fields” and “extension policy” for public artifacts
  - Reserved fields (examples; must be enumerated in the spec):
    - `artifactSurfaceVersion`, `schemaVersion`, `repoId`, `buildId`, `compatibilityKey`, `generatedAt`
    - per-record invariants like `file` (repo-relative normalized path) and stable identifiers for records
  - Extension policy:
    - Either enforce `x_*` namespacing, or require an `extensions` object, or both
    - Explicitly state which artifacts allow additional properties, and under what namespace
- [ ] Define canonical reference + truncation envelopes (contract-first)
  - Specify stable shapes for:
    - reference targets (e.g., `ref.target`, `ref.kind`, `ref.display`)
    - truncation metadata (what was truncated, why, and how to detect it)
  - Note:
    - Implementation must begin with artifacts Phase 2 touches (file relations / graph relations), and the contract must be used by validators immediately, even if other producers adopt later

#### Tests

- [ ] Add a contract-doc presence + basic structure test (smoke check)
  - Example: `tests/contracts/public-artifact-surface-doc.test.js` (verifies file exists + required headings/anchors)
- [ ] Add a SemVer policy conformance test for the schema registry
  - Example: `tests/contracts/semver-policy-enforced.test.js` (ensures all surfaced versions are SemVer strings; ensures N-1 ranges are encoded)

---

### Phase 2.2 Manifest-driven artifact discovery everywhere (no filename guessing)

- [ ] Make `pieces/manifest.json` the single source of truth for locating artifacts (build, validate, tools, retrieval)
  - Update `src/shared/artifact-io.js` to:
    - expose a strict discovery mode that **requires** the manifest
    - centralize resolution logic so all callers share the same behavior

  - Files:
    - `src/shared/artifact-io.js`

- [ ] Add (or formalize) a single “artifact presence/detection” helper that reports artifact availability and format without hardcoded filenames
  - Options:
    - extend `src/shared/artifact-io.js`, or
    - create `src/shared/index-artifacts.js` that wraps artifact-io with presence reporting
  - Presence report should return (at minimum):
    - format: `json | jsonl | sharded | missing`
    - resolved paths
    - required sidecars (meta/parts) and whether they are consistent

- [ ] Update tools to use manifest-driven discovery (never `existsSync('chunk_meta.json')`-style checks)
  - Tools in scope for this phase (minimum):
    - `tools/report-artifacts.js`
    - `tools/assemble-pieces.js`
    - any test/tool code that reads `chunk_meta.json` directly for “presence”
- [ ] Define strict vs non-strict behavior at the API boundary (artifact-io)
  - Strict:
    - manifest required
    - unknown artifact baseName is error
    - missing shard referenced by manifest is error
  - Non-strict:
    - may fall back to legacy guessing/scanning **only** where explicitly allowed (documented), and must emit a warning signal so callers can detect non-canonical behavior

#### Tests

- [ ] Add `tests/artifact-io-manifest-discovery.test.js`
  - Ensures artifact-io resolves artifacts _only_ via manifest in strict mode
- [ ] Add `tests/assemble-pieces-no-guess.test.js`
  - Ensures `assemble-pieces` refuses to run when manifest is missing (or requires `--non-strict` explicitly)
- [ ] Add `tests/report-artifacts-manifest-driven.test.js`
  - Ensures reporting reflects manifest inventory, not directory heuristics

---

### Phase 2.3 Standard sharded JSONL sidecar schema + typed-array safe sharded writing

- [ ] Standardize sharded JSONL `*.meta.json` schema for all JSONL sharded artifacts
  - Required meta fields (as contract):
    - `schemaVersion` (SemVer)
    - `artifact` (artifact baseName, e.g. `chunk_meta`, `repo_map`)
    - `format` = `jsonl-sharded`
    - `generatedAt` (ISO)
    - `compression` (`none | gzip | zstd`)
    - `totalRecords`, `totalBytes`
    - `maxPartRecords`, `maxPartBytes`, `targetMaxBytes`
    - `parts`: list of `{ path, records, bytes }` (checksum optional but encouraged)
  - Files:
    - Writers and meta emitters:
      - `src/index/build/artifacts/writers/chunk-meta.js`
      - `src/index/build/artifacts/writers/file-relations.js`
      - `src/index/build/artifacts.js` (repo_map + graph_relations meta emit)
    - Readers:
      - `src/shared/artifact-io.js` (sharded JSONL loading must parse/validate this schema)
    - Schemas:
      - `src/shared/artifact-schemas.js` (or migrated contract registry; see Phase 2.4)

- [ ] Fix sharded JSONL writer serialization to be contract-correct for TypedArrays (Sweep: `d80d2131f9`)
  - Current risk:
    - `writeJsonLinesSharded()` uses `JSON.stringify(item)` which can serialize TypedArrays incorrectly
  - Required fix:
    - route line serialization through the project’s “typed-array safe” JSON writer (or equivalent normalization)
  - Files:
    - `src/shared/json-stream.js`

- [ ] Ensure meta/manifest consistency is enforced at write-time (not just validate-time)
  - Writers must guarantee:
    - every shard file is in `pieces/manifest.json`
    - every meta file is in `pieces/manifest.json`
    - meta.parts list matches manifest entries (paths, bytes where recorded)

  - Files:
    - `src/index/build/artifacts.js`
    - `src/index/build/artifacts/checksums.js`

#### Tests

- [ ] Add `tests/sharded-meta-schema.test.js`
  - Ensures emitted `*.meta.json` matches the standardized schema
- [ ] Add `tests/sharded-meta-bytes.test.js`
  - Ensures `totalBytes` and per-part `bytes` match actual file sizes
- [ ] Add `tests/sharded-meta-manifest-consistency.test.js`
  - Ensures meta/parts entries are all present in `pieces/manifest.json`
- [ ] Add `tests/json-stream-typedarray-sharded.test.js` (Sweep: `d80d2131f9`)
  - Ensures TypedArray values serialize as JSON arrays in sharded JSONL output

---

### Phase 2.4 Single source of truth for schemas + N-1 adapters (and CLI/config schema hygiene)

- [ ] Create a canonical contracts module and migrate schema definitions into it (shared by build + validate + retrieval)
  - Target layout (example; adjust as needed but keep the intent):
    - `src/contracts/versioning.js` (artifactSurfaceVersion constant + supported ranges)
    - `src/contracts/schemas/*` (JSON schemas)
    - `src/contracts/validators/*` (Ajv compilation + wrappers)
    - `src/contracts/adapters/*` (N-1 major adapters)
    - `src/contracts/fields/*` (canonical enums and normalizers)

  - Replace duplicated definitions:
    - `src/shared/artifact-schemas.js` and `src/index/build/artifacts/schema.js` must become thin wrappers or be removed in favor of contracts

- [ ] Tighten artifact schemas where appropriate (Sweep: `aa638c4e94`)
  - At minimum:
    - top-level objects (`pieces/manifest.json`, `index_state.json`, `builds/current.json`, sharded meta sidecars) should not silently accept arbitrary fields unless explicitly allowed by extension policy

  - Where additional properties are required for forward compatibility:
    - enforce extension namespace rules rather than “anything goes”

- [ ] Make config schema validation robust even when `schema.properties` is missing (Sweep: `e8544c8200`)
  - Current bug:
    - object validation path skips required/additionalProperties checks when `schema.properties` is absent

  - Required behavior:
    - enforce:
      - required keys
      - additionalProperties policy
      - type checks

    - regardless of presence of `schema.properties`

  - Files:
    - `src/config/validate.js`

- [ ] Eliminate CLI schema drift between option definitions and schemas (Sweep: `b06497b181`)
  - Ensure `INDEX_BUILD_SCHEMA` and `BENCH_SCHEMA` (and any other exported schemas) include every defined option
  - Decide + enforce unknown CLI option policy (warn vs error) consistently
  - Files:
    - `src/shared/cli-options.js`
    - any CLI wiring that calls validation (`src/shared/cli.js`, etc.) if needed

#### Tests

- [ ] Add `tests/contracts/schema-registry-single-source.test.js`
  - Ensures build-time schema hash and validate-time schema registry are derived from the same objects

- [ ] Add `tests/contracts/n-minus-one-adapter.test.js`
  - Ensures N-1 payloads adapt or fail closed as intended

- [ ] Add `tests/config/validate-object-without-properties.test.js` (Sweep: `e8544c8200`)
- [ ] Add `tests/cli/cli-options-schema-drift.test.js` (Sweep: `b06497b181`)
- [ ] Add `tests/contracts/additional-properties-policy.test.js` (Sweep: `aa638c4e94`)

---

### Phase 2.5 Strict index validation mode becomes a real gate (and tools/index-validate is hardened)

- [ ] Implement strict validation mode that is manifest-driven and version-aware
  - Strict mode must:
    - require `pieces/manifest.json`
    - validate `builds/current.json` (when present) and `index_state.json`
    - validate sharded meta sidecars and enforce meta↔manifest consistency
    - enforce path safety in manifests:
      - no absolute paths
      - no `..` traversal
      - normalized separators
      - no duplicate `path` entries
    - validate JSONL required keys per artifact type and add regression tests (even if currently aligned)
    - reject unknown artifact schema names (no “ok by default” in strict)
  - Files:
    - `src/index/validate.js`
    - `src/shared/artifact-io.js`
    - schema registry (`src/contracts/*` or existing `src/shared/artifact-schemas.js` until migrated)

- [ ] Harden `tools/index-validate.js` mode parsing (Sweep: `3108f8d2bb`)
  - Unknown modes must be rejected early with a clear error message and a non-zero exit code
  - Must not crash due to undefined report entries
  - File:
    - `tools/index-validate.js`

- [ ] Add an explicit validation check for identity collision footguns relevant to upcoming graph work
  - Example: detect ambiguous `file::name` collisions early and report them deterministically
  - If full remediation is out of scope here:
    - Strict validation must at least detect + emit a named error code (and remediation lands in the graph/identity phase)

#### Tests

- [ ] Add `tests/validate/index-validate-strict.test.js`
- [ ] Add `tests/validate/index-validate-missing-manifest.test.js`
- [ ] Add `tests/validate/index-validate-manifest-safety.test.js`
- [ ] Add `tests/validate/index-validate-sharded-meta-consistency.test.js`
- [ ] Add `tests/validate/index-validate-unknown-mode.test.js` (Sweep: `3108f8d2bb`)
- [ ] Add `tests/validate/index-validate-unknown-artifact-fails-strict.test.js`
- [ ] Add `tests/validate/index-validate-jsonl-required-keys.test.js`
- [ ] Add `tests/validate/index-validate-file-name-collision.test.js` (if implementing collision detection here)

---

### Phase 2.6 Safe promotion barrier + current.json schema and path safety

- [ ] Make promotion conditional on passing strict validation (no “promote broken builds”)
  - Add a mandatory gate in the build pipeline:
    - after artifacts are written
    - before `promoteBuild()` updates `builds/current.json`
  - If validation fails:
    - do not update `current.json`
    - write a clear failure summary into `build_state.json`
  - Files:
    - `src/integrations/core/index.js` (or wherever promotion is orchestrated)
    - `src/index/build/indexer/pipeline.js` if the gate belongs inside the pipeline
    - `src/index/build/promotion.js`

- [ ] Fix path traversal risk in promotion/current resolution (Sweep: `9acfca6186`)
  - Promotion must refuse to write a `buildRoot` that resolves outside the repo cache root
  - Consumers must refuse to follow a `buildRoot` outside repo cache root
  - Files:
    - `src/index/build/promotion.js`
    - `tools/dict-utils.js` (e.g., `resolveIndexRoot`, `getCurrentBuildInfo`)

- [ ] Disambiguate `buildRoots` semantics in current.json
  - If the intent is “per mode”:
    - keep `buildRootsByMode` only
  - If the intent is also “by stage”:
    - add a separate field (`buildRootsByStage`) and make both explicit
  - Ensure the schema + validator enforce the chosen structure

#### Tests

- [ ] Add `tests/promotion/promotion-barrier-strict-validation.test.js`
- [ ] Add `tests/promotion/current-json-path-safety.test.js` (Sweep: `9acfca6186`)
- [ ] Add `tests/promotion/current-json-atomic-write.test.js`
- [ ] Add `tests/promotion/current-json-schema.test.js`
- [ ] Add `tests/promotion/promotion-does-not-advance-on-failure.test.js`

---

### Phase 2.7 Index compatibilityKey gate + cache signature parity for sharded chunk_meta

- [ ] Introduce `compatibilityKey` per the compatibility-gate spec (fail-closed on mismatch)
  - `compatibilityKey` must be computed from “hard compatibility fields” (examples; finalize in spec):
    - `artifactSurfaceVersion` major
    - tool version
    - artifact schema hash
    - tokenizationKey
    - embeddings model identity + dims + quantization settings
    - language/segment policy identity (as stabilized in Phase 1)
  - Persist `compatibilityKey` in:
    - `index_state.json`
    - `pieces/manifest.json`
    - (optional but recommended) `builds/current.json` for fast checks
  - Files:
    - contract module (new): `src/contracts/compat/*` or similar
    - build emission: `src/index/build/indexer/steps/write.js`, `src/index/build/artifacts/checksums.js`, `src/index/build/promotion.js`

- [ ] Enforce compatibilityKey in consumers
  - Retrieval/index loading must detect mismatch and error (or refuse federation)
  - `assemble-pieces` / any bundling must ensure all combined indexes are compatible
  - Files (minimum):
    - retrieval loader(s): `src/retrieval/*` (where index_state/manifest is loaded)
    - federation/bundling tool(s): `tools/assemble-pieces.js` (if it combines)
- [ ] Fix query-cache invalidation gap for sharded `chunk_meta` signatures (Sweep: `ebefa09b5e`)
  - `getIndexSignature()` must incorporate sharded `chunk_meta` (and ideally manifest signature)
  - Required change:
    - stop assuming `chunk_meta.json` exists
    - use `jsonlArtifactSignature(dir, 'chunk_meta')` or a manifest-derived signature
  - File:
    - `src/retrieval/cli-index.js`

#### Tests

- [ ] Add `tests/contracts/index-compatibility-key-generation.test.js`
- [ ] Add `tests/contracts/index-compatibility-key-enforced-on-load.test.js`
- [ ] Add `tests/contracts/index-compatibility-key-federation-block.test.js`
- [ ] Add `tests/retrieval/query-cache-signature-sharded-chunk-meta.test.js` (Sweep: `ebefa09b5e`)

---

### Phase 2.8 Golden contract fixtures and CI enforcement

- [ ] Create golden fixture indexes that cover:
  - multiple modes (`code`, `prose`, `records`) as applicable
  - artifact format variants (`json`, `jsonl`, `jsonl-sharded`)
  - presence of meta sidecars and manifest inventory correctness
- [ ] Add a contract fixture suite that runs:
  - build => validate (strict) => load via artifact-io => basic retrieval smoke (where applicable)
  - and asserts that “public surface invariants” hold for every fixture
- [ ] Add a loader matrix test that proves consumers are resilient to supported artifact encodings
  - Example: `chunk_meta` load parity across json/jsonl/sharded
- [ ] Wire strict validation into CI as a required gate for fixture builds

#### Tests

- [ ] Add `tests/fixtures/public-surface/*` (fixture definitions + expected invariants)
- [ ] Add `tests/contracts/golden-surface-suite.test.js`
- [ ] Add `tests/contracts/loader-matrix-parity.test.js`
- [ ] Add/extend `tests/artifact-formats.js` (if it is the canonical place for format coverage)

---

## Phase 3 — Correctness Endgame (imports • signatures • watch • build state)

### Objective

Eliminate the remaining high-impact correctness and operator-safety gaps before broader optimization work: (a) import extraction must be accurate (dynamic imports, TS aliases) and produce a **true dependency graph** (not co-import similarity), (b) incremental reuse must be **provably safe** via complete, deterministic signatures, (c) watch mode must be **stable, bounded, and atomic** (no build-root reuse; promotion only after success), and (d) `build_state.json` / `current.json` must be **concurrency-safe, validated, and debuggable**, so partial/incorrect builds cannot become “current” and failures are diagnosable.

---

### 3.1 Fix dynamic import scanning, TS alias handling, and module boundary fidelity

- [ ] Fix the language registry wrapper bug that nests `options` incorrectly when calling `collectImports` (so per-language import collectors actually receive `text`, `options`, `filePath`, `root` as intended).
  - Primary touchpoints:
    - `src/index/language-registry/registry.js`
  - Notes:
    - Confirm that language-specific collectors that depend on `options` (e.g., WASM/parser options) behave correctly after this fix.
- [ ] Make JS/TS fast-path import extraction resilient: always run the `require(...)` regex fallback even when `es-module-lexer` parsing fails (so syntax errors don’t suppress require detection).
  - Primary touchpoints:
    - `src/index/build/imports.js` (`collectModuleImportsFast`)
  - Notes:
    - Keep dynamic `import('...')` extraction when possible (string literal cases), but do not regress the “fast path” on large repositories.
- [ ] Replace “co-import graph” behavior with true dependency resolution for `importLinks`, so the import graph represents **importer → imported target** for in-repo files (and not “files that share a module string”).
  - Primary touchpoints:
    - `src/index/build/imports.js` (import scanning + link construction)
    - `src/index/build/graphs.js` (consumer expectations for `ImportGraph`)
    - `src/index/build/file-processor/cached-bundle.js` (preserve/reconstruct relations during reuse)
  - Implementation details:
    - For each file, resolve raw import specifiers to repo-local file targets where possible:
      - Relative specifiers (`./`, `../`): resolve against importer directory; apply extension and `index.*` resolution consistently across JS/TS.
      - TypeScript path aliases: read `tsconfig.json` (`baseUrl`, `paths`) and resolve alias patterns deterministically; if multiple matches, apply a deterministic tie-break (e.g., shortest path, then lexicographic).
      - External specifiers (packages): do **not** map into `ImportGraph` file nodes; keep as raw import metadata (for later features) without corrupting the file-to-file graph.
    - Normalize resolved targets (posix separators, no `..` segments, ensure within repo root).
- [ ] Remove redundant cached-import reads and ensure cached import lookup is performed at most once per file per scan (avoid “read twice on miss” behavior).
  - Primary touchpoints:
    - `src/index/build/imports.js` (`scanImports`)
  - Implementation details:
    - When preloading cached imports for sort-by-import-count, store an explicit “miss” sentinel so the later per-file pass does not call `readCachedImports()` again for the same file.
    - Keep the “import-heavy first” ordering, but make it deterministic and not dependent on incidental Map iteration order.
- [ ] Fix cached-bundle relation reconstruction correctness: do not rebuild bundle-level fileRelations by sampling a single chunk; enforce presence of the canonical relation data (or treat the bundle as invalid for reuse).
  - Primary touchpoints:
    - `src/index/build/file-processor/cached-bundle.js`
  - Implementation details:
    - If bundle-level fileRelations are missing, either:
      - Skip reuse (prefer correctness), or
      - Recompute by aggregating all chunk-level relations deterministically (only if performance impact is acceptable for this phase).
- [ ] Fix cached-bundle hash metadata: do not hardcode `hashAlgo: 'sha1'`; preserve the actual hash algorithm used to compute the stored hash.
  - Primary touchpoints:
    - `src/index/build/file-processor/cached-bundle.js`
- [ ] (Optional; may defer) Reduce import-scan I/O by avoiding duplicate file reads when the pipeline already has the file contents in memory.
  - Primary touchpoints:
    - `src/index/build/imports.js`
    - `src/index/build/indexer/steps/process-files.js` (if a “pass-through text” optimization is introduced)

#### Tests

- [ ] Unit test: language registry passes `options` correctly to a test language’s `collectImports` (regression for wrapper nesting bug).
- [ ] Import extraction regression tests:
  - [ ] A JS file with a deliberate parse error still yields `require('x')` imports via regex fallback.
  - [ ] A file with `import('x')` (string literal) is captured where supported by lexer.
- [ ] Import graph fidelity tests:
  - [ ] Two different files importing `./utils` in different directories do **not** link to each other; they each link to their own resolved `utils` target.
  - [ ] A TS alias import resolves using `tsconfig` `paths` and produces a stable file-to-file edge.
- [ ] Cached bundle reuse tests:
  - [ ] If bundle-level fileRelations are missing, reuse is skipped (or recomputed correctly across all chunks, depending on chosen design).
  - [ ] The stored `hashAlgo` matches the configured file hash algorithm (not hardcoded).
- [ ] Efficiency test (unit-level): `readCachedImports()` is called ≤ 1 time per file per scan in the cache-miss case.

---

### 3.2 Repair incremental cache signature correctness and reuse gating

- [ ] Make signature payload hashing deterministic: replace `sha1(JSON.stringify(payload))` with `sha1(stableStringify(payload))` (or equivalent stable serializer) for both tokenization and incremental signatures.
  - Primary touchpoints:
    - `src/index/build/indexer/signatures.js`
    - `src/shared/stable-json.js` (serializer)
  - Notes:
    - This is a correctness change (reproducibility + “explainability” of reuse), even if it increases invalidations.
- [ ] Include regex flags (not just `.source`) for signature-bearing regex configuration (e.g., `licensePattern`, `generatedPattern`, `linterPattern`).
  - Primary touchpoints:
    - `src/index/build/indexer/signatures.js`
  - Implementation detail:
    - Canonicalize regex as `{ source, flags }` (not a raw `RegExp` object) before hashing.
- [ ] Eliminate hidden signature weakening caused by JSON normalization that drops non-JSON values (e.g., `RegExp` objects) during config hashing. (Static Review: runtime/hash normalization)
  - Primary touchpoints:
    - `src/index/build/runtime/hash.js`
    - `src/index/build/indexer/signatures.js`
  - Notes:
    - Ensure any config structures that can contain regex or other non-JSON objects are serialized explicitly and deterministically before hashing.
- [ ] Stop mutating shared runtime config during a multi-mode build: compute adaptive dict config as a per-run/per-mode derived value instead of overwriting `runtime.dictConfig`. (Static Review B3f60a5bb44d` notes)
  - Primary touchpoints:
    - `src/index/build/indexer/pipeline.js`
    - `src/index/build/indexer/signatures.js` (ensure signatures use the _effective_ dict config)
  - Notes:
    - This prevents cross-mode coupling (e.g., `code` mode discovery affecting `prose` mode tokenizationKey).
- [ ] Add explicit signature versioning / migration behavior so that changing signature semantics does not silently reuse prior manifests.
  - Primary touchpoints:
    - `src/index/build/indexer/signatures.js`
    - `src/index/build/incremental.js` (manifest/state format markers)
  - Notes:
    - Bump a `signatureVersion` or `bundleFormat`/manifest marker and treat mismatches as “do not reuse.”

- [ ] Add an “explain reuse decision” diagnostic path for incremental reuse failures (safe-by-default; useful in CI and field debugging).
  - Primary touchpoints:
    - `src/index/build/indexer/steps/incremental.js`
    - `src/index/build/indexer/signatures.js`
  - Notes:
    - Keep logs bounded (do not print entire configs by default); prefer “top N differing keys” summary.

#### Tests

- [ ] Unit test: two regexes with identical `.source` but different `.flags` produce different tokenization keys.
- [ ] Unit test: two payload objects with identical semantics but different key insertion order produce identical signature hashes (stable stringify).
- [ ] Integration test: multi-mode run (`code` then `prose`) yields the same `prose` signature regardless of `code` file counts (no adaptive dict mutation bleed-through).
- [ ] Integration test: signatureVersion mismatch causes reuse to be rejected (forced rebuild).

---

### 3.3 Resolve watch mode instability and ensure build root lifecycle correctness

- [ ] Make watch builds atomic and promotable: each rebuild writes to a new attempt root (or A/B inactive root), validates, then promotes via `current.json`—never reusing the same buildRoot for successive rebuilds. also addresses race class: `9ed923dfae`)
  - Primary touchpoints:
    - `src/index/build/watch.js`
    - `src/index/build/promotion.js`
    - `src/index/build/runtime/runtime.js` (support “override buildRoot/buildId” or “derive attempt root”)
  - Notes:
    - Promotion must occur only after build success + validation; on failure, current stays unchanged.
    - Decide and document cleanup policy for old attempt roots (time-based, count-based, or explicit `--watch-keep-builds=N`).
- [ ] Implement delta-aware discovery in watch: maintain `trackedEntriesByMode` from an initial full scan, update on FS events, and pass the tracked entries into the pipeline—avoiding repeated whole-repo discovery each rebuild.
  - Primary touchpoints:
    - `src/index/build/watch.js`
    - `src/index/build/discover.js` (if helper extraction needed)
  - Notes:
    - Include periodic “reconcile scan” to heal missed watcher events (especially on platforms with lossy FS event delivery).
- [ ] Enforce watch bounds: `maxFiles` and `maxFileBytes` must apply not just to the initial scan, but also to subsequent add/change events.
  - Primary touchpoints:
    - `src/index/build/watch.js`
  - Notes:
    - Behavior when cap would be exceeded must be explicit (ignore + warn, or evict deterministically, or require reconcile).
- [ ] Add lock acquisition backoff to prevent tight retry loops when another build holds the lock.
  - Primary touchpoints:
    - `src/index/build/watch.js`
    - `src/index/build/lock.js` (optional helper: backoff strategy / jitter)
- [ ] Fix watch shutdown crash by guarding scheduler access during initialization and ensuring shutdown is safe at any point in startup.
  - Primary touchpoints:
    - `src/index/build/watch.js`
- [ ] Fix `waitForStableFile()` semantics so it returns `false` if stability is not observed within the configured check window (i.e., do not proceed “as if stable” when it never stabilized).
  - Primary touchpoints:
    - `src/index/build/watch.js`
- [ ] Ensure runtime contains `recordsDir` and `recordsConfig` so watch/discovery can correctly handle record file behavior (and not silently disable records-aware logic).
  - Primary touchpoints:
    - `src/index/build/runtime/runtime.js`
    - `src/index/build/indexer/steps/discover.js`
    - `src/index/build/watch.js`
- [ ] Fix Parcel watcher backend ignore behavior to avoid directory misclassification when `fs.Stats` is absent (and prevent incorrect inclusion/exclusion). (Static Review note)
  - Primary touchpoints:
    - `src/index/build/watch/backends/parcel.js`
- [ ] Prevent watch from mutating shared runtime fields (`runtime.incrementalEnabled`, `runtime.argv.incremental`); clone runtime per attempt/build loop (runtime is immutable once constructed). (Static Review 9235afd3e9` notes)
  - Primary touchpoints:
    - `src/index/build/watch.js`
- [ ] Harden ignore file handling used by watch and builds: validate ignore file paths stay within repo root (or require explicit opt-in for absolute paths), and make ignore load failures visible (warn + recorded in state). (Static Review C1 
  - Primary touchpoints:
    - `src/index/build/ignore.js`
    - `src/index/build/watch.js` (propagate/report ignore load status)

#### Tests

- [ ] Watch E2E promotion test:
  - [ ] Start watch, modify a file, assert a new build root is created and `current.json` is updated only after successful completion.
- [ ] Watch atomicity test:
  - [ ] Force a controlled failure during rebuild; assert `current.json` remains pointing to the previous build root.
- [ ] Lock backoff test:
  - [ ] Hold lock; start watch; assert retries are spaced (no tight loop) and logs show backoff.
- [ ] Shutdown tests:
  - [ ] SIGINT during early startup does not throw (scheduler guard).
  - [ ] SIGINT during an active build stops cleanly and releases lock.
- [ ] `waitForStableFile` unit test:
  - [ ] File rewritten repeatedly during check window returns `false`.
- [ ] Records-aware discovery test:
  - [ ] With recordsDir configured, record files are handled per expectations (excluded from code/prose, or routed appropriately).
- [ ] Ignore path safety test:
  - [ ] `ignoreFiles: ['../outside']` is rejected (or requires explicit opt-in) and is visible in logs/state. (Static Review C1

---

### 3.4 Enforce build-state integrity and debugging friendliness

- [ ] Make `build_state.json` updates concurrency-safe: prevent clobbering between heartbeat ticks and phase/progress updates via a per-buildRoot write queue or file lock.
  - Primary touchpoints:
    - `src/index/build/build-state.js`
  - Notes:
    - “Last write wins” must not erase phase/progress updates; merging must be correct under concurrent callers.
- [ ] Remove or formalize the ambiguous top-level `phase` field (replace with `currentPhase` / `activePhase` and document schema).
  - Primary touchpoints:
    - `src/index/build/build-state.js`
- [ ] Enrich `build_state.json` with the minimum diagnostics needed for field debugging:
  - buildId, buildRoot, stage/mode, startedAt/finishedAt, counts (files, chunks), and signature identifiers (tokenizationKey/cacheSignature/signatureVersion) to explain reuse/promote decisions.
  - Primary touchpoints:
    - `src/index/build/build-state.js`
    - `src/integrations/core/index.js` (or other orchestration entrypoints that own phase transitions)
- [ ] Harden `current.json` promotion/read path safety and validation: promotion must reject build roots outside the intended cache root, and readers must fail closed on unsafe/invalid roots. `fde9568d49`; race class: `9ed923dfae`)
  - Primary touchpoints:
    - `src/index/build/promotion.js`
    - `tools/dict-utils.js` (current build resolution)
  - Notes:
    - Validate resolved root is within the repo cache root (or within `repoCacheRoot/builds`), not just “some path string.”
    - If deeper schema overhaul (stage-vs-mode separation) is owned by **Phase 2**, implement the safety validation now and explicitly defer schema redesign to **Phase 2 — Contracts & Policy Kernel** (named follow-on).
- [ ] Make embedding enqueue clearly best-effort (when configured as optional), and include unambiguous index identity in job payload (buildId + mode + output directory) so background workers cannot target the wrong build. (Static Review 
  - Primary touchpoints:
    - `src/index/build/indexer/embedding-queue.js`
    - `tools/build-embeddings.js` (or embedding worker entrypoint consuming payload)
  - Notes:
    - If job payload changes require worker updates that are too broad for this phase, implement payload additions now and defer worker consumption hardening to a named follow-on (e.g., **Phase 6 — Service Hardening**).

#### Tests

- [ ] Concurrency test: simulate concurrent `build_state.json` updates (heartbeat + phase update) and assert no loss of fields.
- [ ] Schema test: `build_state.json` no longer writes ambiguous top-level `phase`; uses documented `currentPhase` field instead.
- [ ] Promotion safety tests:
  - [ ] Promotion rejects build roots outside cache root with a clear error.
  - [ ] Reader rejects unsafe `current.json` roots and falls back safely (fail closed) rather than using arbitrary filesystem paths.
- [ ] Embedding enqueue tests:
  - [ ] Enqueue failure logs warning and does not fail the build when configured as optional.
  - [ ] Enqueued job payload contains build identity fields and is stable across runs.

---

## Phase 14 — Documentation and Configuration Hardening

1. **Document security posture and safe defaults**
   * [ ] Document:
     * API server host binding risks (`--host 0.0.0.0`)
     * CORS policy and how to configure allowed origins
     * Auth token configuration (if implemented)
     * RepoPath allowlist behavior
   * [ ] Add a prominent note: indexing untrusted repos and symlinks policy.

2. **Add configuration schema coverage for new settings**
   * [ ] If adding config keys (CORS/auth/cache TTL), ensure they are:
     * Reflected in whatever config docs you maintain
     * Validated consistently (even if validation is lightweight)

---

## Phase 4 — Runtime Envelope, Concurrency, and Safety Guardrails

### Objective
Make runtime behavior explicit, predictable, and safe by default across build, watch, retrieval CLI, and tooling integrations. This phase eliminates known concurrency and logging footguns, enforces threadpool-aware I/O scheduling, standardizes cancellation via `AbortSignal`, and adds bounded-memory and “fail closed” guardrails for large inputs and untrusted regex usage.

---

### 4.1 Unified runtime envelope surface (configured vs effective) + propagation to child processes
- [ ] Define a single runtime envelope configuration surface and wire it end-to-end
  - Cover, at minimum:
    - `UV_THREADPOOL_SIZE` (effective + requested)
    - Node heap sizing (`NODE_OPTIONS=--max-old-space-size=...`)
    - worker pool sizing (tokenize/quantize pools; embedding pools if present)
    - queue concurrency caps (I/O, CPU, embedding) and pending limits
  - Files:
    - `tools/dict-utils.js` (`resolveNodeOptions`, `resolveRuntimeEnv`)
    - `bin/pairofcleats.js`
    - `tools/indexer-service.js`
    - `tools/bootstrap.js`
    - `src/integrations/core/index.js` (spawns indexer stages)
- [ ] Implement precedence rules and make them user-visible
  - Precedence (recommended default):
    - CLI flags > config file > environment variables > defaults
  - Ensure precedence is applied consistently for:
    - `--threads` and any per-lane concurrency knobs
    - `runtime.uvThreadpoolSize`, `runtime.maxOldSpaceMb`, `runtime.nodeOptions`
  - Emit a “configured vs effective” report (single place) usable by:
    - `pairofcleats index --config-dump`
    - `pairofcleats doctor` (later milestone; ensure output shape is stable now)
- [ ] Ensure child-process environment shaping is complete and deterministic
  - `resolveRuntimeEnv()` should be the single canonical builder for Node child env.
  - Ensure every spawn site that runs Node code uses it (or explicitly documents why it cannot).

#### Tests / Verification
- [ ] `tests/runtime/runtime-envelope-config-dump.test.js`
  - Assert dump includes configured + effective values for heap, UV threadpool, and queue caps.
- [ ] `tests/runtime/runtime-envelope-spawn-env.test.js`
  - Spawn a small Node child via the same wrapper used by the toolchain; assert env contains expected `NODE_OPTIONS` and `UV_THREADPOOL_SIZE` values.

---

### 4.2 Thread limit precedence and threadpool-aware I/O scheduling (close the feedback loop)
- [ ] Fix thread limit precedence so env does not silently override CLI
  - Files:
    - `src/shared/threads.js` (`resolveThreadLimits`)
    - Call sites:
      - `src/index/build/runtime/workers.js` (`resolveThreadLimitsConfig`)
      - `tools/build-sqlite-index/run.js`
  - Requirements:
    - `--threads` present must win over env-configured threads.
    - Error messages for invalid `--threads` must correctly attribute the source (CLI vs config vs env).
- [ ] Make I/O concurrency explicitly threadpool-aware and safe by default
  - Files:
    - `src/shared/concurrency.js` (`createTaskQueues`)
    - `src/index/build/runtime/workers.js` (`createRuntimeQueues`)
    - `src/index/build/indexer/steps/process-files.js` (`createShardRuntime`)
  - Policy:
    - Default: cap filesystem I/O concurrency to a function of effective `UV_THREADPOOL_SIZE` (or the configured runtime envelope’s uv size).
    - Escape hatch: allow oversubscription with explicit config + warning.
  - Ensure I/O concurrency caps are used end-to-end (no “computed but ignored” lanes).
- [ ] Optional split of queues to avoid FS saturation blocking subprocess orchestration
  - Introduce (or logically separate) queues for:
    - `fsQueue` (threadpool-bound work)
    - `procQueue` (spawn/wait/pipe)
    - `cpuQueue` (pure JS compute)
  - Ensure pending limits are enforced per queue to prevent runaway buffering.

#### Tests / Verification
- [ ] Extend `tests/thread-limits.js` to cover precedence:
  - CLI > config > env > default.
- [ ] Extend `tests/io-concurrency-cap.js` to assert:
  - default I/O cap respects effective `UV_THREADPOOL_SIZE`,
  - escape hatch lifts the cap with an explicit warning path.

---

### 4.3 Concurrency primitive correctness: rewrite `runWithQueue()` with explicit semantics
- [ ] Fix `runWithQueue()` scheduling correctness under rejection and pending throttling
  - Problem characteristics to eliminate:
    - `Promise.race(pending)` can reject early (pending contains raw task promises), breaking scheduling determinism.
    - Rejections can be swallowed or produce unhandled rejections depending on timing.
    - No explicit contract for fail-fast vs best-effort.
  - Files:
    - `src/shared/concurrency.js`
  - Required semantics:
    - Default: fail-fast (first worker error stops scheduling; function rejects with the underlying error).
    - Optional: best-effort with explicit opt-in (continue scheduling; collect errors; reject at end with `AggregateError`).
    - Never allow unhandled rejections; never call `onResult` for failures; call `onError` at most once per failed item.
  - Add optional `signal` support (see Phase 4.4) so queue runners stop promptly on cancel.

#### Tests / Verification
- [ ] `tests/concurrency/run-with-queue-failfast.test.js`
  - A worker rejection stops scheduling new work; the returned promise rejects with the error; no unhandled rejection warnings.
- [ ] `tests/concurrency/run-with-queue-best-effort.test.js`
  - Schedules all items, calls `onError` deterministically, and rejects with `AggregateError` containing all failures.
- [ ] `tests/concurrency/run-with-queue-pending-throttle.test.js`
  - Pending throttling never rejects due to a raced rejected task; throttle releases only when in-flight tasks settle.

---

### 4.4 Unified cancellation model (AbortSignal-first) across queues, workers, subprocesses, and writers
- [ ] Adopt `AbortSignal` as the single cancellation primitive for long-running operations
  - Files:
    - `src/shared/concurrency.js` (queue runner support)
    - `src/index/build/watch.js` (shutdown wiring)
    - `src/index/build/indexer/pipeline.js` (top-level orchestration)
    - `tools/indexer-service.js` (service lifecycle)
- [ ] Thread `signal` through the hottest loops and ensure prompt abort behavior
  - Requirements:
    - Stop enqueuing new work when aborted.
    - Ensure already-started work observes `signal.aborted` at safe checkpoints.
    - Ensure abort leaves artifacts in a consistent, fail-closed state (no partial promotion).
- [ ] Standardize cancellation error shapes/codes
  - Introduce a small helper module if necessary (e.g., `src/shared/abort.js`) for:
    - `throwIfAborted(signal)`
    - `asAbortError(...)` / a shared error code constant

#### Tests / Verification
- [ ] `tests/cancellation/abort-signal-stops-queue.test.js`
- [ ] `tests/cancellation/watch-shutdown-clean.test.js`
  - Ctrl+C (simulated) stops quickly; no orphaned child processes; no dangling timers.

---

### 4.5 Logging + progress correctness (pino transport, bounded event ring, progress mode parity)
- [ ] Fix pino pretty transport wiring (supported pino v10 path)
  - Files:
    - `src/shared/progress.js` (`configureLogger`)
  - Requirements:
    - Pretty mode uses `transport` in the pino options (or `pino.transport()`), not an invalid “destination-as-transform” signature.
    - Human logs go to stderr; structured progress JSONL remains on stdout where applicable.
- [ ] Bound memory in the progress event ring buffer (no raw meta retention)
  - Files:
    - `src/shared/progress.js` (`recordEvent`, ring buffer storage)
  - Requirements:
    - Store a sanitized/serialized meta payload (size-accounted) rather than raw objects.
    - Prevent cyclic objects from living in the ring due to failed stringify and undercounted bytes.
- [ ] Fix progress rendering edge cases
  - Files:
    - `src/shared/progress.js` (`showProgress`)
    - `src/shared/cli/display/terminal.js` (`normalizeProgressMode`)
  - Requirements:
    - Guard divide-by-zero when `total === 0` (and ensure output remains sensible).
    - Recognize `progress=tty` consistently across parsing and normalization.

#### Tests / Verification
- [ ] `tests/progress/pino-pretty-transport.test.js`
  - Logger initializes under pretty mode without throwing; output is routed to stderr.
- [ ] `tests/progress/ring-buffer-bounded.test.js`
  - Huge/cyclic meta does not blow memory; old events are evicted predictably.
- [ ] `tests/progress/show-progress-total-zero.test.js`
- [ ] `tests/cli/progress-tty-normalization.test.js`

---

### 4.6 JSON streaming/writer guardrails (compression options, on-disk size budgets, typed-array safety)
- [ ] Forward compression options correctly for gzip streams
  - Files:
    - `src/shared/json-stream.js` (`createFflateGzipStream`, `createJsonWriteStream`)
  - Requirements:
    - Honor configured gzip level (and other supported options) rather than ignoring them.
- [ ] Make sharded JSONL writer enforce `maxBytes` against **actual bytes written to disk** (post-compression)
  - Files:
    - `src/shared/json-stream.js` (`writeJsonLinesSharded`)
  - Requirements:
    - Track on-disk byte counts via a byte-counting wrapper/transform on the output path.
    - Roll shards only at record boundaries.
    - Keep a “single record too large” guard with a documented policy for compressed streams.
- [ ] Ensure sharded JSONL serialization path is typed-array safe (no `JSON.stringify(item)` bypass)
  - Use the same serialization path as other JSON writers (typed-array aware), or normalize typed arrays before stringification.

#### Tests / Verification
- [ ] `tests/json-stream/gzip-options-forwarded.test.js`
- [ ] `tests/json-stream/sharded-maxbytes-on-disk.test.js`
- [ ] `tests/json-stream/sharded-typed-arrays.test.js`

---

### 4.7 Large-file strategy and cap correctness (mode-aware, language-aware, cached-bundle safe)
- [ ] Define and enforce a clear strategy for very large files/projects
  - Behavior must be bounded and user-visible:
    - skip with explicit reason + cap values, or
    - partial indexing with truncation metadata (only if explicitly supported by contract).
  - Ensure “untrusted” guardrails remain hard to bypass.
- [ ] Fix pre-read skip cap resolution to be language-aware (and mode-aware where applicable)
  - Files:
    - `src/index/build/file-processor/skip.js` (`resolvePreReadSkip`)
    - `src/index/build/file-processor/read.js` (`resolveFileCaps`)
    - Call sites:
      - `src/index/build/file-processor.js` (thread `fileLanguageId` and any mode value)
  - Requirements:
    - Do not compute caps without the best available language hint.
    - If code vs doc modes differ in caps, ensure the mode is part of resolution (and tested).
- [ ] Fix cached-bundle reuse to respect the same caps resolution inputs as live processing
  - Files:
    - `src/index/build/file-processor/cached-bundle.js` (`reuseCachedBundle`)
  - Requirements:
    - Caps must not silently default to a stricter profile that causes legitimate files to be skipped.
    - Cached-bundle metadata must preserve `hashAlgo` (do not hardcode to `sha1`).

#### Tests / Verification
- [ ] `tests/file-caps/pre-read-skip-respects-language.test.js`
- [ ] `tests/file-caps/cached-bundle-respects-caps.test.js`
- [ ] `tests/file-caps/doc-mode-large-markdown-not-skipped.test.js` (only if mode-specific caps exist)

---

### 4.8 Safe-regex hardening (preemptive protection; no “post-hoc timeouts”)
- [ ] Replace “post-hoc timeout checks” with preemptive safety
  - Files:
    - `src/shared/safe-regex.js`
    - `src/shared/safe-regex/backends/*`
  - Requirements:
    - Prefer RE2 / RE2JS backends with program-size checks and strict input length caps.
    - If any path still uses native JS `RegExp`, isolate it (worker thread) or forbid it for untrusted patterns.
    - Ensure flags normalization and limits are applied consistently from config.
- [ ] Ensure safe-regex usage is systematic for user-driven patterns
  - Audit the call sites that accept user patterns (risk rules, filters, search options) and ensure they route through safe-regex consistently.

#### Tests / Verification
- [ ] `tests/safe-regex/program-size-cap.test.js`
- [ ] `tests/safe-regex/input-length-cap.test.js`
- [ ] `tests/safe-regex/flags-normalization.test.js`

---

### 4.9 Subprocess management (spawn errors, cancellation propagation, and clean shutdown)
- [ ] Introduce a shared subprocess helper that is AbortSignal-aware and fail-closed
  - Target behaviors:
    - capture `error` events on spawn failures (ENOENT, EACCES, etc.)
    - enforce timeouts where required
    - kill child process trees on abort (platform-aware best effort)
    - surface actionable error messages
  - Files (primary spawn sites to consolidate):
    - `tools/indexer-service.js`
    - `src/integrations/core/index.js`
    - `src/integrations/tooling/lsp/client.js`
    - `src/lang/python/pool.js`
    - `tools/*-ingest.js` (ctags/gtags/scip)
- [ ] Ensure cancellation is propagated into subprocess work, not only into JS loops
  - Wire AbortSignal to:
    - `child.kill()` on abort
    - stream teardown
    - promise rejection paths (no hanging awaits)

#### Tests / Verification
- [ ] `tests/subprocess/spawn-error-propagates.test.js`
- [ ] `tests/subprocess/abort-kills-child.test.js`

---

### 4.10 Embedding/vector and encoding guardrails (prevent NaNs; preserve metadata for determinism)
- [ ] Fix vector merge logic to prevent NaN propagation when vectors differ in length
  - Files:
    - `src/shared/embedding-utils.js` (`mergeEmbeddingVectors`)
  - Requirements:
    - Treat missing entries as `0` for both sides; never add `undefined`.
- [ ] Normalize vectors consistently before quantization when emitting multiple vector forms
  - Files (as applicable):
    - `src/index/build/file-processor/embeddings.js`
  - Requirements:
    - If `embedding_u8` is normalized before quantization, `embed_code_u8` / `embed_doc_u8` must follow the same rule (or the contract must explicitly document different semantics).
- [ ] Ensure encoding metadata is plumbed and reused deterministically
  - Files:
    - `src/shared/encoding.js`
    - `src/index/build/file-processor.js` (file meta emission / incremental reuse)
  - Requirements:
    - Persist detected encoding and reuse it when file bytes are unchanged.
    - Emit warnings deterministically (no spam loops) when fallback decoding occurs.

#### Tests / Verification
- [ ] `tests/embeddings/merge-vectors-no-nan.test.js`
- [ ] `tests/embeddings/quantize-normalization-parity.test.js` (if multiple vector forms are emitted)
- [ ] `tests/encoding/metadata-plumbed-and-reused.test.js`

---

### 4.11 Atomic file replace and `.bak` hygiene (consistent behavior across platforms)
- [ ] Make atomic replace behavior consistent and remove `.bak` accumulation
  - Files:
    - `src/shared/json-stream.js` (`replaceFile`)
    - `src/shared/artifact-io.js` (bak cleanup helper reuse, if appropriate)
  - Requirements:
    - After successful replace, ensure backup artifacts are cleaned up where safe.
    - Ensure Windows path-length fallbacks remain correct.
    - Ensure cross-device rename fallback is safe and does not leave partial outputs.

#### Tests / Verification
- [ ] `tests/fs/atomic-replace-cleans-bak.test.js`
- [ ] `tests/fs/atomic-replace-cross-device-fallback.test.js`

---

# Phase 5 — Metadata v2 + Effective Language Fidelity (Segments & VFS prerequisites)

## Objective

Deliver **contract-correct, backend-parity Metadata v2** and make **segments first-class language units** end-to-end.

This phase ensures:

- `metaV2` is **complete, stable, and finalized after enrichment** (no stale derived metadata).
- **SQLite and JSONL backends expose equivalent `metaV2`**, rather than SQLite returning a lossy reconstruction.
- Embedded/segmented code (Markdown fences, Vue `<script>`, etc.) carries an explicit **effective language descriptor** used consistently by chunking, parsing, tooling, and retrieval filters.
- **TSX/JSX fidelity is preserved** during segment discovery and downstream parser/tool selection.
- A **Virtual File System (VFS)** and **segment manifest** foundation exists so tooling providers can operate on embedded code as if it were real files, with stable identities and source mapping.

---

## 5.1 MetaV2 type normalization: preserve inferred parameter maps and canonicalize return types

- [ ] Fix `metaV2` inferred type normalization so `inferredTypes.params` is never silently dropped.
  - [ ] Update `normalizeTypeMap(...)` to support:
    - `returns: TypeEntry[]` (array)
    - `params: Record<string, TypeEntry[]>` (object map keyed by parameter name)
    - `properties: TypeEntry[]` (array, where applicable)
  - [ ] Preserve existing behavior for array-valued type maps while adding explicit support for nested param maps.
  - [ ] Ensure there is exactly **one canonical producer shape** for inferred parameter types (object map), and eliminate/forbid competing shapes.

- [ ] Normalize and surface return types consistently across languages.
  - [ ] Ensure `buildDeclaredTypes(...)` consumes both `docmeta.returnType` and `docmeta.returns` and produces a single canonical output (`metaV2.declaredTypes.returns[]`).
  - [ ] Ensure any output filtering/formatting that reasons about return types uses the canonical `metaV2` fields rather than language-specific docmeta variants.

- [ ] Strengthen validation to catch drift and invalid shapes early.
  - [ ] Add strict validation rules that reject:
    - `metaV2.inferredTypes.params` when it is not an object map of arrays.
    - Type entries missing `type`.
    - Backends emitting different shapes for the same logical field.

- Files:
  - `src/index/metadata-v2.js`
  - `src/index/type-inference-crossfile/extract.js`
  - `src/index/validate.js`
  - `docs/` (contract/schemas where Metadata v2 shape is documented)

#### Tests

- [ ] `tests/metaV2/inferred-params-preserved.test.js`
  - Build a fixture where cross-file inference produces parameter types.
  - Assert `metaV2.inferredTypes.params.<paramName>` exists and is an array of entries with `type`.
  - Assert no data loss compared to `chunk_meta.docmeta.inferredTypes.params`.
- [ ] `tests/metaV2/returns-normalization.test.js`
  - Fixture(s) where return type appears in `docmeta.returns` vs `docmeta.returnType`.
  - Assert `metaV2.declaredTypes.returns[]` is populated consistently.
- [ ] `tests/validate/metav2-rejects-invalid-param-shapes.test.js`
  - Tamper `metaV2.inferredTypes.params` into an array; strict validate must fail.

---

## 5.2 MetaV2 finalization: enforce enrichment-before-serialization ordering

- [ ] Make `metaV2` generation explicitly **post-enrichment**.
  - [ ] Identify and enumerate build steps that mutate chunk state after initial assembly (notably cross-file inference, plus any late relation/risk augmentation).
  - [ ] Introduce a `finalizeMetaV2(chunks)` step after enrichment that recomputes (or provably updates) `metaV2` from the final chunk object.
  - [ ] Ensure artifact writing and storage layers serialize **finalized** `metaV2`, not the assemble-time snapshot.

- [ ] Remove/contain stale-`metaV2` failure modes.
  - [ ] Stop treating early-computed `metaV2` as authoritative once any later phase mutates `chunk.docmeta`, `chunk.codeRelations`, or tooling-derived annotations.
  - [ ] Update cached-bundle repair logic so cached chunks cannot bypass metaV2 finalization when subsequent steps would have enriched them.

- [ ] Determinism and equivalence guarantees.
  - [ ] Provide an internal equivalence check (used in tests and optionally strict validation) that compares:
    - serialized `chunk_meta.docmeta` → recomputed `metaV2`
    - against the stored/serialized `metaV2`
  - [ ] Ensure the recompute is stable across backends and deterministic across runs.

- Deferred (explicit):
  - A purely incremental `metaV2` updater (delta-based updates instead of recompute) is a performance optimization and can be deferred to **Phase 6 — Relations + graph artifacts** once correctness is locked.

- Files:
  - `src/index/build/file-processor/assemble.js`
  - `src/index/build/indexer/steps/inference.js`
  - `src/index/build/indexer/*` (pipeline ordering)
  - `src/index/build/file-processor/cached-bundle.js`
  - `src/index/build/artifacts/writers/chunk-meta.js`

#### Tests

- [ ] `tests/metaV2/finalization-after-inference.test.js`
  - Build fixture with cross-file inference enabled.
  - Assert `metaV2` includes inferred params/returns and any enriched relation/risk fields that were previously missing.
  - Assert `metaV2` matches a fresh recomputation from serialized `chunk_meta.docmeta` for a sampled set of chunks.
- [ ] `tests/metaV2/cached-bundle-does-not-emit-stale-metav2.test.js`
  - Force a build path that reuses cached bundles.
  - Assert final `chunk_meta.metaV2` reflects post-cache enrichment.

---

## 5.3 SQLite parity: store full metaV2 and enforce stable chunk identity invariants

- [ ] Eliminate SQLite “minimal metaV2” reconstruction by storing the canonical `metaV2` object.
  - [ ] Add a `metaV2_json` (or equivalent) column per chunk in SQLite.
  - [ ] Persist **finalized** `metaV2` into SQLite during build.
  - [ ] Update SQLite retrieval to load/parse `metaV2_json` rather than reconstructing a lossy object.
  - [ ] If size becomes a concern, allow compression or a dedicated blob column, but keep the contract identical.

- [ ] Enforce `chunk_id` / chunk identity invariants in SQLite.
  - [ ] Guarantee `chunk_id` is **never null** in the SQLite build path.
  - [ ] When ingesting from JSONL artifacts, compute a stable fallback chunk UID if a record is missing `chunkId`.
  - [ ] Ensure identity invariants are validated (strict mode fails if missing).

- [ ] Backend parity guardrails.
  - [ ] Define a required-field set for `metaV2` that must match across JSONL and SQLite for the same build.
  - [ ] Add a parity sampling validator (build-time or validate-time) that compares `metaV2` fields across modes.

- Deferred (explicit):
  - Any backend-specific indexing accelerators (extra columns/indexes) are permitted, but must not change the logical `metaV2` shape. Additional indexing work can be deferred to **Phase 7 — Embeddings + ANN**.

- Files:
  - `src/storage/sqlite/schema.js`
  - `src/storage/sqlite/build/*` (writers/ingestors)
  - `src/retrieval/sqlite-helpers.js`
  - `src/index/validate.js`

#### Tests

- [ ] `tests/sqlite/metav2-parity.test.js`
  - Build a fixture in JSONL and SQLite modes.
  - Retrieve the same chunk(s) via both.
  - Assert `metaV2` deep-equality for required fields (including `inferredTypes.params`, `lang`, and `segment` where present).
- [ ] `tests/sqlite/chunk-id-non-null.test.js`
  - Build in SQLite mode and assert no chunk row has a null `chunk_id`.
- [ ] `tests/validate/sqlite-metav2-must-not-be-minimal.test.js`
  - Ensure strict validate fails if SQLite retrieval returns a lossy/minimal `metaV2` while JSONL has richer fields.

---

## 5.4 Effective language descriptor: preserve TSX/JSX and drive analysis using effective language, not container extension

- [ ] Stop collapsing TSX/JSX (and similar) during segment discovery.
  - [ ] Remove/replace any aliasing that maps `tsx → typescript` or `jsx → javascript` at **segment discovery time**.
  - [ ] Preserve the *raw segment language hint* (e.g., `tsx`, `jsx`) on the segment record.

- [ ] Define and propagate a single **effective language descriptor** for every chunk.
  - [ ] Add fields (or an equivalent structured object) that clearly separate container vs effective values:
    - `containerExt`, `containerLanguageId`
    - `effectiveExt`, `effectiveLanguageId`
    - `segmentLanguageId` (raw hint) and `segmentType` (script/template/style/fence/etc) when a segment exists
  - [ ] Define explicit normalization rules, e.g.:
    - `segmentLanguageId = 'tsx'` → `effectiveLanguageId = 'typescript'`, `effectiveExt = '.tsx'`
    - `segmentLanguageId = 'jsx'` → `effectiveLanguageId = 'javascript'`, `effectiveExt = '.jsx'`
    - otherwise `effectiveLanguageId` derives from segment language or (if no segment) from container language
  - [ ] Persist the descriptor in both:
    - the in-memory `chunk` object used during build, and
    - the serialized outputs (`chunk_meta`, `metaV2`, filter-index inputs).

- [ ] Drive all language-specific analysis using **effective** language.
  - [ ] In the file processor, select the language handler/context per chunk using the effective descriptor.
  - [ ] Run docmeta extraction, relation extraction, flow, risk detection, and type inference using effective language (not file-level/container language).
  - [ ] Ensure caps/truncation mode still applies effective-language analysis to embedded segments.

- [ ] Ensure tree-sitter pass selection uses segment hints, not container extension.
  - [ ] Choose tree-sitter language id based on the effective descriptor (e.g., `.md` TSX fence must parse as `tsx`).

- [ ] Harden chunk identity for segmented content.
  - [ ] Ensure the canonical stable chunk UID (e.g., `metaV2.chunkId`) includes segment identity and range information so embedded chunks cannot collide.
  - [ ] Remove unstable identity inputs (e.g., `kind`/`name`) from the chunk UID hash if they cause churn without improving uniqueness.
  - [ ] Update cross-file inference keying so it no longer keys by `${file}::${name}` (which collides for repeated names and ignores segments); key by stable chunk UID (or a virtual path) instead.

- Deferred (explicit):
  - Full graph/node identity migrations and symbol identity schemes that depend on `virtualPath` can be completed in **Phase 6 — Relations + graph artifacts** once segment identities are stable.

- Files:
  - `src/index/segments.js`
  - `src/index/build/file-processor.js`
  - `src/index/build/file-processor/assemble.js`
  - `src/index/build/file-processor/tree-sitter.js`
  - `src/index/chunk-id.js`
  - `src/index/type-inference-crossfile/pipeline.js`
  - `src/index/type-inference-crossfile/tooling.js`

#### Tests

- [ ] `tests/segments/tsx-jsx-preserved.test.js`
  - Segment a Markdown fixture containing `tsx` and `jsx` fences.
  - Assert the segment record preserves the raw hint (`segmentLanguageId` is `tsx`/`jsx`).
- [ ] `tests/segments/effective-language-md-vue.test.js`
  - Fixture with `.md` TS/TSX fence and `.vue` `<script lang="ts">`.
  - Assert chunks are analyzed as `effectiveLanguageId = typescript` and are filterable as such.
- [ ] `tests/tree-sitter/segment-language-resolution.test.js`
  - Assert a `.md` TSX fence uses `tsx` parsing, not `typescript` or the `.md` container.
- [ ] `tests/type-inference/crossfile-keying-uses-chunk-uid.test.js`
  - Fixture with repeated function names in different segments.
  - Assert cross-file inference does not collide and preserves distinct results.

---

## 5.5 Retrieval filtering and filter-index upgrades: filter by effective language, not container extension

- [ ] Make `--lang` filter semantics target **effective language**.
  - [ ] Update retrieval filter normalization so language filters are not implemented as “extension lists”.
  - [ ] Instead, filter on the chunk’s effective language field (e.g., `metaV2.lang` or `effectiveLanguageId`).

- [ ] Extend the filter index to index segment-aware dimensions.
  - [ ] Add `byLang` indexing keyed by effective language id.
  - [ ] Optionally add `bySegmentKind` (script/template/style/fence) and/or `byContainer` (vue/markdown/etc) if needed for UX.
  - [ ] Ensure filter-index writing/reading remains deterministic and stable.

- [ ] Maintain compatibility and strict-mode guarantees.
  - [ ] If a legacy build lacks `byLang`, retrieval may fall back to coarse extension-based behavior *only with an explicit warning*.
  - [ ] Strict validation must fail for builds that claim segment-aware capabilities but do not provide the necessary filter-index dimensions.

- [ ] Surface segment context in output payloads.
  - [ ] Ensure retrieval output can expose enough information for UX/debugging:
    - container path
    - segment type + range
    - effective language/ext
    - (optional) virtual path

- Deferred (explicit):
  - Rich query surface additions like `--segment-kind` and advanced segment predicates can be expanded in **Phase 6 — Relations + graph artifacts** once segment identity and manifests are stable.

- Files:
  - `src/retrieval/filters.js`
  - `src/retrieval/filter-index.js`
  - `src/retrieval/output/*` (if output formatting requires segment fields)
  - `src/cli/*` (if CLI flags need to route to new filter fields)

#### Tests

- [ ] `tests/retrieval/lang-filter-matches-segments.test.js`
  - Index a fixture with embedded TS inside `.md` or `.vue`.
  - Query with `--lang typescript` and assert embedded chunks are returned.
- [ ] `tests/retrieval/filter-index-bylang.test.js`
  - Build filter index and assert `byLang.typescript` includes the embedded chunks’ doc IDs.
- [ ] `tests/validate/filter-index-requires-bylang-when-enabled.test.js`
  - Strict validate fails if segment-aware mode is enabled but `byLang` is missing.

---

## 5.6 VFS + segment-aware tooling + Markdown fence hashing cache

- [ ] Introduce a Virtual File System abstraction suitable for tooling providers.
  - [ ] Add a shared VFS module that can address both real files and virtual segment files.
  - [ ] Support both modes:
    - `memOnly`: in-memory materialization only (no disk writes)
    - `diskMirror`: optional on-disk mirror for external tooling that requires paths
  - [ ] Provide core VFS operations:
    - resolve/read content by virtual path
    - materialize a set of virtual paths into a root directory
    - list virtual children for a container file
    - emit cleanup handles

- [ ] Define a deterministic virtual path scheme and stable segment identities.
  - [ ] Virtual paths must be stable across runs and reversible back to source.
  - [ ] Include enough identity to avoid collisions (relPath + segmentId + language/ext at minimum).
  - [ ] Ensure the scheme is filesystem-safe when materialized.

- [ ] Emit a VFS manifest artifact for debuggability and diagnostics remapping.
  - [ ] Add a `vfs_manifest.jsonl` artifact (or equivalent) with entries containing:
    - `virtualPath`
    - source: `{ relPath, segmentId, segmentType, start, end, startLine, endLine }`
    - effective language/ext and raw segment language hint
    - content hash/fingerprint
  - [ ] Ensure diagnostics produced against virtual files can be mapped back to container offsets/lines.

- [ ] Make tooling selection segment-aware and VFS-backed.
  - [ ] Update tooling orchestration to select providers using the effective language descriptor (not container extension).
  - [ ] Materialize virtual files through VFS so providers like TypeScript can analyze embedded code (Markdown TS/TSX fences, Vue `<script lang="ts">`, etc.).
  - [ ] Ensure provider inputs/outputs reference stable identities (chunk UID / virtualPath), not ambiguous `${file}::${name}` keys.

- [ ] Implement Markdown fenced tooling hashing and caching (foundation).
  - [ ] Parse fence info strings to extract:
    - language hint
    - tooling directives (e.g., `tooling:mode=extract|tool|evaluate|apply`, `tooling:name=...`, `tooling:target=...`)
  - [ ] Normalize fenced content for hashing (dedent, newline normalization, trimming rules) and compute a stable fingerprint.
  - [ ] Use the fingerprint/content hash to:
    - stabilize segmentId/virtualPath for fences
    - key a tooling cache so unchanged blocks do not re-run tooling
  - [ ] Store cache entries and provenance in a deterministic location (e.g., under a build cache root).

- Deferred (explicit):
  - “Apply mode” document rewriting and rich evaluate/apply UX can be expanded in **Phase 7 — Embeddings + ANN** or a dedicated tooling UX phase once the hashing + VFS foundations are proven safe.

- Files:
  - `src/shared/vfs.js` (new)
  - `src/index/segments.js` (fence directive parsing, segment hashing hooks)
  - `src/index/type-inference-crossfile/tooling.js`
  - `src/index/tooling/typescript-provider.js`
  - `src/index/build/artifacts/writers/*` (new VFS manifest writer)
  - `docs/` and config schema (tooling/vfs/fence directive configuration)

#### Tests

- [ ] `tests/vfs/virtual-path-stability.test.js`
  - Same input file produces identical virtual paths across repeated builds.
- [ ] `tests/vfs/vfs-manifest-emitted-and-reversible.test.js`
  - Manifest entry round-trips to the correct source segment ranges.
- [ ] `tests/tooling/segment-aware-tool-selection.test.js`
  - `.md` TS/TSX fence triggers TypeScript tooling selection via effective language.
- [ ] `tests/tooling/markdown-fence-fingerprint-stability.test.js`
  - Fingerprint is stable across line-ending differences and indentation-only changes outside the block.
- [ ] `tests/tooling/markdown-fence-cache-invalidation.test.js`
  - Changing one fenced block invalidates only that block’s cached tooling output.

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
    - `start`, `end` (absolute offsets in the *container* file)
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
    - If resolution requires a full SymbolId contract, defer that strengthening to **Phase 8 — Symbol Identity v1**, but Phase 6 must still remove *required* reliance on `file::name` uniqueness.
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

## Phase 8 — Tooling Provider Framework & Type Inference Parity (Segment‑Aware)

### Objective
Deliver a **capability‑gated, provider‑driven tooling layer** that can safely enrich the index with **high‑confidence type/signature information** (and, where practical, symbol/definition context) across languages — without making indexing brittle when tools are absent.

This phase focuses on:
- A **provider registry** + **config‑driven allow/deny** and deterministic provider ordering
- **Segment/VFS‑aware** tooling execution (embedded scripts get the same type coverage as standalone files)
- **TypeScript tooling parity for JS/JSX** (and optionally container‑script segments)
- **Provider hardening** (stable chunk keys, encoding‑correct offsets, LSP reliability, and runtime guardrails)
- A **“doctor” workflow** so users can diagnose and enable optional tooling safely

### Exit Criteria
- Tooling providers are executed through a single registry/orchestrator that is **config‑gated**, **deterministic**, and **safe when tools are missing**.
- JS/JSX receives TypeScript‑powered types by default when TS tooling is available (with explicit caps + opt‑outs).
- All tooling providers attach types using **stable chunk identity** (chunkId / chunkUid) rather than `file::name` keys.
- Tooling reads file text through the shared decoding path so **offset math is consistent** with chunking for non‑UTF8 inputs.
- At least one non‑C/Swift/Python compiled language (e.g., Go or Rust) has an **optional LSP provider** wired end‑to‑end (detected → gated → enriches types).
- A supported **tooling doctor/report** command can explain why tooling is or isn’t active, and what to do next.

---

### Phase 8.1 — Provider interface + registry (capability gating, deterministic selection)
- [ ] Define a **Tooling Provider contract** that standardizes:
  - [ ] `id`, `label`, `languages` (effective `languageId` values), `kinds` (types/symbols/diagnostics), `requires` (binary/module), and `experimental` flags.
  - [ ] `detect({ rootDir, toolingDir, config }) -> { available, details }` (best‑effort; never throws).
  - [ ] `collect({ rootDir, inputs, config, guard, log }) -> { typesByChunkId, diagnostics?, provenance }`.
  - [ ] A shared **result schema** (see Phase 8.2) that supports:
    - provider id
    - confidence
    - bounded evidence
    - deterministic ordering
- [ ] Implement a **provider registry** module and migrate orchestration to it.
  - Touchpoints:
    - `src/index/type-inference-crossfile/tooling.js` (replace ad‑hoc provider wiring)
    - New: `src/index/tooling/registry.js` (or similar)
    - Existing providers: `src/index/tooling/typescript-provider.js`, `clangd-provider.js`, `sourcekit-provider.js`, `pyright-provider.js`
  - [ ] Ensure deterministic provider order:
    - [ ] stable default ordering by provider id
    - [ ] optional config override (e.g., `tooling.providerOrder`)
- [ ] Make tool/provider selection **config‑driven** (allow/deny) and actually enforced.
  - Touchpoints:
    - `tools/dict-utils.js#getToolingConfig` (already parses `enabledTools`/`disabledTools`)
    - `src/index/type-inference-crossfile/tooling.js` / provider registry selection
  - [ ] Semantics:
    - [ ] `tooling.disabledTools` always wins (hard off).
    - [ ] If `tooling.enabledTools` is non‑empty, only listed providers may run.
    - [ ] Provider‑local `enabled: false` also wins (hard off).
- [ ] Formalize provider configuration surfaces (documented + validated).
  - [ ] Extend config inventory / docs to include new fields introduced in Phase 8 (see subsections).
  - [ ] Add schema coverage for tooling config (currently missing from `docs/config-schema.json`).
    - Touchpoints:
      - `docs/config-schema.json`
      - `docs/config-inventory.md` and/or `docs/config-inventory.json`
      - `docs/config-contract.md` (if contract needs to call out tooling behavior)

#### Tests / Verification
- [ ] Add a unit test that resolves providers deterministically given:
  - [ ] default config (all providers eligible)
  - [ ] allowlist only
  - [ ] denylist present
  - [ ] provider‑local `enabled:false`
- [ ] Add a config‑schema test that fails on unknown tooling keys once tooling is included in schema.
- [ ] Add a smoke verification that indexing does not fail when **no tooling is installed** (providers simply no‑op).

---

### Phase 8.2 — Segment/VFS‑aware tooling pass orchestration (stable chunk keys + merge semantics)
- [ ] Replace extension‑only filtering with **effective language selection** (segment‑aware).
  - Touchpoints:
    - `src/index/type-inference-crossfile/tooling.js#filterChunksByExt` (replace)
    - `src/index/segments.js` / segment metadata produced earlier (Phase 5 dependency)
  - [ ] New behavior:
    - [ ] Select candidate chunks by effective `languageId` (segment language if present; else container file language).
    - [ ] Providers may still optionally apply extension filters as a secondary guard.
- [ ] Introduce a **stable per‑chunk tooling key** and remove reliance on `file::name`.
  - Touchpoints:
    - `src/index/chunk-id.js#resolveChunkId`
    - `src/index/type-inference-crossfile/tooling.js`
    - All providers under `src/index/tooling/*-provider.js`
  - [ ] Provider outputs must be keyed by **chunkId** (or chunkUid), not `file::name`.
  - [ ] Add collision/ambiguity detection:
    - [ ] If multiple chunks map to the same legacy key, log once and require chunkId mapping.
- [ ] Add a segment‑aware **virtual file input layer** for tooling.
  - Touchpoints:
    - New (recommended): `src/index/tooling/virtual-files.js`
    - Provider updates: `src/index/tooling/typescript-provider.js` (required), LSP providers as needed
  - [ ] Requirements:
    - [ ] Tooling can be fed either:
      - [ ] real repo files (baseline), and/or
      - [ ] virtual projected files for embedded segments (Phase 5 VFS foundation dependency).
    - [ ] Each virtual file has:
      - [ ] stable virtual path
      - [ ] `languageId`
      - [ ] content hash (for caching/invalidation)
      - [ ] mapping back to `(containerRelPath, segmentId, startOffset, endOffset)`
- [ ] Fix the tooling skip heuristic (too coarse today).
  - Touchpoints:
    - `src/index/type-inference-crossfile/tooling.js#hasToolingReturn` (replace)
  - [ ] New skip policy:
    - [ ] Skip only when the provider has already produced the relevant fields **for this chunkId** and the cached inputs match:
      - file/segment content hash
      - provider version (binary/module version)
      - provider config hash
    - [ ] If only some fields exist (e.g., params but not returns), rerun only if the provider can fill gaps.
- [ ] Normalize and merge tooling types with bounded growth and provenance.
  - Touchpoints:
    - `src/integrations/tooling/providers/shared.js#mergeToolingEntry` (extend)
    - `src/index/type-inference-crossfile/apply.js` (extend inferred‑type structures as needed)
    - `src/index/metadata-v2.js` (ensure tooling types are visible/normalized for segments)
  - [ ] Required semantics:
    - [ ] Attach `provider` (e.g., `typescript`, `clangd`) and `source: "tooling"` at the leaf entries.
    - [ ] Support `confidence` and optional bounded `evidence` fields.
    - [ ] Enforce caps:
      - [ ] max candidates per param/return
      - [ ] deterministic ordering (e.g., sort by confidence desc then lexicographic)
- [ ] Normalize primary return type surfacing to reduce “looks missing” gaps.
  - [ ] Standardize on `docmeta.returnType` as a single “primary” return type while preserving multi‑candidate lists.
  - Touchpoints:
    - `src/index/metadata-v2.js`
    - Retrieval/UI surfaces that read return types (as applicable)

#### Tests / Verification
- [ ] Add a fixture with **duplicate symbol names** in a single file (and/or in two segments) and verify:
  - [ ] tooling enrichment attaches to the correct chunk by chunkId
  - [ ] no overwrite/collision occurs
- [ ] Add a segment fixture (e.g., `.vue` or fenced block) where embedded JS/TS receives tooling types via the virtual file layer.
- [ ] Add a deterministic merge test:
  - [ ] two providers produce overlapping return candidates → merged list is stable and bounded
- [ ] Verify `tests/type-inference-lsp-enrichment.js` continues to pass (no regressions) after orchestration changes.

---

### Phase 8.3 — TypeScript provider parity for JS/JSX (jsconfig, partitions, guardrails, stable keys)
- [ ] Expand TypeScript provider file selection to include JS/JSX when configured.
  - Touchpoints:
    - `src/index/tooling/typescript-provider.js`
    - `src/index/type-inference-crossfile/tooling.js` (ensure JS/JSX chunk sets are sent to TS provider)
  - [ ] Default behavior (recommended):
    - [ ] `.js`, `.jsx`, `.mjs`, `.cjs` are included when `tooling.typescript.includeJs !== false`.
    - [ ] `checkJs` defaults to true for richer types when JS is included.
- [ ] Respect `jsconfig.json` for JS‑first repositories.
  - Touchpoints:
    - `src/index/tooling/typescript-provider.js` (config discovery + resolution)
    - `tools/dict-utils.js#getToolingConfig` (expose relevant config)
  - [ ] Requirements:
    - [ ] If `jsconfig.json` exists and no `tsconfig.json` exists, treat jsconfig as the config source.
    - [ ] Continue to respect explicit `tooling.typescript.tsconfigPath` overrides.
- [ ] Implement a deterministic **program partitioning** strategy with explicit caps.
  - Touchpoints:
    - `src/index/tooling/typescript-provider.js`
    - (Optional helper): `src/index/tooling/typescript-partitions.js`
  - [ ] Partitioning heuristics (in priority order):
    - [ ] by tsconfig/jsconfig roots when available
    - [ ] else by package root (nearest `package.json`)
    - [ ] else by a bounded SCC partition of the import graph (only if already available; otherwise defer SCC splitting)
  - [ ] Determinism requirements:
    - [ ] Partition IDs are content‑derived (e.g., sha1 of sorted root relpaths + config relpath + schema version).
    - [ ] Partitions are enumerated in sorted order by ID before execution.
- [ ] Add huge file / huge project guardrails and omission metadata.
  - Touchpoints:
    - `src/index/tooling/typescript-provider.js`
    - `src/index/type-inference-crossfile/tooling.js` (skip huge‑file candidates before provider invocation if possible)
  - [ ] Policy (centralized):
    - [ ] If `bytes > maxBytes` or `lines > maxLines` (and optionally `nodeCount > maxNodes`):
      - [ ] skip full typechecking
      - [ ] extract surface declarations only (best‑effort)
      - [ ] emit omission metadata (reason codes) so results are explainable
- [ ] Fix parameter‑name instability for destructuring parameters.
  - Touchpoints:
    - `src/index/tooling/typescript-provider.js`
  - [ ] Requirements:
    - [ ] Normalize destructuring param “names” to a stable form (whitespace‑insensitive) **or** store positional param typing for destructured params.
    - [ ] Ensure mapping remains compatible with `docmeta.params` and metadata‑v2 normalization.
- [ ] Emit provider outputs keyed by **chunkId** and encoding‑correct offsets.
  - Touchpoints:
    - `src/index/tooling/typescript-provider.js`
    - `src/shared/encoding.js` (reuse `readTextFile*` for content and offset math)
  - [ ] Ensure virtual file support:
    - [ ] accept VFS virtual files (segments) as additional compiler host inputs when enabled.
- [ ] Extend tooling TypeScript config surface (document + validate).
  - Touchpoints:
    - `tools/dict-utils.js#getToolingConfig`
    - `docs/config-inventory.json` / `docs/config-inventory.md`
  - [ ] Add (minimum) keys:
    - [ ] `tooling.typescript.includeJs` (default true)
    - [ ] `tooling.typescript.checkJs` (default true)
    - [ ] `tooling.typescript.includeNodeModules` (default false)
    - [ ] `tooling.typescript.maxFiles` (safety cap)
    - [ ] `tooling.typescript.maxFileBytes` / `maxLines` (huge file policy)
    - [ ] `tooling.typescript.maxProgramFiles` (huge project policy)

#### Tests / Verification
- [ ] Add a JS fixture repo with `jsconfig.json` + path alias and verify TS provider resolves types (at least one alias import).
- [ ] Add a JS fixture that uses JSDoc and verify tooling types surface into `docmeta.inferredTypes`.
- [ ] Add a “huge file” fixture (generated) and verify:
  - [ ] provider does not blow up runtime
  - [ ] omission metadata is present and deterministic
- [ ] Extend `tests/type-inference-typescript-provider-no-ts.js` with:
  - [ ] JS/JSX selection behavior (no TS module → empty)
  - [ ] config override behavior (explicit `tsconfigPath`)

---

### Phase 8.4 — Provider hardening (LSP reliability, guard semantics, encoding correctness, stable keys)
- [ ] Fix LSP client lifecycle hazards (restart/session corruption).
  - Touchpoints:
    - `src/integrations/tooling/lsp/client.js`
  - [ ] Requirements:
    - [ ] Exit handlers from old processes must not clobber state for a new process instance.
    - [ ] Restart behavior must be deterministic (no interleaved parser/writer state).
- [ ] Eliminate “hung request” failure modes in the LSP client.
  - Touchpoints:
    - `src/integrations/tooling/lsp/client.js`
  - [ ] Requirements:
    - [ ] All requests must have a timeout (default if caller omits one).
    - [ ] If the transport is closed, pending requests must be rejected promptly.
- [ ] Strengthen languageId handling for LSP tooling (avoid extension-only blind spots).
  - Touchpoints:
    - `src/integrations/tooling/lsp/client.js#languageIdForFileExt`
    - Provider inputs (virtual files should provide `languageId` explicitly)
  - [ ] Requirements:
    - [ ] Allow providers to override `languageId` per document (don’t rely solely on file extension).
    - [ ] Ensure segment-projected virtual files carry correct `languageId` (e.g., `typescriptreact` vs `javascriptreact`).
- [ ] Make diagnostics collection deterministic for LSP-based providers (especially Pyright).
  - Touchpoints:
    - `src/index/tooling/pyright-provider.js`
    - (If needed) `src/integrations/tooling/providers/lsp.js` (shared helper)
  - [ ] Requirements:
    - [ ] Add a short, bounded “diagnostics drain” after opening documents (or use request-based diagnostics where supported).
    - [ ] Ensure output does not depend on notification timing or shutdown order (repeatable across runs).
- [ ] Fix circuit breaker semantics so retries don’t artificially trip the breaker.
  - Touchpoints:
    - `src/integrations/tooling/providers/shared.js#createToolingGuard`
  - [ ] Requirements:
    - [ ] Count “failures” per invocation (post‑retries), not per retry attempt.
    - [ ] Keep existing logging, but make it reflect invocation outcomes.
- [ ] Make provider text reads encoding‑correct and consistent with chunking.
  - Touchpoints:
    - `src/index/tooling/clangd-provider.js`
    - `src/index/tooling/sourcekit-provider.js`
    - `src/index/tooling/pyright-provider.js`
  - [ ] Replace `fs.readFile(..., 'utf8')` with shared decode (`src/shared/encoding.js`) so offsets align with chunk ranges for non‑UTF8 files.
- [ ] Replace provider keying by `file::name` across all tooling providers.
  - Touchpoints:
    - `src/index/tooling/clangd-provider.js`
    - `src/index/tooling/sourcekit-provider.js`
    - `src/index/tooling/pyright-provider.js`
    - `src/index/tooling/typescript-provider.js`
  - [ ] Providers must key outputs by `chunkId` (or include range in the key if chunkId is unavailable).
- [ ] Add provider‑level guardrails for large repos/projects (time + scope).
  - [ ] Introduce per‑provider caps (max files, max bytes, max symbols) and enforce them deterministically.
  - Touchpoints:
    - provider files listed above
    - `tools/dict-utils.js#getToolingConfig` (if new config keys are added)

#### Tests / Verification
- [ ] Add a unit test that simulates LSP client restart and verifies:
  - [ ] old process exit does not null out a new client instance
  - [ ] requests after restart still resolve/reject deterministically
- [ ] Add a provider guard test:
  - [ ] a single call that retries does not trip the breaker prematurely
- [ ] Add/extend a non‑UTF8 fixture file and verify provider offset mapping remains stable (no misattachment).

---

### Phase 8.5 — Expand provider coverage + tooling setup UX (doctor/report/install; optional framework servers)
- [ ] Implement additional optional LSP providers (best‑effort; never required for indexing).
  - Touchpoints:
    - New provider modules under `src/index/tooling/` (one per provider)
    - Provider registry (Phase 8.1)
    - Tooling orchestrator (Phase 8.2)
  - [ ] Prioritized list:
    - [ ] Go: `gopls`
    - [ ] Rust: `rust-analyzer`
    - [ ] Java: `jdtls` (gated behind explicit enable due to setup complexity)
    - [ ] Kotlin: `kotlin-language-server` / `kotlin-lsp` (gated)
    - [ ] C#: `csharp-ls` preferred (OmniSharp optional; gated)
  - [ ] Secondary / experimental list (explicitly opt‑in):
    - [ ] Ruby: `ruby-lsp` (Solargraph fallback)
    - [ ] PHP: `phpactor` (Intelephense optional)
    - [ ] Shell: `bash-language-server`
    - [ ] Lua: `lua-language-server`
    - [ ] SQL: `sqls` (limited but useful for hover/symbols)
- [ ] Container scripts: ensure embedded scripts have usable types without requiring framework language servers.
  - [ ] Baseline:
    - [ ] embedded JS/TS segments are projected into virtual files and get TS‑provider enrichment (Phase 8.2 + 8.3)
  - [ ] Optional accelerators (explicitly opt‑in; never required):
    - [ ] Vue: Volar (`@vue/language-server`)
    - [ ] Svelte: `svelte-language-server`
    - [ ] Astro: `@astrojs/language-server`
  - [ ] If enabled:
    - [ ] treat segments as virtual documents (or use LS SFC entrypoints)
    - [ ] map returned positions/types back to container offsets using segment offset maps
- [ ] Add a first‑class “tooling doctor/report” workflow.
  - Touchpoints:
    - New: `tools/tooling-doctor.js` (or promote/rename `tools/tooling-detect.js`)
    - `tools/tooling-utils.js` (report building, tool docs, detection)
    - `docs/commands.md` (CLI surface)
  - [ ] Requirements:
    - [ ] Detect installed tools and print actionable next steps (including manual‑install tools).
    - [ ] Ensure detection checks the actual command a provider will execute (e.g., align `pyright` vs `pyright-langserver`, and respect configured `cmd`).
    - [ ] Verify critical prerequisites (e.g., `compile_commands.json` when required for clangd).
    - [ ] Emit machine‑readable JSON output for automation (`--json`).
- [ ] Improve tooling install/report integration into the public CLI surface (optional but recommended).
  - [ ] Add CLI wrappers:
    - [ ] `pairofcleats tooling report --repo <path> [--json]`
    - [ ] `pairofcleats tooling install <toolId> [--scope cache|user] [--dry-run]`
- [ ] Document tooling setup recipes and known constraints.
  - Touchpoints (choose one home):
    - [ ] New: `docs/tooling.md`
    - [ ] Or extend: `docs/parser-backbone.md` / existing operational docs
  - [ ] Must include concrete guidance for:
    - clangd + compile_commands generation
    - sourcekit-lsp + Swift toolchain assumptions
    - pyright + python environment expectations
    - jdtls/kotlin servers (gated: explain prerequisites)

#### Tests / Verification
- [ ] Add a CLI smoke test that runs tooling doctor/report in a fixture repo and asserts:
  - [ ] missing tools are reported with docs links (when provided)
  - [ ] output is stable in `--json` mode
- [ ] Add an integration fixture for at least one new LSP provider using a stub server (similar to existing LSP enrichment tests).
- [ ] Manual verification checklist:
  - [ ] run `pairofcleats tooling report` on a repo with no tools installed (should be informative, not fatal)
  - [ ] run on a repo with `clangd` or `pyright` installed (should show detected and enabled gating behavior)

---

## Phase 9 — Symbol identity (collision-safe IDs) + cross-file linking

### Objective
Introduce canonical, collision-safe chunk and symbol identity so cross-file joins and graph-powered features are correct by construction. This phase eliminates `file::name` collision classes, emits first-class symbol artifacts, and upgrades cross-file inference and retrieval context expansion to use explicit identity with strict validation.

### 9.1 Canonical chunk identity contract (`docId` vs `chunkUid`) + persisted mapping artifacts
- [ ] Define and enforce a single canonical identity vocabulary
  - [ ] Treat `docId` as a build-local integer identifier (stable only within a single build output).
  - [ ] Introduce `chunkUid` as the stable-ish, graph/UI/cache-facing string identifier used for cross-file joins.
  - [ ] Ensure no module uses “chunkId” to mean both an integer and a string (rename as needed and enforce via validation).
  - Touchpoints (expected): `src/index/build/state.js`, `src/index/chunk-id.js`, `src/index/metadata-v2.js`.
- [ ] Implement `chunkUid` derivation that is resilient to minor line shifts
  - [ ] Compute a deterministic `spanHash` from the chunk’s text content (hash backend: xxh64 via `src/shared/hash.js`), and include small context hashes to reduce collision risk without anchoring to absolute line numbers.
    - Detail (recommended): `chunkUid = xxh64(fileRelPath + '\0' + (segmentId||'') + '\0' + spanHash + '\0' + preHash + '\0' + postHash)`.
  - [ ] Persist `spanHash`, `algoVersion`, and (when used) `pre/post` context hash metadata into `metaV2`.
  - [ ] If a collision is detected within a `{fileRelPath, segmentId}` scope, deterministically disambiguate and record `collisionOf`.
  - Touchpoints (expected): chunking pipeline (span text available), `src/index/metadata-v2.js`.
- [ ] Persist identity mapping artifacts for deterministic joins
  - [ ] Emit a `docId ↔ chunkUid` mapping artifact for the build (and ensure it is discoverable via `pieces/manifest.json`).
  - [ ] Emit a `fileId ↔ normalizedRelPath` mapping artifact (so downstream systems do not rely on raw paths).
  - Touchpoints (expected): artifact writers under `src/index/build/artifacts/writers/`, manifest in `pieces/manifest.json`.
- [ ] Fail closed on missing identity
  - [ ] After adapters/normalization, `chunkUid` must never be null/empty.
  - [ ] Builders and SQLite ingestion must reject any row missing `chunkUid` (or the canonical chunk identity field) with actionable diagnostics.
  - Touchpoints (expected): `src/index/build/*` writers, `src/storage/sqlite/build/from-artifacts.js`, `src/index/validate.js`.

#### Tests
- [ ] `tests/identity/chunkuid-stability-line-shift.test.js`
  - Rebuild fixture where chunks shift lines but text span is identical; assert `chunkUid` values remain unchanged.
- [ ] `tests/identity/docid-chunkuid-mapping-emitted.test.js`
  - Build fixture; assert mapping artifacts exist, are referenced in `pieces/manifest.json`, and are internally consistent.
- [ ] `tests/validate/chunkuid-required.test.js`
  - Tamper an artifact row to remove `chunkUid`; strict validate (and/or SQLite ingestion) fails with a clear error.

### 9.2 Canonical symbol identity types + `SymbolRef` contract (no more `file::name` joins)
- [ ] Define and document canonical symbol identity types and when to use each
  - [ ] `chunkId`: range-specific deterministic identifier for a chunk (keep existing helper behavior, but avoid using it as the cross-file join key when stability is required).
  - [ ] `symbolKey`: stable grouping key (namespaceKey + file/virtualPath + kind + qualifiedName/scope chain); signature-free by default to reduce churn.
  - [ ] `scopedId`: unique disambiguated identity derived from `symbolKey` plus a `signatureKey` (and optional container/anchor disambiguator).
  - [ ] `SymbolId`: upstream semantic ID when available (`scip:` / `lsif:`), with a deterministic fallback (`heur:`).
  - Touchpoints (expected): `docs/symbol-sources.md` and/or public artifact contract docs, `src/index/chunk-id.js`, `src/index/type-inference-crossfile/symbols.js`.
- [ ] Implement per-language `signatureKey` normalization + hashing
  - [ ] Normalize signature strings deterministically and hash into `signatureKey = "sha1:" + sha1(normalizedSignature)` when available.
  - [ ] Treat `signatureKey` as a secondary disambiguator (not part of `symbolKey`).
  - Touchpoints (expected): language-specific normalization helpers, `src/index/type-inference-crossfile/*`.
- [ ] Define a versioned `SymbolRef` envelope usable across graphs, maps, and retrieval
  - [ ] Schema includes identity fields (`SymbolId`/`scopedId`/`symbolKey`), location anchors (file/virtualPath + range), human label, kind, and evidence.
  - [ ] Include explicit resolution state: `resolved | ambiguous | unresolved`, and carry candidate lists for ambiguous cases.
  - [ ] Use truncation metadata for any capped symbol expansion surface.
  - Touchpoints (expected): `src/index/build/graphs.js`, `src/map/build-map.js`, retrieval output shaping.

#### Tests
- [ ] `tests/contracts/identity-types-documented.test.js`
  - Assert contract docs describe `symbolKey`, `scopedId`, and `SymbolId` prefixes.
- [ ] `tests/identity/signaturekey-normalization.test.js`
  - Same signature normalizes to the same hash; semantically different signatures yield different hashes.
- [ ] `tests/symbols/symbolref-envelope-shape.test.js`
  - Validate emitted `SymbolRef` objects include required versioned fields and resolution state.

### 9.3 Collision-safe cross-file inference + tooling-backed typing parity + argMap propagation
- [ ] Replace collision-prone `file::name` indexing in cross-file inference
  - [ ] Use `chunkUid` and/or `symbolKey` as the primary join keys.
  - [ ] When multiple chunks map to the same `symbolKey`, compute deterministic disambiguators and expose `scopedId`.
  - [ ] Update `resolveUniqueSymbol` to return explicit ambiguous/unresolved results (not a silent null) so downstream steps can preserve uncertainty.
  - Touchpoints (expected): `src/index/type-inference-crossfile/pipeline.js`, `src/index/type-inference-crossfile/symbols.js`, `src/index/type-inference-crossfile/extract.js`.
- [ ] Normalize tooling type output to a single internal representation
  - [ ] Define canonical `TypeEntry` representation: `{ type, confidence, source, evidence? }`.
  - [ ] Update providers to emit/normalize into `TypeEntry` consistently.
  - Touchpoints (expected): `src/index/tooling/typescript-provider.js`, `src/index/tooling/pyright-provider.js`, `src/index/tooling/clangd-provider.js`, `src/index/tooling/sourcekit-provider.js`, `src/index/metadata-v2.js`.
- [ ] Implement cross-file argMap propagation using call evidence
  - [ ] Use callsite args + callee parameter names/types to infer parameter types from caller argument types.
  - [ ] Add depth/cycle caps and deterministic tie-breaking to avoid runaway propagation.
  - [ ] Ensure call evidence contains argument ranges/text and is emitted deterministically (use callDetails and/or callsites artifact surface, as available).
  - Touchpoints (expected): `src/index/type-inference-crossfile/*`, relations/callsites producers from Phase 6, `src/index/metadata-v2.js` finalization.
- [ ] Ensure meta construction occurs after enrichment (no drift)
  - [ ] Ensure identity/type inference results are applied before `metaV2` is finalized and written.
  - [ ] If finalization must occur earlier for streaming, persist interim identity/type fields and apply a deterministic “finalization pass” before promotion.

#### Tests
- [ ] `tests/inference/collision-safe-grouping.test.js`
  - Fixture with two same-named symbols in different scopes; assert both survive and do not collapse.
- [ ] `tests/inference/resolveUniqueSymbol-ambiguity.test.js`
  - Ambiguous resolution yields an explicit ambiguous result and does not crash downstream.
- [ ] `tests/type-inference/typeentry-normalization.test.js`
  - Provider outputs normalize into `TypeEntry` consistently (shape + confidence bounds).
- [ ] `tests/type-inference/argmap-propagation.test.js`
  - Two-file fixture: caller passes a string to a callee parameter; assert callee `metaV2.inferredTypes.params` includes string.
- [ ] `tests/metadata/metav2-finalization-includes-enrichments.test.js`
  - Assert `metaV2` includes identity + inferred type fields produced by enrichment passes.

### 9.4 Emit symbol artifacts and use identity in graphs, maps, and retrieval context expansion
- [ ] Emit first-class public symbol artifacts (JSONL + `.meta.json`)
  - [ ] `symbols`: one row per canonical symbol (`SymbolId`, `symbolKey`, `scopedId`, label, kind, anchor).
  - [ ] `symbol_occurrences`: one row per occurrence (def/ref/import/call) with `chunkUid/chunkId`, file/range, and link back to `symbols`.
  - [ ] `symbol_edges`: identity-based symbol graph (calls/overrides/imports/references) expressed as edges between `SymbolId` or `scopedId`.
  - [ ] List artifacts in `pieces/manifest.json` and add required-key validation for each.
  - [ ] Enforce deterministic ordering (stable sort by `(file, range)` and/or `(symbolKey, occurrenceKind)`).
  - Touchpoints (expected): `src/shared/artifact-io.js`, artifact writers, `src/index/validate.js`.
- [ ] Upgrade graph building to prefer canonical identity and preserve uncertainty
  - [ ] Use `SymbolRef` for source/target on edges.
  - [ ] Do not guess on collisions; emit unresolved/ambiguous edges with candidates and evidence.
  - [ ] Ensure `graph_relations` (and any derived graph artifacts) use canonical identities rather than `file::name` joins.
  - Touchpoints (expected): `src/index/build/graphs.js`, `src/index/build/indexer/steps/relations.js`, language relation builders under `src/lang/*`.
- [ ] Add opt-in symbol neighborhood expansion to retrieval
  - [ ] When a query hits a symbol-like chunk, optionally expand context with a bounded neighborhood (definition + references + callers/callees).
  - [ ] Enforce caps (max symbols/edges/chunks) and surface truncation metadata.
  - [ ] Provide an opt-in “symbol context pack” API surface returning `{ symbols, occurrences, edges, chunks }`.
  - Touchpoints (expected): `src/retrieval/context-expansion.js`, API surface (CLI/server) as applicable.
- [ ] Update map builders/clients to key nodes by canonical identity
  - [ ] Prefer `SymbolId/scopedId` (or `chunkUid` fallback) for map node identity.
  - Touchpoints (expected): `src/map/build-map.js` and any map data model used by clients.

#### Tests
- [ ] `tests/symbols/artifacts-emitted.test.js`
  - Build fixture; assert symbol artifacts are present and listed in the manifest.
- [ ] `tests/symbols/referential-integrity.test.js`
  - Assert every occurrence references an existing symbol (or is explicitly unresolved).
- [ ] `tests/symbols/deterministic-order.test.js`
  - Build twice; assert stable ordering (or stable sorted equivalence) for symbol artifacts.
- [ ] `tests/retrieval/symbol-context-expansion.test.js`
  - Query a symbol; assert returned context includes its definition and at least one reference/callsite chunk.
- [ ] `tests/retrieval/symbol-context-expansion-caps.test.js`
  - Construct many references; assert expansion caps apply and truncation metadata is present.

### 9.5 Strict validation for identity collisions and symbol artifact integrity
- [ ] Add strict validation for identity collision classes
  - [ ] Detect `symbolKey` collisions that cannot be disambiguated and fail with actionable diagnostics (include colliding chunks/files).
  - [ ] Validate that all symbol edges reference valid symbols (or are explicitly unresolved with evidence).
  - [ ] Validate symbol occurrence ranges reference valid chunks/files and are in-bounds.
  - Touchpoints (expected): `src/index/validate.js`.
- [ ] Enforce “fail closed” invariants for identity-dependent artifacts
  - [ ] Symbol artifacts and graphs must not silently drop or mis-link due to collisions.
  - [ ] Any missing required identity field in strict mode fails validation before promotion.

#### Tests
- [ ] `tests/validate/symbol-collision-detected.test.js`
  - Fixture with intentionally colliding symbol keys; strict validate fails and reports both sources.
- [ ] `tests/validate/symbol-edges-integrity.test.js`
  - Remove a referenced symbol row; strict validate fails.
- [ ] `tests/validate/symbol-occurrence-range-integrity.test.js`
  - Tamper an occurrence range; strict validate fails with an actionable message.

---

## Phase 10 — Interprocedural Risk Flows (taint summaries + propagation)

### Objective
Deliver cross-file, explainable taint-to-sink risk flows by (1) generating per-symbol taint summaries (inputs/outputs/sanitizers/sinks) and (2) propagating those summaries across a call graph to emit path-level flow artifacts and retrieval/CLI surfacing, with deterministic output, strict caps, and contract-safe metadata.

- Depends on prior phases that establish **canonical symbol identity** and **cross-file call linking**.
- When risk-flow path artifacts are disabled, the system must remain backward-compatible with existing local risk detection and optional one-hop cross-file correlation.

---

### 10.1 Contracts, configuration, and rule-model upgrades

- [ ] Define canonical **data contracts** for:
  - [ ] Per-symbol risk/taint summary (`RiskSummary`)
  - [ ] Interprocedural flow path record (`RiskFlow`)
  - [ ] Call-site evidence record (`CallSiteEvidence`)
  - [ ] Aggregated stats (`RiskFlowStats`)
  - Notes:
    - Include `version` and `generatedAt` fields for each artifact (or for each manifest entry), and a `caps`/`limits` structure to make truncation explicit.
    - Require stable identifiers (`symbolId`, `chunkId`, and `file`) and specify how they are derived (canonical identity contract).

- [ ] Choose canonical artifact names and formats (primary + optional):
  - [ ] `risk_summaries.jsonl` (JSONL; one summary per symbol)
  - [ ] `risk_flows.jsonl` (JSONL; one record per discovered source→sink path)
  - [ ] `risk_flow_stats.json` (JSON object)
  - [ ] Optional (only if needed for downstream UI/graph ops): `risk_flow_graph.jsonl` (edge list derived from paths)
  - Notes:
    - Prefer path JSONL + optional edge list over adjacency-heavy graphs.
    - Enforce per-line size limits via **final byte-size checks** before write (no heuristic-only planning).

- [ ] Define canonical **in-chunk representation** used by retrieval/filtering without loading full flow artifacts:
  - [ ] `chunk.docmeta.risk.summary` (authoritative runtime data)
  - [ ] `chunk.metaV2.risk.summary` (serialized view; must reflect final-state mutations)
  - Notes:
    - Keep this summary compact (for chunk_meta), while retaining full fidelity in `risk_summaries.jsonl`.

- [ ] Add/standardize configuration keys:
  - [ ] `indexing.riskInterprocedural.enabled` (boolean; default false)
  - [ ] `indexing.riskInterprocedural.emitArtifacts` (`"none" | "jsonl"`; default `"jsonl"` when enabled)
  - [ ] `indexing.riskInterprocedural.summaryOnly` (boolean; compute summaries but skip propagation)
  - [ ] Caps/limits:
    - [ ] `maxDepth` (default 4)
    - [ ] `maxPaths` (default 200)
    - [ ] `maxEdges` (default 5000)
    - [ ] `maxMs` (default 75)
  - Notes:
    - Preserve the existing `indexing.riskAnalysis` / `indexing.riskAnalysisCrossFile` behavior as legacy mode unless explicitly replaced.

- [ ] Upgrade the risk-rule model to support interprocedural semantics:
  - [ ] Add explicit “propagation semantics” fields where needed (e.g., sanitizer categories, optional propagators)
  - [ ] Update `docs/risk-rules.md` to document new fields and how they affect summaries/propagation

- [ ] Harden risk-rule normalization/compilation to avoid silent drops and “empty rule” footguns:
  - [ ] Emit diagnostics when a regex pattern fails to compile
  - [ ] Drop any rule that compiles to zero usable patterns (do not keep “empty shells”)
  - [ ] Record rule provenance + compilation warnings in the bundle output (or runtime logs in non-test)

#### Tests
- [ ] Unit: invalid regex patterns produce diagnostics; rules with zero compiled patterns are excluded.
- [ ] Unit: rule bundle merge precedence (defaults vs rulesPath vs inline rules) is deterministic.
- [ ] Contract: JSON schema/required-key checks for `RiskSummary`, `RiskFlow`, and `CallSiteEvidence` (fixtures validate).

---

### 10.2 Per-symbol taint summaries (local analysis → callable summary)

- [ ] Implement a summary builder that converts existing local risk signals + lightweight flow hints into per-callable summaries:
  - [ ] Create `src/index/risk-flows/summaries.js` (or equivalent) exporting `buildRiskSummaries({ chunks, riskRules, caps, identity })`.
  - [ ] For each callable symbol chunk (function/method/ctor/lambda as available), compute:
    - [ ] `sources[]` (source rule hits, categories/tags/confidence)
    - [ ] `sinks[]` (sink rule hits, categories/severity/tags/confidence)
    - [ ] `sanitizers[]` (sanitizer rule hits)
    - [ ] `outputs`:
      - [ ] `returnsTainted` (boolean)
      - [ ] `taintedParams[]` (params that can carry taint into the function)
      - [ ] Optional: `taintedFields[]` (e.g., `this.*` writes / known global writes, when detectable)
    - [ ] `evidence` entries sufficient to justify summary fields without bloating chunk_meta (line numbers + hashes, capped)
    - [ ] `limits` structure indicating capping/truncation and reason
  - Notes:
    - Start conservative: if evidence is insufficient, prefer “unknown” over “incorrectly tainted”.
    - Keep summaries deterministic (stable sorting for lists; stable selection for capped evidence).

- [ ] Fix parameter/return contract hazards that would corrupt summaries or propagation inputs:
  - [ ] Normalize `docmeta.params` into a **positional parameter contract** usable across languages.
    - [ ] Ensure destructured parameters do not explode into unstable keys that break arg→param mapping.
      - [ ] Store destructured params as positional placeholders (e.g., `arg0`, `arg1`) and (optionally) track binding names separately.
  - [ ] Normalize `docmeta.returns` to strings at extraction time:
    - [ ] Accept common object shapes (e.g., `{ type: "T" }`, `{ returnType: "T" }`) and ignore non-strings otherwise.
  - [ ] Ensure inferred-type extraction does not emit `[object Object]` / non-string values.

- [ ] Attach the compact summary into each chunk’s metadata:
  - [ ] `chunk.docmeta.risk.summary = ...`
  - [ ] `chunk.metaV2.risk.summary = ...` (but only after metaV2 is finalized post-enrichment)

#### Tests
- [ ] Unit: summary extraction for a simple function that reads a source (e.g., request input) and hits a sink emits `sources[]`, `sinks[]`, and meaningful `outputs`.
- [ ] Unit: destructured parameters do not misalign arg→param mapping (positional placeholders preserved).
- [ ] Unit: return type extraction ignores non-string entries and normalizes object-shaped returns.
- [ ] Determinism: repeated summary builds over the same fixture produce byte-identical JSONL output.

---

### 10.3 Call-site evidence and call-edge sampling (enable explainable paths)

- [ ] Extend language relation extraction to capture call-site coordinates suitable for explainability:
  - [ ] JavaScript: include `{ startLine, endLine, startCol, endCol }` on `callDetails` entries.
  - [ ] Python (and other languages as available): include equivalent line/column fields when parsers provide them.
  - [ ] Add a snippet strategy:
    - [ ] Store a short, capped snippet OR a stable `snippetHash` + optional preview.
    - [ ] Ensure the snippet strategy cannot exceed JSONL per-line limits.

- [ ] Replace “over-aggressive dedupe” in cross-file call evidence:
  - [ ] Keep `callLinks` as a deduped edge set (caller→callee).
  - [ ] Treat call-site evidence as a bounded sample keyed by location (caller, callee, file, startLine/startCol).
  - [ ] Preserve multiple distinct call sites (up to cap) rather than collapsing them into one.

- [ ] Emit an optional `call_sites.jsonl` artifact when risk-flow artifacts are enabled:
  - [ ] Each entry should include:
    - [ ] `from` / `to` (symbol IDs)
    - [ ] `file`, `startLine`, `endLine` (and columns when available)
    - [ ] `argsSummary` (bounded; no raw code blobs)
    - [ ] `snippetHash` (preferred) and optional snippet preview
  - Notes:
    - Call-site evidence must be deterministic (stable sampling order and keys).

#### Tests
- [ ] Unit: JS callDetails include stable line/column coordinates for a known fixture.
- [ ] Integration: call-site evidence sampling retains multiple distinct call sites for the same edge (up to cap).
- [ ] Size guard: a pathological call site cannot produce a JSONL entry exceeding configured limits.

---

### 10.4 Interprocedural propagation engine (summaries + call graph → risk_flows)

- [ ] Implement propagation across the call graph using summaries:
  - [ ] Create `src/index/risk-flows/propagate.js` exporting `propagateRiskFlows({ summaries, callLinks, callSites, rules, caps })`.
  - [ ] Model taint propagation at the summary level:
    - [ ] Source introduction (direct sources in a symbol)
    - [ ] Sink reachability (direct sinks in a symbol)
    - [ ] Sanitizer influence (reduce or terminate propagation, depending on rule semantics)
    - [ ] Param→output effects and return-taint effects
  - [ ] Produce `risk_flows.jsonl` records containing:
    - [ ] `from` / `to` (symbol IDs)
    - [ ] `source` (rule reference + category)
    - [ ] `sink` (rule reference + category/severity)
    - [ ] `path[]` (symbol ID chain)
    - [ ] `depth`
    - [ ] `confidence` (0..1)
    - [ ] `callSites[]` (bounded evidence along the path, if available)
    - [ ] `notes[]` (e.g., truncation/capping signals)
  - Notes:
    - Handle cycles safely (visited sets + depth cap; no infinite loops).
    - Enforce caps (`maxDepth`, `maxPaths`, `maxEdges`, `maxMs`) and make truncation explicit.
    - Output must be deterministic (stable adjacency ordering, tie-breakers, and capped selection).

- [ ] Emit `risk_flow_stats.json`:
  - [ ] Total summaries, total flows, unique sources/sinks/categories
  - [ ] Max depth observed, caps hit counts, runtime duration

- [ ] Optional: emit `risk_flow_graph.jsonl` as an edge list derived from paths (only if downstream consumers need it).

#### Tests
- [ ] Unit: multi-hop propagation produces the expected `path[]` and `depth`, with bounded evidence.
- [ ] Unit: sanitizer on a path reduces confidence (or terminates), per configured semantics.
- [ ] Unit: cyclic call graphs terminate under caps and emit truncation notes.
- [ ] Determinism: identical fixtures produce identical `risk_flows.jsonl` ordering/content across runs.

---

### 10.5 Indexing pipeline integration, metaV2 finalization, and artifact writing

- [ ] Integrate risk summaries and propagation into the indexing pipeline:
  - [ ] Update `src/index/build/indexer/steps/relations.js` (or a new step adjacent to it) to run:
    - [ ] Cross-file call linking first (call graph + call-site evidence assembly)
    - [ ] `buildRiskSummaries(...)`
    - [ ] `propagateRiskFlows(...)` (if not `summaryOnly`)

- [ ] Fix cross-file inference gating so risk correlation/flows do not accidentally enable type inference:
  - [ ] When cross-file work is triggered only for risk, ensure type inference is not executed unless explicitly enabled.

- [ ] Fix “metaV2 drift” caused by enrichment passes mutating docmeta/relations after metaV2 was built:
  - [ ] Ensure metaV2 is constructed from **final-state** chunk/docmeta right before serialization.
  - [ ] Prefer a single “finalize metaV2” pass after all enrichment mutations (call links, inferred types, risk summaries, etc.).

- [ ] Add new artifact writers and manifest entries:
  - [ ] Update `src/index/build/artifacts.js` to write:
    - [ ] `risk_summaries.jsonl` (sharded)
    - [ ] `risk_flows.jsonl` (sharded)
    - [ ] `risk_flow_stats.json`
    - [ ] optional `call_sites.jsonl` and `risk_flow_graph.jsonl`
  - [ ] Update `src/shared/artifact-io.js` to:
    - [ ] Recognize/load new artifacts via manifest
    - [ ] Add JSONL required keys for the new artifact types
  - [ ] Ensure per-entry byte-size checks are enforced at write-time, with truncation strategies for verbose fields.

#### Tests
- [ ] Integration: enabling interprocedural risk flows produces all configured risk artifacts and includes them in the pieces manifest.
- [ ] Regression: chunk_meta metaV2 reflects post-enrichment relations and risk summary fields (no stale serialization).
- [ ] Config: enabling risk interprocedural features does not activate type inference unless requested.

---

### 10.6 Validation and retrieval/UX surfacing

- [ ] Extend index validation to cover new artifacts:
  - [ ] Update `src/index/validate.js` to validate:
    - [ ] `risk_summaries.jsonl` required keys, confidence bounds, and referential integrity
    - [ ] `risk_flows.jsonl` path integrity (`depth` vs path length), referential integrity, capped notes
    - [ ] `call_sites.jsonl` location validity and referential integrity
    - [ ] `risk_flow_stats.json` internal consistency (counts match or are explainably capped)
  - [ ] Ensure `tools/index-validate.js --strict` fails on broken risk artifacts when present.

- [ ] Add retrieval/CLI surfacing for risk summaries and flows:
  - [ ] Add an option to display `risk.summary` in result output (compact and deterministic).
  - [ ] Add an option to expand and render interprocedural flows for a selected chunk/symbol when `risk_flows.jsonl` is present.
  - [ ] Add basic filtering controls (by sink category/severity, minimum confidence).
  - Notes:
    - If risk artifacts are absent, fall back to existing local `docmeta.risk` display.

- [ ] Documentation:
  - [ ] Add `docs/artifacts/risk_flows.md` covering artifact semantics, schemas, and caps.
  - [ ] Update `docs/risk-rules.md` to reflect new rule semantics.
  - [ ] Update `docs/config.md` (or equivalent) to document new `indexing.riskInterprocedural.*` keys and legacy behavior.

#### Tests
- [ ] Validation: fixture index with risk artifacts passes `index-validate --strict`.
- [ ] CLI: smoke test renders risk summary and (when enabled) at least one multi-hop flow with call-site evidence.
- [ ] Backward compatibility: disabling interprocedural risk flows preserves current output semantics.

---


## Phase 19 — LibUV threadpool utilization (explicit control + docs + tests)

  **Objective:** Make libuv threadpool sizing an explicit, validated, and observable runtime control so PairOfCleats I/O concurrency scales predictably across platforms and workloads.

  ### 19.1 Audit: identify libuv-threadpool-bound hot paths and mismatch points

  * [ ] Audit all high-volume async filesystem call sites (these ultimately depend on libuv threadpool behavior):
    * [ ] `src/index/build/file-processor.js` (notably `runIo(() => fs.stat(...))`, `runIo(() => fs.readFile(...))`)
    * [ ] `src/index/build/file-scan.js` (`fs.open`, `handle.read`)
    * [ ] `src/index/build/preprocess.js` (file sampling + `countLinesForEntries`)
    * [ ] `src/shared/file-stats.js` (stream-based reads for line counting)
  * [ ] Audit concurrency derivation points where PairOfCleats may exceed practical libuv parallelism:
    * [ ] `src/shared/threads.js` (`ioConcurrency = ioBase * 4`, cap 32/64)
    * [ ] `src/index/build/runtime/workers.js` (`createRuntimeQueues` pending limits)
  * [ ] Decide and record the intended precedence rules for threadpool sizing:
    * [ ] Whether PairOfCleats should **respect an already-set `UV_THREADPOOL_SIZE`** (recommended, matching existing `NODE_OPTIONS` behavior where flags aren’t overridden if already present).

  ### 19.2 Add a first-class runtime setting + env override

  * [ ] Add config key (new):
    * [ ] `runtime.uvThreadpoolSize` (number; if unset/invalid => no override)
  * [ ] Add env override (new):
    * [ ] `PAIROFCLEATS_UV_THREADPOOL_SIZE` (number; same parsing rules as other numeric env overrides)
  * [ ] Implement parsing + precedence:
    * [ ] Update `src/shared/env.js`
      * [ ] Add `uvThreadpoolSize: parseNumber(env.PAIROFCLEATS_UV_THREADPOOL_SIZE)`
    * [ ] Update `tools/dict-utils.js`
      * [ ] Extend `getRuntimeConfig(repoRoot, userConfig)` to resolve `uvThreadpoolSize` with precedence:
        * `userConfig.runtime.uvThreadpoolSize` → else `envConfig.uvThreadpoolSize` → else `null`
      * [ ] Clamp/normalize: floor to integer; require `> 0`; else `null`
      * [ ] Update the function’s return shape and JSDoc:
        * from `{ maxOldSpaceMb, nodeOptions }`
        * to `{ maxOldSpaceMb, nodeOptions, uvThreadpoolSize }`

  ### 19.3 Propagate `UV_THREADPOOL_SIZE` early enough (launcher + spawned scripts)

  * [ ] Update `bin/pairofcleats.js` (critical path)
    * [ ] In `runScript()`:
      * [ ] Resolve `runtimeConfig` as today.
      * [ ] Build child env as an object (don’t pass `process.env` by reference when you need to conditionally add keys).
      * [ ] If `runtimeConfig.uvThreadpoolSize` is set and `process.env.UV_THREADPOOL_SIZE` is not set, add:
        * [ ] `UV_THREADPOOL_SIZE = String(runtimeConfig.uvThreadpoolSize)`
      * [ ] (Optional) If `--verbose` or `PAIROFCLEATS_VERBOSE`, log a one-liner showing the chosen `UV_THREADPOOL_SIZE` for the child process.
  * [ ] Update other scripts that spawn Node subcommands and already apply runtime Node options, so they also carry the threadpool sizing consistently:
    * [ ] `tools/setup.js` (`buildRuntimeEnv()`)
    * [ ] `tools/bootstrap.js` (`baseEnv`)
    * [ ] `tools/ci-build-artifacts.js` (`baseEnv`)
    * [ ] `tools/bench-language-repos.js` (repo child env)
    * [ ] `tests/bench.js` (bench child env when spawning search/build steps)
    * [ ] `tools/triage/context-pack.js`, `tools/triage/ingest.js` (where `resolveNodeOptions` is used)
    * Implementation pattern: wherever you currently do `{ ...process.env, NODE_OPTIONS: resolvedNodeOptions }`, also conditionally set `UV_THREADPOOL_SIZE` from `runtimeConfig.uvThreadpoolSize` if not already present.

  > (Optional refactor, if you want to reduce repetition): add a helper in `tools/dict-utils.js` like `resolveRuntimeEnv(runtimeConfig, baseEnv)` and migrate the call sites above to use it.

  ### 19.4 Observability: surface “configured vs effective” values

  * [ ] Update `tools/config-dump.js`
    * [ ] Include in `payload.derived.runtime`:
      * [ ] `uvThreadpoolSize` (configured value from `getRuntimeConfig`)
      * [ ] `effectiveUvThreadpoolSize` (from `process.env.UV_THREADPOOL_SIZE` or null/undefined if absent)
  * [ ] Add runtime warnings in indexing startup when mismatch is likely:
    * [ ] Update `src/index/build/runtime/workers.js` (in `resolveThreadLimitsConfig`, verbose mode is already supported)
      * [ ] Compute `effectiveUv = Number(process.env.UV_THREADPOOL_SIZE) || null`
      * [ ] If `effectiveUv` is set and `ioConcurrency` is materially larger, emit a single warning suggesting alignment.
      * [ ] If `effectiveUv` is not set, consider a *non-fatal* hint when `ioConcurrency` is high (e.g., `>= 16`) and `--verbose` is enabled.
  * [ ] (Services) Emit one-time startup info in long-running modes:
    * [ ] `tools/api-server.js`
    * [ ] `tools/indexer-service.js`
    * [ ] `tools/mcp-server.js`
    * Log: effective `UV_THREADPOOL_SIZE`, and whether it was set by PairOfCleats runtime config or inherited from the environment.

  ### 19.5 Documentation updates

  * [ ] Update env overrides doc:
    * [ ] `docs/env-overrides.md`
      * [ ] Add `PAIROFCLEATS_UV_THREADPOOL_SIZE`
      * [ ] Explicitly note: libuv threadpool size must be set **before the Node process starts**; PairOfCleats applies it by setting `UV_THREADPOOL_SIZE` in spawned child processes (via `bin/pairofcleats.js` and other tool launchers).
  * [ ] Update config docs:
    * [ ] `docs/config-schema.json` add `runtime.uvThreadpoolSize`
    * [ ] `docs/config-inventory.md` add `runtime.uvThreadpoolSize (number)`
    * [ ] `docs/config-inventory.json` add entry for `runtime.uvThreadpoolSize`
  * [ ] Update setup documentation:
    * [ ] `docs/setup.md` add a short “Performance tuning” note:
      * [ ] When indexing large repos or using higher `--threads`, consider setting `runtime.uvThreadpoolSize` (or `PAIROFCLEATS_UV_THREADPOOL_SIZE`) to avoid libuv threadpool becoming the limiting factor.
  * [ ] (Optional) Add a benchmark note:
    * [ ] `docs/benchmarks.md` mention that benchmarking runs should control `UV_THREADPOOL_SIZE` for reproducibility.

  ### 19.6 Tests: schema validation + env propagation

  * [ ] Update config validation tests:
    * [ ] `tests/config-validate.js` ensure `runtime.uvThreadpoolSize` is accepted by schema validation.
  * [ ] Add a focused propagation test:
    * [ ] New: `tests/uv-threadpool-env.js`
      * [ ] Create a temp repo dir with a `.pairofcleats.json` that sets `runtime.uvThreadpoolSize`.
      * [ ] Run: `node bin/pairofcleats.js config dump --json --repo <temp>`
      * [ ] Assert:
        * `payload.derived.runtime.uvThreadpoolSize` matches the config
        * `payload.derived.runtime.effectiveUvThreadpoolSize` matches the propagated env (or check `process.env.UV_THREADPOOL_SIZE` if you expose it directly in the dump)
  * [ ] Add a non-override semantics test (if that’s the decided rule):
    * [ ] New: `tests/uv-threadpool-no-override.js`
      * [ ] Set parent env `UV_THREADPOOL_SIZE=…`
      * [ ] Also set config `runtime.uvThreadpoolSize` to a different value
      * [ ] Assert child sees the parent value (i.e., wrapper respects existing env)

  **Exit criteria**

  * [ ] `runtime.uvThreadpoolSize` is in schema + inventory and validated by `tools/validate-config.js`.
  * [ ] `pairofcleats …` launches propagate `UV_THREADPOOL_SIZE` to child processes when configured.
  * [ ] Users can confirm configured/effective behavior via `pairofcleats config dump --json`.
  * [ ] Docs clearly explain when and how the setting applies.

---

## Phase 20 — Threadpool-aware I/O scheduling guardrails

  **Objective:** Reduce misconfiguration risk by aligning PairOfCleats internal I/O scheduling with the effective libuv threadpool size and preventing runaway pending I/O buildup.

  ### 20.1 Add a “threadpool-aware” cap option for I/O queue sizing

  * [ ] Add config (optional, but recommended if you want safer defaults):
    * [ ] `indexing.ioConcurrencyCap` (number) **or** `runtime.ioConcurrencyCap` (number)
    * Choose the namespace based on your ownership map (`docs/config-inventory-notes.md` suggests runtime is `tools/dict-utils.js`, indexing is build runtime).
  * [ ] Implement in:
    * [ ] `src/shared/threads.js` (preferred, because it’s the canonical concurrency resolver)
      * [ ] After computing `ioConcurrency`, apply:
        * `ioConcurrency = min(ioConcurrency, ioConcurrencyCap)` when configured
        * (Optional) `ioConcurrency = min(ioConcurrency, effectiveUvThreadpoolSize)` when a new boolean is enabled, e.g. `runtime.threadpoolAwareIo === true`
    * [ ] `src/index/build/runtime/workers.js`
      * [ ] Adjust `maxIoPending` to scale from the *final* `ioConcurrency`, not the pre-cap value.

  ### 20.2 Split “filesystem I/O” from “process I/O” (optional, higher impact)

  If profiling shows git/tool subprocess work is being unnecessarily throttled by a threadpool-aware cap:

  * [ ] Update `src/shared/concurrency.js` to support two queues:
    * [ ] `fs` queue (bounded by threadpool sizing)
    * [ ] `proc` queue (bounded separately)
  * [ ] Update call sites:
    * [ ] `src/index/build/file-processor.js`
      * [ ] Use `fsQueue` for `fs.stat`, `fs.readFile`, `fs.open`
      * [ ] Use `procQueue` for `getGitMetaForFile` (and any other spawn-heavy steps)
    * [ ] `src/index/build/runtime/workers.js` and `src/index/build/indexer/steps/process-files.js`
      * [ ] Wire new queues into runtime and shard runtime creation.

  ### 20.3 Tests + benchmarks

  * [ ] Add tests that validate:
    * [ ] Caps are applied deterministically
    * [ ] Pending limits remain bounded
    * [ ] No deadlocks when both queues exist
  * [ ] Update or add a micro-benchmark to show:
    * [ ] Throughput difference when `UV_THREADPOOL_SIZE` and internal `ioConcurrency` are aligned vs misaligned.

  **Exit criteria**

  * [ ] Internal I/O concurrency cannot silently exceed intended caps.
  * [ ] No regression in incremental/watch mode stability.
  * [ ] Benchmarks show either improved throughput or reduced memory/queue pressure (ideally both).

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
  - [ ] Several arrays are produced via Set insertion order (e.g., `annotations`, `params`, `risk.tags`, `risk.categories`). While *often* stable, they can drift if upstream traversal order changes.
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
  - [ ] `createLspClient().request()` can leave pending requests forever if a caller forgets to supply `timeoutMs` (pending map leak). Current provider code *usually* supplies a timeout, but this is not enforced.
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

  * [ ] Add `@modelcontextprotocol/sdk` dependency
  * [ ] Decide migration strategy:
    * [ ] **Option A (recommended):** keep `tools/mcp-server.js` as the entrypoint, but implement server via SDK and keep legacy behind a flag
    * [ ] Option B: replace legacy entirely (higher risk)

  ### 24.2 Implement SDK-based server

  * [ ] Add `src/integrations/mcp/sdk-server.js` (or similar):
    * [ ] Register tools from `src/integrations/mcp/defs.js`
    * [ ] Dispatch calls to existing handlers in `tools/mcp/tools.js` (or migrate handlers into `src/` cleanly)
    * [ ] Preserve progress notifications semantics expected by `tests/mcp-server.js`:
      * [ ] `notifications/progress`
      * [ ] Include `{ tool: 'build_index', phase, message }` fields (match current tests)
  * [ ] Update `tools/mcp-server.js`:
    * [ ] If `mcp.transport=legacy` or env forces legacy → use current transport
    * [ ] Else → use SDK transport

  ### 24.3 Remove or isolate legacy transport surface area

  * [ ] Keep `tools/mcp/transport.js` for now, but:
    * [ ] Move to `tools/mcp/legacy/transport.js`
    * [ ] Update imports accordingly
    * [ ] Reduce churn risk while you validate parity

  ### 24.4 Tests

  * [ ] Ensure these existing tests continue to pass without rewriting expectations unless protocol mandates it:
    * [ ] `tests/mcp-server.js`
    * [ ] `tests/mcp-robustness.js`
    * [ ] `tests/mcp-schema.js`
  * [ ] Add `tests/mcp-transport-selector.js`:
    * [ ] Force `PAIROFCLEATS_MCP_TRANSPORT=legacy` and assert legacy path still works
    * [ ] Force `...=sdk` and assert SDK path works
  * [ ] Add script-coverage action(s)

---

  ### 24.5 API/MCP contract formalization (from Unified Roadmap)

  * [ ] Add minimal OpenAPI coverage for API server routes (focus on search/status/map)
  * [ ] Add JSON Schemas for MCP tool responses (align with `src/integrations/mcp/defs.js`)
  * [ ] Add conformance tests that assert CLI/API/MCP return semantically consistent results:
    * [ ] same query yields compatible results across CLI, API server, and MCP tools
    * [ ] canonical flows: search, status, map export

## Phase 32 — Embeddings native load failures (ERR_DLOPEN_FAILED)

  * [ ] Investigate `ERR_DLOPEN_FAILED` from `build-embeddings` during build-index (Node v24); inspect crash log at `C:\Users\sneak\AppData\Local\PairOfCleats\repos\pairofcleats-codex-8c76cec86f7d\logs\index-crash.log`.
  * [ ] Determine which native module fails to load (onnxruntime/onnxruntime-node/etc.) and verify binary compatibility with current Node/OS; capture a minimal repro and fix path.
  * [x] Add a clear error message with module name + remediation hint (reinstall provider, switch provider alias, or disable embeddings) before exiting.
  * [x] If load failure persists, implement a safe fallback behavior (skip embeddings with explicit warning) so build-index completes.


---




