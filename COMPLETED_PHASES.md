# Completed Phases

Completed phase snapshots are archived here after being removed from NEW_ROADMAP.md. Some phase numbers are reused across roadmap revisions; section titles are authoritative.

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

## Phase 17 — Hashing performance: optional native xxhash (`@node-rs/xxhash`) with `xxhash-wasm` fallback

### 17.1 Add dependency + unify backend contract

* [x] Add `@node-rs/xxhash` as optional dependency (or hard dep if you accept platform constraints)
* [x] Create `src/shared/hash/xxhash-backend.js`:

  * [x] `hash64(buffer|string) -> hex16` (exact output format must match existing `checksumString()` + `checksumFile()`)
  * [x] `hash64Stream(readable) -> hex16` (if supported; otherwise implement chunking in JS)
* [x] Update `src/shared/hash.js`:

  * [x] Keep `sha1()` unchanged
  * [x] Route `checksumString()` / `checksumFile()` through the backend contract
  * [x] Preserve deterministic formatting (`formatXxhashHex`)

### 17.2 Introduce selector + telemetry

* [x] Add `PAIROFCLEATS_XXHASH_BACKEND=auto|native|wasm`
* [x] Emit backend choice in verbose logs (once)

### 17.3 Tests

* [x] Add `tests/xxhash-backends.js`:

  * [x] Assert `checksumString('abc')` matches a known baseline (record from current implementation)
  * [x] Assert `checksumFile()` matches `checksumString()` on same content (via temp file)
  * [x] If native backend is available, assert native and wasm match exactly
  * [x] If native is missing, ensure test still passes (skips “native parity” block)
* [x] Add script-coverage action(s)

**Exit criteria**

* [x] No change to bundle identity semantics (incremental cache stability)
* [x] `checksumFile()` remains bounded-memory for large files (streaming or chunked reads)

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

## Phase 9 — File processing & artifact assembly (chunk payloads/writers/shards)

**Reviewed snapshot:** `PairOfCleats-main` (zip import)  
**Scope driver:** `pairofcleats_review_section_3_files_and_checklist.md` (Section 3)  
**Review date:** 2026-01-12  

### Severity / priority scale

- **P0** — correctness, broken reads, data loss/corruption, or contract violations that can invalidate an index
- **P1** — determinism/stability, significant performance regressions, security/CI risks, or high-maintenance debt
- **P2** — cleanup, minor performance wins, refactors, and documentation improvements

---

## Executive summary

### P0 (must address)

- **Chunk-meta sharding cleanup bug can cause the loader to read stale shard data** when switching builds from sharded chunk-meta to non-sharded JSONL. This is because `loadChunkMeta()` prefers `chunk_meta.meta.json` / `chunk_meta.parts` over `chunk_meta.jsonl`. Current cleanup logic does not remove the sharded artifacts in the “jsonl, not sharded” path.  
  - Impact: **incorrect chunks, incorrect file mapping, confusing debug output, and potentially broken search** for any repo where a previous build produced `chunk_meta.meta.json` / `chunk_meta.parts`.  
  - Primary locus: `src/index/build/artifacts/writers/chunk-meta.js`.

- **Fast import scanning likely mis-parses `es-module-lexer` records** by treating `entry.d` as a module specifier string. In `es-module-lexer`, `d` is not a specifier (it is typically a numeric “dynamic import” marker). This can yield non-string imports (numbers), downstream crashes in normalization, and/or incorrect `fileRelations.imports` / `externalDocs`.  
  - Primary locus: `src/index/build/imports.js`.

- **Piece assembly can silently accept structurally-invalid inputs** because `validateLengths()` treats an empty list as “valid” even when the expected length is non-zero. This can produce assembled indexes with mismatched arrays (e.g., `docLengths`, embeddings vectors) without an early, actionable error.  
  - Primary locus: `src/index/build/piece-assembly.js`.

- **Piece assembly appears to drop the `comment` field in field postings/docLengths** (field tokens include `comment`, but assembly only merges `name/signature/doc/body`). If `comment` is enabled in fielded search, this can corrupt/disable that feature in assembled outputs.  
  - Primary locus: `src/index/build/piece-assembly.js` (and, secondarily, `src/index/build/postings.js` conventions).

### P1 (high-value next)

- **Determinism risks** (import link ordering; vocab ordering derived from `Map` insertion order; shard batch sorting ties; repo-map ordering) can cause noisy diffs and unstable IDs across builds even when inputs are unchanged.
- **Artifact manifest robustness**: `pieces/manifest.json` generation can silently record `null` checksums/bytes on error; this weakens contract guarantees and can hide partial artifact failures.
- **CI metadata hygiene**: `tools/ci-build-artifacts.js` records remote URLs; sanitize to avoid leaking credentials in CI logs/artifacts.

### P2 (cleanup / maintainability)

- Documentation drift (notably the claim that compressed payloads embed a `compression` field) and contract documentation gaps (assembled stage semantics, meta schema examples) should be corrected.
- Several low-risk performance wins are available (avoid `split('\n')` in hot paths; reduce repeated per-chunk work; minimize transient array concat).

---

### 9.1 Per-file processing correctness (Checklist A)

**Audit**

Reviewed the per-file pipeline as implemented in:

- `src/index/build/file-processor.js`
- `src/index/build/file-processor/*` (assemble/cached-bundle/chunk/incremental/meta/read/relations/skip/timings)
- Supporting callsites and artifacts emitted downstream: `src/index/build/artifacts.js`, `src/index/build/artifacts/file-meta.js`, and chunk-meta serialization (`src/index/build/artifacts/writers/chunk-meta.js`)
- Relevant tests in scope: `tests/file-processor/skip.test.js`, `tests/file-processor/cached-bundle.test.js`

Key pipeline stages observed:

1. Resolve file identity (`abs`, `relKey`) and caps → early skip checks
2. Load cached bundle (incremental) when enabled
3. Read + decode file; hash
4. Language context (registry), segment discovery, chunking
5. Comments extraction (optional) → comment-to-chunk assignment
6. Relations, docmeta, flow/meta enrichment (code mode)
7. Tokenization (main thread or worker), minhash, phrase/chargram sources
8. Embeddings attach (optional)
9. Assemble final chunk payloads + per-file relations → persist incremental bundle

**Gaps / issues**

#### Offsets: define and test offset units (byte vs. UTF-16 index)

- `start` / `end` offsets are produced and consumed as **JavaScript string indices** (UTF‑16 code units) throughout the file pipeline (`text.slice(c.start, c.end)` etc.).  
- The checklist explicitly calls out **byte offsets**. Current docs/contracts do not define the unit for `start`/`end`, which leaves room for misinterpretation and subtle bugs for non‑ASCII content.

**Why it matters**
- If any consumer assumes byte offsets (e.g., a non-JS reader, a tool that indexes into raw file bytes), chunks will be mis-sliced for multi-byte UTF‑8 sequences.

**Where to address**
- Primary: `src/index/build/file-processor.js` and `src/index/build/artifacts/writers/chunk-meta.js` (and docs under `docs/`).

#### Chunk boundary invariants are not asserted at the file-processor boundary

- `file-processor.js` assumes `chunkSegments()` returns non-overlapping, in-range chunks. It does not assert invariants such as:
  - `0 <= start <= end <= text.length`
  - monotonically increasing chunk ranges (or “overlap only when configured”)
  - “no accidental overlap” beyond configured overlap window
- This makes debugging chunking regressions harder: errors will surface downstream (postings build, artifact read) rather than at the boundary.

#### Skip reasons: observable coverage is incomplete

Covered / explicit:
- `oversize` (max bytes / max lines), `minified`, `binary`, `read-failure` (and `unreadable` via scan results)

Missing or ambiguous:
- **unsupported language** (no explicit skip reason visible in `file-processor.js` / `skip.js`)
- **parse / relation extraction failures**: most errors will currently throw and likely fail the build rather than record a per-file skip reason (no “parse-error” skip).

#### Provenance: per-file outputs are missing stable “content identity” fields

- Chunk payloads contain `file` (rel path), `ext`, and `lang`, which is good.
- `file_meta.json` contains `id`, `file`, `ext`, git metadata, etc.
- **Neither chunk meta nor file meta currently records a stable file content hash** (even though the pipeline already computes `fileHash` for incremental caching).

This makes post-hoc debugging harder:
- You cannot quickly tell whether a chunk came from a particular file revision without recomputing hashes from source.

#### Minor correctness nits

- Comment assignment edge: comments starting exactly at `chunk.end` can be assigned to the previous chunk due to a strict `<` comparison in `assignCommentsToChunks()` (`src/index/build/file-processor/chunk.js`).
- Timing accounting: `addParseDuration()` is invoked multiple times per file (parseStart and relationStart paths), which risks double-counting in aggregated metrics.

**Remaining work**

- [x] **Document offset units** for `start`/`end` (recommendation: define as UTF‑16 code-unit offsets, because that is what JS uses), and add at least one non‑ASCII regression test that validates:
  - [x] `text.slice(start, end)` reproduces the chunk text
  - [x] `offsetToLine()` aligns with `startLine/endLine` for multi-byte characters  
  (Files: `src/index/build/file-processor.js`, `docs/artifact-contract.md`, `docs/contracts/indexing.md`, plus a new/extended test)

- [x] Add **boundary asserts** (behind a dev/test flag if needed) after chunking:
  - [x] in-range checks (`0..text.length`)
  - [x] monotonic chunk ordering
  - [x] overlap detection (only allow configured overlap)  
  (File: `src/index/build/file-processor.js`)

- [x] Make **unsupported-language** behavior explicit and test-covered:
  - [x] decide: skip with reason `unsupported-language` vs. treat as `unknown` with generic chunking
  - [x] add test coverage for the chosen behavior  
  (Files: `src/index/build/file-processor.js`, `src/index/build/file-processor/skip.js`, tests under `tests/file-processor/`)

- [x] Add **parse-error** (and relation-error) per-file skip handling:
  - [x] catch and record failures from `lang.chunk`, `lang.buildRelations`, `lang.extractDocMeta`, `flow()`, etc.
  - [x] ensure the build can proceed when a single file fails (configurable)  
  (File: `src/index/build/file-processor.js`)

- [x] Add **file-level content hash** to `file_meta.json` (and optionally, to each chunk’s `metaV2`):
  - [x] store `hash` and `hashAlgo`
  - [x] ensure incremental and non-incremental builds agree  
  (Files: `src/index/build/file-processor.js`, `src/index/build/artifacts/file-meta.js`, `docs/artifact-contract.md`)

- [x] Fix the comment boundary condition in `assignCommentsToChunks()`:
  - [x] consider `<=` for boundary tests, or implement overlap-based assignment using comment `(start,end)`  
  (File: `src/index/build/file-processor/chunk.js`)

- [x] Audit and correct **timing double-counting** in `createTimingsTracker()` usage:
  - [x] ensure parseMs reflects one pass, and relation/flow have separate counters if desired  
  (Files: `src/index/build/file-processor.js`, `src/index/build/file-processor/timings.js`)

---

### 9.2 Artifact contract correctness (Checklist B)

**Audit**

Reviewed artifact write orchestration and contract touchpoints:

- Orchestration: `src/index/build/artifacts.js`
- Contract-level helpers: `src/index/build/artifacts/checksums.js`, `src/index/build/artifacts/compression.js`
- Writers: `src/index/build/artifacts/writers/chunk-meta.js`, `.../file-relations.js`, `.../repo-map.js`
- Schema docs: `docs/artifact-contract.md`, `docs/contracts/indexing.md`
- Guardrail tests: `tests/artifact-size-guardrails.js`, `tests/artifact-formats.js`, `tests/artifact-bak-recovery.js`

Confirmed:
- JSON and JSONL writers use `atomic: true` (temp + rename + `.bak` semantics) via shared JSON stream helpers.
- `pieces/manifest.json` is generated and includes checksums for files that can be read at generation time.
- Readers are designed to be backward compatible with older shapes (e.g., token shard files and meta shapes in `tests/artifact-formats.js`).

**Gaps / issues**

#### P0: Chunk-meta sharding cleanup is incomplete (stale shards override new JSONL)

- In `enqueueChunkMetaArtifacts()` (`src/index/build/artifacts/writers/chunk-meta.js`):
  - When `chunkMetaUseJsonl === true` and `chunkMetaUseShards === false`, the writer removes `chunk_meta.json` and `chunk_meta.json.gz`, but **does not remove**:
    - `chunk_meta.meta.json`
    - `chunk_meta.parts/`
- `loadChunkMeta()` prefers meta/parts if they exist, even if `chunk_meta.jsonl` exists. Therefore, stale shards can override a newly-written JSONL file.

#### Sharded directory atomicity remains “best effort” only

- Token postings shards: `artifacts.js` deletes and recreates `token_postings.shards/` and writes part files atomically, but the directory as a whole can still be left in a partial state if the process crashes mid-write (no staging directory + atomic rename).
- Chunk meta shards: similar; additionally, the parts directory is not cleared before writing, which can leave orphan part files.

This is not always fatal if readers rely solely on `meta.parts`, but it violates the “no partially-written states” intent of the checklist.

#### Manifest robustness: checksum/stat errors are swallowed

- `writePiecesManifest()` catches errors from `fs.stat` and `checksumFile` and records `bytes: null` / `checksum: null`, without failing the build or preserving error details.
- That makes it easy to produce an apparently “valid” manifest that cannot be validated later.

#### Documentation drift: compression description is inaccurate

- `docs/artifact-contract.md` claims the JSON payload contains a `compression` field when `.json.gz` is written. Current writers compress the raw JSON stream; they do not inject a `compression` field into the JSON object.

#### Contract clarity gaps

- The docs do not clearly document:
  - precedence rules when multiple formats are present (meta/parts vs jsonl vs json)
  - the on-disk schema for `token_postings.meta.json` and `chunk_meta.meta.json` (fields vs arrays vs legacy)
  - whether `.json.gz` is a sidecar (both present) or a replacement (only gz present)

**Remaining work**

- [x] **Fix chunk-meta cleanup** when `chunkMetaUseJsonl && !chunkMetaUseShards`:
  - [x] remove `chunk_meta.meta.json` if present
  - [x] remove `chunk_meta.parts/` if present  
  (File: `src/index/build/artifacts/writers/chunk-meta.js`)

- [x] Ensure shard writes do not accumulate orphan files:
  - [x] delete `chunk_meta.parts/` before writing new sharded parts (or write to staging dir + rename)
  - [x] confirm `token_postings.shards/` cleanup is complete on all branches  
  (Files: `src/index/build/artifacts/writers/chunk-meta.js`, `src/index/build/artifacts.js`)

- [x] Implement **directory-level atomicity** for sharded artifacts:
  - [x] write shards to `*.tmp/` directory
  - [x] atomically swap into place via rename (and optionally keep a directory-level `.bak`)  
  (Files: `src/index/build/artifacts/writers/chunk-meta.js`, `src/index/build/artifacts.js`)

- [x] Make manifest generation strict for required artifacts:
  - [x] either (a) fail the build on checksum/stat failure, or (b) record an `error` field and ensure validation tooling treats it as failure  
  (File: `src/index/build/artifacts/checksums.js`)

- [x] Update docs to match implementation:
  - [x] remove/adjust claim about `compression` field
  - [x] add schema examples for meta files (fields/arrays/legacy)
  - [x] document precedence rules for readers  
  (Files: `docs/artifact-contract.md`, `docs/contracts/indexing.md`)

- [x] Add a regression test that explicitly covers the stale chunk-meta shard override:
  - [x] build A: sharded chunk meta written
  - [x] build B: non-sharded jsonl written, ensure shards removed or ignored
  - [x] loader reads build B’s jsonl, not build A’s shards  
  (New test; or extend `tests/artifact-formats.js` / `tests/artifact-size-guardrails.js`)

---

### 9.3 Sharding / pieces / postings (Checklist C)

**Audit**

Reviewed:

- Shard planning: `src/index/build/shards.js` + tests (`tests/shard-plan.js`)
- Postings build: `src/index/build/postings.js`
- Tokenization primitives: `src/index/build/tokenization.js` + buffering tests (`tests/tokenization-buffering.js`)
- Piece assembly/merge: `src/index/build/piece-assembly.js` + test (`tests/piece-assembly.js`)
- Piece compaction tool: `tools/compact-pieces.js`

**Gaps / issues**

#### Determinism: import links and vocab ordering are under-specified

- **Imports / importLinks**:
  - `scanImports()` runs with concurrency and stores per-module Sets of importing files. The final arrays are not sorted.
  - `buildImportLinksFromRelations()` builds `importLinks` lists that may include the current file and are not explicitly sorted/deduped.
  - Result: output can vary based on processing order, which can vary with concurrency and scheduling.

- **Vocab ordering**:
  - `buildPostings()` converts multiple Maps to vocab arrays via `Array.from(map.keys())`.
  - This relies on Map insertion order being stable across builds. It often is, but it is not a strong contract and can be perturbed by changes in traversal order or parallelism.
  - Risk: **token IDs may shift across builds** even when inputs are unchanged, creating noisy diffs and complicating caching.

#### Postings canonicalization: sorted/canonical postings are assumed but not asserted

- Many consumers assume postings are in docId order and token vocab order is stable.
- There is no explicit “canonicalize and validate” step before writing postings, and few tests assert canonical ordering.

#### Piece assembly: field postings coverage mismatch + weak validation

- **Field postings merge omits the `comment` field** (see P0 summary).
- **validateLengths()** can silently allow missing arrays when expected > 0 (see P0 summary).
- Vocab arrays in assembly are also derived from Map insertion order; if input order differs, assembled token IDs can differ.

#### Shard planning: tie-break determinism should be explicit

- Some sorts are deterministic (by label, by relPath), but shard batching uses weight-based partitioning without explicit tie-breakers when weights are equal. This is likely stable in current Node versions, but should be explicitly stable to avoid cross-version drift.

**Remaining work**

#### Shard planning

- [x] Add explicit tie-breakers in shard batching and balancing when weights are equal:
  - [x] include `label` or `id` in comparator
  - [x] document determinism guarantees  
  (File: `src/index/build/shards.js`)

- [x] Add a “very large repo” synthetic shard-plan test:
  - [x] verifies bounded memory and time
  - [x] verifies stable shard labels/IDs across runs  
  (New test; extend `tests/shard-plan.js`)

#### Postings / tokenization

- [x] Canonicalize vocab ordering for stability:
  - [x] define canonical sort order (lexicographic; or localeCompare with explicit locale; or bytewise)
  - [x] apply consistently to token vocab, phrase vocab, chargram vocab, and field vocabs  
  (File: `src/index/build/postings.js` and any upstream postings-map builders)

- [x] Canonicalize and/or validate postings ordering:
  - [x] assert postings doc IDs are strictly increasing per token (or stable canonical order)
  - [x] assert vocab/postings arrays align and lengths match  
  (File: `src/index/build/postings.js`; plus tests)

- [x] Expand quantization tests to include:
  - [x] scale correctness
  - [x] dims mismatch handling
  - [x] doc/code embeddings “fallback to main embedding” behavior  
  (File: `tests/postings-quantize.js`)

#### Piece assembly

- [x] Fix `validateLengths()` to fail when expected > 0 and list is empty or mismatched:
  - [x] treat `[]` as invalid when `expected > 0`
  - [x] include artifact name + input dir in error message for fast triage  
  (File: `src/index/build/piece-assembly.js`)

- [x] Merge **all field postings present in inputs**, including `comment` (and any future fields):
  - [x] do not hardcode `name/signature/doc/body`
  - [x] merge based on keys present in `field_postings.json` / `field_tokens.json` or config  
  (File: `src/index/build/piece-assembly.js`)

- [x] Determinize assembly:
  - [x] sort `inputs` deterministically by path (or require stable input ordering and document it)
  - [x] sort merged vocabs (or guarantee stable order via canonicalization)
  - [x] ensure assembled output is byte-for-byte stable for same inputs  
  (Files: `tools/assemble-pieces.js`, `src/index/build/piece-assembly.js`)

- [x] Add a regression test: **assembled output equals monolithic output** for the same fixture:
  - [x] build monolithic index
  - [x] build two partial indexes (or reuse shards) and assemble
  - [x] compare chunk_meta + token_postings + manifest semantics  
  (New test; extend `tests/piece-assembly.js`)

- [x] Verify manifests list all required parts:
  - [x] ensure meta files are included and checksummed
  - [x] ensure shard part counts match meta.parts and manifest counts match meta totals  
  (Files: `src/index/build/artifacts/checksums.js`, tests)

---

### 9.4 Performance improvements to prioritize (Checklist D)

**Audit**

The current implementation is functional and reasonably structured, but several areas will become dominant costs on large repos:

- Per-file pipeline does multiple passes over the same data (chunking, tokenization, docmeta, lint/complexity).
- Artifact writing constructs full in-memory arrays for potentially huge artifacts and then serializes them.
- Some hot paths allocate transient arrays aggressively.

### High-impact improvements (prioritized)

#### Avoid “build huge arrays then serialize”

- `buildPostings()` currently materializes large `vocab` and `postings` arrays in memory.
  - [x] Add a streaming/sharded writer path that writes postings shards incrementally as postings are built (or at least allows releasing intermediate Maps earlier).
- `chunk_meta` estimation uses JSON.stringify samples, which is OK, but writing sharded JSONL still relies on iterators that materialize per-entry objects.
  - [X] Consider a “lightweight entry view” or direct JSONL streaming that avoids building large intermediate objects for fields not needed.

#### Reduce repeated parsing/enrichment passes

- Complexity + lint are computed in the per-chunk loop but cached per file; move the computation to a single per-file pre-pass to remove repeated cache checks.
- Where feasible, consider combining:
  - chunking + tokenization (tokenize the chunk as soon as you slice it, but avoid repeated slice work)
  - relations/docmeta extraction caching to avoid per-chunk repeated derived work

#### Minimize transient allocations

- Avoid `text.split('\n')` for context windows in `file-processor.js`. Use a line-scan utility that slices the relevant ranges without splitting the entire file.
- Replace repeated `array.concat()` in loops (e.g., `commentFieldTokens = commentFieldTokens.concat(tokens)`) with `push(...tokens)` or manual push for large arrays.
- In tokenization, buffer reuse is good, but `buildTokenSequence()` still clones arrays (`slice()`) each call. Confirm this is intentional and consider:
  - pre-sizing output arrays when token counts are known/estimable
  - returning typed arrays for `seq` where possible (if consumers permit)

**Remaining work**

- [x] Replace `split('\n')` usage in `src/index/build/file-processor.js` with a targeted line-scan helper.  
- [x] Move complexity/lint computation outside the per-chunk loop in `file-processor.js`.  
- [x] Reduce transient array concatenations in comment token aggregation.  
- [x] Explore a streaming postings writer for very large repos (phase-level refactor).  
- [x] Add at least one micro-benchmark or perf regression test covering:
  - piece assembly (`src/index/build/piece-assembly.js`)
  - piece compaction (`tools/compact-pieces.js`)

---

### 9.5 Refactoring goals (Checklist E)

**Audit**

Current state:
- Artifact writing is orchestrated from `artifacts.js` via `enqueueJsonObject/Array/Lines` + special-case writers (chunk meta writer).
- Schema definitions are implicit in “writer payload construction” and spread across multiple modules.
- Multiple identifiers exist (`chunk.id`, `metaV2.chunkId`, graph keys `file::name`), which increases the chance of accidental drift.

**Remaining work**

- [x] Introduce a single “artifact writer” abstraction with a consistent interface:
  - [x] `write(name, payload | iterator, { format, sharded, compression, pieceType })`
  - [x] built-in cleanup rules and directory-level atomic swaps
  - [x] standard metadata (version, generatedAt, schemaVersion)  
  (Impacts: `src/index/build/artifacts.js`, `src/index/build/artifacts/writers/*`)

- [x] Separate schema definitions from I/O:
  - [x] define schemas for artifacts in a central module (even if only via JS object contracts + comments)
  - [x] ensure docs mirror those schema definitions  
  (Impacts: `docs/artifact-contract.md`, `docs/contracts/indexing.md`)

- [x] Create a single canonical chunk-id generator and use it everywhere:
  - [x] prefer `metaV2.chunkId` (content-based) for graphs/relations keys instead of ad-hoc `file::name`
  - [x] ensure assembled and non-assembled builds produce identical chunkIds  
  (Impacts: `src/index/build/graphs.js`, and any code producing chunk identifiers)

---

### 9.6 Tests (Checklist F)

**Audit**

In-scope tests are generally helpful and cover:
- `.bak` recovery semantics (`tests/artifact-bak-recovery.js`)
- artifact precedence formats (`tests/artifact-formats.js`)
- size guardrails forcing sharding (`tests/artifact-size-guardrails.js`)
- shard planning (`tests/shard-plan.js`)
- shard vs non-shard equivalence (`tests/shard-merge.js`)
- quantization correctness (`tests/postings-quantize.js`)
- incremental tokenization caching (`tests/incremental-tokenization-cache.js`)

However, multiple tests are still existence/shape-heavy and do not verify semantic meaning deeply, especially around assembled outputs and import scanning.

**Gaps / issues**

- `tests/file-processor/cached-bundle.test.js` uses shapes for `allImports` and `codeRelations.calls` that do not match the likely real shapes; it can pass while not meaningfully validating correctness.
- No tests cover:
  - chunk-meta cleanup when switching formats (P0 issue)
  - compressed sidecar `.json.gz` artifacts and their `.bak` semantics
  - partial shard write behavior (meta missing, orphan parts, etc.)
  - import scanning correctness for dynamic imports / es-module-lexer record handling
  - deterministic `importLinks` ordering
  - perf regression for `compact-pieces` / `assembleIndexPieces`

**Remaining work**

- [X] Strengthen artifact format tests to assert semantic meaning:
  - [X] verify loader precedence (meta/parts vs jsonl vs json) in more combinations
  - [X] verify meta.parts path normalization and correctness

- [X] Add regression tests for atomic write failures:
  - [X] simulate rename failures (via dependency injection or controlled FS behavior)
  - [X] assert `.bak` fallback and cleanup behavior

- [X] Add regression tests for partial shard writes:
  - [X] parts written, meta missing
  - [X] meta references missing parts
  - [X] stale orphan parts do not affect reads

- [X] Add stress fixtures for large token/postings sets:
  - [X] ensure bounded memory / time
  - [X] ensure canonical ordering remains correct under stress

- [x] Add at least one perf regression test:
  - [x] compaction: `tools/compact-pieces.js`
  - [x] assembly: `src/index/build/piece-assembly.js`

- [x] Fix `tests/file-processor/cached-bundle.test.js` to use realistic shapes:
  - [x] `allImports` should be `{ [moduleName: string]: string[] }`
  - [x] `codeRelations.calls/usages` should match the real structure used by `buildRelationGraphs()` / `buildCallIndex()`  
  (File: `tests/file-processor/cached-bundle.test.js`)

---

## Appendix A: File-by-file findings

This section enumerates each in-scope file and lists file-specific items to address (beyond cross-cutting tasks already listed above).

### src/index/build/artifacts.js
- [x] (P1) Consider directory-level atomic swap for `token_postings.shards/` (staging dir + rename).
- [x] (P1) Normalize shard part paths to POSIX in any meta/manifest structures (avoid OS-separator leakage).
- [x] (P2) Consider sorting `pieceEntries` by `path` before writing the manifest to reduce diff noise.

### src/index/build/artifacts/checksums.js
- [x] (P1) Do not silently accept checksum/stat failures for required pieces; fail or record errors explicitly.

### src/index/build/artifacts/compression.js
- [x] (P2) Update docs to clarify that gzip is a sidecar (`.json` and `.json.gz` both exist).
- [X] (P2) Consider extending compression to sharded artifacts (optional future work).

### src/index/build/artifacts/file-meta.js
- [x] (P1) Make file ID assignment stable by sorting unique file paths before assigning IDs.
- [x] (P1) Add file content hash (and algo) and file size to `file_meta.json`.
- [X] (P2) Remove or rename `chunk_authors` in file meta (currently derived from the first chunk and not file-level).

### src/index/build/artifacts/filter-index.js
- [X] (P2) Consider persisting schema version/config hash in the filter index artifact for easier debugging.

### src/index/build/artifacts/metrics.js
- [X] (P2) Do not swallow metrics write errors silently (log or propagate based on severity).

### src/index/build/artifacts/token-mode.js
- [X] (P2) Make parsing more robust (case-insensitive modes; integer parsing + clamping).

### src/index/build/artifacts/writers/chunk-meta.js
- [x] (P0) Remove stale `chunk_meta.meta.json` and `chunk_meta.parts/` when writing non-sharded JSONL.
- [x] (P1) Clear or stage-swap `chunk_meta.parts/` when writing sharded output.
- [x] (P1) Normalize `meta.parts` entries to POSIX paths.
- [X] (P2) Consider normalizing field naming conventions (`chunk_authors` vs `startLine/endLine`).

### src/index/build/artifacts/writers/file-relations.js
- [X] (P2) Consider JSONL/sharding for very large `file_relations` outputs; add versioning metadata.

### src/index/build/artifacts/writers/repo-map.js
- [X] (P1) Ensure `exported` detection handles default exports correctly (depends on relations schema).
- [X] (P2) Consider sorting output by `{file, name}` for stability.

### src/index/build/file-processor.js
- [x] (P1) Add explicit boundary asserts for chunks after chunking.
- [x] (P1) Replace `split('\n')` with line-scan utility for context extraction.
- [x] (P2) Move complexity/lint to per-file scope; avoid repeated per-chunk cache checks.
- [x] (P2) Fix possible timing double-counting across parse/relation durations.
- [x] (P1) Add explicit unsupported-language and parse-error skip reasons (configurable).

### src/index/build/file-processor/assemble.js
- [x] (P1) Ensure field token fields written here (including `comment`) are consistently supported by postings and piece assembly.

### src/index/build/file-processor/cached-bundle.js
- [X] (P2) Validate cached bundle shapes more strictly; ensure importLinks shape is consistent.

### src/index/build/file-processor/chunk.js
- [x] (P2) Adjust comment-to-chunk assignment at boundary (`chunk.end === comment.start`) and consider overlap-based assignment.

### src/index/build/file-processor/incremental.js
- [X] (P2) Ensure cache invalidation includes schema/version changes for any artifact-impacting changes.

### src/index/build/file-processor/meta.js
- [x] (P2) Deduplicate `externalDocs` outputs; consider ordering for determinism.

### src/index/build/file-processor/read.js
- [X] (P2) Consider UTF-8 safe truncation (avoid splitting multi-byte sequences mid-codepoint).

### src/index/build/file-processor/relations.js
- [x] (P2) Consider sorting/deduping relation arrays (imports/exports/usages) for determinism.

### src/index/build/file-processor/skip.js
- [x] (P1) Add explicit unsupported-language skip reason (or document that unknown languages are processed).
- [X] (P2) Add coverage for `unreadable` and `read-failure` skip paths.

### src/index/build/file-processor/timings.js
- [x] (P2) Validate that parse/token/embed durations are not double-counted; document semantics.

### src/index/build/graphs.js
- [x] (P2) Prefer canonical `chunkId` keys where possible instead of `file::name` to avoid collisions.
- [X] (P2) Sort serialized node lists for full determinism (neighbors are already sorted).

### src/index/build/imports.js
- [x] (P0) Fix `es-module-lexer` import record handling (`entry.d` is not a specifier string).
- [x] (P1) Sort and dedupe `importLinks` deterministically; exclude self-links unless explicitly desired.
- [x] (P1) Ensure concurrency does not affect output ordering (sort module keys and file arrays before serialization).

### src/index/build/piece-assembly.js
- [x] (P0) Make `validateLengths()` strict when `expected > 0`.
- [x] (P0) Merge all field postings (including `comment`) and docLengths based on actual input keys.
- [x] (P1) Canonicalize vocab ordering in assembled outputs.
- [X] (P2) Remove redundant filterIndex construction (avoid double work; rely on writeIndexArtifacts).

### src/index/build/postings.js
- [x] (P1) Canonicalize vocab ordering (token/phrase/chargram/field) explicitly.
- [x] (P2) Validate docLengths are finite and consistent; avoid NaN avgDocLen.
- [x] (P2) Sort Object.entries() iteration for field postings and weights for deterministic output.

### src/index/build/shards.js
- [x] (P1) Add explicit tie-breakers in weight-based sorts/batching for determinism across runtimes.
- [X] (P2) Document heuristic thresholds (minFilesForSubdir, hugeThreshold, tenth-largest targets).

### src/index/build/tokenization.js
- [X] (P2) Review buffer reuse effectiveness (arrays are still cloned); consider pre-sizing and reducing transient allocations further.

### tools/assemble-pieces.js
- [x] (P1) Sort `inputDirs` by default (or add `--sort`) to ensure deterministic assembled output.
- [X] (P2) When `--force` is used, consider cleaning the output dir first to avoid stale artifacts.

### tools/ci-build-artifacts.js
- [x] (P1) Sanitize remote URLs before writing them to `manifest.json` to avoid leaking credentials.

### tools/ci-restore-artifacts.js
- [X] (P2) Optionally validate `pieces/manifest.json` checksums after restore (fast fail on corrupt artifacts).

### tools/compact-pieces.js
- [X] (P1) Consider directory-level atomic swap semantics (avoid rm+rename window).
- [X] (P2) Add perf regression harness and validate output equivalence post-compaction.

### tests/artifact-bak-recovery.js
- [X] (P2) Expand coverage to include: both primary and backup corrupt; json.gz sidecars; and cleanup expectations.

### tests/artifact-formats.js
- [X] (P1) Add explicit precedence test: sharded meta/parts must not override fresh jsonl when shards are stale (post-fix).

### tests/artifact-size-guardrails.js
- [X] (P2) Extend to cover: chunkMetaFormat=jsonl with switching shard/no-shard, and cleanup behavior.

### tests/artifacts/file-meta.test.js
- [X] (P1) Update test if file ID assignment is changed to sorted-by-path; assert stability across different chunk orders.

### tests/artifacts/token-mode.test.js
- [X] (P2) Add coverage for invalid modes, case-insensitive parsing, and maxTokens/maxFiles parsing edge cases.

### tests/clean-artifacts.js
- [X] (P2) Consider adding a check that `.bak` files are handled correctly (optional).

### tests/file-processor/cached-bundle.test.js
- [X] (P1) Fix test fixtures to use realistic `allImports` and `codeRelations` shapes, and assert semantic correctness (not only presence).

### tests/file-processor/skip.test.js
- [X] (P2) Add coverage for `unreadable` and `read-failure` paths (permissions, ENOENT races).

### tests/filter-index-artifact.js
- [X] (P2) Add a schema assertion for filter_index fields/versioning to prevent drift.

### tests/filter-index.js
- [X] (P2) Consider adding a determinism check for serialized filter index (same inputs => same output).

### tests/graph-chunk-id.js
- [X] (P2) Add a collision regression test for graph keys, or migrate to chunkId-based keys.

### tests/incremental-tokenization-cache.js
- [X] (P2) Add a second invalidation scenario (e.g., tokenization config changes that affect stemming/synonyms).

### tests/piece-assembly.js
- [X] (P1) Add semantic equivalence test vs monolithic build and add a determinism test (same inputs => identical assembled output).

### tests/postings-quantize.js
- [X] (P2) Extend to test scale and dims, and doc/code embedding behavior.

### tests/shard-merge.js
- [X] (P2) Consider adding checksum and manifest equivalence checks as well.

### tests/shard-plan.js
- [X] (P2) Add stress case coverage (many files, equal weights, perfProfile enabled).

### tests/tokenization-buffering.js
- [X] (P2) Consider adding a non-ASCII tokenization regression case.

### docs/artifact-contract.md
- [X] (P1) Fix compression description (no embedded `compression` field) and clarify `.json.gz` sidecar semantics.
- [X] (P1) Add explicit precedence rules (meta/parts vs jsonl vs json).
- [X] (P2) Add schema examples for meta files and `pieces/manifest.json`.

### docs/contracts/coverage-ledger.md
- [X] (P2) Add entries for new/critical tooling: `tools/assemble-pieces.js`, `tools/compact-pieces.js`, and CI artifact scripts.

### docs/contracts/indexing.md
- [X] (P1) Clarify which artifacts are “required” vs “optional/configurable” (e.g., minhash signatures).
- [X] (P1) Document sharded meta schema and loader precedence.

---

## Phase 10 — Index build orchestration review (findings + required fixes)

### Executive summary: highest-priority issues (fix first)

#### Correctness / functional

- [X] **Sharding path creates fresh worker pools + queues per shard work item, with no explicit teardown.**  
  This is very likely to cause thread/resource leaks, excessive pool creation overhead, and/or a build process that does not exit cleanly.  
  _Primary file:_ `src/index/build/indexer/steps/process-files.js`  
  _Related:_ `src/index/build/runtime/workers.js`, `src/index/build/worker-pool.js`

- [X] **`--mode all` behavior is inconsistent with “extracted-prose” + `records` expectations (tests + CLI surface).**  
  `tests/build-index-all.js` expects an `extracted-prose` index (and should be extended to expect a `records` index) to be produced for `--mode all`. `parseBuildArgs(...)` already resolves `modes` to include `extracted-prose` and must be updated to include `records`; however the CLI entry (`build_index.js`) discards the computed `modes` and delegates to the core build entry, which (in the current tree) resolves “all” differently.  
  _Primary file(s) in scope:_ `build_index.js`, `src/index/build/args.js`, `tests/build-index-all.js`  
  _Note:_ the root cause may live outside this section’s file list, but the mismatch is observable from the files in scope and should be corrected at the boundary.

- [X] **Watch debounce scheduler does not safely handle async `onRun` errors (risk of unhandled promise rejection).**  
  `createDebouncedScheduler(...)` calls `onRun()` without `await`/`.catch(...)`. In `watchIndex(...)`, `onRun` is async. Any unexpected throw/rejection (e.g., from lock release, filesystem exceptions) can become an unhandled rejection.  
  _Primary file:_ `src/index/build/watch.js`

#### Determinism / reproducibility

- [X] **Locale-dependent sorts in ordering-critical paths (`localeCompare`) should be replaced with deterministic lexicographic compares.**  
  Ordering drives chunk IDs, manifest key ordering, and shard planning stability; `localeCompare` can vary by ICU/locale.  
  _Primary files:_  
  - `src/index/build/indexer/steps/discover.js`  
  - `src/index/build/indexer/steps/process-files.js`  
  - `tools/shard-census.js`

#### Incremental correctness across versions

- [X] **Incremental cache signature likely needs a “tool/build schema version” component.**  
  Today, signature invalidation is strongly config-based. If tokenization/chunk schema/postings semantics change across releases without config changes, the cache can be reused incorrectly.  
  _Primary file:_ `src/index/build/indexer/signatures.js`  
  _Related:_ `src/index/build/incremental.js`, `tests/incremental-*.js`

---

### A. Pipeline mapping and boundaries

#### A.1 Current pipeline map (as implemented)

**Audit**

The index build pipeline, as observable from the files in scope, is structured as:

1. **CLI entry**
   - `build_index.js` → parses args and calls the core build entry with `argv` + `rawArgv`.

2. **Runtime construction**
   - `src/index/build/runtime.js` → `createBuildRuntime(...)`  
   - `src/index/build/runtime/runtime.js` → loads config(s), applies stage overrides (`runtime/stage.js`), resolves caps/guardrails (`runtime/caps.js`), ignore rules (`ignore.js`), concurrency and queues/pools (`runtime/workers.js`, `worker-pool.js`), crash logging (`crash-log.js`), and creates a build output root.

3. **Mode build orchestration**
   - `src/index/build/indexer.js` → `buildIndexForMode(...)` for each mode.
   - `src/index/build/indexer/pipeline.js` coordinates the build steps per mode.

4. **Per-mode pipeline stages**
   - **Discover**: `indexer/steps/discover.js` (uses `discover.js` + optional preprocessed discovery)  
   - **Incremental plan + whole-index reuse**: `indexer/steps/incremental.js` (wraps `incremental.js`)  
   - **Relations pre-scan**: `indexer/steps/relations.js` (`preScanImports`)  
   - **Estimate context window**: `estimateContextWindow(...)` (not in scope; used by pipeline)  
   - **Process files**: `indexer/steps/process-files.js`  
     - optional sharding plan execution
     - per-file chunking + postings accumulation + incremental bundle read/write
   - **Relations post-scan + cross-file inference**: `indexer/steps/relations.js` (`postScanImports`, `runCrossFileInference`)  
   - **Incremental manifest pruning**: `incremental.js` (`pruneIncrementalManifest(...)`)  
   - **Postings build**: `indexer/steps/postings.js`  
   - **Write artifacts**: `indexer/steps/write.js`  
   - **Optional**: enqueue embeddings job when using an external embeddings service (called from pipeline)

5. **Promotion**
   - `src/index/build/promotion.js` writes/updates a `current.json` pointer to a successful build root (promotion is performed outside the per-mode pipeline).

**Contract boundaries (recommended)**

- The pipeline currently “spans layers” in a few places:
  - CLI args parsing (“mode all”) and computed mode lists are not consistently treated as an API contract boundary.
  - Sharding logic (planning + execution) creates runtime sub-instances rather than remaining a pure scheduling layer.
  - Incremental state is mutated from multiple steps (process-files + relations cross-file inference updates).

These are workable, but they heighten the importance of clear contracts/invariants per stage.

---

#### A.2 Stage-by-stage contracts (inputs/outputs/invariants/errors/determinism)

> This section captures what the code *currently* does, plus what should be made explicit (and tested).

##### Stage: Discover

**Primary implementation**
- `src/index/build/indexer/steps/discover.js`
- `src/index/build/discover.js`

**Inputs**
- `runtime.root`, `runtime.ignoreMatcher`, `runtime.maxFileBytes`, `runtime.fileCaps`, `runtime.guardrails` (maxDepth/maxFiles), mode (`code`/`prose`/`extracted-prose`)
- Optional precomputed discovery bundle `{ entries, skippedFiles, lineCounts }` from preprocessing (if provided by orchestration layer)

**Outputs**
- `state.entries`: ordered list of discovered file entries
- `state.skippedFiles`: per-mode skips (plus common skips)
- Entries are annotated with `orderIndex` for deterministic downstream ordering

**Invariants**
- Entries must have:
  - `abs` absolute path
  - `rel` repo-relative path (POSIX form) with no `..`
  - `stat` with at least `size`, `mtimeMs`
- Deterministic ordering: sorting by `rel` must be stable and locale-independent.
- `skippedFiles` should preserve a stable ordering for reproducibility (currently sorted in discover.js).

**Error behavior**
- Per-file stat errors or size cap failures are recorded as skips, not fatal errors.
- Discover-level failures (e.g., inability to crawl filesystem) should throw and abort build.

**Determinism requirements**
- Must not use locale-sensitive comparisons (`localeCompare`) or OS-dependent casing assumptions.
- Normalize paths consistently (POSIX rel keys).

**Remaining work**
- [X] Replace locale-dependent sorting in `indexer/steps/discover.js` with deterministic compare (and document determinism requirement).
- [X] Consider adding `stat.isFile()` checks (defensive) before admitting entries (especially for non-git discovery paths).
- [X] Consider making “tracked-only” behavior explicit at the API boundary (discover uses `git ls-files` when root is a git repo root) and ensure watch mode semantics align (see Watch section).

---

##### Stage: Incremental plan / reuse

**Primary implementation**
- `src/index/build/indexer/steps/incremental.js`
- `src/index/build/incremental.js`
- `src/index/build/indexer/signatures.js`

**Inputs**
- `outDir` (mode-specific index output dir)
- `tokenizationKey` (derived from dict signature + tokenization/postings config)
- `cacheSignature` (derived from broader runtime feature/config surface)
- current discovered entries list + their `stat` for whole-index reuse decision

**Outputs**
- `incrementalState` with:
  - `manifest` (files, signature, tokenizationKey, bundleFormat, shards metadata)
  - `bundleDir` + bundle format
- `reused` boolean indicating full-index reuse (early exit)
- For per-file reuse, `readCachedBundle(...)` is used by file processor layer.

**Invariants**
- `manifest.files` keys represent the exact set of indexed files, keyed by deterministic relKey.
- Whole-index reuse must only return true if:
  - stage coverage is sufficient for requested stage
  - manifest key set matches current entries key set (including deletions)
  - size + mtime checks match for all files (or an approved hash fallback mechanism is used)
  - signature + tokenizationKey match

**Error behavior**
- Corrupt/missing manifest should fall back to “rebuild” (not crash).
- Bundle read failures should fall back to “recompute file” (not crash), unless explicitly configured otherwise.

**Determinism requirements**
- Signature computation must be stable (`stableStringify` is used).
- Manifest writing should be stable in structure and ordering (even if JSON object key order is mostly stable in practice).

**Remaining work**
- [X] Add an explicit “cache schema / tool version” component to `cacheSignature` (or a separate `cacheSchemaVersion` field checked alongside it).
- [X] Treat `manifest.version` as a compatibility gate (migrate or reset when unsupported); ensure `manifest.files` is validated as a *plain object* (not an array).
- [X] Decide whether whole-index reuse should allow hash fallback (currently it is strict on mtime/size) — if yes, add an opt-in and tests.

---

##### Stage: Process files (chunking + postings accumulation)

**Primary implementation**
- `src/index/build/indexer/steps/process-files.js`
- `src/index/build/state.js`
- `src/index/build/file-scan.js` (via file processor layer)
- `src/index/build/workers/indexer-worker.js` (worker pool tokenization)
- `src/index/build/worker-pool.js`, `src/index/build/runtime/workers.js` (pool + queue orchestration)

**Inputs**
- Ordered entries list with `orderIndex`
- Runtime config: tokenization config, postings config, feature flags, caps/guardrails, worker pool config, concurrency limits, sharding config
- Incremental state with manifest + bundle directory
- Optional import map from pre-scan stage

**Outputs**
- Mutated `state`:
  - `chunks` (+ `chunkMeta`)
  - `tokenPost`, `phrasePost`, `trigramPost`, `chargramPost`
  - `df`, `docLengths`, `fileRelations`, `importLinks`
  - `fileMeta` and `fileChunkMap`
  - `totalTokens`, `totalChunks`
  - `skippedFiles` additions for per-file failures
- `tokenizationStats` + `shardSummary` + `shardPlan` (for reporting and later artifact writing)
- Incremental manifest updates + bundle writes for non-cached files

**Invariants**
- Chunk IDs must be assigned deterministically and match the ordering derived from discovered entries (not processing completion order).
  - Current mechanism: `orderedAppender` ensures deterministic append order even with concurrency/sharding.
- Postings and DF must reflect the same token stream used to produce chunk meta.
- For cached files:
  - The cached bundle contents must be compatible with the current tokenizationKey/signature.
  - Cached chunks must be appended in the same deterministic order.

**Error behavior**
- Per-file failures: retry per `indexingConfig.fileRetries` (via `runWithQueue` retry handling); if ultimately failing, abort build (current behavior).
- Crash logging is best-effort (debug mode only).

**Determinism requirements**
- Ordering must not depend on concurrency, sharding, or locale settings.
- Any feature that modifies existing chunks (token retention “auto”, cross-file inference update) must be deterministic given the same inputs.

**Remaining work**
- [X] Fix sharding runtime lifecycle (see Section C/D): avoid creating worker pools per shard item; ensure explicit teardown; ensure sharding does not leak threads/handles.
- [X] Replace localeCompare usage in shard plan sorting with deterministic ordering.
- [X] Consider exposing and testing a “deterministic build mode” in which timestamps/build IDs do not affect artifact contents (at least for core artifacts).

---

##### Stage: Relations (import scan + cross-file inference)

**Primary implementation**
- `src/index/build/indexer/steps/relations.js`
- `src/index/build/feature-metrics.js` (for reporting)

**Inputs**
- `state.fileRelations` from per-file processing (and/or pre-scan)
- runtime feature flags:
  - `indexingConfig.importScan`
  - `typeInferenceEnabled`, `riskAnalysisEnabled`
  - `*CrossFileEnabled` flags
- incremental state (to update cached bundles after cross-file inference)

**Outputs**
- `state.importLinks` from `postScanImports`
- Optionally updated `state.chunks` and file metadata from `applyCrossFileInference`
- `graphRelations` structure for index artifacts
- Optional incremental bundle updates via `updateIncrementalBundlesWithChunks(...)`

**Invariants**
- importLinks should be stable given stable fileRelations + scan plan.
- If cross-file inference updates are applied:
  - updates must be reflected in persisted incremental bundles (or explicitly excluded)
  - index artifacts written later must correspond to the updated state.

**Error behavior**
- Import scan failures should degrade gracefully (ideally mark relations as unavailable and continue) unless configured otherwise.
- Cross-file inference failures should not leave state partially mutated; either apply atomically or abort.

**Determinism requirements**
- Import scan output ordering should be stable.
- Graph construction should be stable (avoid hash/map iteration nondeterminism in serialization).

**Remaining work**
- [X] Add tests ensuring cross-file inference updates are persisted into incremental bundles when enabled.
- [X] Clarify the artifact contract for `graphRelations` in `index_state.json` and ensure it is versioned.

---

##### Stage: Postings build

**Primary implementation**
- `src/index/build/indexer/steps/postings.js`

**Inputs**
- `state` with postings sets + DF + doc lengths + chunks
- `runtime.postingsConfig`, token retention configuration

**Outputs**
- A postings artifact structure ready for serialization (plus metrics like context window)
- Optional token retention adjustments applied to chunks (auto)

**Invariants**
- Postings must refer to valid chunk IDs.
- DF counts must align with unique tokens per doc.
- Token retention must not change postings/DF (only the retained token/gram arrays stored in chunks for downstream consumers).

**Error behavior**
- Failures should abort (postings are core artifact).

**Determinism requirements**
- Postings list ordering must be stable (e.g., chunk IDs sorted ascending).
- DF computation must not depend on processing order (it currently does not, provided chunk order is deterministic).

**Remaining work**
- [X] Add/verify tests around token retention “auto” switching (sample vs none) to ensure artifact stability and correctness.

---

##### Stage: Write artifacts + promotion

**Primary implementation**
- `src/index/build/indexer/steps/write.js`
- `src/index/build/promotion.js`
- `src/index/build/build-state.js` (build_state.json)

**Inputs**
- runtime + mode
- `state`, `postings`, `timing`, `entries`, `shardSummary`, `graphRelations`
- (promotion) build root + mode list

**Outputs**
- Mode-specific index directory:
  - `index_state.json`
  - chunk meta, file meta, postings, perf profile, feature metrics, relations graph
- Promotion pointer file:
  - `current.json` mapping mode → build root

**Invariants**
- Artifact writes should be atomic where practical.
- `index_state.json` must contain:
  - tool version + config hash
  - stage
  - tokenizationKey + cacheSignature (if incremental is enabled)
  - feature flags summary (for transparency)

**Error behavior**
- Any write failure should abort promotion; promotion must only occur after successful writes.

**Determinism requirements**
- Artifact contents (excluding timestamps) should be stable given stable inputs.
- Promotion pointer must not “flip” to a partial build.

**Remaining work**
- [X] Validate that `promotion.js` cannot write a `current.json` pointer that escapes the intended cache root (path traversal hardening).
- [X] Consider making build_state updates resilient to concurrent writes (or explicitly “best effort” with documentation).

---

### B. Incremental builds: deeper review

#### B.1 What is already solid

**Audit**

- Clear separation between:
  - tokenizationKey (tokenization + dictionary + postings surface)
  - cacheSignature (broader runtime feature surface)
- Per-file bundle read has a hash fallback mechanism to handle mtime/size mismatch scenarios (when a cached hash exists).
- Manifest pruning deletes bundles for deleted files (`pruneIncrementalManifest`).
- Whole-index reuse checks stage coverage and verifies manifest key set matches entries key set (including deletions) and validates per-file stat checks (`shouldReuseIncrementalIndex`).
- A dedicated test suite exists for:
  - signature invalidation (`tests/incremental-cache-signature.js`)
  - manifest updates (`tests/incremental-manifest.js`)
  - reuse semantics including deletions (`tests/incremental-reuse.js`)
  - incremental plan behavior (`tests/indexer/incremental-plan.test.js`)

#### B.2 Gaps / risks

**Remaining work (correctness + durability)**

- [X] **Cache invalidation across tool updates:** include a “tool version / schema version / algorithm version” in the incremental signature.  
  Suggested approach:
  - Add a `runtime.cacheSchemaVersion` constant (bumped on any semantic change), and include it in `buildIncrementalSignature(...)`.
  - Or include `runtime.toolInfo.version` (and document that caches are invalidated across versions).
- [X] **Manifest version compatibility:** enforce `manifest.version` compatibility explicitly; if unsupported, reset (and optionally delete bundles).  
  Also validate `manifest.files` is a plain object: `loaded.files && typeof loaded.files === 'object' && !Array.isArray(loaded.files)`.
- [X] **Bundle cleanup on invalidation:** when signature/tokenizationKey mismatches, consider deleting the bundles directory (or moving aside) to avoid disk bloat.
- [X] **Whole-index reuse strictness:** decide if whole-index reuse should support content-hash fallback for stat mismatch (opt-in).  
  If not, document that mtime/size must match exactly, and why (performance vs safety).
- [X] **Stage interactions:** confirm and test that:
  - stage1 builds do not reuse stage2 caches (signature should differ, but confirm)
  - stage2 builds do not reuse stage1 caches
  - stage4 behaviors are consistent (if stage4 writes different artifact sets)
- [X] **RelKey normalization:** ensure relKey generation is consistently POSIX and case-handled on Windows for both discovery and watch paths.

---

### C. Concurrency and robustness

#### C.1 Locking

**Audit**

- `src/index/build/lock.js` implements:
  - atomic lock acquisition via `fs.open(lockPath, 'wx')`
  - stale lock detection via pid + timestamp (and mtime fallback)
  - optional wait/poll to acquire lock

**Remaining work**
- [X] Ensure the lock file handle is closed even if `writeFile(...)` fails (use try/finally around the acquired `handle`).
- [X] Consider including `buildId` and `mode(s)` in the lock file payload to improve observability/debugging.
- [X] Add a test that simulates write failure during lock acquisition (can be done by injecting a stubbed fs layer, or by creating a read-only directory).

#### C.2 Sharding + queues + worker pools

**Audit**

- The pipeline uses a queue abstraction (`createTaskQueues`, `runWithQueue`) and worker pools (`Piscina`) to parallelize CPU-heavy tasks.
- Sharding aims to distribute work based on line counts / cost predictions, while preserving deterministic output ordering via an ordered appender.

**Remaining work (critical)**
- [X] **Do not create worker pools per shard item.**  
  Options (choose one):
  1) **Preferred:** share the parent runtime’s worker pools across all shards; only shard the scheduling/queueing.  
  2) If per-shard pools are required: create **one** shard runtime per shard worker (batch), reuse it for all work items in that batch, and **always** `destroy()` pools and tear down queues in a `finally`.
- [X] Add a regression test / harness that runs a sharded build and asserts the process exits promptly (no lingering worker threads).  
  Practical approach: spawn `node build_index.js ...` with `--shards.enabled` and ensure it exits within a timeout; also enable `--verbose` to detect repeated pool creation.
- [X] Audit `maxPending` sizing on queues in shard runtime creation; ensure it cannot exceed a safe bound when shard concurrency is high.

#### C.3 Watch mode robustness

**Audit**

- Watch mode uses chokidar and a debounce scheduler to coalesce changes.
- It maintains a tracked file set to decide whether removals/oversize transitions should trigger rebuilds.
- It always enables incremental to avoid full reindexing on every change.

**Remaining work**
- [X] Make `createDebouncedScheduler(...)` safe for async `onRun`:
  - wrap `onRun()` in `Promise.resolve(...).catch(...)`
  - optionally provide an `onError` callback
- [X] Ensure “extracted-prose only” watch mode is supported:
  - update `isIndexablePath(...)` to treat `extracted-prose` as **code-only** for extension filtering (do **not** treat as prose; `extracted-prose` must not re-index normal prose)
  - add coverage in `tests/watch-filter.js` (including a `.md` change that should *not* trigger when `modes=['extracted-prose']`)
- [X] Decide how to handle untracked file changes in git repos (discover is tracked-only):
  - either document that watch will trigger rebuilds but new untracked files will not be indexed
  - or add an optional “include untracked” mode for watch builds (with tests)

---

### D. Performance and scalability

#### D.1 Discovery and preprocessing overhead

**Audit**

- Discovery uses `git ls-files -z` when root is the git repo root, otherwise fdir crawl.
- It performs a per-file `fs.stat` in a sequential loop (async, but awaited one-by-one).
- Preprocess stage can scan file headers to detect binary/minified, and optionally count lines.

**Remaining work**
- [X] Parallelize `fs.stat` in discovery with a concurrency limit (e.g., 32) to reduce wall-clock time on large repos.
- [X] Consider using fdir’s `withStats()` to avoid a separate stat syscall for non-git discovery paths.
- [X] Ensure file-type detection does not misclassify common text types as binary (treat certain `application/*` mimes as text if needed).

#### D.2 Sharding overhead

**Audit**

- Sharding may require a full line-count pass (expensive) unless line counts are provided.
- Shard planning uses predicted cost from perf profiles when available.

**Remaining work**
- [X] Add an option to avoid full line counting when perf profile is available and sufficiently fresh (approximate weights).
- [X] Revisit per-shard file concurrency hard cap (`min(2, ...)`) — it can underutilize configured `runtime.fileConcurrency` on larger machines.
- [X] Avoid per-shard runtime creation (performance + correctness; see Section C).

#### D.3 Worker pool overhead

**Audit**

- Worker tasks validate cloneability of inputs/outputs for each task (deep scan with limits).
- Worker pool supports restart/backoff, and permanent disable on repeated opaque failures.

**Remaining work**
- [X] Gate cloneability validation behind a debug flag or environment variable; keep it on by default in CI/tests, off in production, or vice versa (choose explicitly).
- [X] Consider using transfer lists for large typed arrays in quantize tasks to reduce cloning overhead.
- [X] Add metrics to quantify:
  - pool restart frequency
  - clone-check overhead
  - task latency distribution

---

### E. Refactoring / code quality / test gaps

#### E.1 Duplication and clarity

**Audit**

- Multiple modules duplicate “max bytes per extension” logic and cap normalization:
  - `discover.js` has `resolveMaxBytesForExt`
  - `watch.js` has `maxBytesForExt`
  - `tools/shard-census.js` has its own normalization helpers
- Ordering uses both explicit `<` comparisons and `localeCompare` in different places.

**Remaining work**
- [X] Centralize “max bytes per extension” and “cap normalization” logic into a single helper module (likely `runtime/caps.js` or a shared `file-caps.js`) and reuse across discover/watch/tools.
- [X] Standardize ordering comparisons: provide a shared `compareRelPaths(a, b)` helper that is locale-independent and (optionally) Windows-case-aware.
- [X] Run formatter / lint pass on files with inconsistent indentation (not functionally wrong, but increases diff noise and review friction).

#### E.2 Tests to add or strengthen

**Remaining work**
- [X] **Build all modes:** Ensure `tests/build-index-all.js` reliably enforces that `--mode all` produces `code`, `prose`, `extracted-prose`, and `records` artifacts (and fix the orchestration boundary if currently inconsistent).
- [X] **Watch extracted-prose:** add a case to `tests/watch-filter.js` where `modes=['extracted-prose']` and confirm indexable file changes trigger scheduling.
- [X] **Watch async error safety:** add a test that uses an async `onRun` that rejects once, and assert no `unhandledRejection` occurs (attach a listener in the test).
- [X] **Sharding teardown:** add a harness test that enables sharding and asserts no lingering worker threads prevent exit.
- [X] **Incremental schema version:** add a test that simulates a tool version/schema version change and confirms caches are invalidated.

---

### File-by-file findings (actionable)

> Items below are intentionally concrete and file-scoped to minimize ambiguity.

#### `build_index.js`

- [X] Pass the resolved `modes` from `parseBuildArgs(...)` through to the build orchestrator (or otherwise guarantee that `--mode all` resolves identically at every boundary and includes `records`).  
  _Why:_ prevents drift between CLI arg parsing and internal orchestration; aligns with `tests/build-index-all.js`.

#### `src/index/build/args.js`

- [X] Consider adding `argv.modes` (or similar) so downstream layers do not need to re-derive the “all → modes” mapping (and so the CLI entry can pass a single object).

#### `src/index/build/build-state.js`

- [X] Document that `build_state.json` is best-effort and may lose updates under concurrent writers; or introduce an append-only/event model to prevent lost updates.
- [X] Consider `timer.unref()` on heartbeat interval for cases where build-state heartbeat should not keep the process alive (optional).

#### `src/index/build/crash-log.js`

- [X] Consider throttling `updateFile(...)` writes when debug crash logging is enabled (currently potentially writes state on every file).

#### `src/index/build/discover.js`

- [X] Add concurrency-limited parallel statting for large repos.
- [X] Add defensive `stat.isFile()` gating for non-git crawls.

#### `src/index/build/failure-taxonomy.js`

- No blocking issues found in scope; consider expanding taxonomy categories over time as needed.

#### `src/index/build/feature-metrics.js`

- No blocking issues found; consider adding an explicit schema version to metrics output to support future evolution.

#### `src/index/build/file-scan.js`

- [X] Treat certain `file-type` “application/*” results (e.g., json/xml) as potentially text, or ensure `file-type` is only advisory and always confirm with istextorbinary when in doubt.
#### `src/index/build/ignore.js`

- [X] Consider supporting nested `.gitignore` semantics for non-git discovery paths (optional, but improves parity with developer expectations).

#### `src/index/build/incremental.js`

- [X] Validate `manifest.files` is a plain object; reset if array/invalid.
- [X] Enforce manifest version compatibility; reset or migrate.
- [X] Consider deleting stale bundles on signature/tokenizationKey mismatch to avoid disk bloat.

#### `src/index/build/indexer.js`

- No major issues; ensure per-mode runtime mutations are intentional and documented.

#### `src/index/build/indexer/pipeline.js`

- [X] Ensure any ordering-critical sorts remain locale-independent (primary issue is in discover step; pipeline relies on it).
- [X] Consider explicitly documenting the per-mode stage graph and how it maps to artifacts and cache signature components.

#### `src/index/build/indexer/signatures.js`

- [X] Add cache schema / tool version component to `buildIncrementalSignature(...)`.
- [X] Consider adding explicit versions for:
  - chunk schema
  - postings schema
  - relations graph schema

#### `src/index/build/indexer/steps/discover.js`

- [X] Replace `localeCompare` sort with deterministic compare.
- [X] Avoid mutating shared entry objects if discovery is reused across modes (optional; low risk today, but cleaner).

#### `src/index/build/indexer/steps/incremental.js`

- [X] Add more granular status reporting (e.g., why reuse rejected) for observability; currently logs are decent but could be structured.

#### `src/index/build/indexer/steps/postings.js`

- [X] Add tests for token retention “auto” switching correctness and stability.

#### `src/index/build/indexer/steps/process-files.js`

- [X] Fix sharding runtime lifecycle (do not create per-work-item pools; ensure teardown).
- [X] Replace localeCompare in shard plan sorting with deterministic compare.
- [X] Revisit per-shard concurrency cap (min(2, ...)).
- [X] Consider hoisting shard runtime creation outside the inner work-item loop if per-shard runtime instances remain desired.

#### `src/index/build/indexer/steps/relations.js`

- [X] Add tests ensuring cross-file inference updates are persisted into incremental bundles when enabled.
- [X] Clarify error strategy for import scan failures (degrade vs abort) and encode it in tests/config.

#### `src/index/build/indexer/steps/write.js`

- [X] Ensure `index_state.json` always includes the correct cache signature / tokenizationKey values used for the build (especially when any runtime config is adapted per mode).

#### `src/index/build/lock.js`

- [X] Close file handle in a `finally` if write fails during lock acquisition.

#### `src/index/build/perf-profile.js`

- No major correctness issues; consider exporting a schema version.

#### `src/index/build/preprocess.js`

- [X] Document that preprocess is currently for `code` + `prose` only (or extend support to `extracted-prose` explicitly if desired).

#### `src/index/build/promotion.js`

- [X] Harden path handling so `current.json` cannot point outside `repoCacheRoot` even if inputs are malformed.

#### `src/index/build/runtime.js`

- No blocking issues found in scope.

#### `src/index/build/runtime/caps.js`

- No blocking issues found; consider consolidating cap normalization usage across tools.

#### `src/index/build/runtime/hash.js`

- No blocking issues found.

#### `src/index/build/runtime/logging.js`

- No blocking issues found; consider documenting the distinction between structured logs and progress logs.

#### `src/index/build/runtime/runtime.js`

- [X] Consider making the “tracked-only discovery” behavior visible in logs when git is used (helps users understand why new files may not be indexed).
- [X] Consider ensuring any per-mode adaptive config does not bleed across modes (currently low risk, but worth documenting).

#### `src/index/build/runtime/stage.js`

- No blocking issues found; stage overrides appear coherent and tested (`tests/build-runtime/stage-overrides.test.js`).

#### `src/index/build/runtime/tree-sitter.js`

- No blocking issues found in scope.

#### `src/index/build/runtime/workers.js`

- [X] Review queue pending-limit sizing with sharding enabled; ensure worst-case bounds are safe.

#### `src/index/build/state.js`

- No blocking issues found; consider adding explicit assertions/guards in merge functions to prevent mismatched id offsets if used elsewhere.

#### `src/index/build/watch.js`

- [X] Make debounce scheduler safe for async `onRun` (catch rejections).
- [X] Support `extracted-prose` as a mode for indexable path filtering.
- [X] Consider reducing rebuild churn from untracked files (optional).

#### `src/index/build/worker-pool.js`

- [X] Consider exposing a “debug clone checks” toggle (ties into worker validation overhead discussion).
- [X] Add optional transferList support for quantize tasks.

#### `src/index/build/workers/indexer-worker.js`

- [X] Gate cloneability validation behind a debug/config toggle if performance becomes an issue.

#### `tools/shard-census.js`

- [X] Replace `localeCompare` with deterministic compare for stable reporting.
- [X] Consider reusing shared cap/normalization utilities rather than duplicating.

#### Tests

##### `tests/build-index-all.js`

- [X] Ensure the build orchestration actually builds `extracted-prose` **and `records`** for `--mode all` (fix boundary mismatch if needed).

##### `tests/watch-filter.js`

- [X] Add an `extracted-prose`-only mode coverage case.
- [X] Add an async debounce safety test (unhandled rejection prevention).

##### `tests/worker-pool*.js`

- No immediate gaps; consider adding a perf regression test if clone checks are made optional.

---

### Deliverables

- [X] Fix sharding runtime lifecycle and add regression coverage.
- [X] Resolve “mode all” / extracted-prose / records mismatch and ensure `tests/build-index-all.js` passes reliably.
- [X] Harden watch debounce scheduling against async rejection.
- [X] Replace localeCompare sorts in ordering-critical paths.
- [X] Add a cache schema/tool version component to incremental signature and add a test for invalidation.

### Exit criteria

- [X] Sharded builds do not leak worker threads/handles and the process exits cleanly.
- [X] `--mode all` produces `code`, `prose`, `extracted-prose`, and `records` indices; validated by test.
- [X] Watch mode does not emit unhandled promise rejections under forced error paths.
- [X] Deterministic ordering is documented and enforced (no locale-dependent sorts in critical ordering paths).
- [X] Incremental cache reuse is safe across code releases (explicit schema/version invalidation).

---

## Phase 16 — Artifact compression upgrade: add Zstandard (`zstd`) alongside gzip

### 16.1 Add compression dependency

* [ ] Add `@mongodb-js/zstd` (recommended as optional dependency due to native bindings)
* [ ] Decide “streaming vs buffer-only” support:

  * [ ] If streaming is supported: implement streaming JSONL writers/readers
  * [ ] If buffer-only: restrict zstd to JSON object/array artifacts, keep JSONL as gzip (document clearly)

### 16.2 Introduce compression abstraction (avoid sprinkling `if (mode===...)` everywhere)

* [ ] Add `src/shared/compression.js`:

  * [ ] `compressBuffer(mode, buffer, level?)`
  * [ ] `decompressBuffer(mode, buffer)`
  * [ ] Optional stream helpers if supported
* [ ] Update `src/index/build/artifacts/compression.js`:

  * [ ] Expand `mode` validation: `gzip|zstd|none`
  * [ ] Keep current defaults unchanged (`gzip` or `null` based on existing config)
* [ ] Update `src/index/build/artifacts.js`:

  * [ ] Replace hard-coded `.json.gz` with extension derived from compression mode

    * [ ] gzip: `.json.gz`
    * [ ] zstd: `.json.zst` (or `.json.zstd`; pick one and standardize)
  * [ ] Ensure `compressionKeepRaw` behavior remains correct

### 16.3 Update readers/writers for new extensions

* [ ] Update `src/shared/artifact-io.js`:

  * [ ] Extend `resolveArtifactPath()` to check:

    * [ ] `<name>.json` then `<name>.json.gz` then `<name>.json.zst`
    * [ ] Also handle `.bak` variants for each
  * [ ] Extend `readJsonFile()` to decode zstd when applicable
* [ ] Update `src/shared/json-stream.js`:

  * [ ] Add zstd path for `writeJsonArrayFile()` / `writeJsonObjectFile()` when compression is requested
  * [ ] If JSONL is to support zstd: update `writeJsonLinesFile()` and `readJsonLinesArraySync()`

### 16.4 Update artifact contract + metrics

* [ ] Update `docs/artifact-contract.md`:

  * [ ] New allowed compression modes
  * [ ] New filename extensions
  * [ ] Backward compatibility statement (gzip still readable)
* [ ] Update `src/index/build/artifacts/metrics.js` to report `compression.mode=zstd`
* [ ] Update `docs/config-schema.json` to restrict/describe valid modes

### 16.5 Tests

* [ ] Add `tests/artifact-zstd-readwrite.js`:

  * [ ] Write a compressed artifact (zstd) using production writer
  * [ ] Read it with `readJsonFile()` and assert payload matches
* [ ] Extend `tests/artifact-bak-recovery.js` with a zstd variant:

  * [ ] `.json.zst` + `.bak` fallback behavior
* [ ] Add script-coverage action(s)

**Exit criteria**

* [ ] `loadIndex()` can transparently read `.json`, `.json.gz`, and `.json.zst` artifacts
* [ ] Existing gzip artifacts remain fully compatible
* [ ] Failure-mode behavior (`.bak` recovery) remains correct for new extensions

---

## Phase 1 — Test Gate Stabilization and Determinism

**Objective:** Make the current test suite reliable (non-flaky) and green, so subsequent refactors (security, caching, RPC hardening) have a trustworthy safety net.

1. **Fix failing Phase 22 gate: `type-inference-lsp-enrichment` (Python tooling return type missing)**

   * [x] **Broaden hover fallback conditions in LSP tooling providers so missing return types are recovered even when parameter types are present.**

     * **Why:** All three LSP tooling providers currently only fetch hover when *both* `returnType` is missing *and* `paramTypes` is empty. If a provider can parse param types from `documentSymbol.detail` but that string omits return type (a plausible LSP behavior), it will never attempt hover and will miss return types (exact symptom reported by the failing test).
     * **Where:**

       * `src/index/tooling/pyright-provider.js`

         * Current gating (too strict):
           `if (!info || (!info.returnType && !Object.keys(info.paramTypes || {}).length)) { ... hover ... }`
       * `src/index/tooling/clangd-provider.js` (same pattern)
       * `src/index/tooling/sourcekit-provider.js` (same pattern)
     * **Fix:**

       * Change hover fallback gating to trigger when **either** return type is missing **or** param types are missing, e.g.:

         * `if (!info || !info.returnType || !Object.keys(info.paramTypes || {}).length) { ... }`
       * Keep a small timeout override (already present) and consider a per-file/per-symbol hover cap if you want to prevent worst-case hover storms.
     * **Tests:**

       * Keep `tests/type-inference-lsp-enrichment.js` as the regression gate.
       * Add/adjust a focused unit/integration test fixture path where `documentSymbol.detail` omits return type but hover includes it (this directly validates the new behavior rather than relying on chance).
   * [x] **Validate stored tooling return types match exact expectations for Python (`str`)**

     * **Why:** The test asserts `entry.type === 'str'` (exact string match). Any normalization differences (e.g., `builtins.str`, `str:`) will fail.
     * **Where:** Return type extraction path:

       * `src/index/tooling/signature-parse/python.js` (`parsePythonSignature`)
       * `src/index/tooling/pyright-provider.js` (populating `entry.returns`)
       * `src/index/type-inference-crossfile/apply.js` (`addInferredReturn`)
     * **Fix:** Ensure the Python return type passed into `addInferredReturn()` is the normalized “plain” name the project expects (currently looks intended to already be `str`, but explicitly confirm by tests).

2. **Fix failing Phase 22 gate: `embeddings-dims-mismatch` (test is flaky due to cache file selection)**

   * [x] **Make the test select a cache entry that matches the identity it intends to mutate.**

     * **Why:** The cache directory can contain *multiple* caches for the same file hash/signature but different identity keys (e.g., stub embeddings default dims 384 from `build_index` stage vs. a subsequent `build-embeddings --dims 8`). The test currently mutates an arbitrary first file returned by `readdir`, which is OS/filesystem-order dependent, causing nondeterministic behavior (observed in `tests/phase22-logs/embeddings-dims-mismatch.js.log`).
     * **Where:** `tests/embeddings-dims-mismatch.js`

       * Current behavior: `const targetFile = cacheFiles[0];` (no filtering)
     * **Fix (recommended):**

       * Read all cache files, parse JSON, and select one whose `cacheMeta.identity.dims === 8` **and** `cacheMeta.identity.stub === true` (or match `cacheMeta.identityKey` computed from `buildCacheIdentity`).
       * Sort `cacheFiles` for determinism even after filtering.
     * **Tests:** The test itself is the gate; ensure it passes consistently on Windows/macOS/Linux.

3. **De-flake related embeddings cache test to prevent future intermittent failures**

   * [x] Apply the same deterministic cache selection strategy to `tests/embeddings-cache-identity.js`.

     * **Why:** It uses the same “first file” selection pattern and can fail depending on directory enumeration order and presence of other identity caches.
     * **Where:** `tests/embeddings-cache-identity.js`
     * **Fix:** Filter for identity matching the run’s intended dims/provider/stub flags (same as above), and sort before selecting.

4. **Add a “Phase 22 gate” smoke runner (optional but strongly recommended)**

   * [x] Create a single script to run only the gate tests and report failures clearly.

     * **Why:** Reduces time-to-signal and encourages frequent local verification during refactors.
     * **Where:** e.g., `tools/run-phase22-gates.js` or `npm run test:phase22`
     * **Exit expectation:** One command that deterministically reproduces CI gate results.

**Exit criteria**

* [X] `tests/type-inference-lsp-enrichment.js` passes.
* [X] `tests/embeddings-dims-mismatch.js` passes deterministically (no filesystem-order dependence).
* [X] `tests/embeddings-cache-identity.js` passes deterministically.

---

---

## Phase 11 — Extracted-Prose + Records end-to-end parity (build/search/stats/tests)

**Objective:** Make `extracted-prose` a first-class index mode (for extracted text such as code comments) and make `records` a first-class mode for log/record artifacts. Enforce deterministic, non-duplicative indexing across `code`, `prose`, `extracted-prose`, and `records`, and ensure `--mode all` includes all four.

### Observed failures driving this phase

- `📦  extracted-prose: 0 chunks, 0 tokens` during benchmark builds (unexpected; indicates missing extraction/discovery or incorrect pipeline wiring).
- Risk of normal prose content being re-indexed into `extracted-prose` (mode separation not strict enough).
- Comment text currently influences `code` mode search, duplicating content that should live in `extracted-prose`.
- Logs/records can exist anywhere in a repo; they must be detected and kept out of the other modes.

### 11.1 Define and enforce mode invariants

* [x] Document and enforce mode semantics in `docs/contracts/indexing.md`:
  * `code` indexes code bodies + structural metadata; **must not index comments as searchable text**.
  * `prose` indexes documentation/prose files (Markdown, text, etc.).
    * Any comments that exist inside prose files (e.g., HTML comments inside Markdown) remain in `prose`.
  * `extracted-prose` indexes **only extracted text** (comments/docstrings/config comments/etc.) sourced from **both** code and prose files.
    * **All comments are eligible** for extraction (default on), but extracted-prose must never contain the “normal prose body” of a prose file.
    * Implementation requirement: extracted-prose mode must only emit chunks for explicit extracted segments (no fallback that chunks the whole file).
  * `records` indexes log/record/triage artifacts; anything indexed in `records` must be excluded from other modes.
  * `all` == `{code, prose, extracted-prose, records}`.

* [x] Update build orchestration so `--mode all` truly means “all”:
  * `src/index/build/args.js`: expand `--mode all` to include `records`.
  * `src/integrations/core/index.js`: expand `mode === 'all'` to include `records` (do not re-derive modes inconsistently vs. `parseBuildArgs`).
  * Ensure stage3 embedding generation includes `extracted-prose` when enabled:
    * `src/integrations/core/index.js`: `buildEmbedModes` must include `extracted-prose` (and still exclude `records`).
  * Add/extend `tests/build-index-all.js` to assert `records` is built.

* [x] Update discovery + file processing so extracted-prose never re-indexes full prose:
  * Guarantee: a prose file with no extractable comment-like segments yields **0** extracted-prose chunks.
  * `src/index/build/file-processor.js`:
    * enforce `segmentsConfig.onlyExtras=true` for `mode === 'extracted-prose'` across all extensions
    * ensure no fallback path can chunk the full file body into extracted-prose
  * Add regression tests:
    * `.md` with only normal prose -> 0 extracted-prose chunks
    * `.md` with HTML comments (`<!-- ... -->`) -> extracted-prose chunks contain the comment text
    * comments remain searchable in prose (since they remain in prose) while also appearing in extracted-prose

* [x] Ensure stats + smoke tests are mode-aware:
  * Smoke test that builds all modes then runs:
    * `search.js --mode extracted-prose ...`
    * `search.js --mode records ...`
  * Ensure any stats tooling used in CI includes extracted-prose + records counts (non-zero when fixtures contain eligible content).

### 11.2 Comments: single source of truth in extracted-prose, displayed by default

* [x] Change the indexing contract so comment text is stored in one place:
  * `extracted-prose` chunk meta contains comment text/tokens/embeddings.
  * `code` chunk meta stores **references** to comment chunks/spans/IDs (no duplicated tokens).

* [x] Retrieval join contract (default-on):
  * `code` results **include** a comment excerpt by default by joining to `extracted-prose` via `(fileId, start, end)` and/or explicit `commentChunkIds`.
  * Add a flag to disable the join for performance debugging (e.g., `--no-comments` or `--comments=off`).
  * Ensure joins are lazy and bounded (do not load all extracted-prose chunks eagerly).

* [x] Implementation (gate behind a compatibility flag only if required):
  * `src/index/build/file-processor.js` / `src/index/build/file-processor/assemble.js`:
    * remove `fieldTokens.comment` population in code mode
    * attach comment references instead

* [x] Tests:
  * [x] Searching in `extracted-prose` finds doc comments for a code fixture.
  * [x] Searching in `code` does **not** match solely on comment text.
  * [x] Default retrieval output includes a comment excerpt for code results when the reference exists.

### 11.3 Records: detect logs/records anywhere and prevent cross-mode duplication

* [x] Define “records” as **log/record-like artifacts**, regardless of directory:
  * examples: build logs, test logs, stack traces, benchmark outputs, crash dumps, tool outputs.

* [x] Implement records detection + routing:
  * Add a classifier (path + content heuristics) used during discovery, e.g. `classifyFileKind(entry)`.
  * Heuristics should include:
    * extensions: `.log`, `.out`, `.trace`, `.stacktrace`, `.dmp`, `.gcov`, `.lcov`, etc.
    * path segments: `logs/`, `log/`, `out/`, `artifacts/`, `coverage/`, `tmp/`, `.cache/` (configurable)
    * lightweight content sniffing (bounded bytes): high timestamp density, stack-trace signatures, test runner prefixes.
  * Provide config overrides:
    * `records.detect` (default on)
    * `records.includeGlobs` / `records.excludeGlobs`

* [x] Enforce exclusion invariant:
  * any file classified into `records` is excluded from `code`, `prose`, and `extracted-prose`.

* [x] Tests:
  * [x] Place a log-like file in an arbitrary subdir (not under a dedicated `recordsDir`) and assert it indexes only under `records`.
  * [x] Add a regression test that prevents a records file from being double-indexed into `prose`.

### 11.4 Rust/prose mode isolation regression

* [x] Add a discovery/unit test that asserts `.rs` files are never included in `prose` discovery.
* [x] Add an integration smoke test that builds `prose` for a repo containing `.rs` and asserts zero `.rs` chunks exist in the prose index.

### 11.5 Critical dependency reference documentation completeness

* [x] Define the “critical dependency set” (runtime deps that are native, download/exec, security-sensitive, or historically fragile).
* [x] Add a CI-friendly tooling check that verifies each critical dependency has a corresponding reference document under `docs/references/dependency-bundle/deps/`.
* [x] For missing entries, add stub docs with:
  * purpose in PairOfCleats
  * supported platforms/constraints
  * security notes (native deps, downloads, binaries)
  * upstream reference links

### 11.6 Mode surface + observability parity (logs, stats, tooling)

* [x] Audit every place that enumerates modes (hard-coded `['code', 'prose']`, `code|prose|both|all`, etc.) and ensure:
  * `extracted-prose` + `records` are included where intended, **or**
  * the tool explicitly declares it only supports `code`/`prose` (and prints that once, clearly).

  Known call-sites to fix (non-exhaustive; start here):
  * Build orchestration:
    * `src/index/build/args.js`
    * `src/integrations/core/index.js`
  * Validators / artifact tools:
    * `src/index/validate.js` (defaults currently fall back to `['code', 'prose']`)
    * `tools/report-artifacts.js`
    * `tools/index-validate.js`
    * `tools/compact-pieces.js`
    * `tools/shard-census.js`
    * `tools/triage/context-pack.js`
  * Storage backend build tools (mode flags):
    * `tools/build-lmdb-index.js`
    * `tools/build-sqlite-index/*` (explicitly declare support set if it remains `code`/`prose` only)
  * Tests that assume only two modes:
    * `tests/discover.js`
    * `tests/preprocess-files.js`
    * `tests/watch-filter.js`

* [x] Update user-facing stats output to include extracted-prose wherever code/prose are shown:
  * `src/retrieval/cli/render.js` (`--stats` line): include `extracted-prose chunks=...` and `records chunks=...` when those indexes are present/enabled.
  * `build-index` final summary: ensure a per-mode summary line exists for all four modes (consistent order/labels).

* [x] Update tooling that reports/validates artifacts so it includes `extracted-prose` + `records` wherever it already includes `code` + `prose`:
  * `tools/report-artifacts.js` (validation should cover all built modes)
  * `tools/index-validate.js` (default should validate all available modes)
  * `src/index/validate.js` (default mode set)
  * `tools/shard-census.js` (mode loop)
  * `tools/triage/context-pack.js` and `tools/triage/ingest.js` (exports should include mode artifacts consistently)

* [x] Update benchmark reporting to surface these modes consistently:
  * `tools/bench/language/metrics.js` should either:
    * report `extracted-prose` + `records` metrics alongside `code` + `prose`, or
    * explicitly mark them as “not built / not available” (once, not per-row spam).

* [x] Normalize ordering + labels everywhere:
  * Stable order: `code`, `prose`, `extracted-prose`, `records`
  * Ensure all mode-summary lines and tables use the same order and consistent labels.

* [x] Add a focused smoke test that asserts user-facing output includes the new modes when present:
  * Build a fixture that contains:
    * a code comment (should produce `extracted-prose` chunks)
    * a prose file with an HTML comment (should also produce `extracted-prose` chunks, while remaining in prose)
    * a log-like file (should produce `records` chunks)
  * Assert the final build summary mentions both `extracted-prose` and `records`.
  * Assert `search.js --stats` output includes extracted-prose + records counts.

### 11.7 Prose-edge linking between symbols and comment chunks (deferred)

* [x] After parity is complete, add a lightweight “prose-edge” mechanism to associate:
  * files, classes, functions, and symbols
  * to one-or-more extracted-prose comment chunks
  * even when not physically adjacent (not necessarily a full graph edge).
* [x] Store as a separate artifact (e.g., `comment_links.jsonl`) so it can be recomputed without rewriting core chunk artifacts.
* [x] Retrieval should be able to surface linked comment chunks for a symbol/file without duplicating stored text.

**Exit criteria**

* [x] `build_index.js --mode all` deterministically builds `code`, `prose`, `extracted-prose`, and `records`.
* [x] `extracted-prose` contains extracted comment text for code files with comments.
* [x] No prose files are indexed into `extracted-prose` (unless explicitly enabled for comment-like segments).
* [x] Code index does not duplicate comment text; it references extracted-prose and displays excerpts by default.
* [x] Records do not duplicate across modes; records detection works for logs placed anywhere.
* [x] Tooling and stats that report per-mode results include `extracted-prose` + `records` (or explicitly mark them unsupported).
* [x] CI has a deterministic check for missing critical dependency reference docs.

---
## Phase 2 — Benchmark + build harness reliability (cache hygiene, shard progress determinism, disk-full resilience)

**Objective:** Make benchmark runs reproducible and prevent disk/memory blowups by managing caches, improving progress determinism, and failing fast with actionable diagnostics when the environment is insufficient.

### Observed failures driving this phase

- Duplicate/late progress counters during sharded builds, e.g.:
  - `[shard] 268/638 src/storage/sqlite/build-helpers.js`
  - `[shard] 268/638 src/storage/sqlite/incremental.js`
- `SqliteError: database or disk is full` during benchmark search/load.
- Benchmark cache growth causing giant artifact files and disk exhaustion.

### 2.1 Cache cleanup after each benchmarked repo

- [x] Update benchmark harnesses to **clean the repo cache after each repo** by default:
  - remove repo build directories (including incremental chunk artifacts and shard parts) and sqlite DBs under `benchmarks/cache/repos/...`
  - keep only benchmark results/baselines (and optionally a minimal build summary)
  - do **not** delete shared caches (downloads, extension caches, shared embedding caches); only repo-specific build outputs
- [x] Add a `--keep-cache` override for debugging.
- [x] Document this in `docs/benchmarks.md` (cache policy + disk sizing expectations).

### 2.2 Deterministic shard progress numbering

- [x] Pre-assign `fileIndex` for each work item **before** concurrent processing begins.
- [x] Ensure progress renderer never reuses the same `(index/total)` pair for different files in the same shard run.
- [x] Add a regression test that simulates concurrent progress events and asserts monotonically increasing fileIndex (running buildindex on the repo itself briefly should be sufficient to verify this)

### 2.3 Disk-full resilience for SQLite + artifact build steps

- [x] Add a preflight free-disk-space check before:
  - building sqlite indexes
  - copying/compacting sqlite DBs
  - writing large artifacts/shards
- [x] On insufficient space, fail fast with:
  - required bytes estimate (best-effort)
  - current free bytes
  - remediation steps (change cache dir, enable cleanup, reduce modes, reduce token retention)
- [x] Optional: if a repo fails due to disk full during benchmark runs, record failure and continue to next repo.

**Exit criteria**

- [x] Bench runs do not accumulate unbounded cache state across repos by default.
- [x] Sharded build progress numbering is stable and trustworthy.
- [x] Disk-full conditions are detected early with actionable messages rather than failing deep in sqlite reads.

---

## Phase 4 — Regression gate sweep (fix current failing tests)

**Objective:** Clear the currently failing regression gates so subsequent refactors (scalability, mode separation, security) have trustworthy signal.

**Status:** Phase archived; remaining failing tests and exit criteria moved to Phase 30 (Verification Gates).

---

## Phase 15 — Benchmarks, regression gates, and release hardening (prove the ROI)

### 15.1 Extend microbench suite (`tools/bench/micro/`)

* [x] Add `tools/bench/micro/watch.js`:
  * [x] Event storm simulation (if feasible) or synthetic scheduler load
* [x] Add `tools/bench/micro/regex.js`:
  * [x] Compare `re2js` vs `re2` on representative patterns/inputs
* [x] Add `tools/bench/micro/hash.js`:
  * [x] Compare wasm vs native checksum throughput
* [x] Add `tools/bench/micro/compression.js`:
  * [x] gzip vs zstd compress/decompress for representative artifact payload sizes
* [x] Add `tools/bench/micro/extractors.js`:
  * [x] PDF/DOCX extraction throughput and memory ceiling

### 15.2 Add “no-regression” assertions where it matters

* [x] Add deterministic snapshot tests (lightweight, not full golden files):
  * [x] Ensure chunk IDs stable across backends
  * [x] Ensure ordering stable under ties
* [x] Add metrics validation:
  * [x] `index-*.json` metrics reflect new compression/extractor options correctly

### 15.3 Documentation + UX polish

* [x] Update `README.md`:
  * [x] Mention PDF/DOCX support and how to enable/disable
  * [x] Mention optional performance backends and how `auto` works
* [x] Update `docs/external-backends.md` for Tantivy/LanceDB reality (what’s implemented vs planned)
* [x] Update `docs/mcp-server.md` for SDK migration

**Exit criteria**

* [x] Remaining verification gates moved to Phase 30 (Verification Gates).

---

## Phase 26 — Tantivy sparse backend (optional, high impact on large repos)

> This phase is intentionally split into “abstraction first” and “backend integration” to keep risk controlled.

### 26.1 Extract a sparse-retrieval interface

* [x] Create `src/retrieval/sparse/`:
  * [x] `types.js` contract: `search({ query, topN, filters, mode }) -> hits[]`
  * [x] `providers/sqlite-fts.js` wrapper around existing SQLite FTS ranking
  * [x] `providers/js-bm25.js` wrapper around the in-memory BM25 path

* [x] Update `src/retrieval/pipeline.js` to call the provider rather than direct sqlite/JS branching:
  * [x] Keep behavior identical as baseline
  * [x] Preserve determinism (stable tie-breaking)

### 26.2 Implement Tantivy integration (choose one operational model)

* [x] Choose packaging model (selected embedded N-API; sidecar deferred)

* [x] Add `src/retrieval/sparse/providers/tantivy.js`:
  * [x] Build query → execute → map results to `{ idx, score }`
  * [x] Support candidate-set filtering if feasible (or document it as a limitation and handle via post-filtering)

* [x] Add `tools/build-tantivy-index.js`:
  * [x] Consume existing artifacts (`chunk_meta`, token streams) and build tantivy index on disk
  * [x] Store alongside other indexes (e.g., under repo cache root)
  * [x] Consider incremental updates later; start with full rebuild

### 26.3 Config + CLI integration

* [x] Add config:
  * [x] `tantivy.enabled`
  * [x] `tantivy.path` (optional override)
  * [x] `tantivy.autoBuild` (optional)

* [x] Extend backend policy logic (see `src/retrieval/cli/backend-context.js` and backend-policy tests):
  * [x] Allow `--backend tantivy` (or `--sparse-backend tantivy`)
  * [x] Ensure `auto` fallback behavior remains predictable

### 26.4 Tests (gated if tantivy isn’t always available in CI)

* [x] Add `tests/tantivy-smoke.js`:
  * [x] Builds tantivy index for `tests/fixtures/sample`
  * [x] Executes a basic query and asserts hits are non-empty

* [x] Gate it behind env:
  * [x] `PAIROFCLEATS_TEST_TANTIVY=1` to run
  * [x] Otherwise test exits 0 with “skipped” message (match existing patterns in repo)

* [x] Add script-coverage action(s) that run it only when env flag is set (or mark as skipped in coverage if you keep strictness)

**Exit criteria**

* [x] Tantivy backend can be enabled without changing default behavior
* [x] Remaining performance gate moved to Phase 30 (Verification Gates).

---

## Phase 32 — Config/Flags/Env Hard Cut: Freeze contract + add enforcement (stop the bleeding)

**Objective:** Ensure the configuration surface simplification cannot regress during implementation by freezing the contract, introducing budgets, and enforcing them in CI.

**Strategic note:** This is a deliberate **breaking “hard cut”** (no deprecation period, no backwards compatibility layer). Confirm adoption of this contract before doing destructive deletions.

### 32.1 Define the “public surface” allowlists + budgets

* [x] Create `docs/config-contract.md` with an explicit whitelist of:
  * public repo config keys
  * public CLI flags
  * public env vars (secrets only)

* [x] In `docs/config-contract.md`, explicitly declare precedence order:
  * CLI flags > repo config > AutoPolicy > code defaults
  * env vars are secrets-only and are not in precedence for normal behavior

* [x] Create `docs/config-budgets.md` documenting numeric budgets + rationale:
  * config keys target: **2** (`cache.root`, `quality`) (optionally +`service.*` if needed)
  * env vars target: **1** (`PAIROFCLEATS_API_TOKEN`)
  * public CLI flags target: **15–25** across core commands

* [x] Encode naming conventions in the contract docs:
  * config keys: lowercase + structured (`cache.root`, `quality`)
  * CLI flags: kebab-case (`--cache-root`, `--explain`)
  * env vars: uppercase `PAIROFCLEATS_*` (secrets and deployment wiring only)

### 32.2 Make the config inventory actionable in CI

* [x] Extend `tools/config-inventory.js` to output:
  * totals (already)
  * **public vs internal/dev-only** classification for CLI flags (new)
  * allowlist drift report (new public keys/flags/env vars)

* [x] Add `npm run config:budget` (or equivalent) and wire into CI to fail when budgets are exceeded.

### 32.3 Enforce governance rules (anti-sprawl guardrails)

* [x] CI: fail if any `process.env.PAIROFCLEATS_*` is referenced outside the secrets env module (`src/shared/env.js`) in runtime code.

* [x] CI: fail if `docs/config-schema.json` contains unknown keys beyond the allowlist/budget.

* [x] CI: fail if the public CLI flag count exceeds budget (using the allowlist + inventory classifier).

* [x] Lint rule (or CI grep): ban `process.env.PAIROFCLEATS_*` usage outside `src/shared/env.js` (scope runtime, not tests).

* [x] Runtime: ensure `--explain` prints policy resolution (inputs + derived values) to reduce “why did it do that?” tickets.

### 32.4 “Adding a new knob” gating requirements (process)

* [x] Add a PR checklist/template requiring any new user-configurable setting to include:
  * justification (user intent vs tuning)
  * ownership (module owner)
  * single-plane design (config **or** CLI **or** env)
  * tests (unit + integration)
  * budget impact (must delete another knob if over budget)

**Exit criteria**

* [x] CI fails if public budgets are exceeded.
* [x] `docs/config-contract.md` and `docs/config-budgets.md` exist and match the intended end-state.

---

## Phase 33 — Config Hard Cut: Introduce MinimalConfig + AutoPolicy (policy-first wiring)

**Objective:** Land the new primitives first: a minimal config schema/loader and an AutoPolicy resolver. Subsequent deletions become “wire to policy” instead of “invent behavior.”

### 33.1 Minimal config schema (repo config)

* [x] Replace `docs/config-schema.json` with a minimal schema containing only:
  * `cache.root`
  * `quality` (`auto|fast|balanced|max`)

* [x] Unknown keys are **errors** (fail fast).

* [x] Update config tooling to the minimal schema:
  * [x] `tools/validate-config.js` validates only the minimal shape
  * [x] `tools/config-reset.js` emits minimal config only
  * [x] `tools/config-dump.js` dumps minimal config + derived policy (recommended)

### 33.2 Minimal config load path (centralized IO)

* [x] Update `tools/dict-utils.js:loadUserConfig()` to:
  * load `.pairofcleats.json`
  * validate against the minimal schema
  * return **only** the minimal config
  * remove fallback-to-tool-root config (unless explicitly retained and documented)

* [x] Enforce centralization rule:
  * only the config loader reads `.pairofcleats.json`
  * all other modules accept a plain options object (no direct config/env/argv reads)

### 33.3 AutoPolicy (resource-derived decisions)

* [x] Add `src/shared/auto-policy.js` with:
  * resource detection: CPU, RAM
  * fast repo scan: file count + size estimate (early-stop allowed)
  * capability detection hooks (native modules/extensions present)
  * outputs for: `quality`, concurrency, feature enablement, backend decisions

* [x] Implement a quality resolver (example mapping):
  * `fast` if `mem < 16GB` or `cpu <= 4`
  * `balanced` if `mem < 48GB` or `cpu < 12`
  * `max` otherwise
  * downgrade one level for “huge repos” (e.g., >200k files or >5GB scanned bytes)

* [x] Wire AutoPolicy creation into central entrypoints (without deleting old config reads yet):
  * [x] `tools/dict-utils.js` exports `getAutoPolicy(repoRoot, config)` (or similar)
  * [x] `bin/pairofcleats.js` passes policy into child scripts via args (preferred) rather than env

### 33.4 Contract tests

* [x] Add tests enforcing the new contract:
  * [x] unknown config key ⇒ error
  * [x] `quality=auto` resolves deterministically with mocked resources/repo metrics

  Suggested:
  * `tests/config/minimal-schema.test.js`
  * `tests/config/auto-policy.test.js`

**Exit criteria**

* [x] `pairofcleats config validate` only accepts minimal config.
* [x] AutoPolicy unit tests exist and pass.
* [x] No new knobs introduced during Phase 33.

---

## Phase 34 — Config Hard Cut: Remove profiles completely (delete the system)

**Objective:** Delete the profile control plane (files + env + flag + merge logic) to remove precedence confusion.

### 34.1 Delete profile artifacts

* [x] Delete the `profiles/` directory.
* [x] Remove profile references in docs (e.g., any “Experimental commands require profile=full”).

### 34.2 Remove profile logic from code

* [x] In `tools/dict-utils.js`, delete:
  * `PROFILES_DIR`
  * `loadProfileConfig`
  * `applyProfileConfig`
  * env/config/cli profile selection logic

* [x] In `src/shared/cli.js`:
  * [x] remove `profile` as a shared option
  * [x] remove automatic profile default injection

* [x] In `src/retrieval/cli-args.js`:
  * [x] remove `--profile`

### 34.3 Remove env var `PAIROFCLEATS_PROFILE`

* [x] Remove from `src/shared/env.js`.
* [x] Remove/replace any tests relying on profiles.

**Exit criteria**

* [x] No `profiles/` directory.
* [x] No references to `PAIROFCLEATS_PROFILE` or `--profile`.
* [x] Help text and docs no longer mention profiles.

---

## Phase 35 — Config Hard Cut: Remove env override plumbing (secrets-only env)

**Objective:** Eliminate the “second configuration system” implemented via env vars. Env is secrets/deployment wiring only.

### 35.1 Rewrite env module (secrets-only)

* [x] Replace `src/shared/env.js` with secrets-only access:
  * `getSecretsEnv()` returns `{ apiToken }`
  * remove parsing helpers for booleans/enums/numbers unless needed elsewhere

* [x] Enforce rule: no runtime behavior depends on env vars except secrets.

### 35.2 Replace `getEnvConfig()` call-sites

* [x] Remove/replace all call-sites of `getEnvConfig()` across index build, retrieval, tools, and tests.

  Strong checklist (non-exhaustive):
  * `src/index/build/file-processor.js` (progress flags)
  * `src/index/build/indexer/pipeline.js`
  * `src/index/build/indexer/steps/process-files.js`
  * `src/index/build/runtime/runtime.js`
  * `src/index/build/watch.js`
  * `src/integrations/core/index.js`
  * `src/integrations/core/status.js`
  * `src/retrieval/cli.js`
  * `src/retrieval/output/cache.js`
  * `src/shared/hash.js`
  * `tools/*` (cache-gc, clean-artifacts, config-dump, vector-extension, services, benches, etc.)
  * `tests/bench.js`

  Replacement strategy:
  * debug/diagnostic toggles ⇒ delete or move to `--explain`
  * perf/resource knobs ⇒ derive in AutoPolicy
  * behavior toggles (embeddings/backend/fts profile) ⇒ derive in AutoPolicy; delete user override

### 35.3 Delete env documentation

* [x] Rewrite `docs/env-overrides.md` to “Secrets only: `PAIROFCLEATS_API_TOKEN`.”
* [x] Remove mentions of env-driven profiles, embeddings toggles, thread knobs, watcher backends, etc.

### 35.4 Update config hashing determinism

* [x] Update `tools/dict-utils.js:getEffectiveConfigHash()` to:
  * exclude env-derived settings from the effective config hash
  * ensure artifact identity is driven by config + repo content + tool version

**Exit criteria**

* [x] No `PAIROFCLEATS_*` env vars used for behavior except `PAIROFCLEATS_API_TOKEN`.
* [x] `getEffectiveConfigHash()` is not sensitive to random env settings.
* [x] Docs reflect secrets-only env.

---

## Phase 36 — Config Hard Cut: Collapse public CLI flags to a strict whitelist

**Objective:** Remove flag sprawl and duplicated flags across scripts by making the public CLI surface strict and small.

### 36.1 Public command surface (whitelist)

* [x] Confirm the public commands are restricted to:
  * `setup`
  * `bootstrap`
  * `index build` / `index watch` / `index validate`
  * `search`
  * `service api`

* [x] Collapse the public flags to a whitelist (target contract):

  `pairofcleats index build`
  * `--repo <path>`
  * `--mode <code|prose|both>` (default `both`)
  * `--quality <auto|fast|balanced|max>`
  * `--watch` (optional)

  `pairofcleats index watch`
  * `--repo <path>`
  * `--mode <code|prose|both>`
  * `--quality <auto|fast|balanced|max>`

  `pairofcleats search "<query>"`
  * `--repo <path>`
  * `--mode <code|prose|both>`
  * `--top <N>` (default 5)
  * `--json`
  * `--explain`

  `pairofcleats service api`
  * `--host <host>` (default 127.0.0.1)
  * `--port <port>` (default 7345)
  * optional: `--repo <path>` only if required

### 36.2 Strict CLI dispatch + parsing

* [x] Update `bin/pairofcleats.js` to:
  * dispatch only the public commands
  * reject unknown commands
  * reject unknown flags
  * avoid passing through arbitrary args to internal scripts

* [x] Update per-command option parsing to accept only the whitelist:
  * [x] rewrite `src/retrieval/cli-args.js` (search)
  * [x] refactor `build_index.js` or `src/index/build/args.js` (index build/watch)

### 36.3 Collapse search filter flags

* [x] Replace dozens of search CLI flags with either:
  * query-language filters (preferred), OR
  * a single `--filter "<expr>"` flag

* [x] Implement a minimal filter parser (initially):
  * [x] `lang`
  * [x] `path`
  * [x] `type`

* [x] Remove per-filter CLI flags and simplify `src/retrieval/cli/normalize-options.js` accordingly.

* [x] Update `docs/search.md` / `docs/search-contract.md` to match the new mechanism.

### 36.4 Delete duplicated options across internal scripts

* [x] Remove duplicated flags like `--repo`, `--out`, `--json` from internal scripts once the CLI wrapper is strict.
* [x] Internal scripts accept explicit parameters from the wrapper (no ad-hoc CLI parsing).

**Exit criteria**

* [x] `pairofcleats --help` shows only the public commands.
* [x] Unknown flags error out.
* [x] Search filtering uses query filters or `--filter` (not dozens of flags).

---

## Phase 37 — Config Hard Cut: Remove user-configurable indexing knobs (wire indexing to AutoPolicy)

**Objective:** Delete `indexing.*` configurability by deriving values via AutoPolicy and making pipeline decisions internal.

### 37.1 Identify indexing config consumption points

* [x] Audit and remove config/env reads across (focus list):
  * `src/index/build/runtime.js`
  * `src/index/build/runtime/runtime.js`
  * `src/index/build/runtime/workers.js`
  * `src/index/build/indexer.js`
  * `src/index/build/file-processor.js`
  * `src/index/build/worker-pool.js`
  * `src/index/build/chunking/*`
  * `src/index/chunking/limits.js`

### 37.2 Thread policy values through indexing

* [x] Create an `IndexBuildContext` (or equivalent) that contains:
  * minimal `config`
  * derived `policy` (AutoPolicy)

* [x] Thread this context through build orchestration so downstream modules do not read config/env directly.

* [x] Delete or ignore now-unused indexing config keys (and remove them from inventory).

Concrete replacements:
* [x] Concurrency uses `policy.indexing.concurrency`
* [x] Embeddings enablement uses `policy.indexing.embeddings.enabled`
* [x] Chunking limits use `policy.indexing.chunking.*`
* [x] Worker pool sizing uses `policy.runtime.workerPool.*`

### 37.3 Remove stage toggles

* [x] Remove env `PAIROFCLEATS_STAGE`.
* [x] Remove config `indexing.stage` (and similar).
* [x] Make pipeline stage selection deterministic and fixed.

### 37.4 Operational behavior decisions (indexing-adjacent)

* [x] Ignore behavior is fixed:
  * always respect `.gitignore`
  * always respect `.pairofcleatsignore` if present
  * remove config keys like `useGitignore`, `usePairofcleatsIgnore`, `useDefaultSkips`, `ignoreFiles`, `extraIgnore`

* [x] Watcher backend is fixed:
  * default to `chokidar` (or internal auto)
  * remove `PAIROFCLEATS_WATCHER_BACKEND` and any config keys controlling it

### 37.5 Tests

* [x] Remove tests that assert behavior of deleted knobs.
* [x] Add tests asserting:
  * policy-derived concurrency is used
  * embeddings enablement is solely policy-driven

**Exit criteria**

* [x] No code reads `indexing.*` from user config.
* [x] Index build outcome is driven by AutoPolicy + repo inputs.
* [x] Test coverage exists for policy-driven decisions.

---

## Phase 38 — Config Hard Cut: Remove user-configurable search knobs (wire retrieval to AutoPolicy)

**Objective:** Delete `search.*` configurability and backend/scoring knobs. Retrieval becomes “one good default pipeline,” with only `--top`, `--json`, `--explain` remaining.

### 38.1 Remove backend selection knobs

* [x] Make retrieval always use SQLite indexes.
* [x] Delete backend selection flags from the public CLI:
  * `--backend`
  * `--ann-backend`
  * `--ann` / `--no-ann`

* [x] Any ANN usage is auto-detected by capabilities + policy.

### 38.2 Remove scoring knobs

* [x] Delete user-tunable scoring knobs:
  * `search.bm25.*` and `--bm25-*`
  * `--fts-profile`, `--fts-weights`
  * env `PAIROFCLEATS_FTS_PROFILE`

* [x] Replace with fixed scoring defaults.
* [x] Optional: policy switches by `quality` (fast/balanced/max), but not user-tunable parameters.

### 38.3 Cache knob removal

* [x] If `docs/query-cache.md` exposes user knobs, collapse to:
  * internal cache with fixed limits, OR
  * off-by-default if not essential

### 38.4 Tests

* [x] Add/adjust tests that assert behavior is policy-driven and does not depend on env/config overrides.

**Exit criteria**

* [x] No code reads `search.*` from config.
* [x] No user-facing backend/scoring knobs remain.
* [x] Search works with the default pipeline + optional explain output.

---

## Phase 39 — Config Hard Cut: Backend + extension simplification (LMDB kept, vector-extension config removed)

Note: LMDB kept and remains opt-in; vector extension config removed.

**Objective:** Simplify backend configuration while keeping LMDB available as an opt-in backend.

### 39.1 Keep LMDB support (user-visible, opt-in)

* [x] Retain LMDB build/runtime paths:
  * [x] `tools/build-lmdb-index.js`
  * [x] LMDB runtime modules
  * [x] `pairofcleats lmdb build` dispatch from `bin/pairofcleats.js`

* [x] Keep docs aligned with LMDB opt-in guidance (no extra config knobs).

### 39.2 Vector extension: auto only

* [x] Remove env `PAIROFCLEATS_VECTOR_EXTENSION`.
* [x] Remove config `sqlite.vectorExtension.*`.

* [x] Make extension lookup fixed to tool-managed directory:
  * `tools/download-extensions.js` installs into a known location
  * runtime checks presence and enables if available
  * never require user path overrides

* [x] Rewrite `docs/sqlite-ann-extension.md` to “auto only.”

**Exit criteria**

* [x] No LMDB code paths are part of the public surface.
* [x] Vector extension has no user-configurable paths; enablement is fully auto.

---

## Phase 40 — Config Hard Cut: Delete dead code/docs/tests and lock minimal surface (budgets + validation)

**Objective:** Remove everything that exists only to support deleted knobs and ensure the repo stays simplified.

### 40.1 Dead docs cleanup

* [x] Delete `docs/config-deprecations.md`.
* [x] Rewrite `docs/env-overrides.md` to secrets-only.
* [x] Rewrite or delete `docs/external-backends.md`.
* [x] Remove any remaining “profile=full required” references in docs.

### 40.2 Trim helper APIs

* [x] Trim `tools/dict-utils.js` exports to only what the remaining public CLI and build/search paths require.
* [x] Delete/move any remaining accessors that expose removed namespaces (`getRuntimeConfig`, `getModelConfig`, etc.).

### 40.3 Re-run and commit inventory

* [x] Run `node tools/config-inventory.js` and commit updated `docs/config-inventory.*`.
* [x] Confirm budgets and enforcement are green.

### 40.4 Add/keep “no new knobs” guardrails

* [x] CI scan: `PAIROFCLEATS_` usage restricted to secrets module (runtime code).
* [x] CI scan: schema key budget enforcement.
* [x] CI scan: public CLI flag budget enforcement.

### 40.5 Operational decisions (explicit hard cut)

* [x] Logging is fixed:
  * default log level `info`
  * only per-invocation overrides via `--json` / `--explain`
  * remove `logging.*` config namespace and env logging controls

* [x] Compression / hashing / regex engine selection is internal auto:
  * “best available” selection (native if present) is automatic
  * remove user knobs for selecting engines

### 40.6 Repeatable validation checklist

* [x] `pairofcleats index build` works on a representative repo with zero config.
* [x] `pairofcleats search "foo"` works and returns results.
* [x] `pairofcleats search --explain "foo"` prints derived policy decisions.
* [x] `node tools/config-inventory.js` reports:
  * config keys <= 5
  * env vars == 1
  * public CLI flags <= 25
* [x] Grep check: no usage of `PAIROFCLEATS_` outside secrets allowlist in runtime code.
* [x] CI green.

---


## Appendix A — Completed items (from PLAN_APPENDIX_A)

- setup: Create worktree: worktrees/appendix-a-sundial
- setup: Remove GIGAROAD/ROADMAP.md
- setup: Keep this plan updated after each completed task
- `src/index/build/artifacts.js`: (P1) Consider directory-level atomic swap for `token_postings.shards/` (staging dir + rename).
- `src/index/build/artifacts.js`: (P1) Normalize shard part paths to POSIX in any meta/manifest structures (avoid OS-separator leakage).
- `src/index/build/artifacts/checksums.js`: (P1) Do not silently accept checksum/stat failures for required pieces; fail or record errors explicitly.
- `src/index/build/artifacts/compression.js`: (P2) Update docs to clarify that gzip is a sidecar (`.json` and `.json.gz` both exist).
- `src/index/build/artifacts/file-meta.js`: (P1) Make file ID assignment stable by sorting unique file paths before assigning IDs.
- `src/index/build/artifacts/file-meta.js`: (P1) Add file content hash (and algo) and file size to `file_meta.json`.
- `src/index/build/artifacts/writers/chunk-meta.js`: (P0) Remove stale `chunk_meta.meta.json` and `chunk_meta.parts/` when writing non-sharded JSONL.
- `src/index/build/artifacts/writers/chunk-meta.js`: (P1) Clear or stage-swap `chunk_meta.parts/` when writing sharded output.
- `src/index/build/artifacts/writers/chunk-meta.js`: (P1) Normalize `meta.parts` entries to POSIX paths.
- `src/index/build/artifacts/writers/repo-map.js`: (P1) Ensure `exported` detection handles default exports correctly (depends on relations schema).
- `src/index/build/file-processor.js`: (P1) Add explicit boundary asserts for chunks after chunking.
- `src/index/build/file-processor.js`: (P1) Replace `split('\n')` with line-scan utility for context extraction.
- `src/index/build/file-processor.js`: (P1) Add explicit unsupported-language and parse-error skip reasons (configurable).
- `src/index/build/file-processor/assemble.js`: (P1) Ensure field token fields written here (including `comment`) are consistently supported by postings and piece assembly.
- `src/index/build/file-processor/skip.js`: (P1) Add explicit unsupported-language skip reason (or document that unknown languages are processed).
- `src/index/build/imports.js`: (P0) Fix `es-module-lexer` import record handling (`entry.d` is not a specifier string).
- `src/index/build/imports.js`: (P1) Sort and dedupe `importLinks` deterministically; exclude self-links unless explicitly desired.
- `src/index/build/imports.js`: (P1) Ensure concurrency does not affect output ordering (sort module keys and file arrays before serialization).
- `src/index/build/piece-assembly.js`: (P0) Make `validateLengths()` strict when `expected > 0`.
- `src/index/build/piece-assembly.js`: (P0) Merge all field postings (including `comment`) and docLengths based on actual input keys.
- `src/index/build/piece-assembly.js`: (P1) Canonicalize vocab ordering in assembled outputs.
- `src/index/build/postings.js`: (P1) Canonicalize vocab ordering (token/phrase/chargram/field) explicitly.
- `src/index/build/shards.js`: (P1) Add explicit tie-breakers in weight-based sorts/batching for determinism across runtimes.
- `tools/assemble-pieces.js`: (P1) Sort `inputDirs` by default (or add `--sort`) to ensure deterministic assembled output.
- `tools/ci-build-artifacts.js`: (P1) Sanitize remote URLs before writing them to `manifest.json` to avoid leaking credentials.
- `tools/compact-pieces.js`: (P1) Consider directory-level atomic swap semantics (avoid rm+rename window).
- `tests/artifact-formats.js`: (P1) Add explicit precedence test: sharded meta/parts must not override fresh jsonl when shards are stale (post-fix).
- `tests/artifacts/file-meta.test.js`: (P1) Update test if file ID assignment is changed to sorted-by-path; assert stability across different chunk orders.
- `tests/file-processor/cached-bundle.test.js`: (P1) Fix test fixtures to use realistic `allImports` and `codeRelations` shapes, and assert semantic correctness (not only presence).
- `tests/piece-assembly.js`: (P1) Add semantic equivalence test vs monolithic build and add a determinism test (same inputs => identical assembled output).
- `docs/artifact-contract.md`: (P1) Fix compression description (no embedded `compression` field) and clarify `.json.gz` sidecar semantics.
- `docs/artifact-contract.md`: (P1) Add explicit precedence rules (meta/parts vs jsonl vs json).
- `docs/artifact-contract.md`: (P2) Add schema examples for meta files and `pieces/manifest.json`.
- `docs/contracts/indexing.md`: (P1) Clarify which artifacts are "required" vs "optional/configurable" (e.g., minhash signatures).
- `docs/contracts/indexing.md`: (P1) Document sharded meta schema and loader precedence.

## Phase 18 - Safe regex acceleration: optional native RE2 (re2) with re2js fallback

### 18.1 Add dependency + backend wrapper

* [x] Add re2 (native) as an optional dependency (recommended)
* [x] Refactor src/shared/safe-regex.js into a backend-based module:
  * [x] Keep current behavior as the fallback backend (re2js)
  * [x] Add src/shared/safe-regex/backends/re2.js
  * [x] Add src/shared/safe-regex/backends/re2js.js (wrap existing usage cleanly)
* [x] Preserve existing safety constraints:
  * [x] maxPatternLength
  * [x] maxInputLength
  * [x] Guard flags normalization (only gimsyu supported as today)

### 18.2 Integrate selector + compatibility contract

* [x] Add createSafeRegex({ engine, ...limits }) selection:
  * [x] engine=auto uses re2 if available else re2js
  * [x] engine=re2 hard-requires native; if missing, warning + fallback to re2js
* [x] Validate behavioral parity:
  * [x] Ensure .exec() and .test() match expectations for g and non-g
  * [x] Ensure .lastIndex semantics are compatible

### 18.3 Update call sites

* [x] Verify these flows still behave correctly:
  * [x] src/retrieval/output/filters.js (file/path filters)
  * [x] src/retrieval/output/risk-tags.js (risk tagging)
  * [x] Any structural search / rulepack path using regex constraints

### 18.4 Tests

* [x] Add tests/safe-regex-engine.js:
  * [x] Conformance tests (flags, match groups, global behavior)
  * [x] Safety limit tests (pattern length, input length)
  * [x] Engine-selection tests (auto, forced re2js)
* [x] Add script-coverage action(s)

**Exit criteria**

* [x] No user-visible semantic regressions in filtering/risk-tagging
* [x] Engine auto is safe and silent (no noisy logs) unless verbose

---

## Phase 43 - Targeted test failures (manual run 2026-01-18)
**Objective:** Record failures from the targeted test run so they can be addressed once, then re-run.
### 43.1 Incremental cache signature
* [x] `tests/incremental-cache-signature.js`: resolved by switching the test-only config change to `indexing.lint` so the config signature changes without reintroducing removed knobs.
### 43.2 Incremental tokenization cache
* [x] `tests/incremental-tokenization-cache.js`: resolved by toggling `indexing.postings.enablePhraseNgrams` in the test-only config so the tokenization key changes without touching removed config knobs.
### 43.3 Smoke retrieval
* [x] `tests/smoke-retrieval.js`: updated help flag expectations and replaced RRF assertions with ANN presence checks for the new contract.

---

