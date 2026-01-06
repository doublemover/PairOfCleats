# SCIP ingestion

Use the SCIP ingestion tool to import symbol occurrences from a SCIP JSON or JSONL export.

## Ingest JSON/JSONL

```bash
pairofcleats ingest scip --repo . --input scip.jsonl
```

## Run the SCIP CLI directly

```bash
pairofcleats ingest scip --repo . --run --input index.scip
```

## Outputs

- `scip.jsonl`: normalized symbol occurrences under the repo cache root.
- `scip.jsonl.meta.json`: summary metadata and per-kind counts.

## Notes

- Uses `scip print --format=json` when `--run` is specified.
- Occurrence roles are normalized to `definition`, `reference`, or `other`.
