# PairOfCleats — Static Codebase Review (Bugs, Misconfigurations, Limiters)

This document is a **static review** of the repository snapshot provided (no dependency installation, no runtime execution, no test execution). Findings focus on:

- **Subtle correctness bugs** (data model drift, key collisions, unreachable branches)
- **Misconfiguration risks** (defaults that don’t match intent, hard-coded values, silent fallbacks)
- **Overly restrictive limiters** that reduce analysis quality in real repos
- **Implementation drift** between emitters/consumers (metadata fields, type inference, filters)

Where possible, each issue includes a **suggested fix direction** (high-level only; no patches).

---

## High-impact cross-cutting issues (priority order)

1) **Return-type field inconsistencies create wrong metadata and broken filters**
   - Some languages emit return types in `docmeta.returns` (string/array), JavaScript uses `docmeta.returns` as a boolean “@returns present”, while many consumers look only at `docmeta.returnType`.
   - Consequences:
     - `metaV2` can incorrectly declare return type `"true"` for JS chunks with `@returns` but without `{Type}`.
     - Type inference and CLI filtering/reporting can appear to “miss return types” for many languages.

2) **Keying by `file::name` (or just `name`) causes collisions across segments/overloads/nesting**
   - Multiple subsystems (cross-file inference, tooling providers, graph building) assume `file + symbolName` is unique.
   - In practice it is not, especially with:
     - Vue/Svelte/Astro segments (multiple “virtual files” in one physical file)
     - TypeScript overloads
     - Duplicate function names in the same file (common in tests)

3) **Segment language normalization collapses JSX/TSX into JS/TS, breaking parsing/tooling**
   - `jsx → javascript` and `tsx → typescript` loses the grammar distinction required by tree-sitter/Babel tooling.
   - Embedded JSX/TSX segments in `.vue`, markdown fences, or HTML script blocks will frequently parse incorrectly or not at all.

4) **Tooling filters are file-extension–based, so embedded segments don’t get tooling-backed types**
   - The TypeScript provider (and tooling pipeline) primarily selects by **file extension**, not per-segment language.
   - Result: Vue `<script lang="ts">` and similar embedded contexts miss the strongest type extraction.

5) **`metaV2` is built before cross-file inference/tooling enrichment and never rebuilt**
   - Cross-file inference mutates `chunk.docmeta` (links, inferred param types, risk flows), but `metaV2` remains the earlier snapshot.
   - Anything consuming `metaV2` sees stale declared/inferred types and relations.

6) **Risk analysis “caps” do not short-circuit early enough**
   - When a file exceeds byte/line caps, the implementation still performs expensive per-line rule scanning.
   - This negates the intended performance protection.

---

# File-by-file findings

## `src/index/metadata-v2.js`

- **Bug: `docmeta.returns` is treated as a return-type value without type-guarding**
  - **What’s wrong:** `normalizeString(docmeta.returnType || docmeta.returns)` will stringify booleans/objects.
  - **Why it matters:** In JavaScript chunks, `docmeta.returns` is a boolean (“@returns present”), so `metaV2.returns` can become `"true"` and declared return types can become `[{type:"true",...}]`.
  - **Suggested fix:** Only treat `docmeta.returns` as a return-type source when it is a **string** or a **structured return list**; otherwise ignore.

- **Bug: structured `docmeta.returns` arrays/objects are stringified**
  - **What’s wrong:** If `docmeta.returns` is an array (common in cross-file inference output), `String(array)` yields garbage (`"[object Object]"` or comma-joined fragments).
  - **Why it matters:** Declared return types in `metaV2` become incorrect or unusable for filters and downstream analysis.
  - **Suggested fix:** Normalize arrays using the same extraction logic used elsewhere (`extractReturnTypes`) and only accept string return types.

- **Drift risk: `metaV2` does not reflect post-processing mutations**
  - **What’s wrong:** `metaV2` is built once during file assembly.
  - **Why it matters:** Cross-file inferred param types, call links, and risk flows may not be represented.
  - **Suggested fix:** Recompute or incrementally update `metaV2` after enrichment steps.

---

## `src/lang/javascript/docmeta.js`

- **Schema ambiguity: `returns` is boolean, while other languages treat `returns` as a return-type**
  - **What’s wrong:** JS uses `returns: boolean` (“@returns tag exists”), and `returnType` holds the type when present.
  - **Why it matters:** Any consumer that interprets `returns` as a type (as `metadata-v2.js` currently does) will misbehave.
  - **Suggested fix:** Rename boolean to something unambiguous (`hasReturnsTag`, `returnsDocTag`) or ensure all consumers treat `returns` as non-type unless explicitly string/array.

---

## `src/index/type-inference.js`

- **Bug: return-type inference ignores `docmeta.returns`**
  - **What’s wrong:** `inferReturnType` reads `docmeta.returnType` only.
  - **Why it matters:** Many languages populate return types in `docmeta.returns` (string) rather than `returnType`, so inferred return types can appear missing even when extracted.
  - **Suggested fix:** Normalize return type from `docmeta.returnType` **or** (string-only) `docmeta.returns`.

- **Data model drift risk: inconsistent sources for “declared vs inferred”**
  - **What’s wrong:** Some return/param types are treated as inference in one subsystem and “declared” in another.
  - **Why it matters:** Filters and ranking may behave unpredictably across languages.
  - **Suggested fix:** Centralize type normalization (declared/inferred/tooling) in one shared normalization path.

---

## `src/retrieval/output/filters.js`

- **Bug: `--returnType` filter ignores `docmeta.returns`**
  - **What’s wrong:** `const foundReturnType = c.docmeta?.returnType || null;`.
  - **Why it matters:** Return-type filtering fails for languages that populate `docmeta.returns`.
  - **Suggested fix:** Filter should consider normalized return types (string-only) from both fields or from `metaV2.types.declared.returns`.

- **Potential semantics pitfall: `--calls` matches caller name OR callee name**
  - **What’s wrong:** `found = callsList.find(([fn, callName]) => fn === calls || callName === calls)`.
  - **Why it matters:** Users typically expect `--calls X` to mean “calls X”, not “is named X”.
  - **Suggested fix:** Separate flags (`--caller` vs `--calls`) or clarify semantics.

---

## `src/retrieval/output/format.js`

- **Correctness/UX gap: output emphasizes `docmeta.returnType`**
  - **What’s wrong:** Formatting (and likely JSON output) prioritizes `returnType` only.
  - **Why it matters:** For many languages, return types exist in `docmeta.returns` and won’t be displayed.
  - **Suggested fix:** Display a normalized return type value (string-only) or prefer `metaV2` declared types.

---

## `src/index/segments.js`

- **Bug/limitation: JSX/TSX are normalized away (`jsx→javascript`, `tsx→typescript`)**
  - **What’s wrong:** `MARKDOWN_FENCE_LANG_ALIASES` collapses JSX/TSX into the base language.
  - **Why it matters:** Tree-sitter and Babel require distinct grammars/plugin sets to parse JSX/TSX. This causes embedded JSX/TSX to parse as plain JS/TS and often fail.
  - **Suggested fix:** Preserve `jsx`/`tsx` as distinct `languageId` values and ensure segment ext reflects it (`.jsx`, `.tsx`).

- **Limiter: stylesheet languages coerced to `.css`**
  - **What’s wrong:** `scss/sass/less → .css`.
  - **Why it matters:** Even if you intentionally parse as CSS, downstream language selection and reporting becomes misleading (you can’t tell if content was SCSS vs CSS).
  - **Suggested fix:** Keep the original language ID while optionally selecting a fallback parser.

- **Observability gap: Vue/Svelte/Astro parse failures are silent**
  - **What’s wrong:** `catch { return null; }` for segment parsers.
  - **Why it matters:** Users can’t tell whether segmentation failed and why analysis quality dropped.
  - **Suggested fix:** Emit a structured “segment parse failed” warning (throttled) and a per-file reason.

- **Correctness risk: offset invariants are assumed, not tested**
  - **What’s wrong:** The system assumes `segment.start/end` slice yields language-valid source.
  - **Why it matters:** Any off-by-one or tag-inclusion bug would cascade into chunking, relations, and tooling.
  - **Suggested fix:** Add fixtures asserting that extracted segment text does **not** include wrapper tags and that parsers can parse it.

---

## `src/index/build/file-processor/tree-sitter.js`

- **Bug: segment language resolution uses the *file* extension instead of the *segment* extension**
  - **What’s wrong:** `resolveTreeSitterLanguagesForSegments` calls `resolveTreeSitterLanguageForSegment(segment.languageId, ext)` where `ext` is the container file ext.
  - **Why it matters:** Embedded TSX/JSX segments in `.vue`/`.md` won’t resolve to `tsx`/`jsx` grammars.
  - **Suggested fix:** Use `segment.ext` (or a richer segment language descriptor) when resolving tree-sitter language IDs.

- **Knock-on effect:** missing-language deferral can be triggered incorrectly
  - **What’s wrong:** `treeSitterMissingLanguages` may omit languages that are actually needed (because ext-based mapping hides them).
  - **Why it matters:** Files may fall back to non-tree-sitter chunking even though a grammar exists.
  - **Suggested fix:** Resolve languages based on per-segment type, not container ext.

---

## `src/lang/babel-parser.js`

- **Bug/limitation: TypeScript JSX enablement is extension-only**
  - **What’s wrong:** `shouldEnableJsx` enables JSX for TypeScript only when `ext === '.tsx'`.
  - **Why it matters:** Embedded TSX segments (often ext `.ts` due to segment normalization) will fail to parse.
  - **Suggested fix:** For TypeScript mode, enable JSX when TSX-like syntax is detected (or when segment language is explicitly TSX).

- **Observability gap: parse failures return null without structured reasons**
  - **What’s wrong:** callers can’t distinguish “unsupported syntax”, “timeout”, “bad ext”, etc.
  - **Why it matters:** makes it hard to debug parsing failures at scale.
  - **Suggested fix:** return `{ok:false,reason,...}` style result, or emit per-file diagnostics.

---

## `src/lang/typescript/chunks.js` and `src/lang/typescript/parser.js`

- **Limiter: TSX parsing depends on `.tsx` extension**
  - **What’s wrong:** TSX language selection is extension-driven.
  - **Why it matters:** TSX inside embedded segments or atypically named files will parse incorrectly.
  - **Suggested fix:** allow explicit segment language IDs (tsx) to override ext heuristics.

---

## `src/lang/tree-sitter/config.js`

- **Bug: HTML config uses `nameNodeTypes`, but the chunker expects `nameTypes`**
  - **What’s wrong:** `extractNodeName` reads `config.nameTypes`; HTML config sets `nameNodeTypes`.
  - **Why it matters:** HTML tree-sitter chunking can silently produce **no chunks** (names not extracted), forcing fallback and wasting parse time.
  - **Suggested fix:** Align config field names (or support both).

- **Completeness gap: no dedicated grammars for SCSS/LESS/SASS**
  - **What’s wrong:** ecosystem exists, but only CSS is supported.
  - **Why it matters:** analysis of modern frontend code is weaker than it appears.
  - **Suggested fix:** treat as optional grammars; keep CSS fallback.

---

## `src/lang/tree-sitter/chunking.js`

- **Limiter: hard failure when `maxChunkNodes` exceeded**
  - **What’s wrong:** if too many nodes, chunking returns `null`, falling back to lower fidelity approaches.
  - **Why it matters:** large code-generated files or large route maps lose structured chunks and relations.
  - **Suggested fix:** implement sampling/partial chunking strategies (e.g., top-level only, or capped per-scope).

- **Potential correctness issue: name extraction is shallow**
  - **What’s wrong:** `findNameNode` depth limit (6) can miss names in deeper patterns.
  - **Why it matters:** missing name ⇒ no chunk emitted for that node.
  - **Suggested fix:** allow deeper search for selected languages or rely on `nameFields` where possible.

---

## `src/index/type-inference-crossfile/pipeline.js`

- **Bug: `chunkByKey` uses `file::name`, which is not unique**
  - **What’s wrong:** `chunkByKey.set(file::name, chunk)` overwrites on collisions.
  - **Why it matters:** incorrect call links, usage links, type inference attribution, and risk flow paths.
  - **Suggested fix:** key by `chunkId` or include `{file,start,end,segmentId}`.

- **Limiter: `addLink` de-duplicates call summaries by `{name,target,file}` only**
  - **What’s wrong:** multiple callsites with different args collapse to one.
  - **Why it matters:** param inference (and future risk flows) loses evidence diversity and accuracy.
  - **Suggested fix:** keep a bounded sample per callee including distinct arg patterns, or store counts.

- **Inconsistency: fallback to `fileRelations.get(file)?.calls` is dead code**
  - **What’s wrong:** `fileRelations` entries (as emitted today) don’t include `.calls`, so this branch never runs.
  - **Why it matters:** indicates implementation drift; reduces confidence in call summary behavior.
  - **Suggested fix:** remove dead path or include calls in fileRelations when needed.

- **Risk severity ranking is too narrow**
  - **What’s wrong:** rank map supports only `low|medium|high`.
  - **Why it matters:** if rules introduce `critical` or other severities, ranking and max severity selection becomes wrong.
  - **Suggested fix:** normalize severities (or support a richer scale) before ranking.

---

## `src/index/type-inference-crossfile/tooling.js`

- **Bug/limitation: chunk selection is file-extension–based**
  - **What’s wrong:** `filterChunksByExt` uses `path.extname(file)`.
  - **Why it matters:** `.vue` files containing TS/JS segments won’t be analyzed by TypeScript tooling.
  - **Suggested fix:** drive tooling selection from `chunk.segment.languageId` / `segment.ext` and provide a virtual-file strategy.

- **Bug: tooling skip heuristic is too coarse (`hasToolingReturn`)**
  - **What’s wrong:** If a chunk has *any* tooling return type, the chunk is excluded from tooling runs.
  - **Why it matters:** partial tooling results (return type only, missing params/diagnostics) can never be completed.
  - **Suggested fix:** skip based on a completeness predicate (returns + params + diagnostics), or add `--toolingForce`.

- **Drift: tooling updates mutate `docmeta` but don’t update `metaV2`**
  - **What’s wrong:** updated return/param types remain invisible to `metaV2`.
  - **Why it matters:** UI/search consumers relying on metaV2 miss tooling improvements.
  - **Suggested fix:** rebuild metaV2 post-tooling or compute metaV2 lazily from docmeta.

---

## `src/index/build/file-processor/assemble.js`

- **Bug/drift: `metaV2` is constructed before enrichment passes**
  - **What’s wrong:** `metaV2` is built from raw `docmeta` at file processing time.
  - **Why it matters:** later mutations (tooling types, cross-file inference) are not reflected.
  - **Suggested fix:** rebuild `metaV2` after enrichment, or delay building until final emission.

---

## `src/index/build/indexer/steps/relations.js`

- **Configuration surprise: `riskAnalysisCrossFileEnabled` can trigger type inference**
  - **What’s wrong:** when cross-file inference runs due to risk, `enableTypeInference` is still `runtime.typeInferenceEnabled`.
  - **Why it matters:** users can unintentionally pay type inference cost when they expected only risk correlation.
  - **Suggested fix:** gate cross-file type inference on `typeInferenceCrossFileEnabled` explicitly.

- **Drift: no post-pass meta normalization**
  - **What’s wrong:** `applyCrossFileInference` modifies chunk objects, but no step normalizes/revalidates metaV2 afterwards.
  - **Why it matters:** downstream features see inconsistent representations.
  - **Suggested fix:** add a “finalize chunk metadata” step.

---

## `src/index/build/graphs.js`

- **Bug/limitation: `chunkIdByKey` uses `file::name` legacy key and overwrites on collisions**
  - **What’s wrong:** duplicates map to the most recently seen chunk.
  - **Why it matters:** graph edges can point to the wrong chunk.
  - **Suggested fix:** store edges by `chunkId` when available; treat legacy keys as non-unique.

- **Performance risk: graph serialization is adjacency-heavy**
  - **What’s wrong:** `out` and `in` arrays are emitted per node.
  - **Why it matters:** JSON size and serialization cost grow quickly; a dense graph can become huge.
  - **Suggested fix:** emit an edge list (or compress adjacency) and cap per-node neighbors.

---

## `src/index/build/indexer/steps/process-files.js`

- **Potential determinism risk: language batching reorders file processing**
  - **What’s wrong:** `entries` are sorted by `treeSitterBatchKey` and path.
  - **Why it matters:** chunk/doc ID allocation changes relative to a pure path sort; incremental tooling or external references may expect stable ordering.
  - **Suggested fix:** document ordering guarantees and ensure incremental reuse logic assumes batch ordering.

- **Complexity risk: deferral uses placeholder flush + re-queue**
  - **What’s wrong:** deferred files are flushed as `null` and later assigned new `orderIndex`.
  - **Why it matters:** makes correctness hard to reason about; can change ordering based on grammar availability.
  - **Suggested fix:** keep original orderIndex and defer *processing* while preserving output order.

---

## `src/shared/artifact-io.js`

- **Misconfiguration risk: max JSON size is implicit and dynamic**
  - **What’s wrong:** `DEFAULT_MAX_JSON_BYTES` depends on heap size and clamps between 32MB and 128MB.
  - **Why it matters:** artifact sharding behavior changes across machines/Node versions; not user-auditable.
  - **Suggested fix:** expose a first-class config key and emit “configured vs effective” values in config dump.

- **Test-only override is a trap**
  - **What’s wrong:** `PAIROFCLEATS_TEST_MAX_JSON_BYTES` exists but there is no production-equivalent knob.
  - **Why it matters:** roadmap tasks that assume configurability will not be implementable without adding config.
  - **Suggested fix:** promote to standard config with safe bounds.

---

## `src/index/build/artifacts.js`

- **Misconfiguration risk: `maxJsonBytes` is not configurable in normal operation**
  - **What’s wrong:** it uses `MAX_JSON_BYTES` directly.
  - **Why it matters:** you cannot intentionally produce smaller `.jsonl` pieces (e.g., 16/8/4/2MB) for better incremental uploads.
  - **Suggested fix:** plumb a config value into artifact writers.

- **Correctness risk: graph JSON size estimation uses magic `-2` offsets**
  - **What’s wrong:** `graphSizes.* - 2` is used to estimate total JSON bytes.
  - **Why it matters:** estimation errors can choose the wrong representation (JSON vs JSONL shards), leading to oversized artifacts.
  - **Suggested fix:** compute sizes from real serialization boundary conditions or always shard above a lower threshold.

---

## `src/index/build/artifacts/writers/chunk-meta.js`

- **Limiter: hard minimum 1MB, hard maximum 256MB**
  - **What’s wrong:** `resolveChunkMetaMaxBytes` clamps.
  - **Why it matters:** if you want very small shards (e.g., 2–8MB), you can, but only if the value is configurable upstream (it currently isn’t).
  - **Suggested fix:** expose this as config and make the clamp policy explicit.

- **Correctness risk: `estimateJsonBytes` is heuristic and may under-estimate**
  - **What’s wrong:** shard planning is based on approximate JSON size.
  - **Why it matters:** shards can exceed configured caps, breaking downstream expectations.
  - **Suggested fix:** include a “final size check” and split on overflow.

---

## `src/index/risk.js`

- **Performance bug: caps don’t prevent expensive scanning**
  - **What’s wrong:** even when `analysisStatus` becomes `capped` due to maxBytes/maxLines, rule scanning and match collection still proceeds.
  - **Why it matters:** large files can still dominate runtime, defeating caps.
  - **Suggested fix:** short-circuit scanning when caps exceeded (or scan only a window / sample).

- **Evidence loss: `dedupeMatches` keeps only one match per rule id**
  - **What’s wrong:** multiple matches of the same rule collapse.
  - **Why it matters:** users lose valuable evidence locations; risk scoring can become non-representative.
  - **Suggested fix:** keep top-K matches per rule or aggregate per-file stats.

- **Taint heuristic false-negative risk: assignment detection suppresses many valid assignments**
  - **What’s wrong:** comparison operators in RHS (`>=`, `<=`, etc.) can cause valid assignments to be ignored.
  - **Why it matters:** taint propagation becomes less reliable.
  - **Suggested fix:** use AST-based assignment detection where available, or refine heuristic.

---

## `src/index/analysis.js`

- **Compatibility risk: ESLint v9+ API drift likely disables linting silently**
  - **What’s wrong:** initialization uses options (`useEslintrc`) that have changed in newer ESLint.
  - **Why it matters:** lint output may silently disappear (the code sets `eslintInitFailed` and returns `[]`).
  - **Suggested fix:** add a compatibility test asserting linting works for a fixture and pin/upgrade config handling accordingly.

---

## `src/index/git.js`

- **Observability gap: git metadata failures are silently swallowed**
  - **What’s wrong:** many `try/catch {}` return `{}` with no warning.
  - **Why it matters:** features relying on churn/author metadata can degrade without clear user feedback.
  - **Suggested fix:** emit a single warning per repo when git metadata is unavailable (missing git, shallow clone, permissions, etc.).

- **Completeness gap: only “author” is stored; committer/branch/issue refs are not captured**
  - **What’s wrong:** meta includes `last_author` and a short log, but not committer identity or richer SCM context.
  - **Why it matters:** audit/ownership routing is less accurate.
  - **Suggested fix:** extend SCM metadata surface behind an abstraction (fits the Metadata Provider API work).

---

## `src/index/tooling/typescript-provider.js`

- **Major gap: `.js/.jsx` are excluded from the strongest TS tooling path**
  - **What’s wrong:** `filterTypeScriptFiles` only includes `.ts/.tsx/...` extensions.
  - **Why it matters:** JS codebases miss TypeScript’s best type extraction even when `allowJs/checkJs` is enabled.
  - **Suggested fix:** include `.js/.jsx` when configured (or when `checkJs` is desired) and respect `jsconfig.json`.

- **Config resolution gap: ignores `jsconfig.json`**
  - **What’s wrong:** default config file list is `['tsconfig.json']`.
  - **Why it matters:** JS projects using `jsconfig.json` lose path aliases/module resolution, reducing type accuracy.
  - **Suggested fix:** include `jsconfig.json` in discovery.

- **Correctness risk: parameter names for destructuring become unstable keys**
  - **What’s wrong:** `paramName = nameNode.getText(...)` yields `{a,b}` patterns.
  - **Why it matters:** mapping param types to `docmeta.params` (identifier list) becomes inconsistent.
  - **Suggested fix:** normalize destructuring param names or store them as positional types.

- **Performance gap: no strategy for very large files / projects**
  - **What’s wrong:** building a TS program and scanning symbols can be expensive, with no "huge file" fallback.
  - **Why it matters:** tooling can dominate indexing time in large monorepos.
  - **Suggested fix:** implement guardrails (max file size, max node count) and/or incremental project service caching.

---

## `src/index/tooling/pyright-provider.js`

- **Correctness risk: diagnostics collection is timing-dependent**
  - **What’s wrong:** relies on LSP `publishDiagnostics` notifications arriving before shutdown, with no explicit wait.
  - **Why it matters:** diagnostic coverage can be incomplete/non-deterministic.
  - **Suggested fix:** add a short post-open wait/drain mechanism or request-based diagnostics collection.

- **Encoding/offset risk: files are read as UTF-8 without using the project’s encoding detection**
  - **What’s wrong:** `fs.readFile(...,'utf8')` is used for offsets.
  - **Why it matters:** offsets may not align with chunk bounds for non-UTF8 files.
  - **Suggested fix:** reuse the shared decoding path used during chunking.

---

## `src/index/tooling/clangd-provider.js`

- **Key collision risk: type maps are keyed by `file::name`**
  - **What’s wrong:** collisions overwrite types for duplicate symbol names.
  - **Why it matters:** wrong types can be attached to chunks.
  - **Suggested fix:** key by chunkId or include range.

- **Encoding/offset risk: uses UTF-8 reads for offset math**
  - **What’s wrong:** same as Pyright provider.
  - **Why it matters:** symbol range mapping can fail or attach to wrong chunk.
  - **Suggested fix:** reuse shared decoding.

---

## `src/index/tooling/sourcekit-provider.js`

- **Key collision + encoding risks mirror the clangd provider**
  - **What’s wrong:** `file::name` keys and UTF-8 reads.
  - **Why it matters:** incorrect attachment in edge cases (duplicates/non-UTF8).
  - **Suggested fix:** key by chunkId; reuse shared decode.

---

## `src/index/constants.js`

- **Limiter: default skip lists are aggressive and can hide important repo context**
  - **What’s wrong:** skipping `package.json`, `package-lock.json`, and broad directories like `build/` and `dist/`.
  - **Why it matters:** dependency understanding and build system search can degrade; some repos keep real source under `build/`.
  - **Suggested fix:** move to a tiered default (safe vs aggressive) and expose a clear configuration override with diagnostics about what was skipped.

---

# Coverage note

Files reviewed were selected for impact (indexing pipeline, segmentation, language analysis, tooling providers, metadata normalization, and risk analysis). Many modules (UI, map rendering, retrieval ranking internals, storage backends) were not deeply audited here.

If you want a second pass, the next most valuable targets are:

- Retrieval ranking + result shaping (verbosity controls, JSON output pruning)
- Index state + piece manifest invariants (especially with incremental indexing)
- Optional-deps / install scripts (clangd/sourcekit/pyright acquisition flows)
- Multi-repo/federation and cache key correctness
