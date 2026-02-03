# Project sweep: critical/serious bugs & functionality issues (static analysis)

This document is a **general static sweep** of the repository for **critical/serious bugs** and **functionality issues** that should be addressed.

---

## Areas reviewed

- **Index build pipeline**: `src/index/build/**` (runtime creation, indexer pipeline steps, file processing)
- **Search/retrieval**: `src/retrieval/**`, `search.js`, `bin/pairofcleats.js` routing
- **Local API**: `tools/api-server.js` + `tools/api/router/**`
- **MCP server & service tooling**: `tools/mcp-server.js`, `tools/mcp/**`, `tools/indexer-service.js`
- **Config/env surfaces**: `src/shared/env.js`, `src/shared/runtime-envelope.js`, `tools/config-inventory.js`
- **Docs/scripts drift**: `README.md`, `AGENTS.md`, `package.json`

---

## Index build pipeline

### [ ] BLOCKER — Tree-sitter deferral path can crash with `ReferenceError`
- **Impact:** `index build` will crash if `treeSitter.languagePasses === false` and deferrals attempt to merge missing languages.
- **Evidence:** `src/index/build/indexer/steps/process-files.js` references `normalizeTreeSitterLanguages(...)` but it is **not imported** and not defined in the module.
  - `process-files.js:314` calls `normalizeTreeSitterLanguages([ ... ])`.
  - The function exists only as a private helper in `src/index/build/indexer/steps/process-files/tree-sitter.js` (not exported).
- **Fix:** Export `normalizeTreeSitterLanguages` from `process-files/tree-sitter.js` and import it into `process-files.js`, *or* refactor the merge logic to use an already-exported helper.

---

## Configuration / environment variable surface

### [ ] HIGH — `getEnvConfig()` disables most env overrides unless `PAIROFCLEATS_TESTING` is set
- **Impact:** In normal usage, environment variables documented for runtime/tool configuration (cache root, embeddings, logging, watcher backend, MCP limits, etc.) are effectively ignored.
- **Evidence:** `src/shared/env.js`:
  - `getEnvConfig()` returns **only** `{ apiToken }` unless `PAIROFCLEATS_TESTING` is truthy:
    - `if (!isTesting(env)) return secrets;`.
  - This is inconsistent with multiple production surfaces reading `envConfig.*` (build runtime, watch backend selection, embeddings runtime, MCP server config, etc.).
- **Examples of real-world breakage:**
  - `PAIROFCLEATS_EMBEDDINGS=stub` won’t affect `src/index/build/runtime/embeddings.js` (it reads `envConfig.embeddings`).
  - `PAIROFCLEATS_CACHE_ROOT` won’t affect build cache selection (build runtime uses `getCacheRoot()` / user config).
  - `PAIROFCLEATS_MCP_QUEUE_MAX` / `PAIROFCLEATS_MCP_MAX_BUFFER_BYTES` won’t affect `tools/mcp-server.js` unless testing mode is set.
- **Fix options:**
  - **Option A (likely intended):** remove the testing gate so `getEnvConfig()` always returns the normalized env overrides.
  - **Option B (if env overrides are meant to be test-only):** remove/stop using `envConfig.*` in production codepaths and update docs/specs to explicitly say these env vars are test-only.

### [ ] HIGH — `envConfig` shape mismatch: consumers read keys that `getEnvConfig()` never provides
- **Impact:** Even with the testing gate removed, several env-controlled toggles referenced by tools are currently **dead**, because `getEnvConfig()` does not include those keys.
- **Evidence (consumers):**
  - `tools/mcp/repo.js` reads:
    - `envConfig.regexEngine`
    - `envConfig.compression`
    - `envConfig.docExtract` (used to gate document extraction)
    - `envConfig.mcpTransport`
  - `tools/compare-models.js` reads:
    - `envConfig.modelsDir`
    - `envConfig.dictDir`
- **Evidence (producer):** `src/shared/env.js` does **not** include: `regexEngine`, `compression`, `docExtract`, `mcpTransport`, `modelsDir`, `dictDir`.
- **Fix:**
  - Add the missing fields to `getEnvConfig()` with the intended env var names (some are already referenced in docs, e.g. `PAIROFCLEATS_MCP_TRANSPORT`, `PAIROFCLEATS_DOC_EXTRACT`).
  - Add/adjust validation where relevant (e.g., allowed selector values).

### [ ] HIGH — Several env vars in the public config inventory are not consumed anywhere
- **Impact:** Users (and docs) are led to believe certain env vars work, but they currently have no effect.
- **Evidence:** `tools/config-inventory.js` lists (among others):
  - `PAIROFCLEATS_HOME` (no references found outside the inventory)
  - `PAIROFCLEATS_MODELS_DIR`, `PAIROFCLEATS_DICT_DIR` (only written into child-process env in `tools/compare-models.js`, never read)
  - `PAIROFCLEATS_EXTENSIONS_DIR` (listed, but no code reads it)
- **Fix:** either implement them (and wire into path resolution) or remove from inventory + docs.

---

## CLI / user-facing command surface

### [ ] HIGH — `pairofcleats search` wrapper rejects many supported search flags and blocks documented backends
- **Impact:** The main `pairofcleats search` entrypoint cannot access large parts of the underlying search CLI.
  - This is user-facing and will be interpreted as “feature broken”.
- **Evidence:** `bin/pairofcleats.js`:
  - Strict allowlist of flags for `search`:
    - `validateArgs(rest, ['repo', 'mode', 'top', 'json', 'explain', 'filter', 'backend'], ...)`
    - This rejects valid flags supported by `src/retrieval/cli-args.js` (e.g. `--lang`, `--ext`, `--path`, `--compact`, `--risk-*`, `--context`, etc.).
  - Backend validation hard-codes `auto|sqlite|lmdb` and rejects `sqlite-fts`.
- **Corollary:** the **API server** does pass through many of these flags (`tools/api/router/search.js`), so the mismatch is particularly confusing.
- **Fix:**
  - Prefer delegating validation to `src/retrieval/cli.js` (or share a single CLI schema), rather than maintaining a divergent wrapper allowlist.
  - Update backend allowlist to include `sqlite-fts` if supported.

---

## Document extraction / non-code formats

### [ ] HIGH — Document extraction is advertised but appears unimplemented (and env hook is broken)
- **Impact:** Users expecting optional PDF/DOCX ingestion will not get it.
- **Evidence:**
  - `README.md` advertises PDF/DOCX support via `pdfjs-dist` + `mammoth` and mentions `PAIROFCLEATS_DOC_EXTRACT=on`.
  - Codebase contains only **capability detection** (`src/shared/capabilities.js` checks for `pdfjs-dist` and `mammoth`) and warnings (`tools/mcp/repo.js`), but **no extraction pipeline** (no PDF/DOCX parsing/chunking stages found in `src/index/build/**` or `src/index/chunking/**`).
  - Additionally, `tools/mcp/repo.js` checks `envConfig.docExtract`, but `getEnvConfig()` does not define `docExtract` at all.
- **Fix:**
  - Either implement extraction end-to-end (ingest → extract text → chunk → index) **or** remove/soften the README claim and keep it as a roadmap item.
  - If kept: add `docExtract` to env config + define the intended env var name and semantics.

---

## Scripts / developer workflow

### [ ] HIGH — Docs and Phase text reference npm scripts that do not exist
- **Impact:** Onboarding and CI reproducibility are degraded (contributors run commands that fail).
- **Evidence:**
  - `README.md` / `AGENTS.md` reference `npm run test:pr` (and similar).
  - `package.json` has no `test`, `test:pr`, `test:nightly`, `verify`, `test:ci-lite`, or `test:ci-long` scripts.
  - CI runs `node tools/ci/run-suite.js --mode ci` directly.
- **Fix:**
  - Add thin npm script aliases that call the existing stable entrypoints (`node tests/run.js` / `node tools/ci/run-suite.js`) **or** update docs to only reference the node entrypoints.

---

## (Potential) accuracy / observability issues

### [ ] POTENTIAL — Metrics backend label set omits LMDB, causing “unknown” backend metrics
- **Impact:** Operational metrics for LMDB searches will be mislabeled as `unknown`.
- **Evidence:** `src/shared/metrics.js` only allows `memory|sqlite|sqlite-fts` in `BACKENDS`.
- **Fix:** Add `lmdb` to the allowed backend label set.

---

## Summary of critical items

- **BLOCKER:** Tree-sitter deferral merge crashes due to undefined `normalizeTreeSitterLanguages`.
- **HIGH:** Env config is effectively test-only and incomplete; multiple tools read envConfig keys that are never produced.
- **HIGH:** `pairofcleats search` wrapper blocks the real search CLI surface (flags + sqlite-fts backend).
- **HIGH:** Document extraction is advertised but not implemented; env hook is missing.
- **HIGH:** Missing npm script aliases referenced in docs and phase text.

