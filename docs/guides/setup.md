# Unified Setup

The unified setup script (`pairofcleats setup`) guides you through installing optional dependencies and building indexes in one flow. It is interactive by default.

## Usage

- Interactive (recommended):
  - `pairofcleats setup`
- Non-interactive (CI):
  - `node tools/setup/setup.js --non-interactive`
- Non-interactive with JSON summary:
  - `node tools/setup/setup.js --non-interactive --json`

## What it can do

- Install Node dependencies (`npm install`).
- Download dictionaries (English wordlist by default).
- Download embedding models.
- Download the SQLite ANN extension when available.
- Detect and optionally install tooling.
- Restore CI artifacts when present.
- Build file-backed indexes (optionally incremental).
- Build SQLite indexes (default unless `--skip-sqlite`).

## Flags

- Flags below apply to the direct script (`node tools/setup/setup.js`):
  - `--non-interactive` / `--ci`: Skip prompts and use defaults.
  - `--json`: Emit a summary report to stdout (logs go to stderr).
  - `--with-sqlite`: Force SQLite build on (default behavior).
  - `--incremental`: Use incremental indexing if available.
  - `--validate-config`: Validate `.pairofcleats.json` before running setup.
  - `--skip-validate`: Skip config validation prompts.
  - `--tooling-scope cache|global`: Override tooling install scope.
  - `--skip-install`: Skip `npm install`.
  - `--skip-dicts`: Skip dictionary download.
  - `--skip-models`: Skip model download.
  - `--skip-extensions`: Skip SQLite extension download.
  - `--skip-tooling`: Skip tooling detection/install.
  - `--skip-artifacts`: Skip CI artifact restore.
  - `--skip-index`: Skip file-backed index build.
  - `--skip-sqlite`: Skip SQLite index build.

## Notes

- Defaults follow `.pairofcleats.json` where applicable.
- Tree-sitter grammars load via WASM (`web-tree-sitter` + `tree-sitter-wasms`), avoiding native build dependencies.
- SQLite builds use file-backed indexes by default, and will stream from piece artifacts or incremental bundles when available.
- `build_index.js` can be run from any working directory; it resolves SQLite build tooling from the install root.
- Index builds write `preprocess.json` under the repo cache root with scan and skip statistics.
- Default ignore patterns can be overridden by adding negated entries (e.g. `!dist/allow.js`) in `extraIgnore`.
- Ignore files configured via `ignoreFiles` must resolve inside the repo root; outside paths are skipped with a warning.
- Index builds write `pieces/manifest.json` in each index directory to list artifact pieces and checksums.
- Use `node tools/index/assemble-pieces.js --input <indexDir> --out <dest>` to merge piece outputs into a single index directory.
- Use `node tools/index/compact-pieces.js --repo <repo>` to compact chunk_meta parts and token_postings shards.
- After setup, run `pairofcleats index validate` to confirm index artifacts are healthy.
- If you prefer a fast, no-prompts path, use `pairofcleats bootstrap`.
