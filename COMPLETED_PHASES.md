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
