# Unified Setup

The unified setup script (`pairofcleats setup`) guides you through installing optional dependencies and building indexes in one flow. It is interactive by default and supports a non-interactive CI mode.

## Usage

- Interactive (recommended):
  - `pairofcleats setup`
- Non-interactive (CI):
- `pairofcleats setup --non-interactive`
- Non-interactive with JSON summary:
- `pairofcleats setup --non-interactive --json`

## What it can do

- Install Node dependencies (`npm install`).
- Download dictionaries (English wordlist by default).
- Download embedding models.
- Download the SQLite ANN extension when configured.
- Detect and optionally install tooling.
- Restore CI artifacts when present.
- Build file-backed indexes (optionally incremental).
- Build SQLite indexes (default unless `--skip-sqlite`).
- Offer to set a Node heap limit for large repos (writes `runtime.maxOldSpaceMb`).

## Flags

- `--non-interactive` / `--ci`: Skip prompts and use defaults.
- `--json`: Emit a summary report to stdout (logs go to stderr).
- `--profile <name>`: Select a profile from `profiles/*.json` and record it in `.pairofcleats.json`.
- `--with-sqlite`: Force SQLite build on (default behavior).
- `--incremental`: Use incremental indexing if available.
- `--validate-config`: Validate `.pairofcleats.json` before running setup.
- `--skip-validate`: Skip config validation prompts.
- `--heap-mb <mb>`: Persist a Node heap limit (max-old-space-size) in `.pairofcleats.json`.
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
- SQLite builds use file-backed indexes by default, but will stream from incremental bundles when available.
- `build_index.js` can be run from any working directory; it resolves SQLite build tooling from the install root.
- After setup, run `pairofcleats index-validate` to confirm index artifacts are healthy.
- If you prefer a fast, no-prompts path, use `pairofcleats bootstrap`.
