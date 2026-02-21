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

The bundled VS Code extension lives in `extensions/vscode` and defines `PairOfCleats: Search`.

Settings:

- `pairofcleats.cliPath`
- `pairofcleats.cliArgs`
- `pairofcleats.searchMode`
- `pairofcleats.searchBackend`
- `pairofcleats.searchAnn`
- `pairofcleats.maxResults`
- `pairofcleats.extraSearchArgs`

## Sublime package

The Sublime package source lives under `sublime/PairOfCleats` and is emitted as `dist/sublime/pairofcleats.sublime-package`.
