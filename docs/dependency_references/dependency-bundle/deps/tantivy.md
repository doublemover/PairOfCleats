# `tantivy`

**Area:** External search backend

## Why this matters for PairOfCleats
Optional high-performance full-text backend for large repositories.

## Implementation notes (practical)
- Ensure schema and tokenizer choices align with current index features.
- Provide clear fallback behavior when the backend is unavailable.

## Where it typically plugs into PairOfCleats
- Optional external backend selection for search.

## Deep links (implementation-relevant)
1. README -- https://github.com/quickwit-oss/tantivy#readme

## Suggested extraction checklist
- [ ] Validate parity for filters and scoring behavior.
- [ ] Benchmark ingest and query throughput.
