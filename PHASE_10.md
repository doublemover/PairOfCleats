## Phase 10 -- Interprocedural Risk Flows (taint summaries + propagation)

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
    - [ ] cap each arg to 80 chars with `...`

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
    - [ ] Fill each flow's `callSiteIdsByStep` from call-site sampling results.

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
  - [ ] Ensure artifacts are registered as "pieces" so they appear in `pieces/manifest.json`.

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

# Appendix A -- Risk Interprocedural Config Spec (v1 refined)

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
    "riskInterprocedural": { /* ... */ }
  }
}
```

> Note: PairOfCleats currently validates `.pairofcleats.json` against `docs/config/schema.json`, which does not yet include `indexing.*`. If/when user-configurable exposure is desired, the schema MUST be expanded accordingly. The implementation MUST still accept the config when it is provided programmatically (tests, internal wiring, or future schema expansion).

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
2. Interprocedural risk MUST NOT change the local risk detector's regex ruleset or caps, other than enabling cross-file linking (§4.2) and emitting additional artifacts.

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
  * The implementation SHOULD still write the stats artifact (it is tiny and aids observability), unless explicitly disabled by higher-level "no artifacts" settings.
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

1. Identifier-boundary matching against the caller's current taint identifier set (tainted params + locally-tainted variables), **OR**
2. Matching any configured **source rule regex** from the same local risk ruleset used by the local detector (covers direct source expressions like `req.body.userId`).

The implementation MUST:
1. Track a bounded taint identifier set per traversal state.
2. Use identifier-boundary matching (no naive substring matches).
3. When traversing to the callee, derive the callee's initial taint identifier set by mapping tainted argument positions to callee parameter names.

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
`caps.maxMs` is a **fail-safe** for flow propagation only. It MUST NOT produce "first N flows" based on runtime speed.

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
* `docs/specs/risk-interprocedural-stats.md`

# Appendix B -- risk_summaries.jsonl Spec (v1 refined)

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

This artifact is intentionally "summary-level": it does **not** attempt to encode full dataflow graphs.

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
  * ...

The meta sidecar MUST follow the same shape used by existing sharded JSONL artifacts (e.g., `chunk_meta.meta.json`, `graph_relations.meta.json`):
* `format: "jsonl"`
* `shardSize` (bytes)
* `partsDir`, `partPrefix`, `parts[]`, `counts[]`
* `totalEntries`, `totalBytes`
* `schemaVersion` (for the rows, i.e., this spec's versioning)

## 3) Identity model
Each row is keyed by `chunkId`:

* `chunkId` MUST match `src/index/chunk-id.js` output and `chunk.metaV2.chunkId`.

Normative constraints:
* There MUST be at most one row per `chunkId`.
* `file` MUST be a repo-relative POSIX path (forward slashes), matching the chunk's `file`.

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

For each signal's evidence list:
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

# Appendix C -- risk_flows.jsonl + call_sites.jsonl Spec (v1 refined)

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
* or `<name>.meta.json` + `<name>.parts/...`

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
  * capped at **80** characters (truncate with `...`)

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

### 7.2 What is a "source root"
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
Define a chunk as "sanitizer-bearing" if its summary contains at least one sanitizer signal.

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
* A "pair" for `maxPathsPerPair` is:
  `(sourceChunkId, sourceRuleId, sinkChunkId, sinkRuleId)`

A "distinct path" is:
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

#### 8.2.2 When an argument is "tainted"
Given a call-site `argsSummary[]`, an argument is considered tainted if either:
1. It identifier-matches any identifier in the caller's taint set (identifier-boundary match), OR
2. It matches any configured **source rule regex** from the local risk ruleset (the same rules used by the local detector).

(2) ensures direct source expressions like `req.body.userId` can be recognized even without local assignment hints.

#### 8.2.3 Traversing an edge and deriving callee taint
For a resolved edge `(caller → callee)`, consider its sampled call sites.

The edge is traversable if **any** sampled call site yields at least one tainted argument under §8.2.2.

When traversing, the callee's next taint set MUST be derived as:
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

# Appendix D -- risk_interprocedural_stats.json Spec (v1 refined)

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

This avoids "hidden failure" where flows are missing but users cannot tell why.

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

# Appendix E -- Phase 10 Refined Implementation Notes (source)

# Phase 10 (Interprocedural Risk Flows) -- Refined Implementation Plan (PairOfCleats)

## 1) Purpose
Phase 10 extends PairOfCleats' current **intra-chunk** risk detection to **interprocedural** (cross-function) risk paths by:

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
3. **Minimal coupling**: interprocedural risk flows must not "accidentally" enable type inference or tooling.
4. **Joinability**: all artifacts must share stable IDs to enable joins without heuristics.

## 4) Key decisions (resolve ambiguity)

### D1 -- Canonical identity for symbols and edges
**Decision:** Use `chunk.metaV2.chunkId` as the canonical symbol identifier.

*Why this is best:* `chunkId` already encodes `(file, segmentId, range, kind, name)` via `src/index/chunk-id.js`, avoiding ambiguity when `(file,name)` collides.

**Edge identity:** `edgeId = sha1("${callerChunkId}->${calleeChunkId}")`.

### D2 -- Storage strategy
**Decision:** Store *compact* summary fields inline on each chunk **and** emit full JSONL artifacts.

* Inline: `chunk.docmeta.risk.summary` and `chunk.metaV2.risk.summary` (compact + capped).
* Artifacts: `risk_summaries.jsonl`, `risk_flows.jsonl`, and `call_sites.jsonl`.

*Why this is best:* inline summary supports fast retrieval and ranking without reading large JSONL; JSONL supports validation, bulk analysis, and explainability.

### D3 -- Call-site evidence strategy
**Decision:** Preserve multiple call-sites per edge in a **separate** `call_sites.jsonl` artifact and reference them by `callSiteId` from flows.

*Why this is best:* avoids `chunk_meta` bloat; keeps call-site samples bounded and reusable across multiple flows.

### D4 -- Capping and time budgets
**Decision:** Do **not** allow time budgets to create partially-different outputs.

* Use structural caps (`maxDepth`, `maxPathsPerSourceSink`, `maxTotalFlows`, `maxCallSitesPerEdge`).
* If an optional `maxMs` guard is enabled and is exceeded:
  * abort propagation entirely and emit a single deterministic `analysisStatus: "timed_out"` record (no partial flows), or
  * record `analysisStatus: "timed_out"` and write **zero** `risk_flows` rows.

*Why this is best:* preserves strict determinism.

### D5 -- Strictness modes
**Decision:** Implement strictness as:

* `conservative` (default): summary-level propagation; no arg->param taint mapping.
* `argAware` (opt-in): only enabled if parameter contracts exist; supports arg->param mapping.

*Why this is best:* incremental correctness; avoids claiming precision we can't support.

## 5) Implementation plan (step-by-step)

### Step 1 -- Add config surface + runtime flags
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

...but keep `enableTypeInference` and `enableRiskCorrelation` false unless explicitly enabled.

### Step 2 -- Fix parameter/return contracts (prerequisite for summaries)
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
* For destructured params: use `arg0`, `arg1`, ... and store `bindings` separately.

**Return types:**
* Treat `docmeta.returnType` (string) as canonical.
* Treat `docmeta.returns` boolean as **documentation presence only** and ignore it for type/risk propagation.

### Step 3 -- Implement RiskSummary builder
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

### Step 4 -- Add call-site payload fields (JS + Python)
**Files:**
* `src/lang/javascript/relations.js`
* `src/lang/python/relations.js`

**Add fields to each `callDetails` entry:**
* `file`, `startLine`, `endLine`, `startCol`, `endCol`
* `calleeName`
* `argsSummary` (truncated)
* `snippetHash` (sha1 of normalized snippet)

**Important:** call-site extraction must be stable and deterministic.

### Step 5 -- Preserve call-site samples per call edge
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

...and store `call_sites.jsonl` rows globally.

### Step 6 -- Implement propagation engine
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

### Step 7 -- Integrate into build pipeline
**File:** `src/index/build/indexer/steps/relations.js`

Insert after `applyCrossFileInference(...)` and before final write:

1. `buildRiskSummaries(...)`
2. if `!summaryOnly`: `propagateRiskFlows(...)`
3. rebuild `metaV2` for all chunks (finalization)

### Step 8 -- Artifact writing + validation
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

### Step 9 -- Retrieval/UX surfacing
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
  - Phase 6 call_sites contract vs docs/specs/risk-flows-and-call-sites.md field names; reconcile now to avoid migration.

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
  - docs/config/schema.json + docs/ (add indexing.riskInterprocedural schema + docs)
- Call sites/line refs:
  - src/retrieval/output/format.js:322-333
  - src/retrieval/output/filters.js:665-669

### 10.8 End-to-end tests + performance guardrails
- Files to change/create:
  - tests/risk/* (new fixtures and determinism tests)
  - tests/relations/* (call_sites + risk flows integration)

### Associated specs reviewed (Phase 10)
- docs/phases/phase-10/implementation-plan.md
- docs/specs/risk-interprocedural-config.md
- docs/specs/risk-summaries.md
- docs/specs/risk-flows-and-call-sites.md
- docs/specs/risk-interprocedural-stats.md
- docs/phases/phase-4/safe-regex-hardening.md (determinism expectations)

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


