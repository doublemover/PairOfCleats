# Phase 8 - Tooling Provider Framework & Type Inference Parity (Segment‑Aware)

## Status legend

Checkboxes represent the state of the work, update them to reflect the state of work as its being done:

- [x] Implemented and appears complete/correct based on code inspection and existing test coverage
- [@] In Progress, this work has been started
- [.] Work has been completed but has Not been tested
- [?] There is a correctness gap **or** there is missing/insufficient test proving behavior
- [ ] Not complete

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
Computed per `docs/specs/identity-contract.md` (canonical). Inputs:
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

## Phase 8.1 -- Provider contract + registry (capability gating, deterministic selection)

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
- (optional but recommended) `docs/config/schema.json` (tooling keys)

### Tasks

- [.] **8.1.1 Define the provider contract (runtime-safe, JSDoc typed)**
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

- [.] **8.1.2 Implement provider registry (deterministic + config-gated)**
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

- [.] **8.1.3 Wrap/migrate existing providers into contract**
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

- [.] **8.1.4 Centralize merge semantics in orchestrator**
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

- [.] **8.1.5 Extend tooling config surface (min required for Phase 8)**
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
  - Config additions notes:
    - Justification: prevent oversized TS programs from stalling indexing on large repos.
    - Design: per-partition caps (`maxFiles`, `maxFileBytes`, `maxProgramFiles`) skip provider when exceeded.
    - Tests: provider caps exercised in `tests/tooling/typescript-*` + doctor reports.
    - Budget impact: bounded memory/CPU; no new background processes.

### Tests / Verification

- [.] Add `tests/tooling/providers/provider-registry-gating.test.js`
  - Construct fake providers + config allow/deny cases and assert selected provider ids are deterministic.
- [.] Add `tests/tooling/providers/provider-registry-ordering.test.js`
  - Assert `(priority,id)` ordering is stable even if registration order changes.

---

## Phase 8.2 -- Segment/VFS-aware tooling orchestration + stable chunk keys + join policy

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

- [.] **8.2.1 Preserve JSX/TSX fidelity in segmentation**
  - Touch: `src/index/segments.js`
  - Change `MARKDOWN_FENCE_LANG_ALIASES`:
    - `jsx -> jsx` (not `javascript`)
    - `tsx -> tsx` (not `typescript`)
  - Rationale:
    - TS/JS providers need the correct effective extension (`.tsx`/`.jsx`) for script kind and tooling languageId mapping.
  - Add/update unit test:
    - `tests/segments/markdown-fence-tsx-jsx-preserved.js`

- [.] **8.2.2 Implement chunkUid computation (v1)**
  - Touch: `src/index/chunk-uid.js`, `src/shared/hash.js`
  - Implement:
    - `computeChunkUidV1({fileRelPath,segmentUid,start,end,chunkText,fullText,namespaceKey,segmentLanguageId})`
    - `resolveChunkUidCollisions(chunks)` (post-docId assignment)
  - Performance requirement:
    - Fetch xxhash backend once per file processor invocation.
    - Avoid re-hashing identical strings via small LRU cache keyed by string length+slice identity (optional; only if profiling shows benefit).

- [.] **8.2.3 Persist chunkUid fields into metaV2**
  - Touch: `src/index/metadata-v2.js`
  - Add fields to metaV2:
    - `chunkUid`
    - `chunkUidAlgoVersion`
    - `spanHash`, `preHash`, `postHash`
    - `collisionOf` (null or string)
  - Ensure metaV2 remains JSON-serializable and stable field ordering is not required (but recommended for diffs).

- [.] **8.2.4 Compute chunkUid in file processor (best location)**
  - Touch: `src/index/build/file-processor.js`
  - Exact placement:
    - Inside the main chunk loop, after `ctext` and `tokenText` are produced and before `chunkPayload` is assembled.
  - Use:
    - `chunkTextForHash = tokenText` (the exact text used for tokenization/indexing).
    - `containerTextForContext = text` (decoded file text from `readTextFileWithHash` path).
  - Store computed values on `chunkPayload.metaV2` (or on chunkPayload then copied into metaV2 in `buildMetaV2`).

- [.] **8.2.5 Collision resolution must run after docId assignment**
  - Superseded by canonical identity contract: `docId` is not stable and MUST NOT be used for disambiguation.
  - Implemented in `assignChunkUids` using stable ordering (file/segmentUid/start/end/kind/name) before docId assignment.

- [.] **8.2.6 Implement VFS builder**
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

- [.] **8.2.7 Replace `file::name` joins in tooling pass with chunkUid joins**
  - Touch: `src/index/type-inference-crossfile/pipeline.js`, `src/index/type-inference-crossfile/tooling.js`
  - In `pipeline.js`:
    - Keep existing `chunkByKey` for non-tooling inference paths if needed.
    - Add `chunkByUid = new Map(chunks.map(c => [c.metaV2.chunkUid, c]))`.
  - In tooling apply:
    - Accept `typesByChunkUid` and directly enrich `chunkByUid.get(chunkUid)`.

- [.] **8.2.8 Update shared tooling guard semantics (per invocation, not per retry)**
  - Touch: `src/integrations/tooling/providers/shared.js#createToolingGuard`
  - Change semantics:
    - retries are internal; only count **one** failure when the invocation fails after retries.
    - keep log lines for each attempt (but don't trip breaker early).
  - Why better:
    - removes false breaker trips on transient flakiness while preserving protective behavior.

- [.] **8.2.9 Enforce bounded merge growth + deterministic ordering**
  - Touch: `src/integrations/tooling/providers/shared.js#mergeToolingEntry`
  - Add caps (configurable; safe defaults):
    - `maxReturnCandidates = 5`
    - `maxParamCandidates = 5`
  - Deterministic:
    - sort candidate types lexicographically after dedupe (or preserve provider order but cap deterministically).
  - Record if truncation occurred via orchestrator observation.

### Tests / Verification

- [.] Add `tests/identity/chunkuid-stability-lineshift.js`
  - Create a file text with a function chunk.
  - Compute chunkUid.
  - Create a new container text with inserted text above the chunk (but keep chunk span content unchanged).
  - Recompute and assert chunkUid unchanged.
- [.] Add `tests/identity/chunkuid-collision-disambiguation.js`
  - Construct two chunk records with identical `chunkId`, `spanHash`, `preHash`, `postHash` (same file+segment).
  - Apply collision resolver and assert:
    - first keeps `chunkUid`
    - second becomes `chunkUid:dup2`
    - second has `collisionOf` pointing to original
- [.] Add `tests/tooling/vfs-offset-mapping-segment.js`
  - Use a container with a segment range, build VFS, assert container→virtual offsets map exactly and obey assertions.
- [.] Extend/confirm `tests/indexing/type-inference/providers/type-inference-lsp-enrichment.test.js` still passes after tooling join changes.

---

## Phase 8.3 -- TypeScript provider parity for JS/JSX + segment VFS support (stable keys, node matching)

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

- [.] **8.3.1 Change TS provider interface to VFS-based inputs**
  - Touch: `src/index/tooling/typescript-provider.js`
  - Replace old signature `collectTypeScriptTypes({chunksByFile})` with:
    - `collectTypeScriptTypes({rootDir, documents, targets, log, toolingConfig, guard})`
  - Provider must:
    - filter to targets where `languageId in {typescript, tsx, javascript, jsx}`
    - output `typesByChunkUid: Map<chunkUid, ToolingTypeEntry>`

- [.] **8.3.2 Config resolution (tsconfig/jsconfig) + partitions**
  - Touch: `src/index/tooling/typescript-provider.js`
  - Algorithm:
    1. For each **containerPath** represented in the targets, resolve config:
       - if `tooling.typescript.tsconfigPath` provided, use it
       - else search upward from `<rootDir>/<containerPath>` for `tsconfig.json`, else `jsconfig.json`
    2. Partition targets by resolved config path (string key); use `"__NO_CONFIG__"` for fallback.
  - Fallback compiler options for `"__NO_CONFIG__"`:
    - `{ allowJs:true, checkJs:true, strict:false, target:ES2020, module:ESNext, jsx:Preserve, skipLibCheck:true }`

- [.] **8.3.3 Build a LanguageService program that includes VFS docs**
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

- [.] **8.3.4 Implement range-based node matching (primary)**
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

- [.] **8.3.5 Extract types and format output deterministically**
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

- [.] **8.3.6 JS/JSX parity and safety caps**
  - Touch: `src/index/tooling/typescript-provider.js`
  - Enforce caps:
    - `maxFiles`, `maxFileBytes`, `maxProgramFiles`
  - When cap exceeded:
    - skip TS provider for that partition and record observation with reason code (doctor/reportable).

- [.] **8.3.7 Emit SymbolRef (minimal heuristic)**
  - Touch: `src/shared/identity.js` (helpers), TS provider
  - For each successful match, optionally attach:
    - `symbolKey = "ts:heur:v1:" + virtualPath + ":" + (nodeName||target.chunkRef.chunkId)`
    - `signatureKey = "sig:v1:" + sha1(signatureCanonical)`
    - `scopedId = "sid:v1:" + sha1(symbolKey + "|" + signatureKey)`
    - `symbolId = null` (unless future SCIP/LSIF available)
  - Store symbolRef on the tooling entry as `entry.symbolRef` OR attach to chunk docmeta (choose one and document; recommended: `entry.symbolRef` for now, ignored by consumers until Phase 9).

### Tests / Verification

- [.] Add `tests/tooling/typescript-vfs-js-parity.js`
  - Build a virtual doc `.jsx` with a simple component and assert return/param types are non-empty and stable.
- [.] Add `tests/tooling/typescript-range-matching.js`
  - Create a file with two functions of same name in different scopes; ensure the correct chunk range maps to correct function.
- [.] Add `tests/tooling/lsp/typescript/typescript-destructured-param-names.test.js`
  - Function `f({a,b}, [c])` should produce stable paramNames like `{a,b}` and `[c]` (whitespace-insensitive).
- [.] Extend `tests/indexing/type-inference/providers/type-inference-typescript-provider-no-ts.test.js`
  - Ensure provider cleanly no-ops when TypeScript module missing (existing behavior preserved).

---

## Phase 8.4 -- LSP provider hardening + VFS integration (restart safety, per-target failures, stable keys)

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

- [.] **8.4.1 Fix LSP client restart race via generation token**
  - Touch: `src/integrations/tooling/lsp/client.js`
  - Add `let generation = 0;` and increment on each `start()`.
  - Capture `const myGen = generation` inside process event handlers; ignore events if `myGen !== generation`.
  - Ensure old process exit cannot null-out writer/parser for a newer generation.

- [.] **8.4.2 Add deterministic timeout + transport-close rejection**
  - Touch: `src/integrations/tooling/lsp/client.js`
  - Requirements:
    - every request must have a timeout, default to e.g. 15000ms if caller omits
    - if transport closes:
      - reject all pending requests immediately with `ERR_LSP_TRANSPORT_CLOSED`

- [.] **8.4.3 Add exponential backoff restart policy**
  - Touch: `src/integrations/tooling/lsp/client.js`
  - Policy:
    - consecutive restart delays: 250ms, 1s, 3s, 10s (cap)
    - reset backoff on stable uptime threshold or successful request.

- [.] **8.4.4 Support VFS docs in provider**
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

- [.] **8.4.5 Per-target failure accounting**
  - Touch: `src/integrations/tooling/providers/shared.js#createToolingGuard` AND LSP provider call sites
  - Semantics:
    - Each target counts as at most 1 failure after all retries/timeouts for that target.
    - Do not increment breaker on intermediate retry attempts.

- [.] **8.4.6 Encoding correctness**
  - Touch: `src/index/tooling/*-provider.js` AND LSP provider text reads
  - Any provider reading file text must use `readTextFile` from `src/shared/encoding.js` so chunk offsets remain consistent.

### Tests / Verification

- [.] Add `tests/tooling/lsp-restart-generation-safety.js`
  - Simulate old process exit after new start and assert new client stays valid.
- [.] Add `tests/tooling/lsp-vfs-didopen-before-hover.js`
  - Use stub LSP server to assert didOpen observed before hover for `.poc-vfs/...` URI.
- [.] Add `tests/tooling/lsp-bychunkuid-keying.js`
  - Assert provider returns map keyed by the provided target chunkUid, not `file::name`.
- [.] Add `tests/tooling/lsp-failure-accounting-per-target.js`
  - Stub LSP server fails N attempts then succeeds; breaker should not trip prematurely.

---

## Phase 8.5 -- Tooling doctor + reporting + CLI integration

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
- Modify: `docs/guides/commands.md` (or create `docs/tooling.md`)

### Tasks

- [.] **8.5.1 Implement doctor report schema**
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

- [.] **8.5.2 Align doctor with provider registry**
  - Doctor must use the same provider registry selection logic as the orchestrator:
    - avoids "doctor says ok but index says no".

- [.] **8.5.3 Add CLI surface**
  - Touch: `bin/pairofcleats.js`
  - Add:
    - `pairofcleats tooling doctor --repo <path> [--json]`
  - Implementation:
    - route to `tools/tooling-doctor.js`

- [.] **8.5.4 Integrate into build logs (optional, gated)**
  - Touch: `tools/build_index.js` (or relevant runner)
  - Behavior:
    - if `tooling.doctorOnBuild === true`, run doctor once at start and log summary.

### Tests / Verification

- [.] Add `tests/tooling/doctor/doctor-json-stable.test.js`
  - Run doctor against a fixture repo and assert JSON keys and key fields are present.
- [.] Add `tests/tooling/doctor/doctor-gating-reasons.test.js`
  - Provide config with denylist and assert provider shows `enabled:false` with correct reason.
- [.] Unskip phase-tagged LMDB tests once Phase 7/8 deliverables land:
  - Remove `DelayedUntilPhase7_8` from `tests/run.config.jsonc`.
  - Ensure these tests pass: `lmdb-backend`, `lmdb-corruption`, `lmdb-report-artifacts`.

---

## 4. Migration checklist (explicitly remove ambiguity)

- [.] `file::name` MUST NOT be used as a tooling join key anywhere.
  - Search patterns:
    - `"::${chunk.name}"`, `"${file}::"`, `"file::name"`
  - Known current touchpoints:
    - `src/index/tooling/typescript-provider.js` (key = `${chunk.file}::${chunk.name}`)
    - `src/integrations/tooling/providers/lsp.js` (key = `${target.file}::${target.name}`)
    - `src/index/type-inference-crossfile/pipeline.js` (chunkByKey / entryByKey)
- [.] All tooling provider outputs must be keyed by `chunkUid` (and include chunkRef for provenance/debug).
- [.] Segment routing must not rely on container ext. Always use effective language id + ext mapping.
- [.] Any time offsets are used for mapping, file text must come from `src/shared/encoding.js`.

---

## 5. Acceptance criteria (Phase 8 complete when true)

- [.] Tooling orchestration is provider-registry-driven and deterministic.
- [.] Embedded JS/TS segments (Markdown fences, Vue script blocks) receive TS-powered enrichment via VFS.
- [.] TypeScript provider enriches JS/JSX when enabled, respecting jsconfig/tsconfig discovery.
- [.] LSP client restart is generation-safe and does not corrupt new sessions.
- [.] Every tooling attachment is keyed by chunkUid, never `file::name`.
- [.] Tooling doctor can explain gating, availability, and configuration in JSON + human output.

---

## 6. Implementation ordering (recommended)

1. Phase 8.2.1-8.2.5 (chunkUid + persistence + collisions)  
2. Phase 8.2.6 (VFS builder)  
3. Phase 8.1 (registry + orchestrator skeleton; wire into tooling pass)  
4. Phase 8.3 (TypeScript provider refactor)  
5. Phase 8.4 (LSP hardening)  
6. Phase 8.5 (doctor + CLI)  
7. Remaining tests + fixtures hardening

---

## Added detail (Phase 8 task mapping)

### 8.1 Provider contract + registry
- Files to change/create:
  - src/index/tooling/registry.js (new; per docs/phases/phase-8/tooling-provider-registry.md)
  - src/index/type-inference-crossfile/tooling.js (replace hardcoded provider fan-out)
  - src/index/type-inference-crossfile/pipeline.js (runToolingPass call at ~99-101)
  - src/index/build/runtime/runtime.js (toolingConfig + toolingEnabled at ~155-176)
  - src/integrations/tooling/providers/shared.js (extend entries with provider id/version/config hash)
- Call sites/line refs:
  - src/index/type-inference-crossfile/pipeline.js:99-107
  - src/index/build/runtime/runtime.js:155-176, 611-612
- Gaps/conflicts:
  - Current providers key by `${file}::${name}` (see src/index/tooling/typescript-provider.js:308); spec requires chunkUid-first joins.
  - docs/phases/phase-8/identity-and-symbol-contracts.md expects chunkUid availability; now required in Phase 8 (fail-closed if missing).

### 8.2 Segment/VFS-aware tooling orchestration
- Files to change/create:
  - src/index/tooling/vfs.js (new typedefs + helpers per docs/phases/phase-8/tooling-vfs-and-segment-routing.md)
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
  - docs/phases/phase-8/typescript-provider-js-parity.md expects JS/JSX support; current routing uses file ext filtering.

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
  - src/shared/cli (add "doctor" command output wiring)
  - tools/dict-utils.js (getToolingConfig surface if new fields added)
- Call sites/line refs:
  - src/index/type-inference-crossfile/tooling.js:221-285 (toolingConfig, logging, diagnostics)
- Gaps/conflicts:
  - docs/phases/phase-8/tooling-doctor-and-reporting.md expects structured health output; current pipeline only logs to console.

### Associated specs reviewed (Phase 8)
- docs/phases/phase-8/tooling-provider-registry.md
- docs/phases/phase-8/tooling-vfs-and-segment-routing.md
- docs/phases/phase-8/typescript-provider-js-parity.md
- docs/phases/phase-8/lsp-provider-hardening.md
- docs/phases/phase-8/tooling-doctor-and-reporting.md
- docs/phases/phase-8/identity-and-symbol-contracts.md
- docs/specs/vfs-manifest-artifact.md

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
  - VFS manifest + virtualPath scheme from `docs/specs/vfs-manifest-artifact.md`.
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
- tests/tooling/lsp/typescript/typescript-js-parity-basic.test.js (test:services)
- tests/tooling/lsp/typescript/typescript-vfs-segment-vue.test.js (test:services)
- tests/tooling/lsp/typescript/typescript-node-matching-range.test.js (test:services)
- tests/tooling/lsp/typescript/typescript-ambiguous-fallback-does-not-guess.test.js (test:services)

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

---

## Progress log (phase8-vfs-of-the-caribbean)

### 2026-01-27

- **Provider registry + selection**
  - Added `selectToolingProviders` with deterministic ordering, `providerOrder` override, per-provider language/kind gating, and enabled/disabled tool filtering.
  - Providers now normalize ids case-insensitively (lowercased).
  - Provider cache keys now include *only* the documents passed to each provider plan (language-scoped).

- **Configured LSP servers (tooling.lsp)**
  - Added `src/index/tooling/lsp-provider.js` to materialize per-server LSP providers from config.
  - Added `tooling.lsp` and `tooling.providerOrder` config wiring + schema updates.
  - LSP providers honor per-server `uriScheme` (`file` or `poc-vfs`), args, languages, timeout, retries.

- **VFS protections**
  - Added `tooling.vfs.maxVirtualFileBytes` limit (fail-closed when strict) to protect virtual docs.
  - `runToolingPass` now reads `tooling.vfs` and passes strict/limits into VFS builder.

- **Provider metadata**
  - Default providers now declare `priority`, `languages`, `kinds`, and `requires` to enable registry gating.

- **LSP provider URI handling**
  - LSP collection supports `poc-vfs://` URIs for servers that cannot accept file-backed temp paths.

- **TypeScript provider partitions + SymbolRef**
  - Added tsconfig/jsconfig discovery per document (with override) and partitioned program builds by config.
  - Enforced `maxFiles`, `maxFileBytes`, and `maxProgramFiles` caps with diagnostics.
  - Normalized destructured parameter names and emitted minimal `symbolRef` metadata per chunkUid.

- **Tooling merge caps**
  - Added deterministic, capped param-type merges with truncation observations in the orchestrator and shared tooling merge helpers.

- **LSP client hardening**
  - Added default request timeouts and transport-close rejection for pending requests.

- **Tooling doctor CLI + schema**
  - Added `tools/tooling-doctor.js` and `pairofcleats tooling doctor` CLI surface.
  - Extended doctor report with config + xxhash metadata and provider array entries.

- **Tests/cleanup**
  - Added provider registry gating/ordering tests and doctor JSON/gating tests.
  - Added TypeScript destructured parameter name test; unskipped Phase 7/8 LMDB tag.

### Pending / follow-ups

- Consider adding validation for `tooling.lsp.servers[]` shape (optional, schema allows it but config normalize is shallow).
- Reconcile `chunkUid` collision post-docId guidance vs identity-contract spec (8.2.5).
- Extend/confirm `tests/indexing/type-inference/providers/type-inference-lsp-enrichment.test.js` coverage after tooling join changes.
