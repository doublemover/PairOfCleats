## Phase 6 -- Universal Relations v2 (Callsites, Args, and Evidence)

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

### Phase 6.1 -- CallDetails v2 and `call_sites` contract (schema + invariants)

- [x] Define a **CallSite (CallDetails v2)** record shape with bounded fields and deterministic truncation rules.
  - Contract fields (minimum viable, JS/TS-focused):
    - `callSiteId` (required; `sha1:` of `file:startLine:startCol:endLine:endCol:calleeRaw`)
    - `callerChunkUid` (stable string id; current code uses `metaV2.chunkId`)
    - `callerDocId` (optional integer doc id, for quick joins; not stable across builds)
    - `file` (container repo-relative path, POSIX)
    - `languageId` (effective language for this callsite; segments must use segment language)
    - `segmentId` (optional; debug-only)
    - `start`, `end` (absolute offsets in the _container_ file)
    - `startLine`, `startCol`, `endLine`, `endCol` (required; must agree with offsets when present)
    - `calleeRaw` (as written / best-effort string form)
    - `calleeNormalized` (best-effort normalized target name, e.g., leaf name)
    - `receiver` (best-effort; e.g., `foo` for `foo.bar()`; null when not applicable)
    - `args` (bounded list of arg summaries; see Phase 6.3)
    - `kwargs` (reserved; populate for languages that support named args, e.g., Python)
    - `confidence` (bounded numeric or enum; must be deterministic)
    - `evidence` (bounded list of short tags/strings; deterministic ordering)
  - Enforce hard caps (examples; choose concrete values and test them):
    - max args per callsite: 5
    - max arg text length: 80
    - max nested shape depth: 2
    - max evidence items: 6
    - max evidence item length: 32
    - max row bytes: 32768
  - Deterministic truncation must use a consistent marker (`...`) and must not depend on runtime/platform.
- [x] Add schema validation for `call_sites` entries.
  - Touchpoints:
    - `src/shared/artifact-schemas.js` (AJV validators)
    - `src/index/validate.js` (wire validation when artifact is present)
  - Notes:
    - Keep schema permissive enough for forward evolution, but strict on required invariants and field types.
    - Ensure identity fields are unambiguous: distinguish **doc id** vs **stable chunk uid** (avoid reusing "chunkId" for both).
- [x] Update documentation for the new contract.
  - Touchpoints:
    - `docs/contracts/artifact-contract.md` (artifact inventory + semantics)
    - If needed: `docs/specs/metadata-schema-v2.md` (to clarify identity fields used for joins)
  - Include at least one example callsite record for JS and TS.

#### Tests / Verification

- [x] Add a schema test that validates a representative `call_sites` entry (including truncation edge cases).
- [x] Add a "reject bad contract" test case (missing required fields, wrong types, oversized fields).
- [ ] Verify that validation runs in CI lanes that already validate artifact schemas.

---

### Phase 6.2 -- Emit `call_sites` as a first‑class, sharded JSONL artifact (meta + manifest)

- [x] Implement a dedicated writer for `call_sites` that is sharded by default.
  - Touchpoints:
    - `src/index/build/artifacts.js` (enqueue the writer in the build)
    - `src/index/build/artifacts/writers/` (new `call-sites.js`)
    - `src/shared/json-stream.js` and/or `src/shared/artifact-io.js` (shared helpers; reuse existing patterns)
  - Output shape (recommended):
    - `pieces/call_sites/meta.json` (counts, shard size, formatVersion, etc.)
    - `pieces/call_sites/part-000.jsonl`, `part-001.jsonl`, ... (entries)
  - Writer requirements:
    - Deterministic shard ordering and deterministic within-shard ordering.
    - Streaming write path (avoid holding all callsites in memory when possible).
    - Compression behavior should follow existing artifact conventions (if used elsewhere).
- [x] Inventory `call_sites` in the manifest and ensure manifest-driven discovery.
  - `call_sites` must be discoverable via `pieces/manifest.json` (no directory scanning / filename guessing in readers).
- [x] Wire validator support for `call_sites`.
  - Touchpoints:
    - `src/index/validate.js`
  - Validation behavior:
    - If present, validate (fail closed).
    - If absent, do not fail; the graph builder must fall back cleanly (Phase 6.5).
- [x] Decide and document the compatibility posture for existing relations artifacts.
  - Recommended:
    - Keep existing lightweight relations (e.g., `callLinks`) intact for backward compatibility.
    - Do **not** bloat `file_relations` with full callsite evidence; `call_sites` is the dedicated "large" artifact.

#### Tests / Verification

- [?] Add an artifact-format test that builds an index and asserts:
  - [?] `call_sites` parts + meta exist when relations are enabled.
  - [x] `pieces/manifest.json` includes the `call_sites` piece(s).
  - [?] Validation passes for `call_sites`.
- [ ] Add a determinism test that rebuilds twice and asserts the `call_sites` content is byte-identical (or at least line-identical) for a fixed fixture repo.

---

### Phase 6.3 -- JS + TS callsite extraction with structured args (CallDetails v2)

- [x] Upgrade JavaScript relations extraction to emit CallDetails v2 fields needed by `call_sites`.
  - Touchpoints:
    - `src/lang/javascript/relations.js`
  - Requirements:
    - Capture callsite `start/end` offsets (range) and `startLine/endLine` (from `loc`) for each call expression.
    - Provide `calleeRaw`, `calleeNormalized`, and `receiver` where applicable:
      - e.g., `foo.bar()` → `calleeRaw="foo.bar"`, `calleeNormalized="bar"`, `receiver="foo"`
    - Emit a bounded, deterministic arg summary (`args`):
      - minimum: arity + "simple literal flags" (string/number/bool/null/object/array/function/spread/identifier)
      - must never include unbounded text (cap string literal previews, object literal previews, etc.)
    - Maintain compatibility for existing consumers that read `callDetails.args` today:
      - either provide a backwards-compatible view, or update consumers in Phase 6.5.
- [x] Upgrade TypeScript relations extraction to produce call details (not just regex call edges).
  - Touchpoints:
    - `src/lang/typescript/relations.js`
    - Babel parsing helpers (e.g., `src/lang/babel-parser.js`)
  - Requirements:
    - Use an AST-based extraction path (Babel) to capture args + locations.
    - Respect TSX/JSX where appropriate (see Phase 6.4 for segment language fidelity hooks).
- [x] Ensure language handlers expose call details consistently through the language registry.
  - Touchpoints:
    - `src/index/language-registry/registry.js` (relations plumbing expectations)
  - Notes:
    - Keep output consistent across JS and TS so downstream systems can be language-agnostic.

#### Tests / Verification

- [x] Add a JS fixture with:
  - [x] free function call
  - [x] method call (`obj.method()`)
  - [x] nested call (`fn(a(b()))`)
  - [x] spread args and literal args
  - [x] Assert extracted callsites include expected `calleeNormalized`, receiver (when applicable), and bounded arg summaries.
- [x] Add a TS fixture (and a TSX/JSX fixture if feasible) with:
  - [x] typed function call
  - [x] optional chaining call (if supported by parser)
  - [x] generic call (if supported)
  - [x] Assert callsite locations + args are extracted.

---

### Phase 6.4 -- Segment-safe absolute positions, chunk attribution, and deterministic ordering

- [x] Ensure callsite positions are **absolute offsets in the container file** (segment-safe).
  - Touchpoints (depending on where translation is implemented):
    - `src/index/build/file-processor.js` (segment discovery + per-segment dispatch)
    - `src/index/segments.js` (language normalization/fidelity)
    - Language relation extractors (if they run on segment text)
  - Requirements:
    - If callsite extraction is performed on a segment slice, translate:
      - `absStart = segment.start + segStart`
      - `absEnd = segment.start + segEnd`
    - `segmentId` may be recorded for debugging, but offsets must not depend on it.
- [x] Attribute each callsite to the correct caller chunk **without relying on name-only joins**.
  - Touchpoints:
    - `src/index/build/file-processor/relations.js` (call index construction)
    - `src/index/language-registry/registry.js` (chunk relation attachment)
  - Requirements:
    - Prefer range containment (callsite offset within chunk start/end), selecting the smallest/innermost containing chunk deterministically.
    - If containment is ambiguous or no chunk contains the callsite, record the callsite with `callerChunkUid = null` only if the contract permits it; otherwise attach to a deterministic "file/module" pseudo-caller (choose one approach and document it).
- [x] Fix segment language fidelity issues that would break JS/TS/TSX call extraction for embedded segments.
  - Touchpoints:
    - `src/index/segments.js` (do not collapse `tsx→typescript` or `jsx→javascript` if it prevents correct tooling selection)
    - `src/index/build/file-processor/tree-sitter.js` (ensure embedded TSX/JSX segments can select the correct parser when container ext differs)
  - If full segment-as-virtual-file semantics are not yet implemented, explicitly defer the broader contract work to **Phase 7 -- Segment-Aware Analysis Backbone & VFS**, but Phase 6 must still support segment callsite offset translation for the JS/TS fixtures included in this phase.
- [x] Define and enforce deterministic ordering for callsites prior to writing.
  - Canonical sort key (recommended):
    - `file`, `callerChunkUid`, `start`, `end`, `calleeNormalized`, `calleeRaw`
  - Ensure ties are broken deterministically (no stable-sort assumptions across runtimes).

#### Tests / Verification

- [x] Add a container/segment fixture (e.g., `.vue` with `<script>` block or `.md` with a fenced TSX block) and assert:
  - [x] extracted callsite `start/end` positions map correctly to the container file
  - [x] `languageId` reflects the embedded language, not the container file type
- [x] Add a determinism test ensuring callsite ordering is stable across rebuilds.

---

### Phase 6.5 -- Graph integration and cross-file linking (prefer `call_sites`, eliminate `file::name` reliance)

- [ ] Produce `call_sites` entries that carry resolved callee identity when it is uniquely resolvable.
  - Touchpoints:
    - `src/index/type-inference-crossfile/pipeline.js` (symbol resolution / linking)
    - `src/index/build/indexer/steps/relations.js` (where cross-file inference is orchestrated)
  - Requirements:
    - Add `targetChunkUid` (and optional `targetDocId`) when the callee can be resolved uniquely.
    - If resolution is ambiguous:
      - record bounded `targetCandidates` (or similar) and keep `targetChunkUid=null`
      - never silently drop the callsite edge
    - If resolution requires a full SymbolId contract, defer that strengthening to **Phase 8 -- Symbol Identity v1**, but Phase 6 must still remove _required_ reliance on `file::name` uniqueness.
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
    - docs/contracts/artifact-schemas.md already lists call_sites, but schema registry lacks it (doc/code drift).
    - docs/specs/risk-flows-and-call-sites.md (Phase 10) defines call_sites fields; align naming now to avoid later rename churn.
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
    - docs/contracts/artifact-contract.md (artifact inventory + examples)
    - docs/contracts/artifact-schemas.md (Phase 6 additions already mention call_sites; ensure field list is explicit)
    - docs/specs/metadata-schema-v2.md (already notes call_sites at line ~138; ensure it stays "not in metaV2")
  - Call sites/line refs:
    - docs/specs/metadata-schema-v2.md:138
  - Gaps/conflicts:
    - docs/contracts/artifact-schemas.md references docs/specs/risk-flows-and-call-sites.md; ensure Phase 6 contract matches that spec's required keys.
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
    - src/index/build/artifacts/writers/call-sites.js (sort by file/callerChunkUid/start/end etc)
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
  - callSiteId
  - callerChunkUid
  - file
  - languageId
  - start
  - end
  - startLine
  - startCol
  - endLine
  - endCol
  - calleeRaw
  - calleeNormalized
  - args
- call_sites row (optional keys):
  - callerDocId, segmentId, receiver, kwargs, confidence, evidence, snippetHash
  - targetChunkUid, targetDocId, targetCandidates (added in 6.5 when resolution is available)
- Caps (set explicit defaults in schema/tests):
  - maxArgsPerCall (recommended: 5)
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
  - required keys: callSiteId, callerChunkUid, file, languageId, start, end, startLine, startCol, endLine, endCol,
    calleeRaw, calleeNormalized, args
  - optional keys: callerDocId, segmentId, receiver, kwargs, confidence, evidence, snippetHash,
    targetChunkUid, targetDocId, targetCandidates
  - caps: maxArgsPerCall, maxArgTextLen, maxArgDepth, maxEvidenceItems, maxEvidenceTextLen, maxRowBytes
- call_sites_meta (json)
  - required keys: schemaVersion, artifact="call_sites", format="jsonl-sharded", generatedAt, compression,
    totalRecords, totalBytes, maxPartRecords, maxPartBytes, targetMaxBytes, parts[]
  - parts[] required keys: path, records, bytes (checksum optional)


