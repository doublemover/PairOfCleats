# Metrics Dashboard

## Goal
Provide a fast console summary of indexing and search metrics, with optional JSON output for external dashboards.

## Usage
- `pairofcleats report metrics`
- `pairofcleats report metrics --json`
- `pairofcleats report metrics --out metrics-summary.json`

## Summary Fields
- Index metrics: chunks, tokens, cache hit rate, BM25 params, timings.
- Search history: total queries, average latency, top queries.
- No-result count.
- Top files and terms (by search hits).

## Inputs
- `metrics/index-<mode>.json` (index build metrics)
- `metrics/metrics.json` (file hit + term lists)
- `metrics/searchHistory` (JSONL)
- `metrics/noResultQueries` (JSONL)
