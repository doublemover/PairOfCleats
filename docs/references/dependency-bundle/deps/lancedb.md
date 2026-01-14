# `lancedb`

**Area:** External vector search backend

## Why this matters for PairOfCleats
Optional external backend for large-scale ANN retrieval.

## Implementation notes (practical)
- Confirm client initialization costs and connection pooling.
- Ensure fallbacks when the backend is unreachable.

## Where it typically plugs into PairOfCleats
- Optional external backend selection for search.

## Deep links (implementation-relevant)
1. README — https://github.com/lancedb/lancedb#readme

## Suggested extraction checklist
- [ ] Benchmark query latency vs sqlite-vec.
- [ ] Validate schema compatibility for index metadata.
