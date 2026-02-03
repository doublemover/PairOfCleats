# Repo inventory report

The repo inventory report summarizes docs, tool entrypoints, and script references so we can track drift.

## CLI

```bash
node tools/docs/repo-inventory.js --root . --json docs/tooling/repo-inventory.json
```

The CLI help identifies itself as `pairofcleats repo-inventory`.

## Options

- `--root`: repo root to scan (defaults to the current working directory).
- `--json`: output path for the JSON report (default: `docs/tooling/repo-inventory.json`).

## Report structure

Top-level keys:
- `generatedAt`, `generatedBy`, `root`
- `docs`: `sources`, `files`, `referenced`, `orphans`
- `tools`: `entrypoints`, `referencedByScripts`, `referencedByCli`, `referenced`, `orphans`
- `scripts`: `all`, `referencedByDocs`, `referencedByCi`, `referencedByTests`, `referenced`, `orphans`
- `notes`: scan scope and exclusions

## Collection rules

- Docs references are extracted only from `README.md` and `AGENTS.md`.
- Script references are collected from docs (excluding `docs/guides/commands.md`), `.github` workflows, and `tests`.
- Tool entrypoints are `.js` files in `tools/` with a `#!/usr/bin/env node` shebang.
