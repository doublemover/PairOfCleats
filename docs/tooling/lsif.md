# LSIF ingest

Use the LSIF ingest tool to import LSIF JSONL graphs into normalized symbol occurrences.

## CLI

```bash
node tools/lsif-ingest.js --repo . --input dump.lsif

# Or via npm
npm run lsif-ingest -- --repo . --input dump.lsif

# Read from stdin
cat dump.lsif | node tools/lsif-ingest.js --repo . --input -
```

## Options

- `--repo`: repo root used to resolve paths and the cache root (defaults to auto-detected repo root).
- `--input`: LSIF JSONL file path or `-` for stdin (stdin is used when omitted).
- `--out`: output JSONL path (default: `<cacheRoot>/lsif/lsif.jsonl`).
- `--json`: emit the summary JSON to stdout instead of status lines.

## Output

- JSONL entries include: `file`, `ext`, `name`, `kind`, `startLine`, `endLine`, `startChar`, `endChar`, `role`, `language`.
- `<output>.meta.json`: summary with `generatedAt`, `repoRoot`, `input`, `output`, and `stats` (vertices, edges, definitions, references, errors, kinds, languages).

## Notes

- The ingest expects LSIF JSONL with `vertex` and `edge` records.
- `item` edges linked to `definitionResult` or `referenceResult` vertices are mapped to `role=definition` or `role=reference`; other items become `role=other`.
- Document URIs like `/repo/...` are normalized to repo-relative paths.
