# SCIP ingest

Use the SCIP ingest tool to import symbol occurrences from a SCIP JSON or JSONL export.

## CLI

```bash
node tools/scip-ingest.js --repo . --input scip.jsonl

# Or via npm
npm run scip-ingest -- --repo . --input scip.jsonl

# Run the SCIP CLI directly
node tools/scip-ingest.js --repo . --run --input index.scip

# Read JSONL from stdin
scip print --format=json --input index.scip | node tools/scip-ingest.js --repo . --input -
```

## Options

- `--repo`: repo root used to resolve paths and the cache root (defaults to auto-detected repo root).
- `--input`: JSON/JSONL file path or `-` for stdin (stdin is used when omitted).
- `--run`: execute `scip print --format=json` (uses `--input` when provided).
- `--scip`: scip binary name (default: `scip`).
- `--args`: extra args appended to the `scip print` command (split on whitespace).
- `--out`: output JSONL path (default: `<cacheRoot>/scip/scip.jsonl`).
- `--json`: emit the summary JSON to stdout instead of status lines.

## Output

- JSONL entries include: `file`, `ext`, `name`, `symbol`, `kind`, `signature`, `startLine`, `endLine`, `startChar`, `endChar`, `role`, `language`, `scope`, `scopeKind`.
- `<output>.meta.json`: summary with `generatedAt`, `repoRoot`, `input`, `output`, and `stats` (documents, occurrences, definitions, references, errors, kinds, languages).

## Notes

- When `--input` points to a file, the tool first tries to parse it as a full JSON document; if that fails, it falls back to JSONL.
- Roles are derived from `symbolRoles` bit flags (definition/reference/other).
- Paths are normalized relative to the repo root.
