# Repo inventory report

The repo inventory report summarizes docs, tool entrypoints, and script references so we can track drift.

## CLI

```bash
node tools/docs/repo-inventory.js --root . --json docs/tooling/repo-inventory.json
```

The CLI help identifies itself as `pairofcleats repo-inventory`.

## Local generated reports

The following reports are generated locally and ignored by Git. A clean clone does not contain them:

- `docs/tooling/repo-inventory.json`
- `docs/tooling/shared-module-ledger.json`
- `docs/tooling/shared-module-ledger.md`
- `docs/testing/suite-taxonomy.json`
- `docs/testing/suite-taxonomy.md`

Generate the reports you need with:

```bash
node tools/docs/repo-inventory.js
node tools/docs/shared-module-ledger.js
node tools/testing/generate-suite-taxonomy-report.js
```

Their ownership, outputs and refresh commands are recorded in
[`generated-surfaces.json`](generated-surfaces.json). You can also refresh one report family with
`node tools/docs/generated-surfaces.js --refresh --surface <id>`, using `repo-inventory`,
`shared-module-ledger`, or `suite-taxonomy` as the ID.

Policy tests build repository inventories and shared-module ledgers directly from the current sources.
They do not require, trust, or rewrite cached reports. Generated-surface freshness checks compare two
independent temporary generations for the inventory and ledger, ignoring JSON generation timestamps;
the suite taxonomy uses its report contract test. Stale or missing local reports do not invalidate a clean
clone, but failed generators, missing generated outputs and non-reproducible content still fail validation.
Use the refresh commands before reading a local report to bring it up to date.
The five local output paths are also excluded from repository inventory inputs, so the report has the
same content whether those caches are missing, present, or stale. Authored docs in the same directories
remain part of the inventory.

This policy applies only to these five reports. Authored documentation, schemas, runtime assets and
other committed generated surfaces remain tracked and retain their existing presence and freshness checks.
Document local output paths as code with their generation instructions, rather than links to files on GitHub.

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

- Docs references are extracted from authored/committed docs Markdown, `README.md`, `AGENTS.md`, and JavaScript under `bin/`, `src/`, and `tools/`.
- Script references are collected from docs (excluding `docs/guides/commands.md` and the exact local output paths above), `.github` workflows, and `tests`.
- Tool entrypoints are `.js` files in `tools/` with a `#!/usr/bin/env node` shebang.
