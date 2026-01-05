# Repometrics Dashboard

## Goal
Provide a fast console summary of indexing and search metrics, with optional JSON output for external dashboards.

## Usage
- `pairofcleats repometrics-dashboard`
- `pairofcleats repometrics-dashboard --json`
- `pairofcleats repometrics-dashboard --out repometrics-summary.json`

## Summary Fields
- Index metrics: chunks, tokens, cache hit rate, BM25 params, timings.
- Search history: total queries, average latency, top queries.
- No-result count.
- Top files and terms (by search hits).

## Inputs
- `repometrics/index-<mode>.json` (index build metrics)
- `repometrics/metrics.json` (file hit + term lists)
- `repometrics/searchHistory` (JSONL)
- `repometrics/noResultQueries` (JSONL)
