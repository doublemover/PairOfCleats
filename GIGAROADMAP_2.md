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
- **Prefer “fix docs to match code”** when the code is already contract-validated and has tests.
- **Prefer “fix code to match docs/contracts”** only when the contract/validator is explicit and the code violates it.

### Touchpoints + line ranges (important: line ranges are approximate)
This document includes file touchpoints with **approximate** line ranges like:

- `src/foo/bar.js` **(~L120–L240)** — anchor: `someFunctionName`

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
> 9->10 must be done sequentially.

- **Phase 9 — Symbol identity (collision-safe IDs) + cross-file linking**
  - Phase 9 objective + non-goals + locked decisions
  - Phase 9 contracts (normative; implementation-ready)
  - Phase 9 implementation plan (tasks/tests)
    - 9.1 — Verify identity primitives
    - 9.2 — Symbol identity
      - 9.2.1 — Implement/extend symbol identity helpers
      - 9.2.2 — Attach `metaV2.symbol`
    - 9.3 — Import bindings + resolver
      - 9.3.1 — Emit `importBindings` in `file_relations`
      - 9.3.2 — Relative import resolver helper
      - 9.3.3 — SymbolRef resolver
      - 9.3.4 — Tests
    - 9.4 — Cross-file linking pipeline
      - 9.4.1 — Replace `file::name` join logic with SymbolRef resolution
      - 9.4.2 — Emit new-format `callLinks` and `usageLinks`
      - 9.4.3 — Keep `callSummaries`, but add resolved IDs where possible
      - 9.4.4 — Tooling provider audit
      - 9.4.5 — Pipeline tests
    - 9.5 — Symbol graph artifacts
      - 9.5.1 — Writers
      - 9.5.2 — Artifact integration
    - 9.6 — Graph building
      - 9.6.1 — Update graph builder to ingest SymbolRef links
      - 9.6.2 — Version bump
    - 9.7 — Map build (stop using `file::name` as member identity)
      - 9.7.1 — Member ID strategy
      - 9.7.2 — Backward compatibility
    - 9.8 — Performance, determinism, and regression guardrails
      - 9.8.1 — Determinism requirements
      - 9.8.2 — Throughput requirements
  - Phase 9 exit criteria + addendum (dependencies, ordering, artifacts, tests, edge cases)

- **Phase 10 — Interprocedural risk propagation + explainability artifacts**
  - Source-of-truth decisions + conflicts resolved (A–C)
  - 10.0 — Documentation merge + canonical spec cleanup (FOUNDATION)
  - 10.1 — Config wiring + runtime gating (FOUNDATION)
  - 10.2 — Param name stabilization for arg-aware mode (FOUNDATION)
  - 10.3 — Risk summaries (artifact + compact docmeta)
  - 10.4 — Shared callsite utilities (FOUNDATION)
  - 10.5 — Interprocedural propagation → `risk_flows`
  - 10.6 — Artifact writing + contracts + manifest integration
  - 10.7 — Validation + referential integrity
  - 10.8 — CLI: explain interprocedural risk flows
  - 10.9 — Cross-cutting robustness improvements (recommended)
  - Phase 10 completion checklist
  - 10.A–10.E — Spec appendices (output of 10.0 merge; keep in-sync with contracts)

---

## Phase 9 objective (what "done" means)

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

This phase directly targets the Phase 9 intent in the roadmap ("Symbol identity (collision-safe IDs) + cross-file linking") and depends on the canonical `chunkUid` contract delivered in Phase 8. In particular, the `chunkUid` construction approach and "fail closed" requirement are consistent with the canonical identity contract described in the planning materials.

---

## Phase 9 non-goals (explicitly out of scope for Phase 9 acceptance)

These may be separate follow-on phases or optional extensions:

- Full **SCIP/LSIF/ctags hybrid symbol source registry** (runtime selection/merging) beyond ensuring the contracts can represent those IDs.
- Full module-resolution parity with Node/TS (tsconfig paths, package exports/imports, Yarn PnP, etc). Phase 9 supports **relative import resolution** only.
- Whole-program correctness for dynamic languages; Phase 9 focuses on **correctness under ambiguity** (never wrong-link) rather than "resolve everything".
- Cross-repo symbol federation.

---

## Phase 9 key decisions (locked)

These choices remove ambiguity and prevent future "forks" in implementation.

### D1) Graph node identity uses `chunkUid`, not `file::name`, not legacy `chunkId`

- **Chosen:** `chunkUid` is the canonical node identifier for graphs and cross-file joins.
- **Why:** `file::name` is not unique; `chunkId` is range-based and churns with line shifts. The roadmap's canonical identity guidance explicitly calls for a `chunkUid` that is stable under line shifts and includes segment disambiguation.

### D2) Symbol identity is a two-layer model: `symbolKey` (human/debug) + `symbolId` (portable token)

- **Chosen:** Persist both.
- **Why:** `symbolKey` is explainable and supports deterministic "rebuild equivalence" reasoning. `symbolId` is compact and future-proofs external sources (SCIP/LSIF) without schema churn.

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

A deterministic "as-if file path" that disambiguates segments:

- If no segment: `virtualPath = fileRelPath`
- If segment: `virtualPath = fileRelPath + "#seg:" + segmentUid`

#### 9.C1.3 `chunkUid` (string)

- **Definition:** Stable-ish identifier for a chunk, used for graphs and join keys.
- **Stability:** Must remain stable when only lines outside the chunk's span shift (i.e., chunk text unchanged).
- **Collision handling:** If a collision is detected within `{virtualPath, segmentUid}`, deterministically disambiguate and record `collisionOf`.

**Algorithm (v1) -- consistent with the canonical contract described in the planning docs:**

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

This follows the canonical identity contract exactly (see `docs/specs/identity-contract.md` §4).

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

Normalize "kind" strings into a stable group set:

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

### 9.1 Verify identity primitives (`segmentUid`, `chunkUid`, `virtualPath`) -- delivered in Phase 8

> If any identity primitive is missing or diverges from the canonical spec, stop Phase 9 and complete the work in Phase 8 before continuing.

**Verification checklist (no new algorithm changes in Phase 9)**
- Code presence:
  - `src/index/identity/*` helpers exist and match `docs/specs/identity-contract.md`.
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
- `src/index/metadata-v2.js` — attach `metaV2.symbol` (definition chunks only).
- `src/shared/identity.js` — **already exists** and contains symbol identity primitives. Phase 9 MUST extend/reuse this (do **not** fork identity algorithms).
- New (optional wrapper): `src/index/identity/symbol.js` — if created, keep it as a thin adapter over `src/shared/identity.js` for index-specific policy (definition chunk detection, kind-group mapping, etc).
- Update callsites: graph builder, cross-file resolver, map builder

#### 9.2.1 Implement symbol identity builder

- [ ] **Update `src/shared/identity.js` (do this first)**
  - [ ] Confirm/export the primitives used by every symbol identity producer:
    - `buildSymbolKey(...)`
    - `buildSignatureKey(...)`
    - `buildScopedSymbolId(...)`
    - `buildSymbolId(...)`
    - `resolveSymbolJoinKey(...)` (used to join calls/usages to symbol definitions)
  - [ ] Ensure the primitives accept the Phase 9 canonical inputs (`virtualPath`, `qualifiedName`, `signature`, `kindGroup`, `chunkUid`/`segmentUid` as required by the Phase 9 contracts) and **do not depend on legacy `chunkId`** for uniqueness unless explicitly marked legacy/back-compat.

- [ ] **Add `src/index/identity/kind-group.js`**
  - [ ] Implement `toKindGroup(kind: string | null): string`

- [ ] **Add `src/index/identity/symbol.js`** *(thin adapter over `src/shared/identity.js`)*
  - [ ] Export `buildSymbolIdentity({ metaV2 }): { scheme, kindGroup, qualifiedName, symbolKey, signatureKey, scopedId, symbolId } | null`
  - [ ] **Hard requirement:** implement hashing/key building by calling helpers from `src/shared/identity.js` (e.g., `buildSymbolKey`, `buildSignatureKey`, `buildScopedSymbolId`, `buildSymbolId`).  
    Do **not** create a second independent SymbolKey/SignatureKey algorithm.
  - [ ] Return null when chunk is not a "definition chunk" (policy below).

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
      - If `importBindings` provides a binding for the target's root identifier, resolve that module to a file.
      - Restrict candidate search to those files; then apply export filtering:
        - if imported name is known, prefer matching exports.
    - If exactly one best candidate above threshold ⇒ `status=resolved`
    - Else if >=2 candidates above threshold ⇒ `status=ambiguous` with top-K candidates
    - Else ⇒ `status=unresolved` with empty candidates

**Caps / guardrails (must be implemented):**

- `MAX_CANDIDATES_PER_REF = 25`
- `MAX_CANDIDATES_GLOBAL_SCAN = 200` (if exceeded, downgrade to ambiguous with "too many" signal)
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

#### 9.4.4 Tooling provider audit (chunkUid-keyed outputs are already implemented)

✅ **Current repo state (verified in code):** all built-in tooling providers already return results keyed by `chunkUid` (no `file::name` Maps).

Providers (current touchpoints):
- `src/index/tooling/clangd-provider.js` — returns `{ byChunkUid }` (capability: `supportsSymbolRef: false`)
- `src/index/tooling/pyright-provider.js` — returns `{ byChunkUid }` (capability: `supportsSymbolRef: false`)
- `src/index/tooling/sourcekit-provider.js` — returns `{ byChunkUid }` (capability: `supportsSymbolRef: false`)
- `src/index/tooling/typescript-provider.js` — returns `{ byChunkUid }` (capability: `supportsSymbolRef: true`)

**Why keep this task anyway?**  
Phase 9 relies on `chunkUid` as the canonical join key, so we need a regression-proof audit + tests that prevent reintroducing `file::name` joins.

- [x] Confirm each provider’s public output surface is `{ provider, byChunkUid }` (not `{ byFile }`).
- [ ] Add a targeted regression test per provider that asserts:
  - [ ] the top-level key is `byChunkUid`,
  - [ ] keys look like `ck64:v1:` / `chunk:`-style UIDs (not `file::name`),
  - [ ] duplicate keys are not silently overwritten (throw or log+count, but do not drop).
  - Suggested test files (choose lane explicitly):
    - `tests/unit/tooling/clangd-provider-output-shape.test.js`
    - `tests/unit/tooling/pyright-provider-output-shape.test.js`
    - `tests/unit/tooling/sourcekit-provider-output-shape.test.js`
    - `tests/unit/tooling/typescript-provider-output-shape.test.js`

**Additional Phase 9 requirement for TS provider**
- [ ] Ensure the TS provider’s `symbolRef` emission uses the Phase 9 symbol identity scheme (see 9.2), and does not embed legacy `chunkId` in any join-critical field unless explicitly marked “legacy/back-compat”.

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
  - [ ] Emit unresolved/ambiguous edges as well (they're valuable for metrics and later resolution).

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
  - Build a small in-memory "fake state" with 2 chunks and resolved/ambiguous links.
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
- [ ] `metaV2.chunkUid` is present and non-empty for every code chunk ("fail closed").
- [ ] `graph_relations.version === 2` and node ids are `chunkUid`.
- [ ] Pipeline emits SymbolRef-based call/usage links; ambiguous/unresolved are preserved explicitly.
- [ ] Symbol artifacts are written and validate successfully on the small fixture suite.
- [ ] New tests for chunkUid stability and resolver correctness are green.

---

## Appendix A -- Concrete file-by-file change list

This appendix is purely to reduce "search time" during implementation. Each file lists the exact intent.

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

- `src/index/segments.js` -- compute and propagate `segmentUid`
- `src/index/build/file-processor.js` -- compute `chunkUid`
- `src/index/build/file-processor/assemble.js` -- pass through chunkUid fields
- `src/index/metadata-v2.js` -- include identity + symbol identity
- `src/lang/javascript/relations.js` -- emit `importBindings`
- `src/index/build/file-processor/relations.js` -- include importBindings
- `src/shared/artifact-schemas.js` -- add schemas, extend file_relations
- `src/shared/artifact-io.js` -- required keys for new JSONL artifacts
- `src/index/type-inference-crossfile/pipeline.js` -- emit SymbolRef edges and avoid file::name joins
- `src/index/tooling/{typescript,pyright,clangd,sourcekit}-provider.js` -- key by chunkUid
- `src/index/build/artifacts.js` -- write symbol artifacts
- `src/index/validate.js` -- validate symbol artifacts (optional strict)
- `src/index/build/graphs.js` -- graph_relations v2 using chunkUid
- `src/map/build-map.js` -- join graph nodes to chunk meta via chunkUid
- `tests/graph-chunk-id.js` -- update

---

## Appendix B -- Metrics to report (recommended)

- `symbol_resolution.resolved_rate`
- `symbol_resolution.ambiguous_rate`
- `symbol_resolution.unresolved_rate`
- `symbol_resolution.max_candidates_hit_rate`
- `symbol_resolution.import_narrowed_rate`

In strict CI mode, optionally enforce:

- `wrong_link_rate == 0` on fixtures with gold truth
- `resolved_rate >= threshold` on fixtures (threshold set per fixture)

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
  - Resolved: docs/phases/phase-9/identity-contracts.md now matches docs/specs/identity-contract.md for chunkUid (span/pre/post hashes + virtualPath + segmentUid).
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
- docs/phases/phase-9/identity-contracts.md
- docs/phases/phase-9/symbol-artifacts-and-pipeline.md
- docs/phases/phase-9/migration-and-backcompat.md
- docs/specs/identity-contract.md
- docs/specs/symbol-identity-and-symbolref.md
- docs/specs/symbol-artifacts.md

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

---
## Phase 10 — Interprocedural risk propagation + explainability artifacts

**Goal:** Add a deterministic, capped, explainable *interprocedural* risk propagation system for the **code** index mode that:
- Reuses existing **local** risk signals (`docmeta.risk` from `src/index/risk.js`).
- Reuses existing **cross-file inference** call resolution (`applyCrossFileInference`), specifically `callDetails[].targetChunkUid`.
- Emits **new artifacts**:
  - `risk_summaries*.jsonl` (+ shard meta)
  - `risk_flows*.jsonl` (+ shard meta)
  - `risk_interprocedural_stats.json`
- Adds a compact, low-bytes **`docmeta.risk.summary`** for each risk-relevant chunk (to support fast display/filtering without scanning JSONL).
- Provides a CLI to explain the flows in an index (`pairofcleats risk explain …`).

---

### Source-of-truth decisions + conflicts resolved 

This phase touches multiple “specs” that are currently **not aligned** with the repo’s implemented contracts. Implement the *best* functionality **and** remove ambiguity by making these explicit choices.

#### A) `call_sites.jsonl` schema: **CODE contract is authoritative**
- **Authoritative schema:** `src/contracts/schemas/artifacts.js` (`call_sites` entry schema)
- **Writer:** `src/index/build/artifacts/writers/call-sites.js`

The older spec `docs/specs/risk-flows-and-call-sites.md` contains a *different* `call_sites` row shape (e.g., `calleeName`, `argsSummary`, no `start/end offsets`, etc.). That spec is **out of date** for `call_sites`.

✅ **Choice:** Do **not** change the repo’s `call_sites` contract to match the spec.  
✅ **Action:** Update the *documents/specs* to match the code contract (see **10.0 Doc merge**).

**Why:** `call_sites` already exists, is validated by contracts/tests, and is used for call graph evidence. The safest and most correct approach is to treat the implemented contract as the single source of truth and bring docs into alignment.

#### B) `callSiteId` algorithm: **keep the existing implementation; update newer docs**
- **Actual implementation:** `buildCallSiteId(...)` in `src/index/build/artifacts/writers/call-sites.js`
- **Doc (currently aligned with code):** `docs/specs/risk-callsite-id-and-stats.md`
- **Doc (currently NOT aligned with code):** `docs/new_docs/risk-callsite-id-and-stats_IMPROVED.md` (it proposes a different string-to-hash recipe)

✅ **Choice:** Keep the current algorithm (colon-separated parts, no `callsite:v1` prefix).  
✅ **Action:** Update the “IMPROVED” doc during merge (or explicitly label it as a future v2) so docs do not contradict working code.

**Why:** Changing `callSiteId` would silently invalidate any stored references and degrade determinism across builds. We can introduce a versioned v2 later **only** if we add an explicit `callSiteIdVersion`/`schemaVersion` surface.

#### C) Config surface conflict: “repo config contract” vs Phase 10 config keys
- `docs/config/contract.md` suggests a narrow public config surface.
- Phase 10’s specs and roadmap require `indexing.riskInterprocedural`.

✅ **Choice (best for engineering velocity + testability):** Treat `indexing.riskInterprocedural` as an **internal/advanced** indexing knob and explicitly preserve it through config load/normalization.  
✅ **Action:** Update `tools/dict-utils/config.js` normalization to keep `indexing.riskInterprocedural` (and any prerequisite knobs used by runtime gating), and update docs so the contract vs internal knobs are clearly delineated.

**Why:** Interprocedural risk is *expensive* and must be opt-in. The least invasive, most explicit opt-in is a config knob. If the product wants a narrower public contract later, it can gate exposure without deleting the internal setting.

---

## 10.0 Documentation merge + canonical spec cleanup (FOUNDATION — do first)

> **Objective:** Eliminate spec drift *before* implementation.

### 10.0.1 Merge/replace outdated specs with reconciled versions
Files involved (read all, then produce a merged canonical set):

- Canonical targets (should live under `docs/specs/`):
  - `docs/specs/risk-interprocedural-config.md`
  - `docs/specs/risk-summaries.md`
  - `docs/specs/risk-flows-and-call-sites.md`
  - `docs/specs/risk-callsite-id-and-stats.md`
  - `docs/specs/risk-interprocedural-stats.md` (currently placeholder)

- Sources to merge in (from `docs/new_docs/`):
  - `spec_risk-interprocedural-config_IMPROVED.md`
  - `spec_risk-summaries_IMPROVED.md`
  - `spec_risk-flows-and-call-sites_RECONCILED.md`
  - `risk-callsite-id-and-stats_IMPROVED.md`
  - `interprocedural-state-and-pipeline_DRAFT.md`

**Required merge outcomes (no ambiguity):**
1. **`call_sites` schema section** in `risk-flows-and-call-sites.md` must explicitly say:
   - “Call sites are the existing artifact contract in `src/contracts/schemas/artifacts.js`.”
   - “For interprocedural risk, we only require a subset of fields (list them), but the artifact may contain superset fields.”
2. **`callSiteId` algorithm** section must match `buildCallSiteId` in `call-sites.js` (use `calleeRaw`, not `calleeName`).
3. **Risk summaries schema** must incorporate the improved doc’s stronger evidence shape (start/end line+col) **and** keep the older doc’s truncation/caps guidance. Any mismatched field names must be resolved (see 10.3 for the final schema we will implement).
4. **Risk flows schema**: keep the roadmap’s detailed schema (source+sink endpoints, path with `chunkUids` + `callSiteIdsByStep`, confidence, notes). If any new_docs schema differs, update it to match.
5. **Stats schema** must be explicit about what “callSitesEmitted” counts in a world where `call_sites` is a general artifact:
   - ✅ Define it as “unique callSiteIds referenced by emitted `risk_flows`” (not total rows in call_sites).
6. Remove any outdated statements (e.g., “docs/config/schema.json doesn’t include indexing.*” is no longer accurate).

### 10.0.2 Add “Spec status table” inside Phase 10 docs
Create a small table (in whichever canonical spec is most appropriate, or at the top of this Phase 10 section) showing:

- spec file → implemented-by code module → status (implemented / draft / planned)
- version numbers (schemaVersion) and compatibility notes


### 10.0.3 Archive deprecated specs + codify the process (MANDATORY)

This implements the repo-wide rule:

> Deprecated/replaced spec documents must be moved to `docs/archived/` (never deleted), and the process must be documented in `AGENTS.md`.

**Tasks**
- [ ] Create `docs/archived/README.md` explaining:
  - what belongs here,
  - how to name/archive files,
  - how to reference the replacement spec.
- [ ] Create `docs/archived/phase-10/` (or `docs/archived/specs/phase-10/`) as the destination for Phase 10 spec deprecations.
- [ ] After the merges in **10.0.1** are complete:
  - [ ] Move the *staging* source docs from `docs/new_docs/` that are no longer meant to be edited:
    - `docs/new_docs/spec_risk-interprocedural-config_IMPROVED.md`
    - `docs/new_docs/spec_risk-summaries_IMPROVED.md`
    - `docs/new_docs/spec_risk-flows-and-call-sites_RECONCILED.md`
    - `docs/new_docs/risk-callsite-id-and-stats_IMPROVED.md`
    - `docs/new_docs/interprocedural-state-and-pipeline_DRAFT.md`
    - Destination: `docs/archived/phase-10/` (keep filenames intact).
  - [ ] Add a short “DEPRECATED” header block to each moved file that points to the canonical replacement(s) in `docs/specs/…`.
- [ ] Update **`AGENTS.md`** with a “Spec deprecation + archival process” section:
  - When to archive vs update-in-place.
  - Required metadata to include in the archived file header (replacement link + date/PR).
  - A reminder that contracts (`src/contracts/**`) remain authoritative and specs must track them.

**Why this is required**
- `docs/new_docs/` is a staging area; leaving parallel variants creates drift and confusion.
- `docs/archived/` preserves context without keeping multiple “active” specs.


---

## 10.1 Config wiring + runtime gating (FOUNDATION — do before any propagation code)

### 10.1.1 Add risk interprocedural config normalizer
**New file:** `src/index/risk-interprocedural/config.js`

Export:
- `normalizeRiskInterproceduralConfig(raw, { mode })`

Inputs:
- `raw` comes from `runtime.indexingConfig.riskInterprocedural` (or `{}`).

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
- `emitArtifacts`: accept `off|none` → `none`, `jsonl` → `jsonl`. Anything else → default `jsonl`.
- `strictness`: unknown → `conservative`
- `sanitizerPolicy`: unknown → `terminate`
- numeric caps:
  - coerce to integers
  - clamp to sane ranges (define in code):
    - `maxDepth`: 1..20
    - `maxPathsPerPair`: 1..50
    - `maxTotalFlows`: 0..1_000_000
    - `maxCallSitesPerEdge`: 1..50
    - `maxEdgeExpansions`: 10_000..10_000_000
    - `maxMs`: null OR 10..60_000
- `summaryOnly=true` forces “no flows” even if other caps allow.
- If `enabled=false`, downstream code must treat the entire feature as disabled and avoid any heavy compute.

### 10.1.2 Preserve config keys through repo config normalization
**File:** `tools/dict-utils/config.js`  
Function: `normalizeUserConfig(config)`

Today this function intentionally narrows the public config surface. For Phase 10 to be operable and testable, we must preserve:

- `config.indexing.riskInterprocedural` (entire nested object)

**Implementation requirement:**
- Add:
  - `riskInterprocedural: indexingConfig.riskInterprocedural || undefined`
  - under the returned `indexing` object.
- Keep it **as-is** (no normalization here); normalization is done in `src/index/risk-interprocedural/config.js`.

Also preserve any prerequisite knobs *already used by runtime* and referenced by specs (only if they are currently being dropped):
- `indexing.riskAnalysis` (if you want it configurable)
- `indexing.riskAnalysisCrossFile`
- `indexing.typeInferenceCrossFile`

If the project intentionally keeps these non-configurable, document that clearly in the merged specs and do not add them.

### 10.1.3 Wire effective config into build runtime
**File:** `src/index/build/runtime/runtime.js`

Tasks:
1. Import `normalizeRiskInterproceduralConfig`.
2. Compute:
   - `const riskInterproceduralConfig = normalizeRiskInterproceduralConfig(indexingConfig.riskInterprocedural, { mode });`
3. Add to returned runtime:
   - `riskInterproceduralConfig`
   - `riskInterproceduralEnabled` (boolean)
     - `true` iff:
       - `mode === 'code'`
       - `riskAnalysisEnabled === true` (Phase 10 depends on local signals)
       - `riskInterproceduralConfig.enabled === true`
4. Add gating to `analysisPolicy`:
   - include `analysisPolicy.risk.interprocedural = riskInterproceduralEnabled`
   - include `analysisPolicy.risk.interproceduralSummaryOnly = riskInterproceduralConfig.summaryOnly`

### 10.1.4 Ensure cross-file inference runs when riskInterprocedural is enabled
**File:** `src/index/build/indexer/steps/relations.js`

Current logic:
- `crossFileEnabled = typeInferenceCrossFileEnabled || riskAnalysisCrossFileEnabled`

Update to:
- `crossFileEnabled = typeInferenceCrossFileEnabled || riskAnalysisCrossFileEnabled || runtime.riskInterproceduralEnabled`

**Important constraint:** Enabling cross-file inference does **not** have to enable “type inference output artifacts”; it only needs to run resolution so `callDetails[].targetChunkUid` exists.

So, keep:
- `enableTypeInference: typeInferenceCrossFileEnabled`
- `enableRiskCorrelation: riskAnalysisCrossFileEnabled`
- (do NOT implicitly force these true just because riskInterprocedural is enabled)

### 10.1.5 Incremental build signature must include riskInterprocedural effective config
**File:** `src/index/build/indexer/signatures.js`

Add `riskInterproceduralConfig` (or a stable subset) to the signature components so incremental rebuilds invalidate when this changes.

- Use a stable JSON stringify (or hash) of the *normalized effective config* object.
- Do **not** include transient fields like timers.

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

(Exact nesting is flexible; but it must be deterministic and allow tooling to quickly see if risk flows are expected.)

### 10.1.7 Tests for config and gating
Add:
- `tests/risk-interprocedural/config-normalization.test.js`
  - unit test `normalizeRiskInterproceduralConfig`
  - include edge cases: alias values, bad types, clamp behavior
- `tests/risk-interprocedural/runtime-gating.test.js`
  - create runtime via `createBuildRuntime` with mode=`code` and mode=`prose`
  - assert `riskInterproceduralEnabled` toggles correctly
  - assert crossFileEnabled includes it (mock `runCrossFileInference` decision logic)

---

## 10.2 Param name stabilization for arg-aware mode (FOUNDATION)

> Arg-aware propagation requires stable “callee param names” to map tainted args → callee identifiers.

### 10.2.1 Fix JS param extraction to be stable + predictable
**File:** `src/lang/javascript/relations.js` (anchors referenced in original roadmap: around callLinks generation and docmeta param extraction)

Current risk:
- `node.params` can contain patterns (destructuring, defaults) that stringify inconsistently.

Required changes:
1. When building `docmeta.params` (or an adjacent structured field), produce **paramNames** array:
   - For `Identifier` param: use name directly.
   - For `AssignmentPattern` (`x=1`): use left identifier name if possible.
   - For `RestElement` (`...rest`): use argument identifier name if possible.
   - For patterns (`ObjectPattern`, `ArrayPattern`), use stable placeholders:
     - `"arg0"`, `"arg1"`, … (based on param index)
2. Ensure `paramNames` is:
   - stable order
   - capped (e.g., 16)
3. Preserve the existing `docmeta.signature` format (do not break search behavior).

**Cross-file inference dependency:**  
`applyCrossFileInference` populates `callLinks.paramNames` via `extractParamTypes`. That function must rely on stable `docmeta.params` or a new stable `docmeta.paramNames`. If needed:

- Update `src/index/type-inference-crossfile/extract.js` (function `extractParamTypes`) to prefer:
  - `docmeta.paramNames` if present
  - else fall back to `docmeta.params`

### 10.2.2 Add tests for JS param normalization
Add:
- `tests/lang/javascript-paramnames.test.js`

Fixture function:
```js
function f({a,b}, x=1, ...rest) {}
```

Expect:
- `docmeta.paramNames` equals `["arg0","x","rest"]`
- `callLinks.paramNames` for calls to `f` are consistent.

---

## 10.3 Risk summaries (artifact + compact docmeta)

> Summaries are the “input facts” for propagation and the primary explainability artifact even when propagation is disabled or times out.

### 10.3.1 Define the *final* summary row schema (implement exactly)
After doc merge (10.0), Implement this as the actual row contract (`schemaVersion: 1`):

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
- `buildRiskSummaries({ chunks, runtime, mode, log })`

Behavior:
1. Only run when:
   - `mode === 'code'`
   - `runtime.riskInterproceduralEnabled === true` OR `runtime.riskInterproceduralConfig.emitArtifacts === 'jsonl'`
   - (If disabled entirely, skip.)
2. For each chunk in `state.chunks`:
   - Read `chunk.docmeta?.risk` (produced by `src/index/risk.js`).
   - If no risk or no signals, skip row emission.
3. Convert `docmeta.risk.sources/sinks/sanitizers` into `RiskSignalSummary[]`:
   - Deterministic ordering:
     - primary: `severity` (high→medium→low→null) for sinks only
     - then `ruleId`
     - then earliest evidence location
   - Caps:
     - `maxSignalsPerKind = 50`
     - `maxEvidencePerSignal = 5`
     - `maxTagsPerSignal = 10`
4. Convert `docmeta.risk.flows` into `RiskLocalFlowSummary[]`:
   - Derive `sourceRuleId`/`sinkRuleId` from existing detector output:
     - detector: `flow.ruleIds = [sourceRuleId, sinkRuleId]`
   - Deterministic order:
     - `sourceRuleId`, then `sinkRuleId`, then evidence location
   - Caps:
     - `maxLocalFlows = 50`
5. Evidence normalization:
   - Input evidence from detector is `{ line, column, excerpt }`
   - Map:
     - `startLine = line`
     - `startCol = column`
     - `endLine = line` (or null if you prefer; pick one and be consistent)
     - `endCol = column`
     - `snippetHash = sha1(normalizeWhitespace(excerpt))` or null if excerpt missing/empty after normalize
   - Use `sha1` from `src/shared/hash.js`
6. Produce `totals` and `truncated` flags:
   - `totals.*` counts BEFORE truncation
   - `truncated.*` indicates truncation actually occurred

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
- Populate only if chunk has at least one local risk signal or local flow.
- Values must be deterministic (sort ties lexicographically).
- This compact summary is what UIs and CLI can read quickly without parsing JSONL.

### 10.3.4 Export `taintHints` from local risk detector
**File:** `src/index/risk.js`

Enhancement:
- The local risk detector already tracks a `taint` map internally for assignment propagation.
- Add a bounded list:
  - `taintHints: { taintedIdentifiers: string[] }`
  - Sort + cap (e.g., 50)
- Attach to `docmeta.risk`.

This improves arg-aware propagation but is not required for correctness if `strictness=conservative`.

### 10.3.5 Per-row size cap enforcement (required)
Both summary rows and compact summary additions must obey size limits.

**Hard limit:** `<= 32 KiB` per JSONL row.

Implement row trimming in `buildRiskSummaries` (or in the writer) with deterministic steps:
1. Drop `tags` arrays from all signals.
2. Reduce evidence per signal to 1.
3. Drop all evidence arrays.
4. If still too large: drop the entire summary row and record in stats (`summariesDroppedBySize++`).

### 10.3.6 Tests for summaries
Add:
- `tests/risk-interprocedural/summaries-schema.test.js`
  - Build a fixture index; load `risk_summaries.jsonl`; schema-validate; verify expected counts.
- `tests/risk-interprocedural/summaries-determinism.test.js`
  - Run summary build twice on same fixture (same runtime), assert identical JSONL output bytes.
- `tests/risk-interprocedural/summaries-truncation.test.js`
  - Construct an artificial chunk with huge tags/evidence, assert trimming steps fire and flags/stats reflect.

---

## 10.4 Shared callsite utilities (FOUNDATION)

### 10.4.1 Factor callSiteId algorithm into a shared helper
**Goal:** Risk flows must reference callSiteIds that match the `call_sites` writer exactly.

**New file (recommended):** `src/index/callsite-id.js`

Export:
- `buildCallSiteId({ file, startLine, startCol, endLine, endCol, calleeRaw })`

Implementation:
- Move (or copy exactly) the logic from `src/index/build/artifacts/writers/call-sites.js`.
- Update call-sites writer to import it (so there is only one implementation).

### 10.4.2 Define edge-key and call site sampling helpers
**New file:** `src/index/risk-interprocedural/edges.js`

Exports:
- `edgeKey(callerUid, calleeUid) => string` (format: `"${callerUid}→${calleeUid}"`)
- `sortCallDetailsForSampling(a, b)` (deterministic comparator)
- `sampleCallSitesForEdge(callDetails, { maxCallSitesPerEdge }) => CallSiteSample[]`

Where `CallSiteSample` includes:
```ts
{
  callSiteId: string,
  args: string[]|null
}
```

Sampling requirements:
- Build list from caller chunk’s `codeRelations.callDetails`, filtering:
  - `detail.targetChunkUid === calleeUid`
- Sort by:
  1) `detail.file` (if present, else caller chunk file)
  2) `detail.startLine`, `detail.startCol`, `detail.endLine`, `detail.endCol`
  3) `detail.calleeNormalized` then `detail.calleeRaw`
  4) `callSiteId` (as tie-breaker)
- Take first `N`.

**Important:** Sampling is used only for *flow evidence*, not for call graph completeness.

### 10.4.3 Tests for callsite helpers
Add:
- `tests/risk-interprocedural/callsite-id.test.js`
  - Ensure the shared helper matches the writer’s output on representative inputs.
- `tests/risk-interprocedural/callsite-sampling.test.js`
  - Given an array of mocked callDetails, assert deterministic ordering and stable sampling.

---

## 10.5 Interprocedural propagation → risk_flows

> Propagation enumerates bounded call paths from source signals to sink signals.

### 10.5.1 Define the *final* flow row schema (implement exactly)
**Artifact:** `risk_flows.jsonl` (sharded)

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

### 10.5.2 Implement propagation engine
**New file:** `src/index/risk-interprocedural/engine.js`

Export:
- `computeInterproceduralRisk({ chunks, summariesByChunkUid, runtime, log })`

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

### 10.5.4 Deterministic traversal algorithm (BFS)
Implement BFS rooted at each `(sourceChunkUid, sourceRuleId)`:

**Root ordering:**
- Sort roots by:
  1) `sourceChunkUid`
  2) `sourceRuleId`

**Queue item (“state”) shape:**
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
- `visitedKey = `${rootSource.chunkUid}|${rootSource.ruleId}|${chunkUid}|${taintSetKey||""}|${depth}``

This is more permissive than typical BFS; it matches the intended “allow revisiting at deeper depth” behavior.

**Expansion order:**
- When expanding a node:
  1) Get outgoing resolved callees from callDetails (or callLinks) and sort `calleeUid` lexicographically.
  2) For each callee, sample callSiteIds for the edge deterministically (10.4.2).
  3) Enqueue callee states in that sorted order.

### 10.5.5 Traversal strictness modes
#### conservative
- Treat every resolved edge as traversable.
- No taint tracking required.
- `taintSetKey = null` for visited key.

#### argAware
An edge (caller→callee) is traversable only if at least one call-site argument is tainted.

**Taint sources (caller side):**
- `callerSummary.taintHints.taintedIdentifiers` (if present)
- Regex match against source rule patterns:
  - Use compiled regexes for *source rules* from runtime’s risk rules (`runtime.riskConfig`)
  - Match per-argument string with identifier boundary rules:
    - `argText` is the string from `callDetails.args[]`
    - Consider an argument tainted if:
      - It contains any tainted identifier as a whole token, OR
      - It matches a source rule regex pattern

**Mapping taint into callee:**
- Determine callee param names:
  - Prefer `callLinks.paramNames` for that callee edge if available
  - Else prefer callee chunk’s `docmeta.paramNames` (from 10.2)
  - Else: no mapping possible; treat traversal as conservative for that edge *only if* a tainted arg exists (still require tainted arg)
- If argument index `i` is tainted and `paramNames[i]` exists:
  - add `paramNames[i]` to callee taint set
- Always union in callee’s own `taintHints.taintedIdentifiers` (if present).

**Canonical taintSetKey:**
- Sort tainted identifiers, cap to 16, join with `,`
- Use this for visited key and determinism.

### 10.5.6 Sanitizer policy
A “barrier chunk” is any chunk that has `signals.sanitizers.length > 0` in its summary.

- `terminate`:
  - You may still emit flows that *end at this chunk* (if it contains sinks).
  - Do not expand outgoing edges from this chunk.
- `weaken`:
  - Continue expansion.
  - Increment `sanitizerBarriersHit` counter for notes and confidence penalty.

### 10.5.7 Flow emission rules
While BFS is running:
- When visiting a chunk that has sinks (`signals.sinks.length > 0`):
  - For each sink signal (sorted by severity desc then ruleId):
    - Emit a flow row from root source → this sink **unless**:
      - `sinkChunkUid === sourceChunkUid` (no intra-chunk flows)
      - caps would be exceeded

**Per-(source,sink) path cap:**
- Maintain counter keyed by:
  - `${sourceChunkUid}|${sourceRuleId}|${sinkChunkUid}|${sinkRuleId}`
- Do not emit more than `maxPathsPerPair`.

### 10.5.8 Caps + timeout behavior (must be explicit)
Apply caps in this order (deterministic and reflected in stats):

1. **Timeout** (`maxMs`):
   - Start timer before any propagation.
   - If exceeded:
     - set status=`timed_out`
     - emit **zero** flow rows
     - still emit summaries (already built)
2. **maxEdgeExpansions**:
   - increment on each edge expansion attempt
   - if exceeded: stop traversal and set `capsHit += ["maxEdgeExpansions"]`
3. **maxDepth**:
   - do not expand states with `depth >= maxDepth`
4. **maxPathsPerPair**:
   - per key cap described above
5. **maxTotalFlows**:
   - stop emitting once reached; set `capsHit += ["maxTotalFlows"]`

### 10.5.9 Confidence scoring (implement exactly)
For each emitted flow:
- `C_source = sourceSignal.confidence ?? 0.5`
- `C_sink = sinkSignal.confidence ?? 0.5`
- `base = 0.1 + 0.9 * C_source * C_sink`
- `hopCount = chunkUids.length - 1`
- `hopDecay = 0.85 ** Math.max(0, hopCount - 1)`
- `sanitizerPenalty = sanitizerPolicy==="weaken" ? (0.5 ** sanitizerBarriersHit) : 1.0`
- `final = clamp(base * hopDecay * sanitizerPenalty, 0, 1)`

### 10.5.10 Per-row size cap enforcement (required)
**Hard limit:** `<= 32 KiB` per JSONL row.

Deterministic trimming for flows:
1. Reduce each `callSiteIdsByStep[i]` to at most 1 id.
2. If still too large, replace `callSiteIdsByStep` with empty arrays (correct length).
3. If still too large, drop the row and record in stats.

### 10.5.11 Tests for propagation
Add fixtures + tests:

- `tests/fixtures/risk-interprocedural/js-simple/`
  - `index.js` contains:
    - `function handle(req){ const cmd=req.body; return run(build(cmd)); }`
    - `function build(x){ return x; }`
    - `function run(cmd){ eval(cmd); }`
  - Ensure:
    - source rule `source.req.body` fires in `handle`
    - sink rule `sink.eval` fires in `run`
    - call chain resolved: handle→build→run

- `tests/risk-interprocedural/flows-conservative.test.js`
  - enable riskInterprocedural (conservative)
  - assert at least 1 flow:
    - `path.chunkUids.length === 3`
    - `callSiteIdsByStep.length === 2`
    - `notes.hopCount === 2`
    - `sink.ruleId === "sink.eval"` (or the actual rule id)
- `tests/risk-interprocedural/flows-argaware-negative.test.js`
  - modify fixture so tainted value is NOT passed (e.g., `build("constant")`)
  - argAware should emit 0 flows
- `tests/risk-interprocedural/flows-sanitizer-policy.test.js`
  - add sanitizer call in middle function (`escape(cmd)`)
  - terminate: no flows beyond sanitizer
  - weaken: flow exists but confidence reduced and `sanitizerBarriersHit>0`
- `tests/risk-interprocedural/flows-timeout.test.js`
  - set `maxMs=1` and create a fixture with branching call graph
  - expect status `timed_out` and `risk_flows` empty

---

## 10.6 Artifact writing + contracts + manifest integration

### 10.6.1 Add contracts for new artifacts
**File:** `src/contracts/schemas/artifacts.js`

Add schemas for:
- `risk_summaries` (jsonl)
- `risk_flows` (jsonl)
- `risk_interprocedural_stats` (json)

Also add meta schemas:
- `risk_summaries_meta` (shard meta)
- `risk_flows_meta`

Update:
- `src/contracts/registry.js` (schema registry + schema hash)

### 10.6.2 Add JSONL required keys
**File:** `src/shared/artifact-io/jsonl.js`

Extend `JSONL_REQUIRED_KEYS` with:
- `risk_summaries`: `["schemaVersion","chunkUid","file","signals"]`
- `risk_flows`: `["schemaVersion","flowId","source","sink","path","confidence","notes"]`

(Keep required keys minimal but sufficient.)

### 10.6.3 Add compression defaults for risk JSONL
**File:** `src/index/build/artifacts/compression.js`

Add `risk_summaries` and `risk_flows` to `COMPRESSIBLE_ARTIFACTS`.

### 10.6.4 Implement artifact writers
**New file:** `src/index/build/artifacts/writers/risk-interprocedural.js`

Exports:
- `enqueueRiskInterproceduralArtifacts({ state, runtime, mode, outputDir, manifest, log })`

Responsibilities:
1. If `mode !== "code"`: do nothing.
2. If `!runtime.riskInterproceduralEnabled`: do nothing.
3. Ensure summaries + flows are computed once and stored on state:
   - `state.riskInterprocedural = { summaryRows, flowRows, stats, callSiteIdsReferenced }`
4. Write:
   - always write `risk_interprocedural_stats.json` when enabled
   - write `risk_summaries` jsonl only if `emitArtifacts==="jsonl"`
   - write `risk_flows` jsonl only if `emitArtifacts==="jsonl"` and `summaryOnly===false` and `status==="ok"`

**Where to compute:**  
Compute in the indexing pipeline **after** cross-file inference and **before** metaV2 finalization, so compact summaries land in chunk meta.

Recommended location:
- In `src/index/build/indexer/pipeline.js` after `runCrossFileInference(...)` and before postings/writing, OR
- In `src/index/build/indexer/steps/write.js` immediately before `finalizeMetaV2(...)`

Pick one and document it; do not compute twice.

### 10.6.5 Ensure chunk meta includes compact risk summary
No special code is needed if you attach `chunk.docmeta.risk.summary`, because:
- `src/index/metadata-v2.js` already includes `risk: docmeta?.risk`

But ensure the compact summary is small enough that `chunk-meta` writer does not drop docmeta for size reasons.

### 10.6.6 Add artifacts to piece assembly
**File:** `src/index/build/piece-assembly.js`

Add optional loading for:
- `risk_summaries`
- `risk_flows`
- `risk_interprocedural_stats`

This makes downstream tooling (sqlite build, etc.) able to access these artifacts uniformly.

### 10.6.7 Tests for artifact writing
Add:
- `tests/risk-interprocedural/artifacts-written.test.js`
  - Build fixture index with `emitArtifacts="jsonl"`
  - Assert files exist:
    - `risk_summaries.jsonl` or sharded variants (+ `.meta.json`)
    - `risk_flows.jsonl` or sharded variants (+ `.meta.json`)
    - `risk_interprocedural_stats.json`
  - Assert shard meta points to shard files.

---

## 10.7 Validation + referential integrity

### 10.7.1 Extend validator to load + schema-validate new artifacts
Files:
- `src/index/validate.js`
- `src/index/validate/artifacts.js`
- `src/index/validate/presence.js`

Tasks:
1. Add `risk_summaries`, `risk_flows`, `risk_interprocedural_stats` to optional artifact list.
2. If present:
   - schema-validate each using contracts
3. Add clear validation errors (include artifact name, failing row index if jsonl).

### 10.7.2 Cross-artifact referential checks (must add)
Add new validator module:
- `src/index/validate/risk-interprocedural.js`

Checks:
- For each summary row:
  - `chunkUid` exists in `chunk_meta`
  - `file` matches `chunk_meta.file` (if present)
- For each flow row:
  - `path.chunkUids.length >= 2`
  - `path.chunkUids[0] === source.chunkUid`
  - `path.chunkUids[last] === sink.chunkUid`
  - `path.callSiteIdsByStep.length === path.chunkUids.length - 1`
  - Every `chunkUid` in path exists in `chunk_meta`
  - Every `callSiteId` referenced exists in `call_sites` **if** `call_sites` is present
    - (Note: call_sites is optional; if absent, validation should warn, not fail, unless strict mode demands it.)
- For stats JSON:
  - `effectiveConfig` fields are consistent with normalization
  - If `status==="timed_out"`: flows count is 0
  - If `emitArtifacts==="jsonl"` and `summaryOnly===false` and `status==="ok"`:
    - `risk_flows` artifact must exist

### 10.7.3 Tests for validator checks
Add:
- `tests/validator/risk-interprocedural.test.js`
  - Build fixture index with riskInterprocedural on
  - Run validator, expect pass
  - Corrupt one `callSiteId` in a flow row, expect validator fail with specific message

---

## 10.8 CLI: explain interprocedural risk flows

### 10.8.1 Add new command wiring
**File:** `bin/pairofcleats.js`

Add command:
- `risk explain`

Map to new tool:
- `tools/explain-risk.js`

### 10.8.2 Implement explain tool
**New file:** `tools/explain-risk.js`

Requirements:
- Inputs:
  - `--index <dir>` (required)
  - `--chunk <chunkUid>` (required)
  - `--max <n>` (default 20)
  - optional filters:
    - `--source-rule <ruleId>`
    - `--sink-rule <ruleId>`
    - `--json`
- Loads artifacts from `indexDir`:
  - `chunk_meta`
  - `risk_summaries` (optional)
  - `risk_flows` (optional)
  - `call_sites` (optional; used to print call site context)
  - `risk_interprocedural_stats` (optional)
- Output (human mode):
  1. Print chunk identification (file, symbol name, kind)
  2. Print compact risk summary if present
  3. Print flows where chunk is:
     - source chunk, or sink chunk, or appears in path
     - ordered by descending `confidence`, then `flowId`
  4. For each flow:
     - print path as `file::symbol` chain
     - print sampled call sites per step by looking up `callSiteId` in `call_sites` (if present)
- JSON mode: emit structured JSON with same data.

### 10.8.3 Tests for CLI
Add:
- `tests/cli/risk-explain.test.js`
  - Build fixture index
  - Run `node bin/pairofcleats.js risk explain --index <dir> --chunk <uid>`
  - Assert output contains flowId and the expected file names

---

## 10.9 Cross-cutting robustness improvements (recommended)

### 10.9.1 Call graph edge union (prevents partial call_sites from hiding callLinks)
**File:** `src/index/build/graphs.js`

Current behavior:
- If there is at least one callSiteEdge, it uses callSiteEdges and does NOT fall back to callLinks for missing edges.

Improve:
- Always union edges from:
  - `callSites` (when present)
  - `callLinks` (when present)
This prevents future regressions if call_sites is sampled or filtered.

### 10.9.2 Performance audit checklist
Before marking Phase 10 complete, verify:
- Summaries build is O(#risk signals) and bounded by caps
- Propagation stops on:
  - timeout
  - maxEdgeExpansions
  - maxDepth
  - maxTotalFlows
- Memory usage:
  - avoid building a global all-edges map if not needed; build per chunk on-demand
- Determinism:
  - output stable across runs given same codebase and config

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

---

### Doc merge checklist (explicit, per original roadmap requirement)
- [ ] `docs/specs/risk-interprocedural-config.md` ← merge `docs/new_docs/spec_risk-interprocedural-config_IMPROVED.md`
- [ ] `docs/specs/risk-summaries.md` ← merge `docs/new_docs/spec_risk-summaries_IMPROVED.md`
- [ ] `docs/specs/risk-flows-and-call-sites.md` ← merge `docs/new_docs/spec_risk-flows-and-call-sites_RECONCILED.md`
- [ ] `docs/specs/risk-callsite-id-and-stats.md` ← reconcile with code + update/annotate `docs/new_docs/risk-callsite-id-and-stats_IMPROVED.md`
- [ ] `docs/specs/risk-interprocedural-stats.md` ← expand from placeholder using merged stats schema
- [ ] `docs/new_docs/interprocedural-state-and-pipeline_DRAFT.md` ← either promote to `docs/specs/` or merge key content into the canonical specs

---

## 10.A Risk Interprocedural Config Spec (canonical)

**Canonical spec file (post-merge):** `docs/specs/risk-interprocedural-config.md`  
**Validator/contract authority:** `docs/config/schema.json` + runtime normalization in `tools/dict-utils/config.js`

### Required config keys (must exist; exact spelling)
- `indexing.riskInterprocedural.enabled` — boolean (default: `false`)
- `indexing.riskInterprocedural.mode` — `"off" | "conservative" | "argAware"`
- `indexing.riskInterprocedural.callsiteSampling.enabled` — boolean
- `indexing.riskInterprocedural.callsiteSampling.perCalleeLimit` — integer
- `indexing.riskInterprocedural.callsiteSampling.totalLimit` — integer
- `indexing.riskInterprocedural.callsiteSampling.seed` — string
- `indexing.riskInterprocedural.limits.maxDepth` — integer
- `indexing.riskInterprocedural.limits.maxPathsPerRisk` — integer
- `indexing.riskInterprocedural.limits.maxTotalPaths` — integer
- `indexing.riskInterprocedural.limits.maxFanOutPerCallsite` — integer
- `indexing.riskInterprocedural.timeouts.propagationMs` — integer
- `indexing.riskInterprocedural.emitArtifacts` — boolean (default: `false`)

**Touchpoints**
- `tools/dict-utils/config.js` (~L1–L310) — add/validate keys; normalize defaults.
- `docs/config/schema.json` (~L1–L264) — ensure schema accepts these keys.
- `src/index/build/runtime/runtime.js` (~L1–L683) — pass normalized config into runtime.

**Minimum test coverage**
- Add/keep `tests/risk-interprocedural/config-normalization.test.js` (lane: integration unless placed under `tests/unit/`).
- Verify `enabled=false` short-circuits all extra work (no new artifacts).

---

## 10.B `risk_summaries.jsonl` Spec (canonical)

**Canonical spec file (post-merge):** `docs/specs/risk-summaries.md`  
**Contract authority (must match):** `src/contracts/schemas/artifacts.js`

### Minimum record schema (must be stable)
- `riskId: string` (deterministic; stable across runs)
- `kind: string` (risk kind/category)
- `title: string`
- `severity: "low" | "medium" | "high" | "critical"` (or project-defined enum — pick one and enforce)
- `primaryLocation: { virtualPath, startLine, startCol, endLine, endCol }`
- `evidence: Array<{ virtualPath, startLine, startCol, endLine, endCol, excerpt?: string }>`
- `sinks: Array<{ symbol: SymbolRefV1, chunkUid?: string|null }>`
- `sources: Array<{ symbol: SymbolRefV1, chunkUid?: string|null }>`
- `counts: { sinks: number, sources: number, flows: number }`
- `truncated: { evidence?: boolean, sinks?: boolean, sources?: boolean, flows?: boolean }`

**Touchpoints**
- `src/index/risk.js` (~L1–L404) — risk extraction output.
- `src/index/metadata-v2.js` (~L1–L301) — where compact docmeta may surface summary signals.
- `src/index/validate.js` (~L1–L581) — schema enforcement for artifact output.

**Minimum test coverage**
- Schema validation test: `tests/risk-interprocedural/summaries-schema.test.js`
- Determinism test: `tests/risk-interprocedural/summaries-determinism.test.js`
- Truncation/caps test: `tests/risk-interprocedural/summaries-truncation.test.js`

---

## 10.C `risk_flows.jsonl` + `call_sites.jsonl` Spec (canonical)

**Canonical spec file (post-merge):** `docs/specs/risk-flows-and-call-sites.md`  
**Call-sites contract authority:** `src/contracts/schemas/artifacts.js` (`call_sites` already exists)

### `call_sites` (existing artifact; do not break)
- Must remain a superset-friendly artifact: interprocedural flow logic should consume a **subset**.

**Touchpoints**
- `src/index/build/artifacts/writers/call-sites.js` (~L1–L276) — `buildCallSiteId` is canonical algorithm.
- `src/contracts/schemas/artifacts.js` (~L1–L677) — contract schema for `call_sites`.

### `risk_flows` (new artifact)
Must include:
- `flowId` (deterministic)
- `riskId`
- `source: { symbol: SymbolRefV1, chunkUid?: string|null }`
- `sink: { symbol: SymbolRefV1, chunkUid?: string|null }`
- `path: Array<{ callSiteId: string, callee: SymbolRefV1, calleeChunkUid?: string|null }>`
- `mode: "conservative" | "argAware"`
- `confidence: "high" | "medium" | "low"`
- `notes?: string[]`
- `truncated?: boolean`

**Minimum test coverage**
- Conservative mode: `tests/risk-interprocedural/flows-conservative.test.js`
- Arg-aware negative test: `tests/risk-interprocedural/flows-argaware-negative.test.js`
- Sanitizer policy: `tests/risk-interprocedural/flows-sanitizer-policy.test.js`
- Timeout behavior: `tests/risk-interprocedural/flows-timeout.test.js`

---

## 10.D Risk Interprocedural Stats Spec (canonical)

**Canonical spec file (post-merge):** `docs/specs/risk-interprocedural-stats.md`  
Clarify counts vs artifacts (especially because `call_sites` is a general artifact).

### Required counters (explicit semantics)
- `flowsEmitted`: number of risk flow records written
- `risksWithFlows`: count of riskIds that emitted ≥1 flow
- `uniqueCallSitesReferenced`: count of unique callSiteIds referenced by emitted `risk_flows`
- `callSiteSampling`: { `enabled`, `perCalleeLimit`, `totalLimit`, `seed` }
- `mode`: propagation mode
- `timingMs`: { `total`, `propagation`, `io` }
- `capsHit`: record which caps were hit (depth, fanout, paths, timeout)

**Minimum test coverage**
- Stats correctness test (small fixture): add/keep `tests/risk-interprocedural/callsite-sampling.test.js`
- Validator test: `tests/validator/risk-interprocedural.test.js`

---

## 10.E Implementation notes (non-normative)

These are constraints to keep implementations coherent:

- **Determinism:** All emitted artifacts must be stable under re-run; enforce deterministic sorting at every aggregation boundary.
- **No hidden global state:** Cache keys must include buildRoot/buildId where applicable.
- **Runtime gating:** When `riskInterprocedural.enabled=false`, do not emit new artifacts, and do not pay traversal costs.
- **Back-compat:** Never break existing `call_sites` readers; new fields must be additive.
- **Archival policy:** Deprecated spec docs move to `docs/archived/` and are documented in `AGENTS.md` (see 10.0.3).

# Appendices — touchpoint mappings (with line ranges) + test lane hints

These appendices are generated to remove scavenger-hunts:
- Every file path referenced in a phase body appears here.
- Existing files include **approximate** line ranges.
- Planned files/dirs are labeled **NEW**.

## Appendix P0 — Root-level touchpoints referenced by this roadmap

- `AGENTS.md` (~L1–L63) — agent workflow; must include the spec archival policy.
- `COMPLETED_PHASES.md` (~L1–L12) — record of completed roadmap phases.
- `GIGAROADMAP.md` (~L1–L4692) — prerequisite plan; this roadmap assumes it is complete.
- `package.json` (~L1–L278) — test lane scripts (`test:unit`, `test:services`, etc).

## Appendix P7 — repo touchpoint map

> Line ranges are approximate. Prefer anchor strings (function/export names) over line numbers.

### Existing directories referenced
- `docs/contracts/` (DIR; exists)
- `src/contracts/` (DIR; exists)
- `tests/fixtures/sample/` (DIR; exists)

### Existing src/ files referenced (edit candidates)
- `src/contracts/registry.js` (~L1–L10) — exports/anchors: `ARTIFACT_SCHEMA_REGISTRY`, `ARTIFACT_SCHEMA_HASH`, `ARTIFACT_SCHEMA_NAMES`, `getArtifactSchema`
- `src/contracts/schemas/artifacts.js` (~L1–L677) — exports/anchors: `ARTIFACT_SCHEMA_DEFS`
- `src/index/build/file-processor/embeddings.js` (~L1–L260)
- `src/index/build/indexer/embedding-queue.js` (~L1–L49) — exports/anchors: `enqueueEmbeddingJob`
- `src/index/build/indexer/pipeline.js` (~L1–L326)
- `src/index/build/indexer/steps/write.js` (~L1–L101) — exports/anchors: `writeIndexArtifactsForMode`
- `src/index/embedding.js` (~L1–L56) — exports/anchors: `quantizeVec`, `quantizeVecUint8`, `normalizeVec`, `createEmbedder`
- `src/index/validate.js` (~L1–L581)
- `src/retrieval/ann/providers/hnsw.js` (~L1–L27) — exports/anchors: `createHnswAnnProvider`
- `src/retrieval/ann/providers/lancedb.js` (~L1–L39) — exports/anchors: `createLanceDbAnnProvider`
- `src/retrieval/cli-index.js` (~L1–L416) — exports/anchors: `resolveIndexDir`, `requireIndexDir`, `buildQueryCacheKey`, `getIndexSignature`
- `src/retrieval/cli/load-indexes.js` (~L1–L368)
- `src/retrieval/cli/normalize-options.js` (~L1–L273) — exports/anchors: `normalizeSearchOptions`
- `src/retrieval/cli/options.js` (~L1–L141) — exports/anchors: `getMissingFlagMessages`, `estimateIndexBytes`, `resolveIndexedFileCount`, `resolveBm25Defaults`, `loadBranchFromMetrics`
- `src/retrieval/cli/query-plan.js` (~L1–L205) — exports/anchors: `buildQueryPlan`
- `src/retrieval/lancedb.js` (~L1–L180)
- `src/retrieval/query-intent.js` (~L1–L84) — exports/anchors: `classifyQuery`, `resolveIntentVectorMode`, `resolveIntentFieldWeights`
- `src/retrieval/rankers.js` (~L1–L292) — exports/anchors: `rankBM25Legacy`, `getTokenIndex`, `rankBM25`, `rankBM25Fields`, `rankMinhash`
- `src/retrieval/sqlite-helpers.js` (~L1–L544) — exports/anchors: `createSqliteHelpers`
- `src/shared/artifact-io.js` (~L1–L12)
- `src/shared/artifact-io/manifest.js` (~L1–L291) — exports/anchors: `resolveManifestPath`, `loadPiecesManifest`, `readCompatibilityKey`, `normalizeMetaParts`, `resolveMetaFormat`
- `src/shared/embedding-adapter.js` (~L1–L158) — exports/anchors: `getEmbeddingAdapter`
- `src/shared/embedding-utils.js` (~L1–L176) — exports/anchors: `DEFAULT_EMBEDDING_POOLING`, `DEFAULT_EMBEDDING_NORMALIZE`, `DEFAULT_EMBEDDING_TRUNCATION`, `isVectorLike`, `mergeEmbeddingVectors`
- `src/shared/hnsw.js` (~L1–L160) — exports/anchors: `normalizeHnswConfig`, `resolveHnswPaths`, `loadHnswIndex`, `rankHnswIndex`
- `src/shared/lancedb.js` (~L1–L65) — exports/anchors: `normalizeLanceDbConfig`, `resolveLanceDbPaths`, `resolveLanceDbTarget`
- `src/storage/lmdb/schema.js` (~L1–L49) — exports/anchors: `LMDB_SCHEMA_VERSION`, `LMDB_META_KEYS`, `LMDB_ARTIFACT_KEYS`, `LMDB_ARTIFACT_LIST`, `LMDB_REQUIRED_ARTIFACT_KEYS`
- `src/storage/sqlite/build/incremental-update.js` (~L1–L567)
- `src/storage/sqlite/vector.js` (~L1–L71) — exports/anchors: `quantizeVec`, `resolveQuantizationParams`, `dequantizeUint8ToFloat32`, `toSqliteRowId`, `packUint32`

### Existing tools/ files referenced (edit candidates)
- `tools/build-embeddings.js` (~L1–L12)
- `tools/build-embeddings/cache.js` (~L1–L26) — exports/anchors: `buildCacheIdentity`, `resolveCacheRoot`, `resolveCacheDir`, `buildCacheKey`, `isCacheValid`
- `tools/build-embeddings/cli.js` (~L1–L95) — exports/anchors: `parseBuildEmbeddingsArgs`
- `tools/build-embeddings/embed.js` (~L1–L119) — exports/anchors: `assertVectorArrays`, `runBatched`, `ensureVectorArrays`, `createDimsValidator`, `isDimsMismatch`
- `tools/build-embeddings/hnsw.js` (~L1–L115) — exports/anchors: `createHnswBuilder`
- `tools/build-embeddings/lancedb.js` (~L1–L143)
- `tools/build-embeddings/manifest.js` (~L1–L111) — exports/anchors: `updatePieceManifest`
- `tools/build-embeddings/runner.js` (~L1–L763)
- `tools/build-embeddings/sqlite-dense.js` (~L1–L209) — exports/anchors: `updateSqliteDense`
- `tools/build-lmdb-index.js` (~L1–L311)
- `tools/dict-utils/paths/db.js` (~L1–L62) — exports/anchors: `resolveLmdbPaths`, `resolveSqlitePaths`
- `tools/index-validate.js` (~L1–L130)
- `tools/indexer-service.js` (~L1–L441)
- `tools/service/queue.js` (~L1–L270) — exports/anchors: `resolveQueueName`, `getQueuePaths`
- `tools/vector-extension.js` (~L1–L393) — exports/anchors: `getBinarySuffix`, `getPlatformKey`, `getVectorExtensionConfig`, `resolveVectorExtensionPath`, `loadVectorExtension`

### Existing docs/ files referenced (edit candidates)
- `docs/contracts/artifact-schemas.md` (~L1–L67)
- `docs/contracts/public-artifact-surface.md` (~L1–L104)
- `docs/guides/embeddings.md` (~L1–L92)
- `docs/guides/search.md` (~L1–L74)

### Existing tests/ files referenced (edit candidates)
- `tests/artifact-io-manifest-discovery.test.js` (~L1–L60) — lane: `integration`; run: `npm run test:integration -- --match artifact-io-manifest-discovery.test`
- `tests/embedding-queue-defaults.js` (~L1–L37) — lane: `integration`; run: `npm run test:integration -- --match embedding-queue-defaults`
- `tests/embedding-queue.js` (~L1–L51) — lane: `integration`; run: `npm run test:integration -- --match embedding-queue`
- `tests/embeddings-validate.js` (~L1–L82) — lane: `integration`; run: `npm run test:integration -- --match embeddings-validate`
- `tests/hnsw-ann.js` (~L1–L124) — lane: `integration`; run: `npm run test:integration -- --match hnsw-ann`
- `tests/hnsw-atomic.js` (~L1–L90) — lane: `integration`; run: `npm run test:integration -- --match hnsw-atomic`
- `tests/hnsw-candidate-set.js` (~L1–L78) — lane: `integration`; run: `npm run test:integration -- --match hnsw-candidate-set`
- `tests/lancedb-ann.js` (~L1–L100) — lane: `integration`; run: `npm run test:integration -- --match lancedb-ann`
- `tests/lmdb-backend.js` (~L1–L122) — lane: `integration`; run: `npm run test:integration -- --match lmdb-backend`
- `tests/lmdb-corruption.js` (~L1–L105) — lane: `integration`; run: `npm run test:integration -- --match lmdb-corruption`
- `tests/lmdb-report-artifacts.js` (~L1–L125) — lane: `integration`; run: `npm run test:integration -- --match lmdb-report-artifacts`

### Planned/new paths referenced in this phase (create as needed)
- **tests/**
  - `tests/ann-parity.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match ann-parity`
  - `tests/embedding-normalization-consistency.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match embedding-normalization-consistency`
  - `tests/embedding-quantization-no-wrap.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match embedding-quantization-no-wrap`
  - `tests/fixtures/embeddings` (NEW fixture/dir — create as part of this phase)
  - `tests/fixtures/embeddings/basic-repo` (NEW fixture/dir — create as part of this phase)
  - `tests/fixtures/embeddings/missing-vectors` (NEW fixture/dir — create as part of this phase)
  - `tests/fixtures/embeddings/quantization-caps` (NEW fixture/dir — create as part of this phase)
  - `tests/hnsw-target-selection.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match hnsw-target-selection`
  - `tests/indexer-service-embedding-job-uses-build-root.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match indexer-service-embedding-job-uses-build-root`
  - `tests/integration/ann-parity.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match ann-parity.test`
  - `tests/lancedb-candidate-filtering.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match lancedb-candidate-filtering`
  - `tests/manifest-embeddings-pieces.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match manifest-embeddings-pieces`
  - `tests/quantize-embedding-utils.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match quantize-embedding-utils`
  - `tests/retrieval-strict-manifest-embeddings.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match retrieval-strict-manifest-embeddings`
  - `tests/storage/embeddings-backend-resilience.test.js` (NEW) — intended lane: `storage`; run (once created): `npm run test:storage -- --match embeddings-backend-resilience.test`
  - `tests/unit/ann-backend-selection.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match ann-backend-selection.test`
  - `tests/unit/cache-preflight-meta.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match cache-preflight-meta.test`
  - `tests/unit/dense-vector-mode.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match dense-vector-mode.test`
  - `tests/unit/hnsw-insert-failures.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match hnsw-insert-failures.test`
  - `tests/unit/hnsw-load-signature.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match hnsw-load-signature.test`
  - `tests/unit/lancedb-candidate-filtering.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match lancedb-candidate-filtering.test`
  - `tests/unit/lancedb-connection-cache.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match lancedb-connection-cache.test`
  - `tests/unit/lancedb-filter-pushdown.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match lancedb-filter-pushdown.test`
  - `tests/unit/lmdb-mapsize.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match lmdb-mapsize.test`
  - `tests/unit/sqlite-ann-mode-scope.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match sqlite-ann-mode-scope.test`


## Appendix P9 — repo touchpoint map

> Line ranges are approximate. Prefer anchor strings (function/export names) over line numbers.

### Existing directories referenced
- `src/index/build/artifacts/writers/` (DIR; exists)
- `src/index/identity/` (DIR; exists)
- `src/index/tooling/` (DIR; exists)
- `tests/type-inference-crossfile/` (DIR; exists)
- `tools/bench/` (DIR; exists)

### Existing src/ files referenced (edit candidates)
- `src/contracts/schemas/artifacts.js` (~L1–L677) — exports/anchors: `ARTIFACT_SCHEMA_DEFS`
- `src/index/build/artifacts.js` (~L1–L528)
- `src/index/build/file-processor.js` (~L1–L529) — exports/anchors: `createFileProcessor`
- `src/index/build/file-processor/assemble.js` (~L1–L127) — exports/anchors: `buildChunkPayload`
- `src/index/build/file-processor/relations.js` (~L1–L71) — exports/anchors: `buildCallIndex`, `buildFileRelations`, `stripFileRelations`
- `src/index/build/graphs.js` (~L1–L267) — exports/anchors: `buildRelationGraphs`
- `src/index/chunk-id.js` (~L1–L21) — exports/anchors: `buildChunkId`, `resolveChunkId`
- `src/index/identity/chunk-uid.js` (~L1–L204) — exports/anchors: `PRE_CONTEXT_CHARS`, `POST_CONTEXT_CHARS`, `ESCALATION_CONTEXT_CHARS`, `MAX_COLLISION_PASSES`, `normalizeForUid`
- `src/index/metadata-v2.js` (~L1–L301) — exports/anchors: `buildMetaV2`, `finalizeMetaV2`
- `src/index/segments.js` (~L1–L190) — exports/anchors: `assignSegmentUids`, `discoverSegments`, `chunkSegments`
- `src/index/tooling/clangd-provider.js` (~L1–L187) — exports/anchors: `CLIKE_EXTS`, `createClangdProvider`
- `src/index/tooling/pyright-provider.js` (~L1–L127) — exports/anchors: `PYTHON_EXTS`, `createPyrightProvider`
- `src/index/tooling/sourcekit-provider.js` (~L1–L93) — exports/anchors: `SWIFT_EXTS`, `createSourcekitProvider`
- `src/index/tooling/typescript-provider.js` (~L1–L467) — exports/anchors: `createTypeScriptProvider`
- `src/index/type-inference-crossfile/pipeline.js` (~L1–L438)
- `src/index/type-inference-crossfile/symbols.js` (~L1–L30) — exports/anchors: `leafName`, `isTypeDeclaration`, `addSymbol`, `resolveUniqueSymbol`
- `src/index/validate.js` (~L1–L581)
- `src/lang/javascript/relations.js` (~L1–L687) — exports/anchors: `buildCodeRelations`
- `src/map/build-map.js` (~L1–L288) — exports/anchors: `buildNodeList`, `buildMapCacheKey`
- `src/map/build-map/edges.js` (~L1–L186) — exports/anchors: `buildEdgesFromGraph`, `buildEdgesFromCalls`, `buildEdgesFromUsage`, `buildEdgesFromCallSummaries`, `buildImportEdges`
- `src/map/build-map/filters.js` (~L1–L229) — exports/anchors: `resolveFocus`, `normalizeIncludeList`, `applyLimits`, `applyScopeFilter`, `applyCollapse`
- `src/map/build-map/symbols.js` (~L1–L95) — exports/anchors: `buildSymbolId`, `buildPortId`, `upsertMember`, `buildMemberIndex`, `resolveMemberByName`
- `src/map/isometric/client/map-data.js` (~L1–L47) — exports/anchors: `initMapData`
- `src/shared/artifact-io.js` (~L1–L12)
- `src/shared/artifact-io/jsonl.js` (~L1–L79) — exports/anchors: `resolveJsonlRequiredKeys`, `parseJsonlLine`
- `src/shared/artifact-schemas.js` (~L1–L2)
- `src/shared/identity.js` (~L1–L104) — exports/anchors: `buildChunkRef`, `isSemanticSymbolId`, `resolveSymbolJoinKey`, `resolveChunkJoinKey`, `buildSymbolKey`

### Existing docs/ files referenced (edit candidates)
- `docs/phases/phase-9/identity-contracts.md` (~L1–L132)
- `docs/phases/phase-9/migration-and-backcompat.md` (~L1–L45)
- `docs/phases/phase-9/symbol-artifacts-and-pipeline.md` (~L1–L122)
- `docs/specs/identity-contract.md` (~L1–L313)

### Existing tests/ files referenced (edit candidates)
- `tests/graph-chunk-id.js` (~L1–L43) — lane: `integration`; run: `npm run test:integration -- --match graph-chunk-id`

### Planned/new paths referenced in this phase (create as needed)
- **src/**
  - `src/index/build/artifacts/writers/symbol-edges.js` (NEW — create as part of this phase)
  - `src/index/build/artifacts/writers/symbol-occurrences.js` (NEW — create as part of this phase)
  - `src/index/build/artifacts/writers/symbols.js` (NEW — create as part of this phase)
  - `src/index/identity/kind-group.js` (NEW — create as part of this phase)
  - `src/index/identity/normalize.js` (NEW — create as part of this phase)
  - `src/index/identity/segment-uid.js` (NEW — create as part of this phase)
  - `src/index/identity/symbol.js` (NEW — create as part of this phase)
  - `src/index/identity/virtual-path.js` (NEW — create as part of this phase)
  - `src/index/type-inference-crossfile/resolve-relative-import.js` (NEW — create as part of this phase)
  - `src/index/type-inference-crossfile/resolver.js` (NEW — create as part of this phase)
- **tools/**
  - `tools/bench/symbol-resolution-bench.js` (NEW — create as part of this phase)
- **docs/**
  - `docs/specs/symbol-artifacts.md` (NEW doc/spec — create as part of this phase)
  - `docs/specs/symbol-identity-and-symbolref.md` (NEW doc/spec — create as part of this phase)
- **tests/**
  - `tests/artifacts/symbol-artifacts-smoke.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match symbol-artifacts-smoke.test`
  - `tests/benchmarks` (NEW fixture/dir — create as part of this phase)
  - `tests/crossfile/resolve-relative-import.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match resolve-relative-import.test`
  - `tests/crossfile/symbolref-resolution.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match symbolref-resolution.test`
  - `tests/determinism` (NEW fixture/dir — create as part of this phase)
  - `tests/determinism/symbol-artifact-order.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match symbol-artifact-order.test`
  - `tests/fixtures/graph/chunkuid-join` (NEW fixture/dir — create as part of this phase)
  - `tests/fixtures/identity/chunkuid-collision` (NEW fixture/dir — create as part of this phase)
  - `tests/fixtures/imports/relative-ambiguous` (NEW fixture/dir — create as part of this phase)
  - `tests/fixtures/symbols/ambiguous-defs` (NEW fixture/dir — create as part of this phase)
  - `tests/identity/chunk-uid-stability.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match chunk-uid-stability.test`
  - `tests/identity/segment-uid-stability.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match segment-uid-stability.test`
  - `tests/identity/symbol-identity.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match symbol-identity.test`
  - `tests/integration/chunkuid-determinism.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match chunkuid-determinism.test`
  - `tests/integration/file-name-collision-no-wrong-join.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match file-name-collision-no-wrong-join.test`
  - `tests/integration/graph-relations-v2-chunkuid.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match graph-relations-v2-chunkuid.test`
  - `tests/integration/import-resolver-relative.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match import-resolver-relative.test`
  - `tests/integration/map-chunkuid-join.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match map-chunkuid-join.test`
  - `tests/integration/symbol-artifact-determinism.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match symbol-artifact-determinism.test`
  - `tests/map/map-build-symbol-identity.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match map-build-symbol-identity.test`
  - `tests/services/symbol-artifacts-emission.test.js` (NEW) — intended lane: `services`; run (once created): `npm run test:services -- --match symbol-artifacts-emission.test`
  - `tests/services/symbol-edges-ambiguous.test.js` (NEW) — intended lane: `services`; run (once created): `npm run test:services -- --match symbol-edges-ambiguous.test`
  - `tests/services/symbol-links-by-chunkuid.test.js` (NEW) — intended lane: `services`; run (once created): `npm run test:services -- --match symbol-links-by-chunkuid.test`
  - `tests/unit/chunk-uid-stability.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match chunk-uid-stability.test`
  - `tests/unit/identity-symbolkey-scopedid.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match identity-symbolkey-scopedid.test`
  - `tests/unit/segment-uid-stability.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match segment-uid-stability.test`
  - `tests/unit/symbolref-envelope.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match symbolref-envelope.test`
  - `tests/unit/tooling/clangd-provider-output-shape.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match clangd-provider-output-shape.test`
  - `tests/unit/tooling/pyright-provider-output-shape.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match pyright-provider-output-shape.test`
  - `tests/unit/tooling/sourcekit-provider-output-shape.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match sourcekit-provider-output-shape.test`
  - `tests/unit/tooling/typescript-provider-output-shape.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match typescript-provider-output-shape.test`
  - `tests/validate/chunk-uid-required.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match chunk-uid-required.test`
  - `tests/validate/symbol-integrity-strict.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match symbol-integrity-strict.test`


## Appendix P10 — repo touchpoint map

> Line ranges are approximate. Prefer anchor strings (function/export names) over line numbers.

### Existing directories referenced
- `docs/new_docs/` (DIR; exists)
- `docs/specs/` (DIR; exists)
- `src/contracts/` (DIR; exists)

### Existing src/ files referenced (edit candidates)
- `src/contracts/registry.js` (~L1–L10) — exports/anchors: `ARTIFACT_SCHEMA_REGISTRY`, `ARTIFACT_SCHEMA_HASH`, `ARTIFACT_SCHEMA_NAMES`, `getArtifactSchema`
- `src/contracts/schemas/artifacts.js` (~L1–L677) — exports/anchors: `ARTIFACT_SCHEMA_DEFS`
- `src/index/build/artifacts/compression.js` (~L1–L46) — exports/anchors: `resolveCompressionConfig`
- `src/index/build/artifacts/writers/call-sites.js` (~L1–L276) — exports/anchors: `createCallSites`, `enqueueCallSitesArtifacts`
- `src/index/build/graphs.js` (~L1–L267) — exports/anchors: `buildRelationGraphs`
- `src/index/build/indexer/pipeline.js` (~L1–L326)
- `src/index/build/indexer/signatures.js` (~L1–L120) — exports/anchors: `SIGNATURE_VERSION`, `buildIncrementalSignatureSummary`, `buildIncrementalSignaturePayload`, `buildTokenizationKey`, `buildIncrementalSignature`
- `src/index/build/indexer/steps/relations.js` (~L1–L205) — exports/anchors: `resolveImportScanPlan`, `preScanImports`, `postScanImports`, `runCrossFileInference`
- `src/index/build/indexer/steps/write.js` (~L1–L101) — exports/anchors: `writeIndexArtifactsForMode`
- `src/index/build/piece-assembly.js` (~L1–L512)
- `src/index/build/runtime/runtime.js` (~L1–L683)
- `src/index/metadata-v2.js` (~L1–L301) — exports/anchors: `buildMetaV2`, `finalizeMetaV2`
- `src/index/risk.js` (~L1–L404) — exports/anchors: `normalizeRiskConfig`, `detectRiskSignals`
- `src/index/type-inference-crossfile/extract.js` (~L1–L84) — exports/anchors: `extractReturnTypes`, `extractParamTypes`, `extractReturnCalls`, `inferArgType`
- `src/index/validate.js` (~L1–L581)
- `src/index/validate/artifacts.js` (~L1–L38) — exports/anchors: `buildArtifactLists`
- `src/index/validate/presence.js` (~L1–L183) — exports/anchors: `createArtifactPresenceHelpers`
- `src/lang/javascript/relations.js` (~L1–L687) — exports/anchors: `buildCodeRelations`
- `src/shared/artifact-io/jsonl.js` (~L1–L79) — exports/anchors: `resolveJsonlRequiredKeys`, `parseJsonlLine`
- `src/shared/hash.js` (~L1–L74) — exports/anchors: `sha1`, `sha1File`, `setXxhashBackend`

### Existing tools/ files referenced (edit candidates)
- `tools/dict-utils/config.js` (~L1–L310) — exports/anchors: `loadUserConfig`, `getEffectiveConfigHash`, `getCacheRoot`, `getDictConfig`, `applyAdaptiveDictConfig`

### Existing docs/ files referenced (edit candidates)
- `docs/config/contract.md` (~L1–L70)
- `docs/config/schema.json` (~L1–L264)
- `docs/new_docs/interprocedural-state-and-pipeline_DRAFT.md` (~L1–L156)
- `docs/new_docs/risk-callsite-id-and-stats_IMPROVED.md` (~L1–L120)
- `docs/new_docs/spec_risk-flows-and-call-sites_RECONCILED.md` (~L1–L141)
- `docs/new_docs/spec_risk-interprocedural-config_IMPROVED.md` (~L1–L99)
- `docs/new_docs/spec_risk-summaries_IMPROVED.md` (~L1–L169)
- `docs/specs/risk-callsite-id-and-stats.md` (~L1–L162)
- `docs/specs/risk-flows-and-call-sites.md` (~L1–L341)
- `docs/specs/risk-interprocedural-config.md` (~L1–L171)
- `docs/specs/risk-interprocedural-stats.md` (~L1–L9)
- `docs/specs/risk-summaries.md` (~L1–L253)

### Existing bin/ files referenced (edit candidates)
- `bin/pairofcleats.js` (~L1–L279)

### Planned/new paths referenced in this phase (create as needed)
- **src/**
  - `src/index/build/artifacts/writers/risk-interprocedural.js` (NEW — create as part of this phase)
  - `src/index/callsite-id.js` (NEW — create as part of this phase)
  - `src/index/risk-interprocedural/config.js` (NEW — create as part of this phase)
  - `src/index/risk-interprocedural/edges.js` (NEW — create as part of this phase)
  - `src/index/risk-interprocedural/engine.js` (NEW — create as part of this phase)
  - `src/index/risk-interprocedural/summaries.js` (NEW — create as part of this phase)
  - `src/index/validate/risk-interprocedural.js` (NEW — create as part of this phase)
- **tools/**
  - `tools/explain-risk.js` (NEW — create as part of this phase)
- **docs/**
  - `docs/archived` (NEW — create as part of this phase)
  - `docs/archived/README.md` (NEW doc/spec — create as part of this phase)
  - `docs/archived/phase-10` (NEW — create as part of this phase)
  - `docs/archived/specs/phase-10` (NEW — create as part of this phase)
- **tests/**
  - `tests/cli/risk-explain.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match risk-explain.test`
  - `tests/fixtures/risk-interprocedural/js-simple` (NEW fixture/dir — create as part of this phase)
  - `tests/lang/javascript-paramnames.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match javascript-paramnames.test`
  - `tests/risk-interprocedural/artifacts-written.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match artifacts-written.test`
  - `tests/risk-interprocedural/callsite-id.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match callsite-id.test`
  - `tests/risk-interprocedural/callsite-sampling.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match callsite-sampling.test`
  - `tests/risk-interprocedural/config-normalization.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match config-normalization.test`
  - `tests/risk-interprocedural/flows-argaware-negative.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match flows-argaware-negative.test`
  - `tests/risk-interprocedural/flows-conservative.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match flows-conservative.test`
  - `tests/risk-interprocedural/flows-sanitizer-policy.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match flows-sanitizer-policy.test`
  - `tests/risk-interprocedural/flows-timeout.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match flows-timeout.test`
  - `tests/risk-interprocedural/runtime-gating.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match runtime-gating.test`
  - `tests/risk-interprocedural/summaries-determinism.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match summaries-determinism.test`
  - `tests/risk-interprocedural/summaries-schema.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match summaries-schema.test`
  - `tests/risk-interprocedural/summaries-truncation.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match summaries-truncation.test`
  - `tests/unit` (NEW fixture/dir — create as part of this phase)
  - `tests/validator/risk-interprocedural.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match risk-interprocedural.test`

