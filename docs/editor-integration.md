# Editor Integration

## CLI contract for editor tooling
Editor integrations shell out to the CLI and expect JSON output.
- The VS Code extension uses `--json-compact`.
- The Sublime Text integration is designed to use `--json` to retain full metadata.

The JSON payload contains the following top-level keys:
- `backend`: the selected backend (`memory`, `sqlite`, `sqlite-fts`, `lmdb`).
- `code`, `prose`, `records`: arrays of result hits (may be empty).
- `stats`: search timing and cache metadata.

Compact hit fields (subset, for `--json-compact`):
- `file`: repo-relative path for the chunk.
- `startLine`, `endLine`: 1-based line numbers for editor navigation.
- `start`, `end`: byte offsets (optional).
- `kind`, `name`, `headline`.
- `score`, `scoreType`, `sparseScore`, `annScore`.
- `scoreBreakdown` (optional when `--explain` is used).

Editor integrations should prefer `file` + `startLine` for navigation. If line
numbers are missing, fall back to file-only navigation.

## VS Code extension (CLI shell-out)
The bundled VS Code extension lives in `extensions/vscode` and defines a single
command: `PairOfCleats: Search`. It:
- prompts for a query
- runs `pairofcleats search --json-compact`
- shows a Quick Pick for results
- opens the selected file at `startLine`

### Settings
- `pairofcleats.cliPath`: override the CLI command or point to a JS entrypoint.
- `pairofcleats.cliArgs`: arguments inserted before the `search` command.
- `pairofcleats.searchMode`: default search mode (code + prose + extracted-prose by default).
- `pairofcleats.searchBackend`: optional backend override.
- `pairofcleats.searchAnn`: enable/disable ANN usage.
- `pairofcleats.maxResults`: max results to request.
- `pairofcleats.extraSearchArgs`: extra search flags appended to the CLI call.

### Notes
- If `cliPath` is empty and the workspace contains `bin/pairofcleats.js`, the
  extension uses `node` with that entrypoint. Otherwise it falls back to the
  `pairofcleats` binary in PATH.
- The extension assumes a trusted local workspace and does not attempt to
  sandbox CLI execution.
