# Unified Setup

The unified setup script (`npm run setup`) guides you through installing optional dependencies and building indexes in one flow. It is interactive by default and supports a non-interactive CI mode.

## Usage

- Interactive (recommended):
  - `npm run setup`
- Non-interactive (CI):
  - `npm run setup -- --non-interactive`
- Non-interactive with JSON summary:
  - `npm run setup -- --non-interactive --json`

## What it can do

- Install Node dependencies (`npm install`).
- Download dictionaries (English wordlist by default).
- Download embedding models.
- Download the SQLite ANN extension when configured.
- Detect and optionally install tooling.
- Restore CI artifacts when present.
- Build file-backed indexes (optionally incremental).
- Build SQLite indexes (optional).

## Flags

- `--non-interactive` / `--ci`: Skip prompts and use defaults.
- `--json`: Emit a summary report to stdout (logs go to stderr).
- `--with-sqlite`: Default SQLite build to yes.
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
- SQLite builds require file-backed indexes; setup will prompt if they are missing.
- If you prefer a fast, no-prompts path, use `npm run bootstrap`.
