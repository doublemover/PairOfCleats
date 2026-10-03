# PairOfCleats Search Showcase Fixture

This fixture is a repo-self search corpus for PairOfCleats.

It has two datasets:

- `eval.json`: a small stable subset compatible with `node tools/eval/run.js`
- `showcase.json`: a broader case catalog with categories, stability tiers, CLI args, prerequisites, and expected anchors

The showcase intentionally mixes:

- production sources under `src/` and `tools/`
- user-facing docs under `docs/`
- checked-in language and risk fixtures under `tests/fixtures/`

That split is deliberate. The main codebase provides the strongest repo-specific entrypoints and docs headings, while the checked-in language fixtures expose filters that need richer syntax and metadata shapes than the production sources naturally contain.

## Stability tiers

- `stable`: high-signal cases that should be useful in most indexed repo runs
- `optional`: cases that depend on specific index modes or enriched artifacts such as risk tags or SQLite indexes
- `exploratory`: worthwhile probes for advanced metadata filters that may not be available in every environment

## What this covers

- code, prose, and extracted-prose modes
- literal, phrase, path, and mixed queries
- path/file/ext/lang/type/signature/decorator/import filters
- behavioral and relation filters such as `--async`, `--generator`, and `--returns`
- output shaping with `--json`, `--compact`, `--stats`, and `--explain`
- backend routing probes for `memory`, `sqlite`, and `sqlite-fts`
- optional enriched filters such as `--risk`, `--risk-flow`, `--return-type`, and `--inferred-type`

## What is not in the default run

- federated workspace search
- record-only search cases
- structural-search filters

Those surfaces are real, but they are not good single-repo defaults for this corpus because they require extra workspace topology, pre-ingested records, or structural-match artifacts that are not guaranteed to exist in a normal local repo index.

## Useful commands

List the case catalog:

```powershell
node tools/testing/run-search-showcase.js --list
```

Run the stable default tier and capture each case into `.testLogs/search-showcase`:

```powershell
node tools/testing/run-search-showcase.js
```

Run the same matrix through a real PTY/ConPTY terminal review path:

```powershell
node tools/testing/run-search-showcase.js --pty
```

The default run executes each selected case across a terminal-size matrix:

- default inherited terminal size
- `72x20`
- `88x24`
- `104x28`
- `132x34`
- `188x30`
- `220x50`

Each capture records `COLUMNS` and `LINES` in `command.txt` and `meta.json`.
In PTY mode, each run also persists a merged terminal transcript in `terminal.ansi.log` and a stripped companion in `terminal.txt`.

Include optional and exploratory cases too:

```powershell
node tools/testing/run-search-showcase.js --include-optional --include-exploratory
```

Run one case only:

```powershell
node tools/testing/run-search-showcase.js --case code-parse-search-args
```

Override the terminal-size matrix:

```powershell
node tools/testing/run-search-showcase.js --size default --size 80x24 --size 188x30
```

Capture one search through a PTY directly:

```powershell
node tools/testing/capture-search-debug.js --pty --label help-review -- --help
```
