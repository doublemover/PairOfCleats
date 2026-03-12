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

Open the command palette and run:
- `PairOfCleats: Open Settings`
- `PairOfCleats: Open Project Settings`
- `PairOfCleats: Project Settings Template`
- `PairOfCleats: Show Effective Settings`
- `PairOfCleats: Validate Settings`

Core:
- `pairofcleats_path`: Path to the CLI binary or `bin/pairofcleats.js`.
- `node_path`: Optional override for the Node.js binary.
- `index_mode_default`: `code`, `prose`, or `both`.
- `search_backend_default`: `memory`, `sqlite`, `sqlite-fts`, or `lmdb`.
- `search_limit`: Default `--top` value.
- `search_prompt_options`: Prompt for mode/backend/limit each search.
- `history_limit`: Maximum queries stored per project.

API:
- `api_server_url`: Base URL for API-backed workflows.
- `api_timeout_ms`: Timeout for API requests in milliseconds.

Output:
- `open_results_in`: `quick_panel`, `new_tab`, or `output_panel`.
- `results_buffer_threshold`: When using `quick_panel`, switch to the output panel once results reach this count (`0` disables).

Watch:
- `index_watch_scope`: `repo` or `folder` for watch root selection.
- `index_watch_folder`: Optional folder path (absolute or repo-relative) when using `folder` scope.
- `index_watch_mode`: `all`, `code`, `prose`, `records`, or `extracted-prose`.
- `index_watch_poll_ms`: Watch polling interval in ms (when polling is enabled).
- `index_watch_debounce_ms`: Debounce interval for watch rebuilds (ms).

Map:
- `map_type_default`: `combined`, `imports`, `calls`, `usages`, or `dataflow`.
- `map_format_default`: `html-iso`, `html`, `svg`, `dot`, or `json`.
- `map_prompt_options`: Prompt for map type/format each run.
- `map_output_dir`: Output directory for map artifacts (absolute or repo-relative).
- `map_only_exported`: When true, include exported symbols only.
- `map_collapse_default`: `none`, `file`, or `dir`.
- `map_max_files`: Guardrail for file nodes.
- `map_max_members_per_file`: Guardrail for members per file.
- `map_max_edges`: Guardrail for edges.
- `map_top_k_by_degree`: Prefer top-k files by edge degree when truncating.
- `map_show_report_panel`: `true`, `false`, or `null` to control map summary panel behavior.
- `map_stream_output`: Stream CLI output to the map panel.
- `map_open_uri_template`: URI template for the isometric viewer (Sublime links).
- `map_three_url`: Override three.js module path (default resolves from node_modules).
- `map_index_mode`: Index mode to read (`code` or `prose`).
- `map_wasd_sensitivity`: Isometric viewer WASD sensitivity.
- `map_wasd_acceleration`: Isometric viewer WASD acceleration.
- `map_wasd_max_speed`: Isometric viewer WASD max speed.
- `map_wasd_drag`: Isometric viewer WASD damping.
- `map_zoom_sensitivity`: Isometric viewer zoom sensitivity.

Environment:
- `env`: Extra environment values (for `PAIROFCLEATS_API_TOKEN`, etc.).

## Commands

- `PairOfCleats: Open Settings`
- `PairOfCleats: Open Project Settings`
- `PairOfCleats: Show Effective Settings`
- `PairOfCleats: Validate Settings`
- `PairOfCleats: Search`
- `PairOfCleats: Search (With Options)`
- `PairOfCleats: Search Selection`
- `PairOfCleats: Search Symbol Under Cursor`
- `PairOfCleats: Search History`
- `PairOfCleats: Repeat Last Search`
- `PairOfCleats: Explain Search`
- `PairOfCleats: Index Build (Code)`
- `PairOfCleats: Index Build (Prose)`
- `PairOfCleats: Index Build (All)`
- `PairOfCleats: Index Watch Start`
- `PairOfCleats: Index Watch Stop`
- `PairOfCleats: Index Validate`
- `PairOfCleats: Open Index Directory`
- `PairOfCleats: Map (Repo)`
- `PairOfCleats: Map (Current Folder)`
- `PairOfCleats: Map (Current File)`
- `PairOfCleats: Map (Symbol Under Cursor)`
- `PairOfCleats: Map (Selection)`
- `PairOfCleats: Map Jump to Node`
- `PairOfCleats: Map Open Last Viewer`
- `PairOfCleats: Map Show Last Report`

## Project overrides

In your `.sublime-project` file:

```json
{
  "settings": {
    "pairofcleats": {
      "pairofcleats_path": "./bin/pairofcleats.js",
      "api_server_url": "http://127.0.0.1:4152",
      "open_results_in": "output_panel",
      "index_watch_scope": "folder",
      "index_watch_folder": "./src",
      "map_stream_output": true,
      "env": {
        "PAIROFCLEATS_API_TOKEN": "..."
      }
    }
  }
}
```

Project overrides replace base settings key-for-key.
`env` is the only merged setting: package/user `env` values are loaded first, then project `env` values override conflicts.
Use `PairOfCleats: Show Effective Settings` to inspect the final merged settings for the current window.
Use `PairOfCleats: Project Settings Template` to open a copy/paste starter payload for `.sublime-project`.

## CLI output contract

The Sublime integration is designed to use `--json` output so it can access full
metadata when available. It does not assume the compact JSON contract used by
other editors.
