# Static Review Findings: Integrations + Map (Targeted Sweep)

This report statically reviews **only** the following files from the attached repo snapshot:

- `src/integrations/core/index.js`
- `src/integrations/core/status.js`
- `src/integrations/mcp/defs.js`
- `src/integrations/mcp/protocol.js`
- `src/integrations/tooling/lsp/client.js`
- `src/integrations/tooling/lsp/positions.js`
- `src/integrations/tooling/lsp/symbols.js`
- `src/integrations/tooling/providers/lsp.js`
- `src/integrations/tooling/providers/shared.js`
- `src/integrations/triage/index-records.js`
- `src/integrations/triage/normalize/aws-inspector.js`
- `src/integrations/triage/normalize/dependabot.js`
- `src/integrations/triage/normalize/generic.js`
- `src/integrations/triage/normalize/helpers.js`
- `src/integrations/triage/record-utils.js`
- `src/integrations/triage/render.js`
- `src/map/build-map.js`
- `src/map/constants.js`
- `src/map/dot-writer.js`
- `src/map/html-writer.js`
- `src/map/isometric-viewer.js`
- `src/map/isometric/client/controls.js`
- `src/map/isometric/client/defaults.js`
- `src/map/isometric/client/dom.js`
- `src/map/isometric/client/edges.js`
- `src/map/isometric/client/layout-utils.js`
- `src/map/isometric/client/layout.js`
- `src/map/isometric/client/map-data.js`
- `src/map/isometric/client/materials.js`
- `src/map/isometric/client/meshes.js`

The focus is on **bugs, mis-implementations, correctness gaps, and configuration/contract drift**. No code changes are made here—only findings and concrete suggestions.

---

## Executive summary (highest-leverage issues)

### Medium

1) **Two-stage indexing queue uses embeddings queue config namespace**
- **Where:** `src/integrations/core/index.js` (two-stage background enqueue)
- **What:** Stage2 background jobs are enqueued using `userConfig.indexing.embeddings.queue.dir` and `maxQueued`.
- **Impact:** Confusing configuration semantics; risks unintended coupling (embeddings queue size limits throttling stage2 indexing), and reduces operator clarity.
- **Suggestion:** Give two-stage indexing its own queue config keys (or a shared `indexing.queue.*` that both can use explicitly), and include “effective queue config” in `config_status` output.

2) **MCP tool schema appears richer than the core CLI arg builder supports**
- **Where:**
  - Schema lists many filters in `src/integrations/mcp/defs.js` (`type`, `author`, `import`, `calls`, `signature`, …)
  - Core `buildSearchArgs()` in `src/integrations/core/index.js` only maps a small subset
- **Impact:** Depending on how MCP server wiring is implemented (not in this review scope), there is a risk that MCP accepts inputs that don’t actually influence search execution.
- **Suggestion:** Ensure one of these is true:
  - MCP server translates schema fields → CLI flags explicitly (and tests it), OR
  - Reduce schema to what is actually honored, OR
  - Expand `buildSearchArgs()` to cover the schema.

3) **Map member identity collisions likely for repeated names inside a file**
- **Where:** `src/map/build-map.js` (`buildSymbolId()` returns `${file}::${name}` for most named symbols)
- **Impact:** Overloads / same-name functions / methods / nested symbols can collapse into one node, distorting edges and per-member metadata (types, risk, dataflow).
- **Suggestion:** Use a more collision-resistant ID:
  - incorporate `startLine` (and maybe `endLine`) into IDs for named symbols, or
  - incorporate container/class name when available, or
  - use chunk IDs consistently when present.
  Also add a warning counter: “mergedSymbolsDueToCollision”.

4) **Isometric viewer has minimal JSON/error handling; one malformed payload breaks the UI entirely**
- **Where:** `src/map/isometric/client/dom.js`
- **What:** `JSON.parse` on `#map-data` and `#viewer-config` has no try/catch; missing DOM nodes throw.
- **Impact:** A truncated or invalid map JSON yields a blank viewer with a console error.
- **Suggestion:** Catch parse errors and render a minimal in-page error state with actionable steps (e.g., “map-data missing”, “JSON invalid”, “file too large”).

---

## Detailed findings by file

### `src/integrations/tooling/lsp/client.js`

**A) Potentially over-aggressive error policy**
- Parser error handler kills the process immediately.
- For transient framing issues, this is fine; for partial reads or server logs on stdout, it can produce cascading failures.
- **Recommendation:** verify that the framing parser cannot be desynchronized by non-protocol stdout writes (some servers misbehave). Consider running servers with stdio separation or strict mode.

### `src/integrations/tooling/providers/lsp.js`

**A) LanguageId coverage is narrow (medium)**
- `languageIdForFileExt()` returns `plaintext` for many languages.
- If this provider is later used for Go/Rust/Java/etc, it will silently underperform.
- **Recommendation:** Either:
  - infer languageId from the configured LSP server type, or
  - expand extension mapping to all supported languages, or
  - allow per-provider override.

**B) Symbol → chunk mapping can fail for multi-chunk symbols**
- `findChunkForOffsets()` requires the symbol range to fit within a single chunk.
- Large symbols spanning chunk boundaries will be dropped.
- **Recommendation:** if a symbol overlaps multiple chunks, choose the chunk containing `selectionRange.start` (or split).

**C) Signature extraction is heuristic and potentially brittle**
- `extractClikeSignature()`, `extractSwiftSignature()` etc are regex/split-based.
- **Recommendation:** Prefer LSP-native requests when available:
  - `textDocument/signatureHelp` at a callsite,
  - `textDocument/hover` / semantic tokens,
  - server-specific extensions.

**D) Keying type results by `file::name` is collision-prone**
- Stored as `typesByChunk.set(`${target.file}::${target.name}`, ...)`.
- **Recommendation:** prefer chunkId or include range.

### `src/integrations/tooling/providers/shared.js`

**A) Circuit breaker counts failures per retry attempt (medium)**
- `consecutiveFailures++` is incremented on every failed attempt (including retries).
- A single call can trip the breaker.
- **Recommendation:** count per *invocation* (after all retries exhausted), or keep two counters (attempt failures vs invocation failures).

**B) Merge semantics are “first truthy wins” and can hide conflicts**
- `mergeToolingEntry()` only fills missing fields, never resolves disagreements.
- **Recommendation:** track provenance (provider name + confidence), or store multiple signatures/types with scores.

### `src/integrations/tooling/lsp/positions.js`

**A) UTF-16 vs codepoint offset risk (medium)**
- LSP positions are specified in UTF-16 code units.
- `positionToOffset()` uses `lineColToOffset()` from shared utilities.
- **Risk:** If `lineColToOffset()` interprets “character” as Unicode codepoints or bytes, offsets will be wrong for non-ASCII.
- **Recommendation:** explicitly document/ensure offsets are computed using UTF-16 code unit indexing, matching LSP.

### `src/integrations/tooling/lsp/symbols.js`

**A) SymbolInformation flattening drops URI (low/medium depending on usage)**
- `flattenSymbolInformation()` includes no `uri`.
- If used for `workspace/symbol` results, downstream cannot map results to files.
- **Recommendation:** include `symbol.location.uri` when present.

### `src/integrations/core/index.js`

**A) Stage2 background queue config uses embeddings queue keys (medium)**
- Two-stage indexing enqueues Stage2 using `indexing.embeddings.queue.*` keys.
- **Recommendation:** separate queue namespaces or share explicitly with a `queue.kind` mechanism.

**B) `buildSearchArgs()` coverage vs MCP schema (medium)**
- Only maps a subset of filters.
- **Recommendation:** if this is intended as shared arg builder, expand coverage or constrain schemas.

**C) Minor code hygiene: indentation suggests accidental drift (low)**
- `buildSearchArgs` is oddly indented; not a functional bug, but a signal for lint drift.

### `src/integrations/core/status.js`

**A) Potentially expensive recursive size computation (medium)**
- `sizeOfPath()` recursively scans directories and sums file sizes; `includeAll` can traverse many repos.
- **Recommendation:** add a cap/timeout, or return partial results with a “truncated” flag.

**B) Output field naming may be confusing (low)**
- Payload uses `repo.root` but sets it to `repoCacheRoot`.
- **Recommendation:** include both `repoRoot` and `repoCacheRoot` explicitly.

### `src/integrations/mcp/defs.js`

**A) Schema likely over-promises without enforcement (medium)**
- Schema defines many search filters.
- Without explicit translation tests, it’s easy for MCP to accept inputs that do nothing.
- **Recommendation:** Add MCP conformance tests:
  - each schema field should cause an observable change in emitted CLI args or in result filtering.

**B) Missing knobs exposed elsewhere (low/medium)**
- Core supports `annBackend` (`--ann-backend`), but schema doesn’t expose it.
- **Recommendation:** either intentionally hide it or add it.

### `src/integrations/mcp/protocol.js`

**A) Minor doc-comment mismatch (low)**
- `sendError()` docstring does not mention `data` although function supports it.
- **Recommendation:** keep comments consistent.

### `src/integrations/triage/index-records.js`

**A) Path normalization inconsistencies can misclassify triage vs non-triage (medium)**
- `recordsDir` can be relative; `absPath.startsWith(recordsDir)` then depends on path style.
- **Recommendation:** normalize `recordsDir` to an absolute, normalized form before comparisons.

**B) Embedding text selection may be suboptimal (design consideration)**
- Uses `embedText = docmeta.doc || text`.
- If `docmeta.doc` is short, embeddings may lack context; if `text` is huge, embeddings cost rises.
- **Recommendation:** for records, embed a bounded “summary + key fields + first N lines” representation.

### `src/integrations/triage/normalize/dependabot.js`

**A) References normalization may be shallow (low/medium)**
- Uses arrays of strings; might want normalized objects with URLs + labels.

### `src/integrations/triage/normalize/generic.js`

**A) `record.vuln.references` normalization ignores object forms (medium)**
- Uses `normalizeStringArray` not `normalizeReferences`.
- If input uses `{ url, title }` objects, URLs may be lost.
- **Recommendation:** use helper normalization that preserves URLs.

### `src/integrations/triage/normalize/helpers.js`

**A) `ensureRecordId()` fallback uses `JSON.stringify` of raw objects (medium)**
- `JSON.stringify` property order can vary in some scenarios.
- **Recommendation:** use a stable canonicalization (sorted keys) before hashing, or derive stableKey from explicit fields.

### `src/integrations/triage/record-utils.js`

- No correctness bugs found in isolation; appears straightforward.

### `src/integrations/triage/render.js`

**A) Potentially huge raw payload rendering (low/medium)**
- Renders `record.raw` via JSON.stringify; can be enormous.
- **Recommendation:** truncate or gate behind a flag (or show summary only).

### `src/map/constants.js`

### `src/map/build-map.js`

**A) Member ID collisions (medium)**
- See executive summary.

**C) Call edges built from `chunk.codeRelations.calls` assume tuple shape (medium)**
- `buildEdgesFromCalls()` expects each entry to be an array where `entry[1]` is the target name.
- If `calls` are stored as strings or as `{ target, ... }` objects, edges will silently drop.
- **Recommendation:** support multiple call-link encodings, or validate/trace drops.

**D) CallSummaries are emitted as `dataflow` edges (design drift risk)**
- `buildEdgesFromCallSummaries()` uses `type: 'dataflow'` for call summaries.
- **Risk:** viewer semantics (edge colors/weights/filters) may treat call edges differently than dataflow.
- **Recommendation:** consider explicit `callsite` or `callSummary` edge type.

### `src/map/dot-writer.js`

**A) DOT escaping is partial (low/medium)**
- `escapeDot()` escapes quotes and newlines, but not all DOT-reserved sequences.
- **Recommendation:** treat as acceptable for internal use; if exposed broadly, harden escaping.

### `src/map/html-writer.js`

**A) Untrusted SVG injection risk (low/medium)**
- Embeds raw SVG string into HTML.
- If the SVG is generated from untrusted sources, this can lead to script injection.
- **Recommendation:** treat output as local/offline; otherwise sanitize SVG.

### `src/map/isometric-viewer.js`

**A) Hard-coded script URL paths (medium)**
- Uses absolute paths like `/isomap/viewer.js` and `/three/three.module.js`.
- **Impact:** breaks when opened as a standalone file.
- **Recommendation:** support a relative “bundle mode”, or accept a configurable base URL.

### `src/map/isometric/client/dom.js`

**A) Missing error handling for missing DOM/invalid JSON (medium)**
- See executive summary.

**B) Config merge is shallow (low/medium)**
- Nested objects are shallow-merged; partial overrides can unintentionally discard defaults.
- **Recommendation:** implement a small deep-merge for known nested sections.

### `src/map/isometric/client/edges.js`

**A) Routing/collision system is computationally expensive in borderline cases (medium)**
- Obstacle-aware routing checks many segments against many obstacles.
- **Recommendation:**
  - keep existing fast-mode cutoff,
  - pre-index obstacles in a grid to prune checks,
  - cap routing attempts per edge and record “unroutable” counts.

**B) Edge aggregation loses member-level information (expected, but clarify semantics) (low/medium)**
- In fast mode, edges are collapsed at file-level.
- **Recommendation:** annotate aggregated edges with `aggregated: true` and include the number of collapsed edges.

### `src/map/isometric/client/layout-utils.js`

**A) Force-layout stability depends on item sizing inputs (low/medium)**
- Layout uses repulsion/attraction constants; extreme node sizes could cause oscillation.
- **Recommendation:** cap max forces or normalize weights.

### `src/map/isometric/client/layout.js`

**A) Potential undefined groupKey mapping (low)**
- `groupKeyByFile.set(node.path, key)` assumes `node.path` exists.
- **Recommendation:** guard or fall back to `node.name`.

### `src/map/isometric/client/map-data.js`

**A) First-wins behavior for name-based member keys (low/medium)**
- `memberByKey` stores `nameKey` only if not present; collisions keep the first entry.
- **Recommendation:** store arrays for ambiguous name keys, or prefer rangeKey always.

### `src/map/isometric/client/materials.js`

- No correctness bugs found in isolation.
- Minor robustness suggestions: add `onError` handler for texture loads.

### `src/map/isometric/client/meshes.js`

**A) Label texture/material lifecycle (low)**
- Many labels create textures/materials; no explicit disposal.
- **Recommendation:** acceptable for single-load viewer; for live reload, add disposal paths.

---

## Suggested next steps (non-code)

1) Add minimal regression tests around the critical issues:
- Records indexing docmeta coverage when `record === null` but `recordMeta` exists.
- CVSS score 0 preservation.

2) Add lightweight “drop counters” to map building:
- number of call edges skipped due to unknown encoding,
- number of symbols merged due to ID collision,
- number of members without range.

3) Document the “contracts” explicitly:
- MCP schema ↔ CLI flags mapping.
