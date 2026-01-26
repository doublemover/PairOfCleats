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
- **Fail-closed identity/callsite joins:** in strict mode, missing caller/target chunkUid or ambiguous resolution never produces graph edges; no file::name fallback.

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


---

## Added detail (Phase 6 task mapping)

### 6.1 CallDetails v2 and call_sites contract
- Task: Define CallSite record shape (schema + caps + deterministic truncation)
  - Files to change/create:
    - src/contracts/schemas/artifacts.js (add call_sites + call_sites_meta near ARTIFACT_SCHEMA_DEFS around lines 282, 318, 559; reuse baseShardedJsonlMeta at ~162)
    - src/shared/artifact-io/jsonl.js (add required key list for call_sites at ~11-17)
    - src/shared/artifact-io/loaders.js (call_sites should use resolveJsonlRequiredKeys; no new loader needed if loadJsonArrayArtifact is used, but add required keys)
  - Call sites/line refs:
    - src/contracts/schemas/artifacts.js:162, 282, 318, 559
    - src/shared/artifact-io/jsonl.js:11-17
    - src/shared/artifact-io/loaders.js:150-205 (requiredKeys usage in loadJsonArrayArtifact)
  - Gaps/conflicts:
    - docs/artifact-schemas.md already lists call_sites, but schema registry lacks it (doc/code drift).
    - SPEC_risk_flows_and_call_sites_jsonl_v1_refined.md (Phase 10) defines call_sites fields; align naming now to avoid later rename churn.
- Task: Add schema validation for call_sites entries
  - Files to change/create:
    - src/index/validate.js (optionalArtifacts list around 76-95; add call_sites; add load/validate block similar to file_relations at 339-347)
    - src/index/validate/presence.js (hasLegacyArtifact path check at ~121-160)
  - Call sites/line refs:
    - src/index/validate.js:76-95, 339-347
    - src/index/validate/presence.js:121-160
  - Gaps/conflicts:
    - strict mode expects manifest entries; call_sites must be optional with clean fallback when missing.
- Task: Update documentation for contract
  - Files to change/create:
    - docs/artifact-contract.md (artifact inventory + examples)
    - docs/artifact-schemas.md (Phase 6 additions already mention call_sites; ensure field list is explicit)
    - docs/metadata-schema-v2.md (already notes call_sites at line ~138; ensure it stays “not in metaV2”)
  - Call sites/line refs:
    - docs/metadata-schema-v2.md:138
  - Gaps/conflicts:
    - docs/artifact-schemas.md references SPEC_risk_flows_and_call_sites_jsonl_v1_refined.md; ensure Phase 6 contract matches that spec’s required keys.
- Tests / Verification
  - Files to change/create:
    - tests/contracts/call-sites-schema.test.js (new; validate good + bad entries)
    - tests/jsonl-validation.js (add call_sites JSONL required-key failure case)
    - tests/sharded-meta-schema.test.js (ensure call_sites_meta validates SemVer + required fields)

### 6.2 Emit call_sites artifact (sharded JSONL + manifest)
- Task: Implement writer + manifest entry
  - Files to change/create:
    - src/index/build/artifacts/writers/call-sites.js (new; model after file-relations writer)
    - src/index/build/artifacts.js (enqueue writer near file_relations at ~380-401)
    - src/index/build/artifacts/compression.js (add call_sites to compressibleArtifacts list near line ~20)
  - Call sites/line refs:
    - src/index/build/artifacts.js:380-401
    - src/index/build/artifacts/writers/file-relations.js:57-153 (template for sharded JSONL)
    - src/index/build/artifacts/compression.js:16-33
- Task: Manifest-driven discovery + validator support
  - Files to change/create:
    - src/shared/artifact-io/manifest.js (no change if addPieceFile used correctly; verify manifest schema accepts new piece type/name)
    - src/index/validate.js + src/index/validate/presence.js (see 6.1)
    - src/shared/artifact-io/jsonl.js (required keys)
  - Call sites/line refs:
    - src/index/build/artifacts.js:173-188 (addPieceFile helper used by writer)
    - src/index/validate/presence.js:24-90 (meta schema validation)
- Task: Deterministic ordering + streaming write
  - Files to change/create:
    - src/index/build/artifacts/writers/call-sites.js (ensure stable sort before streaming; match shard ordering rules)
  - Call sites/line refs:
    - src/index/build/artifacts/writers/file-relations.js:104-147 (deterministic shards + meta)
- Tests / Verification
  - Files to change/create:
    - tests/artifact-formats.js (assert call_sites presence in manifest)
    - tests/perf/baseline-artifacts.test.js (ensure meta schemaVersion and counts)
    - tests/relations/call-sites-determinism.test.js (new; rebuild twice, compare JSONL)

### 6.3 JS + TS callsite extraction with structured args
- Task: Upgrade JS relations extraction
  - Files to change/create:
    - src/lang/javascript/relations.js (add calleeRaw/calleeNormalized/receiver, start/end, startLine/endLine; extend args)
  - Call sites/line refs:
    - src/lang/javascript/relations.js:329-337 (formatCallArg), 413-418 (callDetails push)
- Task: Upgrade TS extraction to AST-based call details
  - Files to change/create:
    - src/lang/typescript/relations.js (replace regex scan around 73-124 with Babel AST walk)
    - src/lang/babel-parser.js (TSX/JSX plugin selection at ~23-58)
  - Call sites/line refs:
    - src/lang/typescript/relations.js:73-124
    - src/lang/babel-parser.js:23-58
- Task: Align language registry output
  - Files to change/create:
    - src/index/language-registry/registry.js (buildChunkRelations callDetails join at ~689-694)
    - src/index/build/file-processor/relations.js (call index for caller; update if callerChunkUid replaces caller name)
  - Call sites/line refs:
    - src/index/language-registry/registry.js:689-694
    - src/index/build/file-processor/relations.js:1-24
- Tests / Verification
  - Files to change/create:
    - tests/relations/js-call-sites.test.js (new)
    - tests/relations/ts-call-sites.test.js (new; include TSX fixture)
    - tests/fixtures/languages/ (add JS + TS fixtures)

### 6.4 Segment-safe positions + deterministic ordering
- Task: Translate segment offsets to container offsets
  - Files to change/create:
    - src/index/segments.js (chunkSegments adjusts chunk offsets at ~90-140; ensure callsite extraction uses container offsets)
    - src/index/build/file-processor/relations.js (if callsite extraction runs on segment text, translate before writing)
  - Call sites/line refs:
    - src/index/segments.js:90-150
    - src/index/build/file-processor/relations.js:1-24
- Task: Correct segment language fidelity for JS/TS/TSX
  - Files to change/create:
    - src/index/segments/config.js (resolveSegmentExt at ~56-70; ensure tsx/jsx preserved)
    - src/index/build/file-processor/tree-sitter.js (resolveTreeSitterLanguageForSegment at ~27-45)
  - Call sites/line refs:
    - src/index/segments/config.js:56-75
    - src/index/build/file-processor/tree-sitter.js:27-45
- Task: Deterministic ordering for callsites before write
  - Files to change/create:
    - src/index/build/artifacts/writers/call-sites.js (sort by relPath/callerChunkUid/start/end etc)
- Tests / Verification
  - Files to change/create:
    - tests/relations/segment-call-sites.test.js (new; .vue or fenced block fixture)
    - tests/relations/call-sites-ordering.test.js (new; ensures stable ordering)

### 6.5 Graph integration and cross-file linking (prefer call_sites)
- Task: Emit resolved callee identity in call_sites
  - Files to change/create:
    - src/index/type-inference-crossfile/pipeline.js (resolve call links at ~201-280; add targetChunkUid/targetCandidates)
    - src/index/build/indexer/steps/relations.js (cross-file inference is invoked at ~110-160)
  - Call sites/line refs:
    - src/index/type-inference-crossfile/pipeline.js:201-280
    - src/index/build/indexer/steps/relations.js:110-170
- Task: Replace file::name joins with chunkUid (or best-effort ambiguity)
  - Files to change/create:
    - src/index/type-inference-crossfile/pipeline.js (chunkByKey map uses `${file}::${name}` at ~58-70; update)
    - src/index/build/graphs.js (legacyKey usage at ~9-136)
  - Call sites/line refs:
    - src/index/type-inference-crossfile/pipeline.js:58-70, 286, 340
    - src/index/build/graphs.js:9, 91-149
- Task: Graph construction prefers call_sites when present
  - Files to change/create:
    - src/index/build/graphs.js (switch to call_sites artifact as edge source)
    - src/shared/artifact-io/loaders.js + src/index/build/piece-assembly.js (load call_sites for graph build if needed)
  - Call sites/line refs:
    - src/index/build/piece-assembly.js:121-136
    - src/index/build/graphs.js:135-149
- Task: Ensure metaV2 consistency after post-processing
  - Files to change/create:
    - src/index/build/indexer/steps/write.js (finalizeMetaV2 at ~9-40)
  - Call sites/line refs:
    - src/index/build/indexer/steps/write.js:9-40
  - Gaps/conflicts:
    - finalizeMetaV2 already runs after cross-file inference in current pipeline; ensure new call_sites processing does not mutate docmeta after write.

## Phase 6 addendum: dependencies, ordering, artifacts, tests, edge cases

### 6.1 Dependencies and order of operations
- Dependencies:
  - 6.1 (schema + caps) must land before 6.2 (writer) and 6.5 (graph consumption).
  - 6.3 (extractors) must land before 6.4 (offset translation + attribution).
  - chunkUid utility from Phase 8 is preferred; until then, use chunkId only as a fallback and keep chunkUid nullable.
- Order of operations (within 6.1):
  1) Finalize CallDetails v2 field list + caps (document and test).
  2) Register schema + required keys (schema registry + jsonl required-keys list).
  3) Wire validator (optional artifact, fail closed when present).
  4) Add example rows in docs.

### 6.1 Artifact rows (call_sites + call_sites_meta)
- call_sites row (required keys):
  - callerChunkUid
  - relPath
  - languageId
  - start
  - end
  - calleeRaw
  - calleeNormalized
  - args
- call_sites row (optional keys):
  - callerDocId, segmentId, startLine, endLine, receiver, kwargs, confidence, evidence
  - targetChunkUid, targetDocId, targetCandidates (added in 6.5 when resolution is available)
- Caps (set explicit defaults in schema/tests):
  - maxArgsPerCall (recommended: 8)
  - maxArgTextLen (recommended: 80)
  - maxArgDepth (recommended: 2)
  - maxEvidenceItems (recommended: 6)
  - maxEvidenceTextLen (recommended: 32)
  - maxRowBytes (recommended: 32768; drop and log if exceeded)
- call_sites_meta (sharded JSONL meta, required keys):
  - schemaVersion, artifact (const "call_sites"), format "jsonl-sharded", generatedAt, compression,
    totalRecords, totalBytes, maxPartRecords, maxPartBytes, targetMaxBytes, parts[]
  - parts[] required keys: path, records, bytes (checksum optional)

### 6.1 Acceptance criteria + tests (lane)
- tests/validate/call-sites-schema-valid.test.js (test:services)
- tests/validate/call-sites-schema-invalid.test.js (test:services)
- tests/unit/call-sites-truncation.test.js (test:unit)

### 6.1 Edge cases and fallback behavior
- Missing location info: drop callsite row and record a warning (do not fabricate offsets).
- Oversized args/evidence: truncate deterministically with a fixed marker; set confidence lower.
- Row > 32KB: drop row, log warning; include count in stats when available.

### 6.2 Dependencies and order of operations
- Dependencies:
  - 6.1 schema + required keys before writer implementation.
  - pieces/manifest inventory before validator strict checks.
- Order of operations (within 6.2):
  1) Implement writer with deterministic ordering.
  2) Emit sharded meta + parts; ensure manifest entry.
  3) Wire validator to load via manifest.
  4) Add determinism test (two builds, identical output).

### 6.2 Acceptance criteria + tests (lane)
- tests/integration/call-sites-artifact-emission.test.js (test:integration)
- tests/integration/call-sites-manifest-inventory.test.js (test:integration)
- tests/integration/call-sites-determinism.test.js (test:integration)

### 6.2 Edge cases and fallback behavior
- Missing call_sites (relations disabled): validator passes; graph builder uses callLinks fallback.
- Shard boundary: ensure stable part sizes even when record counts differ by 1.

### 6.3 Dependencies and order of operations
- Dependencies:
  - 6.1 caps + schema finalize before extraction to avoid later field renames.
  - 6.4 offset translation must be defined before segment fixtures are validated.
- Order of operations (within 6.3):
  1) AST walk produces raw call expression info.
  2) Normalize callee and receiver.
  3) Build bounded args summary.
  4) Attach location (start/end + line/col) and emit CallDetails.

### 6.3 Acceptance criteria + tests (lane)
- tests/relations/js-call-details-v2.test.js (test:unit)
- tests/relations/ts-call-details-v2.test.js (test:unit)
- tests/relations/ts-call-details-tsx.test.js (test:unit)

### 6.3 Edge cases and fallback behavior
- Optional chaining / computed callee: calleeRaw captured, calleeNormalized best-effort, receiver may be null.
- Spread and nested calls: args summary uses stable ordering and caps; nested call args are summarized, not expanded.

### 6.4 Dependencies and order of operations
- Dependencies:
  - segment boundaries + segment language mapping from Phase 5.
  - segmentUid (Phase 8) optional; segmentId remains debug-only.
- Order of operations (within 6.4):
  1) Translate segment offsets to container offsets.
  2) Attribute callsite to smallest containing chunk.
  3) Apply deterministic sorting prior to writing.

### 6.4 Acceptance criteria + tests (lane)
- tests/relations/segment-offset-translation.test.js (test:integration)
- tests/relations/callsite-ordering-determinism.test.js (test:integration)

### 6.4 Edge cases and fallback behavior
- Callsite outside any chunk: attach to deterministic pseudo-caller or emit with callerChunkUid null (choose and document).
- Segment with mismatched languageId: route by effective language, not container ext.
- Fail-closed: never synthesize callerChunkUid from file::name; if no chunk contains the callsite, do not guess.

### 6.5 Dependencies and order of operations
- Dependencies:
  - 6.2 writer + 6.3 extraction complete.
  - chunkUid mapping available (Phase 8) or fallback to chunkId with explicit ambiguity tracking.
- Order of operations (within 6.5):
  1) Build chunkUid index (or fallback map) before cross-file linking.
  2) Resolve callees; attach targetChunkUid or targetCandidates.
  3) Graph builder prefers call_sites; fallback to callLinks if missing.

### 6.5 Acceptance criteria + tests (lane)
- tests/services/graph-call-sites-preferred.test.js (test:services)
- tests/services/graph-call-sites-fallback.test.js (test:services)
- tests/integration/file-name-collision-no-wrong-join.test.js (test:integration)

### 6.5 Edge cases and fallback behavior
- Ambiguous callee resolution: emit candidates, do not pick a winner; graph marks ambiguity.
- Missing target chunkUid: leave null, keep edge evidence in call_sites.
- file::name collisions: resolve via chunkUid; if missing, surface ambiguity rather than silent overwrite.
- Fail-closed: in strict mode, do not emit graph edges for callsites missing callerChunkUid/targetChunkUid; keep evidence rows only.

## Fixtures list (Phase 6)

- tests/fixtures/relations/js-callsites-basic
- tests/fixtures/relations/ts-callsites-basic
- tests/fixtures/relations/segments/vue-script-tsx
- tests/fixtures/relations/segments/md-fence-tsx
- tests/fixtures/graph/file-name-collision

## Compat/migration checklist (Phase 6)

- Keep legacy callLinks in file_relations; call_sites is additive.
- Keep segmentId as optional debug-only; prefer segmentUid when available.
- Do not break existing consumers of callDetails.args; provide backward-compatible fields or adapt consumers.
- Validator treats call_sites as optional; fail-closed only when present.
- Graph builder falls back to callLinks when call_sites absent (no file::name joins).
- Align call_sites fields with Phase 10 call_sites spec before implementation; do not ship two divergent schemas.

## Artifacts contract appendix (Phase 6)

- call_sites (jsonl or sharded jsonl)
  - required keys: callerChunkUid, relPath, languageId, start, end, calleeRaw, calleeNormalized, args
  - optional keys: callerDocId, segmentId, startLine, endLine, receiver, kwargs, confidence, evidence,
    targetChunkUid, targetDocId, targetCandidates
  - caps: maxArgsPerCall, maxArgTextLen, maxArgDepth, maxEvidenceItems, maxEvidenceTextLen, maxRowBytes
- call_sites_meta (json)
  - required keys: schemaVersion, artifact="call_sites", format="jsonl-sharded", generatedAt, compression,
    totalRecords, totalBytes, maxPartRecords, maxPartBytes, targetMaxBytes, parts[]
  - parts[] required keys: path, records, bytes (checksum optional)

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
- [ ] Unskip phase-tagged LMDB tests once Phase 7/8 deliverables land:
  - Remove `DelayedUntilPhase7_8` from `tests/run.config.jsonc`.
  - Ensure these tests pass: `lmdb-backend`, `lmdb-corruption`, `lmdb-report-artifacts`.

---

---

## Added detail (Phase 7 task mapping)

### 7.1 Build-scoped embeddings jobs + best-effort enqueue
- Task: Bind embedding jobs to explicit build output target
  - Files to change/create:
    - src/index/build/indexer/pipeline.js (enqueueEmbeddingJob call at ~323 already passes indexRoot; extend with configHash/repoProvenance)
    - src/index/build/indexer/embedding-queue.js (payload fields at ~8-33)
    - tools/service/queue.js (job schema validation if any)
  - Call sites/line refs:
    - src/index/build/indexer/pipeline.js:323
    - src/index/build/indexer/embedding-queue.js:8-33
  - Gaps/conflicts:
    - embedding job payload currently lacks configHash/repo provenance; Phase 7 requires it for determinism.
- Task: Best-effort enqueue when embeddingService is enabled
  - Files to change/create:
    - src/index/build/indexer/embedding-queue.js (wrap ensureQueueDir/enqueueJob, set pending state on failure)
    - src/index/build/indexer/steps/write.js (index_state.embeddings fields at ~52-98)
  - Call sites/line refs:
    - src/index/build/indexer/embedding-queue.js:8-46
    - src/index/build/indexer/steps/write.js:52-98
- Task: Worker honors build scoping
  - Files to change/create:
    - tools/indexer-service.js (runBuildEmbeddings uses --repo only at ~260-284; add --index-root/indexDir)
    - tools/build-embeddings/cli.js + tools/build-embeddings/args.js (ensure --index-root is parsed)
  - Call sites/line refs:
    - tools/indexer-service.js:260-284
    - tools/build-embeddings/cli.js (args wiring)

### 7.2 Embeddings artifact contract + capability signaling
- Task: Manifest + artifact discovery
  - Files to change/create:
    - tools/build-embeddings/manifest.js (embeddingPieces list at ~52-70; currently filtered by ARTIFACT_SCHEMA_DEFS)
    - src/index/build/artifacts.js (dense_vectors pieces at ~255-300)
  - Call sites/line refs:
    - tools/build-embeddings/manifest.js:52-90
    - src/index/build/artifacts.js:255-300
  - Gaps/conflicts:
    - tools/build-embeddings/manifest.js drops entries whose name is not in ARTIFACT_SCHEMA_DEFS, so dense_vectors_hnsw.bin and lancedb dirs are silently omitted; reconcile with “discoverable” requirement.
- Task: Emit embedding identity + backend availability in index_state
  - Files to change/create:
    - src/index/build/indexer/steps/write.js (index_state.embeddings at ~52-90)
    - tools/build-embeddings/runner.js (index_state updates at ~175-191 and ~692-704)
    - src/retrieval/cli-index.js (embeddingsState read at ~101-107)
  - Call sites/line refs:
    - src/index/build/indexer/steps/write.js:52-90
    - tools/build-embeddings/runner.js:175-191, 692-704
    - src/retrieval/cli-index.js:101-107
- Task: Harden validation for embeddings presence/consistency
  - Files to change/create:
    - src/index/validate.js (dense vector validation at ~413-491)
  - Call sites/line refs:
    - src/index/validate.js:413-491
- Task: Missing-vector reporting + gating
  - Files to change/create:
    - tools/build-embeddings/embed.js (fillMissingVectors at ~120-150; add missing counters)
    - tools/build-embeddings/runner.js (propagate missing stats into index_state)
    - src/index/build/file-processor/embeddings.js (inline embeddings path)
  - Call sites/line refs:
    - tools/build-embeddings/embed.js:108-145

### 7.3 Quantization invariants
- Task: Clamp levels to [2,256] everywhere
  - Files to change/create:
    - src/storage/sqlite/vector.js (resolveQuantizationParams at ~10-20)
    - src/shared/embedding-utils.js (quantizeEmbeddingVector at ~56-74)
    - src/index/embedding.js (quantizeVec export at ~8-12)
    - src/storage/sqlite/build/incremental-update.js (quantize/pack paths at ~15-40)
  - Call sites/line refs:
    - src/storage/sqlite/vector.js:10-20
    - src/shared/embedding-utils.js:56-86
    - src/index/embedding.js:8-12
    - src/storage/sqlite/build/incremental-update.js:15-40
- Task: Safe dequantization + param propagation
  - Files to change/create:
    - src/storage/sqlite/vector.js (dequantizeUint8ToFloat32 at ~22-40)
    - tools/build-embeddings/lancedb.js (buildBatch uses dequantize with defaults at ~28-45)
  - Call sites/line refs:
    - src/storage/sqlite/vector.js:22-40
    - tools/build-embeddings/lancedb.js:28-45
- Task: MergeEmbeddingVectors regression guard
  - Files to change/create:
    - src/shared/embedding-utils.js (mergeEmbeddingVectors at ~6-32)

### 7.4 Normalization policy consistency
- Task: Centralize normalization policy
  - Files to change/create:
    - src/shared/embedding-utils.js (normalizeEmbeddingVector* at ~36-55) or new policy module
    - tools/build-embeddings/embed.js (normalizeEmbeddingVector call at ~4-10, ~108-121)
    - src/index/build/file-processor/embeddings.js (normalizeVec calls at ~238-240)
    - src/retrieval/embedding.js (query-time embeddings)
  - Call sites/line refs:
    - tools/build-embeddings/embed.js:1-15, 108-121
    - src/index/build/file-processor/embeddings.js:238-240

### 7.5 LanceDB ANN correctness
- Task: Promise-cache connections + candidate filtering
  - Files to change/create:
    - src/retrieval/lancedb.js (connection caching and candidate filtering paths)
  - Call sites/line refs:
    - src/retrieval/lancedb.js (connection map + rankLanceDb usage)
- Task: idColumn handling + warning policy
  - Files to change/create:
    - src/retrieval/lancedb.js (filter construction and warnOnce)
  - Gaps/conflicts:
    - tools/build-embeddings/lancedb.js meta lacks quantization params; add for later verification.

### 7.6 HNSW ANN correctness
- Task: Load signature compatibility + similarity mapping
  - Files to change/create:
    - src/shared/hnsw.js (loadHnswIndex + rankHnswIndex at ~40-120)
  - Call sites/line refs:
    - src/shared/hnsw.js:40-120
- Task: Insertion failure observability
  - Files to change/create:
    - tools/build-embeddings/hnsw.js (writeIndex at ~52-110)
  - Call sites/line refs:
    - tools/build-embeddings/hnsw.js:52-110

### 7.7 ANN backend policy + parity
- Task: Canonical ann-backend selection
  - Files to change/create:
    - src/retrieval/cli/normalize-options.js (backend choice)
    - src/retrieval/ann/index.js (provider selection)
    - src/retrieval/ann/providers/*.js (availability rules)
  - Call sites/line refs:
    - src/retrieval/ann/providers/hnsw.js:9-22
    - src/retrieval/ann/providers/lancedb.js:9-27
    - src/retrieval/ann/providers/sqlite-vec.js:8-23
- Task: Record backend availability in state
  - Files to change/create:
    - src/index/build/indexer/steps/write.js (index_state.features detail)
    - src/retrieval/cli/run-search-session.js (annBackendUsed at ~483-487)
  - Call sites/line refs:
    - src/retrieval/cli/run-search-session.js:483-487

### 7.8 Backend storage resilience
- Task: LMDB map size planning
  - Files to change/create:
    - tools/build-lmdb-index.js (lmdb open config; currently no map size config)
  - Call sites/line refs:
    - tools/build-lmdb-index.js:1-90 (open import and options)
- Task: SQLite dense cross-mode safety
  - Files to change/create:
    - tools/build-embeddings/sqlite-dense.js (deleteDense/deleteAnn at ~130-150; uses global table name)
  - Call sites/line refs:
    - tools/build-embeddings/sqlite-dense.js:118-150
- Task: Embedding cache preflight metadata
  - Files to change/create:
    - tools/build-embeddings/run.js (preflight; see runner invocation)
    - tools/build-embeddings/cache.js (cache scan logic)
  - Gaps/conflicts:
    - Current run.js is minimal; cache scanning appears in runner.js; add metadata file to avoid full directory scan.

## Phase 7 addendum: dependencies, ordering, artifacts, tests, edge cases

### 7.1 Dependencies and order of operations
- Dependencies:
  - Build-scoped job payload schema must land before worker changes.
  - Queue enqueue changes must land before state recording.
- Order of operations:
  1) Extend payload schema (buildId/buildRoot/indexDir/configHash).
  2) Update enqueue call sites to populate payload.
  3) Update worker to enforce buildRoot and reject mismatches.
  4) Update index_state embeddings.pending/ready logic.
  5) Add tests for payload and failure modes.

### 7.1 Acceptance criteria + tests (lane)
- tests/embeddings/job-payload-includes-buildroot.test.js (test:integration)
- tests/embeddings/optional-no-service.test.js (test:integration)
- tests/embeddings/worker-refuses-mismatched-buildroot.test.js (test:integration)

### 7.1 Edge cases and fallback behavior
- Unwritable queue dir in service mode: log warning, set embeddings.pending=true, continue build.
- Missing buildRoot/indexDir in job: refuse job, do not write artifacts.

### 7.2 Artifact row fields (embeddings artifacts)
- dense_vectors_uint8.json (and dense_vectors_doc_uint8.json, dense_vectors_code_uint8.json):
  - required keys: dims, vectors
  - optional keys: model, scale
  - vectors: array of uint8 arrays, length == chunk count for the mode
  - caps: dims >= 1; each vector length == dims; values in [0,255]
- dense_vectors_hnsw.meta.json:
  - required keys: dims, count, space, m, efConstruction, efSearch
  - optional keys: version, generatedAt, model
  - caps: count <= vectors length; dims >= 1
- dense_vectors_lancedb.meta.json:
  - required keys: dims, count, metric, table, embeddingColumn, idColumn
  - optional keys: version, generatedAt, model
  - caps: count <= vectors length; dims >= 1
- pieces/manifest.json entries (for each embedding artifact):
  - required keys: type="embeddings", name, format, path
  - recommended keys: count, dims, checksum, bytes

### 7.2 Dependencies and order of operations
- Dependencies:
  - 7.1 payload scoping before artifact publication in service mode.
  - Validation rules must align with manifest entries.
- Order of operations:
  1) Define artifact contract + manifest entries.
  2) Emit index_state.embeddings capability summary.
  3) Harden validator for counts/dims.
  4) Add missing-vectors reporting + gating.

### 7.2 Acceptance criteria + tests (lane)
- tests/validate/embeddings-referential-integrity.test.js (test:services)
- tests/validate/embeddings-optional-absence.test.js (test:services)
- tests/embeddings/missing-rate-gating.test.js (test:integration)

### 7.2 Edge cases and fallback behavior
- Embeddings absent: validation passes, index_state.embeddings.ready=false with reason.
- Dims mismatch: validation fails in strict mode; non-strict logs warning.

### 7.3 Dependencies and order of operations
- Dependencies:
  - Quantization utils updated before any backend writes (HNSW/LanceDB).
- Order of operations:
  1) Clamp levels in config resolution.
  2) Clamp levels at quantizer/dequantizer.
  3) Thread quantization params through writers.

### 7.3 Acceptance criteria + tests (lane)
- tests/unit/quantization-levels-clamp.test.js (test:unit)
- tests/unit/dequantize-levels-safe.test.js (test:unit)
- tests/regression/incremental-update-quantize-no-wrap.test.js (test:integration)

### 7.3 Edge cases and fallback behavior
- levels <= 1: dequantize safely (no divide by zero) and clamp to 2.
- levels > 256: clamp to 256 with warning.

### 7.4 Dependencies and order of operations
- Dependencies:
  - Normalization policy must be defined before ANN query-time use.
- Order of operations:
  1) Centralize normalization policy.
  2) Apply to build-time embedding vectors.
  3) Apply to query-time embedding vectors.

### 7.4 Acceptance criteria + tests (lane)
- tests/unit/normalization-policy-consistency.test.js (test:unit)
- tests/integration/hnsw-rebuild-idempotent.test.js (test:integration)

### 7.4 Edge cases and fallback behavior
- Policy mismatch detected between build/query: mark ANN unavailable and fall back to lexical search.

### 7.5 Dependencies and order of operations
- Dependencies:
  - 7.3 quantization invariants and 7.4 normalization before LanceDB query fixes.
- Order of operations:
  1) Promise-cache LanceDB connections.
  2) Fix candidate filtering to honor topN.
  3) Escape identifiers and sanitize filters.
  4) Replace warnOnce suppression with rate-limited warnings.

### 7.5 Acceptance criteria + tests (lane)
- tests/lancedb-ann.js (test:services, skip 77 if missing deps)
- tests/unit/lancedb-connection-caching.test.js (test:unit)

### 7.5 Edge cases and fallback behavior
- LanceDB missing: skip backend, mark availability false, continue with other backends.
- Candidate set too small: return fewer results, log cap hit; never crash.

### 7.6 Dependencies and order of operations
- Dependencies:
  - 7.3 quantization invariants before HNSW build.
- Order of operations:
  1) Fix load signature.
  2) Verify similarity mapping (ip/cosine).
  3) Capture insertion failures with summary.

### 7.6 Acceptance criteria + tests (lane)
- tests/unit/hnsw-signature-compat.test.js (test:unit)
- tests/unit/hnsw-similarity-mapping.test.js (test:unit)
- tests/integration/hnsw-insert-failure-reporting.test.js (test:integration)

### 7.6 Edge cases and fallback behavior
- Insert failure: fail build with error summary; do not write partial index.
- Missing HNSW index: mark availability false; fall back to other backends.

### 7.7 Dependencies and order of operations
- Dependencies:
  - 7.5 and 7.6 must land before backend selection parity.
- Order of operations:
  1) Enumerate backend availability in index_state.
  2) Apply selection policy (config + availability).
  3) Add explicit backend tests with skip semantics.

### 7.7 Acceptance criteria + tests (lane)
- tests/services/ann-backend-selection.test.js (test:services)
- tests/services/ann-backend-availability-reporting.test.js (test:services)

### 7.7 Edge cases and fallback behavior
- Preferred backend unavailable: select next available backend; record reason in state.

### 7.8 Dependencies and order of operations
- Dependencies:
  - Storage backend guardrails must land before embeddings/ANN rely on them.
- Order of operations:
  1) Harden storage open/create paths.
  2) Add explicit error reporting (no silent partial writes).
  3) Add resilience tests.

### 7.8 Acceptance criteria + tests (lane)
- tests/storage/embeddings-backend-resilience.test.js (test:storage)

### 7.8 Edge cases and fallback behavior
- Partial storage failure: mark embeddings unavailable, do not expose ANN indexes.

## Fixtures list (Phase 7)

- tests/fixtures/embeddings/basic-repo
- tests/fixtures/embeddings/missing-vectors
- tests/fixtures/embeddings/quantization-caps

## Compat/migration checklist (Phase 7)

- Keep existing dense_vectors_* filenames; do not rename artifacts.
- Accept legacy embedding jobs with a warning or explicit refusal (no silent mutation).
- Preserve current zero-fill behavior for missing vectors but record missing counts/gating.
- Keep ANN backends optional; missing deps must skip, not fail builds.

## Artifacts contract appendix (Phase 7)

- dense_vectors_uint8.json (and dense_vectors_doc_uint8.json, dense_vectors_code_uint8.json)
  - required keys: dims, vectors
  - optional keys: model, scale
  - caps: dims >= 1; vectors length == chunk count; values in [0,255]
- dense_vectors_hnsw.meta.json
  - required keys: dims, count, space, m, efConstruction, efSearch
  - optional keys: version, generatedAt, model
- dense_vectors_lancedb.meta.json
  - required keys: dims, count, metric, table, embeddingColumn, idColumn
  - optional keys: version, generatedAt, model
- pieces/manifest.json entries for embeddings
  - required keys: type="embeddings", name, format, path
  - recommended keys: count, dims, checksum, bytes

# Phase 8 - Tooling Provider Framework & Type Inference Parity (Segment‑Aware)

## 0. Guiding principles (non-negotiable)

1. **Stable identity first.** Tooling outputs must attach to chunks using stable keys (`chunkUid` preferred; `chunkId` as range-specific fallback). Never rely on `file::name`.
2. **Segment-aware by construction.** Embedded code (Markdown fences, Vue/Svelte/Astro blocks, etc.) must be projected into **virtual documents** and routed by effective language, not container extension.
3. **Capability-gated tooling.** Missing tools must not make indexing brittle. Providers must detect availability and no-op safely when absent.
4. **Deterministic and bounded.** Provider selection order, merging, and output growth must be deterministic and bounded by caps.
5. **Encoding-correct offsets.** Any provider mapping offsets must read text via the shared decode path (`src/shared/encoding.js`) so positions match chunking offsets.
6. **High-throughput defaults.** Avoid O(N²) scans. Prefer grouping, caching, and single-pass mapping where possible.

---

## Exit Criteria

- Tooling inputs and outputs are keyed by `chunkUid` with `segmentUid`/`virtualPath` present for all targets.
- VFS routing produces deterministic virtual paths and correct virtual ranges for segments.
- **Fail-closed identity joins:** in strict mode, missing/ambiguous identity never falls back to `file::name` or name-only joins.

---

## 1. Canonical contracts (copy/paste into implementation)

### 1.1 Chunk identifiers

**`chunkId` (range-specific, already exists)**  
Produced by `src/index/chunk-id.js#resolveChunkId({file, segment, start, end, kind, name})`.

**`chunkUid` (stable-ish, new)**  
Computed per `docs/spec-identity-contract.refined.md` (canonical). Inputs:
- namespaceKey (default "repo")
- virtualPath (fileRelPath or fileRelPath#seg:<segmentUid>)
- chunkText + pre/post context windows
- optional segment.languageId salt

Canonical form:
- `chunkUid = "ck64:v1:" + namespaceKey + ":" + virtualPath + ":" + spanHash + (":" + preHash?) + (":" + postHash?)`

Collision handling (mandatory, per canonical spec):
- Escalate context window once; if still colliding, append deterministic `:ord<N>` suffixes.

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
 * @property {string | null | undefined} segmentUid
 * @property {string | null | undefined} segmentId // legacy debug only
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
2. else join on `{file, segmentUid, chunkId}`
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
 * @property {string|null} segmentUid
 * @property {string|null} segmentId      // legacy debug only
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

- Canonical prefix: `.poc-vfs/`
- If segmentUid is null (no segment):
  - `.poc-vfs/<containerPath>`
- If segmentUid is non-null (segment):
  - `.poc-vfs/<containerPath>#seg:<segmentUid><effectiveExt>`
- Percent-encode `#` and `%` in containerPath before embedding.
- Never use container extension for `effectiveExt` (always effective language).

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
    - `computeChunkUidV1({fileRelPath,segmentUid,start,end,chunkText,fullText,namespaceKey,segmentLanguageId})`
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
    1. Group chunks by `{containerPath, segmentUid}`.
    2. Read each container file once using `readTextFile()` from `src/shared/encoding.js`.
    3. Slice `segmentText = containerText.slice(segment.start, segment.end)` when segmentUid present; else full file.
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
    - `symbolKey = "ts:heur:v1:" + virtualPath + ":" + (nodeName||target.chunkRef.chunkId)`
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
- [ ] Unskip phase-tagged LMDB tests once Phase 7/8 deliverables land:
  - Remove `DelayedUntilPhase7_8` from `tests/run.config.jsonc`.
  - Ensure these tests pass: `lmdb-backend`, `lmdb-corruption`, `lmdb-report-artifacts`.

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


---

## Added detail (Phase 8 task mapping)

### 8.1 Provider contract + registry
- Files to change/create:
  - src/index/tooling/registry.js (new; per spec_phase8_tooling_provider_registry_refined.md)
  - src/index/type-inference-crossfile/tooling.js (replace hardcoded provider fan-out)
  - src/index/type-inference-crossfile/pipeline.js (runToolingPass call at ~99-101)
  - src/index/build/runtime/runtime.js (toolingConfig + toolingEnabled at ~155-176)
  - src/integrations/tooling/providers/shared.js (extend entries with provider id/version/config hash)
- Call sites/line refs:
  - src/index/type-inference-crossfile/pipeline.js:99-107
  - src/index/build/runtime/runtime.js:155-176, 611-612
- Gaps/conflicts:
  - Current providers key by `${file}::${name}` (see src/index/tooling/typescript-provider.js:308); spec requires chunkUid-first joins.
  - spec_phase8_identity_and_symbol_contracts_refined.md expects chunkUid availability; now required in Phase 8 (fail-closed if missing).

### 8.2 Segment/VFS-aware tooling orchestration
- Files to change/create:
  - src/index/tooling/vfs.js (new typedefs + helpers per spec_phase8_tooling_vfs_and_segment_routing_refined.md)
  - src/index/tooling/vfs-builder.js (new; build ToolingVirtualDocument[] + ToolingTarget[])
  - src/index/segments.js (segmentUid + ranges available at ~90-150)
  - src/index/segments/config.js (resolveSegmentExt at ~56-75 for TSX/JSX)
  - src/index/type-inference-crossfile/tooling.js (buildChunksByFile/filterChunksByExt at ~38-70)
- Call sites/line refs:
  - src/index/segments.js:90-150
  - src/index/type-inference-crossfile/tooling.js:38-70
  - src/index/build/file-processor/process-chunks.js:250-285 (effective language + segment info)
- Gaps/conflicts:
  - No existing VFS manifest artifact; spec-vfs-manifest-artifact.md expects vfs_manifest.jsonl (new writer needed).
  - Offsets currently computed in container coordinates; VFS needs virtualRange to avoid remapping in providers.

### 8.3 TypeScript provider parity for JS/JSX + segment VFS
- Files to change/create:
  - src/index/tooling/typescript-provider.js (collectTypeScriptTypes at ~253; currently TS-only)
  - src/integrations/tooling/providers/shared.js (tooling entry format may need symbolRef support)
  - src/index/type-inference-crossfile/tooling.js (routing by virtualPath/languageId)
- Call sites/line refs:
  - src/index/tooling/typescript-provider.js:253-325
- Gaps/conflicts:
  - typescript-provider currently keys results by `${chunk.file}::${chunk.name}` (line ~308); must switch to chunkUid.
  - spec_phase8_typescript_provider_js_parity_refined.md expects JS/JSX support; current routing uses file ext filtering.

### 8.4 LSP provider hardening + VFS integration
- Files to change/create:
  - src/index/tooling/clangd-provider.js, pyright-provider.js, sourcekit-provider.js (LSP providers)
  - src/integrations/tooling/lsp/client.js (process lifecycle + restart safety)
  - src/integrations/tooling/lsp/positions.js (rangeToOffsets; VFS virtual ranges)
- Call sites/line refs:
  - src/integrations/tooling/lsp/positions.js:1-28
  - src/index/tooling/clangd-provider.js:6-12
- Gaps/conflicts:
  - Providers currently assume physical paths; VFS requires virtualPath + segment routing and possibly temp file materialization.

### 8.5 Tooling doctor + reporting + CLI integration
- Files to change/create:
  - src/index/type-inference-crossfile/tooling.js (collect diagnostics + provenance)
  - src/shared/cli (add “doctor” command output wiring)
  - tools/dict-utils.js (getToolingConfig surface if new fields added)
- Call sites/line refs:
  - src/index/type-inference-crossfile/tooling.js:221-285 (toolingConfig, logging, diagnostics)
- Gaps/conflicts:
  - spec_phase8_tooling_doctor_and_reporting_refined.md expects structured health output; current pipeline only logs to console.

### Associated specs reviewed (Phase 8)
- docs/spec_phase8_tooling_provider_registry_refined.md
- docs/spec_phase8_tooling_vfs_and_segment_routing_refined.md
- docs/spec_phase8_typescript_provider_js_parity_refined.md
- docs/spec_phase8_lsp_provider_hardening_refined.md
- docs/spec_phase8_tooling_doctor_and_reporting_refined.md
- docs/spec_phase8_identity_and_symbol_contracts_refined.md
- docs/spec-vfs-manifest-artifact.md

## Phase 8 addendum: dependencies, ordering, artifacts, tests, edge cases

### Cross-phase ordering (Phase 8 ↔ Phase 9)
- Identity primitives (`segmentUid`, `virtualPath`, `chunkUid`) are **promoted to Phase 8** as a hard prerequisite for 8.2+ tooling work.
- Phase 9.1 becomes **verification + extension only** (no new algorithm changes); if missing, stop Phase 9 and complete Phase 8 identity tasks first.
- Required identity tests before 8.2 starts:
  - tests/unit/segment-uid-stability.test.js (test:unit)
  - tests/unit/chunk-uid-stability.test.js (test:unit)
  - tests/validate/chunk-uid-required.test.js (test:services)

### 8.1 Dependencies and order of operations
- Dependencies:
  - Provider contract must land before registry and orchestrator.
  - ChunkUid utility (Phase 8 identity tasks) must be available or inlined using the canonical spec.
- Order of operations:
  1) Define provider contract + capability gating.
  2) Implement registry and deterministic selection order.
  3) Wire orchestrator to use registry.
  4) Add provider-level unit tests.

### 8.1 Acceptance criteria + tests (lane)
- tests/tooling/provider-registry-ordering.test.js (test:unit)
- tests/tooling/provider-detect-capabilities.test.js (test:unit)

### 8.1 Edge cases and fallback behavior
- Provider detect throws: mark unavailable, continue with remaining providers.
- Two providers claim same language/kind: deterministic priority order, stable merge rules.
- Fail-closed: if chunkUid is missing on any target in strict mode, provider output is discarded for that target (no file::name fallback).

### 8.2 Dependencies and order of operations
- Dependencies:
  - VFS manifest + virtualPath scheme from `docs/spec-vfs-manifest-artifact.md`.
  - segmentUid (Phase 8) or legacy segmentId only for debug.
- Order of operations:
  1) Build VFS documents and targets from segments.
  2) Emit vfs_manifest artifact (if enabled).
  3) Route targets to providers based on effective language.
  4) Merge results keyed by chunkUid.

### 8.2 Artifact row fields (vfs_manifest.jsonl)
- vfs_manifest row required keys:
  - schemaVersion, virtualPath, docHash
  - containerPath, containerExt, containerLanguageId
  - languageId, effectiveExt
  - segmentUid, segmentStart, segmentEnd
- vfs_manifest row optional keys:
  - segmentId (debug-only), lineStart, lineEnd, extensions
- Caps:
  - virtualPath must be deterministic, POSIX, and under `.poc-vfs/`
  - docHash = "xxh64:<hex16>" of virtual doc text
  - row size <= 32KB

### 8.2 Acceptance criteria + tests (lane)
- tests/tooling/vfs-manifest-emission.test.js (test:integration)
- tests/tooling/vfs-virtual-range-mapping.test.js (test:integration)

### 8.2 Edge cases and fallback behavior
- Segment offsets out of bounds: strict mode fails; non-strict drops target and logs.
- VirtualPath collision: append deterministic disambiguator and record warning.
- Fail-closed: do not emit ToolingTarget if virtualRange cannot be mapped; never guess offsets.

### 8.3 Dependencies and order of operations
- Dependencies:
  - VFS routing (8.2) must land before TS provider parity.
  - chunkUid must be present on targets.
- Order of operations:
  1) Build TS Program from virtual docs.
  2) Range-based node matching.
  3) Emit results keyed by chunkUid.

### 8.3 Acceptance criteria + tests (lane)
- tests/tooling/typescript-js-parity-basic.test.js (test:services)
- tests/tooling/typescript-vfs-segment-vue.test.js (test:services)
- tests/tooling/typescript-node-matching-range.test.js (test:services)
- tests/tooling/typescript-ambiguous-fallback-does-not-guess.test.js (test:services)

### 8.3 Edge cases and fallback behavior
- Multiple candidate nodes: mark ambiguous, do not guess in strict mode.
- Missing virtual doc: skip target, log provider diagnostic.
- Fail-closed: if node matching is ambiguous in strict mode, emit no types for that chunkUid (no name-only fallback).

### 8.4 Dependencies and order of operations
- Dependencies:
  - 8.2 VFS routing and 8.1 registry must land first.
- Order of operations:
  1) Implement VFS open/update lifecycle for LSP.
  2) Ensure restart safety and per-target failure isolation.
  3) Emit results keyed by chunkUid.

### 8.4 Acceptance criteria + tests (lane)
- tests/tooling/lsp-vfs-open-update.test.js (test:services)
- tests/tooling/lsp-restart-safety.test.js (test:services)

### 8.4 Edge cases and fallback behavior
- LSP server crash: restart once, then mark provider unavailable.
- VFS document too large: skip and log; do not crash indexing.
- Fail-closed: if LSP cannot map offsets to virtualRange, drop the result for that target.

### 8.5 Dependencies and order of operations
- Dependencies:
  - Provider registry + VFS must be in place.
- Order of operations:
  1) Collect per-provider diagnostics.
  2) Emit tooling doctor report.
  3) Wire CLI output and config hints.

### 8.5 Acceptance criteria + tests (lane)
- tests/tooling/doctor-reporting.test.js (test:services)
- tests/tooling/doctor-cli-output.test.js (test:services)

### 8.5 Edge cases and fallback behavior
- Provider returns partial output: include diagnostics and mark degraded in doctor report.

## Fixtures list (Phase 8)

- tests/fixtures/vfs/markdown-tsx-fence
- tests/fixtures/vfs/vue-script-ts
- tests/fixtures/tooling/js-parity-basic
- tests/fixtures/tooling/lsp-basic

## Compat/migration checklist (Phase 8)

- segmentId remains debug-only; segmentUid is the primary segment identity.
- Providers that cannot handle VFS must be skipped (no file::name fallback).
- Tooling outputs keyed by chunkUid; legacy file::name maps must be removed or gated behind strict=false.

## Artifacts contract appendix (Phase 8)

- vfs_manifest.jsonl (or sharded jsonl)
  - required keys: schemaVersion, virtualPath, docHash, containerPath, containerExt, containerLanguageId,
    languageId, effectiveExt, segmentUid, segmentStart, segmentEnd
  - optional keys: segmentId, lineStart, lineEnd, extensions
  - caps: virtualPath deterministic under .poc-vfs; docHash = xxh64 of virtual doc text; row size <= 32KB
- vfs_manifest.meta.json (if sharded)
  - required keys: schemaVersion, artifact="vfs_manifest", format="jsonl-sharded", generatedAt, compression,
    totalRecords, totalBytes, maxPartRecords, maxPartBytes, targetMaxBytes, parts[]

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

5) **Fail-closed identity and symbol joins:** no file::name fallback in strict mode; ambiguous resolutions are preserved, not guessed.

This phase directly targets the Phase 9 intent in the roadmap (“Symbol identity (collision-safe IDs) + cross-file linking”) and depends on the canonical `chunkUid` contract delivered in Phase 8. In particular, the `chunkUid` construction approach and “fail closed” requirement are consistent with the canonical identity contract described in the planning materials.

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
span = normalizeForUid(chunkText)
pre  = normalizeForUid(text.slice(max(0, start-128), start))
post = normalizeForUid(text.slice(end, min(len, end+128)))

spanHash = xxhash64("span\0" + span)
preHash  = xxhash64("pre\0" + pre)   (only if pre.length > 0)
postHash = xxhash64("post\0" + post) (only if post.length > 0)

base = "ck64:v1:" + namespaceKey + ":" + virtualPath + ":" + spanHash
if (segment.languageId) base = "ck64:v1:" + namespaceKey + ":" + virtualPath + ":" + segment.languageId + ":" + spanHash
if (preHash)  base += ":" + preHash
if (postHash) base += ":" + postHash

chunkUid = base
```

This follows the canonical identity contract exactly (see `docs/spec-identity-contract.refined.md` §4).

**Collision disambiguation (required):**

If `chunkUid` already exists for a different chunk under the same `virtualPath` scope:

- set `collisionOf = originalChunkUid`
- follow the canonical disambiguation steps: escalate context windows once, then assign deterministic ordinals and append `:ord<index>`.

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

### 9.1 Verify identity primitives (`segmentUid`, `chunkUid`, `virtualPath`) — delivered in Phase 8

> If any identity primitive is missing or diverges from the canonical spec, stop Phase 9 and complete the work in Phase 8 before continuing.

**Verification checklist (no new algorithm changes in Phase 9)**
- Code presence:
  - `src/index/identity/*` helpers exist and match `docs/spec-identity-contract.refined.md`.
  - `segmentUid`, `virtualPath`, and `chunkUid` are populated in `metaV2` for every code chunk.
- Behavior:
  - `segmentUid` stable under line shifts outside the segment.
  - `chunkUid` stable under line shifts outside the chunk span; changes when span text changes.
  - Collision handling uses canonical escalation + `:ord<N>` suffixes.
- Fail-closed identity rules:
  - Strict validation rejects any chunk missing `chunkUid`/`segmentUid`/`virtualPath`.
  - No file::name fallback for joins in strict mode.
- Tests (already required in Phase 8; rerun only if identity code changes):
  - tests/unit/segment-uid-stability.test.js (test:unit)
  - tests/unit/chunk-uid-stability.test.js (test:unit)
  - tests/validate/chunk-uid-required.test.js (test:services)
  - tests/graph-chunk-id.js (updated to chunkUid)

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

---

## Added detail (Phase 9 task mapping)

### 9.1 Identity primitives (segmentUid, chunkUid, virtualPath)
- Files to change/create:
  - New: src/index/identity/normalize.js, virtual-path.js, segment-uid.js, chunk-uid.js
  - Existing: src/index/segments.js (assignSegmentUids / buildSegmentUid at ~17-50)
  - Existing: src/index/build/file-processor/assemble.js (buildChunkPayload at ~52-105)
  - Existing: src/index/metadata-v2.js (buildMetaV2 uses chunk/meta fields at ~214-260)
  - Existing: src/index/chunk-id.js (legacy chunkId; used by resolveChunkId)
- Call sites/line refs:
  - src/index/segments.js:17-50 (buildSegmentUid, assignSegmentUids)
  - src/index/build/file-processor/assemble.js:52-105
  - src/index/chunk-id.js:1-18
- Gaps/conflicts:
  - Resolved: docs/PHASE9_SPEC_IDENTITY_CONTRACTS.md now matches docs/spec-identity-contract.refined.md for chunkUid (span/pre/post hashes + virtualPath + segmentUid).
  - Phase 8 spec updated to align; Phase 9 remains the implementation target.

### 9.2 Symbol identity (metaV2.symbol + SymbolRef)
- Files to change/create:
  - New: src/index/identity/kind-group.js, src/index/identity/symbol.js
  - Existing: src/index/metadata-v2.js (add symbol object after identity fields)
  - Existing: src/index/type-inference-crossfile/symbols.js (leafName/isTypeDeclaration; may be replaced by identity helpers)
- Call sites/line refs:
  - src/index/metadata-v2.js:214-260 (current metaV2 fields)
  - src/index/type-inference-crossfile/symbols.js:1-30
- Gaps/conflicts:
  - Resolved: symbolKey inputs now use `virtualPath` (segmentUid-based), not segmentId.

### 9.3 Import-aware cross-file resolver
- Files to change/create:
  - New: src/index/type-inference-crossfile/resolve-relative-import.js, resolver.js
  - Existing: src/lang/javascript/relations.js (add importBindings during AST walk; call site around 360-420)
  - Existing: src/index/build/file-processor/relations.js (persist importBindings into fileRelations)
  - Existing: src/contracts/schemas/artifacts.js (extend file_relations schema)
- Call sites/line refs:
  - src/lang/javascript/relations.js:360-418 (AST traversal + callDetails)
  - src/index/build/file-processor/relations.js:27-50
  - src/contracts/schemas/artifacts.js:318-334

### 9.4 Pipeline emits SymbolRef-based links
- Files to change/create:
  - src/index/type-inference-crossfile/pipeline.js (replace chunkByKey `${file}::${name}` at ~58-70; update callLinks at ~201-280)
  - src/index/type-inference-crossfile/symbols.js (or new resolver helpers)
  - src/index/tooling/* providers (clangd/pyright/sourcekit/typescript) keyed by file::name
- Call sites/line refs:
  - src/index/type-inference-crossfile/pipeline.js:58-70, 201-280, 286, 340
  - src/index/tooling/typescript-provider.js:308
  - src/index/tooling/clangd-provider.js:230
  - src/index/tooling/pyright-provider.js:281, 328
  - src/index/tooling/sourcekit-provider.js:198
- Gaps/conflicts:
  - Multiple providers split names by /::|\./ (see src/index/type-inference-crossfile/symbols.js:4-9); switching to SymbolRef requires consistent qualifiedName handling.

### 9.5 Symbol artifacts (symbols, symbol_occurrences, symbol_edges)
- Files to change/create:
  - New writers: src/index/build/artifacts/writers/symbols.js, symbol-occurrences.js, symbol-edges.js
  - src/index/build/artifacts.js (enqueue writers near file_relations at ~380)
  - src/shared/artifact-io/jsonl.js (required keys list)
  - src/contracts/schemas/artifacts.js (add schemas)
  - src/index/validate.js (strict validation + referential checks)
- Call sites/line refs:
  - src/index/build/artifacts.js:380-401
  - src/shared/artifact-io/jsonl.js:11-17
  - src/index/validate.js:76-95, 301-347

### 9.6 Graph relations migrate to chunkUid
- Files to change/create:
  - src/index/build/graphs.js (legacyKey + resolveChunkId at ~9-149)
  - tests/graph-chunk-id.js (update expectations)
- Call sites/line refs:
  - src/index/build/graphs.js:9, 91-149
- Gaps/conflicts:
  - resolveChunkId currently uses chunkId fallback; Phase 8 must ensure metaV2.chunkUid is populated to avoid legacyKey reuse.

### 9.7 Map build identity updates
- Files to change/create:
  - src/map/build-map.js (consume chunkUid + symbolId)
  - src/map/build-map/symbols.js (buildSymbolId uses file::name at ~11-16)
  - src/map/build-map/edges.js (edge member keys at ~104)
  - src/map/build-map/filters.js (file::name parsing at ~30-31, 115-116, 189-192, 216-217)
- Call sites/line refs:
  - src/map/build-map/symbols.js:11-16
  - src/map/build-map/edges.js:104
  - src/map/build-map/filters.js:30-31, 115-116, 189-192, 216-217

### 9.8 Performance + determinism guardrails
- Files to change/create:
  - src/index/build/graphs.js (serializeGraph already sorts; keep stable ordering)
  - new tests under tests/determinism/ and tools/bench/
- Call sites/line refs:
  - src/index/build/graphs.js:45-68 (serializeGraph ordering)

### Associated specs reviewed (Phase 9)
- docs/PHASE9_SPEC_IDENTITY_CONTRACTS.md
- docs/PHASE9_SPEC_SYMBOL_ARTIFACTS_AND_PIPELINE.md
- docs/PHASE9_SPEC_MIGRATION_AND_BACKCOMPAT.md
- docs/spec-identity-contract.refined.md
- docs/spec-symbol-identity-and-symbolref.refined.md
- docs/spec-symbol-artifacts.refined.md

## Phase 9 addendum: dependencies, ordering, artifacts, tests, edge cases

### Cross-phase ordering (Phase 8 ↔ Phase 9)
- Identity primitives (`segmentUid`, `virtualPath`, `chunkUid`) **must already be complete from Phase 8** before any Phase 9 symbol/graph work starts.
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
  2) Replace file::name joins with chunkUid joins.
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

### Exit Criteria

- All emitted risk artifacts validate with strict referential integrity.
- **Fail-closed callsite/identity joins:** missing chunkUid or callSiteId never yields a flow edge in strict mode; ambiguous joins remain unresolved.

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
- [ ] **Unskip phase-tagged tests once Phase 10 deliverables land**
  - Remove `CheckAfterPhase10` from `tests/run.config.jsonc`.
  - Ensure these tests pass: `lancedb-ann`, `parity`, `piece-assembly`, `query-cache`, `search-explain`, `search-rrf`, `services/mcp/tool-search-defaults-and-filters.test`, `shard-merge`, `tooling/triage/context-pack.test`.

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


---

## Added detail (Phase 10 task mapping)

### 10.1 Configuration + runtime wiring
- Files to change/create:
  - New: src/index/risk-interprocedural/config.js (normalizeRiskInterproceduralConfig)
  - src/index/build/runtime/runtime.js (risk config normalization at ~163-170)
  - src/index/build/indexer/steps/relations.js (crossFileEnabled at ~129-139)
  - src/index/build/indexer/steps/write.js (index_state.features at ~66-76)
- Call sites/line refs:
  - src/index/build/runtime/runtime.js:163-170
  - src/index/build/indexer/steps/relations.js:129-139
  - src/index/build/indexer/steps/write.js:66-76
- Gaps/conflicts:
  - Runtime already gates riskAnalysisCrossFile, but interprocedural needs to force cross-file linking without enabling type inference; ensure no accidental enabling in policy.

### 10.2 Contract hardening prerequisites
- Task: Return type boolean contamination
  - Files to change/create:
    - src/index/type-inference-crossfile/extract.js (extractReturnTypes at ~5-25)
    - src/shared/docmeta.js (collectDeclaredReturnTypes already ignores booleans; confirm)
    - src/index/metadata-v2.js (returns field at ~232-246)
  - Call sites/line refs:
    - src/index/type-inference-crossfile/extract.js:5-25
    - src/index/metadata-v2.js:232-246
- Task: Parameter contract for destructuring
  - Files to change/create:
    - src/lang/javascript/relations.js (collectPatternNames usage at ~201, 325)
    - src/lang/javascript/ast-utils.js (collectPatternNames at ~40-70)
    - src/lang/javascript/docmeta.js (params + returns extraction at ~1-40)
  - Call sites/line refs:
    - src/lang/javascript/relations.js:201, 325
    - src/lang/javascript/ast-utils.js:40-70
    - src/lang/javascript/docmeta.js:1-40
- Task: Call-site locations for JS + Python
  - Files to change/create:
    - src/lang/javascript/relations.js (callDetails push at ~413-418)
    - src/lang/python/ast-script.js (call_details append at ~435; output at ~604)
  - Call sites/line refs:
    - src/lang/javascript/relations.js:413-418
    - src/lang/python/ast-script.js:435, 604

### 10.3 Risk summaries (risk_summaries.jsonl + compact risk.summary)
- Files to change/create:
  - New: src/index/risk-interprocedural/summaries.js (buildRiskSummaries)
  - src/index/risk.js (optional: emit taintHints for argAware)
  - src/index/metadata-v2.js (embed compact summary into metaV2)
  - src/index/build/indexer/steps/relations.js (invoke builder and attach to chunks)
- Call sites/line refs:
  - src/index/risk.js:194-240 (detectRiskSignals entry point)
  - src/index/build/indexer/steps/relations.js:110-170 (cross-file stage hook)

### 10.4 Call-site sampling + call_sites.jsonl
- Files to change/create:
  - src/index/build/artifacts/writers/call-sites.js (from Phase 6; extend schema to include callSiteId + evidence)
  - src/shared/artifact-io/jsonl.js (required keys for call_sites)
  - src/lang/javascript/relations.js + src/lang/python/ast-script.js (location fields)
- Gaps/conflicts:
  - Phase 6 call_sites contract vs SPEC_risk_flows_and_call_sites_jsonl_v1_refined.md field names; reconcile now to avoid migration.

### 10.5 Propagation engine + risk_flows.jsonl
- Files to change/create:
  - New: src/index/risk-interprocedural/propagate.js (taint propagation engine)
  - src/index/type-inference-crossfile/pipeline.js (existing risk correlation at ~335-370; likely superseded or augmented)
  - src/index/build/indexer/steps/relations.js (call propagation after cross-file links)
- Call sites/line refs:
  - src/index/type-inference-crossfile/pipeline.js:335-370

### 10.6 Artifact writing + validation
- Files to change/create:
  - src/index/build/artifacts.js (emit risk_summaries.jsonl, call_sites.jsonl, risk_flows.jsonl, risk_interprocedural_stats.json)
  - src/contracts/schemas/artifacts.js (add schemas)
  - src/shared/artifact-io/jsonl.js (required keys)
  - src/index/validate.js + src/index/validate/presence.js (optional artifact validation)
- Call sites/line refs:
  - src/index/build/artifacts.js:380-401 (writer enqueue area)
  - src/contracts/schemas/artifacts.js:282-340
  - src/index/validate.js:76-95, 339-347

### 10.7 Explainability tooling (CLI) + docs
- Files to change/create:
  - src/retrieval/output/format.js (risk flows display at ~322-333)
  - src/retrieval/output/filters.js (riskFlow filtering at ~665-669)
  - docs/config-schema.json + docs/ (add indexing.riskInterprocedural schema + docs)
- Call sites/line refs:
  - src/retrieval/output/format.js:322-333
  - src/retrieval/output/filters.js:665-669

### 10.8 End-to-end tests + performance guardrails
- Files to change/create:
  - tests/risk/* (new fixtures and determinism tests)
  - tests/relations/* (call_sites + risk flows integration)

### Associated specs reviewed (Phase 10)
- docs/PH10_refined_implementation_plan.md
- docs/SPEC_risk_interprocedural_config_v1_refined.md
- docs/SPEC_risk_summaries_jsonl_v1_refined.md
- docs/SPEC_risk_flows_and_call_sites_jsonl_v1_refined.md
- docs/SPEC_risk_interprocedural_stats_json_v1_refined.md
- docs/spec_phase4_safe_regex_hardening.md (determinism expectations)

## Phase 10 addendum: dependencies, ordering, artifacts, tests, edge cases

### 10.1 Dependencies and order of operations
- Dependencies:
  - Config schema + runtime wiring must land before any artifact emission.
- Order of operations:
  1) Parse config and resolve caps.
  2) Gate execution (enabled/summaryOnly/emitArtifacts).
  3) Emit risk_interprocedural_stats even on early exit.

### 10.1 Acceptance criteria + tests (lane)
- tests/risk/config-defaults.test.js (test:unit)
- tests/risk/config-summary-only.test.js (test:unit)

### 10.1 Edge cases and fallback behavior
- risk disabled: emit stats with status=disabled, no risk_summaries/call_sites/risk_flows.

### 10.2 Dependencies and order of operations
- Dependencies:
  - Phase 6 call_sites contract and Phase 8 chunkUid must be available.
- Order of operations:
  1) Validate chunkUid and risk rule inputs.
  2) Validate callSites contract (if present) before flow generation.

### 10.2 Acceptance criteria + tests (lane)
- tests/validate/risk-contract-prereqs.test.js (test:services)

### 10.2 Edge cases and fallback behavior
- Missing chunkUid: strict mode fails; non-strict disables interprocedural pipeline.
- Fail-closed: never derive chunkUid from file::name or docId in risk flows.

### 10.3 Artifact row fields (risk_summaries.jsonl)
- risk_summaries row required keys (RiskSummariesRowV1_1):
  - schemaVersion, chunkUid, file, symbol.name, symbol.kind, sources, sinks, sanitizers, localFlows, limits
  - optional: chunkId, symbol.language, taintHints
- Caps (per spec defaults):
  - evidencePerSignal (default 3)
  - maxSignalsPerKind (default 50)
  - localFlows.rulePairs cap 50
  - taintHints.taintedIdentifiers cap 50
  - maxRowBytes 32768 (drop + record in stats)

### 10.3 Acceptance criteria + tests (lane)
- tests/risk/risk-summaries-emission.test.js (test:services)
- tests/validate/risk-summaries-schema.test.js (test:services)

### 10.3 Edge cases and fallback behavior
- No local risk signals: emit zero rows; stats reflects summariesEmitted=0.

### 10.4 Artifact row fields (call_sites.jsonl for risk)
- call_sites row required keys (CallSitesRowV1_1):
  - schemaVersion, callSiteId, callerChunkUid, calleeChunkUid, file,
    startLine, startCol, endLine, endCol, calleeName, argsSummary, snippetHash
- Caps (per spec defaults):
  - argsSummary length <= 5; each arg <= 80 chars (whitespace collapsed)
  - maxRowBytes 32768 (drop + record in stats)
  - maxCallSitesPerEdge = caps.maxCallSitesPerEdge

### 10.4 Acceptance criteria + tests (lane)
- tests/risk/call-sites-sampling.test.js (test:services)
- tests/risk/call-site-id-determinism.test.js (test:services)

### 10.4 Edge cases and fallback behavior
- Missing callsite location: set endLine/endCol to startLine/startCol when unknown.
- Snippet extraction fails: use fallback snippetHash from calleeName + argsSummary.
- Fail-closed: if callSiteId inputs are missing, drop the call_sites row and record in stats (no synthetic IDs).

### 10.5 Artifact row fields (risk_flows.jsonl)
- risk_flows row required keys (RiskFlowsRowV1_1):
  - schemaVersion, flowId, source, sink, path.chunkUids, path.callSiteIdsByStep, confidence, notes
- Caps (per spec defaults):
  - maxDepth, maxPathsPerPair, maxTotalFlows, maxCallSitesPerEdge
  - maxRowBytes 32768 (drop + record in stats)

### 10.5 Acceptance criteria + tests (lane)
- tests/risk/risk-flows-basic.test.js (test:services)
- tests/risk/risk-flows-referential-integrity.test.js (test:services)

### 10.5 Edge cases and fallback behavior
- Ambiguous edges: allow empty callSiteIdsByStep entries; do not drop the flow.
- cap hit: record in stats.capsHit and notes.capsHit.
- Fail-closed: if any referenced callSiteId does not exist, strict validation fails; non-strict drops the flow row and records in stats.

### 10.6 Dependencies and order of operations
- Dependencies:
  - 10.3/10.4/10.5 artifacts must be produced before validation.
- Order of operations:
  1) Emit artifacts.
  2) Emit stats with artifact refs.
  3) Validate referential integrity.

### 10.6 Acceptance criteria + tests (lane)
- tests/validate/risk-artifacts-integrity.test.js (test:services)

### 10.7 Dependencies and order of operations
- Dependencies:
  - risk_flows and call_sites must be emitted for explain output.
- Order of operations:
  1) Load risk_flows + call_sites.
  2) Join by callSiteId for explanations.
  3) Render CLI output.

### 10.7 Acceptance criteria + tests (lane)
- tests/risk/explain-cli-output.test.js (test:integration)

### 10.8 Acceptance criteria + tests (lane)
- tests/risk/end-to-end-risk-flow.test.js (test:services)
- tests/risk/perf-guardrails.test.js (test:perf)
- Unskip tag CheckAfterPhase10 in tests/run.config.jsonc; run test:ci

### 10.8 Edge cases and fallback behavior
- summaryOnly=true: emit risk_summaries only; call_sites/risk_flows counts must be zero and stats reflect summaryOnly.
- timed_out: emit stats with status=timed_out and zero flows/callSites.

## Fixtures list (Phase 10)

- tests/fixtures/risk/basic-flow
- tests/fixtures/risk/ambiguous-callsites
- tests/fixtures/risk/summary-only

## Compat/migration checklist (Phase 10)

- Risk interprocedural remains opt-in; default disabled.
- Local risk detector behavior unchanged; risk_summaries derived from existing docmeta.
- call_sites artifact must match Phase 6 contract (single shared artifact).

## Artifacts contract appendix (Phase 10)

- risk_summaries.jsonl
  - required keys: schemaVersion, chunkUid, file, symbol.name, symbol.kind, sources, sinks, sanitizers, localFlows, limits
  - optional keys: chunkId, symbol.language, taintHints
  - caps: evidencePerSignal, maxSignalsPerKind, maxRowBytes
- call_sites.jsonl (risk)
  - required keys: schemaVersion, callSiteId, callerChunkUid, calleeChunkUid, file,
    startLine, startCol, endLine, endCol, calleeName, argsSummary, snippetHash
  - caps: argsSummary length <= 5; arg length <= 80; maxRowBytes
- risk_flows.jsonl
  - required keys: schemaVersion, flowId, source, sink, path.chunkUids, path.callSiteIdsByStep, confidence, notes
  - caps: maxDepth, maxPathsPerPair, maxTotalFlows, maxRowBytes
- risk_interprocedural_stats.json
  - required keys: schemaVersion, generatedAt, status, effectiveConfig, counts, capsHit, timingsMs
  - optional keys: reason, artifacts, droppedRecords

