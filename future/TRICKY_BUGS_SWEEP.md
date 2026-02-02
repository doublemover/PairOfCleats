# Tricky / non-obvious issues sweep (additional)

> Scope note: This list intentionally **excludes** items already called out in the earlier `CRITICAL_SWEEP.md` (tree-sitter deferral crash, wrapper allowlist gaps, doc-extraction pipeline gaps, etc.) and treats the **test-only env var override** behavior as intended.

## Areas evaluated

- [x] Env-var override usage in **non-test** code paths (`getEnvConfig`, `setVerboseEnv`, runtime envelope)
- [x] HTTP API (`tools/api/*`) request schema → CLI args translation
- [x] MCP server search tool path (`tools/mcp/*` → `src/integrations/core/search.js` → `src/retrieval/cli.js`)
- [x] Core search integration argument construction (`src/integrations/core/search.js` + `src/integrations/core/args.js`)
- [x] VSCode extension search invocation (`extensions/vscode/extension.js`)

---

## Findings

### 1) API `/search` is silently ignoring many request fields (flag name mismatches)

- [ ] **Broken mapping**: `tools/api/router/search.js` builds flags like `--type-filter`, `--author-filter`, `--risk-tag-filter`, `--chunk-author-filter`, etc.
  - The search CLI actually consumes `--type`, `--author`, `--risk-tag`, `--chunk-author`, etc. (see `src/retrieval/cli-args.js` + `src/retrieval/cli/normalize-options.js`).
  - Result: many API payload fields validate successfully but **do nothing** at runtime.

  **Concrete examples** (API payload → current flag → expected flag):
  - `type` → `--type-filter` → should be `--type`
  - `author` → `--author-filter` → should be `--author`
  - `import` → `--import-filter` → should be `--import`
  - `calls` → `--calls-filter` → should be `--calls`
  - `uses` → `--uses-filter` → should be `--uses`
  - `chunkAuthor` → `--chunk-author-filter` → should be `--chunk-author`
  - `risk` → `--risk-filter` → should be `--risk`
  - `riskTag` → `--risk-tag-filter` → should be `--risk-tag`
  - `riskFlow` → `--risk-flow-filter` → should be `--risk-flow`

- [ ] **Broken output selection**: API uses `output` but emits `--output <value>`, which the CLI does not read.
  - Search CLI uses `--json`, `--compact`, `--full`.
  - So `output: "full"` (from the API schema) does not translate to `--full`, and is mostly ignored.

- [ ] **`meta` / `metaJson` are validated but ignored**
  - `SearchRequestSchema` includes `meta` + `metaJson`.
  - `tools/api/router/search.js` never emits `--meta` / `--meta-json`.

**Why this is tricky:** Everything *looks* correct from the API perspective (schema accepts the request; search returns results), but filters/output knobs are silently non-functional.

**Fix direction:** Replace the generic camelCase→kebab-case builder with an explicit mapping table that emits the exact CLI flags (`--type`, `--author`, `--risk-tag`, `--full`, `--meta-json`, etc.).

---

### 2) API search args include `--repo`, but core search prepends `--repo` again (duplicate repo flag)

- [ ] In `tools/api/router/search.js`, `buildSearchParams()` adds `--repo <repoPath>`.
- [ ] In `src/integrations/core/search.js`, `search(repoPath, …)` **always** prepends `--repo <repoPath>` to the arg list.

**Impact:** Requests end up with `--repo` twice.

This is not just cosmetic: yargs can represent duplicates as arrays depending on parser configuration, and `src/retrieval/cli.js` expects `argv.repo` to be a string.

**Fix direction (pick one):**
- Prefer: remove `--repo` from `buildSearchParams()` entirely (API already passes `repoPath` separately).
- Or: make core `search()` detect and remove/override existing `--repo` before prepending its own.

---

### 3) API + MCP are vulnerable to **option-injection via `query`** (including a `--help` kill-switch)

- [ ] `src/integrations/core/search.js` appends `query` as a final argv token **without inserting `--`**.
- [ ] `src/retrieval/cli-args.js` enables `.help()` via yargs.

**Result:** If a client supplies a query like `"--help"` or `"-h"`, yargs can treat it as a flag, print help, and (by default) **exit the process**.

This affects:
- HTTP API (`/search` and `/search/stream`) because `payload.query` is user-controlled.
- MCP search tool because `args.query` is user-controlled.

Even if yargs doesn’t exit in a particular environment, queries beginning with `-` can still be mis-parsed as options, yielding empty/incorrect queries.

**Fix direction:**
- Best global fix: in `src/integrations/core/search.js`, when `query` is present and starts with `-`, insert `'--'` before appending it (or always insert `'--'` before the query).
- Defense-in-depth: change the yargs setup in `parseSearchArgs()` to `.exitProcess(false)` and handle help explicitly, so library usage can’t terminate long-running servers.

---

### 4) API `defaultOutput` is configured but never applied

- [ ] `tools/api-server.js` passes `defaultOutput: argv.output` into `createApiRouter({ … })`.
- [ ] `createApiRouter()` calls `buildSearchParams(repoPath, payload || {})` **without passing `defaultOutput`**.

**Impact:** The API server’s configured default output mode doesn’t influence requests that omit `output`.

**Fix direction:** thread `defaultOutput` into `buildSearchParams()`.

---

### 5) Non-test code paths still reference test-only env override fields (mostly harmless, a few are “dead toggles”)

> You said test-only overrides are intended. This section is just a **callout of remaining non-test references** so you can decide whether to keep them (for tests) or remove/replace them.

- [ ] **One real “still trying to use it” case:** `build_index.js` calls `setVerboseEnv(argv.verbose)`, but `getEnvConfig()` only honors `PAIROFCLEATS_VERBOSE` in testing mode.
  - So setting this env var in normal runs is currently ineffective.

- [ ] **Potentially dead logging toggles** (no CLI fallback):
  - `src/index/build/file-processor.js` → `showLineProgress = getEnvConfig().verbose === true;`
  - `src/index/build/indexer/pipeline.js` → extra stats logging gated on `envConfig.verbose` (does not check `runtime.argv.verbose`).

- [ ] Other non-test `getEnvConfig()` usage (has fallbacks / test-only behavior):
  - `src/index/build/discover.js` (stat concurrency)
  - `src/index/build/runtime/runtime.js` (stage override, cacheRoot labeling)
  - `src/index/build/watch/resolve-backend.js` (watch backend selection)
  - `tools/cache-gc.js`, `tools/index-validate.js`, `tools/build-embeddings/*`, `tools/build-sqlite-index/*` (mostly test toggles like crash logging)

---

### 6) Minor: MCP transport has variable shadowing that could confuse maintenance

- [ ] `tools/mcp/transport.js` defines `const inFlight = new Map();` at module scope, and later declares `const inFlight = processing ? 1 : 0;` inside `enqueueMessage()`.

This isn’t currently breaking behavior (it’s block-scoped), but it’s an easy footgun.

---

### 7) Minor: VSCode extension can mis-parse queries that begin with `-` and then fail JSON parsing

- [ ] `extensions/vscode/extension.js` builds args as `['search', query, '--json', …]` (no `--` separator).
- [ ] A query like `"--help"` will produce non-JSON output and the extension will throw on `JSON.parse(stdout)`.

**Fix direction:** insert `'--'` before `query` when it starts with `-` (or always), similar to the core fix.

---

## Suggested “high-leverage” fixes (recommended order)

- [ ] Fix API arg mapping (`tools/api/router/search.js`) using an explicit field→flag map; include `--full`, `--meta`, `--meta-json`, and correct filter flags.
- [ ] Remove duplicate `--repo` injection (API should not emit it; core already forces it).
- [ ] Add `--` separation before appending `query` in `src/integrations/core/search.js` (protect API + MCP + any future server integrations).
- [ ] Thread `defaultOutput` through API router so server config actually applies.

