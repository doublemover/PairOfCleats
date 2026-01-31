# PairOfCleats GigaRoadmap

    ## Status legend
    
    Checkboxes represent the state of the work, update them to reflect the state of work as its being done:
    - [x] Implemented and appears complete/correct based on code inspection and existing test coverage
    - [@] In Progress, this work has been started
    - [.] Work has been completed but has Not been tested
    - [?] There is a correctness gap **or** there is missing/insufficient test proving behavior
    - [ ] Not complete
    
    Completed Phases: `COMPLETED_PHASES.md`

### Source-of-truth hierarchy (when specs disagree)
When a document/spec conflicts with the running code, follow this order:

1) **`src/contracts/**` and validators** are authoritative for artifact shapes and required keys.
2) **Current implementation** is authoritative for runtime behavior *when it is already validated by contracts/tests*.
3) **Docs** (`docs/contracts/**`, `docs/specs/**`, `docs/phases/**`) must be updated to match (never the other way around) unless we have a deliberate migration plan.

If you discover a conflict:
- **Prefer "fix docs to match code"** when the code is already contract-validated and has tests.
- **Prefer "fix code to match docs/contracts"** only when the contract/validator is explicit and the code violates it.

### Touchpoints + line ranges (important: line ranges are approximate)
This document includes file touchpoints with **approximate** line ranges like:

- `src/foo/bar.js` **(~L120-L240)**  -  anchor: `someFunctionName`

Line numbers drift as the repo changes. Treat them as a **starting hint**, not a hard reference.
Always use the **anchor string** (function name / constant / error message) as the primary locator.

### Tests: lanes + name filters (use them aggressively)
The repo has a first-class test runner with lanes + filters:

- Runner: `npm test` (alias for `node tests/run.js`)
- List lanes/tags: `npm test -- --list-lanes` / `npm test -- --list-tags`
- Run a lane: `npm run test:unit`, `npm run test:integration`, `npm run test:services`, etc.
- Filter by name/path (selectors):  
  - `npm test -- --match risk_interprocedural`  
  - `npm run test:unit -- --match chunk-uid`  
  - `npm run test:integration -- --match crossfile`

**Lane rules are defined in:** `tests/run.rules.jsonc` (keep new tests named/placed so they land in the intended lane).

### Deprecating spec documents: archive policy (MANDATORY)
When a spec/doc is replaced (e.g., a reconciled spec supersedes an older one):

- **Move the deprecated doc to:** `docs/archived/` (create this folder if missing).
- Keep a short header in the moved file indicating:
  - what replaced it,
  - why it was deprecated,
  - the date/PR.
- Add/update the repository process in **`AGENTS.md`** so future agents follow the same archival convention.

This roadmap includes explicit tasks to enforce this process (see Phase 10 doc merge).

---


## Roadmap Table of Contents
> **Reminder:** This list is a navigational summary. The authoritative implementation details live in the phase bodies below.

- **Phase 10 - Interprocedural risk propagation + explainability artifacts**
  - Source-of-truth decisions + conflicts resolved
  - 10.0 - Documentation merge + canonical spec cleanup (FOUNDATION)
  - 10.1 - Config wiring + runtime gating (FOUNDATION)
  - 10.2 - Data model + param name stabilization for arg-aware mode (FOUNDATION)
  - 10.3 - Risk summaries (artifact + compact docmeta)
  - 10.4 - Shared callsite utilities (FOUNDATION)
  - 10.5 - Interprocedural propagation -> `risk_flows`
  - 10.6 - Artifact writing + contracts + manifest integration
  - 10.7 - Validation + referential integrity
  - 10.8 - CLI: explain interprocedural risk flows
  - 10.9 - Cross-cutting robustness improvements (recommended)
  - Phase 10 completion checklist

---

## Phase 10 - Interprocedural risk propagation + explainability artifacts

**Goal:** Add a deterministic, capped, explainable *interprocedural* risk propagation system for the **code** index mode that:
- Reuses existing **local** risk signals (`docmeta.risk` from `src/index/risk.js`).
- Reuses existing **cross-file inference** call resolution (`applyCrossFileInference`), specifically `callDetails[].targetChunkUid`.
- Emits **new artifacts**:
  - `risk_summaries*.jsonl` (+ shard meta)
  - `risk_flows*.jsonl` (+ shard meta)
  - `risk_interprocedural_stats.json`
- Adds a compact, low-bytes **`docmeta.risk.summary`** for each risk-relevant chunk (to support fast display/filtering without scanning JSONL).
- Provides a CLI to explain the flows in an index (`pairofcleats risk explain ...`).

---

### Source-of-truth decisions + conflicts resolved 

This phase touches multiple "specs" that are currently **not aligned** with the repo's implemented contracts. Implement the *best* functionality **and** remove ambiguity by making these explicit choices.

#### A) `call_sites.jsonl` schema: **CODE contract is authoritative**
- **Authoritative schema:** `src/contracts/schemas/artifacts.js` (`call_sites` entry schema)
- **Writer:** `src/index/build/artifacts/writers/call-sites.js`

The older spec `docs/specs/risk-flows-and-call-sites.md` contains a *different* `call_sites` row shape (e.g., `calleeName`, `argsSummary`, no `start/end offsets`, etc.). That spec is **out of date** for `call_sites`.

**Choice:** Do **not** change the repo's `call_sites` contract to match the spec.  
**Action:** Update the *documents/specs* to match the code contract (see **10.0 Doc merge**).

**Why:** `call_sites` already exists, is validated by contracts/tests, and is used for call graph evidence. The safest and most correct approach is to treat the implemented contract as the single source of truth and bring docs into alignment.

#### B) `callSiteId` algorithm: **keep the existing implementation; update newer docs**
- **Actual implementation:** `buildCallSiteId(...)` in `src/index/build/artifacts/writers/call-sites.js`
- **Doc (currently aligned with code):** `docs/specs/risk-callsite-id-and-stats.md`
- **Doc (currently NOT aligned with code):** `docs/new_docs/risk-callsite-id-and-stats_IMPROVED.md` (it proposes a different string-to-hash recipe)

**Choice:** Keep the current algorithm (colon-separated parts, no `callsite:v1` prefix).  
**Action:** Update the "IMPROVED" doc during merge (or explicitly label it as a future v2) so docs do not contradict working code.

**Why:** Changing `callSiteId` would silently invalidate any stored references and degrade determinism across builds. We can introduce a versioned v2 later **only** if we add an explicit `callSiteIdVersion`/`schemaVersion` surface.

#### C) Config surface conflict: "repo config contract" vs Phase 10 config keys
- `docs/config/contract.md` suggests a narrow public config surface.
- Phase 10's specs and roadmap require `indexing.riskInterprocedural`.

**Choice (best for engineering velocity + testability):** Treat `indexing.riskInterprocedural` as an **internal/advanced** indexing knob and explicitly preserve it through config load/normalization.  
**Action:** Update `tools/dict-utils/config.js` normalization to keep `indexing.riskInterprocedural` (and any prerequisite knobs used by runtime gating), and update docs so the contract vs internal knobs are clearly delineated.

**Why:** Interprocedural risk is *expensive* and must be opt-in. The least invasive, most explicit opt-in is a config knob. If the product wants a narrower public contract later, it can gate exposure without deleting the internal setting.

---

## 10.0 Documentation merge + canonical spec cleanup (FOUNDATION - do first)

> **Objective:** Eliminate spec drift *before* implementation.

### 10.0.1 Merge/replace outdated specs with reconciled versions
Files involved (read all, then produce a merged canonical set):

- Canonical targets (should live under `docs/specs/`):
  - [ ] `docs/specs/risk-interprocedural-config.md`
  - [ ] `docs/specs/risk-summaries.md`
  - [ ] `docs/specs/risk-flows-and-call-sites.md`
  - [ ] `docs/specs/risk-callsite-id-and-stats.md`
  - [ ] `docs/specs/risk-interprocedural-stats.md` (currently placeholder)

- Sources to merge in (from `docs/new_docs/`):
  - [ ] `spec_risk-interprocedural-config_IMPROVED.md`
  - [ ] `spec_risk-summaries_IMPROVED.md`
  - [ ] `spec_risk-flows-and-call-sites_RECONCILED.md`
  - [ ] `risk-callsite-id-and-stats_IMPROVED.md`
  - [ ] `interprocedural-state-and-pipeline_DRAFT.md`

**Tasks (required, no ambiguity):**
- [ ] Merge canonical specs in `docs/specs/` using the sources above (see Doc merge checklist at end of Phase 10).
- [ ] Update the **`call_sites` schema section** in `risk-flows-and-call-sites.md` to explicitly say:
  - [ ] Call sites are the existing artifact contract in `src/contracts/schemas/artifacts.js`.
  - [ ] For interprocedural risk, we only require a subset of fields (list them), but the artifact may contain superset fields.
- [ ] Ensure the **`callSiteId` algorithm** section matches `buildCallSiteId` in `call-sites.js` (use `calleeRaw`, not `calleeName`).
- [ ] Reconcile **risk summaries schema**: incorporate stronger evidence shape (start/end line+col) and keep truncation/caps guidance. Resolve any mismatched field names (see 10.3 for the implemented schema).
- [ ] Reconcile **risk flows schema**: keep the roadmap's detailed schema (source+sink endpoints, path with `chunkUids` + `callSiteIdsByStep`, confidence, notes). Update any new_docs schema to match.
- [ ] Make **stats schema** explicit about what callSitesEmitted means:
  - [ ] Define as unique callSiteIds referenced by emitted `risk_flows` (not total rows in call_sites).
- [ ] Remove outdated statements (e.g., docs/config/schema.json doesn't include indexing.).

### 10.0.2 Add Spec status table inside Phase 10 docs
Create a small table (in whichever canonical spec is most appropriate, or at the top of this Phase 10 section) showing:

- [ ] spec file -> implemented-by code module -> status (implemented / draft / planned)
- [ ] version numbers (schemaVersion) and compatibility notes

**Tasks**
- [ ] Add the status table to the canonical spec (or Phase 10 header).
- [ ] Include schemaVersion and a compatibility note: **no back-compat; old indexes should error with a rebuild instruction**.


### 10.0.3 Archive deprecated specs + codify the process (MANDATORY)

This implements the repo-wide rule:

> Deprecated/replaced spec documents must be moved to `docs/archived/` (never deleted), and the process must be documented in `AGENTS.md`.

**Tasks**
- [ ] Create `docs/archived/README.md` explaining:
  - [ ] what belongs here,
  - [ ] how to name/archive files,
  - [ ] how to reference the replacement spec.
- [ ] Create `docs/archived/phase-10/` (or `docs/archived/specs/phase-10/`) as the destination for Phase 10 spec deprecations.
- [ ] After the merges in **10.0.1** are complete:
  - [ ] Move the *staging* source docs from `docs/new_docs/` that are no longer meant to be edited:
    - [ ] `docs/new_docs/spec_risk-interprocedural-config_IMPROVED.md`
    - [ ] `docs/new_docs/spec_risk-summaries_IMPROVED.md`
    - [ ] `docs/new_docs/spec_risk-flows-and-call-sites_RECONCILED.md`
    - [ ] `docs/new_docs/risk-callsite-id-and-stats_IMPROVED.md`
    - [ ] `docs/new_docs/interprocedural-state-and-pipeline_DRAFT.md`
    - [ ] Destination: `docs/archived/phase-10/` (keep filenames intact).
  - [ ] Add a short "DEPRECATED" header block to each moved file that points to the canonical replacement(s) in `docs/specs/...`.
- [ ] Update **`AGENTS.md`** with a "Spec deprecation + archival process" section:
  - [ ] When to archive vs update-in-place.
  - [ ] Required metadata to include in the archived file header (replacement link + date/PR).
  - [ ] A reminder that contracts (`src/contracts/**`) remain authoritative and specs must track them.

**Why this is required**
- `docs/new_docs/` is a staging area; leaving parallel variants creates drift and confusion.
- `docs/archived/` preserves context without keeping multiple "active" specs.


---

## 10.1 Config wiring + runtime gating (FOUNDATION - do before any propagation code)

### 10.1.0 Authoritative config keys (single source of truth)
**These keys are canonical. Use these exact names everywhere in Phase 10 and specs.**

**Tasks**
- [ ] Document the authoritative keys list in Phase 10 and in `docs/specs/risk-interprocedural-config.md`.
- [ ] Update any downstream task/test references to use these exact key names (no aliases).

**Authoritative keys**
- `indexing.riskInterprocedural.enabled`
- `indexing.riskInterprocedural.summaryOnly`
- `indexing.riskInterprocedural.strictness`
- `indexing.riskInterprocedural.sanitizerPolicy`
- `indexing.riskInterprocedural.emitArtifacts`
- `indexing.riskInterprocedural.caps.maxDepth`
- `indexing.riskInterprocedural.caps.maxPathsPerPair`
- `indexing.riskInterprocedural.caps.maxTotalFlows`
- `indexing.riskInterprocedural.caps.maxCallSitesPerEdge`
- `indexing.riskInterprocedural.caps.maxEdgeExpansions`
- `indexing.riskInterprocedural.caps.maxMs`

### 10.1.1 Add risk interprocedural config normalizer
**New file:** `src/index/risk-interprocedural/config.js`

Export:
- [ ] `normalizeRiskInterproceduralConfig(raw, { mode })`

Inputs:
- [ ] `raw` comes from `runtime.indexingConfig.riskInterprocedural` (or `{}`).

Output (**effective config**; use these defaults unless the merged spec dictates otherwise):
```js
{
  enabled: false,                 // hard gate
  summaryOnly: false,             // if true: summaries + compact docmeta only, no propagation, no risk_flows
  strictness: 'conservative',     // 'conservative' | 'argAware'
  sanitizerPolicy: 'terminate',   // 'terminate' | 'weaken'
  emitArtifacts: 'jsonl',         // 'none' | 'jsonl'  (accept legacy aliases: 'off' -> 'none')
  caps: {
    maxDepth: 4,
    maxPathsPerPair: 3,
    maxTotalFlows: 5000,
    maxCallSitesPerEdge: 3,
    maxEdgeExpansions: 200000,    // global cap on edge traversals (prevents explosion even if flows are capped)
    maxMs: 2500                   // wall clock budget; null disables
  }
}
```

**Normalization rules (MUST be deterministic):**
- [ ] `emitArtifacts`: accept `off|none` -> `none`, `jsonl` -> `jsonl`. Anything else -> default `jsonl`.
- [ ] `strictness`: unknown -> `conservative`
- [ ] `sanitizerPolicy`: unknown -> `terminate`
- [ ] numeric caps:
  - [ ] coerce to integers
  - [ ] clamp to sane ranges (define in code):
    - [ ] `maxDepth`: 1..20
    - [ ] `maxPathsPerPair`: 1..50
    - [ ] `maxTotalFlows`: 0..1_000_000
    - [ ] `maxCallSitesPerEdge`: 1..50
    - [ ] `maxEdgeExpansions`: 10_000..10_000_000
    - [ ] `maxMs`: null OR 10..60_000
- [ ] `summaryOnly=true` forces "no flows" even if other caps allow.
- [ ] If `enabled=false`, downstream code must treat the entire feature as disabled and avoid any heavy compute.

### 10.1.2 Preserve config keys through repo config normalization
**File:** `tools/dict-utils/config.js`  
Function: `normalizeUserConfig(config)`

Today this function intentionally narrows the public config surface. For Phase 10 to be operable and testable, we must preserve:

- `config.indexing.riskInterprocedural` (entire nested object)

**Implementation requirement:**
- [ ] Add `riskInterprocedural: indexingConfig.riskInterprocedural || undefined` under the returned `indexing` object.
- [ ] Keep it **as-is** (no normalization here); normalization is done in `src/index/risk-interprocedural/config.js`.

Also preserve any prerequisite knobs *already used by runtime* and referenced by specs (only if they are currently being dropped):
- [ ] `indexing.riskAnalysis` (if you want it configurable)
- [ ] `indexing.riskAnalysisCrossFile`
- [ ] `indexing.typeInferenceCrossFile`

If the project intentionally keeps these non-configurable, document that clearly in the merged specs and do not add them.

### 10.1.3 Wire effective config into build runtime
**File:** `src/index/build/runtime/runtime.js`

Tasks:
- [ ] Import `normalizeRiskInterproceduralConfig`.
- [ ] Compute:
  - [ ] `const riskInterproceduralConfig = normalizeRiskInterproceduralConfig(indexingConfig.riskInterprocedural, { mode });`
- [ ] Add to returned runtime:
  - [ ] `riskInterproceduralConfig`
  - [ ] `riskInterproceduralEnabled` (boolean)
    - [ ] `true` iff:
      - [ ] `mode === 'code'`
      - [ ] `riskAnalysisEnabled === true` (Phase 10 depends on local signals)
      - [ ] `riskInterproceduralConfig.enabled === true`
- [ ] Add gating to `analysisPolicy`:
  - [ ] include `analysisPolicy.risk.interprocedural = riskInterproceduralEnabled`
  - [ ] include `analysisPolicy.risk.interproceduralSummaryOnly = riskInterproceduralConfig.summaryOnly`

### 10.1.4 Ensure cross-file inference runs when riskInterprocedural is enabled
**File:** `src/index/build/indexer/steps/relations.js`

Current logic:
- `crossFileEnabled = typeInferenceCrossFileEnabled || riskAnalysisCrossFileEnabled`

Update to:
- [ ] `crossFileEnabled = typeInferenceCrossFileEnabled || riskAnalysisCrossFileEnabled || runtime.riskInterproceduralEnabled`

**Important constraint:** Enabling cross-file inference does **not** have to enable "type inference output artifacts"; it only needs to run resolution so `callDetails[].targetChunkUid` exists.

So, keep:
- [ ] `enableTypeInference: typeInferenceCrossFileEnabled`
- [ ] `enableRiskCorrelation: riskAnalysisCrossFileEnabled`
- [ ] Do NOT implicitly force these true just because riskInterprocedural is enabled.

### 10.1.5 Incremental build signature must include riskInterprocedural effective config
**File:** `src/index/build/indexer/signatures.js`

Add `riskInterproceduralConfig` (or a stable subset) to the signature components so incremental rebuilds invalidate when this changes.

- [ ] Use a stable JSON stringify (or hash) of the *normalized effective config* object.
- [ ] Do **not** include transient fields like timers.

### 10.1.6 Index state output must record whether this feature ran
**File:** `src/index/build/indexer/steps/write.js`

In `index_state.json`, add:
```json
"riskInterprocedural": {
  "enabled": true,
  "summaryOnly": false,
  "emitArtifacts": "jsonl"
}
```

- [ ] Implement this in `index_state.json` (exact nesting flexible, but must be deterministic and allow tooling to quickly see if risk flows are expected).

### 10.1.7 Tests for config and gating
Add:
- [ ] `tests/risk-interprocedural/config-normalization.test.js`
  - [ ] unit test `normalizeRiskInterproceduralConfig`
  - [ ] include edge cases: alias values, bad types, clamp behavior
- [ ] `tests/risk-interprocedural/runtime-gating.test.js`
  - [ ] create runtime via `createBuildRuntime` with mode=`code` and mode=`prose`
  - [ ] assert `riskInterproceduralEnabled` toggles correctly
  - [ ] assert crossFileEnabled includes it (mock `runCrossFileInference` decision logic)

---

## 10.2 Param name stabilization for arg-aware mode (FOUNDATION)

> Arg-aware propagation requires stable "callee param names" to map tainted args -> callee identifiers.

### 10.2.0 Map data flow entry points + consumers (required)
**Tasks**
- [ ] Identify parsing entry points:
  - [ ] `src/lang/javascript/relations.js` (param extraction in `buildCodeRelations`)
  - [ ] `src/index/type-inference-crossfile/extract.js` (`extractParamTypes`)
  - [ ] `src/index/type-inference-crossfile/pipeline.js` (`applyCrossFileInference`)
  - [ ] `src/index/build/indexer/steps/relations.js` (`runCrossFileInference`)
- [ ] Identify consumers:
  - [ ] `src/index/risk-interprocedural/summaries.js`
  - [ ] `src/index/risk-interprocedural/engine.js`
  - [ ] `src/index/build/artifacts/writers/risk-interprocedural.js`
  - [ ] `src/index/build/piece-assembly.js`
  - [ ] `src/index/validate/risk-interprocedural.js`
- [ ] Cross-reference these entry points/consumers in 10.5 (engine) and 10.6 (writers/manifest) to keep data flow explicit.

### 10.2.1 Fix JS param extraction to be stable + predictable
**File:** `src/lang/javascript/relations.js` (anchors referenced in original roadmap: around callLinks generation and docmeta param extraction)

Current risk:
- `node.params` can contain patterns (destructuring, defaults) that stringify inconsistently.

Required changes:
- [ ] When building `docmeta.params` (or an adjacent structured field), produce **paramNames** array:
  - [ ] For `Identifier` param: use name directly.
  - [ ] For `AssignmentPattern` (`x=1`): use left identifier name if possible.
  - [ ] For `RestElement` (`...rest`): use argument identifier name if possible.
  - [ ] For patterns (`ObjectPattern`, `ArrayPattern`), use stable placeholders:
    - [ ] `"arg0"`, `"arg1"`, ... (based on param index)
- [ ] Ensure `paramNames` is:
  - [ ] stable order
  - [ ] capped (e.g., 16)
- [ ] Preserve the existing `docmeta.signature` format (do not break search behavior).

**Cross-file inference dependency:**  
`applyCrossFileInference` populates `callLinks.paramNames` via `extractParamTypes`. That function must rely on stable `docmeta.params` or a new stable `docmeta.paramNames`. If needed:

- [ ] Update `src/index/type-inference-crossfile/extract.js` (function `extractParamTypes`) to prefer:
  - [ ] `docmeta.paramNames` if present
  - [ ] else fall back to `docmeta.params`

### 10.2.2 Add tests for JS param normalization
Add:
- [ ] `tests/lang/javascript-paramnames.test.js`

- [ ] Fixture function:
```js
function f({a,b}, x=1, ...rest) {}
```

Expect:
- [ ] `docmeta.paramNames` equals `["arg0","x","rest"]`
- [ ] `callLinks.paramNames` for calls to `f` are consistent.

---

## 10.3 Risk summaries (artifact + compact docmeta)

> Summaries are the "input facts" for propagation and the primary explainability artifact even when propagation is disabled or times out.

### 10.3.1 Define the *final* summary row schema (implement exactly)
After doc merge (10.0), Implement this as the actual row contract (`schemaVersion: 1`):
- [ ] Implement this schema in `src/contracts/schemas/artifacts.js` and `docs/specs/risk-summaries.md`.

**Artifact:** `risk_summaries.jsonl` (sharded)

**Row (RiskSummaryRowV1):**
```ts
{
  schemaVersion: 1,

  // identity
  chunkUid: string,
  file: string,
  languageId: string|null,

  // optional symbol context (for debugging / UI; must not bloat)
  symbol: {
    name: string|null,
    kind: string|null,
    signature: string|null
  },

  // signals (bounded + deterministic)
  signals: {
    sources: RiskSignalSummary[],
    sinks: RiskSignalSummary[],
    sanitizers: RiskSignalSummary[],
    localFlows: RiskLocalFlowSummary[]
  },

  // optional: local taint hints (helps arg-aware)
  taintHints?: {
    taintedIdentifiers: string[]
  },

  totals: {
    sources: number,
    sinks: number,
    sanitizers: number,
    localFlows: number
  },

  truncated: {
    sources: boolean,
    sinks: boolean,
    sanitizers: boolean,
    localFlows: boolean,
    evidence: boolean
  }
}
```

**RiskSignalSummary:**
```ts
{
  ruleId: string,
  ruleName: string,
  ruleType: "source"|"sink"|"sanitizer",
  category: string|null,
  severity: string|null,        // only meaningful for sinks
  confidence: number|null,      // 0..1
  tags: string[],               // bounded
  evidence: EvidenceRef[]       // bounded
}
```

**EvidenceRef:**
```ts
{
  file: string,
  startLine: number,
  startCol: number,
  endLine: number|null,
  endCol: number|null,
  snippetHash: string|null      // "sha1:<hex>" or null
}
```

**RiskLocalFlowSummary (resolve ambiguity explicitly):**
Because local flows involve a *pair* of rules, store both IDs:
```ts
{
  sourceRuleId: string,
  sinkRuleId: string,
  category: string|null,        // usually from sink
  severity: string|null,        // usually from sink
  confidence: number|null,      // derived from source/sink confidences
  evidence: EvidenceRef[]
}
```

This removes the ambiguity present in `spec_risk-summaries_IMPROVED.md` where flows had a single `ruleId`.

### 10.3.2 Implement summary builder
**New file:** `src/index/risk-interprocedural/summaries.js`

Exports:
- [ ] `buildRiskSummaries({ chunks, runtime, mode, log })`

Behavior:
- [ ] Only run when:
  - [ ] `mode === 'code'`
  - [ ] `runtime.riskInterproceduralEnabled === true` OR `runtime.riskInterproceduralConfig.emitArtifacts === 'jsonl'`
  - [ ] If disabled entirely, skip.
- [ ] For each chunk in `state.chunks`:
  - [ ] Read `chunk.docmeta?.risk` (produced by `src/index/risk.js`).
  - [ ] If no risk or no signals, skip row emission.
- [ ] Convert `docmeta.risk.sources/sinks/sanitizers` into `RiskSignalSummary[]`:
  - [ ] Deterministic ordering:
    - [ ] primary: `severity` (high->medium->low->null) for sinks only
    - [ ] then `ruleId`
    - [ ] then earliest evidence location
  - [ ] Caps:
    - [ ] `maxSignalsPerKind = 50`
    - [ ] `maxEvidencePerSignal = 5`
    - [ ] `maxTagsPerSignal = 10`
- [ ] Convert `docmeta.risk.flows` into `RiskLocalFlowSummary[]`:
  - [ ] Derive `sourceRuleId`/`sinkRuleId` from existing detector output:
    - [ ] detector: `flow.ruleIds = [sourceRuleId, sinkRuleId]`
  - [ ] Deterministic order:
    - [ ] `sourceRuleId`, then `sinkRuleId`, then evidence location
  - [ ] Caps:
    - [ ] `maxLocalFlows = 50`
- [ ] Evidence normalization:
  - [ ] Input evidence from detector is `{ line, column, excerpt }`
  - [ ] Map:
    - [ ] `startLine = line`
    - [ ] `startCol = column`
    - [ ] `endLine = line` (or null if you prefer; pick one and be consistent)
    - [ ] `endCol = column`
    - [ ] `snippetHash = sha1(normalizeWhitespace(excerpt))` or null if excerpt missing/empty after normalize
  - [ ] Use `sha1` from `src/shared/hash.js`
- [ ] Produce `totals` and `truncated` flags:
  - [ ] `totals.*` counts BEFORE truncation
  - [ ] `truncated.*` indicates truncation actually occurred

### 10.3.3 Attach compact summary to `docmeta.risk.summary`
**Output field:** `chunk.docmeta.risk.summary`

Compact schema (must stay small; no evidence arrays):
```ts
{
  sources: { count: number },
  sinks: { count: number, maxSeverity: string|null },
  sanitizers: { count: number },
  localFlows: { count: number },

  topCategories: string[],   // max 5
  topTags: string[],         // max 8

  interprocedural: {
    enabled: boolean,
    summaryOnly: boolean
  }
}
```

Rules:
- [ ] Populate only if chunk has at least one local risk signal or local flow.
- [ ] Values must be deterministic (sort ties lexicographically).
- [ ] This compact summary is what UIs and CLI can read quickly without parsing JSONL.

### 10.3.4 Export `taintHints` from local risk detector
**File:** `src/index/risk.js`

Enhancement:
- [ ] The local risk detector already tracks a `taint` map internally for assignment propagation.
- [ ] Add a bounded list:
  - [ ] `taintHints: { taintedIdentifiers: string[] }`
  - [ ] Sort + cap (e.g., 50)
- [ ] Attach to `docmeta.risk`.

This improves arg-aware propagation but is not required for correctness if `strictness=conservative`.

### 10.3.5 Per-row size cap enforcement (required)
Both summary rows and compact summary additions must obey size limits.

**Hard limit:** `<= 32 KiB` per JSONL row.

Implement row trimming in `buildRiskSummaries` (or in the writer) with deterministic steps:
- [ ] Drop `tags` arrays from all signals.
- [ ] Reduce evidence per signal to 1.
- [ ] Drop all evidence arrays.
- [ ] If still too large: drop the entire summary row and record in stats (`summariesDroppedBySize++`).

### 10.3.6 Tests for summaries
Add:
- [ ] `tests/risk-interprocedural/summaries-schema.test.js`
  - [ ] Build a fixture index; load `risk_summaries.jsonl`; schema-validate; verify expected counts.
- [ ] `tests/risk-interprocedural/summaries-determinism.test.js`
  - [ ] Run summary build twice on same fixture (same runtime), assert identical JSONL output bytes.
- [ ] `tests/risk-interprocedural/summaries-truncation.test.js`
  - [ ] Construct an artificial chunk with huge tags/evidence, assert trimming steps fire and flags/stats reflect.

---

## 10.4 Shared callsite utilities (FOUNDATION)

### 10.4.1 Factor callSiteId algorithm into a shared helper
**Goal:** Risk flows must reference callSiteIds that match the `call_sites` writer exactly.

**New file (recommended):** `src/index/callsite-id.js`

Export:
- [ ] `buildCallSiteId({ file, startLine, startCol, endLine, endCol, calleeRaw })`

Implementation:
- [ ] Move (or copy exactly) the logic from `src/index/build/artifacts/writers/call-sites.js`.
- [ ] Update call-sites writer to import it (so there is only one implementation).

### 10.4.2 Define edge-key and call site sampling helpers
**New file:** `src/index/risk-interprocedural/edges.js`

Exports:
- [ ] `edgeKey(callerUid, calleeUid) => string` (format: `"${callerUid}->${calleeUid}"`)
- [ ] `sortCallDetailsForSampling(a, b)` (deterministic comparator)
- [ ] `sampleCallSitesForEdge(callDetails, { maxCallSitesPerEdge }) => CallSiteSample[]`

Where `CallSiteSample` includes:
```ts
{
  callSiteId: string,
  args: string[]|null
}
```

Sampling requirements:
- [ ] Build list from caller chunk's `codeRelations.callDetails`, filtering:
  - [ ] `detail.targetChunkUid === calleeUid`
- [ ] Sort by:
  - [ ] `detail.file` (if present, else caller chunk file)
  - [ ] `detail.startLine`, `detail.startCol`, `detail.endLine`, `detail.endCol`
  - [ ] `detail.calleeNormalized` then `detail.calleeRaw`
  - [ ] `callSiteId` (as tie-breaker)
- [ ] Take first `N`.

**Important:** Sampling is used only for *flow evidence*, not for call graph completeness.

### 10.4.3 Add local pointer hash helper (callsite IDs + graph joins)
**File (likely):** `src/index/build/shared/graph/graph-store.js`

**Goal:** Ensure callsite IDs and graph joins use a shared, stable hash for local pointers so tests can target it.

**Tasks**
- [ ] Add a helper that takes callsite-local inputs and produces a stable pointer hash (inputs must match callSiteId formation).
- [ ] Document how callsite IDs are formed and reused in:
  - [ ] 10.5 propagation (`risk-interprocedural/engine.js`)
  - [ ] 10.6 writer/manifest plumbing (`risk-interprocedural.js`, piece assembly)
- [ ] Expose the helper for tests (so sampling + joins can be verified deterministically).

### 10.4.4 Tests for callsite helpers
Add:
- [ ] `tests/risk-interprocedural/callsite-id.test.js`
  - [ ] Ensure the shared helper matches the writer's output on representative inputs.
- [ ] `tests/risk-interprocedural/callsite-sampling.test.js`
  - [ ] Given an array of mocked callDetails, assert deterministic ordering and stable sampling.
- [ ] Add a focused test for the local pointer hash helper (inputs -> stable hash).

---

## 10.5 Interprocedural propagation -> risk_flows

> Propagation enumerates bounded call paths from source signals to sink signals.

### 10.5.1 Define the *final* flow row schema (implement exactly)
**Artifact:** `risk_flows.jsonl` (sharded)

- [ ] Implement this schema in `src/contracts/schemas/artifacts.js` and `docs/specs/risk-flows-and-call-sites.md`.

Row `RiskFlowRowV1`:
```ts
{
  schemaVersion: 1,
  flowId: string,  // "sha1:<hex>"

  source: {
    chunkUid: string,
    ruleId: string,
    ruleName: string,
    ruleType: "source",
    category: string|null,
    severity: null,
    confidence: number|null
  },

  sink: {
    chunkUid: string,
    ruleId: string,
    ruleName: string,
    ruleType: "sink",
    category: string|null,
    severity: string|null,
    confidence: number|null
  },

  path: {
    chunkUids: string[],             // length >= 2
    callSiteIdsByStep: string[][]    // length == chunkUids.length - 1
  },

  confidence: number,                // computed final confidence 0..1

  notes: {
    strictness: "conservative"|"argAware",
    sanitizerPolicy: "terminate"|"weaken",
    hopCount: number,
    sanitizerBarriersHit: number,
    capsHit: string[]                // e.g., ["maxDepth","maxPathsPerPair"]
  }
}
```

**Call sites (existing artifact; do not break)**
- [ ] Treat `call_sites` as a superset artifact; risk flows only consume a subset of fields.
- [ ] Keep `call_sites` contract aligned to `src/contracts/schemas/artifacts.js` (no schema changes).
- [ ] Ensure callSiteIds used here are produced by the shared helper from 10.4.1.
- [ ] Document the subset fields consumed by propagation in `docs/specs/risk-flows-and-call-sites.md`.
- [ ] Touchpoints:
  - [ ] `src/index/build/artifacts/writers/call-sites.js` (writer + callSiteId)
  - [ ] `src/contracts/schemas/artifacts.js` (contract authority)

### 10.5.2 Implement propagation engine
**New file:** `src/index/risk-interprocedural/engine.js`

Export:
- [ ] `computeInterproceduralRisk({ chunks, summariesByChunkUid, runtime, log })`

Return:
```ts
{
  status: "ok" | "timed_out" | "disabled",
  summaryRows: RiskSummaryRowV1[],
  flowRows: RiskFlowRowV1[],
  stats: RiskInterproceduralStatsV1,
  // for referential checks / writers
  callSiteIdsReferenced: Set<string>
}
```

### 10.5.3 Graph inputs and how to build them (no searching required)
Inputs come from the existing indexing pipeline:

- `chunk.codeRelations.callDetails[]`
  - produced by language relations collectors (e.g., `src/lang/javascript/relations.js`)
  - enriched by cross-file inference (`applyCrossFileInference`) with `detail.targetChunkUid`

- `chunk.docmeta.risk.*`
  - produced by `src/index/risk.js`

The engine must **not** require reading artifacts from disk; it runs during build.
- [ ] Enforce in-code: do not read artifacts from disk inside the propagation engine (use in-memory build state only).
- [ ] Cross-reference 10.2.0 entry points/consumers for paramNames flow into this section.

### 10.5.4 Deterministic traversal algorithm (BFS)
Implement BFS rooted at each `(sourceChunkUid, sourceRuleId)`:

**Root ordering:**
- [ ] Sort roots by:
  - [ ] `sourceChunkUid`
  - [ ] `sourceRuleId`

**Queue item ("state") shape:**
```ts
{
  chunkUid: string,
  rootSource: { chunkUid: string, ruleId: string },
  pathChunkUids: string[],             // from root to current
  callSiteIdsByStep: string[][],       // parallel to edges in path
  depth: number,                       // edges traversed so far
  sanitizerBarriersHit: number,
  taintSetKey: string|null             // only used for argAware
}
```

**Visited key (per spec; include depth):**
- [ ] `visitedKey = `${rootSource.chunkUid}|${rootSource.ruleId}|${chunkUid}|${taintSetKey||""}|${depth}``

This is more permissive than typical BFS; it matches the intended "allow revisiting at deeper depth" behavior.

**Expansion order:**
- [ ] When expanding a node:
  - [ ] Get outgoing resolved callees from callDetails (or callLinks) and sort `calleeUid` lexicographically.
  - [ ] For each callee, sample callSiteIds for the edge deterministically (10.4.2).
  - [ ] Enqueue callee states in that sorted order.

### 10.5.5 Traversal strictness modes
#### conservative
- [ ] Treat every resolved edge as traversable.
- [ ] No taint tracking required.
- [ ] `taintSetKey = null` for visited key.

#### argAware
An edge (caller->callee) is traversable only if at least one call-site argument is tainted.

**Taint sources (caller side):**
- [ ] `callerSummary.taintHints.taintedIdentifiers` (if present)
- [ ] Regex match against source rule patterns:
  - [ ] Use compiled regexes for *source rules* from runtime's risk rules (`runtime.riskConfig`)
  - [ ] Match per-argument string with identifier boundary rules:
    - [ ] `argText` is the string from `callDetails.args[]`
    - [ ] Consider an argument tainted if:
      - [ ] It contains any tainted identifier as a whole token, OR
      - [ ] It matches a source rule regex pattern

**Mapping taint into callee:**
- [ ] Determine callee param names:
  - [ ] Prefer `callLinks.paramNames` for that callee edge if available
  - [ ] Else prefer callee chunk's `docmeta.paramNames` (from 10.2)
  - [ ] Else: no mapping possible; treat traversal as conservative for that edge *only if* a tainted arg exists (still require tainted arg)
- [ ] If argument index `i` is tainted and `paramNames[i]` exists:
  - [ ] add `paramNames[i]` to callee taint set
- [ ] Always union in callee's own `taintHints.taintedIdentifiers` (if present).

**Canonical taintSetKey:**
- [ ] Sort tainted identifiers, cap to 16, join with `,`
- [ ] Use this for visited key and determinism.

### 10.5.6 Sanitizer policy
A "barrier chunk" is any chunk that has `signals.sanitizers.length > 0` in its summary.

- `terminate`:
  - [ ] You may still emit flows that *end at this chunk* (if it contains sinks).
  - [ ] Do not expand outgoing edges from this chunk.
- `weaken`:
  - [ ] Continue expansion.
  - [ ] Increment `sanitizerBarriersHit` counter for notes and confidence penalty.

### 10.5.7 Flow emission rules
While BFS is running:
- [ ] When visiting a chunk that has sinks (`signals.sinks.length > 0`):
  - [ ] For each sink signal (sorted by severity desc then ruleId):
    - [ ] Emit a flow row from root source -> this sink **unless**:
      - [ ] `sinkChunkUid === sourceChunkUid` (no intra-chunk flows)
      - [ ] caps would be exceeded

**Per-(source,sink) path cap:**
- [ ] Maintain counter keyed by:
  - [ ] `${sourceChunkUid}|${sourceRuleId}|${sinkChunkUid}|${sinkRuleId}`
- [ ] Do not emit more than `maxPathsPerPair`.

### 10.5.8 Caps + timeout behavior (must be explicit)
Apply caps in this order (deterministic and reflected in stats):

- [ ] **Timeout** (`maxMs`):
  - [ ] Start timer before any propagation.
  - [ ] If exceeded:
    - [ ] set status=`timed_out`
    - [ ] emit **zero** flow rows
    - [ ] still emit summaries (already built)
- [ ] **maxEdgeExpansions**:
  - [ ] increment on each edge expansion attempt
  - [ ] if exceeded: stop traversal and set `capsHit += ["maxEdgeExpansions"]`
- [ ] **maxDepth**:
  - [ ] do not expand states with `depth >= maxDepth`
- [ ] **maxPathsPerPair**:
  - [ ] per key cap described above
- [ ] **maxTotalFlows**:
  - [ ] stop emitting once reached; set `capsHit += ["maxTotalFlows"]`

### 10.5.9 Confidence scoring (implement exactly)
For each emitted flow:
- [ ] `C_source = sourceSignal.confidence ?? 0.5`
- [ ] `C_sink = sinkSignal.confidence ?? 0.5`
- [ ] `base = 0.1 + 0.9 * C_source * C_sink`
- [ ] `hopCount = chunkUids.length - 1`
- [ ] `hopDecay = 0.85 ** Math.max(0, hopCount - 1)`
- [ ] `sanitizerPenalty = sanitizerPolicy==="weaken" ? (0.5 ** sanitizerBarriersHit) : 1.0`
- [ ] `final = clamp(base * hopDecay * sanitizerPenalty, 0, 1)`

### 10.5.10 Per-row size cap enforcement (required)
**Hard limit:** `<= 32 KiB` per JSONL row.

Deterministic trimming for flows:
- [ ] Reduce each `callSiteIdsByStep[i]` to at most 1 id.
- [ ] If still too large, replace `callSiteIdsByStep` with empty arrays (correct length).
- [ ] If still too large, drop the row and record in stats.

### 10.5.11 Tests for propagation
Add fixtures + tests:

- [ ] `tests/fixtures/risk-interprocedural/js-simple/`
  - [ ] `index.js` contains:
    - [ ] `function handle(req){ const cmd=req.body; return run(build(cmd)); }`
    - [ ] `function build(x){ return x; }`
    - [ ] `function run(cmd){ eval(cmd); }`
  - [ ] Ensure:
    - [ ] source rule `source.req.body` fires in `handle`
    - [ ] sink rule `sink.eval` fires in `run`
    - [ ] call chain resolved: handle->build->run

- [ ] `tests/risk-interprocedural/flows-conservative.test.js`
  - [ ] enable riskInterprocedural (conservative)
  - [ ] assert at least 1 flow:
    - [ ] `path.chunkUids.length === 3`
    - [ ] `callSiteIdsByStep.length === 2`
    - [ ] `notes.hopCount === 2`
    - [ ] `sink.ruleId === "sink.eval"` (or the actual rule id)
- [ ] `tests/risk-interprocedural/flows-argaware-negative.test.js`
  - [ ] modify fixture so tainted value is NOT passed (e.g., `build("constant")`)
  - [ ] argAware should emit 0 flows
- [ ] `tests/risk-interprocedural/flows-sanitizer-policy.test.js`
  - [ ] add sanitizer call in middle function (`escape(cmd)`)
  - [ ] terminate: no flows beyond sanitizer
  - [ ] weaken: flow exists but confidence reduced and `sanitizerBarriersHit>0`
- [ ] `tests/risk-interprocedural/flows-timeout.test.js`
  - [ ] set `maxMs=1` and create a fixture with branching call graph
  - [ ] expect status `timed_out` and `risk_flows` empty

---

## 10.6 Artifact writing + contracts + manifest integration

### 10.6.1 Add contracts for new artifacts
**File:** `src/contracts/schemas/artifacts.js`

Add schemas for:
- [ ] `risk_summaries` (jsonl)
- [ ] `risk_flows` (jsonl)
- [ ] `risk_interprocedural_stats` (json)

Also add meta schemas:
- [ ] `risk_summaries_meta` (shard meta)
- [ ] `risk_flows_meta`

Update:
- [ ] `src/contracts/registry.js` (schema registry + schema hash)

**Risk interprocedural stats schema (canonical)**
- [ ] Update `docs/specs/risk-interprocedural-stats.md` to match this schema (no appendix copy).
- [ ] Required counters (explicit semantics):
  - [ ] `flowsEmitted`: number of risk flow records written
  - [ ] `risksWithFlows`: count of riskIds that emitted >= 1 flow
  - [ ] `uniqueCallSitesReferenced`: count of unique callSiteIds referenced by emitted `risk_flows`
  - [ ] `callSiteSampling`: { `enabled`, `perCalleeLimit`, `totalLimit`, `seed` }
  - [ ] `mode`: propagation mode
  - [ ] `timingMs`: { `total`, `propagation`, `io` }
  - [ ] `capsHit`: record which caps were hit (depth, fanout, paths, timeout)

### 10.6.2 Add JSONL required keys
**File:** `src/shared/artifact-io/jsonl.js`

Extend `JSONL_REQUIRED_KEYS` with:
- [ ] `risk_summaries`: `["schemaVersion","chunkUid","file","signals"]`
- [ ] `risk_flows`: `["schemaVersion","flowId","source","sink","path","confidence","notes"]`

(Keep required keys minimal but sufficient.)

### 10.6.3 Add compression defaults for risk JSONL
**File:** `src/index/build/artifacts/compression.js`

Add `risk_summaries` and `risk_flows` to `COMPRESSIBLE_ARTIFACTS`.
- [ ] Implement compression defaults update.

### 10.6.4 Implement artifact writers
**New file:** `src/index/build/artifacts/writers/risk-interprocedural.js`

Exports:
- [ ] `enqueueRiskInterproceduralArtifacts({ state, runtime, mode, outputDir, manifest, log })`

Responsibilities:
- [ ] If `mode !== "code"`: do nothing.
- [ ] If `!runtime.riskInterproceduralEnabled`: do nothing.
- [ ] Ensure summaries + flows are computed once and stored on state:
  - [ ] `state.riskInterprocedural = { summaryRows, flowRows, stats, callSiteIdsReferenced }`
- [ ] Write:
  - [ ] always write `risk_interprocedural_stats.json` when enabled
  - [ ] write `risk_summaries` jsonl only if `emitArtifacts==="jsonl"`
  - [ ] write `risk_flows` jsonl only if `emitArtifacts==="jsonl"` and `summaryOnly===false` and `status==="ok"`
- [ ] Reference 10.2.0 entry points/consumers to confirm where paramNames and callDetails originate.

**Where to compute:**  
Compute in the indexing pipeline **after** cross-file inference and **before** metaV2 finalization, so compact summaries land in chunk meta.

Recommended location:
- In `src/index/build/indexer/pipeline.js` after `runCrossFileInference(...)` and before postings/writing, OR
- In `src/index/build/indexer/steps/write.js` immediately before `finalizeMetaV2(...)`

Pick one and document it; do not compute twice.
- [ ] Document the chosen compute location and ensure it is invoked exactly once.

### 10.6.5 Callsite assembly helper + manifest builder touchpoints
**Files (manifest builders):**
- [ ] `src/index/build/incremental.js` (index manifest + pieces manifest)
- [ ] `src/index/build/piece-assembly.js` (piece assembly + manifest usage)
- [ ] `src/shared/artifact-io/manifest.js` (manifest path/compat helpers)

**Tasks**
- [ ] Add/confirm a helper for assembling callsite references used by risk flows.
- [ ] Wire the helper into `risk-interprocedural` writer usage so callSiteIds match the manifest.
- [ ] Document the manifest builder files above in the callsite assembly helper docstring/comments.

### 10.6.6 Ensure chunk meta includes compact risk summary
No special code is needed if you attach `chunk.docmeta.risk.summary`, because:
- `src/index/metadata-v2.js` already includes `risk: docmeta?.risk`

- [ ] Ensure the compact summary is small enough that `chunk-meta` writer does not drop docmeta for size reasons.

### 10.6.7 Add artifacts to piece assembly
**File:** `src/index/build/piece-assembly.js`

Add optional loading for:
- [ ] `risk_summaries`
- [ ] `risk_flows`
- [ ] `risk_interprocedural_stats`

This makes downstream tooling (sqlite build, etc.) able to access these artifacts uniformly.

### 10.6.8 Tests for artifact writing
Add:
- [ ] `tests/risk-interprocedural/artifacts-written.test.js`
  - [ ] Build fixture index with `emitArtifacts="jsonl"`
  - [ ] Assert files exist:
    - [ ] `risk_summaries.jsonl` or sharded variants (+ `.meta.json`)
    - [ ] `risk_flows.jsonl` or sharded variants (+ `.meta.json`)
    - [ ] `risk_interprocedural_stats.json`
  - [ ] Assert shard meta points to shard files.

---

## 10.7 Validation + referential integrity

### 10.7.1 Extend validator to load + schema-validate new artifacts
Files:
- [ ] `src/index/validate.js`
- [ ] `src/index/validate/artifacts.js`
- [ ] `src/index/validate/presence.js`

Tasks:
- [ ] Add `risk_summaries`, `risk_flows`, `risk_interprocedural_stats` to optional artifact list.
- [ ] If present:
  - [ ] schema-validate each using contracts
- [ ] Add clear validation errors (include artifact name, failing row index if jsonl).
- [ ] Compatibility stance: if artifacts are missing/old schema when expected, error and instruct users to rebuild (no back-compat).

### 10.7.2 Cross-artifact referential checks (must add)
Add new validator module:
- [ ] `src/index/validate/risk-interprocedural.js`

Checks:
- [ ] For each summary row:
  - [ ] `chunkUid` exists in `chunk_meta`
  - [ ] `file` matches `chunk_meta.file` (if present)
- [ ] For each flow row:
  - [ ] `path.chunkUids.length >= 2`
  - [ ] `path.chunkUids[0] === source.chunkUid`
  - [ ] `path.chunkUids[last] === sink.chunkUid`
  - [ ] `path.callSiteIdsByStep.length === path.chunkUids.length - 1`
  - [ ] Every `chunkUid` in path exists in `chunk_meta`
  - [ ] Every `callSiteId` referenced exists in `call_sites` **if** `call_sites` is present
    - [ ] (Note: call_sites is optional; if absent, validation should warn, not fail, unless strict mode demands it.)
- [ ] For stats JSON:
  - [ ] `effectiveConfig` fields are consistent with normalization
  - [ ] If `status==="timed_out"`: flows count is 0
  - [ ] If `emitArtifacts==="jsonl"` and `summaryOnly===false` and `status==="ok"`:
    - [ ] `risk_flows` artifact must exist

### 10.7.3 Tests for validator checks
Add:
- [ ] `tests/validator/risk-interprocedural.test.js`
  - [ ] Build fixture index with riskInterprocedural on
  - [ ] Run validator, expect pass
  - [ ] Corrupt one `callSiteId` in a flow row, expect validator fail with specific message

---

## 10.8 CLI: explain interprocedural risk flows

### 10.8.1 Add new command wiring
**File:** `bin/pairofcleats.js`

Add command:
- [ ] `risk explain`

Map to new tool:
- [ ] `tools/explain-risk.js`

### 10.8.2 Implement explain tool
**New file:** `tools/explain-risk.js`

Requirements:
- [ ] Inputs:
  - [ ] `--index <dir>` (required)
  - [ ] `--chunk <chunkUid>` (required)
  - [ ] `--max <n>` (default 20)
  - [ ] optional filters:
    - [ ] `--source-rule <ruleId>`
    - [ ] `--sink-rule <ruleId>`
    - [ ] `--json`
- [ ] Loads artifacts from `indexDir`:
  - [ ] `chunk_meta`
  - [ ] `risk_summaries` (optional)
  - [ ] `risk_flows` (optional)
  - [ ] `call_sites` (optional; used to print call site context)
  - [ ] `risk_interprocedural_stats` (optional)
- [ ] Output (human mode):
  - [ ] Print chunk identification (file, symbol name, kind)
  - [ ] Print compact risk summary if present
  - [ ] Print flows where chunk is:
    - [ ] source chunk, or sink chunk, or appears in path
    - [ ] ordered by descending `confidence`, then `flowId`
  - [ ] For each flow:
    - [ ] print path as `file::symbol` chain
    - [ ] print sampled call sites per step by looking up `callSiteId` in `call_sites` (if present)
- [ ] JSON mode: emit structured JSON with same data.

### 10.8.3 Tests for CLI
Add:
- [ ] `tests/cli/risk-explain.test.js`
  - [ ] Build fixture index
  - [ ] Run `node bin/pairofcleats.js risk explain --index <dir> --chunk <uid>`
  - [ ] Assert output contains flowId and the expected file names

### 10.8.4 Docs update for CLI output changes
**Files:** `docs/guides/commands.md` (and any CLI reference docs that mention `risk` commands)

**Tasks**
- [ ] Update CLI usage/output examples if `risk explain` output or flags change.
- [ ] Add a note about rebuild requirements for old indexes (align with 10.7 compatibility stance).

---

## 10.9 Cross-cutting robustness improvements (recommended)

### 10.9.1 Call graph edge union (prevents partial call_sites from hiding callLinks)
**File:** `src/index/build/graphs.js`

Current behavior:
- [ ] If there is at least one callSiteEdge, it uses callSiteEdges and does NOT fall back to callLinks for missing edges.

Improve:
- [ ] Always union edges from:
  - [ ] `callSites` (when present)
  - [ ] `callLinks` (when present)
- [ ] Add a regression test (integration or unit) that proves missing callSiteEdges do not drop callLinks.

**Suggested test file:** `tests/risk-interprocedural/flows-conservative.test.js` (extend) or add `tests/risk-interprocedural/graph-callsite-union.test.js`.

### 10.9.2 Performance audit checklist
Before marking Phase 10 complete, verify:
- [ ] Summaries build is O(#risk signals) and bounded by caps (`src/index/risk-interprocedural/summaries.js`).
- [ ] Propagation stops on:
  - [ ] timeout
  - [ ] maxEdgeExpansions
  - [ ] maxDepth
  - [ ] maxTotalFlows
- [ ] Memory usage:
  - [ ] avoid building a global all-edges map if not needed; build per chunk on-demand (`risk-interprocedural/engine.js`).
- [ ] No hidden global state:
  - [ ] cache keys include buildRoot/buildId where applicable (pipeline + writer helpers).
- [ ] Determinism:
  - [ ] output stable across runs given same codebase and config (use `tests/risk-interprocedural/summaries-determinism.test.js` and a flow determinism test).

**Files to review (explicit)**
- [ ] `src/index/risk-interprocedural/summaries.js` (summary caps + determinism)
- [ ] `src/index/risk-interprocedural/engine.js` (caps, BFS ordering, timeouts, memory usage)
- [ ] `src/index/risk-interprocedural/edges.js` (edge ordering + sampling determinism)
- [ ] `src/index/build/artifacts/writers/risk-interprocedural.js` (status/emit flags + timing)

**Tests to use**
- [ ] `tests/risk-interprocedural/summaries-determinism.test.js`
- [ ] `tests/risk-interprocedural/flows-conservative.test.js`
- [ ] `tests/risk-interprocedural/flows-argaware-negative.test.js`
- [ ] `tests/risk-interprocedural/flows-timeout.test.js`

---

## Phase 10 completion checklist (must be true)
- [ ] Docs are merged; canonical specs in `docs/specs/` match code contracts (especially `call_sites`).
- [ ] Deprecated/replaced spec docs have been moved to `docs/archived/` and the process is documented in `AGENTS.md` (see 10.0.3).
- [ ] `indexing.riskInterprocedural` survives config load and is normalized deterministically.
- [ ] Cross-file inference runs when riskInterprocedural is enabled.
- [ ] `docmeta.risk.summary` is present, compact, and deterministic.
- [ ] `risk_summaries` artifact rows are schema-valid, capped, and <=32KiB each.
- [ ] `risk_flows` artifact rows are deterministic, capped, and <=32KiB each.
- [ ] Every callSiteId referenced by flows is resolvable in `call_sites` when present.
- [ ] `risk_interprocedural_stats.json` is always written when enabled and accurately reflects status/caps.
- [ ] Validator enforces schema + referential integrity for the new artifacts.
- [ ] `pairofcleats risk explain` works and is covered by tests.
- [ ] Old indexes are not supported; validation errors instruct users to rebuild (no compatibility shim).

---

### Doc merge checklist (explicit, per original roadmap requirement)
- [ ] `docs/specs/risk-interprocedural-config.md` <- merge `docs/new_docs/spec_risk-interprocedural-config_IMPROVED.md`
- [ ] `docs/specs/risk-summaries.md` <- merge `docs/new_docs/spec_risk-summaries_IMPROVED.md`
- [ ] `docs/specs/risk-flows-and-call-sites.md` <- merge `docs/new_docs/spec_risk-flows-and-call-sites_RECONCILED.md`
- [ ] `docs/specs/risk-callsite-id-and-stats.md` <- reconcile with code + update/annotate `docs/new_docs/risk-callsite-id-and-stats_IMPROVED.md`
- [ ] `docs/specs/risk-interprocedural-stats.md` <- expand from placeholder using merged stats schema
- [ ] `docs/new_docs/interprocedural-state-and-pipeline_DRAFT.md` <- either promote to `docs/specs/` or merge key content into the canonical specs

---

# Appendices  -  touchpoint mappings (with line ranges) + test lane hints

These appendices are generated to remove scavenger-hunts:
- Every file path referenced in a phase body appears here.
- Existing files include **approximate** line ranges.
- Planned files/dirs are labeled **NEW**.

## Appendix P0  -  Root-level touchpoints referenced by this roadmap

- `AGENTS.md` (~L1-L63)  -  agent workflow; must include the spec archival policy.
- `COMPLETED_PHASES.md` (~L1-L12)  -  record of completed roadmap phases.
- `GIGAROADMAP.md` (~L1-L4692)  -  prerequisite plan; this roadmap assumes it is complete.
- `package.json` (~L1-L278)  -  test lane scripts (`test:unit`, `test:services`, etc).

## Appendix P7  -  repo touchpoint map

> Line ranges are approximate. Prefer anchor strings (function/export names) over line numbers.

### Existing directories referenced
- `docs/contracts/` (DIR; exists)
- `src/contracts/` (DIR; exists)
- `tests/fixtures/sample/` (DIR; exists)

### Existing src/ files referenced (edit candidates)
- `src/contracts/registry.js` (~L1-L10)  -  exports/anchors: `ARTIFACT_SCHEMA_REGISTRY`, `ARTIFACT_SCHEMA_HASH`, `ARTIFACT_SCHEMA_NAMES`, `getArtifactSchema`
- `src/contracts/schemas/artifacts.js` (~L1-L677)  -  exports/anchors: `ARTIFACT_SCHEMA_DEFS`
- `src/index/build/file-processor/embeddings.js` (~L1-L260)
- `src/index/build/indexer/embedding-queue.js` (~L1-L49)  -  exports/anchors: `enqueueEmbeddingJob`
- `src/index/build/indexer/pipeline.js` (~L1-L326)
- `src/index/build/indexer/steps/write.js` (~L1-L101)  -  exports/anchors: `writeIndexArtifactsForMode`
- `src/index/embedding.js` (~L1-L56)  -  exports/anchors: `quantizeVec`, `quantizeVecUint8`, `normalizeVec`, `createEmbedder`
- `src/index/validate.js` (~L1-L581)
- `src/retrieval/ann/providers/hnsw.js` (~L1-L27)  -  exports/anchors: `createHnswAnnProvider`
- `src/retrieval/ann/providers/lancedb.js` (~L1-L39)  -  exports/anchors: `createLanceDbAnnProvider`
- `src/retrieval/cli-index.js` (~L1-L416)  -  exports/anchors: `resolveIndexDir`, `requireIndexDir`, `buildQueryCacheKey`, `getIndexSignature`
- `src/retrieval/cli/load-indexes.js` (~L1-L368)
- `src/retrieval/cli/normalize-options.js` (~L1-L273)  -  exports/anchors: `normalizeSearchOptions`
- `src/retrieval/cli/options.js` (~L1-L141)  -  exports/anchors: `getMissingFlagMessages`, `estimateIndexBytes`, `resolveIndexedFileCount`, `resolveBm25Defaults`, `loadBranchFromMetrics`
- `src/retrieval/cli/query-plan.js` (~L1-L205)  -  exports/anchors: `buildQueryPlan`
- `src/retrieval/lancedb.js` (~L1-L180)
- `src/retrieval/query-intent.js` (~L1-L84)  -  exports/anchors: `classifyQuery`, `resolveIntentVectorMode`, `resolveIntentFieldWeights`
- `src/retrieval/rankers.js` (~L1-L292)  -  exports/anchors: `rankBM25Legacy`, `getTokenIndex`, `rankBM25`, `rankBM25Fields`, `rankMinhash`
- `src/retrieval/sqlite-helpers.js` (~L1-L544)  -  exports/anchors: `createSqliteHelpers`
- `src/shared/artifact-io.js` (~L1-L12)
- `src/shared/artifact-io/manifest.js` (~L1-L291)  -  exports/anchors: `resolveManifestPath`, `loadPiecesManifest`, `readCompatibilityKey`, `normalizeMetaParts`, `resolveMetaFormat`
- `src/shared/embedding-adapter.js` (~L1-L158)  -  exports/anchors: `getEmbeddingAdapter`
- `src/shared/embedding-utils.js` (~L1-L176)  -  exports/anchors: `DEFAULT_EMBEDDING_POOLING`, `DEFAULT_EMBEDDING_NORMALIZE`, `DEFAULT_EMBEDDING_TRUNCATION`, `isVectorLike`, `mergeEmbeddingVectors`
- `src/shared/hnsw.js` (~L1-L160)  -  exports/anchors: `normalizeHnswConfig`, `resolveHnswPaths`, `loadHnswIndex`, `rankHnswIndex`
- `src/shared/lancedb.js` (~L1-L65)  -  exports/anchors: `normalizeLanceDbConfig`, `resolveLanceDbPaths`, `resolveLanceDbTarget`
- `src/storage/lmdb/schema.js` (~L1-L49)  -  exports/anchors: `LMDB_SCHEMA_VERSION`, `LMDB_META_KEYS`, `LMDB_ARTIFACT_KEYS`, `LMDB_ARTIFACT_LIST`, `LMDB_REQUIRED_ARTIFACT_KEYS`
- `src/storage/sqlite/build/incremental-update.js` (~L1-L567)
- `src/storage/sqlite/vector.js` (~L1-L71)  -  exports/anchors: `quantizeVec`, `resolveQuantizationParams`, `dequantizeUint8ToFloat32`, `toSqliteRowId`, `packUint32`

### Existing tools/ files referenced (edit candidates)
- `tools/build-embeddings.js` (~L1-L12)
- `tools/build-embeddings/cache.js` (~L1-L26)  -  exports/anchors: `buildCacheIdentity`, `resolveCacheRoot`, `resolveCacheDir`, `buildCacheKey`, `isCacheValid`
- `tools/build-embeddings/cli.js` (~L1-L95)  -  exports/anchors: `parseBuildEmbeddingsArgs`
- `tools/build-embeddings/embed.js` (~L1-L119)  -  exports/anchors: `assertVectorArrays`, `runBatched`, `ensureVectorArrays`, `createDimsValidator`, `isDimsMismatch`
- `tools/build-embeddings/hnsw.js` (~L1-L115)  -  exports/anchors: `createHnswBuilder`
- `tools/build-embeddings/lancedb.js` (~L1-L143)
- `tools/build-embeddings/manifest.js` (~L1-L111)  -  exports/anchors: `updatePieceManifest`
- `tools/build-embeddings/runner.js` (~L1-L763)
- `tools/build-embeddings/sqlite-dense.js` (~L1-L209)  -  exports/anchors: `updateSqliteDense`
- `tools/build-lmdb-index.js` (~L1-L311)
- `tools/dict-utils/paths/db.js` (~L1-L62)  -  exports/anchors: `resolveLmdbPaths`, `resolveSqlitePaths`
- `tools/index-validate.js` (~L1-L130)
- `tools/indexer-service.js` (~L1-L441)
- `tools/service/queue.js` (~L1-L270)  -  exports/anchors: `resolveQueueName`, `getQueuePaths`
- `tools/vector-extension.js` (~L1-L393)  -  exports/anchors: `getBinarySuffix`, `getPlatformKey`, `getVectorExtensionConfig`, `resolveVectorExtensionPath`, `loadVectorExtension`

### Existing docs/ files referenced (edit candidates)
- `docs/contracts/artifact-schemas.md` (~L1-L67)
- `docs/contracts/public-artifact-surface.md` (~L1-L104)
- `docs/guides/embeddings.md` (~L1-L92)
- `docs/guides/search.md` (~L1-L74)

### Existing tests/ files referenced (edit candidates)
- `tests/artifact-io-manifest-discovery.test.js` (~L1-L60)  -  lane: `integration`; run: `npm run test:integration -- --match artifact-io-manifest-discovery.test`
- `tests/embedding-queue-defaults.js` (~L1-L37)  -  lane: `integration`; run: `npm run test:integration -- --match embedding-queue-defaults`
- `tests/embedding-queue.js` (~L1-L51)  -  lane: `integration`; run: `npm run test:integration -- --match embedding-queue`
- `tests/embeddings-validate.js` (~L1-L82)  -  lane: `integration`; run: `npm run test:integration -- --match embeddings-validate`
- `tests/hnsw-ann.js` (~L1-L124)  -  lane: `integration`; run: `npm run test:integration -- --match hnsw-ann`
- `tests/hnsw-atomic.js` (~L1-L90)  -  lane: `integration`; run: `npm run test:integration -- --match hnsw-atomic`
- `tests/hnsw-candidate-set.js` (~L1-L78)  -  lane: `integration`; run: `npm run test:integration -- --match hnsw-candidate-set`
- `tests/lancedb-ann.js` (~L1-L100)  -  lane: `integration`; run: `npm run test:integration -- --match lancedb-ann`
- `tests/lmdb-backend.js` (~L1-L122)  -  lane: `integration`; run: `npm run test:integration -- --match lmdb-backend`
- `tests/lmdb-corruption.js` (~L1-L105)  -  lane: `integration`; run: `npm run test:integration -- --match lmdb-corruption`
- `tests/lmdb-report-artifacts.js` (~L1-L125)  -  lane: `integration`; run: `npm run test:integration -- --match lmdb-report-artifacts`

### Planned/new paths referenced in this phase (create as needed)
- **tests/**
  - `tests/ann-parity.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match ann-parity`
  - `tests/embedding-normalization-consistency.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match embedding-normalization-consistency`
  - `tests/embedding-quantization-no-wrap.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match embedding-quantization-no-wrap`
  - `tests/fixtures/embeddings` (NEW fixture/dir  -  create as part of this phase)
  - `tests/fixtures/embeddings/basic-repo` (NEW fixture/dir  -  create as part of this phase)
  - `tests/fixtures/embeddings/missing-vectors` (NEW fixture/dir  -  create as part of this phase)
  - `tests/fixtures/embeddings/quantization-caps` (NEW fixture/dir  -  create as part of this phase)
  - `tests/hnsw-target-selection.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match hnsw-target-selection`
  - `tests/indexer-service-embedding-job-uses-build-root.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match indexer-service-embedding-job-uses-build-root`
  - `tests/integration/ann-parity.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match ann-parity.test`
  - `tests/lancedb-candidate-filtering.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match lancedb-candidate-filtering`
  - `tests/manifest-embeddings-pieces.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match manifest-embeddings-pieces`
  - `tests/quantize-embedding-utils.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match quantize-embedding-utils`
  - `tests/retrieval-strict-manifest-embeddings.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match retrieval-strict-manifest-embeddings`
  - `tests/storage/embeddings-backend-resilience.test.js` (NEW)  -  intended lane: `storage`; run (once created): `npm run test:storage -- --match embeddings-backend-resilience.test`
  - `tests/unit/ann-backend-selection.test.js` (NEW)  -  intended lane: `unit`; run (once created): `npm run test:unit -- --match ann-backend-selection.test`
  - `tests/unit/cache-preflight-meta.test.js` (NEW)  -  intended lane: `unit`; run (once created): `npm run test:unit -- --match cache-preflight-meta.test`
  - `tests/unit/dense-vector-mode.test.js` (NEW)  -  intended lane: `unit`; run (once created): `npm run test:unit -- --match dense-vector-mode.test`
  - `tests/unit/hnsw-insert-failures.test.js` (NEW)  -  intended lane: `unit`; run (once created): `npm run test:unit -- --match hnsw-insert-failures.test`
  - `tests/unit/hnsw-load-signature.test.js` (NEW)  -  intended lane: `unit`; run (once created): `npm run test:unit -- --match hnsw-load-signature.test`
  - `tests/unit/lancedb-candidate-filtering.test.js` (NEW)  -  intended lane: `unit`; run (once created): `npm run test:unit -- --match lancedb-candidate-filtering.test`
  - `tests/unit/lancedb-connection-cache.test.js` (NEW)  -  intended lane: `unit`; run (once created): `npm run test:unit -- --match lancedb-connection-cache.test`
  - `tests/unit/lancedb-filter-pushdown.test.js` (NEW)  -  intended lane: `unit`; run (once created): `npm run test:unit -- --match lancedb-filter-pushdown.test`
  - `tests/unit/lmdb-mapsize.test.js` (NEW)  -  intended lane: `unit`; run (once created): `npm run test:unit -- --match lmdb-mapsize.test`
  - `tests/unit/sqlite-ann-mode-scope.test.js` (NEW)  -  intended lane: `unit`; run (once created): `npm run test:unit -- --match sqlite-ann-mode-scope.test`


## Appendix P9  -  repo touchpoint map

> Line ranges are approximate. Prefer anchor strings (function/export names) over line numbers.

### Existing directories referenced
- `src/index/build/artifacts/writers/` (DIR; exists)
- `src/index/identity/` (DIR; exists)
- `src/index/tooling/` (DIR; exists)
- `tests/type-inference-crossfile/` (DIR; exists)
- `tools/bench/` (DIR; exists)

### Existing src/ files referenced (edit candidates)
- `src/contracts/schemas/artifacts.js` (~L1-L677)  -  exports/anchors: `ARTIFACT_SCHEMA_DEFS`
- `src/index/build/artifacts.js` (~L1-L528)
- `src/index/build/file-processor.js` (~L1-L529)  -  exports/anchors: `createFileProcessor`
- `src/index/build/file-processor/assemble.js` (~L1-L127)  -  exports/anchors: `buildChunkPayload`
- `src/index/build/file-processor/relations.js` (~L1-L71)  -  exports/anchors: `buildCallIndex`, `buildFileRelations`, `stripFileRelations`
- `src/index/build/graphs.js` (~L1-L267)  -  exports/anchors: `buildRelationGraphs`
- `src/index/chunk-id.js` (~L1-L21)  -  exports/anchors: `buildChunkId`, `resolveChunkId`
- `src/index/identity/chunk-uid.js` (~L1-L204)  -  exports/anchors: `PRE_CONTEXT_CHARS`, `POST_CONTEXT_CHARS`, `ESCALATION_CONTEXT_CHARS`, `MAX_COLLISION_PASSES`, `normalizeForUid`
- `src/index/metadata-v2.js` (~L1-L301)  -  exports/anchors: `buildMetaV2`, `finalizeMetaV2`
- `src/index/segments.js` (~L1-L190)  -  exports/anchors: `assignSegmentUids`, `discoverSegments`, `chunkSegments`
- `src/index/tooling/clangd-provider.js` (~L1-L187)  -  exports/anchors: `CLIKE_EXTS`, `createClangdProvider`
- `src/index/tooling/pyright-provider.js` (~L1-L127)  -  exports/anchors: `PYTHON_EXTS`, `createPyrightProvider`
- `src/index/tooling/sourcekit-provider.js` (~L1-L93)  -  exports/anchors: `SWIFT_EXTS`, `createSourcekitProvider`
- `src/index/tooling/typescript-provider.js` (~L1-L467)  -  exports/anchors: `createTypeScriptProvider`
- `src/index/type-inference-crossfile/pipeline.js` (~L1-L438)
- `src/index/type-inference-crossfile/symbols.js` (~L1-L30)  -  exports/anchors: `leafName`, `isTypeDeclaration`, `addSymbol`, `resolveUniqueSymbol`
- `src/index/validate.js` (~L1-L581)
- `src/lang/javascript/relations.js` (~L1-L687)  -  exports/anchors: `buildCodeRelations`
- `src/map/build-map.js` (~L1-L288)  -  exports/anchors: `buildNodeList`, `buildMapCacheKey`
- `src/map/build-map/edges.js` (~L1-L186)  -  exports/anchors: `buildEdgesFromGraph`, `buildEdgesFromCalls`, `buildEdgesFromUsage`, `buildEdgesFromCallSummaries`, `buildImportEdges`
- `src/map/build-map/filters.js` (~L1-L229)  -  exports/anchors: `resolveFocus`, `normalizeIncludeList`, `applyLimits`, `applyScopeFilter`, `applyCollapse`
- `src/map/build-map/symbols.js` (~L1-L95)  -  exports/anchors: `buildSymbolId`, `buildPortId`, `upsertMember`, `buildMemberIndex`, `resolveMemberByName`
- `src/map/isometric/client/map-data.js` (~L1-L47)  -  exports/anchors: `initMapData`
- `src/shared/artifact-io.js` (~L1-L12)
- `src/shared/artifact-io/jsonl.js` (~L1-L79)  -  exports/anchors: `resolveJsonlRequiredKeys`, `parseJsonlLine`
- `src/shared/artifact-schemas.js` (~L1-L2)
- `src/shared/identity.js` (~L1-L104)  -  exports/anchors: `buildChunkRef`, `isSemanticSymbolId`, `resolveSymbolJoinKey`, `resolveChunkJoinKey`, `buildSymbolKey`

### Existing docs/ files referenced (edit candidates)
- `docs/phases/phase-9/identity-contracts.md` (~L1-L132)
- `docs/phases/phase-9/migration-and-backcompat.md` (~L1-L45)
- `docs/phases/phase-9/symbol-artifacts-and-pipeline.md` (~L1-L122)
- `docs/specs/identity-contract.md` (~L1-L313)

### Existing tests/ files referenced (edit candidates)
- `tests/graph-chunk-id.js` (~L1-L43)  -  lane: `integration`; run: `npm run test:integration -- --match graph-chunk-id`

### Planned/new paths referenced in this phase (create as needed)
- **src/**
  - `src/index/build/artifacts/writers/symbol-edges.js` (NEW  -  create as part of this phase)
  - `src/index/build/artifacts/writers/symbol-occurrences.js` (NEW  -  create as part of this phase)
  - `src/index/build/artifacts/writers/symbols.js` (NEW  -  create as part of this phase)
  - `src/index/identity/kind-group.js` (NEW  -  create as part of this phase)
  - `src/index/identity/normalize.js` (NEW  -  create as part of this phase)
  - `src/index/identity/segment-uid.js` (NEW  -  create as part of this phase)
  - `src/index/identity/symbol.js` (NEW  -  create as part of this phase)
  - `src/index/identity/virtual-path.js` (NEW  -  create as part of this phase)
  - `src/index/type-inference-crossfile/resolve-relative-import.js` (NEW  -  create as part of this phase)
  - `src/index/type-inference-crossfile/resolver.js` (NEW  -  create as part of this phase)
- **tools/**
  - `tools/bench/symbol-resolution-bench.js` (NEW  -  create as part of this phase)
- **docs/**
  - `docs/specs/symbol-artifacts.md` (NEW doc/spec  -  create as part of this phase)
  - `docs/specs/symbol-identity-and-symbolref.md` (NEW doc/spec  -  create as part of this phase)
- **tests/**
  - `tests/artifacts/symbol-artifacts-smoke.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match symbol-artifacts-smoke.test`
  - `tests/benchmarks` (NEW fixture/dir  -  create as part of this phase)
  - `tests/crossfile/resolve-relative-import.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match resolve-relative-import.test`
  - `tests/crossfile/symbolref-resolution.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match symbolref-resolution.test`
  - `tests/determinism` (NEW fixture/dir  -  create as part of this phase)
  - `tests/determinism/symbol-artifact-order.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match symbol-artifact-order.test`
  - `tests/fixtures/graph/chunkuid-join` (NEW fixture/dir  -  create as part of this phase)
  - `tests/fixtures/identity/chunkuid-collision` (NEW fixture/dir  -  create as part of this phase)
  - `tests/fixtures/imports/relative-ambiguous` (NEW fixture/dir  -  create as part of this phase)
  - `tests/fixtures/symbols/ambiguous-defs` (NEW fixture/dir  -  create as part of this phase)
  - `tests/identity/chunk-uid-stability.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match chunk-uid-stability.test`
  - `tests/identity/segment-uid-stability.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match segment-uid-stability.test`
  - `tests/identity/symbol-identity.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match symbol-identity.test`
  - `tests/integration/chunkuid-determinism.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match chunkuid-determinism.test`
  - `tests/integration/file-name-collision-no-wrong-join.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match file-name-collision-no-wrong-join.test`
  - `tests/integration/graph-relations-v2-chunkuid.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match graph-relations-v2-chunkuid.test`
  - `tests/integration/import-resolver-relative.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match import-resolver-relative.test`
  - `tests/integration/map-chunkuid-join.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match map-chunkuid-join.test`
  - `tests/integration/symbol-artifact-determinism.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match symbol-artifact-determinism.test`
  - `tests/map/map-build-symbol-identity.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match map-build-symbol-identity.test`
  - `tests/services/symbol-artifacts-emission.test.js` (NEW)  -  intended lane: `services`; run (once created): `npm run test:services -- --match symbol-artifacts-emission.test`
  - `tests/services/symbol-edges-ambiguous.test.js` (NEW)  -  intended lane: `services`; run (once created): `npm run test:services -- --match symbol-edges-ambiguous.test`
  - `tests/services/symbol-links-by-chunkuid.test.js` (NEW)  -  intended lane: `services`; run (once created): `npm run test:services -- --match symbol-links-by-chunkuid.test`
  - `tests/unit/chunk-uid-stability.test.js` (NEW)  -  intended lane: `unit`; run (once created): `npm run test:unit -- --match chunk-uid-stability.test`
  - `tests/unit/identity-symbolkey-scopedid.test.js` (NEW)  -  intended lane: `unit`; run (once created): `npm run test:unit -- --match identity-symbolkey-scopedid.test`
  - `tests/unit/segment-uid-stability.test.js` (NEW)  -  intended lane: `unit`; run (once created): `npm run test:unit -- --match segment-uid-stability.test`
  - `tests/unit/symbolref-envelope.test.js` (NEW)  -  intended lane: `unit`; run (once created): `npm run test:unit -- --match symbolref-envelope.test`
  - `tests/unit/tooling/clangd-provider-output-shape.test.js` (NEW)  -  intended lane: `unit`; run (once created): `npm run test:unit -- --match clangd-provider-output-shape.test`
  - `tests/unit/tooling/pyright-provider-output-shape.test.js` (NEW)  -  intended lane: `unit`; run (once created): `npm run test:unit -- --match pyright-provider-output-shape.test`
  - `tests/unit/tooling/sourcekit-provider-output-shape.test.js` (NEW)  -  intended lane: `unit`; run (once created): `npm run test:unit -- --match sourcekit-provider-output-shape.test`
  - `tests/unit/tooling/typescript-provider-output-shape.test.js` (NEW)  -  intended lane: `unit`; run (once created): `npm run test:unit -- --match typescript-provider-output-shape.test`
  - `tests/validate/chunk-uid-required.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match chunk-uid-required.test`
  - `tests/validate/symbol-integrity-strict.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match symbol-integrity-strict.test`


## Appendix P10  -  repo touchpoint map

> Line ranges are approximate. Prefer anchor strings (function/export names) over line numbers.

### Existing directories referenced
- `docs/new_docs/` (DIR; exists)
- `docs/specs/` (DIR; exists)
- `src/contracts/` (DIR; exists)

### Existing src/ files referenced (edit candidates)
- `src/contracts/registry.js` (~L1-L10)  -  exports/anchors: `ARTIFACT_SCHEMA_REGISTRY`, `ARTIFACT_SCHEMA_HASH`, `ARTIFACT_SCHEMA_NAMES`, `getArtifactSchema`
- `src/contracts/schemas/artifacts.js` (~L1-L677)  -  exports/anchors: `ARTIFACT_SCHEMA_DEFS`
- `src/index/build/artifacts/compression.js` (~L1-L46)  -  exports/anchors: `resolveCompressionConfig`
- `src/index/build/artifacts/writers/call-sites.js` (~L1-L276)  -  exports/anchors: `createCallSites`, `enqueueCallSitesArtifacts`
- `src/index/build/graphs.js` (~L1-L267)  -  exports/anchors: `buildRelationGraphs`
- `src/index/build/indexer/pipeline.js` (~L1-L326)
- `src/index/build/indexer/signatures.js` (~L1-L120)  -  exports/anchors: `SIGNATURE_VERSION`, `buildIncrementalSignatureSummary`, `buildIncrementalSignaturePayload`, `buildTokenizationKey`, `buildIncrementalSignature`
- `src/index/build/indexer/steps/relations.js` (~L1-L205)  -  exports/anchors: `resolveImportScanPlan`, `preScanImports`, `postScanImports`, `runCrossFileInference`
- `src/index/build/indexer/steps/write.js` (~L1-L101)  -  exports/anchors: `writeIndexArtifactsForMode`
- `src/index/build/piece-assembly.js` (~L1-L512)
- `src/index/build/runtime/runtime.js` (~L1-L683)
- `src/index/metadata-v2.js` (~L1-L301)  -  exports/anchors: `buildMetaV2`, `finalizeMetaV2`
- `src/index/risk.js` (~L1-L404)  -  exports/anchors: `normalizeRiskConfig`, `detectRiskSignals`
- `src/index/type-inference-crossfile/extract.js` (~L1-L84)  -  exports/anchors: `extractReturnTypes`, `extractParamTypes`, `extractReturnCalls`, `inferArgType`
- `src/index/validate.js` (~L1-L581)
- `src/index/validate/artifacts.js` (~L1-L38)  -  exports/anchors: `buildArtifactLists`
- `src/index/validate/presence.js` (~L1-L183)  -  exports/anchors: `createArtifactPresenceHelpers`
- `src/lang/javascript/relations.js` (~L1-L687)  -  exports/anchors: `buildCodeRelations`
- `src/shared/artifact-io/jsonl.js` (~L1-L79)  -  exports/anchors: `resolveJsonlRequiredKeys`, `parseJsonlLine`
- `src/shared/hash.js` (~L1-L74)  -  exports/anchors: `sha1`, `sha1File`, `setXxhashBackend`

### Existing tools/ files referenced (edit candidates)
- `tools/dict-utils/config.js` (~L1-L310)  -  exports/anchors: `loadUserConfig`, `getEffectiveConfigHash`, `getCacheRoot`, `getDictConfig`, `applyAdaptiveDictConfig`

### Existing docs/ files referenced (edit candidates)
- `docs/config/contract.md` (~L1-L70)
- `docs/config/schema.json` (~L1-L264)
- `docs/new_docs/interprocedural-state-and-pipeline_DRAFT.md` (~L1-L156)
- `docs/new_docs/risk-callsite-id-and-stats_IMPROVED.md` (~L1-L120)
- `docs/new_docs/spec_risk-flows-and-call-sites_RECONCILED.md` (~L1-L141)
- `docs/new_docs/spec_risk-interprocedural-config_IMPROVED.md` (~L1-L99)
- `docs/new_docs/spec_risk-summaries_IMPROVED.md` (~L1-L169)
- `docs/specs/risk-callsite-id-and-stats.md` (~L1-L162)
- `docs/specs/risk-flows-and-call-sites.md` (~L1-L341)
- `docs/specs/risk-interprocedural-config.md` (~L1-L171)
- `docs/specs/risk-interprocedural-stats.md` (~L1-L9)
- `docs/specs/risk-summaries.md` (~L1-L253)

### Existing bin/ files referenced (edit candidates)
- `bin/pairofcleats.js` (~L1-L279)

### Planned/new paths referenced in this phase (create as needed)
- **src/**
  - `src/index/build/artifacts/writers/risk-interprocedural.js` (NEW  -  create as part of this phase)
  - `src/index/callsite-id.js` (NEW  -  create as part of this phase)
  - `src/index/risk-interprocedural/config.js` (NEW  -  create as part of this phase)
  - `src/index/risk-interprocedural/edges.js` (NEW  -  create as part of this phase)
  - `src/index/risk-interprocedural/engine.js` (NEW  -  create as part of this phase)
  - `src/index/risk-interprocedural/summaries.js` (NEW  -  create as part of this phase)
  - `src/index/validate/risk-interprocedural.js` (NEW  -  create as part of this phase)
- **tools/**
  - `tools/explain-risk.js` (NEW  -  create as part of this phase)
- **docs/**
  - `docs/archived` (NEW  -  create as part of this phase)
  - `docs/archived/README.md` (NEW doc/spec  -  create as part of this phase)
  - `docs/archived/phase-10` (NEW  -  create as part of this phase)
  - `docs/archived/specs/phase-10` (NEW  -  create as part of this phase)
- **tests/**
  - `tests/cli/risk-explain.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match risk-explain.test`
  - `tests/fixtures/risk-interprocedural/js-simple` (NEW fixture/dir  -  create as part of this phase)
  - `tests/lang/javascript-paramnames.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match javascript-paramnames.test`
  - `tests/risk-interprocedural/artifacts-written.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match artifacts-written.test`
  - `tests/risk-interprocedural/callsite-id.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match callsite-id.test`
  - `tests/risk-interprocedural/callsite-sampling.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match callsite-sampling.test`
  - `tests/risk-interprocedural/config-normalization.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match config-normalization.test`
  - `tests/risk-interprocedural/flows-argaware-negative.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match flows-argaware-negative.test`
  - `tests/risk-interprocedural/flows-conservative.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match flows-conservative.test`
  - `tests/risk-interprocedural/flows-sanitizer-policy.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match flows-sanitizer-policy.test`
  - `tests/risk-interprocedural/flows-timeout.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match flows-timeout.test`
  - `tests/risk-interprocedural/runtime-gating.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match runtime-gating.test`
  - `tests/risk-interprocedural/summaries-determinism.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match summaries-determinism.test`
  - `tests/risk-interprocedural/summaries-schema.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match summaries-schema.test`
  - `tests/risk-interprocedural/summaries-truncation.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match summaries-truncation.test`
  - `tests/unit` (NEW fixture/dir  -  create as part of this phase)
  - `tests/validator/risk-interprocedural.test.js` (NEW)  -  intended lane: `integration`; run (once created): `npm run test:integration -- --match risk-interprocedural.test`










