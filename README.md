# PairOfCleats

*Give your coding agents a pair of cleats, so they can sprint through your codebase.*

## What is PairOfCleats?
PairOfCleats builds a hybrid semantic index for a repo (code + docs) and exposes a CLI/MCP server for fast, filterable search. Index artifacts live in a cache outside the repo by default, so they can be mounted into agent images or shared across workflows.

## Status
Active development. See `ROADMAP.md` for milestones and longer-term work.

## Requirements
- Node.js 18+
- Optional: Python 3 for AST-based metadata on `.py` files (fallbacks to heuristics)
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
- Cache is outside the repo by default; set `cache.root` in `.pairofcleats.json` to override.

<details>
<summary><h2>Index features</h2></summary>

- Languages: JavaScript/TypeScript, Python, Swift, Rust, C/C++/ObjC, Go, Java, C#, Kotlin, Ruby, PHP, Lua, SQL (dialects), Perl, Shell
- Config formats: JSON, TOML, INI/CFG/CONF, XML, YAML, Dockerfile, Makefile, GitHub Actions YAML
- Docs: Markdown, RST, AsciiDoc
- Chunking:
  - Code declarations (functions, classes, methods, types)
  - Config sections (keys/blocks)
  - Doc headings/sections
- Metadata per chunk:
  - docstrings, signatures, params, decorators/annotations
  - modifiers + visibility + inheritance
  - code relations (calls/imports/exports/usages)
  - dataflow + control-flow summaries
  - type inference (intra-file, optional cross-file)
  - git metadata, JS complexity/lint, headline + neighbor context
- Index artifacts:
  - token/phrase/chargram postings
  - MinHash signatures
  - dense vectors (MiniLM)
  - incremental per-file cache bundles
</details>

<details>
<summary><h2>Search features</h2></summary>

- BM25 token/phrase search + n-grams/chargrams
- MinHash similarity fallback
- Dense vectors (optional, ANN-aware when enabled)
- Backends:
  - `memory` (file-backed JSON)
  - `sqlite` (same scoring, shared artifacts)
  - `sqlite-fts` (SQLite-only FTS5 scoring)
- Filters (high-signal subset):
  - `--type`, `--signature`, `--param`, `--decorator`, `--inferred-type`, `--return-type`
  - `--throws`, `--reads`, `--writes`, `--mutates`, `--awaits`
  - `--branches`, `--loops`, `--breaks`, `--continues`
  - `--async`, `--generator`, `--returns`
  - `--author`, `--churn`, `--lint`, `--calls`, `--import`, `--uses`, `--extends`
- Output:
  - human-readable (color) or `--json` for tools
</details>

<details>
<summary><h2>Dictionaries</h2></summary>

- Default English wordlist: `npm run download-dicts -- --lang en` (setup/ bootstrap runs this)
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
- `search.js` auto-uses SQLite when `sqlite.use: true` and DBs exist
- FTS5 scoring (optional): set `sqlite.scoreMode` to `fts`
- ANN extension (optional): set `sqlite.annMode = "extension"` and install `sqlite-vec`
  - Install: `npm run download-extensions`
  - Verify: `npm run verify-extensions`
</details>

<details>
<summary><h2>Installation</h2></summary>

- Guided setup: `npm run setup` (prompts)
- CI/automation: `npm run setup -- --non-interactive`
- Manual steps:
  - Install dependencies: `npm install`
  - Optional extras:
    - Dictionaries: `npm run download-dicts -- --lang en`
    - Models: `npm run download-models`
    - SQLite ANN extension: `npm run download-extensions`
    - Verify extension: `npm run verify-extensions`
    - Detect tooling: `npm run tooling-detect`
    - Install tooling: `npm run tooling-install -- --scope cache`
  - Build indexes:
    - File-backed: `node build_index.js` (add `--incremental` if desired)
    - SQLite: `npm run build-sqlite-index`
</details>

<details>
<summary><h2>MCP server</h2></summary>

Run: `npm run mcp-server`

Tools:
- `index_status`
- `build_index`
- `search`
- `download_models`
- `report_artifacts`
</details>

<details>
<summary><h2>Tests</h2></summary>

All-in-one (runs everything it can):
- `npm run test-all` (pass `-- --skip-bench` to skip the benchmark run)

Core:
- `npm run verify`
- `npm run fixture-smoke`
- `npm run fixture-parity`
- `npm run fixture-eval`

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
- `npm run clean-artifacts-test`
- `npm run uninstall-test`

Reports + MCP:
- `npm run repometrics-dashboard-test`
- `npm run compare-models-test`
- `npm run summary-report-test`
- `npm run mcp-server-test`

Meta:
- `npm run script-coverage-test`
- `npm run bench` / `npm run bench-ann`
</details>

<details>
<summary><h2>Maintenance</h2></summary>

- Report cache sizes: `npm run report-artifacts`
- Clean repo artifacts: `npm run clean-artifacts` (add `-- --all` to wipe cache)
- Uninstall caches + models + extensions: `npm run uninstall`
- Compact SQLite indexes: `npm run compact-sqlite-index`
- Repometrics dashboard: `npm run repometrics-dashboard`
- Tooling detect/install: `npm run tooling-detect`, `npm run tooling-install`
- CI artifacts: `node tools/ci-build-artifacts.js --out ci-artifacts`, `node tools/ci-restore-artifacts.js --from ci-artifacts`
</details>

<details>
<summary><h2>Design docs</h2></summary>

- [`COMPLETE_PLAN.md`](COMPLETE_PLAN.md) - single source of truth for all phases
- [`docs/ast-feature-list.md`](docs/ast-feature-list.md) - metadata schema + per-language coverage
- [`docs/language-fidelity.md`](docs/language-fidelity.md) - parsing validation checklist
- [`docs/parser-backbone.md`](docs/parser-backbone.md) - parser and inference strategy
- [`docs/language-handler-imports.md`](docs/language-handler-imports.md) - registry import tradeoffs
- [`docs/sqlite-index-schema.md`](docs/sqlite-index-schema.md) - SQLite schema for artifacts
- [`docs/sqlite-incremental-updates.md`](docs/sqlite-incremental-updates.md) - incremental update flow
- [`docs/sqlite-compaction.md`](docs/sqlite-compaction.md) - compaction details
- [`docs/sqlite-ann-extension.md`](docs/sqlite-ann-extension.md) - SQLite ANN extension setup
- [`docs/model-comparison.md`](docs/model-comparison.md) - model evaluation harness
- [`docs/query-cache.md`](docs/query-cache.md) - query cache behavior
- [`docs/repometrics-dashboard.md`](docs/repometrics-dashboard.md) - repometrics output and usage
- [`docs/setup.md`](docs/setup.md) - unified setup flow and flags
</details>

<details>
<summary><h2>Cache layout</h2></summary>

- `<cache>/repos/<repoId>/index-code`
- `<cache>/repos/<repoId>/index-prose`
- `<cache>/repos/<repoId>/incremental/<mode>`
- `<cache>/repos/<repoId>/repometrics`
- `<cache>/repos/<repoId>/index-sqlite/index-code.db`
- `<cache>/repos/<repoId>/index-sqlite/index-prose.db`
- `<cache>/models`
- `<cache>/extensions`

Default cache root:
- Windows: `%LOCALAPPDATA%\\PairOfCleats`
- Linux/macOS: `~/.cache/pairofcleats`
</details>
