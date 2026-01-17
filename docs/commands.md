# Command Surface

PairOfCleats uses the `pairofcleats` CLI as the primary interface. `npm run <script>`
wrappers remain available for CI or local convenience, but the list is intentionally
small. If the binary is not on your PATH, use `node bin/pairofcleats.js`.

Experimental commands require `profile=full` (or `PAIROFCLEATS_PROFILE=full`).

## Core
- `pairofcleats setup`
- `pairofcleats bootstrap`
- `pairofcleats search`
- `pairofcleats index build`
- `pairofcleats index watch`
- `pairofcleats index validate`
- `pairofcleats embeddings build`
- `pairofcleats generate-repo-dict`
- `pairofcleats git-hooks`

## SQLite
- `pairofcleats sqlite build`
- `pairofcleats sqlite compact`
- `pairofcleats sqlite search` (defaults to `sqlite-fts` when `--backend` is omitted)

## LMDB
- `pairofcleats lmdb build`

## Assets
- `pairofcleats assets dicts`
- `pairofcleats assets models`
- `pairofcleats assets extensions`
- `pairofcleats assets extensions-verify`

## Tooling
- `pairofcleats tooling detect`
- `pairofcleats tooling install`

## Ingest
- `pairofcleats ingest ctags`
- `pairofcleats ingest scip`
- `pairofcleats ingest lsif`
- `pairofcleats ingest gtags`

## Structural
- `pairofcleats structural search`

## Cache
- `pairofcleats cache gc`
- `pairofcleats cache clean`
- `pairofcleats cache report`

## Reports
- `pairofcleats report repometrics`
- `pairofcleats report compare-models`
- `pairofcleats report summary`
- `pairofcleats report eval`

## Services
- `pairofcleats service api`
- `pairofcleats service indexer`
- `pairofcleats service mcp`

## Config + triage
- `pairofcleats config validate`
- `pairofcleats config dump`
- `pairofcleats config reset`
- `pairofcleats triage ingest`
- `pairofcleats triage decision`
- `pairofcleats triage context-pack`

## Benchmarks
- `pairofcleats bench micro`
- `pairofcleats bench language`
- `pairofcleats bench matrix`

## Migration notes
- Language-specific bench scripts were removed; use `pairofcleats bench language --language <lang>`
  and `--tier <typical|large>` instead.

## Tests
- `pairofcleats test`
- `npm run test`
- `npm run test:smoke` / `npm run test:unit` / `npm run test:integration`
- `npm run test:services` / `npm run test:storage` / `npm run test:perf` / `npm run test:ci`
- `npm run test:list`
- `npm run verify`

Use `node tests/run.js --list` to see the resolved test IDs for your filters.
