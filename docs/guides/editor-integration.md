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

- prefers the active editor's workspace folder when multiple folders are open
- prompts for a workspace folder when no active editor pins the target
- currently supports local `file:` workspaces only; remote workspace URIs fail closed with an explicit error

Operational command behavior:

- setup/bootstrap/doctor/config-dump/index-health run against the selected local repo root
- setup/bootstrap/doctor use the configured CLI resolution path
- config-dump uses `tools/config/dump.js --json --repo <repo>`
- index-health uses `tools/index/report-artifacts.js --json --repo <repo>`
- command output is summarized in the `PairOfCleats` output channel with the raw JSON payload appended below the summary

## Sublime package

The Sublime package source lives under `sublime/PairOfCleats` and is emitted as `dist/sublime/pairofcleats.sublime-package`.
