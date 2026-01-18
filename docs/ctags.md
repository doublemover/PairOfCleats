# Ctags ingestion

Use the ctags ingestion tool to stream JSONL symbol output into a cache-backed artifact for later use.

## Generate JSONL from ctags

```bash
ctags --output-format=json --tag-relative=yes --recurse=yes . > ctags.jsonl
pairofcleats ingest ctags --repo . --input ctags.jsonl
```

## Run ctags directly

```bash
pairofcleats ingest ctags --repo . --run
```

## Interactive mode (stdin)

If you run ctags in interactive mode yourself, pipe JSONL output into stdin:

```bash
ctags --_interactive --output-format=json
# In another shell, feed the output into the ingest tool:
pairofcleats ingest ctags --repo . --input - --interactive
```

## Outputs

- `ctags.jsonl`: normalized symbol rows under the repo cache root.
- `ctags.jsonl.meta.json`: summary metadata and per-kind counts.

## Notes

- `--fields` and `--args` are passed to ctags when using `--run`.
- The tool stores file paths relative to the repo root and preserves ctags metadata where available.
