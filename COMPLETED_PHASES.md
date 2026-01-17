# Completed Phases

Phases 1-4 were completed during the initial Sublime Text plugin and map rollout. Phases 11-12 and 14-15 were completed as the cache/perf and optional-deps groundwork.

## Phase 1 — Sublime Text 3 Plugin Foundation (Parity + Plumbing)

### 1.1 Plugin repo structure + packaging

* [x] Create `sublime/PairOfCleats/` package skeleton:

  * [x] `PairOfCleats.py` (entrypoint)
  * [x] `commands/` (command modules)
  * [x] `lib/` (helpers: config, subprocess, parsing, caching)
  * [x] `messages/` (install/upgrade notes)
  * [x] `Default.sublime-commands`
  * [x] `Main.sublime-menu` (optional)
  * [x] `Default.sublime-keymap` (optional)
* [x] Add `README.md` for ST3 plugin installation + prerequisites
* [x] Add “Package Control” compatibility notes (no external deps beyond Node runtime + repo binaries)

### 1.2 Node/CLI discovery + execution contract

* [x] Implement robust “pairofcleats binary discovery”:

  * [x] Prefer project-local `node_modules/.bin/pairofcleats` when available
  * [x] Fallback to global `pairofcleats` on PATH
  * [x] Allow explicit override in ST settings: `pairofcleats_path`
* [x] Implement repo-root detection:

  * [x] Prefer `.pairofcleats.json` location
  * [x] Fallback to `.git` root
  * [x] Fallback to folder of active file
* [x] Implement subprocess wrapper:

  * [x] Streams output to Sublime panel
  * [x] Captures JSON payloads when `--json` is used
  * [x] Supports cancellation (best-effort)
  * [x] Adds stable environment injection (cache root, embeddings mode, etc.)

### 1.3 Settings + per-project overrides

* [x] Add `PairOfCleats.sublime-settings` defaults:

  * [x] `pairofcleats_path`, `node_path`
  * [x] `index_mode_default` (code/prose/both)
  * [x] `search_backend_default` (memory/sqlite-fts/etc)
  * [x] `open_results_in` (quick_panel / new_tab / output_panel)
* [x] Support `.sublime-project` settings overrides
* [x] Validate config and surface actionable error messages

### 1.4 Smoke tests (plugin-side)

* [x] Add Python unit tests that:

  * [x] Import plugin modules without Sublime runtime (mock `sublime`, `sublime_plugin`)
  * [x] Validate binary discovery behavior
  * [x] Validate repo-root resolution on fixtures
  * [x] Validate settings overlay precedence

---


## Phase 2 — Sublime Search UX (Queries, Results, Navigation)

### 2.1 Search command(s)

* [x] `PairOfCleats: Search` command:

  * [x] Prompt input panel for query
  * [x] Optional toggles: code/prose/both, backend, limit
  * [x] Execute `pairofcleats search ... --json`
* [x] `PairOfCleats: Search Selection` command:

  * [x] Uses selected text as query
* [x] `PairOfCleats: Search Symbol Under Cursor` command

### 2.2 Results presentation

* [x] Quick panel results:

  * [x] Show `file:line-range`, symbol name, snippet/headline, score
  * [x] Preserve stable ordering for repeatability
* [x] On selection:

  * [x] Open file at best-effort location (line/column)
  * [x] Highlight match range (if available)
* [x] Add optional “results buffer” view (for large result sets)

### 2.3 Quality-of-life UX

* [x] Query history (per project)
* [x] “Repeat last search” command
* [x] “Explain search” (if supported by CLI flags / internal explain output)

### 2.4 Tests

* [x] Add Node-level “search contract” tests:

  * [x] Ensure `--json` output parseability and required fields
* [x] Add plugin tests:

  * [x] Search command dispatches correct subprocess args
  * [x] Results parsing tolerates partial/missing optional fields

---


## Phase 3 — Index Lifecycle in Sublime (Build/Watch/Validate + Status)

### 3.1 Build index commands

* [x] `PairOfCleats: Index Build (Code)`
* [x] `PairOfCleats: Index Build (Prose)`
* [x] `PairOfCleats: Index Build (All)`
* [x] Stream progress to an output panel
* [x] Persist “last index time” + “last index mode” in project cache

### 3.2 Watch mode integration

* [x] `PairOfCleats: Index Watch Start`
* [x] `PairOfCleats: Index Watch Stop`
* [x] Prevent duplicate watchers per window/project
* [x] Robust shutdown on Sublime exit / project close

### 3.3 Validate + repair affordances

* [x] `PairOfCleats: Index Validate`
* [x] Surface actionable failures (missing artifacts, invalid JSON, stale manifests)
* [x] Provide “Open index directory” convenience command

### 3.4 Tests

* [x] Node tests for index build/validate on fixtures
* [x] Plugin tests for lifecycle commands and watcher gating

---


## Phase 4 — Codebase Semantic Map (Imports/Exports/Calls/Dataflow/Control Flow → Visual Map)

### What this phase delivers

A **real codebase map** that uses existing and enriched semantic metadata to generate a **diagram-ready model** and one or more **rendered artifacts**.

It must explicitly incorporate and visualize:

* **Imports / Exports / ImportLinks**
* **Calls / CallLinks / CallSummaries**
* **Usages / UsageLinks**
* **Signature / Modifiers / Params / Returns**
* **Reads / Writes / Mutates / Aliases**
* **Control flow** (branches, loops, throws, awaits, yields, returns)
* **AST-derived semantics** (using what the indexer already extracts)

#### Visual grammar (required characteristics)

* **File = outer shape**

  * Shape varies by file type/category (source/test/config/doc/generated/etc.)
* **Functions/classes = content inside the file shape**

  * The “fill” of the file node is structurally subdivided to represent contained functions/classes
* **Function details = nested sub-shapes inside function area**

  * Small badges/segments represent modifiers/returns/dataflow/control-flow
* **Multiple line styles = multiple edge semantics**

  * Imports (file→file), control flow calls (fn→fn), usage deps (fn→fn), dataflow (arg/return/state)

---

### 4.1 Inventory + normalize available semantics from existing artifacts

Leverage what is already produced today, and formalize how it’s consumed:

* [x] **Inputs** (expected present after `index build`):

  * [x] `file_relations.json` (imports, exports, usages, importLinks, functionMeta/classMeta)
  * [x] `repo_map.json` (chunk-level symbol map, exported flag, signatures)
  * [x] `chunk_meta.json` (docmeta/metaV2: signature/modifiers/returns/controlFlow/dataflow + relations)
  * [x] `graph_relations.json` (importGraph/callGraph/usageGraph)
* [x] Define “canonical IDs” used across the map:

  * [x] `fileId = <repo-relative path>`
  * [x] `symbolId = <file>::<symbolName>` (already used in relation graphs)
  * [x] Stable IDs for anonymous/lambda cases (fallback: chunkId when name is `(anonymous)`)

---

### 4.2 Define a versioned “Map Model” schema (diagram-ready)

This is the core contract the plugin will consume.

* [x] Create `docs/map-schema.json` (or similar) with:

  * [x] `version`
  * [x] `generatedAt`
  * [x] `root` (repo root logical id)
  * [x] `legend`:

    * [x] `nodeTypes` (file/function/class/symbol)
    * [x] `fileShapes` mapping (category → shape)
    * [x] `functionBadges` mapping (modifier/returns/dataflow/control-flow → badge glyph)
    * [x] `edgeTypes` mapping (imports/calls/usages/dataflow/aliases/mutations)
    * [x] `edgeStyles` mapping (solid/dashed/dotted/double, arrowheads, labels)
  * [x] `nodes`:

    * [x] file nodes with nested “members” (functions/classes)
    * [x] function nodes with structured “semantic facets”
  * [x] `edges` (typed, labeled, optionally “port-addressable”)
* [x] Schema must support **hierarchical nesting**:

  * [x] File node has `members[]` with per-member ports
  * [x] Member nodes (functions) include `signature`, `modifiers`, `returns`, `controlFlow`, `dataflow`
* [x] Determinism requirements:

  * [x] Stable ordering (sort keys/ids)
  * [x] Explicit timestamp field allowed, but everything else must be deterministic

---

### 4.3 Build the semantic “map extractor” (core engine tool)

Implement a Node tool that reads index artifacts and produces the map model.

* [x] Add `tools/code-map.js` (or `tools/report-code-map.js`) that:

  * [x] Locates repo + index dirs using existing `tools/dict-utils.js`
  * [x] Loads:

    * [x] `file_relations.json`
    * [x] `repo_map.json`
    * [x] `chunk_meta.json` (or minimal subset)
    * [x] `graph_relations.json`
  * [x] Merges into a single “map model”:

    * [x] **Files** classified into categories (drives file shape)
    * [x] **Members** extracted per file:

      * [x] functions/methods/classes (from `repo_map` and/or chunk meta)
      * [x] include line ranges
      * [x] include `signature`, `modifiers`, `params`, `returns`
    * [x] **Function semantics**:

      * [x] `dataflow.reads`, `dataflow.writes`, `dataflow.mutations`, `dataflow.aliases`
      * [x] `controlFlow.branches/loops/returns/throws/awaits/yields/breaks/continues`
      * [x] `throws`, `awaits`, `yields`, `returnsValue` facets surfaced explicitly
    * [x] **Edges**:

      * [x] Import edges (file→file) from `importLinks` + raw `imports`
      * [x] Export edges (file→symbol) from `exports` + repo_map `exported`
      * [x] Call edges (fn→fn) from `callLinks` or `graph_relations.callGraph`
      * [x] Usage edges (fn→fn) from `usageLinks` or `graph_relations.usageGraph`
      * [x] Dataflow edges:

        * [x] Argument flow edges from `callSummaries.argMap` (caller→callee param ports)
        * [x] Return flow edges using inferred return metadata where available
        * [x] Optional: “state flow” edges when reads/writes/mutations overlap (guardrailed; see 28.6)
      * [x] Alias edges:

        * [x] derived from `dataflow.aliases` (function-local or cross-function via calls when resolvable)
* [x] Add CLI entrypoint:

  * [x] `pairofcleats report map` (preferred, consistent with existing `report` group), or
  * [x] `pairofcleats map` (top-level)
* [x] Support scope + size controls:

  * [x] `--scope repo|dir|file|symbol`
  * [x] `--focus <path or symbol>`
  * [x] `--include imports,calls,usages,dataflow,exports`
  * [x] `--only-exported`
  * [x] `--max-files N`, `--max-members-per-file N`, `--max-edges N`
  * [x] `--collapse file|dir` (aggregate mode)
  * [x] `--format json|dot|svg|html` (see 28.4)

---

### 4.4 Generate “shape-based” diagrams (DOT-first, with nested function fills)

To match your “shape with fill containing functions” requirement cleanly, DOT/Graphviz is the most direct representation.

* [x] Implement a DOT generator `src/map/dot-writer.js`:

  * [x] **File nodes as outer shapes** with file-type-dependent shapes:

    * [x] Source code: `box` or `component`
    * [x] Tests: `box` with distinct border style
    * [x] Config/data: `cylinder` or `hexagon`
    * [x] Docs/prose: `note`
    * [x] Generated/build artifacts: `folder` or `box3d`
  * [x] **Fill represents members** using HTML-like labels:

    * [x] Outer `<TABLE>` represents the file “container”
    * [x] Each function/class is a row with a `PORT` so edges can land on that member specifically
  * [x] **Nested shapes inside the function row** (HTML sub-tables/cells) to represent:

    * [x] modifiers: async/static/generator/visibility
    * [x] signature/params summary
    * [x] returns/returnType/returnsValue indicator
    * [x] dataflow mini-badges: reads/writes/mutates/aliases counts (and/or top N symbols)
    * [x] controlFlow mini-badges: branches/loops/throws/awaits/yields
* [x] **Edge encoding** (multiple edge “line types”):

  * [x] Import edges: dashed file→file
  * [x] Call edges: solid function→function (primary control flow)
  * [x] Usage edges: thin/secondary style function→function
  * [x] Dataflow edges:

    * [x] dotted caller→callee(param) edges (argument flow)
    * [x] dotted callee→caller edges for return flow (if inferred)
  * [x] Mutation/state edges (optional, guardrailed): double-line or distinct style
  * [x] Alias edges: dashed-dotted, labeled `alias: a=b`
* [x] Output modes:

  * [x] `--format dot` always available
  * [x] `--format svg` if Graphviz present (shell out to `dot -Tsvg`)
  * [x] `--format html` wraps SVG + legend into a standalone HTML viewer
* [x] Implement legend rendering:

  * [x] Either embed as a DOT subgraph or in HTML wrapper
  * [x] Must document shape/edge meaning for users

---

### 4.5 Sublime Text 3 plugin commands for map generation + viewing

Provide first-class UX inside Sublime, even if rendering happens externally.

* [x] Add commands:

  * [x] `PairOfCleats: Map (Repo)`
  * [x] `PairOfCleats: Map (Current Folder)`
  * [x] `PairOfCleats: Map (Current File)`
  * [x] `PairOfCleats: Map (Symbol Under Cursor)`
  * [x] `PairOfCleats: Map (Selection)`
* [x] Add a “Map Type” chooser:

  * [x] Import Map
  * [x] Call Map
  * [x] Usage/Dependency Map
  * [x] Dataflow Map (args/returns/state)
  * [x] Combined Map (guardrailed by size limits)
* [x] Implement output handling:

  * [x] Write outputs to `.pairofcleats/maps/` (repo-local) or cache dir
  * [x] Open `.dot` in Sublime for inspection
  * [x] If `.svg`/`.html` produced:

    * [x] Provide “Open in Browser” command (best-effort)
* [x] Navigation affordances:

  * [x] When a map is generated, also produce an indexable “node list” JSON:

    * [x] allows Sublime quick panel “Jump to node” (file/function)
    * [x] opens file at recorded `startLine`
* [x] Graceful degradation:

  * [x] If `astDataflow` / `controlFlow` metadata is unavailable in the index:

    * [x] show “limited map” warning
    * [x] offer action: “Rebuild index with dataflow/control-flow enabled” (invokes `index build` with the project’s config expectations)

---

### 4.6 Performance guardrails + scaling strategy (mandatory for real repos)

This phase will generate *very large graphs* unless explicitly constrained.

* [x] Hard limits with user-overrides:

  * [x] `maxFiles`, `maxMembersPerFile`, `maxEdges`
  * [x] edge sampling policies per edge type
* [x] Aggregation modes:

  * [x] Directory-level aggregation (folder nodes contain files)
  * [x] File-only map (no nested functions)
  * [x] Export-only functions view
  * [x] “Top-K by degree” (highest call/import fan-in/out)
* [x] Deterministic sampling:

  * [x] same inputs → same output (stable selection)
* [x] Cache map builds keyed by:

  * [x] index signature + generator options
* [x] Failure mode policy:

  * [x] If size exceeds limits, output a “truncated map” plus a summary explaining what was dropped

---

### 4.7 Tests (core + integration + determinism)

Add explicit automated coverage for the map feature.

#### Node tool tests (authoritative)

* [x] `tests/code-map-basic.js`

  * [x] Build a tiny fixture repo with:

    * [x] imports/exports
    * [x] functions calling other functions
    * [x] a function with reads/writes/mutations/aliases
    * [x] a function with branches/loops/throws/awaits
  * [x] Run `build_index.js --stub-embeddings`
  * [x] Run `pairofcleats report map --format json`
  * [x] Assert:

    * [x] file nodes exist
    * [x] member nodes include `signature/modifiers/returns/dataflow/controlFlow`
    * [x] edge sets include imports + calls
* [x] `tests/code-map-dot.js`

  * [x] Generate DOT output
  * [x] Assert:

    * [x] file “container” nodes exist
    * [x] function rows/ports exist
    * [x] edges connect to ports (caller fn → callee fn)
    * [x] distinct edge styles appear for import vs call vs dataflow
* [x] `tests/code-map-determinism.js`

  * [x] Run map generation twice and compare outputs (ignore `generatedAt`)
* [x] `tests/code-map-guardrails.js`

  * [x] Generate a repo with many dummy functions
  * [x] Ensure truncation behavior is correct and stable

#### Plugin-side tests

* [x] Python unit tests:

  * [x] command registration exists
  * [x] subprocess args are correct for each map command
  * [x] output paths computed correctly
  * [x] “Graphviz missing” fallback behavior (DOT-only) works



### 4.8 Isometric map viewer (three.js)

* [x] Generate an isometric HTML viewer from the map model (three.js module import)
* [x] Support zoom with configurable sensitivity
* [x] Support WASD movement with configurable sensitivity/acceleration/drag
* [x] Highlight selections and show file/line metadata
* [x] Double-click opens the selected file/line via a URI template
* [x] Add layout styles (clustered/radial/flat) with adjustable spacing
* [x] Add flow-connected highlighting (edges + related nodes) and hover highlights from the selection panel
* [x] Add grid line rendering + glow, fog, and wireframe tuning (panel configurable)
* [x] Modularize the isometric viewer client into <500-line modules
---

## Phase 11 — Resource Lifecycle Management (Caches, Long-Lived Servers, Builds)

**Objective:** Prevent memory and resource leaks in long-running processes (API server, service workers), especially across repeated builds and multi-repo usage.

1. **Add eviction/TTL for API router repo-level caches**

   * [x] **Implement eviction for `repoCaches` map in `tools/api/router.js`.**

     * **Why:** `repoCaches` can grow unbounded if clients query multiple repos or if repo roots vary. Each entry can hold heavy caches (index cache + sqlite connections).
     * **Fix:**

       * Add:

         * `maxRepos` (e.g., 3–10)
         * `repoTtlMs` (e.g., 10–30 minutes)
       * Track `lastUsed` and evict least-recently-used / expired.
       * On eviction: close sqlite cache handles (`sqliteCache.close()`), clear index cache.
   * [x] Add metrics for cache size and evictions.

     * **Where:** `tools/api/router.js` and metrics registry.

2. **Add eviction for per-repo index cache and sqlite DB cache**

   * [x] **Index cache eviction**

     * **Why:** `src/retrieval/index-cache.js` caches by `dir` (which can change per build). On repeated re-indexing, old build directories can accumulate.
     * **Fix:** Convert to LRU with max entries, or TTL purge on access.
   * [x] **SQLite DB cache eviction**

     * **Where:** `src/retrieval/sqlite-cache.js`
     * **Why:** Same “dir-per-build” key pattern; can leak connections/handles.
     * **Fix:** LRU/TTL + ensure `close()` called on eviction.

3. **Add explicit cache invalidation when “current build” pointer changes**

   * [x] Detect when the effective index directory changes (new build) and prune caches for previous builds.

     * **Why:** Keeps hot caches relevant and bounds memory footprint.

**Exit criteria**

* [x] API server memory does not grow unbounded when indexing/searching multiple repos/builds.
* [x] Old build caches are evicted/pruned automatically.
* [x] SQLite handles are closed on eviction (verified via tests or instrumentation).

---

## Phase 12 — Performance and Operational Hardening

**Objective:** Improve throughput and robustness under load without changing core behavior.

1. **Reduce event-loop blocking sync filesystem calls on API request paths**

   * [x] Replace `fsSync.*` in API request hot paths with async equivalents where practical.

     * **Why:** Sync I/O can stall concurrent requests in the API server process.
     * **Where (examples):**

       * `tools/api/router.js` `resolveRepo()` uses `existsSync/statSync`.
     * **Fix:** Use `fs.promises.stat` with try/catch; cache results briefly if needed.

2. **Prevent decompression “zip bomb” style memory spikes in artifact reading**

   * [x] Add output size limiting to gzip decompression.

     * **Why:** `src/shared/artifact-io.js` uses `gunzipSync(buffer)` and only checks decompressed size *after* decompression. A small compressed file could expand massively and spike memory.
     * **Fix:**

       * Use `zlib.gunzipSync(buffer, { maxOutputLength: maxBytes + slack })` (if supported in your Node target), or switch to streaming gunzip with explicit byte limits.
     * **Where:** `src/shared/artifact-io.js` `parseBuffer` / gzip handling.

3. **Add download size limits for tools that fetch large remote assets**

   * [x] Enforce maximum download size (or require hash) for dictionary downloads.

     * **Why:** `tools/download-dicts.js` buffers the entire response in memory (`Buffer.concat`) without a hard cap.
     * **Fix:** Stream to disk with a cap; abort if exceeded; strongly prefer requiring hashes for non-default URLs.

**Exit criteria**

* [x] API request path avoids avoidable sync I/O.
* [x] Artifact gzip parsing cannot explode memory beyond configured limits.
* [x] Large downloads are bounded and/or verified.

---

## Phase 14 — Optional-dependency framework + capability registry (foundation for all phases)

### 14.1 Introduce a consistent “optional dependency” loader

* [x] Add `src/shared/optional-deps.js` with a single, opinionated API:

  * [x] `tryRequire(name)` / `tryImport(name)` helpers (use `createRequire(import.meta.url)` where needed)
  * [x] Standardized return shape: `{ ok: true, mod } | { ok: false, error, reason }`
  * [x] Standardized logging hook (only when `PAIROFCLEATS_VERBOSE` or a dedicated flag is enabled)
* [x] Add `src/shared/capabilities.js` that reports runtime availability:

  * [x] `watcher: { chokidar: true, parcel: boolean }`
  * [x] `regex: { re2: boolean, re2js: true }`
  * [x] `hash: { nodeRsXxhash: boolean, wasmXxhash: true }`
  * [x] `compression: { gzip: true, zstd: boolean }`
  * [x] `extractors: { pdf: boolean, docx: boolean }`
  * [x] `mcp: { sdk: boolean, legacy: true }`
  * [x] `externalBackends: { tantivy: boolean, lancedb: boolean }` (even if “boolean” means “reachable” rather than “installed”)
* [x] Wire capabilities into existing “status” surfaces:

  * [x] Extend `tools/mcp/repo.js` → `configStatus()` to include capability info and warnings for requested-but-unavailable features
  * [x] Extend `tools/config-dump.js` (or equivalent) to print capabilities in JSON output mode

### 14.2 Add config + env “backend selectors” (uniform UX)

* [x] Extend `src/shared/env.js` to parse new selectors (string + allowlist):

  * [x] `PAIROFCLEATS_WATCHER_BACKEND` = `auto|chokidar|parcel`
  * [x] `PAIROFCLEATS_REGEX_ENGINE` = `auto|re2|re2js`
  * [x] `PAIROFCLEATS_XXHASH_BACKEND` = `auto|native|wasm`
  * [x] `PAIROFCLEATS_COMPRESSION` = `auto|gzip|zstd|none`
  * [x] `PAIROFCLEATS_DOC_EXTRACT` = `auto|on|off`
  * [x] `PAIROFCLEATS_MCP_TRANSPORT` = `auto|sdk|legacy`
* [x] Add parallel config keys in `.pairofcleats.json` (keep them near existing related config blocks):

  * [x] `indexing.watch.backend`
  * [x] `search.regex.engine`
  * [x] `indexing.hash.backend`
  * [x] `indexing.artifactCompression.mode` enum expansion + `auto`
  * [x] `indexing.documentExtraction.enabled`
  * [x] `mcp.transport`
* [x] Update `docs/config-schema.json`:

  * [x] Add/expand enums (avoid “free string” for anything that’s meant to be policy-controlled)
  * [x] Add descriptions that clarify fallback rules (`auto` behavior)
* [x] Update any config validation code paths if they enforce known keys (`src/config/validate.js` is schema-driven; keep schema authoritative)

### 14.3 Add dependency-bundle reference stubs (keeps repo documentation consistent)

For each new dependency introduced in later phases, add a minimal doc file under:
`docs/references/dependency-bundle/deps/<dep>.md`

* [x] `parcel-watcher.md`
* [x] `re2.md`
* [x] `node-rs-xxhash.md`
* [x] `mongodb-js-zstd.md`
* [x] `pdfjs-dist.md`
* [x] `mammoth.md`
* [x] `modelcontextprotocol-sdk.md`
* [x] `lancedb.md` (if used)
* [x] `tantivy.md` (if used)
* [x] Update `docs/references/dependency-bundle/README.md` if it has an index

### 14.4 Tests (framework-level)

* [x] Add `tests/capabilities-report.js`:

  * [x] Asserts `capabilities` object shape is stable
  * [x] Asserts `auto` selectors never throw when optional deps are missing
* [x] Add a script-coverage action to run it:

  * [x] `tests/script-coverage/actions.js`: add action entry that calls `runNode(...)`
  * [x] (Optional) Add an npm script alias if you want parity with the rest of the repo scripts

**Exit criteria**

* [x] All “capability” calls are side-effect-free and safe when optional deps are absent
* [x] `config_status` (MCP) can surface “you requested X but it’s not available” warnings without crashing
* [x] CI passes on Node 18 (Ubuntu + Windows lanes)

---

## Phase 15 — File watching performance: add `@parcel/watcher` backend (keep chokidar fallback)

### 15.1 Add the dependency (prefer optional unless you want it guaranteed everywhere)

* [x] Add `@parcel/watcher` to `package.json`

  * [x] Prefer `optionalDependencies` if you want installs to succeed even when native builds fail
  * [x] If you add it as a hard dependency, ensure Windows CI remains green

### 15.2 Create a watcher-backend abstraction

* [x] Create `src/index/build/watch/backends/types.js` (or inline JSDoc contract) describing:

  * [x] `start({ root, ignored, onEvent, onError, pollMs? }) -> { close(): Promise<void> }`
  * [x] Normalized event shape: `{ type: 'add'|'change'|'unlink', absPath }`
* [x] Extract chokidar wiring out of `src/index/build/watch.js`:

  * [x] Move into `src/index/build/watch/backends/chokidar.js`
  * [x] Preserve existing semantics (`awaitWriteFinish`, ignored matcher, poll support)
* [x] Implement parcel watcher backend:

  * [x] New file: `src/index/build/watch/backends/parcel.js`
  * [x] Map parcel events to the normalized `{type, absPath}` model
  * [x] Decide how to handle rename/move (often appears as unlink+add):

    * [x] If parcel reports rename, still emit unlink+add for compatibility with current scheduling
  * [x] Implement “poll” behavior:

    * [x] If poll mode is requested, either:

      * [x] force chokidar with polling, **or**
      * [x] implement a cheap stat-based poller wrapper (only if needed)
  * [x] Implement “write stability” guard:

    * [x] Chokidar has `awaitWriteFinish`; parcel does not in the same way
    * [x] Add a “stabilize file” check in the pipeline: before processing a file, optionally confirm `mtime/size` stable across N ms
    * [x] Place this in `createDebouncedScheduler()` or immediately before `enqueueOrUpdate()` in `file-processor.js` (prefer a single shared guard)

### 15.3 Wire selection into `watchIndex()`

* [x] Update `src/index/build/watch.js`:

  * [x] Choose backend via (in order): CLI/config → env → `auto` capability
  * [x] Log selected backend once at startup (only if verbose or `--watch`)
  * [x] Ensure `pollMs` is still honored (either by backend or by selection logic)

### 15.4 Tests

* [x] Add `tests/watch-backend-selection.js`:

  * [x] Forces `PAIROFCLEATS_WATCHER_BACKEND=chokidar` and asserts no parcel import occurs
  * [x] Forces `...=parcel` and asserts fallback behavior if module unavailable (no crash, warning path)
* [x] Add `tests/watch-stability-guard.js`:

  * [x] Simulate “partial write” (write file in two chunks with delay) and assert processor waits/defers correctly
  * [x] Keep the test deterministic: use explicit timeouts and a temp directory under `tests/.cache`
* [x] Add corresponding script-coverage actions in `tests/script-coverage/actions.js`

**Exit criteria**

* [x] `pairofcleats index watch` remains correct on Windows and Linux
* [x] No regressions in ignore behavior (still uses `buildIgnoredMatcher`)
* [x] Event storms do not cause repeated redundant rebuilds (existing debounce logic preserved)

---

## Phase 7 — RPC Robustness and Memory-Safety (LSP + MCP + JSON-RPC)

**Objective:** Prevent unbounded memory growth and improve resilience when communicating with external processes (LSP servers, MCP transport), including malformed or oversized JSON-RPC frames.

1. **Implement `maxBufferBytes` enforcement in framed JSON-RPC parser**

   * [x] **Enforce `maxBufferBytes` in `createFramedJsonRpcParser`.**

     * **Why:** The function accepts `maxBufferBytes` but does not enforce it, leaving an unbounded buffer growth path if a peer sends large frames or never terminates headers.
     * **Where:** `src/shared/jsonrpc.js` (`createFramedJsonRpcParser`)
     * **Fix:**

       * Track buffer size after concatenation.
       * If buffer exceeds limit:

         * Clear internal buffer.
         * Call `onError(new Error(...))`.
         * Optionally enter a “failed/closed” state to reject further data.
       * Consider separate thresholds:

         * `maxHeaderBytes` (protect header scan)
         * `maxMessageBytes` (protect content-length payload)
   * [x] **Add explicit tests for oversized frames.**

     * **Where:** Add a new unit test under `tests/` that pushes > limit into parser and asserts:

       * `onError` called
       * parser does not continue to grow memory

2. **Apply bounded JSON-RPC parsing in LSP client**

   * [x] Replace `StreamMessageReader` usage with the bounded framed parser (or wrap it with size checks).

     * **Why:** `StreamMessageReader` will buffer messages; without explicit size enforcement at your integration boundary, a misbehaving server can cause OOM.
     * **Where:** `src/integrations/tooling/lsp/client.js`
     * **Fix:**

       * Wire `proc.stdout` `data` into `createFramedJsonRpcParser`.
       * Feed parsed messages into the existing dispatch/response correlation logic.
       * Ensure shutdown/kill closes parser cleanly.

3. **Apply bounded JSON-RPC parsing in MCP transport**

   * [x] Replace `StreamMessageReader` usage similarly.

     * **Where:** `tools/mcp/transport.js`
     * **Fix:** Same pattern as LSP client; enforce message size limits and fail gracefully.

**Exit criteria**

* [x] `createFramedJsonRpcParser` enforces max buffer/message sizes with tests.
* [x] LSP client no longer relies on unbounded message buffering.
* [x] MCP transport no longer relies on unbounded message buffering.

---

## Phase 2.4 — Unified CLI progress display + logging hygiene (build-index, bench-lang, long runners)

**Objective:** Make all long-running CLI commands share a single, high-quality TTY display (progress bars + compact logs), reduce noisy/repetitive output, and ensure mode-level visibility (`code`/`prose`/`extracted-prose`/`records`) is consistent everywhere.

### 2.4.1 Standardize on a single progress UI dependency

- [x] Add `terminal-kit` as the progress/UI engine for TTY mode (Windows/macOS/Linux).
  - Use built-in progress bars and screen-buffer primitives rather than hand-rolled ANSI.
  - Explicitly validate in **PowerShell** (Windows Terminal + classic console hosts) as well as bash/zsh.
  - Rendering contract:
    - interactive UI renders to **stderr** (never stdout)
    - stdout remains clean for JSON output, pipes, and file redirection

- [x] Add a thin wrapper module (new): `src/shared/cli/display.js`
  - Public API (proposal):
    - `createDisplay({ stream, isTTY, verbose, progressMode, json })`
    - `display.task(name, { total, unit, mode, stage }) -> { tick(n=1), set(n), done(), fail(err) }`
    - `display.log/info/warn/error(...)` (routes to log pane in TTY, to stderr otherwise)
    - `display.close()` (restores terminal state)
  - Defaults:
    - `--progress=auto` is **on by default**:
      - if `process.stderr.isTTY`: show interactive progress UI
      - else: emit periodic, single-line progress summaries (no cursor movement)
    - `--progress=off` (or `--no-progress`) disables progress rendering entirely
    - `--progress=jsonl` emits machine-readable progress events to **stderr** (one JSON object per line)
    - interactive UI is automatically disabled when `--json` output is enabled (JSON must remain clean)

### 2.4.2 Define a shared progress event vocabulary

- [x] Add a small event layer that long tasks can emit (even when they are not directly rendering):
  - `task:start`, `task:progress`, `task:end`
  - stable fields:
    - `taskId`
    - `stage` (e.g., `discovery`, `processing`, `write`, `sqlite`, `validate`, `promote`, `bench`)
    - `mode` (`code`, `prose`, `extracted-prose`, `records`)
    - optional: `shardId`, `repoId`, `file`, `bytes`, `lines`, `etaMs`
- [x] Ensure events can be:
  - rendered live in-process (direct `build_index.js` runs)
  - consumed by a parent process (bench harness) without scraping free-form text
- [x] Standardize emission:
  - progress events always go to **stderr**
  - parent processes can opt-in to JSONL parsing via `--progress=jsonl`

### 2.4.3 Upgrade `build-index` to use the unified display

- [x] Replace per-file `[shard] i/n …` spam (default) with:
  - an overall stage bar
  - per-mode bars when multiple modes are active
  - shard-level bars only when sharding is enabled
- [x] Keep file-level output behind `--verbose` (CLI-only). Do not add env toggles; env is reserved for secrets/deployment wiring only.
- [x] Ensure extracted-prose + records are shown everywhere code/prose are shown:
  - startup “modes enabled” banner
  - stage/mode progress bars
  - final per-mode summaries (chunks/tokens/dims)
- [x] Logging noise controls:
  - avoid repeating identical warnings many times (dedupe + counters)
  - cap redraw frequency (e.g., 10–20 updates/sec)
  - in PowerShell/Windows, avoid flicker and cursor corruption (use terminal-kit primitives; add fallback to non-interactive lines when the console cannot reposition)

### 2.4.4 Refactor `bench-lang` to use the same display

- [x] Replace `tools/bench/language/progress/render.js`’s custom ANSI UI with the shared display wrapper.
- [x] Ensure bench progress renders to **stderr** (never stdout), matching `build-index`.
- [x] Update `tools/bench-language-repos.js` + `tools/bench/language/run.js` to consume progress events from child index builds.
- [x] Ensure bench output remains stable and machine-readable when `--json` is used (no TTY UI in JSON mode).

### 2.4.5 Adopt unified display for other long-running commands

- [x] Migrate these to emit progress events and/or use the unified display:
  - `tools/build-sqlite-index/*`
  - `tools/build-lmdb-index.js`
  - `tools/build-embeddings/*`
  - `tools/compact-sqlite-index.js`
  - `tools/download-extensions.js` (download/verify/extract steps)
  - `tools/ci-build-artifacts.js` (multi-step aggregator)
  - `tools/eval/run.js` (long-running eval workflows)

### 2.4.6 Logging hygiene: less noisy, more actionable

- [x] Add log de-duplication + coalescing:
  - collapse repeated identical warnings/errors into one line with a counter
  - throttle high-rate progress logs
- [x] Add a consistent verbosity contract across tools:
  - default: compact info logs only (summary lines + key warnings)
  - `--verbose`: per-file or per-item logs + shard plan dump
  - `--quiet`: errors only (still prints final summary)
- [x] Ensure crash logs retain full detail regardless of verbosity:
  - write full detail to crash report artifacts / ring buffer logs (not console spam)
  - print a single-line “crash summary + path to report” to stderr

**Exit criteria**

- [x] `build_index.js` and `tools/bench-language-repos.js` share the same display UX and render identical progress primitives.
- [x] Progress output is on by default and consistently emitted on **stderr**, with JSON-safe stdout.
- [x] Long-running tools listed above use the unified display (TTY) and emit clean line logs (non-TTY).
- [x] Default console output is materially less noisy while preserving debuggability via `--verbose`.

---

## Phase 3 — Index build scalability: artifact sharding, OOM prevention, and parsing robustness

**Objective:** Prevent index builds from failing on large repos due to memory blowups, oversized artifacts, and brittle JSON parsing.

### Observed failures driving this phase

- `Error: JSON artifact too large to load (...)` while loading `chunk_meta` (examples observed: ~139MB, ~188MB, ~157MB, and ~704MB).
- `RangeError: Map maximum size exceeded` in:
  - `src/index/build/state.js` (`state.phrasePost.set(...)`)
  - `graphology` during relation graph building
- Out-of-memory (OOM) when indexing at least one file in the listed fixture set.
- Repeated JSON parse/syntax errors while reading chunk JSON (“chunkJSON”), including lines containing `[]` / `{}` or bracket fragments.

### 3.1 Hard guarantee: shard JSONL artifacts before they exceed MAX_JSON_BYTES

- [x] Upgrade `chunk_meta` sharding to be **measured**, not purely sample-estimated:
  - enforce a hard upper bound per artifact file (and per shard part)
  - if a part would exceed the bound, split earlier
- [x] Apply the same policy to other potentially-large JSONL artifacts as needed (file relations, repo map, graphs).
- [x] Add tests that generate synthetic chunk meta large enough to exceed `MAX_JSON_BYTES` and assert the writer produces `chunk_meta.meta.json` + `chunk_meta.parts/...`, and the loader can read it.
- [x] Align explicitly with the requirement: “split into multiple jsonl artifacts if it exceeds the size.”

### 3.2 Streaming loaders for SQLite build tooling

- [x] Update sqlite index build tooling to avoid `readJsonLinesArray(...)` collecting the entire chunk_meta into memory:
  - stream chunk_meta JSONL/parts and insert rows incrementally
  - keep peak memory bounded by a small batch size
- [x] Add a regression test on a synthetic large index that builds sqlite from artifacts successfully without unbounded memory growth.

### 3.3 Phrase postings and graph construction memory caps

- [x] Add guardrails to prevent `Map maximum size exceeded`:
  - phrase postings: cap unique phrase grams per file/chunk; spill/flush; or disable phrase indexing beyond a threshold
  - relation graphs: cap max edges; dedupe aggressively; avoid building a global in-memory graph for very large repos (stream edges instead)
- [x] Add diagnostics that identify top contributors (file path + chunk id) when a cap is hit.

### 3.4 Fix the OOM file culprit in the fixture set

- [x] Reproduce the OOM reliably and identify the triggering file from the provided list (fixtures under `tests/fixtures/languages/*`, `tests/fixtures/sample/*`, `tests/fixtures/tree-sitter/*`).
- [x] Add a targeted regression test and the minimal fix (caps, chunking change, skip reason, or algorithmic improvement) so the fixture set indexes without OOM.

### 3.5 JSONL parsing robustness (“chunkJSON”)

- [x] Add strict JSONL validation:
  - each non-empty line must parse as a JSON object with required keys
  - detect and fail fast on bracket/fragments indicative of “JSON array in a .jsonl file”
- [x] Improve error reporting (file, line number, short preview).
- [x] Add tests for trailing blank lines, truncated final line, and accidental JSON-array formatting.

**Exit criteria**

- [x] Large repos no longer fail with “JSON artifact too large to load”.
- [x] Index builds do not crash with `Map maximum size exceeded`; they degrade gracefully with clear diagnostics.
- [x] The identified OOM fixture file is fixed and covered by tests.
- [x] JSONL parsing failures are actionable and do not appear as repeated opaque syntax errors.

---

## Phase 5 — Encoding + Language Handler Hardening (latin1, utf-8, Swift)

**Objective:** Eliminate encoding-related crashes and restore full language coverage parity for the fixture corpus, with particular focus on latin1/invalid UTF‑8 inputs and Swift parsing.

### 5.1 Encoding regression suite expansion

- [x] Add `latin1.js` fixture (from downloads) into `tests/fixtures/encoding/latin1.js` (or equivalent) with known latin1 bytes that are not valid UTF‑8.
- [x] Add tests covering:
  - latin1 decode fallback path (iconv)
  - invalid UTF‑8 does not crash (`TypeError: The encoded data was not valid for encoding utf-8`)
  - JSONL artifact reading/writing always produces valid UTF‑8
- [x] Add a decode test matrix for `readTextFileWithHash`:
  - utf-8 (valid)
  - utf-8 (invalid sequences)
  - latin1 / windows-1252 (detected + decoded)
  - truncation near caps does not split multi-byte sequences

### 5.2 Swift indexing parity

- [x] Reproduce “Swift broken” against:
  - `tests/fixtures/languages/src/swift_advanced.swift`
  - `tests/fixtures/tree-sitter/swift.swift`
  - at least one real-world Swift repo used in benchmarks
- [x] Fix whichever stage is failing (language registry / chunking / docmeta / relations / comment extraction).
- [x] Add/extend Swift tests so that:
  - chunking extracts expected functions/types
  - extracted-prose comment extraction works

### 5.3 Tree-sitter maxBytes behavior for JavaScript

- [x] Clarify and codify behavior when JS files exceed the tree-sitter `maxBytes` cap (e.g., `984433 > 524288`):
  - fall back to heuristic chunking with a clear reason, OR
  - treat as oversize/minified and skip indexing entirely (configurable)
- [x] Add tests covering the chosen behavior, including ensuring this path cannot trigger downstream Map-size blowups.

**Exit criteria**

- [x] No encoding-related `TypeError` escapes the file read/decode boundary.
- [x] Swift fixtures index correctly (chunking + extracted-prose comments at minimum).
- [x] Large JS files do not cause tree-sitter disable → downstream indexer crashes.

---

## Phase 6 — Security and Input-Hardening (Local Servers + Indexing)

**Objective:** Close high-impact vulnerabilities and unsafe defaults that could be exploited when indexing untrusted repositories or exposing the local API server beyond localhost.

1. **Prevent symlink-based repo escape during discovery/indexing**

   * [x] **Stop following symlinks when discovering and stat’ing files.**

     * **Why:** If a repository contains a tracked symlink pointing outside the repo (e.g., to `/etc/passwd`), the current logic can follow it and read/index external files. This is a classic “repo escape / data exfiltration” risk when indexing untrusted repos.
     * **Where:** `src/index/build/discover.js`

       * Uses `fs.stat()` (follows symlinks) on each path.
     * **Fix:**

       * Use `lstat` first; if it is a symlink:

         * Default behavior: **skip** the entry.
         * Optional (configurable) behavior: allow symlinks only if resolved target remains within `rootDir` (realpath boundary check).
       * Ensure both “git ls-files” path discovery and fallback `fdir` scanning apply the same symlink policy.
     * **Tests:**

       * Add a fixture repo containing a symlink file pointing outside repo root.
       * Assert indexing does not read it (and ideally logs a warning or records a skip reason).
   * [x] **Ensure downstream file reads cannot accidentally follow symlinks even if discovery misses one.**

     * **Why:** Defense-in-depth; discovery should prevent it, but a second gate at file-read time reduces risk.
     * **Where:** `src/index/build/file-processor.js` and any shared read helpers (e.g., `src/shared/encoding.js` `readTextFileWithHash`)
     * **Fix:** If feasible, check `lstat` before read in the pre-read stage (or pass `lstat` results from discovery and enforce “no symlink reads”).

2. **Lock down API server defaults (CORS, repo selection, and exposure)**

   * [x] **Remove unconditional permissive CORS (`Access-Control-Allow-Origin: *`) or make it explicitly opt-in.**

     * **Why:** If the server is started with `--host 0.0.0.0` (supported), permissive CORS plus no auth makes it trivial for any web page on the same network to call the API from a browser (cross-site request from an untrusted origin).
     * **Where (currently sets `*`):**

       * `tools/api/router.js` (sets headers broadly, including metrics endpoint)
       * `tools/api/response.js`
       * `tools/api/sse.js`
     * **Fix (recommended safe default):**

       * Default allowlist: `http://127.0.0.1:*` and `http://localhost:*` only (or no CORS headers at all unless configured).
       * Add config flags:

         * `api.cors.allowedOrigins` (array)
         * `api.cors.allowAnyOrigin` (explicit opt-in, default false)
   * [x] **Add authentication for non-localhost bindings (or always, with a “dev disable” escape hatch).**

     * **Why:** The API allows expensive operations (search) and can access the filesystem via repo selection (see next item). This should not be anonymous if reachable from other machines.
     * **Fix:**

       * Support a bearer token header, e.g. `Authorization: Bearer <token>` with `PAIR_OF_CLEATS_API_TOKEN` env var.
       * If `host` is not `127.0.0.1/localhost`, require token by default.
   * [x] **Restrict `repoPath` override in API requests (prevent arbitrary filesystem indexing/search).**

     * **Why:** Current API accepts a request body that can set `repoPath`, and then resolves and operates on that directory. Without an allowlist, this is arbitrary directory read/search capability.
     * **Where:** `tools/api/router.js` `resolveRepo(value)` and usage in `/search`, `/status`, `/stream/search`.
     * **Fix options:**

       * Option A (strict): disallow `repoPath` in request; only use the server’s configured repo.
       * Option B (allowlist): allow only if within a configured set of allowed roots (`api.allowedRepoRoots`), enforced by realpath boundary checks.
     * **Tests:**

       * Confirm requests with disallowed repoPath return 400/403.
       * Confirm allowed repo paths still work.

3. **Harden API request body parsing and limits**

   * [x] **Replace string concatenation body parsing with byte-safe buffering and strict size enforcement.**

     * **Why:** Current `parseBody` in `tools/api/router.js` does `data += chunk` and uses `data.length` (characters, not bytes). This is less reliable and can be slower for large payloads due to repeated string reallocations.
     * **Fix:**

       * Accumulate Buffers in an array; track `byteLength`.
       * Enforce a hard cap in bytes (e.g., 1 MiB configurable).
       * Only decode once at the end.
   * [x] **Validate `Content-Type` for JSON endpoints.**

     * **Why:** Avoid ambiguous parsing and reduce attack surface.
     * **Fix:** Require `application/json` for POST bodies on `/search` and stream endpoints (except where intentionally flexible).

**Exit criteria**

* [x] Indexing does not follow symlinks by default (tested with a symlink fixture).
* [x] API no longer emits permissive CORS headers by default.
* [x] API requests cannot arbitrarily set `repoPath` unless explicitly allowed/configured.
* [x] API body parsing is byte-safe and enforces a clear, tested size limit.

---

## Phase 8 — Language handlers & chunking review

**Objective:** Make language detection, per-language chunking, tree-sitter integration, and ingestion tooling *deterministic, robust on real-world code*, and *well-tested* — with clear fallback behavior, predictable chunk boundaries, and guardrails against performance/pathological inputs.

**Scope reference:** Review Section 5 file list + checklist (see the attached “review section 5 files and checklist” markdown).

### Note
While generating the markdown deliverable, I noticed one small wording issue in the YAML section of the produced document: it currently describes the tab bug using code spans that don’t clearly distinguish '\t' vs '\\t' (because Markdown code spans visually collapse some intent). The underlying identified bug is correct and the remediation tasks are correct, but that one wording line could be clarified to explicitly contrast '\\t' (backslash+t) vs '\t' (actual tab).

---

### 8.0 Priority findings summary (what must be fixed first)

#### P0 — Breaks correctness, tests, or core workflows
- [x] **Fix YAML tab handling + Windows path normalization bugs** in `src/index/chunking/formats/yaml.js` (tabs currently checked as the literal string `"\t"`; Windows paths normalized with the wrong regex).  
  - Affects: skipping list items / indentation detection; GitHub Actions workflow detection on Windows-style paths.
- [x] **Fix C-like docstring/attribute extraction off-by-one** in `src/lang/clike.js` (doc comment extraction currently skips the line immediately above declarations).  
  - Affects: docstring/attributes in C/C++/ObjC chunks (and downstream docmeta / fidelity).
- [x] **Fix broken test syntax** in `tests/language-registry/collectors.test.js` (invalid escaped quotes).  
  - Affects: test suite execution.
- [x] **Fix ingestion tools writing output before ensuring directory exists** in:
  - `tools/ctags-ingest.js`
  - `tools/gtags-ingest.js`
  - `tools/lsif-ingest.js`
  - `tools/scip-ingest.js`  
  Creating the write stream before `ensureOutputDir()` can fail when the output directory does not exist.
- [x] **Fix SQL statement splitting for standard SQL escaping (`''` / `""`)** in `src/lang/sql.js`.  
  Current quote toggling assumes backslash-escaping and will mis-split statements containing doubled quotes.

#### P1 — Tree-sitter quality/perf gaps that will surface at scale
- [x] **Fix `findNameNode` traversal depth bug** in `src/lang/tree-sitter/chunking.js` (depth increments per node instead of per level; the search stops after ~4 iterations).  
  - Affects: chunk naming quality and method/class qualification.
- [x] **Make tree-sitter worker path functional and deterministic** (`src/lang/workers/tree-sitter-worker.js` + `src/lang/tree-sitter/chunking.js`).  
  - Worker currently does not preload/init grammars; `buildTreeSitterChunksAsync()` treats a `null` worker result as “success” and does not fall back.

#### P2 — Cleanup, clarity, and long-term maintainability
- [x] **Remove or use unused imports** (e.g., `parseTypeScriptSignature` in `src/lang/typescript/chunks-babel.js`).
- [x] **Add missing/edge-case tests** (Windows paths, tabs, unicode identifiers, SQL quoting, tree-sitter worker behavior, etc.).
- [x] **Document chunk metadata semantics** (particularly `meta.endLine` inclusivity and byte vs. code-unit offsets) in `docs/contracts/chunking.md` (and/or a new contract doc).

---

### 8.1 Chunking pipeline: mapping, fallback, limits, determinism

#### 8.1.1 Fallback behavior and deterministic output
- [x] **Audit & document** the full fallback chain in `src/index/chunking/dispatch.js`:
  - code chunker → code-format chunker → prose chunker → root chunk (prose extensions) → fixed-size blob fallback.
- [x] **Add regression tests** that verify:
  - A failed code chunker returns `null` and the dispatcher properly falls back.
  - “Prose mode” behavior for `.md/.rst/.adoc/.txt/.mdx` is stable (chunk headings when possible; otherwise single chunk).
  - “Code mode” for prose files intentionally uses blob fallback (or adjust if that’s not desired).

#### 8.1.2 Limits: correctness + performance under large inputs
- [x] **Add tests for multi-byte UTF-8 boundaries** in `applyChunkingLimits()` (`src/index/chunking/limits.js`):
  - Ensure splits never create invalid surrogate pairs.
  - Ensure byte limits are enforced correctly with emoji / non-ASCII identifiers.
- [x] **Performance review:** `resolveByteBoundary()` currently calls `Buffer.byteLength(text.slice(0, mid))` repeatedly.
  - [x] Consider a faster strategy (e.g., pre-encoding once to a `Buffer`, or maintaining cumulative byte counts per line) to avoid repeated substring allocations.
- [x] **Clarify contract semantics** for:
  - Whether `chunk.end` is exclusive (it is treated as exclusive almost everywhere).
  - Whether `meta.endLine` is “line containing end offset” vs “last included line”.  
    (Many language chunkers use `offsetToLine(end)` vs `offsetToLine(end - 1)`; this should be intentional and documented.)
  - Update `docs/contracts/chunking.md` accordingly and add examples.

---

### 8.2 Format chunkers: YAML, JSON, XML, INI/TOML, Markdown, RST/Asciidoc

#### 8.2.1 YAML (`src/index/chunking/formats/yaml.js`)
**Bugs**
- [x] **Fix tab detection** in `chunkYamlTopLevel()` and list-item skipping:
  - Current code checks `line.startsWith("\t")` (literal backslash + t) instead of `line.startsWith("\t")` as a tab character.
  - Locations:
    - line ~60: `line.startsWith('\t')` in list-item skip condition
    - line ~92: `line.startsWith('\t')` in indentation calculation
- [x] **Fix Windows path normalization** in `chunkYaml()`:
  - Current: `normalizedPath = relPath.replace(/\\\\/g, '/')`  
    This matches *double* backslashes; typical Windows paths contain single backslashes.
  - Should be: `relPath.replace(/\\/g, '/')` (single backslash regex)

**Hardening / improvements**
- [x] **Add YAML tests** covering:
  - Tab-indented YAML (even if discouraged, tools may produce it).
  - Workflow path detection for both `".github/workflows/foo.yml"` and `".github\\workflows\\foo.yml"`.
  - A workflow file with `jobs:` where indentation is not 2 spaces (ensure graceful behavior).
- [x] **Document YAML chunker limitations** (top-level-only + heuristics for GH Actions) in the chunking contract or a dedicated “format chunkers” doc section.

#### 8.2.2 JSON (`src/index/chunking/formats/json.js`)
- [x] **Test hygiene:** Fix test calls that pass arguments in the wrong positions (e.g., `chunkJson(jsonText, {})` in `tests/chunking/json.test.js` currently passes `{}` as `relPath`).  
  Update to `chunkJson(jsonText, null, {})` for clarity and future-proofing.
- [x] **Optional robustness improvement:** consider using `jsonc-parser` for tolerant parsing (trailing commas/comments) *if desired*.
  - If adopted, ensure invalid JSON still cleanly falls back (i.e., return `null`).

#### 8.2.3 XML (`src/index/chunking/formats/xml.js`)
- [x] Add tests for:
  - Nested tags with attributes + self-closing tags.
  - CDATA blocks and processing instructions.
  - Malformed tag recovery (should return `null`, triggering fallback, rather than producing broken chunks).

#### 8.2.4 Markdown (`src/index/chunking/formats/markdown.js`)
- [x] Add tests for:
  - Headings inside fenced blocks (should not create chunks; current `inFence` logic covers ``` and ~~~).
  - Setext headings vs horizontal rules (ensure `---` under a paragraph is treated correctly).

#### 8.2.5 RST/Asciidoc (`src/index/chunking/formats/rst-asciidoc.js`)
- [x] Add tests for:
  - RST overline+underline headings and nested sectioning.
  - Asciidoc `==` headings inside code/list blocks to avoid false positives.

#### 8.2.6 INI/TOML (`src/index/chunking/formats/ini-toml.js`)
- [x] Add tests for:
  - TOML array-of-tables (`[[table]]`).
  - INI sections with unusual whitespace and comments.

---

### 8.3 Language registry: selection, options, and collector mapping

#### 8.3.1 Registry correctness (`src/index/language-registry/registry.js`)
- [x] **Confirm and document intentional grouping** of C/C++/ObjC into `id: 'clike'`:
  - Ensure docs and tests consistently reflect that `.c/.h/.cpp/.hpp/.m/.mm` map to the same language id.
  - Update language-fidelity expectations and/or docs if users expect separate ids.

- [x] Expand `tests/language-registry/selection.test.js` to cover:
  - C/C++/ObjC extensions: `.c`, `.h`, `.cpp`, `.hpp`, `.m`, `.mm`
  - Ambiguous extensions and “special names”:
    - `Dockerfile`, `dockerfile`, `*.Dockerfile`
    - `Makefile`, `makefile`
    - `CMakeLists.txt`
    - `.gitignore`-style config names (if supported elsewhere)

#### 8.3.2 Import collectors map (`tests/language-registry/collectors.test.js`)
- [x] **Fix syntax error** at the Dart fixture entry:
  - Replace `text: "import 'package:foo/bar.dart';",` with a valid JS string literal:
    - `text: "import 'package:foo/bar.dart';",`

- [x] Add edge-case import collector tests for:
  - Multiline imports (where applicable).
  - Imports inside comments (should be ignored where the collector claims to ignore comments).
  - Duplicate imports / whitespace variants (ensure normalization works).

---

### 8.4 Tree-sitter backbone: wasm init, language loading, chunk extraction, workers

#### 8.4.1 Name extraction (`src/lang/tree-sitter/chunking.js`)
- [x] **Fix `findNameNode()` depth logic**:
  - Current implementation increments `depth` per dequeued node, not per BFS level.
  - Result: the search stops after ~4 processed nodes and often fails to find a name.
  - Expected: traverse up to N levels or up to a node-count budget (explicitly), and return the first plausible identifier.

- [x] Add tests that assert:
  - Function and class chunk names are extracted correctly across multiple language grammars.
  - Member/method names are found for nested AST shapes where the `name` field is not a direct child.

#### 8.4.2 Worker-mode tree-sitter chunking (`src/lang/workers/tree-sitter-worker.js`, `src/lang/tree-sitter/chunking.js`)
- [x] **Initialize and preload grammars inside the worker** (or add a per-worker lazy-init path):
  - Today, the worker calls `buildTreeSitterChunks()` without ensuring tree-sitter wasm + language grammar are loaded in that worker thread.
  - Proposed fix:
    - In the worker, resolve language id from `ext`/`languageId`, then `await preloadTreeSitterLanguages([resolvedId], treeSitterOptions)` before parsing.
- [x] **Make `buildTreeSitterChunksAsync()` treat `null` results as a failure signal** and fall back to in-thread parsing (or to non-tree-sitter chunking), at least when worker-mode is enabled.
- [x] Add tests that explicitly enable worker-mode and assert that:
  - Chunks are returned (not `null`) for a known fixture.
  - The result matches non-worker behavior (same chunk boundaries, or documented acceptable differences).
  - If a grammar is missing/unavailable, it falls back cleanly and deterministically.

#### 8.4.3 Configuration normalization (`src/lang/tree-sitter/options.js`)
- [x] Improve boolean normalization:
  - Current `normalizeEnabled()` only recognizes `false` and the literal string `'off'`.
  - Expand to treat `'false'`, `'0'`, `'no'` (case-insensitive) as disabled, and `'true'`, `'1'`, `'yes'`, `'on'` as enabled.
- [x] Add tests for config parsing from environment/JSON where booleans may be strings.

#### 8.4.4 Offsets: bytes vs JS string indices
- [x] Add an explicit contract note and tests around offset units used by:
  - tree-sitter (`node.startIndex/endIndex`)
  - parse5 and other JS parsers
  - Python AST (line/col from Python runtime)  
  Ensure all chunk `start/end` offsets are consistent with JS string slicing expectations, particularly with non-BMP unicode characters.

---

### 8.5 Language handlers: correctness fixes & hardening

#### 8.5.1 C-like (`src/lang/clike.js`)
- [x] **Fix docstring extraction index** for functions and ObjC methods:
  - Current:
    - ObjC method chunk meta: `extractDocComment(lines, i - 1, ...)` and `collectAttributes(lines, i - 1, ...)`
    - C-like functions: `extractDocComment(lines, i - 1)`
  - This skips the immediate preceding line.  
  - Fix: pass `i` (0-based declaration start line) instead of `i - 1`.
  - Locations:
    - ~417–418, ~463 in `src/lang/clike.js`

- [x] Add tests for C-like doc comment capture:
  - A `/** ... */` or `// ...` directly above a `struct`, `class`, `enum`, and `function`.
  - ObjC method with `///` doc comment above it.

#### 8.5.2 SQL (`src/lang/sql.js`)
- [x] **Fix quote handling** in both `stripSqlComments()` and `splitSqlStatements()`:
  - SQL escaping commonly uses doubled quotes:
    - `'It''s fine'`
    - `"a ""quoted"" identifier"`
  - Current logic toggles on every `'`/`"` not preceded by backslash, which breaks on doubled quotes.

- [x] Add tests that include:
  - Semicolons inside strings with doubled quotes.
  - PostgreSQL dollar-quoted strings combined with single-quoted strings.
  - MySQL delimiter blocks that contain semicolons.

#### 8.5.3 CSS (`src/lang/css.js`)
- [x] Add guardrails to prevent pathological chunk explosion when using the CSS tree-sitter parser:
  - Options:
    - Enforce a max node/chunk count (consistent with tree-sitter default maxChunkNodes behavior).
    - Or switch to `buildTreeSitterChunks()` and its existing limits.
- [x] Add tests for:
  - Nested `@media` with many rules (ensure performance and deterministic chunk output).
  - Files exceeding the max node threshold (ensure fallback to heuristic).

#### 8.5.4 TypeScript (`src/lang/typescript/chunks-babel.js`)
- [x] Remove or use unused import `parseTypeScriptSignature` (currently imported but not referenced).
- [x] Add/extend tests ensuring:
  - Babel-based TS chunker produces signatures and types consistently where expected.
  - Worker/non-worker tree-sitter paths do not regress TS chunking (when enabled).

---

### 8.6 Imports, relations, and control-flow metrics

#### 8.6.1 Import collectors
- [x] Add test coverage for:
  - Normalization rules (`normalizeImportToken()` behavior).
  - Edge cases per language (e.g., JS `import type`, TS `import("x")`, Python relative imports).
- [x] Validate that collectors return stable, sorted output (dedupe + order determinism), or document if order is intentionally non-deterministic.

#### 8.6.2 Relations builders (`src/index/language-registry/simple-relations.js`, per-language `relations.js`)
- [x] Add a small integration test that:
  - Runs `collectLanguageImports()` and `buildLanguageRelations()` for a multi-language fixture set.
  - Verifies the resulting `imports`, `exports`, `calls`, and `usages` sets match expectations.

---

### 8.7 Ingestion tools: ctags / gtags / lsif / scip

#### 8.7.1 Output directory creation order
- [x] Move `await ensureOutputDir()` to occur *before* `fs.createWriteStream(outputPath, ...)` in:
  - `tools/ctags-ingest.js` (write stream is created before the dir is ensured)
  - `tools/gtags-ingest.js`
  - `tools/lsif-ingest.js`
  - `tools/scip-ingest.js`

#### 8.7.2 Robustness improvements
- [x] Add tests / smoke scripts that verify:
  - Tools succeed when output directory doesn’t exist.
  - Tools correctly handle empty input streams.
  - Tools fail with actionable errors on malformed JSON lines.

- [x] Add optional flags/docs for:
  - Strict vs tolerant ingest behavior (skip malformed lines vs fail-fast).
  - Path normalization expectations (repo-root relative vs absolute).

---

### 8.8 Docs and test suite alignment

#### 8.8.1 Fix broken / missing documentation references
- [x] The Section 5 checklist references docs that are *not present* in this repo snapshot (e.g., `docs/contracts/language-registry.md`, `docs/contracts/ast.md`, and `docs/optional/*`).  
  Decide whether to:
  - Create these docs, or
  - Update the checklist to point to existing docs (`docs/language-handler-imports.md`, `docs/language-fidelity.md`, etc.).

#### 8.8.2 Update existing docs for discovered behavior
- [x] Update `docs/contracts/chunking.md` to include:
  - Chunk offset semantics (exclusive `end`, unicode considerations).
  - `meta.startLine/endLine` semantics and examples.
  - Expected behavior for overlapping chunks (if allowed) vs non-overlapping (if required).
- [x] Update `docs/language-fidelity.md` if docstring expectations for C-like currently fail due to the off-by-one bug.

#### 8.8.3 Add a “known limitations” section (recommended)
- [x] Document known heuristic limitations for:
  - SQL parsing (heuristic statement splitting vs full parser).
  - YAML parsing (line-based, top-level heuristics).
  - Language relations (regex-based calls/usages for some languages).

---

### Deliverables
- [x] All P0/P1 fixes implemented with unit tests.
- [x] Updated docs reflecting chunk semantics and configuration.
- [x] A focused regression test pack covering:
  - YAML tabs + Windows workflow paths
  - C-like doc comments
  - SQL doubled-quote handling
  - Tree-sitter worker-mode functionality
  - Chunking limits with unicode/multi-byte text

---

### Exit criteria
- [x] `npm test` (or the project’s test runner) executes without syntax errors (including `collectors.test.js`).
- [x] Format chunkers are robust against malformed inputs and fall back deterministically.
- [x] Tree-sitter worker-mode returns real chunks for supported languages and falls back when grammars are missing.
- [x] Chunk metadata semantics are documented and consistent across chunkers (or differences are explicitly justified).
- [x] Ingestion tools succeed when output directories are missing and produce valid NDJSON outputs.

---

## Phase 41 — Test runner entrypoint: `pairofcleats test` (lanes/selectors/output)

**Objective:** Replace hundreds of ad-hoc `node tests/<file>.js` entrypoints with a single stable runner that can execute existing tests unchanged, while enabling lanes, selectors, retries/timeouts, and structured output.

### 41.1 Choose and wire the canonical entrypoint

* [x] Implement the canonical public interface (preferred): `pairofcleats test …`
  * Acceptable alternative: `node tests/run.js …`

* [x] Wire `npm test` to the canonical entrypoint.

* [x] Ensure the runner can execute existing tests (initially `tests/*.js`) unchanged (subprocess execution).

### 41.2 Runner CLI interface (selectors + options)

Selection:

* [x] Support `selectors...` (id/path/name selectors).
* [x] `--lane <name>[,<name>...]` (default `ci`).
* [x] `--tag <tag>` (repeatable) and `--exclude-tag <tag>` (repeatable).
* [x] `--match <pattern>` (repeatable) and `--exclude <pattern>` (repeatable).
  * pattern forms: substring (case-insensitive) or regex literal `/.../`
* [x] `--list` prints resolved tests and exits.

Execution controls:

* [x] `--jobs <n>` (default 1 initially; increase once isolation improves).
* [x] `--retries <n>` (default 0 local, 1–2 CI).
* [x] `--timeout-ms <n>` (default 120000).
* [x] `--fail-fast`.

Output / reporting:

* [x] `--quiet` minimal output.
* [x] `--json` machine-readable summary to stdout.
* [x] `--junit <path>` writes JUnit XML.
* [x] `--log-dir <path>` captures per-test stdout/stderr.

Pass-through:

* [x] Support `-- <args>` pass-through to selected tests.

### 41.3 Environment normalization (runner responsibility)

* [x] Normalize these env vars (unless explicitly overridden):
  * `PAIROFCLEATS_TEST_TIMEOUT_MS`
  * `PAIROFCLEATS_TEST_LOG_DIR`
  * `PAIROFCLEATS_TEST_RETRIES`

* [x] Runner must **not** globally force cache roots or embeddings providers.

### 41.4 Discovery model

* [x] Convention-based discovery (initial):
  * discover executable Node scripts under `tests/`
  * exclude `tests/fixtures/**`, `tests/**/helpers/**`, and known orchestrators
  * id is relative path from `tests/` without extension

* [x] Manifest-based discovery (recommended long-term):
  * add `tests/manifest.json` (or `tests/manifest.js`) with `{id, path, tags}`
  * support stable ids even after refactors

### 41.5 Lanes, determinism, and exit codes

* [x] Implement lanes:
  * `smoke`, `unit`, `integration`, `services`, `storage`, `perf`, `ci` (default)

* [x] Define lane composition (initial):
  * `ci = unit + integration + services` minus `perf` and minus explicitly flaky/slow tests

* [x] Exit codes:
  * `0` all pass
  * `1` failures
  * `2` usage error (unknown lane / bad flags)

* [x] Output format (human):
  * preamble (lanes/filters/resolved count)
  * per-test `PASS/FAIL <id> (<duration>)`
  * final summary (passed/failed/skipped + failure list + log dir)

**Exit criteria**

* [x] `pairofcleats test` runs the default lane on a clean checkout.
* [x] `--lane`, `--match`, and `--list` work and are deterministic.
* [x] Runner emits stable human output and optional JSON/JUnit reports.

---

## Phase 42 — Test suite decomposition & regrouping (split monolith tests; folder structure; retire suites)

**Objective:** Make failures easy to triage by enforcing “one responsibility per test file,” and by regrouping the suite into coherent directories aligned with lanes/tags.

### 42.1 Establish the grouping taxonomy (paths + ids)

* [x] Introduce (or formalize) group folders under `tests/`:
  * `harness/` — meta-tests and suite controllers
  * `unit/` — pure logic
  * `indexing/` — build-time + artifact contracts
  * `retrieval/` — search semantics + filters + determinism
  * `storage/` — SQLite/LMDB backends + migrations
  * `services/` — API + MCP servers
  * `tooling/` — LSP enrichment, cross-file inference, worker/tool contracts
  * `lang/` — language/format contracts (per-language invariants and metadata expectations)
  * `perf/` — benchmarks + perf guardrails

* [x] Ensure the test runner lane/tag model maps cleanly onto these groups.

### 42.2 Migration Phase 1 — Tag-and-lane only (no file moves)

* [x] Establish lane membership using a small mapping (runner manifest).
* [x] Keep today’s scripts runnable during migration.

### 42.3 Split the largest multi-responsibility tests (priority list)

#### 42.3.1 Split `tests/language-fidelity.js` (split aggressively)

Indexing artifact integrity (`tests/indexing/language-fixture/`):

* [x] Add `tests/indexing/language-fixture/postings-integrity.test.js`
* [x] Add `tests/indexing/language-fixture/chunk-meta-exists.test.js`

Search filter semantics (`tests/retrieval/filters/`):

* [x] Add `tests/retrieval/filters/control-flow.test.js` (branches)
* [x] Add `tests/retrieval/filters/types.test.js` (inferred-type, return-type)
* [x] Add `tests/retrieval/filters/behavioral.test.js` (returns, async)
* [x] Add `tests/retrieval/filters/file-selector.test.js` (file regex)
* [x] Add `tests/retrieval/filters/risk.test.js` (risk tag + risk flow)

Language/format contracts (`tests/lang/contracts/`):

* [x] Add `tests/lang/contracts/javascript.test.js`
* [x] Add `tests/lang/contracts/typescript.test.js`
* [x] Add `tests/lang/contracts/python.test.js`
* [x] Add `tests/lang/contracts/go.test.js`
* [x] Add `tests/lang/contracts/sql.test.js`
* [x] Add `tests/lang/contracts/misc-buildfiles.test.js`

#### 42.3.2 Split `tests/fixture-smoke.js` (split by contract area)

Fixture build + artifacts (`tests/indexing/fixtures/`):

* [x] Add `tests/indexing/fixtures/build-and-artifacts.test.js`
* [x] Add `tests/indexing/fixtures/minhash-consistency.test.js`

Search output contracts (`tests/retrieval/contracts/`):

* [x] Add `tests/retrieval/contracts/result-shape.test.js`
* [x] Add `tests/retrieval/contracts/compact-json.test.js`

Fixture-scoped filter semantics (`tests/retrieval/filters/`):

* [x] Add `tests/retrieval/filters/ext-path.test.js`
* [x] Add `tests/retrieval/filters/type-signature-decorator.test.js`

Language spot-checks (fixture sample only) (`tests/lang/fixtures-sample/`):

* [x] Add `tests/lang/fixtures-sample/python-metadata.test.js`
* [x] Add `tests/lang/fixtures-sample/swift-metadata.test.js`
* [x] Add `tests/lang/fixtures-sample/rust-metadata.test.js`

#### 42.3.3 Split `tests/sqlite-incremental.js` (split by behavior axis)

`tests/storage/sqlite/incremental/`:

* [x] Add `tests/storage/sqlite/incremental/file-manifest-updates.test.js`
* [x] Add `tests/storage/sqlite/incremental/search-after-update.test.js`
* [x] Add `tests/storage/sqlite/incremental/manifest-normalization.test.js`

`tests/storage/sqlite/migrations/`:

* [x] Add `tests/storage/sqlite/migrations/schema-mismatch-rebuild.test.js`

#### 42.3.4 Split `tests/search-filters.js` (split by filter family)

`tests/retrieval/filters/query-syntax/`:

* [x] Add `tests/retrieval/filters/query-syntax/negative-terms.test.js`
* [x] Add `tests/retrieval/filters/query-syntax/phrases-and-scorebreakdown.test.js`

`tests/retrieval/filters/git-metadata/`:

* [x] Add `tests/retrieval/filters/git-metadata/chunk-author.test.js`
* [x] Add `tests/retrieval/filters/git-metadata/modified-time.test.js`
* [x] Add `tests/retrieval/filters/git-metadata/branch.test.js`

`tests/retrieval/filters/file-and-token/`:

* [x] Add `tests/retrieval/filters/file-and-token/file-selector-case.test.js`
* [x] Add `tests/retrieval/filters/file-and-token/token-case.test.js`
* [x] Add `tests/retrieval/filters/file-and-token/punctuation-tokenization.test.js`

#### 42.3.5 Split `tests/mcp-server.js` (split by MCP contract areas)

`tests/services/mcp/`:

* [x] Add `tests/services/mcp/protocol-initialize.test.js`
* [x] Add `tests/services/mcp/tools-list.test.js`
* [x] Add `tests/services/mcp/tool-index-status.test.js`
* [x] Add `tests/services/mcp/tool-config-status.test.js`
* [x] Add `tests/services/mcp/tool-build-index-progress.test.js`
* [x] Add `tests/services/mcp/tool-search-defaults-and-filters.test.js`
* [x] Add `tests/services/mcp/errors.test.js` (missing repo, missing index)

#### 42.3.6 Split `tests/api-server.js` (split by endpoint family)

`tests/services/api/`:

* [x] Add `tests/services/api/health-and-status.test.js`
* [x] Add `tests/services/api/search-happy-path.test.js`
* [x] Add `tests/services/api/search-validation.test.js`
* [x] Add `tests/services/api/repo-authorization.test.js`
* [x] Add `tests/services/api/no-index.test.js`

#### 42.3.7 Split `tests/type-inference-crossfile.js` (unit vs integration)

`tests/tooling/type-inference/`:

* [x] Add `tests/tooling/type-inference/crossfile-stats.unit.test.js`

`tests/indexing/type-inference/`:

* [x] Add `tests/indexing/type-inference/crossfile-output.integration.test.js`

#### 42.3.8 Split `tests/triage-records.js` (split by pipeline stage)

`tests/tooling/triage/`:

* [x] Add `tests/tooling/triage/ingest-generic.exposure.test.js`
* [x] Add `tests/tooling/triage/ingest-sources.smoke.test.js`
* [x] Add `tests/tooling/triage/decision.test.js`
* [x] Add `tests/tooling/triage/records-index-and-search.test.js`
* [x] Add `tests/tooling/triage/context-pack.test.js`

#### 42.3.9 Split `tests/bench.js` (move to perf + split scenarios)

`tests/perf/bench/`:

* [x] Add `tests/perf/bench/run.test.js` (or `run.js` if treated as a tool rather than a test)
* [x] Add `tests/perf/bench/scenarios/memory-vs-sqlite.js`
* [x] Add `tests/perf/bench/scenarios/sqlite-fts.js`
* [x] Add `tests/perf/bench/scenarios/ann-on-off.js`
* [x] Add `tests/perf/bench/scenarios/bm25-params.js`

#### 42.3.10 Optional decompositions (as time permits)

* [x] Split `tests/mcp-robustness.js` into two tests (queue overload vs timeout scenarios).
* [x] Consider splitting `tests/mcp-schema.js` by snapshot type (tool schema vs response shape).
* [x] Consider splitting `tests/type-inference-crossfile-go.js` similarly to JS cross-file.
* [x] Consider splitting `tests/type-inference-lsp-enrichment.js` by language if it remains unstable.

### 42.4 Migration Phase 2 — Move tests into group folders (mechanical)

* [x] Move remaining tests into `tests/<group>/...` while preserving ids via a manifest.
* [x] Create thin compatibility shims only where necessary.

### 42.5 Migration Phase 3 — Remove deprecated suites and script sprawl

* [x] Remove monolith scripts once split tests cover equivalent assertions.
* [x] Collapse `package.json` scripts surface to a small set of lanes (delegate to the test runner).

**Success criteria**

* [x] A developer can answer “what should I run?” with ~6 lanes.
* [x] The largest multi-domain scripts are split so failures point to a subsystem.
* [x] CI can run the `ci` lane deterministically with clear logs and minimal flake.
* [x] The test tree communicates intent via folder structure and stable ids.
