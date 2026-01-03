# LSIF ingestion

Use the LSIF ingestion tool to import offline code intelligence graphs.

## Ingest JSONL

```bash
node tools/lsif-ingest.js --repo . --input dump.lsif
```

## Outputs

- `lsif.jsonl`: normalized symbol occurrences under the repo cache root.
- `lsif.jsonl.meta.json`: summary metadata and per-kind counts.

## Notes

- LSIF output is a JSONL graph (vertices + edges).
- Definitions and references are derived from `definitionResult` and `referenceResult` edges.
