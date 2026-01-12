# PairOfCleats Sublime Text

PairOfCleats integration for Sublime Text 3.

## Install

- Copy or symlink `sublime/PairOfCleats` into your Sublime `Packages` directory.
- Ensure Node.js 18+ is available on PATH (or set `node_path`).
- Install the PairOfCleats CLI (global npm install or local repo checkout).

## Package Control notes

This package avoids external Python dependencies. It relies on the Node runtime
and the PairOfCleats CLI or local repo binaries.

## CLI discovery

Resolution order:
1) `pairofcleats_path` setting (absolute or repo-relative)
2) `node_modules/.bin/pairofcleats` (repo-local)
3) `bin/pairofcleats.js` (repo-local)
4) `pairofcleats` on PATH

If the selected path ends in `.js`, the plugin runs it with `node_path` (or `node`).

## Settings

Open the command palette and run `PairOfCleats: Open Settings` or `PairOfCleats: Validate Settings`.

- `pairofcleats_path`: Path to the CLI binary or `bin/pairofcleats.js`.
- `node_path`: Optional override for the Node.js binary.
- `index_mode_default`: `code`, `prose`, or `both`.
- `search_backend_default`: `memory`, `sqlite`, `sqlite-fts`, or `lmdb`.
- `open_results_in`: `quick_panel`, `new_tab`, or `output_panel`.
- `profile`: Sets `PAIROFCLEATS_PROFILE`.
- `cache_root`: Sets `PAIROFCLEATS_CACHE_ROOT`.
- `embeddings_mode`: Sets `PAIROFCLEATS_EMBEDDINGS`.
- `node_options`: Sets `PAIROFCLEATS_NODE_OPTIONS`.
- `env`: Extra environment overrides (merged with defaults).

## Project overrides

In your `.sublime-project` file:

```json
{
  "settings": {
    "pairofcleats": {
      "pairofcleats_path": "./bin/pairofcleats.js",
      "env": {
        "PAIROFCLEATS_PROFILE": "balanced"
      }
    }
  }
}
```

## CLI output contract

The Sublime integration is designed to use `--json` output so it can access full
metadata when available. It does not assume the compact JSON contract used by
other editors.
