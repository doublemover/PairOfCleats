# Editor Integration

## CLI contract for editor tooling

Editor integrations shell out to the CLI and expect JSON output.

- VS Code uses `--json`.
- Sublime Text uses `--json` for structured result metadata.

The JSON payload includes top-level search buckets (`code`, `prose`, `extractedProse`, `records`) plus backend and optional stats/explain fields.

## Deterministic packaging flow

Canonical packaging commands:

```bash
npm run package-sublime
npm run package-vscode
```

Smoke checks (used by release-check):

```bash
node tools/package-sublime.js --smoke
node tools/package-vscode.js --smoke
```

Packaging behavior is deterministic:

- stable file ordering
- normalized archive roots (`PairOfCleats/`, `extension/`)
- fixed archive metadata (`mtime`, mode bits)
- per-archive SHA-256 output and JSON manifest

See `docs/specs/editor-packaging-determinism.md` for contract details.

## VS Code extension

The bundled VS Code extension lives in `extensions/vscode` and defines:

- `PairOfCleats: Search`
- `PairOfCleats: Setup`
- `PairOfCleats: Bootstrap`
- `PairOfCleats: Tooling Doctor`
- `PairOfCleats: Config Dump`
- `PairOfCleats: Index Health`
- `PairOfCleats: Code Map`
- `PairOfCleats: Architecture Check`
- `PairOfCleats: Impact Analysis`
- `PairOfCleats: Suggest Tests`
- `PairOfCleats: Workspace Manifest`
- `PairOfCleats: Workspace Status`
- `PairOfCleats: Workspace Build`
- `PairOfCleats: Workspace Catalog`
- `PairOfCleats: Workflow Status`
- `PairOfCleats: Rerun Last Workflow`
- `PairOfCleats: Recent Workflows`
- `PairOfCleats: Reopen Last Results`
- `PairOfCleats: Search History`
- `PairOfCleats: Group Results by Section`
- `PairOfCleats: Group Results by File`
- `PairOfCleats: Group Results by Query`

Settings:

- `pairofcleats.cliPath`
- `pairofcleats.cliArgs`
- `pairofcleats.searchMode`
- `pairofcleats.searchBackend`
- `pairofcleats.searchAnn`
- `pairofcleats.maxResults`
- `pairofcleats.searchContextLines`
- `pairofcleats.searchFile`
- `pairofcleats.searchPath`
- `pairofcleats.searchLang`
- `pairofcleats.searchExt`
- `pairofcleats.searchType`
- `pairofcleats.searchCaseSensitive`
- `pairofcleats.env`
- `pairofcleats.extraSearchArgs`

The VS Code search command forwards these common search flags directly instead of forcing normal workflows through `extraSearchArgs`.

Repo targeting behavior:

- resolves repo context at the repo-root level, not only at the workspace-folder level
- prefers the active editor's nearest repo root when it sits inside a nested repo
- prompts for an explicit repo root when multiple local repo candidates are open and no active editor pins the target
- keeps the selected repo label visible in workflow status and persisted search result sets
- currently supports local `file:` workspaces only; remote workspace URIs fail closed with an explicit error

Operational command behavior:

- setup/bootstrap/doctor/config-dump/index-health run against the selected local repo root
- setup/bootstrap/doctor use the configured CLI resolution path
- config-dump uses `tools/config/dump.js --json --repo <repo>`
- index-health uses `tools/index/report-artifacts.js --json --repo <repo>`
- code-map uses `pairofcleats report map --json --format html-iso --out ...` and opens the generated map artifact
- architecture-check uses `pairofcleats architecture-check --json --repo <repo> --rules <path>`
- impact uses `pairofcleats impact --json --repo <repo> ...` with prompted seed/changed inputs
- suggest-tests uses `pairofcleats suggest-tests --json --repo <repo> ...` with prompted changed paths
- workspace commands use `pairofcleats workspace manifest|status|build|catalog --json --workspace <path>`
- long-running workflow commands persist session metadata in workspace state, drive a status bar item keyed to the active repo context, and expose rerun/recent-workflow commands without requiring a second task runner stack
- search runs persist normalized result sets in workspace state, populate the `PairOfCleats Results` explorer view, and support grouping by query, section, or file
- saved result-set actions support open, reveal-in-explorer, copy-path, reopen-last-results, and rerun from history
- command output is summarized in the `PairOfCleats` output channel with the raw JSON payload appended below the summary

## Sublime package

The Sublime package source lives under `sublime/PairOfCleats` and is emitted as `dist/sublime/pairofcleats.sublime-package`.
