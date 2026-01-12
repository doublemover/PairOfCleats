# PairOfCleats GigaRoadmap

Large architectural changes are explicitly permitted when they reduce defect surface area and/or materially improve throughput and durability. Confirm before you enact any large architectural changes!

## Status legend

Checkboxes represent “meets the intent of the requirement, end-to-end, without known correctness gaps”:

- [x] Implemented and appears complete/correct based on code inspection and existing test coverage
- [ ] Not complete **or** there is a correctness gap **or** there is a missing/insufficient test proving behavior

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

* [ ] `PairOfCleats: Search` command:

  * [ ] Prompt input panel for query
  * [ ] Optional toggles: code/prose/both, backend, limit
  * [ ] Execute `pairofcleats search ... --json`
* [ ] `PairOfCleats: Search Selection` command:

  * [ ] Uses selected text as query
* [ ] `PairOfCleats: Search Symbol Under Cursor` command

### 2.2 Results presentation

* [ ] Quick panel results:

  * [ ] Show `file:line-range`, symbol name, snippet/headline, score
  * [ ] Preserve stable ordering for repeatability
* [ ] On selection:

  * [ ] Open file at best-effort location (line/column)
  * [ ] Highlight match range (if available)
* [ ] Add optional “results buffer” view (for large result sets)

### 2.3 Quality-of-life UX

* [ ] Query history (per project)
* [ ] “Repeat last search” command
* [ ] “Explain search” (if supported by CLI flags / internal explain output)

### 2.4 Tests

* [ ] Add Node-level “search contract” tests:

  * [ ] Ensure `--json` output parseability and required fields
* [ ] Add plugin tests:

  * [ ] Search command dispatches correct subprocess args
  * [ ] Results parsing tolerates partial/missing optional fields

---


## Phase 3 — Index Lifecycle in Sublime (Build/Watch/Validate + Status)

### 3.1 Build index commands

* [ ] `PairOfCleats: Index Build (Code)`
* [ ] `PairOfCleats: Index Build (Prose)`
* [ ] `PairOfCleats: Index Build (All)`
* [ ] Stream progress to an output panel
* [ ] Persist “last index time” + “last index mode” in project cache

### 3.2 Watch mode integration

* [ ] `PairOfCleats: Index Watch Start`
* [ ] `PairOfCleats: Index Watch Stop`
* [ ] Prevent duplicate watchers per window/project
* [ ] Robust shutdown on Sublime exit / project close

### 3.3 Validate + repair affordances

* [ ] `PairOfCleats: Index Validate`
* [ ] Surface actionable failures (missing artifacts, invalid JSON, stale manifests)
* [ ] Provide “Open index directory” convenience command

### 3.4 Tests

* [ ] Node tests for index build/validate on fixtures
* [ ] Plugin tests for lifecycle commands and watcher gating

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

* [ ] **Inputs** (expected present after `index build`):

  * [ ] `file_relations.json` (imports, exports, usages, importLinks, functionMeta/classMeta)
  * [ ] `repo_map.json` (chunk-level symbol map, exported flag, signatures)
  * [ ] `chunk_meta.json` (docmeta/metaV2: signature/modifiers/returns/controlFlow/dataflow + relations)
  * [ ] `graph_relations.json` (importGraph/callGraph/usageGraph)
* [ ] Define “canonical IDs” used across the map:

  * [ ] `fileId = <repo-relative path>`
  * [ ] `symbolId = <file>::<symbolName>` (already used in relation graphs)
  * [ ] Stable IDs for anonymous/lambda cases (fallback: chunkId when name is `(anonymous)`)

---

### 4.2 Define a versioned “Map Model” schema (diagram-ready)

This is the core contract the plugin will consume.

* [ ] Create `docs/map-schema.json` (or similar) with:

  * [ ] `version`
  * [ ] `generatedAt`
  * [ ] `root` (repo root logical id)
  * [ ] `legend`:

    * [ ] `nodeTypes` (file/function/class/symbol)
    * [ ] `fileShapes` mapping (category → shape)
    * [ ] `functionBadges` mapping (modifier/returns/dataflow/control-flow → badge glyph)
    * [ ] `edgeTypes` mapping (imports/calls/usages/dataflow/aliases/mutations)
    * [ ] `edgeStyles` mapping (solid/dashed/dotted/double, arrowheads, labels)
  * [ ] `nodes`:

    * [ ] file nodes with nested “members” (functions/classes)
    * [ ] function nodes with structured “semantic facets”
  * [ ] `edges` (typed, labeled, optionally “port-addressable”)
* [ ] Schema must support **hierarchical nesting**:

  * [ ] File node has `members[]` with per-member ports
  * [ ] Member nodes (functions) include `signature`, `modifiers`, `returns`, `controlFlow`, `dataflow`
* [ ] Determinism requirements:

  * [ ] Stable ordering (sort keys/ids)
  * [ ] Explicit timestamp field allowed, but everything else must be deterministic

---

### 4.3 Build the semantic “map extractor” (core engine tool)

Implement a Node tool that reads index artifacts and produces the map model.

* [ ] Add `tools/code-map.js` (or `tools/report-code-map.js`) that:

  * [ ] Locates repo + index dirs using existing `tools/dict-utils.js`
  * [ ] Loads:

    * [ ] `file_relations.json`
    * [ ] `repo_map.json`
    * [ ] `chunk_meta.json` (or minimal subset)
    * [ ] `graph_relations.json`
  * [ ] Merges into a single “map model”:

    * [ ] **Files** classified into categories (drives file shape)
    * [ ] **Members** extracted per file:

      * [ ] functions/methods/classes (from `repo_map` and/or chunk meta)
      * [ ] include line ranges
      * [ ] include `signature`, `modifiers`, `params`, `returns`
    * [ ] **Function semantics**:

      * [ ] `dataflow.reads`, `dataflow.writes`, `dataflow.mutations`, `dataflow.aliases`
      * [ ] `controlFlow.branches/loops/returns/throws/awaits/yields/breaks/continues`
      * [ ] `throws`, `awaits`, `yields`, `returnsValue` facets surfaced explicitly
    * [ ] **Edges**:

      * [ ] Import edges (file→file) from `importLinks` + raw `imports`
      * [ ] Export edges (file→symbol) from `exports` + repo_map `exported`
      * [ ] Call edges (fn→fn) from `callLinks` or `graph_relations.callGraph`
      * [ ] Usage edges (fn→fn) from `usageLinks` or `graph_relations.usageGraph`
      * [ ] Dataflow edges:

        * [ ] Argument flow edges from `callSummaries.argMap` (caller→callee param ports)
        * [ ] Return flow edges using inferred return metadata where available
        * [ ] Optional: “state flow” edges when reads/writes/mutations overlap (guardrailed; see 28.6)
      * [ ] Alias edges:

        * [ ] derived from `dataflow.aliases` (function-local or cross-function via calls when resolvable)
* [ ] Add CLI entrypoint:

  * [ ] `pairofcleats report map` (preferred, consistent with existing `report` group), or
  * [ ] `pairofcleats map` (top-level)
* [ ] Support scope + size controls:

  * [ ] `--scope repo|dir|file|symbol`
  * [ ] `--focus <path or symbol>`
  * [ ] `--include imports,calls,usages,dataflow,exports`
  * [ ] `--only-exported`
  * [ ] `--max-files N`, `--max-members-per-file N`, `--max-edges N`
  * [ ] `--collapse file|dir` (aggregate mode)
  * [ ] `--format json|dot|svg|html` (see 28.4)

---

### 4.4 Generate “shape-based” diagrams (DOT-first, with nested function fills)

To match your “shape with fill containing functions” requirement cleanly, DOT/Graphviz is the most direct representation.

* [ ] Implement a DOT generator `src/map/dot-writer.js`:

  * [ ] **File nodes as outer shapes** with file-type-dependent shapes:

    * [ ] Source code: `box` or `component`
    * [ ] Tests: `box` with distinct border style
    * [ ] Config/data: `cylinder` or `hexagon`
    * [ ] Docs/prose: `note`
    * [ ] Generated/build artifacts: `folder` or `box3d`
  * [ ] **Fill represents members** using HTML-like labels:

    * [ ] Outer `<TABLE>` represents the file “container”
    * [ ] Each function/class is a row with a `PORT` so edges can land on that member specifically
  * [ ] **Nested shapes inside the function row** (HTML sub-tables/cells) to represent:

    * [ ] modifiers: async/static/generator/visibility
    * [ ] signature/params summary
    * [ ] returns/returnType/returnsValue indicator
    * [ ] dataflow mini-badges: reads/writes/mutates/aliases counts (and/or top N symbols)
    * [ ] controlFlow mini-badges: branches/loops/throws/awaits/yields
* [ ] **Edge encoding** (multiple edge “line types”):

  * [ ] Import edges: dashed file→file
  * [ ] Call edges: solid function→function (primary control flow)
  * [ ] Usage edges: thin/secondary style function→function
  * [ ] Dataflow edges:

    * [ ] dotted caller→callee(param) edges (argument flow)
    * [ ] dotted callee→caller edges for return flow (if inferred)
  * [ ] Mutation/state edges (optional, guardrailed): double-line or distinct style
  * [ ] Alias edges: dashed-dotted, labeled `alias: a=b`
* [ ] Output modes:

  * [ ] `--format dot` always available
  * [ ] `--format svg` if Graphviz present (shell out to `dot -Tsvg`)
  * [ ] `--format html` wraps SVG + legend into a standalone HTML viewer
* [ ] Implement legend rendering:

  * [ ] Either embed as a DOT subgraph or in HTML wrapper
  * [ ] Must document shape/edge meaning for users

---

### 4.5 Sublime Text 3 plugin commands for map generation + viewing

Provide first-class UX inside Sublime, even if rendering happens externally.

* [ ] Add commands:

  * [ ] `PairOfCleats: Map (Repo)`
  * [ ] `PairOfCleats: Map (Current Folder)`
  * [ ] `PairOfCleats: Map (Current File)`
  * [ ] `PairOfCleats: Map (Symbol Under Cursor)`
  * [ ] `PairOfCleats: Map (Selection)`
* [ ] Add a “Map Type” chooser:

  * [ ] Import Map
  * [ ] Call Map
  * [ ] Usage/Dependency Map
  * [ ] Dataflow Map (args/returns/state)
  * [ ] Combined Map (guardrailed by size limits)
* [ ] Implement output handling:

  * [ ] Write outputs to `.pairofcleats/maps/` (repo-local) or cache dir
  * [ ] Open `.dot` in Sublime for inspection
  * [ ] If `.svg`/`.html` produced:

    * [ ] Provide “Open in Browser” command (best-effort)
* [ ] Navigation affordances:

  * [ ] When a map is generated, also produce an indexable “node list” JSON:

    * [ ] allows Sublime quick panel “Jump to node” (file/function)
    * [ ] opens file at recorded `startLine`
* [ ] Graceful degradation:

  * [ ] If `astDataflow` / `controlFlow` metadata is unavailable in the index:

    * [ ] show “limited map” warning
    * [ ] offer action: “Rebuild index with dataflow/control-flow enabled” (invokes `index build` with the project’s config expectations)

---

### 4.6 Performance guardrails + scaling strategy (mandatory for real repos)

This phase will generate *very large graphs* unless explicitly constrained.

* [ ] Hard limits with user-overrides:

  * [ ] `maxFiles`, `maxMembersPerFile`, `maxEdges`
  * [ ] edge sampling policies per edge type
* [ ] Aggregation modes:

  * [ ] Directory-level aggregation (folder nodes contain files)
  * [ ] File-only map (no nested functions)
  * [ ] Export-only functions view
  * [ ] “Top-K by degree” (highest call/import fan-in/out)
* [ ] Deterministic sampling:

  * [ ] same inputs → same output (stable selection)
* [ ] Cache map builds keyed by:

  * [ ] index signature + generator options
* [ ] Failure mode policy:

  * [ ] If size exceeds limits, output a “truncated map” plus a summary explaining what was dropped

---

### 4.7 Tests (core + integration + determinism)

Add explicit automated coverage for the map feature.

#### Node tool tests (authoritative)

* [ ] `tests/code-map-basic.js`

  * [ ] Build a tiny fixture repo with:

    * [ ] imports/exports
    * [ ] functions calling other functions
    * [ ] a function with reads/writes/mutations/aliases
    * [ ] a function with branches/loops/throws/awaits
  * [ ] Run `build_index.js --stub-embeddings`
  * [ ] Run `pairofcleats report map --format json`
  * [ ] Assert:

    * [ ] file nodes exist
    * [ ] member nodes include `signature/modifiers/returns/dataflow/controlFlow`
    * [ ] edge sets include imports + calls
* [ ] `tests/code-map-dot.js`

  * [ ] Generate DOT output
  * [ ] Assert:

    * [ ] file “container” nodes exist
    * [ ] function rows/ports exist
    * [ ] edges connect to ports (caller fn → callee fn)
    * [ ] distinct edge styles appear for import vs call vs dataflow
* [ ] `tests/code-map-determinism.js`

  * [ ] Run map generation twice and compare outputs (ignore `generatedAt`)
* [ ] `tests/code-map-guardrails.js`

  * [ ] Generate a repo with many dummy functions
  * [ ] Ensure truncation behavior is correct and stable

#### Plugin-side tests

* [ ] Python unit tests:

  * [ ] command registration exists
  * [ ] subprocess args are correct for each map command
  * [ ] output paths computed correctly
  * [ ] “Graphviz missing” fallback behavior (DOT-only) works

---


## Phase 5 — Optional: Service-Mode Integration for Sublime (API-backed Workflows)

*(Renumbered from prior Phase 28; content largely unchanged, but consider adding map endpoints.)*

### 5.1 Map endpoints (if service mode is adopted)

* [ ] Extend `api-server` to support:

  * [ ] `GET /map?scope=...&format=...`
  * [ ] `GET /map/nodes?filter=...` for quick panels
* [ ] Sublime plugin optionally consumes the API for faster iteration

### 5.2 Tests

* [ ] API contract tests for map endpoints
* [ ] Sublime plugin integration tests (mock HTTP server)

---


## Phase 6 — Distribution Readiness (Package Control + Cross-Platform)

*(Renumbered from prior Phase 29.)*

* [ ] Packaging rules for ST3 (no compiled Python deps)
* [ ] Windows/macOS/Linux path + quoting correctness
* [ ] Document Graphviz optional dependency (for SVG/HTML rendering)
* [ ] Provide minimal “DOT-only mode” documentation

Tests:

* [ ] `python -m py_compile` over plugin package
* [ ] Cross-platform subprocess quoting tests (Node)

---


## Phase 7 — Verification Gates (Regression + Parity + UX Acceptance)

*(Renumbered from prior Phase 30.)*

* [ ] Parity checklist vs existing extension behaviors (where applicable)
* [ ] Deterministic outputs for map/search commands
* [ ] Performance acceptance criteria (map generation with guardrails)
* [ ] End-to-end smoke suite including:

  * [ ] index build
  * [ ] search
  * [ ] map generation (json + dot)
  * [ ] optional svg rendering when Graphviz available

---

### Notes on dependency leverage (aligned to the map phase)

This map phase is intentionally designed to **maximize reuse** of what the repo already has:

* Existing semantics extraction already provides the key fields you listed:

  * `imports/exports/usages/importLinks` via relations
  * `calls/callDetails` + cross-file `callLinks/usageLinks/callSummaries`
  * `signature/modifiers/returns` via docmeta/functionMeta
  * `reads/writes/mutations/aliases` via AST dataflow (when enabled)
  * `controlFlow` counts already present in docmeta/functionMeta
* Existing graph tooling:

  * `graphology`-backed `graph_relations.json` provides a strong base graph layer
* The missing piece is the **visual model + rendering/export** and **Sublime UX** around it, which Phase 28 supplies.


## Phase 8 — Test Gate Stabilization and Determinism

**Objective:** Make the current test suite reliable (non-flaky) and green, so subsequent refactors (security, caching, RPC hardening) have a trustworthy safety net.

1. **Fix failing Phase 22 gate: `type-inference-lsp-enrichment` (Python tooling return type missing)**

   * [ ] **Broaden hover fallback conditions in LSP tooling providers so missing return types are recovered even when parameter types are present.**

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
   * [ ] **Validate stored tooling return types match exact expectations for Python (`str`)**

     * **Why:** The test asserts `entry.type === 'str'` (exact string match). Any normalization differences (e.g., `builtins.str`, `str:`) will fail.
     * **Where:** Return type extraction path:

       * `src/index/tooling/signature-parse/python.js` (`parsePythonSignature`)
       * `src/index/tooling/pyright-provider.js` (populating `entry.returns`)
       * `src/index/type-inference-crossfile/apply.js` (`addInferredReturn`)
     * **Fix:** Ensure the Python return type passed into `addInferredReturn()` is the normalized “plain” name the project expects (currently looks intended to already be `str`, but explicitly confirm by tests).

2. **Fix failing Phase 22 gate: `embeddings-dims-mismatch` (test is flaky due to cache file selection)**

   * [ ] **Make the test select a cache entry that matches the identity it intends to mutate.**

     * **Why:** The cache directory can contain *multiple* caches for the same file hash/signature but different identity keys (e.g., stub embeddings default dims 384 from `build_index` stage vs. a subsequent `build-embeddings --dims 8`). The test currently mutates an arbitrary first file returned by `readdir`, which is OS/filesystem-order dependent, causing nondeterministic behavior (observed in `tests/phase22-logs/embeddings-dims-mismatch.js.log`).
     * **Where:** `tests/embeddings-dims-mismatch.js`

       * Current behavior: `const targetFile = cacheFiles[0];` (no filtering)
     * **Fix (recommended):**

       * Read all cache files, parse JSON, and select one whose `cacheMeta.identity.dims === 8` **and** `cacheMeta.identity.stub === true` (or match `cacheMeta.identityKey` computed from `buildCacheIdentity`).
       * Sort `cacheFiles` for determinism even after filtering.
     * **Tests:** The test itself is the gate; ensure it passes consistently on Windows/macOS/Linux.

3. **De-flake related embeddings cache test to prevent future intermittent failures**

   * [ ] Apply the same deterministic cache selection strategy to `tests/embeddings-cache-identity.js`.

     * **Why:** It uses the same “first file” selection pattern and can fail depending on directory enumeration order and presence of other identity caches.
     * **Where:** `tests/embeddings-cache-identity.js`
     * **Fix:** Filter for identity matching the run’s intended dims/provider/stub flags (same as above), and sort before selecting.

4. **Add a “Phase 22 gate” smoke runner (optional but strongly recommended)**

   * [ ] Create a single script to run only the gate tests and report failures clearly.

     * **Why:** Reduces time-to-signal and encourages frequent local verification during refactors.
     * **Where:** e.g., `tools/run-phase22-gates.js` or `npm run test:phase22`
     * **Exit expectation:** One command that deterministically reproduces CI gate results.

**Exit criteria**

* [ ] `tests/type-inference-lsp-enrichment.js` passes.
* [ ] `tests/embeddings-dims-mismatch.js` passes deterministically (no filesystem-order dependence).
* [ ] `tests/embeddings-cache-identity.js` passes deterministically.
* [ ] No new flaky tests introduced (verified via at least 5 repeated local runs on one platform, and ideally at least one Windows run).

---


## Phase 9 — Security and Input-Hardening (Local Servers + Indexing)

**Objective:** Close high-impact vulnerabilities and unsafe defaults that could be exploited when indexing untrusted repositories or exposing the local API server beyond localhost.

1. **Prevent symlink-based repo escape during discovery/indexing**

   * [ ] **Stop following symlinks when discovering and stat’ing files.**

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
   * [ ] **Ensure downstream file reads cannot accidentally follow symlinks even if discovery misses one.**

     * **Why:** Defense-in-depth; discovery should prevent it, but a second gate at file-read time reduces risk.
     * **Where:** `src/index/build/file-processor.js` and any shared read helpers (e.g., `src/shared/encoding.js` `readTextFileWithHash`)
     * **Fix:** If feasible, check `lstat` before read in the pre-read stage (or pass `lstat` results from discovery and enforce “no symlink reads”).

2. **Lock down API server defaults (CORS, repo selection, and exposure)**

   * [ ] **Remove unconditional permissive CORS (`Access-Control-Allow-Origin: *`) or make it explicitly opt-in.**

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
   * [ ] **Add authentication for non-localhost bindings (or always, with a “dev disable” escape hatch).**

     * **Why:** The API allows expensive operations (search) and can access the filesystem via repo selection (see next item). This should not be anonymous if reachable from other machines.
     * **Fix:**

       * Support a bearer token header, e.g. `Authorization: Bearer <token>` with `PAIR_OF_CLEATS_API_TOKEN` env var.
       * If `host` is not `127.0.0.1/localhost`, require token by default.
   * [ ] **Restrict `repoPath` override in API requests (prevent arbitrary filesystem indexing/search).**

     * **Why:** Current API accepts a request body that can set `repoPath`, and then resolves and operates on that directory. Without an allowlist, this is arbitrary directory read/search capability.
     * **Where:** `tools/api/router.js` `resolveRepo(value)` and usage in `/search`, `/status`, `/stream/search`.
     * **Fix options:**

       * Option A (strict): disallow `repoPath` in request; only use the server’s configured repo.
       * Option B (allowlist): allow only if within a configured set of allowed roots (`api.allowedRepoRoots`), enforced by realpath boundary checks.
     * **Tests:**

       * Confirm requests with disallowed repoPath return 400/403.
       * Confirm allowed repo paths still work.

3. **Harden API request body parsing and limits**

   * [ ] **Replace string concatenation body parsing with byte-safe buffering and strict size enforcement.**

     * **Why:** Current `parseBody` in `tools/api/router.js` does `data += chunk` and uses `data.length` (characters, not bytes). This is less reliable and can be slower for large payloads due to repeated string reallocations.
     * **Fix:**

       * Accumulate Buffers in an array; track `byteLength`.
       * Enforce a hard cap in bytes (e.g., 1 MiB configurable).
       * Only decode once at the end.
   * [ ] **Validate `Content-Type` for JSON endpoints.**

     * **Why:** Avoid ambiguous parsing and reduce attack surface.
     * **Fix:** Require `application/json` for POST bodies on `/search` and stream endpoints (except where intentionally flexible).

**Exit criteria**

* [ ] Indexing does not follow symlinks by default (tested with a symlink fixture).
* [ ] API no longer emits permissive CORS headers by default.
* [ ] API requests cannot arbitrarily set `repoPath` unless explicitly allowed/configured.
* [ ] API body parsing is byte-safe and enforces a clear, tested size limit.

---


## Phase 10 — RPC Robustness and Memory-Safety (LSP + MCP + JSON-RPC)

**Objective:** Prevent unbounded memory growth and improve resilience when communicating with external processes (LSP servers, MCP transport), including malformed or oversized JSON-RPC frames.

1. **Implement `maxBufferBytes` enforcement in framed JSON-RPC parser**

   * [ ] **Enforce `maxBufferBytes` in `createFramedJsonRpcParser`.**

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
   * [ ] **Add explicit tests for oversized frames.**

     * **Where:** Add a new unit test under `tests/` that pushes > limit into parser and asserts:

       * `onError` called
       * parser does not continue to grow memory

2. **Apply bounded JSON-RPC parsing in LSP client**

   * [ ] Replace `StreamMessageReader` usage with the bounded framed parser (or wrap it with size checks).

     * **Why:** `StreamMessageReader` will buffer messages; without explicit size enforcement at your integration boundary, a misbehaving server can cause OOM.
     * **Where:** `src/integrations/tooling/lsp/client.js`
     * **Fix:**

       * Wire `proc.stdout` `data` into `createFramedJsonRpcParser`.
       * Feed parsed messages into the existing dispatch/response correlation logic.
       * Ensure shutdown/kill closes parser cleanly.

3. **Apply bounded JSON-RPC parsing in MCP transport**

   * [ ] Replace `StreamMessageReader` usage similarly.

     * **Where:** `tools/mcp/transport.js`
     * **Fix:** Same pattern as LSP client; enforce message size limits and fail gracefully.

**Exit criteria**

* [ ] `createFramedJsonRpcParser` enforces max buffer/message sizes with tests.
* [ ] LSP client no longer relies on unbounded message buffering.
* [ ] MCP transport no longer relies on unbounded message buffering.

---


## Phase 11 — Resource Lifecycle Management (Caches, Long-Lived Servers, Builds)

**Objective:** Prevent memory and resource leaks in long-running processes (API server, service workers), especially across repeated builds and multi-repo usage.

1. **Add eviction/TTL for API router repo-level caches**

   * [ ] **Implement eviction for `repoCaches` map in `tools/api/router.js`.**

     * **Why:** `repoCaches` can grow unbounded if clients query multiple repos or if repo roots vary. Each entry can hold heavy caches (index cache + sqlite connections).
     * **Fix:**

       * Add:

         * `maxRepos` (e.g., 3–10)
         * `repoTtlMs` (e.g., 10–30 minutes)
       * Track `lastUsed` and evict least-recently-used / expired.
       * On eviction: close sqlite cache handles (`sqliteCache.close()`), clear index cache.
   * [ ] Add metrics for cache size and evictions.

     * **Where:** `tools/api/router.js` and metrics registry.

2. **Add eviction for per-repo index cache and sqlite DB cache**

   * [ ] **Index cache eviction**

     * **Why:** `src/retrieval/index-cache.js` caches by `dir` (which can change per build). On repeated re-indexing, old build directories can accumulate.
     * **Fix:** Convert to LRU with max entries, or TTL purge on access.
   * [ ] **SQLite DB cache eviction**

     * **Where:** `src/retrieval/sqlite-cache.js`
     * **Why:** Same “dir-per-build” key pattern; can leak connections/handles.
     * **Fix:** LRU/TTL + ensure `close()` called on eviction.

3. **Add explicit cache invalidation when “current build” pointer changes**

   * [ ] Detect when the effective index directory changes (new build) and prune caches for previous builds.

     * **Why:** Keeps hot caches relevant and bounds memory footprint.

**Exit criteria**

* [ ] API server memory does not grow unbounded when indexing/searching multiple repos/builds.
* [ ] Old build caches are evicted/pruned automatically.
* [ ] SQLite handles are closed on eviction (verified via tests or instrumentation).

---


## Phase 12 — Performance and Operational Hardening

**Objective:** Improve throughput and robustness under load without changing core behavior.

1. **Reduce event-loop blocking sync filesystem calls on API request paths**

   * [ ] Replace `fsSync.*` in API request hot paths with async equivalents where practical.

     * **Why:** Sync I/O can stall concurrent requests in the API server process.
     * **Where (examples):**

       * `tools/api/router.js` `resolveRepo()` uses `existsSync/statSync`.
     * **Fix:** Use `fs.promises.stat` with try/catch; cache results briefly if needed.

2. **Prevent decompression “zip bomb” style memory spikes in artifact reading**

   * [ ] Add output size limiting to gzip decompression.

     * **Why:** `src/shared/artifact-io.js` uses `gunzipSync(buffer)` and only checks decompressed size *after* decompression. A small compressed file could expand massively and spike memory.
     * **Fix:**

       * Use `zlib.gunzipSync(buffer, { maxOutputLength: maxBytes + slack })` (if supported in your Node target), or switch to streaming gunzip with explicit byte limits.
     * **Where:** `src/shared/artifact-io.js` `parseBuffer` / gzip handling.

3. **Add download size limits for tools that fetch large remote assets**

   * [ ] Enforce maximum download size (or require hash) for dictionary downloads.

     * **Why:** `tools/download-dicts.js` buffers the entire response in memory (`Buffer.concat`) without a hard cap.
     * **Fix:** Stream to disk with a cap; abort if exceeded; strongly prefer requiring hashes for non-default URLs.

**Exit criteria**

* [ ] API request path avoids avoidable sync I/O.
* [ ] Artifact gzip parsing cannot explode memory beyond configured limits.
* [ ] Large downloads are bounded and/or verified.

---


## Phase 13 — Documentation and Configuration Hardening

**Objective:** Ensure the fixed behavior is discoverable, configurable, and hard to misconfigure into an unsafe state.

1. **Document security posture and safe defaults**

   * [ ] Document:

     * API server host binding risks (`--host 0.0.0.0`)
     * CORS policy and how to configure allowed origins
     * Auth token configuration (if implemented)
     * RepoPath allowlist behavior
   * [ ] Add a prominent note: indexing untrusted repos and symlinks policy.

2. **Add configuration schema coverage for new settings**

   * [ ] If adding config keys (CORS/auth/cache TTL), ensure they are:

     * Reflected in whatever config docs you maintain
     * Validated consistently (even if validation is lightweight)

**Exit criteria**

* [ ] README/docs reflect new defaults and how to safely expose services.
* [ ] New options are documented and validated enough to prevent silent misconfiguration.

---

---


## Phase 14 — Optional-dependency framework + capability registry (foundation for all phases)

### 14.1 Introduce a consistent “optional dependency” loader

* [ ] Add `src/shared/optional-deps.js` with a single, opinionated API:

  * [ ] `tryRequire(name)` / `tryImport(name)` helpers (use `createRequire(import.meta.url)` where needed)
  * [ ] Standardized return shape: `{ ok: true, mod } | { ok: false, error, reason }`
  * [ ] Standardized logging hook (only when `PAIROFCLEATS_VERBOSE` or a dedicated flag is enabled)
* [ ] Add `src/shared/capabilities.js` that reports runtime availability:

  * [ ] `watcher: { chokidar: true, parcel: boolean }`
  * [ ] `regex: { re2: boolean, re2js: true }`
  * [ ] `hash: { nodeRsXxhash: boolean, wasmXxhash: true }`
  * [ ] `compression: { gzip: true, zstd: boolean }`
  * [ ] `extractors: { pdf: boolean, docx: boolean }`
  * [ ] `mcp: { sdk: boolean, legacy: true }`
  * [ ] `externalBackends: { tantivy: boolean, lancedb: boolean }` (even if “boolean” means “reachable” rather than “installed”)
* [ ] Wire capabilities into existing “status” surfaces:

  * [ ] Extend `tools/mcp/repo.js` → `configStatus()` to include capability info and warnings for requested-but-unavailable features
  * [ ] Extend `tools/config-dump.js` (or equivalent) to print capabilities in JSON output mode

### 14.2 Add config + env “backend selectors” (uniform UX)

* [ ] Extend `src/shared/env.js` to parse new selectors (string + allowlist):

  * [ ] `PAIROFCLEATS_WATCHER_BACKEND` = `auto|chokidar|parcel`
  * [ ] `PAIROFCLEATS_REGEX_ENGINE` = `auto|re2|re2js`
  * [ ] `PAIROFCLEATS_XXHASH_BACKEND` = `auto|native|wasm`
  * [ ] `PAIROFCLEATS_COMPRESSION` = `auto|gzip|zstd|none`
  * [ ] `PAIROFCLEATS_DOC_EXTRACT` = `auto|on|off`
  * [ ] `PAIROFCLEATS_MCP_TRANSPORT` = `auto|sdk|legacy`
* [ ] Add parallel config keys in `.pairofcleats.json` (keep them near existing related config blocks):

  * [ ] `indexing.watch.backend`
  * [ ] `search.regex.engine`
  * [ ] `indexing.hash.backend`
  * [ ] `indexing.artifactCompression.mode` enum expansion + `auto`
  * [ ] `indexing.documentExtraction.enabled`
  * [ ] `mcp.transport`
* [ ] Update `docs/config-schema.json`:

  * [ ] Add/expand enums (avoid “free string” for anything that’s meant to be policy-controlled)
  * [ ] Add descriptions that clarify fallback rules (`auto` behavior)
* [ ] Update any config validation code paths if they enforce known keys (`src/config/validate.js` is schema-driven; keep schema authoritative)

### 14.3 Add dependency-bundle reference stubs (keeps repo documentation consistent)

For each new dependency introduced in later phases, add a minimal doc file under:
`docs/references/dependency-bundle/deps/<dep>.md`

* [ ] `parcel-watcher.md`
* [ ] `re2.md`
* [ ] `node-rs-xxhash.md`
* [ ] `mongodb-js-zstd.md`
* [ ] `pdfjs-dist.md`
* [ ] `mammoth.md`
* [ ] `modelcontextprotocol-sdk.md`
* [ ] `lancedb.md` (if used)
* [ ] `tantivy.md` (if used)
* [ ] Update `docs/references/dependency-bundle/README.md` if it has an index

### 14.4 Tests (framework-level)

* [ ] Add `tests/capabilities-report.js`:

  * [ ] Asserts `capabilities` object shape is stable
  * [ ] Asserts `auto` selectors never throw when optional deps are missing
* [ ] Add a script-coverage action to run it:

  * [ ] `tests/script-coverage/actions.js`: add action entry that calls `runNode(...)`
  * [ ] (Optional) Add an npm script alias if you want parity with the rest of the repo scripts

**Exit criteria**

* [ ] All “capability” calls are side-effect-free and safe when optional deps are absent
* [ ] `config_status` (MCP) can surface “you requested X but it’s not available” warnings without crashing
* [ ] CI passes on Node 18 (Ubuntu + Windows lanes)

---


## Phase 15 — File watching performance: add `@parcel/watcher` backend (keep chokidar fallback)

### 15.1 Add the dependency (prefer optional unless you want it guaranteed everywhere)

* [ ] Add `@parcel/watcher` to `package.json`

  * [ ] Prefer `optionalDependencies` if you want installs to succeed even when native builds fail
  * [ ] If you add it as a hard dependency, ensure Windows CI remains green

### 15.2 Create a watcher-backend abstraction

* [ ] Create `src/index/build/watch/backends/types.js` (or inline JSDoc contract) describing:

  * [ ] `start({ root, ignored, onEvent, onError, pollMs? }) -> { close(): Promise<void> }`
  * [ ] Normalized event shape: `{ type: 'add'|'change'|'unlink', absPath }`
* [ ] Extract chokidar wiring out of `src/index/build/watch.js`:

  * [ ] Move into `src/index/build/watch/backends/chokidar.js`
  * [ ] Preserve existing semantics (`awaitWriteFinish`, ignored matcher, poll support)
* [ ] Implement parcel watcher backend:

  * [ ] New file: `src/index/build/watch/backends/parcel.js`
  * [ ] Map parcel events to the normalized `{type, absPath}` model
  * [ ] Decide how to handle rename/move (often appears as unlink+add):

    * [ ] If parcel reports rename, still emit unlink+add for compatibility with current scheduling
  * [ ] Implement “poll” behavior:

    * [ ] If poll mode is requested, either:

      * [ ] force chokidar with polling, **or**
      * [ ] implement a cheap stat-based poller wrapper (only if needed)
  * [ ] Implement “write stability” guard:

    * [ ] Chokidar has `awaitWriteFinish`; parcel does not in the same way
    * [ ] Add a “stabilize file” check in the pipeline: before processing a file, optionally confirm `mtime/size` stable across N ms
    * [ ] Place this in `createDebouncedScheduler()` or immediately before `enqueueOrUpdate()` in `file-processor.js` (prefer a single shared guard)

### 15.3 Wire selection into `watchIndex()`

* [ ] Update `src/index/build/watch.js`:

  * [ ] Choose backend via (in order): CLI/config → env → `auto` capability
  * [ ] Log selected backend once at startup (only if verbose or `--watch`)
  * [ ] Ensure `pollMs` is still honored (either by backend or by selection logic)

### 15.4 Tests

* [ ] Add `tests/watch-backend-selection.js`:

  * [ ] Forces `PAIROFCLEATS_WATCHER_BACKEND=chokidar` and asserts no parcel import occurs
  * [ ] Forces `...=parcel` and asserts fallback behavior if module unavailable (no crash, warning path)
* [ ] Add `tests/watch-stability-guard.js`:

  * [ ] Simulate “partial write” (write file in two chunks with delay) and assert processor waits/defers correctly
  * [ ] Keep the test deterministic: use explicit timeouts and a temp directory under `tests/.cache`
* [ ] Add corresponding script-coverage actions in `tests/script-coverage/actions.js`

**Exit criteria**

* [ ] `pairofcleats index watch` remains correct on Windows and Linux
* [ ] No regressions in ignore behavior (still uses `buildIgnoredMatcher`)
* [ ] Event storms do not cause repeated redundant rebuilds (existing debounce logic preserved)

---


## Phase 16 — Safe regex acceleration: optional native RE2 (`re2`) with `re2js` fallback

### 16.1 Add dependency + backend wrapper

* [ ] Add `re2` (native) as an optional dependency (recommended)
* [ ] Refactor `src/shared/safe-regex.js` into a backend-based module:

  * [ ] Keep current behavior as the fallback backend (`re2js`)
  * [ ] Add `src/shared/safe-regex/backends/re2.js`
  * [ ] Add `src/shared/safe-regex/backends/re2js.js` (wrap existing usage cleanly)
* [ ] Preserve existing safety constraints:

  * [ ] `maxPatternLength`
  * [ ] `maxInputLength`
  * [ ] Guard flags normalization (only `gimsyu` supported as today)

### 16.2 Integrate selector + compatibility contract

* [ ] Add `createSafeRegex({ engine, ...limits })` selection:

  * [ ] `engine=auto` uses `re2` if available else `re2js`
  * [ ] `engine=re2` hard-requires native; if missing, returns a clear error (or a warning + fallback if you prefer)
* [ ] Validate behavioral parity:

  * [ ] Ensure `.exec()` and `.test()` match expectations for `g` and non-`g`
  * [ ] Ensure `.lastIndex` semantics are either compatible or explicitly *not supported* (and documented)

### 16.3 Update call sites

* [ ] Verify these flows still behave correctly:

  * [ ] `src/retrieval/output/filters.js` (file/path filters)
  * [ ] `src/retrieval/output/risk-tags.js` (risk tagging)
  * [ ] Any structural search / rulepack path using regex constraints

### 16.4 Tests

* [ ] Add `tests/safe-regex-engine.js`:

  * [ ] Conformance tests (flags, match groups, global behavior)
  * [ ] Safety limit tests (pattern length, input length)
  * [ ] Engine-selection tests (`auto`, forced `re2js`)
* [ ] Add script-coverage action(s)

**Exit criteria**

* [ ] No user-visible semantic regressions in filtering/risk-tagging
* [ ] “Engine auto” is safe and silent (no noisy logs) unless verbose

---


## Phase 17 — Hashing performance: optional native xxhash (`@node-rs/xxhash`) with `xxhash-wasm` fallback

### 17.1 Add dependency + unify backend contract

* [ ] Add `@node-rs/xxhash` as optional dependency (or hard dep if you accept platform constraints)
* [ ] Create `src/shared/hash/xxhash-backend.js`:

  * [ ] `hash64(buffer|string) -> hex16` (exact output format must match existing `checksumString()` + `checksumFile()`)
  * [ ] `hash64Stream(readable) -> hex16` (if supported; otherwise implement chunking in JS)
* [ ] Update `src/shared/hash.js`:

  * [ ] Keep `sha1()` unchanged
  * [ ] Route `checksumString()` / `checksumFile()` through the backend contract
  * [ ] Preserve deterministic formatting (`formatXxhashHex`)

### 17.2 Introduce selector + telemetry

* [ ] Add `PAIROFCLEATS_XXHASH_BACKEND=auto|native|wasm`
* [ ] Emit backend choice in verbose logs (once)

### 17.3 Tests

* [ ] Add `tests/xxhash-backends.js`:

  * [ ] Assert `checksumString('abc')` matches a known baseline (record from current implementation)
  * [ ] Assert `checksumFile()` matches `checksumString()` on same content (via temp file)
  * [ ] If native backend is available, assert native and wasm match exactly
  * [ ] If native is missing, ensure test still passes (skips “native parity” block)
* [ ] Add script-coverage action(s)

**Exit criteria**

* [ ] No change to bundle identity semantics (incremental cache stability)
* [ ] `checksumFile()` remains bounded-memory for large files (streaming or chunked reads)

---


## Phase 18 — Artifact compression upgrade: add Zstandard (`zstd`) alongside gzip

### 18.1 Add compression dependency

* [ ] Add `@mongodb-js/zstd` (recommended as optional dependency due to native bindings)
* [ ] Decide “streaming vs buffer-only” support:

  * [ ] If streaming is supported: implement streaming JSONL writers/readers
  * [ ] If buffer-only: restrict zstd to JSON object/array artifacts, keep JSONL as gzip (document clearly)

### 18.2 Introduce compression abstraction (avoid sprinkling `if (mode===...)` everywhere)

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

### 18.3 Update readers/writers for new extensions

* [ ] Update `src/shared/artifact-io.js`:

  * [ ] Extend `resolveArtifactPath()` to check:

    * [ ] `<name>.json` then `<name>.json.gz` then `<name>.json.zst`
    * [ ] Also handle `.bak` variants for each
  * [ ] Extend `readJsonFile()` to decode zstd when applicable
* [ ] Update `src/shared/json-stream.js`:

  * [ ] Add zstd path for `writeJsonArrayFile()` / `writeJsonObjectFile()` when compression is requested
  * [ ] If JSONL is to support zstd: update `writeJsonLinesFile()` and `readJsonLinesArraySync()`

### 18.4 Update artifact contract + metrics

* [ ] Update `docs/artifact-contract.md`:

  * [ ] New allowed compression modes
  * [ ] New filename extensions
  * [ ] Backward compatibility statement (gzip still readable)
* [ ] Update `src/index/build/artifacts/metrics.js` to report `compression.mode=zstd`
* [ ] Update `docs/config-schema.json` to restrict/describe valid modes

### 18.5 Tests

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


## Phase 19 — Massive functionality boost: PDF + DOCX ingestion (prose mode)

### 19.1 Add document extraction dependencies

* [ ] Add `pdfjs-dist` (PDF text extraction)
* [ ] Add `mammoth` (DOCX → text/HTML extraction)

### 19.2 Introduce “extractor” layer in indexing pipeline

* [ ] Create `src/index/build/extractors/`:

  * [ ] `text.js` (wrap existing `readTextFileWithHash` path)
  * [ ] `pdf.js` (buffer → extracted text; include page separators if possible)
  * [ ] `docx.js` (buffer → extracted text; preserve headings if possible)
  * [ ] `index.js` (select extractor by extension + config)
* [ ] Add a new constant set in `src/index/constants.js`:

  * [ ] `EXTS_EXTRACTABLE_BINARY = new Set(['.pdf', '.docx'])`
* [ ] Add `.pdf` and `.docx` to `EXTS_PROSE` **only if** extraction is enabled (or add them unconditionally but ensure they don’t get skipped)

### 19.3 Fix binary-skip logic to allow extractable docs

You must handle both “pre-read” scanning and “post-read” binary checks:

* [ ] Update `src/index/build/file-scan.js` / `createFileScanner()`:

  * [ ] If `ext` ∈ `EXTS_EXTRACTABLE_BINARY` and extraction enabled:

    * [ ] Do **not** mark as `{ reason: 'binary' }`
    * [ ] Still allow minified checks to run when relevant (likely irrelevant for pdf/docx)
* [ ] Update `src/index/build/file-processor/skip.js`:

  * [ ] If `ext` extractable and extraction enabled, do not return `binarySkip`
* [ ] Update `src/index/build/file-processor.js`:

  * [ ] Branch early on `ext`:

    * [ ] For `.pdf`/`.docx`: read buffer → extractor → `text`
    * [ ] For all else: existing text decoding path
  * [ ] Ensure `hash` still derives from raw bytes (current `sha1(buffer)` behavior is good)
  * [ ] Ensure `stats.bytes` is still the raw size for guardrails

### 19.4 Chunking strategy for extracted docs

* [ ] Decide on an initial, deterministic chunking approach:

  * [ ] Minimal viable: treat extracted output as prose and let default prose chunking apply
  * [ ] Better: add dedicated chunkers:

    * [ ] Add `src/index/chunking/prose/pdf.js` to split by page markers
    * [ ] Add `src/index/chunking/prose/docx.js` to split by headings / paragraph blocks
* [ ] Update `src/index/chunking/dispatch.js`:

  * [ ] Map `.pdf` and `.docx` to their chunkers (or prose fallback)

### 19.5 Search + metadata integration

* [ ] Ensure extracted docs appear in:

  * [ ] `file_meta.json` (file path + ext)
  * [ ] `chunk_meta.*` (chunks with correct file associations)
* [ ] Consider adding a metadata flag for UI filters:

  * [ ] `fileMeta[i].isExtractedDoc = true` (or reuse existing `externalDocs` pattern if appropriate)
* [ ] Verify retrieval filters treat these files correctly (extension/path filters)

### 19.6 Tests (must include “end-to-end search finds doc content”)

* [ ] Add fixture files under `tests/fixtures/docs/`:

  * [ ] `sample.pdf` with a known unique phrase
  * [ ] `sample.docx` with a known unique phrase
* [ ] Add `tests/pdf-docx-extraction.js`:

  * [ ] Unit-level extraction returns expected text
* [ ] Add `tests/pdf-docx-index-search.js`:

  * [ ] Build prose index for a temp repo that includes the docs
  * [ ] Run `search.js --mode prose` and assert the phrases match chunks
* [ ] Add script-coverage action(s)

**Exit criteria**

* [ ] PDF/DOCX are no longer silently dropped as “binary” (when enabled)
* [ ] Prose search can retrieve content from these formats reliably
* [ ] No regression to binary detection for non-extractable files

---


## Phase 20 — MCP server: migrate from custom JSON-RPC plumbing to official MCP SDK (reduce maintenance)

### 20.1 Add MCP SDK and plan transport layering

* [ ] Add `@modelcontextprotocol/sdk` dependency
* [ ] Decide migration strategy:

  * [ ] **Option A (recommended):** keep `tools/mcp-server.js` as the entrypoint, but implement server via SDK and keep legacy behind a flag
  * [ ] Option B: replace legacy entirely (higher risk)

### 20.2 Implement SDK-based server

* [ ] Add `src/integrations/mcp/sdk-server.js` (or similar):

  * [ ] Register tools from `src/integrations/mcp/defs.js`
  * [ ] Dispatch calls to existing handlers in `tools/mcp/tools.js` (or migrate handlers into `src/` cleanly)
  * [ ] Preserve progress notifications semantics expected by `tests/mcp-server.js`:

    * [ ] `notifications/progress`
    * [ ] Include `{ tool: 'build_index', phase, message }` fields (match current tests)
* [ ] Update `tools/mcp-server.js`:

  * [ ] If `mcp.transport=legacy` or env forces legacy → use current transport
  * [ ] Else → use SDK transport

### 20.3 Remove or isolate legacy transport surface area

* [ ] Keep `tools/mcp/transport.js` for now, but:

  * [ ] Move to `tools/mcp/legacy/transport.js`
  * [ ] Update imports accordingly
  * [ ] Reduce churn risk while you validate parity

### 20.4 Tests

* [ ] Ensure these existing tests continue to pass without rewriting expectations unless protocol mandates it:

  * [ ] `tests/mcp-server.js`
  * [ ] `tests/mcp-robustness.js`
  * [ ] `tests/mcp-schema.js`
* [ ] Add `tests/mcp-transport-selector.js`:

  * [ ] Force `PAIROFCLEATS_MCP_TRANSPORT=legacy` and assert legacy path still works
  * [ ] Force `...=sdk` and assert SDK path works
* [ ] Add script-coverage action(s)

**Exit criteria**

* [ ] MCP server behavior is unchanged from the client perspective (tool list, outputs, progress events)
* [ ] Maintenance burden reduced: eliminate custom framing/parsing where SDK provides it

---


## Phase 21 — Tantivy sparse backend (optional, high impact on large repos)

> This phase is intentionally split into “abstraction first” and “backend integration” to keep risk controlled.

### 21.1 Extract a sparse-retrieval interface

* [ ] Create `src/retrieval/sparse/`:

  * [ ] `types.js` contract: `search({ query, topN, filters, mode }) -> hits[]`
  * [ ] `providers/sqlite-fts.js` wrapper around existing SQLite FTS ranking
  * [ ] `providers/js-bm25.js` wrapper around the in-memory BM25 path
* [ ] Update `src/retrieval/pipeline.js` to call the provider rather than direct sqlite/JS branching:

  * [ ] Keep behavior identical as baseline
  * [ ] Preserve determinism (stable tie-breaking)

### 21.2 Implement Tantivy integration (choose one operational model)

* [ ] Choose packaging model:

  * [ ] **Sidecar model:** `tools/tantivy-server` (Rust) + Node client
  * [ ] **Embedded binding:** Node N-API module
* [ ] Add `src/retrieval/sparse/providers/tantivy.js`:

  * [ ] Build query → execute → map results to `{ idx, score }`
  * [ ] Support candidate-set filtering if feasible (or document it as a limitation and handle via post-filtering)
* [ ] Add `tools/build-tantivy-index.js`:

  * [ ] Consume existing artifacts (`chunk_meta`, token streams) and build tantivy index on disk
  * [ ] Store alongside other indexes (e.g., under repo cache root)
  * [ ] Consider incremental updates later; start with full rebuild

### 21.3 Config + CLI integration

* [ ] Add config:

  * [ ] `tantivy.enabled`
  * [ ] `tantivy.path` (optional override)
  * [ ] `tantivy.autoBuild` (optional)
* [ ] Extend backend policy logic (see `src/retrieval/cli/backend-context.js` and backend-policy tests):

  * [ ] Allow `--backend tantivy` (or `--sparse-backend tantivy`)
  * [ ] Ensure `auto` fallback behavior remains predictable

### 21.4 Tests (gated if tantivy isn’t always available in CI)

* [ ] Add `tests/tantivy-smoke.js`:

  * [ ] Builds tantivy index for `tests/fixtures/sample`
  * [ ] Executes a basic query and asserts hits are non-empty
* [ ] Gate it behind env:

  * [ ] `PAIROFCLEATS_TEST_TANTIVY=1` to run
  * [ ] Otherwise test exits 0 with “skipped” message (match existing patterns in repo)
* [ ] Add script-coverage action(s) that run it only when env flag is set (or mark as skipped in coverage if you keep strictness)

**Exit criteria**

* [ ] Tantivy backend can be enabled without changing default behavior
* [ ] For large repos, sparse retrieval latency is materially improved (benchmarks added in Phase 15)

---


## Phase 22 — LanceDB vector backend (optional, high impact on ANN scaling)

### 22.1 Extract a vector-ANN provider interface

* [ ] Create `src/retrieval/ann/`:

  * [ ] `types.js`: `query({ embedding, topN, candidateSet, mode }) -> hits[]`
  * [ ] `providers/sqlite-vec.js` wrapper around `rankVectorAnnSqlite`
  * [ ] `providers/hnsw.js` wrapper around `rankHnswIndex`
* [ ] Update `src/retrieval/pipeline.js` to use the provider interface

### 22.2 Implement LanceDB integration (choose operational model)

* [ ] Choose packaging model:

  * [ ] Node library integration, **or**
  * [ ] Sidecar service (Python) + HTTP
* [ ] Add `src/retrieval/ann/providers/lancedb.js`:

  * [ ] Query by vector and return `{ idx, sim }`
  * [ ] Handle filtering:

    * [ ] If LanceDB supports “where id IN (…)” efficiently → push down
    * [ ] Otherwise → post-filter and overfetch

### 22.3 Build tooling for vector index creation

* [ ] Add `tools/build-lancedb-index.js`:

  * [ ] Ingest `dense_vectors_*` artifacts
  * [ ] Store LanceDB table in cache (mode-specific)
  * [ ] Validate dims/model compatibility using existing `index_state.json` semantics

### 22.4 Tests (gated)

* [ ] Add `tests/lancedb-ann-smoke.js`:

  * [ ] Build embeddings (stub) → build lancedb table → run a nearest-neighbor query → assert stable result ordering
* [ ] Gate behind `PAIROFCLEATS_TEST_LANCEDB=1`
* [ ] Add script-coverage action(s) gated similarly

**Exit criteria**

* [ ] LanceDB ANN can be enabled without breaking sqlite/hnsw fallbacks
* [ ] Demonstrable memory and/or latency win for ANN retrieval at scale

---


## Phase 23 — Benchmarks, regression gates, and release hardening (prove the ROI)

### 23.1 Extend microbench suite (`tools/bench/micro/`)

* [ ] Add `tools/bench/micro/watch.js`:

  * [ ] Event storm simulation (if feasible) or synthetic scheduler load
* [ ] Add `tools/bench/micro/regex.js`:

  * [ ] Compare `re2js` vs `re2` on representative patterns/inputs
* [ ] Add `tools/bench/micro/hash.js`:

  * [ ] Compare wasm vs native checksum throughput
* [ ] Add `tools/bench/micro/compression.js`:

  * [ ] gzip vs zstd compress/decompress for representative artifact payload sizes
* [ ] Add `tools/bench/micro/extractors.js`:

  * [ ] PDF/DOCX extraction throughput and memory ceiling

### 23.2 Add “no-regression” assertions where it matters

* [ ] Add deterministic snapshot tests (lightweight, not full golden files):

  * [ ] Ensure chunk IDs stable across backends
  * [ ] Ensure ordering stable under ties
* [ ] Add metrics validation:

  * [ ] `index-*.json` metrics reflect new compression/extractor options correctly

### 23.3 Documentation + UX polish

* [ ] Update `README.md`:

  * [ ] Mention PDF/DOCX support and how to enable/disable
  * [ ] Mention optional performance backends and how `auto` works
* [ ] Update `docs/external-backends.md` for Tantivy/LanceDB reality (what’s implemented vs planned)
* [ ] Update `docs/mcp-server.md` for SDK migration

**Exit criteria**

* [ ] Benchmarks show measurable improvement (and are reproducible)
* [ ] CI remains green on Node 18 + Windows lane
* [ ] New features are discoverable via config docs + `config_status`

---


## Phase 24 — LibUV threadpool utilization (explicit control + docs + tests)

**Objective:** Make libuv threadpool sizing an explicit, validated, and observable runtime control so PairOfCleats I/O concurrency scales predictably across platforms and workloads.

### 24.1 Audit: identify libuv-threadpool-bound hot paths and mismatch points

* [ ] Audit all high-volume async filesystem call sites (these ultimately depend on libuv threadpool behavior):

  * [ ] `src/index/build/file-processor.js` (notably `runIo(() => fs.stat(...))`, `runIo(() => fs.readFile(...))`)
  * [ ] `src/index/build/file-scan.js` (`fs.open`, `handle.read`)
  * [ ] `src/index/build/preprocess.js` (file sampling + `countLinesForEntries`)
  * [ ] `src/shared/file-stats.js` (stream-based reads for line counting)
* [ ] Audit concurrency derivation points where PairOfCleats may exceed practical libuv parallelism:

  * [ ] `src/shared/threads.js` (`ioConcurrency = ioBase * 4`, cap 32/64)
  * [ ] `src/index/build/runtime/workers.js` (`createRuntimeQueues` pending limits)
* [ ] Decide and record the intended precedence rules for threadpool sizing:

  * [ ] Whether PairOfCleats should **respect an already-set `UV_THREADPOOL_SIZE`** (recommended, matching existing `NODE_OPTIONS` behavior where flags aren’t overridden if already present).

### 24.2 Add a first-class runtime setting + env override

* [ ] Add config key (new):

  * [ ] `runtime.uvThreadpoolSize` (number; if unset/invalid => no override)
* [ ] Add env override (new):

  * [ ] `PAIROFCLEATS_UV_THREADPOOL_SIZE` (number; same parsing rules as other numeric env overrides)
* [ ] Implement parsing + precedence:

  * [ ] Update `src/shared/env.js`

    * [ ] Add `uvThreadpoolSize: parseNumber(env.PAIROFCLEATS_UV_THREADPOOL_SIZE)`
  * [ ] Update `tools/dict-utils.js`

    * [ ] Extend `getRuntimeConfig(repoRoot, userConfig)` to resolve `uvThreadpoolSize` with precedence:

      * `userConfig.runtime.uvThreadpoolSize` → else `envConfig.uvThreadpoolSize` → else `null`
    * [ ] Clamp/normalize: floor to integer; require `> 0`; else `null`
    * [ ] Update the function’s return shape and JSDoc:

      * from `{ maxOldSpaceMb, nodeOptions }`
      * to `{ maxOldSpaceMb, nodeOptions, uvThreadpoolSize }`

### 24.3 Propagate `UV_THREADPOOL_SIZE` early enough (launcher + spawned scripts)

* [ ] Update `bin/pairofcleats.js` (critical path)

  * [ ] In `runScript()`:

    * [ ] Resolve `runtimeConfig` as today.
    * [ ] Build child env as an object (don’t pass `process.env` by reference when you need to conditionally add keys).
    * [ ] If `runtimeConfig.uvThreadpoolSize` is set and `process.env.UV_THREADPOOL_SIZE` is not set, add:

      * [ ] `UV_THREADPOOL_SIZE = String(runtimeConfig.uvThreadpoolSize)`
    * [ ] (Optional) If `--verbose` or `PAIROFCLEATS_VERBOSE`, log a one-liner showing the chosen `UV_THREADPOOL_SIZE` for the child process.
* [ ] Update other scripts that spawn Node subcommands and already apply runtime Node options, so they also carry the threadpool sizing consistently:

  * [ ] `tools/setup.js` (`buildRuntimeEnv()`)
  * [ ] `tools/bootstrap.js` (`baseEnv`)
  * [ ] `tools/ci-build-artifacts.js` (`baseEnv`)
  * [ ] `tools/bench-language-repos.js` (repo child env)
  * [ ] `tests/bench.js` (bench child env when spawning search/build steps)
  * [ ] `tools/triage/context-pack.js`, `tools/triage/ingest.js` (where `resolveNodeOptions` is used)
  * Implementation pattern: wherever you currently do `{ ...process.env, NODE_OPTIONS: resolvedNodeOptions }`, also conditionally set `UV_THREADPOOL_SIZE` from `runtimeConfig.uvThreadpoolSize` if not already present.

> (Optional refactor, if you want to reduce repetition): add a helper in `tools/dict-utils.js` like `resolveRuntimeEnv(runtimeConfig, baseEnv)` and migrate the call sites above to use it.

### 24.4 Observability: surface “configured vs effective” values

* [ ] Update `tools/config-dump.js`

  * [ ] Include in `payload.derived.runtime`:

    * [ ] `uvThreadpoolSize` (configured value from `getRuntimeConfig`)
    * [ ] `effectiveUvThreadpoolSize` (from `process.env.UV_THREADPOOL_SIZE` or null/undefined if absent)
* [ ] Add runtime warnings in indexing startup when mismatch is likely:

  * [ ] Update `src/index/build/runtime/workers.js` (in `resolveThreadLimitsConfig`, verbose mode is already supported)

    * [ ] Compute `effectiveUv = Number(process.env.UV_THREADPOOL_SIZE) || null`
    * [ ] If `effectiveUv` is set and `ioConcurrency` is materially larger, emit a single warning suggesting alignment.
    * [ ] If `effectiveUv` is not set, consider a *non-fatal* hint when `ioConcurrency` is high (e.g., `>= 16`) and `--verbose` is enabled.
* [ ] (Services) Emit one-time startup info in long-running modes:

  * [ ] `tools/api-server.js`
  * [ ] `tools/indexer-service.js`
  * [ ] `tools/mcp-server.js`
  * Log: effective `UV_THREADPOOL_SIZE`, and whether it was set by PairOfCleats runtime config or inherited from the environment.

### 24.5 Documentation updates

* [ ] Update env overrides doc:

  * [ ] `docs/env-overrides.md`

    * [ ] Add `PAIROFCLEATS_UV_THREADPOOL_SIZE`
    * [ ] Explicitly note: libuv threadpool size must be set **before the Node process starts**; PairOfCleats applies it by setting `UV_THREADPOOL_SIZE` in spawned child processes (via `bin/pairofcleats.js` and other tool launchers).
* [ ] Update config docs:

  * [ ] `docs/config-schema.json` add `runtime.uvThreadpoolSize`
  * [ ] `docs/config-inventory.md` add `runtime.uvThreadpoolSize (number)`
  * [ ] `docs/config-inventory.json` add entry for `runtime.uvThreadpoolSize`
* [ ] Update setup documentation:

  * [ ] `docs/setup.md` add a short “Performance tuning” note:

    * [ ] When indexing large repos or using higher `--threads`, consider setting `runtime.uvThreadpoolSize` (or `PAIROFCLEATS_UV_THREADPOOL_SIZE`) to avoid libuv threadpool becoming the limiting factor.
* [ ] (Optional) Add a benchmark note:

  * [ ] `docs/benchmarks.md` mention that benchmarking runs should control `UV_THREADPOOL_SIZE` for reproducibility.

### 24.6 Tests: schema validation + env propagation

* [ ] Update config validation tests:

  * [ ] `tests/config-validate.js` ensure `runtime.uvThreadpoolSize` is accepted by schema validation.
* [ ] Add a focused propagation test:

  * [ ] New: `tests/uv-threadpool-env.js`

    * [ ] Create a temp repo dir with a `.pairofcleats.json` that sets `runtime.uvThreadpoolSize`.
    * [ ] Run: `node bin/pairofcleats.js config dump --json --repo <temp>`
    * [ ] Assert:

      * `payload.derived.runtime.uvThreadpoolSize` matches the config
      * `payload.derived.runtime.effectiveUvThreadpoolSize` matches the propagated env (or check `process.env.UV_THREADPOOL_SIZE` if you expose it directly in the dump)
* [ ] Add a non-override semantics test (if that’s the decided rule):

  * [ ] New: `tests/uv-threadpool-no-override.js`

    * [ ] Set parent env `UV_THREADPOOL_SIZE=…`
    * [ ] Also set config `runtime.uvThreadpoolSize` to a different value
    * [ ] Assert child sees the parent value (i.e., wrapper respects existing env)

**Exit criteria**

* [ ] `runtime.uvThreadpoolSize` is in schema + inventory and validated by `tools/validate-config.js`.
* [ ] `pairofcleats …` launches propagate `UV_THREADPOOL_SIZE` to child processes when configured.
* [ ] Users can confirm configured/effective behavior via `pairofcleats config dump --json`.
* [ ] Docs clearly explain when and how the setting applies.

---


## Phase 25 — Threadpool-aware I/O scheduling guardrails

**Objective:** Reduce misconfiguration risk by aligning PairOfCleats internal I/O scheduling with the effective libuv threadpool size and preventing runaway pending I/O buildup.

### 25.1 Add a “threadpool-aware” cap option for I/O queue sizing

* [ ] Add config (optional, but recommended if you want safer defaults):

  * [ ] `indexing.ioConcurrencyCap` (number) **or** `runtime.ioConcurrencyCap` (number)
  * Choose the namespace based on your ownership map (`docs/config-inventory-notes.md` suggests runtime is `tools/dict-utils.js`, indexing is build runtime).
* [ ] Implement in:

  * [ ] `src/shared/threads.js` (preferred, because it’s the canonical concurrency resolver)

    * [ ] After computing `ioConcurrency`, apply:

      * `ioConcurrency = min(ioConcurrency, ioConcurrencyCap)` when configured
      * (Optional) `ioConcurrency = min(ioConcurrency, effectiveUvThreadpoolSize)` when a new boolean is enabled, e.g. `runtime.threadpoolAwareIo === true`
  * [ ] `src/index/build/runtime/workers.js`

    * [ ] Adjust `maxIoPending` to scale from the *final* `ioConcurrency`, not the pre-cap value.

### 25.2 Split “filesystem I/O” from “process I/O” (optional, higher impact)

If profiling shows git/tool subprocess work is being unnecessarily throttled by a threadpool-aware cap:

* [ ] Update `src/shared/concurrency.js` to support two queues:

  * [ ] `fs` queue (bounded by threadpool sizing)
  * [ ] `proc` queue (bounded separately)
* [ ] Update call sites:

  * [ ] `src/index/build/file-processor.js`

    * [ ] Use `fsQueue` for `fs.stat`, `fs.readFile`, `fs.open`
    * [ ] Use `procQueue` for `getGitMetaForFile` (and any other spawn-heavy steps)
  * [ ] `src/index/build/runtime/workers.js` and `src/index/build/indexer/steps/process-files.js`

    * [ ] Wire new queues into runtime and shard runtime creation.

### 25.3 Tests + benchmarks

* [ ] Add tests that validate:

  * [ ] Caps are applied deterministically
  * [ ] Pending limits remain bounded
  * [ ] No deadlocks when both queues exist
* [ ] Update or add a micro-benchmark to show:

  * [ ] Throughput difference when `UV_THREADPOOL_SIZE` and internal `ioConcurrency` are aligned vs misaligned.

**Exit criteria**

* [ ] Internal I/O concurrency cannot silently exceed intended caps.
* [ ] No regression in incremental/watch mode stability.
* [ ] Benchmarks show either improved throughput or reduced memory/queue pressure (ideally both).

---


## Phase 26 — (Conditional) Native LibUV work: only if profiling proves a real gap

**Objective:** Only pursue *direct* libuv usage (via a native addon) if profiling demonstrates a material bottleneck that cannot be addressed through configuration and queue hygiene.

### 26.1 Profiling gate and decision record

* [ ] Add a short profiling harness / guidance doc:

  * [ ] `docs/perf-profiling.md` (new) describing how to profile indexing (CPU + I/O wait) and what thresholds justify native work.
* [ ] Establish decision criteria (example):

  * [ ] If ≥20–30% wall time is spent in JS-level file scanning/reading overhead beyond disk throughput limits, consider native.
  * [ ] Otherwise, stay in JS + threadpool tuning.

### 26.2 Prototype native module (N-API) using libuv for a specific hot path

* [ ] Only target one narrow, measurable function (examples):

  * [ ] Fast “sample read + binary/minified detection” replacing parts of `src/index/build/file-scan.js`
  * [ ] Batched `stat + read` pipeline for small files
* [ ] Provide a clean fallback path to existing JS implementation.
* [ ] Add CI coverage for:

  * [ ] Linux/macOS/Windows builds (or prebuilds)
  * [ ] ABI compatibility across supported Node versions

### 26.3 Packaging and docs

* [ ] Update:

  * [ ] `package.json` optionalDependencies/build tooling (node-gyp/prebuildify/etc.)
  * [ ] `docs/setup.md` to explain native build requirements/fallback behavior

**Exit criteria**

* [ ] Prototype demonstrates measurable improvement on representative repos.
* [ ] Install friction and cross-platform maintenance cost are explicitly accepted (or the work is abandoned).

#### 18 Bottom line

* **Do not add libuv directly** to this Node codebase.
* **Do add explicit support for libuv threadpool sizing** (via `UV_THREADPOOL_SIZE`) because the current concurrency model (notably `ioConcurrency` up to 64) strongly suggests you will otherwise hit an invisible throughput ceiling.

---



## Phase 27 — File processing & artifact assembly (chunk payloads/writers/shards)

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

## 27.1 Per-file processing correctness (Checklist A)

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

- [ ] **Document offset units** for `start`/`end` (recommendation: define as UTF‑16 code-unit offsets, because that is what JS uses), and add at least one non‑ASCII regression test that validates:
  - [ ] `text.slice(start, end)` reproduces the chunk text
  - [ ] `offsetToLine()` aligns with `startLine/endLine` for multi-byte characters  
  (Files: `src/index/build/file-processor.js`, `docs/artifact-contract.md`, `docs/contracts/indexing.md`, plus a new/extended test)

- [ ] Add **boundary asserts** (behind a dev/test flag if needed) after chunking:
  - [ ] in-range checks (`0..text.length`)
  - [ ] monotonic chunk ordering
  - [ ] overlap detection (only allow configured overlap)  
  (File: `src/index/build/file-processor.js`)

- [ ] Make **unsupported-language** behavior explicit and test-covered:
  - [ ] decide: skip with reason `unsupported-language` vs. treat as `unknown` with generic chunking
  - [ ] add test coverage for the chosen behavior  
  (Files: `src/index/build/file-processor.js`, `src/index/build/file-processor/skip.js`, tests under `tests/file-processor/`)

- [ ] Add **parse-error** (and relation-error) per-file skip handling:
  - [ ] catch and record failures from `lang.chunk`, `lang.buildRelations`, `lang.extractDocMeta`, `flow()`, etc.
  - [ ] ensure the build can proceed when a single file fails (configurable)  
  (File: `src/index/build/file-processor.js`)

- [ ] Add **file-level content hash** to `file_meta.json` (and optionally, to each chunk’s `metaV2`):
  - [ ] store `hash` and `hashAlgo`
  - [ ] ensure incremental and non-incremental builds agree  
  (Files: `src/index/build/file-processor.js`, `src/index/build/artifacts/file-meta.js`, `docs/artifact-contract.md`)

- [ ] Fix the comment boundary condition in `assignCommentsToChunks()`:
  - [ ] consider `<=` for boundary tests, or implement overlap-based assignment using comment `(start,end)`  
  (File: `src/index/build/file-processor/chunk.js`)

- [ ] Audit and correct **timing double-counting** in `createTimingsTracker()` usage:
  - [ ] ensure parseMs reflects one pass, and relation/flow have separate counters if desired  
  (Files: `src/index/build/file-processor.js`, `src/index/build/file-processor/timings.js`)

---

## 27.2 Artifact contract correctness (Checklist B)

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

- [ ] **Fix chunk-meta cleanup** when `chunkMetaUseJsonl && !chunkMetaUseShards`:
  - [ ] remove `chunk_meta.meta.json` if present
  - [ ] remove `chunk_meta.parts/` if present  
  (File: `src/index/build/artifacts/writers/chunk-meta.js`)

- [ ] Ensure shard writes do not accumulate orphan files:
  - [ ] delete `chunk_meta.parts/` before writing new sharded parts (or write to staging dir + rename)
  - [ ] confirm `token_postings.shards/` cleanup is complete on all branches  
  (Files: `src/index/build/artifacts/writers/chunk-meta.js`, `src/index/build/artifacts.js`)

- [ ] Implement **directory-level atomicity** for sharded artifacts:
  - [ ] write shards to `*.tmp/` directory
  - [ ] atomically swap into place via rename (and optionally keep a directory-level `.bak`)  
  (Files: `src/index/build/artifacts/writers/chunk-meta.js`, `src/index/build/artifacts.js`)

- [ ] Make manifest generation strict for required artifacts:
  - [ ] either (a) fail the build on checksum/stat failure, or (b) record an `error` field and ensure validation tooling treats it as failure  
  (File: `src/index/build/artifacts/checksums.js`)

- [ ] Update docs to match implementation:
  - [ ] remove/adjust claim about `compression` field
  - [ ] add schema examples for meta files (fields/arrays/legacy)
  - [ ] document precedence rules for readers  
  (Files: `docs/artifact-contract.md`, `docs/contracts/indexing.md`)

- [ ] Add a regression test that explicitly covers the stale chunk-meta shard override:
  - [ ] build A: sharded chunk meta written
  - [ ] build B: non-sharded jsonl written, ensure shards removed or ignored
  - [ ] loader reads build B’s jsonl, not build A’s shards  
  (New test; or extend `tests/artifact-formats.js` / `tests/artifact-size-guardrails.js`)

---

## 27.3 Sharding / pieces / postings (Checklist C)

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

- [ ] Add explicit tie-breakers in shard batching and balancing when weights are equal:
  - [ ] include `label` or `id` in comparator
  - [ ] document determinism guarantees  
  (File: `src/index/build/shards.js`)

- [ ] Add a “very large repo” synthetic shard-plan test:
  - [ ] verifies bounded memory and time
  - [ ] verifies stable shard labels/IDs across runs  
  (New test; extend `tests/shard-plan.js`)

#### Postings / tokenization

- [ ] Canonicalize vocab ordering for stability:
  - [ ] define canonical sort order (lexicographic; or localeCompare with explicit locale; or bytewise)
  - [ ] apply consistently to token vocab, phrase vocab, chargram vocab, and field vocabs  
  (File: `src/index/build/postings.js` and any upstream postings-map builders)

- [ ] Canonicalize and/or validate postings ordering:
  - [ ] assert postings doc IDs are strictly increasing per token (or stable canonical order)
  - [ ] assert vocab/postings arrays align and lengths match  
  (File: `src/index/build/postings.js`; plus tests)

- [ ] Expand quantization tests to include:
  - [ ] scale correctness
  - [ ] dims mismatch handling
  - [ ] doc/code embeddings “fallback to main embedding” behavior  
  (File: `tests/postings-quantize.js`)

#### Piece assembly

- [ ] Fix `validateLengths()` to fail when expected > 0 and list is empty or mismatched:
  - [ ] treat `[]` as invalid when `expected > 0`
  - [ ] include artifact name + input dir in error message for fast triage  
  (File: `src/index/build/piece-assembly.js`)

- [ ] Merge **all field postings present in inputs**, including `comment` (and any future fields):
  - [ ] do not hardcode `name/signature/doc/body`
  - [ ] merge based on keys present in `field_postings.json` / `field_tokens.json` or config  
  (File: `src/index/build/piece-assembly.js`)

- [ ] Determinize assembly:
  - [ ] sort `inputs` deterministically by path (or require stable input ordering and document it)
  - [ ] sort merged vocabs (or guarantee stable order via canonicalization)
  - [ ] ensure assembled output is byte-for-byte stable for same inputs  
  (Files: `tools/assemble-pieces.js`, `src/index/build/piece-assembly.js`)

- [ ] Add a regression test: **assembled output equals monolithic output** for the same fixture:
  - [ ] build monolithic index
  - [ ] build two partial indexes (or reuse shards) and assemble
  - [ ] compare chunk_meta + token_postings + manifest semantics  
  (New test; extend `tests/piece-assembly.js`)

- [ ] Verify manifests list all required parts:
  - [ ] ensure meta files are included and checksummed
  - [ ] ensure shard part counts match meta.parts and manifest counts match meta totals  
  (Files: `src/index/build/artifacts/checksums.js`, tests)

---

## 27.4 Performance improvements to prioritize (Checklist D)

**Audit**

The current implementation is functional and reasonably structured, but several areas will become dominant costs on large repos:

- Per-file pipeline does multiple passes over the same data (chunking, tokenization, docmeta, lint/complexity).
- Artifact writing constructs full in-memory arrays for potentially huge artifacts and then serializes them.
- Some hot paths allocate transient arrays aggressively.

### High-impact improvements (prioritized)

#### Avoid “build huge arrays then serialize”

- `buildPostings()` currently materializes large `vocab` and `postings` arrays in memory.
  - [ ] Add a streaming/sharded writer path that writes postings shards incrementally as postings are built (or at least allows releasing intermediate Maps earlier).
- `chunk_meta` estimation uses JSON.stringify samples, which is OK, but writing sharded JSONL still relies on iterators that materialize per-entry objects.
  - [ ] Consider a “lightweight entry view” or direct JSONL streaming that avoids building large intermediate objects for fields not needed.

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

- [ ] Replace `split('\n')` usage in `src/index/build/file-processor.js` with a targeted line-scan helper.  
- [ ] Move complexity/lint computation outside the per-chunk loop in `file-processor.js`.  
- [ ] Reduce transient array concatenations in comment token aggregation.  
- [ ] Explore a streaming postings writer for very large repos (phase-level refactor).  
- [ ] Add at least one micro-benchmark or perf regression test covering:
  - piece assembly (`src/index/build/piece-assembly.js`)
  - piece compaction (`tools/compact-pieces.js`)

---

## 27.5 Refactoring goals (Checklist E)

**Audit**

Current state:
- Artifact writing is orchestrated from `artifacts.js` via `enqueueJsonObject/Array/Lines` + special-case writers (chunk meta writer).
- Schema definitions are implicit in “writer payload construction” and spread across multiple modules.
- Multiple identifiers exist (`chunk.id`, `metaV2.chunkId`, graph keys `file::name`), which increases the chance of accidental drift.

**Remaining work**

- [ ] Introduce a single “artifact writer” abstraction with a consistent interface:
  - [ ] `write(name, payload | iterator, { format, sharded, compression, pieceType })`
  - [ ] built-in cleanup rules and directory-level atomic swaps
  - [ ] standard metadata (version, generatedAt, schemaVersion)  
  (Impacts: `src/index/build/artifacts.js`, `src/index/build/artifacts/writers/*`)

- [ ] Separate schema definitions from I/O:
  - [ ] define schemas for artifacts in a central module (even if only via JS object contracts + comments)
  - [ ] ensure docs mirror those schema definitions  
  (Impacts: `docs/artifact-contract.md`, `docs/contracts/indexing.md`)

- [ ] Create a single canonical chunk-id generator and use it everywhere:
  - [ ] prefer `metaV2.chunkId` (content-based) for graphs/relations keys instead of ad-hoc `file::name`
  - [ ] ensure assembled and non-assembled builds produce identical chunkIds  
  (Impacts: `src/index/build/graphs.js`, and any code producing chunk identifiers)

---

## 27.6 Tests (Checklist F)

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

- [ ] Strengthen artifact format tests to assert semantic meaning:
  - [ ] verify loader precedence (meta/parts vs jsonl vs json) in more combinations
  - [ ] verify meta.parts path normalization and correctness

- [ ] Add regression tests for atomic write failures:
  - [ ] simulate rename failures (via dependency injection or controlled FS behavior)
  - [ ] assert `.bak` fallback and cleanup behavior

- [ ] Add regression tests for partial shard writes:
  - [ ] parts written, meta missing
  - [ ] meta references missing parts
  - [ ] stale orphan parts do not affect reads

- [ ] Add stress fixtures for large token/postings sets:
  - [ ] ensure bounded memory / time
  - [ ] ensure canonical ordering remains correct under stress

- [ ] Add at least one perf regression test:
  - [ ] compaction: `tools/compact-pieces.js`
  - [ ] assembly: `src/index/build/piece-assembly.js`

- [ ] Fix `tests/file-processor/cached-bundle.test.js` to use realistic shapes:
  - [ ] `allImports` should be `{ [moduleName: string]: string[] }`
  - [ ] `codeRelations.calls/usages` should match the real structure used by `buildRelationGraphs()` / `buildCallIndex()`  
  (File: `tests/file-processor/cached-bundle.test.js`)

---

## Appendix A: File-by-file findings

This section enumerates each in-scope file and lists file-specific items to address (beyond cross-cutting tasks already listed above).

### src/index/build/artifacts.js
- [ ] (P1) Consider directory-level atomic swap for `token_postings.shards/` (staging dir + rename).
- [ ] (P1) Normalize shard part paths to POSIX in any meta/manifest structures (avoid OS-separator leakage).
- [ ] (P2) Consider sorting `pieceEntries` by `path` before writing the manifest to reduce diff noise.

### src/index/build/artifacts/checksums.js
- [ ] (P1) Do not silently accept checksum/stat failures for required pieces; fail or record errors explicitly.

### src/index/build/artifacts/compression.js
- [ ] (P2) Update docs to clarify that gzip is a sidecar (`.json` and `.json.gz` both exist).
- [ ] (P2) Consider extending compression to sharded artifacts (optional future work).

### src/index/build/artifacts/file-meta.js
- [ ] (P1) Make file ID assignment stable by sorting unique file paths before assigning IDs.
- [ ] (P1) Add file content hash (and algo) and file size to `file_meta.json`.
- [ ] (P2) Remove or rename `chunk_authors` in file meta (currently derived from the first chunk and not file-level).

### src/index/build/artifacts/filter-index.js
- [ ] (P2) Consider persisting schema version/config hash in the filter index artifact for easier debugging.

### src/index/build/artifacts/metrics.js
- [ ] (P2) Do not swallow metrics write errors silently (log or propagate based on severity).

### src/index/build/artifacts/token-mode.js
- [ ] (P2) Make parsing more robust (case-insensitive modes; integer parsing + clamping).

### src/index/build/artifacts/writers/chunk-meta.js
- [ ] (P0) Remove stale `chunk_meta.meta.json` and `chunk_meta.parts/` when writing non-sharded JSONL.
- [ ] (P1) Clear or stage-swap `chunk_meta.parts/` when writing sharded output.
- [ ] (P1) Normalize `meta.parts` entries to POSIX paths.
- [ ] (P2) Consider normalizing field naming conventions (`chunk_authors` vs `startLine/endLine`).

### src/index/build/artifacts/writers/file-relations.js
- [ ] (P2) Consider JSONL/sharding for very large `file_relations` outputs; add versioning metadata.

### src/index/build/artifacts/writers/repo-map.js
- [ ] (P1) Ensure `exported` detection handles default exports correctly (depends on relations schema).
- [ ] (P2) Consider sorting output by `{file, name}` for stability.

### src/index/build/file-processor.js
- [ ] (P1) Add explicit boundary asserts for chunks after chunking.
- [ ] (P1) Replace `split('\n')` with line-scan utility for context extraction.
- [ ] (P2) Move complexity/lint to per-file scope; avoid repeated per-chunk cache checks.
- [ ] (P2) Fix possible timing double-counting across parse/relation durations.
- [ ] (P1) Add explicit unsupported-language and parse-error skip reasons (configurable).

### src/index/build/file-processor/assemble.js
- [ ] (P1) Ensure field token fields written here (including `comment`) are consistently supported by postings and piece assembly.

### src/index/build/file-processor/cached-bundle.js
- [ ] (P2) Validate cached bundle shapes more strictly; ensure importLinks shape is consistent.

### src/index/build/file-processor/chunk.js
- [ ] (P2) Adjust comment-to-chunk assignment at boundary (`chunk.end === comment.start`) and consider overlap-based assignment.

### src/index/build/file-processor/incremental.js
- [ ] (P2) Ensure cache invalidation includes schema/version changes for any artifact-impacting changes.

### src/index/build/file-processor/meta.js
- [ ] (P2) Deduplicate `externalDocs` outputs; consider ordering for determinism.

### src/index/build/file-processor/read.js
- [ ] (P2) Consider UTF-8 safe truncation (avoid splitting multi-byte sequences mid-codepoint).

### src/index/build/file-processor/relations.js
- [ ] (P2) Consider sorting/deduping relation arrays (imports/exports/usages) for determinism.

### src/index/build/file-processor/skip.js
- [ ] (P1) Add explicit unsupported-language skip reason (or document that unknown languages are processed).
- [ ] (P2) Add coverage for `unreadable` and `read-failure` skip paths.

### src/index/build/file-processor/timings.js
- [ ] (P2) Validate that parse/token/embed durations are not double-counted; document semantics.

### src/index/build/graphs.js
- [ ] (P2) Prefer canonical `chunkId` keys where possible instead of `file::name` to avoid collisions.
- [ ] (P2) Sort serialized node lists for full determinism (neighbors are already sorted).

### src/index/build/imports.js
- [ ] (P0) Fix `es-module-lexer` import record handling (`entry.d` is not a specifier string).
- [ ] (P1) Sort and dedupe `importLinks` deterministically; exclude self-links unless explicitly desired.
- [ ] (P1) Ensure concurrency does not affect output ordering (sort module keys and file arrays before serialization).

### src/index/build/piece-assembly.js
- [ ] (P0) Make `validateLengths()` strict when `expected > 0`.
- [ ] (P0) Merge all field postings (including `comment`) and docLengths based on actual input keys.
- [ ] (P1) Canonicalize vocab ordering in assembled outputs.
- [ ] (P2) Remove redundant filterIndex construction (avoid double work; rely on writeIndexArtifacts).

### src/index/build/postings.js
- [ ] (P1) Canonicalize vocab ordering (token/phrase/chargram/field) explicitly.
- [ ] (P2) Validate docLengths are finite and consistent; avoid NaN avgDocLen.
- [ ] (P2) Sort Object.entries() iteration for field postings and weights for deterministic output.

### src/index/build/shards.js
- [ ] (P1) Add explicit tie-breakers in weight-based sorts/batching for determinism across runtimes.
- [ ] (P2) Document heuristic thresholds (minFilesForSubdir, hugeThreshold, tenth-largest targets).

### src/index/build/tokenization.js
- [ ] (P2) Review buffer reuse effectiveness (arrays are still cloned); consider pre-sizing and reducing transient allocations further.

### tools/assemble-pieces.js
- [ ] (P1) Sort `inputDirs` by default (or add `--sort`) to ensure deterministic assembled output.
- [ ] (P2) When `--force` is used, consider cleaning the output dir first to avoid stale artifacts.

### tools/ci-build-artifacts.js
- [ ] (P1) Sanitize remote URLs before writing them to `manifest.json` to avoid leaking credentials.

### tools/ci-restore-artifacts.js
- [ ] (P2) Optionally validate `pieces/manifest.json` checksums after restore (fast fail on corrupt artifacts).

### tools/compact-pieces.js
- [ ] (P1) Consider directory-level atomic swap semantics (avoid rm+rename window).
- [ ] (P2) Add perf regression harness and validate output equivalence post-compaction.

### tests/artifact-bak-recovery.js
- [ ] (P2) Expand coverage to include: both primary and backup corrupt; json.gz sidecars; and cleanup expectations.

### tests/artifact-formats.js
- [ ] (P1) Add explicit precedence test: sharded meta/parts must not override fresh jsonl when shards are stale (post-fix).

### tests/artifact-size-guardrails.js
- [ ] (P2) Extend to cover: chunkMetaFormat=jsonl with switching shard/no-shard, and cleanup behavior.

### tests/artifacts/file-meta.test.js
- [ ] (P1) Update test if file ID assignment is changed to sorted-by-path; assert stability across different chunk orders.

### tests/artifacts/token-mode.test.js
- [ ] (P2) Add coverage for invalid modes, case-insensitive parsing, and maxTokens/maxFiles parsing edge cases.

### tests/clean-artifacts.js
- [ ] (P2) Consider adding a check that `.bak` files are handled correctly (optional).

### tests/file-processor/cached-bundle.test.js
- [ ] (P1) Fix test fixtures to use realistic `allImports` and `codeRelations` shapes, and assert semantic correctness (not only presence).

### tests/file-processor/skip.test.js
- [ ] (P2) Add coverage for `unreadable` and `read-failure` paths (permissions, ENOENT races).

### tests/filter-index-artifact.js
- [ ] (P2) Add a schema assertion for filter_index fields/versioning to prevent drift.

### tests/filter-index.js
- [ ] (P2) Consider adding a determinism check for serialized filter index (same inputs => same output).

### tests/graph-chunk-id.js
- [ ] (P2) Add a collision regression test for graph keys, or migrate to chunkId-based keys.

### tests/incremental-tokenization-cache.js
- [ ] (P2) Add a second invalidation scenario (e.g., tokenization config changes that affect stemming/synonyms).

### tests/piece-assembly.js
- [ ] (P1) Add semantic equivalence test vs monolithic build and add a determinism test (same inputs => identical assembled output).

### tests/postings-quantize.js
- [ ] (P2) Extend to test scale and dims, and doc/code embedding behavior.

### tests/shard-merge.js
- [ ] (P2) Consider adding checksum and manifest equivalence checks as well.

### tests/shard-plan.js
- [ ] (P2) Add stress case coverage (many files, equal weights, perfProfile enabled).

### tests/tokenization-buffering.js
- [ ] (P2) Consider adding a non-ASCII tokenization regression case.

### docs/artifact-contract.md
- [ ] (P1) Fix compression description (no embedded `compression` field) and clarify `.json.gz` sidecar semantics.
- [ ] (P1) Add explicit precedence rules (meta/parts vs jsonl vs json).
- [ ] (P2) Add schema examples for meta files and `pieces/manifest.json`.

### docs/contracts/coverage-ledger.md
- [ ] (P2) Add entries for new/critical tooling: `tools/assemble-pieces.js`, `tools/compact-pieces.js`, and CI artifact scripts.

### docs/contracts/indexing.md
- [ ] (P1) Clarify which artifacts are “required” vs “optional/configurable” (e.g., minhash signatures).
- [ ] (P1) Document sharded meta schema and loader precedence.


## Phase 28 — Section 2 — Index build orchestration review (findings + required fixes)

### Executive summary: highest-priority issues (fix first)

#### Correctness / functional

- [ ] **Sharding path creates fresh worker pools + queues per shard work item, with no explicit teardown.**  
  This is very likely to cause thread/resource leaks, excessive pool creation overhead, and/or a build process that does not exit cleanly.  
  _Primary file:_ `src/index/build/indexer/steps/process-files.js`  
  _Related:_ `src/index/build/runtime/workers.js`, `src/index/build/worker-pool.js`

- [ ] **`--mode all` behavior is inconsistent with “extracted-prose” expectations (tests + CLI surface).**  
  `tests/build-index-all.js` expects an `extracted-prose` index to be produced for `--mode all`, and `parseBuildArgs(...)` already resolves `modes` to include it; however the CLI entry (`build_index.js`) discards the computed `modes` and delegates to the core build entry, which (in the current tree) resolves “all” differently.  
  _Primary file(s) in scope:_ `build_index.js`, `src/index/build/args.js`, `tests/build-index-all.js`  
  _Note:_ the root cause may live outside this section’s file list, but the mismatch is observable from the files in scope and should be corrected at the boundary.

- [ ] **Watch debounce scheduler does not safely handle async `onRun` errors (risk of unhandled promise rejection).**  
  `createDebouncedScheduler(...)` calls `onRun()` without `await`/`.catch(...)`. In `watchIndex(...)`, `onRun` is async. Any unexpected throw/rejection (e.g., from lock release, filesystem exceptions) can become an unhandled rejection.  
  _Primary file:_ `src/index/build/watch.js`

#### Determinism / reproducibility

- [ ] **Locale-dependent sorts in ordering-critical paths (`localeCompare`) should be replaced with deterministic lexicographic compares.**  
  Ordering drives chunk IDs, manifest key ordering, and shard planning stability; `localeCompare` can vary by ICU/locale.  
  _Primary files:_  
  - `src/index/build/indexer/steps/discover.js`  
  - `src/index/build/indexer/steps/process-files.js`  
  - `tools/shard-census.js`

#### Incremental correctness across versions

- [ ] **Incremental cache signature likely needs a “tool/build schema version” component.**  
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
- [ ] Replace locale-dependent sorting in `indexer/steps/discover.js` with deterministic compare (and document determinism requirement).
- [ ] Consider adding `stat.isFile()` checks (defensive) before admitting entries (especially for non-git discovery paths).
- [ ] Consider making “tracked-only” behavior explicit at the API boundary (discover uses `git ls-files` when root is a git repo root) and ensure watch mode semantics align (see Watch section).

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
- [ ] Add an explicit “cache schema / tool version” component to `cacheSignature` (or a separate `cacheSchemaVersion` field checked alongside it).
- [ ] Treat `manifest.version` as a compatibility gate (migrate or reset when unsupported); ensure `manifest.files` is validated as a *plain object* (not an array).
- [ ] Decide whether whole-index reuse should allow hash fallback (currently it is strict on mtime/size) — if yes, add an opt-in and tests.

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
- [ ] Fix sharding runtime lifecycle (see Section C/D): avoid creating worker pools per shard item; ensure explicit teardown; ensure sharding does not leak threads/handles.
- [ ] Replace localeCompare usage in shard plan sorting with deterministic ordering.
- [ ] Consider exposing and testing a “deterministic build mode” in which timestamps/build IDs do not affect artifact contents (at least for core artifacts).

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
- [ ] Add tests ensuring cross-file inference updates are persisted into incremental bundles when enabled.
- [ ] Clarify the artifact contract for `graphRelations` in `index_state.json` and ensure it is versioned.

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
- [ ] Add/verify tests around token retention “auto” switching (sample vs none) to ensure artifact stability and correctness.

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
- [ ] Validate that `promotion.js` cannot write a `current.json` pointer that escapes the intended cache root (path traversal hardening).
- [ ] Consider making build_state updates resilient to concurrent writes (or explicitly “best effort” with documentation).

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

- [ ] **Cache invalidation across tool updates:** include a “tool version / schema version / algorithm version” in the incremental signature.  
  Suggested approach:
  - Add a `runtime.cacheSchemaVersion` constant (bumped on any semantic change), and include it in `buildIncrementalSignature(...)`.
  - Or include `runtime.toolInfo.version` (and document that caches are invalidated across versions).
- [ ] **Manifest version compatibility:** enforce `manifest.version` compatibility explicitly; if unsupported, reset (and optionally delete bundles).  
  Also validate `manifest.files` is a plain object: `loaded.files && typeof loaded.files === 'object' && !Array.isArray(loaded.files)`.
- [ ] **Bundle cleanup on invalidation:** when signature/tokenizationKey mismatches, consider deleting the bundles directory (or moving aside) to avoid disk bloat.
- [ ] **Whole-index reuse strictness:** decide if whole-index reuse should support content-hash fallback for stat mismatch (opt-in).  
  If not, document that mtime/size must match exactly, and why (performance vs safety).
- [ ] **Stage interactions:** confirm and test that:
  - stage1 builds do not reuse stage2 caches (signature should differ, but confirm)
  - stage2 builds do not reuse stage1 caches
  - stage4 behaviors are consistent (if stage4 writes different artifact sets)
- [ ] **RelKey normalization:** ensure relKey generation is consistently POSIX and case-handled on Windows for both discovery and watch paths.

---

### C. Concurrency and robustness

#### C.1 Locking

**Audit**

- `src/index/build/lock.js` implements:
  - atomic lock acquisition via `fs.open(lockPath, 'wx')`
  - stale lock detection via pid + timestamp (and mtime fallback)
  - optional wait/poll to acquire lock

**Remaining work**
- [ ] Ensure the lock file handle is closed even if `writeFile(...)` fails (use try/finally around the acquired `handle`).
- [ ] Consider including `buildId` and `mode(s)` in the lock file payload to improve observability/debugging.
- [ ] Add a test that simulates write failure during lock acquisition (can be done by injecting a stubbed fs layer, or by creating a read-only directory).

#### C.2 Sharding + queues + worker pools

**Audit**

- The pipeline uses a queue abstraction (`createTaskQueues`, `runWithQueue`) and worker pools (`Piscina`) to parallelize CPU-heavy tasks.
- Sharding aims to distribute work based on line counts / cost predictions, while preserving deterministic output ordering via an ordered appender.

**Remaining work (critical)**
- [ ] **Do not create worker pools per shard item.**  
  Options (choose one):
  1) **Preferred:** share the parent runtime’s worker pools across all shards; only shard the scheduling/queueing.  
  2) If per-shard pools are required: create **one** shard runtime per shard worker (batch), reuse it for all work items in that batch, and **always** `destroy()` pools and tear down queues in a `finally`.
- [ ] Add a regression test / harness that runs a sharded build and asserts the process exits promptly (no lingering worker threads).  
  Practical approach: spawn `node build_index.js ...` with `--shards.enabled` and ensure it exits within a timeout; also enable `--verbose` to detect repeated pool creation.
- [ ] Audit `maxPending` sizing on queues in shard runtime creation; ensure it cannot exceed a safe bound when shard concurrency is high.

#### C.3 Watch mode robustness

**Audit**

- Watch mode uses chokidar and a debounce scheduler to coalesce changes.
- It maintains a tracked file set to decide whether removals/oversize transitions should trigger rebuilds.
- It always enables incremental to avoid full reindexing on every change.

**Remaining work**
- [ ] Make `createDebouncedScheduler(...)` safe for async `onRun`:
  - wrap `onRun()` in `Promise.resolve(...).catch(...)`
  - optionally provide an `onError` callback
- [ ] Ensure “extracted-prose only” watch mode is supported:
  - update `isIndexablePath(...)` to treat `extracted-prose` as both `code` and `prose` for extension filtering
  - add coverage in `tests/watch-filter.js`
- [ ] Decide how to handle untracked file changes in git repos (discover is tracked-only):
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
- [ ] Parallelize `fs.stat` in discovery with a concurrency limit (e.g., 32) to reduce wall-clock time on large repos.
- [ ] Consider using fdir’s `withStats()` to avoid a separate stat syscall for non-git discovery paths.
- [ ] Ensure file-type detection does not misclassify common text types as binary (treat certain `application/*` mimes as text if needed).

#### D.2 Sharding overhead

**Audit**

- Sharding may require a full line-count pass (expensive) unless line counts are provided.
- Shard planning uses predicted cost from perf profiles when available.

**Remaining work**
- [ ] Add an option to avoid full line counting when perf profile is available and sufficiently fresh (approximate weights).
- [ ] Revisit per-shard file concurrency hard cap (`min(2, ...)`) — it can underutilize configured `runtime.fileConcurrency` on larger machines.
- [ ] Avoid per-shard runtime creation (performance + correctness; see Section C).

#### D.3 Worker pool overhead

**Audit**

- Worker tasks validate cloneability of inputs/outputs for each task (deep scan with limits).
- Worker pool supports restart/backoff, and permanent disable on repeated opaque failures.

**Remaining work**
- [ ] Gate cloneability validation behind a debug flag or environment variable; keep it on by default in CI/tests, off in production, or vice versa (choose explicitly).
- [ ] Consider using transfer lists for large typed arrays in quantize tasks to reduce cloning overhead.
- [ ] Add metrics to quantify:
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
- [ ] Centralize “max bytes per extension” and “cap normalization” logic into a single helper module (likely `runtime/caps.js` or a shared `file-caps.js`) and reuse across discover/watch/tools.
- [ ] Standardize ordering comparisons: provide a shared `compareRelPaths(a, b)` helper that is locale-independent and (optionally) Windows-case-aware.
- [ ] Run formatter / lint pass on files with inconsistent indentation (not functionally wrong, but increases diff noise and review friction).

#### E.2 Tests to add or strengthen

**Remaining work**
- [ ] **Build all modes:** Ensure `tests/build-index-all.js` reliably enforces that `--mode all` produces `code`, `prose`, and `extracted-prose` artifacts (and fix the orchestration boundary if currently inconsistent).
- [ ] **Watch extracted-prose:** add a case to `tests/watch-filter.js` where `modes=['extracted-prose']` and confirm indexable file changes trigger scheduling.
- [ ] **Watch async error safety:** add a test that uses an async `onRun` that rejects once, and assert no `unhandledRejection` occurs (attach a listener in the test).
- [ ] **Sharding teardown:** add a harness test that enables sharding and asserts no lingering worker threads prevent exit.
- [ ] **Incremental schema version:** add a test that simulates a tool version/schema version change and confirms caches are invalidated.

---

### File-by-file findings (actionable)

> Items below are intentionally concrete and file-scoped to minimize ambiguity.

#### `build_index.js`

- [ ] Pass the resolved `modes` from `parseBuildArgs(...)` through to the build orchestrator (or otherwise guarantee that “mode all” resolves identically at every boundary).  
  _Why:_ prevents drift between CLI arg parsing and internal orchestration; aligns with `tests/build-index-all.js`.

#### `src/index/build/args.js`

- [ ] Consider adding `argv.modes` (or similar) so downstream layers do not need to re-derive the “all → modes” mapping (and so the CLI entry can pass a single object).

#### `src/index/build/build-state.js`

- [ ] Document that `build_state.json` is best-effort and may lose updates under concurrent writers; or introduce an append-only/event model to prevent lost updates.
- [ ] Consider `timer.unref()` on heartbeat interval for cases where build-state heartbeat should not keep the process alive (optional).

#### `src/index/build/crash-log.js`

- [ ] Consider throttling `updateFile(...)` writes when debug crash logging is enabled (currently potentially writes state on every file).

#### `src/index/build/discover.js`

- [ ] Add concurrency-limited parallel statting for large repos.
- [ ] Add defensive `stat.isFile()` gating for non-git crawls.

#### `src/index/build/failure-taxonomy.js`

- No blocking issues found in scope; consider expanding taxonomy categories over time as needed.

#### `src/index/build/feature-metrics.js`

- No blocking issues found; consider adding an explicit schema version to metrics output to support future evolution.

#### `src/index/build/file-scan.js`

- [ ] Treat certain `file-type` “application/*” results (e.g., json/xml) as potentially text, or ensure `file-type` is only advisory and always confirm with istextorbinary when in doubt.
#### `src/index/build/ignore.js`

- [ ] Consider supporting nested `.gitignore` semantics for non-git discovery paths (optional, but improves parity with developer expectations).

#### `src/index/build/incremental.js`

- [ ] Validate `manifest.files` is a plain object; reset if array/invalid.
- [ ] Enforce manifest version compatibility; reset or migrate.
- [ ] Consider deleting stale bundles on signature/tokenizationKey mismatch to avoid disk bloat.

#### `src/index/build/indexer.js`

- No major issues; ensure per-mode runtime mutations are intentional and documented.

#### `src/index/build/indexer/pipeline.js`

- [ ] Ensure any ordering-critical sorts remain locale-independent (primary issue is in discover step; pipeline relies on it).
- [ ] Consider explicitly documenting the per-mode stage graph and how it maps to artifacts and cache signature components.

#### `src/index/build/indexer/signatures.js`

- [ ] Add cache schema / tool version component to `buildIncrementalSignature(...)`.
- [ ] Consider adding explicit versions for:
  - chunk schema
  - postings schema
  - relations graph schema

#### `src/index/build/indexer/steps/discover.js`

- [ ] Replace `localeCompare` sort with deterministic compare.
- [ ] Avoid mutating shared entry objects if discovery is reused across modes (optional; low risk today, but cleaner).

#### `src/index/build/indexer/steps/incremental.js`

- [ ] Add more granular status reporting (e.g., why reuse rejected) for observability; currently logs are decent but could be structured.

#### `src/index/build/indexer/steps/postings.js`

- [ ] Add tests for token retention “auto” switching correctness and stability.

#### `src/index/build/indexer/steps/process-files.js`

- [ ] Fix sharding runtime lifecycle (do not create per-work-item pools; ensure teardown).
- [ ] Replace localeCompare in shard plan sorting with deterministic compare.
- [ ] Revisit per-shard concurrency cap (min(2, ...)).
- [ ] Consider hoisting shard runtime creation outside the inner work-item loop if per-shard runtime instances remain desired.

#### `src/index/build/indexer/steps/relations.js`

- [ ] Add tests ensuring cross-file inference updates are persisted into incremental bundles when enabled.
- [ ] Clarify error strategy for import scan failures (degrade vs abort) and encode it in tests/config.

#### `src/index/build/indexer/steps/write.js`

- [ ] Ensure `index_state.json` always includes the correct cache signature / tokenizationKey values used for the build (especially when any runtime config is adapted per mode).

#### `src/index/build/lock.js`

- [ ] Close file handle in a `finally` if write fails during lock acquisition.

#### `src/index/build/perf-profile.js`

- No major correctness issues; consider exporting a schema version.

#### `src/index/build/preprocess.js`

- [ ] Document that preprocess is currently for `code` + `prose` only (or extend support to `extracted-prose` explicitly if desired).

#### `src/index/build/promotion.js`

- [ ] Harden path handling so `current.json` cannot point outside `repoCacheRoot` even if inputs are malformed.

#### `src/index/build/runtime.js`

- No blocking issues found in scope.

#### `src/index/build/runtime/caps.js`

- No blocking issues found; consider consolidating cap normalization usage across tools.

#### `src/index/build/runtime/hash.js`

- No blocking issues found.

#### `src/index/build/runtime/logging.js`

- No blocking issues found; consider documenting the distinction between structured logs and progress logs.

#### `src/index/build/runtime/runtime.js`

- [ ] Consider making the “tracked-only discovery” behavior visible in logs when git is used (helps users understand why new files may not be indexed).
- [ ] Consider ensuring any per-mode adaptive config does not bleed across modes (currently low risk, but worth documenting).

#### `src/index/build/runtime/stage.js`

- No blocking issues found; stage overrides appear coherent and tested (`tests/build-runtime/stage-overrides.test.js`).

#### `src/index/build/runtime/tree-sitter.js`

- No blocking issues found in scope.

#### `src/index/build/runtime/workers.js`

- [ ] Review queue pending-limit sizing with sharding enabled; ensure worst-case bounds are safe.

#### `src/index/build/state.js`

- No blocking issues found; consider adding explicit assertions/guards in merge functions to prevent mismatched id offsets if used elsewhere.

#### `src/index/build/watch.js`

- [ ] Make debounce scheduler safe for async `onRun` (catch rejections).
- [ ] Support `extracted-prose` as a mode for indexable path filtering.
- [ ] Consider reducing rebuild churn from untracked files (optional).

#### `src/index/build/worker-pool.js`

- [ ] Consider exposing a “debug clone checks” toggle (ties into worker validation overhead discussion).
- [ ] Add optional transferList support for quantize tasks.

#### `src/index/build/workers/indexer-worker.js`

- [ ] Gate cloneability validation behind a debug/config toggle if performance becomes an issue.

#### `tools/shard-census.js`

- [ ] Replace `localeCompare` with deterministic compare for stable reporting.
- [ ] Consider reusing shared cap/normalization utilities rather than duplicating.

#### Tests

##### `tests/build-index-all.js`

- [ ] Ensure the build orchestration actually builds `extracted-prose` for `--mode all` (fix boundary mismatch if needed).

##### `tests/watch-filter.js`

- [ ] Add an `extracted-prose`-only mode coverage case.
- [ ] Add an async debounce safety test (unhandled rejection prevention).

##### `tests/worker-pool*.js`

- No immediate gaps; consider adding a perf regression test if clone checks are made optional.

---

### Deliverables

- [ ] Fix sharding runtime lifecycle and add regression coverage.
- [ ] Resolve “mode all” / extracted-prose mismatch and ensure `tests/build-index-all.js` passes reliably.
- [ ] Harden watch debounce scheduling against async rejection.
- [ ] Replace localeCompare sorts in ordering-critical paths.
- [ ] Add a cache schema/tool version component to incremental signature and add a test for invalidation.

### Exit criteria

- [ ] Sharded builds do not leak worker threads/handles and the process exits cleanly.
- [ ] `--mode all` produces `code`, `prose`, and `extracted-prose` indices; validated by test.
- [ ] Watch mode does not emit unhandled promise rejections under forced error paths.
- [ ] Deterministic ordering is documented and enforced (no locale-dependent sorts in critical ordering paths).
- [ ] Incremental cache reuse is safe across code releases (explicit schema/version invalidation).


## Phase 29 — Embeddings & ANN (onnx/HNSW/batching/candidate sets)

**Objective:** harden the embeddings + ANN stack for correctness, determinism (where required), performance, and resilient fallbacks across **index build**, **build-embeddings tooling**, and **retrieval-time ANN execution**.

### 29.1 Correctness

#### 29.1.1 Model identity (cache keys, preprocessing, normalization, dims)

##### Current state (verified)
- [x] Tooling cache keys include **file hash** + **chunk signature** + **embedding identity** (`tools/build-embeddings/cache.js`, `tools/build-embeddings/run.js`).
- [x] Tooling includes **dims mismatch guardrails** with explicit hard-fail paths and tests (`tools/build-embeddings/embed.js`, `tests/embeddings-dims-mismatch.js`, `tests/embeddings-dims-validation.js`).

##### Remaining gaps / action items
- [ ] **Expand embedding identity to include preprocessing + provider-specific knobs**, not just `{modelId, provider, mode, stub, dims, scale}`:
  - Why: changing `onnx` tokenizer/model path or execution provider can change embeddings without changing `modelId`/`provider`, allowing silent cache reuse.
  - Files:
    - `tools/build-embeddings/cache.js` (identity schema)
    - `tools/build-embeddings/run.js` (identity inputs)
  - Add fields (at minimum):
    - ONNX: `onnx.modelPath` (resolved), `onnx.tokenizerId`, `onnx.executionProviders`, `onnx.threads`, `onnx.graphOptimizationLevel`
    - Common: pooling strategy (mean), `normalize=true`, truncation/max_length policy
    - Quantization: `minVal/maxVal` (currently fixed -1..1), quantization “version”
- [ ] **Include a tooling/version fingerprint in cache identity** (or bumpable `identity.version`) so cache invalidates when embedding algorithm changes:
  - Why: changes to doc extraction, pooling logic, quantization, or merging should invalidate caches even if file hashes are unchanged.
  - Files: `tools/build-embeddings/cache.js`, optionally `tools/build-embeddings/chunks.js`
- [ ] **Add strict provider validation**: unknown `indexing.embeddings.provider` should not silently map to `xenova`.
  - Why: silent fallback can produce “correct-looking” but unintended embeddings and cache identity mismatch.
  - Files: `src/shared/onnx-embeddings.js` (normalizeEmbeddingProvider), `src/index/embedding.js`, `tools/build-embeddings/cli.js`, `src/retrieval/embedding.js`
- [ ] **Unify default stub embedding dimensions across build + retrieval + tooling** (currently inconsistent defaults: 384 vs 512).
  - Why: any code path that calls stub embeddings without an explicit `dims` risks producing query embeddings that cannot match the index dims.
  - Files: `src/shared/embedding.js` (defaults to 512), `src/index/embedding.js` (defaults to 384), `tools/build-embeddings/run.js` (defaults to 384), `src/retrieval/embedding.js` (passes `dims`, but can pass null in some ANN-only paths).
  - Recommendation: pick **384** as the single default everywhere OR require dims explicitly in stub mode and fail loudly if missing.
- [ ] **Index-build (inline) path lacks explicit dims mismatch failure** comparable to build-embeddings tool:
  - `src/index/build/file-processor/embeddings.js` currently coerces unexpected shapes to empty arrays and proceeds.
  - Add an explicit “dims contract” check and fail fast (or disable embeddings) if:
    - vectors are not arrays/typed arrays,
    - dims are inconsistent across chunks,
    - batch output length mismatches input length.
- [ ] **Make per-file embedding cache writes atomic** (cache files are written with `fs.writeFile`):
  - Why: partial/corrupt cache JSON can cause repeated recompute; while not “poisoning,” it degrades throughput and can mask real failures.
  - Files: `tools/build-embeddings/run.js` (cache writes), optionally reuse `tools/build-embeddings/atomic.js` or shared atomic writer.

**Exit criteria**
- [ ] Changing any embedding-relevant knob (model path/tokenizer/provider/normalization/pooling/quantization) forces cache miss.
- [ ] Dims mismatch fails loudly (or deterministically disables embeddings) in **both** build-embeddings and inline index-build paths.
- [ ] Stub-mode dims are consistent across indexing + retrieval.

---

#### 29.1.2 Determinism (float handling, batching order)

##### Current state (verified)
- [x] Quantization uses deterministic rounding (`src/index/embedding.js`).
- [x] Batched embedding retains input ordering in both tooling and index build (`tools/build-embeddings/embed.js`, `src/index/build/file-processor/embeddings.js`).

##### Remaining gaps / action items
- [ ] **Document and/or enforce determinism requirements for HNSW build**:
  - HNSW graph structure can vary with insertion order; current insertion order is “file processing order,” which depends on `Map` insertion order derived from chunk meta traversal.
  - Files: `tools/build-embeddings/run.js`, `tools/build-embeddings/hnsw.js`
  - Recommendation: ensure vectors are added to HNSW in a stable order (e.g., ascending `chunkIndex`).
- [ ] **Avoid nondeterministic file sampling in context window estimation**:
  - `src/index/build/context-window.js` uses the first N files in `files[]`; if upstream file enumeration order is OS-dependent, context window results can change.
  - Recommendation: sort file paths before sampling (or explicitly document nondeterminism).
- [ ] **Normalize float types across providers**:
  - Many paths convert typed arrays into JS arrays; this is deterministic but increases the surface for subtle differences and performance regressions.
  - Recommendation: standardize on `Float32Array` where feasible and only convert at serialization boundaries.

**Exit criteria**
- [ ] HNSW build is reproducible across runs given identical artifacts/config (or nondeterminism is clearly documented and accepted).
- [ ] Context window selection is stable given identical repo state.

---

#### 29.1.3 Robust fallback behavior (missing models/extensions/unsupported configs)

##### Current state (verified)
- [x] Retrieval embedding errors are caught and return `null` (`src/retrieval/embedding.js`), which allows the search pipeline to continue in sparse-only mode.
- [x] SQLite vector extension usage is guarded and can be disabled via sanitization (`tests/vector-extension-sanitize.js`).

##### Remaining gaps / action items
- [ ] **ONNX embedder config validation is partially ineffective**:
  - `src/shared/onnx-embeddings.js:createOnnxEmbedder()` checks `normalizeEmbeddingProvider('onnx') !== 'onnx'` which is a no-op (constant input).
  - Replace with validation of the *actual* requested provider (or remove the dead check).
- [ ] **Improve “missing model” errors with clear remediation** (especially for offline envs):
  - Recommend: explicitly mention `tools/download-models.js` and where the model path is expected.
  - Files: `src/shared/onnx-embeddings.js`, `src/index/embedding.js`
- [ ] **HNSW load path should fall back to `.bak` on corrupt primary**, not only when primary is missing:
  - Today: `src/shared/hnsw.js` only chooses `.bak` if primary missing; it does not retry `.bak` if `readIndexSync()` throws.
- [ ] **Use HNSW meta for safety checks**:
  - Retrieval load does not read `dense_vectors_hnsw.meta.json`, so it cannot validate `dims`, `space`, or `model` before querying.
  - Files: `src/shared/hnsw.js`
- [ ] **Add explicit tests for “extension missing” fallback**:
  - Currently there is sanitization coverage, but not “load failure / missing shared library” behavior.
  - Files/tests: `tools/build-embeddings/sqlite-dense.js` + new test.

**Exit criteria**
- [ ] Missing/corrupt HNSW artifacts do not crash retrieval; the system degrades gracefully to another ANN backend or sparse-only.
- [ ] Missing ONNX model artifacts fail with actionable errors (or clean fallback in non-strict modes).

---

### 29.2 Batching & scheduling

#### 29.2.1 Batch auto-tuning (memory/CPU/repo size)

##### Current state (verified)
- [x] Both index-build and build-embeddings tooling implement “auto batch” based on `os.totalmem()` (`src/index/build/runtime/embeddings.js`, `tools/build-embeddings/cli.js`).
- [x] Language-specific multipliers exist and are tested (`src/index/build/embedding-batch.js`, `tests/embedding-batch-multipliers.js`).

##### Remaining gaps / action items
- [ ] **Unify and justify auto-batch heuristics**:
  - Index-build uses `totalGb * 16` with min 16.
  - build-embeddings tool uses `totalGb * 32` with min 32.
  - Decide a single policy OR clearly document why they intentionally differ.
- [ ] **Incorporate CPU oversubscription controls**:
  - ONNX runtime can be multi-threaded (`threads` option), while the embedding queue can also be concurrent.
  - Add a policy: e.g., `embeddingConcurrency * onnxThreads <= cpuCount` (or document exceptions).
  - Files: `src/index/build/runtime/embeddings.js`, `src/shared/onnx-embeddings.js`
- [ ] **Adapt batch sizing to repo characteristics**:
  - For tiny repos/files, large batch sizes increase latency without improving throughput.
  - For huge repos, file-by-file batching underutilizes the accelerator (many small batches).
  - Recommendation: introduce a global “embedding batcher” that batches across files with:
    - max batch size,
    - max tokens/estimated memory per batch,
    - stable ordering.
  - Files impacted: `src/index/build/file-processor/embeddings.js`, `tools/build-embeddings/run.js`

**Exit criteria**
- [ ] Batch sizing + concurrency are predictable and safe across low-memory hosts, multi-core hosts, and both small and large repos.
- [ ] Default settings do not oversubscribe CPU when ONNX threads are enabled.

---

#### 29.2.2 Embedding queues (backpressure, bounded memory)

##### Current state (verified)
- [x] Service-mode job enqueue provides a `maxQueued` hook (`src/index/build/indexer/embedding-queue.js`).

##### Remaining gaps / action items
- [ ] **Define and enforce backpressure defaults**:
  - If `maxQueued` is unset/null, behavior depends on `enqueueJob()` (not in scope here); ensure a safe default exists.
  - Add explicit documentation + a test that verifies queue growth is bounded.
- [ ] **Ensure service jobs include enough identity to be safe**:
  - Job payload includes `{repo, mode}`, but not an embedding identity fingerprint.
  - Include `embeddingProvider`, model id, and/or a hash of embedding config to prevent mismatched worker configuration from producing incompatible embeddings.

**Exit criteria**
- [ ] Queue growth is bounded by default; overload produces clear errors and does not OOM the process.

---

#### 29.2.3 Session/model reuse

##### Current state (verified)
- [x] ONNX sessions are cached per normalized config (`src/shared/onnx-embeddings.js`).
- [x] Retrieval embedder instances are cached in-process (`src/retrieval/embedding.js`).

##### Remaining gaps / action items
- [ ] **Guard concurrent use of shared ONNX sessions if required**:
  - If `onnxruntime-node` sessions are not safe for concurrent `run()` calls, add a per-session mutex/queue.
  - At minimum: document thread-safety assumptions and add a stress test.
- [ ] **Avoid duplicate pipeline/session loads in index-build**:
  - `src/index/embedding.js` does not maintain a global cache similar to retrieval; if multiple embedder instances are constructed in one process, models may be loaded multiple times.

**Exit criteria**
- [ ] A single model/session is loaded once per process per config, and safely shared across all embedding calls.

---

### 29.3 ANN correctness

#### 29.3.1 Distance metric correctness (HNSW scoring)

##### Current state (verified)
- [x] HNSW ranker applies a stable tie-break (`idx`) after converting distances to similarity (`src/shared/hnsw.js`).

##### Remaining gaps / action items
- [ ] **Confirm and test distance-to-similarity conversion for each HNSW space** (`l2`, `cosine`, `ip`):
  - Current code treats `ip` the same as `cosine` (`sim = 1 - distance`).
  - This may be correct or incorrect depending on hnswlib’s distance definition for `ip`.
  - Required: add unit tests with known vectors and expected distances/similarities and adjust conversion if needed.
  - Files: `src/shared/hnsw.js`, new test (e.g., `tests/hnsw-distance-metrics.js`).

**Exit criteria**
- [ ] For each supported space, returned `sim` is monotonic with the true similarity notion used elsewhere in scoring.

---

#### 29.3.2 Atomic safety (no torn reads/writes)

##### Current state (verified)
- [x] Build writes HNSW `.bin` and `.meta.json` via atomic replace with `.bak` retention (`tools/build-embeddings/atomic.js`, `tools/build-embeddings/hnsw.js`).
- [x] There is a test that asserts `.bak` is created on replace (`tests/hnsw-atomic.js`).

##### Remaining gaps / action items
- [ ] **HNSW reader should support “corrupt primary” fallback**:
  - Implement: try primary, and if read fails, try `.bak` before giving up.
  - Files: `src/shared/hnsw.js`
- [ ] **Validate `.bin` / `.meta.json` pairing**:
  - Ensure meta file exists, parseable, and matches expected dims/space/model before using the index.
  - If mismatch, treat index as unavailable and fall back.

**Exit criteria**
- [ ] Retrieval never crashes due to a torn/corrupt HNSW file; fallback paths are exercised by tests.

---

#### 29.3.3 Candidate set semantics (HNSW + sqlite-vec)

##### Current state (verified)
- [x] SQLite candidate pushdown behavior is tested for small vs large candidate sets (`tests/sqlite-vec-candidate-set.js`).

##### Remaining gaps / action items
- [ ] **Handle empty candidate sets explicitly in HNSW path**:
  - `rankHnswIndex()` currently treats an empty set as “no filter” (because `candidateSet.size` is falsy), which can return results when none are desired.
  - Files: `src/shared/hnsw.js`
- [ ] **Document and test candidate-set cap behavior**:
  - HNSW uses a `candidateSetCap` default of 1000; ensure callers understand whether this can truncate results.
  - Add tests for:
    - empty set → empty hits,
    - small set → only those labels,
    - very large set → filter still applied and returned hits are subset, with stable ordering.
- [ ] **Align candidate-set tie-break behavior across backends**:
  - SQLite ANN tests require deterministic tie-break by `rowid`.
  - HNSW already tie-breaks by `idx`. Ensure both are consistent with retrieval expectations.

**Exit criteria**
- [ ] Candidate sets behave identically (semantically) across ANN backends: never return items outside the set, deterministic ordering for ties, predictable truncation rules.

---

### 29.4 Performance improvements to prioritize

#### 29.4.1 Float32Array end-to-end (avoid JS arrays of floats)
- [ ] **Standardize the embedding contract to return `Float32Array`**:
  - Files: `src/index/embedding.js`, `src/retrieval/embedding.js`, `src/shared/onnx-embeddings.js`, `src/shared/embedding.js`
- [ ] **Update downstream code to accept typed arrays** (don’t gate on `Array.isArray`):
  - Files: `src/index/build/file-processor/embeddings.js`, `tools/build-embeddings/embed.js`, `tools/build-embeddings/run.js`, `tools/build-embeddings/hnsw.js`
- [ ] **Defer conversion to JS arrays only at serialization boundaries** (JSON writing).

#### 29.4.2 Minimize serialization between threads/processes (transferable buffers)
- [ ] Where embeddings are computed in worker threads/processes (service mode), prefer:
  - transferring `ArrayBuffer`/`SharedArrayBuffer` instead of JSON arrays,
  - or using binary packed formats for vectors.
- [ ] Add an explicit “embedding payload format” version in job payloads so workers and callers stay compatible.
  - File touchpoints: `src/index/build/indexer/embedding-queue.js` (job payload)

#### 29.4.3 Pre-allocate and reuse buffers
- [ ] **ONNX embedding path**:
  - Avoid per-call allocations:
    - re-use `BigInt64Array` buffers for token ids/masks where shapes are stable,
    - avoid `Array.from()` conversions for slices.
  - Files: `src/shared/onnx-embeddings.js`
- [ ] **Index-build merge path**:
  - Avoid allocating a new zero vector per chunk in `attachEmbeddings()`.
  - File: `src/index/build/file-processor/embeddings.js`

#### 29.4.4 Candidate generation tuning
- [ ] Push sparse filters earlier and reduce dense scoring work:
  - prefer ANN-restricted candidate sets before dense dot products,
  - prefer pushing candidate constraints into sqlite-vec queries when small enough (already partially implemented).
  - (Some of this lives outside the reviewed file list; track as cross-cutting work.)

**Exit criteria**
- [ ] Embedding pipelines avoid unnecessary conversions/allocations; measurable CPU and memory reductions on large repos.
- [ ] ANN candidate generation demonstrably reduces dense scoring load for common queries.

---

### 29.5 Refactoring goals

#### 29.5.1 Single embedding interface shared by build + retrieval
- [ ] Create a single shared adapter interface, e.g.:
  - `embed(texts: string[], opts) => Float32Array[]`
  - `embedOne(text: string, opts) => Float32Array`
- [ ] Move provider selection + error handling behind adapters:
  - `xenova`, `onnx`, `stub`.
- [ ] Ensure both index-build and retrieval use the same adapter and the same preprocessing defaults.

#### 29.5.2 Centralize normalization & preprocessing
- [ ] Eliminate duplicated `normalizeVec()` implementations:
  - `src/index/embedding.js`
  - `src/shared/onnx-embeddings.js`
  - `tools/build-embeddings/embed.js` (indirectly uses index/embedding normalization)
- [ ] Centralize:
  - pooling strategy,
  - normalization strategy,
  - truncation/max_length policy,
  - doc/code merge policy.

#### 29.5.3 Clear ANN backend adapters
- [ ] Wrap sqlite-vec and HNSW behind a single “ANN adapter” contract with:
  - candidate set semantics,
  - deterministic tie-break contract,
  - consistent error handling and stats reporting.
  - (Some of this lives outside the reviewed file list.)

**Exit criteria**
- [ ] Build + retrieval cannot diverge in embedding shape/normalization/pooling without a deliberate, versioned change.
- [ ] ANN behavior is consistent regardless of backend.

---

### 29.6 Tests

#### 29.6.1 Coverage checklist

##### Already covered (verified)
- [x] Cache identity/invalidation (baseline) — `tests/embeddings-cache-identity.js`, `tests/embeddings-cache-invalidation.js`
- [x] Dims mismatch (tooling) — `tests/embeddings-dims-mismatch.js`, `tests/embeddings-dims-validation.js`
- [x] ANN candidate set correctness (sqlite-vec) — `tests/sqlite-vec-candidate-set.js`
- [x] HNSW artifacts existence + atomic replace — `tests/hnsw-ann.js`, `tests/hnsw-atomic.js`

##### Missing / needs additions
- [ ] **Cache identity tests must cover provider-specific knobs**, especially ONNX config:
  - Add tests proving that changing `onnx.tokenizerId` or `onnx.modelPath` changes identityKey and forces cache miss.
- [ ] **Add extension missing/fallback tests**:
  - Simulate vector extension load failure and ensure build/search does not crash and disables vector ANN.
- [ ] **Add HNSW candidate set tests**:
  - empty set returns empty hits,
  - filter does not leak labels,
  - tie-break stability.
- [ ] **Add HNSW `.bak` fallback tests**:
  - corrupt primary index/meta triggers `.bak` load and does not crash.
- [ ] **Add performance regression test for embedding batching throughput** (required by checklist):
  - Recommended approach (stable in CI):
    - Use a synthetic embedder function with a fixed per-call overhead + per-item cost.
    - Assert that `runBatched()` with batchSize>1 achieves >= X% speedup vs batchSize=1 on a fixed input size.
    - Use generous thresholds to avoid flakiness; focus on catching *major* regressions (e.g., accidental O(n²) behavior or disabling batching).
  - Candidate target: `tools/build-embeddings/embed.js:runBatched()` and/or `src/index/build/file-processor/embeddings.js` batching path.

**Exit criteria**
- [ ] Tests fail if embedding identity changes are not reflected in cache keys.
- [ ] Tests cover ANN candidate set semantics for both sqlite-vec and HNSW.
- [ ] At least one performance regression test exists for batching throughput.

---

### Appendix A — File-by-file review notes (actionable items)

> The checklist items above are the canonical “what to fix.” This appendix maps concrete file-level changes back to those items.

#### src

##### `src/index/build/context-window.js`
- [ ] Sort/sanitize file list before sampling to reduce OS-dependent nondeterminism.
- [ ] Consider documenting that context-window estimation is heuristic and may vary with sampling strategy.

##### `src/index/build/embedding-batch.js`
- [ ] Consider parsing `baseSize` if it may come from config as a numeric string.
- [ ] Add explicit documentation for multiplier precedence (fallback vs user config).

##### `src/index/build/file-processor/embeddings.js`
- [ ] Add dims contract validation (non-empty vectors must share dims; fail fast otherwise).
- [ ] Support `Float32Array` outputs (don’t rely on `Array.isArray`).
- [ ] Avoid allocating `new Array(dims).fill(0)` per chunk; reuse a single `zeroVec`.
- [ ] Validate that `getChunkEmbeddings(texts).length === texts.length`; if not, log + fail or retry with a clear warning.
- [ ] Ensure doc embedding results are length-aligned with `docPayloads` (currently assumes perfect alignment).

##### `src/index/build/indexer/embedding-queue.js`
- [ ] Include embedding identity/config hash in job payload to prevent mismatched worker behavior.
- [ ] Consider switching job IDs to `crypto.randomUUID()` for collision resistance.
- [ ] Ensure `maxQueued` has a safe default; document backpressure behavior.

##### `src/index/build/runtime/embeddings.js`
- [ ] Reconcile auto-batch policy with tooling (`tools/build-embeddings/cli.js`).
- [ ] Consider incorporating ONNX thread settings into concurrency auto-tune to avoid oversubscription.

##### `src/index/embedding.js`
- [ ] Centralize `normalizeVec`/`quantizeVec` into shared utilities; remove duplication.
- [ ] Add strict provider validation (unknown provider should error/warn).
- [ ] Harden `normalizeBatchOutput()` to:
  - guarantee output length equals input count,
  - handle unexpected tensor dims more defensively,
  - avoid returning a single huge vector when output is 3D.
- [ ] Prefer returning `Float32Array` (or at least accept typed arrays downstream).

##### `src/retrieval/embedding.js`
- [ ] Use a normalized/fingerprinted ONNX config in the embedder cache key (avoid JSON-order sensitivity).
- [ ] If retrieval can request embeddings without known dims (ANN-only paths), require dims or ensure consistent default dims.
- [ ] Consider logging embedder load failures once (rate-limited) to aid debugging.

##### `src/shared/embedding.js`
- [ ] Unify stub default dims with the rest of the system (recommend 384).
- [ ] Optionally return `Float32Array` to match the desired end-to-end contract.

##### `src/shared/hnsw.js`
- [ ] Implement `.bak` fallback when the primary index exists but is corrupt/unreadable.
- [ ] Read/validate `dense_vectors_hnsw.meta.json` to confirm `dims/space/model` before using the index.
- [ ] Handle empty candidate sets explicitly by returning `[]`.
- [ ] Add unit tests for distance conversion across spaces (l2/cosine/ip) and adjust similarity conversion if required.

##### `src/shared/onnx-embeddings.js`
- [ ] Remove/fix dead provider check (`normalizeEmbeddingProvider('onnx')`).
- [ ] Add clearer error messaging for missing model artifacts + remediation steps.
- [ ] Improve performance by avoiding heavy array conversions and by reusing buffers/tensors.
- [ ] Consider concurrency guards around `session.run()` if onnxruntime sessions are not safe concurrently.

---

#### tools

##### `tools/build-embeddings.js`
- No issues observed beyond those in underlying implementation modules.

##### `tools/build-embeddings/atomic.js`
- [ ] Consider consolidating atomic replace logic with `src/shared/json-stream.js` to avoid divergence (optional refactor).

##### `tools/build-embeddings/cache.js`
- [ ] Expand identity schema to include preprocessing and provider-specific config (especially ONNX knobs).
- [ ] Add a bumpable “identity version” or build-tool version fingerprint.

##### `tools/build-embeddings/chunks.js`
- [ ] Consider incorporating doc-related signals into the chunk signature (or into identity versioning) so doc embedding caches invalidate when doc extraction logic changes.
- [ ] Consider normalizing `start/end` to finite numbers before signature generation (avoid stringifying `undefined`).

##### `tools/build-embeddings/cli.js`
- [ ] Document (or change) the behavior where `mode=service` is coerced to `inline` for this tool.
- [ ] Unify auto-batch defaults with index-build runtime (or document why they differ).

##### `tools/build-embeddings/embed.js`
- [ ] Update to accept and return typed arrays (`Float32Array`) instead of insisting on JS arrays.
- [ ] Consider failing fast on non-vector outputs instead of silently returning `[]` entries (to avoid quietly producing all-zero embeddings).

##### `tools/build-embeddings/hnsw.js`
- [ ] Ensure stable vector insertion order into HNSW (ascending chunkIndex).
- [ ] When adding vectors reconstructed from cache (dequantized), consider re-normalizing for cosine space to reduce drift.

##### `tools/build-embeddings/manifest.js`
- [ ] Consider reading HNSW meta to report accurate `count`/`dims` for ANN piece files, rather than relying on `totalChunks` (defensive correctness).

##### `tools/build-embeddings/run.js`
- [ ] Make cache writes atomic (optional but recommended).
- [ ] Use `Number.isFinite()` for chunk start/end to avoid 0/NaN edge cases from `||` coercion.
- [ ] Apply `ensureVectorArrays()` to embedded doc batches just like code batches.
- [ ] Make HNSW build deterministic (stable insertion order).
- [ ] Consider adding a global cross-file batcher for throughput.

##### `tools/build-embeddings/sqlite-dense.js`
- [ ] Add tests for “vector extension missing/failed to load” fallback behavior.
- [ ] Consider batching inserts in larger chunks or using prepared statements more aggressively for performance on large vector sets.

##### `tools/compare-models.js`
- [ ] If comparing ONNX vs xenova providers, ensure the script can capture and report provider config differences (identity) to interpret deltas correctly (minor enhancement).

##### `tools/download-models.js`
- [ ] Consider supporting explicit download of ONNX model artifacts when users rely on `indexing.embeddings.provider=onnx` and custom `onnx.modelPath`.
- [ ] Improve output to show where models were cached and what to set in config if needed.

---

#### tests

##### `tests/build-embeddings-cache.js`
- [ ] Extend to assert cache identity changes for ONNX config changes (once identity schema is expanded).

##### `tests/embedding-batch-autotune.js`
- [ ] Consider loosening or documenting assumptions about minimum batch size on low-memory systems (or adjust runtime min to match test expectations).

##### `tests/embedding-batch-multipliers.js`
- No issues; good coverage of multiplier normalization.

##### `tests/embeddings-cache-identity.js`
- [ ] Extend to cover ONNX-specific identity fields (tokenizerId/modelPath/etc).

##### `tests/embeddings-cache-invalidation.js`
- [ ] Add invalidation scenarios tied to preprocessing knobs (pooling/normalize/max_length) once surfaced in identity.

##### `tests/embeddings-dims-mismatch.js`
- Good.

##### `tests/embeddings-dims-validation.js`
- Good.

##### `tests/embeddings-sqlite-dense.js`
- [ ] Add coverage for vector extension load failure paths (extension missing), not only baseline dense sqlite insertions.

##### `tests/embeddings-validate.js`
- Good baseline index-state + artifact validation coverage.

##### `tests/hnsw-ann.js`
- [ ] Add correctness assertions beyond “backend selected”:
  - candidate set filtering (once exposed),
  - tie-break determinism,
  - sanity check of returned ordering for a known query on fixture corpus.

##### `tests/hnsw-atomic.js`
- [ ] Add test for `.bak` fallback on corrupt primary index/meta (reader-side).

##### `tests/smoke-embeddings.js`
- Good smoke harness; consider adding new tests to this suite after implementing performance regression and fallback tests.

##### `tests/sqlite-vec-candidate-set.js`
- [ ] Add a column-name sanitization test (table is covered; column is not).

##### `tests/vector-extension-sanitize.js`
- Good table sanitization coverage; extend for column sanitization as above.

---


## Phase 30 — Index analysis features (metadata/risk/git/type-inference) — Review findings & remediation checklist

**Objective:** Review the Section 4 file set (56 files) and produce a concrete, exhaustive remediation checklist that (1) satisfies the provided Phase 4 checklist (A–G) and (2) captures additional defects, inconsistencies, and improvements found during review.

**Scope:** All files enumerated in `pairofcleats_review_section_4_files_and_checklist.md` (src/tests/docs).  
**Out of scope:** Implementing fixes in-code (this document is a work plan / punch list).

---

### Summary (priority ordered)

#### P0 — Must fix (correctness / crash / schema integrity)

- [ ] **Risk rules regex compilation is currently mis-wired.** `src/index/risk-rules.js` calls `createSafeRegex()` with an incorrect argument signature, so rule regex configuration (flags, limits) is not applied, and invalid patterns can throw and abort normalization.  
  - Fix in: `src/index/risk-rules.js` (see §B.1).
- [ ] **Risk analysis can crash indexing on long lines.** `src/index/risk.js` calls SafeRegex `test()` / `exec()` without guarding against SafeRegex input-length exceptions. One long line can throw and fail the whole analysis pass.  
  - Fix in: `src/index/risk.js` (see §B.2).
- [ ] **Metadata v2 drops inferred/tooling parameter types (schema data loss).** `src/index/metadata-v2.js` normalizes type maps assuming values are arrays; nested maps (e.g., `inferredTypes.params.<name>[]`) are silently discarded.  
  - Fix in: `src/index/metadata-v2.js` + tests + schema/docs (see §A.1–A.4).

#### P1 — Should fix (determinism, performance, docs, validation gaps)

- [ ] **`metaV2` validation is far too shallow and does not reflect the actual schema shape.** `src/index/validate.js` only validates a tiny subset of fields and does not traverse nested type maps.  
- [ ] **Docs drift:** `docs/metadata-schema-v2.md` and `docs/risk-rules.md` do not fully match current code (field names, structures, and configuration).  
- [ ] **Performance risks:** risk scanning does redundant passes and does not short-circuit meaningfully when capped; markdown parsing is duplicated (inline + fenced); tooling providers re-read files rather than reusing already-loaded text.

#### P2 — Nice to have (quality, maintainability, test depth)

- [ ] Improve signature parsing robustness for complex types (C-like, Python, Swift).
- [ ] Clarify and standardize naming conventions (chunk naming vs provider symbol naming, “generatedBy”, “embedded” semantics).
- [ ] Expand tests to cover surrogate pairs (emoji), CRLF offsets, and risk rules/config edge cases.

---

### A) Metadata v2: correctness, determinism, and validation

#### Dependency guidance (best choices)
- `ajv` — encode **metadata-schema-v2** as JSON Schema and validate `metaV2` as a hard gate in `tools/index-validate` (or equivalent).  
- `semver` — version `metaV2.schemaVersion` independently and gate readers/writers.

#### A.1 `metaV2.types` loses nested inferred/tooling param types (P0)

##### Affected files
- `src/index/metadata-v2.js`
- `docs/metadata-schema-v2.md`
- `src/index/validate.js`
- `tests/metadata-v2.js`

##### Findings
- [ ] **Data loss bug:** `normalizeTypeMap()` assumes `raw[key]` is an array of entries. If `raw[key]` is an object map (e.g., `raw.params` where `raw.params.<paramName>` is an array), it is treated as non-array and dropped.  
  - Evidence: `normalizeTypeMap()` (lines ~78–91) only normalizes `Array.isArray(entries)` shapes.
- [ ] **Downstream effect:** `splitToolingTypes()` is applied to `docmeta.inferredTypes`; because nested shapes are not handled, **tooling-derived param types will not appear in `metaV2.types.tooling.params`**, and inferred param types will be absent from `metaV2.types.inferred.params`.

##### Required remediation
- [ ] Update `normalizeTypeMap()` to support nested “param maps” (and any similar nested structures) rather than dropping them. A pragmatic approach:
  - [ ] If `entries` is an array → normalize as today.
  - [ ] If `entries` is an object → treat it as a nested map and normalize each subkey:
    - preserve the nested object shape in output (preferred), or
    - flatten with a predictable prefix strategy (only if schema explicitly adopts that).
- [ ] Update `splitToolingTypes()` so it correctly separates tooling vs non-tooling entries **inside nested maps** (e.g., `params.<name>[]`, `locals.<name>[]`).
- [ ] Update `tests/metadata-v2.js` to assert:
  - [ ] inferred param types survive into `metaV2.types.inferred.params.<paramName>[]`
  - [ ] tooling param types survive into `metaV2.types.tooling.params.<paramName>[]`
  - [ ] non-tooling inferred types do not leak into tooling bucket (and vice versa)

#### A.2 Declared types coverage is incomplete (P1)

##### Findings
- [ ] `buildDeclaredTypes()` currently only materializes:
  - param annotations via `docmeta.paramTypes`
  - return annotation via `docmeta.returnType`  
  It does **not** cover:
  - [ ] parameter defaults (`docmeta.paramDefaults`)
  - [ ] local types (`docmeta.localTypes`)
  - [ ] any other declared type sources the codebase may already emit

##### Required remediation
- [ ] Decide which “declared” facets are part of Metadata v2 contract and implement them consistently (and document them):
  - [ ] `declared.defaults` (if desired)
  - [ ] `declared.locals` (if desired)
- [ ] Update `docs/metadata-schema-v2.md` accordingly.
- [ ] Add tests in `tests/metadata-v2.js` for any newly included declared facets.

#### A.3 Determinism and stable ordering in `metaV2` (P1)

##### Findings
- [ ] Several arrays are produced via Set insertion order (e.g., `annotations`, `params`, `risk.tags`, `risk.categories`). While *often* stable, they can drift if upstream traversal order changes.
- [ ] `metaV2` mixes optional `null` vs empty collections inconsistently across fields (some fields null, others empty arrays). This matters for artifact diffs and schema validation.

##### Required remediation
- [ ] Standardize ordering rules for arrays that are semantically sets:
  - [ ] Sort `annotations` (lexicographic) before emitting.
  - [ ] Sort `params` (lexicographic) before emitting.
  - [ ] Sort risk `tags`/`categories` (lexicographic) before emitting.
- [ ] Establish a consistent “empty means null” vs “empty means []” policy for v2 and enforce it in `buildMetaV2()` and schema/docs.

#### A.4 `generatedBy` and `embedded` semantics are unclear (P2)

##### Findings
- [ ] `generatedBy` currently uses `toolInfo?.version` only; if `tooling` already contains `tool` and `version`, this can be redundant and underspecified.
- [ ] `embedded` is emitted whenever `chunk.segment` exists, even when the segment is not embedded (parentSegmentId may be null). This makes the field name misleading.

##### Required remediation
- [ ] Decide and document the intended meaning:
  - [ ] Option A: `generatedBy = "<tool>@<version>"` and keep `tooling` for structured detail.
  - [ ] Option B: remove `generatedBy` and rely solely on `tooling`.
- [ ] Restrict `embedded` field to truly-embedded segments only **or** rename the field to something like `segmentContext` / `embedding`.

#### A.5 Validation gaps for Metadata v2 (P1)

##### Findings (in `src/index/validate.js`)
- [ ] `validateMetaV2()` (lines ~162–206) validates only:
  - `chunkId` presence
  - `file` presence
  - `risk.flows` has `source` and `sink`
  - type entries have `.type` for a shallow, array-only traversal  
  It does **not** validate:
  - [ ] `segment` object shape
  - [ ] range/start/end types and ordering invariants
  - [ ] `lang`, `ext`, `kind`, `name` constraints
  - [ ] nested types map shapes (params/locals)
  - [ ] `generatedBy`/`tooling` shape and required fields
  - [ ] cross-field invariants (e.g., range within segment, embedded context consistency)

##### Required remediation
- [ ] Establish **one canonical validator** for `metaV2` (preferably schema-based):
  - [ ] Add an explicit JSON Schema for v2 (in docs or tooling directory).
  - [ ] Validate `metaV2` against the schema in `validateIndexArtifacts()`.
- [ ] If schema-based validation is not yet possible, expand `validateMetaV2()` to:
  - [ ] traverse nested `params`/`locals` maps for type entries
  - [ ] validate `range` numbers, monotonicity, and non-negativity
  - [ ] validate the presence/type of stable core fields as defined in `docs/metadata-schema-v2.md`
- [ ] Add tests (or fixtures) that exercise validation failures for each major failure class.

#### A.6 Docs drift: `docs/metadata-schema-v2.md` vs implementation (P1)

##### Findings
- [ ] The schema doc should be reviewed line-by-line against current `buildMetaV2()` output:
  - field names
  - optionality
  - nesting of `types.*`
  - risk shapes and analysisStatus shape
  - relations link formats

##### Required remediation
- [ ] Update `docs/metadata-schema-v2.md` to reflect the actual emitted shape **or** update `buildMetaV2()` to match the doc (pick one, do not leave them divergent).
- [ ] Add a “schema change log” section so future modifications don’t silently drift.

---

### B) Risk rules and risk analysis

#### Dependency guidance (best choices)
- `re2`/RE2-based engine (already present via `re2js`) — keep for ReDoS safety, but ensure wrapper behavior cannot crash indexing.
- `ajv` — validate rule bundle format (ids, patterns, severities, categories, etc.) before compiling.

#### B.1 Risk regex compilation is broken (P0)

##### Affected file
- `src/index/risk-rules.js`

##### Findings
- [ ] **Incorrect call signature:** `compilePattern()` calls `createSafeRegex(pattern, flags, regexConfig)` but `createSafeRegex()` accepts `(pattern, config)` (per `src/shared/safe-regex.js`).  
  Consequences:
  - `regexConfig` is ignored entirely
  - the intended default flags (`i`) are not applied
  - any user-configured safe-regex limits are not applied
- [ ] **No error shielding:** `compilePattern()` does not catch regex compilation errors. An invalid pattern can throw and abort normalization.

##### Required remediation
- [ ] Fix `compilePattern()` to call `createSafeRegex(pattern, safeRegexConfig)` (or a merged config object).
- [ ] Wrap compilation in `try/catch` and return `null` on failure (or record a validation error) so rule bundles cannot crash indexing.
- [ ] Add tests that verify:
  - [ ] configured flags (e.g., `i`) actually take effect
  - [ ] invalid patterns do not crash normalization and are surfaced as actionable diagnostics
  - [ ] configured `maxInputLength` and other safety controls are honored

#### B.2 Risk analysis can crash on long inputs (P0)

##### Affected file
- `src/index/risk.js`

##### Findings
- [ ] `matchRuleOnLine()` calls SafeRegex `test()` and `exec()` without guarding against exceptions thrown by SafeRegex input validation (e.g., when line length exceeds `maxInputLength`).  
  - This is a hard failure mode: one long line can abort analysis for the entire file (or build, depending on call site error handling).

##### Required remediation
- [ ] Ensure **risk analysis never throws** due to regex evaluation. Options:
  - [ ] Add `try/catch` around `rule.requires.test(...)`, `rule.excludes.test(...)`, and `pattern.exec(...)` to treat failures as “no match”.
  - [ ] Alternatively (or additionally), change the SafeRegex wrapper to return `false/null` instead of throwing for overlong input.
  - [ ] Add a deterministic “line too long” cap behavior:
    - skip risk evaluation for that line
    - optionally record `analysisStatus.exceeded` includes `maxLineLength` (or similar)

#### B.3 `scope` and cap semantics need tightening (P1)

##### Findings
- [ ] `scope === 'file'` currently evaluates only `lineIdx === 0` (first line). This is likely not the intended meaning of “file scope”.
- [ ] `maxMatchesPerFile` currently caps **number of matching lines**, not number of matches (variable name implies match-count cap).

##### Required remediation
- [ ] Define (in docs + code) what `scope: "file"` means:
  - [ ] “pattern evaluated against entire file text” (recommended), or
  - [ ] “pattern evaluated once per file via a representative subset”
- [ ] Implement `maxMatchesPerFile` as an actual match-count cap (or rename it to `maxMatchingLines`).
- [ ] Add tests for both behaviors.

#### B.4 Performance: redundant scanning and weak short-circuiting (P1)

##### Findings
- [ ] Risk analysis scans the same text repeatedly (sources, sinks, sanitizers are scanned in separate loops).
- [ ] When caps are exceeded (bytes/lines), flows are skipped, but line scanning for matches still proceeds across the entire file, which defeats the purpose of caps for large/minified files.

##### Required remediation
- [ ] Add an early-exit path when `maxBytes`/`maxLines` caps are exceeded:
  - either skip all analysis and return `analysisStatus: capped`
  - or scan only a bounded prefix/suffix and clearly mark that results are partial
- [ ] Consider a single-pass scanner per line that evaluates all rule categories in one traversal.
- [ ] Add a prefilter stage for candidate files/lines (cheap substring checks) before SafeRegex evaluation.

#### B.5 Actionability and determinism of outputs (P1)

##### Findings
- [ ] `dedupeMatches()` collapses evidence to one match per rule id (may not be sufficient for remediation).
- [ ] Time-based caps (`maxMs`) can introduce nondeterminism across machines/runs (what gets included depends on wall clock).

##### Required remediation
- [ ] Preserve up to N distinct match locations per rule (configurable) rather than only first hit.
- [ ] Prefer deterministic caps (maxBytes/maxLines/maxNodes/maxEdges) over time caps; if `maxMs` remains, ensure it cannot cause nondeterministic partial outputs without clearly indicating partiality.
- [ ] Sort emitted matches/flows deterministically (by line/col, rule id) before output.

#### B.6 Docs drift: `docs/risk-rules.md` vs implementation (P1)

##### Findings
- [ ] `docs/risk-rules.md` should be updated to reflect:
  - actual rule bundle fields supported (`requires`, `excludes`, `scope`, `maxMatchesPerLine`, `maxMatchesPerFile`, etc.)
  - actual emitted `risk.analysisStatus` shape (object vs string)
  - actual matching semantics (line-based vs file-based)

##### Required remediation
- [ ] Update the doc to match current behavior (or update code to match doc), then add tests that lock it in.

---

### C) Git signals (metadata + blame-derived authorship)

#### Dependency guidance (best choices)
- `simple-git` (already used) — ensure it’s called in a way that scales: batching where feasible, caching aggressively, and defaulting expensive paths off unless explicitly enabled.

#### C.1 Default blame behavior and cost control (P1)

##### Affected file
- `src/index/git.js`

##### Findings
- [ ] `blameEnabled` defaults to **true** (`options.blame !== false`). If a caller forgets to pass `blame:false`, indexing will run `git blame` per file (very expensive).
- [ ] `git log` + `git log --numstat` are executed per file; caching helps within a run but does not avoid the O(files) subprocess cost.

##### Required remediation
- [ ] Make blame opt-in by default:
  - [ ] change default to `options.blame === true`, **or**
  - [ ] ensure all call sites pass `blame:false` unless explicitly requested via config
- [ ] Consider adding a global “gitSignalsPolicy” (or reuse existing policy object) that centrally controls:
  - blame on/off
  - churn computation on/off
  - commit log depth
- [ ] Performance optimization options (choose based on ROI):
  - [ ] batch `git log` queries when indexing many files (e.g., per repo, not per file)
  - [ ] compute churn only when needed for ranking/filtering
  - [ ] support “recent churn only” explicitly in docs (currently it’s “last 10 commits”)

#### C.2 Minor correctness and maintainability issues (P2)

##### Findings
- [ ] Misleading JSDoc: `parseLineAuthors()` is documented as “Compute churn from git numstat output” (it parses blame authors, not churn). This can mislead future maintenance.

##### Required remediation
- [ ] Fix the JSDoc to match the function purpose and parameter type.

#### C.3 Tests improvements (P1)

##### Affected tests
- `tests/git-blame-range.js`
- `tests/git-meta.js`
- `tests/churn-filter.js`
- `tests/git-hooks.js`

##### Findings
- [ ] No tests assert “blame is off by default” (or the intended default policy).
- [ ] No tests cover rename-following semantics (`--follow`) or untracked files.
- [ ] Caching behavior is not validated (e.g., “git blame called once per file even if many chunks”).

##### Required remediation
- [ ] Add tests that explicitly validate the intended default blame policy.
- [ ] Add a caching-focused test that ensures repeated `getGitMeta()` calls for the same file do not spawn repeated git commands (can be validated via mocking or by instrumenting wrapper counts).
- [ ] Decide whether rename-following is required and add tests if so.

---

### D) Type inference (local + cross-file + tooling providers)

#### Dependency guidance (best choices)
- LSP-based providers (clangd/sourcekit/pyright) — keep optional and guarded; correctness should degrade gracefully.
- TypeScript compiler API — keep optional and isolated; add caching/incremental compilation for large repos.

#### D.1 Provider lifecycle and resilience (P1)

##### Affected files
- `src/index/type-inference-crossfile/tooling.js`
- `src/index/tooling/*.js`
- `src/integrations/tooling/lsp/client.js`
- `src/integrations/tooling/providers/lsp.js`
- `src/integrations/tooling/providers/shared.js`

##### Findings
- [ ] `createLspClient().request()` can leave pending requests forever if a caller forgets to supply `timeoutMs` (pending map leak). Current provider code *usually* supplies a timeout, but this is not enforced.
- [ ] Diagnostics timing: providers request symbols immediately after `didOpen` and then `didClose` quickly; some servers publish diagnostics asynchronously and may not emit before close, leading to inconsistent diagnostic capture.

##### Required remediation
- [ ] Enforce a default request timeout in `createLspClient.request()` if none is provided.
- [ ] For diagnostics collection, consider:
  - [ ] waiting a bounded time for initial diagnostics after `didOpen`, or
  - [ ] explicitly requesting diagnostics if server supports it (varies), or
  - [ ] documenting that diagnostics are “best effort” and may be incomplete

#### D.2 Unicode/offset correctness: add stronger guarantees (P1)

##### Affected files
- `src/integrations/tooling/lsp/positions.js`
- `src/shared/lines.js` (supporting)
- `tests/type-inference-lsp-enrichment.js`
- `tests/segment-pipeline.js` + fixtures

##### Findings
- [ ] `positions.js` JSDoc claims “1-based line/column”; column is actually treated as 0-based (correct for LSP), but the doc comment is misleading.
- [ ] Test coverage does not explicitly include surrogate pairs (emoji), which are the common failure mode when mixing code-point vs UTF-16 offsets.

##### Required remediation
- [ ] Fix the JSDoc to reflect actual behavior (LSP: 0-based character offsets; line converted to 1-based for internal helpers).
- [ ] Add tests with:
  - [ ] emoji in identifiers and/or strings before symbol definitions
  - [ ] CRLF line endings fixtures (if Windows compatibility is required)

#### D.3 Generic LSP provider chunk matching is weaker than clangd provider (P2)

##### Affected file
- `src/integrations/tooling/providers/lsp.js`

##### Findings
- [ ] `findChunkForOffsets()` requires strict containment (symbol range must be within chunk range). clangd-provider uses overlap scoring, which is more robust.

##### Required remediation
- [ ] Update generic provider to use overlap scoring like clangd-provider to reduce missed matches.

#### D.4 TypeScript provider issues (P2/P1 depending on usage)

##### Affected file
- `src/index/tooling/typescript-provider.js`

##### Findings
- [ ] `loadTypeScript()` resolve order includes keys that are not implemented (`global`) and duplicates (`cache` vs `tooling`).
- [ ] Parameter name extraction uses `getText()` which can produce non-identifiers for destructuring params (bad keys for `params` map).
- [ ] Naming convention risk: provider writes keys like `Class.method` which may not match chunk naming conventions; if mismatched, types will not attach.

##### Required remediation
- [ ] Fix the resolution order logic and document each lookup path purpose.
- [ ] Only record parameter names for identifiers; skip or normalize destructuring params.
- [ ] Validate chunk naming alignment (structural chunk naming vs provider symbol naming) and add a test for a class method mapping end-to-end.

#### D.5 Cross-file inference merge determinism and evidence (P2)

##### Affected files
- `src/index/type-inference-crossfile/apply.js`
- `src/index/type-inference-crossfile/pipeline.js`

##### Findings
- [ ] `mergeTypeList()` dedupes by `type|source` but drops evidence differences; confidence merging strategy is simplistic.
- [ ] Output ordering is not explicitly sorted after merges.

##### Required remediation
- [ ] Decide how to treat evidence in merges (keep first, merge arrays, keep highest confidence).
- [ ] Sort merged type lists deterministically (confidence desc, type asc, source asc).

#### D.6 Signature parsing robustness (P2)

##### Affected files
- `src/index/tooling/signature-parse/clike.js`
- `src/index/tooling/signature-parse/python.js`
- `src/index/tooling/signature-parse/swift.js`

##### Findings
- [ ] Parsers are intentionally lightweight, but they will fail on common real-world signatures:
  - C++ templates, function pointers, references
  - Python `*args/**kwargs`, keyword-only params, nested generics
  - Swift closures and attributes

##### Required remediation
- [ ] Add test fixtures covering at least one “hard” signature per language.
- [ ] Consider using tooling hover text more consistently (already used as fallback in clangd-provider) or integrate a minimal parser that handles nested generics and defaults.

---

### E) Performance improvements to prioritize (cross-cutting)

#### E.1 Risk analysis hot path (P1)
- [ ] Single-pass line scan for sources/sinks/sanitizers.
- [ ] Early return on caps (maxBytes/maxLines) rather than scanning the whole file anyway.
- [ ] Cheap prefilter before SafeRegex evaluation.
- [ ] Avoid per-line SafeRegex exceptions (see §B.2).

#### E.2 Markdown segmentation duplication (P2)
- [ ] `segments.js` parses markdown twice (inline code spans + fenced blocks). Consider extracting both from one micromark event stream.

#### E.3 Tooling providers I/O duplication (P2)
- [ ] Providers re-read file text from disk; if indexing already has the content in memory, pass it through (where feasible) to reduce I/O.

---

### F) Refactoring goals (maintainability / policy centralization)

- [ ] Consolidate analysis feature toggles into a single `analysisPolicy` object that is passed to:
  - metadata v2 builder
  - risk analysis
  - git analysis
  - type inference (local + cross-file + tooling)
- [ ] Centralize schema versioning and validation:
  - one metadata v2 schema
  - one risk rule bundle schema
  - one place that validates both as part of artifact validation

---

### G) Tests: required additions and upgrades

#### Existing tests reviewed (from the provided list)
- `tests/metadata-v2.js`
- `tests/churn-filter.js`
- `tests/git-blame-range.js`
- `tests/git-hooks.js`
- `tests/git-meta.js`
- `tests/minhash-parity.js`
- `tests/segment-pipeline.js` (+ fixtures)
- `tests/type-inference-crossfile*.js`
- `tests/type-inference-lsp-enrichment.js`
- `tests/type-inference-*-provider-no-*.js` (clangd/sourcekit)

#### Required test upgrades (P1/P0 where noted)
- [ ] **P0:** Add tests for metadata v2 nested inferred/tooling param types (see §A.1).
- [ ] **P0:** Add tests for risk rule compilation config correctness (flags honored, invalid patterns handled) (see §B.1).
- [ ] **P0:** Add risk analysis “long line” test to ensure no crashes (see §B.2).
- [ ] **P1:** Add unicode offset tests that include surrogate pairs (emoji) for:
  - LSP position mapping
  - chunk start offsets around unicode
- [ ] **P1:** Add git caching/policy tests (default blame policy + no repeated subprocess calls where caching is intended).

---

**Deliverables**
- This remediation checklist (this document)
- Updated `docs/metadata-schema-v2.md` and `docs/risk-rules.md` that match implementation
- Expanded test suite that locks in:
  - metaV2 types correctness (including nested)
  - risk rule compilation correctness and non-crashing evaluation
  - unicode offset correctness (including surrogate pairs)
  - intended git blame policy and caching

**Exit criteria**
- All P0 items are fixed and covered by tests.
- Metadata v2 output matches the schema doc, and `validateIndexArtifacts()` validates it meaningfully.
- Risk analysis and tooling passes are “best-effort”: they may skip/partial, but they never crash indexing.


## Phase 31 — Language handlers & chunking review (Section 5)

**Objective:** Make language detection, per-language chunking, tree-sitter integration, and ingestion tooling *deterministic, robust on real-world code*, and *well-tested* — with clear fallback behavior, predictable chunk boundaries, and guardrails against performance/pathological inputs.

**Scope reference:** Review Section 5 file list + checklist (see the attached “review section 5 files and checklist” markdown).

### Note
While generating the markdown deliverable, I noticed one small wording issue in the YAML section of the produced document: it currently describes the tab bug using code spans that don’t clearly distinguish '\t' vs '\\t' (because Markdown code spans visually collapse some intent). The underlying identified bug is correct and the remediation tasks are correct, but that one wording line could be clarified to explicitly contrast '\\t' (backslash+t) vs '\t' (actual tab).

---

### 31.0 Priority findings summary (what must be fixed first)

#### P0 — Breaks correctness, tests, or core workflows
- [ ] **Fix YAML tab handling + Windows path normalization bugs** in `src/index/chunking/formats/yaml.js` (tabs currently checked as the literal string `"\t"`; Windows paths normalized with the wrong regex).  
  - Affects: skipping list items / indentation detection; GitHub Actions workflow detection on Windows-style paths.
- [ ] **Fix C-like docstring/attribute extraction off-by-one** in `src/lang/clike.js` (doc comment extraction currently skips the line immediately above declarations).  
  - Affects: docstring/attributes in C/C++/ObjC chunks (and downstream docmeta / fidelity).
- [ ] **Fix broken test syntax** in `tests/language-registry/collectors.test.js` (invalid escaped quotes).  
  - Affects: test suite execution.
- [ ] **Fix ingestion tools writing output before ensuring directory exists** in:
  - `tools/ctags-ingest.js`
  - `tools/gtags-ingest.js`
  - `tools/lsif-ingest.js`
  - `tools/scip-ingest.js`  
  Creating the write stream before `ensureOutputDir()` can fail when the output directory does not exist.
- [ ] **Fix SQL statement splitting for standard SQL escaping (`''` / `""`)** in `src/lang/sql.js`.  
  Current quote toggling assumes backslash-escaping and will mis-split statements containing doubled quotes.

#### P1 — Tree-sitter quality/perf gaps that will surface at scale
- [ ] **Fix `findNameNode` traversal depth bug** in `src/lang/tree-sitter/chunking.js` (depth increments per node instead of per level; the search stops after ~4 iterations).  
  - Affects: chunk naming quality and method/class qualification.
- [ ] **Make tree-sitter worker path functional and deterministic** (`src/lang/workers/tree-sitter-worker.js` + `src/lang/tree-sitter/chunking.js`).  
  - Worker currently does not preload/init grammars; `buildTreeSitterChunksAsync()` treats a `null` worker result as “success” and does not fall back.

#### P2 — Cleanup, clarity, and long-term maintainability
- [ ] **Remove or use unused imports** (e.g., `parseTypeScriptSignature` in `src/lang/typescript/chunks-babel.js`).
- [ ] **Add missing/edge-case tests** (Windows paths, tabs, unicode identifiers, SQL quoting, tree-sitter worker behavior, etc.).
- [ ] **Document chunk metadata semantics** (particularly `meta.endLine` inclusivity and byte vs. code-unit offsets) in `docs/contracts/chunking.md` (and/or a new contract doc).

---

### 31.1 Chunking pipeline: mapping, fallback, limits, determinism

#### 31.1.1 Fallback behavior and deterministic output
- [ ] **Audit & document** the full fallback chain in `src/index/chunking/dispatch.js`:
  - code chunker → code-format chunker → prose chunker → root chunk (prose extensions) → fixed-size blob fallback.
- [ ] **Add regression tests** that verify:
  - A failed code chunker returns `null` and the dispatcher properly falls back.
  - “Prose mode” behavior for `.md/.rst/.adoc/.txt/.mdx` is stable (chunk headings when possible; otherwise single chunk).
  - “Code mode” for prose files intentionally uses blob fallback (or adjust if that’s not desired).

#### 31.1.2 Limits: correctness + performance under large inputs
- [ ] **Add tests for multi-byte UTF-8 boundaries** in `applyChunkingLimits()` (`src/index/chunking/limits.js`):
  - Ensure splits never create invalid surrogate pairs.
  - Ensure byte limits are enforced correctly with emoji / non-ASCII identifiers.
- [ ] **Performance review:** `resolveByteBoundary()` currently calls `Buffer.byteLength(text.slice(0, mid))` repeatedly.
  - [ ] Consider a faster strategy (e.g., pre-encoding once to a `Buffer`, or maintaining cumulative byte counts per line) to avoid repeated substring allocations.
- [ ] **Clarify contract semantics** for:
  - Whether `chunk.end` is exclusive (it is treated as exclusive almost everywhere).
  - Whether `meta.endLine` is “line containing end offset” vs “last included line”.  
    (Many language chunkers use `offsetToLine(end)` vs `offsetToLine(end - 1)`; this should be intentional and documented.)
  - Update `docs/contracts/chunking.md` accordingly and add examples.

---

### 31.2 Format chunkers: YAML, JSON, XML, INI/TOML, Markdown, RST/Asciidoc

#### 31.2.1 YAML (`src/index/chunking/formats/yaml.js`)
**Bugs**
- [ ] **Fix tab detection** in `chunkYamlTopLevel()` and list-item skipping:
  - Current code checks `line.startsWith("\t")` (literal backslash + t) instead of `line.startsWith("\t")` as a tab character.
  - Locations:
    - line ~60: `line.startsWith('\t')` in list-item skip condition
    - line ~92: `line.startsWith('\t')` in indentation calculation
- [ ] **Fix Windows path normalization** in `chunkYaml()`:
  - Current: `normalizedPath = relPath.replace(/\\\\/g, '/')`  
    This matches *double* backslashes; typical Windows paths contain single backslashes.
  - Should be: `relPath.replace(/\\/g, '/')` (single backslash regex)

**Hardening / improvements**
- [ ] **Add YAML tests** covering:
  - Tab-indented YAML (even if discouraged, tools may produce it).
  - Workflow path detection for both `".github/workflows/foo.yml"` and `".github\\workflows\\foo.yml"`.
  - A workflow file with `jobs:` where indentation is not 2 spaces (ensure graceful behavior).
- [ ] **Document YAML chunker limitations** (top-level-only + heuristics for GH Actions) in the chunking contract or a dedicated “format chunkers” doc section.

#### 31.2.2 JSON (`src/index/chunking/formats/json.js`)
- [ ] **Test hygiene:** Fix test calls that pass arguments in the wrong positions (e.g., `chunkJson(jsonText, {})` in `tests/chunking/json.test.js` currently passes `{}` as `relPath`).  
  Update to `chunkJson(jsonText, null, {})` for clarity and future-proofing.
- [ ] **Optional robustness improvement:** consider using `jsonc-parser` for tolerant parsing (trailing commas/comments) *if desired*.
  - If adopted, ensure invalid JSON still cleanly falls back (i.e., return `null`).

#### 31.2.3 XML (`src/index/chunking/formats/xml.js`)
- [ ] Add tests for:
  - Nested tags with attributes + self-closing tags.
  - CDATA blocks and processing instructions.
  - Malformed tag recovery (should return `null`, triggering fallback, rather than producing broken chunks).

#### 31.2.4 Markdown (`src/index/chunking/formats/markdown.js`)
- [ ] Add tests for:
  - Headings inside fenced blocks (should not create chunks; current `inFence` logic covers ``` and ~~~).
  - Setext headings vs horizontal rules (ensure `---` under a paragraph is treated correctly).

#### 31.2.5 RST/Asciidoc (`src/index/chunking/formats/rst-asciidoc.js`)
- [ ] Add tests for:
  - RST overline+underline headings and nested sectioning.
  - Asciidoc `==` headings inside code/list blocks to avoid false positives.

#### 31.2.6 INI/TOML (`src/index/chunking/formats/ini-toml.js`)
- [ ] Add tests for:
  - TOML array-of-tables (`[[table]]`).
  - INI sections with unusual whitespace and comments.

---

### 31.3 Language registry: selection, options, and collector mapping

#### 31.3.1 Registry correctness (`src/index/language-registry/registry.js`)
- [ ] **Confirm and document intentional grouping** of C/C++/ObjC into `id: 'clike'`:
  - Ensure docs and tests consistently reflect that `.c/.h/.cpp/.hpp/.m/.mm` map to the same language id.
  - Update language-fidelity expectations and/or docs if users expect separate ids.

- [ ] Expand `tests/language-registry/selection.test.js` to cover:
  - C/C++/ObjC extensions: `.c`, `.h`, `.cpp`, `.hpp`, `.m`, `.mm`
  - Ambiguous extensions and “special names”:
    - `Dockerfile`, `dockerfile`, `*.Dockerfile`
    - `Makefile`, `makefile`
    - `CMakeLists.txt`
    - `.gitignore`-style config names (if supported elsewhere)

#### 31.3.2 Import collectors map (`tests/language-registry/collectors.test.js`)
- [ ] **Fix syntax error** at the Dart fixture entry:
  - Replace `text: "import 'package:foo/bar.dart';",` with a valid JS string literal:
    - `text: "import 'package:foo/bar.dart';",`

- [ ] Add edge-case import collector tests for:
  - Multiline imports (where applicable).
  - Imports inside comments (should be ignored where the collector claims to ignore comments).
  - Duplicate imports / whitespace variants (ensure normalization works).

---

### 31.4 Tree-sitter backbone: wasm init, language loading, chunk extraction, workers

#### 31.4.1 Name extraction (`src/lang/tree-sitter/chunking.js`)
- [ ] **Fix `findNameNode()` depth logic**:
  - Current implementation increments `depth` per dequeued node, not per BFS level.
  - Result: the search stops after ~4 processed nodes and often fails to find a name.
  - Expected: traverse up to N levels or up to a node-count budget (explicitly), and return the first plausible identifier.

- [ ] Add tests that assert:
  - Function and class chunk names are extracted correctly across multiple language grammars.
  - Member/method names are found for nested AST shapes where the `name` field is not a direct child.

#### 31.4.2 Worker-mode tree-sitter chunking (`src/lang/workers/tree-sitter-worker.js`, `src/lang/tree-sitter/chunking.js`)
- [ ] **Initialize and preload grammars inside the worker** (or add a per-worker lazy-init path):
  - Today, the worker calls `buildTreeSitterChunks()` without ensuring tree-sitter wasm + language grammar are loaded in that worker thread.
  - Proposed fix:
    - In the worker, resolve language id from `ext`/`languageId`, then `await preloadTreeSitterLanguages([resolvedId], treeSitterOptions)` before parsing.
- [ ] **Make `buildTreeSitterChunksAsync()` treat `null` results as a failure signal** and fall back to in-thread parsing (or to non-tree-sitter chunking), at least when worker-mode is enabled.
- [ ] Add tests that explicitly enable worker-mode and assert that:
  - Chunks are returned (not `null`) for a known fixture.
  - The result matches non-worker behavior (same chunk boundaries, or documented acceptable differences).
  - If a grammar is missing/unavailable, it falls back cleanly and deterministically.

#### 31.4.3 Configuration normalization (`src/lang/tree-sitter/options.js`)
- [ ] Improve boolean normalization:
  - Current `normalizeEnabled()` only recognizes `false` and the literal string `'off'`.
  - Expand to treat `'false'`, `'0'`, `'no'` (case-insensitive) as disabled, and `'true'`, `'1'`, `'yes'`, `'on'` as enabled.
- [ ] Add tests for config parsing from environment/JSON where booleans may be strings.

#### 31.4.4 Offsets: bytes vs JS string indices
- [ ] Add an explicit contract note and tests around offset units used by:
  - tree-sitter (`node.startIndex/endIndex`)
  - parse5 and other JS parsers
  - Python AST (line/col from Python runtime)  
  Ensure all chunk `start/end` offsets are consistent with JS string slicing expectations, particularly with non-BMP unicode characters.

---

### 31.5 Language handlers: correctness fixes & hardening

#### 31.5.1 C-like (`src/lang/clike.js`)
- [ ] **Fix docstring extraction index** for functions and ObjC methods:
  - Current:
    - ObjC method chunk meta: `extractDocComment(lines, i - 1, ...)` and `collectAttributes(lines, i - 1, ...)`
    - C-like functions: `extractDocComment(lines, i - 1)`
  - This skips the immediate preceding line.  
  - Fix: pass `i` (0-based declaration start line) instead of `i - 1`.
  - Locations:
    - ~417–418, ~463 in `src/lang/clike.js`

- [ ] Add tests for C-like doc comment capture:
  - A `/** ... */` or `// ...` directly above a `struct`, `class`, `enum`, and `function`.
  - ObjC method with `///` doc comment above it.

#### 31.5.2 SQL (`src/lang/sql.js`)
- [ ] **Fix quote handling** in both `stripSqlComments()` and `splitSqlStatements()`:
  - SQL escaping commonly uses doubled quotes:
    - `'It''s fine'`
    - `"a ""quoted"" identifier"`
  - Current logic toggles on every `'`/`"` not preceded by backslash, which breaks on doubled quotes.

- [ ] Add tests that include:
  - Semicolons inside strings with doubled quotes.
  - PostgreSQL dollar-quoted strings combined with single-quoted strings.
  - MySQL delimiter blocks that contain semicolons.

#### 31.5.3 CSS (`src/lang/css.js`)
- [ ] Add guardrails to prevent pathological chunk explosion when using the CSS tree-sitter parser:
  - Options:
    - Enforce a max node/chunk count (consistent with tree-sitter default maxChunkNodes behavior).
    - Or switch to `buildTreeSitterChunks()` and its existing limits.
- [ ] Add tests for:
  - Nested `@media` with many rules (ensure performance and deterministic chunk output).
  - Files exceeding the max node threshold (ensure fallback to heuristic).

#### 31.5.4 TypeScript (`src/lang/typescript/chunks-babel.js`)
- [ ] Remove or use unused import `parseTypeScriptSignature` (currently imported but not referenced).
- [ ] Add/extend tests ensuring:
  - Babel-based TS chunker produces signatures and types consistently where expected.
  - Worker/non-worker tree-sitter paths do not regress TS chunking (when enabled).

---

### 31.6 Imports, relations, and control-flow metrics

#### 31.6.1 Import collectors
- [ ] Add test coverage for:
  - Normalization rules (`normalizeImportToken()` behavior).
  - Edge cases per language (e.g., JS `import type`, TS `import("x")`, Python relative imports).
- [ ] Validate that collectors return stable, sorted output (dedupe + order determinism), or document if order is intentionally non-deterministic.

#### 31.6.2 Relations builders (`src/index/language-registry/simple-relations.js`, per-language `relations.js`)
- [ ] Add a small integration test that:
  - Runs `collectLanguageImports()` and `buildLanguageRelations()` for a multi-language fixture set.
  - Verifies the resulting `imports`, `exports`, `calls`, and `usages` sets match expectations.

---

### 31.7 Ingestion tools: ctags / gtags / lsif / scip

#### 31.7.1 Output directory creation order
- [ ] Move `await ensureOutputDir()` to occur *before* `fs.createWriteStream(outputPath, ...)` in:
  - `tools/ctags-ingest.js` (write stream is created before the dir is ensured)
  - `tools/gtags-ingest.js`
  - `tools/lsif-ingest.js`
  - `tools/scip-ingest.js`

#### 31.7.2 Robustness improvements
- [ ] Add tests / smoke scripts that verify:
  - Tools succeed when output directory doesn’t exist.
  - Tools correctly handle empty input streams.
  - Tools fail with actionable errors on malformed JSON lines.

- [ ] Add optional flags/docs for:
  - Strict vs tolerant ingest behavior (skip malformed lines vs fail-fast).
  - Path normalization expectations (repo-root relative vs absolute).

---

### 31.8 Docs and test suite alignment

#### 31.8.1 Fix broken / missing documentation references
- [ ] The Section 5 checklist references docs that are *not present* in this repo snapshot (e.g., `docs/contracts/language-registry.md`, `docs/contracts/ast.md`, and `docs/optional/*`).  
  Decide whether to:
  - Create these docs, or
  - Update the checklist to point to existing docs (`docs/language-handler-imports.md`, `docs/language-fidelity.md`, etc.).

#### 31.8.2 Update existing docs for discovered behavior
- [ ] Update `docs/contracts/chunking.md` to include:
  - Chunk offset semantics (exclusive `end`, unicode considerations).
  - `meta.startLine/endLine` semantics and examples.
  - Expected behavior for overlapping chunks (if allowed) vs non-overlapping (if required).
- [ ] Update `docs/language-fidelity.md` if docstring expectations for C-like currently fail due to the off-by-one bug.

#### 31.8.3 Add a “known limitations” section (recommended)
- [ ] Document known heuristic limitations for:
  - SQL parsing (heuristic statement splitting vs full parser).
  - YAML parsing (line-based, top-level heuristics).
  - Language relations (regex-based calls/usages for some languages).

---

### Deliverables
- [ ] All P0/P1 fixes implemented with unit tests.
- [ ] Updated docs reflecting chunk semantics and configuration.
- [ ] A focused regression test pack covering:
  - YAML tabs + Windows workflow paths
  - C-like doc comments
  - SQL doubled-quote handling
  - Tree-sitter worker-mode functionality
  - Chunking limits with unicode/multi-byte text

---

### Exit criteria
- [ ] `npm test` (or the project’s test runner) executes without syntax errors (including `collectors.test.js`).
- [ ] Format chunkers are robust against malformed inputs and fall back deterministically.
- [ ] Tree-sitter worker-mode returns real chunks for supported languages and falls back when grammars are missing.
- [ ] Chunk metadata semantics are documented and consistent across chunkers (or differences are explicitly justified).
- [ ] Ingestion tools succeed when output directories are missing and produce valid NDJSON outputs.


## Phase 32 — (Review) — Retrieval, Services & Benchmarking/Eval (Latency End-to-End)

### Objective

Validate and improve the **retrieval pipeline**, **services surfaces (API + MCP)**, and **benchmark/eval tooling** so that:

* Search semantics are correct and contract-aligned (query parsing, filters, ranking, explain output, context expansion).
* Backends behave consistently (memory / sqlite / sqlite-fts / lmdb) and performance paths are not accidentally disabled.
* Services are robust (streaming behavior, cancellation, backpressure, security posture).
* Benchmarks and eval harnesses are actionable, reproducible, and can enforce latency/quality budgets.

### Scope

Reviewed the complete Section 8 list from the attached markdown checklist document fileciteturn0file0, including:

* Retrieval CLI + pipeline + filters + output formatting
* SQLite/LMDB helpers and cache layers
* Core integrations used by tools/services
* API server (router + SSE) and MCP transport/tools
* Benchmark harnesses (micro + language) and query tooling
* Eval harness
* Related docs + tests + fixtures

(Where files referenced other modules not in the Section 8 list, I noted mismatches and dependency risks, but the primary focus remains the Section 8 scope.)

---

### Exit Criteria (What “Done” Looks Like)

#### Correctness & Contracts

* [ ] Query parsing supports required constructs (operators/quoting/negation/precedence) or docs/contracts explicitly define the simplified grammar.
* [ ] Filters are correctly detected as “active” and do not disable backend fast-paths accidentally.
* [ ] Explain output matches actual scoring math and is emitted only when requested (or contracts updated to reflect always-present fields).

#### Performance & Latency

* [ ] SQLite FTS fast-path is not disabled by default (especially for large indexes).
* [ ] Context expansion avoids repeated O(N) scans per query (or is cached/optimized).
* [ ] Benchmarks can write baselines reliably and optionally enforce budgets.

#### Services Robustness

* [ ] API streaming handles backpressure and connection close without hanging.
* [ ] API/MCP support cancellation/timeout propagation to stop expensive work.
* [ ] CORS/security posture is explicitly intentional and documented.

#### Tests & Tooling

* [ ] Tests cover discovered regressions and add missing edge cases (FTS eligibility, extracted-prose query caching, MCP id=0, etc.).
* [ ] Bench/eval docs match actual behavior and command usage.

---

## Findings & Required Work

### 8.A — Retrieval Semantics, Explain, Context Expansion

#### A1 — **Critical: Filter “active” detection is wrong (breaks performance paths)**

**Files:**

* `src/retrieval/filters.js`
* `src/retrieval/cli.js`
* `src/retrieval/pipeline.js`
* `src/retrieval/sqlite-helpers.js` (indirect impact via CLI choices)

**What I found:**
`hasActiveFilters()` treats *any non-empty object* as “active,” which causes `filtersActive` to be true even when no user filters are set, because the CLI always includes internal objects like `filePrefilter`.

**Impact:**

* Forces filter pass on every query.
* Can disable SQLite FTS eligibility for large indexes because allowed-id pushdown cannot be used when the “allowed set” becomes huge.
* Prevents “lazy chunk loading” decisions that should apply when there are no real filters.
* Creates major, silent performance regressions at scale.

**Action items:**

* [ ] Fix `hasActiveFilters()` to ignore internal/config-only keys (e.g., `filePrefilter`) and only count user-constraining filters.
* [ ] Add unit tests for `hasActiveFilters()` default filter object and typical combinations.
* [ ] Add an integration test ensuring sqlite-fts remains eligible on a large index when no filters are set (or at least verify the path selection in stats/debug output).

---

#### A2 — **Context expansion does repeated O(N) indexing work per query**

**Files:**

* `src/retrieval/context-expansion.js`
* `src/retrieval/cli.js` (enables context expansion)
* `src/retrieval/pipeline.js`

**What I found:**
`buildContextIndex()` rebuilds `byName` and `byFile` maps every query.

**Impact:**

* For large repos, this adds noticeable latency per query.
* Violates checklist intent: “avoids repeated file reads / expensive rebuilds.”

**Action items:**

* [ ] Cache context index per loaded index signature (store on the loaded index object or in `index-cache.js`).
* [ ] Add tests to ensure expansions are stable and do not cross branch/filters (if applicable).
* [ ] Document the intended semantic boundaries of context expansion (same file vs cross-file, name matching rules, etc.).

---

#### A3 — Explain output / scoring contract alignment is ambiguous

**Files:**

* `src/retrieval/pipeline.js`
* `src/retrieval/output/explain.js`
* `src/retrieval/cli/render-output.js`
* Docs: `docs/contracts/retrieval-ranking.md` (very high-level)

**What I found:**
The pipeline always builds `scoreBreakdown` objects, even if explain is not requested; compact JSON hides it, but full JSON may expose it unintentionally.

**Action items:**

* [ ] Decide contract behavior:

  * Option 1: Only compute/attach `scoreBreakdown` when explain requested.
  * Option 2: Always include but document it (and remove `--explain` implication of optionality).
* [ ] Add snapshot tests asserting the presence/absence of explain fields by mode/output format.
* [ ] Ensure explain’s boost attribution matches scoring math (phrase + symbol boosts currently depend on the already-boosted score; document or adjust).

---

### 8.B — Query Parsing & Filtering

#### B1 — Query parsing does not satisfy checklist requirements

**Files:**

* `src/retrieval/query.js`
* `src/retrieval/query-parse.js`
* Tests/docs indirectly

**What I found:**
Parsing supports:

* quoted phrases (`"..."`)
* negation via `-token` and `-"phrase"`

It does **not** support:

* boolean operators (AND/OR/NOT) semantics
* precedence / parentheses
* actionable errors for malformed queries (unbalanced quotes become literal tokens)

**Action items:**

* [ ] Either implement full operator parsing & precedence or explicitly constrain and document the query grammar.
* [ ] Add detection + actionable error messages for unbalanced quotes and invalid constructs.
* [ ] Add tests for negated phrases, nested quotes, malformed input, and operator tokens.

---

#### B2 — Filtering: performance and correctness concerns

**Files:**

* `src/retrieval/output/filters.js`
* `src/retrieval/filter-index.js`

**Key improvements:**

* [ ] Ensure case-sensitive file filters don’t lose correctness through normalization shortcuts (currently used for prefiltering; confirm final checks are strict).
* [ ] Consider memory growth of filter index structures; document expected footprint and add soft limits/metrics.

---

### 8.C — Ranking Determinism & Tie-Breaking

#### C1 — Dense ranking should defensively validate embedding dimensionality

**Files:**

* `src/retrieval/rankers.js`
* `src/retrieval/embedding.js`
* `src/retrieval/sqlite-helpers.js`

**What I found:**
`rankDenseVectors()` assumes query embedding length matches index vector dimension. If not, dot-products can become NaN and ranking becomes unstable.

**Action items:**

* [ ] Validate query embedding length vs index dims; if mismatch, either truncate safely or skip dense scoring with a clear warning.
* [ ] Add tests for dims mismatch (stub embeddings + configured dims is a good harness).

---

#### C2 — SQLite dense vector scale fallback looks unsafe

**Files:**

* `src/retrieval/sqlite-helpers.js`
* Related: `src/storage/sqlite/vector.js` (quantization uses 2/255)

**What I found:**
If `dense_meta.scale` is missing for any reason, sqlite helper defaults scale to **1.0**, which would break score normalization badly for uint8 quantized vectors.

**Action items:**

* [ ] Change fallback scale default to `2/255` (and minVal to `-1` consistent with vector quantization).
* [ ] Add a regression test ensuring dense scoring remains bounded even when meta is missing/corrupt (or fail loudly).

---

### 8.D — Services: API Server & MCP

#### D1 — SSE backpressure “drain wait” can hang indefinitely on closed connections

**Files:**

* `tools/api/sse.js`

**What I found:**
If `res.write()` returns false, the code awaits `'drain'` only. If the client disconnects before drain fires, that promise may never resolve.

**Action items:**

* [ ] Replace `await once('drain')` with `Promise.race([drain, close, error])`.
* [ ] Add tests simulating backpressure + early disconnect (larger payload / forced write buffering).

---

#### D2 — Streaming contracts/docs do not match actual /search/stream behavior

**Files:**

* `tools/api/router.js`
* Docs: `docs/api-server.md`, `docs/contracts/api-mcp.md`

**What I found:**
`/search/stream` only emits:

* `start`
* `result` OR `error`
* `done`

Docs/contracts claim progress streaming and/or richer semantics.

**Action items:**

* [ ] Decide: implement progress events (pipeline milestones) OR revise docs/contracts to match current behavior.
* [ ] If implementing progress: add hooks from retrieval CLI/pipeline → core API → router SSE.

---

#### D3 — Cancellation/timeout propagation is missing end-to-end

**Files:**

* `tools/api/router.js`
* `tools/mcp/transport.js`
* `tools/mcp/tools.js`
* `src/integrations/core/index.js`
* `src/retrieval/cli.js` (currently no signal handling)

**What I found:**
Timeouts exist in MCP wrapper, but they do not abort underlying work. API does not abort search on client disconnect. Retrieval does not consume `AbortSignal`.

**Action items:**

* [ ] Introduce `AbortController` per request/tool call.
* [ ] Wire close events (`req.on('close')`) and timeout timers to `abort()`.
* [ ] Teach retrieval pipeline / embedding fetch to check `signal.aborted` and throw a consistent cancellation error.
* [ ] Add tests:

  * API stream abort stops work early (not just stops writing).
  * MCP tool timeout aborts the underlying work, not just returns an error.

---

#### D4 — Security posture: permissive CORS is risky

**Files:**

* `tools/api/router.js`
* Docs: `docs/api-server.md`

**What I found:**
CORS is `*` by default. Even though server defaults to localhost, permissive CORS enables untrusted sites to read responses from a local service in a browser context.

**Action items:**

* [ ] Default CORS to disabled or restricted (require explicit `--cors` enablement).
* [ ] Document threat model: local-only, trusted environment, or add token-based auth.
* [ ] Add tests for CORS behavior (preflight, allowed origins).

---

### 8.E — Benchmarks & Latency Budgets

#### E1 — Microbench “dense” vs “hybrid” distinction is not actually implemented

**Files:**

* `tools/bench/micro/run.js`
* `tools/bench/micro/search.js`
* `tools/bench/micro/tinybench.js`
* Docs: `docs/benchmarks.md`

**What I found:**
Bench tasks labeled “dense” and “hybrid” do not reliably enforce different scoring regimes. Some of the logic implies profiles/env-driven behavior that isn’t applied.

**Action items:**

* [ ] Implement explicit scoring strategy selection (via args/env/profile) for sparse vs dense vs hybrid.
* [ ] Confirm the benchmark measures what it claims (esp. hybrid weighting).
* [ ] Add “sanity asserts” in benchmark output to record which strategy actually ran.

---

#### E2 — Baseline writing can fail because directories don’t exist

**Files:**

* `tools/bench/micro/tinybench.js`
* Docs: `docs/benchmarks.md`

**What I found:**
`--write-baseline` writes to `benchmarks/baselines/...` but does not create the directory first.

**Action items:**

* [ ] Ensure baseline directory exists via `fs.mkdirSync(..., { recursive:true })`.
* [ ] Add a test for `--write-baseline` success on a clean repo checkout.
* [ ] Update docs to clarify how baselines are created and stored.

---

#### E3 — SQLite cache reuse is missing in benchmark harnesses

**Files:**

* `tools/bench/micro/run.js`
* `tools/bench/micro/tinybench.js`

**What I found:**
Bench harnesses often pass `sqliteCache = null`, which may force repeated DB opens and distort warm-run measurements.

**Action items:**

* [ ] Instantiate and reuse `createSqliteDbCache()` across runs for warm scenarios.
* [ ] Record cache reuse status in benchmark output for transparency.

---

#### E4 — Latency “budgets” are described but not enforceable

**Files:**

* `docs/benchmarks.md`
* Tests: existing bench tests do not enforce budgets

**Action items:**

* [ ] Define target budgets (p50/p95) for representative queries and backends.
* [ ] Add CI-friendly “perf smoke” tests that fail if budgets regress beyond thresholds (with generous margins and stable fixtures).
* [ ] Document environment assumptions for benchmarks (CPU, disk, warmup, etc.).

---

### 8.F — Eval Harness

#### F1 — Matching logic is permissive and may inflate scores

**Files:**

* `tools/eval/run.js`
* Docs: `docs/eval.md`

**What I found:**
Expected match uses `hit.name.includes(expected.name)`; that may treat `foo` as matching `foobar`.

**Action items:**

* [ ] Decide strictness: exact name match vs substring vs regex.
* [ ] Add dataset option `matchMode` or per-expected matcher configuration.
* [ ] Add tests for false-positive matching cases.

---

## Additional Concrete Bugs Found (Non-Checklist)

### G1 — Retrieval output summary “word count” logic uses character length

**Files:**

* `src/retrieval/output/format.js`

**What I found:**
The summary logic compares `.length` of the string (characters) to a “maxWords” variable and uses it to adjust `maxWords`. This is unit-inconsistent and likely incorrect behavior.

**Action items:**

* [ ] Fix to track word count, not character length.
* [ ] Avoid calling `getBodySummary()` twice.
* [ ] Add tests for summary length behavior.

---

### G2 — Parity test references missing benchmark query file path

**Files:**

* `tests/parity.js`
* Existing file: `tests/parity-queries.txt`

**What I found:**
`tests/parity.js` reads from `benchmarks/queries/parity-queries.txt`, but the queries file exists under `tests/parity-queries.txt`.

**Action items:**

* [ ] Update parity test to load from `tests/parity-queries.txt` (or move file to benchmarks).
* [ ] Add a guard assertion that query file exists with a clear message.

---

### G3 — Language benchmark progress renderer imports wrong relative paths

**Files:**

* `tools/bench/language/progress/render.js`

**What I found:**
Imports reference `../../../src/shared/...` but need one more `../` to reach repo root. As written, this resolves to `tools/src/shared/...` which doesn’t exist.

**Action items:**

* [ ] Fix import paths to `../../../../src/shared/...`.
* [ ] Add a smoke test that loads the module (ensures no runtime import failures).

---

### G4 — MCP transport drops valid JSON-RPC ids when id = 0

**Files:**

* `tools/mcp/transport.js`

**What I found:**
`if (!id) return;` treats `0` as falsy and drops responses/notifications. JSON-RPC allows `id: 0`.

**Action items:**

* [ ] Change checks to `(id === null || id === undefined)`.
* [ ] Add MCP tests sending `id: 0`.

---

### G5 — Bench query generator emits invalid CLI fragments (and lacks quoting)

**Files:**

* `tools/bench-query-generator.js`

**What I found:**
At least one strategy emits `--signature` without a value. Additionally, values with spaces (authors, types) are not quoted, which will break shell parsing.

**Action items:**

* [ ] Fix signature strategy to emit `--signature "<value>"`.
* [ ] Quote/escape all flag values safely.
* [ ] Clarify intended consumer (CLI vs internal harness) and ensure output format matches it.

---

## Test Coverage Additions (Highly Recommended)

### New/Expanded Tests

* [ ] `hasActiveFilters()` default object returns false; internal config-only objects don’t activate filters.
* [ ] sqlite-fts eligibility remains enabled for unfiltered queries on large (>900 chunks) indexes.
* [ ] Query cache includes extracted-prose payloads and validates required fields when mode enabled.
* [ ] SSE backpressure + client disconnect doesn’t hang.
* [ ] API abort cancels search work (requires AbortSignal support).
* [ ] MCP id=0 support.
* [ ] `--write-baseline` creates directories and succeeds.

---

## Documentation Corrections Required

* [ ] `docs/api-server.md`: align stream behavior (progress vs start/result/done), update security/CORS discussion.
* [ ] `docs/contracts/api-mcp.md`: align `/search/stream` contract to actual behavior or update implementation.
* [ ] `docs/benchmarks.md`: document baseline creation and ensure code supports it (mkdir); clarify dense/hybrid distinctions.
* [ ] `docs/mcp-server.md`: appears outdated vs actual transport implementation; update to match current code.

## Phase 33 — Review Section 7 — Storage backends (SQLite + LMDB)

**Objective:** Perform an audit of the storage backends (SQLite + LMDB) and their supporting tooling (build, validation, compaction, incremental updates, ANN extension management, and backend selection). Identify *all* correctness bugs, edge cases, documentation drift, missing tests, and performance/refactoring opportunities, aligned to the provided checklist.

#### Out-of-scope (not deeply reviewed, but referenced when necessary)

- Non-listed call-sites (e.g. retrieval query code) were spot-checked only when needed to validate schema/index/query alignment.

---

### Executive summary

#### Top P0 / correctness items

- [ ] **(P0) SQLite ANN table is not updated when it already exists** in:
  - `src/storage/sqlite/build/from-bundles.js` (vector table existence sets `vectorAnnReady = true` but **does not** prepare `insertVectorAnn`) — see around L120.
  - `src/storage/sqlite/build/incremental-update.js` (same pattern) — see around L240.

  **Impact:** when the ANN virtual table already exists (most importantly during incremental updates), deleted rows *can* be removed (because deletes run via `deleteDocIds(...)`), but replacement vectors for changed chunks are **not reinserted**, leaving the ANN table sparse/out-of-sync with `dense_vectors`. This can silently degrade or break ANN-based retrieval depending on how the extension is queried.

- [ ] **(P0) Retrieval-side fail-closed is incomplete for SQLite schema versions.**

  `src/retrieval/cli-sqlite.js` validates required table *names* but does **not** enforce `PRAGMA user_version == SCHEMA_VERSION` (or otherwise fail-closed on schema mismatch). This violates the checklist requirement (“readers fail closed on unknown versions”) for the SQLite reader path.

- [ ] **(P0) Bundle-build path does not hard-fail on embedding dimension mismatches** (`src/storage/sqlite/build/from-bundles.js`).

  The code currently *warns once* on a dims mismatch but continues (and may still insert inconsistent vectors). This risks producing an index with an internally inconsistent dense-vector corpus (which can cause downstream errors or silent relevance regressions).

#### High-signal P1 / robustness items

- [ ] **WAL / sidecar handling is inconsistent across build vs incremental update paths.**  
  Full rebuild paths use `replaceSqliteDatabase(...)` which removes sidecars, but incremental updates modify the DB in-place under WAL mode and do not explicitly checkpoint/truncate. If later tooling removes sidecars without a checkpoint, this can create “single-file DB” assumptions that do not hold.

- [ ] **Indexing for hot maintenance queries can be improved**: `chunks(mode, file)` exists, but multiple maintenance queries order by `id` and would benefit from `(mode, file, id)`.

- [ ] **Docs drift:** `docs/sqlite-incremental-updates.md` (and a few related docs) describe doc-id behavior and operational details that do not match current implementation (doc-id reuse/free-list behavior; ratio guard details; and operational caveats).

#### “Good news” / items that look solid already

- Most bulk write paths are transactional (build ingest, compaction copy, incremental applyChanges).
- The extension download hardening in `tools/download-extensions.js` has multiple safety layers (hash verification support, archive path traversal protection, size/entry limits).
- LMDB corruption handling has targeted tests (`tests/lmdb-corruption.js`) and tooling integration (`tests/lmdb-report-artifacts.js`).

---

## Checklist coverage and required follow-ups

### A) Schema & migrations

**Audit**

- SQLite schema is versioned via `PRAGMA user_version` with `SCHEMA_VERSION = 7` (`src/storage/sqlite/schema.js`).
- Incremental update explicitly checks schema version and required tables before mutating (`src/storage/sqlite/build/incremental-update.js`).
- Table-level constraints are generally well-defined (primary keys per (mode, …), plus supporting indexes for vocab/postings).

**Gaps / issues**

- [ ] **Fail-closed at read time:** Add a `user_version` gate to the SQLite reader path (at minimum in `src/retrieval/cli-sqlite.js` / sqlite backend creation).
  - Desired behavior:  
    - If backend is *forced* to SQLite: throw a clear error (“SQLite schema mismatch: expected X, found Y”).
    - If backend is not forced (auto): treat SQLite as unavailable and fall back to the file-backed backend, with a warning.
- [ ] **Index alignment with hot predicates:** Consider adding `CREATE INDEX idx_chunks_file_id ON chunks(mode, file, id)` to support:
  - `SELECT id FROM chunks WHERE mode=? AND file=? ORDER BY id`
  - `SELECT file, id FROM chunks WHERE mode=? ORDER BY file, id` (incremental update id reuse scan)
- [ ] **Document upgrade path explicitly:** The system is effectively “rebuild on schema bump”. Ensure docs and user-facing error messaging make that explicit (and fail closed rather than attempting to limp on).
- [ ] **Consider column-level schema validation for critical tables** (optional but recommended): required-table-name checks do not catch incompatible column changes if a user provides an arbitrary SQLite file containing tables with the right names.

---

### B) SQLite build pipeline

**Audit**

- Build-from-artifacts path uses bulk inserts and creates secondary indexes after ingest (`src/storage/sqlite/build/from-artifacts.js`).
- Build-from-bundles supports a fast-path using bundle workers (`src/storage/sqlite/build/from-bundles.js` + `bundle-loader.js`).
- Validation includes `PRAGMA integrity_check` (full) and cross-table count consistency checks (`src/storage/sqlite/build/validate.js`).

**Gaps / issues**

- [ ] **(P0) Fix ANN insert statement preparation when the ANN table already exists:**
  - In `src/storage/sqlite/build/from-bundles.js`:
    - When `hasVectorTable` is true (L120), prepare `insertVectorAnn` immediately (same SQL as the “created table” path near L209).
  - In `src/storage/sqlite/build/incremental-update.js`:
    - When `vectorAnnReady` is set based on `hasVectorTable` (L240), prepare `insertVectorAnn` as well.
  - Add a CI-friendly unit test that does not require a real sqlite-vec binary (see “Tests” section below).
- [ ] **(P0) Enforce embedding dims consistency in bundle builds.**
  - Recommendation: pre-scan each bundle (or the whole manifest) to ensure all embeddings are either absent or have a single consistent dimension; then hard-fail the build if mismatched.
  - Current behavior: warns once around L197 and continues; this should be tightened to match the artifacts build path which throws on mismatch.
- [ ] **Failure cleanup should include SQLite sidecars** (`.db-wal`, `.db-shm`) in:
  - `src/storage/sqlite/build/from-artifacts.js`
  - `src/storage/sqlite/build/from-bundles.js`

  Today they remove only `outPath` on failure. If WAL/SHM exist, they can be left behind as confusing debris and can interfere with subsequent runs.
- [ ] **Consider ensuring the produced DB is “single-file”** after build by checkpointing/truncating WAL (or switching journal mode back), rather than relying on implicit behavior.
- [ ] **Prepared statement churn:** `deleteDocIds(...)` dynamically prepares multiple statements per chunk; consider statement caching keyed by chunk size to reduce overhead during large deletes.

---

### C) LMDB backend

**Audit**

- LMDB has a clear key-space separation (`meta:*`, `artifact:*`) and an explicit schema version (`src/storage/lmdb/schema.js`).
- LMDB build tool stores artifacts plus metadata into LMDB (`tools/build-lmdb-index.js`).
- Corruption handling is at least partially validated via tests (`tests/lmdb-corruption.js`, `tests/lmdb-report-artifacts.js`).

**Gaps / issues**

- [ ] Ensure the LMDB *reader* path (not in this checklist set) fails closed on schema mismatch the same way SQLite incremental update does (explicit schema version check; clear error messaging).
- [ ] Consider adding a lightweight “LMDB quick check” command in tooling (or enhancing `tools/index-validate.js`) that validates the presence of all required keys (schema version, chunk meta, vocab, postings, etc.) and reports missing keys explicitly.
- [ ] Document LMDB key invariants and expected artifact presence (which artifacts are mandatory vs optional).

---

### D) Incremental updates

**Audit**

- Incremental update gating exists (requires incremental manifest, rejects schema mismatch, rejects high change ratios) (`src/storage/sqlite/build/incremental-update.js`).
- It preserves doc-id stability per-file by reusing IDs for changed files and reusing free IDs from deletions.
- Deletes are applied across all relevant tables using `deleteDocIds(...)` with consistent table lists.

**Gaps / issues**

- [ ] **(P0) ANN table insertion bug** (same as in section B) must be fixed for incremental updates.
- [ ] **WAL lifecycle:** after an in-place incremental update, run:
  - `PRAGMA wal_checkpoint(TRUNCATE);`
  - optionally `PRAGMA journal_mode = DELETE;` (if the project prefers single-file DBs)

  This ensures the on-disk DB is not “dependent on sidecars” after the update and reduces the likelihood of later tooling accidentally discarding uncheckpointed state.
- [ ] **Manifest match logic:** `isManifestMatch(...)` falls back to mtime/size when one side has a hash and the other does not.
  - Consider tightening: if an incremental manifest provides a hash but the DB manifest row does not, treat as “changed” and update the DB row hash (this gradually converges the DB to the stronger invariant).
- [ ] **Performance of doc-id reuse scan:** the “scan all chunks ordered by file,id” approach is correct but can be expensive; if it becomes a bottleneck, consider either:
  - adding `(mode,file,id)` index, and/or
  - materializing file→docId list in a side table (only if necessary).

---

### E) Performance

**Audit**

- Build pragmas in `src/storage/sqlite/build/pragmas.js` are set to favor build throughput (WAL + relaxed synchronous) and are restored (partially).
- Compaction tool is designed to reduce doc-id sparsity and reclaim file size (`tools/compact-sqlite-index.js`).

**Gaps / issues**

- [ ] **Avoid repeated `COUNT(*)` scans** for backend auto-selection where possible (`src/storage/backend-policy.js`).
  - Options: use `file_manifest` sum, maintain a meta counter, or store chunk count in `index_state.json`.
- [ ] **Improve maintenance query performance** via `(mode,file,id)` index as noted above.
- [ ] **Reduce query-time statement re-preparation** in `src/retrieval/sqlite-helpers.js` (`chunkArray(...)` creates fresh SQL each time); consider caching by chunk size.
- [ ] **Add at least one p95 query latency regression test** using a stable fixture DB (details below).

---

### F) Refactoring goals

**Audit**

- The codebase already separates schema SQL, prepared statements, and build/validate logic into dedicated modules.

**Gaps / issues**

- [ ] **De-duplicate shared helpers:**
  - `updateIndexStateManifest(...)` exists in both `tools/build-lmdb-index.js` and `tools/build-sqlite-index/index-state.js`.
  - `chunkArray(...)` exists in both build and retrieval code (or adjacent helpers).
- [ ] **Centralize ANN table setup logic** so that “table exists” vs “table created” paths always prepare the insert statement (avoid the current drift between `prepareVectorAnnTable(...)` and the bundle/incremental paths).
- [ ] **Clarify naming:** `toVectorId(...)` is currently a “coerce to BigInt” helper; consider renaming to reflect that it does not encode/transform the id.

---

## Tests and benchmarks — required additions

### Must-add tests (CI-friendly)

- [ ] **Unit test: ANN insertion when the ANN table already exists** (no real extension binary required).
  - Approach:
    - Create a temporary SQLite DB with all required tables plus a *plain* `dense_vectors_ann` table (not virtual) matching the schema used by insert/delete (`rowid` + `embedding` BLOB column).
    - Pass a mocked `vectorConfig` into `incrementalUpdateDatabase(...)` with:
      - `loadVectorExtension: () => ({ ok: true })`
      - `hasVectorTable: () => true`
      - `encodeVector: () => Buffer.from([0])` (or similar stable stub)
    - Run an incremental update that modifies at least one file and assert that:
      - rows are deleted for removed docIds
      - rows are inserted/replaced for changed docIds
- [ ] **Unit test: bundle-build dims mismatch hard failure**
  - Create two bundle files in the incremental bundle dir: one with embedding length N, one with embedding length N+1.
  - Assert build fails (or returns count 0 with a clear reason) rather than “warn and continue”.

### Additional recommended tests

- [ ] **Reader fail-closed test:** Provide a DB with `user_version != SCHEMA_VERSION` and confirm:
  - forced SQLite backend errors clearly
  - auto backend falls back without using SQLite.
- [ ] **Incremental WAL checkpoint test** (if WAL checkpointing is implemented): verify that after incremental update:
  - no `*.db-wal` / `*.db-shm` remain (or WAL is truncated to a small size, depending on desired policy).

### Benchmark / regression testing

- [ ] **p95 query latency regression guard (fixture-based)**
  - Add a small but non-trivial fixture SQLite DB (or build it deterministically during test setup) and run a representative query workload:
    - candidate generation (ngrams)
    - FTS ranking (if enabled)
    - dense vector scoring (if enabled)
  - Measure per-query durations and assert p95 stays under a budget (or does not regress beyond a tolerance vs a baseline).
  - Keep it deterministic: single-threaded, warm cache (or explicit warm-up iterations), fixed query set, fixed limits.

---

## File-by-file findings and action items

> This section lists concrete issues and improvement opportunities per reviewed file.  
> Items are written as actionable checkboxes; severity tags (P0/P1/P2) are included where appropriate.

### `src/storage/backend-policy.js`

- [ ] Clarify threshold semantics for `autoSqliteThresholdChunks` / `autoSqliteThresholdBytes` when set to `0` (current code uses `> 0`, so `0` behaves like “disabled” rather than “always use SQLite”).
- [ ] Consider avoiding expensive `COUNT(*)` scans for auto-selection; store chunk count in a meta table or `index_state.json` and read that instead (or sum `file_manifest.chunk_count`).
- [ ] Consider logging/telemetry: when auto-select declines SQLite due to missing/invalid thresholds, surface that decision (currently it is silent except for return fields).

### `src/storage/lmdb/schema.js`

- [ ] Add brief inline documentation describing key-space expectations (which keys must exist for a usable LMDB index).
- [ ] Consider adding a helper to enumerate expected artifact keys for validation tooling (to avoid drift).

### `src/storage/sqlite/build-helpers.js`

- [ ] Ensure `vectorConfig.extension.table` / `.column` are always sanitized before being interpolated into SQL (call-site currently depends on the caller to sanitize).
- [ ] Consider making `buildChunkRow(...)` treat empty strings/arrays consistently (e.g., avoid turning `''` into `null` unintentionally for fields where empty-string is meaningful).
- [ ] Consider reducing confusion: `buildChunkRow(...)` returns fields (`signature`, `doc`) that are not inserted into `chunks` but only into `chunks_fts`.

### `src/storage/sqlite/build/bundle-loader.js`

- [ ] Ensure loader failures return actionable error messages (bundle path, reason). (Current errors are decent; confirm `readBundleFile(...)` includes enough context.)
- [ ] Consider exposing a small “max in-flight bundles” safeguard if worker threads are enabled (to avoid memory spikes on extremely large bundles).

### `src/storage/sqlite/build/delete.js`

- [ ] Cache delete statements by chunk size to reduce repeated `db.prepare(...)` overhead when deleting many docIds.
- [ ] Consider supporting a temp table approach (`CREATE TEMP TABLE ids(...)`) if deletion performance becomes a bottleneck for large deletes.
- [ ] Verify that the `vectorDeleteTargets` contract remains consistent across callers (column name `rowid` vs explicit id columns).

### `src/storage/sqlite/build/from-artifacts.js`

- [ ] Tighten shard discovery: `listShardFiles(...)` includes `.jsonl` but ingestion reads shards via `readJson(...)`; either:
  - restrict token-postings shards to `.json`, or
  - add JSONL support for token-postings shards (if they can be JSONL in practice).
- [ ] Consider inserting `dense_meta` inside the same transaction as the first dense-vector batch (atomicity / consistency).
- [ ] For `chunkMeta` ingestion (non-piece path), avoid building a single giant `rows` array in memory if the artifact can be large; use chunked batching as done in `ingestChunkMetaPieces(...)`.
- [ ] Failure cleanup: remove sidecars (`outPath-wal`, `outPath-shm`) as well as `outPath` on failure.

### `src/storage/sqlite/build/from-bundles.js`

- [ ] **(P0) Prepare `insertVectorAnn` even when the ANN table already exists** (see around L120).  
  The “table exists” branch sets `vectorAnnReady = true` but does not prepare the insert statement, so embeddings are not inserted into ANN.
- [ ] **(P0) Make embedding dims mismatch a hard failure.**  
  Current warning-only behavior (around L197) can produce inconsistent dense vectors.
- [ ] Guard against malformed bundles: `count += result.bundle.chunks.length` should handle missing/invalid `chunks` gracefully (use `?.length || 0`).
- [ ] Remove unused import (`path` is currently imported but not used).
- [ ] Failure cleanup should remove SQLite sidecars, not just the DB file.

### `src/storage/sqlite/build/incremental-update.js`

- [ ] **(P0) Prepare `insertVectorAnn` when the ANN table already exists** (see around L240).  
  Without this, incremental updates delete ANN rows but do not reinsert replacement vectors.
- [ ] Add explicit WAL checkpointing/truncation at the end of a successful update (to keep the DB self-contained and avoid large WAL growth).
- [ ] Consider tightening `isManifestMatch(...)` semantics when hashes are available on only one side (to converge DB manifest quality).
- [ ] Performance: consider `(mode,file,id)` index or other optimization for `getDocIdsForFile(...)` scanning and per-file id lists.
- [ ] Remove (or convert to assertion) the redundant “dims mismatch warn” path inside applyChanges; dims mismatch should already be rejected earlier.

### `src/storage/sqlite/build/manifest.js`

- [ ] De-duplicate `conflicts` output (currently can include repeated normalized paths).
- [ ] Consider strict hash preference: if `entry.hash` is present but `dbEntry.hash` is null, treat as mismatch and update DB hash (do not silently match on mtime/size).

### `src/storage/sqlite/build/pragmas.js`

- [ ] Consider restoring `journal_mode` (or explicitly checkpointing) after build to ensure “single-file DB” invariants if the project expects that.
- [ ] Consider surfacing pragma failures (currently swallowed silently).

### `src/storage/sqlite/build/statements.js`

- [ ] Consider adding `idx_chunks_file_id` (see schema/index alignment notes).
- [ ] Reduce confusion: `buildChunkRowWithMeta(...)` populates fields not present in the schema (e.g., `churn_added`, `churn_deleted`, `churn_commits`). Either:
  - add these columns to the schema if they are intended, or
  - stop emitting them to avoid “looks supported but isn’t”.

### `src/storage/sqlite/build/validate.js`

- [ ] Consider validating ANN invariants when ANN is enabled:
  - `dense_vectors_ann` row count should match `dense_vectors` row count for the mode (or at least have no orphans).
- [ ] Consider making full `integrity_check` optional for very large DBs (it can be expensive); provide a quick-check mode and/or configurable validation levels.

### `src/storage/sqlite/build/vocab.js`

- [ ] Consider caching prepared statements by chunk size (similar to delete/vocab fetch) to reduce repeated SQL compilation overhead.
- [ ] Error messaging: if `missing.length` is huge, cap printed missing values in the thrown error and include only a sample plus counts (to avoid megabyte-scale exception strings).

### `src/storage/sqlite/incremental.js`

- [ ] Document the on-disk incremental manifest contract and failure modes (missing manifest, conflicts, ratio guard).
- [ ] Consider adding a small helper to validate the incremental manifest shape early, with clearer error output.

### `src/storage/sqlite/schema.js`

- [ ] Consider adding `(mode,file,id)` index for maintenance queries.
- [ ] Ensure docs (`docs/sqlite-index-schema.md`) stay in sync when schema changes.

### `src/storage/sqlite/utils.js`

- [ ] `normalizeFilePath(...)` returns the input unchanged when it is not a string; consider returning `null` instead to reduce accidental “undefined as key” behavior.
- [ ] `replaceSqliteDatabase(...)`: consider logging when fallback rename/remove paths are taken (debuggability of replacement failures).

### `src/storage/sqlite/vector.js`

- [ ] `toVectorId(...)` is effectively “coerce to BigInt”; consider renaming to reflect that (e.g., `toSqliteRowidInt64(...)`) to avoid implying a non-trivial mapping.
- [ ] Consider making quantization parameters (`minVal`, `maxVal`) configurable or derived from embedding model metadata (avoid silent saturation if embeddings are out of range).

---

### Tooling files

#### `tools/build-lmdb-index.js`

- [ ] Consider a `--validate` option that checks required artifacts exist before writing LMDB (fail early, clearer errors).
- [ ] Consider writing a small LMDB “manifest” key listing which artifacts were written (enables tool-side validation and reduces drift).

#### `tools/build-sqlite-index.js`

- [ ] Consider exit codes and messaging consistency across build modes (full rebuild vs incremental vs skipped).

#### `tools/build-sqlite-index/cli.js`

- [ ] Consider validating incompatible flag combinations early (e.g., `--bundle-workers` without a bundle dir).
- [ ] Consider adding `--no-compact` / `--compact` clarity in CLI help (if not already covered elsewhere).

#### `tools/build-sqlite-index/index-state.js`

- [ ] De-duplicate `updateIndexStateManifest(...)` with the LMDB equivalent; extract to a shared helper module.
- [ ] Consider including schema version and build mode (full vs incremental) in `index_state.json` for observability.

#### `tools/build-sqlite-index/run.js`

- [ ] Ensure `stopHeartbeat()` is always invoked via `try/finally` (avoid leaking an interval on error when `exitOnError=false`).
- [ ] After incremental updates, consider forcing WAL checkpoint/truncate (see incremental update section).
- [ ] Consider making the “incremental fallback to rebuild” reason more explicit in output (currently logged, but could include key stats: changedFiles, deletedFiles, ratio).

#### `tools/build-sqlite-index/temp-path.js`

- [ ] Consider a “same filesystem guarantee” note: temp DB path must be on same filesystem for atomic rename (current implementation uses same directory, which is good; document this).

#### `tools/clean-artifacts.js`

- [ ] Consider adding a `--dry-run` option that prints what would be deleted without deleting it (safety for new users).

#### `tools/compact-sqlite-index.js`

- [ ] If vector extension is enabled but cannot be loaded, consider warning that compaction may drop ANN acceleration (and suggest remediation, e.g. rerun embeddings rebuild once extension is available).
- [ ] Consider recording pre/post compaction stats into `index_state.json` (bytes, row counts) for observability.

#### `tools/download-extensions.js`

- [ ] Consider streaming zip extraction rather than buffering each entry into memory (`adm-zip` forces buffer extraction; if large binaries become common, consider a streaming zip library).
- [ ] Consider setting file permissions for extracted binaries explicitly per-platform conventions (e.g., preserve exec bit if needed, although shared libraries typically do not require it).

#### `tools/index-validate.js`

- [ ] Consider including actionable remediation hints per failure mode (e.g., “run build-index”, “run build-sqlite-index”, “run download-extensions”).

#### `tools/report-artifacts.js`

- [ ] Consider clarifying the units in output when printing both formatted size and raw bytes (currently raw bytes are printed in parentheses without a label).

#### `tools/vector-extension.js`

- [ ] Consider keying `loadCache` by (db, config) rather than only db (avoids surprising behavior if config changes during a long-lived process).
- [ ] Consider restoring prior `trusted_schema` value after `ensureVectorTable(...)` (minimize global DB setting changes).

#### `tools/verify-extensions.js`

- [ ] Consider adding a quick “smoke query” that verifies the ANN table can be created and queried (optional).

---

### Test files

#### `tests/backend-policy.js`

- [ ] Add coverage for threshold edge cases (e.g., `autoSqliteThresholdChunks=0` semantics).
- [ ] Add a test case where SQLite exists but artifact metadata cannot be read (ensure fallback behavior is correct and reason is surfaced).

#### `tests/compact-pieces.js`

- [ ] No issues noted (acts as a compaction functional check for artifact pieces).

#### `tests/lmdb-backend.js`

- [ ] Consider adding schema version mismatch coverage (fail closed when schema version differs).

#### `tests/lmdb-corruption.js`

- [ ] Consider asserting on error message content to ensure corruption reporting remains actionable.

#### `tests/lmdb-report-artifacts.js`

- [ ] Consider adding a test for “missing required key” vs “corruption” differentiation (if validation tooling can distinguish).

#### `tests/retrieval-backend-policy.js`

- [ ] Add coverage for schema version mismatch fallback (once reader-side user_version check exists).

#### `tests/smoke-sqlite.js`

- [ ] Add coverage for `user_version` mismatch behavior once implemented.

#### `tests/sqlite-ann-extension.js`

- [ ] Add a CI-friendly companion test that does not require the real extension binary (mock vectorConfig approach described above) to ensure ANN insert/delete invariants are enforced in CI.

#### `tests/sqlite-ann-fallback.js`

- [ ] Consider adding explicit coverage that fallback ANN search never returns out-of-range docIds (robustness guard).

#### `tests/sqlite-auto-backend.js`

- [ ] Add a test that covers the “SQLite present but too small” path + verifies reason reporting is stable.

#### `tests/sqlite-build-delete.js`

- [ ] Add coverage for deleting from an ANN table using `rowid` column and BigInt inputs (ensures `toVectorId(...)` conversion remains correct).

#### `tests/sqlite-build-indexes.js`

- [ ] Add coverage for any new maintenance index (e.g., `(mode,file,id)`), if introduced.

#### `tests/sqlite-build-manifest.js`

- [ ] Add a test for “manifest has hash but DB does not” semantics (once tightened).

#### `tests/sqlite-build-vocab.js`

- [ ] Add stress coverage for token sets larger than SQLite’s `IN` limit (ensuring chunking logic remains correct).

#### `tests/sqlite-bundle-missing.js`

- [ ] Add bundle-shape validation coverage (missing `chunks` field should not crash build loop).

#### `tests/sqlite-cache.js`

- [ ] No issues noted (validates cache path behavior / read path).

#### `tests/sqlite-chunk-id.js`

- [ ] No issues noted (docId/chunkId behavior).

#### `tests/sqlite-compact.js`

- [ ] Consider adding coverage for compaction with ANN enabled but extension mocked (ensures dense_vectors_ann remains consistent after compaction).

#### `tests/sqlite-incremental-no-change.js`

- [ ] Consider verifying `index_state.json` is unchanged (or only updated timestamp changes), depending on desired policy.

#### `tests/sqlite-incremental.js`

- [ ] Add coverage for doc-id reuse behavior (free-list) to prevent accidental regression to “always append”.

#### `tests/sqlite-index-state-fail-closed.js`

- [ ] Consider adding coverage that “pending” flips back to false on successful build (already implied but could be explicit).

#### `tests/sqlite-missing-dep.js`

- [ ] No issues noted (validates better-sqlite3 missing behavior).

#### `tests/sqlite-sidecar-cleanup.js`

- [ ] Add incremental-update sidecar cleanup coverage if WAL checkpointing/truncation is implemented.

---

### Documentation files

#### `docs/contracts/sqlite.md`

- [ ] Explicitly document the `user_version` contract and the “fail closed / rebuild on mismatch” behavior.
- [ ] Ensure the list of required tables aligns with the actual reader/build code paths (and clearly separate “core” vs “optional” tables).

#### `docs/external-backends.md`

- [ ] Consider updating to reflect current backend-policy behavior (auto selection thresholds, forced backend semantics).

#### `docs/model-compare-sqlite.json`, `docs/parity-sqlite-ann.json`, `docs/parity-sqlite-fts-ann.json`

- [ ] Ensure these reports are either generated artifacts (and documented as such) or kept in sync with the current schema/tooling versions (otherwise they can mislead).

#### `docs/references/dependency-bundle/deps/better-sqlite3.md`

- [ ] Confirm documented behavior matches current runtime expectations (particularly around extension loading, platform binaries, and supported SQLite features).

#### `docs/sqlite-ann-extension.md`

- [ ] Document the invariant that `dense_vectors_ann` must remain consistent with `dense_vectors` (no orphans; same cardinality per mode when enabled).
- [ ] Document how incremental updates maintain the ANN table (and note limitations when extension is not available).

#### `docs/sqlite-compaction.md`

- [ ] Clarify how compaction interacts with the ANN extension table (and the remediation path if ANN is temporarily unavailable during compaction).

#### `docs/sqlite-incremental-updates.md`

- [ ] Update doc-id behavior description to match implementation (per-file id reuse + free-list reuse rather than always appending).
- [ ] Document the ratio guard behavior and fallback to full rebuild more explicitly.
- [ ] Document WAL/sidecar expectations for incremental updates (single-file vs WAL sidecars).

#### `docs/sqlite-index-schema.md`

- [ ] Reconfirm schema matches `SCHEMA_VERSION = 7` (columns, indexes, optional extension table).
- [ ] If `(mode,file,id)` index is added, document it as a maintenance/performance index.

---

## Exit criteria for this review section

The following items should be completed to consider “Review Section 7” fully addressed:

- [ ] ANN insert-preparation bug fixed in both bundle-build and incremental-update code paths.
- [ ] Reader-side schema version fail-closed behavior implemented and tested.
- [ ] Bundle-build embedding dims mismatch becomes a hard failure (with tests).
- [ ] WAL/sidecar policy is explicitly decided, implemented consistently, and documented (at minimum for incremental updates).
- [ ] At least one CI-friendly test covers ANN table sync invariants without requiring a real extension binary.
- [ ] At least one fixture-based p95 latency regression test is added (or an equivalent deterministic perf guard).

---

---

# Phase 34 — Phase 2/3/4/5/6 verification gates

**Objective:** run and gate the regression tests that confirm Phase 2 contract alignment, Phase 3 chunking invariants, Phase 4 retrieval semantics, Phase 5 durability, and Phase 6 embeddings correctness.

## 34.1 CLI flag removal and error handling
- [ ] `tests/search-removed-flags.js`
  - [ ] Failure: Expected actionable error for --human.
  - [ ] Log: `logs/phase-22/search-removed-flags.log:1`
- [ ] `tests/search-missing-flag-values.js`
  - [ ] Failure: Expected missing value message for --type.
  - [ ] Log: `logs/phase-22/search-missing-flag-values.log:1`

## 34.10 Phase 9 CI gating + flaky test recovery
- [ ] `tests/script-coverage.js`
  - [ ] Failure: Error: unsafe tar entry: C:/Users/sneak/Development/PairOfCleats_CODEX/tests/.cache/download-extensions/tar/.tmp/extract-1768204937568/vec0.dll
  - [ ] Log: `tests/.logs/2026-01-12T08-02-14-028Z/download-extensions-test.attempt-3.log:15`

## 34.11 Phase 10 modularization regression sweep
- [ ] `tests/search-help.js`
  - [ ] Failure: Help output missing flag: --calls.
  - [ ] Log: `logs/phase-22/search-help.log:1`

## 34.12 Phase 11 docs/help parity checks
- [ ] `tests/search-help.js`
  - [ ] Failure: Help output missing flag: --calls.
  - [ ] Log: `logs/phase-22/search-help.log:1`
- [ ] `tests/search-removed-flags.js`
  - [ ] Failure: Expected actionable error for --human.
  - [ ] Log: `logs/phase-22/search-removed-flags.log:1`

## 34.29 file processor skip
- [ ] `tests/file-processor/skip.test.js`
  - [ ] Failure: Expected binary buffer to skip with reason=binary.
  - [ ] Log: `logs/phase-22/file-processor-skip.log:1`

## 34.32 lang js chunking
- [ ] `tests/lang/js-chunking.test.js`
  - [ ] Failure: Missing exported function chunk (alpha).
  - [ ] Log: `logs/phase-22/lang-js-chunking.log:1`

## 34.34 lang js relations
- [ ] `tests/lang/js-relations.test.js`
  - [ ] Failure: Missing exports for run/default: [].
  - [ ] Log: `logs/phase-22/lang-js-relations.log:1`

## 34.38 language registry collectors
- [ ] `tests/language-registry/collectors.test.js`
  - [ ] Failure: dockerfile mismatch: ["node:18"] !== ["base","node:18"].
  - [ ] Log: `logs/phase-22/language-registry-collectors.log:1`

**Exit criteria**
- [ ] All verification tests pass.

---
