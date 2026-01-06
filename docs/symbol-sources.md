# Symbol sources and precedence

PairOfCleats can ingest symbols from multiple sources. This document defines precedence, fallback behavior, and how artifacts are stored.

## Sources (highest priority first)

1) LSP tooling (clangd/sourcekit-lsp/tsserver)
- Best for exact signatures, types, and live project configuration.
- Applies during indexing and enriches chunk metadata.

2) SCIP ingestion
- Offline code intelligence. Preferred when available because it carries definitions + references in a standard format.
- Ingested via `pairofcleats ingest scip`.

3) LSIF ingestion
- Offline graph for definitions/references; often produced by CI.
- Ingested via `pairofcleats ingest lsif`.

4) Ctags ingestion
- Fast, broad symbol discovery, fewer type details.
- Ingested via `pairofcleats ingest ctags`.

5) GNU Global (GTAGS) ingestion
- Fallback symbol lookup for repos without tooling/ctags coverage.
- Ingested via `pairofcleats ingest gtags`.

6) Heuristic / AST chunking
- Always available; used as a baseline when no external sources are present.

## Precedence rules

- LSP wins over offline sources when both are available.
- SCIP overrides LSIF and ctags for definitions/references when both exist.
- LSIF overrides ctags for definitions/references when both exist.
- Ctags does not replace AST chunking; it augments symbol lookup and navigation.
- GTAGS is used as a fallback when other external sources are not available.

## Storage locations

All artifacts live in the repo cache root (outside the repo by default):

- `builds/<buildId>/index-code/` + `builds/<buildId>/index-prose/`: chunk metadata, postings, and repo map.
- `builds/current.json`: pointer to the active build root.
- `scip/scip.jsonl`: normalized SCIP occurrences + metadata.
- `lsif/lsif.jsonl`: normalized LSIF occurrences + metadata.
- `ctags/ctags.jsonl`: normalized ctags symbols + metadata.
- `gtags/gtags.jsonl`: normalized GNU Global symbols + metadata.

## Notes

- The ingestion tools do not mutate the main index; they provide additional symbol sources.
- When multiple sources provide the same symbol, the higher-precedence source is favored in future lookups.
- If a source is stale or missing, the next available source is used automatically.
