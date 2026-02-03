# GNU Global (GTAGS) ingest

Use the GTAGS ingest tool to convert `global -x` output into normalized JSONL.

## CLI

```bash
# Run global -x inside the repo
node tools/gtags-ingest.js --repo . --run

# Or via npm
npm run gtags-ingest -- --repo . --run

# Ingest from a file
node tools/gtags-ingest.js --repo . --input gtags.txt --out ./gtags.jsonl

# Read from stdin (default when --run is not used)
global -x | node tools/gtags-ingest.js --repo . --input -
```

## Options

- `--repo`: repo root used to resolve paths and the cache root (defaults to auto-detected repo root).
- `--input`: text file path or `-` for stdin. If omitted and `--run` is not set, stdin is used.
- `--run`: execute `global -x` directly.
- `--global`: global binary name (default: `global`).
- `--args`: extra args appended to the `global -x` command (split on whitespace).
- `--out`: output JSONL path (default: `<cacheRoot>/gtags/gtags.jsonl`).
- `--json`: emit the summary JSON to stdout instead of status lines.

## Output

- JSONL entries include: `file`, `ext`, `name`, `startLine`, `endLine`, `role` (always `definition`), `source` (`gtags`).
- `<output>.meta.json`: summary with `generatedAt`, `repoRoot`, `input`, `output`, and `stats` (entries, errors).

## Notes

- The tool expects `global -x` format: `name line file`.
- Paths are normalized relative to the repo root.
