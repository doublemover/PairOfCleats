# PairOfCleats

*Give your coding agents a pair of cleats, so they can sprint through your codebase.*

## What is PairOfCleats?
PairOfCleats builds a hybrid semantic index for a repo (code + docs) and exposes a CLI/MCP server for fast, filterable search. It is designed for agent workflows, with artifacts stored outside the repo by default so they can be shared across runs, containers, and CI while keeping working trees clean.

The index captures rich structure and metadata: language-aware chunking across code, configs, and docs; docstrings/signatures/annotations; call/import/usage relations; control-flow and dataflow summaries; type inference (intra-file with optional cross-file); git-aware churn metadata; and embeddings for semantic search. Search combines BM25 token/phrase scoring, MinHash similarity, dense vectors, and optional SQLite backends (including FTS5 and ANN via sqlite-vec) with filters and human/JSON output. The tooling also includes incremental indexing, cache management, dictionary bootstrapping, CI artifact restore/build, optional language tooling detection/installation, and triage workflows for ingesting vulnerability records plus generating context packs.

## Status
Active development. Current execution status lives in `COMPLETE_PLAN.md`; `ROADMAP.md` is historical.

## Requirements
- Node.js 18+
- Optional: Python 3 for AST-based metadata on `.py` files (fallbacks to heuristics; worker pool via `indexing.pythonAst.*`)
- Optional: SQLite backend (via `better-sqlite3`)
- Optional: SQLite vector extension (`sqlite-vec`) for ANN acceleration

## Quick start
- `npm run setup`
  - Guided prompts for install, dictionaries, models, extensions, tooling, and indexes.
  - Add `--non-interactive` for CI or automated runs.
  - Add `--with-sqlite` to build SQLite indexes.
  - Add `--incremental` to reuse per-file cache bundles.
- `npm run bootstrap` (fast, no prompts)
  - Add `--with-sqlite` to build SQLite indexes.
  - Add `--incremental` to reuse per-file cache bundles.
- `npm run watch-index` (polls for file changes and rebuilds incrementally)     
- `npm run api-server` (local HTTP JSON API for status/search)
- Cache is outside the repo by default; set `cache.root` in `.pairofcleats.json` to override.
- CLI commands auto-detect repo roots; use `--repo <path>` to override.
- Local CLI entrypoint: `node bin/pairofcleats.js <command>` (mirrors `npm run` scripts).

<details>
<summary><h2>Index features</h2></summary>

- Languages: JavaScript/TypeScript, Python, Swift, Rust, C/C++/ObjC, Go, Java, C#, Kotlin, Ruby, PHP, Lua, SQL (dialects), Perl, Shell
- LSP enrichment (clangd/sourcekit-lsp) is best-effort; clangd uses compile_commands.json when available and can be required via `tooling.clangd.requireCompilationDatabase`
- Config formats: JSON, TOML, INI/CFG/CONF, XML, YAML, Dockerfile, Makefile, GitHub Actions YAML
- Docs: Markdown, RST, AsciiDoc
- Chunking:
  - Code declarations (functions, classes, methods, types)
  - Config sections (keys/blocks)
  - Doc headings/sections
- Ignore files: `.pairofcleatsignore` (gitignore-style) and `.gitignore`        
- Large file guardrails: `indexing.maxFileBytes` (default 5 MB; set to `0` to disable)
- Metadata per chunk:
  - docstrings, signatures, params, decorators/annotations
  - modifiers + visibility + inheritance
  - code relations (calls/imports/exports/usages)
  - interprocedural call summaries (args + return hints)
  - dataflow (reads/writes/mutations/aliases) + control-flow summaries
  - risk signals (sources/sinks/flows + tags, with cross-file call correlation)
  - type inference (intra-file, optional cross-file)
  - git metadata (last author/date, churn = added+deleted lines), JS complexity/lint, headline + neighbor context
- Triage records (findings + decisions) indexed outside the repo
- Index artifacts:
  - token postings (always)
  - phrase/chargram postings (configurable via `indexing.postings.*`)
  - MinHash signatures
  - dense vectors (merged + doc/code variants; MiniLM)
  - incremental per-file cache bundles
</details>

<details>
<summary><h2>Search features</h2></summary>

- BM25 token/phrase search + n-grams/chargrams
- MinHash similarity fallback
- Dense vectors (optional, ANN-aware when enabled)
- Query syntax: `-term` excludes tokens, `"exact phrase"` boosts phrase matches, `-"phrase"` excludes phrases
- Modes: `code`, `prose`, `both`, `records`, `all`
- Backends:
  - `memory` (file-backed JSON)
  - `sqlite` (same scoring, shared artifacts)
  - `sqlite-fts` (SQLite-only FTS5 scoring)
- Common filters (ext/kind/author/visibility) use precomputed indexes for speed.
- Filters (high-signal subset):
  - `--type`, `--signature`, `--param`, `--decorator`, `--inferred-type`, `--return-type`
  - `--throws`, `--reads`, `--writes`, `--mutates`, `--awaits`
  - `--alias`
  - `--risk`, `--risk-tag`, `--risk-source`, `--risk-sink`, `--risk-category`, `--risk-flow`
  - `--branches`, `--loops`, `--breaks`, `--continues`
  - `--async`, `--generator`, `--returns`
  - `--author`, `--chunk-author`, `--modified-after`, `--modified-since`, `--churn [min]` (git numstat added+deleted), `--lint`, `--calls`, `--import`, `--uses`, `--extends`
  - `--path`/`--file` (substring or `/regex/`), `--ext` (generic file filters)
  - `--meta`, `--meta-json` (records metadata filters)
- Output:
  - human-readable (color), `--json` (full), or `--json-compact` (lean tooling payload)
  - full JSON includes `score` (selected), `scoreType`, `sparseScore`, `annScore`, and `scoreBreakdown` (sparse/ann/phrase/selected)
  - `--explain` / `--why` prints a score breakdown in human output (selected/sparse/ANN/phrase)
- Optional query cache (`search.queryCache.*` in `.pairofcleats.json`)
</details>

<details>
<summary><h2>Triage records + context packs</h2></summary>

- Ingest findings into cache-backed records:
  - `node tools/triage/ingest.js --source dependabot --in dependabot.json --meta service=api --meta env=prod`
  - `node tools/triage/ingest.js --source aws_inspector --in inspector.json --meta service=api --meta env=prod`
  - `node tools/triage/ingest.js --source generic --in record.json --meta service=api --meta env=prod`
- Build the records index: `node build_index.js --mode records --incremental`
- Search records with metadata filters:
  - `node search.js "CVE-2024-0001" --mode records --meta service=api --meta env=prod --json`
- Create decision records:
  - `node tools/triage/decision.js --finding <recordId> --status accept --justification "..."`
- Generate a context pack:
  - `node tools/triage/context-pack.js --record <recordId> --out context.json`
- Docs: [`docs/triage-records.md`](docs/triage-records.md)
</details>

<details>
<summary><h2>Dictionaries</h2></summary>

- Default English wordlist: `npm run download-dicts -- --lang en` (setup/ bootstrap runs this)
- Cache dir: `<cache>/dictionaries` (override with `dictionary.dir` or `PAIROFCLEATS_DICT_DIR`)
- Update dictionaries with ETag/Last-Modified: `npm run download-dicts -- --update`
- Add custom lists: `npm run download-dicts -- --url mylist=https://example.com/words.txt`
- Slang support: drop `.txt` files into the `slang/` folder in the dictionary cache
- Repo-specific dictionary (opt-in):
  - `npm run generate-repo-dict -- --min-count 3`
  - enable via `{ "dictionary": { "enableRepoDictionary": true } }`
</details>

<details>
<summary><h2>Model cache</h2></summary>

- Models live under `<cache>/models` by default
- Download: `npm run download-models`
- Override in `.pairofcleats.json`:
  ```json
  { "models": { "id": "Xenova/all-MiniLM-L12-v2", "dir": "C:/cache/pairofcleats/models" } }
  ```
- Env overrides: `PAIROFCLEATS_MODELS_DIR`, `PAIROFCLEATS_MODEL`
</details>

<details>
<summary><h2>SQLite backend</h2></summary>

- Build: `npm run build-sqlite-index`
- Uses split DBs (`index-code.db` + `index-prose.db`) for concurrency
- `search.js` auto-uses SQLite when `sqlite.use: true` and DBs exist, unless `search.sqliteAutoChunkThreshold` keeps small repos on file-backed indexes (default 5000; set 0 to always prefer SQLite)
- FTS5 scoring (optional): set `sqlite.scoreMode` to `fts`
- ANN extension (optional): set `sqlite.annMode = "extension"` and install `sqlite-vec`
  - ANN is on by default when `search.annDefault` is true; use `--no-ann` or set `search.annDefault: false` to disable
  - Install: `npm run download-extensions`
  - Verify: `npm run verify-extensions`
</details>

<details>
<summary><h2>Installation</h2></summary>

- Guided setup: `npm run setup` (prompts)
- CI/automation: `npm run setup -- --non-interactive --json` (summary JSON on stdout)
- Manual steps:
  - Install dependencies: `npm install`
  - Optional extras:
    - Dictionaries: `npm run download-dicts -- --lang en`
    - Models: `npm run download-models`
    - SQLite ANN extension: `npm run download-extensions`
    - Verify extension: `npm run verify-extensions`
    - Detect tooling: `npm run tooling-detect`
    - Install tooling: `npm run tooling-install -- --scope cache`
    - Git hooks: `npm run git-hooks -- --install`
    - Validate config: `npm run config-validate -- --config .pairofcleats.json`
  - Build indexes:
    - File-backed: `node build_index.js` (add `--incremental` if desired)
    - SQLite: `npm run build-sqlite-index`
    - Validate: `npm run index-validate`
</details>

<details>
<summary><h2>API server</h2></summary>

Run: `npm run api-server` or `node bin/pairofcleats.js server`

Endpoints:
- `GET /health`
- `GET /status?repo=<path>`
- `POST /search` (JSON payload mirrors CLI filters)
- `GET /status/stream` (SSE)
- `POST /search/stream` (SSE)
- Docs: [`docs/api-server.md`](docs/api-server.md)
</details>

<details>
<summary><h2>Editor integration</h2></summary>

- VS Code extension (CLI shell-out) under `extensions/vscode`
- Command: `PairOfCleats: Search`
- Uses `pairofcleats search --json-compact` with file/line hints
- Docs: [`docs/editor-integration.md`](docs/editor-integration.md)
</details>

<details>
<summary><h2>MCP server</h2></summary>

Run: `npm run mcp-server`

Tools:
- `index_status`
- `config_status`
- `build_index`
- `search`
- `triage_ingest`
- `triage_decision`
- `triage_context_pack`
- `download_models`
- `download_dictionaries`
- `download_extensions`
- `verify_extensions`
- `build_sqlite_index`
- `compact_sqlite_index`
- `cache_gc`
- `clean_artifacts`
- `bootstrap`
- `report_artifacts`
- `search` defaults to compact JSON payloads (set `output: "full"` for full JSON).
- Progress: long-running tools emit `notifications/progress` with `{ id, tool, message, stream, phase }`.
- Errors: `tools/call` responses set `isError=true` and return a JSON payload with `message` plus optional `code`, `stdout`, `stderr`, `hint`.
</details>

<details>
<summary><h2>Tests</h2></summary>

All-in-one (runs everything it can):
- `npm run test-all`
- `npm run test-all-no-bench` (skips the benchmark run)
- `npm run test-all -- --skip-bench` (same as above)

Core:
- `npm run verify`
- `npm run fixture-smoke`
- `npm run fixture-parity`
- `npm run fixture-eval`
- `npm run search-explain-test`

Fidelity:
- `npm run language-fidelity-test`
- `npm run format-fidelity-test`
- `npm run type-inference-crossfile-test`

SQLite + extensions:
- `npm run sqlite-incremental-test`
- `npm run sqlite-compact-test`
- `npm run sqlite-ann-extension-test`
- `npm run download-extensions-test`

Tooling + caches:
- `npm run download-dicts-test`
- `npm run setup-test`
- `npm run tooling-detect-test`
- `npm run tooling-install-test`
- `npm run query-cache-test`
- `npm run index-validate-test`
- `npm run clean-artifacts-test`
- `npm run uninstall-test`
- `npm run cache-gc-test`
- `npm run git-hooks-test`

Triage:
- `npm run triage-test`

Reports + MCP:
- `npm run repometrics-dashboard-test`
- `npm run compare-models-test`
- `npm run summary-report-test`
- `npm run mcp-server-test`
- `npm run api-server-test`
- `npm run api-server-stream-test`
- `npm run vscode-extension-test`

Meta:
- `npm run script-coverage-test`
- `npm run docs-consistency-test`
- `npm run bench` / `npm run bench-ann` / `npm run bench-language`
</details>

<details>
<summary><h2>Maintenance</h2></summary>

- Report cache sizes: `npm run report-artifacts` (add `-- --all` for all repos)
- Validate index artifacts: `npm run index-validate`
- Cache GC (age/size): `npm run cache-gc -- --max-gb 10` or `--max-age-days 30`
- Clean repo artifacts: `npm run clean-artifacts` (add `-- --all` to clear repo caches; keeps models/dictionaries/extensions)
- Uninstall caches + models + extensions: `npm run uninstall`
- Compact SQLite indexes: `npm run compact-sqlite-index`
- Dependency policy: versions are pinned in `package.json`; update via `npm install` and commit `package-lock.json`.
- Repometrics dashboard: `npm run repometrics-dashboard`
- Model comparison: `npm run compare-models`
- Combined summary report: `npm run summary-report` (add `-- --json` for JSON output)
- Tooling detect/install: `npm run tooling-detect`, `npm run tooling-install`
- Git hooks (post-commit/post-merge): `npm run git-hooks -- --install`
- CI artifacts: `node tools/ci-build-artifacts.js --out ci-artifacts`, `node tools/ci-restore-artifacts.js --from ci-artifacts`
</details>

<details>
<summary><h2>Design docs</h2></summary>

- [`COMPLETE_PLAN.md`](COMPLETE_PLAN.md) - single source of truth for all phases
- [`docs/ast-feature-list.md`](docs/ast-feature-list.md) - metadata schema + per-language coverage
- [`docs/language-fidelity.md`](docs/language-fidelity.md) - parsing validation checklist
- [`docs/parser-backbone.md`](docs/parser-backbone.md) - parser and inference strategy
- [`docs/language-handler-imports.md`](docs/language-handler-imports.md) - registry import tradeoffs
- [`docs/editor-integration.md`](docs/editor-integration.md) - editor contract + VS Code extension
- [`docs/api-server.md`](docs/api-server.md) - local HTTP JSON API surface
- [`docs/sqlite-index-schema.md`](docs/sqlite-index-schema.md) - SQLite schema for artifacts
- [`docs/sqlite-incremental-updates.md`](docs/sqlite-incremental-updates.md) - incremental update flow
- [`docs/sqlite-compaction.md`](docs/sqlite-compaction.md) - compaction details
- [`docs/sqlite-ann-extension.md`](docs/sqlite-ann-extension.md) - SQLite ANN extension setup
- [`docs/model-comparison.md`](docs/model-comparison.md) - model evaluation harness
- [`docs/language-benchmarks.md`](docs/language-benchmarks.md) - language benchmark repos and workflow
- [`docs/query-cache.md`](docs/query-cache.md) - query cache behavior
- [`docs/repometrics-dashboard.md`](docs/repometrics-dashboard.md) - repometrics output and usage
- [`docs/setup.md`](docs/setup.md) - unified setup flow and flags
- [`docs/triage-records.md`](docs/triage-records.md) - triage ingestion + context packs
- [`docs/config-schema.json`](docs/config-schema.json) - config schema for `.pairofcleats.json`
</details>

<details>
<summary><h2>Cache layout</h2></summary>

- `<cache>/repos/<repoId>/index-code`
- `<cache>/repos/<repoId>/index-prose`
- `<cache>/repos/<repoId>/index-records`
- `<cache>/repos/<repoId>/incremental/<mode>`
- `<cache>/repos/<repoId>/repometrics`
- `<cache>/repos/<repoId>/triage/records`
- `<cache>/repos/<repoId>/triage/context-packs`
- `<cache>/repos/<repoId>/index-sqlite/index-code.db`
- `<cache>/repos/<repoId>/index-sqlite/index-prose.db`
- `<cache>/dictionaries`
- `<cache>/models`
- `<cache>/extensions`
- `<cache>/tooling`

Default cache root:
- Windows: `%LOCALAPPDATA%\\PairOfCleats`
- Linux/macOS: `$XDG_CACHE_HOME/pairofcleats` or `~/.cache/pairofcleats`
- Override with `cache.root`, `PAIROFCLEATS_CACHE_ROOT`, or `PAIROFCLEATS_HOME`
</details>
