# Ctags ingest

Use the ctags ingest tool to normalize ctags JSON into a cache-backed JSONL artifact.

## CLI

```bash
# Run ctags directly (default when no --input is provided)
node tools/ctags-ingest.js --repo . --run

# Or via npm
npm run ctags-ingest -- --repo . --run

# Ingest a pre-generated JSONL file
node tools/ctags-ingest.js --repo . --input ctags.jsonl --out ./ctags.jsonl

# Stream JSONL from stdin
ctags --output-format=json --tag-relative=yes --recurse=yes . | node tools/ctags-ingest.js --repo . --input -
```

## Options

- `--repo`: repo root used to resolve paths and the cache root (defaults to auto-detected repo root).
- `--input`: JSONL file path or `-` for stdin. When omitted, the tool runs ctags.
- `--run`: execute `ctags` directly (same behavior as omitting `--input`).
- `--interactive`: read JSONL from stdin (use with `ctags --_interactive` in another shell).
- `--ctags`: ctags binary name (default: `ctags`).
- `--fields`: value passed to `ctags --fields=...` when running ctags.
- `--args`: extra args appended to the ctags command (split on whitespace).
- `--out`: output JSONL path (default: `<cacheRoot>/ctags/ctags.jsonl`).
- `--json`: emit the summary JSON to stdout instead of status lines.

## Output

- JSONL entries include: `file`, `ext`, `name`, `kind`, `kindName`, `signature`, `startLine`, `endLine`, plus scope/access/language fields when present.
- `<output>.meta.json`: summary with `generatedAt`, `repoRoot`, `input`, `output`, and `stats` (entries, ignored, errors, kinds, languages).

## Notes

- When running ctags, the tool uses `ctags --output-format=json --tag-relative=yes --recurse=yes <repoRoot>` plus any `--fields`/`--args`.
- Paths are normalized relative to the repo root.
- If `--input` points to a file, it is used even if `--run` is set.
